'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveAutoSubs } = require('../auto-subs');

const TYPES = { GKP: 1, DEF: 2, MID: 3, FWD: 4 };
const FORMATIONS = [[3, 4, 3], [3, 5, 2], [4, 3, 3], [4, 4, 2], [4, 5, 1], [5, 2, 3], [5, 3, 2], [5, 4, 1]];
function setup([defenders, midfielders, forwards] = [4, 4, 2], benchOrder = null) {
  const outfieldBench = benchOrder || [
    ...Array(5 - defenders).fill('DEF'), ...Array(5 - midfielders).fill('MID'), ...Array(3 - forwards).fill('FWD'),
  ];
  const types = ['GKP', ...Array(defenders).fill('DEF'), ...Array(midfielders).fill('MID'),
    ...Array(forwards).fill('FWD'), 'GKP', ...outfieldBench];
  const picks = types.map((_, index) => ({ element: index + 1, position: index + 1, multiplier: 1 }));
  const players = new Map(types.map((pos, index) => [index + 1, { id: index + 1, name: `Player ${index + 1}`, pos, teamCode: 1000 + index + 1 }]));
  const teams = types.map((_, index) => ({ id: index + 1, code: 1000 + index + 1 }));
  teams.push({ id: 99, code: 1099 });
  const fixtures = types.map((_, index) => ({ id: index + 1, event: 3, team_h: index + 1, team_a: 99, started: true, finished: true }));
  const live = { elements: Object.fromEntries(types.map((_, index) => [index + 1, {
    stats: { minutes: 90, total_points: 2, yellow_cards: 0, red_cards: 0 }, explain: [[[], index + 1]],
  }])) };
  return { payload: { picks, subs: [] }, players, teams, fixtures, live, options: { gw: 3 }, types };
}
function resolve(s) { return resolveAutoSubs(s.payload, s.players, s.live, s.fixtures, s.teams, s.options); }
function state(s, id, availability) {
  const stats = s.live.elements[id].stats;
  stats.minutes = availability === 'played' ? 90 : 0;
  stats.total_points = availability === 'played' ? 2 : 0;
  s.fixtures.find(fixture => fixture.id === id).finished = availability !== 'pending';
  if (availability === 'unknown') delete stats.minutes;
}
function incoming(result, source = 'projected') { return result.substitutions.filter(sub => sub.source === source).map(sub => sub.element_in).sort((a, b) => a - b); }
function assertPositionIntegrity(result) {
  assert.equal(result.positions.size, 15);
  assert.deepEqual([...result.positions.values()].sort((a, b) => a - b), Array.from({ length: 15 }, (_, index) => index + 1));
  assert.equal([...result.positions.values()].filter(position => position <= 11).length, 11);
}
function assertLegal(s, result) {
  const counts = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const [id, position] of result.positions) if (position <= 11) counts[s.types[id - 1]]++;
  assert.equal(counts.GKP, 1);
  assert.ok(counts.DEF >= 3 && counts.DEF <= 5);
  assert.ok(counts.MID >= 2 && counts.MID <= 5);
  assert.ok(counts.FWD >= 1 && counts.FWD <= 3);
}

test('completed zero-minute no-card Ekitike-type starter is replaced by first legal outfield reserve', () => {
  const s = setup([4, 4, 2], ['MID', 'DEF', 'FWD']);
  state(s, 11, 'absent');
  const result = resolve(s);
  assert.deepEqual(result.substitutions, [{ element_out: 11, element_in: 13, source: 'projected', pending: false }]);
  assert.equal(result.provisional, true);
  assert.equal(result.positions.get(13), 11);
  assert.equal(result.positions.get(11), 13);
  assertPositionIntegrity(result);
  assertLegal(s, result);
});

test('first eligible pending reserve retains priority over a later already-played high scorer', () => {
  const s = setup([4, 4, 2], ['MID', 'DEF', 'FWD']);
  state(s, 11, 'absent');
  state(s, 13, 'pending');
  s.live.elements[14].stats.total_points = 30;
  const result = resolve(s);
  assert.deepEqual(incoming(result), [13]);
  assert.equal(result.substitutions[0].pending, true);
  assert.equal(s.live.elements[13].stats.total_points, 0);
  assert.equal(s.live.elements[13].stats.minutes, 0);
});

test('a confirmed nonplaying first reserve is skipped, but an unknown earlier reserve blocks promotion', () => {
  const s = setup([4, 4, 2], ['MID', 'DEF', 'FWD']);
  state(s, 11, 'absent');
  state(s, 13, 'absent');
  assert.deepEqual(incoming(resolve(s)), [14]);
  state(s, 13, 'unknown');
  assert.deepEqual(incoming(resolve(s)), []);
});

test('minimum defenders and forwards are retained even when a higher-priority reserve has played', () => {
  const defenders = setup([3, 4, 3], ['MID', 'DEF', 'DEF']);
  state(defenders, 2, 'absent');
  assert.deepEqual(incoming(resolve(defenders)), [14]);
  const forwards = setup([4, 5, 1], ['DEF', 'FWD', 'FWD']);
  state(forwards, 11, 'absent');
  assert.deepEqual(incoming(resolve(forwards)), [14]);
});

test('several simultaneous absences produce a legal maximum plan in bench order', () => {
  const s = setup([3, 4, 3], ['MID', 'DEF', 'DEF']);
  for (const id of [2, 3, 5]) state(s, id, 'absent');
  const result = resolve(s);
  assert.deepEqual(incoming(result), [13, 14, 15]);
  assertLegal(s, result);
  assertPositionIntegrity(result);
});

test('a second unfinished DGW fixture prevents a zero-minute starter from being replaced', () => {
  const s = setup();
  state(s, 11, 'absent');
  s.fixtures.push({ id: 101, event: 3, team_h: 11, team_a: 99, started: false, finished: false });
  assert.deepEqual(incoming(resolve(s)), []);
  s.fixtures.at(-1).finished = true;
  assert.equal(incoming(resolve(s)).length, 1);
});

test('any minutes in the GW prevent replacement even if the other DGW match was missed', () => {
  const s = setup();
  s.live.elements[11].stats.minutes = 1;
  s.live.elements[11].stats.total_points = 0;
  s.fixtures.push({ id: 101, event: 3, team_h: 11, team_a: 99, started: true, finished: true });
  s.live.elements[11].explain.push([[], 101]);
  assert.deepEqual(incoming(resolve(s)), []);
});

test('provisional football full-time permits projection but ninety clock minutes alone does not', () => {
  const s = setup();
  state(s, 11, 'pending');
  s.fixtures[10].minutes = 90;
  assert.deepEqual(incoming(resolve(s)), []);
  s.fixtures[10].finished_provisional = true;
  assert.equal(incoming(resolve(s)).length, 1);
});

test('goalkeeper uses only the reserve keeper, independently of outfield priority', () => {
  const s = setup();
  state(s, 1, 'absent');
  state(s, 11, 'absent');
  state(s, 12, 'pending');
  const result = resolve(s);
  assert.deepEqual(incoming(result), [12, 13]);
  assert.equal(result.substitutions.find(sub => sub.element_in === 12).pending, true);
  assert.equal(result.positions.get(12), 1);
  assertLegal(s, result);
  state(s, 12, 'absent');
  assert.ok(!incoming(resolve(s)).includes(12));
  assert.equal(resolve(s).positions.get(1), 1);
});

test('zero-minute yellow or red cards count as participation for starters and reserves', () => {
  for (const [card, points] of [['yellow_cards', -1], ['red_cards', -3]]) {
    const s = setup();
    state(s, 11, 'absent');
    s.live.elements[11].stats[card] = 1;
    s.live.elements[11].stats.total_points = points;
    assert.deepEqual(incoming(resolve(s)), [], card);
    s.live.elements[11].stats[card] = 0;
    s.live.elements[11].stats.total_points = 0;
    state(s, 13, 'absent');
    s.live.elements[13].stats[card] = 1;
    s.live.elements[13].stats.total_points = points;
    assert.deepEqual(incoming(resolve(s)), [13], card);
  }
});

test('official substitutions and automatic_subs alias apply once even if positions were already swapped', () => {
  const s = setup();
  const sub = { element_out: 11, element_in: 13 };
  s.payload.subs = [sub];
  s.payload.automatic_subs = [{ ...sub }];
  let result = resolve(s);
  assert.deepEqual(result.substitutions, [{ ...sub, source: 'official', pending: false }]);
  assert.equal(result.provisional, false);
  assert.equal(result.positions.get(13), 11);
  s.payload.picks[10].position = 13;
  s.payload.picks[12].position = 11;
  result = resolve(s);
  assert.equal(result.positions.get(13), 11);
  assert.equal(result.positions.get(11), 13);
  assert.equal(result.substitutions.length, 1);
});

test('official swapped players are not projected a second time while independent absences still work', () => {
  const s = setup();
  s.payload.subs = [{ element_out: 11, element_in: 13 }];
  state(s, 11, 'absent');
  state(s, 13, 'absent');
  state(s, 6, 'absent');
  const result = resolve(s);
  assert.deepEqual(incoming(result, 'official'), [13]);
  assert.deepEqual(incoming(result), [14]);
  assert.equal(result.positions.get(13), 11);
});

test('missing source, incomplete live stats and ambiguous player/fixture metadata do not fabricate absences', () => {
  const mutations = [
    s => { delete s.live.elements[11]; },
    s => { delete s.live.elements[11].stats.minutes; },
    s => { delete s.live.elements[11].stats.yellow_cards; },
    s => { delete s.live.elements[11].stats.red_cards; },
    s => { delete s.live.elements[11].stats.total_points; },
    s => { s.live.elements[11].stats.total_points = 5; },
    s => { s.live.elements[11].stats.minutes = -1; },
    s => { s.live.elements[11].explain = 'invalid'; },
    s => { s.live.elements[11].explain = [[[], 777]]; },
    s => { s.live.elements[11].explain = [[[], 2]]; },
    s => { s.players.get(11).teamCode = 5000; },
    s => { s.players.get(11).pos = 'UNKNOWN'; },
    s => { s.fixtures = []; },
    s => { s.fixtures[0].team_h = 888; },
    s => { s.fixtures.push({ ...s.fixtures[0] }); },
    s => { s.teams.push({ ...s.teams[0] }); },
    s => { s.options.gw = 4; },
  ];
  mutations.forEach((mutate, index) => {
    const s = setup();
    state(s, 11, 'absent');
    mutate(s);
    assert.deepEqual(incoming(resolve(s)), [], `mutation ${index}`);
  });
});

test('a recognised team with no matches in a complete nonempty GW is a confirmed blank', () => {
  const s = setup();
  state(s, 11, 'absent');
  s.live.elements[11].explain = [];
  s.fixtures = s.fixtures.filter(fixture => fixture.team_h !== 11);
  assert.deepEqual(incoming(resolve(s)), [13]);
});

test('a malformed omitted event is not silently mistaken for a confirmed team blank', () => {
  const s = setup();
  state(s, 11, 'pending');
  s.live.elements[11].explain = [];
  // Corrupted GW metadata must not filter the player's unfinished fixture out
  // and then call their now-empty schedule a confirmed blank.
  delete s.fixtures[10].event;
  assert.deepEqual(incoming(resolve(s)), []);
});

test('explicit null for an unscheduled fixture does not invalidate a complete current-GW feed', () => {
  const s = setup();
  state(s, 11, 'absent');
  s.fixtures.push({ id: 500, event: null, team_h: 11, team_a: 99, started: false, finished: false });
  assert.deepEqual(incoming(resolve(s)), [13]);
});

test('contradictory finished-GW flag never turns an unfinished fixture into an absence', () => {
  const s = setup();
  state(s, 11, 'pending');
  s.options.finished = true;
  assert.deepEqual(incoming(resolve(s)), []);
});

test('lineup, metadata, live scores and official substitutions are immutable inputs on every refresh', () => {
  const s = setup();
  state(s, 11, 'absent');
  const before = structuredClone(s);
  const first = resolve(s);
  assert.deepEqual(s, before);
  const second = resolve(s);
  assert.deepEqual(second, first);
  assert.deepEqual(s, before);
  state(s, 13, 'absent');
  assert.deepEqual(incoming(resolve(s)), [14]);
  assert.equal(s.payload.picks[10].position, 11);
  assert.equal(s.payload.picks[12].position, 13);
});

test('never selects a player by points, including zero and negative-point appearances', () => {
  const s = setup();
  state(s, 11, 'absent');
  for (const scores of [[-5, 30, 20], [0, 30, 20], [50, -8, 80]]) {
    scores.forEach((points, index) => { s.live.elements[index + 13].stats.total_points = points; });
    assert.deepEqual(incoming(resolve(s)), [13]);
  }
});

test('numeric position metadata and map-form teams are accepted without changing Draft ID joins', () => {
  const s = setup();
  state(s, 11, 'absent');
  for (const player of s.players.values()) { player.element_type = TYPES[player.pos]; delete player.pos; }
  s.teams = new Map(s.teams.map(team => [team.id, team]));
  assert.deepEqual(incoming(resolve(s)), [13]);
});

test('malformed locked picks fail explicitly rather than manufacturing a squad', () => {
  const mutations = [
    s => { s.payload.picks.pop(); },
    s => { s.payload.picks[1].element = 1; },
    s => { s.payload.picks[1].position = 1; },
    s => { s.payload.picks[1].position = 16; },
    s => { s.payload.picks[1].element = '2'; },
    s => { s.payload.picks[1] = null; },
  ];
  for (const mutate of mutations) {
    const s = setup(); mutate(s);
    assert.throws(() => resolve(s), TypeError);
  }
});

function combinations(values, size, start = 0, chosen = [], result = []) {
  if (chosen.length === size) { result.push([...chosen]); return result; }
  for (let index = start; index < values.length; index++) {
    chosen.push(values[index]); combinations(values, size, index + 1, chosen, result); chosen.pop();
  }
  return result;
}
function permutations(values) {
  if (!values.length) return [[]];
  return [...new Set(values)].flatMap(value => {
    const remaining = [...values]; remaining.splice(remaining.indexOf(value), 1);
    return permutations(remaining).map(rest => [value, ...rest]);
  });
}
// Independent oracle: enumerate incoming/outgoing SETS, then evaluate only the
// final position counts. It does not reuse the production recursive swap planner.
function expectedIncoming(s, absentees, candidates) {
  for (let size = Math.min(absentees.length, candidates.length); size >= 0; size--) {
    for (const ins of combinations(candidates, size)) {
      for (const outs of combinations(absentees, size)) {
        const xi = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].filter(id => !outs.includes(id)).concat(ins);
        const counts = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
        xi.forEach(id => { counts[s.types[id - 1]]++; });
        if (counts.GKP === 1 && counts.DEF >= 3 && counts.DEF <= 5
          && counts.MID >= 2 && counts.MID <= 5 && counts.FWD >= 1 && counts.FWD <= 3) return ins;
      }
    }
  }
  return [];
}

test('exhaustive outfield absence masks across every legal formation and reserve order match a set-based oracle', () => {
  let cases = 0;
  for (const formation of FORMATIONS) {
    const base = setup(formation);
    for (const order of permutations(base.types.slice(12))) {
      const s = setup(formation, order);
      for (let mask = 0; mask < 1024; mask++) {
        const absentees = [];
        for (let bit = 0; bit < 10; bit++) {
          const id = bit + 2;
          const absent = (mask & (1 << bit)) !== 0;
          state(s, id, absent ? 'absent' : 'played');
          if (absent) absentees.push(id);
        }
        const result = resolve(s);
        assert.deepEqual(incoming(result), expectedIncoming(s, absentees, [13, 14, 15]), `${formation} / ${order} / ${mask}`);
        assertPositionIntegrity(result);
        assertLegal(s, result);
        cases++;
      }
    }
  }
  assert.equal(cases, 25600);
});

test('all reserve played/pending/absent combinations keep priority and legal formations under multiple absences', () => {
  for (const formation of FORMATIONS) {
    const s = setup(formation);
    const absentees = [2, 6, 11];
    absentees.forEach(id => state(s, id, 'absent'));
    for (let pattern = 0; pattern < 27; pattern++) {
      let current = pattern;
      const candidates = [];
      for (const id of [13, 14, 15]) {
        const availability = ['played', 'pending', 'absent'][current % 3];
        state(s, id, availability);
        current = Math.floor(current / 3);
        if (availability !== 'absent') candidates.push(id);
      }
      const result = resolve(s);
      assert.deepEqual(incoming(result), expectedIncoming(s, absentees, candidates), `${formation} / ${pattern}`);
      for (const sub of result.substitutions) assert.equal(sub.pending, s.live.elements[sub.element_in].stats.minutes === 0);
      assertPositionIntegrity(result);
      assertLegal(s, result);
    }
  }
});
