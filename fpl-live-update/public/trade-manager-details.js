/* Historical manager return drill-down: only the ranking's effective-GW scores. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TQLTradeDetails = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const points = (value, signed = false) => Number.isFinite(value) ? `${signed && value > 0 ? '+' : ''}${value}` : '—';
  const tone = value => value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral';
  function model(snapshot, entryId, requestedGw) {
    const returns = snapshot?.tradeReturns;
    const throughGw = Math.min(Number(requestedGw), Number(returns?.throughGw));
    if (!Number.isSafeInteger(entryId) || entryId <= 0 || !Number.isInteger(throughGw) || throughGw < 0 || throughGw > 38) return null;
    const manager = returns?.managerRankingByGw?.[throughGw]?.rows?.find(row => Number(row.entryId) === entryId);
    if (!manager) return null;
    const available = Array.isArray(returns.transactionDetails);
    const seen = new Set();
    const details = (returns.transactionDetails || []).filter(deal => {
      if (Number(deal.entryId) !== entryId || !Number.isInteger(deal.gw) || deal.gw < 1 || deal.gw > throughGw) return false;
      const key = String(deal.transactionId);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    const rounds = [];
    for (let gw = throughGw; gw >= 1; gw--) {
      const ledger = returns.currentByGw?.[gw]?.rows?.find(row => Number(row.entryId) === entryId);
      const deals = details.filter(deal => deal.gw === gw).sort((a, b) =>
        (Date.parse(b.added) || 0) - (Date.parse(a.added) || 0)
        || String(b.transactionId).localeCompare(String(a.transactionId), 'en', {numeric:true}));
      if (ledger || deals.length) rounds.push({gw, ledger, deals});
    }
    return {manager, throughGw, available, rounds, updated: snapshot.meta?.updated || null};
  }
  function source(deal) {
    if (deal.kind === 't') return `Trade · 与 ${deal.counterparty || '对方经理待确认'} 交换`;
    if (deal.kind === 'w') return 'Waiver · 自由球员市场';
    if (deal.kind === 'f') return '自由签约 · 自由球员市场';
    return '交易方式待确认';
  }
  function players(list, incoming) {
    return (list || []).map(player => `<span class="tm-player"><span>${esc(player.name || `球员 #${player.id}`)}</span><strong>${points(player.gwPoints)} <small>分</small></strong></span>`).join('')
      || `<p class="tm-muted">${incoming ? '换入' : '换出'}球员记录待同步</p>`;
  }
  function body(view) {
    const summary = view.manager;
    const total = summary.complete ? `${points(summary.net, true)} 分` : `已知 ${points(summary.knownNet, true)} 分 · 总收益待补全`;
    const intro = `<div class="tm-summary"><span>截至 GW${view.throughGw} · ${Number(summary.dealCount) || 0} 笔操作</span><strong class="${tone(summary.net)}">${esc(total)}</strong></div>
      <p class="tm-explanation">只计生效当轮：换入分 − 换出分（含替补），不计后续轮次；同轮买入又转出的球员在轮次净收益中抵消。</p>`;
    if (!view.available) return intro + '<p class="tm-empty">逐笔交易得分正在等待数据同步，请稍后刷新再打开；不会使用球员总分代替。</p>';
    if (!view.rounds.length) return intro + '<p class="tm-empty">这个经理在所选范围内暂无已成交交易。</p>';
    return intro + '<div class="tm-columns" aria-hidden="true"><span>交易方式 / 来源</span><span>换入 · 当轮得分</span><span>换出 · 当轮得分</span><span>单笔得分差</span></div>' + view.rounds.map(round => `<section class="tm-round" aria-label="GW${round.gw} 交易">
      <div class="tm-round-heading"><h3>GW${round.gw}</h3><span>本轮净收益 <b class="${tone(round.ledger?.net)}">${points(round.ledger?.net, true)} 分</b></span></div>
      ${round.ledger && !round.ledger.complete ? '<p class="tm-muted">本轮记录或得分不完整，暂不计入正式排名。</p>' : ''}
      ${round.deals.length !== Number(round.ledger?.dealCount) ? '<p class="tm-muted">部分逐笔明细尚待同步，本轮净收益以已核算账本为准。</p>' : ''}
      ${round.deals.map(deal => `<article class="tm-deal">
        <div class="tm-source">${esc(source(deal))}</div>
        <section class="tm-in"><h4 class="tm-field-label">换入 · GW${round.gw} 得分</h4><div class="tm-players">${players(deal.playersIn, true)}</div></section>
        <section class="tm-out"><h4 class="tm-field-label">换出 · GW${round.gw} 得分</h4><div class="tm-players">${players(deal.playersOut, false)}</div></section>
        <div class="tm-net"><span class="tm-field-label">单笔得分差</span><b class="${tone(deal.net)}">${points(deal.net, true)} <small>分</small></b></div>
        ${!deal.complete ? '<p class="tm-muted">部分得分或记录暂缺，单笔得分差不补零。</p>' : ''}
      </article>`).join('')}
    </section>`).join('');
  }
  let dialog, returnFocus, previousOverflow;
  function open({snapshot, entryId, throughGw, trigger}) {
    const view = model(snapshot, entryId, throughGw);
    if (!view) return;
    if (!dialog) {
      dialog = document.createElement('dialog'); dialog.className = 'tm-dialog';
      dialog.setAttribute('aria-labelledby','tmDetailTitle');
      dialog.innerHTML = '<div class="tm-dialog-heading"><div><span>MANAGER TRANSFERS</span><h2 id="tmDetailTitle"></h2></div><button type="button" class="tm-close" aria-label="关闭交易明细">×</button></div><div class="tm-body"></div><p class="tm-footer"></p>';
      document.body.append(dialog);
      dialog.querySelector('.tm-close').addEventListener('click', () => dialog.close());
      dialog.addEventListener('click', event => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
      });
      dialog.addEventListener('close', () => {
        document.body.style.overflow = previousOverflow;
        const fallback = document.querySelector(`[data-trade-manager="${dialog.dataset.entryId}"]`) || document.getElementById('tcHistoryManagersTab');
        (returnFocus?.isConnected ? returnFocus : fallback)?.focus({preventScroll:true});
      });
    }
    returnFocus = trigger; dialog.dataset.entryId = String(entryId);
    dialog.querySelector('h2').textContent = `${view.manager.manager} · 交易明细`;
    dialog.querySelector('.tm-body').innerHTML = body(view);
    const timestamp = Date.parse(view.updated);
    dialog.querySelector('.tm-footer').textContent = `打开时的交易快照${Number.isFinite(timestamp) ? ' · 数据更新于 '+new Date(timestamp).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}) : ''}。实时得分可能随官方结算修正。`;
    if (!dialog.open) { previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; dialog.showModal(); }
    dialog.scrollTop = 0;
    dialog.querySelector('.tm-close').focus({preventScroll:true});
  }
  return {open, model, body, source};
});
