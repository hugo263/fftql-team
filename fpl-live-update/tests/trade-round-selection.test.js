'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const timeline = require('../public/timeline');
const { buildTradeReturns } = require('../trade-returns');
const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

function harness(throughGw = 3) {
  const nodes = new Map();
  const $ = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', textContent: '', value: '',
      setAttribute() {}, addEventListener(type, listener) { this[type] = listener; } });
    return nodes.get(selector);
  };
  const snap = { meta: { currentGw: 3, reportGw: 3, lastFinishedGw: 3, upcomingGw: 4,
    reportLive: false, reportFinalizing: true },
    transactions: { all: [] }, tradeReturns: { version: 1, throughGw, acquisitions: [], currentByGw: {
      2: { rows: [], gains: 12, losses: -4, net: 8 },
      3: { rows: [], gains: 25, losses: -10, net: 15 },
      4: { rows: [], gains: 0, losses: 0, net: 0 },
    } } };
  const context = vm.createContext({ STATE: { snap, txCenterGw: null, txEvalGw: null, txCenterFilter: 'done', txHistoryView: 'players' },
    TIMELINE: timeline, $, $$: () => [], document: { querySelector: () => null }, esc: String, txGroupsHtml: () => '' });
  vm.runInContext(app.slice(app.indexOf('function managerMark('),app.indexOf('\nfunction ',app.indexOf('function managerMark(')+1)),context);
  vm.runInContext(app.slice(app.indexOf('function renderTradeCenter()'), app.indexOf('function selectTradeHistoryView(')), context);
  return { context, $, snap };
}

function transaction(id, gw, elementIn, elementOut, manager = '测试经理') {
  return { id, gw, result: 'a', kind: 'f', entryId: 101, manager,
    elementIn, elementOut, playerIn: { id: elementIn, name: `换入${elementIn}` },
    playerOut: { id: elementOut, name: `换出${elementOut}` } };
}

function populateReturns(snap, transactions, throughGw = 4) {
  snap.meta = { currentGw: 4, reportGw: 4, lastFinishedGw: 4, upcomingGw: 5, reportLive: false };
  snap.transactions.all = transactions;
  snap.tradeReturns = buildTradeReturns({ transactions, reportGw: 4, scoringGw: throughGw,
    livePointsByGw: new Map([[4, new Map([[1, 8], [2, 3]])], [5, new Map([[3, 999], [1, 999]])]]),
    managers: [{ entryId: 101, entryName: '测试经理' }] });
}

test('completed GW3 evaluation stays at GW3 while details independently default to GW4', () => {
  const { context, $ } = harness();
  context.renderTradeCenter();
  assert.equal($('#tcTxGwSel').value, '4');
  assert.equal($('#tcGwSel').value, 'latest');
  assert.match($('#tcCurrentTitle').textContent, /GW3/);
  assert.match($('#tcCurrentSummary').innerHTML, /\+25/);
  assert.match($('#tcEvalLabel').textContent, /已完赛 · 待结算/);
  assert.doesNotMatch($('#tcCurrentLabel').textContent, /实时/);
});

test('detail slicer never changes evaluation; historical evaluation and automatic mode survive refresh', () => {
  const { context, $, snap } = harness();
  context.renderTradeCenter();
  $('#tcTxGwSel').change({ target: { value: '2' } });
  assert.match($('#tcCurrentTitle').textContent, /GW3/);
  assert.equal(context.STATE.txCenterGw, 2);
  $('#tcGwSel').change({ target: { value: '2' } });
  assert.match($('#tcCurrentSummary').innerHTML, /\+12/);
  snap.tradeReturns.throughGw = 4;
  context.renderTradeCenter();
  assert.match($('#tcCurrentTitle').textContent, /GW2/);
  assert.equal($('#tcTxGwSel').value, '2');
  $('#tcGwSel').change({ target: { value: 'latest' } });
  assert.match($('#tcCurrentTitle').textContent, /GW4/);
});

test('no scoring data shows a waiting state instead of GW0 or fabricated zero returns', () => {
  const { context, $ } = harness(0);
  context.renderTradeCenter();
  assert.match($('#tcCurrentReturns').innerHTML, /尚无比赛得分/);
  assert.equal($('#tcCurrentSummary').innerHTML, '');
  assert.doesNotMatch($('#tcEvalLabel').textContent, /GW0/);
});

test('new GW5 transactions appear in evaluation options on refresh while auto remains latest scored GW4', () => {
  const { context, $, snap } = harness(4);
  const transactions = [transaction('old', 4, 1, 2)];
  populateReturns(snap, transactions);
  context.renderTradeCenter();
  assert.doesNotMatch($('#tcGwSel').innerHTML, /value="5"/);
  transactions.push(transaction('new', 5, 3, 1));
  populateReturns(snap, transactions);
  context.renderTradeCenter();
  assert.match($('#tcGwSel').innerHTML, /value="5">GW5（[^<]*待计分/);
  assert.equal($('#tcGwSel').value, 'latest');
  assert.match($('#tcCurrentTitle').textContent, /GW4/);
  assert.match($('#tcCurrentSummary').innerHTML, /\+5/);
});

test('selecting future GW shows pending named transactions and no fabricated points or future history', () => {
  const { context, $, snap } = harness(4);
  populateReturns(snap, [transaction('old', 4, 1, 2), transaction('new', 5, 3, 1)]);
  const future = snap.tradeReturns.currentByGw[5];
  assert.equal(future.pending, true);
  for (const field of ['net', 'gains', 'losses']) assert.equal(future[field], null);
  const row = future.rows[0];
  assert.equal(row.net, null);
  assert.equal(row.inPoints, null);
  assert.equal(row.outPoints, null);
  assert.equal(row.playersIn[0].gwPoints, null);
  assert.equal(row.playersIn[0].contribution, null);
  assert.equal(snap.tradeReturns.managerRankingByGw[5], undefined);
  context.renderTradeCenter();
  $('#tcGwSel').change({ target: { value: '5' } });
  assert.equal(context.STATE.txEvalGw, 5);
  assert.equal($('#tcGwSel').value, '5');
  assert.match($('#tcCurrentTitle').textContent, /GW5/);
  assert.match($('#tcCurrentReturns').innerHTML, /换入3/);
  assert.match($('#tcCurrentReturns').innerHTML, /换出1/);
  assert.match($('#tcCurrentReturns').innerHTML, /待计分/);
  assert.match($('#tcCurrentReturns').innerHTML, /换入 — 分 \/ 换出 — 分/);
  assert.equal(($('#tcCurrentSummary').innerHTML.match(/>—<\/strong>/g) || []).length, 3);
  assert.doesNotMatch($('#tcCurrentSummary').innerHTML, />0<\/strong>|999/);
  assert.match($('#tcHistoryLabel').textContent, /截至 GW4/);
  assert.match($('#tcHistoryReturns').innerHTML, /换入1/);
  assert.doesNotMatch($('#tcHistoryReturns').innerHTML, /换入3|999/);
  context.STATE.txHistoryView = 'managers';
  context.renderTradeEval();
  assert.match($('#tcHistoryReturns').innerHTML, /\+5/);
  assert.doesNotMatch($('#tcHistoryReturns').innerHTML, /999/);
  assert.match($('#tcHistoryLabel').textContent, /截至 GW4/);
});

test('future evaluation selection persists on refresh independently of transaction detail round', () => {
  const { context, $, snap } = harness(4);
  populateReturns(snap, [transaction('new', 5, 3, 1)]);
  context.renderTradeCenter();
  $('#tcGwSel').change({ target: { value: '5' } });
  $('#tcTxGwSel').change({ target: { value: '2' } });
  context.renderTradeCenter();
  assert.equal($('#tcGwSel').value, '5');
  assert.equal($('#tcTxGwSel').value, '2');
  assert.match($('#tcCurrentTitle').textContent, /GW5/);
  $('#tcGwSel').change({ target: { value: 'latest' } });
  assert.match($('#tcCurrentTitle').textContent, /GW4/);
  snap.tradeReturns.throughGw = 5;
  context.renderTradeCenter();
  assert.match($('#tcCurrentTitle').textContent, /GW5/);
  assert.equal($('#tcTxGwSel').value, '2');
});

test('future proposal opens a round but rejected transactions are not presented as completed evaluation', () => {
  const { context, $, snap } = harness(4);
  populateReturns(snap, [{ ...transaction('rejected', 5, 3, 1), result: 'di' }]);
  context.renderTradeCenter();
  $('#tcGwSel').change({ target: { value: '5' } });
  assert.equal($('#tcGwSel').value, '5');
  assert.match($('#tcCurrentReturns').innerHTML, /暂无已成交操作/);
  assert.doesNotMatch($('#tcCurrentReturns').innerHTML, /换入3/);
  assert.equal(($('#tcCurrentSummary').innerHTML.match(/>—<\/strong>/g) || []).length, 3);
});

test('future cached placeholder zeroes never masquerade as scored player contributions', () => {
  const { context, $, snap } = harness(4);
  populateReturns(snap, [transaction('new', 5, 3, 1)]);
  const future = snap.tradeReturns.currentByGw[5];
  Object.assign(future, { gains: 0, losses: 0, net: 0, pending: false, complete: true });
  for (const row of future.rows) {
    Object.assign(row, { inPoints: 0, outPoints: 0, net: 0, pending: false, complete: true });
    for (const player of [...row.playersIn, ...row.playersOut]) Object.assign(player, { gwPoints: 0, contribution: 0 });
  }
  context.renderTradeCenter();
  $('#tcGwSel').change({ target: { value: '5' } });
  assert.equal(($('#tcCurrentSummary').innerHTML.match(/>—<\/strong>/g) || []).length, 3);
  assert.match($('#tcCurrentReturns').innerHTML, /（待计分）/);
  assert.doesNotMatch($('#tcCurrentReturns').innerHTML, /（0 分）|>0<\/b>|换入 0 分|换出 0 分/);
  assert.equal(future.rows[0].pending, false, 'rendering should not mutate the cached snapshot');
});

test('accepted transactions without a cached evaluation ledger show waiting for sync, not no trades', () => {
  const { context, $, snap } = harness(4);
  populateReturns(snap, [transaction('new', 5, 3, 1)]);
  delete snap.tradeReturns.currentByGw[5];
  context.renderTradeCenter();
  $('#tcGwSel').change({ target: { value: '5' } });
  assert.equal($('#tcGwSel').value, '5');
  assert.match($('#tcCurrentReturns').innerHTML, /交易评价明细待同步/);
  assert.doesNotMatch($('#tcCurrentReturns').innerHTML, /暂无已成交操作/);
  assert.equal(($('#tcCurrentSummary').innerHTML.match(/>—<\/strong>/g) || []).length, 3);
});

test('both distinct, labelled slicers are present once and changed scripts have cache versions', () => {
  for (const id of ['tcGwSel', 'tcTxGwSel']) assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1);
  assert.match(html, /aria-label="选择交易收益的 GW"/);
  assert.match(html, /aria-label="选择交易明细的 GW"/);
  assert.ok(html.includes('/timeline.js?v=83'));
  assert.ok(html.includes('/match-view.js?v=84'));
  assert.ok(html.includes('/app.js?v=105'));
});
