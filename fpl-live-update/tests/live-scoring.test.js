'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SNAPSHOT_SCHEMA, deriveGameweekState, isSnapshotFresh, snapshotTtlMs, scoreLockedPicks, applyLiveMatchScores, rebuildH2HStandings } = require('../live-scoring');
const { buildSnapshot, buildDreamTeam } = require('../server');

const start = Date.parse('2026-09-01T00:00:00Z');
const events = [1, 2, 3, 4].map((id) => ({ id, deadline_time: new Date(start + id * 86400000).toISOString(), finished: id <= 2, data_checked: id <= 2, is_current: id === 3 }));
const now = start + 3.5 * 86400000;
const state = deriveGameweekState(events, [{ event: 3, started: true, finished: false }], now);

test('deadline changes report from completed GW2 to live GW3 before kickoff', () => {
  const before = deriveGameweekState(events, [], start + 2.9 * 86400000);
  assert.equal(before.reportGw, 2);
  assert.equal(before.reportLive, false);
  const begun = deriveGameweekState(events, [{ event: 3, started: false, finished: false }], start + 3 * 86400000);
  assert.equal(begun.reportGw, 3);
  assert.equal(begun.reportLive, true);
  assert.equal(begun.fixturesStarted, false);
  assert.equal(begun.lastFinishedGw, 2);
  assert.equal(begun.upcomingGw, 3);
});

test('all provisional final whistles end LIVE before official scoring settles', () => {
  const partial = deriveGameweekState(events, [{ event: 3, started: true, finished: false, finished_provisional: true }], now);
  assert.equal(partial.reportLive, false);
  assert.equal(partial.lastFinishedGw, 3);
  assert.equal(partial.upcomingGw, 4);
  assert.equal(partial.reportFinalizing, true);
});

test('one remaining fixture, including a postponed one, keeps the round live', () => {
  for (const started of [true, false]) {
    const state = deriveGameweekState(events, [
      { event: 3, finished_provisional: true, finished: false, started: true },
      { event: 3, finished_provisional: false, finished: false, started },
    ], now);
    assert.equal(state.reportLive, true);
    assert.equal(state.lastFinishedGw, 2);
  }
  for (const event of [null, undefined, 2]) {
    assert.equal(deriveGameweekState(events, [{ event, finished: true }], now).reportLive, true);
  }
});

test('finalizing scores keep minute refreshes without advertising LIVE', () => {
  const snapshot = { meta: { snapshotSchema: SNAPSHOT_SCHEMA, reportLive: false,
    reportFinalizing: true, updated: new Date(now).toISOString() }, events: [] };
  assert.equal(snapshotTtlMs(snapshot, 900000, now), 60000);
  assert.equal(isSnapshotFresh(snapshot, 900000, now + 60000), false);
});

test('full pipeline full time updates report, predictions, players, standings and prebuilt matches without freezing provisional scores', async (t) => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fpl-final-whistle-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  const source = fixture();
  const fetchJson = async url => {
    const value = await source.fetchJson(url);
    return url.includes('/fixtures/') ? value.map(f => ({ ...f, finished: false, finished_provisional: true })) : value;
  };
  const snapshot = await buildSnapshot(999, { fetchJson, cacheDir, now });
  assert.equal(snapshot.meta.reportLive, false);
  assert.equal(snapshot.meta.reportGw, 3);
  assert.equal(snapshot.meta.lastFinishedGw, 3);
  assert.equal(snapshot.meta.upcomingGw, 4);
  assert.equal(snapshot.meta.reportFinalizing, true);
  assert.equal(snapshot.meta.standingsLive, false);
  assert.equal(snapshot.meta.refreshSeconds, 900);
  assert.equal(snapshot.tradeReturns.throughGw, 3);
  assert.equal(snapshot.players.find(p => p.id === 1).lastGwPoints, 8);
  assert.equal(snapshot.matchDetails[0].live, false);
  assert.equal(snapshot.matchDetails[0].finished, true);
  assert.equal(snapshot.h2hByGw[3][0].finished, true);
  assert.equal(fs.existsSync(path.join(cacheDir, 'draft-live-v1-gw3.json')), false);
  assert.equal(fs.existsSync(path.join(cacheDir, 'draft-live-detail-v1-gw3.json')), false);
});

test('all finished fixtures stop live updates; next deadline starts new report', () => {
  const finished = deriveGameweekState(events, [{ event: 3, started: true, finished: true }], now);
  assert.equal(finished.reportGw, 3);
  assert.equal(finished.reportLive, false);
  assert.equal(finished.reportFinalizing, true);
  assert.equal(finished.lastFinishedGw, 3);
  assert.equal(finished.upcomingGw, 4);
  const settled = events.map((event) => event.id === 3 ? { ...event, finished: true, data_checked: true } : event);
  assert.equal(deriveGameweekState(settled, [], now).reportGw, 3);
  const next = deriveGameweekState(settled, [], start + 4 * 86400000);
  assert.equal(next.reportGw, 4);
  assert.equal(next.reportLive, true);
  assert.equal(next.lastFinishedGw, 3);
});

test('preseason has no live report', () => {
  const pre = deriveGameweekState(events.map((event) => ({ ...event, finished: false, is_current: false })), [], start);
  assert.equal(pre.reportGw, 0);
  assert.equal(pre.gwStarted, false);
  assert.equal(pre.reportLive, false);
});

test('both cache types expire at60s live, at deadline, or schema change', () => {
  const snapshot = { meta: { snapshotSchema: SNAPSHOT_SCHEMA, reportLive: true, updated: new Date(now).toISOString() }, events: [] };
  assert.equal(isSnapshotFresh(snapshot, 900000, now + 59999), true);
  assert.equal(isSnapshotFresh(snapshot, 900000, now + 60000), false);
  const waiting = { meta: { ...snapshot.meta, reportLive: false }, events: [{ deadline: new Date(now + 30000).toISOString() }] };
  assert.equal(isSnapshotFresh(waiting, 900000, now + 29999), true);
  assert.equal(isSnapshotFresh(waiting, 900000, now + 30000), false);
  assert.equal(isSnapshotFresh({ meta: { updated: snapshot.meta.updated } }, 900000, now), false);
  assert.equal(isSnapshotFresh({ ...snapshot, meta: { ...snapshot.meta, snapshotSchema: SNAPSHOT_SCHEMA - 1 } }, 900000, now), false);
});

test('live snapshot expires with its oldest scoring source, not sixty seconds after a slow build', () => {
  const snapshot = { meta: { snapshotSchema: SNAPSHOT_SCHEMA, reportLive: true,
    updated: new Date(now + 20000).toISOString(), reportSourceExpiresAt: new Date(now + 60000).toISOString() }, events: [] };
  assert.equal(snapshotTtlMs(snapshot, 900000, now + 20000), 40000);
  assert.equal(isSnapshotFresh(snapshot, 900000, now + 59999), true);
  assert.equal(isSnapshotFresh(snapshot, 900000, now + 60000), false);
  assert.equal(isSnapshotFresh(snapshot, 900000, now + 65000), false, 'no fresh-container/expired-detail window');
  const delayed = { ...snapshot, meta: { ...snapshot.meta, updated: new Date(now + 61000).toISOString() } };
  assert.equal(snapshotTtlMs(delayed, 900000, now + 61000), 0);
  assert.equal(isSnapshotFresh(delayed, 900000, now + 61000), false);
  assert.equal(isSnapshotFresh(snapshot, 900000, now + 19999), false, 'future construction time is not fresh');
});

test('resolved positions are the single scoring XI and are not autosubbed a second time', () => {
  const points = new Map([[1, 0], [2, 8], [3, 100]]);
  const payload = { picks: [{ element: 1, position: 1 }, { element: 2, position: 12 }, { element: 3, position: 13 }], subs: [{ element_out: 1, element_in: 3 }] };
  const positions = new Map([[1, 12], [2, 1], [3, 13]]);
  assert.equal(scoreLockedPicks(payload, points, positions), 8);
  assert.equal(scoreLockedPicks(payload, new Map([[1, 0], [3, 100]]), positions), null);
});

test('locked XI ignores multiplier/bench, applies official subs only once', () => {
  const points = new Map([[1, 3], [2, 8], [3, 100]]);
  assert.equal(scoreLockedPicks({ picks: [{ element: 1, position: 1, multiplier: 2 }, { element: 3, position: 12, multiplier: 1 }] }, points), 3);
  const subs = [{ element_out: 1, element_in: 2 }];
  assert.equal(scoreLockedPicks({ picks: [{ element: 1, position: 1 }, { element: 2, position: 12 }], subs }, points), 8);
  assert.equal(scoreLockedPicks({ picks: [{ element: 2, position: 1 }, { element: 1, position: 12 }], subs }, points), 8);
  assert.equal(scoreLockedPicks({ picks: [{ element: 99, position: 1 }] }, points), null);
});

test('standings reconstruct unique historical/live matches without double counting stale totals', () => {
  const entries = [{ id: 1 }, { id: 2 }];
  const matches = [
    { event: 1, started: true, league_entry_1: 1, league_entry_2: 2, league_entry_1_points: 10, league_entry_2_points: 5 },
    { event: 2, started: true, league_entry_1: 1, league_entry_2: 2, league_entry_1_points: 8, league_entry_2_points: 8 },
    { event: 3, started: false, league_entry_1: 1, league_entry_2: 2, league_entry_1_points: 0, league_entry_2_points: 0 },
  ];
  const scored = applyLiveMatchScores([...matches, matches[0]], 3, new Map([[1, 2], [2, 5]]), state);
  const rows = rebuildH2HStandings(entries, scored, 3, [{ league_entry: 1, total: 99, matches_played: 38 }]);
  assert.equal(rows.find((row) => row.league_entry === 1).total, 4);
  assert.equal(rows.find((row) => row.league_entry === 1).points_for, 20);
  assert.equal(rows.find((row) => row.league_entry === 2).total, 4);
  assert.equal(rows.find((row) => row.league_entry === 2).points_for, 18);
  assert.equal(rows[0].matches_played, 3);
  assert.equal(scored[2].started, true);
  assert.equal(scored[2].live, true);
});

function fixture(scoring = 'h') {
  const positions = [1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 1, 2, 3, 4];
  const players = Array.from({ length: 30 }, (_, index) => ({ id: index + 1, code: 1000 + index, web_name: `Player${index + 1}`, first_name: 'Player', second_name: String(index + 1), team: 1, element_type: positions[index % 15] }));
  players.push({ ...players[0], id: 100, code: 9999, web_name: 'New signing' });
  const picks = (entry) => ({ entry_history: {}, picks: positions.map((_, index) => ({ element: index + 1 + (entry === 22 ? 15 : 0), position: index + 1, multiplier: 1 })), subs: [] });
  const details = {
    league: { scoring, start_event: 1, name: 'Test league' },
    league_entries: [{ id: 1, entry_id: 11, entry_name: 'A' }, { id: 2, entry_id: 22, entry_name: 'B' }],
    standings: [{ league_entry: 1, rank: 1, total: 999, points_for: 999, matches_played: 38 }, { league_entry: 2, rank: 2, total: 998, points_for: 998, matches_played: 38 }],
    matches: scoring === 'c' ? [] : [1, 2, 3, 4].map((event) => ({ event, started: event <= 3, finished: event <= 2, league_entry_1: 1, league_entry_2: 2, league_entry_1_points: event === 1 ? 10 : event === 2 ? 8 : 4, league_entry_2_points: event === 1 ? 5 : event === 2 ? 8 : 0 })),
  };
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url);
    if (url.includes('/bootstrap-static')) {
      return { events, elements: players, teams: [{ id: 1, code: 3, name: 'Arsenal', short_name: 'ARS' }, { id: 2, code: 14, name: 'Liverpool', short_name: 'LIV' }], element_types: positions.slice(0, 4).map((_, i) => ({ id: i + 1, singular_name_short: ['GKP', 'DEF', 'MID', 'FWD'][i] })) };
    }
    if (url.includes('/fixtures/')) return [{ id: 21, event: 3, team_h: 1, team_a: 2, started: true, finished: false }];
    if (url.endsWith('/details')) return details;
    if (url.endsWith('/transactions')) return { transactions: [] };
    if (url.endsWith('/trades')) return { trades: [] };
    if (url.endsWith('/element-status')) return { element_status: players.filter((player) => player.id !== 1).map((player) => ({ element: player.id, owner: player.id <= 15 || player.id === 100 ? 11 : 22 })) };
    const pickMatch = url.match(/\/entry\/(\d+)\/event\/(\d+)$/);
    if (pickMatch) return picks(Number(pickMatch[1]));
    const liveMatch = url.match(/\/event\/(\d+)\/live$/);
    if (liveMatch) {
      const gw = Number(liveMatch[1]);
      return { elements: Object.fromEntries(players.map((player) => [player.id, { stats: {
        total_points: gw < 3 ? gw : player.id === 1 ? 8 : player.id === 16 ? 5 : 0,
        minutes: gw < 3 || player.id === 1 || player.id === 16 ? 90 : 0, yellow_cards: 0, red_cards: 0,
      } }])) };
    }
    throw new Error(`Unexpected test request ${url}`);
  };
  return { fetchJson, calls, players };
}

test('snapshot exposes actual Draft trading windows without changing Classic event timeline', async (t) => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fpl-window-test-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  const source = fixture();
  const snapshot = await buildSnapshot(999, { cacheDir, now, fetchJson: async url => {
    const value = await source.fetchJson(url);
    return url === 'https://draft.premierleague.com/api/bootstrap-static'
      ? { ...value, events: { data: [{ id: 4, waivers_time: '2026-09-11T12:30:00Z', deadline_time: '2026-09-12T12:30:00Z' }] } }
      : value;
  } });
  assert.deepEqual(snapshot.tradeWindows, [{ gw: 4, opensAt: '2026-09-11T12:30:00Z', closesAt: '2026-09-12T12:30:00Z' }]);
  assert.equal(snapshot.meta.reportGw, 3);
  assert.equal(snapshot.meta.snapshotSchema, SNAPSHOT_SCHEMA);
});

test('full pipeline GW3 report/TOTW/history/live standings use locked players, current squad uses ownership', async (t) => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fpl-live-test-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  const source = fixture();
  const options = { fetchJson: source.fetchJson, cacheDir, now };
  const snapshot = await buildSnapshot(999, options);
  assert.equal(snapshot.meta.reportGw, 3);
  assert.equal(snapshot.meta.lastFinishedGw, 2);
  assert.equal(snapshot.meta.refreshSeconds, 900);
  assert.equal(snapshot.meta.standingsLive, true);
  const a = snapshot.managers.find((manager) => manager.entryId === 11);
  assert.equal(a.reportGwPoints, 8);
  assert.equal(a.total, 7);
  assert.equal(a.matchesPlayed, 3);
  assert.equal(a.pointsFor, 26);
  assert.equal(a.picks.some((pick) => pick.element === 1), false);
  assert.equal(a.picks.some((pick) => pick.element === 100), true);
  assert.equal(snapshot.h2hByGw[3][0].entry1Points, 8);
  assert.equal(snapshot.h2hByGw[4], undefined);
  assert.ok(snapshot.leagueSchedule.some(m => m.gw === 4), 'full fixture calendar retains future official matches');
  assert.ok(snapshot.leagueSchedule.filter(m => !m.started).every(m => m.entry1Points === null && m.entry2Points === null), 'future zero placeholders are omitted');
  assert.equal(snapshot.gwHistory.at(-1).gw, 3);
  assert.equal(snapshot.players.find((player) => player.id === 1).lastGwPoints, 2);
  assert.equal(snapshot.players.find((player) => player.id === 1).liveGwPoints, 8);
  assert.equal(snapshot.dreamTeam.players.length, 11);
  assert.equal(snapshot.dreamTeam.players[0].gwPoints, 8);
  for (const gw of [1, 2, 3]) {
    const pastKeeper = snapshot.totwByGw[gw].players.find(player => player.id === 1);
    assert.equal(pastKeeper.owner, 11, `GW${gw} keeps the locked owner even after release`);
    assert.equal(pastKeeper.ownerName, 'A');
    assert.equal(pastKeeper.ownershipStatus, 'owned');
  }
  assert.equal(snapshot.players.find(player => player.id === 1).owner, null, 'current free-agent data is unchanged');
  assert.equal(snapshot.matchDetails.length, 1, 'current matchup is already in the normal snapshot');
  const detail = snapshot.matchDetails[0];
  assert.equal(detail.gw, snapshot.meta.reportGw);
  assert.deepEqual(detail.sides.map(side => [side.entryId, side.score, side.players.length]), [[11, 8, 15], [22, 5, 15]]);
  assert.ok(detail.sides[0].players.some(player => player.id === 1), 'locked goalkeeper survives later ownership change');
  assert.ok(!detail.sides[0].players.some(player => player.id === 100));
  assert.equal(Date.parse(detail.updated), now);
  assert.equal(Date.parse(snapshot.meta.reportSourceExpiresAt), now + 60000);
  assert.equal(source.calls.filter(url => url.endsWith('/entry/11/event/3')).length, 1, 'precomputation does not refetch every matchup');
  assert.equal(source.calls.filter(url => url.endsWith('/event/3/live')).length, 1);
  await buildSnapshot(999, options);
  assert.equal(source.calls.filter((url) => url.endsWith('/event/1/live')).length, 1);
  assert.equal(source.calls.filter((url) => url.endsWith('/event/2/live')).length, 1);
  assert.equal(source.calls.filter((url) => url.endsWith('/event/3/live')).length, 2);
});

test('Classic totals reconstruct each locked GW, not stale totals plus live twice', async (t) => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fpl-classic-test-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  const source = fixture('c');
  const options = { fetchJson: source.fetchJson, cacheDir, now };
  const snapshot = await buildSnapshot(999, options);
  assert.equal(snapshot.managers[0].total, 41);
  assert.equal(snapshot.managers[0].pointsFor, 41);
  assert.equal(snapshot.managers[1].total, 38);
  assert.deepEqual(snapshot.managers[0].history.map((item) => item.points), [11, 22, 8]);
  assert.deepEqual(snapshot.matchDetails, [], 'Classic leagues do not get invented head-to-head details');
  await buildSnapshot(999, options);
  assert.equal(source.calls.filter((url) => url.endsWith('/entry/11/event/1')).length, 1);
});

test('empty/failing current live feed cannot publish fresh zero-score snapshot', async (t) => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fpl-failed-test-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  const source = fixture();
  await assert.rejects(buildSnapshot(999, { cacheDir, now, fetchJson: (url) => url.endsWith('/event/3/live') ? Promise.resolve({ elements: {} }) : source.fetchJson(url) }), /no player scores/);
});

test('pipeline refuses empty/malformed current fixtures instead of withdrawing projected substitutions as fresh data', async (t) => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fpl-fixture-validation-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  const source = fixture();
  for (const bad of [[], [{ id: 21, event: 4, team_h: 1, team_a: 2, started: true, finished: false }], [{ event: 3, started: true, finished: false }]]) {
    await assert.rejects(buildSnapshot(999, { cacheDir, now, fetchJson: url => url.includes('/fixtures/') ? Promise.resolve(bad) : source.fetchJson(url) }), /Fixture status unavailable/);
  }
});

test('precomputed automatic substitute uses the same seven points in report, standings and both pitch details', async (t) => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fpl-projected-pipeline-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  const source = fixture();
  const originalPicks = new Map();
  const snapshot = await buildSnapshot(999, { cacheDir, now, fetchJson: async url => {
    const value = await source.fetchJson(url);
    if (url.includes('/bootstrap-static')) return { ...value,
      elements: value.elements.map(player => player.id === 1 ? { ...player, team: 2 } : player),
      teams: [...value.teams, { id: 3, code: 31, name: 'Opponent A', short_name: 'OPA' }, { id: 4, code: 54, name: 'Opponent B', short_name: 'OPB' }],
    };
    if (url.includes('/fixtures/')) return [
      { id: 21, event: 3, team_h: 2, team_a: 3, started: true, finished: false, finished_provisional: true },
      { id: 22, event: 3, team_h: 1, team_a: 4, started: true, finished: false },
    ];
    if (url.endsWith('/event/3/live')) {
      value.elements[1].stats = { total_points: 0, minutes: 0, yellow_cards: 0, red_cards: 0 };
      value.elements[12].stats = { total_points: 7, minutes: 90, yellow_cards: 0, red_cards: 0 };
    }
    if (url.includes('/entry/') && url.endsWith('/event/3')) originalPicks.set(url, value);
    return value;
  } });
  const side = snapshot.matchDetails[0].sides.find(item => item.entryId === 11);
  const manager = snapshot.managers.find(item => item.entryId === 11);
  assert.equal(side.score, 7);
  assert.equal(manager.reportGwPoints, side.score);
  assert.equal(snapshot.reportGwMatches[0].entry1Points, side.score);
  assert.equal(manager.pointsFor, 25, '10 + 8 historical points plus the seven-point substitute');
  assert.equal(manager.total, 7);
  assert.equal(side.provisional, true);
  assert.equal(snapshot.meta.autoSubsProvisional, true);
  assert.deepEqual(side.substitutions, [{ element_out: 1, element_in: 12, source: 'projected', pending: false }]);
  assert.equal(side.players.find(player => player.id === 12).countsForTeam, true);
  assert.equal(side.players.find(player => player.id === 1).countsForTeam, false);
  const picks = [...originalPicks.values()][0];
  assert.equal(picks.picks.find(pick => pick.element === 1).position, 1, 'projection cannot rewrite official input');
  assert.deepEqual(picks.subs, []);
});

test('missing minutes or disciplinary data in any locked player fails the snapshot instead of silently cancelling projections', async (t) => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fpl-missing-appearance-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  const source = fixture();
  for (const field of ['minutes', 'yellow_cards', 'red_cards']) {
    await assert.rejects(buildSnapshot(999, { cacheDir, now, fetchJson: async url => {
      const value = await source.fetchJson(url);
      if (url.endsWith('/event/3/live')) delete value.elements[12].stats[field];
      return value;
    } }), /Incomplete live appearance data/);
  }
});

test('early live TOTW provides a legal zero-point XI, goalkeeper first', () => {
  const source = fixture();
  const players = source.players.map((player) => ({ ...player, pos: ['GKP', 'DEF', 'MID', 'FWD'][player.element_type - 1] }));
  const team = buildDreamTeam(players, new Map(players.map((player) => [player.id, 0])));
  assert.equal(team.players.length, 11);
  assert.equal(team.players[0].pos, 'GKP');
  assert.equal(team.players.every((player) => player.gwPoints === 0), true);
});

test('TOTW ownership survives new trades, manager renames and fresh scores; historical API is fetched only once', async (t) => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fpl-totw-freeze-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  const source = fixture();
  let later = false;
  const fetchJson = async url => {
    const value = structuredClone(await source.fetchJson(url));
    if (url.endsWith('/live')) value.elements[100].stats.total_points = later ? 21 : 20;
    if (later && url.endsWith('/details')) value.league_entries[0].entry_name = 'Renamed A';
    if (later && url.endsWith('/element-status')) value.element_status.find(row => row.element === 2).owner = 22;
    if (later && /\/entry\/\d+\/event\/[12]$/.test(url)) throw Error('history should be cached');
    return value;
  };
  const first = await buildSnapshot(999, { cacheDir, now, fetchJson });
  const frozenFiles = fs.readdirSync(cacheDir).filter(name => name.includes('ownership'));
  assert.equal(frozenFiles.length, 3);
  const saved = frozenFiles.map(name => fs.readFileSync(path.join(cacheDir, name), 'utf8'));
  later = true;
  const second = await buildSnapshot(999, { cacheDir, now: now + 60_000, fetchJson });
  for (const gw of [1, 2, 3]) {
    const free = second.totwByGw[gw].players.find(player => player.id === 100);
    assert.equal(free.owner, null);
    assert.equal(free.ownershipStatus, 'free', 'a later signing never rewrites historical free status');
    const defender = second.totwByGw[gw].players.find(player => player.id === 2);
    assert.equal(defender.owner, 11);
    assert.equal(defender.ownerName, 'A', 'snapshot retains its captured display name');
  }
  assert.equal(first.totwByGw[3].players[0].gwPoints, 20);
  assert.equal(second.totwByGw[3].players[0].gwPoints, 21, 'freezing ownership must not freeze unsettled scores');
  assert.equal(second.managers.find(manager => manager.entryId === 11).entryName, 'Renamed A');
  assert.equal(second.players.find(player => player.id === 2).owner, 22);
  assert.equal(source.calls.filter(url => url.endsWith('/entry/11/event/1')).length, 1);
  assert.deepEqual(frozenFiles.map(name => fs.readFileSync(path.join(cacheDir, name), 'utf8')), saved);
});

test('incomplete historical squads stay unknown, are not persisted, and recover on a later refresh', async (t) => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fpl-totw-partial-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  const source = fixture();
  let recovered = false;
  const fetchJson = async url => !recovered && url.endsWith('/entry/22/event/2')
    ? { picks: [] } : source.fetchJson(url);
  const first = await buildSnapshot(999, { cacheDir, now, fetchJson });
  assert.ok(first.totwByGw[2].players.every(player => player.ownershipStatus === 'unknown' && player.owner === null));
  assert.equal(fs.readdirSync(cacheDir).filter(name => name.includes('ownership')).length, 2);
  recovered = true;
  const second = await buildSnapshot(999, { cacheDir, now, fetchJson });
  assert.ok(second.totwByGw[2].players.every(player => player.ownershipStatus !== 'unknown'));
  assert.equal(fs.readdirSync(cacheDir).filter(name => name.includes('ownership')).length, 3);
});

test('a frozen historical manager remains named even if absent from the latest league membership', async (t) => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fpl-totw-membership-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  const source = fixture();
  await buildSnapshot(999, { cacheDir, now, fetchJson: source.fetchJson });
  const snapshot = await buildSnapshot(999, { cacheDir, now: now + 60_000, fetchJson: async url => {
    const value = structuredClone(await source.fetchJson(url));
    if (url.endsWith('/details')) value.league_entries = value.league_entries.filter(entry => entry.entry_id !== 11);
    return value;
  } });
  assert.equal(snapshot.managers.some(manager => manager.entryId === 11), false);
  for (const gw of [1, 2, 3]) {
    const player = snapshot.totwByGw[gw].players.find(player => player.id === 1);
    assert.equal(player.owner, 11);
    assert.equal(player.ownerName, 'A');
    assert.equal(player.ownershipStatus, 'owned');
  }
});
