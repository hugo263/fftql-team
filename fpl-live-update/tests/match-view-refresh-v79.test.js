'use strict';

// Lifecycle contract tests only; these do not substitute for browser/visual QA.
// Authored, not executed, pending the user's explicit testing authorization.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { detailSignature } = require('../public/match-view');

function harness({ push = true, actualStream = false } = {}) {
  let now = Date.parse('2026-09-14T12:00:00Z'), timerId = 0;
  const timers = new Map(), nodes = new Map(), requests = [], streams = [], sources = [];
  const documentEvents = new Map(), windowEvents = new Map();
  const addListener = (events, type, callback) => {
    if (!events.has(type)) events.set(type, new Set());
    events.get(type).add(callback);
  };
  const removeListener = (events, type, callback) => events.get(type)?.delete(callback);
  const dispatch = (events, type, event = {}) => {
    for (const callback of [...events.get(type) || []]) callback(event);
  };
  class Node {
    constructor() {
      this.events = new Map(); this.classes = new Set(); this.attributes = new Map();
      this.content = ''; this.writes = 0; this.scrollTop = 0;
      this.classList = { add: key => this.classes.add(key), remove: key => this.classes.delete(key),
        toggle: (key, on) => on ? this.classes.add(key) : this.classes.delete(key) };
    }
    set innerHTML(value) { this.content = value; this.writes++; }
    get innerHTML() { return this.content; }
    addEventListener(type, callback) { this.events.set(type, callback); }
    emit(type, data = {}) { return this.events.get(type)?.(data); }
    setAttribute(key, value) { this.attributes.set(key, value); }
    removeAttribute(key) { this.attributes.delete(key); }
    querySelector() { return this.child ||= new Node(); }
    querySelectorAll() { return []; }
    showModal() { this.open = true; }
    close() { this.open = false; this.emit('close'); }
    focus() {}
    closest() { return this; }
  }
  const node = id => { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); };
  const document = { hidden: false, body: new Node(), querySelector: key => node(key),
    addEventListener: (type, callback) => addListener(documentEvents, type, callback),
    removeEventListener: (type, callback) => removeListener(documentEvents, type, callback) };
  class ClockDate extends Date { static now() { return now; } }
  const context = { document, navigator: { onLine: true }, Date: ClockDate, AbortController,
    URL: { revokeObjectURL() {} },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: url => new Promise(resolve => requests.push({ url, resolve })),
    addEventListener: (type, callback) => addListener(windowEvents, type, callback),
    removeEventListener: (type, callback) => removeListener(windowEvents, type, callback),
  };
  context.window = context;
  if (push) context.TQLUpdates = { connect(options) {
    const stream = { options, isHealthy: true, closed: false, acknowledgements: [], catchUps: 0,
      healthy() { return this.isHealthy && !this.closed; },
      close() { this.closed = true; },
      acknowledge(state) { this.acknowledgements.push(state); },
      catchUp() { this.catchUps++; },
    };
    streams.push(stream);
    options.onStatus({ status: 'connecting' });
    return stream;
  } };
  if (actualStream) {
    context.EventSource = class {
      constructor(url) { this.url = url; this.events = new Map(); sources.push(this); }
      addEventListener(type, callback) { this.events.set(type, callback); }
      close() { this.closed = true; }
      send(type, value) { this.events.get(type)?.({ data: JSON.stringify(value) }); }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/update-stream.js'), 'utf8'), context);
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/match-view.js'), 'utf8'), context);
  const snapshot = { meta: { leagueId: 47275, leagueName: 'League', reportGw: 4 } };
  context.FPLMatchView.init({ getSnapshot: () => snapshot, fieldHtml: () => '' });
  const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
  const makeDetail = (revision = 'a', extras = {}) => ({ leagueId: 47275, leagueName: 'League', gw: 4,
    updated: new Date(now).toISOString(), live: true, finished: false, finalizing: false,
    meta: { revision },
    sides: [10, 20].map(entryId => ({ entryId, entryName: `Manager ${entryId}`, playerName: 'Manager', score: 2,
      startingCount: 1, playedCount: 1, remainingCount: 1, benchPoints: 0, formation: '4-4-2',
      players: [{ id: entryId, name: `Player ${entryId}`, points: 2, minutes: 20, pos: 'GKP', position: 1,
        countsForTeam: true, status: 'playing', team: 'ARS', fixtures: [{ started: true, finished: false }] }] })), ...extras });
  const click = (gw = 4, ids = [10, 20]) => {
    const card = new Node(); card.dataset = { matchGw: String(gw), matchLeft: String(ids[0]), matchRight: String(ids[1]) };
    node('#lastGwMatchList').emit('click', { target: card });
  };
  return { node, document, context, requests, streams, sources, timers, flush, makeDetail, click,
    advance: ms => { now += ms; },
    now: () => now,
    close: () => node('#matchDetailDialog').close(),
    doc: type => dispatch(documentEvents, type),
    win: (type, event = {}) => dispatch(windowEvents, type, event),
    reply: async (index, detail, ok = true) => {
      requests[index].resolve({ ok, status: ok ? 200 : 502, json: async () => detail }); await flush();
    },
    fire: async delay => {
      const entry = [...timers].find(([, timer]) => timer.delay === delay);
      assert(entry, `scheduled delay ${delay}`); timers.delete(entry[0]); entry[1].callback(); await flush();
    },
  };
}

test('detail fingerprint ignores transport clocks but retains score, substitutions and match status', () => {
  const source = { updated: 'a', meta: { revision: 'a' }, stale: false, live: true,
    sides: [{ score: 3, players: [{ points: 3, minutes: 45 }], substitutions: [] }] };
  const refreshed = structuredClone(source);
  refreshed.updated = 'b'; refreshed.meta.revision = 'b'; refreshed.stale = true; refreshed.refreshError = 'slow';
  assert.equal(detailSignature(source), detailSignature(refreshed));
  for (const change of [d => d.sides[0].score++, d => d.sides[0].players[0].points++,
    d => d.sides[0].substitutions.push({ element_in: 1 }), d => d.live = false]) {
    const changed = structuredClone(source); change(changed);
    assert.notEqual(detailSignature(source), detailSignature(changed));
  }
});

test('open real match subscribes separately and changed revision bypasses a fresh local cache', async () => {
  const h = harness(); h.click(); await h.reply(0, h.makeDetail());
  assert.equal(h.streams.length, 1);
  const stream = h.streams[0];
  assert.equal(stream.options.url, '/api/updates?channel=match&league=47275&gw=4&entry1=10&entry2=20');
  assert.equal(stream.options.initialRevision, 'a');
  const update = stream.options.onUpdate({ revision: 'b', stale: false });
  assert.equal(h.requests.length, 2, 'push cannot be acknowledged with old locally-fresh scores');
  const next = h.makeDetail('b'); next.sides[0].score = 9;
  await h.reply(1, next);
  const acknowledged = await update;
  assert.equal(acknowledged.revision, 'b');
  assert.equal(acknowledged.updated, next.updated);
  assert.equal(acknowledged.checkedAt, next.updated);
  assert.equal(stream.acknowledgements.length, 0, 'notification read waits for shared stream version validation');
  assert.match(h.node('#matchDetailBody').innerHTML, /<strong>9<\/strong>/);
  h.close(); assert.equal(stream.closed, true);
});

test('a returned newer cache revision includes real clocks instead of masquerading as the notified revision', async () => {
  const h = harness(); h.click(); await h.reply(0, h.makeDetail());
  const notifiedAt = new Date(h.now()).toISOString();
  const pending = h.streams[0].options.onUpdate({ revision: 'b', updated: notifiedAt, stale: false });
  h.advance(1500);
  const actual = h.makeDetail('c');
  actual.meta.checkedAt = new Date(h.now() + 250).toISOString();
  await h.reply(1, actual);
  const state = await pending;
  assert.equal(state.revision, 'c');
  assert.equal(state.updated, actual.updated);
  assert.equal(state.checkedAt, actual.meta.checkedAt);
  assert(Date.parse(state.checkedAt) > Date.parse(notifiedAt));
  assert.equal(h.streams[0].acknowledgements.length, 0);
  h.close();
});

test('missing HTTP revision is not acknowledged using the push identity', async () => {
  const h = harness(); h.click(); await h.reply(0, h.makeDetail());
  const pending = h.streams[0].options.onUpdate({ revision: 'b', stale: false });
  const unversioned = h.makeDetail(); delete unversioned.meta;
  await h.reply(1, unversioned);
  assert.equal(await pending, false);
  h.close();
});

test('real shared transport accepts a newer HTTP revision and does not retry already delivered match data', async () => {
  const h = harness({ actualStream: true }); h.click(); await h.reply(0, h.makeDetail());
  h.advance(1000);
  const notified = { revision: 'b', updated: new Date(h.now()).toISOString(), stale: false };
  h.sources[0].send('update', notified);
  assert.equal(h.requests.length, 2);
  h.advance(1000);
  const actual = h.makeDetail('c'); actual.sides[0].score = 8;
  await h.reply(1, actual);
  assert(![...h.timers.values()].some(timer => timer.delay === 2000));
  const calls = h.requests.length;
  h.sources[0].send('checked', { revision: 'c', updated: actual.updated, stale: false });
  await h.flush();
  assert.equal(h.requests.length, calls);
  assert.match(h.node('#matchDetailBody').innerHTML, /<strong>8<\/strong>/);
  h.close();
});

test('real shared transport retries when HTTP trails the notified match revision', async () => {
  const h = harness({ actualStream: true }); h.click();
  const original = h.makeDetail(); await h.reply(0, original);
  h.advance(1000);
  h.sources[0].send('update', { revision: 'b', updated: new Date(h.now()).toISOString(), stale: false });
  await h.reply(1, original);
  assert([...h.timers.values()].some(timer => timer.delay === 2000));
  h.advance(2000); await h.fire(2000);
  assert.equal(h.requests.length, 3);
  const corrected = h.makeDetail('b'); corrected.sides[0].score = 7;
  await h.reply(2, corrected);
  assert(![...h.timers.values()].some(timer => timer.delay === 2000));
  assert.match(h.node('#matchDetailBody').innerHTML, /<strong>7<\/strong>/);
  h.close();
});

test('checked unchanged data updates source time without rebuilding pitches or moving scroll', async () => {
  const h = harness(); h.click(); await h.reply(0, h.makeDetail());
  const body = h.node('#matchDetailBody'); const writes = body.writes; body.scrollTop = 190;
  h.advance(60_000);
  h.streams[0].options.onChecked({ revision: 'a', updated: new Date(h.now()).toISOString(), stale: false });
  assert.equal(body.writes, writes);
  assert.equal(body.scrollTop, 190);
  assert.equal(h.requests.length, 1);
  h.close();
});

test('same-content response after reconnect retains player DOM; actual score change redraws once', async () => {
  const h = harness(); h.click(); await h.reply(0, h.makeDetail());
  const body = h.node('#matchDetailBody'), writes = body.writes;
  h.advance(1000);
  const pending = h.streams[0].options.onUpdate({ revision: 'b', stale: false });
  await h.reply(1, h.makeDetail('b'));
  await pending;
  assert.equal(body.writes, writes);
  h.close();
});

test('healthy push suppresses timed fetches, stalled push falls back to the scoring cache cadence', async () => {
  const h = harness(); h.click(); await h.reply(0, h.makeDetail());
  h.advance(60_000); await h.fire(20_000);
  assert.equal(h.requests.length, 1);
  h.streams[0].isHealthy = false; h.streams[0].options.onStatus({ status: 'polling' });
  h.advance(1000); await h.fire(1000);
  assert.equal(h.requests.length, 2);
  await h.reply(1, h.makeDetail('b'));
  h.close();
});

test('no SSE support still refreshes the open matchup after sixty seconds', async () => {
  const h = harness({ push: false }); h.click(); await h.reply(0, h.makeDetail());
  h.advance(60_000); await h.fire(60_000);
  assert.equal(h.requests.length, 2);
  await h.reply(1, h.makeDetail('b'));
  h.close();
});

test('hidden/offline/pagehide releases subscriptions and resume catches up without rebuilding league', async () => {
  const h = harness(); h.click(); await h.reply(0, h.makeDetail());
  h.document.hidden = true; h.doc('visibilitychange');
  assert.equal(h.streams[0].closed, true);
  h.advance(60_000); h.document.hidden = false; h.doc('visibilitychange');
  assert.equal(h.streams.length, 2); assert.equal(h.requests.length, 2);
  await h.reply(1, h.makeDetail('b'));
  h.context.navigator.onLine = false; h.win('offline'); assert.equal(h.streams[1].closed, true);
  h.context.navigator.onLine = true; h.win('online'); assert.equal(h.streams.length, 3);
  h.win('pagehide'); assert.equal(h.streams[2].closed, true);
  h.win('pageshow', { persisted: true }); assert.equal(h.streams.length, 4);
  assert(h.requests.every(request => /\/match\//.test(request.url)));
  h.close();
});

test('finalizing keeps subscription, official settled result releases it and still permits sharing', async () => {
  const h = harness(); h.click(); await h.reply(0, h.makeDetail('a', { live: false, finished: true, finalizing: true }));
  assert.equal(h.streams.length, 1);
  const pending = h.streams[0].options.onUpdate({ revision: 'b', stale: false });
  await h.reply(1, h.makeDetail('b', { live: false, finished: true, finalizing: false }));
  await pending;
  assert.equal(h.streams[0].closed, true);
  assert.equal(h.node('#matchDetailShare').disabled, false);
  assert.equal(h.timers.size, 0);
  h.close();
});

test('failed push read leaves original pitch in place and returns false instead of acknowledging', async () => {
  const h = harness(); h.click(); await h.reply(0, h.makeDetail());
  const original = h.node('#matchDetailBody').innerHTML;
  const pending = h.streams[0].options.onUpdate({ revision: 'b', stale: false });
  await h.reply(1, { error: 'Official scores unavailable' }, false);
  assert.equal(await pending, false);
  assert.equal(h.node('#matchDetailBody').innerHTML, original);
  assert.equal(h.node('#matchDetailRetry').hidden, false);
  const calls = h.requests.length;
  assert.equal(await h.streams[0].options.onUpdate({ revision: 'b', stale: false }), false);
  assert.equal(h.requests.length, calls, 'bounded retry does not hammer the upstream');
  h.close();
});
