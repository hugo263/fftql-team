'use strict';

// Author-only coverage for v79. These tests use a virtual browser clock and no
// network. Do not execute until the user authorizes testing/release.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const CLIENT = fs.readFileSync(path.join(ROOT, 'public/update-stream.js'), 'utf8');
const BASE = Date.parse('2026-09-14T12:00:00Z');
const flush = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));
const state = (revision, offset = 0, extra = {}) => ({ revision, stale: false,
  updated: new Date(BASE + offset).toISOString(), ...extra });

function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
      if (!listeners.get(type)?.size) listeners.delete(type);
    },
    emit(type, event = {}) { for (const listener of [...(listeners.get(type) || [])]) listener(event); },
  };
}

function harness({ onUpdate = value => value, online = true, hidden = false, sourceSupported = true } = {}) {
  let time = BASE, nextId = 0;
  const timers = new Map(), streams = [], reads = [], checks = [], statuses = [];
  const document = Object.assign(eventTarget(), { hidden });
  const window = Object.assign(eventTarget(), { navigator: { onLine: online } });
  class ClockDate extends Date { static now() { return time; } }
  class Source {
    constructor(url) { this.url = url; this.events = new Map(); this.closed = false; streams.push(this); }
    addEventListener(type, listener) {
      if (!this.events.has(type)) this.events.set(type, []);
      this.events.get(type).push(listener);
    }
    close() { this.closed = true; }
    open() { this.onopen?.(); }
    fail() { this.onerror?.({}); }
    send(type, value) { for (const listener of this.events.get(type) || []) listener({ data: JSON.stringify(value) }); }
    raw(type, data) { for (const listener of this.events.get(type) || []) listener({ data }); }
  }
  if (sourceSupported) window.EventSource = Source;
  const deterministicMath = Object.create(Math); deterministicMath.random = () => 0;
  vm.runInNewContext(CLIENT, {
    window, document, Date: ClockDate, Math: deterministicMath,
    setTimeout(callback, delay = 0) { const id = ++nextId; timers.set(id, { callback, at: time + Number(delay) }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const client = window.TQLUpdates.connect({ url: '/api/updates?league=47275', initialRevision: 'a',
    onUpdate(value) { reads.push(plain(value)); return onUpdate(value, reads.length); },
    onChecked(value) { checks.push(plain(value)); }, onStatus(value) { statuses.push(value.status); },
  });
  async function advance(ms) {
    const target = time + ms;
    let steps = 0;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      if (++steps > 10_000) throw Error('Virtual clock found an unbounded timer loop');
      const [id, timer] = next; timers.delete(id); time = timer.at;
      timer.callback(); await flush();
    }
    time = target; await flush();
  }
  return { client, window, document, streams, reads, checks, statuses, timers, advance,
    offline() { window.navigator.onLine = false; window.emit('offline'); },
    online() { window.navigator.onLine = true; window.emit('online'); },
    hide() { document.hidden = true; document.emit('visibilitychange'); },
    show() { document.hidden = false; document.emit('visibilitychange'); },
    now: () => time,
  };
}

test('offline closes the stream, cancels delivery retries and catches up once when connectivity returns', async () => {
  const h = harness(); h.streams[0].open();
  assert.equal(h.client.healthy(), true);
  h.offline();
  assert.equal(h.streams[0].closed, true);
  assert.equal(h.client.healthy(), false);
  assert.equal(h.statuses.at(-1), 'offline');
  await h.advance(120_000);
  assert.equal(h.streams.length, 1); assert.equal(h.reads.length, 0);
  h.online(); await flush();
  assert.equal(h.streams.length, 2); assert.equal(h.reads.length, 1);
  assert.equal(h.reads[0].resume, true);
  h.streams[1].open(); h.streams[1].send('checked', state('a'));
  await flush(); assert.equal(h.reads.length, 1);
  h.client.close();
});

test('an initially hidden or offline page performs no connection or fetch until it can be viewed online', async () => {
  for (const mode of ['hidden', 'offline']) {
    const h = harness({ hidden: mode === 'hidden', online: mode !== 'offline' });
    assert.equal(h.streams.length, 0); assert.equal(h.reads.length, 0);
    await h.advance(120_000);
    if (mode === 'hidden') h.show(); else h.online();
    await flush(); assert.equal(h.streams.length, 1); assert.equal(h.reads.length, 1);
    h.client.close();
  }
});

test('pagehide suspends even when document.hidden is false; BFCache pageshow reconnects and reads once', async () => {
  const h = harness(); h.streams[0].open();
  h.window.emit('pagehide', { persisted: true });
  assert.equal(h.document.hidden, false); assert.equal(h.streams[0].closed, true);
  await h.advance(120_000); assert.equal(h.streams.length, 1); assert.equal(h.reads.length, 0);
  h.window.emit('pageshow', { persisted: true }); await flush();
  assert.equal(h.streams.length, 2); assert.equal(h.reads.length, 1);
  h.client.close();
});

test('a connection with no frames is unhealthy at 55 seconds and the watchdog replaces it', async () => {
  const h = harness(); h.streams[0].open();
  await h.advance(54_999); assert.equal(h.client.healthy(), true);
  await h.advance(1); assert.equal(h.client.healthy(), false);
  // The watchdog samples at twenty-second intervals, not every millisecond.
  await h.advance(5000); assert.equal(h.streams[0].closed, true);
  assert.equal(h.statuses.at(-1), 'reconnecting');
  await h.advance(1000); assert.equal(h.streams.length, 2);
  h.client.close();
});

test('named heartbeats preserve transport health without refreshing data or forging source timestamps', async () => {
  const h = harness(); h.streams[0].open();
  for (let index = 0; index < 5; index++) {
    await h.advance(20_000);
    h.streams[0].send('heartbeat', { serverTime: new Date(h.now()).toISOString() });
    assert.equal(h.client.healthy(), true);
  }
  assert.equal(h.streams.length, 1); assert.equal(h.reads.length, 0); assert.equal(h.checks.length, 0);
  h.client.close();
});

test('a burst of notifications coalesces to the latest revision and never overlaps data reads', async () => {
  const finishes = [];
  const h = harness({ onUpdate: () => new Promise(resolve => finishes.push(resolve)) });
  h.streams[0].send('update', state('b', 1000));
  h.streams[0].send('update', state('c', 2000));
  h.streams[0].send('update', state('d', 3000));
  assert.equal(h.reads.length, 1); assert.equal(h.reads[0].revision, 'b');
  finishes.shift()(state('b', 1000)); await flush();
  await h.advance(2000);
  assert.equal(h.reads.length, 2); assert.equal(h.reads[1].revision, 'd');
  finishes.shift()(state('d', 3000)); await flush();
  h.streams[0].send('checked', state('d', 3000)); await flush();
  assert.equal(h.reads.length, 2); assert.equal(h.checks.length, 1);
  h.client.close();
});

test('a lagging cached response does not acknowledge a newer notification; it retries that revision', async () => {
  const h = harness({ onUpdate: (_value, attempt) => attempt === 1 ? state('a', 1000) : state('b', 2000) });
  h.streams[0].send('update', state('b', 2000)); await flush();
  assert.equal(h.reads.length, 1);
  await h.advance(2000);
  assert.equal(h.reads.length, 2); assert.equal(h.reads[1].revision, 'b');
  h.streams[0].send('checked', state('b', 2000)); await flush();
  assert.equal(h.reads.length, 2);
  h.client.close();
});

test('a different response revision without a provably newer source timestamp cannot consume pending work', async () => {
  const h = harness({ onUpdate: (_value, attempt) => attempt === 1
    ? { revision: 'other', stale: false } : state('b', 2000) });
  h.streams[0].send('update', state('b', 2000)); await flush();
  await h.advance(2000); assert.equal(h.reads.length, 2);
  h.client.close();
});

test('a genuinely newer response may satisfy an older notification without a redundant request', async () => {
  const h = harness({ onUpdate: () => state('c', 3000) });
  h.streams[0].send('update', state('b', 2000)); await flush();
  await h.advance(2000); assert.equal(h.reads.length, 1);
  h.streams[0].send('checked', state('c', 3000)); await flush();
  assert.equal(h.reads.length, 1); assert.equal(h.checks.length, 1);
  h.client.close();
});

test('deferred and rejected reads stay pending, while hiding cancels their timer until resumption', async () => {
  const h = harness({ onUpdate: (value, attempt) => attempt === 1 ? false
    : attempt === 2 ? Promise.reject(Error('fetch failed')) : value });
  h.streams[0].send('update', state('b', 1000)); await flush();
  await h.advance(2000); assert.equal(h.reads.length, 2);
  h.hide(); await h.advance(60_000); assert.equal(h.reads.length, 2);
  h.show(); await flush(); assert.equal(h.reads.length, 3);
  assert.equal(h.reads[2].revision, 'b');
  h.client.close();
});

test('stop cancels reconnects, retry timers and all lifecycle listeners, including after a late promise settles', async () => {
  let finish;
  const h = harness({ onUpdate: () => new Promise(resolve => { finish = resolve; }) });
  h.streams[0].send('update', state('b', 1000));
  h.streams[0].fail();
  h.client.close();
  finish(false); await flush();
  h.window.emit('online'); h.window.emit('pageshow', { persisted: true }); h.document.emit('visibilitychange');
  await h.advance(120_000);
  assert.equal(h.streams.length, 1); assert.equal(h.reads.length, 1);
  assert.equal(h.timers.size, 0); assert.equal(h.window.listeners.size, 0); assert.equal(h.document.listeners.size, 0);
  assert.equal(h.client.healthy(), false);
});

test('stop also cancels an already scheduled failed-delivery retry', async () => {
  const h = harness({ onUpdate: () => false });
  h.streams[0].send('update', state('b', 1000)); await flush();
  assert.ok(h.timers.size > 0);
  h.client.close(); await h.advance(60_000);
  assert.equal(h.reads.length, 1); assert.equal(h.timers.size, 0);
});

test('frames from a replaced stream, invalid JSON and missing revisions cannot trigger data reads', async () => {
  const h = harness(); const old = h.streams[0];
  old.raw('update', '{broken'); old.send('update', { updated: 'missing revision' });
  assert.equal(h.reads.length, 0);
  old.fail(); await h.advance(1000); assert.equal(h.streams.length, 2);
  old.send('update', state('late', 1000)); old.open();
  assert.equal(h.reads.length, 0); assert.equal(h.client.healthy(), false);
  h.streams[1].open(); assert.equal(h.client.healthy(), true);
  h.client.close();
});

test('unsupported EventSource explicitly requests polling mode and retains manual catch-up behavior', async () => {
  const h = harness({ sourceSupported: false });
  assert.equal(h.statuses.at(-1), 'polling'); assert.equal(h.client.healthy(), false);
  h.client.catchUp(); await flush(); assert.equal(h.reads.length, 1);
  h.client.close();
});

test('first-paint data requests are bounded and do not wait for the league snapshot or component waterfall', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const firstStyle = html.indexOf('<link rel="stylesheet"');
  const early = html.slice(0, firstStyle);
  assert.match(early, /__fplInitialSnapshot\s*=\s*fetch[\s\S]*?AbortSignal\.timeout\(45_?000\)/);
  assert.match(early, /__fplInitialMatchCentre\s*=\s*fetch[\s\S]*?AbortSignal\.timeout\(30_?000\)/);
  assert.doesNotMatch(early, /await\s+(?:window\.)?__fplInitialSnapshot/);
  assert.match(early, /catch\(error\s*=>\s*\(\{\s*error\s*\}\)\)/);
  const home = fs.readFileSync(path.join(ROOT, 'public/home-tab.js'), 'utf8');
  const modules = home.indexOf('const modules = Promise.all');
  const template = home.indexOf("fetch('/discover.html");
  const ready = home.indexOf('await modules');
  const mounted = home.indexOf('window.TQLMatchCentre.mount(root)');
  assert.ok(modules >= 0 && modules < template && template < ready && ready < mounted);
  assert.match(home, /Promise\.all\(\[script\('\/match-centre-share\.js\?v=\d+'\),\s*script\('\/live-render\.js\?v=79'\)\]\)/);
  assert.match(home, /\.then\(\(\)\s*=>\s*script\('\/match-centre\.js\?v=105'\)\)/);
  assert.match(home, /AbortSignal\.timeout\(20_?000\)/);
  const scriptLoader = home.slice(home.indexOf('function script('), home.indexOf('async function mount('));
  assert.match(scriptLoader, /setTimeout\(/, 'A stalled component script needs its own timeout, not only the template timeout');
  assert.match(scriptLoader, /clearTimeout\(/);
  assert.match(scriptLoader, /scripts\.delete\(src\)/);
  assert.match(scriptLoader, /node\.remove\(\)/);
});
