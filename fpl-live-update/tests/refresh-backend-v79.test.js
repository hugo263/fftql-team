'use strict';

// Authored for the refresh redesign. Do not run until the user authorizes testing.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createMatchCentreService, refreshPlan, TTL_MS, FINALIZING_TTL_MS,
  IDLE_TTL_MS, HISTORY_TTL_MS, RETRY_BASE_MS, RETRY_MAX_MS } = require('../match-centre');
const { createUpdateHub, contentRevision } = require('../update-stream');

const clone = value => JSON.parse(JSON.stringify(value));
const initialTime = Date.parse('2026-09-13T17:00:00Z');
const frame = (chunks, event) => chunks.filter(chunk => chunk.startsWith(`event: ${event}\n`))
  .map(chunk => JSON.parse(chunk.split('\ndata: ')[1].trim()));
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness() {
  let time = initialTime;
  const source = {
    boot: {
      events: [{ id: 4, name: 'Gameweek 4', deadline_time: '2026-09-12T10:00:00Z',
        finished: false, data_checked: false, is_current: true }],
      teams: [{ id: 1, code: 3, name: 'Arsenal', short_name: 'ARS' },
        { id: 2, code: 8, name: 'Chelsea', short_name: 'CHE' }],
      elements: [{ id: 101, code: 1101, team: 1, element_type: 2, web_name: 'Defender' }],
    },
    fixtures: [{ id: 41, event: 4, team_h: 1, team_a: 2, kickoff_time: '2026-09-13T16:00:00Z',
      started: true, finished: false, finished_provisional: false, minutes: 60,
      team_h_score: 0, team_a_score: 0,
      stats: ['goals_scored', 'assists', 'yellow_cards', 'red_cards'].map(identifier => ({ identifier, h: [], a: [] })) }],
    live: { elements: [{ id: 101, explain: [{ fixture: 41,
      stats: [{ identifier: 'minutes', value: 60, points: 2 }, { identifier: 'clean_sheets', value: 1, points: 4 }] }] }] },
    fail: null, wait: null,
  };
  const calls = [];
  const service = createMatchCentreService({ now: () => time, fetchJson: async url => {
    calls.push(url);
    if (source.wait) await source.wait(url);
    if (source.fail?.(url)) throw new Error('upstream unavailable');
    if (url.endsWith('/bootstrap-static/')) return clone(source.boot);
    if (url.endsWith('/fixtures/')) return clone(source.fixtures);
    if (url.endsWith('/live/')) return clone(source.live);
    throw new Error('unexpected URL');
  } });
  return { source, calls, service, advance: ms => { time += ms; }, now: () => time };
}

test('final whistle keeps a one-minute correction window until official GW settlement', async () => {
  const h = harness();
  const live = await h.service.get();
  assert.equal(live.meta.refreshMode, 'match');
  h.source.fixtures[0].finished_provisional = true;
  h.advance(TTL_MS);
  const finalizing = await h.service.get();
  assert.equal(finalizing.meta.live, false);
  assert.equal(finalizing.meta.refreshMode, 'finalizing');
  assert.equal(finalizing.meta.refreshSeconds, FINALIZING_TTL_MS / 1000);
  h.source.live.elements[0].explain[0].stats.push({ identifier: 'bonus', value: 3, points: 3 });
  h.advance(FINALIZING_TTL_MS);
  const corrected = await h.service.get();
  assert.equal(corrected.events.at(-1).kind, 'bonus');
  assert.equal(corrected.events.at(-1).points, 3);
  assert.equal(corrected.events.at(-1).baseline, false);
  h.source.boot.events[0].finished = true;
  h.source.boot.events[0].data_checked = true;
  h.advance(FINALIZING_TTL_MS);
  const settled = await h.service.get();
  assert.equal(settled.meta.refreshMode, 'idle');
  assert.equal(settled.meta.refreshSeconds, IDLE_TTL_MS / 1000);
  const count = h.calls.length;
  h.advance(15 * 60_000);
  await h.service.get();
  assert.equal(h.calls.length, count);
});

test('settlement never delays the following kickoff, and active football wins over finalizing', () => {
  const events = [{ id: 4, finished: false, data_checked: false }, { id: 5, finished: false }];
  const fixtures = [{ event: 4, finished_provisional: true },
    { event: 5, started: false, kickoff_time: new Date(initialTime + 90_000).toISOString() }];
  const before = refreshPlan(fixtures, initialTime, events);
  assert.equal(before.refreshMode, 'finalizing');
  assert.equal(Date.parse(before.nextRefreshAt), initialTime + 30_000);
  assert.equal(refreshPlan(fixtures, initialTime + 30_000, events).refreshMode, 'match');
});

test('settled history does not inherit another GW ten-second cadence, including direct HTTP-style reads', async () => {
  const h = harness();
  h.source.boot.events.unshift({ id: 3, name: 'Gameweek 3', deadline_time: '2026-09-05T10:00:00Z', finished: true, data_checked: true });
  h.source.fixtures.unshift({ ...clone(h.source.fixtures[0]), id: 31, event: 3, finished: true, finished_provisional: true });
  await h.service.get();
  const history = await h.service.get(3);
  assert.equal(history.meta.refreshMode, 'history');
  assert.equal(history.meta.refreshSeconds, HISTORY_TTL_MS / 1000);
  const historyCalls = () => h.calls.filter(url => url.includes('/event/3/live/')).length;
  const calls = historyCalls();
  for (let i = 0; i < 5; i++) { h.advance(TTL_MS); await h.service.get(3); await h.service.get(); }
  assert.equal(historyCalls(), calls);
  h.advance(HISTORY_TTL_MS);
  await h.service.get(3);
  assert.equal(historyCalls(), calls + 1);
});

test('cold live failures back off without repeated upstream work and reset after recovery', async () => {
  const h = harness(); h.source.fail = url => url.endsWith('/live/');
  await assert.rejects(h.service.get(), /upstream unavailable/);
  const count = h.calls.length;
  assert.equal(h.service.peek(), null);
  assert.equal(Date.parse(h.service.getStatus().retryAt), h.now() + RETRY_BASE_MS);
  for (let i = 0; i < 4; i++) await assert.rejects(h.service.get(), error => error.statusCode === 503);
  assert.equal(h.calls.length, count);
  h.advance(RETRY_BASE_MS);
  await assert.rejects(h.service.get(), /upstream unavailable/);
  assert.equal(Date.parse(h.service.getStatus().retryAt), h.now() + RETRY_BASE_MS * 2);
  h.advance(RETRY_BASE_MS * 2);
  h.source.fail = null;
  const recovered = await h.service.get();
  assert.equal(recovered.meta.stale, false);
  assert.equal(h.service.getStatus().retryAt, null);
  h.advance(TTL_MS); h.source.fail = url => url.endsWith('/live/');
  const stale = await h.service.get();
  assert.equal(stale.meta.stale, true);
  assert.equal(stale.meta.refreshing, false);
  assert.equal(Date.parse(stale.meta.retryAt), h.now() + RETRY_BASE_MS);
});

test('bootstrap failures back off globally, use a bounded delay, and retain cached source time', async () => {
  const h = harness(); const first = await h.service.get();
  h.advance(TTL_MS); h.source.fail = () => true;
  const stale = await h.service.get();
  assert.equal(stale.meta.updated, first.meta.updated);
  assert.equal(stale.meta.checkedAt, first.meta.checkedAt);
  assert.deepEqual(stale.events, first.events);
  assert.equal(contentRevision(stale), contentRevision(first));
  for (let i = 0; i < 8; i++) {
    const status = h.service.getStatus();
    assert(Date.parse(status.retryAt) - h.now() <= RETRY_MAX_MS);
    const count = h.calls.length;
    await h.service.get();
    assert.equal(h.calls.length, count);
    h.advance(Date.parse(status.retryAt) - h.now());
    await h.service.get();
  }
});

test('peek and status are read-only snapshots and never renew freshness or make requests', async () => {
  const h = harness(); const original = await h.service.get(); const count = h.calls.length;
  const copy = h.service.peek();
  copy.fixtures[0].team_h_score = 99;
  copy.events[0].player.name = 'changed';
  assert.equal(h.service.peek().fixtures[0].team_h_score, 0);
  assert.equal(h.service.peek().events[0].player.name, 'Defender');
  assert.equal(h.service.getStatus().fresh, true);
  h.advance(TTL_MS);
  const pending = h.service.peek();
  assert.equal(pending.meta.stale, true);
  assert.equal(pending.meta.updated, original.meta.updated);
  assert.equal(pending.meta.checkedAt, original.meta.checkedAt);
  assert.equal(pending.meta.selectionPending, true);
  assert.equal(h.service.peek(4).meta.selectionPending, undefined);
  assert.equal(pending.meta.gwDeadline, h.source.boot.events[0].deadline_time);
  assert.equal(h.service.getStatus().fresh, false);
  assert.equal(h.calls.length, count);
  h.advance(6 * 60 * 60_000);
  assert.equal(h.service.peek(), null, 'old content is not an unlimited first-paint substitute');
});

test('SWR can show cached data immediately while a single shared background read completes', async () => {
  const h = harness(); const original = await h.service.get(); h.advance(TTL_MS);
  let release;
  h.source.wait = url => url.endsWith('/live/') ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
  const a = h.service.get(), b = h.service.get();
  await tick();
  assert.equal(h.service.peek().meta.refreshing, true);
  assert.equal(h.service.peek().meta.updated, original.meta.updated);
  assert.equal(h.service.getStatus().refreshing, true);
  const count = h.calls.filter(url => url.endsWith('/live/')).length;
  release();
  const [first, second] = await Promise.all([a, b]);
  assert.deepEqual(first, second);
  assert.equal(first.meta.refreshing, false);
  assert.equal(h.service.getStatus().refreshing, false);
  assert.equal(h.calls.filter(url => url.endsWith('/live/')).length, count);
});

function response() {
  const res = new EventEmitter(); res.chunks = []; res.writableLength = 0;
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers; };
  res.write = text => { res.chunks.push(text); return true; };
  res.end = () => { res.emit('close'); };
  res.destroy = () => { res.destroyed = true; res.emit('close'); };
  return res;
}

test('heartbeat is a tiny observable frame, never a renewed upstream observation', () => {
  let heartbeat, cleared = false;
  const hub = createUpdateHub({ now: () => initialTime,
    setIntervalFn(fn, ms) { assert.equal(ms, 20_000); heartbeat = fn; return 1; },
    clearIntervalFn() { cleared = true; } });
  const res = response();
  const feed = { meta: { updated: 'original', checkedAt: 'checked' }, fixtures: [] };
  hub.publish('discover:default', feed); hub.subscribe({}, res, 'discover:default', 'visitor');
  res.chunks = []; heartbeat();
  assert.deepEqual(frame(res.chunks, 'heartbeat'), [{ serverTime: new Date(initialTime).toISOString() }]);
  assert.equal(frame(res.chunks, 'update').length, 0);
  assert.equal(frame(res.chunks, 'checked').length, 0);
  res.end(); assert.equal(cleared, true);
});

test('schedule, retry, and collection metadata notify without pretending content changed', () => {
  const hub = createUpdateHub(); const res = response();
  const feed = { meta: { updated: 'source', checkedAt: 'first', nextRefreshAt: 'due' }, fixtures: [] };
  hub.publish('discover:default', feed); hub.subscribe({}, res, 'discover:default', 'visitor'); res.chunks = [];
  feed.meta.checkedAt = 'second'; feed.meta.nextRefreshAt = 'later'; feed.meta.refreshing = true;
  hub.publish('discover:default', feed);
  assert.equal(frame(res.chunks, 'update').length, 0);
  assert.equal(frame(res.chunks, 'checked').at(-1).checkedAt, 'second');
  assert.equal(frame(res.chunks, 'checked').at(-1).nextRefreshAt, 'later');
  res.chunks = []; feed.meta.retryAt = 'retry';
  hub.publish('discover:default', feed);
  assert.equal(frame(res.chunks, 'checked').at(-1).retryAt, 'retry');
  res.end();
});

test('collector failure marks the existing topic stale without replacing score revision or source time', () => {
  const hub = createUpdateHub(); const res = response();
  const feed = { meta: { updated: 'source', checkedAt: 'checked' }, detail: { points: 2 } };
  const revision = hub.publish('match:1:4:10:20', feed);
  hub.subscribe({}, res, 'match:1:4:10:20', 'visitor'); res.chunks = [];
  assert.equal(hub.markStale('match:1:4:10:20', { retryAt: 'retry' }), true);
  const message = frame(res.chunks, 'update')[0];
  assert.equal(message.revision, revision);
  assert.equal(message.updated, 'source');
  assert.equal(message.checkedAt, 'checked');
  assert.equal(message.stale, true);
  assert.equal(message.nextRefreshAt, 'retry');
  assert.equal(hub.markStale('missing'), false);
  res.end();
});

function publicRouteHelpers(service, clock = () => initialTime) {
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const start = source.indexOf('const matchWatchDue = new Map();');
  const end = source.indexOf('\nconst MIME =', start);
  assert(start > 0 && end > start, 'target the actual server helper implementation');
  class ClockDate extends Date { static now() { return clock(); } }
  const context = { matchCentreService: service, updates: createUpdateHub(), Date: ClockDate };
  vm.runInNewContext(source.slice(start, end), context);
  return context;
}

function historyPass(context) {
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const start = source.indexOf('for (const key of updates.activeKeys().filter(k => /^discover:\\d+$/.test(k)))');
  const end = source.indexOf('\n        })().finally', start);
  assert(start > 0 && end > start, 'execute the actual server historical scheduler loop');
  context.console = { warn() {} };
  vm.runInNewContext(`async function runHistoryPass() { ${source.slice(start, end)} }`, context);
  return () => context.runHistoryPass();
}

test('server match publication uses one canonical revision in either requested side order', () => {
  const routes = publicRouteHelpers({});
  const detail = { leagueId: 1, gw: 4, updated: new Date(initialTime).toISOString(), live: true,
    sides: [{ entryId: 20, score: 5 }, { entryId: 10, score: 3 }] };
  const first = routes.publishMatchDetail('match:1:4:10:20', detail);
  const second = routes.publishMatchDetail('match:1:4:10:20', { ...detail, sides: [...detail.sides].reverse() });
  assert.equal(first, second);
  assert.deepEqual(detail.sides.map(side => side.entryId), [20, 10], 'publication never reorders the response or cached detail');
});

test('public Discover SWR returns last-known data before one deduplicated collection completes', async () => {
  const cached = { meta: { gw: 4, updated: new Date(initialTime - 15_000).toISOString(), selectionPending: true },
    fixtures: [{ id: 41, team_h_score: 0 }], events: [] };
  let release, calls = 0;
  const routes = publicRouteHelpers({
    getStatus: () => ({ gw: 4, fresh: false, retryAt: null }),
    peek: () => clone(cached),
    get: () => { calls++; return new Promise(resolve => { release = resolve; }); },
  });
  const first = await routes.getPublicMatchCentre();
  const second = await routes.getPublicMatchCentre();
  assert.equal(calls, 1);
  assert.equal(first.meta.updated, cached.meta.updated);
  assert.equal(first.meta.selectionPending, true);
  assert.equal(first.meta.refreshing, true);
  assert.equal(first.meta.stale, true);
  assert.equal(first.meta.revision, second.meta.revision);
  const collected = routes.collectMatchCentre();
  release({ ...cached, meta: { gw: 4, updated: new Date(initialTime).toISOString(), stale: false } });
  assert.equal((await collected).meta.stale, false);
});

test('public Discover respects shared backoff instead of creating work for each visitor', async () => {
  let calls = 0;
  const retryAt = new Date(initialTime + 20_000).toISOString();
  const routes = publicRouteHelpers({
    getStatus: () => ({ gw: 4, fresh: false, retryAt }),
    peek: () => ({ meta: { gw: 4, updated: new Date(initialTime - 20_000).toISOString(), stale: true, retryAt }, fixtures: [], events: [] }),
    get: () => { calls++; throw new Error('must not request during retry window'); },
  });
  const result = await routes.getPublicMatchCentre();
  assert.equal(calls, 0);
  assert.equal(result.meta.stale, true);
  assert.equal(result.meta.retryAt, retryAt);
});

test('historical scheduler due ledger survives payload eviction and current-GW rollover', async () => {
  let now = initialTime;
  const collected = [];
  const feed = gw => ({ meta: { gw, updated: new Date(now).toISOString(), checkedAt: new Date(now).toISOString(),
    nextRefreshAt: new Date(now + HISTORY_TTL_MS).toISOString(), stale: false }, fixtures: [], events: [] });
  const routes = publicRouteHelpers({
    getStatus: gw => ({ gw: gw || 5, cached: false, fresh: false, refreshing: false, nextRefreshAt: new Date(now).toISOString() }),
    peek: () => null,
    get: async gw => { collected.push(gw); return feed(gw); },
  }, () => now);
  // GW4 was current when subscribed, and has now become the third history GW.
  for (const gw of [2, 3, 4]) routes.publishMatchCentre(feed(gw), gw);
  routes.updates.activeKeys = () => ['discover:2', 'discover:3', 'discover:4'];
  routes.status = { gw: 5 };
  const pass = historyPass(routes);
  await pass(); now += 2000; await pass();
  assert.deepEqual(collected, [], 'evicted payload is not treated as a never-collected topic');
  now = initialTime + HISTORY_TTL_MS; await pass();
  assert.deepEqual(collected, [2, 3, 4]);
  now += 2000; await pass();
  assert.deepEqual(collected, [2, 3, 4], 'subsequent scheduler ticks do not thrash the bounded cache');
});

test('historical scheduler retries an evicted failing topic at its retry time, not every tick or fifteen minutes', async () => {
  let now = initialTime, calls = 0, failed = true;
  const retryAt = () => new Date(initialTime + 20_000).toISOString();
  const routes = publicRouteHelpers({
    getStatus: gw => ({ gw: gw || 5, cached: false, fresh: false, refreshing: false,
      nextRefreshAt: new Date(now).toISOString(), retryAt: failed ? retryAt() : null }),
    peek: () => null,
    get: async gw => {
      calls++;
      if (failed) throw new Error('upstream unavailable');
      return { meta: { gw, updated: new Date(now).toISOString(), checkedAt: new Date(now).toISOString(),
        nextRefreshAt: new Date(now + HISTORY_TTL_MS).toISOString(), stale: false }, fixtures: [], events: [] };
    },
  }, () => now);
  routes.updates.activeKeys = () => ['discover:3']; routes.status = { gw: 5 };
  const pass = historyPass(routes);
  await pass(); assert.equal(calls, 1);
  now += 2000; await pass(); assert.equal(calls, 1);
  now = initialTime + 20_000; failed = false; await pass(); assert.equal(calls, 2);
  now += 2000; await pass(); assert.equal(calls, 2);
});
