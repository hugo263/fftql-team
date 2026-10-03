'use strict';

// Authored for the v79 refresh work. Do not run before the user's test/release
// authorization: fixtures are synthetic and never replace site data.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  WORKSPACE_DISPLAY_POLICY, PUBLIC_LIVE_DISPLAY_LIMIT_MS, PUBLIC_IDLE_DISPLAY_LIMIT_MS,
  RETRY_BACKOFF_MS, canServeWhileRefreshing, createPublicSnapshotReader,
} = require('../public-snapshot');
const { workspaceFresh, WORKSPACE_INTERVAL } = require('../update-stream');
const { SNAPSHOT_SCHEMA, isSnapshotFresh } = require('../live-scoring');

const NOW = Date.parse('2026-09-14T12:00:00Z');
const DAY = 86_400_000;
const iso = time => new Date(time).toISOString();
const tick = () => new Promise(resolve => setImmediate(resolve));
function snapshot(age = 16 * 60_000, live = true) {
  const updated = NOW - age;
  const events = Array.from({ length: 38 }, (_, index) => ({
    id: index + 1, deadline: iso(Date.parse('2026-08-15T12:00:00Z') + index * 7 * DAY),
  }));
  return {
    meta: { leagueId: 47275, snapshotSchema: SNAPSHOT_SCHEMA, season: '2026/27',
      currentGw: 5, reportGw: 5, reportLive: live, reportFinalizing: false,
      updated: iso(updated), reportSourceUpdated: iso(updated - 10_000),
      reportSourceExpiresAt: iso(updated + 50_000) },
    events, tradeWindows: events.map(event => ({ gw: event.id,
      opensAt: iso(Date.parse(event.deadline) - DAY), closesAt: event.deadline })),
    managers: [{ entryId: 101, points: 14 }], players: [{ id: 9, liveGwPoints: 2 }],
    totwByGw: { 4: [{ id: 9, owner: 101 }] },
  };
}
const eligible = (value, time = NOW) => canServeWhileRefreshing(value, 47275,
  SNAPSHOT_SCHEMA, time, WORKSPACE_DISPLAY_POLICY);
function reader(overrides = {}) {
  return createPublicSnapshotReader({ schema: SNAPSHOT_SCHEMA, normalTtlMs: WORKSPACE_INTERVAL,
    now: () => NOW, displayPolicy: WORKSPACE_DISPLAY_POLICY,
    isFresh: (value, _ttl, time) => workspaceFresh(value, SNAPSHOT_SCHEMA, time), ...overrides });
}

test('workspace first-paint window genuinely extends beyond the fifteen-minute collector TTL', async () => {
  const saved = snapshot(), before = JSON.stringify(saved);
  assert.equal(workspaceFresh(saved, SNAPSHOT_SCHEMA, NOW), false);
  assert.equal(eligible(saved), true);
  // The default scoring predicate is unchanged by opting the public route in.
  assert.equal(isSnapshotFresh(saved, WORKSPACE_INTERVAL, NOW), false);
  let calls = 0, finish;
  const get = reader({ readCached: () => saved, loadSnapshot: () => {
    calls++; return new Promise(resolve => { finish = resolve; });
  } });
  const [a, b] = await Promise.all([get(47275), get(47275)]);
  assert.equal(calls, 1);
  assert.equal(a.meta.stale, true);
  assert.equal(b.meta.refreshing, true);
  assert.equal(a.meta.updated, saved.meta.updated);
  assert.equal(a.meta.reportSourceUpdated, saved.meta.reportSourceUpdated);
  assert.equal(a.meta.reportSourceExpiresAt, saved.meta.reportSourceExpiresAt);
  assert.equal(a.totwByGw, saved.totwByGw);
  assert.equal(a.players, saved.players);
  assert.equal(JSON.stringify(saved), before);
  finish(snapshot(0)); await tick();
});

test('live and finalizing data have a strict source-age ceiling, idle display a larger bounded window', () => {
  assert.equal(eligible(snapshot(20 * 60_000)), true);
  assert.equal(eligible(snapshot(PUBLIC_LIVE_DISPLAY_LIMIT_MS)), false);
  const delayedSource = snapshot(0);
  delayedSource.meta.reportSourceUpdated = iso(NOW - PUBLIC_LIVE_DISPLAY_LIMIT_MS);
  assert.equal(eligible(delayedSource), false);
  const finalizing = snapshot(PUBLIC_LIVE_DISPLAY_LIMIT_MS, false);
  finalizing.meta.reportFinalizing = true;
  assert.equal(eligible(finalizing), false);
  assert.equal(eligible(snapshot(2 * 60 * 60_000, false)), true);
  assert.equal(eligible(snapshot(PUBLIC_IDLE_DISPLAY_LIMIT_MS, false)), false);
});

test('settled frozen source timestamps stay original, never get falsely renewed or rejected for being historic', () => {
  const settled = snapshot(60 * 60_000, false);
  settled.meta.reportSourceUpdated = iso(NOW - DAY);
  settled.meta.reportSourceExpiresAt = iso(NOW - DAY + 60_000);
  assert.equal(eligible(settled), true);
  settled.meta.reportFinalizing = true;
  assert.equal(eligible(settled), false);
  settled.meta.reportFinalizing = false;
  settled.meta.reportSourceUpdated = iso(NOW + 1);
  assert.equal(eligible(settled), false);
  settled.meta.reportSourceUpdated = '2025-09-14T12:00:00Z';
  assert.equal(eligible(settled), false);
});

test('public display fails closed on wrong identity, schema, season, incomplete calendar and report GW', () => {
  const changes = [
    s => { s.meta.leagueId = 123; }, s => { s.meta.snapshotSchema--; },
    s => { s.meta.season = '2025/26'; }, s => { s.meta.season = '2026/28'; },
    s => { s.meta.currentGw = 4; }, s => { s.meta.reportGw = 4; },
    s => { s.meta.reportSourceExpiresAt = 'invalid'; },
    s => { s.meta.reportSourceExpiresAt = iso(NOW - DAY); },
    s => { s.meta.reportSourceUpdated = iso(Date.parse(s.events[4].deadline) - 1); },
    s => { s.events.pop(); }, s => { s.events[4] = s.events[3]; },
    s => { s.events[4] = null; }, s => { s.meta.updated = '2026-09-14T11:44:00'; },
    s => { s.events[10].deadline = '2026-10-24T12:00:00'; },
    s => { s.events[10].deadline = s.events[9].deadline; },
    s => { s.tradeWindows[5].opensAt = 'invalid'; },
    s => { s.tradeWindows.push(s.tradeWindows[0]); },
    s => { s.tradeWindows[0] = null; }, s => { delete s.tradeWindows; },
    s => { s.meta.reportFinalizing = true; }, s => { delete s.meta.reportSourceUpdated; },
    s => { s.meta.stale = true; }, s => { s.meta.refreshing = true; },
  ];
  for (const change of changes) {
    const value = snapshot(); change(value); assert.equal(eligible(value), false, String(change));
  }
});

for (const boundary of ['deadline', 'opensAt', 'closesAt']) {
  test(`public first paint cannot conceal a crossed ${boundary} at its exact boundary`, () => {
    const value = snapshot();
    if (boundary === 'deadline') value.events[5].deadline = iso(NOW);
    else {
      value.tradeWindows[5][boundary] = iso(NOW);
      if (boundary === 'closesAt') value.tradeWindows[5].opensAt = iso(NOW - DAY);
    }
    assert.equal(eligible(value, NOW - 1), true);
    assert.equal(eligible(value), false);
  });
}

test('no cache waits once for the authoritative build; concurrent first visitors share it', async () => {
  let calls = 0, finish, resolved = false;
  const expected = snapshot(0);
  const get = reader({ readCached: () => null, loadSnapshot: () => {
    calls++; return new Promise(resolve => { finish = resolve; });
  } });
  const one = get(47275).then(value => { resolved = true; return value; });
  const two = get(47275);
  await tick();
  assert.equal(resolved, false);
  assert.equal(calls, 1);
  finish(expected);
  assert.equal(await one, expected);
  assert.equal(await two, expected);
});

test('an unsafe old fallback from the authoritative loader is not leaked after cache validation rejects it', async () => {
  for (const change of [s => { s.meta.leagueId = 1; }, s => { s.meta.reportGw = 4; },
    s => { s.meta.updated = iso(NOW - PUBLIC_LIVE_DISPLAY_LIMIT_MS); },
    s => { s.events[5].deadline = iso(NOW); }]) {
    const old = snapshot(); change(old);
    old.meta.stale = true;
    const get = reader({ readCached: () => old, loadSnapshot: async () => old });
    await assert.rejects(get(47275), /(?:当前轮次|联赛)数据暂不可用/);
  }
});

test('a newly validated build remains authoritative even when the display-only calendar guard is stricter', async () => {
  const fresh = snapshot(0);
  fresh.events.pop(); // A later official GW deadline has not been announced.
  assert.equal(eligible(fresh), false);
  const get = reader({ readCached: () => null, loadSnapshot: async () => fresh });
  assert.equal(await get(47275), fresh);
  for (const change of [s => { s.meta.leagueId = 99; }, s => { s.meta.snapshotSchema--; },
    s => { delete s.players; }, s => { delete s.managers; }]) {
    const invalid = snapshot(0); change(invalid);
    const invalidGet = reader({ readCached: () => null, loadSnapshot: async () => invalid });
    await assert.rejects(invalidGet(47275), /联赛数据暂不可用/);
  }
});

test('a safe failed refresh preserves scores and source clocks with explicit delayed status and retry backoff', async () => {
  let time = NOW, calls = 0;
  const saved = snapshot(), before = JSON.stringify(saved);
  const get = reader({ now: () => time, readCached: () => saved, loadSnapshot: async () => {
    calls++; throw new Error('upstream timeout');
  } });
  assert.equal((await get(47275)).meta.refreshing, true);
  await tick();
  const delayed = await get(47275);
  assert.equal(delayed.meta.refreshing, false);
  assert.equal(delayed.meta.stale, true);
  assert.match(delayed.meta.refreshError, /暂时不可用/);
  assert.equal(delayed.meta.updated, saved.meta.updated);
  assert.equal(delayed.meta.reportSourceUpdated, saved.meta.reportSourceUpdated);
  assert.equal(JSON.stringify(saved), before);
  assert.equal(calls, 1);
  time += RETRY_BACKOFF_MS;
  assert.equal((await get(47275)).meta.refreshing, true);
  await tick(); assert.equal(calls, 2);
});

test('two league identities never share pending builds or display one another’s cached data', async () => {
  const first = snapshot(), second = snapshot(); second.meta.leagueId = 99;
  const cache = new Map([[47275, first], [99, second]]), calls = [], finishes = new Map();
  const get = reader({ readCached: id => cache.get(id), loadSnapshot: id => {
    calls.push(id); return new Promise(resolve => finishes.set(id, resolve));
  } });
  const [a, b] = await Promise.all([get(47275), get(99)]);
  assert.equal(a.meta.leagueId, 47275); assert.equal(b.meta.leagueId, 99);
  assert.deepEqual(calls, [47275, 99]);
  finishes.get(47275)(first); finishes.get(99)(second); await tick();
});
