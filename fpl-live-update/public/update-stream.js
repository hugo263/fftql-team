/* One-way notifications. Transport health is not upstream data freshness. */
(() => {
  'use strict';
  const HEARTBEAT_LIMIT = 55_000;
  window.TQLUpdates = {
    connect({ url, onUpdate, onChecked = () => {}, onStatus = () => {}, initialRevision = null, initialStale = false }) {
      let stream = null, stopped = false, healthy = false, revision = initialRevision, stale = initialStale;
      let pending = null, delivering = false, retry = null, reconnect = null, watchdog = null;
      let lastFrame = 0, failures = 0, deliveryFailures = 0, status = '', suspended = false;
      const online = () => window.navigator?.onLine !== false;
      const visible = () => !stopped && !suspended && !document.hidden && online();
      const announce = value => {
        if (status === value || stopped) return;
        status = value;
        try { onStatus({ status: value }); } catch (_) { /* UI must not break recovery. */ }
      };
      function acknowledge(state) {
        if (!state || typeof state.revision !== 'string' || !state.revision) return;
        revision = state.revision; stale = Boolean(state.stale);
        if (pending?.revision === revision && Boolean(pending.stale) === stale && !pending.resume) pending = null;
      }
      function planDelivery(delay = 2000) {
        clearTimeout(retry);
        const retryAt = Date.parse(pending?.retryAt || '');
        const recoveryDelay = Math.min(30_000, delay * 2 ** Math.min(Math.max(0, deliveryFailures - 1), 4));
        const wait = Math.max(pending?.refreshing ? 7500 : recoveryDelay,
          Number.isFinite(retryAt) ? Math.min(300_000, retryAt - Date.now()) : 0);
        if (pending && visible()) retry = setTimeout(deliver, wait);
      }
      async function deliver() {
        if (delivering || !pending || !visible()) return;
        clearTimeout(retry); retry = null;
        delivering = true;
        const state = pending;
        try {
          const result = await onUpdate(state);
          if (result === false) throw Error('Refresh deferred');
          if (stopped) return;
          if (result && typeof result === 'object' && !state.resume && result.revision !== state.revision) {
            const returnedAt = Date.parse(result.checkedAt || result.updated || '');
            const notifiedAt = Date.parse(state.checkedAt || state.updated || '');
            // Do not lose a notification when the HTTP cache still trails it.
            if (!Number.isFinite(returnedAt) || !Number.isFinite(notifiedAt) || returnedAt <= notifiedAt) throw Error('Cache has not caught up');
          }
          // A cache read may be newer than the notification which initiated it.
          acknowledge(result && typeof result === 'object' ? result : state);
          deliveryFailures = 0;
          if (pending === state) pending = null;
        } catch (_) { deliveryFailures++; /* Never acknowledge failed or deferred reads. */ }
        finally { delivering = false; if (pending) planDelivery(deliveryFailures ? 2000 : 0); }
      }
      function markFrame() {
        lastFrame = Date.now(); healthy = true; failures = 0; announce('live');
      }
      function receive(event) {
        let state;
        try { state = JSON.parse(event.data); } catch (_) { return; }
        if (!state || typeof state.revision !== 'string' || !state.revision) return;
        markFrame(); state.stale = Boolean(state.stale);
        if (state.revision !== revision || state.stale !== stale || state.refreshing) {
          pending = state; deliver();
        } else {
          if (pending && !pending.resume) pending = null;
          try { onChecked(state); } catch (_) { /* Presentation only. */ }
        }
      }
      function drop() {
        stream?.close(); stream = null; healthy = false;
        clearTimeout(watchdog); watchdog = null;
      }
      function planReconnect() {
        clearTimeout(reconnect);
        if (!visible()) return;
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5));
        reconnect = setTimeout(open, delay + Math.floor(Math.random() * delay * .2));
      }
      function watch() {
        clearTimeout(watchdog);
        if (!stream || !visible()) return;
        watchdog = setTimeout(() => {
          // Mobile networks may silently stall an otherwise-open connection.
          if (Date.now() - lastFrame >= HEARTBEAT_LIMIT) {
            drop(); announce('reconnecting'); planReconnect();
          } else watch();
        }, 20_000);
      }
      function open() {
        clearTimeout(reconnect); reconnect = null;
        if (!visible() || stream) return;
        if (!window.EventSource) { announce('polling'); return; }
        announce(failures ? 'reconnecting' : 'connecting');
        let source;
        try { source = new window.EventSource(url); } catch (_) { announce('reconnecting'); planReconnect(); return; }
        stream = source; lastFrame = Date.now(); watch();
        source.onopen = () => { if (stream === source) { markFrame(); watch(); } };
        source.onerror = () => {
          if (stream !== source) return;
          // Own retries so hidden/offline tabs cannot leave a native loop alive.
          drop(); announce(online() ? 'reconnecting' : 'offline'); planReconnect();
        };
        for (const type of ['update', 'checked']) source.addEventListener(type, event => {
          if (stream === source) receive(event);
        });
        source.addEventListener('heartbeat', () => { if (stream === source) markFrame(); });
      }
      function catchUp() {
        if (!visible()) return;
        // Re-entering checks once even if the last revision is unchanged:
        // the cached data may now be stale or a GW may have rolled over.
        pending = pending || { revision, stale, resume: true };
        deliver();
      }
      function pause() {
        drop(); clearTimeout(retry); clearTimeout(reconnect);
        announce(online() ? 'paused' : 'offline');
      }
      function visibility() { if (!visible()) pause(); else { open(); catchUp(); } }
      const pagehide = () => { suspended = true; pause(); };
      const pageshow = event => { suspended = false; if (event.persisted) visibility(); };
      document.addEventListener('visibilitychange', visibility);
      window.addEventListener?.('online', visibility);
      window.addEventListener?.('offline', visibility);
      window.addEventListener?.('pagehide', pagehide);
      window.addEventListener?.('pageshow', pageshow);
      if (visible()) open(); else pause();
      return { healthy: () => healthy && visible() && Date.now() - lastFrame < HEARTBEAT_LIMIT,
        acknowledge, catchUp, close() {
        stopped = true; drop(); pending = null; clearTimeout(retry); clearTimeout(reconnect);
        document.removeEventListener('visibilitychange', visibility);
        window.removeEventListener?.('online', visibility);
        window.removeEventListener?.('offline', visibility);
        window.removeEventListener?.('pagehide', pagehide);
        window.removeEventListener?.('pageshow', pageshow);
      } };
    },
  };
})();
