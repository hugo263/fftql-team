/* Shared anonymous analytics for the workbench and league discovery page. */
(function () {
  'use strict';
  if (!['/', '/index.html', '/draft', '/draft/', '/portal', '/portal/', '/portal.html', '/discover', '/discover/', '/discover.html'].includes(location.pathname)) return;
  if (window.__fplAnalyticsInitialized) return;
  window.__fplAnalyticsInitialized = true;

  const STORAGE_KEY = 'fpl_analytics_session_v1';
  const SESSION_MS = 30 * 60 * 1000;
  const isDiscover = /^\/discover(?:\/|\.html)?$/.test(location.pathname);
  const isPortal = !!document.querySelector('#newsTitle');
  const path = isDiscover ? '/discover' : '/';
  const validLeagueId = value => {
    const raw = String(value ?? '');
    return /^\d{1,10}$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
  };
  let activeLeagueId = validLeagueId(new URLSearchParams(location.search).get('league'));
  let reportedLeagueUse = false;
  const now = Date.now();
  let session;
  try { session = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
  catch (_) { session = null; }
  if (!session || typeof session.id !== 'string' || !/^[a-zA-Z0-9-]{8,64}$/.test(session.id)
    || !Number.isFinite(session.last) || now - session.last > SESSION_MS || session.last > now + 5000) {
    session = { id: globalThis.crypto?.randomUUID?.() || `${now}-${Math.random().toString(36).slice(2)}`, last: now };
  }

  const tabs = document.querySelector('#tabs');
  const currentTab = () => isPortal ? 'news' : isDiscover ? 'discover' : document.querySelector('#tabs .tab.active')?.dataset.tab || 'weekly';
  const referrerOrigin = () => {
    try {
      const referrer = new URL(document.referrer);
      return ['http:', 'https:'].includes(referrer.protocol) ? referrer.origin : '';
    } catch (_) { return ''; }
  };
  const send = (type, extra = {}, beacon = false) => {
    session.last = Date.now();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(session)); }
    catch (_) { /* Anonymous tracking still works when storage is unavailable. */ }
    const payload = JSON.stringify({
      type, sid: session.id, path, leagueId: activeLeagueId,
      tab: currentTab(), referrer: type === 'pageview' ? referrerOrigin() : '',
      screenWidth: window.innerWidth, ...extra,
    });
    if (beacon && navigator.sendBeacon) {
      try {
        if (navigator.sendBeacon('/api/analytics/event', new Blob([payload], { type: 'application/json' }))) return;
      } catch (_) { /* Use keepalive fetch when the beacon cannot be queued. */ }
    }
    try {
      fetch('/api/analytics/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
    } catch (_) { /* Analytics must never block the page. */ }
  };

  // URL attribution alone is not proof of a successful league lookup.
  // The workbench emits this only after it has rendered a valid snapshot.
  document.addEventListener('fpl:league-ready', event => {
    const leagueId = validLeagueId(event.detail?.leagueId);
    if (isDiscover || !leagueId) return;
    activeLeagueId = leagueId;
    if (reportedLeagueUse) return;
    reportedLeagueUse = true;
    send('league_use', { leagueId });
  });
  send('pageview');
  tabs?.addEventListener('click', event => {
    const tab = event.target?.closest?.('.tab');
    if (tab) send('tab_view', { tab: tab.dataset.tab });
  });

  let visibleSince = document.visibilityState === 'hidden' ? null : Date.now();
  const flushEngagement = (beacon = false) => {
    if (visibleSince == null) return;
    const current = Date.now();
    const duration = Math.floor((current - visibleSince) / 1000);
    visibleSince = current;
    if (duration >= 3) send('engagement', { duration }, beacon);
  };
  setInterval(() => {
    if (document.visibilityState === 'visible') flushEngagement();
  }, 30_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushEngagement(true);
      visibleSince = null;
    } else visibleSince = Date.now();
  });
  window.addEventListener('pagehide', () => {
    flushEngagement(true);
    visibleSince = null;
  });
  window.addEventListener('pageshow', () => {
    if (visibleSince == null && document.visibilityState !== 'hidden') visibleSince = Date.now();
  });
})();
