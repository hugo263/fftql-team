'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SNAPSHOT_SCHEMA } = require('../live-scoring');
const { PUBLIC_STALE_LIMIT_MS, RETRY_BACKOFF_MS, canServeWhileRefreshing, createPublicSnapshotReader } = require('../public-snapshot');

const NOW = Date.parse('2026-09-07T03:00:00Z');
function snapshot(age = 90_000) {
  return { meta: { leagueId: 47275, snapshotSchema: SNAPSHOT_SCHEMA, season: '2026/27', reportLive: true,
    updated: new Date(NOW - age).toISOString(), reportSourceUpdated: new Date(NOW - age - 20_000).toISOString(),
    reportSourceExpiresAt: new Date(NOW - age + 40_000).toISOString() },
  events: [{ id: 1, deadline: '2026-08-15T18:00:00Z' }, { id: 4, deadline: '2026-09-14T11:00:00Z' }],
  managers: [{ entryId: 1, points: 38 }], players: [{ id: 1, liveGwPoints: -1 }], matchDetails: [] };
}
const eligible = (value, time = NOW) => canServeWhileRefreshing(value, 47275, SNAPSHOT_SCHEMA, time);
const tick = () => new Promise(resolve => setImmediate(resolve));

test('display shortcut rejects wrong identity/schema/season, missing data and invalid or old timestamps', () => {
  assert.equal(eligible(snapshot()), true);
  for (const transform of [
    s => { s.meta.leagueId = 1; }, s => { s.meta.snapshotSchema--; },
    s => { s.meta.season = '2025/26'; }, s => { s.meta.season = '2026/28'; },
    s => { s.meta.updated = 'invalid'; }, s => { s.meta.updated = new Date(NOW + 1).toISOString(); },
    s => { s.meta.reportSourceUpdated = 'invalid'; },
    s => { s.meta.reportSourceUpdated = new Date(NOW - PUBLIC_STALE_LIMIT_MS).toISOString(); },
    s => { s.meta.stale = true; }, s => { s.meta.refreshing = true; },
    s => { delete s.managers; }, s => { delete s.players; }, s => { s.events = []; },
    s => { s.events[0].deadline = 'invalid'; }, s => { s.events[0].deadline = '2025-08-01T00:00:00Z'; },
  ]) { const s = snapshot(); transform(s); assert.equal(eligible(s), false); }
  const recent = snapshot(PUBLIC_STALE_LIMIT_MS - 1);
  recent.meta.reportSourceUpdated = recent.meta.updated;
  assert.equal(eligible(recent), true);
  assert.equal(eligible(snapshot(PUBLIC_STALE_LIMIT_MS)), false);
});

test('a deadline crossed after the snapshot forbids stale display at the exact deadline boundary', () => {
  const s = snapshot();
  s.events[1].deadline = new Date(NOW).toISOString();
  assert.equal(eligible(s, NOW - 1), true);
  assert.equal(eligible(s), false);
  assert.equal(eligible(s, NOW + 1), false);
});

test('expired public GETs immediately return a marked copy and deduplicate background loading', async () => {
  const saved = snapshot(), before = JSON.stringify(saved);
  let calls = 0, complete, memory = saved;
  const get = createPublicSnapshotReader({ schema: SNAPSHOT_SCHEMA, normalTtlMs: 900_000,
    readCached: () => memory, rememberCached: (_id, value) => { memory = value; }, now: () => NOW,
    loadSnapshot: () => { calls++; return new Promise(resolve => { complete = resolve; }); } });
  const [a, b] = await Promise.all([get(47275), get(47275)]);
  assert.equal(calls, 1);
  assert.equal(a.meta.stale, true);
  assert.equal(b.meta.refreshing, true);
  assert.equal(a.meta.updated, saved.meta.updated);
  assert.equal(a.meta.reportSourceUpdated, saved.meta.reportSourceUpdated);
  assert.equal(a.meta.reportSourceExpiresAt, saved.meta.reportSourceExpiresAt);
  assert.equal(a.players, saved.players);
  assert.equal(a.managers, saved.managers);
  assert.equal(JSON.stringify(saved), before);
  memory = snapshot(0);
  complete(memory);
  await tick();
  // The normal loader owns fresh-cache returns too.
  let freshCalls = 0;
  const fresh = createPublicSnapshotReader({ schema: SNAPSHOT_SCHEMA, normalTtlMs: 900_000,
    readCached: () => memory, now: () => NOW, loadSnapshot: async () => { freshCalls++; return memory; } });
  assert.equal(await fresh(47275), memory);
  assert.equal(freshCalls, 1);
});

test('background failure backs off, retains original fields, then retries without unhandled rejection', async () => {
  let time = NOW, calls = 0, errors = 0;
  const saved = snapshot();
  const get = createPublicSnapshotReader({ schema: SNAPSHOT_SCHEMA, normalTtlMs: 900_000,
    readCached: () => saved, now: () => time, onError: () => { errors++; },
    loadSnapshot: async () => { calls++; throw new Error('official API timeout'); } });
  assert.equal((await get(47275)).meta.refreshing, true);
  await tick();
  const backedOff = await get(47275);
  assert.equal(backedOff.meta.refreshing, false);
  assert.equal(backedOff.meta.stale, true);
  assert.equal(backedOff.meta.updated, saved.meta.updated);
  assert.match(backedOff.meta.refreshError, /暂时不可用/);
  assert.equal(calls, 1);
  assert.equal(errors, 1);
  time += RETRY_BACKOFF_MS;
  assert.equal((await get(47275)).meta.refreshing, true);
  await tick();
  assert.equal(calls, 2);
});

test('cold, over-age and cross-deadline requests wait for the authoritative result', async () => {
  const crossed = snapshot(); crossed.events[1].deadline = new Date(NOW - 1).toISOString();
  for (const candidate of [null, snapshot(PUBLIC_STALE_LIMIT_MS), crossed]) {
    let finish, resolved = false;
    const authoritative = snapshot(0);
    const get = createPublicSnapshotReader({ schema: SNAPSHOT_SCHEMA, normalTtlMs: 900_000,
      readCached: () => candidate, now: () => NOW,
      loadSnapshot: () => new Promise(resolve => { finish = resolve; }) });
    const task = get(47275).then(value => { resolved = true; return value; });
    await tick();
    assert.equal(resolved, false);
    finish(authoritative);
    assert.equal(await task, authoritative);
  }
});

test('public wrapper does not replace match authorization, scheduler or forced refresh loaders', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const matchGetter = source.slice(source.indexOf('async function getMatchSnapshot'), source.indexOf('const matchDetailService'));
  assert.ok(!matchGetter.includes('getPublicLeagueSnapshot'));
  const refreshRoute = source.slice(source.indexOf("if (pathname === '/api/refresh'"), source.indexOf("if (pathname === '/api/health'"));
  assert.match(refreshRoute, /refreshWorkspaceNow\(requestedLeagueId \|\| Number\(config.leagueId\)\)/);
  assert.match(source, /then\(\(\) => getLeagueSnapshot\(leagueId, true\)\)/);
  assert.ok(!refreshRoute.includes('getPublicLeagueSnapshot'));
});
