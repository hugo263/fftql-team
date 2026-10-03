/* Official Draft free-agency windows, independent of the selected report GW. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FPLTradeCountdown = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function timestamp(value) {
    return typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
  }
  function windowsFromDraft(events) {
    return (Array.isArray(events?.data) ? events.data : []).filter(e => Number.isInteger(e.id) && e.id > 0).map(e => ({
      gw: e.id,
      opensAt: Number.isFinite(timestamp(e.waivers_time)) ? e.waivers_time : null,
      closesAt: Number.isFinite(timestamp(e.deadline_time)) ? e.deadline_time : null,
    }));
  }
  function nextWindow(windows, kind, now = Date.now()) {
    const field = kind === 'open' ? 'opensAt' : 'closesAt';
    const candidates = (Array.isArray(windows) ? windows : []).filter(w => Number.isInteger(w.gw) && w.gw > 0);
    const future = candidates.map(w => ({ gw: w.gw, at: w[field], time: timestamp(w[field]) }))
      .filter(w => w.time > now).sort((a, b) => a.time - b.time);
    if (future.length) return { ...future[0], state: 'countdown' };
    return { state: candidates.length && candidates.every(w => Number.isFinite(timestamp(w[field])) && timestamp(w[field]) <= now)
      ? 'complete' : 'unavailable' };
  }
  function parts(time, now = Date.now()) {
    const seconds = Math.max(0, Math.ceil((time - now) / 1000));
    return [Math.floor(seconds / 86400), Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60];
  }
  const dateFormat = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  function cardHtml(windows, kind, now = Date.now()) {
    const next = nextWindow(windows, kind, now);
    const open = kind === 'open';
    const title = open ? '自由市场开放' : '阵容截止';
    const subtitle = open ? '自由球员市场开放 · Waiver 处理后' : '本轮阵容锁定 · 请提前完成调整';
    const active = next.state === 'countdown';
    const values = active ? parts(next.time, now) : [];
    const remaining = active ? values.map((n, i) => `${n}${['天', '小时', '分', '秒'][i]}`).join(' ') : '';
    const field = open ? 'opensAt' : 'closesAt';
    const previous = (Array.isArray(windows) ? windows : []).map(w => timestamp(w[field]))
      .filter(time => Number.isFinite(time) && active && time < next.time).sort((a,b) => b-a)[0];
    const progress = active && Number.isFinite(previous) && now >= previous
      ? Math.min(100, Math.max(0, (now-previous)/(next.time-previous)*100)) : null;
    const icon = open ? '<path d="M5 8h14l-4-4m4 4-4 4M19 16H5l4 4m-4-4 4-4"/>'
      : '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16M9 4v4h6V4M9 20v-4h6v4"/><circle cx="12" cy="12" r="2.5"/>';
    return `<article class="trade-clock ${open ? 'trade-clock-open' : 'trade-clock-close'}">
      <svg class="trade-clock-watermark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width=".8" aria-hidden="true">${icon}</svg>
      <div class="trade-clock-content"><span class="trade-clock-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${icon}</svg></span><div class="trade-clock-copy">
      <div class="trade-clock-heading"><h3>${title}</h3><span class="trade-clock-gw">${active ? `GW${next.gw}` : '—'}</span><div class="trade-clock-date">${active ? `<time datetime="${new Date(next.time).toISOString()}">${dateFormat.format(next.time)}</time> <span>北京时间</span>` : '官方赛程更新后自动显示'}</div></div>
      ${active ? `<div class="trade-clock-digits" role="timer" aria-live="off" aria-label="${title}倒计时 ${remaining}">${values.map((n, i) => `<span><b>${String(n).padStart(2, '0')}</b><small>${['天', '时', '分', '秒'][i]}</small></span>`).join('<i class="trade-clock-separator" aria-hidden="true">:</i>')}</div>`
        : `<p class="trade-clock-empty">${next.state === 'complete' ? '本赛季已无后续时间' : '等待官方时间公布'}</p>`}
      ${progress == null ? '' : `<div class="trade-clock-progress" role="progressbar" aria-label="距下一${title}的周期进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"><span style="width:${progress.toFixed(2)}%"></span></div>`}
      <p class="trade-clock-note">${subtitle}</p>
      </div></div>
    </article>`;
  }
  return { windowsFromDraft, nextWindow, parts, cardHtml };
});
