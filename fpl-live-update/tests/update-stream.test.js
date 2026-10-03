'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createUpdateHub, contentRevision, workspaceFresh, WORKSPACE_INTERVAL } = require('../update-stream');
const now = Date.parse('2026-09-13T10:00:00Z');
const snapshot = () => ({ meta: { snapshotSchema: 7, leagueId: 47275, updated: new Date(now).toISOString(),
  reportLive: true, buildMs: 100, reportSourceExpiresAt: new Date(now + 60000).toISOString() },
  events: [], tradeWindows: [], players: [{ id: 1, points: 2 }] });
const flush = () => new Promise(resolve => setImmediate(resolve));

test('content revision ignores collection clocks, not scores, ownership, events or match status', () => {
  const a = snapshot(), b = structuredClone(a);
  b.meta.updated = 'later'; b.meta.buildMs = 300; b.meta.reportSourceExpiresAt = 'later';
  b.meta.revision = 'old'; b.meta.stale = true;
  b.meta.checkedAt = 'later'; b.meta.nextRefreshAt = 'later'; b.meta.retryAt = 'later';
  b.meta.refreshing = true; b.meta.retryAfterSeconds = 20;
  assert.equal(contentRevision(a), contentRevision(b));
  for (const change of [s => s.players[0].points++, s => s.players[0].owner = 42,
    s => s.meta.reportLive = false, s => s.events.push({ observedAt: 'now', kind: 'goal' })]) {
    const next = structuredClone(a); change(next); assert.notEqual(contentRevision(a), contentRevision(next));
  }
});

test('workspace is fifteen minutes even during live play; original source expiry is not forged', () => {
  const s = snapshot();
  assert(workspaceFresh(s, 7, now + 60001));
  assert(workspaceFresh(s, 7, now + WORKSPACE_INTERVAL - 1));
  assert(!workspaceFresh(s, 7, now + WORKSPACE_INTERVAL));
  assert(!workspaceFresh(s, 6, now));
  assert(!workspaceFresh(s, 7, now - 1));
  assert(!workspaceFresh(s, 7, now + 2, now + 1));
  s.meta.stale = true; assert(!workspaceFresh(s, 7, now));
});

for (const type of ['deadline', 'opensAt', 'closesAt']) test(`workspace wakes at ${type}, including next GW`, () => {
  const s = snapshot(), at = now + 300000;
  if (type === 'deadline') s.events.push({ id: 5, deadline: new Date(at).toISOString() });
  else s.tradeWindows.push({ gw: 5, [type]: new Date(at).toISOString() });
  assert(workspaceFresh(s, 7, at - 1)); assert(!workspaceFresh(s, 7, at));
  s.meta.updated = new Date(at).toISOString(); assert(workspaceFresh(s, 7, at));
});

function response() {
  const res = new EventEmitter(); res.chunks = []; res.writableLength = 0;
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers; };
  res.write = text => { res.chunks.push(text); return true; };
  res.end = () => { res.ended = true; res.emit('close'); };
  res.destroy = () => { res.destroyed = true; res.emit('close'); };
  return res;
}
test('SSE sends updates only on content/stale changes, check timestamps separately, and isolates leagues', () => {
  const hub = createUpdateHub(), a = response(), b = response();
  const s = snapshot(); hub.publish('league:1', s);
  hub.subscribe({}, a, 'league:1', 'a'); hub.subscribe({}, b, 'league:2', 'b');
  assert.equal(a.headers['X-Accel-Buffering'], 'no'); assert.match(a.chunks.join(''), /event: update/);
  a.chunks = []; b.chunks = [];
  hub.publish('league:1', s); assert.equal(a.chunks.length, 0);
  s.meta.updated = new Date(now + 1000).toISOString(); hub.publish('league:1', s);
  assert.match(a.chunks.join(''), /event: checked/); assert.doesNotMatch(a.chunks.join(''), /event: update/);
  a.chunks = []; s.players[0].points = 9; hub.publish('league:1', s);
  assert.match(a.chunks.join(''), /event: update/); assert.equal(b.chunks.length, 0);
  a.chunks = []; s.meta.stale = true; hub.publish('league:1', s);
  assert.match(a.chunks.join(''), /"stale":true/);
  a.end(); b.end(); assert.deepEqual(hub.activeKeys(), []);
});
test('SSE reconnect receives latest state and enforces connection / topic bounds', () => {
  const hub = createUpdateHub({ maxClients: 2, maxPerIp: 1, maxTopics: 2 });
  const a = response(), b = response(), c = response();
  hub.subscribe({}, a, 'league:1', 'a'); hub.subscribe({}, b, 'league:2', 'a');
  assert.equal(b.status, 429);
  hub.subscribe({}, c, 'league:2', 'b'); assert.equal(c.status, 200);
  const extra = response(); hub.subscribe({}, extra, 'league:3', 'c'); assert.equal(extra.status, 429);
  hub.publish('league:1', snapshot()); a.end();
  const reopened = response(); hub.subscribe({}, reopened, 'league:1', 'a');
  assert.match(reopened.chunks.join(''), /event: update/);
  reopened.writableLength = 100000; const s = snapshot(); s.players[0].points++;
  hub.publish('league:1', s); assert(reopened.destroyed);
  c.end();
});

test('SSE heartbeats are named observable frames, leave source clocks unchanged and clean up on close', () => {
  const intervals = new Map(); let intervalId = 0, noDelay = 0;
  const hub = createUpdateHub({ now: () => now + 20_000,
    setIntervalFn(fn, ms) { const id = ++intervalId; intervals.set(id, { fn, ms }); return id; },
    clearIntervalFn(id) { intervals.delete(id); } });
  const res = response(); res.socket = { setNoDelay: value => { assert.equal(value, true); noDelay++; } };
  const original = snapshot(), before = JSON.stringify(original);
  hub.publish('league:1', original); hub.subscribe({}, res, 'league:1', 'a');
  assert.equal(noDelay, 1); assert.equal(intervals.size, 1);
  const timer = [...intervals.values()][0]; assert.equal(timer.ms, 20_000);
  res.chunks = []; timer.fn();
  const frame = res.chunks.join('');
  assert.match(frame, /event: heartbeat\n/);
  assert.match(frame, /"serverTime":"2026-09-13T10:00:20.000Z"/);
  assert.doesNotMatch(frame, /"updated"|"revision"|event: (?:update|checked)/);
  assert.equal(JSON.stringify(original), before);
  res.end(); assert.equal(intervals.size, 0); assert.deepEqual(hub.activeKeys(), []);
});

function clientHarness(onUpdate = () => true) {
  const streams = [], timers = [], checked = [], calls = [], listeners = new Map(), windowListeners = new Map();
  class Source {
    constructor(url) { this.url = url; this.events = new Map(); streams.push(this); }
    addEventListener(type, fn) { this.events.set(type, fn); }
    close() { this.closed = true; }
    send(type, value) { this.events.get(type)({ data: JSON.stringify(value) }); }
  }
  const document = { hidden: false, addEventListener: (k, fn) => listeners.set(k, fn),
    removeEventListener: k => listeners.delete(k) };
  const window = { EventSource: Source, navigator: { onLine: true },
    addEventListener: (k, fn) => windowListeners.set(k, fn), removeEventListener: k => windowListeners.delete(k) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/update-stream.js'), 'utf8'), {
    window, document, EventSource: Source,
    setTimeout(fn, ms) { timers.push({ fn, ms, active: true }); return timers.length; },
    clearTimeout(id) { if (timers[id - 1]) timers[id - 1].active = false; },
  });
  const client = window.TQLUpdates.connect({ url: '/api/updates?league=1', initialRevision: 'a',
    onUpdate: state => { calls.push(state); return onUpdate(state); }, onChecked: s => checked.push(s) });
  return { client, streams, timers, checked, calls, document, listeners, windowListeners,
    runRetry() {
      const timer = timers.find(timer => timer.active && timer.ms === 2000);
      assert.ok(timer, 'A deferred delivery must schedule a retry, independent of heartbeat timers');
      timer.active = false; timer.fn();
    } };
}
test('browser deduplicates notifications, closes while hidden, resumes and catches up', async () => {
  const h = clientHarness(); h.streams[0].onopen(); assert(h.client.healthy());
  h.streams[0].send('update', { revision: 'a', stale: false }); assert.equal(h.calls.length, 0);
  h.streams[0].send('update', { revision: 'b', stale: false }); await flush();
  h.streams[0].send('update', { revision: 'b', stale: false }); await flush(); assert.equal(h.calls.length, 1);
  h.document.hidden = true; h.listeners.get('visibilitychange')(); assert(h.streams[0].closed);
  h.document.hidden = false; h.listeners.get('visibilitychange')(); assert.equal(h.streams.length, 2);
  await flush();
  assert.equal(h.calls.length, 2); assert.equal(h.calls[1].resume, true);
  assert.equal(h.calls[1].revision, 'b');
  h.streams[1].send('checked', { revision: 'b', stale: false }); await flush();
  assert.equal(h.calls.length, 2);
  h.streams[1].send('update', { revision: 'c', stale: false }); await flush(); assert.equal(h.calls.length, 3);
  h.client.close(); assert.equal(h.listeners.size, 0); assert.equal(h.windowListeners.size, 0);
});
test('deferred or failed cache reads retry newest revision without overlapping requests', async () => {
  let finish; const h = clientHarness(() => new Promise(resolve => { finish = resolve; }));
  h.streams[0].send('update', { revision: 'b', stale: false });
  h.streams[0].send('update', { revision: 'c', stale: false }); assert.equal(h.calls.length, 1);
  finish(false); await flush(); h.runRetry(); assert.equal(h.calls.at(-1).revision, 'c');
  finish(true); await flush(); h.streams[0].send('checked', { revision: 'c', stale: false });
  assert.equal(h.calls.length, 2); h.client.close();
});
test('server routes and shipped pages use one shared push client without touching admin', () => {
  const root = path.join(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(server, /pathname === '\/api\/updates'/);
  assert.match(server, /sec-fetch-site.*cross-site/);
  assert.match(server, /due\.slice\(i, i \+ 2\)/);
  for (const page of ['index.html', 'discover.html']) {
    const html = fs.readFileSync(path.join(root, 'public', page), 'utf8');
    assert.equal((html.match(/src="\/update-stream.js\?v=79"/g) || []).length, 1);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'public/admin.html'), 'utf8'), /update-stream/);
});
