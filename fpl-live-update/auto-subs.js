'use strict';

// Pure, conservative Draft autosub projection. Points are never recalculated:
// callers sum the existing official Draft total_points using these positions.
// Supply the complete Classic fixture list for the requested GW, not a team's
// subset. Missing/contradictory evidence keeps the official XI unchanged.

const OUTFIELD = new Set(['DEF', 'MID', 'FWD']);

function positionType(player) {
  const value = player?.pos ?? player?.posId ?? player?.element_type;
  if (value === 'GK' || value === 'GKP' || value === 1) return 'GKP';
  if (value === 'DEF' || value === 2) return 'DEF';
  if (value === 'MID' || value === 3) return 'MID';
  if (value === 'FWD' || value === 4) return 'FWD';
  return null;
}

function hasFinished(fixture) {
  return fixture.finished === true || fixture.finished_provisional === true;
}

function validPicks(payload) {
  const picks = payload?.picks;
  if (!Array.isArray(picks) || picks.length !== 15
    || picks.some((pick) => !Number.isSafeInteger(pick.element) || pick.element <= 0
      || !Number.isInteger(pick.position) || pick.position < 1 || pick.position > 15)
    || new Set(picks.map((pick) => pick.element)).size !== 15
    || new Set(picks.map((pick) => pick.position)).size !== 15) {
    throw new TypeError('Autosubs require 15 unique locked Draft picks and positions 1–15');
  }
  return picks;
}

function swap(positions, outgoing, incoming) {
  const oldPosition = positions.get(outgoing);
  positions.set(outgoing, positions.get(incoming));
  positions.set(incoming, oldPosition);
}

function formationCounts(positions, types) {
  const counts = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const [element, position] of positions) {
    if (position > 11) continue;
    const type = types.get(element);
    if (!type) return null;
    counts[type]++;
  }
  return counts;
}

function legalFormation(counts) {
  return counts && counts.GKP === 1
    && counts.DEF >= 3 && counts.DEF <= 5
    && counts.MID >= 2 && counts.MID <= 5
    && counts.FWD >= 1 && counts.FWD <= 3
    && counts.DEF + counts.MID + counts.FWD === 10;
}

function explanationFixtureIds(element) {
  const explain = element?.explain;
  if (explain == null) return [];
  if (!Array.isArray(explain)) return null;
  const ids = [];
  for (const item of explain) {
    const id = Array.isArray(item) ? item[1] : item?.fixture;
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    ids.push(id);
  }
  return [...new Set(ids)];
}

function playerAvailability(player, element, context) {
  const stats = element?.stats;
  if (!player || !stats || !Number.isFinite(stats.minutes) || stats.minutes < 0
    || !Number.isFinite(stats.yellow_cards) || stats.yellow_cards < 0
    || !Number.isFinite(stats.red_cards) || stats.red_cards < 0
    || !Number.isFinite(stats.total_points)) return 'unknown';

  // A player receiving a card without a recorded minute is not an absentee.
  // Keeping their official score also avoids discarding a zero-minute penalty.
  const participated = stats.minutes > 0 || stats.yellow_cards > 0 || stats.red_cards > 0;
  if (!participated && stats.total_points !== 0) return 'unknown';
  if (!context.known) return 'unknown';
  const team = context.teamsByCode.get(player.teamCode);
  if (!team) return 'unknown';

  const explainedIds = explanationFixtureIds(element);
  if (!explainedIds) return 'unknown';
  for (const id of explainedIds) {
    const fixture = context.fixturesById.get(id);
    // Historical/current club metadata can disagree after a real-world
    // transfer. Do not guess the earlier club or remaining DGW fixtures.
    if (!fixture || (fixture.team_h !== team.id && fixture.team_a !== team.id)) return 'unknown';
  }
  const relevant = context.fixtures.filter((fixture) => fixture.team_h === team.id || fixture.team_a === team.id);
  if (context.finished && relevant.some((fixture) => !hasFinished(fixture))) return 'unknown';
  if (participated) return 'played';
  if (relevant.some((fixture) => !hasFinished(fixture))) return 'pending';
  // An empty team schedule is a confirmed blank only when a nonempty complete
  // GW fixture payload and a recognised team were supplied by the caller.
  return 'absent';
}

function fixtureContext(fixtures, teams, gw, finished) {
  const teamRows = teams instanceof Map ? [...teams.values()] : teams;
  const rows = Array.isArray(fixtures) ? fixtures.filter((fixture) => fixture && typeof fixture === 'object' && fixture.event === gw) : [];
  // Do not silently drop a damaged fixture and infer a confirmed blank from
  // the remaining rows. Explicit null is valid for an unscheduled fixture;
  // an omitted/invalid event cannot establish a complete selected-GW feed.
  const completeEventMetadata = Array.isArray(fixtures) && fixtures.every((fixture) =>
    fixture && typeof fixture === 'object' && (fixture.event === null
      || (Number.isInteger(fixture.event) && fixture.event >= 1 && fixture.event <= 38)));
  const known = Number.isInteger(gw) && gw >= 1 && gw <= 38
    && completeEventMetadata
    && Array.isArray(teamRows) && teamRows.length > 0 && rows.length > 0
    && teamRows.every((team) => Number.isInteger(team?.id) && Number.isInteger(team?.code))
    && new Set(teamRows.map((team) => team.id)).size === teamRows.length
    && new Set(teamRows.map((team) => team.code)).size === teamRows.length
    && rows.every((fixture) => Number.isSafeInteger(fixture.id) && fixture.id > 0
      && Number.isInteger(fixture.team_h) && Number.isInteger(fixture.team_a)
      && fixture.team_h !== fixture.team_a && typeof fixture.finished === 'boolean'
      && (fixture.finished_provisional == null || typeof fixture.finished_provisional === 'boolean'))
    && new Set(rows.map((fixture) => fixture.id)).size === rows.length;
  const safeTeams = (Array.isArray(teamRows) ? teamRows : []).filter((team) => team && typeof team === 'object');
  const teamsByCode = new Map(safeTeams.map((team) => [team.code, team]));
  const teamIds = new Set(safeTeams.map((team) => team.id));
  return {
    known: !!known && rows.every((fixture) => teamIds.has(fixture.team_h) && teamIds.has(fixture.team_a)),
    finished: finished === true, fixtures: rows, teamsByCode,
    fixturesById: new Map(rows.map((fixture) => [fixture.id, fixture])),
  };
}

function betterPlan(candidate, current) {
  if (!current || candidate.length !== current.length) return !current || candidate.length > current.length;
  // Maximise legitimate replacements, then prefer the earliest bench players.
  // The priority of a pending candidate is identical to an already-played one.
  for (let index = 0; index < candidate.length; index++) {
    if (candidate[index].benchPosition !== current[index].benchPosition) {
      return candidate[index].benchPosition < current[index].benchPosition;
    }
  }
  return false;
}

function chooseOutfieldPlan(absentees, candidates, counts, types) {
  let best = [];
  function visit(index, remaining, formation, chosen) {
    if (index === candidates.length) {
      if (legalFormation(formation) && betterPlan(chosen, best)) best = chosen;
      return;
    }
    const incoming = candidates[index];
    const incomingType = types.get(incoming.element);
    // Explore the whole combination: a greedy single swap can temporarily
    // violate a formation even when two simultaneous swaps are both legal.
    // Prefer same-position outgoing players only as a deterministic tie-break;
    // this never changes which bench players are selected or consults points.
    const orderedOutgoing = [...remaining].sort((a, b) =>
      Number(types.get(b.element) === incomingType) - Number(types.get(a.element) === incomingType)
      || a.position - b.position);
    for (const outgoing of orderedOutgoing) {
      const nextFormation = { ...formation };
      nextFormation[types.get(outgoing.element)]--;
      nextFormation[incomingType]++;
      visit(index + 1, remaining.filter((item) => item.element !== outgoing.element), nextFormation,
        [...chosen, {
          element_out: outgoing.element, element_in: incoming.element,
          benchPosition: incoming.position, source: 'projected', pending: incoming.availability === 'pending',
        }]);
    }
    visit(index + 1, remaining, formation, chosen);
  }
  visit(0, absentees, counts, []);
  return best;
}

/**
 * Resolve official substitutions and conservative in-GW projections.
 *
 * @param {object} payload Official Draft entry/GW response, never current ownership.
 * @param {Map<number, object>} playersById Draft-ID-keyed snapshot player metadata.
 * @param {object} live Official Draft GW live response (`elements[id].stats/explain`).
 * @param {Array<object>} fixtures Complete Classic fixture payload for this GW.
 * @param {Array<object>|Map<number,object>} teams Classic teams with stable `code`.
 * @param {{gw:number, finished?:boolean}} options Selected GW, not next/report GW by inference.
 * @returns {{positions:Map<number,number>,substitutions:Array<object>,provisional:boolean}}
 *
 * Every projected replacement stays provisional until the official picks/subs
 * confirm it. `pending` means the chosen bench player has no appearance/card
 * yet and still has a fixture; reserve that priority without projecting points.
 * Call this afresh on the original official payload on every refresh. Do not
 * feed last response's projected positions back as if they were official picks.
 */
function resolveAutoSubs(payload, playersById, live, fixtures, teams, { gw, finished = false } = {}) {
  const picks = validPicks(payload);
  const positions = new Map(picks.map((pick) => [pick.element, pick.position]));
  const substitutions = [];
  const officialTouched = new Set();
  const officialPairs = new Set();
  const official = [
    ...(Array.isArray(payload.subs) ? payload.subs : []),
    ...(Array.isArray(payload.automatic_subs) ? payload.automatic_subs : []),
  ];
  for (const sub of official) {
    const outgoing = positions.get(sub?.element_out);
    const incoming = positions.get(sub?.element_in);
    const key = `${sub?.element_out}:${sub?.element_in}`;
    if (outgoing == null || incoming == null || sub.element_out === sub.element_in || officialPairs.has(key)) continue;
    if (outgoing <= 11 && incoming > 11) swap(positions, sub.element_out, sub.element_in);
    else if (!(outgoing > 11 && incoming <= 11)) continue;
    officialPairs.add(key);
    officialTouched.add(sub.element_out);
    officialTouched.add(sub.element_in);
    substitutions.push({ element_out: sub.element_out, element_in: sub.element_in, source: 'official', pending: false });
  }
  const result = () => ({ positions, substitutions, provisional: substitutions.some((sub) => sub.source === 'projected') });
  if (!(playersById instanceof Map)) return result();
  const types = new Map(picks.map((pick) => [pick.element, positionType(playersById.get(pick.element))]));
  const counts = formationCounts(positions, types);
  if (!legalFormation(counts)) return result();
  const context = fixtureContext(fixtures, teams, gw, finished);
  if (!context.known) return result();
  const availability = new Map(picks.map((pick) => [pick.element,
    playerAvailability(playersById.get(pick.element), live?.elements?.[pick.element], context)]));
  const ordered = [...positions].map(([element, position]) => ({ element, position, availability: availability.get(element) }))
    .sort((a, b) => a.position - b.position);
  const absent = ordered.filter((pick) => pick.position <= 11 && pick.availability === 'absent' && !officialTouched.has(pick.element));
  const bench = ordered.filter((pick) => pick.position > 11 && !officialTouched.has(pick.element));

  // Goalkeepers have a separate substitution channel, never an outfield slot.
  const absentKeeper = absent.find((pick) => types.get(pick.element) === 'GKP');
  const benchKeeper = bench.find((pick) => types.get(pick.element) === 'GKP');
  if (absentKeeper && benchKeeper && ['played', 'pending'].includes(benchKeeper.availability)) {
    swap(positions, absentKeeper.element, benchKeeper.element);
    substitutions.push({ element_out: absentKeeper.element, element_in: benchKeeper.element,
      source: 'projected', pending: benchKeeper.availability === 'pending' });
  }

  const outfieldAbsentees = absent.filter((pick) => OUTFIELD.has(types.get(pick.element)));
  const candidates = [];
  for (const pick of bench) {
    if (types.get(pick.element) === 'GKP') continue;
    // Unknown earlier bench evidence cannot justify promoting a lower bench
    // player past it. Wait for the feed rather than assume it is a non-player.
    if (!OUTFIELD.has(types.get(pick.element)) || pick.availability === 'unknown') break;
    if (pick.availability === 'played' || pick.availability === 'pending') candidates.push(pick);
  }
  const plan = chooseOutfieldPlan(outfieldAbsentees, candidates, counts, types);
  for (const { benchPosition, ...sub } of plan) {
    swap(positions, sub.element_out, sub.element_in);
    substitutions.push(sub);
  }
  return result();
}

module.exports = { resolveAutoSubs };
