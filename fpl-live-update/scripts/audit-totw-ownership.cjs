#!/usr/bin/env node
'use strict';

// Read-only independent audit. No application imports, cache writes or transaction
// reconstruction: ownership comes only from complete official event picks.
// Usage: node scripts/audit-totw-ownership.cjs [snapshot.json] [1,2,3]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const positiveId = value => Number.isSafeInteger(value) && value > 0;
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function main() {
  const snapshotPath = path.resolve(process.argv[2] || path.join(__dirname, '../data/snapshot.json'));
  const snapshotBytes = fs.readFileSync(snapshotPath);
  const snapshot = JSON.parse(snapshotBytes);
  const leagueId = snapshot.meta?.leagueId;
  const gameweeks = (process.argv[3] || '1,2,3').split(',').map(Number);
  assert(positiveId(leagueId), 'Snapshot leagueId is invalid');
  assert(gameweeks.length && gameweeks.every(gw => positiveId(gw) && gw <= 38), 'Invalid gameweeks');
  assert(new Set(gameweeks).size === gameweeks.length, 'Duplicate gameweeks');
  const requestFailures = [];
  const sourceRecords = [];
  async function getJson(apiPath) {
    const url = `https://draft.premierleague.com/api${apiPath}`;
    const started = new Date().toISOString();
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      assert(response.ok, `HTTP ${response.status}`);
      const body = await response.json();
      sourceRecords.push({ url, fetchedAt: started, keys: Object.keys(body) });
      return body;
    } catch (error) {
      requestFailures.push({ url, error: error.message });
      throw error;
    }
  }
  const [league, status] = await Promise.all([
    getJson(`/league/${leagueId}/details`),
    getJson(`/league/${leagueId}/element-status`),
  ]);
  assert(league.league?.id === leagueId, 'Official response league mismatch');
  const entries = league.league_entries;
  assert(Array.isArray(entries) && entries.length > 0, 'Missing official league entries');
  const entryIds = entries.map(e => e.entry_id);
  assert(entryIds.every(positiveId) && new Set(entryIds).size === entries.length, 'Invalid/duplicate official entry IDs');
  const oldEntryIds = new Set(snapshot.managers.map(m => m.entryId));
  assert(oldEntryIds.size === entries.length && entryIds.every(id => oldEntryIds.has(id)), 'Snapshot and official manager coverage differs');
  const names = new Map(entries.map(e => [e.entry_id, e.entry_name]));
  const ownerName = id => id == null ? '自由球员' : (names.get(id) || `未知经理 ${id}`);
  const players = new Map(snapshot.players.map(p => [p.id, p]));
  assert(Array.isArray(status.element_status), 'Missing current element_status');
  const currentOwners = new Map();
  for (const p of status.element_status) {
    assert(positiveId(p.element) && !currentOwners.has(p.element), 'Invalid/duplicate current element');
    assert(p.owner === null || names.has(p.owner), `Unknown current owner of ${p.element}`);
    currentOwners.set(p.element, p.owner);
  }

  const tasks = gameweeks.flatMap(gw => entries.map(entry => ({ gw, entry })));
  const loaded = new Map();
  const validationFailures = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, tasks.length) }, async () => {
    while (next < tasks.length) {
      const { gw, entry } = tasks[next++];
      try {
        const data = await getJson(`/entry/${entry.entry_id}/event/${gw}`);
        assert(Array.isArray(data.picks) && data.picks.length === 15, 'Expected exactly 15 picks (including bench)');
        const elements = data.picks.map(p => p.element);
        const positions = data.picks.map(p => p.position);
        assert(elements.every(id => positiveId(id) && players.has(id)), 'Invalid or unknown pick element');
        assert(new Set(elements).size === 15, 'Duplicate player within squad');
        assert(new Set(positions).size === 15 && positions.every(p => positiveId(p) && p <= 15), 'Positions must cover 1–15');
        for (const value of [data.event, data.entry_history?.event, ...(data.subs || []).map(s => s.event)]) {
          if (value != null) assert(value === gw, `GW metadata mismatch: ${value} != ${gw}`);
        }
        for (const value of [data.entry, data.entry_id, data.entry_history?.entry]) {
          if (value != null) assert(value === entry.entry_id, 'Entry metadata mismatch');
        }
        loaded.set(`${gw}:${entry.entry_id}`, data);
      } catch (error) {
        validationFailures.push({ gw, entryId: entry.entry_id, error: error.message });
      }
    }
  }));

  const summary = [];
  const differences = [];
  const currentVsHistorical = [];
  const totwOwnership = [];
  const metadataShapes = new Map();
  for (const gw of gameweeks) {
    const complete = entries.every(e => loaded.has(`${gw}:${e.entry_id}`));
    // Missing squads must never silently classify absent players as free agents.
    if (!complete) { summary.push({ gw, complete: false }); continue; }
    const historicalOwners = new Map();
    for (const entry of entries) {
      const data = loaded.get(`${gw}:${entry.entry_id}`);
      const shape = {
        response: Object.keys(data).sort(),
        pick: Object.keys(data.picks[0]).sort(),
        entryHistory: Object.keys(data.entry_history || {}).sort(),
        subs: data.subs?.length ? Object.keys(data.subs[0]).sort() : [],
      };
      metadataShapes.set(JSON.stringify(shape), shape);
      for (const p of data.picks) {
        assert(!historicalOwners.has(p.element), `GW${gw}: duplicate owned player ${p.element} across managers`);
        historicalOwners.set(p.element, entry.entry_id);
      }
    }
    const totw = snapshot.totwByGw?.[gw]?.players;
    assert(Array.isArray(totw) && totw.length === 11 && new Set(totw.map(p => p.id)).size === 11, `GW${gw}: expected 11 unique TOTW players`);
    let freeAgents = 0;
    let changed = 0;
    for (const p of totw) {
      const historicalOwner = historicalOwners.get(p.id) ?? null;
      assert(currentOwners.has(p.id), `Current status missing TOTW player ${p.id}`);
      if (historicalOwner === null) freeAgents++;
      const row = {
        gw, playerId: p.id, player: p.name, gwPoints: p.gwPoints,
        oldOwner: p.owner ?? null, oldOwnerName: ownerName(p.owner),
        historicalOwner, historicalOwnerName: ownerName(historicalOwner),
        currentOwner: currentOwners.get(p.id), currentOwnerName: ownerName(currentOwners.get(p.id)),
      };
      totwOwnership.push(row);
      if ((p.owner ?? null) !== historicalOwner) { changed++; differences.push(row); }
    }
    for (const [id, currentOwner] of currentOwners) {
      const historicalOwner = historicalOwners.get(id) ?? null;
      if (currentOwner !== historicalOwner) currentVsHistorical.push({
        gw, playerId: id, player: players.get(id)?.name ?? `#${id}`,
        historicalOwner, historicalOwnerName: ownerName(historicalOwner),
        currentOwner, currentOwnerName: ownerName(currentOwner),
      });
    }
    summary.push({ gw, complete: true, managers: entries.length, picks: historicalOwners.size, totwPlayers: totw.length, historicalFreeAgents: freeAgents, ownerCorrections: changed, allPlayersOwnerChanges: currentVsHistorical.filter(p => p.gw === gw).length });
  }
  console.log(JSON.stringify({
    leagueId, snapshotPath, snapshotUpdated: snapshot.meta.updated,
    snapshotSha256: crypto.createHash('sha256').update(snapshotBytes).digest('hex'),
    auditedAt: new Date().toISOString(), requestCount: sourceRecords.length + requestFailures.length,
    requestFailures, validationFailures, metadataShapes: [...metadataShapes.values()],
    summary, differences, totwOwnership, currentVsHistorical, sources: sourceRecords,
  }, null, 2));
  if (requestFailures.length || validationFailures.length) process.exitCode = 1;
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
