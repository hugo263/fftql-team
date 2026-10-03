'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const timeline = require('../public/timeline');
const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

// Execute the actual render functions without starting the app or a network call.
const functionSource = (start, end) => app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)));
const context = vm.createContext({
  TIMELINE: timeline,
  esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  fmt1: (n) => n == null ? '—' : Number(n).toFixed(1),
  fmtM: (n) => n == null ? '—' : `£${Number(n).toFixed(1)}M`,
  kitUrl: (p) => p.teamCode ? `/api/kit/${p.teamCode}${p.pos === 'GKP' ? '-gk' : ''}.png` : '',
  initialOf: (s) => (s || '?')[0],
  perspectiveFieldHtml: () => '<div class="fpl-perspective-field"></div>',
  squadSummaryHtml: () => '<div class="compare-summary">Compare forecast</div>',
});
vm.runInContext([
  functionSource('function managerSquadHtml(', 'function renderSquadModal('),
  functionSource('function comparePlayerCard(', 'let cmpRadar = null;'),
].join('\n'), context);
const meta = { reportGw: 3, currentGw: 3, lastFinishedGw: 2, reportLive: true, upcomingGw: 3 };
const positions = ['GKP', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'MID', 'FWD', 'GKP', 'DEF', 'FWD', 'FWD'];
const manager = () => ({
  rank: 2, squadValue: 85.5, formAvg: 47, projected: 123.4,
  picks: positions.map((pos, index) => ({
    position: index + 1,
    player: { id: index + 1, name: `Player-${index + 1}`, pos, team: 'LIV', teamName: 'Liverpool', teamCode: 14,
      status: 'a', liveGwPoints: index === 1 ? 0 : index === 2 ? -1 : 8, lastGwPoints: 17, totalPoints: 32, epNext: 999 },
  })),
});

test('standings detail renders all 15 players in a keeper-first pitch and separate bench', () => {
  const html = context.managerSquadHtml(manager(), meta);
  assert.equal((html.match(/class="cmp-kit-img"/g) || []).length, 15);
  const pitch = html.split('<div class="cmp-bench-area">')[0];
  assert.equal((pitch.match(/class="cmp-kit-img"/g) || []).length, 11);
  assert.ok(pitch.indexOf('cmp-pitch-gkp') < pitch.indexOf('cmp-pitch-def'));
  assert.ok(pitch.indexOf('cmp-pitch-def') < pitch.indexOf('cmp-pitch-mid'));
  assert.ok(pitch.indexOf('cmp-pitch-mid') < pitch.indexOf('cmp-pitch-fwd'));
  assert.match(html, /\/api\/kit\/14-gk\.png/);
  assert.match(html, /替补席 · 4 人/);
  assert.match(html, /阵型 4-5-1/);
});

test('detail has no EP or prediction, explicitly explains current ownership and actual point scope', () => {
  const html = context.managerSquadHtml(manager(), meta);
  assert.doesNotMatch(html, /\bEP\b|epNext|预计|Compare forecast|999/);
  assert.match(html, /当前持有阵容/);
  assert.match(html, /截止前调整官方暂不公开/);
  assert.match(html, /GW3 实际得分与赛季总分/);
  assert.match(html, /官方 DEFCON 与奖励分/);
  assert.match(html, /GW3 <b>8<\/b>/);
  assert.doesNotMatch(html, /<b>17<\/b>/);
});

test('actual zero and negative points remain distinct from missing data', () => {
  const m = manager();
  m.picks[3].player.liveGwPoints = null;
  m.picks[3].player.totalPoints = null;
  const html = context.managerSquadHtml(m, meta);
  assert.match(html, /GW3 <b>0<\/b>/);
  assert.match(html, /GW3 <b>-1<\/b>/);
  assert.match(html, /GW3 <b>—<\/b>/);
  assert.match(html, /总分 <b>—<\/b>/);
});

test('compare view remains last-finished-GW based with its existing summary', () => {
  const html = context.squadPitchSideHtml(manager());
  assert.match(html, /Compare forecast/);
  assert.match(html, /上轮 <b>17<\/b>/);
  assert.doesNotMatch(html, /当前持有阵容|GW3 <b>/);
});

test('manager names are escaped and unavailable squads have a clear empty state', () => {
  const m = manager();
  m.picks[0].player.name = '<img onerror=bad>';
  assert.match(context.managerSquadHtml(m, meta), /&lt;img onerror=bad&gt;/);
  const empty = context.managerSquadHtml({ picks: [], rank: null }, meta);
  assert.match(empty, /暂无可用阵容/);
  assert.doesNotMatch(empty, /cmp-kit-img/);
});
