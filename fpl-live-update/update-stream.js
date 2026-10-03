'use strict';

const { createHash } = require('node:crypto');
const WORKSPACE_INTERVAL = 15 * 60_000;
// Operational timestamps are not content changes. Event observedAt and actual
// deadlines deliberately remain in the fingerprint.
const VOLATILE = new Set(['updated', 'buildMs', 'reportSourceUpdated', 'reportSourceExpiresAt',
  'bootstrapUpdated', 'checkedAt', 'nextRefreshAt', 'retryAt', 'retryAfterSeconds', 'revision',
  'stale', 'refreshing', 'selectionPending', 'refreshError', 'warning']);
function contentRevision(value) {
  return createHash('sha256').update(JSON.stringify(value, (key, item) => VOLATILE.has(key) ? undefined : item)).digest('hex').slice(0, 24);
}
function workspaceFresh(snapshot, schema, now = Date.now(), invalidatedAt = 0) {
  const meta = snapshot?.meta;
  const built = Date.parse(meta?.updated);
  if (!meta || meta.snapshotSchema !== schema || meta.stale || !Number.isFinite(built)
    || built > now || built < invalidatedAt || now - built >= WORKSPACE_INTERVAL) return false;
  const boundaries = [
    meta.weeklySwitchAt,
    ...(snapshot.events || []).map(e => e.deadline || e.deadline_time),
    ...(snapshot.tradeWindows || []).flatMap(w => [w.opensAt, w.closesAt]),
  ].map(Date.parse);
  return !boundaries.some(t => t > built && t <= now);
}

// One notification channel per league/GW, never one upstream task per visitor.
// Only tiny revisions are pushed; clients read the already-built shared cache.
function createUpdateHub({ maxClients = 512, maxPerIp = 12, maxTopics = 160, now = Date.now,
  setIntervalFn = setInterval, clearIntervalFn = clearInterval } = {}) {
  const topics = new Map(), clients = new Set();
  function topic(key) {
    if (!topics.has(key)) {
      if (topics.size >= maxTopics) {
        const idle = [...topics].find(([, t]) => !t.clients.size);
        if (!idle) return null;
        topics.delete(idle[0]);
      }
      topics.set(key, { clients: new Set(), state: null });
    }
    return topics.get(key);
  }
  function write(client, event, state) {
    if (client.res.destroyed || client.res.writableEnded || client.res.writableLength > 64 * 1024) {
      client.res.destroy(); return false;
    }
    try { client.res.write(`event: ${event}\ndata: ${JSON.stringify(state)}\n\n`); return true; }
    catch { client.res.destroy(); return false; }
  }
  function publish(key, payload) {
    const t = topic(key);
    const state = { revision: contentRevision(payload), updated: payload.meta?.updated,
      checkedAt: payload.meta?.checkedAt || payload.meta?.updated,
      stale: Boolean(payload.meta?.stale), refreshing: Boolean(payload.meta?.refreshing),
      refreshSeconds: payload.meta?.refreshSeconds, nextRefreshAt: payload.meta?.nextRefreshAt,
      retryAt: payload.meta?.retryAt };
    if (!t) return state.revision;
    const changed = !t.state || t.state.revision !== state.revision || t.state.stale !== state.stale;
    const checked = t.state?.updated !== state.updated || t.state?.checkedAt !== state.checkedAt
      || t.state?.nextRefreshAt !== state.nextRefreshAt || t.state?.retryAt !== state.retryAt
      || t.state?.refreshing !== state.refreshing;
    t.state = state;
    if (changed || checked) for (const c of t.clients) write(c, changed ? 'update' : 'checked', state);
    return state.revision;
  }
  function markStale(key, { retryAt } = {}) {
    const t = topics.get(key);
    if (!t?.state) return false;
    // A collector failure says nothing new about scores. Keep the last content
    // revision and honest source clocks while making the failure observable.
    const next = { ...t.state, stale: true, refreshing: false,
      ...(retryAt ? { retryAt, nextRefreshAt: retryAt } : {}) };
    const changed = !t.state.stale;
    const checked = t.state.refreshing !== next.refreshing || t.state.retryAt !== next.retryAt;
    t.state = next;
    if (changed || checked) for (const client of t.clients) write(client, changed ? 'update' : 'checked', next);
    return true;
  }
  function subscribe(req, res, key, ip) {
    if (clients.size >= maxClients || [...clients].filter(c => c.ip === ip).length >= maxPerIp) {
      res.writeHead(429, { 'Retry-After': '60' }); res.end(); return;
    }
    const t = topic(key);
    if (!t) { res.writeHead(503); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff' });
    const c = { res, ip }; clients.add(c); t.clients.add(c);
    let heartbeat = null;
    const cleanup = () => { if (heartbeat !== null) clearIntervalFn(heartbeat); clients.delete(c); t.clients.delete(c); };
    // Register cleanup before the first frame: a failed/closed first write must
    // not leave a phantom watcher that keeps collecting upstream forever.
    res.on('close', cleanup);
    res.on('error', () => { cleanup(); res.destroy(); });
    res.socket?.setNoDelay?.(true);
    try { res.write('retry: 5000\n: connected\n\n'); }
    catch { cleanup(); res.destroy(); return; }
    if (res.destroyed) { cleanup(); return; }
    // Always send current revision on reconnect: no missed-update replay log.
    if (t.state && !write(c, 'update', t.state)) { cleanup(); return; }
    heartbeat = setIntervalFn(() => {
      if (res.destroyed || res.writableLength > 64 * 1024) return res.destroy();
      // Named frames are observable by EventSource. A silent/stalled proxy can
      // otherwise look healthy forever after the one-time `open` event.
      write(c, 'heartbeat', { serverTime: new Date(now()).toISOString() });
    }, 20_000);
    heartbeat.unref?.();
  }
  return { publish, markStale, subscribe, activeKeys: () => [...topics].filter(([, t]) => t.clients.size).map(([key]) => key) };
}
module.exports = { createUpdateHub, contentRevision, workspaceFresh, WORKSPACE_INTERVAL };
