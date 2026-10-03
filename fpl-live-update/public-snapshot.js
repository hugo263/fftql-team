'use strict';

const { isSnapshotFresh } = require('./live-scoring');

const PUBLIC_STALE_LIMIT_MS = 5 * 60_000;
const PUBLIC_LIVE_DISPLAY_LIMIT_MS = 30 * 60_000;
const PUBLIC_IDLE_DISPLAY_LIMIT_MS = 6 * 60 * 60_000;
const RETRY_BACKOFF_MS = 20_000;

// The fifteen-minute workspace collection cadence is intentionally independent
// of scoring freshness. Its display window must extend beyond that cadence or
// stale-while-revalidate can never help a normally expired workspace cache.
// The longer idle window is ONLY a visibly old first paint, never a fresh TTL.
const WORKSPACE_DISPLAY_POLICY = Object.freeze({
  maxAgeMs: snapshot => snapshot.meta.reportLive || snapshot.meta.reportFinalizing
    ? PUBLIC_LIVE_DISPLAY_LIMIT_MS : PUBLIC_IDLE_DISPLAY_LIMIT_MS,
  strict: true,
});

function timestamp(value, strict) {
  return typeof value === 'string' && (!strict || /(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    ? Date.parse(value) : NaN;
}

// This is a display-only shortcut, never a scoring or match-validation cache.
// Keep the original five-minute policy for callers that do not opt in. The
// workspace route passes WORKSPACE_DISPLAY_POLICY explicitly; force refresh,
// locked lineup scoring and authorization must not use this predicate as fresh.
function canServeWhileRefreshing(snapshot, leagueId, schema, now = Date.now(), policy = {}) {
  const meta = snapshot?.meta;
  const strict = policy.strict === true;
  if (!meta || meta.snapshotSchema !== schema || Number(meta.leagueId) !== leagueId
    || !Number.isSafeInteger(leagueId) || leagueId <= 0 || !Number.isFinite(now)
    || (!policy.allowMarkedStale && (meta.stale || meta.refreshing)) || !Array.isArray(snapshot.managers)
    || !Array.isArray(snapshot.players)) return false;
  const maxAgeMs = typeof policy.maxAgeMs === 'function' ? policy.maxAgeMs(snapshot)
    : policy.maxAgeMs ?? PUBLIC_STALE_LIMIT_MS;
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return false;
  const updated = timestamp(meta.updated, strict);
  if (!Number.isFinite(updated) || updated > now || now - updated >= maxAgeMs) return false;
  let sourceUpdated = null;
  if (meta.reportSourceUpdated != null) {
    sourceUpdated = timestamp(meta.reportSourceUpdated, strict);
    const mutableScore = !strict || meta.reportLive || meta.reportFinalizing;
    // Settled scores can legitimately keep their original frozen source time.
    // A later report build never renews the freshness of live/finalizing scores.
    if (!Number.isFinite(sourceUpdated) || sourceUpdated > updated
      || (mutableScore && now - sourceUpdated >= maxAgeMs)) return false;
  } else if (strict && (meta.reportLive || meta.reportFinalizing)) {
    return false;
  }
  const season = /^(\d{4})\/(\d{2})$/.exec(meta.season || '');
  if (!season || Number(season[2]) !== (Number(season[1]) + 1) % 100) return false;
  const start = Date.UTC(Number(season[1]), 6, 1);
  const end = Date.UTC(Number(season[1]) + 1, 6, 1);
  if (now < start || now >= end) return false;
  if (strict && (updated < start || (sourceUpdated != null && sourceUpdated < start))) return false;
  if (strict && meta.reportSourceExpiresAt != null) {
    const expires = timestamp(meta.reportSourceExpiresAt, true);
    if (!Number.isFinite(expires) || sourceUpdated == null || expires < sourceUpdated || expires >= end) return false;
  }
  const events = snapshot.events;
  if (!Array.isArray(events) || !events.length || !events.some(event => event?.id === 1)) return false;
  const ids = new Set();
  const deadlines = new Map();
  for (const event of events) {
    if (!event || typeof event !== 'object') return false;
    const deadline = timestamp(event.deadline || event.deadline_time, strict);
    if (!Number.isInteger(event.id) || event.id < 1 || event.id > 38 || ids.has(event.id)
      || !Number.isFinite(deadline) || deadline < start || deadline >= end
      || (deadline > updated && deadline <= now)) return false;
    ids.add(event.id);
    deadlines.set(event.id, deadline);
  }
  if (strict) {
    // Missing future GW records could otherwise hide a crossed deadline.
    if (ids.size !== 38 || typeof meta.reportLive !== 'boolean'
      || typeof meta.reportFinalizing !== 'boolean') return false;
    let reportGw = 0, previous = -Infinity;
    for (let gw = 1; gw <= 38; gw++) {
      const deadline = deadlines.get(gw);
      if (deadline <= previous) return false;
      previous = deadline;
      if (deadline <= now) reportGw = gw;
    }
    if (meta.reportGw !== reportGw || meta.currentGw !== Math.max(1, reportGw)) return false;
    if (reportGw > 0 && sourceUpdated != null && sourceUpdated < deadlines.get(reportGw)) return false;
    if (meta.reportLive && meta.reportFinalizing) return false;
    if ((meta.reportLive || meta.reportFinalizing) && reportGw === 0) return false;
    if (!Array.isArray(snapshot.tradeWindows)) return false;
    const windows = new Set();
    for (const window of snapshot.tradeWindows) {
      if (!window || typeof window !== 'object') return false;
      if (!Number.isInteger(window.gw) || !ids.has(window.gw) || windows.has(window.gw)) return false;
      windows.add(window.gw);
      if (window.opensAt != null && window.closesAt != null
        && timestamp(window.opensAt, true) >= timestamp(window.closesAt, true)) return false;
      for (const field of ['opensAt', 'closesAt']) {
        // Official unavailable times remain unavailable, not invented dates.
        if (window[field] == null) continue;
        const boundary = timestamp(window[field], true);
        if (!Number.isFinite(boundary) || boundary < start || boundary >= end
          || (boundary > updated && boundary <= now)) return false;
      }
    }
  }
  return true;
}

function createPublicSnapshotReader({ schema, normalTtlMs, readCached, rememberCached,
  loadSnapshot, now = Date.now, onError = () => {}, isFresh = isSnapshotFresh,
  displayPolicy = {} }) {
  const pending = new Map();
  const failures = new Map();
  const staleCopy = (snapshot, refreshing) => ({ ...snapshot, meta: {
    ...snapshot.meta,
    stale: true,
    refreshing,
    refreshError: refreshing ? '正在同步最新数据，暂时显示上次成功更新的数据'
      : '官方数据暂时不可用，显示上次成功更新的数据',
  } });
  function recordFailure(leagueId) {
    failures.delete(leagueId);
    failures.set(leagueId, now());
    while (failures.size > 200) failures.delete(failures.keys().next().value);
  }

  function startLoad(leagueId) {
    if (pending.has(leagueId)) return pending.get(leagueId);
    const task = Promise.resolve().then(() => loadSnapshot(leagueId)).then((snapshot) => {
      // A lower-level error fallback must not smuggle an old season or previous
      // GW into the public response after the cache guard correctly rejected it.
      if (displayPolicy.strict) {
        const meta = snapshot?.meta;
        if (!meta || Number(meta.leagueId) !== leagueId || meta.snapshotSchema !== schema
          || !Array.isArray(snapshot.players) || !Array.isArray(snapshot.managers)) {
          throw new Error('联赛数据暂不可用，请稍后重试');
        }
        // Fresh builds remain authoritative: e.g. an incomplete future calendar
        // can prevent SWR, but must not turn a legitimate new build into an error.
        if ((meta.stale || meta.refreshing) && !canServeWhileRefreshing(snapshot, leagueId, schema, now(),
          { ...displayPolicy, allowMarkedStale: true })) {
          throw new Error('当前轮次数据暂不可用，请稍后重试');
        }
      }
      if (snapshot?.meta?.stale) {
        recordFailure(leagueId);
        return staleCopy(snapshot, false);
      }
      failures.delete(leagueId);
      return snapshot;
    }).catch((error) => {
      recordFailure(leagueId);
      onError(error, leagueId);
      throw error;
    }).finally(() => pending.delete(leagueId));
    pending.set(leagueId, task);
    // Background callers return immediately, so observe errors even when no
    // HTTP caller is awaiting this task. Awaiting cold callers still reject.
    task.catch(() => {});
    return task;
  }

  return async function getPublicSnapshot(leagueId) {
    const checkedAt = now();
    const cached = readCached(leagueId);
    // Cold/invalid/old/next-GW requests still wait for the authoritative path.
    if (!canServeWhileRefreshing(cached, leagueId, schema, checkedAt, displayPolicy)
      || isFresh(cached, normalTtlMs, checkedAt)) return startLoad(leagueId);
    rememberCached?.(leagueId, cached);
    const failedAt = failures.get(leagueId);
    if (failedAt != null && checkedAt - failedAt < RETRY_BACKOFF_MS) return staleCopy(cached, false);
    startLoad(leagueId);
    // No fields or timestamps are written back to memory/disk by this wrapper.
    return staleCopy(cached, true);
  };
}

module.exports = { PUBLIC_STALE_LIMIT_MS, PUBLIC_LIVE_DISPLAY_LIMIT_MS, PUBLIC_IDLE_DISPLAY_LIMIT_MS,
  WORKSPACE_DISPLAY_POLICY, RETRY_BACKOFF_MS, canServeWhileRefreshing, createPublicSnapshotReader };
