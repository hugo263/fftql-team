const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { windowsFromDraft, nextWindow, parts, cardHtml } = require('../public/trade-countdown');
const official = { data: [
  { id: 4, waivers_time: '2026-09-11T12:30:00Z', deadline_time: '2026-09-12T12:30:00Z', trades_time: '2026-09-10T12:30:00Z' },
  { id: 5, waivers_time: '2026-09-17T17:30:00Z', deadline_time: '2026-09-18T17:30:00Z' },
] };
const windows = windowsFromDraft(official);
test('uses Draft waiver/deadline fields, not manager trade deadline', () => {
  assert.deepEqual(windows[0], { gw: 4, opensAt: official.data[0].waivers_time, closesAt: official.data[0].deadline_time });
  assert.deepEqual(windowsFromDraft([]), []);
  assert.deepEqual(windowsFromDraft({ data: [{ id: 4, waivers_time: 'bad' }] }), [{ gw: 4, opensAt: null, closesAt: null }]);
});
test('before GW4 both timers target GW4', () => {
  for (const kind of ['open', 'close']) assert.equal(nextWindow(windows, kind, Date.parse('2026-09-08T00:00:00Z')).gw, 4);
});
test('opening boundary rolls only opening forward, closing stays GW4', () => {
  const t = Date.parse(windows[0].opensAt);
  assert.equal(nextWindow(windows, 'open', t - 1).gw, 4);
  assert.equal(nextWindow(windows, 'open', t).gw, 5);
  assert.equal(nextWindow(windows, 'close', t).gw, 4);
});
test('closing boundary rolls closing forward and never goes negative', () => {
  const t = Date.parse(windows[0].closesAt);
  assert.equal(nextWindow(windows, 'close', t - 1).gw, 4);
  assert.equal(nextWindow(windows, 'close', t).gw, 5);
  assert.deepEqual(parts(t, t + 1), [0, 0, 0, 0]);
  assert.deepEqual(parts(t, t - 90061000), [1, 1, 1, 1]);
});
test('future dates, not list order/current GW, control selection', () => {
  assert.equal(nextWindow([...windows].reverse(), 'open', Date.parse('2026-09-08T00:00:00Z')).gw, 4);
  const shifted = windows.map(w => w.gw === 4 ? { ...w, opensAt: '2026-09-13T00:00:00Z' } : w);
  assert.equal(nextWindow(shifted, 'open', Date.parse('2026-09-12T00:00:00Z')).gw, 4);
});
test('missing dates and season end show honest empty states', () => {
  assert.equal(nextWindow([], 'open').state, 'unavailable');
  assert.equal(nextWindow([{ gw: 4, opensAt: null }], 'open').state, 'unavailable');
  assert.equal(nextWindow(windows, 'open', Date.parse('2027-06-01T00:00:00Z')).state, 'complete');
  assert.match(cardHtml([], 'open'), /等待官方时间公布/);
  assert.doesNotMatch(cardHtml([], 'open'), /NaN|undefined/);
});
test('cards show Beijing absolute dates and independent labeled GW/timer', () => {
  const t = Date.parse('2026-09-11T12:30:00Z');
  assert.match(cardHtml(windows, 'open', t), /GW5/);
  const close = cardHtml(windows, 'close', t);
  assert.match(close, /GW4/);
  assert.match(close, /20:30/);
  assert.match(close, /北京时间/);
  assert.match(close, /role="timer" aria-live="off"/);
});
test('weekly integration removes KPIs and installs one visible-only timer', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const html = read('public/index.html'), app = read('public/app.js');
  assert.doesNotMatch(html, /id="kpiRow"/);
  assert.match(html, /id="tradeCountdowns"/);
  assert.match(html, /trade-countdown.js\?v=97/);
  assert.match(app, /clearTimeout\(tradeCountdownTimer\)/);
  assert.match(app, /document.hidden \|\| !\$\('#tab-weekly'\)\.classList.contains\('active'\)/);
  assert.match(read('public/trade-countdown.css'), /max-width:700px/);
});
