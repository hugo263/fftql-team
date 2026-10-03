'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/analytics.js'), 'utf8');

function harness(pathname = '/', search = '?league=47275', stored = null) {
  const listeners = new Map(), windowListeners = new Map(), sent = [], intervals = [];
  let clock = 1788610000000;
  let tab = 'weekly';
  const storage = new Map(stored ? [['fpl_analytics_session_v1', JSON.stringify(stored)]] : []);
  const tabs = { addEventListener: (name, callback) => listeners.set(`tabs:${name}`, callback) };
  const document = {
    visibilityState: 'visible', referrer: 'https://example.com/private?secret=hidden',
    addEventListener: (name, callback) => listeners.set(name, callback),
    querySelector: selector => pathname.startsWith('/discover') ? null
      : selector === '#tabs' ? tabs : { dataset: { tab } },
  };
  const context = vm.createContext({ document, location: { pathname, search },
    window: { innerWidth: 390, addEventListener: (name, callback) => windowListeners.set(name, callback) },
    Date: class extends Date { static now() { return clock; } }, URL, URLSearchParams, Blob,
    crypto: { randomUUID: () => '12345678-1234-1234-1234-123456789abc' },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    navigator: { sendBeacon: () => false },
    fetch: (url, options) => { sent.push({ url, ...JSON.parse(options.body) }); return Promise.resolve({ ok: true }); },
    setInterval: fn => intervals.push(fn),
  });
  vm.runInContext(source, context);
  return { sent, context, storage, run: () => vm.runInContext(source, context),
    ready: id => listeners.get('fpl:league-ready')?.({ detail: { leagueId: id } }),
    advance: ms => { clock += ms; }, tick: () => intervals.forEach(fn => fn()),
    visibility: state => { document.visibilityState = state; listeners.get('visibilitychange')?.(); },
    pagehide: () => windowListeners.get('pagehide')?.(),
    clickTab: name => { tab = name; listeners.get('tabs:click')?.({ target: { closest: () => ({ dataset: { tab: name } }) } }); },
  };
}

test('both pages share a single tracker; the workbench announces only a successfully rendered league', () => {
  const index = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const discover = fs.readFileSync(path.join(__dirname, '../public/discover.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  assert.match(index, /analytics\.js\?v=98/);
  assert.match(discover, /analytics\.js\?v=98/);
  assert.ok(index.indexOf('/analytics.js') < index.indexOf('/app.js'));
  assert.doesNotMatch(app, /function initAnalytics\(/);
  assert.match(app, /dispatchEvent\(new CustomEvent\('fpl:league-ready'/);
});

test('one pageview and one confirmed league use; refresh renders and repeated script inclusion do not inflate either', () => {
  const h = harness();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].type, 'pageview');
  h.ready(47275); h.ready(47275); h.ready(47275); h.run();
  assert.equal(h.sent.filter(e => e.type === 'pageview').length, 1);
  assert.equal(h.sent.filter(e => e.type === 'league_use').length, 1);
  h.clickTab('trades');
  assert.equal(h.sent.at(-1).type, 'tab_view');
  assert.equal(h.sent.at(-1).tab, 'trades');
  assert.equal(h.sent.at(-1).leagueId, 47275);
});

test('a URL, invalid ID or failed load alone cannot become a confirmed league use', () => {
  const h = harness();
  for (const id of [null, undefined, 0, -1, 2.5, 'garbage', '1e3', '12345678901']) h.ready(id);
  assert.equal(h.sent.filter(e => e.type === 'league_use').length, 0);
  assert.equal(h.sent[0].leagueId, 47275);
});

test('discover records a pageview without a tabs element, never a league-use event', () => {
  const h = harness('/discover', '');
  h.ready(47275); h.clickTab('ignored');
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].path, '/discover');
  assert.equal(h.sent[0].tab, 'discover');
  assert.equal(h.sent[0].leagueId, null);
});

test('unknown SPA fallback paths do not create traffic or league-adoption events', () => {
  const h = harness('/wp-json/probe');
  h.ready(47275); h.advance(30_000); h.tick();
  assert.equal(h.sent.length, 0);
});

test('hidden time is not counted and pagehide cannot duplicate a visibility flush', () => {
  const h = harness();
  h.advance(30_000); h.visibility('hidden'); h.pagehide();
  h.advance(300_000); h.tick();
  h.visibility('visible'); h.advance(10_000); h.tick();
  assert.deepEqual(h.sent.filter(e => e.type === 'engagement').map(e => e.duration), [30, 10]);
});

test('session key stays compatible and private referrer paths/query strings are never transmitted', () => {
  const h = harness('/', '?league=47275&private=secret', { id: 'existing-session-1234', last: 1788609999000 });
  assert.equal(h.sent[0].sid, 'existing-session-1234');
  assert.equal(h.sent[0].referrer, 'https://example.com');
  assert.equal(h.sent[0].path, '/');
  assert.equal(JSON.stringify(h.sent).includes('secret'), false);
});
