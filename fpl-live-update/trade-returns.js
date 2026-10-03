'use strict';

// Deliberately different measures, using only Draft-ID GW scores:
// - currentByGw: each manager's net roster change at that GW's deadline.
// - managerRankingByGw: cumulative currentByGw net, counted only in the
//   transaction's effective GW; later holding points never enter this ranking.
// - acquisitions: raw player points during each post-acquisition holding spell.
// None of these measures claims to be the manager's actual starting-XI contribution.
// The caller supplies normalized, deadline-derived transactions. No I/O here.

function positiveId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function transactionSide(transaction, reverse = false) {
  const incomingKey = reverse ? 'Out' : 'In';
  const outgoingKey = reverse ? 'In' : 'Out';
  const elements = (key) => {
    const ids = transaction[`elements${key}`];
    const raw = Array.isArray(ids) && ids.length ? ids : [transaction[`element${key}`]];
    const normalized = raw.map(positiveId);
    return {
      ids: [...new Set(normalized.filter((id) => id != null))],
      complete: normalized.length > 0 && normalized.every((id) => id != null),
    };
  };
  const metadata = (key) => {
    const list = transaction[`players${key}`];
    const players = Array.isArray(list) && list.length ? list : [transaction[`player${key}`]];
    return new Map(players.filter(Boolean).map((player) => [positiveId(player.id), player]));
  };
  const incoming = elements(incomingKey);
  const outgoing = elements(outgoingKey);
  const inPlayers = metadata(incomingKey);
  const outPlayers = metadata(outgoingKey);
  const playerFor = (id, byId) => byId.get(id) || { id, name: `球员 #${id}` };
  const entryId = positiveId(reverse ? transaction.counterpartyEntryId : transaction.entryId);
  return {
    entryId,
    manager: (reverse ? transaction.counterparty : transaction.manager) || `#${entryId}`,
    incoming: incoming.ids,
    outgoing: outgoing.ids,
    playersIn: incoming.ids.map((id) => playerFor(id, inPlayers)),
    playersOut: outgoing.ids.map((id) => playerFor(id, outPlayers)),
    complete: incoming.complete && outgoing.complete,
  };
}

function buildManagerRankings(currentByGw, managers, throughGw) {
  const ledger = new Map();
  const ensureManager = (entryId, name) => {
    if (!ledger.has(entryId)) ledger.set(entryId, {
      entryId, manager: name || `#${entryId}`, transactionIds: new Set(),
      knownNet: 0, knownGains: 0, knownLosses: 0, scoredGwCount: 0, missingGwCount: 0,
    });
    return ledger.get(entryId);
  };
  // The optional full roster makes inactivity a legitimate zero, including
  // before the first transaction. Do not discover future traders early when
  // callers omit the roster: their first effective-GW row introduces them.
  for (const manager of Array.isArray(managers) ? managers : []) {
    const entryId = positiveId(manager?.entryId);
    if (entryId != null) ensureManager(entryId, manager.entryName || manager.manager || manager.playerName);
  }
  const rankings = {};
  let dealCount = 0;
  for (let asOfGw = 0; asOfGw <= throughGw; asOfGw++) {
    const round = currentByGw[asOfGw];
    if (round) {
      dealCount += round.dealCount;
      for (const row of round.rows) {
        const manager = ensureManager(row.entryId, row.manager);
        for (const id of row.transactionIds) manager.transactionIds.add(String(id));
        if (row.complete && Number.isFinite(row.net)) {
          manager.knownNet += row.net;
          // Gains/losses are the positive/negative effective-GW manager nets,
          // after same-GW intermediary players have already cancelled out.
          manager.knownGains += Math.max(0, row.net);
          manager.knownLosses += Math.min(0, row.net);
          manager.scoredGwCount++;
        } else manager.missingGwCount++;
      }
    }
    const rows = [...ledger.values()].map((manager) => {
      const complete = manager.missingGwCount === 0;
      return {
        entryId: manager.entryId, manager: manager.manager, rank: null,
        net: complete ? manager.knownNet : null,
        gains: complete ? manager.knownGains : null,
        losses: complete ? manager.knownLosses : null,
        dealCount: manager.transactionIds.size,
        scoredGwCount: manager.scoredGwCount,
        missingGwCount: manager.missingGwCount,
        complete,
        // Explicit partial sums are not eligible totals or ranking keys.
        knownNet: manager.knownNet, knownGains: manager.knownGains, knownLosses: manager.knownLosses,
      };
    }).sort((left, right) => Number(right.complete) - Number(left.complete)
      || (left.complete && right.complete ? right.net - left.net : 0)
      || left.entryId - right.entryId);
    rows.forEach((row, index) => {
      if (!row.complete) return;
      row.rank = index > 0 && rows[index - 1].complete && row.net === rows[index - 1].net
        ? rows[index - 1].rank : index + 1;
    });
    const completeCount = rows.filter((row) => row.complete).length;
    const missingCount = rows.length - completeCount;
    rankings[asOfGw] = {
      asOfGw, rows, complete: missingCount === 0, completeCount, missingCount,
      dealCount, // Unique league deals; a direct trade is not counted twice.
    };
  }
  return rankings;
}

function latestScoringGw(livePointsByGw, reportGw, reportLivePayload) {
  // A future/deadline-only live feed often contains hundreds of placeholder
  // zeroes. Actual minutes, a scoring breakdown or non-zero points are evidence
  // that the new round has begun scoring (zero-point appearances still count).
  const currentHasData = Object.values(reportLivePayload?.elements || {}).some((el) =>
    Number(el.stats?.minutes) > 0
    || (Number.isFinite(el.stats?.total_points) && el.stats.total_points !== 0)
    || (Array.isArray(el.explain) && el.explain.length > 0));
  return Math.max(0, ...[...livePointsByGw].filter(([gw, points]) =>
    gw <= reportGw && points.size > 0 && (gw < reportGw || currentHasData)).map(([gw]) => gw));
}

function buildTradeReturns({ transactions = [], livePointsByGw = new Map(), reportGw = 0, scoringGw = reportGw, managers = [] } = {}) {
  const throughGw = Math.max(0, Math.min(38, reportGw, Number.isInteger(scoringGw) ? scoringGw : 0));
  const seenTransactions = new Set();
  const accepted = transactions.filter((transaction) => {
    if (transaction.result !== 'a') return false;
    if (!Number.isInteger(transaction.gw) || transaction.gw < 1 || transaction.gw > 38) return false;
    const key = String(transaction.id);
    if (seenTransactions.has(key)) return false;
    seenTransactions.add(key);
    return true;
  }).slice().sort((left, right) => {
    const leftTime = Date.parse(left.added || '') || 0;
    const rightTime = Date.parse(right.added || '') || 0;
    return left.gw - right.gw || leftTime - rightTime
      || String(left.id).localeCompare(String(right.id), 'en', { numeric: true });
  });
  const byGw = new Map();
  const holding = new Map(); // entryId:elementId -> one acquisition spell
  const spells = [];

  for (const transaction of accepted) {
    const sides = [transactionSide(transaction)];
    if (transaction.kind === 't') sides.push(transactionSide(transaction, true));
    if (!byGw.has(transaction.gw)) byGw.set(transaction.gw, { deals: new Set(), managers: new Map() });
    const round = byGw.get(transaction.gw);
    round.deals.add(String(transaction.id));

    for (const side of sides) {
      if (side.entryId == null) continue;
      if (!round.managers.has(side.entryId)) {
        round.managers.set(side.entryId, {
          entryId: side.entryId, manager: side.manager,
          deals: new Set(), changes: new Map(), players: new Map(), complete: true,
        });
      }
      const manager = round.managers.get(side.entryId);
      manager.deals.add(String(transaction.id));
      manager.complete = manager.complete && side.complete;
      for (const player of [...side.playersIn, ...side.playersOut]) manager.players.set(positiveId(player.id), player);
      // A -> B -> C before one deadline contributes only C - A. The intermediate
      // B must not inflate gross gains, losses, or the acquired-player ranking.
      for (const id of side.incoming) manager.changes.set(id, (manager.changes.get(id) || 0) + 1);
      for (const id of side.outgoing) manager.changes.set(id, (manager.changes.get(id) || 0) - 1);

      // A transfer taking effect in GW N means the old holder cannot receive
      // the player's GW N score. Closing before opening also handles re-entry.
      for (const id of side.outgoing) {
        const key = `${side.entryId}:${id}`;
        const spell = holding.get(key);
        if (spell) {
          spell.releasedGw = transaction.gw;
          holding.delete(key);
        }
      }
      for (const player of side.playersIn) {
        const id = positiveId(player.id);
        const key = `${side.entryId}:${id}`;
        const existing = holding.get(key);
        if (existing) {
          // An unexplained duplicate acquisition is incomplete history, not a
          // reason to credit the same player twice for overlapping rounds.
          existing.releasedGw = transaction.gw;
          existing.integrityComplete = false;
        }
        const spell = {
          id: `${transaction.id}:${side.entryId}:${id}`,
          transactionId: transaction.id,
          entryId: side.entryId,
          manager: side.manager,
          kind: transaction.kind,
          player,
          fromGw: transaction.gw,
          releasedGw: null,
          integrityComplete: side.complete && !existing,
        };
        spells.push(spell);
        holding.set(key, spell);
      }
    }
  }

  const pointsOf = (id, gw) => {
    const points = livePointsByGw.get(gw)?.get(id);
    return Number.isFinite(points) ? points : null;
  };
  const packagePoints = (ids, gw) => {
    const scores = ids.map((id) => pointsOf(id, gw));
    return scores.every((score) => score != null) ? scores.reduce((sum, score) => sum + score, 0) : null;
  };

  const currentByGw = {};
  const latestGw = Math.max(throughGw, 0, ...byGw.keys());
  for (let gw = 1; gw <= latestGw; gw++) {
    const round = byGw.get(gw) || { deals: new Set(), managers: new Map() };
    const pending = gw > throughGw;
    const rows = [...round.managers.values()].map((manager) => {
      const incoming = [...manager.changes].filter(([, count]) => count > 0).map(([id]) => id);
      const outgoing = [...manager.changes].filter(([, count]) => count < 0).map(([id]) => id);
      const consistent = manager.complete && [...manager.changes.values()].every((count) => Math.abs(count) <= 1);
      const inPoints = pending || !consistent ? null : packagePoints(incoming, gw);
      const outPoints = pending || !consistent ? null : packagePoints(outgoing, gw);
      const complete = !pending && inPoints != null && outPoints != null;
      const playerWithContribution = (id, direction) => {
        const gwPoints = pending ? null : pointsOf(id, gw);
        return {
          ...manager.players.get(id),
          gwPoints,
          // Per-player raw score, never an equal share of the package net.
          // A missing peer score does not erase this player's known value;
          // an inconsistent ledger, however, cannot attribute any contribution.
          contribution: consistent && gwPoints != null ? (gwPoints === 0 ? 0 : direction * gwPoints) : null,
        };
      };
      return {
        entryId: manager.entryId,
        manager: manager.manager,
        dealCount: manager.deals.size,
        transactionIds: [...manager.deals],
        playersIn: incoming.map((id) => playerWithContribution(id, 1)),
        playersOut: outgoing.map((id) => playerWithContribution(id, -1)),
        inPoints, outPoints,
        net: complete ? inPoints - outPoints : null,
        complete, pending,
      };
    }).sort((left, right) => Number(right.complete) - Number(left.complete)
      || (right.net ?? 0) - (left.net ?? 0) || left.entryId - right.entryId);
    const completeCount = rows.filter((row) => row.complete).length;
    const missingCount = pending ? 0 : rows.length - completeCount;
    const complete = !pending && missingCount === 0;
    currentByGw[gw] = {
      dealCount: round.deals.size,
      rows,
      gains: complete ? rows.reduce((sum, row) => sum + Math.max(0, row.net), 0) : null,
      losses: complete ? rows.reduce((sum, row) => sum + Math.min(0, row.net), 0) : null,
      net: complete ? rows.reduce((sum, row) => sum + row.net, 0) : null,
      complete, completeCount, missingCount, pending,
    };
  }

  const acquisitions = spells.map((spell) => {
    const toGw = Math.min(throughGw, spell.releasedGw == null ? throughGw : spell.releasedGw - 1);
    const series = [];
    for (let gw = spell.fromGw; gw <= toGw; gw++) series.push({ gw, points: pointsOf(positiveId(spell.player.id), gw) });
    const pending = spell.fromGw > throughGw;
    const complete = !pending && spell.integrityComplete && series.every((item) => item.points != null);
    return {
      ...spell,
      toGw,
      gwCount: series.length,
      points: complete ? series.reduce((sum, item) => sum + item.points, 0) : null,
      complete,
      pending,
      series,
    };
  }).sort((left, right) => Number(right.complete) - Number(left.complete)
    || (right.points ?? 0) - (left.points ?? 0) || right.fromGw - left.fromGw || left.entryId - right.entryId);

  const managerRankingByGw = buildManagerRankings(currentByGw, managers, throughGw);
  // Keep individual accepted operations for the ranking drill-down. Unlike
  // net roster rows, this also retains players moved on again in the same GW.
  // Scores always come from that operation's effective GW, never season totals.
  const transactionDetails = accepted.flatMap((transaction) => {
    const directions = transaction.kind === 't' ? [false, true] : [false];
    return directions.map((reverse) => {
      const side = transactionSide(transaction, reverse);
      if (side.entryId == null) return null;
      const pending = transaction.gw > throughGw;
      const scoredPlayer = (player) => ({
        id: positiveId(player.id), name: player.name || `球员 #${player.id}`,
        gwPoints: pending ? null : pointsOf(positiveId(player.id), transaction.gw),
      });
      const playersIn = side.playersIn.map(scoredPlayer);
      const playersOut = side.playersOut.map(scoredPlayer);
      const inPoints = pending || !side.complete ? null : packagePoints(side.incoming, transaction.gw);
      const outPoints = pending || !side.complete ? null : packagePoints(side.outgoing, transaction.gw);
      const complete = inPoints != null && outPoints != null;
      return {
        transactionId: String(transaction.id), entryId: side.entryId, manager: side.manager,
        gw: transaction.gw, added: transaction.added || null, kind: transaction.kind,
        counterpartyEntryId: transaction.kind === 't'
          ? positiveId(reverse ? transaction.entryId : transaction.counterpartyEntryId) : null,
        counterparty: transaction.kind === 't'
          ? (reverse ? transaction.manager : transaction.counterparty) || null : null,
        playersIn, playersOut, inPoints, outPoints,
        net: complete ? inPoints - outPoints : null, complete, pending,
      };
    }).filter(Boolean);
  });
  return { version: 1, throughGw, currentByGw, acquisitions, managerRankingByGw, transactionDetails };
}

module.exports = { buildTradeReturns, latestScoringGw };
