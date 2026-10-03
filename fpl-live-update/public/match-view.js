/* Match report detail: isolated from current-ownership comparison and sharing. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FPLMatchView = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const number = value => typeof value === 'number' && Number.isFinite(value) ? String(value) : '—';
  const positionOrder = ['GKP', 'DEF', 'MID', 'FWD'];
  const states = { played: '已出战', playing: '球队比赛中', pending: '未开赛', waiting: '未登场', dnp: '未出场', blank: '无赛程', unknown: '待更新' };
  function playerState(player) {
    const state = Object.hasOwn(states, player.status) ? player.status : 'unknown';
    const minutes = typeof player.minutes === 'number' && Number.isFinite(player.minutes) ? `${player.minutes}′` : '分钟未知';
    const hasPlayed = typeof player.minutes === 'number' && player.minutes > 0;
    const hasScore = state !== 'unknown' && Number.isFinite(player.points)
      && (hasPlayed || player.yellowCards > 0 || player.redCards > 0 || player.points < 0);
    const finished = hasPlayed && player.fixtures?.length && player.fixtures.every(f => f.finished);
    const label = state === 'playing' ? '赛中' : finished ? '已完赛' : states[state];
    return { state, label, minutes, hasPlayed, hasScore, score: hasScore ? number(player.points) : '—' };
  }
  function kit(player) {
    const code = Number(player.teamCode);
    return Number.isSafeInteger(code) && code > 0 ? `/api/kit/${code}${player.pos === 'GKP' ? '-gk' : ''}.png` : '';
  }
  function fixtureLabel(player) {
    return (player.fixtures || []).map(f => `${f.opponent || '对手待定'}${typeof f.home === 'boolean' ? ` (${f.home ? 'H' : 'A'})` : ''} · ${f.finished ? '完赛' : f.started ? '比赛中' : '未开赛'}`).join(' / ');
  }
  function substitutionFor(side, player) {
    const substitutions = Array.isArray(side.substitutions) ? side.substitutions : [];
    const involved = substitutions.filter(sub => ['official', 'projected'].includes(sub.source)
      && [Number(sub.element_in), Number(sub.element_out)].includes(Number(player.id)));
    const substitution = involved.find(sub => sub.source === 'official') || involved[0];
    if (!substitution) return null;
    const incoming = Number(substitution.element_in) === Number(player.id);
    const projected = substitution.source === 'projected';
    const counterpartId = Number(incoming ? substitution.element_out : substitution.element_in);
    const counterpart = side.players.find(candidate => Number(candidate.id) === counterpartId);
    const pending = projected && substitution.pending === true;
    return {
      source: substitution.source, incoming, pending,
      badge: `${projected ? '预' : '替'}${incoming ? '↑' : '↓'}`,
      description: `${projected ? '按规则预判自动替补' : '官方自动替补'}：${incoming ? '换上，替换' : '换下，由'} ${counterpart?.name || `#${counterpartId}`}${incoming ? '' : ' 替换'}${pending ? '；替补待上场，未获得的分数不预先计入' : ''}${projected ? '；最终以官方结算为准' : ''}`,
    };
  }
  function substitutionNote(side) {
    const substitutions = Array.isArray(side.substitutions) ? side.substitutions : [];
    const official = substitutions.filter(sub => sub.source === 'official').length;
    const projected = substitutions.filter(sub => sub.source === 'projected').length;
    const pending = substitutions.filter(sub => sub.source === 'projected' && sub.pending === true).length;
    if (!official && !projected && !side.provisional) return '';
    return [official ? `官方自动替补 ${official} 组` : '',
      projected ? `规则预判 ${projected} 组${pending ? ` · ${pending} 人待上场` : ''}` : side.provisional ? '含自动替补预判' : ''].filter(Boolean).join(' · ');
  }
  function playerHtml(player, substitution = null) {
    const state = playerState(player);
    const src = kit(player);
    const fixture = fixtureLabel(player);
    const pendingSubstitute = substitution?.incoming && substitution.pending && !state.hasPlayed;
    const title = `${player.name} · ${player.teamName || player.team} · ${state.score}${state.hasScore ? ' 分' : '（尚无得分）'} · ${state.minutes} · ${state.label}${fixture ? ` · ${fixture}` : ''}${player.teamMetadataNote ? ` · ${player.teamMetadataNote}` : ''}${substitution ? ` · ${substitution.description}` : ''}`;
    return `<div class="md-player md-state-${state.state} ${state.hasPlayed ? 'md-played' : ''}" title="${escape(title)}" aria-label="${escape(title)}">
      <div class="md-kit ${src ? '' : 'md-kit-error'}">
        ${src ? `<img src="${src}" alt="${escape(player.teamName || player.team)}${player.pos === 'GKP' ? '门将' : '主场'}球衣" decoding="async">` : ''}
        <span class="md-kit-fallback" aria-hidden="true">${escape(player.team || '?')}</span>
        ${substitution ? `<span class="md-sub-badge md-sub-${substitution.source}${substitution.incoming ? ' md-sub-in' : ' md-sub-out'}" aria-label="${escape(substitution.description)}">${substitution.badge}</span>` : ''}
      </div>
      <div class="md-player-plate"><span class="md-player-name">${escape(player.name)}</span><span class="md-player-score"><b>${state.score}</b>${state.hasScore ? '<span>分</span>' : ''}<small>${state.hasPlayed ? state.minutes : state.label}</small></span></div>
      <span class="md-player-status">${pendingSubstitute ? '预判 · 待上场' : state.hasPlayed ? state.label : state.minutes === '分钟未知' ? '分钟待更新' : `${state.minutes} · ${escape(player.team)}`}</span>
    </div>`;
  }
  function sideHtml(side, field) {
    const ordered = [...side.players].sort((a, b) => a.position - b.position);
    const starters = ordered.filter(p => p.countsForTeam);
    const bench = ordered.filter(p => !p.countsForTeam);
    const rows = [...positionOrder, ...(starters.some(p => !positionOrder.includes(p.pos)) ? ['UNKNOWN'] : [])];
    const playerCard = player => playerHtml(player, substitutionFor(side, player));
    const substitutions = substitutionNote(side);
    return `<section class="md-side" aria-label="${escape(side.entryName)}的${side.preview ? '赛前预览' : '当轮阵容'}">
      <header class="md-team-head"><div><h3>${escape(side.entryName)}</h3><p>${escape(side.playerName)} <span>· ${escape(side.formation)}</span></p></div><div class="md-team-score"><strong>${number(side.score)}</strong><span>${side.preview ? '尚未开赛' : side.provisional ? '暂计得分' : '当轮得分'}</span></div></header>
      <div class="md-progress">${side.preview ? '<span>当前持有阵容 · 截止前可变</span><span>非该轮锁定阵容</span>' : `<span>已出战 <b>${number(side.playedCount)} / ${number(side.startingCount)}</b></span><span>还有赛程 <b>${number(side.remainingCount)} 人</b></span>`}</div>
      ${substitutions ? `<p class="md-subs-note${side.provisional ? ' md-subs-projected' : ''}">${escape(substitutions)}</p>` : ''}
      <div class="md-pitch" style="grid-template-rows:repeat(${rows.length},1fr)">${field}${rows.map(pos => `<div class="md-pitch-row md-row-${pos.toLowerCase()}">${starters.filter(p => pos === 'UNKNOWN' ? !positionOrder.includes(p.pos) : p.pos === pos).map(playerCard).join('')}</div>`).join('')}</div>
      <div class="md-bench"><div class="md-bench-heading"><b>替补席</b><span>${number(side.benchPoints)} 分 · 不计入总分</span></div><div class="md-bench-row">${bench.map(playerCard).join('')}</div></div>
    </section>`;
  }
  function validDetail(detail, selection) {
    return detail && Number(detail.leagueId) === selection.leagueId && Number(detail.gw) === selection.gw &&
      Array.isArray(detail.sides) && detail.sides.length === 2 && detail.sides.every((side, i) =>
        Number(side.entryId) === selection.entries[i] && Array.isArray(side.players) && side.players.length > 0);
  }
  function detailSignature(detail) {
    // Receiving an identical official result with a newer collection time is
    // not a reason to recreate thirty player cards or disturb scroll/focus.
    const clocks = new Set(['updated', 'checkedAt', 'meta', 'revision', 'stale', 'refreshError']);
    return JSON.stringify(detail, (key, value) => clocks.has(key) ? undefined : value);
  }
  function previewDetail(snapshot, selection) {
    if (!(selection.gw > snapshot.meta.reportGw) || selection.gw > 38
      || Number(snapshot.meta.leagueId) !== selection.leagueId
      || !(snapshot.leagueSchedule || []).some(m => m.gw === selection.gw
        && selection.entries.includes(m.entry1Id) && selection.entries.includes(m.entry2Id) && m.entry1Id !== m.entry2Id)) return null;
    const sides = selection.entries.map(id => {
      const manager = snapshot.managers.find(m => m.entryId === id);
      if (!manager || manager.picks?.length !== 15 || manager.picks.some(p => !p.player)) return null;
      const players = manager.picks.map(p => ({ ...p.player, position: p.position, countsForTeam: p.position <= 11,
        points: null, minutes: 0, yellowCards: 0, redCards: 0, status: 'pending', fixtures: [] }));
      return { entryId: id, entryName: manager.entryName, playerName: manager.playerName, preview: true,
        formation: ['DEF','MID','FWD'].map(pos => players.filter(p => p.countsForTeam && p.pos === pos).length).join('-'),
        players, score: null, startingCount: 11, playedCount: null, remainingCount: null, benchPoints: null, substitutions: [] };
    });
    if (sides.some(side => !side)) return null;
    return { leagueId: selection.leagueId, leagueName: snapshot.meta.leagueName, gw: selection.gw,
      updated: snapshot.meta.updated, preview: true, live: false, finished: false, stale: !!snapshot.meta.stale, sides };
  }
  function copyImage(blobPromise, clipboard, ClipboardType) {
    try {
      if (!clipboard?.write || !ClipboardType) throw new Error('当前浏览器不支持复制图片');
      // Start inside the click gesture; Safari may reject writes after awaiting image generation.
      return Promise.resolve(clipboard.write([new ClipboardType({ 'image/png': blobPromise })]));
    } catch (error) { return Promise.reject(error); }
  }
  let initialized = false;
  let hydrateSnapshot = null;
  function hydrate(snapshot) {
    return hydrateSnapshot ? hydrateSnapshot(snapshot) : 0;
  }
  function init(options) {
    if (initialized) return;
    initialized = true;
    const browser = typeof window === 'undefined' ? globalThis : window;
    const dialog = document.querySelector('#matchDetailDialog');
    const body = document.querySelector('#matchDetailBody');
    const heading = document.querySelector('#matchDetailTitle');
    const meta = document.querySelector('#matchDetailMeta');
    const notice = document.querySelector('#matchDetailNotice');
    const retry = document.querySelector('#matchDetailRetry');
    const shareButton = document.querySelector('#matchDetailShare');
    const feedback = document.querySelector('#matchShareFeedback');
    const imageLink = document.querySelector('#matchShareImage');
    let selection = null, detail = null, request = null, timer = null, sequence = 0, lastLoaded = 0;
    let intentTimer = null;
    let updates = null, updatesKey = null, connectingUpdates = false, renderedSignature = null;
    let retryAt = 0, loadFailures = 0;
    let pageSuspended = false;
    const detailCache = new Map();
    const pendingLoads = new Map();
    const freshMs = 60_000;
    const cacheKey = current => `${current.leagueId}:${current.gw}:${current.entries.join(':')}`;
    const fresh = entry => {
      const age = entry ? Date.now() - Date.parse(entry.detail.updated) : NaN;
      return !!entry && !entry.detail.stale && Number.isFinite(age) && age >= -5000 && age < freshMs;
    };
    function remember(current, result) {
      const key = cacheKey(current);
      const previous = detailCache.get(key);
      const incomingTime = Date.parse(result.updated);
      const previousTime = Date.parse(previous?.detail.updated);
      // A slower API request must not roll a snapshot-hydrated score backwards.
      if (previous && Number.isFinite(previousTime)
        && (!Number.isFinite(incomingTime) || previousTime > incomingTime
          || (previousTime === incomingTime && !previous.detail.stale && result.stale))) return previous;
      const entry = { detail: result, loadedAt: Date.now() };
      detailCache.delete(key);
      detailCache.set(key, entry);
      while (detailCache.size > 24) detailCache.delete(detailCache.keys().next().value);
      return entry;
    }
    hydrateSnapshot = snapshot => {
      if (detail?.preview && selection && dialog.open && Number(snapshot.meta?.leagueId) === selection.leagueId) {
        if (selection.gw > snapshot.meta.reportGw) {
          const updatedPreview = previewDetail(snapshot, selection);
          if (updatedPreview) { detail = updatedPreview; render(); }
        } else load();
      }
      const leagueId = Number(snapshot?.meta?.leagueId);
      const gw = Number(snapshot?.meta?.reportGw);
      const activeLeagueId = Number(options.getSnapshot()?.meta?.leagueId);
      if (![leagueId, gw].every(value => Number.isSafeInteger(value) && value > 0)
        || gw > 38 || leagueId !== activeLeagueId || !Array.isArray(snapshot.matchDetails)) return 0;
      const members = new Set((Array.isArray(snapshot.managers) ? snapshot.managers : []).map(manager => Number(manager.entryId)));
      const matches = Array.isArray(snapshot.reportGwMatches) ? snapshot.reportGwMatches
        : Array.isArray(snapshot.h2hByGw?.[gw]) ? snapshot.h2hByGw[gw] : [];
      let count = 0;
      for (const source of snapshot.matchDetails) {
        if (source?.autoSubsVersion !== 1 || !Array.isArray(source.sides)) continue;
        const entries = source.sides.map(side => Number(side?.entryId));
        const updated = Date.parse(source?.updated);
        if (!entries || entries.length !== 2 || entries[0] === entries[1]
          || entries.some(id => !Number.isSafeInteger(id) || id <= 0 || !members.has(id))
          || !Number.isFinite(updated) || updated > Date.now() + 5000
          || !matches.some(match => [Number(match.entry1Id), Number(match.entry2Id)].every(id => entries.includes(id)))) continue;
        const current = { leagueId, gw, entries };
        if (!validDetail(source, current)) continue;
        // Preserve the source timestamp and mark stale snapshots honestly;
        // neither receipt nor hydration starts a new 60-second freshness window.
        const seeded = snapshot.meta.stale ? { ...source, stale: true } : source;
        remember(current, seeded);
        remember({ ...current, entries: [...entries].reverse() }, { ...seeded, sides: [...seeded.sides].reverse() });
        count++;
      }
      if (count && selection && dialog.open && selection.leagueId === leagueId && selection.gw === gw) {
        const cached = detailCache.get(cacheKey(selection));
        const currentTime = Date.parse(detail?.updated);
        const incomingTime = Date.parse(cached?.detail.updated);
        if (cached && (!detail || !Number.isFinite(currentTime) || incomingTime > currentTime
          || (incomingTime === currentTime && detail.stale && !cached.detail.stale))) {
          const isFresh = fresh(cached);
          if (isFresh) { sequence++; request = null; }
          detail = isFresh ? cached.detail : { ...cached.detail, stale: true };
          lastLoaded = cached.loadedAt;
          const scrollTop = body.scrollTop;
          render();
          body.scrollTop = scrollTop;
          if (!isFresh && !request) load(true);
          else planRefresh();
        }
      }
      return count;
    };
    async function fetchDetail(current, forceRead = false) {
      const key = cacheKey(current);
      const cached = detailCache.get(key);
      if (!forceRead && fresh(cached)) return cached;
      if (pendingLoads.has(key)) return pendingLoads.get(key);
      if (pendingLoads.size >= 4) throw new Error('正在读取其他对阵，请稍后重试。');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45_000);
      const task = (async () => {
        const response = await fetch(`/api/league/${current.leagueId}/match/${current.gw}/${current.entries[0]}/${current.entries[1]}`, { cache: 'no-store', signal: controller.signal });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `对战数据暂不可用（${response.status}）`);
        if (!validDetail(result, current)) throw new Error('对战数据不完整，请稍后重试。');
        return remember(current, result);
      })().finally(() => { clearTimeout(timeout); pendingLoads.delete(key); });
      pendingLoads.set(key, task);
      return task;
    }
    function selectionFor(card) {
      if (!card || card.disabled) return null;
      const snapshot = options.getSnapshot();
      const leagueId = Number(snapshot?.meta?.leagueId);
      const gw = Number(card.dataset.matchGw);
      const entries = [Number(card.dataset.matchLeft), Number(card.dataset.matchRight)];
      return [leagueId, gw, ...entries].every(n => Number.isSafeInteger(n) && n > 0)
        ? { leagueId, gw, entries } : null;
    }
    function warm(card, delay = 140) {
      clearTimeout(intentTimer);
      const current = selectionFor(card);
      if (!current || current.gw > options.getSnapshot()?.meta?.reportGw || document.hidden || navigator.connection?.saveData) return;
      intentTimer = setTimeout(() => {
        // Only pre-read the matchup the user is pointing at, never the league.
        if (!document.hidden && !pendingLoads.size) fetchDetail(current).catch(() => {});
      }, delay);
    }
    let imageUrl = null, sharing = false, shareGeneration = 0;
    const field = options.fieldHtml();
    const time = iso => {
      const date = new Date(iso);
      return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '时间待更新';
    };
    function clearImage() {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = null;
      imageLink.hidden = true;
      imageLink.removeAttribute('href');
    }
    function closeUpdates() {
      updates?.close(); updates = null; updatesKey = null;
    }
    function ensureUpdates() {
      if (!dialog.open || !detail || detail.preview || pageSuspended || document.hidden || navigator.onLine === false
        || (!detail.live && !detail.finalizing && !detail.stale)) { closeUpdates(); return; }
      if (!browser.TQLUpdates || connectingUpdates) return;
      const key = cacheKey(selection);
      if (updates && updatesKey === key) return;
      closeUpdates(); updatesKey = key; connectingUpdates = true;
      const current = selection;
      try {
        updates = browser.TQLUpdates.connect({
          url: `/api/updates?channel=match&league=${current.leagueId}&gw=${current.gw}&entry1=${current.entries[0]}&entry2=${current.entries[1]}`,
          initialRevision: detail.meta?.revision || null, initialStale: Boolean(detail.stale),
          onUpdate: async state => {
            if (!dialog.open || pageSuspended || document.hidden || cacheKey(selection) !== key || request) return false;
            // This notification came from a newer shared backend detail. Do
            // not accidentally acknowledge it using the local 60s old cache.
            const loaded = await load(true, true, true);
            // The shared stream validates a different/newer returned revision
            // using real source clocks. Never substitute the notification's
            // identity when a cache response cannot prove what it contains.
            return loaded && typeof loaded.revision === 'string' ? loaded : false;
          },
          onChecked: state => {
            if (!dialog.open || cacheKey(selection) !== key || !detail) return;
            const incoming = Date.parse(state.updated);
            if (Number.isFinite(incoming) && incoming >= Date.parse(detail.updated)) {
              detail = { ...detail, updated: state.updated, stale: Boolean(state.stale),
                meta: { ...detail.meta, ...state } };
              lastLoaded = remember(current, detail).loadedAt;
              render(); // content signature keeps the pitches in place
            }
            planRefresh();
          },
          onStatus: () => { if (dialog.open && !connectingUpdates) planRefresh(); },
        });
      } finally { connectingUpdates = false; }
    }
    function planRefresh() {
      clearTimeout(timer);
      ensureUpdates();
      if (!dialog.open || detail?.preview || pageSuspended || document.hidden || navigator.onLine === false) return;
      if (detail && !detail.live && !detail.finalizing && !detail.stale) return;
      const age = detail ? Date.now() - Date.parse(detail.updated) : 0;
      const cacheDue = detail && !detail.stale && Number.isFinite(age) ? Math.max(1000, freshMs - age) : freshMs;
      const delay = updates?.healthy() ? 20_000 : Math.max(cacheDue, retryAt - Date.now());
      timer = setTimeout(() => {
        if (!dialog.open || pageSuspended || document.hidden || navigator.onLine === false) return;
        if (updates?.healthy() || request) planRefresh();
        else load(true);
      }, delay);
    }
    function render() {
      const label = detail.preview ? '赛前阵容预览' : detail.live ? '实时对战' : detail.finished ? '对战结果' : '当轮对战';
      heading.textContent = `GW${detail.gw} · ${label}`;
      meta.textContent = `${detail.leagueName} · 更新于 ${time(detail.updated)}`;
      notice.textContent = detail.stale ? '暂时无法获取最新数据，以下保留上次成功的对战快照。' : detail.live ? '本场独立同步 · 官方得分变化后自动更新，已含 DEFCON 与奖励分。' : detail.finalizing ? '比赛已结束，等待官方结算；有变化自动同步，已包含 DEFCON 与奖励分。' : '展示该 GW 锁定阵容，已含防守贡献（DEFCON）与奖励分；替补不计总分。';
      notice.classList.toggle('md-warning', !!detail.stale);
      if (detail.preview) notice.textContent = '赛前预览：成员按最新交易归属更新，首发／替补参考最近公开阵容；截止前排位调整官方暂不公开，不代表已同步的新首发，得分尚未产生。' + (detail.stale ? ' 当前数据有延迟。' : '');
      retry.hidden = !detail.stale;
      shareButton.disabled = sharing;
      body.setAttribute('aria-busy', 'false');
      const signature = detailSignature(detail);
      if (signature === renderedSignature) return;
      renderedSignature = signature;
      const scrollTop = body.scrollTop;
      const historicalKitNote = detail.sides.some(s => s.players.some(p => p.teamMetadataNote)) ? ' 发生真实俱乐部转会的球员展示当前球衣，历史对阵以当轮记录为准。' : '';
      const hasProjected = detail.sides.some(side => side.provisional || side.substitutions?.some(sub => sub.source === 'projected'));
      const hasSubstitutions = detail.sides.some(side => side.substitutions?.length);
      const projectedNote = hasProjected ? ' 含预判自动替补，最终以官方结算为准；待上场的替补显示「—」，不预先加分。' : '';
      const substitutionLegend = hasSubstitutions ? '<span>替↑/↓ 官方替补</span><span>预↑/↓ 规则预判</span>' : '';
      body.innerHTML = `<div class="md-state-legend"><span>— 未参赛</span><span><i></i>赛中实时分</span><span>完赛保留实际分</span>${substitutionLegend}</div><div class="md-pitches">${detail.sides.map(side => sideHtml(side, field)).join('')}</div><p class="md-scoring-note">赛中底色表示已出场且球队比赛仍在进行，不保证球员仍在场。已出战人数只计有效 XI；0 分出场也计入，替补席不计总分。双赛周人数可能重叠。${projectedNote}${historicalKitNote}</p>`;
      body.querySelectorAll('.md-kit img').forEach(img => {
        const fallback = () => img.parentElement.classList.add('md-kit-error');
        img.addEventListener('error', fallback, { once: true });
        if (img.complete && !img.naturalWidth) fallback();
      });
      if (detail.preview) {
        const legend = body.querySelector('.md-state-legend');
        if (legend) legend.textContent = '当前持有阵容 · 非本轮锁定阵容 · — 尚未开赛';
        const note = body.querySelector('.md-scoring-note');
        if (note) note.textContent = '此图仅供赛前沟通，不预测得分；该轮开始后自动改为锁定阵容和实际得分。';
      }
      body.scrollTop = scrollTop;
    }
    async function load(background = false, forceRead = false, fromNotification = false) {
      if (!selection || !dialog.open) return false;
      if (background && Date.now() < retryAt) { planRefresh(); return false; }
      const snapshot = options.getSnapshot();
      if (selection.gw > snapshot.meta.reportGw) {
        detail = previewDetail(snapshot, selection);
        closeUpdates();
        retry.hidden = true;
        if (detail) render();
        else {
          body.innerHTML = '<div class="md-loading">赛前阵容暂不可用<small>等待当前阵容同步，不使用其他轮次得分代替。</small></div>';
          body.setAttribute('aria-busy', 'false');
          notice.textContent = '该轮尚未开始，阵容未锁定。';
          shareButton.disabled = true;
        }
        return true;
      }
      const version = ++sequence;
      const current = selection;
      request = version;
      retry.hidden = true;
      if (!background || !detail) {
        renderedSignature = null;
        body.innerHTML = '<div class="md-loading" role="status"><span class="md-loading-dot"></span>正在同步本场对阵…<small>获取该 GW 阵容与实时得分</small></div>';
        body.setAttribute('aria-busy', 'true');
      }
      try {
        const entry = await fetchDetail(current, forceRead);
        if (version !== sequence || !dialog.open) return false;
        detail = entry.detail;
        lastLoaded = entry.loadedAt;
        retryAt = 0; loadFailures = 0;
        render();
        const state = detail.meta?.revision ? { ...detail.meta, revision: detail.meta.revision,
          updated: detail.updated, checkedAt: detail.meta.checkedAt || detail.updated,
          stale: Boolean(detail.stale) } : null;
        // Notification reads must go through the stream's monotonic validation
        // before acknowledgment. Direct/manual reads can acknowledge their own
        // actual version once rendered, including clearing an identical push.
        if (state && !fromNotification) updates?.acknowledge?.(state);
        return state || true;
      } catch (error) {
        if (version !== sequence || !dialog.open) return false;
        retryAt = Date.now() + Math.min(freshMs, 15_000 * 2 ** Math.min(loadFailures++, 2));
        const message = error.name === 'AbortError' ? '读取超时，请稍后重试。' : error.message;
        notice.textContent = detail ? `更新失败，保留 ${time(detail.updated)} 的快照。${message}` : message;
        notice.classList.add('md-warning');
        if (detail) { detail = { ...detail, stale: true }; }
        else body.innerHTML = '<div class="md-loading">暂时无法读取这场对战<small>没有用当前持有阵容或其他 GW 的数据替代。</small></div>';
        body.setAttribute('aria-busy', 'false');
        retry.hidden = false;
        return false;
      } finally {
        if (version === sequence) { request = null; planRefresh(); }
      }
    }
    function open(card) {
      const snapshot = options.getSnapshot();
      const current = selectionFor(card);
      if (!current) return;
      const { gw } = current;
      clearTimeout(intentTimer);
      clearTimeout(timer);
      closeUpdates();
      sequence++;
      request = null;
      selection = current;
      detail = null;
      renderedSignature = null;
      retryAt = 0; loadFailures = 0;
      lastLoaded = 0;
      shareGeneration++;
      sharing = false;
      clearImage();
      feedback.textContent = '';
      shareButton.disabled = true;
      shareButton.querySelector('span').textContent = '复制图片';
      heading.textContent = `GW${gw} · 对战详情`;
      meta.textContent = snapshot.meta.leagueName;
      notice.textContent = '按所选 GW 的锁定阵容读取，不受之后的交易影响。';
      notice.classList.remove('md-warning');
      if (!dialog.open) dialog.showModal();
      document.body.classList.add('match-detail-open');
      body.scrollTop = 0;
      const cached = detailCache.get(cacheKey(current));
      if (cached) {
        detail = fresh(cached) ? cached.detail : { ...cached.detail, stale: true };
        lastLoaded = cached.loadedAt;
        render();
        if (fresh(cached)) planRefresh();
        else {
          notice.textContent = '先展示上次快照，正在同步最新比分…';
          load(true);
        }
      } else load();
    }
    shareButton.addEventListener('click', async () => {
      if (!detail || sharing) return;
      const current = JSON.parse(JSON.stringify(detail));
      const version = ++shareGeneration;
      sharing = true;
      shareButton.disabled = true;
      shareButton.querySelector('span').textContent = '生成中…';
      feedback.textContent = '正在生成双球场图片…';
      try {
        const blobPromise = window.FPLMatchShare.createBlob(current);
        const copyResult = copyImage(blobPromise, navigator.clipboard, typeof ClipboardItem === 'undefined' ? null : ClipboardItem)
          .then(() => true, () => false);
        const blob = await blobPromise;
        const copied = await copyResult;
        if (!dialog.open || version !== shareGeneration) return;
        clearImage();
        imageUrl = URL.createObjectURL(blob);
        imageLink.href = imageUrl;
        imageLink.hidden = false;
        const names = current.sides.map(s => s.entryName).join('-vs-').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').slice(0, 90);
        const filename = `FPL-Draft-GW${current.gw}-${names}.png`;
        imageLink.download = filename;
        imageLink.textContent = '下载图片';
        feedback.textContent = copied ? '图片已复制，可在微信中按 Ctrl+V（Mac：⌘V）粘贴。'
          : '浏览器未允许复制图片，可点击「下载图片」保存后发送到微信。';
        if (version === shareGeneration && current.updated !== detail?.updated) feedback.textContent += ` 图片为 ${time(current.updated)} 的快照。`;
      } catch (error) {
        if (version === shareGeneration) feedback.textContent = `图片生成失败：${error.message}，请重试。`;
      } finally {
        if (version === shareGeneration) {
          sharing = false;
          shareButton.disabled = !detail;
          shareButton.querySelector('span').textContent = '复制图片';
        }
      }
    });
    const matchList = document.querySelector('#lastGwMatchList');
    matchList.addEventListener('pointerover', event => {
      if (event.pointerType === 'mouse') warm(event.target.closest('[data-match-gw]'));
    });
    matchList.addEventListener('focusin', event => warm(event.target.closest('[data-match-gw]')));
    matchList.addEventListener('pointerdown', event => warm(event.target.closest('[data-match-gw]'), 0));
    matchList.addEventListener('pointerleave', () => clearTimeout(intentTimer));
    matchList.addEventListener('focusout', () => clearTimeout(intentTimer));
    matchList.addEventListener('click', event => {
      const card = event.target.closest('[data-match-gw]');
      if (card && !card.disabled) open(card);
    });
    document.querySelector('#fxRounds')?.addEventListener('click', event => {
      const card = event.target.closest('[data-match-gw]');
      if (card && !card.disabled) open(card);
    });
    document.querySelector('#matchDetailClose').addEventListener('click', () => dialog.close());
    retry.addEventListener('click', () => { retryAt = 0; return load(!!detail, true); });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
    dialog.addEventListener('close', () => {
      sequence++;
      shareGeneration++;
      request = null;
      clearTimeout(intentTimer);
      clearTimeout(timer);
      closeUpdates();
      clearImage();
      document.body.classList.remove('match-detail-open');
      if (selection) document.querySelector(`[data-match-gw="${selection.gw}"][data-match-left="${selection.entries[0]}"][data-match-right="${selection.entries[1]}"]`)?.focus({ preventScroll: true });
    });
    function restore() {
      if (pageSuspended || document.hidden || navigator.onLine === false || !dialog.open) { clearTimeout(timer); closeUpdates(); return; }
      ensureUpdates();
      const sourceTime = Date.parse(detail?.updated || '') || lastLoaded;
      if (!request && (!detail || detail.stale || Date.now() - Math.min(lastLoaded, sourceTime) >= freshMs)) load(!!detail);
      else { updates?.catchUp?.(); planRefresh(); }
    }
    document.addEventListener('visibilitychange', restore);
    browser.addEventListener?.('online', restore);
    browser.addEventListener?.('offline', restore);
    browser.addEventListener?.('pagehide', () => { pageSuspended = true; clearTimeout(timer); closeUpdates(); });
    browser.addEventListener?.('pageshow', event => { pageSuspended = false; if (event.persisted) restore(); });
  }
  return { init, hydrate, playerState, playerHtml, sideHtml, validDetail, number, kit, substitutionFor, substitutionNote, previewDetail, copyImage, detailSignature };
});
