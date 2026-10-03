'use strict';

// This public feed deliberately uses Classic IDs for all three upstreams.
const fs = require('node:fs');
const path = require('node:path');
const { createGameweekRollover } = require('./gameweek-rollover');
const API = 'https://fantasy.premierleague.com/api/';
const TTL_MS = 10_000;
const FINALIZING_TTL_MS = 60_000;
const IDLE_TTL_MS = 3 * 60 * 60_000;
const HISTORY_TTL_MS = 15 * 60_000;
const REFRESH_POLICY_VERSION = 3;
const RETRY_BASE_MS = 20_000;
const RETRY_MAX_MS = 3 * 60_000;
const KICKOFF_LEAD_MS = 60_000;
const START_DELAY_WINDOW_MS = 4 * 60 * 60_000;
const BOOTSTRAP_TTL_MS = 15 * 60_000;
const MAX_GAMEWEEKS = 3;
const MAX_UPSTREAM_REQUESTS = 4;
const MAX_EVENTS = 2_000;
const KINDS = { goals_scored: 'goal', assists: 'assist', yellow_cards: 'yellow', red_cards: 'red' };
const POSITIONS = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };

class MatchCentreError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.name = 'MatchCentreError';
    this.statusCode = statusCode;
  }
}
const integer = n => Number.isSafeInteger(n) && n > 0;
const numeric = n => typeof n === 'number' && Number.isFinite(n);
const clone = value => JSON.parse(JSON.stringify(value));
const iso = n => new Date(n).toISOString();
const keyOf = (fixture, player, kind) => `${fixture}:${player}:${kind}`;

// Use the whole official calendar, including the next GW. A quiet cached GW
// must not keep the homepage asleep when the following round kicks off.
function refreshPlan(fixtures, sourceTime, events = []) {
  const unfinished = fixtures.filter(f => !f.finished && !f.finished_provisional);
  const isActive = unfinished.some(f => {
    if (f.started) return true; // includes half-time and stoppage time
    const kickoff = Date.parse(f.kickoff_time);
    return Number.isFinite(kickoff) && kickoff - KICKOFF_LEAD_MS <= sourceTime
      && sourceTime < kickoff + START_DELAY_WINDOW_MS;
  });
  const futureStarts = unfinished.map(f => Date.parse(f.kickoff_time))
    .filter(t => Number.isFinite(t) && t - KICKOFF_LEAD_MS > sourceTime);
  // Football's final whistle is not FPL settlement. Keep collecting official
  // corrections until the finished GW has actually been checked by FPL.
  const allEvents = events instanceof Map ? [...events.values()] : events;
  const finalizing = allEvents.some(event => {
    if (event.finished === true && event.data_checked !== false) return false;
    const matches = fixtures.filter(f => f.event === event.id);
    return matches.length > 0 && matches.every(f => f.finished || f.finished_provisional);
  });
  const interval = isActive ? TTL_MS : finalizing ? FINALIZING_TTL_MS : IDLE_TTL_MS;
  const next = Math.min(sourceTime + interval, ...futureStarts.map(t => t - KICKOFF_LEAD_MS));
  return { refreshSeconds: interval / 1000, refreshMode: isActive ? 'match' : finalizing ? 'finalizing' : 'idle', nextRefreshAt: iso(next) };
}

function recordDue(record, isDefault = true) {
  const meta = record.payload?.meta || {};
  const due = Date.parse(meta.nextRefreshAt);
  let until = Number.isFinite(due) ? Math.min(due, record.fetchedAt + IDLE_TTL_MS) : record.fetchedAt + TTL_MS;
  const settledOrIdle = !meta.live && !(meta.footballFinished && !(meta.finished && meta.data_checked));
  if (!isDefault && settledOrIdle) until = Math.min(until, record.fetchedAt + HISTORY_TTL_MS);
  return until;
}

function recordFresh(record, time, isDefault = true) {
  if (record.payload?.meta?.presentationVersion !== 4
      || record.payload?.meta?.refreshPolicyVersion !== REFRESH_POLICY_VERSION) return false;
  // v63 caches have no schedule: revalidate those after the original 60s TTL.
  const until = recordDue(record, isDefault);
  return time >= record.fetchedAt && time < until;
}

function gameweekRefreshPlan(base, gw, sourceTime) {
  if (gw === defaultGameweek(base)) return defaultRefreshPlan(base, sourceTime);
  const plan = refreshPlan(base.fixtures.filter(f => f.event === gw), sourceTime, [base.events.get(gw)]);
  if (plan.refreshMode !== 'idle') return plan;
  return { refreshSeconds: HISTORY_TTL_MS / 1000, refreshMode: 'history',
    nextRefreshAt: iso(Math.min(Date.parse(plan.nextRefreshAt), sourceTime + HISTORY_TTL_MS)) };
}

function defaultRefreshPlan(base, sourceTime) {
  const plan = refreshPlan(base.fixtures, sourceTime, base.events);
  const boundaries = [base.displayState?.weeklySwitchAt,
    ...[...base.events.values()].map(e => e.deadline_time)]
    .map(Date.parse).filter(t => Number.isFinite(t) && t > sourceTime);
  return { ...plan, nextRefreshAt: iso(Math.min(Date.parse(plan.nextRefreshAt), ...boundaries)) };
}

function validateGameweek(value) {
  if (value === undefined || value === null) return null;
  if (!((typeof value === 'number' && Number.isInteger(value)) ||
      (typeof value === 'string' && /^[1-9]\d?$/.test(value)))) {
    throw new MatchCentreError('GW must be an integer from 1 to 38', 400);
  }
  const gw = Number(value);
  if (gw < 1 || gw > 38) throw new MatchCentreError('GW must be an integer from 1 to 38', 400);
  return gw;
}

function parseSources(boot, fixtures, fetchedAt) {
  if (!boot || !Array.isArray(boot.events) || !boot.events.length ||
      !Array.isArray(boot.teams) || !boot.teams.length ||
      !Array.isArray(boot.elements) || !boot.elements.length || !Array.isArray(fixtures)) {
    throw new MatchCentreError('Official FPL source data is unavailable');
  }
  const events = new Map();
  const teams = new Map();
  const players = new Map();
  for (const e of boot.events) {
    if (!integer(e.id) || e.id > 38 || events.has(e.id) || typeof e.name !== 'string') {
      throw new MatchCentreError('Invalid official gameweek identity');
    }
    events.set(e.id, e);
  }
  for (const t of boot.teams) {
    if (!integer(t.id) || !integer(t.code) || teams.has(t.id) ||
        typeof t.name !== 'string' || typeof t.short_name !== 'string') {
      throw new MatchCentreError('Invalid official team identity');
    }
    teams.set(t.id, { id: t.id, code: t.code, name: t.name, short_name: t.short_name });
  }
  for (const p of boot.elements) {
    if (!integer(p.id) || players.has(p.id) || !teams.has(p.team) || !POSITIONS[p.element_type] ||
        typeof p.web_name !== 'string') throw new MatchCentreError('Invalid official player identity');
    players.set(p.id, { id: p.id, code: integer(p.code) ? p.code : null, name: p.web_name, position: POSITIONS[p.element_type], team: p.team });
  }
  const fixtureIds = new Set();
  for (const f of fixtures) {
    // Validate before filtering: a missing event must not masquerade as a blank GW.
    if (!integer(f.id) || fixtureIds.has(f.id) ||
        !(f.event === null || (integer(f.event) && events.has(f.event))) ||
        !teams.has(f.team_h) || !teams.has(f.team_a) || f.team_h === f.team_a ||
        !(typeof f.started === 'boolean' || f.started === null) ||
        typeof f.finished !== 'boolean' || typeof f.finished_provisional !== 'boolean' ||
        !(f.kickoff_time === null || (typeof f.kickoff_time === 'string' && Number.isFinite(Date.parse(f.kickoff_time)))) ||
        ![f.team_h_score, f.team_a_score].every(n => n === null || (Number.isInteger(n) && n >= 0)) ||
        !numeric(f.minutes) || !Array.isArray(f.stats)) {
      throw new MatchCentreError('Invalid official fixture identity or status');
    }
    fixtureIds.add(f.id);
  }
  const firstEvent = [...events.values()].sort((a, b) => a.id - b.id)[0];
  return { events, teams, players, fixtures, fetchedAt, season: firstEvent.deadline_time || `event-${firstEvent.id}` };
}

function defaultGameweek(base) {
  const running = base.fixtures.filter(f => f.event && f.started && !f.finished && !f.finished_provisional);
  const started = base.fixtures.filter(f => f.event && (f.started || f.finished || f.finished_provisional));
  const current = [...base.events.values()].find(e => e.is_current);
  if (current && running.some(f => f.event === current.id)) return current.id;
  if (running.length) return Math.max(...running.map(f => f.event));
  if (base.displayState?.weeklyDefaultGw) return base.displayState.weeklyDefaultGw;
  if (started.length) return Math.max(...started.map(f => f.event));
  return current?.id || [...base.events.keys()].sort((a, b) => a - b)[0];
}

function buildRecord(base, live, gw, previous, observedAt, sourceTime) {
  if (!live || !Array.isArray(live.elements)) throw new MatchCentreError('Official Classic live data is unavailable');
  const selected = base.fixtures.filter(f => f.event === gw);
  if (selected.some(f => f.started) && live.elements.length === 0) {
    throw new MatchCentreError('Official live player scores are unavailable');
  }
  const fixturesById = new Map(selected.map(f => [f.id, f]));
  const counts = new Map();
  const explains = new Map();
  const candidates = new Map();
  let ignoredReferences = 0;
  const addCandidate = (fixture, player, team) => {
    const person = base.players.get(player);
    const match = fixturesById.get(fixture);
    if (!person || !match || ![match.team_h, match.team_a].includes(person.team) || (team && person.team !== team)) {
      ignoredReferences++;
      return false;
    }
    candidates.set(`${fixture}:${player}`, { fixture, player });
    return true;
  };
  for (const f of selected) {
    const identifiers = new Set();
    for (const s of f.stats) {
      if (!s || typeof s.identifier !== 'string' || identifiers.has(s.identifier) || !Array.isArray(s.a) || !Array.isArray(s.h)) {
        throw new MatchCentreError('Invalid official fixture statistics');
      }
      identifiers.add(s.identifier);
      if (!KINDS[s.identifier] && s.identifier !== 'defensive_contribution') continue;
      for (const side of ['h', 'a']) {
        const seen = new Set();
        for (const item of s[side]) {
          if (!integer(item.element) || !Number.isInteger(item.value) || item.value < 0 || seen.has(item.element)) {
            throw new MatchCentreError('Invalid official fixture player statistics');
          }
          seen.add(item.element);
          if (addCandidate(f.id, item.element, f[`team_${side}`])) {
            counts.set(keyOf(f.id, item.element, s.identifier), item.value);
          }
        }
      }
    }
  }
  const liveIds = new Set();
  for (const p of live.elements) {
    if (!integer(p.id) || liveIds.has(p.id) || !Array.isArray(p.explain)) {
      throw new MatchCentreError('Invalid official Classic live player identity');
    }
    liveIds.add(p.id);
    if (!base.players.has(p.id)) { ignoredReferences++; continue; }
    const seenFixtures = new Set();
    for (const row of p.explain) {
      if (!integer(row.fixture) || seenFixtures.has(row.fixture) || !Array.isArray(row.stats)) {
        throw new MatchCentreError('Invalid official player fixture explanation');
      }
      seenFixtures.add(row.fixture);
      if (!addCandidate(row.fixture, p.id)) continue;
      const statMap = new Map();
      for (const s of row.stats) {
        if (!s || typeof s.identifier !== 'string' || !numeric(s.value) || !numeric(s.points) || statMap.has(s.identifier)) {
          throw new MatchCentreError('Invalid official scoring explanation');
        }
        statMap.set(s.identifier, s);
      }
      explains.set(`${row.fixture}:${p.id}`, statMap);
    }
  }
  const priorState = new Map(previous?.state || []);
  for (const k of priorState.keys()) {
    const [fixture, player] = k.split(':').map(Number);
    addCandidate(fixture, player);
  }
  const state = new Map();
  for (const { fixture, player } of candidates.values()) {
    const explanation = explains.get(`${fixture}:${player}`);
    for (const [identifier, kind] of Object.entries(KINDS)) {
      const k = keyOf(fixture, player, kind);
      if (!fixturesById.get(fixture).stats.some(s => s.identifier === identifier)) {
        if (priorState.has(k)) state.set(k, priorState.get(k));
        continue;
      }
      const value = counts.get(keyOf(fixture, player, identifier)) || 0;
      const official = explanation?.get(identifier);
      const hasRed = (counts.get(keyOf(fixture, player, 'red_cards')) || 0) > 0;
      // A second yellow may become a red in explain. Do not invent an additional -1.
      const points = official && official.value === value ? official.points
        : explanation && (value === 0 || (kind === 'yellow' && hasRed && !official)) ? 0 : null;
      const prior = priorState.get(k);
      state.set(k, { value, points, knownPoints: points ?? prior?.knownPoints ?? prior?.points ?? 0 });
    }
    // An absent CS stat is zero only when this player's fixture explanation exists.
    // An absent whole explanation cannot revoke a previously observed clean sheet.
    for (const [identifier, kind] of [['clean_sheets', 'cs'], ['defensive_contribution', 'dc'], ['bonus', 'bonus'], ['penalties_saved', 'penalty_saved'], ['penalties_missed', 'penalty_missed']]) {
      const k = keyOf(fixture, player, kind);
      if (explanation) {
        const stat = explanation.get(identifier);
        state.set(k, { value: stat?.value || 0, points: stat?.points || 0 });
      } else if (priorState.has(k)) {
        state.set(k, priorState.get(k));
      }
    }
  }

  let sequence = previous?.sequence || 0;
  // Add the stable cross-product identity to legacy observations without changing
  // their event IDs, team-at-observation, timestamps or scores.
  const history = clone(previous?.payload.events || []).map(event => ({...event,
    player: {...event.player, code: event.player?.code ?? base.players.get(event.player?.id)?.code ?? null},
  }));
  const previousFixtures = new Set(previous?.payload.fixtures.map(f => f.id) || []);
  for (const [k, current] of state) {
    const [fixture, player, metric] = k.split(':');
    const old = priorState.get(k) || { value: 0, points: 0 };
    // Upgrading an existing observation cache must not announce historical bonus as new.
    const baseline = !previous || !previousFixtures.has(Number(fixture))
      || (metric === 'bonus' && !(previous.payload.meta.presentationVersion >= 2))
      || (['penalty_saved', 'penalty_missed'].includes(metric) && !(previous.payload.meta.presentationVersion >= 3));
    const isAward = ['cs', 'dc', 'bonus', 'penalty_saved', 'penalty_missed'].includes(metric);
    if (baseline ? (isAward ? current.points === 0 : current.value === 0)
      : (isAward ? current.points === old.points : current.value === old.value && current.points === old.points)) continue;
    // Unknown points alone should not turn an absent event into an update.
    if (!isAward && current.value === 0 && old.value === 0 && (current.points === null || old.points === null)) continue;
    const lost = metric === 'cs' && !baseline && old.points > 0 && current.points === 0;
    const points = baseline ? current.points
      : current.points === null ? null : current.points - (old.knownPoints ?? old.points ?? 0);
    const kind = lost ? 'cs_lost' : metric;
    let detail = baseline ? '本场累计；首次同步记录，非刚刚发生' : '官方数据变更；时间为本站检测时间';
    if (!baseline && current.value <= old.value && !lost) detail += '；官方统计或积分修订';
    if (metric === 'dc') detail += '；仅展示官方已计入的防守贡献分';
    if (metric === 'yellow' && current.value > 0 && current.points === 0) detail += '；纪律扣分遵循官方明细，黄牌未重复扣分';
    if (points === null) detail += '；积分明细待官方同步';
    history.push({
      id: `gw${gw}-f${fixture}-p${player}-${metric}-${++sequence}`,
      fixtureId: Number(fixture), kind, player: base.players.get(Number(player)),
      value: current.value, points, delta: baseline ? current.value : current.value - old.value,
      observedAt: iso(observedAt), baseline, detail,
    });
  }
  const truncated = history.length > MAX_EVENTS || previous?.payload.meta.historyTruncated === true;
  const fixtures = selected.map(f => ({
    id: f.id, event: f.event, kickoff_time: f.kickoff_time, started: f.started,
    finished: f.finished, finished_provisional: f.finished_provisional,
    team_h: f.team_h, team_a: f.team_a, team_h_score: f.team_h_score, team_a_score: f.team_a_score,
    minutes: f.minutes, home: base.teams.get(f.team_h), away: base.teams.get(f.team_a),
    redCards: Object.fromEntries([['home', 'h'], ['away', 'a']].map(([label, side]) => {
      const official = f.stats.find(s => s.identifier === 'red_cards');
      return [label, official ? official[side].reduce((sum, item) => sum + item.value, 0) : null];
    })),
  })).sort((a, b) => (Date.parse(a.kickoff_time) || Infinity) - (Date.parse(b.kickoff_time) || Infinity) || a.id - b.id);
  return {
    gw, season: base.season, fetchedAt: sourceTime, sequence, state: [...state],
    payload: {
      meta: { gw, updated: iso(sourceTime), checkedAt: iso(observedAt), firstSourceTime: previous?.payload.meta.firstSourceTime || iso(sourceTime),
        stale: false, source: 'Official FPL', ...gameweekRefreshPlan(base, gw, sourceTime), ignoredReferences,
        season: base.season, gwDeadline: base.events.get(gw).deadline_time || null,
        nextGwDeadline: base.events.get(gw + 1)?.deadline_time || null,
        bootstrapUpdated: iso(base.bootstrapAt), finished: base.events.get(gw).finished === true,
        data_checked: base.events.get(gw).data_checked === true,
        footballFinished: fixtures.length > 0 && fixtures.every(f => f.finished || f.finished_provisional),
        live: fixtures.some(f => f.started && !f.finished && !f.finished_provisional),
        historyTruncated: truncated, eventTimeType: 'observed', scoringScope: 'event-components', presentationVersion: 4,
        refreshPolicyVersion: REFRESH_POLICY_VERSION },
      gameweeks: [...base.events.values()].sort((a, b) => a.id - b.id).map(e => ({ id: e.id, name: e.name })),
      fixtures, events: history.slice(-MAX_EVENTS),
    },
  };
}

function createMatchCentreService({ fetchJson, cachePath, now = Date.now, rollover = createGameweekRollover() } = {}) {
  if (typeof fetchJson !== 'function') throw new TypeError('fetchJson is required');
  const clock = typeof now === 'function' ? now : () => Number(now);
  const records = new Map();
  const inFlight = new Map();
  const failedUntil = new Map();
  const failures = new Map();
  let base = null;
  let baseInFlight = null;
  let bootstrap = null;
  let bootstrapAt = 0;
  let selectedDefault = null;
  let season = null;
  let baseFailedUntil = 0;
  let baseFailures = 0;
  let activeUpstreamRequests = 0;
  const upstreamQueue = [];
  const retryDelay = attempts => Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(attempts - 1, 5));
  function retryError(until) {
    const error = new MatchCentreError('Official FPL refresh is temporarily unavailable', 503);
    error.retryAt = iso(until);
    error.retryAfterSeconds = Math.max(1, Math.ceil((until - clock()) / 1000));
    return error;
  }
  async function fetchOfficial(url) {
    if (activeUpstreamRequests >= MAX_UPSTREAM_REQUESTS) {
      // A concurrent history read must not turn a healthy live read into a
      // fake upstream failure. Queue bounded work instead of exceeding quota.
      if (upstreamQueue.length >= MAX_UPSTREAM_REQUESTS * 2) {
        throw new MatchCentreError('Match centre is busy; please retry shortly', 503);
      }
      await new Promise(resolve => upstreamQueue.push(resolve));
    } else activeUpstreamRequests++;
    try { return await fetchJson(url); }
    finally {
      const next = upstreamQueue.shift();
      if (next) next(); // transfer this reserved slot to the queued request
      else activeUpstreamRequests--;
    }
  }
  if (cachePath) {
    try {
      if (fs.statSync(cachePath).size <= 8_000_000) {
        const saved = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        if (saved.version === 1 && Array.isArray(saved.records) && saved.records.length <= MAX_GAMEWEEKS) {
          for (const record of saved.records) {
            if (validateGameweek(record.gw) && numeric(record.fetchedAt) && record.fetchedAt <= clock() &&
                record.payload?.meta?.gw === record.gw && record.payload.meta.source === 'Official FPL' &&
                Number.isFinite(Date.parse(record.payload.meta.firstSourceTime)) &&
                Number.isFinite(Date.parse(record.payload.meta.updated)) &&
                Array.isArray(record.payload.fixtures) && Array.isArray(record.payload.events) &&
                Array.isArray(record.payload.gameweeks) && Array.isArray(record.state) &&
                Number.isInteger(record.sequence) && record.season === saved.season) records.set(record.gw, record);
          }
          selectedDefault = validateGameweek(saved.selectedDefault);
          season = saved.season;
        }
      }
    } catch { /* A missing/corrupt independent cache never blocks a fresh official read. */ }
  }
  function touch(gw) {
    const r = records.get(gw);
    if (r) { records.delete(gw); records.set(gw, r); }
    return r;
  }
  function persist() {
    if (!cachePath) return;
    const temp = `${cachePath}.tmp-${process.pid}`;
    try {
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(temp, JSON.stringify({ version: 1, season, selectedDefault, records: [...records.values()] }));
      fs.renameSync(temp, cachePath);
    } catch { /* In-memory results remain usable if optional cache storage is unavailable. */ }
  }
  function result(record, stale = false) {
    const payload = clone(record.payload);
    payload.meta.stale = stale;
    const retryAt = Math.max(baseFailedUntil, failedUntil.get(record.gw) || 0);
    payload.meta.refreshing = Boolean(baseInFlight || inFlight.has(record.gw));
    if (stale) {
      payload.meta.warning = retryAt > clock() ? '官方数据暂不可用，保留上次成功同步结果' : '正在同步，保留上次成功数据';
      if (retryAt > clock()) {
        payload.meta.retryAt = iso(retryAt);
        payload.meta.nextRefreshAt = iso(retryAt);
      }
    }
    return payload;
  }
  async function getBase(maxAge = IDLE_TTL_MS, force = false) {
    if (!force && base && clock() - base.fetchedAt < maxAge
      && clock() < Date.parse(defaultRefreshPlan(base, base.fetchedAt).nextRefreshAt)) return base;
    if (baseInFlight) return baseInFlight;
    if (clock() < baseFailedUntil) throw retryError(baseFailedUntil);
    const fetchedAt = clock();
    baseInFlight = (async () => {
      try {
        const loadBootstrap = async () => {
          const settling = base && refreshPlan(base.fixtures, fetchedAt, base.events).refreshMode === 'finalizing';
          const ttl = settling ? FINALIZING_TTL_MS : BOOTSTRAP_TTL_MS;
          if (!force && bootstrap && clock() - bootstrapAt < ttl) return bootstrap;
          const start = clock();
          const boot = await fetchOfficial(`${API}bootstrap-static/`);
          // Only retain metadata after the complete source validation below.
          return { freshBootstrap: boot, fetchedAt: start };
        };
        const [loaded, fixtures] = await Promise.all([loadBootstrap(), fetchOfficial(`${API}fixtures/`)]);
        const boot = loaded.freshBootstrap || loaded;
        const next = parseSources(boot, fixtures, fetchedAt);
        if (loaded.freshBootstrap) { bootstrap = boot; bootstrapAt = loaded.fetchedAt; }
        next.bootstrapAt = bootstrapAt;
        next.displayState = rollover.observe([...next.events.values()], next.fixtures, clock());
        if (season && season !== next.season) records.clear();
        season = next.season;
        base = next;
        selectedDefault = defaultGameweek(base);
        baseFailures = 0;
        baseFailedUntil = 0;
        return base;
      } catch (error) {
        baseFailedUntil = clock() + retryDelay(++baseFailures);
        throw error;
      } finally { baseInFlight = null; }
    })();
    return baseInFlight;
  }
  async function get(value, force = false) {
    const requested = validateGameweek(value);
    const candidate = requested || selectedDefault;
    const cached = candidate && touch(candidate);
    if (!force && cached && recordFresh(cached, clock(), candidate === selectedDefault)) return result(cached);
    if (clock() < (failedUntil.get(candidate) || 0)) {
      if (cached) return result(cached, true);
      throw retryError(failedUntil.get(candidate));
    }
    let official;
    try {
      // A historical fifteen-minute correction check must also refresh its
      // fixture metadata, not rebuild against a three-hour-old global base.
      const maxAge = requested && requested !== selectedDefault
        ? cached?.payload.meta.refreshMode === 'match' ? TTL_MS
          : cached?.payload.meta.refreshMode === 'finalizing' ? FINALIZING_TTL_MS : HISTORY_TTL_MS
        : IDLE_TTL_MS;
      official = await getBase(maxAge, force);
    }
    catch (error) {
      if (cached) return result(cached, true);
      throw error;
    }
    const gw = requested || selectedDefault;
    if (!official.events.has(gw)) throw new MatchCentreError('Requested GW is unavailable', 400);
    if (inFlight.has(gw)) return inFlight.get(gw);
    const previous = touch(gw);
    if (!force && previous && recordFresh(previous, clock(), gw === selectedDefault)) return result(previous);
    if (clock() < (failedUntil.get(gw) || 0)) {
      if (previous) return result(previous, true);
      throw retryError(failedUntil.get(gw));
    }
    if (inFlight.size >= MAX_GAMEWEEKS) {
      if (previous) return result(previous, true);
      throw new MatchCentreError('Match centre is busy; please retry shortly', 503);
    }
    const startedAt = clock();
    const task = Promise.resolve().then(async () => {
      try {
        const hasStarted = official.fixtures.some(f => f.event === gw && (f.started || f.finished || f.finished_provisional));
        const live = hasStarted ? await fetchOfficial(`${API}event/${gw}/live/`) : { elements: [] };
        const next = buildRecord(official, live, gw, previous, clock(), Math.min(official.fetchedAt, startedAt));
        records.delete(gw);
        records.set(gw, next);
        while (records.size > MAX_GAMEWEEKS) {
          // History browsing must not erase the default GW's live CS baseline.
          const oldest = [...records.keys()].find(id => id !== selectedDefault);
          records.delete(oldest);
        }
        failedUntil.delete(gw);
        failures.delete(gw);
        persist();
        const payload = result(next);
        payload.meta.refreshing = false;
        return payload;
      } catch (error) {
        const attempts = (failures.get(gw) || 0) + 1;
        failures.set(gw, attempts);
        failedUntil.set(gw, clock() + retryDelay(attempts));
        if (previous) {
          const payload = result(previous, true);
          payload.meta.refreshing = false;
          return payload;
        }
        throw error;
      } finally { inFlight.delete(gw); }
    });
    inFlight.set(gw, task);
    return task;
  }
  // Read-only SWR view: never advances collection clocks or writes event history.
  // Callers decide whether to launch get() in the background and publish it.
  function peek(value) {
    const requested = validateGameweek(value);
    const gw = requested || selectedDefault;
    const record = records.get(gw);
    if (!record) return null;
    const firstDeadline = Date.parse(record.season);
    const seasonYear = new Date(firstDeadline).getUTCFullYear();
    // Old content is useful during a short reconnect, not across seasons or a
    // weeks-long gap. Unknown legacy season formats require a fresh base read.
    if (!Number.isFinite(firstDeadline) || clock() < Date.UTC(seasonYear, 6, 1)
      || clock() >= Date.UTC(seasonYear + 1, 6, 1) || clock() - record.fetchedAt > 6 * 60 * 60_000) return null;
    const fresh = recordFresh(record, clock(), gw === selectedDefault);
    const payload = result(record, !fresh);
    // The cached GW is a last-known selection until the default calendar has
    // been checked again. Consumers must not call this confirmed current GW.
    if (!requested && !fresh) payload.meta.selectionPending = true;
    return payload;
  }
  function getStatus(value) {
    const gw = validateGameweek(value) || selectedDefault;
    const record = records.get(gw);
    const retryAt = Math.max(baseFailedUntil, failedUntil.get(gw) || 0);
    const fresh = Boolean(record && recordFresh(record, clock(), gw === selectedDefault));
    const due = fresh ? recordDue(record, gw === selectedDefault) : clock();
    return { gw, cached: Boolean(record), fresh, refreshing: Boolean(baseInFlight || inFlight.has(gw)),
      nextRefreshAt: iso(Math.max(due, retryAt)), retryAt: retryAt > clock() ? iso(retryAt) : null,
      updated: record?.payload.meta.updated || null, checkedAt: record?.payload.meta.checkedAt || record?.payload.meta.updated || null };
  }
  return { get, peek, getStatus };
}

module.exports = { createMatchCentreService, validateGameweek, MatchCentreError, TTL_MS, FINALIZING_TTL_MS,
  IDLE_TTL_MS, HISTORY_TTL_MS, refreshPlan, BOOTSTRAP_TTL_MS, MAX_GAMEWEEKS, RETRY_BASE_MS, RETRY_MAX_MS };
