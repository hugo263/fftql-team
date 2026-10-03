'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGameweekRollover, DAY_MS } = require('../gameweek-rollover');
const { deriveGameweekState } = require('../live-scoring');
const { createMatchCentreService } = require('../match-centre');
const { workspaceFresh } = require('../update-stream');
const timeline = require('../public/timeline');
const end = Date.parse('2026-09-14T21:05:00Z');
const events = Array.from({ length: 38 }, (_, i) => ({ id: i + 1, name: `Gameweek ${i + 1}`,
  deadline_time: new Date(Date.parse('2026-09-12T10:00:00Z') + (i - 3) * 7 * DAY_MS).toISOString(),
  is_current: i === 3, finished: i < 4, data_checked: true }));
const fixtures = [
  { id: 31, event: 4, started: true, finished: true, finished_provisional: true, kickoff_time: '2026-09-14T19:00:00Z' },
  { id: 41, event: 5, started: false, finished: false, finished_provisional: false, kickoff_time: '2026-09-19T12:30:00Z' },
];

test('rollover waits a full 24h, persists first observation, and never advances scoring', () => {
  const store = createGameweekRollover();
  const state = store.observe(events, fixtures, end);
  assert.equal(state.weeklyDefaultGw, 4);
  assert.equal(state.weeklyFinishBasis, 'observed');
  assert.equal(Date.parse(state.weeklySwitchAt), end + DAY_MS);
  assert.equal(store.observe(events, fixtures, end + DAY_MS - 1).weeklyDefaultGw, 4);
  const next = store.observe(events, fixtures, end + DAY_MS);
  assert.equal(next.weeklyDefaultGw, 5);
  assert.equal(next.weeklyFinishedAt, state.weeklyFinishedAt);
  const core = deriveGameweekState(events, fixtures, end + DAY_MS);
  assert.equal(core.reportGw, 4);
  assert.equal(core.reportLive, false);
  assert.equal(timeline.weeklyGw({ ...core, ...state }, end + DAY_MS), 5);
  assert.equal(timeline.reportGw({ ...core, ...next }), 4);
  assert.equal(timeline.live({ ...core, ...next }, 5), false);
});

test('unfinished / postponed / TBD fixtures block rollover, and reopening a fixture resets it', () => {
  const store = createGameweekRollover();
  store.observe(events, fixtures, end);
  const incomplete = [...fixtures, { id: 32, event: 4, kickoff_time: null, finished: false }];
  assert.equal(store.observe(events, incomplete, end + 2 * DAY_MS).weeklyDefaultGw, 4);
  assert.equal(store.observe(events, incomplete, end + 2 * DAY_MS).weeklySwitchAt, null);
  incomplete[2] = { ...incomplete[2], finished_provisional: true };
  const completed = store.observe(events, incomplete, end + 2 * DAY_MS);
  assert.equal(completed.weeklyDefaultGw, 4);
  assert.equal(Date.parse(completed.weeklySwitchAt), end + 3 * DAY_MS);
});

test('legacy cold start backfills only verified finished rounds, without assuming exact final whistle', () => {
  const state = createGameweekRollover().observe(events, fixtures, end + 2 * DAY_MS);
  assert.equal(state.weeklyDefaultGw, 5);
  assert.equal(state.weeklyFinishBasis, 'legacy-estimate');
  assert.equal(state.weeklyFinishedAt, '2026-09-14T22:00:00.000Z');
  const incomplete = fixtures.map(f => ({ ...f, finished: false, finished_provisional: false }));
  const store = createGameweekRollover();
  assert.equal(store.observe(events, incomplete, end + 2 * DAY_MS).weeklyDefaultGw, 4);
  const after = store.observe(events, fixtures, end + 2 * DAY_MS);
  assert.equal(after.weeklyFinishBasis, 'observed');
  assert.equal(after.weeklyDefaultGw, 4, 'an observed late completion must not be backdated');
});

test('observed completion survives restart, season changes isolate state, final GW cannot become39', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fpl-rollover-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cachePath = path.join(dir, 'rounds.json');
  createGameweekRollover({ cachePath }).observe(events, fixtures, end);
  const restarted = createGameweekRollover({ cachePath });
  assert.equal(restarted.observe(events, fixtures, end + DAY_MS).weeklyFinishBasis, 'observed');
  assert.equal(restarted.observe(events, fixtures, end + DAY_MS).weeklyDefaultGw, 5);
  const nextSeason = events.map(e => ({ ...e, deadline_time: e.deadline_time.replace('2026', '2027').replace('2027-01', '2028-01') }));
  assert.equal(restarted.observe(nextSeason, [], end).weeklySwitchAt, null);
  const seasonEnd = Date.parse(events[37].deadline_time) + 3 * DAY_MS;
  const last = [{ ...fixtures[0], event: 38, kickoff_time: events[37].deadline_time }];
  assert.equal(restarted.observe(events, last, seasonEnd).weeklyDefaultGw, 38);
  assert.equal(restarted.observe(events, last, seasonEnd).nextWeeklyGw, null);
});

test('workspace cache expires at rollover boundary and historical selections remain available', () => {
  const meta = createGameweekRollover().observe(events, fixtures, end);
  const built = end + DAY_MS - 1000;
  const snapshot = { meta: { ...meta, snapshotSchema: 7, updated: new Date(built).toISOString() }, events: [] };
  assert.equal(workspaceFresh(snapshot, 7, built + 999), true);
  assert.equal(workspaceFresh(snapshot, 7, built + 1000), false);
  assert.equal(timeline.followReport({ ...meta, updated: new Date(end).toISOString() }, { ...meta, weeklyDefaultGw: 5 }, 2), 2);
});

test('match centre default crosses 24h exactly, keeps history, and loads no future live scores', async () => {
  let now = end;
  const calls = [];
  const boot = { events, teams: [{ id: 1, code: 3, name: 'Arsenal', short_name: 'ARS' }, { id: 2, code: 7, name: 'Villa', short_name: 'AVL' }],
    elements: [{ id: 1, code: 123, team: 1, element_type: 2, web_name: 'Player' }] };
  const matches = fixtures.map(f => ({ ...f, team_h: 1, team_a: 2, team_h_score: f.started ? 1 : null,
    team_a_score: f.started ? 0 : null, minutes: f.started ? 90 : 0, stats: [] }));
  const service = createMatchCentreService({ now: () => now, fetchJson: async url => {
    calls.push(url);
    if (url.endsWith('bootstrap-static/')) return structuredClone(boot);
    if (url.endsWith('fixtures/')) return structuredClone(matches);
    return { elements: [{ id: 1, explain: [] }] };
  } });
  assert.equal((await service.get()).meta.gw, 4);
  now = end + DAY_MS - 1000;
  const before = await service.get();
  assert.equal(before.meta.gw, 4);
  assert.equal(Date.parse(before.meta.nextRefreshAt), end + DAY_MS);
  now++;
  const count = calls.length;
  await service.get();
  assert.equal(calls.length, count, 'cached response before exact boundary');
  now = end + DAY_MS;
  const next = await service.get();
  assert.equal(next.meta.gw, 5);
  assert.equal(next.fixtures[0].event, 5);
  assert.equal(next.fixtures[0].team_h_score, null);
  assert.deepEqual(next.events, []);
  assert.equal(calls.some(url => url.includes('/event/5/live/')), false);
  assert.equal((await service.get(4)).meta.gw, 4);
  assert.equal((await service.get()).meta.gw, 5);
});
