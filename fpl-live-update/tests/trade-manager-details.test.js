'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {buildTradeReturns} = require('../trade-returns');
const ui = require('../public/trade-manager-details');
const managers = [{entryId:11,entryName:'Manager A'},{entryId:22,entryName:'Manager B'}];
const tx = (id, gw, incoming, outgoing, extra = {}) => ({id,gw,kind:'w',result:'a',entryId:11,manager:'Manager A',
  elementsIn:incoming,elementsOut:outgoing,playersIn:incoming.map(id=>({id,name:`P${id}`})),playersOut:outgoing.map(id=>({id,name:`P${id}`})),...extra});
function build(transactions, scoringGw=2) {
  return buildTradeReturns({transactions,reportGw:3,scoringGw,managers,livePointsByGw:new Map([
    [1,new Map([[1,1],[2,9],[3,4],[4,0]])],
    [2,new Map([[1,2],[2,6],[3,-1],[4,0]])],
    [3,new Map([[1,999],[2,999],[3,999],[4,999]])],
  ])});
}
const snap = tradeReturns => ({meta:{updated:'2026-09-15T00:00:00Z'},tradeReturns});
test('multi-player trade details have opposite participants and actual effective-GW raw scores',()=>{
  const deal=tx('t1',2,[2,3],[1,4],{kind:'t',counterpartyEntryId:22,counterparty:'Manager B'});
  const r=build([deal,deal]);
  assert.equal(r.transactionDetails.length,2);
  const [a,b]=r.transactionDetails;
  assert.deepEqual([a.entryId,a.counterpartyEntryId,a.counterparty,a.net],[11,22,'Manager B',3]);
  assert.deepEqual([b.entryId,b.counterpartyEntryId,b.counterparty,b.net],[22,11,'Manager A',-3]);
  assert.deepEqual(a.playersIn.map(p=>p.gwPoints),[6,-1]);
  assert.deepEqual(b.playersIn.map(p=>p.gwPoints),[2,0]);
});
test('waiver and free-agent details identify the market, not an invented previous owner',()=>{
  const r=build([tx('w',1,[2],[1]),tx('f',2,[3],[2],{kind:'f'})]);
  assert.equal(r.transactionDetails[0].counterparty,null);
  assert.equal(ui.source(r.transactionDetails[0]),'Waiver · 自由球员市场');
  assert.equal(ui.source(r.transactionDetails[1]),'自由签约 · 自由球员市场');
  assert.equal(ui.source({kind:'t'}),'Trade · 与 对方经理待确认 交换');
});
test('same-round intermediaries remain visible in deals but cancel in manager round net',()=>{
  const r=build([tx('a',2,[2],[1]),tx('b',2,[3],[2],{kind:'f'})]);
  const view=ui.model(snap(r),11,2);
  assert.equal(view.rounds[0].deals.length,2);
  assert.equal(view.rounds[0].ledger.net,-3);
  assert.equal(view.rounds[0].deals.reduce((sum,d)=>sum+d.net,0),-3);
  assert.match(ui.body(view),/P2/);
  assert.match(ui.body(view),/抵消/);
});
test('future and rejected transactions cannot leak into a historical manager drill-down',()=>{
  const r=build([tx('old',1,[2],[1]),tx('now',2,[3],[2]),tx('future',3,[4],[3]),tx('reject',1,[4],[1],{result:'di'})]);
  const view=ui.model(snap(r),11,1);
  assert.deepEqual(view.rounds.map(r=>r.gw),[1]);
  assert.equal(view.rounds[0].deals[0].net,8);
  assert.equal(ui.model(snap(r),11,3).throughGw,2);
  assert.equal(r.transactionDetails.find(d=>d.transactionId==='future').playersIn[0].gwPoints,null);
  assert.ok(!r.transactionDetails.some(d=>d.transactionId==='reject'));
  assert.doesNotMatch(ui.body(view),/999|GW2|GW3/);
});
test('missing points remain unknown while known peer scores are retained',()=>{
  const r=build([tx('missing',2,[2,99],[1])]);
  const d=r.transactionDetails[0];
  assert.equal(d.net,null);assert.equal(d.complete,false);
  assert.deepEqual(d.playersIn.map(p=>p.gwPoints),[6,null]);
  assert.match(ui.body(ui.model(snap(r),11,2)),/得分或记录暂缺/);
});
test('legacy caches and inactive managers receive distinct honest empty states',()=>{
  const r=build([tx('a',1,[2],[1])]);
  assert.match(ui.body(ui.model(snap(r),22,2)),/暂无已成交交易/);
  delete r.transactionDetails;
  assert.match(ui.body(ui.model(snap(r),11,2)),/等待数据同步/);
  assert.equal(ui.model(snap(r),99,2),null);
  assert.equal(ui.model(snap(r),11,NaN),null);
});
test('drill-down escapes player names and counterparties and never reads current player scores',()=>{
  const r=build([tx('a',2,[2],[1],{kind:'t',counterpartyEntryId:22,counterparty:'<img src=x onerror=alert(1)>',playersIn:[{id:2,name:'<script>bad()</script>'}]})]);
  const snapshot={...snap(r),players:[{id:2,totalPoints:999,lastGwPoints:888}]};
  const html=ui.body(ui.model(snapshot,11,2));
  assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img/);
  assert.doesNotMatch(html,/<script>|<img|999|888/);
});
test('compact drill-down keeps every deal and player score with one shared column header',()=>{
  const r=build([tx('old',1,[2],[1]),tx('multi',2,[2,3],[1,4],{kind:'t',counterpartyEntryId:22,counterparty:'Manager B'})]);
  const html=ui.body(ui.model(snap(r),11,2));
  assert.equal((html.match(/class="tm-columns"/g)||[]).length,1);
  assert.equal((html.match(/class="tm-deal"/g)||[]).length,2);
  assert.equal((html.match(/class="tm-player"/g)||[]).length,6);
  assert.equal((html.match(/class="tm-net"/g)||[]).length,2);
  assert.match(html,/Trade · 与 Manager B 交换/);
  assert.match(html,/>P3<\/span><strong>-1 /);
  assert.match(html,/>P4<\/span><strong>0 /);
  assert.match(html,/换入 · GW2 得分/);
  assert.match(html,/本轮净收益/);
});
