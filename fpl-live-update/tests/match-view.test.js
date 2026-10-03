'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const view = require('../public/match-view');

test('match UI distinguishes played zero, negative, unknown and 180 minute DGW', () => {
  assert.equal(view.number(0), '0');
  assert.equal(view.number(-2), '-2');
  assert.equal(view.number(null), '—');
  assert.equal(view.number(undefined), '—');
  assert.equal(view.playerState({ minutes: 90, points: 0, status: 'played' }).hasPlayed, true);
  assert.equal(view.playerState({ minutes: 180, status: 'played' }).minutes, '180′');
  assert.equal(view.playerState({ minutes: null, status: 'unknown' }).minutes, '分钟未知');
  assert.equal(view.playerState({ minutes: 0, status: 'waiting' }).label, '未登场');
  assert.equal(view.playerState({ minutes: 0, status: 'dnp' }).label, '未出场');
});

test('pending/waiting/dnp/blank zero points display a dash, while actual zero and disciplinary deductions display scores', () => {
  for (const status of ['pending', 'waiting', 'dnp', 'blank', 'unknown']) {
    const state = view.playerState({ minutes: 0, points: 0, status });
    assert.equal(state.score, '—', status);
    assert.equal(state.hasPlayed, false);
    assert.equal(state.hasScore, false);
    assert.match(view.playerHtml({ name: status, minutes: 0, points: 0, status }), /<b>—<\/b>/);
  }
  for (const player of [
    { minutes: 90, points: 0, status: 'played' },
    { minutes: 0, points: -1, yellowCards: 1, status: 'waiting' },
    { minutes: 0, points: -3, redCards: 1, status: 'dnp' },
    { minutes: 120, points: -2, status: 'played' },
  ]) {
    const state = view.playerState(player);
    assert.equal(state.hasScore, true);
    assert.equal(state.score, String(player.points));
  }
  assert.equal(view.playerState({ minutes: 90, points: null, status: 'played' }).score, '—');
});

test('playing status highlights actual score while final and DGW-between-games retain honest labels', () => {
  const playing = { name: 'Active', points: 3, minutes: 45, status: 'playing', fixtures: [{ started: true, finished: false }] };
  assert.equal(view.playerState(playing).label, '赛中');
  assert.match(view.playerHtml(playing), /md-state-playing md-played/);
  const final = { ...playing, status: 'played', fixtures: [{ started: true, finished: true }] };
  assert.equal(view.playerState(final).label, '已完赛');
  const dgw = { ...final, fixtures: [...final.fixtures, { started: false, finished: false }] };
  assert.equal(view.playerState(dgw).label, '已出战');
  assert.equal(view.playerState(dgw).score, '3');
  assert.ok(!view.playerHtml(dgw).includes('md-state-playing'));
});

test('match UI uses identical same-origin FPL goalkeeper shirts and escaped names', () => {
  assert.equal(view.kit({ teamCode: 14, pos: 'GKP' }), '/api/kit/14-gk.png');
  assert.equal(view.kit({ teamCode: 14, pos: 'DEF' }), '/api/kit/14.png');
  assert.equal(view.kit({ teamCode: '../x', pos: 'GKP' }), '');
  const html = view.playerHtml({ name: '<img onerror=x>', team: 'ARS', points: -1, minutes: 90, status: 'played', fixtures: [] });
  assert.ok(html.includes('&lt;img onerror=x&gt;'));
  assert.ok(html.includes('<b>-1</b>'));
  assert.ok(!html.includes('<img onerror=x>'));
  assert.ok(!view.playerHtml({ name: 'Missing', points: null }).includes('<b>0</b>'));
});

test('pitch places keeper first, separates effective XI from bench, keeps unknown position visible', () => {
  const html = view.sideHtml({ entryName: 'Team', players: [
    { name: 'Bench keeper', position: 1, pos: 'GKP', countsForTeam: false },
    { name: 'Forward', position: 2, pos: 'FWD', countsForTeam: true },
    { name: 'Active keeper', position: 12, pos: 'GKP', countsForTeam: true },
    { name: 'Unknown position', position: 10, pos: '', countsForTeam: true },
  ] }, '<span>FIELD</span>');
  assert.ok(html.indexOf('Active keeper') < html.indexOf('Forward'));
  assert.ok(html.indexOf('Unknown position') < html.indexOf('md-bench-heading'));
  assert.ok(html.indexOf('Bench keeper') > html.indexOf('md-bench-heading'));
  assert.ok(html.includes('不计入总分'));
});

test('responses cannot substitute another gameweek, league or reversed pair', () => {
  const selection = { leagueId: 47275, gw: 3, entries: [10, 20] };
  const detail = { leagueId: 47275, gw: 3, sides: [{ entryId: 10, players: [{}] }, { entryId: 20, players: [{}] }] };
  assert.equal(view.validDetail(detail, selection), true);
  assert.equal(view.validDetail({ ...detail, gw: 2 }, selection), false);
  assert.equal(view.validDetail({ ...detail, leagueId: 9 }, selection), false);
  assert.equal(view.validDetail({ ...detail, sides: detail.sides.slice().reverse() }, selection), false);
  assert.equal(view.validDetail({ ...detail, sides: [] }, selection), false);
});

// A small DOM contract harness exercises lifecycle and caching without a browser
// or network. It does not infer visual correctness from strings or DOM stubs.
function browserHarness() {
  let clock = Date.parse('2026-09-05T12:00:00Z');
  let timerId = 0;
  const timers = new Map();
  const calls = [];
  const elements = new Map();
  const cards = new Map();
  const listeners = new Map();
  class Element {
    constructor() {
      this.listeners = new Map(); this.classNames = new Set(); this.attributes = new Map();
      this.innerHTML = ''; this.textContent = ''; this.hidden = false; this.disabled = false;
      this.classList = {
        add: name => this.classNames.add(name), remove: name => this.classNames.delete(name),
        toggle: (name, value) => value ? this.classNames.add(name) : this.classNames.delete(name),
      };
    }
    addEventListener(name, fn) { this.listeners.set(name, fn); }
    emit(name, event = {}) { return this.listeners.get(name)?.(event); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    removeAttribute(name) { this.attributes.delete(name); }
    querySelector() { return this.span ||= new Element(); }
    querySelectorAll() { return []; }
    showModal() { this.open = true; }
    close() { this.open = false; this.emit('close'); }
    focus() { this.focused = true; }
    closest() { return this; }
  }
  for (const id of ['matchDetailDialog', 'matchDetailBody', 'matchDetailTitle', 'matchDetailMeta', 'matchDetailNotice', 'matchDetailRetry', 'matchDetailShare', 'matchShareFeedback', 'matchShareImage', 'lastGwMatchList', 'matchDetailClose']) elements.set(`#${id}`, new Element());
  const document = {
    hidden: false, body: new Element(),
    querySelector: selector => elements.get(selector) || cards.get(selector),
    addEventListener: (name, fn) => listeners.set(name, fn),
  };
  class ClockDate extends Date { static now() { return clock; } }
  const context = {
    document, navigator: {}, Date: ClockDate, AbortController,
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, at: clock + ms, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    URL: { revokeObjectURL() {} },
    fetch: (url) => new Promise(resolve => calls.push({ url, resolve })),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/match-view.js'), 'utf8'), context);
  context.FPLMatchView.init({ getSnapshot: () => ({ meta: { leagueId: 47275, leagueName: 'Cache League' } }), fieldHtml: () => '<span>FIELD</span>' });
  const byId = id => elements.get(`#${id}`);
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  const card = (gw = 3, entries = [10, 20]) => {
    const selector = `[data-match-gw="${gw}"][data-match-left="${entries[0]}"][data-match-right="${entries[1]}"]`;
    if (!cards.has(selector)) {
      const element = new Element();
      element.dataset = { matchGw: String(gw), matchLeft: String(entries[0]), matchRight: String(entries[1]) };
      cards.set(selector, element);
    }
    return cards.get(selector);
  };
  const detail = (gw = 3, extra = {}) => ({ autoSubsVersion: 1, leagueId: 47275, leagueName: 'Cache League', gw, updated: new Date(clock).toISOString(), live: gw === 3, finished: gw < 3,
    sides: [10, 20].map(entryId => ({ entryId, entryName: `GW${gw} team ${entryId}`, playerName: 'Manager', score: gw, startingCount: 1, playedCount: 1, remainingCount: 0, benchPoints: 0,
      players: [{ id: entryId, name: `GW${gw} player ${entryId}`, position: 1, pos: 'GKP', countsForTeam: true, minutes: 90, points: 0, status: 'played', fixtures: [{ finished: true }] }] })), ...extra });
  return {
    calls, timers, document, navigator: context.navigator, byId, card, detail, flush,
    hydrate: snapshot => context.FPLMatchView.hydrate(snapshot),
    snapshot: (details, extra = {}) => ({ meta: { leagueId: 47275, leagueName: 'Cache League', reportGw: 3 }, managers: [{ entryId: 10 }, { entryId: 20 }],
      reportGwMatches: [{ entry1Id: 10, entry2Id: 20 }], matchDetails: details, ...extra }),
    click: (gw = 3, entries) => byId('lastGwMatchList').emit('click', { target: card(gw, entries) }),
    close: () => byId('matchDetailDialog').close(),
    advance: ms => { clock += ms; },
    visibility: () => listeners.get('visibilitychange')?.(),
    reply: async (index, result, ok = true) => { calls[index].resolve({ ok, status: ok ? 200 : 502, json: async () => result }); await flush(); },
    fireTimer: async ms => { const found = [...timers].find(([, timer]) => timer.ms === ms); assert.ok(found, `timer ${ms}`); timers.delete(found[0]); found[1].fn(); await flush(); },
  };
}

test('front-end reopen reuses a fresh matchup, expiry shows timestamped cache immediately and fetches once', async () => {
  const h = browserHarness();
  h.click();
  assert.equal(h.calls.length, 1);
  await h.reply(0, h.detail());
  assert.match(h.byId('matchDetailBody').innerHTML, /GW3 player 10/);
  h.close();
  assert.equal(h.card().focused, true);
  h.advance(59000);
  h.click();
  assert.equal(h.calls.length, 1);
  assert.equal(h.byId('matchDetailShare').disabled, false);
  h.close();
  h.advance(1000);
  h.click();
  assert.equal(h.calls.length, 2);
  assert.match(h.byId('matchDetailBody').innerHTML, /GW3 player 10/);
  assert.match(h.byId('matchDetailNotice').textContent, /上次快照/);
  await h.reply(1, h.detail());
  assert.ok(!h.byId('matchDetailNotice').classNames.has('md-warning'));
});

test('close/reopen while fetching merges requests and a completed older GW cannot overwrite the active GW', async () => {
  const h = browserHarness();
  h.click(); h.close(); h.click();
  assert.equal(h.calls.length, 1, 'reopening same in-flight matchup does not duplicate request');
  h.click(2);
  assert.equal(h.calls.length, 2);
  await h.reply(1, h.detail(2));
  assert.match(h.byId('matchDetailTitle').textContent, /GW2/);
  await h.reply(0, h.detail(3));
  assert.match(h.byId('matchDetailBody').innerHTML, /GW2 player 10/);
  assert.ok(!h.byId('matchDetailBody').innerHTML.includes('GW3 player'));
  h.click(3);
  assert.equal(h.calls.length, 2, 'finished background response is reusable only under its own GW cache key');
  assert.match(h.byId('matchDetailTitle').textContent, /GW3/);
});

test('open match fallback independently refreshes at sixty seconds and retains scores on failure', async () => {
  const h = browserHarness();
  h.click();
  const original = h.detail();
  await h.reply(0, original);
  h.advance(60000);
  await h.fireTimer(60000);
  assert.equal(h.calls.length, 2);
  await h.reply(1, { error: 'Upstream unavailable' }, false);
  assert.match(h.byId('matchDetailBody').innerHTML, /GW3 player 10/);
  assert.match(h.byId('matchDetailNotice').textContent, /保留/);
  assert.equal(h.byId('matchDetailRetry').hidden, false);
  h.click(2);
  await h.reply(2, { error: 'History unavailable' }, false);
  assert.match(h.byId('matchDetailBody').innerHTML, /暂时无法读取/);
  assert.ok(!h.byId('matchDetailBody').innerHTML.includes('GW3 player'));
  assert.equal(h.byId('matchDetailShare').disabled, true);
});

test('pointer intent warms only the targeted match and obeys data-saving preference', async () => {
  const h = browserHarness();
  h.byId('lastGwMatchList').emit('pointerover', { pointerType: 'mouse', target: h.card() });
  assert.equal(h.calls.length, 0);
  await h.fireTimer(140);
  assert.equal(h.calls.length, 1);
  h.click();
  assert.equal(h.calls.length, 1);
  await h.reply(0, h.detail());
  assert.match(h.byId('matchDetailBody').innerHTML, /GW3 player 10/);
  h.close();
  h.navigator.connection = { saveData: true };
  h.byId('lastGwMatchList').emit('pointerover', { pointerType: 'mouse', target: h.card(2) });
  assert.ok(![...h.timers.values()].some(timer => timer.ms === 140), 'data-saving preference suppresses prefetch');
  h.navigator.connection.saveData = false;
  h.document.hidden = true;
  h.byId('lastGwMatchList').emit('pointerover', { pointerType: 'mouse', target: h.card(2) });
  assert.ok(![...h.timers.values()].some(timer => timer.ms === 140), 'hidden page cannot initiate another prefetch');
});

test('hydrated snapshot opens instantly in either side order and does not renew the original source age', async () => {
  const h = browserHarness();
  const detail = h.detail();
  const snapshot = h.snapshot([detail]);
  assert.equal(h.hydrate(snapshot), 1);
  h.click();
  assert.equal(h.calls.length, 0);
  assert.match(h.byId('matchDetailBody').innerHTML, /GW3 player 10/);
  assert.equal(h.byId('matchDetailShare').disabled, false);
  h.close();
  h.advance(59000);
  h.hydrate(snapshot);
  h.click(3, [20, 10]);
  assert.equal(h.calls.length, 0);
  const html = h.byId('matchDetailBody').innerHTML;
  assert.ok(html.indexOf('GW3 team 20') < html.indexOf('GW3 team 10'));
  h.close();
  h.advance(1000);
  h.click();
  assert.equal(h.calls.length, 1, 're-hydration at 59 seconds does not reset the scoring TTL');
  assert.match(h.byId('matchDetailNotice').textContent, /上次快照/);
  await h.reply(0, h.detail());
});

test('new snapshot synchronizes an already-open matchup and keeps scroll position without another fetch', () => {
  const h = browserHarness();
  h.hydrate(h.snapshot([h.detail()]));
  h.click();
  h.byId('matchDetailBody').scrollTop = 240;
  h.advance(1000);
  const next = h.detail();
  next.sides[0].entryName = 'Newer scored XI';
  next.sides[0].score = 77;
  h.hydrate(h.snapshot([next]));
  assert.equal(h.calls.length, 0);
  assert.match(h.byId('matchDetailBody').innerHTML, /Newer scored XI/);
  assert.match(h.byId('matchDetailBody').innerHTML, /<strong>77<\/strong>/);
  assert.equal(h.byId('matchDetailBody').scrollTop, 240);
});

test('slow old API response cannot overwrite a newer snapshot already displayed or its cached copy', async () => {
  const h = browserHarness();
  h.click();
  const old = h.detail();
  h.advance(1000);
  const newer = h.detail();
  newer.sides[0].entryName = 'Snapshot winner';
  h.hydrate(h.snapshot([newer]));
  assert.match(h.byId('matchDetailBody').innerHTML, /Snapshot winner/);
  await h.reply(0, old);
  assert.match(h.byId('matchDetailBody').innerHTML, /Snapshot winner/);
  h.close(); h.click();
  assert.equal(h.calls.length, 1);
  assert.match(h.byId('matchDetailBody').innerHTML, /Snapshot winner/);
});

test('hydration rejects mismatched league, GW, membership, opponent, version and future timestamps', () => {
  const cases = [
    snapshot => { snapshot.meta.leagueId = 12; },
    snapshot => { snapshot.meta.reportGw = 4; },
    snapshot => { snapshot.managers.pop(); },
    snapshot => { snapshot.reportGwMatches = [{ entry1Id: 10, entry2Id: 30 }]; },
    snapshot => { snapshot.matchDetails[0].autoSubsVersion = 0; },
    snapshot => { snapshot.matchDetails[0].updated = '2099-01-01T00:00:00Z'; },
    snapshot => { snapshot.matchDetails[0].sides[0].players = []; },
  ];
  for (const mutate of cases) {
    const h = browserHarness();
    const snapshot = h.snapshot([h.detail()]);
    mutate(snapshot);
    assert.equal(h.hydrate(snapshot), 0);
    h.click();
    assert.equal(h.calls.length, 1, 'bad prepared data must fall back, never fabricate or switch lineups');
    assert.match(h.byId('matchDetailBody').innerHTML, /正在同步/);
  }
});

test('historical selection remains untouched when the current snapshot hydrates', async () => {
  const h = browserHarness();
  h.click(2);
  await h.reply(0, h.detail(2));
  h.hydrate(h.snapshot([h.detail(3)]));
  assert.match(h.byId('matchDetailTitle').textContent, /GW2/);
  assert.match(h.byId('matchDetailBody').innerHTML, /GW2 player 10/);
  assert.equal(h.calls.length, 1);
  h.close(); h.click(3);
  assert.match(h.byId('matchDetailTitle').textContent, /GW3/);
  assert.equal(h.calls.length, 1);
});

test('stale snapshot is displayed with warning and triggers background fallback rather than becoming fresh', async () => {
  const h = browserHarness();
  const snapshot = h.snapshot([h.detail()]);
  snapshot.meta.stale = true;
  h.hydrate(snapshot);
  h.click();
  assert.equal(h.calls.length, 1);
  assert.match(h.byId('matchDetailBody').innerHTML, /GW3 player 10/);
  assert.ok(h.byId('matchDetailNotice').classNames.has('md-warning'));
  await h.reply(0, { error: 'Official unavailable' }, false);
  assert.match(h.byId('matchDetailNotice').textContent, /保留/);
});

test('projected/official badges are distinct, pending substitute stays dash and escaped counterpart text is safe', () => {
  const side = { entryName: 'Subs', provisional: true, score: 4, players: [
    { id: 1, name: '<Out>', pos: 'GKP', position: 12, countsForTeam: false, minutes: 0, points: 0, status: 'dnp' },
    { id: 12, name: 'Bench Keeper', pos: 'GKP', position: 1, countsForTeam: true, minutes: 0, points: 0, status: 'pending' },
    { id: 2, name: 'Defender Out', pos: 'DEF', position: 13, countsForTeam: false, minutes: 0, points: 0, status: 'dnp' },
    { id: 13, name: 'Defender In', pos: 'DEF', position: 2, countsForTeam: true, minutes: 90, points: 4, status: 'played' },
  ], substitutions: [{ element_out: 1, element_in: 12, source: 'projected', pending: true }, { element_out: 2, element_in: 13, source: 'official', pending: false }] };
  assert.equal(view.substitutionFor(side, side.players[0]).badge, '预↓');
  assert.equal(view.substitutionFor(side, side.players[1]).badge, '预↑');
  assert.equal(view.substitutionFor(side, side.players[2]).badge, '替↓');
  assert.equal(view.substitutionFor(side, side.players[3]).badge, '替↑');
  const pending = view.playerHtml(side.players[1], view.substitutionFor(side, side.players[1]));
  assert.match(pending, /<b>—<\/b>/);
  assert.match(pending, /预判 · 待上场/);
  assert.match(pending, /&lt;Out&gt;/);
  assert.ok(!pending.includes('<Out>'));
  const html = view.sideHtml(side, '<span>FIELD</span>');
  assert.match(html, /暂计得分/);
  assert.match(html, /规则预判 1 组 · 1 人待上场/);
  assert.match(html, /官方自动替补 1 组/);
});
