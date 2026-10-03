'use strict';

// Ownership is independent of scoring: official GW picks lock all 15 players,
// while a Team of the Week may still change as live/final points are corrected.
const SCHEMA = 1;
const SOURCE = 'draft-event-picks';
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function id(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function timestamp(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  return typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
}

function identity(context) {
  if (!object(context)) return null;
  const leagueId = id(context.leagueId);
  const gw = id(context.gw);
  const season = typeof context.season === 'string' && /^(\d{4})\/(\d{2})$/.exec(context.season);
  const deadline = timestamp(context.deadline);
  if (!leagueId || !gw || gw > 38 || !season || !Number.isFinite(deadline)) return null;
  const startYear = Number(season[1]);
  if (Number(season[2]) !== (startYear + 1) % 100
    || deadline < Date.UTC(startYear, 6, 1) || deadline >= Date.UTC(startYear + 1, 6, 1)) return null;
  return { leagueId, season: context.season, gw, deadline: new Date(deadline).toISOString() };
}

function expectedEntries(entries) {
  if (!Array.isArray(entries) || !entries.length) return null;
  const byEntry = new Map();
  const leagueEntryIds = new Set();
  for (const entry of entries) {
    const entryId = id(entry?.entry_id);
    const leagueEntryId = id(entry?.id);
    if (!entryId || !leagueEntryId || byEntry.has(entryId) || leagueEntryIds.has(leagueEntryId)) return null;
    byEntry.set(entryId, { entry, entryId, leagueEntryId });
    leagueEntryIds.add(leagueEntryId);
  }
  return byEntry;
}

function validPicks(picks) {
  if (!Array.isArray(picks) || picks.length !== 15) return false;
  const elements = new Set();
  const positions = new Set();
  for (const pick of picks) {
    const element = id(pick?.element);
    const position = id(pick?.position);
    if (!element || !position || position > 15 || elements.has(element) || positions.has(position)) return false;
    elements.add(element);
    positions.add(position);
  }
  return true;
}

function payloadMatches(payload, entryId, gw) {
  if (!object(payload)) return false;
  for (const value of [payload.entry, payload.entry_id, payload.entry_history?.entry, payload.entry_history?.entry_id]) {
    if (value !== undefined && id(value) !== entryId) return false;
  }
  for (const value of [payload.event, payload.gw, payload.entry_history?.event]) {
    if (value !== undefined && id(value) !== gw) return false;
  }
  for (const field of ['subs', 'automatic_subs']) {
    if (payload[field] === undefined) continue;
    if (!Array.isArray(payload[field])) return false;
    for (const substitution of payload[field]) {
      if (!object(substitution) || (substitution.event !== undefined && id(substitution.event) !== gw)) return false;
    }
  }
  return true;
}

/**
 * picksByEntry: Map<entry_id, { entryId, gw, payload, leagueId? }>.
 * The envelope must describe the actual request, not the desired fallback GW.
 * Any incomplete/ambiguous source returns null, never a partly-free owner map.
 */
function buildOwnershipSnapshot(context) {
  const key = identity(context);
  const entries = expectedEntries(context?.entries);
  const now = timestamp(context?.now ?? Date.now());
  if (!key || !entries || !Number.isFinite(now) || now < timestamp(key.deadline)
    || !(context.picksByEntry instanceof Map) || context.picksByEntry.size !== entries.size) return null;
  const managers = [];
  const owners = {};
  for (const { entry, entryId, leagueEntryId } of entries.values()) {
    const envelope = context.picksByEntry.get(entryId);
    if (!object(envelope) || id(envelope.entryId) !== entryId || id(envelope.gw) !== key.gw
      || (envelope.leagueId !== undefined && id(envelope.leagueId) !== key.leagueId)
      || !payloadMatches(envelope.payload, entryId, key.gw) || !validPicks(envelope.payload.picks)
      || typeof entry.entry_name !== 'string') return null;
    const picks = envelope.payload.picks.map((pick) => ({ element: id(pick.element), position: id(pick.position) }))
      .sort((a, b) => a.position - b.position);
    for (const pick of picks) {
      if (own(owners, pick.element)) return null;
      owners[pick.element] = entryId;
    }
    // Preserve source text, not HTML. Renderers must escape this historical name
    // just as they escape other manager names; escaping here would double-encode.
    managers.push({ entryId, leagueEntryId, ownerName: entry.entry_name || `#${entryId}`, picks });
  }
  return {
    schema: SCHEMA, source: SOURCE, status: 'locked', ...key,
    lockedAt: key.deadline, capturedAt: new Date(now).toISOString(), managers, owners,
  };
}

/** Validate persisted content against its league/season/GW/deadline before use. */
function isValidOwnershipSnapshot(snapshot, context = snapshot) {
  const key = identity(context);
  const actual = identity(snapshot);
  const now = timestamp(context?.now ?? Date.now());
  if (!key || !actual || !Number.isFinite(now) || snapshot.schema !== SCHEMA || snapshot.source !== SOURCE
    || snapshot.status !== 'locked' || snapshot.lockedAt !== actual.deadline
    || !['leagueId', 'season', 'gw', 'deadline'].every((field) => key[field] === actual[field])
    || snapshot.leagueId !== actual.leagueId || snapshot.gw !== actual.gw || snapshot.deadline !== actual.deadline
    || !Number.isFinite(timestamp(snapshot.capturedAt)) || timestamp(snapshot.capturedAt) < timestamp(actual.deadline)
    || timestamp(snapshot.capturedAt) > now || !Array.isArray(snapshot.managers) || !snapshot.managers.length
    || !object(snapshot.owners)) return false;
  const entries = context?.entries === undefined ? null : expectedEntries(context.entries);
  if (context?.entries !== undefined && (!entries || entries.size !== snapshot.managers.length)) return false;
  const entryIds = new Set();
  const leagueEntryIds = new Set();
  const elements = new Set();
  for (const manager of snapshot.managers) {
    if (!object(manager) || !id(manager.entryId) || !id(manager.leagueEntryId)
      || typeof manager.entryId !== 'number' || typeof manager.leagueEntryId !== 'number'
      || entryIds.has(manager.entryId) || leagueEntryIds.has(manager.leagueEntryId)
      || typeof manager.ownerName !== 'string' || !manager.ownerName.length || !validPicks(manager.picks)
      || (entries && entries.get(manager.entryId)?.leagueEntryId !== manager.leagueEntryId)) return false;
    entryIds.add(manager.entryId);
    leagueEntryIds.add(manager.leagueEntryId);
    for (const pick of manager.picks) {
      if (elements.has(pick.element) || typeof pick.element !== 'number' || typeof pick.position !== 'number'
        || !own(snapshot.owners, pick.element) || snapshot.owners[pick.element] !== manager.entryId) return false;
      elements.add(pick.element);
    }
  }
  return Object.keys(snapshot.owners).length === elements.size;
}

/** Callers must context-validate caches first; null safely removes current owners. */
function applyOwnership(team, snapshot) {
  if (!object(team)) return team;
  const valid = isValidOwnershipSnapshot(snapshot);
  const managers = new Map(valid ? snapshot.managers.map((manager) => [manager.entryId, manager.ownerName]) : []);
  return {
    ...team,
    ownership: valid
      ? { status: 'locked', gw: snapshot.gw, lockedAt: snapshot.lockedAt, capturedAt: snapshot.capturedAt, source: SOURCE }
      : { status: 'unavailable' },
    players: (Array.isArray(team.players) ? team.players : []).map((player) => {
      const element = id(player?.id);
      const known = valid && element !== null;
      const owner = known && own(snapshot.owners, element) ? snapshot.owners[element] : null;
      return {
        ...player, owner, ownerName: owner === null ? null : managers.get(owner),
        ownershipStatus: !known ? 'unknown' : owner === null ? 'free' : 'owned',
      };
    }),
  };
}

function ownershipCacheKey(context) {
  const key = identity(context);
  return key ? `totw-ownership-v${SCHEMA}-league${key.leagueId}-season${key.season.replace('/', '-')}-gw${key.gw}.json` : null;
}

module.exports = { SCHEMA, SOURCE, buildOwnershipSnapshot, isValidOwnershipSnapshot, applyOwnership, ownershipCacheKey };
