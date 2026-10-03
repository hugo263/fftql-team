'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateMatchRequest, validateGameweekFixtures, effectivePositions, appearanceStatus, fixtureHasFinished, fixtureAppearanceMinutes, buildMatchDetail, createMatchDetailService,
} = require('../match-detail');

const now = Date.parse('2026-09-05T10:00:00Z');
const types = ['GKP', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD', 'GKP', 'DEF', 'MID', 'FWD'];
function source(leagueId = 47275, gw = 3) {
  const players = Array.from({ length: 30 }, (_, index) => ({
    id: index + 1, name: `Player${index + 1}`, team: 'ONE', teamName: 'Team One', teamCode: 100,
    pos: types[index % 15], minutes: 999, // Deliberately wrong season total.
    owner: index < 15 ? 22 : 11, // Deliberately contrary to the locked GW squads.
  }));
  const payload = (entry) => ({ picks: types.map((_, index) => ({ element: index + 1 + (entry === 22 ? 15 : 0), position: index + 1, multiplier: 1 })), subs: [] });
  const snapshot = {
    meta: { leagueId, leagueName: 'The Test League', reportGw: 3, lastFinishedGw: 2, reportLive: true },
    events: [1, 2, 3, 4].map((id) => ({ id, deadline: `2026-09-0${id}T10:00:00Z`, finished: id < 3 })),
    managers: [{ entryId: 11, entryName: 'Side A', playerName: 'Manager A', picks: payload(22).picks }, { entryId: 22, entryName: 'Side B', playerName: 'Manager B', picks: payload(11).picks }, { entryId: 33, entryName: 'Not the opponent' }],
    h2hByGw: { 1: [{ entry1Id: 11, entry2Id: 22 }], 2: [{ entry1Id: 11, entry2Id: 22 }], 3: [{ entry1Id: 11, entry2Id: 22 }] },
    players,
  };
  // GW4 is still a future GW even though this simulated clock is later: the
  // fixture validation requires both the published report and its deadline.
  const live = { elements: Object.fromEntries(players.map((player) => [player.id, { stats: { total_points: player.id <= 11 || (player.id > 15 && player.id <= 26) ? 1 : 100, minutes: 0, yellow_cards: 0, red_cards: 0 } }])) };
  live.elements[1].stats = { total_points: 0, minutes: 90 }; // zero points is still an appearance
  live.elements[2].stats = { total_points: -1, minutes: 0, yellow_cards: 1 }; // booking without pitch minutes
  live.elements[3].stats = { total_points: 12, minutes: 180 }; // DGW minutes can exceed90
  const fixtures = [
    { id: 1, event: gw, team_h: 1, team_a: 2, started: true, finished: true },
    { id: 2, event: gw, team_h: 1, team_a: 3, started: false, finished: false },
    { id: 3, event: gw + 1, team_h: 2, team_a: 3, started: false, finished: false },
  ];
  const teams = [{ id: 1, code: 100, short_name: 'ONE' }, { id: 2, code: 200, short_name: 'TWO' }, { id: 3, code: 300, short_name: 'THREE' }, { id: 4, code: 400, short_name: 'BLANK' }];
  return { snapshot, leagueId, gw, entry1Id: 11, entry2Id: 22, picks: new Map([[11, payload(11)], [22, payload(22)]]), live, fixtures, teams, now };
}

test('match request validates league, GW, entry ID space and actual opponent; reverse order is valid', () => {
  const s = source();
  assert.deepEqual(validateMatchRequest(s.snapshot, 47275, 3, 22, 11, now).managers.map((manager) => manager.entryId), [22, 11]);
  assert.throws(() => validateMatchRequest(s.snapshot, 47275, 3, 11, 11, now), { status: 400 });
  assert.throws(() => validateMatchRequest(s.snapshot, 47275, 3, 11, 99, now), { status: 404 });
  assert.throws(() => validateMatchRequest(s.snapshot, 47275, 3, 11, 33, now), { code: 'MATCH_NOT_FOUND' });
  assert.throws(() => validateMatchRequest(s.snapshot, 999, 3, 11, 22, now), { code: 'LEAGUE_NOT_FOUND' });
  assert.throws(() => validateMatchRequest(s.snapshot, 47275, 4, 11, 22, now), { code: 'FUTURE_GAMEWEEK' });
  assert.throws(() => validateMatchRequest(s.snapshot, 47275, 3, 11, 22, Date.parse('2026-09-03T09:59:59Z')), { code: 'FUTURE_GAMEWEEK' });
  assert.throws(() => validateMatchRequest(s.snapshot, 47275, 39, 11, 22, now), { status: 400 });
});

test('detail uses selected GW locked15, actual GW minutes/points, no owner or captain leakage', () => {
  const s = source();
  s.picks.get(11).picks[0].multiplier = 2;
  const detail = buildMatchDetail(s);
  const a = detail.sides[0];
  assert.equal(a.players.length, 15);
  assert.equal(a.players[0].id, 1);
  assert.equal(a.players[0].minutes, 90);
  assert.equal(a.players[0].points, 0);
  assert.equal(a.players[0].status, 'played');
  assert.equal(a.score, 19); // 0 -1 +12 +8; excludes bench4×100
  assert.equal(a.benchPoints, 400);
  assert.equal(a.startingCount, 11);
  assert.equal(a.playedCount, 2); // both zero-points90min and180min count once
  assert.equal(a.remainingCount, 11); // DGW players may also be in playedCount
  assert.equal(a.formation, '4-4-2');
  assert.equal(a.players[1].yellowCards, 1);
  assert.deepEqual(a.players[0].fixtures.map((fixture) => fixture.opponent), ['TWO', 'THREE']);
  assert.equal(detail.live, true);
});

test('appearance labels do not infer player still on pitch from team kickoff or infer appearance from points', () => {
  assert.equal(appearanceStatus(20, [{ started: true, finished: false }]), 'played');
  assert.equal(appearanceStatus(0, [{ started: true, finished: false }]), 'waiting');
  assert.equal(appearanceStatus(0, [{ started: false, finished: false }]), 'pending');
  assert.equal(appearanceStatus(0, [{ started: true, finished: true }]), 'dnp');
  assert.equal(appearanceStatus(0, []), 'blank');
  assert.equal(appearanceStatus(undefined, []), 'unknown');
});

test('official full-time provisional status ends remaining fixtures without freezing unsettled points', () => {
  const s = source();
  // Same official state as GW3 fixture21 (Liverpool–Newcastle), observed on
  // 2026-09-05: started:true, finished:false, finished_provisional:true.
  s.fixtures = [{ id: 21, event: 3, team_h: 1, team_a: 2, started: true, finished: false, finished_provisional: true }];
  const detail = buildMatchDetail(s);
  assert.equal(detail.sides[0].playedCount, 2);
  assert.equal(detail.sides[0].remainingCount, 0);
  assert.equal(detail.sides[0].players[0].fixtures[0].finished, true);
  assert.equal(detail.sides[0].players[0].fixtures[0].settled, false);
  assert.equal(detail.sides[0].players[1].status, 'dnp');
  assert.equal(detail.live, false);
  assert.equal(detail.finished, true);
  assert.equal(detail.finalizing, true); // keep refreshing without claiming LIVE
  assert.equal(fixtureHasFinished({ finished: false, finished_provisional: false, minutes: 90 }), false);
  assert.equal(fixtureHasFinished({ finished: true, finished_provisional: false }), true);
  // A remaining second fixture in a DGW still counts the player once.
  s.fixtures.push({ id: 22, event: 3, team_h: 1, team_a: 3, started: false, finished: false });
  assert.equal(buildMatchDetail(s).sides[0].remainingCount, 11);
});

test('recorded autosub applied once, changed XI/bench totals use resulting positions', () => {
  const s = source();
  const payload = s.picks.get(11);
  payload.subs = [{ element_in: 12, element_out: 1 }];
  const before = buildMatchDetail(s);
  assert.equal(before.sides[0].score, 119);
  assert.equal(before.sides[0].players[0].id, 12);
  payload.picks[0].position = 12;
  payload.picks[11].position = 1;
  const after = buildMatchDetail(s);
  assert.equal(after.sides[0].score, 119);
  assert.equal(after.sides[0].players[0].id, 12);
  assert.equal(after.sides[0].benchPoints, 300);
});

test('historical GW final and blank fixtures are distinct from unavailable fixture source', () => {
  const s = source(47275, 2);
  s.fixtures = s.fixtures.filter((fixture) => fixture.event === 2).map((fixture) => ({ ...fixture, finished: true, started: true }));
  s.snapshot.players[3].teamCode = 400;
  const detail = buildMatchDetail(s);
  assert.equal(detail.finished, true);
  assert.equal(detail.live, false);
  assert.equal(detail.sides[0].remainingCount, 0);
  assert.equal(detail.sides[0].players.find((player) => player.id === 4).status, 'blank');
  assert.equal(detail.sides[0].players.find((player) => player.id === 2).status, 'dnp');
  assert.equal(detail.sides[0].players.find((player) => player.id === 2).points, -1);
  assert.throws(() => buildMatchDetail({ ...s, fixtures: null }), { status: 502 });
});

test('incomplete scores/minutes or invalid lineup fail clearly rather than fabricate zeros', () => {
  const s = source();
  delete s.live.elements[12].stats.minutes; // Missing bench data is not fabricated either.
  assert.throws(() => buildMatchDetail(s), { code: 'MATCH_DATA_UNAVAILABLE' });
  assert.throws(() => effectivePositions({ picks: [] }), { status: 502 });
  const bad = source().picks.get(11);
  bad.picks[0].position = 12;
  assert.throws(() => effectivePositions(bad), { status: 502 });
});

test('historical real-club transfer uses recorded fixture, never guesses old opponent or home/away', () => {
  const s = source(47275, 2);
  s.fixtures = s.fixtures.filter((fixture) => fixture.event === 2).map((fixture) => ({ ...fixture, started: true, finished: true }));
  s.snapshot.players[0].teamCode = 400;
  s.live.elements[1].explain = [[[{ stat: 'minutes', value: 90 }], 1]];
  const player = buildMatchDetail(s).sides[0].players[0];
  assert.equal(player.minutes, 90);
  assert.equal(player.fixtureTeamUnknown, true);
  assert.match(player.teamMetadataNote, /当前球队/);
  assert.deepEqual(player.fixtures, [{ opponent: 'ONE–TWO', home: null, started: true, finished: true, settled: true }]);
  const current = source();
  current.snapshot.players[0].teamCode = 400;
  current.live.elements[1].explain = [[[], 1]];
  assert.throws(() => buildMatchDetail(current), { code: 'MATCH_DATA_UNAVAILABLE' });
});

function serviceHarness(options = {}) {
  let clock = now;
  let failure = false;
  const requests = [];
  const snapshots = [];
  const fixtures = new Map();
  const getSource = (leagueId = 47275) => {
    if (!fixtures.has(leagueId)) fixtures.set(leagueId, source(leagueId));
    return fixtures.get(leagueId);
  };
  const service = createMatchDetailService({
    now: () => clock, draftApi: 'https://draft.test/api', classicApi: 'https://classic.test/api',
    getSnapshot: async (leagueId) => {
      snapshots.push(leagueId);
      if (options.snapshotWait) await options.snapshotWait;
      return getSource(leagueId).snapshot;
    },
    fetchJson: async (url) => {
      requests.push(url);
      if (failure) throw new Error('temporary network failure');
      const s = getSource();
      if (url.endsWith('/bootstrap-static/')) return { teams: s.teams };
      if (url.includes('/fixtures/')) return s.fixtures;
      if (url.endsWith('/event/3/live')) return s.live;
      const match = url.match(/\/entry\/(\d+)\/event\/3$/);
      if (match) return s.picks.get(Number(match[1]));
      throw new Error(`Unexpected request ${url}`);
    },
    ...options,
  });
  return { service, requests, snapshots, getSource, advance: (ms) => { clock += ms; }, fail: (value) => { failure = value; } };
}

test('same match concurrent and reversed requests merge, return requested side order, fetch only two squads', async () => {
  const h = serviceHarness();
  const [a, b] = await Promise.all([h.service.get(47275, 3, 11, 22), h.service.get(47275, 3, 22, 11)]);
  assert.deepEqual(a.sides.map((side) => side.entryId), [11, 22]);
  assert.deepEqual(b.sides.map((side) => side.entryId), [22, 11]);
  assert.equal(h.requests.length, 5);
  assert.equal(h.snapshots.length, 1);
  assert.deepEqual(h.requests.filter((url) => url.includes('/entry/')), ['https://draft.test/api/entry/11/event/3', 'https://draft.test/api/entry/22/event/3']);
  assert.equal(h.service.inFlightSize(), 0);
  h.advance(59999);
  await h.service.get(47275, 3, 11, 22);
  assert.equal(h.requests.length, 5);
  h.advance(1);
  await h.service.get(47275, 3, 11, 22);
  assert.equal(h.requests.length, 9, '60-second scores, fixtures and both squads refresh; teams remain reusable');
  assert.equal(h.requests.filter((url) => url.endsWith('/bootstrap-static/')).length, 1);
  assert.equal(h.requests.filter((url) => url.includes('/entry/')).length, 4, 'picks refresh so official autosubs are not frozen');
});

test('failed refresh returns old detail with stale flag and original timestamp, never fresh zeros', async () => {
  const h = serviceHarness();
  const first = await h.service.get(47275, 3, 11, 22);
  h.advance(60000);
  h.fail(true);
  const stale = await h.service.get(47275, 3, 22, 11);
  assert.equal(stale.stale, true);
  assert.equal(stale.updated, first.updated);
  assert.equal(stale.sides.find((side) => side.entryId === 11).score, 19);
  h.fail(false);
  const recovered = await h.service.get(47275, 3, 11, 22);
  assert.equal(recovered.stale, undefined);
  assert.notEqual(recovered.updated, first.updated);
});

test('invalid requests fetch no player data and initial upstream failure returns explicit error', async () => {
  const h = serviceHarness();
  await assert.rejects(h.service.get(47275, 3, 11, 33), { status: 404 });
  assert.equal(h.requests.length, 0);
  await assert.rejects(h.service.get(47275, 4, 11, 22), { status: 400 });
  assert.equal(h.requests.length, 0);
  h.fail(true);
  await assert.rejects(h.service.get(47275, 3, 11, 22), { status: 502 });
  assert.equal(h.service.cacheSize(), 0);
});

test('detail cache is bounded in memory and evicts least recently used match', async () => {
  const h = serviceHarness({ maxEntries: 2 });
  await h.service.get(1, 3, 11, 22);
  await h.service.get(2, 3, 11, 22);
  await h.service.get(3, 3, 11, 22);
  assert.equal(h.service.cacheSize(), 2);
  const calls = h.requests.length;
  const snapshots = h.snapshots.length;
  await h.service.get(1, 3, 11, 22);
  assert.equal(h.snapshots.length, snapshots + 1, 'evicted match is validated and rebuilt, not returned from the detail cache');
  assert.equal(h.requests.length, calls, 'the same entries, GW and public sources remain reusable across leagues');
  assert.equal(h.service.cacheSize(), 2);
});

test('SGW highlights actual appearances during the fixture and preserves cards before an appearance', () => {
  const s = source();
  s.fixtures = [{ id: 1, event: 3, team_h: 1, team_a: 2, started: true, finished: false }];
  let a = buildMatchDetail(s).sides[0];
  assert.equal(a.players[0].status, 'playing');
  assert.equal(a.players[0].points, 0, 'played zero remains a real score');
  assert.equal(a.players[1].status, 'waiting', 'a card is not evidence of an appearance');
  assert.equal(a.players[1].points, -1);
  assert.equal(a.players[1].yellowCards, 1);
  assert.equal(a.playedCount, 2);
  s.fixtures[0].finished_provisional = true;
  a = buildMatchDetail(s).sides[0];
  assert.equal(a.players[0].status, 'played');
  assert.equal(a.players[1].status, 'dnp');
  assert.equal(a.remainingCount, 0);
});

test('DGW highlights only an appearance in the active fixture, never old aggregate minutes', () => {
  const s = source();
  s.fixtures[1].started = true;
  s.live.elements[1].explain = [[[{ stat: 'minutes', value: 90 }], 1], [[{ stat: 'minutes', value: 0 }], 2]];
  s.live.elements[3].explain = [{ fixture: 1, stats: [{ identifier: 'minutes', value: 90 }] }, { fixture: 2, stats: [{ identifier: 'minutes', value: 35 }] }];
  let a = buildMatchDetail(s).sides[0];
  assert.equal(a.players[0].status, 'played', 'first-match appearance must not mark second fixture playing');
  assert.equal(a.players[2].status, 'playing');
  assert.equal(a.playedCount, 2);
  assert.equal(a.remainingCount, 11);
  delete s.live.elements[3].explain;
  a = buildMatchDetail(s).sides[0];
  assert.equal(a.players[2].status, 'played', 'missing per-fixture evidence is conservative in DGW');
  assert.equal(a.players[2].points, 12, 'past DGW points remain visible');
  assert.deepEqual([...fixtureAppearanceMinutes([null, {}, [[], 2], [[{ stat: 'minutes', value: -1 }], 3]])], []);
});

test('shared scoring sources do not acquire a fresh TTL when another match is assembled', async () => {
  const h = serviceHarness();
  const first = await h.service.get(1, 3, 11, 22);
  h.advance(59000);
  const second = await h.service.get(2, 3, 11, 22);
  assert.equal(second.updated, first.updated);
  assert.equal(h.requests.length, 5);
  h.advance(1000);
  const renewed = await h.service.get(2, 3, 11, 22);
  assert.equal(h.requests.length, 9);
  assert.equal(Date.parse(renewed.updated) - Date.parse(first.updated), 60000);
});

test('long upstream response retains request age, returns stale and is retried immediately', async () => {
  let clock = now;
  let calls = 0;
  const s = source();
  const service = createMatchDetailService({
    now: () => clock, getSnapshot: async () => s.snapshot,
    draftApi: 'https://draft.test/api', classicApi: 'https://classic.test/api',
    fetchJson: async (url) => {
      calls++;
      if (url.endsWith('/bootstrap-static/')) return { teams: s.teams };
      if (url.includes('/fixtures/')) return s.fixtures;
      if (url.endsWith('/live')) { await Promise.resolve(); clock += 61000; return s.live; }
      const entry = Number(url.match(/\/entry\/(\d+)/)?.[1]);
      return s.picks.get(entry);
    },
  });
  const detail = await service.get(47275, 3, 11, 22);
  assert.equal(detail.stale, true);
  assert.equal(Date.parse(detail.updated), now, 'network duration cannot relabel old data as fresh');
  await service.get(47275, 3, 11, 22);
  assert.equal(calls, 9);
});

test('parallel matches reuse each in-flight public URL without merging match identity', async () => {
  const h = serviceHarness();
  const [a, b] = await Promise.all([h.service.get(1, 3, 11, 22), h.service.get(2, 3, 22, 11)]);
  assert.equal(a.leagueId, 1);
  assert.equal(b.leagueId, 2);
  assert.deepEqual(b.sides.map((side) => side.entryId), [22, 11]);
  assert.equal(h.snapshots.length, 2);
  assert.equal(h.requests.length, 5, 'public source and same entry/GW picks are merged independently of league');
});

test('distinct in-flight matches are bounded and release capacity after completion', async () => {
  let release;
  const snapshotWait = new Promise((resolve) => { release = resolve; });
  const h = serviceHarness({ maxInFlight: 1, snapshotWait });
  const running = h.service.get(1, 3, 11, 22);
  await assert.rejects(h.service.get(2, 3, 11, 22), { status: 429 });
  assert.equal(h.service.inFlightSize(), 1);
  release();
  await running;
  assert.equal(h.service.inFlightSize(), 0);
});

test('precomputed match prime answers either side order without metadata or upstream round trips', async () => {
  const h = serviceHarness();
  const s = h.getSource();
  const detail = buildMatchDetail(s);
  h.service.prime({ ...s.snapshot, matchDetails: [detail] });
  const reversed = await h.service.get(47275, 3, 22, 11);
  assert.deepEqual(reversed.sides.map(side => side.entryId), [22, 11]);
  assert.equal(reversed.sides[1].score, detail.sides[0].score);
  assert.equal(h.requests.length, 0);
  assert.equal(h.snapshots.length, 0);
  assert.deepEqual(detail.sides.map(side => side.entryId), [11, 22], 'reverse response must not mutate snapshot');
});

test('get seeds a fetched snapshot without upstream calls; re-prime cannot renew its original 60-second age', async () => {
  const h = serviceHarness();
  const s = h.getSource();
  const detail = buildMatchDetail(s);
  s.snapshot.matchDetails = [detail];
  const first = await h.service.get(47275, 3, 11, 22);
  assert.equal(h.snapshots.length, 1);
  assert.equal(h.requests.length, 0);
  h.advance(59000);
  h.service.prime(s.snapshot);
  const second = await h.service.get(47275, 3, 22, 11);
  assert.equal(second.updated, first.updated);
  assert.equal(h.requests.length, 0);
  h.advance(1000);
  const fresh = await h.service.get(47275, 3, 11, 22);
  assert.equal(h.requests.length, 5, 'precomputed scoring source expired, despite recent hydration');
  assert.equal(Date.parse(fresh.updated) - Date.parse(first.updated), 60000);
});

test('invalid or unprepared snapshot details are ignored and safely use the requested match fallback', async () => {
  const mutations = [
    snapshot => { snapshot.meta.stale = true; },
    snapshot => { snapshot.matchDetails[0].autoSubsVersion = 0; },
    snapshot => { snapshot.matchDetails[0].leagueId = 123; },
    snapshot => { snapshot.matchDetails[0].gw = 2; },
    snapshot => { snapshot.matchDetails[0].updated = new Date(now + 1).toISOString(); },
    snapshot => { snapshot.matchDetails[0].sides[0].players.pop(); },
    snapshot => { snapshot.matchDetails[0].sides[0].entryId = 33; },
    snapshot => { snapshot.matchDetails = []; },
  ];
  for (const mutate of mutations) {
    const h = serviceHarness();
    const s = h.getSource();
    const prepared = JSON.parse(JSON.stringify({ ...s.snapshot, matchDetails: [buildMatchDetail(s)] }));
    mutate(prepared);
    h.service.prime(prepared);
    assert.equal(h.service.cacheSize(), 0);
    const actual = await h.service.get(47275, 3, 11, 22);
    assert.equal(actual.gw, 3);
    assert.deepEqual(actual.sides.map(side => side.entryId), [11, 22]);
    assert.equal(h.requests.length, 5);
  }
});

test('expired precomputed detail remains fallback with its timestamp when official refresh fails', async () => {
  const h = serviceHarness();
  const s = h.getSource();
  const original = buildMatchDetail(s);
  s.snapshot.matchDetails = [original];
  h.advance(60000);
  h.fail(true);
  const stale = await h.service.get(47275, 3, 22, 11);
  assert.equal(stale.stale, true);
  assert.equal(stale.updated, original.updated);
  assert.equal(stale.sides[1].score, original.sides[0].score);
});

test('a slower on-demand response cannot replace a newer primed score or erase its resolved lineup', async () => {
  let clock = now;
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const s = source();
  const calls = [];
  const service = createMatchDetailService({ now: () => clock, getSnapshot: async () => s.snapshot,
    draftApi: 'https://draft.test/api', classicApi: 'https://classic.test/api',
    fetchJson: async url => {
      calls.push(url); await wait;
      if (url.endsWith('/bootstrap-static/')) return { teams: s.teams };
      if (url.includes('/fixtures/')) return s.fixtures;
      if (url.endsWith('/live')) return s.live;
      return s.picks.get(Number(url.match(/\/entry\/(\d+)/)?.[1]));
    },
  });
  const pending = service.get(47275, 3, 22, 11);
  for (let i = 0; i < 4; i++) await Promise.resolve();
  assert.equal(calls.length, 5);
  clock += 1000;
  const newer = buildMatchDetail({ ...s, now: clock });
  newer.sides[0].score = 50;
  newer.sides[0].substitutions = [{ element_in: 12, element_out: 1, source: 'projected', pending: false }];
  newer.sides[0].provisional = true;
  service.prime({ ...s.snapshot, matchDetails: [newer] });
  release();
  const result = await pending;
  assert.equal(result.updated, newer.updated);
  assert.equal(result.sides[1].score, 50);
  assert.equal(result.sides[1].provisional, true);
  assert.deepEqual(result.sides[1].substitutions, newer.sides[0].substitutions);
  service.prime({ ...s.snapshot, matchDetails: [{ ...newer, stale: true }] });
  assert.equal((await service.get(47275, 3, 11, 22)).stale, undefined, 'same-time stale prime cannot downgrade fresh data');
});

test('fixture validation rejects empty, wrong-GW, duplicate or incomplete sources before any projection', () => {
  const s = source();
  for (const fixtures of [null, [], s.fixtures.filter(f => f.event !== 3), [s.fixtures[0], s.fixtures[0]], [{ ...s.fixtures[0], started: null }], [{ ...s.fixtures[0], team_a: 99 }]]) {
    assert.throws(() => validateGameweekFixtures(fixtures, 3, s.teams), { status: 502 });
  }
  assert.equal(validateGameweekFixtures(s.fixtures, 3, s.teams).length, 2);
  assert.throws(() => buildMatchDetail({ ...s, fixtures: [] }), { code: 'MATCH_DATA_UNAVAILABLE' });
});

test('fixture validation checks the original event metadata before filtering so an omitted game cannot become a blank', () => {
  const s = source();
  for (const bad of [null, [], 1, { id: 99 }, { event: undefined }, { event: '3' }, { event: 0 }, { event: 39 }]) {
    assert.throws(() => validateGameweekFixtures([...s.fixtures, bad], 3, s.teams), { status: 502 });
    assert.throws(() => buildMatchDetail({ ...s, fixtures: [...s.fixtures, bad] }), { status: 502 });
  }
  const unassigned = { id: 99, event: null, team_h: 2, team_a: 3, started: false, finished: false };
  assert.equal(validateGameweekFixtures([...s.fixtures, unassigned], 3, s.teams).length, 2, 'explicitly unassigned fixture is not a missing event');
});

test('priming many league snapshots retains the bounded match cache', () => {
  const h = serviceHarness({ maxEntries: 2 });
  for (const leagueId of [1, 2, 3]) {
    const s = h.getSource(leagueId);
    h.service.prime({ ...s.snapshot, matchDetails: [buildMatchDetail(s)] });
  }
  assert.equal(h.service.cacheSize(), 2);
  assert.equal(h.requests.length, 0);
});
