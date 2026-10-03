'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const context = vm.createContext({ esc: s => String(s).replaceAll('<','&lt;').replaceAll('>','&gt;') });
vm.runInContext(app.slice(app.indexOf('function matchCardHtml('), app.indexOf('function renderDreamTeam(')), context);
const draw = (a,b,finished=true,live=false) => context.matchCardHtml({gw:3,entry1:'A',entry2:'B',entry1Id:11,entry2Id:22,entry1Points:a,entry2Points:b},finished,live);
test('winning side and score are highlighted consistently for left and right wins', () => {
  assert.match(draw(34,42),/B 获胜/);
  assert.match(draw(34,42),/is-winner">42/);
  assert.match(draw(45,43),/A 获胜/);
  assert.match(draw(45,43),/is-winner">45/);
  assert.equal((draw(45,43).match(/match-result-badge/g)||[]).length,1);
});
test('ties retain accessible outcome; incomplete and live games never claim a winner', () => {
  assert.match(draw(0,0),/平局/);
  assert.doesNotMatch(draw(32,32),/is-winner|match-result-badge/);
  assert.doesNotMatch(draw(null,4),/获胜|平局|is-winner/);
  assert.match(draw(null,4),/—/);
  assert.doesNotMatch(draw(5,9,false,true),/获胜|match-result-badge|is-winner/);
  assert.match(draw(-1,0),/B 获胜/);
});
test('wins and draws use the same two score cells without colon or draw footer', () => {
  for (const html of [draw(34,42), draw(45,43), draw(32,32), draw(0,0), draw(5,9,false,true)]) {
    assert.equal((html.match(/class="match-score-number /g) || []).length, 2);
    assert.doesNotMatch(html, /match-score-divider|match-draw-label|>平局<|>:</);
  }
});
