'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const view = require('../public/match-view');

function snapshot() {
  return {meta:{leagueId:1, reportGw:3, updated:'2026-09-07T00:00:00Z'},
    leagueSchedule:[{gw:4, entry1Id:11, entry2Id:22}],
    managers:[11,22].map(entryId => ({entryId, entryName:`Team ${entryId}`, picks:
      Array.from({length:15}, (_,i) => ({position:i+1, player:{id:entryId*100+i, name:`P${i}`, pos:i===0||i===11?'GKP':i<5?'DEF':i<10?'MID':'FWD', lastGwPoints:9, points:9, minutes:90}}))}))};
}
test('future preview uses current players but never carries prior GW scores or appearances', () => {
  const s = snapshot(), selection = {leagueId:1, gw:4, entries:[22,11]};
  const d = view.previewDetail(s, selection);
  assert.equal(d.preview, true); assert.equal(d.live, false);
  assert.deepEqual(d.sides.map(s=>s.entryId), [22,11]);
  for (const side of d.sides) {
    assert.equal(side.score, null); assert.equal(side.players.length,15);
    assert.equal(side.players.filter(p=>p.countsForTeam).length,11);
    assert.ok(side.players.every(p=>p.points===null && p.minutes===0 && p.status==='pending'));
    assert.match(view.sideHtml(side,''), /非该轮锁定阵容/);
    assert.doesNotMatch(view.sideHtml(side,''), /当轮得分|已出战/);
  }
  assert.equal(s.managers[0].picks[0].player.points,9, 'never mutate source data');
  for (const changes of [{gw:3},{entries:[11,33]},{leagueId:2},{gw:39}]) assert.equal(view.previewDetail(s,{...selection,...changes}),null);
  s.managers[0].picks=[]; assert.equal(view.previewDetail(s,selection),null);
});
test('clipboard writing starts synchronously with a promised PNG to preserve the click gesture', async () => {
  let release, written;
  const png = new Promise(resolve=>{release=resolve;});
  class Item { constructor(data) {this.data=data;} }
  const copying = view.copyImage(png, {write(items) {written=items;return items[0].data['image/png'].then(()=>{});}}, Item);
  assert.equal(written[0].data['image/png'],png);
  release({type:'image/png'}); await copying;
});
test('missing or denied clipboard support rejects rather than claiming copy success', async () => {
  const blob = Promise.resolve({type:'image/png'});
  await assert.rejects(view.copyImage(blob,null,null), /不支持/);
  await assert.rejects(view.copyImage(blob,{write(){return Promise.reject(Error('denied'));}},class{}),/denied/);
});
