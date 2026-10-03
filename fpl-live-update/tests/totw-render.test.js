'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

test('TOTW renders historical owner, explicit free and unknown without consulting current managers', () => {
  const nodes = new Map();
  const $ = id => { if (!nodes.has(id)) nodes.set(id, {classList:{toggle(){}}}); return nodes.get(id); };
  const players = [
    { id: 1, name: 'Past owner', pos: 'GKP', gwPoints: 5, owner: 11, ownerName: '<Past & A>', ownershipStatus: 'owned' },
    { id: 2, name: 'Past free', pos: 'DEF', gwPoints: 4, owner: null, ownershipStatus: 'free' },
    { id: 3, name: 'Incomplete', pos: 'MID', gwPoints: 3, owner: 99, ownershipStatus: 'unknown' },
  ];
  const context = { STATE: {snap: {meta: {},totwByGw: {2: {formation: '3-5-2', players}}}},
    $,
    TIMELINE: { reportGw: () => 3, live: () => false },
    esc: value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
    kitUrl: () => '', initialOf: () => 'P', perspectiveFieldHtml: () => '', bindKitFallbacks(){},
    ownerName(){ throw Error('must not read current ownership'); },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function renderDreamTeam'), source.indexOf('function perspectiveFieldHtml')), context);
  context.renderDreamTeam(2);
  const html = $('#dreamTeamPitch').innerHTML;
  assert.match(html, /&lt;Past &amp; A&gt;/);
  assert.match(html, /dt-owner free[^>]*title="自由球员"/);
  assert.match(html, /dt-owner " title="归属待确认"/);
  assert.doesNotMatch(html, /<Past & A>/);
  assert.match($('#dreamTeamNote').textContent, /历史归属尚未完整确认/);
});
