'use strict';

const { resolveAutoSubs } = require('./auto-subs');

class MatchDetailError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const unavailable = (message) => new MatchDetailError(502, 'MATCH_DATA_UNAVAILABLE', message);

// FPL can leave `finished` false after the football match has ended while it
// settles scoring. Remaining appearances follow full time, not that delay.
function fixtureHasFinished(fixture) {
  return fixture.finished === true || fixture.finished_provisional === true;
}

function fixtureState(fixture) {
  return {
    started: fixture.started,
    finished: fixtureHasFinished(fixture),
    settled: fixture.finished === true,
  };
}

function validateGameweekFixtures(fixtures, gw, teams) {
  if (!Array.isArray(fixtures)) throw unavailable('该轮官方赛程暂时不可用');
  // Validate original event metadata before filtering. A row with a missing
  // or invalid event may be this GW's omitted fixture; silently dropping it
  // can turn a team's pending game into a false blank and trigger an autosub.
  // Official event:null fixtures are explicitly unassigned, not missing data.
  if (fixtures.some((fixture) => !fixture || typeof fixture !== 'object' || Array.isArray(fixture)
    || !Object.hasOwn(fixture, 'event')
    || (fixture.event !== null && (!Number.isInteger(fixture.event) || fixture.event < 1 || fixture.event > 38)))) {
    throw unavailable('官方赛程轮次信息暂时不完整，不能确认自动替补');
  }
  const rows = fixtures.filter((fixture) => fixture?.event === gw);
  const teamIds = Array.isArray(teams) ? new Set(teams.map((team) => team.id)) : null;
  if (!rows.length || new Set(rows.map((fixture) => fixture.id)).size !== rows.length
    || rows.some((fixture) => !Number.isSafeInteger(fixture.id) || fixture.id <= 0
      || !Number.isSafeInteger(fixture.team_h) || !Number.isSafeInteger(fixture.team_a)
      || fixture.team_h === fixture.team_a
      || (teamIds && (!teamIds.has(fixture.team_h) || !teamIds.has(fixture.team_a)))
      || typeof fixture.started !== 'boolean' || typeof fixture.finished !== 'boolean'
      || (fixture.finished_provisional != null && typeof fixture.finished_provisional !== 'boolean'))) {
    throw unavailable('官方赛程状态暂时不完整，不能确认自动替补');
  }
  return rows;
}

function validateMatchRequest(snapshot, leagueId, gw, entry1Id, entry2Id, now = Date.now()) {
  if (![leagueId, gw, entry1Id, entry2Id].every((id) => Number.isSafeInteger(id) && id > 0) || gw > 38 || entry1Id === entry2Id) {
    throw new MatchDetailError(400, 'INVALID_MATCH_REQUEST', '对阵参数无效');
  }
  if (snapshot?.meta?.leagueId !== leagueId) throw new MatchDetailError(404, 'LEAGUE_NOT_FOUND', '没有找到这个 Draft 联赛');
  const event = (snapshot.events || []).find((item) => item.id === gw);
  const deadline = Date.parse(event?.deadline || '');
  if (!event || gw > snapshot.meta.reportGw || !Number.isFinite(deadline) || deadline > now) {
    throw new MatchDetailError(400, 'FUTURE_GAMEWEEK', '只能查看已开始的比赛周');
  }
  const managers = new Map((snapshot.managers || []).map((manager) => [manager.entryId, manager]));
  if (!managers.has(entry1Id) || !managers.has(entry2Id)) throw new MatchDetailError(404, 'MATCH_NOT_FOUND', '未找到这个联赛的对阵');
  const match = (snapshot.h2hByGw?.[gw] || []).find((item) =>
    (item.entry1Id === entry1Id && item.entry2Id === entry2Id)
    || (item.entry1Id === entry2Id && item.entry2Id === entry1Id));
  if (!match) throw new MatchDetailError(404, 'MATCH_NOT_FOUND', '这两名玩家在所选比赛周没有对阵');
  return { managers: [managers.get(entry1Id), managers.get(entry2Id)], event, match };
}

function effectivePositions(payload) {
  const picks = payload?.picks;
  if (!Array.isArray(picks) || picks.length !== 15
    || new Set(picks.map((pick) => pick.element)).size !== 15
    || new Set(picks.map((pick) => pick.position)).size !== 15
    || picks.some((pick) => !Number.isInteger(pick.element) || !Number.isInteger(pick.position) || pick.position < 1 || pick.position > 15)) {
    throw unavailable('官方尚未提供完整的该轮锁定阵容');
  }
  const positions = new Map(picks.map((pick) => [pick.element, pick.position]));
  for (const sub of payload.subs || payload.automatic_subs || []) {
    const outgoing = positions.get(sub.element_out);
    const incoming = positions.get(sub.element_in);
    // Official Draft usually already exchanges pick positions. Only complete
    // a documented, not-yet-applied swap. Rule-based projections are handled
    // separately by resolveAutoSubs, without mutating this official payload.
    if (outgoing <= 11 && incoming > 11) {
      positions.set(sub.element_in, outgoing);
      positions.set(sub.element_out, incoming);
    }
  }
  return positions;
}

function appearanceStatus(minutes, fixtures, activeAppearance = false) {
  if (!Number.isFinite(minutes)) return 'unknown';
  // "playing" confirms an appearance in a fixture that is still underway,
  // not that the player remains on the pitch (they may have been subbed off).
  if (minutes > 0) return activeAppearance ? 'playing' : 'played';
  if (!fixtures.length) return 'blank';
  if (fixtures.every((fixture) => fixture.finished)) return 'dnp';
  if (fixtures.some((fixture) => fixture.started && !fixture.finished)) return 'waiting';
  return 'pending';
}

function fixtureAppearanceMinutes(explain) {
  const minutes = new Map();
  for (const item of Array.isArray(explain) ? explain : []) {
    const fixtureId = Array.isArray(item) ? item[1] : item?.fixture;
    const stats = Array.isArray(item) ? item[0] : item?.stats;
    if (!Number.isInteger(fixtureId) || !Array.isArray(stats)) continue;
    const entry = stats.find((stat) => (stat?.stat || stat?.identifier) === 'minutes');
    if (Number.isFinite(entry?.value) && entry.value >= 0) minutes.set(fixtureId, entry.value);
  }
  return minutes;
}

function buildMatchDetail({ snapshot, leagueId, gw, entry1Id, entry2Id, picks, live, fixtures, teams, lineups, now = Date.now() }) {
  const { managers, event } = validateMatchRequest(snapshot, leagueId, gw, entry1Id, entry2Id, now);
  if (!Array.isArray(fixtures) || !Array.isArray(teams) || !live?.elements || typeof live.elements !== 'object') {
    throw unavailable('该轮官方得分或赛程暂时不可用');
  }
  const gwFixtures = validateGameweekFixtures(fixtures, gw, teams);
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const teamsByCode = new Map(teams.map((team) => [team.code, team]));
  const playersById = new Map((snapshot.players || []).map((player) => [player.id, player]));
  const finished = !!event.finished || (gwFixtures.length > 0 && gwFixtures.every(fixtureHasFinished))
    || (gw < snapshot.meta.reportGw && gw <= snapshot.meta.lastFinishedGw);
  const sides = managers.map((manager) => {
    const payload = picks.get(manager.entryId);
    effectivePositions(payload); // Require the complete, locked fifteen.
    const lineup = lineups?.get(manager.entryId)
      || resolveAutoSubs(payload, playersById, live, gwFixtures, teams, { gw, finished });
    const { positions } = lineup;
    const players = [...positions].map(([id, position]) => {
      const player = playersById.get(id);
      const stats = live.elements[id]?.stats;
      if (!player || !Number.isFinite(stats?.total_points) || !Number.isFinite(stats?.minutes) || stats.minutes < 0) {
        throw unavailable('部分球员的该轮得分或出场时间暂时缺失');
      }
      const team = teamsByCode.get(player.teamCode);
      if (!team) throw unavailable('部分球员的球队赛程暂时无法核对');
      // A player may since have changed real-world clubs. Recorded fixture IDs
      // come from this GW's Draft explanation, unlike the current player master.
      const explainedIds = [...new Set((live.elements[id].explain || []).map((item) =>
        Array.isArray(item) ? item[1] : item.fixture).filter(Number.isInteger))];
      const explainedFixtures = explainedIds.map((fixtureId) => gwFixtures.find((fixture) => fixture.id === fixtureId));
      if (explainedFixtures.some((fixture) => !fixture)) throw unavailable('球员得分明细与本轮赛程暂时无法对应');
      const fixtureTeamUnknown = explainedFixtures.some((fixture) => fixture.team_h !== team.id && fixture.team_a !== team.id);
      if (fixtureTeamUnknown && !finished) throw unavailable('球员转队后的本轮剩余赛程暂时无法核对');
      const relevantFixtures = fixtureTeamUnknown ? explainedFixtures
        : gwFixtures.filter((fixture) => fixture.team_h === team.id || fixture.team_a === team.id);
      const minutesByFixture = fixtureAppearanceMinutes(live.elements[id].explain);
      const activeAppearance = relevantFixtures.some((fixture) => {
        if (!fixture.started || fixtureHasFinished(fixture)) return false;
        if (minutesByFixture.has(fixture.id)) return minutesByFixture.get(fixture.id) > 0;
        // Only a single-fixture GW allows total GW minutes to establish which
        // match was played. A past DGW appearance must not light up game two.
        return relevantFixtures.length === 1 && stats.minutes > 0;
      });
      const playerFixtures = relevantFixtures.map((fixture) => {
        if (fixtureTeamUnknown) {
          const homeTeam = teamsById.get(fixture.team_h);
          const awayTeam = teamsById.get(fixture.team_a);
          if (!homeTeam || !awayTeam) throw unavailable('部分比赛的对手信息暂时缺失');
          return {
            opponent: `${homeTeam.short_name || homeTeam.name}–${awayTeam.short_name || awayTeam.name}`,
            home: null, ...fixtureState(fixture),
          };
        }
        const home = fixture.team_h === team.id;
        const opponent = teamsById.get(home ? fixture.team_a : fixture.team_h);
        if (!opponent) throw unavailable('部分比赛的对手信息暂时缺失');
        return { opponent: opponent.short_name || opponent.name, home, ...fixtureState(fixture) };
      });
      return {
        id, name: player.name, team: player.team, teamName: player.teamName, teamCode: player.teamCode,
        pos: player.pos, position, countsForTeam: position <= 11,
        points: stats.total_points, minutes: stats.minutes,
        status: appearanceStatus(stats.minutes, playerFixtures, activeAppearance),
        yellowCards: Number.isFinite(stats.yellow_cards) ? stats.yellow_cards : null,
        redCards: Number.isFinite(stats.red_cards) ? stats.red_cards : null,
        ...(fixtureTeamUnknown ? { fixtureTeamUnknown: true, teamMetadataNote: '已转队：球衣为当前球队，所列对阵来自该轮得分记录' } : {}),
        fixtures: playerFixtures,
      };
    }).sort((a, b) => a.position - b.position);
    const starting = players.filter((player) => player.countsForTeam);
    const countPosition = (position) => starting.filter((player) => player.pos === position).length;
    return {
      entryId: manager.entryId, entryName: manager.entryName, playerName: manager.playerName,
      score: starting.reduce((total, player) => total + player.points, 0),
      playedCount: starting.filter((player) => player.minutes > 0).length,
      remainingCount: starting.filter((player) => player.fixtures.some((fixture) => !fixture.finished)).length,
      startingCount: starting.length,
      benchPoints: players.filter((player) => !player.countsForTeam).reduce((total, player) => total + player.points, 0),
      formation: `${countPosition('DEF')}-${countPosition('MID')}-${countPosition('FWD')}`,
      substitutions: lineup.substitutions,
      provisional: lineup.provisional,
      players,
    };
  });
  return {
    leagueId, leagueName: snapshot.meta.leagueName, gw,
    updated: new Date(now).toISOString(), live: !finished, finished,
    finalizing: finished && !(event.finished && event.dataChecked !== false), autoSubsVersion: 1,
    sides,
  };
}

function createMatchDetailService({ getSnapshot, fetchJson, draftApi, classicApi, now = Date.now, maxEntries = 64, maxInFlight = 8, ttlMs = 60_000 }) {
  const cache = new Map();
  const inFlight = new Map();
  const resources = new Map();
  const resourceFlights = new Map();
  const freshTtlMs = Math.min(60_000, Math.max(1, ttlMs));
  const maxResourceEntries = Math.max(16, maxEntries * 4);
  const maxResourceInFlight = Math.max(5, maxInFlight * 5);
  const ordered = (detail, entry1Id) => detail.sides[0].entryId === entry1Id ? detail : { ...detail, sides: [...detail.sides].reverse() };
  const detailKey = (leagueId, gw, ids) => `${leagueId}:${gw}:${[...ids].sort((a, b) => a - b).join(':')}`;

  function remember(key, detail, expiresAt) {
    const previous = cache.get(key);
    // A slow, in-flight request must not undo a newer refresh's precomputed
    // lineup. Both paths use the oldest scoring-source timestamp.
    if (previous && (Date.parse(previous.detail.updated) > Date.parse(detail.updated)
      || (previous.detail.updated === detail.updated && !previous.detail.stale && detail.stale))) return previous.detail;
    cache.delete(key);
    cache.set(key, { detail, expiresAt });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
    return detail;
  }

  function prime(snapshot) {
    if (snapshot?.meta?.stale || !Array.isArray(snapshot?.matchDetails)) return;
    for (const detail of snapshot.matchDetails) {
      if (detail?.autoSubsVersion !== 1 || detail.leagueId !== snapshot.meta.leagueId
        || detail.gw !== snapshot.meta.reportGw || !Array.isArray(detail.sides) || detail.sides.length !== 2) continue;
      const ids = detail.sides.map((side) => side.entryId);
      const updated = Date.parse(detail.updated || '');
      if (!Number.isFinite(updated) || updated > now() || detail.sides.some((side) => !Array.isArray(side.players) || side.players.length !== 15)) continue;
      try { validateMatchRequest(snapshot, detail.leagueId, detail.gw, ids[0], ids[1], now()); }
      catch (_) { continue; }
      remember(detailKey(detail.leagueId, detail.gw, ids), detail, detail.stale ? updated : updated + freshTtlMs);
    }
  }

  async function resource(url, lifetime, select = (value) => value) {
    const previous = resources.get(url);
    if (previous && now() < previous.expiresAt) {
      resources.delete(url);
      resources.set(url, previous);
      return previous;
    }
    if (resourceFlights.has(url)) return resourceFlights.get(url);
    // Keep an independent hard bound: a rejected Promise.all can release its
    // match slot while the other upstream requests are still finishing.
    if (resourceFlights.size >= maxResourceInFlight) {
      throw new MatchDetailError(429, 'MATCH_LOOKUP_BUSY', '对阵查询繁忙，请稍后重试');
    }
    const task = (async () => {
      const requestedAt = now();
      const value = select(await fetchJson(url));
      const result = { value, requestedAt, expiresAt: requestedAt + lifetime };
      resources.delete(url);
      resources.set(url, result);
      while (resources.size > maxResourceEntries) resources.delete(resources.keys().next().value);
      return result;
    })().finally(() => resourceFlights.delete(url));
    resourceFlights.set(url, task);
    return task;
  }

  async function get(leagueId, gw, entry1Id, entry2Id) {
    if (![leagueId, gw, entry1Id, entry2Id].every((id) => Number.isSafeInteger(id) && id > 0) || gw > 38 || entry1Id === entry2Id) {
      throw new MatchDetailError(400, 'INVALID_MATCH_REQUEST', '对阵参数无效');
    }
    const sorted = [entry1Id, entry2Id].sort((a, b) => a - b);
    const key = `${leagueId}:${gw}:${sorted.join(':')}`;
    const cached = cache.get(key);
    const old = cached?.detail;
    if (cached && now() < cached.expiresAt) {
      cache.delete(key);
      cache.set(key, cached);
      return ordered(old, entry1Id);
    }
    if (inFlight.has(key)) return ordered(await inFlight.get(key), entry1Id);
    if (inFlight.size >= maxInFlight) throw new MatchDetailError(429, 'MATCH_LOOKUP_BUSY', '对阵查询繁忙，请稍后重试');
    const task = (async () => {
      try {
        const snapshot = await getSnapshot(leagueId, gw, sorted[0], sorted[1]);
        validateMatchRequest(snapshot, leagueId, gw, sorted[0], sorted[1], now());
        prime(snapshot);
        const prepared = cache.get(key);
        if (prepared && now() < prepared.expiresAt) return ordered(prepared.detail, sorted[0]);
        // Historical/missing details retain the on-demand fallback. Current
        // round details normally come from the refresh-built snapshot above.
        // Public GW data is shared; picks remain keyed by entry/GW.
        const validPicks = (value) => { effectivePositions(value); return value; };
        const [first, second, live, fixtures, classic] = await Promise.all([
          resource(`${draftApi}/entry/${sorted[0]}/event/${gw}`, freshTtlMs, validPicks),
          resource(`${draftApi}/entry/${sorted[1]}/event/${gw}`, freshTtlMs, validPicks),
          resource(`${draftApi}/event/${gw}/live`, freshTtlMs, (value) => {
            if (!value?.elements || typeof value.elements !== 'object') throw unavailable('该轮官方得分暂时不可用');
            return value;
          }),
          resource(`${classicApi}/fixtures/?event=${gw}`, freshTtlMs, (value) => {
            validateGameweekFixtures(value, gw);
            return value;
          }),
          resource(`${classicApi}/bootstrap-static/`, 6 * 60 * 60_000, (value) => {
            if (!Array.isArray(value?.teams) || !value.teams.length) throw unavailable('官方球队信息暂时不可用');
            // Do not retain the much larger Classic player master. Draft
            // player IDs and scoring never come from this metadata cache.
            return value.teams;
          }),
        ]);
        const detail = buildMatchDetail({
          snapshot, leagueId, gw, entry1Id: sorted[0], entry2Id: sorted[1],
          picks: new Map([[sorted[0], first.value], [sorted[1], second.value]]),
          live: live.value, fixtures: fixtures.value, teams: classic.value, now: now(),
        });
        // Reassembling a second match must not give 59-second-old live scores
        // another full minute of life. Preserve the oldest scoring-source age,
        // including request duration; squad caching must also refresh autosubs.
        const scoringSources = [first, second, live, fixtures];
        const expiresAt = Math.min(...scoringSources.map((source) => source.expiresAt));
        detail.updated = new Date(Math.min(...scoringSources.map((source) => source.requestedAt))).toISOString();
        if (now() >= expiresAt) {
          detail.stale = true;
          detail.refreshError = '官方明细响应较慢，显示带时间标记的数据快照';
        }
        return ordered(remember(key, detail, expiresAt), sorted[0]);
      } catch (error) {
        const fallback = cache.get(key)?.detail || old;
        if (fallback && !(error instanceof MatchDetailError && error.status < 500)) {
          return ordered({ ...fallback, stale: true, refreshError: '官方明细暂时不可用，显示上次成功更新的结果' }, sorted[0]);
        }
        if (error instanceof MatchDetailError) throw error;
        if (/HTTP 404/.test(error.message)) throw new MatchDetailError(404, 'MATCH_DATA_NOT_FOUND', '该轮官方阵容暂时不可用');
        throw unavailable('暂时无法读取官方对阵明细，请稍后重试');
      }
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, task);
    return ordered(await task, entry1Id);
  }
  return { get, prime, cacheSize: () => cache.size, inFlightSize: () => inFlight.size };
}

module.exports = { MatchDetailError, validateMatchRequest, validateGameweekFixtures, effectivePositions, appearanceStatus, fixtureHasFinished, fixtureAppearanceMinutes, buildMatchDetail, createMatchDetailService };
