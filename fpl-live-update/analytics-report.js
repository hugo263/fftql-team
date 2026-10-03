'use strict';

// Pure reporting over the retained event log. No filesystem, account or network
// access belongs here; the caller supplies the complete retained history.
const DAY_MS = 86_400_000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const TYPES = new Set(['pageview', 'tab_view', 'engagement', 'league_use']);
const { validateHistory } = require('./analytics-history');
const { classifyDay } = require('./analytics-matchdays');
const TAB_LABELS = {
  news: 'FPL 资讯',
  home: '首页',
  weekly: '本轮战报', trades: '交易中心', standings: '积分榜', fixtures: '联赛赛程', freeagents: '自由球员',
  share: '阵容分享', compare: '阵容对比', predict: '下轮预测', trade: '交易评估', discover: '联赛入口',
};

function timestamp(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8.64e15) return null;
  return value;
}
function identity(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function dateKey(ts) {
  return new Date(ts + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}
function dayStart(ts) {
  return Math.floor((ts + SHANGHAI_OFFSET_MS) / DAY_MS) * DAY_MS - SHANGHAI_OFFSET_MS;
}
function leagueId(value) {
  // Accept canonical integer strings from older JSON writers, but never coerce
  // booleans, empty strings, floats, signed or exponential strings into IDs.
  if (typeof value === 'string' && !/^[1-9]\d*$/.test(value)) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
function sessionKey(event) {
  const vid = identity(event.vid);
  const sid = identity(event.sid);
  return vid && sid ? JSON.stringify([vid, sid]) : null;
}
function distinctVisitors(events) {
  return new Set(events.map(event => identity(event.vid)).filter(Boolean)).size;
}
function countBy(events, getLabel) {
  const counts = new Map();
  for (const event of events) {
    const label = identity(getLabel(event)) || '其他';
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts].map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'zh-CN'));
}
function moduleLabel(event) {
  return TAB_LABELS[event.tab] || identity(event.tab) || '本轮战报';
}
function summary(events) {
  const views = events.filter(event => event.type === 'pageview');
  const sessions = new Map();
  // A heartbeat without a pageview does not create a visitor or session.
  for (const event of views) {
    const key = sessionKey(event);
    if (!key) continue;
    if (!sessions.has(key)) sessions.set(key, { pageviews: 0, duration: 0 });
    sessions.get(key).pageviews++;
  }
  for (const event of events) {
    if (event.type !== 'engagement') continue;
    const session = sessions.get(sessionKey(event));
    if (!session || typeof event.duration !== 'number' || !Number.isFinite(event.duration) || event.duration < 0) continue;
    // Ingestion enforces this same per-event bound; retain the guard when
    // reporting a damaged/legacy event instead of letting it dominate a mean.
    session.duration += Math.min(event.duration, 1800);
  }
  const rows = [...sessions.values()];
  const totalDuration = rows.reduce((sum, row) => sum + row.duration, 0);
  const bounced = rows.filter(row => row.pageviews <= 1 && row.duration < 10).length;
  return {
    pageviews: views.length,
    visitors: distinctVisitors(views),
    sessions: rows.length,
    avgDuration: rows.length ? Math.round(totalDuration / rows.length) : 0,
    bounceRate: rows.length ? Math.round(bounced / rows.length * 1000) / 10 : 0,
  };
}
function sinceOrFirst(value, events, now) {
  const parsed = timestamp(value);
  return parsed != null && parsed <= now ? parsed : events.length ? events[0].ts : null;
}

function buildAnalyticsReport(events, options = {}) {
  const rawNow = options.now === undefined ? Date.now() : options.now;
  const now = timestamp(rawNow);
  if (now == null) throw new TypeError('Analytics now must be a finite timestamp in milliseconds');
  const requestedDays = options.days === undefined ? 30 : options.days;
  if (!Number.isInteger(requestedDays) || requestedDays < 1 || requestedDays > 400) {
    throw new TypeError('Analytics days must be an integer from 1 to 400');
  }
  const days = requestedDays;
  const todayStart = dayStart(now);
  const start = todayStart - (days - 1) * DAY_MS;
  const previousStart = start - days * DAY_MS;
  const history = options.history ? validateHistory(options.history, options.leagueTrackingSince) : null;
  const excludedIds = new Set([...(Array.isArray(options.excludedVisitorIds) ? options.excludedVisitorIds : []),
    ...(history?.internalVisitorIds || [])]
    .map(identity).filter(Boolean));
  const all = (Array.isArray(events) ? events : []).filter(event => event && typeof event === 'object'
    && timestamp(event.ts) != null && event.ts <= now && TYPES.has(event.type))
    .sort((a, b) => a.ts - b.ts);
  const isInternal = event => event.internal === true || excludedIds.has(identity(event.vid));
  const human = all.filter(event => !event.bot && !isInternal(event));
  const current = human.filter(event => event.ts >= start);
  const previous = human.filter(event => event.ts >= previousStart && event.ts < start);
  const today = human.filter(event => event.ts >= todayStart);
  const currentViews = current.filter(event => event.type === 'pageview');
  const moduleEvents = current.filter(event => event.type === 'pageview' || event.type === 'tab_view');

  const daily = new Map();
  for (let index = 0; index < days; index++) daily.set(dateKey(start + index * DAY_MS), []);
  for (const event of currentViews) daily.get(dateKey(event.ts)).push(event);
  const trend = [...daily].map(([date, views]) => ({
    date, pageviews: views.length, visitors: distinctVisitors(views),
    sessions: new Set(views.map(sessionKey).filter(Boolean)).size,
  }));
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, value: 0, matchday: 0, nonMatchday: 0, unknown: 0 }));
  currentViews.forEach(event => {
    const row = hourly[new Date(event.ts + SHANGHAI_OFFSET_MS).getUTCHours()];
    row.value++;
    row[classifyDay(dateKey(event.ts), options.matchdayCalendar)]++;
  });
  const dayCounts = { matchday: 0, nonMatchday: 0, unknown: 0 };
  for (const date of daily.keys()) dayCounts[classifyDay(date, options.matchdayCalendar)]++;

  const historicalEvents = (history?.events || []).filter(event => event.ts <= now && !isInternal(event));
  const validLeagueEvents = [...human.filter(event => event.type === 'league_use' && leagueId(event.leagueId) != null),
    ...historicalEvents].sort((a, b) => a.ts - b.ts);
  const leagueRows = new Map();
  for (const event of validLeagueEvents) {
    const id = leagueId(event.leagueId);
    const name = identity(event.leagueName) || identity(event.name);
    if (!leagueRows.has(id)) leagueRows.set(id, { leagueId: id, name: name || `联赛 #${id}`,
      opens: 0, historicalOpens: 0, visitors: new Set(), firstSeen: event.ts, lastSeen: event.ts });
    const row = leagueRows.get(id);
    row.opens++;
    if (event.source === 'access-log-backfill') row.historicalOpens++;
    const vid = identity(event.vid);
    if (vid) row.visitors.add(vid);
    if (name) row.name = name;
    row.lastSeen = event.ts;
  }
  const currentInternal = all.filter(event => event.ts >= start && isInternal(event));
  const todaySummary = summary(today);
  const rawLeagueEvents = all.filter(event => event.type === 'league_use' && leagueId(event.leagueId) != null);
  return {
    ok: true,
    generatedAt: now,
    days,
    range: { start, end: now, timezone: 'Asia/Shanghai', startInclusive: true, endInclusive: true,
      previousStart, previousEnd: start, previousEndInclusive: false },
    trackingSince: sinceOrFirst(options.trackingSince, all, now),
    summary: { ...summary(current),
      activeVisitors: distinctVisitors(human.filter(event => event.ts >= now - 30 * 60 * 1000)) },
    previous: summary(previous),
    today: { date: dateKey(now), start: todayStart, end: now,
      pageviews: todaySummary.pageviews, visitors: todaySummary.visitors, sessions: todaySummary.sessions },
    trend,
    modules: countBy(moduleEvents, moduleLabel),
    sources: countBy(currentViews, event => identity(event.referrer) || '直接访问'),
    devices: countBy(currentViews, event => event.device),
    browsers: countBy(currentViews, event => event.browser),
    systems: countBy(currentViews, event => event.os),
    hourly,
    matchdayCalendar: { available: Boolean(options.matchdayCalendar), stale: Boolean(options.matchdayCalendar?.stale),
      source: options.matchdayCalendar?.source || null, fetchedAt: options.matchdayCalendar?.fetchedAt || null,
      definition: '英超官方赛程的北京时间开球日期；当天所有小时均归为比赛日', dayCounts },
    recent: [...moduleEvents].reverse().slice(0, 30).map(event => ({
      ts: event.ts, type: event.type, module: moduleLabel(event),
      source: identity(event.referrer) || '直接访问', device: identity(event.device) || '其他',
      browser: identity(event.browser) || '其他', visitor: identity(event.vid)?.slice(0, 8) || '未知访客',
    })),
    filteredBots: all.filter(event => event.ts >= start && event.bot).length,
    leagueUsage: {
      total: leagueRows.size,
      period: new Set(validLeagueEvents.filter(event => event.ts >= start).map(event => leagueId(event.leagueId))).size,
      today: new Set(validLeagueEvents.filter(event => event.ts >= todayStart).map(event => leagueId(event.leagueId))).size,
      trackingSince: historicalEvents.length ? Math.min(historicalEvents[0].ts,
        sinceOrFirst(options.leagueTrackingSince, rawLeagueEvents, now) ?? historicalEvents[0].ts)
        : sinceOrFirst(options.leagueTrackingSince, rawLeagueEvents, now),
      collectorSince: sinceOrFirst(options.leagueTrackingSince, rawLeagueEvents, now),
      opens: validLeagueEvents.length,
      historical: { imported: Boolean(history), opens: historicalEvents.length,
        leagues: new Set(historicalEvents.map(event => event.leagueId)).size,
        since: historicalEvents[0]?.ts ?? null, until: historicalEvents.at(-1)?.ts ?? null,
        method: history ? 'document-and-successful-data-request' : null },
      // This is missing attribution, not a guess at how many leagues existed.
      legacyPageviews: human.filter(event => event.type === 'pageview' && event.v !== 2 && event.leagueId == null).length,
      rows: [...leagueRows.values()].map(row => ({ ...row, visitors: row.visitors.size }))
        .sort((a, b) => b.opens - a.opens || a.leagueId - b.leagueId).slice(0, 100),
    },
    exclusions: {
      since: sinceOrFirst(options.exclusionsSince, [], now),
      internalEvents: currentInternal.length,
      internalPageviews: currentInternal.filter(event => event.type === 'pageview').length,
      knownVisitors: excludedIds.size,
      affectedVisitors: distinctVisitors(currentInternal),
    },
  };
}

module.exports = { buildAnalyticsReport };
