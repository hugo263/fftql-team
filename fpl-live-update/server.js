/**
 * FPL Draft League Weekly Update Server
 * --------------------------------------
 * Zero-dependency Node.js (>=18) server:
 *   - Static file serving from ./public
 *   - Data pipeline pulling from official FPL draft & classic APIs
 *   - Snapshot generation (data/snapshot.json)
 *   - Refresh each minute while a GW is active, every N minutes off peak;
 *     reports switch at the deadline and final Draft scores are cached.
 *
 * Data sources (all public, no auth):
 *   - https://draft.premierleague.com/api/bootstrap-static
 *   - https://fantasy.premierleague.com/api/bootstrap-static/
 *   - https://draft.premierleague.com/api/league/{id}/details
 *   - https://draft.premierleague.com/api/draft/league/{id}/transactions
 *   - https://draft.premierleague.com/api/league/{id}/element-status
 *   - https://draft.premierleague.com/api/entry/{entryId}/event/{gw}
 *   - https://draft.premierleague.com/api/event/{gw}/live
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { adminNewsResponse } = require('./admin-news-sso');
const { createNewsProxy } = require('./news-proxy');
const {
  LIVE_REFRESH_MS, SNAPSHOT_SCHEMA, deriveGameweekState, isSnapshotFresh,
  scoreLockedPicks, applyLiveMatchScores, rebuildH2HStandings,
} = require('./live-scoring');
const { createMatchDetailService, validateMatchRequest, validateGameweekFixtures, effectivePositions, buildMatchDetail, MatchDetailError } = require('./match-detail');
const { resolveAutoSubs } = require('./auto-subs');
const { collectFunRankings } = require('./fun-rankings');
const { buildTradeReturns, latestScoringGw } = require('./trade-returns');
const { buildAnalyticsReport: aggregateAnalyticsReport } = require('./analytics-report');
const { createInternalTrafficStore, INTERNAL_COOKIE, MARKER_MAX_AGE } = require('./analytics-identity');
const { validateHistory } = require('./analytics-history');
const { sendPublicJson, sendStaticFile } = require('./public-http');
const { createPublicSnapshotReader, WORKSPACE_DISPLAY_POLICY, canServeWhileRefreshing } = require('./public-snapshot');
const { buildOwnershipSnapshot, isValidOwnershipSnapshot, applyOwnership, ownershipCacheKey } = require('./totw-ownership');
const { createMatchCentreService } = require('./match-centre');
const { createGameweekRollover } = require('./gameweek-rollover');
const { createUpdateHub, workspaceFresh, WORKSPACE_INTERVAL } = require('./update-stream');
const { createTaskGate } = require('./refresh-control');
const { pageRoute } = require('./site-routing');
const updates = createUpdateHub();
const proxyNews = createNewsProxy();
const snapshotBuildGate = createTaskGate({ concurrency: 2, maxQueued: 24, queueTimeoutMs: 30_000 });
let leagueInvalidatedAt = 0;

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SNAPSHOT_PATH = path.join(DATA_DIR, 'snapshot.json');
const ANALYTICS_DIR = path.join(DATA_DIR, 'analytics');
const LEAGUE_CACHE_DIR = path.join(DATA_DIR, 'leagues');

const config = loadConfig();
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  } catch (e) {
    return { leagueId: 47275, port: 3000, refreshMinutes: 15 };
  }
}

const ADMIN_PASSWORD = process.env.FPL_ADMIN_PASSWORD || config.adminPassword || '';
const ADMIN_PASSWORD_HASH = config.adminPasswordHash || '';
const ADMIN_SESSION_SECRET = process.env.FPL_ADMIN_SESSION_SECRET
  || config.adminSessionSecret
  || ADMIN_PASSWORD_HASH
  || ADMIN_PASSWORD;
const ANALYTICS_SALT = process.env.FPL_ANALYTICS_SALT
  || config.analyticsSalt
  || ADMIN_SESSION_SECRET
  || `fpl-weekly-${config.leagueId || 47275}`;
const ADMIN_COOKIE = 'fpl_admin_session';
const internalTraffic = createInternalTrafficStore({
  filePath: path.join(ANALYTICS_DIR, 'internal-visitors.json'), secret: ADMIN_SESSION_SECRET,
});
const ANALYTICS_COLLECTION_PATH = path.join(ANALYTICS_DIR, 'collection-v2.json');
const ANALYTICS_HISTORY_PATH = path.join(ANALYTICS_DIR, 'league-history-v1.json');
let leagueTrackingSince = null;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginAttempts = new Map();
const analyticsRates = new Map();
const leagueLookupRates = new Map();
const kitImageCache = new Map();

const DRAFT_API = 'https://draft.premierleague.com/api';
const CLASSIC_API = 'https://fantasy.premierleague.com/api';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// Independent public match feed. It never writes league scores or ownership.
const gameweekRollover = createGameweekRollover({ cachePath: path.join(DATA_DIR, 'cache', 'gameweek-rollover-v1.json') });
const matchCentreService = createMatchCentreService({
  rollover: gameweekRollover,
  cachePath: path.join(DATA_DIR, 'cache', 'match-centre-v1.json'),
  fetchJson: async url => {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(35000),
    });
    if (!response.ok) throw new Error(`Official match feed HTTP ${response.status}`);
    return response.json();
  },
});

/* ------------------------------------------------------------------ */
/* Fetch helpers                                                       */
/* ------------------------------------------------------------------ */

async function fetchJson(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      if (i === retries - 1) throw err;
      await sleep(1500 * (i + 1));
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getKitImage(code, goalkeeper = false) {
  const key = `${code}${goalkeeper ? '-gk' : ''}`;
  if (kitImageCache.has(key)) return kitImageCache.get(key);
  const task = (async () => {
    const suffix = goalkeeper ? '_1' : '';
    const upstream = `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${code}${suffix}-66.png`;
    const response = await fetch(upstream, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'image/png' },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Kit image HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > 1024 * 1024) throw new Error('Invalid kit image');
    return buffer;
  })();
  kitImageCache.set(key, task);
  try {
    return await task;
  } catch (error) {
    kitImageCache.delete(key);
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Data pipeline                                                       */
/* ------------------------------------------------------------------ */

async function buildSnapshot(requestedLeagueId = config.leagueId, options = {}) {
  const t0 = Date.now();
  const leagueId = requestedLeagueId;
  const clock = () => options.now ?? Date.now();
  const sourceTimes = new Map();
  const requestJson = async (url) => {
    const requestedAt = clock();
    const value = await (options.fetchJson || fetchJson)(url);
    sourceTimes.set(url, requestedAt);
    return value;
  };

  // 1. Bootstrap data (draft + classic) --------------------------------
  const [draftBoot, classicBoot, leagueDetails, transactions, leagueTrades, elementStatus] =
    await Promise.all([
      requestJson(`${DRAFT_API}/bootstrap-static`),
      requestJson(`${CLASSIC_API}/bootstrap-static/`),
      requestJson(`${DRAFT_API}/league/${leagueId}/details`),
      requestJson(`${DRAFT_API}/draft/league/${leagueId}/transactions`),
      requestJson(`${DRAFT_API}/draft/league/${leagueId}/trades`),
      requestJson(`${DRAFT_API}/league/${leagueId}/element-status`),
    ]);

  // 2. Gameweek state ---------------------------------------------------
  const events = classicBoot.events || [];
  const initialState = deriveGameweekState(events, [], options.now ?? Date.now());
  let currentFixtures = [];
  const currentEvent = events.find((event) => event.id === initialState.currentGw);
  if (currentEvent && initialState.gwStarted) {
    try {
      const fixtures = await requestJson(`${CLASSIC_API}/fixtures/?event=${currentEvent.id}`);
      currentFixtures = validateGameweekFixtures(fixtures, currentEvent.id, classicBoot.teams);
    } catch (e) {
      // Do not publish a new score that silently drops previously projected
      // substitutions merely because remaining-fixture data is unavailable.
      throw new Error(`Fixture status unavailable for automatic substitutions: ${e.message}`);
    }
  }
  const gameweekState = deriveGameweekState(events, currentFixtures, options.now ?? Date.now());
  const displayState = gameweekRollover.observe(events, currentFixtures, options.now ?? Date.now());
  const { currentGw, lastFinishedGw, upcomingGw, reportGw } = gameweekState;

  // 3. Player master table (merged draft + classic) ----------------------
  // Draft and classic player IDs can diverge when players are added at
  // different times. `code` is the stable cross-product player identifier.
  const classicByCode = new Map();
  for (const el of classicBoot.elements || []) classicByCode.set(el.code, el);
  const draftTeams = new Map((draftBoot.teams || []).map((t) => [t.id, t]));
  const classicTeamsByCode = new Map((classicBoot.teams || []).map((t) => [t.code, t]));
  const posById = new Map(
    (draftBoot.element_types || []).map((t) => [t.id, t])
  );

  // ownership map: element -> entry_id
  const ownerByElement = new Map();
  for (const es of elementStatus.element_status || []) {
    if (es.owner != null) ownerByElement.set(es.element, es.owner);
  }

  const players = (draftBoot.elements || []).map((d) => {
    const c = classicByCode.get(d.code) || {};
    const team = draftTeams.get(d.team) || {};
    const cTeam = classicTeamsByCode.get(team.code) || {};
    const pos = posById.get(d.element_type) || {};
    return {
      id: d.id,
      name: d.web_name || `${d.first_name} ${d.second_name}`.trim(),
      fullName: `${d.first_name} ${d.second_name}`.trim(),
      team: team.short_name || '',
      teamName: team.name || cTeam.name || '',
      teamCode: team.code || cTeam.code || null,
      teamStrength: cTeam.strength || 3,
      pos: pos.singular_name_short || ['GKP', 'DEF', 'MID', 'FWD'][d.element_type - 1] || '',
      posId: d.element_type,
      nowCost: (c.now_cost || 0) / 10, // in £M
      form: Number(c.form || 0),
      ppg: Number(c.points_per_game || 0),
      epNext: Number(c.ep_next || 0), // expected points next GW
      totalPoints: c.total_points ?? d.total_points ?? 0,
      eventPoints: c.event_points ?? d.event_points ?? 0,
      minutes: c.minutes ?? d.minutes ?? 0,
      starts: c.starts ?? d.starts ?? 0,
      goals: c.goals_scored ?? d.goals_scored ?? 0,
      assists: c.assists ?? d.assists ?? 0,
      cleanSheets: c.clean_sheets ?? d.clean_sheets ?? 0,
      xg: Number(c.expected_goals ?? d.expected_goals ?? 0),
      xa: Number(c.expected_assists ?? d.expected_assists ?? 0),
      xgi: Number(c.expected_goal_involvements ?? d.expected_goal_involvements ?? 0),
      xg90: Number(c.expected_goals_per_90 ?? 0),
      xa90: Number(c.expected_assists_per_90 ?? 0),
      news: c.news || '',
      status: c.status || d.status || 'a',
      chanceNext: c.chance_of_playing_next_round,
      inDreamteam: !!(c.in_dreamteam || d.in_dreamteam),
      dreamteamCount: c.dreamteam_count ?? d.dreamteam_count ?? 0,
      owner: ownerByElement.get(d.id) ?? null, // entry_id or null (free agent)
      inAcceptedTrade: !!(ownerByElement.get(d.id) !== undefined && d.status === 't'),
      photo: d.code ? String(d.code) : '',
    };
  });
  const playersById = new Map(players.map((p) => [p.id, p]));

  // 4. League entries / standings ----------------------------------------
  const league = leagueDetails.league || {};
  const leagueEntries = leagueDetails.league_entries || [];
  const standings = leagueDetails.standings || [];
  let matches = leagueDetails.matches || [];

  const entryByLeagueEntryId = new Map(); // standings key -> entry object
  const entryByEntryId = new Map(); // entry_id -> entry object
  for (const e of leagueEntries) {
    entryByLeagueEntryId.set(e.id, e);
    entryByEntryId.set(e.entry_id, e);
  }
  let standingsByLeagueEntryId = new Map(
    standings.map((s) => [s.league_entry, s])
  );

  // per-GW scores per entry (league_entry id space) for form / trends
  const gwScores = new Map(); // leagueEntryId -> [{gw, points}]

  // 5. Squads for every entry (current GW) --------------------------------
  const squads = new Map(); // entry_id -> picks payload
  const squadGwByEntry = new Map(); // never mistake a fallback squad for the live locked XI
  await Promise.all(
    leagueEntries.map(async (e) => {
      try {
        const gwToFetch = Math.max(1, currentGw);
        const picksData = await requestJson(
          `${DRAFT_API}/entry/${e.entry_id}/event/${gwToFetch}`
        );
        squads.set(e.entry_id, picksData);
        squadGwByEntry.set(e.entry_id, gwToFetch);
      } catch (err) {
        // try previous GW if current not available yet
        try {
          const picksData = await requestJson(
            `${DRAFT_API}/entry/${e.entry_id}/event/${Math.max(1, currentGw - 1)}`
          );
          squads.set(e.entry_id, picksData);
          squadGwByEntry.set(e.entry_id, Math.max(1, currentGw - 1));
        } catch (e2) {
          console.warn(`[warn] squad fetch failed for entry ${e.entry_id}: ${e2.message}`);
        }
      }
    })
  );

  // 6. Include the active GW immediately at its deadline. Only officially
  // checked/finished rounds may be frozen; a provisional final whistle is not
  // final scoring. Keep the existing Draft-ID-specific cache namespace.
  const cacheDir = options.cacheDir || path.join(ROOT, 'data', 'cache');
  try { fs.mkdirSync(cacheDir, { recursive: true }); } catch (e) { /* ignore */ }
  const livePointsByGw = new Map(); // gw -> Map(elementId -> points)
  const rawLiveByGw = new Map();
  let reportLivePayload = null;
  let reportLiveRequestedAt = null;
  if (reportGw > 0) {
    for (let gw = 1; gw <= reportGw; gw++) {
      const cacheFile = path.join(cacheDir, `draft-live-v1-gw${gw}.json`);
      const event = events.find((item) => item.id === gw);
      const isSettled = !!(event?.finished && event?.data_checked !== false);
      try {
        if (isSettled && gw !== reportGw && fs.existsSync(cacheFile)) {
          livePointsByGw.set(gw, new Map(JSON.parse(fs.readFileSync(cacheFile, 'utf8'))));
          continue;
        }
        // The report also needs minutes/cards/explain for automatic subs and
        // prebuilt pitch details. Keep only officially settled raw feeds on
        // disk; the active GW always reads the current official source.
        const detailCacheFile = path.join(cacheDir, `draft-live-detail-v1-gw${gw}.json`);
        const live = isSettled && gw === reportGw && fs.existsSync(detailCacheFile)
          ? JSON.parse(fs.readFileSync(detailCacheFile, 'utf8'))
          : await requestJson(`${DRAFT_API}/event/${gw}/live`);
        rawLiveByGw.set(gw, live);
        if (gw === reportGw) {
          reportLivePayload = live;
          reportLiveRequestedAt = sourceTimes.get(`${DRAFT_API}/event/${gw}/live`) ?? clock();
        }
        const m = new Map();
        for (const [elementId, el] of Object.entries(live.elements || {})) {
          if (Number.isFinite(el.stats?.total_points)) m.set(Number(elementId), el.stats.total_points);
        }
        if (!m.size) throw new Error('Draft live response has no player scores');
        livePointsByGw.set(gw, m);
        if (isSettled) {
          try { fs.writeFileSync(cacheFile, JSON.stringify([...m])); } catch (e) { /* ignore */ }
          if (gw === reportGw) {
            try { fs.writeFileSync(detailCacheFile, JSON.stringify(live)); } catch (e) { /* ignore */ }
          }
        }
      } catch (err) {
        console.warn(`[warn] live fetch failed for GW${gw}: ${err.message}`);
        // Keep serving the previous snapshot on a current-feed error; never
        // publish a fresh timestamp around fabricated zero points.
        if (gw === reportGw) throw err;
      }
    }
  }
  const livePoints = livePointsByGw.get(lastFinishedGw) || new Map();
  const reportPoints = livePointsByGw.get(reportGw) || new Map();

  // Keep the latest finished Draft GW score on every player. Classic FPL's
  // `event_points` can move to a different event around deadlines, while the
  // Draft live endpoint is the authoritative score source for this league.
  for (const player of players) {
    player.lastGwPoints = livePoints.get(player.id) ?? 0;
    player.liveGwPoints = reportPoints.get(player.id) ?? 0;
  }

  // Freeze membership from that GW's complete official squads, not today's
  // element-status. Scores may still settle; owned/free attribution must not.
  const ownershipPicksByGw = new Map();
  const loadOwnership = async (gw) => {
    const context = { leagueId, season: '2026/27', gw,
      deadline: events.find(event => event.id === gw)?.deadline_time,
      entries: leagueEntries, now: clock() };
    if ((league.id != null && Number(league.id) !== leagueId)
      || !(Date.parse(context.deadline || '') <= context.now)) return null;
    const cacheKey = ownershipCacheKey(context);
    if (!cacheKey) return null;
    const file = path.join(cacheDir, cacheKey);
    // Its own complete membership was verified at capture time. A manager
    // leaving/renaming later must not rewrite that historical league roster.
    const { entries: _currentEntries, ...cacheContext } = context;
    const readFrozen = () => {
      try {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        return isValidOwnershipSnapshot(saved, { ...cacheContext, now: clock() }) ? saved : null;
      } catch (_) { return null; }
    };
    const saved = readFrozen();
    if (saved) return saved;
    if (gw < Math.max(1, Number(league.start_event) || 1)) return null;
    const picksByEntry = new Map();
    const payloads = new Map();
    // Bounded concurrency for the one-time history backfill. Current GW reuses
    // the already fetched exact-GW payload; never relabel a fallback lineup.
    for (let offset = 0; offset < leagueEntries.length; offset += 4) {
      await Promise.all(leagueEntries.slice(offset, offset + 4).map(async entry => {
        try {
          const payload = squadGwByEntry.get(entry.entry_id) === gw
            ? squads.get(entry.entry_id)
            : await requestJson(`${DRAFT_API}/entry/${entry.entry_id}/event/${gw}`);
          payloads.set(entry.entry_id, payload);
          if (!Array.isArray(payload?.picks) || payload.picks.some(pick => !playersById.has(Number(pick.element)))) {
            throw new Error('Historical squad contains missing or unknown Draft player IDs');
          }
          picksByEntry.set(entry.entry_id, { entryId: entry.entry_id, gw, payload });
        } catch (error) {
          console.warn(`[totw] historical squad unavailable league=${leagueId} gw=${gw} entry=${entry.entry_id}: ${error.message}`);
        }
      }));
    }
    const frozen = buildOwnershipSnapshot({ ...context, now: clock(), picksByEntry });
    if (frozen) {
      // Only validated full rosters may be reused by Classic scoring. Preserve
      // a valid snapshot another build saved while these requests were pending.
      ownershipPicksByGw.set(gw, payloads);
      const alreadyFrozen = readFrozen();
      if (alreadyFrozen) return alreadyFrozen;
      const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temporary, JSON.stringify(frozen), { flag: 'wx', mode: 0o600 });
        fs.renameSync(temporary, file);
      } catch (error) {
        try { fs.unlinkSync(temporary); } catch (_) { /* no temporary file to clean */ }
        console.warn(`[totw] ownership cache write failed league=${leagueId} gw=${gw}: ${error.message}`);
      }
    } else console.warn(`[totw] incomplete historical ownership league=${leagueId} gw=${gw}; do not label missing players free`);
    return frozen;
  };

  // Team of the Week per GW, including the active round (legal best XI).
  const totwByGw = {};
  for (const [gw, pts] of livePointsByGw) {
    const team = buildDreamTeam(players, pts);
    if (team && team.players && team.players.length) {
      totwByGw[gw] = applyOwnership(team, await loadOwnership(gw));
    }
  }
  const dreamTeam = totwByGw[reportGw] || applyOwnership(buildDreamTeam(players, reportPoints), null);

  const reportScores = new Map();
  const reportLineups = new Map();
  for (const entry of leagueEntries) {
    if (squadGwByEntry.get(entry.entry_id) !== reportGw) continue;
    const payload = squads.get(entry.entry_id);
    effectivePositions(payload);
    for (const pick of payload.picks) {
      const stats = reportLivePayload?.elements?.[pick.element]?.stats;
      if (!Number.isFinite(stats?.minutes) || stats.minutes < 0
        || !Number.isFinite(stats?.yellow_cards) || stats.yellow_cards < 0
        || !Number.isFinite(stats?.red_cards) || stats.red_cards < 0
        || !Number.isFinite(stats?.total_points)) {
        throw new Error(`Incomplete live appearance data for Draft player ${pick.element}`);
      }
    }
    const lineup = resolveAutoSubs(payload, playersById, reportLivePayload, currentFixtures, classicBoot.teams, {
      gw: reportGw, finished: gameweekState.gwFinished,
    });
    reportLineups.set(entry.entry_id, lineup);
    const score = scoreLockedPicks(payload, reportPoints, lineup.positions);
    if (score != null) reportScores.set(entry.id, score);
  }
  if (gameweekState.reportLive && reportScores.size !== leagueEntries.length) {
    throw new Error('Current GW locked Draft lineups are not all available yet');
  }
  const reportSourceTimes = [reportLiveRequestedAt,
    sourceTimes.get(`${CLASSIC_API}/fixtures/?event=${reportGw}`),
    ...[...reportLineups.keys()].map((id) => sourceTimes.get(`${DRAFT_API}/entry/${id}/event/${reportGw}`))];
  const reportSourceTime = reportGw > 0 && reportSourceTimes.every(Number.isFinite)
    ? Math.min(...reportSourceTimes) : null;
  matches = applyLiveMatchScores(matches, reportGw, reportScores, gameweekState);
  // Rebuild from each unique match, instead of adding a provisional GW to an
  // official table that may already include it. API matches_played can contain
  // the full-season fixture count, so derive that too.
  if (league.scoring !== 'c' && matches.length) {
    standingsByLeagueEntryId = new Map(rebuildH2HStandings(leagueEntries, matches, reportGw, standings)
      .map((row) => [row.league_entry, row]));
  }
  for (const match of matches) {
    if (!match.started || match.event > reportGw) continue;
    for (const [id, points] of [[match.league_entry_1, match.league_entry_1_points], [match.league_entry_2, match.league_entry_2_points]]) {
      if (id == null || points == null) continue;
      if (!gwScores.has(id)) gwScores.set(id, []);
      if (!gwScores.get(id).some((row) => row.gw === match.event)) gwScores.get(id).push({ gw: match.event, points });
    }
  }
  for (const arr of gwScores.values()) arr.sort((a, b) => a.gw - b.gw);

  // Classic Draft has no H2H match history and entry_history can be {}. Its
  // standings.total can already include this GW, so never blindly add live
  // points to it. Reconstruct from each GW's locked squad once, retaining only
  // officially settled lineup caches for following refreshes.
  if (league.scoring === 'c' && reportGw > 0) {
    const classicRows = [];
    for (const entry of leagueEntries) {
      const history = [];
      for (let gw = Math.max(1, Number(league.start_event) || 1); gw <= reportGw; gw++) {
        let payload;
        if (squadGwByEntry.get(entry.entry_id) === gw) payload = squads.get(entry.entry_id);
        else if (ownershipPicksByGw.get(gw)?.has(entry.entry_id)) {
          payload = ownershipPicksByGw.get(gw).get(entry.entry_id);
          const event = events.find((item) => item.id === gw);
          if (event?.finished && event?.data_checked !== false && payload?.picks?.length) {
            fs.writeFileSync(path.join(cacheDir, `draft-picks-v1-entry${entry.entry_id}-gw${gw}.json`), JSON.stringify(payload));
          }
        }
        else {
          const file = path.join(cacheDir, `draft-picks-v1-entry${entry.entry_id}-gw${gw}.json`);
          const event = events.find((item) => item.id === gw);
          const settled = event?.finished && event?.data_checked !== false;
          if (settled && fs.existsSync(file)) payload = JSON.parse(fs.readFileSync(file, 'utf8'));
          else {
            payload = await requestJson(`${DRAFT_API}/entry/${entry.entry_id}/event/${gw}`);
            if (settled && payload?.picks?.length) fs.writeFileSync(file, JSON.stringify(payload));
          }
        }
        const points = scoreLockedPicks(payload, livePointsByGw.get(gw) || new Map(),
          gw === reportGw ? reportLineups.get(entry.entry_id)?.positions : null);
        if (points == null) throw new Error(`Draft scoring unavailable for entry ${entry.entry_id} GW${gw}`);
        history.push({ gw, points });
      }
      gwScores.set(entry.id, history);
      const previous = standingsByLeagueEntryId.get(entry.id) || {};
      classicRows.push({ ...previous, league_entry: entry.id, total: history.reduce((sum, item) => sum + item.points, 0), matches_played: history.length });
    }
    classicRows.sort((a, b) => b.total - a.total || (a.rank || 99) - (b.rank || 99));
    classicRows.forEach((row, index) => { row.rank = index && row.total === classicRows[index - 1].total ? classicRows[index - 1].rank : index + 1; });
    standingsByLeagueEntryId = new Map(classicRows.map((row) => [row.league_entry, row]));
  }

  // 7. Compose per-manager data -------------------------------------------
  const managers = leagueEntries.map((e) => {
    const st = standingsByLeagueEntryId.get(e.id) || {};
    const picksData = squads.get(e.entry_id) || { picks: [] };
    const previousPicks = (picksData.picks || []).map((p) => ({
      element: p.element,
      position: p.position,
    }));
    const currentPlayers = players.filter((p) => p.owner === e.entry_id);
    const currentIds = new Set(currentPlayers.map((p) => p.id));
    const previousIds = new Set(previousPicks.map((p) => p.element));
    const kept = previousPicks.filter((p) => currentIds.has(p.element));
    const departed = previousPicks.filter((p) => !currentIds.has(p.element));
    const incoming = currentPlayers.filter((p) => !previousIds.has(p.id));

    // FPL's picks endpoint describes the locked/active GW, while element-status
    // reflects ownership immediately after waivers and trades. Rebuild the
    // current squad by preserving unchanged positions and placing each incoming
    // player in the same-position slot vacated by an outgoing player.
    const vacanciesByPos = { GKP: [], DEF: [], MID: [], FWD: [] };
    for (const pick of departed) {
      const pos = playersById.get(pick.element)?.pos;
      if (pos && vacanciesByPos[pos]) vacanciesByPos[pos].push(pick.position);
    }
    Object.values(vacanciesByPos).forEach((slots) => slots.sort((a, b) => a - b));
    const usedPositions = new Set(kept.map((p) => p.position));
    const firstUnusedPosition = () => {
      for (let position = 1; position <= 15; position++) {
        if (!usedPositions.has(position)) return position;
      }
      return usedPositions.size + 1;
    };
    const addedPicks = incoming
      .sort((a, b) => a.posId - b.posId || a.name.localeCompare(b.name))
      .map((player) => {
        const position = vacanciesByPos[player.pos]?.shift() ?? firstUnusedPosition();
        usedPositions.add(position);
        return { element: player.id, position };
      });
    const currentPicks = [...kept, ...addedPicks];

    const picks = currentPicks.map((p) => {
      const pl = playersById.get(p.element) || {};
      return {
        element: p.element,
        position: p.position,
        player: playerLite(pl),
      };
    });
    const squadValue =
      Math.round(picks.reduce((s, p) => s + (p.player.nowCost || 0), 0) * 10) / 10;
    // Draft has no captain multiplier, but only the starting XI scores. Keep
    // bench players out of matchup forecasts and projected rankings.
    const projected = Math.round(
      picks.filter((p) => p.position <= 11).reduce(
        (s, p) => s + (p.player.epNext || 0),
        0
      ) * 10
    ) / 10;
    const history = (gwScores.get(e.id) || [])
      .filter((h) => h.points != null)
      .map((h) => ({ gw: h.gw, points: h.points }));
    if (!history.length && reportGw > 0 && reportScores.has(e.id)) {
      history.push({ gw: reportGw, points: reportScores.get(e.id) });
    }
    const last5 = history.slice(-5).map((h) => h.points);
    const formAvg = last5.length
      ? Math.round((last5.reduce((a, b) => a + b, 0) / last5.length) * 10) / 10
      : null;
    return {
      leagueEntryId: e.id,
      entryId: e.entry_id,
      entryName: e.entry_name,
      playerName: `${e.player_first_name || ''} ${e.player_last_name || ''}`.trim(),
      shortName: e.short_name || '',
      rank: st.rank || null,
      lastRank: st.last_rank ?? null,
      total: st.total ?? null, // h2h total (3/1/0 per match)
      matchesPlayed: st.matches_played ?? 0,
      matchesWon: st.matches_won ?? 0,
      matchesDrawn: st.matches_drawn ?? 0,
      matchesLost: st.matches_lost ?? 0,
      pointsFor: league.scoring === 'c' ? (st.total ?? 0) : (st.points_for ?? 0),
      pointsAgainst: st.points_against ?? 0,
      liveGwPoints: reportScores.get(e.id) ?? history.find((item) => item.gw === reportGw)?.points ?? null,
      reportGwPoints: reportScores.get(e.id) ?? history.find((item) => item.gw === reportGw)?.points ?? null,
      autoSubsProvisional: !!reportLineups.get(e.entry_id)?.provisional,
      picks,
      squadValue,
      lineupSourceGw: squadGwByEntry.get(e.entry_id) || null,
      lineupNote: `成员按最新交易归属更新；首发／替补参考${squadGwByEntry.get(e.entry_id) ? ' GW' + squadGwByEntry.get(e.entry_id) + ' 公开阵容' : '可用位置'}，下一轮截止前的排位调整官方暂不公开。`,
      projected,
      history,
      formAvg,
      squadCount: picks.length,
    };
  });
  managers.sort((a, b) => (a.rank || 99) - (b.rank || 99));

  // value ranking (classic squad price)
  const valueRanking = [...managers]
    .sort((a, b) => b.squadValue - a.squadValue)
    .map((m, i) => ({ entryId: m.entryId, rank: i + 1, squadValue: m.squadValue }));
  const valueRankByEntry = new Map(valueRanking.map((v) => [v.entryId, v.rank]));
  const projectedRanking = [...managers]
    .sort((a, b) => b.projected - a.projected)
    .map((m, i) => ({ entryId: m.entryId, rank: i + 1 }));
  const projRankByEntry = new Map(projectedRanking.map((v) => [v.entryId, v.rank]));

  // 8. Transactions ---------------------------------------------------------
  // The transactions API can retain the just-finished event number after its
  // deadline. The actual effective GW is the first GW whose deadline is still
  // ahead of the transaction timestamp.
  const effectiveGw = (timestamp, fallbackGw) => {
    const at = Date.parse(timestamp || '');
    if (!Number.isFinite(at)) return fallbackGw;
    const event = events.find((e) => {
      const deadline = Date.parse(e.deadline_time || '');
      return Number.isFinite(deadline) && deadline > at;
    });
    return event ? event.id : fallbackGw;
  };

  const standardTx = (transactions.transactions || []).map((t) => {
    const pIn = playersById.get(t.element_in) || null;
    const pOut = playersById.get(t.element_out) || null;
    const mgr = entryByEntryId.get(t.entry) || null;
    return {
      id: t.id,
      gw: effectiveGw(t.added, t.event),
      sourceGw: t.event,
      kind: t.kind, // 'w' = waiver, 'f' = free agent
      result: t.result, // 'a' accepted, 'do' denied etc.
      entryId: t.entry,
      manager: mgr ? mgr.entry_name : `#${t.entry}`,
      playerShort: mgr ? mgr.short_name : '',
      elementIn: t.element_in,
      elementOut: t.element_out,
      playerIn: pIn ? playerLite(pIn) : null,
      playerOut: pOut ? playerLite(pOut) : null,
      added: t.added,
      priority: t.priority,
      index: t.index,
    };
  });

  // Direct manager-to-manager trades are exposed by a separate FPL endpoint.
  // Keep each multi-player deal as one transaction and retain both sides.
  const directTrades = (leagueTrades.trades || []).map((t) => {
    const offered = entryByEntryId.get(t.offered_entry) || null;
    const received = entryByEntryId.get(t.received_entry) || null;
    const items = t.tradeitem_set || [];
    const elementsIn = items.map((x) => x.element_in);
    const elementsOut = items.map((x) => x.element_out);
    const playersIn = elementsIn.map((id) => playersById.get(id)).filter(Boolean).map(playerLite);
    const playersOut = elementsOut.map((id) => playersById.get(id)).filter(Boolean).map(playerLite);
    const completedAt = t.response_time || t.offer_time;
    return {
      id: `trade-${t.id}`,
      tradeId: t.id,
      gw: effectiveGw(completedAt, t.event),
      sourceGw: t.event,
      kind: 't',
      result: 'a',
      tradeState: t.state,
      entryId: t.offered_entry,
      manager: offered ? offered.entry_name : `#${t.offered_entry}`,
      counterpartyEntryId: t.received_entry,
      counterparty: received ? received.entry_name : `#${t.received_entry}`,
      elementsIn,
      elementsOut,
      playersIn,
      playersOut,
      elementIn: elementsIn[0] ?? null,
      elementOut: elementsOut[0] ?? null,
      playerIn: playersIn[0] || null,
      playerOut: playersOut[0] || null,
      added: completedAt,
    };
  });

  const txAll = [...standardTx, ...directTrades]
    .sort((a, b) => String(b.added || '').localeCompare(String(a.added || '')));
  const lastGwTx = txAll.filter((t) => t.gw === lastFinishedGw);
  const currentGwTx = txAll.filter((t) => t.gw === currentGw);

  // 8b. Trade impact analysis ------------------------------------------------
  // For each ACCEPTED transaction, track real points of the player in vs the
  // player out, per finished GW from the deadline-derived effective GW
  // (inclusive) through lastFinishedGw. Multi-player direct trades are scored
  // as one package on each side.
  // Reuses livePointsByGw (already cached per GW) -> zero extra API calls.
  const ptsOfEl = (element, gw) => {
    const m = livePointsByGw.get(gw);
    return m ? (m.get(element) ?? null) : null;
  };
  const tradeImpact = txAll
    .filter((t) => t.result === 'a' && t.playerIn && t.playerOut)
    .map((t) => {
      const elementsIn = t.elementsIn?.length ? t.elementsIn : [t.elementIn];
      const elementsOut = t.elementsOut?.length ? t.elementsOut : [t.elementOut];
      const playersIn = t.playersIn?.length ? t.playersIn : [t.playerIn];
      const playersOut = t.playersOut?.length ? t.playersOut : [t.playerOut];
      const gws = [];
      for (let g = Math.max(1, t.gw); g <= lastFinishedGw; g++) gws.push(g);
      const packagePoints = (elements, gw) => elements.reduce((sum, element) => sum + (ptsOfEl(element, gw) || 0), 0);
      const inSeries = gws.map((g) => ({ gw: g, pts: packagePoints(elementsIn, g) }));
      const outSeries = gws.map((g) => ({ gw: g, pts: packagePoints(elementsOut, g) }));
      const sumPts = (arr) => arr.reduce((s, x) => s + (x.pts || 0), 0);
      const inTotal = sumPts(inSeries);
      const outTotal = sumPts(outSeries);
      return {
        id: t.id,
        gw: t.gw,
        kind: t.kind,
        entryId: t.entryId,
        manager: t.manager,
        counterparty: t.counterparty || null,
        playerIn: t.playerIn,
        playerOut: t.playerOut,
        playersIn,
        playersOut,
        gwCount: gws.length,
        inTotal,
        outTotal,
        net: inTotal - outTotal,
        inLast: packagePoints(elementsIn, lastFinishedGw),
        outLast: packagePoints(elementsOut, lastFinishedGw),
        inSeries,
        outSeries,
      };
    })
    .sort((a, b) => b.gw - a.gw || b.net - a.net);

  // Keep the legacy tradeImpact payload for compatibility. The new cards use
  // manager-level deadline changes and finite acquisition holding spells,
  // including the live report GW, without fetching additional upstream data.
  const scoringGw = latestScoringGw(livePointsByGw, reportGw, reportLivePayload);
  const tradeReturns = buildTradeReturns({ transactions: txAll, livePointsByGw, reportGw, scoringGw, managers });

  // 9. GW history summary (from h2h matches) ---------------------------------
  const gwSummary = {};
  for (const m of matches) {
    if (!m.started || m.event > reportGw) continue; // future rounds
    if (m.league_entry_1_points == null && m.league_entry_2_points == null) continue;
    const g = (gwSummary[m.event] = gwSummary[m.event] || []);
    if (m.league_entry_1_points != null) g.push(m.league_entry_1_points);
    if (m.league_entry_2_points != null) g.push(m.league_entry_2_points);
  }
  let gwHistory = Object.entries(gwSummary)
    .map(([gw, scores]) => ({
      gw: Number(gw),
      highest: Math.max(...scores),
      lowest: Math.min(...scores),
      average: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10,
    }))
    .sort((a, b) => a.gw - b.gw);
  if (!gwHistory.length && reportGw > 0) {
    const scores = managers
      .map((manager) => manager.history.find((item) => item.gw === reportGw)?.points)
      .filter((points) => points != null);
    if (scores.length) {
      gwHistory = [{
        gw: reportGw,
        highest: Math.max(...scores),
        lowest: Math.min(...scores),
        average: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10,
      }];
    }
  }

  // current GW matches (h2h fixtures)
  const mapMatch = (m) => ({
    gw: m.event,
    finished: m.finished,
    live: !!m.live,
    entry1: entryByLeagueEntryId.get(m.league_entry_1)?.entry_name || '',
    entry1Id: entryByLeagueEntryId.get(m.league_entry_1)?.entry_id,
    entry1Points: m.league_entry_1_points,
    entry2: entryByLeagueEntryId.get(m.league_entry_2)?.entry_name || '',
    entry2Id: entryByLeagueEntryId.get(m.league_entry_2)?.entry_id,
    entry2Points: m.league_entry_2_points,
    autoSubsProvisional: m.event === reportGw && !!(
      reportLineups.get(entryByLeagueEntryId.get(m.league_entry_1)?.entry_id)?.provisional
      || reportLineups.get(entryByLeagueEntryId.get(m.league_entry_2)?.entry_id)?.provisional),
  });
  // all h2h matches grouped by GW (for the report-tab GW slicer)
  const h2hByGw = {};
  for (const m of matches) {
    if (!m.started || m.event > reportGw) continue;
    (h2hByGw[m.event] = h2hByGw[m.event] || []).push(mapMatch(m));
  }
  const currentGwMatches = matches
    .filter((m) => m.event === currentGw)
    .map(mapMatch);
  const upcomingGwMatches = matches
    .filter((m) => m.event === upcomingGw)
    .map(mapMatch);
  const lastGwMatches = (h2hByGw[lastFinishedGw] || []).slice();

  // fixtures for upcoming GW (difficulty reference)
  // draft bootstrap fixtures is a dict keyed by GW string
  const fixturesByGw = draftBoot.fixtures || {};
  const fixturesList = Array.isArray(fixturesByGw)
    ? fixturesByGw
    : Object.values(fixturesByGw).flat();
  const draftFixtures = fixturesList.filter((f) => f.event === upcomingGw);
  const nextFixtures = draftFixtures.map((f) => {
    const h = draftTeams.get(f.team_h) || {};
    const a = draftTeams.get(f.team_a) || {};
    return {
      gw: f.event,
      home: h.name || '',
      homeShort: h.short_name || '',
      away: a.name || '',
      awayShort: a.short_name || '',
      kickoff: f.kickoff_time || null,
    };
  });

  const snapshot = {
    meta: {
      leagueName: league.name
        || (leagueId === config.leagueId ? config.leagueName : '')
        || 'FPL Draft League',
      leagueId,
      scoring: league.scoring,
      leagueStartGw: Math.max(1, Number(league.start_event) || 1),
      currentGw,
      lastFinishedGw,
      upcomingGw,
      ...gameweekState,
      ...displayState,
      snapshotSchema: SNAPSHOT_SCHEMA,
      autoSubsProvisional: [...reportLineups.values()].some((lineup) => lineup.provisional),
      standingsLive: gameweekState.reportLive,
      reportStatus: gameweekState.reportLive ? 'live' : reportGw ? 'finished' : 'upcoming',
      refreshSeconds: WORKSPACE_INTERVAL / 1000,
      updated: new Date().toISOString(),
      ...(reportSourceTime != null ? {
        reportSourceUpdated: new Date(reportSourceTime).toISOString(),
        reportSourceExpiresAt: new Date(reportSourceTime + LIVE_REFRESH_MS).toISOString(),
      } : {}),
      buildMs: Date.now() - t0,
      playersCount: players.length,
      refreshMinutes: config.refreshMinutes,
      season: '2026/27',
    },
    // Draft owns waiver/free-agency timing; never substitute Classic kickoff times.
    tradeWindows: require('./public/trade-countdown').windowsFromDraft(draftBoot.events),
    events: events.map((e) => ({
      id: e.id,
      name: e.name,
      deadline: e.deadline_time,
      isCurrent: !!e.is_current,
      isNext: !!e.is_next,
      finished: !!e.finished,
      dataChecked: e.data_checked !== false,
    })),
    managers: managers.map((m) => ({
      ...m,
      valueRank: valueRankByEntry.get(m.entryId) || null,
      projectedRank: projRankByEntry.get(m.entryId) || null,
    })),
    players,
    transactions: {
      all: txAll,
      lastGw: lastGwTx,
      currentGw: currentGwTx,
    },
    tradeImpact,
    tradeReturns,
    dreamTeam,
    totwByGw,
    gwHistory,
    currentGwMatches,
    upcomingGwMatches,
    lastGwMatches,
    reportGwMatches: (h2hByGw[reportGw] || []).slice(),
    h2hByGw,
    // Full official H2H calendar, not just started/report/next-GW matches.
    // Future API zeroes are placeholders, never actual 0:0 results.
    leagueSchedule: matches.filter(m => Number.isInteger(m.event) && m.event >= 1 && m.event <= 38).map(m => ({
      ...mapMatch(m),
      started: !!m.started,
      entry1: entryByLeagueEntryId.get(m.league_entry_1)?.entry_name
        || (m.league_entry_1 == null || m.league_entry_1 === 0 ? '联赛平均分' : `未知队伍 #${m.league_entry_1}`),
      entry2: entryByLeagueEntryId.get(m.league_entry_2)?.entry_name
        || (m.league_entry_2 == null || m.league_entry_2 === 0 ? '联赛平均分' : `未知队伍 #${m.league_entry_2}`),
      entry1Points: m.started && Number.isFinite(m.league_entry_1_points) ? m.league_entry_1_points : null,
      entry2Points: m.started && Number.isFinite(m.league_entry_2_points) ? m.league_entry_2_points : null,
    })),
    nextFixtures,
    matchDetails: [],
  };

  // Build the current round once from the same locked picks, raw live feed
  // and resolved XI used by the report/standings. No per-match network calls,
  // no current-ownership lineup and no recursive snapshot-service warmup.
  if (reportGw > 0 && reportLivePayload) {
    const seen = new Set();
    for (const match of snapshot.reportGwMatches) {
      const ids = [match.entry1Id, match.entry2Id];
      if (!ids.every((id) => Number.isSafeInteger(id) && id > 0 && reportLineups.has(id)) || ids[0] === ids[1]) continue;
      const key = [...ids].sort((a, b) => a - b).join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const detail = buildMatchDetail({ snapshot, leagueId, gw: reportGw, entry1Id: ids[0], entry2Id: ids[1],
          picks: squads, live: reportLivePayload, fixtures: currentFixtures, teams: classicBoot.teams,
          lineups: reportLineups, now: clock() });
        const timestamps = [reportLiveRequestedAt,
          sourceTimes.get(`${CLASSIC_API}/fixtures/?event=${reportGw}`),
          ...ids.map((id) => sourceTimes.get(`${DRAFT_API}/entry/${id}/event/${reportGw}`))];
        if (timestamps.some((value) => !Number.isFinite(value))) throw new Error('Missing scoring-source timestamp');
        detail.updated = new Date(Math.min(...timestamps)).toISOString();
        if (clock() - Date.parse(detail.updated) >= LIVE_REFRESH_MS) {
          detail.stale = true;
          detail.refreshError = '官方数据响应较慢，显示带时间标记的阵容快照';
        }
        snapshot.matchDetails.push(detail);
      } catch (error) {
        // Only this match falls back to the on-demand endpoint; do not make
        // up player minutes or throw away the rest of the league's report.
        console.warn(`[match] precompute skipped ${leagueId}/${reportGw}/${key}: ${error.message}`);
      }
    }
  }
  snapshot.funRankings = await collectFunRankings({snapshot,events,teams:classicBoot.teams,fetchJson:requestJson,
    draftApi:DRAFT_API,classicApi:CLASSIC_API,cacheDir,squads,squadGwByEntry,ownershipPicksByGw,
    reportLive:reportLivePayload,reportFixtures:currentFixtures,reportLineups,rawLiveByGw});
  snapshot.meta.buildMs = Date.now() - t0;

  return snapshot;
}

function playerLite(p) {
  if (!p || !p.id) return null;
  return {
    id: p.id,
    name: p.name,
    fullName: p.fullName,
    team: p.team,
    teamName: p.teamName,
    teamCode: p.teamCode,
    teamStrength: p.teamStrength,
    pos: p.pos,
    nowCost: p.nowCost,
    form: p.form,
    ppg: p.ppg,
    epNext: p.epNext,
    totalPoints: p.totalPoints,
    eventPoints: p.eventPoints,
    lastGwPoints: p.lastGwPoints,
    liveGwPoints: p.liveGwPoints,
    minutes: p.minutes,
    goals: p.goals,
    assists: p.assists,
    cleanSheets: p.cleanSheets,
    xg: p.xg,
    xa: p.xa,
    xg90: p.xg90,
    xa90: p.xa90,
    news: p.news,
    status: p.status,
    chanceNext: p.chanceNext,
    owner: p.owner,
    photo: p.photo,
  };
}

/** Pick formation-legal best XI for the requested GW, including live rounds. */
function buildDreamTeam(players, livePoints) {
  if (!livePoints.size) return [];
  const byPos = { GKP: [], DEF: [], MID: [], FWD: [] };
  for (const p of players) {
    const pts = livePoints.get(p.id) ?? 0;
    if (byPos[p.pos]) byPos[p.pos].push({ p, pts });
  }
  if (!byPos.GKP.length) return [];
  Object.values(byPos).forEach((arr) => arr.sort((a, b) => b.pts - a.pts || a.p.id - b.p.id));

  // enumerate legal FPL formations: 1 GKP + d DEF (3-5) + m MID (2-5) + f FWD (1-3), d+m+f=10
  let best = null;
  for (let d = 3; d <= 5; d++) {
    for (let m = 2; m <= 5; m++) {
      const f = 10 - d - m;
      if (f < 1 || f > 3) continue;
      if (byPos.DEF.length < d || byPos.MID.length < m || byPos.FWD.length < f) continue;
      const total =
        sum(byPos.DEF.slice(0, d)) + sum(byPos.MID.slice(0, m)) + sum(byPos.FWD.slice(0, f));
      if (!best || total > best.total) best = { d, m, f, total };
    }
  }
  if (!best) return [];

  const sel = [
    ...byPos.GKP.slice(0, 1),
    ...byPos.DEF.slice(0, best.d),
    ...byPos.MID.slice(0, best.m),
    ...byPos.FWD.slice(0, best.f),
  ];
  const team = sel.map(({ p, pts }) => ({
    ...playerLite(p),
    gwPoints: pts,
  }));
  return { formation: `${best.d}-${best.m}-${best.f}`, players: team };
}

const sum = (arr) => arr.reduce((s, x) => s + x.pts, 0);

/* ------------------------------------------------------------------ */
/* Snapshot lifecycle                                                   */
/* ------------------------------------------------------------------ */

let building = null;
let lastSnapshot = null;
const leagueSnapshots = new Map();
const leagueBuilds = new Map();
const LEAGUE_CACHE_TTL_MS = Math.max(5, config.refreshMinutes || 15) * 60 * 1000;

async function refreshSnapshot() {
  if (building) return building;
  building = (async () => {
    try {
      const snap = await snapshotBuildGate.run(() => buildSnapshot());
      lastSnapshot = snap;
      snap.meta.revision = updates.publish(`league:${Number(snap.meta.leagueId)}`, snap);
      matchDetailService.prime(snap);
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap));
      console.log(
        `[snapshot] ok GW(current=${snap.meta.currentGw}, lastFinished=${snap.meta.lastFinishedGw}) ` +
        `managers=${snap.managers.length} tx=${snap.transactions.all.length} ` +
        `in ${snap.meta.buildMs}ms @ ${new Date().toLocaleTimeString()}`
      );
      return snap;
    } catch (err) {
      console.error('[snapshot] FAILED:', err.message);
      // keep serving stale data if present
      if (!lastSnapshot && fs.existsSync(SNAPSHOT_PATH)) {
        lastSnapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
      }
      throw err;
    } finally {
      building = null;
    }
  })();
  return building;
}

async function getSnapshot() {
  if (!lastSnapshot && fs.existsSync(SNAPSHOT_PATH)) {
    try { lastSnapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')); }
    catch (error) { console.warn('[snapshot] invalid disk snapshot:', error.message); }
  }
  if (isSnapshotFresh(lastSnapshot, LEAGUE_CACHE_TTL_MS)) return lastSnapshot;
  try { return await refreshSnapshot(); }
  catch (error) {
    if (!lastSnapshot) throw error;
    return { ...lastSnapshot, meta: { ...lastSnapshot.meta, stale: true, refreshError: '官方数据暂时不可用，显示上次成功更新的数据' } };
  }
}

function parseLeagueId(value) {
  const raw = String(value || '').trim();
  if (!/^\d{1,10}$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function leagueCachePath(leagueId) {
  return path.join(LEAGUE_CACHE_DIR, `${leagueId}.json`);
}

function allowLeagueLookup(req) {
  const key = anonHash(clientIp(req));
  const now = Date.now();
  const current = leagueLookupRates.get(key);
  if (!current || now - current.started > 60_000) {
    leagueLookupRates.set(key, { started: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= 15;
}

async function getLeagueSnapshot(leagueId, force = false) {
  if (leagueId === config.leagueId) {
    return force ? refreshSnapshot() : getSnapshot();
  }

  const now = Date.now();
  const memory = leagueSnapshots.get(leagueId);
  if (!force && isSnapshotFresh(memory, LEAGUE_CACHE_TTL_MS, now)) {
    return memory;
  }

  const cachePath = leagueCachePath(leagueId);
  if (!force && fs.existsSync(cachePath)) {
    try {
      const disk = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (isSnapshotFresh(disk, LEAGUE_CACHE_TTL_MS, now)) {
        leagueSnapshots.set(leagueId, disk);
        return disk;
      }
    } catch (e) { /* rebuild invalid cache */ }
  }

  if (leagueBuilds.has(leagueId)) return leagueBuilds.get(leagueId);
  const task = (async () => {
    const snap = await snapshotBuildGate.run(() => buildSnapshot(leagueId));
    leagueSnapshots.set(leagueId, snap);
    snap.meta.revision = updates.publish(`league:${leagueId}`, snap);
    matchDetailService.prime(snap);
    try {
      fs.mkdirSync(LEAGUE_CACHE_DIR, { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify(snap), { mode: 0o600 });
    } catch (e) {
      console.warn(`[league] cache write failed for ${leagueId}: ${e.message}`);
    }
    console.log(
      `[league] built id=${leagueId} name=${snap.meta.leagueName} `
      + `managers=${snap.managers.length} in ${snap.meta.buildMs}ms`
    );
    return snap;
  })().finally(() => leagueBuilds.delete(leagueId));
  leagueBuilds.set(leagueId, task);
  return task;
}

function readWorkspaceCache(leagueId) {
  const memory = leagueId === Number(config.leagueId) ? lastSnapshot : leagueSnapshots.get(leagueId);
  if (memory) return memory;
  const file = leagueId === Number(config.leagueId) ? SNAPSHOT_PATH : leagueCachePath(leagueId);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}
function isWorkspaceFresh(snapshot, _ttl, now = Date.now()) {
  return snapshot?.funRankings?.version === 1 && snapshot?.meta?.weeklyPolicyVersion === 1 && workspaceFresh(snapshot, SNAPSHOT_SCHEMA, now, leagueInvalidatedAt);
}
const workspaceRetry = new Map();
async function getWorkspaceSnapshot(leagueId) {
  const cached = readWorkspaceCache(leagueId);
  if (isWorkspaceFresh(cached)) {
    // Old persisted metadata is upgraded without forging its source timestamp.
    const snap = { ...cached, meta: { ...cached.meta, refreshSeconds: WORKSPACE_INTERVAL / 1000 } };
    snap.meta.revision = updates.publish(`league:${leagueId}`, snap);
    if (leagueId === Number(config.leagueId)) lastSnapshot = snap;
    else leagueSnapshots.set(leagueId, snap);
    return snap;
  }
  const staleResult = () => {
    if (!canServeWhileRefreshing(cached, leagueId, SNAPSHOT_SCHEMA, Date.now(), WORKSPACE_DISPLAY_POLICY)) {
      throw new Error('当前轮次数据暂不可用，请稍后重试');
    }
    const stale = { ...cached, meta: { ...cached.meta, stale: true, refreshing: false,
      refreshError: '官方数据暂时不可用，保留上次成功更新的数据', refreshSeconds: WORKSPACE_INTERVAL / 1000 } };
    updates.publish(`league:${leagueId}`, stale);
    return stale;
  };
  if (Date.now() < (workspaceRetry.get(leagueId) || 0)) {
    if (cached) return staleResult();
    throw new Error('官方数据暂不可用，正在等待重试，请稍后再试');
  }
  try {
    const snap = await getLeagueSnapshot(leagueId, true);
    workspaceRetry.delete(leagueId);
    return snap;
  }
  catch (error) {
    workspaceRetry.set(leagueId, Date.now() + 60_000);
    while (workspaceRetry.size > 200) workspaceRetry.delete(workspaceRetry.keys().next().value);
    updates.markStale(`league:${leagueId}`, { retryAt: new Date(workspaceRetry.get(leagueId)).toISOString() });
    if (!cached) throw error;
    return staleResult();
  }
}

// Explicit refresh must start after any older report build, not return a build
// whose ownership/picks were fetched before the click. Coalesce repeated clicks.
const manualRefreshes = new Map();
function refreshWorkspaceNow(leagueId) {
  if (manualRefreshes.has(leagueId)) return manualRefreshes.get(leagueId);
  const prior = leagueId === Number(config.leagueId) ? building : leagueBuilds.get(leagueId);
  const task = Promise.allSettled([
    Promise.resolve(prior).catch(() => {}).then(() => getLeagueSnapshot(leagueId, true)),
    matchCentreService.get(undefined, true).then(feed => publishMatchCentre(feed, null)),
  ]).then(([league, feed]) => {
    if (league.status === 'rejected') throw league.reason;
    return { snapshot: league.value, warning: feed.status === 'rejected' || feed.value?.meta?.stale
      ? '联赛与阵容成员已刷新；比赛动态暂时延迟，保留上次数据。' : null };
  }).finally(() => manualRefreshes.delete(leagueId));
  manualRefreshes.set(leagueId, task);
  return task;
}

// Public GETs may paint a bounded, clearly marked previous snapshot immediately
// while the original deduplicated loader refreshes it. Match authorization,
// scoring lifetimes and the manual force-refresh path are unchanged.
const getPublicLeagueSnapshot = createPublicSnapshotReader({
  schema: SNAPSHOT_SCHEMA,
  normalTtlMs: LEAGUE_CACHE_TTL_MS,
  displayPolicy: WORKSPACE_DISPLAY_POLICY,
  isFresh: isWorkspaceFresh,
  readCached(leagueId) {
    const memory = leagueId === config.leagueId ? lastSnapshot : leagueSnapshots.get(leagueId);
    if (memory) return memory;
    const file = leagueId === config.leagueId ? SNAPSHOT_PATH : leagueCachePath(leagueId);
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (_) { return null; }
  },
  rememberCached(leagueId, snapshot) {
    if (leagueId === config.leagueId) lastSnapshot = snapshot;
    else leagueSnapshots.set(leagueId, snapshot);
  },
  loadSnapshot: (leagueId) => getWorkspaceSnapshot(leagueId),
  onError: (error, leagueId) => console.warn(`[league] background refresh failed id=${leagueId}: ${error.message}`),
});

// A match needs recent league membership/player metadata, not a freshly built
// whole-league report. Its actual points, fixtures and locked picks are fetched
// separately by match-detail.js with a maximum sixty-second scoring lifetime.
// Cap this metadata shortcut at five minutes, and never let an older season or
// pre-deadline snapshot authorize a match that it cannot positively identify.
async function getMatchSnapshot(leagueId, gw, entry1Id, entry2Id) {
  const checkedAt = Date.now();
  const eligible = (snapshot) => {
    if (!snapshot || snapshot.meta?.snapshotSchema !== SNAPSHOT_SCHEMA || snapshot.meta?.stale) return false;
    const updated = Date.parse(snapshot.meta.updated || '');
    if (!Number.isFinite(updated) || updated > checkedAt || checkedAt - updated >= 5 * 60_000) return false;
    const season = /^(\d{4})\/(\d{2})$/.exec(snapshot.meta.season || '');
    if (!season || Number(season[2]) !== (Number(season[1]) + 1) % 100) return false;
    const seasonStart = Date.UTC(Number(season[1]), 6, 1);
    const seasonEnd = Date.UTC(Number(season[1]) + 1, 6, 1);
    const firstDeadline = Date.parse((snapshot.events || []).find((event) => event.id === 1)?.deadline || '');
    const matchDeadline = Date.parse((snapshot.events || []).find((event) => event.id === gw)?.deadline || '');
    if (!(checkedAt >= seasonStart && checkedAt < seasonEnd
      && firstDeadline >= seasonStart && firstDeadline < seasonEnd
      && matchDeadline >= seasonStart && matchDeadline < seasonEnd)) return false;
    try {
      validateMatchRequest(snapshot, leagueId, gw, entry1Id, entry2Id, checkedAt);
      return true;
    } catch (_) { return false; }
  };

  const memory = leagueId === config.leagueId ? lastSnapshot : leagueSnapshots.get(leagueId);
  if (eligible(memory)) return memory;
  if (!memory) {
    const cachePath = leagueId === config.leagueId ? SNAPSHOT_PATH : leagueCachePath(leagueId);
    try {
      if (fs.existsSync(cachePath)) {
        const disk = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        if (eligible(disk)) return disk;
      }
    } catch (_) { /* The regular getter handles absent or invalid cache data. */ }
  }

  let snapshot = await getLeagueSnapshot(leagueId);
  const metadataIsRecent = (value) => {
    const updated = Date.parse(value?.meta?.updated || '');
    const age = Date.now() - updated;
    return Number.isFinite(age) && age >= 0 && age < 5 * 60_000;
  };
  // Off-peak report caching can normally last fifteen minutes. The match
  // shortcut has a tighter metadata bound even when no football is live.
  if (!snapshot?.meta?.stale && !metadataIsRecent(snapshot)) {
    snapshot = await getLeagueSnapshot(leagueId, true);
  }
  // The default snapshot getter may fall back to stale metadata after an API
  // failure. Do not present fresh match scores joined to unbounded old clubs.
  if (snapshot?.meta?.stale || !metadataIsRecent(snapshot)) {
    throw new MatchDetailError(502, 'MATCH_DATA_UNAVAILABLE', '联赛资料暂时无法更新，请稍后重试');
  }
  return snapshot;
}

const matchDetailService = createMatchDetailService({
  getSnapshot: getMatchSnapshot,
  fetchJson,
  draftApi: DRAFT_API,
  classicApi: CLASSIC_API,
});

/* ------------------------------------------------------------------ */
/* Privacy-friendly first-party analytics                              */
/* ------------------------------------------------------------------ */

function jsonResponse(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req, maxBytes = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > maxBytes) reject(new Error('Request body too large'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.headers['x-real-ip'] || req.socket.remoteAddress || 'unknown';
}

function anonHash(value) {
  return crypto.createHmac('sha256', ANALYTICS_SALT).update(String(value)).digest('hex').slice(0, 20);
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch (e) { return false; }
}

function dateKey(ts) {
  return new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

function hourInShanghai(ts) {
  return Number(new Date(ts).toLocaleString('en-US', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false,
  }).replace(/^24$/, '0'));
}

function parseUserAgent(ua = '') {
  const value = String(ua);
  const bot = /bot|crawler|spider|slurp|headless|preview|facebookexternalhit|bingpreview/i.test(value);
  const device = /ipad|tablet/i.test(value)
    ? '平板'
    : /mobile|iphone|ipod|android/i.test(value) ? '手机' : '桌面';
  let browser = '其他';
  if (/Edg\//.test(value)) browser = 'Edge';
  else if (/OPR\//.test(value)) browser = 'Opera';
  else if (/Chrome\//.test(value)) browser = 'Chrome';
  else if (/Firefox\//.test(value)) browser = 'Firefox';
  else if (/Safari\//.test(value)) browser = 'Safari';
  let os = '其他';
  if (/iPhone|iPad|iPod/.test(value)) os = 'iOS';
  else if (/Android/.test(value)) os = 'Android';
  else if (/Mac OS X|Macintosh/.test(value)) os = 'macOS';
  else if (/Windows/.test(value)) os = 'Windows';
  else if (/Linux/.test(value)) os = 'Linux';
  return { bot, device, browser, os };
}

function cleanReferrer(raw, host) {
  if (!raw) return '直接访问';
  try {
    const ref = new URL(String(raw));
    if (ref.host === host) return '站内访问';
    return ref.hostname.replace(/^www\./, '') || '直接访问';
  } catch (e) {
    return '直接访问';
  }
}

function allowAnalyticsEvent(req) {
  const key = anonHash(clientIp(req));
  const now = Date.now();
  if (analyticsRates.size > 5000) {
    for (const [rateKey, value] of analyticsRates) {
      if (now - value.started > 60_000) analyticsRates.delete(rateKey);
    }
  }
  const current = analyticsRates.get(key);
  if (!current || now - current.started > 60_000) {
    analyticsRates.set(key, { started: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= 120;
}

function sanitizeText(value, max = 80) {
  return String(value || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, max);
}

function analyticsVisitorId(req) {
  return anonHash(`${clientIp(req)}|${String(req.headers['user-agent'] || '')}`);
}

function internalAnalyticsRequest(req) {
  return isAdmin(req) || internalTraffic.verifyMarker(parseCookies(req)[INTERNAL_COOKIE]);
}

function markInternalBrowser(req) {
  internalTraffic.remember(analyticsVisitorId(req));
  return `${INTERNAL_COOKIE}=${encodeURIComponent(internalTraffic.issueMarker())}; Path=/; HttpOnly${adminCookieSecurity(req)}; SameSite=Strict; Max-Age=${MARKER_MAX_AGE}`;
}

function ensureAnalyticsCollectionStarted() {
  if (leagueTrackingSince) return leagueTrackingSince;
  if (fs.existsSync(ANALYTICS_COLLECTION_PATH)) {
    const saved = JSON.parse(fs.readFileSync(ANALYTICS_COLLECTION_PATH, 'utf8'));
    if (saved.version !== 2 || !Number.isFinite(saved.leagueTrackingSince)) {
      throw new Error('联赛流量统计起点记录无效');
    }
    leagueTrackingSince = saved.leagueTrackingSince;
  } else {
    const started = Date.now();
    fs.mkdirSync(ANALYTICS_DIR, { recursive: true });
    fs.writeFileSync(ANALYTICS_COLLECTION_PATH, JSON.stringify({ version: 2, leagueTrackingSince: started }), { mode: 0o600 });
    leagueTrackingSince = started;
  }
  return leagueTrackingSince;
}

function analyticsLeague(leagueId) {
  const id = parseLeagueId(leagueId);
  if (!id) return null;
  const snap = id === Number(config.leagueId) ? lastSnapshot : leagueSnapshots.get(id);
  return Number(snap?.meta?.leagueId) === id ? { id, name: snap.meta.leagueName } : null;
}

function recordAnalyticsEvent(req, body) {
  const allowedTypes = new Set(['pageview', 'tab_view', 'engagement', 'league_use']);
  if (!body || typeof body !== 'object' || !allowedTypes.has(body.type)) return false;
  const type = body.type;
  const league = analyticsLeague(body.leagueId);
  // A cached validated snapshot proves that this league really exists. Raw
  // query strings, failed lookups and routine API refreshes are not adoption.
  if (type === 'league_use' && !league) return false;
  ensureAnalyticsCollectionStarted();
  const ua = String(req.headers['user-agent'] || '');
  const parsed = parseUserAgent(ua);
  const ts = Date.now();
  const internal = internalAnalyticsRequest(req);
  const vid = analyticsVisitorId(req);
  if (internal) internalTraffic.remember(vid);
  const event = {
    v: 2,
    ts,
    type,
    sid: sanitizeText(body.sid, 64) || anonHash(`${clientIp(req)}|${ts}`),
    vid,
    internal,
    leagueId: league?.id || null,
    ...(type === 'league_use' ? { leagueName: sanitizeText(league.name, 120) } : {}),
    path: sanitizeText(body.path || '/', 120),
    tab: sanitizeText(body.tab || 'weekly', 40),
    referrer: cleanReferrer(body.referrer, req.headers.host),
    device: parsed.device,
    browser: parsed.browser,
    os: parsed.os,
    screenWidth: Math.max(0, Math.min(10000, Number(body.screenWidth) || 0)),
    duration: type === 'engagement'
      ? Math.max(0, Math.min(1800, Math.round(Number(body.duration) || 0)))
      : 0,
    bot: parsed.bot,
  };
  fs.mkdirSync(ANALYTICS_DIR, { recursive: true });
  const file = path.join(ANALYTICS_DIR, `${dateKey(ts)}.jsonl`);
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > 25 * 1024 * 1024) return;
  } catch (e) { /* append attempt below will surface real errors */ }
  fs.appendFile(file, `${JSON.stringify(event)}\n`, { mode: 0o600 }, (err) => {
    if (err) console.error('[analytics] append failed:', err.message);
  });
  return true;
}

function pruneAnalyticsFiles(retentionDays = 400) {
  if (!fs.existsSync(ANALYTICS_DIR)) return;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(ANALYTICS_DIR)) {
    const match = name.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/);
    if (!match) continue;
    const fileTs = Date.parse(`${match[1]}T00:00:00+08:00`);
    if (Number.isFinite(fileTs) && fileTs < cutoff) {
      try { fs.unlinkSync(path.join(ANALYTICS_DIR, name)); } catch (e) { /* keep serving */ }
    }
  }
}

function timingSafeTextEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifyAdminPassword(candidate) {
  if (ADMIN_PASSWORD) return timingSafeTextEqual(candidate, ADMIN_PASSWORD);
  const [algorithm, salt, expected] = String(ADMIN_PASSWORD_HASH).split('$');
  if (algorithm !== 'scrypt' || !salt || !expected) return false;
  try {
    const actual = crypto.scryptSync(String(candidate), salt, 32).toString('base64url');
    return timingSafeTextEqual(actual, expected);
  } catch (e) {
    return false;
  }
}

function loginAllowed(req) {
  const key = anonHash(clientIp(req));
  const now = Date.now();
  const state = loginAttempts.get(key);
  if (!state || now - state.started > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { started: now, failures: 0 });
    return true;
  }
  return state.failures < 8;
}

function noteLoginFailure(req) {
  const key = anonHash(clientIp(req));
  const state = loginAttempts.get(key) || { started: Date.now(), failures: 0 };
  state.failures += 1;
  loginAttempts.set(key, state);
}

function adminSessionToken() {
  const payload = Buffer.from(JSON.stringify({
    iat: Date.now(),
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
    nonce: crypto.randomBytes(10).toString('hex'),
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function adminCookieSecurity(req) {
  const host = String(req.headers.host || '').split(':')[0];
  return host === 'localhost' || host === '127.0.0.1' ? '' : '; Secure';
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return ['', ''];
    try { return [part.slice(0, idx).trim(), decodeURIComponent(part.slice(idx + 1))]; }
    catch (_) { return ['', '']; }
  }).filter(([key]) => key));
}

function isAdmin(req) {
  if (!ADMIN_SESSION_SECRET) return false;
  const token = parseCookies(req)[ADMIN_COOKIE] || '';
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const expected = crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(payload).digest('base64url');
  if (!timingSafeTextEqual(signature, expected)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number(parsed.exp) > Date.now();
  } catch (e) {
    return false;
  }
}

function readAnalyticsEvents(fromTs) {
  if (!fs.existsSync(ANALYTICS_DIR)) return [];
  const events = [];
  for (const name of fs.readdirSync(ANALYTICS_DIR)) {
    if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) continue;
    const content = fs.readFileSync(path.join(ANALYTICS_DIR, name), 'utf8');
    for (const line of content.split('\n')) {
      if (!line) continue;
      try {
        const event = JSON.parse(line);
        if (Number(event.ts) >= fromTs) events.push(event);
      } catch (e) { /* skip a partial final line */ }
    }
  }
  return events.sort((a, b) => a.ts - b.ts);
}

function analyticsTrackingSince() {
  if (!fs.existsSync(ANALYTICS_DIR)) return null;
  const files = fs.readdirSync(ANALYTICS_DIR).filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort();
  for (const name of files) {
    const lines = fs.readFileSync(path.join(ANALYTICS_DIR, name), 'utf8').split('\n');
    for (const line of lines) {
      if (!line) continue;
      try { return Number(JSON.parse(line).ts) || null; } catch (e) { /* continue */ }
    }
  }
  return null;
}

const analyticsMatchdays = require('./analytics-matchdays').createMatchdayCalendar({
  fetchFixtures: async url => {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Fixture calendar HTTP ${response.status}`);
    return response.json();
  },
});

function buildAnalyticsReport(days, matchdayCalendar = null) {
  const exclusions = internalTraffic.getState();
  const cutoff = ensureAnalyticsCollectionStarted();
  const history = fs.existsSync(ANALYTICS_HISTORY_PATH)
    ? validateHistory(JSON.parse(fs.readFileSync(ANALYTICS_HISTORY_PATH, 'utf8')), cutoff) : null;
  return aggregateAnalyticsReport(readAnalyticsEvents(0), {
    days, now: Date.now(), trackingSince: analyticsTrackingSince(), matchdayCalendar,
    leagueTrackingSince: cutoff, history,
    excludedVisitorIds: exclusions.visitorIds, exclusionsSince: exclusions.since,
  });
}

// Offline maintenance only: reuse the live HMAC salt without exposing it in a
// command argument, log, public API or backfill artifact.
function buildHistoricalLeagueUsage(logs) {
  const { buildAccessLogBackfill } = require('./analytics-backfill');
  const cutoff = ensureAnalyticsCollectionStarted();
  const result = buildAccessLogBackfill(logs, { cutoff, defaultLeagueId: config.leagueId || 47275,
    hashVisitor: anonHash, excludedVisitorIds: internalTraffic.getState().visitorIds });
  for (const event of result.events) {
    const cachePath = Number(event.leagueId) === Number(config.leagueId || 47275)
      ? SNAPSHOT_PATH : path.join(LEAGUE_CACHE_DIR, `${event.leagueId}.json`);
    try {
      const snapshot = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (Number(snapshot.meta?.leagueId) === event.leagueId) event.leagueName = snapshot.meta.leagueName || '';
    } catch { /* A cached name is optional, never evidence of league usage. */ }
  }
  return validateHistory({ version: 1, cutoff, generatedAt: Date.now(), ...result }, cutoff);
}

/* ------------------------------------------------------------------ */
/* HTTP server                                                           */
/* ------------------------------------------------------------------ */

const matchWatchDue = new Map();
const matchCentreReads = new Map();
// Keep the tiny due ledger separate from the bounded three-GW payload cache.
// A subscribed current GW can become a third history topic at a GW rollover;
// payload eviction must not turn it into a new collection every scheduler tick.
const historyWatchDue = new Map();
function publishMatchCentre(feed, requested) {
  const key = `discover:${requested || 'default'}`;
  feed.meta.revision = updates.publish(key, feed);
  if (!requested) updates.publish(`discover:${feed.meta.gw}`, feed);
  else if (matchCentreService.getStatus().gw === Number(feed.meta.gw)) updates.publish('discover:default', feed);
  if (!feed.meta.stale && !feed.meta.refreshing) {
    const checked = Date.parse(feed.meta.checkedAt || feed.meta.updated);
    const due = Date.parse(feed.meta.nextRefreshAt);
    if (Number.isFinite(checked) && Number.isFinite(due)) {
      historyWatchDue.set(Number(feed.meta.gw), Math.min(due, checked + 15 * 60_000));
    }
  }
  return feed;
}
function collectMatchCentre(requested) {
  const key = String(requested || 'default');
  if (!matchCentreReads.has(key)) {
    const task = matchCentreService.get(requested).then(feed => {
      if (feed.meta.stale) {
        const bounded = matchCentreService.peek(requested);
        if (!bounded) throw new Error('当前比赛数据暂不可用，请稍后重试');
        feed = bounded; feed.meta.refreshing = false;
      }
      return publishMatchCentre(feed, requested);
    }).catch(error => {
      const status = matchCentreService.getStatus(requested);
      const retryAt = status.retryAt || new Date(Date.now() + 60_000).toISOString();
      updates.markStale(`discover:${requested || 'default'}`, { retryAt });
      if (!requested && status.gw) updates.markStale(`discover:${status.gw}`, { retryAt });
      const gw = Number(requested || status.gw);
      if (gw) historyWatchDue.set(gw, Date.parse(retryAt));
      throw error;
    })
      .finally(() => matchCentreReads.delete(key));
    matchCentreReads.set(key, task);
    task.catch(() => {}); // SWR callers can finish before the collection does.
  }
  return matchCentreReads.get(key);
}
async function getPublicMatchCentre(requested) {
  const status = matchCentreService.getStatus(requested);
  const cached = matchCentreService.peek(requested);
  if (cached && status.fresh) return publishMatchCentre(cached, requested);
  if (cached && status.retryAt && Date.parse(status.retryAt) > Date.now()) return publishMatchCentre(cached, requested);
  const task = collectMatchCentre(requested);
  if (!cached) return task;
  // peek only exposes same-season bounded, explicitly last-known data. The
  // read starts one shared background collection; it never renews source time.
  cached.meta.stale = true; cached.meta.refreshing = true;
  return publishMatchCentre(cached, requested);
}
function publishMatchDetail(key, detail) {
  const refreshSeconds = detail.live || detail.finalizing || detail.stale ? 60 : 3600;
  const nextRefreshAt = new Date(detail.stale ? Date.now() + 60_000
    : Math.max(Date.now() + 5000, Date.parse(detail.updated) + refreshSeconds * 1000)).toISOString();
  matchWatchDue.set(key, Date.parse(nextRefreshAt));
  // Keep this envelope ephemeral: authoritative Draft totals/lineups and their
  // source timestamp remain exactly as returned by match-detail.js.
  return updates.publish(key, { ...detail, sides: [...detail.sides].sort((a, b) => a.entryId - b.entryId), meta: { updated: detail.updated,
    stale: Boolean(detail.stale), refreshSeconds, nextRefreshAt } });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    const page = pageRoute(url);
    if (page.redirect) {
      res.writeHead(302, { Location: page.redirect, 'Cache-Control': 'no-store' });
      res.end(); return;
    }
    if (pathname.startsWith('/api/news/')) return await proxyNews(req, res, url);
    if (pathname === '/api/updates') {
      if (req.method !== 'GET') return jsonResponse(res, 405, { error: 'GET only' }, { Allow: 'GET' });
      if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && !sameOrigin(req))) {
        return jsonResponse(res, 403, { error: 'Invalid origin' });
      }
      let key;
      if (url.searchParams.get('channel') === 'match') {
        const ids = ['league', 'gw', 'entry1', 'entry2'].map(field => parseLeagueId(url.searchParams.get(field)));
        const [leagueId, gw, left, right] = ids;
        if (ids.some(id => !id) || gw > 38 || left === right) return jsonResponse(res, 400, { error: 'Invalid match' });
        const entries = [left, right].sort((a, b) => a - b);
        key = `match:${leagueId}:${gw}:${entries[0]}:${entries[1]}`;
        const watched = updates.activeKeys().filter(item => item.startsWith('match:'));
        if (!watched.includes(key) && watched.length >= 32) return jsonResponse(res, 503, { error: 'Match subscriptions busy' });
        if (!watched.includes(key) && !allowLeagueLookup(req)) return jsonResponse(res, 429, { error: 'Try again shortly' }, { 'Retry-After': '60' });
        try {
          // Never subscribe arbitrary manager pairs without the same actual-GW,
          // membership and opponent validation as the existing detail endpoint.
          const detail = await matchDetailService.get(leagueId, gw, ...entries);
          if (res.destroyed) return;
          publishMatchDetail(key, detail);
        } catch (error) {
          return jsonResponse(res, error.status || 502, { error: error.message || 'Match unavailable' });
        }
      } else if (url.searchParams.get('channel') === 'discover') {
        const gw = url.searchParams.get('gw');
        if (gw !== null && !/^(?:[1-9]|[12]\d|3[0-8])$/.test(gw)) return jsonResponse(res, 400, { error: 'Invalid GW' });
        key = `discover:${gw || 'default'}`;
        const currentGw = matchCentreService.getStatus().gw;
        const historical = updates.activeKeys().filter(k => /^discover:\d+$/.test(k) && Number(k.split(':')[1]) !== currentGw);
        if (gw && Number(gw) !== currentGw && !historical.includes(key) && historical.length >= 2) {
          return jsonResponse(res, 503, { error: 'History subscriptions busy; periodic refresh remains available' });
        }
      } else {
        const id = parseLeagueId(url.searchParams.get('league'));
        const snap = id && readWorkspaceCache(id);
        if (!snap || Number(snap.meta?.leagueId) !== id || snap.meta.snapshotSchema !== SNAPSHOT_SCHEMA) {
          return jsonResponse(res, 404, { error: 'Load league first' });
        }
        key = `league:${id}`;
        updates.publish(key, snap);
      }
      return updates.subscribe(req, res, key, anonHash(clientIp(req)));
    }
    if (pathname === '/api/analytics/event' && req.method === 'POST') {
      if (!sameOrigin(req)) return jsonResponse(res, 403, { ok: false });
      if (!allowAnalyticsEvent(req)) return jsonResponse(res, 429, { ok: false });
      const body = await readJsonBody(req);
      if (!recordAnalyticsEvent(req, body)) return jsonResponse(res, 400, { ok: false, error: '无效的统计事件或未验证的联赛' });
      res.writeHead(204, {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end();
      return;
    }
    if (pathname === '/admin/news') {
      if (req.method !== 'GET') return jsonResponse(res, 405, { ok: false });
      const authenticated = isAdmin(req);
      let sessionExp = 0;
      if (authenticated) {
        const payload = (parseCookies(req)[ADMIN_COOKIE] || '').split('.')[0];
        sessionExp = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).exp;
      }
      const result = adminNewsResponse(authenticated, sessionExp, process.env.TQL_ADMIN_SSO_SECRET || config.adminNewsSsoSecret);
      res.writeHead(result.status, result.headers);
      res.end(result.body);
      return;
    }
    if (pathname === '/api/admin/login' && req.method === 'POST') {
      if (!ADMIN_SESSION_SECRET || (!ADMIN_PASSWORD && !ADMIN_PASSWORD_HASH)) {
        return jsonResponse(res, 503, { ok: false, error: '后台登录尚未配置' });
      }
      if (!sameOrigin(req)) return jsonResponse(res, 403, { ok: false, error: '来源校验失败' });
      if (!loginAllowed(req)) return jsonResponse(res, 429, { ok: false, error: '尝试次数过多，请 15 分钟后再试' });
      const body = await readJsonBody(req, 4096);
      if (!verifyAdminPassword(body.password || '')) {
        noteLoginFailure(req);
        return jsonResponse(res, 401, { ok: false, error: '密码不正确' });
      }
      loginAttempts.delete(anonHash(clientIp(req)));
      return jsonResponse(res, 200, { ok: true }, {
        'Set-Cookie': [
          `${ADMIN_COOKIE}=${encodeURIComponent(adminSessionToken())}; Path=/; HttpOnly${adminCookieSecurity(req)}; SameSite=Strict; Max-Age=604800`,
          markInternalBrowser(req),
        ],
      });
    }
    if (pathname === '/api/admin/logout' && req.method === 'POST') {
      return jsonResponse(res, 200, { ok: true }, {
        'Set-Cookie': `${ADMIN_COOKIE}=; Path=/; HttpOnly${adminCookieSecurity(req)}; SameSite=Strict; Max-Age=0`,
      });
    }
    if (pathname === '/api/admin/session') {
      const authenticated = isAdmin(req);
      return jsonResponse(res, 200, { authenticated }, authenticated ? { 'Set-Cookie': markInternalBrowser(req) } : {});
    }
    if (pathname === '/api/admin/analytics') {
      if (!isAdmin(req)) return jsonResponse(res, 401, { ok: false, error: '请先登录' });
      const internalCookie = markInternalBrowser(req);
      const requestedDays = Number(url.searchParams.get('days'));
      const days = [7, 30, 90].includes(requestedDays) ? requestedDays : 30;
      return jsonResponse(res, 200, buildAnalyticsReport(days, await analyticsMatchdays.get()), { 'Set-Cookie': internalCookie });
    }
    const matchDetailRoute = pathname.match(/^\/api\/league\/([^/]+)\/match\/([^/]+)\/([^/]+)\/([^/]+)$/);
    if (matchDetailRoute) {
      if (req.method !== 'GET') return jsonResponse(res, 405, { ok: false, error: '仅支持 GET 查询' }, { Allow: 'GET' });
      if (!allowLeagueLookup(req)) return jsonResponse(res, 429, { ok: false, error: '查询过于频繁，请稍后再试' });
      const [leagueId, gw, entry1Id, entry2Id] = matchDetailRoute.slice(1).map(parseLeagueId);
      try {
        const detail = await matchDetailService.get(leagueId, gw, entry1Id, entry2Id);
        const entries = [entry1Id, entry2Id].sort((a, b) => a - b);
        const key = `match:${leagueId}:${gw}:${entries[0]}:${entries[1]}`;
        const revision = publishMatchDetail(key, detail);
        return jsonResponse(res, 200, { ...detail, meta: { revision, updated: detail.updated,
          stale: Boolean(detail.stale), refreshSeconds: detail.live || detail.finalizing || detail.stale ? 60 : 3600 } });
      } catch (error) {
        return jsonResponse(res, error.status || 502, {
          ok: false, code: error.code || 'MATCH_DATA_UNAVAILABLE',
          error: error.message || '暂时无法读取官方对阵明细，请稍后重试',
        });
      }
    }
    const leagueRoute = pathname.match(/^\/api\/league\/(\d+)$/);
    if (leagueRoute && req.method === 'GET') {
      if (!allowLeagueLookup(req)) {
        return jsonResponse(res, 429, { ok: false, error: '查询过于频繁，请稍后再试' });
      }
      const leagueId = parseLeagueId(leagueRoute[1]);
      if (!leagueId) return jsonResponse(res, 400, { ok: false, error: '请输入有效的 Draft 联赛 ID' });
      try {
        const snap = await getPublicLeagueSnapshot(leagueId);
        return await sendPublicJson(req, res, 200, snap);
      } catch (e) {
        const notFound = /HTTP 404/.test(e.message);
        return jsonResponse(res, notFound ? 404 : 502, {
          ok: false,
          error: notFound ? '没有找到这个 Draft 联赛，请检查 ID' : '暂时无法读取 FPL 数据，请稍后重试',
        });
      }
    }
    if (pathname === '/api/snapshot') {
      const snap = await (req.method === 'GET' ? getPublicLeagueSnapshot(config.leagueId) : getSnapshot());
      return await sendPublicJson(req, res, 200, snap);
    }
    if (pathname === '/api/refresh' && (req.method === 'POST' || req.method === 'GET')) {
      const requestedLeagueId = parseLeagueId(url.searchParams.get('league'));
      if (!allowLeagueLookup(req)) return jsonResponse(res, 429, { ok: false, error: '刷新过于频繁，请稍后再试' });
      const refreshTask = refreshWorkspaceNow(requestedLeagueId || Number(config.leagueId));
      refreshTask
        .then(({ snapshot: snap, warning }) => {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, updated: snap?.meta.updated || new Date().toISOString(), warning }));
        })
        .catch((e) => {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        });
      return;
    }
    if (pathname === '/api/match-centre') {
      if (req.method !== 'GET') {
        res.writeHead(405, { Allow: 'GET' }); res.end(); return;
      }
      try {
        const feed = await getPublicMatchCentre(url.searchParams.has('gw') ? url.searchParams.get('gw') : undefined);
        return await sendPublicJson(req, res, 200, feed);
      } catch (error) {
        const status = error.statusCode === 400 ? 400 : 503;
        return await sendPublicJson(req, res, status, { error: status === 400 ? 'GW 必须为 1–38 的整数' : '官方比赛数据暂时不可用，请稍后重试' });
      }
    }
    if (pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, ts: Date.now() }));
      return;
    }
    const kitRoute = pathname.match(/^\/api\/kit\/(\d{1,6})(-gk)?\.png$/);
    if (kitRoute && req.method === 'GET') {
      try {
        const image = await getKitImage(Number(kitRoute[1]), Boolean(kitRoute[2]));
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': image.length,
          'Cache-Control': 'public, max-age=86400',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(image);
      } catch (error) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Kit image unavailable');
      }
      return;
    }

    // static files
    let filePath = page.file || (pathname === '/'
      ? '/index.html'
      : (pathname === '/admin' || pathname === '/admin/') ? '/admin.html'
        : (pathname === '/discover' || pathname === '/discover/') ? '/discover.html'
          : pathname);
    filePath = path.normalize(path.join(PUBLIC_DIR, filePath));
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    let target = filePath;
    if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      // SPA fallback
      target = path.join(PUBLIC_DIR, 'index.html');
    }
    const ext = path.extname(target).toLowerCase();
    return await sendStaticFile(req, res, target, {
      contentType: MIME[ext] || 'application/octet-stream',
      version: url.searchParams.get('v'),
      headers: target.endsWith('admin.html') ? { 'X-Frame-Options': 'DENY' } : {},
    });
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Server error: ${err.message}`);
  }
});

/* ------------------------------------------------------------------ */
/* Scheduler: 60-second deadline/live checks, normal off-peak TTL.       */
/* ------------------------------------------------------------------ */

async function main() {
  const port = config.port || 3000;
  ensureAnalyticsCollectionStarted();
  try { pruneAnalyticsFiles(); } catch (e) { console.warn('[analytics] prune failed:', e.message); }
  server.listen(port, config.host || '0.0.0.0', () => {
    console.log(`[fpl-weekly] listening on ${config.host || '0.0.0.0'}:${port}`);
    console.log(`[fpl-weekly] league: ${config.leagueName} (id=${config.leagueId})`);
  });

  // Keep observing the active GW even with no open browser, so later clean-sheet
  // losses can be compared against a genuinely observed earlier state.
  let observing = false, finishedSignature = null, observingHistory = false, observedCheck = null;
  const observeMatches = async () => {
    if (observing) return;
    observing = true;
    try {
      const status = matchCentreService.getStatus();
      const due = Date.parse(status.nextRefreshAt) <= Date.now();
      const feed = due && !status.refreshing ? await collectMatchCentre()
        : status.checkedAt !== observedCheck ? matchCentreService.peek() : null;
      // Local wake-up checks must not repeatedly hash/clone every event solely
      // to decide that no collection is due. Publication occurs on collection.
      if (feed && !feed.meta.stale) {
        observedCheck = feed.meta.checkedAt || feed.meta.updated;
        const signature = `${feed.meta.gw}:` + feed.fixtures.filter(f => f.finished || f.finished_provisional).map(f => f.id).sort().join(',');
        const cached = readWorkspaceCache(Number(config.leagueId));
        if ((finishedSignature !== null && signature !== finishedSignature)
          || (finishedSignature === null && cached?.meta.reportLive && Number(cached.meta.reportGw) === Number(feed.meta.gw)
            && feed.fixtures.length && feed.fixtures.every(f => f.finished || f.finished_provisional))) {
          leagueInvalidatedAt = Date.now();
        }
        finishedSignature = signature;
      }
      // Historical corrections must never hold up the current match collector.
      if (!observingHistory) {
        observingHistory = true;
        (async () => {
          for (const key of updates.activeKeys().filter(k => /^discover:\d+$/.test(k))) {
            const gw = Number(key.split(':')[1]);
            const state = matchCentreService.getStatus(gw);
            if (gw === status.gw || state.refreshing || Date.now() < (historyWatchDue.get(gw) || 0)
              || Date.now() < Date.parse(state.nextRefreshAt)) continue;
            try { await collectMatchCentre(gw); }
            catch (error) { console.warn('[match-centre history]', error.message); }
          }
        })().finally(() => { observingHistory = false; });
      }
    } catch (error) { console.warn('[match-centre] refresh failed:', error.message); }
    finally { observing = false; }
  };
  observeMatches();
  // Cheap local cache checks; official live collection has a 10s TTL and a
  // single in-flight request. Idle TTL is three hours, bounded by next kickoff.
  setInterval(observeMatches, 2000);

  // Only open match dialogs get a separate, lightweight Draft detail collector.
  // Its source caches remain 60 seconds and shared across all spectators; a
  // notification does not request a full report rebuild or borrow Classic
  // totals. The existing five-minute membership guard may independently need
  // authoritative league metadata; that correctness check remains unchanged.
  let watchingMatches = false;
  setInterval(async () => {
    if (watchingMatches) return;
    watchingMatches = true;
    try {
      const active = updates.activeKeys().filter(key => key.startsWith('match:'));
      for (const key of matchWatchDue.keys()) if (!active.includes(key)) matchWatchDue.delete(key);
      const due = active.filter(key => Date.now() >= (matchWatchDue.get(key) || 0));
      for (let offset = 0; offset < due.length; offset += 2) {
        await Promise.all(due.slice(offset, offset + 2).map(async key => {
          if (!updates.activeKeys().includes(key)) return;
          const [leagueId, gw, left, right] = key.split(':').slice(1).map(Number);
          try { publishMatchDetail(key, await matchDetailService.get(leagueId, gw, left, right)); }
          catch (error) {
            const retryAt = new Date(Date.now() + 60_000).toISOString();
            matchWatchDue.set(key, Date.parse(retryAt));
            updates.markStale(key, { retryAt });
            console.warn('[match-watch]', error.message);
          }
        }));
      }
    } finally { watchingMatches = false; }
  }, 5000).unref();

  // initial build
  try {
    await refreshSnapshot();
  } catch (e) {
    console.error('[fpl-weekly] initial snapshot failed:', e.message);
  }

  let scheduling = false;
  const retryAfter = new Map();
  setInterval(async () => {
    if (scheduling) return;
    scheduling = true;
    try {
      const ids = [...new Set([Number(config.leagueId), ...updates.activeKeys()
        .filter(key => key.startsWith('league:')).map(key => Number(key.split(':')[1]))])];
      const due = ids.filter(id => Date.now() >= (retryAfter.get(id) || 0) && !isWorkspaceFresh(readWorkspaceCache(id)));
      // Bound report builds across leagues, not just within a single league.
      for (let i = 0; i < due.length; i += 2) {
        await Promise.all(due.slice(i, i + 2).map(async id => {
          try {
            const snap = await getWorkspaceSnapshot(id);
            if (snap.meta.stale) retryAfter.set(id, Date.now() + 60_000);
            else retryAfter.delete(id);
          } catch (e) { retryAfter.set(id, Date.now() + 60_000); console.warn('[scheduler]', e.message); }
        }));
      }
      for (const id of retryAfter.keys()) if (!ids.includes(id)) retryAfter.delete(id);
    } finally { scheduling = false; }
  }, 10_000);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('Fatal:', e);
    process.exit(1);
  });
}

module.exports = { buildSnapshot, buildDreamTeam, playerLite, server, matchDetailService, recordAnalyticsEvent, buildAnalyticsReport, buildHistoricalLeagueUsage };
