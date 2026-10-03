'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const timeline = require('../public/timeline');
const gw2 = {currentGw:2,lastFinishedGw:2,reportGw:2,reportLive:false,gwStarted:true,upcomingGw:3};
const gw3 = {currentGw:3,lastFinishedGw:2,reportGw:3,reportLive:true,gwStarted:true,upcomingGw:3,refreshSeconds:60};
test('live report advances at GW3 start, while GW2 stays historical', () => {
  assert.equal(timeline.reportGw(gw3),3);
  assert.equal(timeline.live(gw3,3),true);
  assert.equal(timeline.live(gw3,2),false);
  assert.equal(timeline.phase(gw3,3),'本轮 · 进行中');
  assert.equal(timeline.phase(gw3,4),'下轮');
  assert.equal(timeline.phase(gw3,2),'已完赛');
});
test('after GW3 ends report freezes at3, transactions can select GW4', () => {
  const final={...gw3,lastFinishedGw:3,reportLive:false,upcomingGw:4};
  assert.equal(timeline.reportGw(final),3);
  assert.equal(timeline.live(final),false);
  assert.equal(timeline.phase(final,3),'已完赛');
  assert.equal(timeline.defaultTradeGw(final,4),4);
});
test('GW3 trades are selected during GW3 even when GW4 transactions exist', () => {
  assert.equal(timeline.defaultTradeGw(gw3,4),3);
  assert.equal(timeline.defaultTradeGw(gw2,3),3);
});
test('auto update follows current GW but preserves a historical selection', () => {
  assert.equal(timeline.followReport(gw2,gw3,2),3);
  assert.equal(timeline.followReport(gw2,gw3,1),1);
  assert.equal(timeline.followReport({},gw3,null),3);
});
test('latest live round and closed round use distinct refresh policies', () => {
  assert.equal(timeline.refreshMilliseconds(gw3),60_000);
  assert.equal(timeline.refreshMilliseconds(gw2),900_000);
});
test('transaction default follows next GW but not a historical selection', () => {
  const gw4 = {...gw3,currentGw:4,reportGw:4,lastFinishedGw:3,upcomingGw:4};
  assert.equal(timeline.followTrade(gw3,gw4,3),4);
  assert.equal(timeline.followTrade(gw3,gw4,2),2);
  assert.equal(timeline.followTrade({},gw3,null),3);
  const ended = {...gw3,lastFinishedGw:3,reportLive:false,upcomingGw:4};
  assert.equal(timeline.followTrade(ended,ended,3),3, 'refresh preserves completed GW3 detail selection');
  assert.equal(timeline.followTrade(gw3,ended,3),4, 'automatic selection follows completion once');
});

test('evaluation rounds add newly observed trades without advancing automatic scoring selection', () => {
  const snapshot = { tradeReturns: { throughGw: 4, currentByGw: {} }, transactions: { all: [] } };
  assert.deepEqual(timeline.tradeEvalRounds(snapshot), [4, 3, 2, 1]);
  snapshot.transactions.all.push({ gw: 5, result: 'a' }, { gw: 5, result: 'a' });
  assert.deepEqual(timeline.tradeEvalRounds(snapshot), [5, 4, 3, 2, 1]);
  assert.equal(timeline.tradeEvalGw(snapshot, null), 4);
  assert.equal(timeline.tradeEvalGw(snapshot, 5), 5);
  assert.equal(timeline.tradeEvalGw(snapshot, 3), 3);
  snapshot.tradeReturns.throughGw = 5;
  assert.equal(timeline.tradeEvalGw(snapshot, null), 5);
  assert.equal(timeline.tradeEvalGw(snapshot, 3), 3);
});

test('evaluation options require real future transactions or nonempty ledgers, not empty future calendar rounds', () => {
  const snapshot = { meta: { upcomingGw: 9 }, transactions: { all: [{ gw: 5, result: 'di' }] },
    tradeReturns: { throughGw: 3, currentByGw: {
      4: { dealCount: 0, rows: [], pending: true },
      6: { dealCount: 1, rows: [] },
      8: { rows: [{ entryId: 101 }] },
    } } };
  assert.deepEqual(timeline.tradeEvalRounds(snapshot), [8, 6, 5, 3, 2, 1]);
  assert.equal(timeline.tradeEvalGw(snapshot, 4), 3, 'empty future ledger must not invent a selectable round');
  assert.equal(timeline.tradeEvalGw(snapshot, 9), 3, 'upcoming calendar alone is not transaction evidence');
  assert.equal(timeline.tradeEvalGw(snapshot, 8), 8);
});

test('evaluation round bounds reject malformed data and missing snapshots remain safe', () => {
  const snapshot = { transactions: { all: [0, -1, 1.5, 39, Infinity, NaN, 'bad'].map(gw => ({ gw })) },
    tradeReturns: { throughGw: 2, currentByGw: {
      '-1': { dealCount: 1 }, '1.5': { rows: [{}] }, 39: { rows: [{}] }, bad: { dealCount: 1 },
    } } };
  assert.deepEqual(timeline.tradeEvalRounds(snapshot), [2, 1]);
  for (const selected of [0, -1, 1.5, 39, Infinity, NaN, 'bad']) assert.equal(timeline.tradeEvalGw(snapshot, selected), 2);
  assert.deepEqual(timeline.tradeEvalRounds({}), []);
  assert.equal(timeline.tradeEvalGw({}, null), 0);
});

test('first preseason transaction can be inspected without inventing first-round points', () => {
  const snapshot = { transactions: { all: [{ gw: 1, result: 'a' }] }, tradeReturns: { throughGw: 0 } };
  assert.deepEqual(timeline.tradeEvalRounds(snapshot), [1]);
  assert.equal(timeline.tradeEvalGw(snapshot, null), 0);
  assert.equal(timeline.tradeEvalGw(snapshot, 1), 1);
});
