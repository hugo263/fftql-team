'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTradeReturns, latestScoringGw } = require('../trade-returns');

const points = (byGw) => new Map(Object.entries(byGw).map(([gw, values]) => [Number(gw), new Map(Object.entries(values).map(([id, score]) => [Number(id), score]))]));
const player = (id) => ({ id, name: `Player ${id}`, pos: 'MID' });
function transfer(id, gw, incoming, outgoing, extra = {}) {
  return {
    id, gw, added: `2026-08-${String(gw + 10).padStart(2, '0')}T12:00:00Z`, result: 'a', kind: 'f',
    entryId: 11, manager: 'Manager A', elementsIn: incoming, elementsOut: outgoing,
    playersIn: incoming.map(player), playersOut: outgoing.map(player), ...extra,
  };
}
const build = (transactions, scores, reportGw = 3, managers = []) => buildTradeReturns({ transactions, livePointsByGw: points(scores), reportGw, managers });

test('trade evaluation waits past the deadline and placeholder zeros, but zero-point appearances count', () => {
  const scores = points({ 3: { 1: 3, 2: 5 }, 4: { 1: 0, 2: 0 } });
  const placeholder = { elements: { 1: { stats: { minutes: 0, total_points: 0 }, explain: [] } } };
  assert.equal(latestScoringGw(scores, 4, placeholder), 3);
  for (const stats of [{ minutes: 1, total_points: 0 }, { minutes: 0, total_points: -1 }]) {
    assert.equal(latestScoringGw(scores, 4, { elements: { 1: { stats } } }), 4);
  }
  assert.equal(latestScoringGw(new Map(), 1, placeholder), 0);
  const result = buildTradeReturns({ transactions: [transfer('x', 4, [2], [1])],
    livePointsByGw: scores, reportGw: 4, scoringGw: 3 });
  assert.equal(result.throughGw, 3);
  assert.equal(result.currentByGw[4].pending, true);
  assert.equal(result.currentByGw[4].rows[0].playersIn[0].gwPoints, null);
  assert.equal(result.acquisitions[0].points, null);
  assert.equal(result.managerRankingByGw[4], undefined);
});

test('current trade returns use raw Draft scores, preserve real zero/negative and rank manager net descending', () => {
  const result = build([
    transfer('f1', 3, [2], [1]),
    transfer('f2', 3, [4], [3], { entryId: 22, manager: 'Manager B' }),
    transfer('f3', 3, [6], [5], { entryId: 33, manager: 'Manager C' }),
  ], { 3: { 1: 3, 2: 9, 3: 0, 4: -1, 5: 2, 6: 2 } });
  const current = result.currentByGw[3];
  assert.deepEqual(current.rows.map(row => [row.entryId, row.inPoints, row.outPoints, row.net]), [[11, 9, 3, 6], [33, 2, 2, 0], [22, -1, 0, -1]]);
  assert.equal(current.gains, 6);
  assert.equal(current.losses, -1);
  assert.equal(current.net, 5);
  assert.equal(current.dealCount, 3);
  assert.equal(current.complete, true);
  assert.deepEqual(result.acquisitions.map(row => row.points), [9, 2, -1]);
});

test('direct multi-player deal counts both managers with opposite package returns and one deal', () => {
  const deal = transfer('t1', 3, [3, 4], [1, 2], { kind: 't', counterpartyEntryId: 22, counterparty: 'Manager B' });
  const result = build([deal, { ...deal }], { 3: { 1: 2, 2: 3, 3: 8, 4: -1 } });
  const current = result.currentByGw[3];
  assert.equal(current.dealCount, 1, 'duplicate transaction IDs cannot double count a direct deal');
  assert.deepEqual(current.rows.map(row => [row.entryId, row.dealCount, row.inPoints, row.outPoints, row.net]), [[11, 1, 7, 5, 2], [22, 1, 5, 7, -2]]);
  assert.equal(current.gains, 2);
  assert.equal(current.losses, -2);
  assert.equal(current.net, 0, 'a direct deal redistributes rather than creates raw points');
  assert.deepEqual(result.acquisitions.map(row => [row.entryId, row.player.id, row.points]), [[11, 3, 8], [22, 2, 3], [22, 1, 2], [11, 4, -1]]);
});

test('same-GW intermediary and round trip cancel before the deadline instead of inflating gains', () => {
  const result = build([
    transfer('f2', 3, [3], [2], { added: '2026-08-13T13:00:00Z' }),
    transfer('f1', 3, [2], [1], { added: '2026-08-13T12:00:00Z' }),
    transfer('f3', 3, [5], [4], { entryId: 22 }),
    transfer('f4', 3, [4], [5], { entryId: 22, added: '2026-08-13T14:00:00Z' }),
  ], { 3: { 1: 3, 2: 99, 3: 8, 4: 2, 5: 80 } });
  assert.deepEqual(result.currentByGw[3].rows.map(row => [row.entryId, row.inPoints, row.outPoints, row.net]), [[11, 8, 3, 5], [22, 0, 0, 0]]);
  const intermediary = result.acquisitions.find(row => row.player.id === 2);
  assert.equal(intermediary.gwCount, 0);
  assert.equal(intermediary.points, 0, 'no scoring GW is held; frontend excludes zero-length holding spells');
  assert.equal(result.acquisitions.find(row => row.player.id === 3).points, 8);
});

test('holding spell stops before transfer-out GW; later reacquisition starts an independent period', () => {
  const transactions = [transfer('f1', 1, [2], [1]), transfer('f2', 3, [3], [2]), transfer('f3', 4, [2], [3])];
  const scores = { 1: { 1: 2, 2: 5 }, 2: { 2: 7 }, 3: { 2: 40, 3: 2 }, 4: { 2: 3, 3: 9 }, 5: { 2: 8 } };
  const result = build(transactions, scores, 5);
  const spells = result.acquisitions.filter(row => row.player.id === 2).sort((a, b) => a.fromGw - b.fromGw);
  assert.deepEqual(spells.map(row => [row.fromGw, row.toGw, row.releasedGw, row.gwCount, row.points]), [[1, 2, 3, 2, 12], [4, 5, null, 2, 11]]);
  assert.equal(result.acquisitions.find(row => row.player.id === 3).points, 2);
  const historical = build(transactions, scores, 2);
  assert.equal(historical.acquisitions.find(row => row.transactionId === 'f1').points, 12);
  assert.equal(historical.acquisitions.find(row => row.transactionId === 'f3').pending, true);
  assert.equal(historical.acquisitions.find(row => row.transactionId === 'f3').points, null);
  assert.equal(historical.currentByGw[3].net, null, 'historical cutoff never leaks future GW scores');
});

test('missing/null/non-finite point data remains incomplete rather than becoming zero or partial total', () => {
  for (const unavailable of [undefined, null, NaN, Infinity]) {
    const result = build([transfer('f1', 2, [2, 3], [1])], { 2: { 1: 0, 2: 4, 3: unavailable }, 3: { 2: 5, 3: 6 } });
    const current = result.currentByGw[2];
    assert.equal(current.rows[0].inPoints, null);
    assert.equal(current.rows[0].outPoints, 0);
    assert.equal(current.net, null);
    assert.equal(current.gains, null);
    assert.equal(current.losses, null);
    assert.equal(current.missingCount, 1);
    const acquisition = result.acquisitions.find(row => row.player.id === 3);
    assert.equal(acquisition.complete, false);
    assert.equal(acquisition.points, null);
    assert.deepEqual(acquisition.series, [{ gw: 2, points: null }, { gw: 3, points: 6 }]);
  }
});

test('future deals stay pending despite supplied points, no-deal live round is legitimately zero', () => {
  const result = build([transfer('f1', 4, [2], [1])], { 4: { 1: 2, 2: 99 } });
  assert.equal(result.currentByGw[3].dealCount, 0);
  assert.equal(result.currentByGw[3].net, 0);
  assert.equal(result.currentByGw[3].complete, true);
  assert.equal(result.currentByGw[4].pending, true);
  assert.equal(result.currentByGw[4].rows[0].inPoints, null);
  assert.equal(result.currentByGw[4].net, null);
  assert.equal(result.acquisitions[0].points, null);
  assert.deepEqual(result.acquisitions[0].series, []);
});

test('only accepted, normalized valid-GW transactions enter returns; singular legacy IDs work', () => {
  const singular = { id: 'f1', gw: 3, result: 'a', kind: 'f', entryId: 11, manager: 'A', elementIn: 2, elementOut: 1, playerIn: player(2), playerOut: player(1) };
  const ignored = ['p', 'di', 'do', 'r'].map((result, i) => transfer(`x${i}`, 3, [4], [3], { result }));
  const badRounds = [0, 39, '3', null].map((gw, i) => transfer(`b${i}`, gw, [4], [3]));
  const result = build([singular, ...ignored, ...badRounds], { 3: { 1: 2, 2: 8, 3: 1, 4: 99 } });
  assert.equal(result.currentByGw[3].dealCount, 1);
  assert.equal(result.currentByGw[3].net, 6);
  assert.equal(result.acquisitions.length, 1);
});

test('incomplete trade packages and unexplained repeated acquisitions cannot earn trustworthy totals', () => {
  const broken = build([transfer('f1', 3, [2, null], [1])], { 3: { 1: 2, 2: 8 } });
  assert.equal(broken.currentByGw[3].rows[0].complete, false);
  assert.equal(broken.currentByGw[3].net, null);
  assert.equal(broken.acquisitions[0].points, null);
  const duplicate = build([transfer('f1', 2, [2], [1]), transfer('f2', 3, [2], [3])], { 2: { 1: 2, 2: 8 }, 3: { 2: 9, 3: 1 } });
  assert.equal(duplicate.acquisitions.length, 2);
  assert.ok(duplicate.acquisitions.every(row => !row.complete && row.points === null));
});

test('individual contributions preserve zero and negative scores with the correct in/out signs, without mutating metadata', () => {
  const deal = transfer('f1', 3, [2, 3], [1, 4]);
  const result = build([deal], { 3: { 1: -3, 2: 0, 3: -2, 4: 4 } });
  const row = result.currentByGw[3].rows[0];
  assert.deepEqual(row.playersIn.map(({id, gwPoints, contribution}) => [id, gwPoints, contribution]), [[2, 0, 0], [3, -2, -2]]);
  assert.deepEqual(row.playersOut.map(({id, gwPoints, contribution}) => [id, gwPoints, contribution]), [[1, -3, 3], [4, 4, -4]]);
  assert.equal([...row.playersIn, ...row.playersOut].reduce((sum, item) => sum + item.contribution, 0), row.net);
  assert.equal(row.net, -3);
  assert.ok(deal.playersIn.every((item) => !Object.hasOwn(item, 'gwPoints') && !Object.hasOwn(item, 'contribution')));
  assert.ok(result.acquisitions.every((item) => !Object.hasOwn(item.player, 'gwPoints')));
  const zeroOut = build([transfer('f2', 3, [2], [1])], { 3: { 1: 0, 2: 0 } }).currentByGw[3].rows[0].playersOut[0];
  assert.equal(Object.is(zeroOut.contribution, -0), false);
});

test('pending individual scores stay unknown even if a future score map is supplied', () => {
  const row = build([transfer('f1', 4, [2], [1])], { 4: { 1: -1, 2: 10 } }).currentByGw[4].rows[0];
  for (const item of [...row.playersIn, ...row.playersOut]) {
    assert.equal(item.gwPoints, null);
    assert.equal(item.contribution, null);
  }
});

test('one missing player does not erase another known individual contribution', () => {
  for (const unavailable of [undefined, null, NaN, Infinity]) {
    const row = build([transfer('f1', 3, [2, 3], [1])], { 3: { 1: 0, 2: 4, 3: unavailable } }).currentByGw[3].rows[0];
    assert.equal(row.complete, false);
    assert.equal(row.net, null);
    assert.deepEqual(row.playersIn.map(({gwPoints, contribution}) => [gwPoints, contribution]), [[4, 4], [null, null]]);
    assert.equal(row.playersOut[0].contribution, 0);
  }
});

test('inconsistent manager ledgers retain known raw scores but never attribute individual contributions', () => {
  const result = build([transfer('f1', 3, [2], [1]), transfer('f2', 3, [2], [3])], { 3: { 1: 1, 2: 8, 3: -2 } });
  const row = result.currentByGw[3].rows[0];
  assert.equal(row.complete, false);
  assert.equal(row.net, null);
  assert.deepEqual(row.playersIn.map(({gwPoints, contribution}) => [gwPoints, contribution]), [[8, null]]);
  assert.deepEqual(row.playersOut.map(({gwPoints, contribution}) => [gwPoints, contribution]), [[1, null], [-2, null]]);
  assert.equal(result.managerRankingByGw[3].rows[0].rank, null);
});

test('manager ranking counts each trade only at its effective GW, never later holding scores', () => {
  const result = build([transfer('f1', 1, [2], [1]), transfer('f2', 3, [3], [2])], {
    1: { 1: 1, 2: 5 }, 2: { 2: 1000 }, 3: { 2: 40, 3: 10 }, 4: { 3: 1000 },
  }, 4, [{entryId: 11, entryName: 'Manager A'}, {entryId: 22, entryName: 'No deals'}]);
  const managerAt = (gw) => result.managerRankingByGw[gw].rows.find((row) => row.entryId === 11);
  assert.equal(managerAt(1).net, 4);
  assert.equal(managerAt(2).net, 4);
  assert.equal(managerAt(3).net, -26);
  assert.equal(managerAt(4).net, -26);
  assert.deepEqual([managerAt(4).gains, managerAt(4).losses, managerAt(4).dealCount, managerAt(4).scoredGwCount], [4, -30, 2, 2]);
  assert.equal(result.acquisitions.find((row) => row.transactionId === 'f1').points, 1005, 'old holding-period measure remains independent');
  assert.equal(result.managerRankingByGw[4].rows[0].entryId, 22, 'legitimate inactive zero outranks a loss');
  assert.equal(result.version, 1);
});

test('manager rankings contain every supplied manager, including zero-deal managers and the pre-GW baseline', () => {
  const result = build([], {}, 2, [
    {entryId: 33, playerName: 'C'}, {entryId: 11, entryName: 'A'}, {entryId: 22, manager: 'B'}, {entryId: 11, entryName: 'duplicate'}, {entryId: null},
  ]);
  assert.deepEqual(Object.keys(result.managerRankingByGw), ['0', '1', '2']);
  for (const ranking of Object.values(result.managerRankingByGw)) {
    assert.equal(ranking.complete, true);
    assert.equal(ranking.dealCount, 0);
    assert.deepEqual(ranking.rows.map((row) => [row.entryId, row.manager, row.rank, row.net, row.scoredGwCount, row.dealCount]), [
      [11, 'A', 1, 0, 0, 0], [22, 'B', 1, 0, 0, 0], [33, 'C', 1, 0, 0, 0],
    ]);
  }
});

test('manager rankings use competition ties and a stable entry-ID order, not arbitrary roster ordering', () => {
  const result = build([
    transfer('f1', 3, [2], [1], {entryId: 22}),
    transfer('f2', 3, [4], [3], {entryId: 11}),
    transfer('f3', 3, [6], [5], {entryId: 44}),
  ], { 3: { 1: 1, 2: 6, 3: 2, 4: 7, 5: 5, 6: 0 } }, 3,
  [{entryId:44}, {entryId:33}, {entryId:22}, {entryId:11}]);
  assert.deepEqual(result.managerRankingByGw[3].rows.map(({entryId, net, rank}) => [entryId, net, rank]), [
    [11, 5, 1], [22, 5, 1], [33, 0, 3], [44, -5, 4],
  ]);
});

test('incomplete historical manager totals remain unranked behind even negative complete totals', () => {
  const result = build([
    transfer('a1', 1, [2], [1]), transfer('a2', 2, [3], [2]), transfer('a3', 3, [4], [3]),
    transfer('b1', 1, [6], [5], {entryId:22}),
  ], { 1: { 1: 2, 2: 8, 5: 5, 6: 0 }, 2: { 2: 0 }, 3: { 3: 5, 4: 3 } }, 3,
  [{entryId:11}, {entryId:22}, {entryId:33}]);
  const ranking = result.managerRankingByGw[3];
  assert.deepEqual(ranking.rows.map(({entryId, net, rank}) => [entryId, net, rank]), [[33, 0, 1], [22, -5, 2], [11, null, null]]);
  const incomplete = ranking.rows[2];
  assert.equal(incomplete.complete, false);
  assert.equal(incomplete.gains, null);
  assert.equal(incomplete.losses, null);
  assert.deepEqual([incomplete.knownNet, incomplete.knownGains, incomplete.knownLosses], [4, 6, -2]);
  assert.deepEqual([incomplete.dealCount, incomplete.scoredGwCount, incomplete.missingGwCount], [3, 2, 1]);
  assert.equal(ranking.complete, false);
  assert.equal(ranking.missingCount, 1);
  assert.equal(ranking.completeCount, 2);
  assert.equal(result.managerRankingByGw[1].rows.find((row) => row.entryId === 11).net, 6, 'later missing data cannot mutate a historical cutoff');
});

test('future operations and future-only manager identities never leak into an earlier ranking', () => {
  const result = build([
    transfer('f1', 1, [2], [1]),
    transfer('future', 4, [4], [3], {entryId:44, manager:'Future trader'}),
  ], { 1: { 1: 1, 2: 5 }, 4: { 3: 1, 4: 999 } }, 3);
  assert.equal(result.managerRankingByGw[4], undefined);
  assert.deepEqual(result.managerRankingByGw[0].rows, []);
  for (const gw of [1, 2, 3]) {
    assert.deepEqual(result.managerRankingByGw[gw].rows.map(({entryId, net, dealCount}) => [entryId, net, dealCount]), [[11, 4, 1]]);
    assert.equal(result.managerRankingByGw[gw].dealCount, 1);
  }
});

test('cumulative multi-player direct trades count one operation per manager and one league deal', () => {
  const deal = transfer('t1', 2, [3, 4], [1, 2], {kind:'t', counterpartyEntryId:22, counterparty:'Manager B'});
  const result = build([deal, {...deal}], {2:{1:2, 2:3, 3:8, 4:-1}, 3:{1:900, 2:900, 3:900, 4:900}}, 3);
  const ranking = result.managerRankingByGw[3];
  assert.equal(ranking.dealCount, 1);
  assert.deepEqual(ranking.rows.map(({entryId, net, dealCount, scoredGwCount}) => [entryId, net, dealCount, scoredGwCount]), [[11,2,1,1], [22,-2,1,1]]);
  for (const row of result.currentByGw[2].rows) {
    assert.equal([...row.playersIn, ...row.playersOut].reduce((sum, item) => sum + item.contribution, 0), row.net);
  }
});

test('same-GW intermediary scores and round trips stay cancelled in manager totals and individual contributions', () => {
  const result = build([
    transfer('f1', 2, [2], [1]), transfer('f2', 2, [3], [2], {added:'2026-08-12T13:00:00Z'}),
    transfer('f3', 2, [5], [4], {entryId:22}), transfer('f4', 2, [4], [5], {entryId:22, added:'2026-08-12T14:00:00Z'}),
  ], {2:{1:3, 2:999, 3:8, 4:2, 5:999}, 3:{3:500}}, 3);
  assert.deepEqual(result.managerRankingByGw[3].rows.map(({entryId, net, gains, losses, dealCount, scoredGwCount}) => [entryId, net, gains, losses, dealCount, scoredGwCount]), [
    [11,5,5,0,2,1], [22,0,0,0,2,1],
  ]);
  const row = result.currentByGw[2].rows[0];
  assert.deepEqual(row.playersIn.map(({id, contribution}) => [id, contribution]), [[3,8]]);
  assert.deepEqual(row.playersOut.map(({id, contribution}) => [id, contribution]), [[1,-3]]);
});
