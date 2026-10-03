/* Shared presentation timeline. Independent of prediction and transaction scoring. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FPLTimeline = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function reportGw(meta) {
    return Number(meta.reportGw ?? (meta.gwInProgress ? meta.currentGw : meta.lastFinishedGw)) || 0;
  }
  function live(meta, gw = reportGw(meta)) {
    return Boolean(meta.reportLive ?? meta.gwInProgress) && Number(gw) === reportGw(meta);
  }
  function weeklyGw(meta, now = Date.now()) {
    const switchAt = Date.parse(meta.weeklySwitchAt);
    return Number(Number.isFinite(switchAt) && now >= switchAt && meta.nextWeeklyGw
      ? Math.max(meta.weeklyDefaultGw || 0, meta.nextWeeklyGw)
      : meta.weeklyDefaultGw) || reportGw(meta);
  }
  function phase(meta, gw) {
    gw = Number(gw);
    if (live(meta, gw)) return '本轮 · 进行中';
    if (gw <= Number(meta.lastFinishedGw || 0)) return meta.reportFinalizing && gw === reportGw(meta) ? '已完赛 · 待结算' : '已完赛';
    if (gw === Number(meta.currentGw) && meta.gwStarted) return '本轮';
    const next = Math.max(Number(meta.lastFinishedGw || 0) + 1, Number(meta.currentGw || 0) + (meta.gwStarted ? 1 : 0));
    return gw === next ? '下轮' : '待开赛';
  }
  function defaultTradeGw(meta, maxGw) {
    return Math.min(maxGw, live(meta) ? reportGw(meta) : Math.max(1, Number(meta.upcomingGw) || Number(meta.lastFinishedGw || 0) + 1));
  }
  function followReport(previous, next, selected) {
    return selected == null || selected === weeklyGw(previous || {}, Date.parse(previous?.updated) || Date.now()) ? weeklyGw(next) : selected;
  }
  function followTrade(previous, next, selected) {
    return selected == null || selected === defaultTradeGw(previous || {}, Infinity)
      ? defaultTradeGw(next, Infinity) : selected;
  }
  const validGw = (value) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 38;
  function latestTradeScoreGw(snapshot) {
    const value = snapshot.tradeReturns?.throughGw;
    return validGw(value) ? Number(value) : 0;
  }
  function tradeEvalRounds(snapshot) {
    const rounds = new Set();
    for (let gw = 1; gw <= latestTradeScoreGw(snapshot); gw++) rounds.add(gw);
    // New transactions can take effect before their GW has any match points.
    // Include actual activity, not empty future calendar/ledger placeholders.
    for (const transaction of snapshot.transactions?.all || []) {
      if (validGw(transaction.gw)) rounds.add(Number(transaction.gw));
    }
    for (const [gw, ledger] of Object.entries(snapshot.tradeReturns?.currentByGw || {})) {
      if (validGw(gw) && (ledger?.dealCount > 0 || ledger?.rows?.length > 0)) rounds.add(Number(gw));
    }
    return [...rounds].sort((a, b) => b - a);
  }
  function tradeEvalGw(snapshot, selected) {
    return validGw(selected) && tradeEvalRounds(snapshot).includes(Number(selected))
      ? Number(selected) : latestTradeScoreGw(snapshot);
  }
  function refreshMilliseconds(meta) {
    return Math.max(30, Number(meta?.refreshSeconds) || (live(meta || {}) ? 60 : 900)) * 1000;
  }
  return { reportGw, weeklyGw, live, phase, defaultTradeGw, followReport, followTrade, tradeEvalRounds, tradeEvalGw, refreshMilliseconds };
});
