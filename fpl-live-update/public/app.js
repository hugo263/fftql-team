/* FPL Draft Weekly Update — frontend app */
'use strict';

const STATE = {
  snap: null,
  standingsSort: 'rank',
  squadEntryId: null,
  freeAgentPos: '',
  freeAgentTeam: '',
  freeAgentStatus: 'signable',
  freeAgentSort: 'epNext',
  freeAgentSearch: '',
  freeAgentPage: 1,
  shareEntryId: null,
  shareLoadedEntryId: null,
  shareLockedIds: new Set(),
  shareMessage: '紫色球员不卖，其他都可以谈，欢迎私聊交易。',
  reportGw: null,
  reportGwPinned: false,
  trendEntryId: null,
  txCenterGw: null,
  txEvalGw: null, // null follows latest GW with actual scoring data, not deadlines.
  txCenterFilter: 'done',
  txHistoryView: 'players',
  myEntryId: null,
  posFilterA: '',
  posFilterB: '',
  cmpLeft: null,
  cmpRight: null,
  cmpView: 'pitch',
  tradeA: [],
  tradeB: [],
};

const REQUESTED_LEAGUE_ID = (() => {
  const value = new URLSearchParams(window.location.search).get('league');
  return /^\d{1,10}$/.test(value || '') ? Number(value) : null;
})();
const SNAPSHOT_ENDPOINT = REQUESTED_LEAGUE_ID
  ? `/api/league/${REQUESTED_LEAGUE_ID}`
  : '/api/snapshot';
const SCOUT_WORKSPACE = document.documentElement.classList.contains('scout-workspace');
const TIMELINE = FPLTimeline;
const CHART_TEXT = SCOUT_WORKSPACE ? '#4A5A50' : '#93a4c3';
const CHART_FAINT = SCOUT_WORKSPACE ? '#748178' : '#5f7397';
const CHART_GRID = SCOUT_WORKSPACE ? '#E3E9E2' : 'rgba(34,48,80,.4)';
const CHART_PRIMARY = SCOUT_WORKSPACE ? '#12382A' : '#00ff87';
const CHART_SECONDARY = SCOUT_WORKSPACE ? '#88599D' : '#4f8cff';
const CHART_POS_FILL = SCOUT_WORKSPACE ? 'rgba(18,56,42,.72)' : 'rgba(0,255,135,.65)';
const CHART_NEG_FILL = SCOUT_WORKSPACE ? 'rgba(179,64,42,.62)' : 'rgba(255,92,114,.55)';

if (SCOUT_WORKSPACE) {
  const scoutLabels = {
    weekly: '本轮战报', trades: '交易动态与收益', standings: '积分榜', fixtures: '联赛赛程',
    freeagents: '自由球员', share: '阵容分享', compare: '阵容对比', predict: '下轮预测', trade: '交易评估',
  };
  document.querySelectorAll('#tabs .tab').forEach((tab) => {
    tab.textContent = scoutLabels[tab.dataset.tab] || tab.textContent;
  });
}

/* ---------------- utils ---------------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt1 = (n) => (n == null ? '—' : Number(n).toFixed(1));
const fmtM = (n) => (n == null ? '—' : `£${Number(n).toFixed(1)}M`);
const photoUrl = (code) => code ? `https://resources.premierleague.com/premierleague/photos/players/110x110/p${code}.png` : '';
const initialOf = (name) => (name || '?').trim().charAt(0).toUpperCase();
// Visual identity only; use the same name-based colours as fixtures and feed.
function managerMark(name) {
  if (!name) return '';
  const palette = ['#D85B36','#2F6FED','#3E7C4F','#88599D','#AB7824','#20847D'];
  let hash = 0;
  for (const char of String(name)) hash = (Math.imul(hash,31) + char.charCodeAt(0)) >>> 0;
  return `<i class="night-manager-mark" style="--manager-color:${palette[hash % palette.length]}" aria-hidden="true"></i>`;
}
const kitUrl = (player) => {
  const code = Number(player?.teamCode);
  if (!Number.isFinite(code) || code <= 0) return '';
  return `/api/kit/${code}${player.pos === 'GKP' ? '-gk' : ''}.png`;
};
const bindKitFallbacks = (selector, wrapperSelector) => {
  $$(selector).forEach((img) => {
    img.addEventListener('error', () => img.closest(wrapperSelector)?.classList.add('kit-error'), { once: true });
  });
};

function managerByEntry(entryId) {
  return (STATE.snap?.managers || []).find((m) => m.entryId === entryId) || null;
}
function ownerName(entryId) {
  const m = managerByEntry(entryId);
  return m ? m.entryName : null;
}
/* "我方" = Ken 的队伍（与阵容对比页同一识别规则） */
function getMyEntryId() {
  if (STATE.myEntryId) return STATE.myEntryId;
  const s = STATE.snap;
  if (!s || !s.managers) return null;
  const ken = s.managers.find((m) => /加布惊焰/.test(m.entryName))
    || s.managers.find((m) => /Ken/i.test(m.playerName));
  STATE.myEntryId = (ken || null)?.entryId ?? STATE.cmpLeft ?? (s.managers[0] || {}).entryId ?? null;
  return STATE.myEntryId;
}
/* 去音调规范化：Sangaré -> sangare，让 "sangare" 也能搜到 */
function normTxt(str) {
  return String(str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function formDots(history, last = 5) {
  const recent = (history || []).slice(-last).map((h) => h.points);
  if (!recent.length) return '<span class="tx-meta">—</span>';
  const median = [...recent].sort((a, b) => a - b)[Math.floor(recent.length / 2)];
  return `<span class="form-dots">${recent.map((p) => {
    const cls = p >= median ? 'g' : 'r';
    return `<span class="form-dot ${cls}">${p}</span>`;
  }).join('')}</span>`;
}
function normCdf(z) {
  // Abramowitz-Stegun approximation
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z >= 0 ? 1 - p : p;
}
function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 90) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

const POS_ORDER = { GKP: 0, DEF: 1, MID: 2, FWD: 3 };
const forecastLabel = () => `GW${STATE.snap?.meta.upcomingGw || '—'} 预计`;

/* ---------------- boot ---------------- */
let autoRefreshTimer = null;
let leagueUpdates = null;
let snapshotLoading = false;
let lastTextInputAt = 0;
let snapshotRequest = null, snapshotGeneration = 0, snapshotFailures = 0;
let leagueConnection = 'connecting', snapshotError = '';
document.addEventListener('input', (event) => {
  if (/^(INPUT|TEXTAREA)$/.test(event.target.tagName)) lastTextInputAt = Date.now();
});
function applySnapshot(snapshot, background = false) {
  if (!snapshot?.meta || !Array.isArray(snapshot.players) || !Array.isArray(snapshot.managers)
    || (REQUESTED_LEAGUE_ID && Number(snapshot.meta.leagueId) !== REQUESTED_LEAGUE_ID)) throw Error('联赛数据不完整，请重试');
  const focused = document.activeElement;
  const focusId = background && focused?.id;
  const selection = focusId && /^(INPUT|TEXTAREA)$/.test(focused.tagName)
    ? [focused.selectionStart, focused.selectionEnd] : null;
  const scroll = background ? { x: window.scrollX, y: window.scrollY } : null;
  if (!STATE.reportGwPinned) STATE.reportGw = TIMELINE.weeklyGw(snapshot.meta);
  STATE.txCenterGw = TIMELINE.followTrade(STATE.snap?.meta, snapshot.meta, STATE.txCenterGw);
  STATE.snap = snapshot;
  if (typeof window !== 'undefined') window.TQLHome?.setLeagueSnapshot(snapshot);
  // Resolve the original default before any lazily opened module can change Compare.
  getMyEntryId();
  for (const side of ['A', 'B']) {
    STATE[`trade${side}`] = STATE[`trade${side}`].map((player) => snapshot.players.find((p) => p.id === player.id) || player);
  }
  renderAll();
  // Keep the user's cursor and reading position through a background snapshot.
  if (focusId && !focused.isConnected) {
    const replacement = document.getElementById(focusId);
    replacement?.focus({ preventScroll: true });
    if (selection && selection[0] != null) {
      try { replacement?.setSelectionRange(...selection); } catch (_) { /* Non-text input. */ }
    }
  }
  if (scroll && (window.scrollY !== scroll.y || window.scrollX !== scroll.x)) window.scrollTo(scroll.x, scroll.y);
}
function scheduleAutoRefresh() {
  clearTimeout(autoRefreshTimer);
  if (document.hidden || window.navigator?.onLine === false) return;
  if (!leagueUpdates && STATE.snap && window.TQLUpdates) {
    leagueUpdates = window.TQLUpdates.connect({
      url: `/api/updates?league=${Number(STATE.snap.meta.leagueId)}`,
      initialRevision: STATE.snap.meta.revision,
      initialStale: Boolean(STATE.snap.meta.stale),
      onUpdate: () => pollSnapshot(),
      onStatus: ({ status }) => { leagueConnection = status; updateRefreshStatus(); },
      onChecked: state => {
        if (!STATE.snap || !state.updated) return;
        STATE.snap.meta = { ...STATE.snap.meta, updated: state.updated, checkedAt: state.checkedAt,
          stale: state.stale, refreshing: Boolean(state.refreshing), refreshSeconds: state.refreshSeconds || 900 };
        snapshotError = '';
        window.TQLHome?.setLeagueSnapshot(STATE.snap);
        updateRefreshStatus();
      },
    });
  }
  // Only a disconnected/unsupported browser falls back to periodic cache reads.
  autoRefreshTimer = setTimeout(() => {
    updateRefreshStatus();
    if (!leagueUpdates?.healthy() || STATE.snap?.meta.refreshing) pollSnapshot(); else scheduleAutoRefresh();
  }, STATE.snap?.meta.refreshing ? 7500 : Math.min(60_000, 15_000 * 2 ** Math.min(snapshotFailures, 2)));
}
async function readSnapshot(signal) {
  const response = await fetch(SNAPSHOT_ENDPOINT, { cache: 'no-store', signal });
  const snapshot = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(snapshot.error || `HTTP ${response.status}`);
  if (!snapshot?.meta || !Array.isArray(snapshot.players) || !Array.isArray(snapshot.managers)
    || (REQUESTED_LEAGUE_ID && Number(snapshot.meta.leagueId) !== REQUESTED_LEAGUE_ID)) throw Error('联赛数据不完整');
  return snapshot;
}
async function pollSnapshot() {
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '') && Date.now() - lastTextInputAt < 2000;
  if (document.hidden || window.navigator?.onLine === false || snapshotLoading || typing) {
    scheduleAutoRefresh();
    return false;
  }
  snapshotLoading = true;
  const generation = ++snapshotGeneration;
  const controller = new AbortController(); snapshotRequest = controller;
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const snapshot = await readSnapshot(controller.signal);
    if (generation !== snapshotGeneration) return false;
    snapshotError = ''; snapshotFailures = 0;
    if (!STATE.snap || snapshot.meta.stale !== STATE.snap.meta.stale || (snapshot.meta.revision ? snapshot.meta.revision !== STATE.snap.meta.revision : snapshot.meta.updated !== STATE.snap.meta.updated)) applySnapshot(snapshot, true);
    else { STATE.snap.meta = snapshot.meta; updateRefreshStatus(); }
    // A refreshing response is useful for first paint, not an acknowledgement of
    // the newer revision whose notification triggered this read.
    return snapshot.meta.refreshing ? false : { revision: snapshot.meta.revision, stale: Boolean(snapshot.meta.stale),
      updated: snapshot.meta.updated, checkedAt: snapshot.meta.checkedAt };
  } catch (error) {
    if (generation !== snapshotGeneration) return false;
    snapshotFailures++;
    snapshotError = STATE.snap ? '连接暂时中断，保留上次数据，正在自动重试' : '联赛暂时未能载入，正在自动重试';
    updateRefreshStatus();
    return false;
  } finally {
    clearTimeout(timeout);
    if (generation === snapshotGeneration) {
      snapshotRequest = null; snapshotLoading = false; scheduleAutoRefresh();
    }
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearTimeout(autoRefreshTimer);
  else if (!leagueUpdates) pollSnapshot();
  else scheduleAutoRefresh();
});
window.addEventListener('online', () => { if (!leagueUpdates) pollSnapshot(); });
window.addEventListener('pageshow', event => { if (event.persisted && !leagueUpdates) pollSnapshot(); });
function updateRefreshStatus() {
  if (!STATE.snap) {
    if (snapshotError) {
      $('#updatedAt').textContent = snapshotError;
      const notice = $('#initialLoadNotice');
      if (notice && !window.TQLHome?.isActive()) { notice.hidden = false; notice.textContent = `${snapshotError}，也可以点击右上角刷新。`; }
    }
    return;
  }
  const { meta } = STATE.snap;
  const age = Date.now() - Date.parse(meta.updated);
  const stale = meta.stale || age > Math.max(180_000, (meta.refreshSeconds || 900) * 2000);
  const transport = leagueConnection === 'offline' ? '网络已断开，保留当前数据 · '
    : ['connecting', 'reconnecting', 'polling'].includes(leagueConnection) ? '正在恢复自动同步 · ' : '';
  const status = snapshotError ? `${snapshotError} · ` : meta.refreshing ? '正在同步最新数据，先显示上次结果 · ' : stale ? '数据暂有延迟 · ' : transport || '有变化自动同步 · ';
  $('#updatedAt').textContent = `${status}更新于 ${timeAgo(meta.updated)} · ${new Date(meta.updated).toLocaleString('zh-CN', {hour12:false})}`;
  const notice = $('#snapshotSyncNotice');
  if (notice) {
    notice.hidden = !meta.refreshing && !stale && !snapshotError && leagueConnection !== 'offline';
    notice.textContent = notice.hidden ? '' : `${snapshotError || (leagueConnection === 'offline' ? '网络已断开，恢复后自动同步' : meta.refreshing ? '正在同步最新数据，当前先展示上次结果' : '数据同步暂有延迟，当前保留上次结果')}（${new Date(meta.updated).toLocaleString('zh-CN', {hour12:false})}）。`;
  }
}
async function boot() {
  const generation = ++snapshotGeneration;
  snapshotLoading = true;
  try {
    const early = window.__fplInitialSnapshot;
    delete window.__fplInitialSnapshot;
    if (early) {
      const result = await early;
      if (generation !== snapshotGeneration) return;
      if (result.error) throw result.error;
      applySnapshot(result.data);
    } else {
      const result = await readSnapshot(AbortSignal.timeout(45_000));
      if (generation !== snapshotGeneration) return;
      applySnapshot(result);
    }
    snapshotError = ''; snapshotFailures = 0;
  } catch (e) {
    if (generation !== snapshotGeneration) return;
    snapshotError = `联赛暂时未能载入：${e.message}`; snapshotFailures++;
    updateRefreshStatus();
  } finally {
    if (generation === snapshotGeneration) {
      if (STATE.snap || window.TQLHome?.isActive()) $('#initialLoadNotice')?.setAttribute('hidden', '');
      snapshotLoading = false; scheduleAutoRefresh();
    }
  }
}

// Hidden modules must not build charts, canvases or request kits/QR images on first paint.
const tabSnapshots = new Map();
function renderTab(tab) {
  if (typeof window !== 'undefined') window.TQLHome?.show(tab === 'home');
  if (tab === 'home') return;
  if (!STATE.snap) {
    const notice = $('#initialLoadNotice');
    if (notice) { notice.hidden = false; notice.textContent = snapshotError || '正在读取联赛数据，完成后会自动显示…'; }
    return;
  }
  updateTradeCountdowns();
  if (!STATE.snap || tabSnapshots.get(tab) === STATE.snap) return;
  switch (tab) {
    case 'weekly': renderWeekly(); break;
    case 'trades': renderTradeCenter(); break;
    case 'standings': renderStandings(); break;
    case 'fun': TQLFun.render(STATE.snap); break;
    case 'fixtures': FPLFixtures.render(STATE.snap); break;
    case 'freeagents': renderFreeAgentTeamOptions(); renderFreeAgents(); break;
    case 'share': initShare(); break;
    case 'compare': initCompare(); break;
    case 'predict': renderPredict(); break;
    case 'trade': initTrade(); break;
    default: return;
  }
  tabSnapshots.set(tab, STATE.snap);
}

function renderAll() {
  const { meta } = STATE.snap;
  $('#initialLoadNotice')?.setAttribute('hidden', '');
  document.title = `${meta.leagueName || 'Draft 联赛'} · TQL FPL`;
  $('#leagueName').textContent = meta.leagueName;
  if (SCOUT_WORKSPACE) {
    Chart.defaults.color = CHART_TEXT;
    Chart.defaults.borderColor = CHART_GRID;
  }
  $('#seasonBadge').textContent = meta.season;
  const displayGw = TIMELINE.weeklyGw(meta) || meta.currentGw;
  $('#gwBadge').textContent = `GW${displayGw}`;
  const stateBadge = $('#gwStateBadge');
  stateBadge.dataset.state = displayGw > TIMELINE.reportGw(meta) ? 'upcoming'
    : meta.reportFinalizing ? 'pending' : meta.gwFinished ? 'final' : meta.gwInProgress ? 'live' : 'upcoming';
  stateBadge.classList.toggle('done', Boolean(meta.gwFinished));
  if (displayGw > TIMELINE.reportGw(meta)) {
    stateBadge.textContent = `GW${displayGw} 待开赛`;
    stateBadge.classList.remove('done');
  } else if (meta.reportFinalizing) {
    stateBadge.textContent = `GW${meta.currentGw} 完赛 · 待结算`;
  } else if (meta.gwFinished) {
    stateBadge.textContent = `GW${meta.lastFinishedGw} 已完赛`;
    stateBadge.classList.add('done');
  } else if (meta.gwInProgress) {
    stateBadge.textContent = `GW${meta.currentGw} 比赛进行中`;
  } else {
    stateBadge.textContent = `GW${meta.currentGw} 待开赛`;
  }
  updateRefreshStatus();
  $('#refreshNote').textContent = meta.refreshMinutes || 15;
  $('#tabs [data-tab="predict"]').textContent = `${TIMELINE.live(meta, meta.upcomingGw) ? '本轮' : '下轮'}预测`;

  FPLMatchView.hydrate(STATE.snap);
  if (STATE.squadEntryId != null) renderSquadModal(STATE.squadEntryId);
  renderTab($('#tabs .tab.active')?.dataset.tab || 'weekly');
  if ($('#tabs .tab.active')?.dataset.tab !== 'home') {
    document.dispatchEvent(new CustomEvent('fpl:league-ready', { detail: { leagueId: meta.leagueId } }));
  }
}

/* ---------------- tabs ---------------- */
$('#tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  $$('.tab').forEach((t) => t.classList.toggle('active', t === btn));
  $$('.tabpanel').forEach((p) => p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`));
  renderTab(btn.dataset.tab);
  if (btn.dataset.tab !== 'home' && STATE.snap) document.dispatchEvent(new CustomEvent('fpl:league-ready', { detail: { leagueId: STATE.snap.meta.leagueId } }));
});

/* ---------------- refresh ---------------- */
$('#btnRefresh').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (btn.disabled) return;
  btn.disabled = true;
  btn.classList.add('is-refreshing');
  btn.setAttribute('aria-busy', 'true');
  btn.setAttribute('aria-label', '正在更新数据');
  let generation = null, controller = null, timeout = null;
  try {
    // A manual refresh supersedes an older automatic/initial read. Its late
    // response must not overwrite the result the user explicitly requested.
    generation = ++snapshotGeneration;
    snapshotRequest?.abort();
    controller = new AbortController(); snapshotRequest = controller;
    timeout = setTimeout(() => controller.abort(), 90_000);
    snapshotLoading = true;
    const refreshUrl = REQUESTED_LEAGUE_ID
      ? `/api/refresh?league=${REQUESTED_LEAGUE_ID}`
      : '/api/refresh';
    const response = await fetch(refreshUrl, { method: 'POST', signal: controller.signal });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) throw Error(result.error || `HTTP ${response.status}`);
    const snapshot = await readSnapshot(controller.signal);
    if (generation !== snapshotGeneration) return;
    snapshotError = ''; snapshotFailures = 0;
    applySnapshot(snapshot, true);
    leagueUpdates?.acknowledge?.(snapshot.meta);
    if (typeof window !== 'undefined' && window.TQLHome?.isActive()) {
      if (await window.TQLHome.refresh() === false) throw new Error('联赛已刷新，比赛动态暂时不可用');
    }
    if (result.warning) { snapshotError = result.warning; updateRefreshStatus(); }
  } catch (err) {
    snapshotError = `刷新暂未完成，${STATE.snap ? '保留上次数据，' : ''}稍后自动重试`;
    updateRefreshStatus();
  } finally {
    clearTimeout(timeout);
    btn.disabled = false;
    btn.classList.remove('is-refreshing');
    btn.setAttribute('aria-busy', 'false');
    btn.setAttribute('aria-label', '刷新数据');
    if (generation !== null && generation === snapshotGeneration) { snapshotRequest = null; snapshotLoading = false; }
    scheduleAutoRefresh();
  }
});

/* ================= Tab 1: Weekly ================= */
let tradeCountdownTimer = null;
function updateTradeCountdowns() {
  clearTimeout(tradeCountdownTimer);
  tradeCountdownTimer = null;
  if (!STATE.snap || document.hidden || !$('#tab-weekly').classList.contains('active')) return;
  const now = Date.now();
  if (!STATE.reportGwPinned && STATE.reportGw !== TIMELINE.weeklyGw(STATE.snap.meta, now)) {
    STATE.reportGw = TIMELINE.weeklyGw(STATE.snap.meta, now);
    renderWeekly();
  }
  $('#tradeCountdowns').innerHTML = ['open', 'close'].map(kind => FPLTradeCountdown.cardHtml(STATE.snap.tradeWindows, kind, now)).join('');
  tradeCountdownTimer = setTimeout(updateTradeCountdowns, 1000 - now % 1000);
}
document.addEventListener('visibilitychange', updateTradeCountdowns);
window.addEventListener('pageshow', updateTradeCountdowns);
window.addEventListener('pagehide', () => clearTimeout(tradeCountdownTimer));

function renderGwSlicer() {
  const s = STATE.snap;
  const lastGw = TIMELINE.weeklyGw(s.meta);
  if (STATE.reportGw == null || STATE.reportGw > lastGw || STATE.reportGw < 1) {
    STATE.reportGw = lastGw;
  }
  const btns = [];
  for (let gw = 1; gw <= lastGw; gw++) {
    btns.push(`<button class="sort-btn ${gw === STATE.reportGw ? 'active' : ''}" data-gw="${gw}">GW${gw}${TIMELINE.live(s.meta, gw) ? ' · LIVE' : gw > TIMELINE.reportGw(s.meta) ? ' · 待开赛' : ''}</button>`);
  }
  $('#gwSlicer').innerHTML = btns.join('');
}

$('#gwSlicer').addEventListener('click', (e) => {
  const btn = e.target.closest('.sort-btn[data-gw]');
  if (!btn) return;
  STATE.reportGw = Number(btn.dataset.gw);
  STATE.reportGwPinned = true;
  $$('#gwSlicer .sort-btn').forEach((b) => b.classList.toggle('active', b === btn));
  renderWeekly();
});

function renderWeekly() {
  const s = STATE.snap;
  const { meta } = s;
  renderGwSlicer();
  const gw = STATE.reportGw || TIMELINE.weeklyGw(meta);
  const isLive = TIMELINE.live(meta, gw);
  const pending = gw > TIMELINE.reportGw(meta) || !meta.gwStarted && gw > meta.lastFinishedGw;

  $('#lastGwLabel').textContent = gw ? `GW${gw}（${pending ? '待开赛' : isLive ? '进行中 · 实时比分' : '已完赛'}）` : '等待首轮开始';
  $('#reportMatchTitle').textContent = pending ? '本轮对阵赛程' : isLive ? '本轮实时对阵' : '本轮对阵结果';
  const hasProjectedSubs = gw === TIMELINE.reportGw(s.meta) && s.meta.autoSubsProvisional;
  $('#reportContext').textContent = (pending ? '待开赛 · 赛前对阵，产生实际得分后自动更新' : isLive ? '进行中 · 有变化自动同步' : meta.reportFinalizing && gw === TIMELINE.reportGw(meta) ? '已完赛 · 等待官方结算，有变化自动同步' : 'FINAL · 已完赛结果')
    + (hasProjectedSubs ? ' · 含预判自动替补' : '');
  $('#reportContext').classList.toggle('is-live', isLive);
  const gwMatches = pending ? (s.leagueSchedule || []).filter(m => m.gw === gw)
    .map(m => ({ ...m, finished: false, entry1Points: null, entry2Points: null }))
    : (s.h2hByGw && s.h2hByGw[gw]) || [];
  $('#lastGwMatchList').innerHTML = gwMatches.length
    ? gwMatches.map((m) => matchCardHtml(m, m.finished, isLive)).join('')
    : '<div class="tx-meta">该 GW 无对阵数据</div>';

  renderDreamTeam(gw);
  renderGwTrend();
  TQLFun.summary(s, gw);
}

function matchCardHtml(m, finished, live = false) {
  const p1 = Number.isFinite(m.entry1Points) ? m.entry1Points : null;
  const p2 = Number.isFinite(m.entry2Points) ? m.entry2Points : null;
  const known = p1 != null && p2 != null;
  const w1 = finished && known && p1 > p2, w2 = finished && known && p2 > p1;
  const draw = finished && known && p1 === p2;
  const outcome = w1 ? `${m.entry1} 获胜` : w2 ? `${m.entry2} 获胜` : draw ? '平局' : '';
  const available = Number.isSafeInteger(m.entry1Id) && m.entry1Id > 0 && Number.isSafeInteger(m.entry2Id) && m.entry2Id > 0;
  return `
    <button type="button" class="match-card match-card-button" data-match-gw="${Number(m.gw)}" data-match-left="${Number(m.entry1Id)}" data-match-right="${Number(m.entry2Id)}" aria-haspopup="dialog" aria-label="${esc(m.entry1)} 对阵 ${esc(m.entry2)}，${outcome ? `${esc(outcome)}，` : ''}${available ? '查看 GW' + Number(m.gw) + ' 对战详情' : '暂无可查看阵容'}" ${available ? '' : 'disabled'}>
      <span class="match-side ${w1 ? 'winner' : ''}">
        <span class="match-team">${esc(m.entry1)}</span>
        ${w1 ? '<span class="match-result-badge">胜</span>' : ''}
      </span>
      <span class="match-score ${live ? 'live-score' : ''} ${draw ? 'is-draw' : ''}">${finished || live ? `<span class="match-score-number ${w1 ? 'is-winner' : w2 ? 'is-loser' : ''}">${p1 ?? '—'}</span><span class="match-score-number ${w2 ? 'is-winner' : w1 ? 'is-loser' : ''}">${p2 ?? '—'}</span>` : '<span class="match-score-pending">VS</span>'}</span>
      <span class="match-side right ${w2 ? 'winner' : ''}">
        <span class="match-team">${esc(m.entry2)}</span>
        ${w2 ? '<span class="match-result-badge">胜</span>' : ''}
      </span>
    </button>`;
}

function renderDreamTeam(gw) {
  const s = STATE.snap;
  const gwNum = gw || STATE.reportGw || TIMELINE.reportGw(s.meta);
  const dt = (s.totwByGw && s.totwByGw[gwNum]) || { players: [] };
  const live = TIMELINE.live(s.meta, gwNum);
  const finalizing = s.meta.reportFinalizing && gwNum === TIMELINE.reportGw(s.meta);
  const pending = gwNum > TIMELINE.reportGw(s.meta);
  $('#dreamTeamLabel').textContent = `GW${gwNum} · ${pending ? '待开赛' : live ? '实时阵容' : finalizing ? '完赛阵容 · 待结算' : '最终阵容'} · ${dt.formation || '等待比赛数据'}`;
  $('#dreamTeamNote').textContent = pending ? '本轮尚未开赛；产生实际得分后自动更新最佳阵容。历史战报与归属可在上方选择轮次查看。' : live
    ? '按本轮已产生的 Draft 得分更新最佳阵容；比赛尚未结束，阵容与奖励分可能变化。球衣来自 FPL 官方，Draft 无队长加倍。'
    : finalizing ? '本轮比赛已结束，最佳阵容按当前 Draft 得分展示；官方结算前仍同步得分修正。球衣来自 FPL 官方，Draft 无队长加倍。'
    : '按所选 GW 最终 Draft 得分选出的最佳阵容；该轮结束后保留结果。球衣来自 FPL 官方，Draft 无队长加倍。';
  if (!pending) $('#dreamTeamNote').textContent += dt.players?.length && dt.players.every(player => player.ownershipStatus === 'owned' || player.ownershipStatus === 'free')
    ? ` 归属按 GW${gwNum} 截止时的完整阵容锁定，不随后续交易改变。`
    : ' 历史归属尚未完整确认，不使用当前归属代替。';
  $('#dreamTeamPitch').classList.toggle('is-empty', !dt.players?.length);
  if (!dt.players?.length) {
    $('#dreamTeamPitch').innerHTML = perspectiveFieldHtml() + '<div class="pitch-empty">本轮比赛数据尚未产生<br>开赛后自动更新最佳阵容</div>';
    return;
  }
  const rows = { GKP: [], DEF: [], MID: [], FWD: [] };
  (dt.players || []).forEach((p) => rows[p.pos] && rows[p.pos].push(p));
  const order = ['GKP', 'DEF', 'MID', 'FWD'];
  $('#dreamTeamPitch').innerHTML = perspectiveFieldHtml() + order.map((pos) => {
    if (!rows[pos].length) return '';
    return `<div class="pitch-row pitch-row-${pos.toLowerCase()}">${rows[pos].map((p) => {
      const isFree = p.ownershipStatus === 'free';
      const owner = p.ownershipStatus === 'owned' && p.ownerName ? p.ownerName : isFree ? '自由球员' : '归属待确认';
      const kitSrc = kitUrl(p);
      return `
        <div class="dt-card" title="${esc(p.teamName || p.team)} · ${p.pos}">
          <div class="dt-kit ${kitSrc ? '' : 'kit-error'}">
            ${kitSrc ? `<img class="dt-kit-img" src="${kitSrc}" alt="${esc(p.teamName || p.team)} ${p.pos === 'GKP' ? '门将' : '主场'}球衣" loading="lazy" decoding="async" />` : ''}
            <span class="dt-kit-fallback pos-photo-${p.pos}">${esc(initialOf(p.team || p.name))}</span>
          </div>
          <div class="dt-nameplate">
            <div class="dt-name" title="${esc(p.name)}">${esc(p.name)}</div>
            <div class="dt-score"><strong>${p.gwPoints}</strong> 分</div>
          </div>
          <div class="dt-meta">${esc(p.team)} · ${p.pos}</div>
          <div class="dt-owner ${isFree ? 'free' : ''}" title="${esc(owner)}">${esc(owner)}</div>
        </div>`;
    }).join('')}</div>`;
  }).join('');
  bindKitFallbacks('#dreamTeamPitch .dt-kit-img', '.dt-kit');
}

function perspectiveFieldHtml() {
  return FPLPitch.html();
}

/* ================= Tab 2: Trade Center ================= */
/* 交易动态列表（按玩家分组）——战报页与交易中心共用渲染 */
function txPlayers(t, side) {
  const plural = side === 'in' ? t.playersIn : t.playersOut;
  const single = side === 'in' ? t.playerIn : t.playerOut;
  return plural?.length ? plural : single ? [single] : [];
}
function txPlayerNames(t, side) {
  const names = txPlayers(t, side).map((p) => p.name).filter(Boolean);
  if (names.length) return names.join('、');
  const fallback = side === 'in' ? t.elementIn : t.elementOut;
  return fallback != null ? `#${fallback}` : '—';
}
function txKindLabel(kind) {
  if (kind === 't') return '交易';
  if (kind === 'f') return '自由签约';
  return 'Waiver';
}
function txGroupsHtml(txs) {
  const byManager = new Map();
  txs.forEach((t) => {
    if (!byManager.has(t.entryId)) byManager.set(t.entryId, []);
    byManager.get(t.entryId).push(t);
  });
  return Array.from(byManager.entries()).map(([entryId, list]) => {
    const m = managerByEntry(entryId);
    return `
      <div class="tx-group">
        <div class="tx-group-head">
          <span class="tx-manager">${managerMark(m?.entryName)}${esc(m ? m.entryName : `#${entryId}`)}</span>
          <span class="tx-count">${list.length} 笔操作</span>
        </div>
        <div class="tx-rows">${list.map((t) => {
          const denied = t.result !== 'a';
          const pIn = txPlayers(t, 'in')[0] || null;
          const detail = t.kind === 't' && t.counterparty
            ? `与 ${esc(t.counterparty)} 完成交易`
            : pIn ? `form ${fmt1(pIn.form)} · PPG ${fmt1(pIn.ppg)} · ${fmtM(pIn.nowCost)}` : '';
          return `
            <div class="tx-row">
              <span class="tx-kind kind-${t.kind}">${txKindLabel(t.kind)}</span>
              <span class="tx-in">+ ${esc(txPlayerNames(t, 'in'))}</span>
              <span class="tx-arrow">←</span>
              <span class="tx-out">− ${esc(txPlayerNames(t, 'out'))}</span>
              <span class="tx-meta">
                ${detail}
                ${denied ? ' · <span class="tx-status denied">未成交</span>' : ''}
              </span>
            </div>`;
        }).join('')}</div>
      </div>`;
  }).join('');
}

function renderTradeCenter() {
  const s = STATE.snap;
  const lastGw = s.meta.lastFinishedGw;
  const transactionGws = (s.transactions.all || [])
    .map((t) => Number(t.gw))
    .filter((gw) => Number.isFinite(gw) && gw > 0);
  const nextGw = s.meta.upcomingGw || lastGw + 1;
  // FPL may leave is_current on the just-finished GW for a while. Keep the
  // first unfinished GW available so transactions that take effect next round
  // always have a visible home in the trade center.
  const maxGw = Math.max(lastGw, s.meta.currentGw || lastGw, nextGw, ...transactionGws);
  if (STATE.txCenterGw == null || STATE.txCenterGw > maxGw || STATE.txCenterGw < 1) {
    STATE.txCenterGw = TIMELINE.defaultTradeGw(s.meta, maxGw);
  }

  // GW 下拉（最新在前）
  const sel = $('#tcTxGwSel');
  const opts = [];
  for (let gw = maxGw; gw >= 1; gw--) {
    const suffix = `（${TIMELINE.phase(s.meta, gw)}）`;
    opts.push(`<option value="${gw}">GW${gw}${suffix}</option>`);
  }
  sel.innerHTML = opts.join('');
  sel.value = String(STATE.txCenterGw);

  // 交易动态列表
  const all = (s.transactions.all || []).filter((t) => t.gw === STATE.txCenterGw);
  const doneCount = all.filter((t) => t.result === 'a').length;
  const btnAll = document.querySelector('#tcFilter [data-mode="all"]');
  const btnDone = document.querySelector('#tcFilter [data-mode="done"]');
  if (btnAll) btnAll.textContent = `所有交易 (${all.length})`;
  if (btnDone) btnDone.textContent = `已成交 (${doneCount})`;
  $$('#tcFilter .sort-btn').forEach((btn) =>
    btn.classList.toggle('active', btn.dataset.mode === STATE.txCenterFilter));
  const txs = STATE.txCenterFilter === 'done' ? all.filter((t) => t.result === 'a') : all;
  $('#tcTxLabel').textContent = `GW${STATE.txCenterGw} · ${txs.length} 笔`;
  if (!txs.length) {
    const hint = (STATE.txCenterFilter === 'done' && all.length)
      ? '该 GW 没有已成交的交易，可切换到「所有交易」查看被拒绝的提案'
      : '该 GW 暂无交易 / waiver 记录';
    $('#tcTxSummary').innerHTML = `<div class="tx-meta">${hint}</div>`;
  } else {
    $('#tcTxSummary').innerHTML = txGroupsHtml(txs);
  }

  renderTradeEval();
}

const signedPts = (n) => `${n > 0 ? '+' : ''}${n}`;

function renderTradeEval() {
  const s = STATE.snap;
  const G = TIMELINE.tradeEvalGw(s, STATE.txEvalGw);
  const returns = s.tradeReturns;
  const evalSel = $('#tcGwSel');
  const latest = TIMELINE.tradeEvalGw(s, null);
  const rounds = TIMELINE.tradeEvalRounds(s);
  const options = [`<option value="latest">自动 · ${latest ? `GW${latest}（最新有得分）` : '等待比赛得分'}</option>`];
  for (const gw of rounds) options.push(`<option value="${gw}">GW${gw}（${gw > latest ? '已有交易 · 待计分' : TIMELINE.phase(s.meta, gw)}）</option>`);
  evalSel.innerHTML = options.join('');
  evalSel.value = rounds.includes(Number(STATE.txEvalGw)) ? String(STATE.txEvalGw) : 'latest';
  const pointText = (n, signed = false) => Number.isFinite(n) ? (signed ? signedPts(n) : String(n)) : '—';
  const pointClass = (n) => n > 0 ? 'trade-return-positive' : n < 0 ? 'trade-return-negative' : 'trade-return-neutral';
  const empty = (message) => `<p class="trade-return-empty">${esc(message)}</p>`;
  $('#tcEvalLabel').textContent = G ? `GW${G} · ${TIMELINE.phase(s.meta, G)} · 只统计已成交` : '等待首轮比赛得分';
  $('#tcCurrentTitle').textContent = `${G ? `GW${G}` : '本轮'}交易收益／损失`;
  $('#tcCurrentLabel').textContent = G ? `GW${G}${TIMELINE.live(s.meta, G) ? ' · 实时' : s.meta.reportFinalizing && G === TIMELINE.reportGw(s.meta) ? ' · 待结算' : ''}` : '待开赛';
  const managerView = STATE.txHistoryView === 'managers';
  $$('#tcHistoryTabs [data-view]').forEach((button) => {
    const active = button.dataset.view === STATE.txHistoryView;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  $('#tcHistoryReturns').setAttribute('aria-labelledby', managerView ? 'tcHistoryManagersTab' : 'tcHistoryPlayersTab');
  $('#tcHistoryIntro').textContent = managerView
    ? '汇总每位经理的交易净收益，只计算各次交易生效的那一轮。'
    : '按每名引援持有期间的累计得分，从高到低排列。';
  $('#tcHistoryNameHead').textContent = managerView ? '经理 / 交易操作' : '引援球员 / 所属经理';
  $('#tcHistoryScoreHead').textContent = managerView ? '累计净收益' : '累计收益';
  $('#tcHistoryNote').textContent = managerView
    ? '每轮换入得分 − 换出得分，再按经理累计；不计入交易生效后的其他轮次。同轮中转相互抵消，直接交易按双方视角计算。按交易收益卡片所选轮次回看。'
    : '从交易生效 GW 起累计，转出生效 GW 起停止；重新买入单独计算。按交易收益卡片所选轮次回看，不计入其后的得分。';

  // A cached pre-upgrade snapshot has no new return data. Do not invent zeros.
  if (!returns || returns.version !== 1) {
    $('#tcCurrentSummary').innerHTML = '';
    $('#tcCurrentReturns').innerHTML = empty('交易收益数据尚未更新，将随下一次数据同步显示。');
    $('#tcHistoryLabel').textContent = '等待同步';
    $('#tcHistoryReturns').innerHTML = empty('历史引援排行将在收益数据同步后显示。');
    return;
  }

  const throughGw = Math.min(G, latest);
  const pending = G === 0 || G > latest;
  const current = returns.currentByGw?.[G];
  const managers = (current?.rows || []).map(row => pending ? {
    ...row, pending: true, complete: false, inPoints: null, outPoints: null, net: null,
  } : row);
  const metric = (label, value, color) => `<div class="trade-return-metric"><span>${label}</span><strong class="${color}">${pointText(value, true)}</strong></div>`;
  const summary = pending ? { gains: null, losses: null, net: null } : current || { gains: 0, losses: 0, net: 0 };
  $('#tcCurrentSummary').innerHTML = metric('收益合计 / 分', summary.gains, 'trade-return-positive')
    + metric('损失合计 / 分', summary.losses, 'trade-return-negative')
    + metric('净收益 / 分', summary.net, pointClass(summary.net));

  if (!G) {
    $('#tcCurrentSummary').innerHTML = '';
    $('#tcCurrentReturns').innerHTML = empty('尚无比赛得分，成交记录可在下方按 GW 查看。');
    $('#tcHistoryLabel').textContent = '等待开赛';
    $('#tcHistoryReturns').innerHTML = empty('比赛产生得分后显示历史引援收益。');
    return;
  }
  const warning = pending
    ? `<p class="trade-return-warning">GW${G} 尚未产生比赛得分，先展示已成交操作；产生得分后自动更新收益／损失。</p>`
    : current?.missingCount
      ? `<p class="trade-return-warning">${current.missingCount} 位经理的部分球员得分暂缺，合计暂不显示；已知得分仍保留。</p>`
      : '';
  const contributionNames = (players, direction, row) => (players || []).map((player) => {
    const name = player.name || `#${player.id}`;
    // Scores are attached by the selected-GW ledger. Do not substitute a
    // player's current/season score, or divide a multi-player deal's net.
    const contribution = row.pending ? null : player.contribution;
    const label = Number.isFinite(contribution) ? `${pointText(contribution, true)} 分` : row.pending ? '待计分' : '—';
    const explanation = Number.isFinite(contribution)
      ? `GW${G} 球员得分 ${pointText(player.gwPoints)} 分；${direction === 'in' ? '换入计入' : '换出扣除'}，对净收益贡献 ${label}`
      : row.pending ? `GW${G} 尚未产生比赛得分` : Number.isFinite(player.gwPoints)
        ? `GW${G} 球员得分 ${player.gwPoints} 分；交易记录不完整，暂不计算净收益贡献`
        : `GW${G} 球员贡献分待同步`;
    return `<span class="trade-return-player" title="${esc(explanation)}"><span class="trade-return-player-name">${esc(name)}</span><b class="trade-return-player-points ${pointClass(contribution)}">（${label}）</b></span>`;
  }).join('');
  $('#tcCurrentReturns').innerHTML = warning + (managers.length ? managers.map((row, index) => {
    const inNames = contributionNames(row.playersIn, 'in', row);
    const outNames = contributionNames(row.playersOut, 'out', row);
    const activity = inNames || outNames
      ? `<p class="trade-return-movement"><span class="tx-in">换入</span><span class="trade-return-players">${inNames || '无'}</span></p><p class="trade-return-movement"><span class="tx-out">换出</span><span class="trade-return-players">${outNames || '无'}</span></p>`
      : '<p>同轮进出已抵消，无净阵容变化</p>';
    return `<div class="trade-return-row">
      <span class="trade-return-rank">${index + 1}</span>
      <div class="trade-return-copy"><strong>${managerMark(row.manager)}${esc(row.manager)}</strong>${activity}<p>${row.dealCount} 笔操作 · 换入 ${pointText(row.inPoints)} 分 / 换出 ${pointText(row.outPoints)} 分</p></div>
      <div class="trade-return-score ${pointClass(row.net)}"><b>${pointText(row.net, true)}</b><small>${row.pending ? '待计分' : row.complete ? '净收益 / 分' : '数据暂缺'}</small></div>
    </div>`;
  }).join('') : empty(!current && (s.transactions?.all || []).some(t => Number(t.gw) === G && t.result === 'a')
    ? `GW${G} 交易评价明细待同步，已成交记录可在下方查看。`
    : `GW${G} 暂无已成交操作${pending ? '，历史引援收益仍可在右侧查看' : '，本轮交易净收益为 0'}。`));

  $('#tcHistoryLabel').textContent = throughGw > 0
    ? `截至 GW${throughGw}${TIMELINE.live(s.meta, throughGw) ? ' · 实时' : ''}`
    : '等待开赛';
  if (managerView) {
    const ranking = returns.managerRankingByGw?.[throughGw];
    if (!ranking) {
      $('#tcHistoryReturns').innerHTML = empty('经理收益排名尚未更新，将随下一次数据同步显示。');
      return;
    }
    const missing = ranking.missingCount
      ? `<p class="trade-return-warning">${ranking.missingCount} 位经理有当轮得分或交易记录暂缺，暂不排名；已知部分单独标注。</p>` : '';
    $('#tcHistoryReturns').innerHTML = missing + (ranking.rows.length ? ranking.rows.map((row) => {
      const activity = `${row.dealCount} 笔操作 · ${row.scoredGwCount} 个计分轮次`;
      const totals = row.complete
        ? `收益 ${pointText(row.gains, true)} / 损失 ${pointText(row.losses, true)} 分`
        : `已知净收益 ${pointText(row.knownNet, true)} 分 · ${row.missingGwCount} 轮待补全`;
      return `<button type="button" class="trade-return-row trade-manager-detail-button" data-trade-manager="${Number(row.entryId)}" data-through-gw="${throughGw}" aria-haspopup="dialog" aria-label="查看${esc(row.manager)}截至 GW${throughGw} 的交易明细">
        <span class="trade-return-rank ${row.complete && row.rank <= 3 ? 'top' : ''}">${row.complete ? row.rank : '—'}</span>
        <span class="trade-return-copy"><strong>${managerMark(row.manager)}${esc(row.manager)}</strong><span class="trade-manager-line">${activity}</span><span class="trade-manager-line">${totals}</span><span class="trade-manager-hint">查看交易明细 ↗</span></span>
        <span class="trade-return-score ${pointClass(row.net)}"><b>${pointText(row.net, true)}</b><small>${row.complete ? row.dealCount ? '单轮净收益累计' : '暂无交易' : '数据暂缺'}</small></span>
      </button>`;
    }).join('') : empty('暂无可排名的经理。'));
    return;
  }
  // Derive the as-of ranking from the holding-period series, never future GWs.
  const history = (returns.acquisitions || []).map((item) => {
    const series = (item.series || []).filter((sample) => sample.gw <= throughGw);
    const complete = item.integrityComplete !== false && series.length > 0
      && series.every((sample) => Number.isFinite(sample.points));
    return { ...item, series, complete, asOfPoints: complete ? series.reduce((sum, sample) => sum + sample.points, 0) : null };
  }).filter((item) => item.fromGw <= throughGw && item.series.length)
    .sort((a, b) => Number(b.complete) - Number(a.complete)
      || (b.asOfPoints ?? 0) - (a.asOfPoints ?? 0)
      || a.fromGw - b.fromGw || String(a.id).localeCompare(String(b.id)));
  let rank = 0;
  let previousPoints = null;
  const historyMissing = history.filter((item) => !item.complete).length;
  const historyWarning = historyMissing
    ? `<p class="trade-return-warning">${historyMissing} 名引援的交易记录或历史得分不完整，暂不排名，列在榜单末尾。</p>` : '';
  $('#tcHistoryReturns').innerHTML = historyWarning + (history.length ? history.map((item, index) => {
    if (item.complete && item.asOfPoints !== previousPoints) rank = index + 1;
    previousPoints = item.asOfPoints;
    const last = item.series[item.series.length - 1].gw;
    const period = item.fromGw === last ? `GW${last}` : `GW${item.fromGw}–${last}`;
    const released = item.releasedGw != null && item.releasedGw <= throughGw;
    return `<div class="trade-return-row">
      <span class="trade-return-rank ${item.complete && rank <= 3 ? 'top' : ''}">${item.complete ? rank : '—'}</span>
      <div class="trade-return-copy"><strong>${esc(item.player?.name || `#${item.player?.id || '未知球员'}`)}</strong><p>${managerMark(item.manager)}${esc(item.manager)}</p><p>${period} · ${item.series.length} 个计分轮次${released ? ' · 已转出' : ''}</p></div>
      <div class="trade-return-score ${pointClass(item.asOfPoints)}"><b>${pointText(item.asOfPoints)}</b><small>${item.complete ? '累计得分' : '数据暂缺'}</small></div>
    </div>`;
  }).join('') : empty(throughGw > 0 ? `截至 GW${throughGw} 暂无已产生计分轮次的成交引援。` : '赛季尚未开赛，交易引援开始产生得分后显示排行。'));
}

$('#tcGwSel').addEventListener('change', (e) => {
  STATE.txEvalGw = e.target.value === 'latest' ? null : Number(e.target.value);
  renderTradeEval();
});

$('#tcTxGwSel').addEventListener('change', (e) => {
  STATE.txCenterGw = Number(e.target.value);
  renderTradeCenter();
});

function selectTradeHistoryView(view) {
  if (!['players', 'managers'].includes(view)) return;
  STATE.txHistoryView = view;
  if (STATE.snap) renderTradeEval();
}
$('#tcHistoryReturns').addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-trade-manager]');
  if (!trigger || !STATE.snap) return;
  window.TQLTradeDetails?.open({ snapshot: STATE.snap, entryId: Number(trigger.dataset.tradeManager),
    throughGw: Number(trigger.dataset.throughGw), trigger });
});
$('#tcHistoryTabs').addEventListener('click', (event) => {
  const button = event.target.closest('[data-view]');
  if (button) selectTradeHistoryView(button.dataset.view);
});
$('#tcHistoryTabs').addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const view = event.key === 'Home' ? 'players' : event.key === 'End' ? 'managers'
    : STATE.txHistoryView === 'players' ? 'managers' : 'players';
  selectTradeHistoryView(view);
  $(`#tcHistoryTabs [data-view="${view}"]`).focus();
});

$('#tcFilter').addEventListener('click', (e) => {
  const btn = e.target.closest('.sort-btn');
  if (!btn) return;
  $$('#tcFilter .sort-btn').forEach((b) => b.classList.toggle('active', b === btn));
  STATE.txCenterFilter = btn.dataset.mode;
  renderTradeCenter();
});

let gwTrendChart = null;
function renderGwTrend() {
  const s = STATE.snap;
  const hist = s.gwHistory.filter((g) => g.gw <= TIMELINE.reportGw(s.meta));
  const ctx = $('#gwTrendChart');

  // 填充玩家选择器（保留当前选中项）
  const sel = $('#trendPlayerSel');
  const prev = sel.value ?? '';
  sel.innerHTML = '<option value="">全联赛（最高 / 平均 / 最低）</option>' +
    s.managers.map((m) => `<option value="${m.entryId}">${esc(m.entryName)}</option>`).join('');
  sel.value = prev;
  if (sel.value !== (prev ?? '')) { sel.value = ''; STATE.trendEntryId = null; }

  let datasets;
  if (STATE.trendEntryId) {
    // 单玩家视图：该玩家每轮得分 + 联赛平均参考线
    const mgr = managerByEntry(Number(STATE.trendEntryId));
    if (!mgr) { STATE.trendEntryId = null; return renderGwTrend(); }
    const byGw = new Map((mgr.history || []).map((h) => [h.gw, h.points]));
    datasets = [
      {
        label: `${mgr.entryName} 每轮得分`,
        data: hist.map((g) => byGw.get(g.gw) ?? null),
        borderColor: CHART_PRIMARY, backgroundColor: SCOUT_WORKSPACE ? 'rgba(79,126,78,.08)' : 'rgba(0,255,135,.14)',
        tension: .35, fill: true, pointRadius: 4, pointHoverRadius: 6, borderWidth: 2.5,
      },
      {
        label: '联赛平均', data: hist.map((g) => g.average),
        borderColor: CHART_SECONDARY, borderDash: [6, 4], tension: .35, pointRadius: 2, borderWidth: 1.5,
      },
    ];
  } else {
    datasets = [
      {
        label: '最高分', data: hist.map((g) => g.highest),
        borderColor: CHART_PRIMARY, backgroundColor: SCOUT_WORKSPACE ? 'rgba(79,126,78,.08)' : 'rgba(0,255,135,.12)',
        tension: .35, fill: true, pointRadius: 4,
      },
      {
        label: '平均分', data: hist.map((g) => g.average),
        borderColor: CHART_SECONDARY, borderDash: [6, 4], tension: .35, pointRadius: 3,
      },
      {
        label: '最低分', data: hist.map((g) => g.lowest),
        borderColor: SCOUT_WORKSPACE ? '#bd788a' : '#ff5c72', borderDash: [6, 4], tension: .35, pointRadius: 3,
      },
    ];
  }

  if (gwTrendChart) gwTrendChart.destroy();
  gwTrendChart = new Chart(ctx, {
    type: 'line',
    data: { labels: hist.map((g) => `GW${g.gw}`), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: CHART_TEXT, boxWidth: 14 } } },
      scales: {
        x: { ticks: { color: CHART_FAINT }, grid: { color: CHART_GRID } },
        y: { ticks: { color: CHART_FAINT }, grid: { color: CHART_GRID } },
      },
    },
  });
}

$('#trendPlayerSel').addEventListener('change', (e) => {
  STATE.trendEntryId = e.target.value ? Number(e.target.value) : null;
  renderGwTrend();
});

/* ================= Tab 2: Standings ================= */
function renderStandings() {
  const s = STATE.snap;
  const classic = s.meta.scoring === 'c';
  const reportGw = TIMELINE.reportGw(s.meta);
  const live = Boolean(s.meta.standingsLive);
  $('#standingsLiveLabel').textContent = `GW${reportGw} · ${live ? '实时积分' : s.meta.reportFinalizing ? '已完赛 · 待官方结算' : '已结算'}`;
  $('#standingsLiveHead').textContent = `GW${reportGw} 分`;
  $('#standingsProjectedHead').textContent = forecastLabel();
  $('#standingsNote').textContent = live
    ? '实时积分按本轮当前比分暂计胜／平／负，未完赛排名会变化；不计队长倍数。累计得分仅计入本轮一次，点击玩家查看阵容。'
    : '按已完赛结果排名 · 点击任意玩家查看阵容 · 价值按经典 FPL 市场价合计';
  if (s.meta.autoSubsProvisional) $('#standingsNote').textContent += ' 本轮得分含按规则预判的自动替补，最终以官方结算为准。';
  $('#standingsScoreHead').textContent = classic ? '总分' : 'H2H';
  $('#standingsRecordHead').textContent = classic ? '计分制' : 'W-D-L';
  $('#standingsForHead').textContent = classic ? '价值排名' : '得分';
  $('#standingsAgainstHead').textContent = classic ? '预计排名' : '失分';
  const key = STATE.standingsSort;
  const rows = [...s.managers].sort((a, b) => {
    if (key === 'rank') return (a.rank || 99) - (b.rank || 99);
    return (b[key] || 0) - (a[key] || 0);
  });
  $('#standingsBody').innerHTML = rows.map((m) => {
    const rankShown = key === 'rank' ? m.rank : (key === 'squadValue' ? m.valueRank : key === 'projected' ? m.projectedRank : m.rank);
    const trend = m.rank && m.lastRank ? m.rank - m.lastRank : 0;
    const trendHtml = trend === 0
      ? '<span class="trend-flat">·</span>'
      : `<span class="${trend < 0 ? 'trend-up' : 'trend-down'}">${trend < 0 ? '▲' : '▼'}${Math.abs(trend)}</span>`;
    return `
      <tr data-entry="${m.entryId}" tabindex="0" role="button" aria-haspopup="dialog" aria-label="查看 ${esc(m.entryName)} 的阵容">
        <td class="ta-c rank-cell"><span class="night-rank ${rankShown != null && rankShown <= 3 ? 'is-leading' : ''}">${rankShown ?? '—'}</span>${trendHtml}</td>
        <td>
          <div class="team-cell">
            <span class="team-name">${managerMark(m.entryName)}${esc(m.entryName)}</span>
            <span class="team-manager">${esc(m.playerName)}</span>
          </div>
        </td>
        <td class="ta-c"><b>${m.total ?? '-'}</b></td>
        <td class="ta-c" style="color:var(--text-dim)">${classic ? 'Classic' : `${m.matchesWon}-${m.matchesDrawn}-${m.matchesLost}`}</td>
        <td class="ta-r live-points">${m.reportGwPoints ?? m.history?.find((h) => h.gw === reportGw)?.points ?? '—'}</td>
        <td class="ta-r" style="color:var(--accent)">${classic ? (m.valueRank ?? '—') : m.pointsFor}</td>
        <td class="ta-r" style="color:var(--red)">${classic ? (m.projectedRank ?? '—') : m.pointsAgainst}</td>
        <td class="ta-r">${fmtM(m.squadValue)}</td>
        <td class="ta-r">${fmt1(m.projected)}</td>
        <td class="ta-c">${formDots(m.history)}</td>
      </tr>`;
  }).join('');
}

$('#standingsSort').addEventListener('click', (e) => {
  const btn = e.target.closest('.sort-btn');
  if (!btn) return;
  STATE.standingsSort = btn.dataset.sort;
  $$('#standingsSort .sort-btn').forEach((b) => b.classList.toggle('active', b === btn));
  renderStandings();
});

/* squad modal */
$('#standingsBody').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-entry]');
  if (!tr) return;
  openSquadModal(Number(tr.dataset.entry));
});
$('#standingsBody').addEventListener('keydown', (e) => {
  const tr = e.target.closest('tr[data-entry]');
  if (!tr || !['Enter', ' '].includes(e.key)) return;
  e.preventDefault();
  openSquadModal(Number(tr.dataset.entry));
});
let squadModalOpener = null;
let squadModalBodyOverflow = '';
function closeSquadModal() {
  const entryId = STATE.squadEntryId;
  $('#squadModal').classList.remove('open');
  STATE.squadEntryId = null;
  document.body.style.overflow = squadModalBodyOverflow;
  const opener = squadModalOpener?.isConnected ? squadModalOpener : $(`#standingsBody tr[data-entry="${entryId}"]`);
  opener?.focus();
}
$('#squadModalClose').addEventListener('click', closeSquadModal);
$('#squadModal').addEventListener('click', (e) => {
  if (e.target === $('#squadModal')) closeSquadModal();
});
$('#squadModal').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeSquadModal();
  } else if (e.key === 'Tab') {
    // This read-only dialog has a single interactive control.
    e.preventDefault();
    $('#squadModalClose').focus();
  }
});

function managerSquadHtml(m, meta) {
  const reportGw = TIMELINE.reportGw(meta);
  const scoreLabel = reportGw > 0 ? `GW${reportGw}` : '本轮';
  const scoresNote = reportGw > 0
    ? `球员下方为 ${scoreLabel} 实际得分与赛季总分${TIMELINE.live(meta, reportGw) ? '，本轮分数仍在更新' : ''}。`
    : '本赛季尚未开赛，得分显示「—」。';
  return `
    <div class="manager-view-summary">
      <span>联赛排名 <b>${m.rank != null ? `#${m.rank}` : '—'}</b></span>
      <span>阵容价值 <b>${fmtM(m.squadValue)}</b></span>
      <span>近 5 轮场均 <b>${m.formAvg != null ? fmt1(m.formAvg) : '—'}</b></span>
    </div>
    <p class="manager-view-context">${esc(m.lineupNote || '当前持有阵容 · 首发／替补参考最近公开阵容，截止前调整官方暂不公开。')}</p>
    <p class="manager-view-score-note">${scoresNote}交易后球员的本轮得分不等于本队实际获得的积分。${reportGw > 0 ? '本轮分已包含官方 DEFCON 与奖励分。' : ''}</p>
    ${squadPitchSideHtml(m, { summary: false, scoreLabel, scoreKey: reportGw > 0 ? 'liveGwPoints' : null, managerView: true })}`;
}

function renderSquadModal(entryId) {
  const m = managerByEntry(entryId);
  if (!m) return;
  $('#squadModalTitle').innerHTML = `${esc(m.entryName)} <span class="manager-view-subtitle">${esc(m.playerName)}</span>`;
  const scrollTop = $('#squadModalBody').scrollTop;
  $('#squadModalBody').innerHTML = managerSquadHtml(m, STATE.snap.meta);
  $('#squadModalBody').scrollTop = scrollTop;
  bindKitFallbacks('#squadModalBody .cmp-kit-img', '.cmp-kit');
}

function openSquadModal(entryId) {
  if (!managerByEntry(entryId)) return;
  if (STATE.squadEntryId == null) {
    squadModalOpener = document.activeElement;
    squadModalBodyOverflow = document.body.style.overflow;
  }
  STATE.squadEntryId = entryId;
  renderSquadModal(entryId);
  $('#squadModalBody').scrollTop = 0;
  $('#squadModal').classList.add('open');
  document.body.style.overflow = 'hidden';
  $('#squadModalClose').focus();
}

/* ================= Tab 4: Free agents ================= */
const FREE_AGENT_PAGE_SIZE = 50;
const FREE_STATUS = {
  a: { label: '可出场', cls: 'available' },
  d: { label: '存疑', cls: 'doubtful' },
  i: { label: '伤病', cls: 'injured' },
  s: { label: '停赛', cls: 'suspended' },
  u: { label: '不可用', cls: 'unavailable' },
};

function isUnowned(player) {
  return player && player.owner == null && !player.inAcceptedTrade;
}

function matchesFreeAgentStatus(player, mode) {
  if (mode === 'all') return true;
  if (mode === 'available') return player.status === 'a';
  if (mode === 'risk') return ['d', 'i', 's'].includes(player.status);
  return player.status !== 'u';
}

function renderFreeAgentTeamOptions() {
  const select = $('#freeAgentTeam');
  if (!select) return;
  const teams = [...new Map((STATE.snap.players || [])
    .filter(isUnowned)
    .map((player) => [player.team, player.teamName || player.team]))]
    .sort((a, b) => a[1].localeCompare(b[1], 'en'));
  select.innerHTML = '<option value="">全部球队</option>'
    + teams.map(([code, name]) => `<option value="${esc(code)}">${esc(name)}</option>`).join('');
  if (teams.some(([code]) => code === STATE.freeAgentTeam)) select.value = STATE.freeAgentTeam;
  else STATE.freeAgentTeam = '';
}

function freeAgentStatusHtml(player) {
  const status = FREE_STATUS[player.status] || { label: player.status || '未知', cls: 'unavailable' };
  const chance = player.chanceNext != null && player.status !== 'a' ? ` ${player.chanceNext}%` : '';
  const news = player.news ? ` title="${esc(player.news)}"` : '';
  return `<span class="fa-status ${status.cls}"${news}>${status.label}${chance}</span>`;
}

function renderFreeAgentKpis(players) {
  const by = (key) => [...players].sort((a, b) => Number(b[key] || 0) - Number(a[key] || 0))[0] || null;
  const nextBest = by('epNext');
  const formBest = by('form');
  const pointsBest = by('totalPoints');
  const risks = players.filter((p) => ['d', 'i', 's'].includes(p.status)).length;
  $('#freeAgentKpis').innerHTML = `
    <div class="kpi"><div class="kpi-label">当前可签球员</div><div class="kpi-value">${players.length}</div><div class="kpi-extra">不含已离队 / 不可用</div></div>
    <div class="kpi k-blue"><div class="kpi-label">${forecastLabel()}最高</div><div class="kpi-value">${fmt1(nextBest?.epNext)}</div><div class="kpi-extra">${esc(nextBest?.name || '—')} · ${esc(nextBest?.team || '')}</div></div>
    <div class="kpi k-purple"><div class="kpi-label">近期状态最佳</div><div class="kpi-value">${fmt1(formBest?.form)}</div><div class="kpi-extra">${esc(formBest?.name || '—')} · Form</div></div>
    <div class="kpi k-orange"><div class="kpi-label">赛季得分最高</div><div class="kpi-value">${pointsBest?.totalPoints ?? '—'}</div><div class="kpi-extra">${esc(pointsBest?.name || '—')} · 总分</div></div>
    <div class="kpi k-red"><div class="kpi-label">伤停或存疑</div><div class="kpi-value">${risks}</div><div class="kpi-extra">签约前建议查看状态</div></div>`;
}

function renderFreeAgents() {
  if (!STATE.snap || !$('#freeAgentBody')) return;
  $('#freeAgentSort [data-sort="epNext"]').textContent = forecastLabel();
  const players = (STATE.snap.players || []).filter(isUnowned);
  const signable = players.filter((player) => player.status !== 'u');
  renderFreeAgentKpis(signable);

  const q = normTxt(STATE.freeAgentSearch);
  const withoutPosition = players.filter((player) => {
    if (!matchesFreeAgentStatus(player, STATE.freeAgentStatus)) return false;
    if (STATE.freeAgentTeam && player.team !== STATE.freeAgentTeam) return false;
    if (!q) return true;
    return normTxt(`${player.name} ${player.fullName} ${player.team} ${player.teamName}`).includes(q);
  });
  const positionCounts = withoutPosition.reduce((counts, player) => {
    counts[player.pos] = (counts[player.pos] || 0) + 1;
    return counts;
  }, {});
  $$('#freeAgentPos .sort-btn').forEach((button) => {
    const count = button.dataset.pos ? (positionCounts[button.dataset.pos] || 0) : withoutPosition.length;
    button.textContent = `${button.dataset.label} ${count}`;
    button.classList.toggle('active', button.dataset.pos === STATE.freeAgentPos);
  });

  const filtered = withoutPosition
    .filter((player) => !STATE.freeAgentPos || player.pos === STATE.freeAgentPos)
    .sort((a, b) => {
      const key = STATE.freeAgentSort;
      const valueDiff = Number(b[key] || 0) - Number(a[key] || 0);
      return valueDiff || Number(b.totalPoints || 0) - Number(a.totalPoints || 0)
        || a.name.localeCompare(b.name, 'en');
    });
  const totalPages = Math.max(1, Math.ceil(filtered.length / FREE_AGENT_PAGE_SIZE));
  STATE.freeAgentPage = Math.min(Math.max(1, STATE.freeAgentPage), totalPages);
  const start = (STATE.freeAgentPage - 1) * FREE_AGENT_PAGE_SIZE;
  const pagePlayers = filtered.slice(start, start + FREE_AGENT_PAGE_SIZE);
  const reportGw = TIMELINE.reportGw(STATE.snap.meta);
  const nextGw = STATE.snap.meta.upcomingGw || reportGw + 1;
  $('#freeLastGwHead').textContent = reportGw ? `GW${reportGw}` : '本轮';
  $('#freeNextGwHead').textContent = `GW${nextGw}预计`;
  $('#freeAgentLabel').textContent = `· ${filtered.length} 人`;

  $('#freeAgentBody').innerHTML = pagePlayers.length ? pagePlayers.map((player) => {
    const kit = kitUrl(player);
    const xgi90 = Number(player.xg90 || 0) + Number(player.xa90 || 0);
    return `
      <tr>
        <td>
          <div class="fa-player">
            <div class="fa-kit">
              ${kit ? `<img class="fa-kit-img" src="${kit}" alt="${esc(player.teamName)} 球衣" loading="lazy" />` : ''}
              <span class="fa-kit-fallback pos-photo-${player.pos}">${esc(initialOf(player.name))}</span>
            </div>
            <div class="fa-player-copy">
              <strong>${esc(player.name)}</strong>
              <span>${esc(player.teamName || player.team)}</span>
            </div>
          </div>
        </td>
        <td class="ta-c"><span class="pos-pill pos-${player.pos}">${player.pos}</span></td>
        <td>${freeAgentStatusHtml(player)}</td>
        <td class="ta-r">${fmtM(player.nowCost)}</td>
        <td class="ta-r">${player.liveGwPoints ?? (reportGw === STATE.snap.meta.lastFinishedGw ? player.lastGwPoints : null) ?? '—'}</td>
        <td class="ta-r"><b>${player.totalPoints ?? 0}</b></td>
        <td class="ta-r">${fmt1(player.form)}</td>
        <td class="ta-r">${fmt1(player.ppg)}</td>
        <td class="ta-r">${fmt1(xgi90)}</td>
        <td class="ta-r fa-ep"><b>${fmt1(player.epNext)}</b></td>
        <td class="ta-r">${player.minutes ?? 0}</td>
      </tr>`;
  }).join('') : `<tr><td colspan="11"><div class="fa-empty">没有符合当前条件的自由球员</div></td></tr>`;
  bindKitFallbacks('#freeAgentBody .fa-kit-img', '.fa-kit');

  $('#freeAgentPager').innerHTML = `
    <button class="btn btn-ghost" data-page="prev" ${STATE.freeAgentPage <= 1 ? 'disabled' : ''}>上一页</button>
    <span>第 ${STATE.freeAgentPage} / ${totalPages} 页 · 显示 ${pagePlayers.length} 人</span>
    <button class="btn btn-ghost" data-page="next" ${STATE.freeAgentPage >= totalPages ? 'disabled' : ''}>下一页</button>`;
}

function resetFreeAgentPage() {
  STATE.freeAgentPage = 1;
  renderFreeAgents();
}

$('#freeAgentSearch').addEventListener('input', (event) => {
  STATE.freeAgentSearch = event.target.value.trim();
  resetFreeAgentPage();
});
$('#freeAgentTeam').addEventListener('change', (event) => {
  STATE.freeAgentTeam = event.target.value;
  resetFreeAgentPage();
});
$('#freeAgentStatus').addEventListener('change', (event) => {
  STATE.freeAgentStatus = event.target.value;
  resetFreeAgentPage();
});
$('#freeAgentPos').addEventListener('click', (event) => {
  const button = event.target.closest('.sort-btn[data-pos]');
  if (!button) return;
  STATE.freeAgentPos = button.dataset.pos;
  resetFreeAgentPage();
});
$('#freeAgentSort').addEventListener('click', (event) => {
  const button = event.target.closest('.sort-btn[data-sort]');
  if (!button) return;
  STATE.freeAgentSort = button.dataset.sort;
  $$('#freeAgentSort .sort-btn').forEach((item) => item.classList.toggle('active', item === button));
  resetFreeAgentPage();
});
$('#freeAgentPager').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-page]');
  if (!button || button.disabled) return;
  STATE.freeAgentPage += button.dataset.page === 'next' ? 1 : -1;
  renderFreeAgents();
  $('#tab-freeagents').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ================= Tab 5: Squad share ================= */
const SHARE_SITE_ORIGIN = 'https://fftql.team';
const SHARE_POS_LABEL = { GKP: '门将', DEF: '后卫', MID: '中场', FWD: '前锋' };
const SHARE_TEAM_COLORS = {
  ARS: ['#e30613', '#ffffff'], AVL: ['#95bfe5', '#670e36'], BOU: ['#d71920', '#111111'],
  BRE: ['#e30613', '#ffffff'], BHA: ['#0057b8', '#ffffff'], BUR: ['#6c1d45', '#8fd2f4'],
  CHE: ['#034694', '#ffffff'], COV: ['#69b3e7', '#ffffff'], CRY: ['#1b458f', '#c4122e'],
  EVE: ['#003399', '#ffffff'], FUL: ['#ffffff', '#111111'], HUL: ['#f5a12d', '#111111'],
  IPS: ['#005daa', '#ffffff'], LEE: ['#ffffff', '#1d428a'], LEI: ['#003090', '#fdbb30'],
  LIV: ['#c8102e', '#ffffff'], MCI: ['#6cabdd', '#ffffff'], MUN: ['#da291c', '#111111'],
  NEW: ['#111111', '#ffffff'], NFO: ['#dd0000', '#ffffff'], SOU: ['#d71920', '#ffffff'],
  SUN: ['#eb172b', '#ffffff'], TOT: ['#ffffff', '#132257'], WHU: ['#7a263a', '#1bb1e7'],
  WOL: ['#fdb913', '#231f20'],
};
const SHARE_QR_STATE = { url: '', image: null, loading: false, failed: false, promise: null };

function shareManager() {
  return managerByEntry(STATE.shareEntryId);
}

function shareStorageKey(entryId = STATE.shareEntryId) {
  return `fpl-share-locks:${STATE.snap?.meta?.leagueId || 'default'}:${entryId || 'none'}`;
}

function loadShareLocks(entryId) {
  let stored = [];
  try {
    stored = JSON.parse(localStorage.getItem(shareStorageKey(entryId)) || '[]');
  } catch (e) { stored = []; }
  const validIds = new Set((managerByEntry(entryId)?.picks || []).map((pick) => Number(pick.player.id)));
  STATE.shareLockedIds = new Set(stored.map(Number).filter((id) => validIds.has(id)));
  STATE.shareLoadedEntryId = entryId;
}

function saveShareLocks() {
  try {
    localStorage.setItem(shareStorageKey(), JSON.stringify([...STATE.shareLockedIds]));
  } catch (e) { /* storage unavailable */ }
}

function shareUrl() {
  const leagueId = STATE.snap?.meta?.leagueId;
  return `${SHARE_SITE_ORIGIN}/${leagueId ? `?league=${leagueId}` : ''}#share`;
}

function getShareQrImage() {
  const url = shareUrl();
  if (SHARE_QR_STATE.url !== url) {
    Object.assign(SHARE_QR_STATE, { url, image: null, loading: false, failed: false, promise: null });
  }
  if (SHARE_QR_STATE.image || SHARE_QR_STATE.loading || SHARE_QR_STATE.failed) return SHARE_QR_STATE.image;
  SHARE_QR_STATE.loading = true;
  SHARE_QR_STATE.promise = TQLNightShare.qr(url).then(image => {
    if (SHARE_QR_STATE.url !== url) return;
    Object.assign(SHARE_QR_STATE, { image, loading: false, failed: !image });
    renderShareCanvas();
  });
  return null;
}

function initShare() {
  if (!STATE.snap || !$('#shareEntrySelect')) return;
  const managers = STATE.snap.managers || [];
  $('#shareEntrySelect').innerHTML = managers
    .map((m) => `<option value="${m.entryId}">${esc(m.entryName)}</option>`).join('');
  if (!managerByEntry(STATE.shareEntryId)) STATE.shareEntryId = getMyEntryId() || managers[0]?.entryId || null;
  $('#shareEntrySelect').value = STATE.shareEntryId ?? '';
  $('#shareMessage').value = STATE.shareMessage;
  if (STATE.shareLoadedEntryId !== STATE.shareEntryId) loadShareLocks(STATE.shareEntryId);
  renderShare();
}

function sharePlayerHtml(pick) {
  const player = pick.player;
  const locked = STATE.shareLockedIds.has(Number(player.id));
  const shirt = kitUrl(player);
  return `
    <button class="share-player-card ${locked ? 'locked' : 'tradable'}" type="button"
      data-player-id="${player.id}" aria-pressed="${locked}" title="点击切换交易状态">
      <span class="share-kit ${shirt ? '' : 'kit-error'}">
        ${shirt ? `<img class="share-kit-img" src="${shirt}" alt="${esc(player.teamName || player.team)} 球衣" loading="lazy" />` : ''}
        <span class="share-kit-fallback pos-photo-${player.pos}">${esc(initialOf(player.team || player.name))}</span>
        ${locked ? '<span class="share-lock-badge">非卖</span>' : ''}
      </span>
      <span class="share-player-name" title="${esc(player.name)}">${esc(player.name)}</span>
      <span class="share-player-score"><b>${player.lastGwPoints ?? '—'}</b> 上轮&nbsp;·&nbsp;<b>${player.totalPoints ?? '—'}</b> 总分</span>
    </button>`;
}

function renderShare() {
  const manager = shareManager();
  if (!manager) return;
  const sorted = [...(manager.picks || [])].sort((a, b) => a.position - b.position);
  const starters = sorted.filter((pick) => pick.position <= 11);
  const bench = sorted.filter((pick) => pick.position > 11);
  const groups = { FWD: [], MID: [], DEF: [], GKP: [] };
  starters.forEach((pick) => groups[pick.player.pos]?.push(pick));
  const formation = ['DEF', 'MID', 'FWD'].map((pos) => groups[pos].length).join('-');
  $('#shareSquadGrid').innerHTML = `
    <div class="share-pitch-meta">
      <span>首发阵容 · ${esc(formation)}</span>
      <small>点击球衣切换交易状态</small>
    </div>
    <div class="share-pitch-scroll">
      <div class="share-editor-pitch">
        ${perspectiveFieldHtml()}
        ${['GKP', 'DEF', 'MID', 'FWD'].map((pos) => `
          <div class="share-pitch-row share-pitch-row-${pos.toLowerCase()}" aria-label="${SHARE_POS_LABEL[pos]}">
            ${groups[pos].map(sharePlayerHtml).join('')}
          </div>`).join('')}
      </div>
      <div class="share-bench-area">
        <div class="share-bench-head"><span>替补席</span><small>${bench.length} 人</small></div>
        <div class="share-bench-row">${bench.map(sharePlayerHtml).join('')}</div>
      </div>
    </div>`;
  bindKitFallbacks('#shareSquadGrid .share-kit-img', '.share-kit');
  const lockedCount = STATE.shareLockedIds.size;
  const total = manager.picks?.length || 0;
  $('#shareSummary').textContent = `${manager.entryName} · ${lockedCount} 名非卖品 · ${Math.max(0, total - lockedCount)} 名可以谈。${manager.lineupNote || '位置参考最近公开阵容，截止前调整官方暂不公开。'}`;
  renderShareCanvas();
}

function roundedCanvasRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function fillRoundedCanvasRect(ctx, x, y, width, height, radius, color) {
  roundedCanvasRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = color;
  ctx.fill();
}

function fitCanvasText(ctx, text, maxWidth) {
  const value = String(text || '—');
  if (ctx.measureText(value).width <= maxWidth) return value;
  let short = value;
  while (short.length > 1 && ctx.measureText(`${short}…`).width > maxWidth) short = short.slice(0, -1);
  return `${short}…`;
}

function drawShareJersey(ctx, x, y, team, goalkeeper = false) {
  const [primary, secondary] = goalkeeper
    ? ['#f2c94c', '#222222']
    : (SHARE_TEAM_COLORS[team] || ['#22a06b', '#ffffff']);
  ctx.save();
  ctx.translate(x, y);
  ctx.shadowColor = 'rgba(10, 35, 26, .16)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 5;
  ctx.beginPath();
  ctx.moveTo(-24, -31);
  ctx.lineTo(-49, -17);
  ctx.lineTo(-38, 9);
  ctx.lineTo(-27, 3);
  ctx.lineTo(-25, 35);
  ctx.lineTo(25, 35);
  ctx.lineTo(27, 3);
  ctx.lineTo(38, 9);
  ctx.lineTo(49, -17);
  ctx.lineTo(24, -31);
  ctx.quadraticCurveTo(0, -16, -24, -31);
  ctx.closePath();
  ctx.fillStyle = primary;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = secondary;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-18, -29);
  ctx.quadraticCurveTo(0, -12, 18, -29);
  ctx.stroke();
  ctx.restore();
}

const SHARE_KIT_IMAGES = new Map();
const SHARE_BRAND_URL = '/brand/tql-badge-preview-v47.png?v=47';
const SHARE_BRAND_STATE = { image: null, promise: null };

function loadShareBrandImage() {
  const ready = typeof document !== 'undefined' && Array.from(document.images || []).find(image =>
    image.getAttribute('src') === SHARE_BRAND_URL && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
  if (ready) {
    SHARE_BRAND_STATE.image = ready;
    return (SHARE_BRAND_STATE.promise = Promise.resolve(ready));
  }
  if (SHARE_BRAND_STATE.promise) return SHARE_BRAND_STATE.promise;
  SHARE_BRAND_STATE.promise = new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (loaded) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      image.onload = image.onerror = null;
      SHARE_BRAND_STATE.image = loaded;
      resolve(loaded);
      if (loaded) renderShareCanvas();
    };
    const timer = setTimeout(() => finish(null), 5000);
    image.crossOrigin = 'anonymous';
    image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0 ? image : null);
    image.onerror = () => finish(null);
    image.src = SHARE_BRAND_URL;
  }).catch(() => null);
  return SHARE_BRAND_STATE.promise;
}

function drawShareBrandWordmark(ctx, x, y, width, height) {
  loadShareBrandImage();
  const image = SHARE_BRAND_STATE.image;
  if (image) {
    const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const imageWidth = image.naturalWidth * scale;
    const imageHeight = image.naturalHeight * scale;
    const left = x + (width - imageWidth) / 2, top = y + (height - imageHeight) / 2;
    ctx.save();
    // Match the header's rounded badge, hiding the source's checkerboard corners.
    roundedCanvasRect(ctx, left, top, imageWidth, imageHeight, imageWidth * .125);
    ctx.clip();
    ctx.drawImage(image, left, top, imageWidth, imageHeight);
    ctx.restore();
  } else {
    fillRoundedCanvasRect(ctx, x, y, width, height, 12, '#d9ef9e');
    ctx.fillStyle = '#12382a';
    ctx.font = '900 30px Inter, PingFang SC, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('TQL FPL', x + width / 2, y + height / 2 + 10);
    ctx.textAlign = 'left';
  }
}

function loadShareKitImage(player) {
  const url = kitUrl(player);
  if (!url) return Promise.resolve(null);
  const cached = SHARE_KIT_IMAGES.get(url);
  if (cached) return cached.promise;
  const state = { image: null, promise: null };
  state.promise = new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      state.image = image;
      resolve(image);
      renderShareCanvas();
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
  SHARE_KIT_IMAGES.set(url, state);
  return state.promise;
}

function getShareKitImage(player) {
  const url = kitUrl(player);
  if (!url) return null;
  const cached = SHARE_KIT_IMAGES.get(url);
  if (!cached) loadShareKitImage(player);
  return SHARE_KIT_IMAGES.get(url)?.image || null;
}

async function ensureShareKitImages(manager) {
  await Promise.allSettled((manager?.picks || []).map((pick) => loadShareKitImage(pick.player)));
}

function drawShareMessage(ctx, message, x, y, maxWidth) {
  const text = String(message || '').trim();
  if (!text) return;
  const lines = [];
  let line = '';
  [...text].forEach((char) => {
    if (ctx.measureText(line + char).width > maxWidth && line) {
      lines.push(line);
      line = char;
    } else line += char;
  });
  if (line) lines.push(line);
  lines.slice(0, 2).forEach((value, index) => ctx.fillText(value, x, y + index * 38));
}

function shareCanvasPitchBounds(y, topY = 282, bottomY = 956) {
  const bounds = FPLPitch.boundsAt((y - topY) / (bottomY - topY));
  return { left: 16 + 1048 * bounds.left, right: 16 + 1048 * bounds.right };
}

function drawShareCanvasPitch(ctx) {
  FPLPitch.draw(ctx, 16, 282, 1048, 674);
}

function drawShareCanvasPlayer(ctx, pick, x, y, plateWidth) {
  const player = pick.player;
  const locked = STATE.shareLockedIds.has(Number(player.id));
  const kitImage = getShareKitImage(player);
  if (kitImage) {
    const height = 82;
    const width = height * (kitImage.naturalWidth / kitImage.naturalHeight);
    ctx.save();
    ctx.shadowColor = 'rgba(5, 25, 16, .24)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 6;
    ctx.drawImage(kitImage, x - width / 2, y - height / 2, width, height);
    ctx.restore();
  } else {
    drawShareJersey(ctx, x, y, player.team, player.pos === 'GKP');
  }
  const plateX = x - plateWidth / 2;
  const plateY = y + 30;
  fillRoundedCanvasRect(ctx, plateX, plateY, plateWidth, 58, 7, locked ? '#5c236e' : '#f3f5f1');
  ctx.save();
  ctx.clip();
  ctx.fillStyle = locked ? '#3b164a' : '#d9ef9e';
  ctx.fillRect(plateX, plateY + 30, plateWidth, 28);
  ctx.restore();
  ctx.textAlign = 'center';
  ctx.fillStyle = locked ? '#ffffff' : '#14201a';
  ctx.font = '800 18px Inter, PingFang SC, sans-serif';
  ctx.fillText(fitCanvasText(ctx, player.name, plateWidth - 16), x, plateY + 24);
  ctx.fillStyle = locked ? '#edcff5' : '#12382a';
  ctx.font = '700 13px Inter, PingFang SC, sans-serif';
  ctx.fillText(`上轮 ${player.lastGwPoints ?? '—'} · 总 ${player.totalPoints ?? '—'}${locked ? ' · 非卖' : ''}`, x, plateY + 46);
  ctx.textAlign = 'left';
}

function renderShareCanvas() {
  const canvas = $('#shareCanvas');
  const manager = shareManager();
  if (!canvas || !manager) return;
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const meta = STATE.snap.meta;
  const sortedPicks = [...(manager.picks || [])].sort((a, b) => a.position - b.position);
  const starters = sortedPicks.filter((pick) => pick.position <= 11);
  const bench = sortedPicks.filter((pick) => pick.position > 11);
  const groups = { GKP: [], DEF: [], MID: [], FWD: [] };
  starters.forEach((pick) => groups[pick.player.pos]?.push(pick));

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#f3f5f1';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#0b1f17';
  ctx.fillRect(0, 0, width, 262);

  drawShareBrandWordmark(ctx, 62, 20, 218, 64);
  ctx.fillStyle = '#d9ef9e';
  ctx.font = '700 25px Inter, PingFang SC, sans-serif';
  ctx.fillText(`DRAFT · GW${meta.upcomingGw || meta.currentGw}`, 308, 62);
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 48px Inter, PingFang SC, sans-serif';
  ctx.fillText('阵容交易名片', 62, 130);
  ctx.font = '800 29px Inter, PingFang SC, sans-serif';
  ctx.fillText(fitCanvasText(ctx, manager.entryName, 660), 62, 182);
  ctx.fillStyle = '#d9ef9e';
  ctx.font = '500 23px Inter, PingFang SC, sans-serif';
  ctx.fillText(fitCanvasText(ctx, `${manager.playerName || ''} · ${meta.leagueName}`, 810), 62, 222);
  fillRoundedCanvasRect(ctx, 806, 103, 214, 80, 12, '#ffffff10');
  ctx.fillStyle = '#edcff5';
  ctx.font = '900 25px Inter, PingFang SC, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${STATE.shareLockedIds.size} 名非卖品`, 913, 153);
  ctx.textAlign = 'left';

  ctx.fillStyle = '#f3f6ef';
  ctx.fillRect(0, 262, width, 834);
  drawShareCanvasPitch(ctx);
  const rowY = { GKP: 345, DEF: 485, MID: 655, FWD: 820 };
  ['GKP', 'DEF', 'MID', 'FWD'].forEach((pos) => {
    const picks = groups[pos];
    const y = rowY[pos];
    const bounds = shareCanvasPitchBounds(y);
    const available = bounds.right - bounds.left - 80;
    const gap = 8;
    const plateWidth = Math.min(144, (available - Math.max(0, picks.length - 1) * gap) / Math.max(1, picks.length));
    const rowWidth = picks.length * plateWidth + Math.max(0, picks.length - 1) * gap;
    const startX = (width - rowWidth) / 2 + plateWidth / 2;
    picks.forEach((pick, index) => drawShareCanvasPlayer(ctx, pick, startX + index * (plateWidth + gap), y, plateWidth));
  });

  fillRoundedCanvasRect(ctx, 48, 946, 984, 150, 12, '#eaf0e3');
  ctx.fillStyle = '#496344';
  ctx.font = '800 16px Inter, PingFang SC, sans-serif';
  ctx.fillText('替补席', 72, 974);
  const benchWidth = 148;
  const benchGap = 30;
  const benchRowWidth = bench.length * benchWidth + Math.max(0, bench.length - 1) * benchGap;
  const benchStart = (width - benchRowWidth) / 2 + benchWidth / 2;
  bench.forEach((pick, index) => drawShareCanvasPlayer(ctx, pick, benchStart + index * (benchWidth + benchGap), 993, benchWidth));

  fillRoundedCanvasRect(ctx, 62, 1114, 770, 104, 12, '#ffffff');
  ctx.fillStyle = '#14201a';
  ctx.font = '700 23px Inter, PingFang SC, sans-serif';
  drawShareMessage(ctx, STATE.shareMessage, 88, 1155, 718);

  fillRoundedCanvasRect(ctx, 854, 1098, 164, 164, 16, '#ffffff');
  const qrImage = getShareQrImage();
  if (qrImage) {
    ctx.drawImage(qrImage, 864, 1108, 144, 144);
  } else {
    ctx.fillStyle = '#315a49';
    ctx.font = '700 17px Inter, PingFang SC, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(SHARE_QR_STATE.failed ? '扫码地址见下方' : '二维码加载中', 936, 1187);
    ctx.textAlign = 'left';
  }

  ctx.fillStyle = '#0b1f17';
  ctx.fillRect(0, 1251, width, 189);
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 23px Inter, PingFang SC, sans-serif';
  ctx.fillText('fftql.team', 62, 1295);
  ctx.fillStyle = '#d9ef9e';
  ctx.font = '600 20px Inter, PingFang SC, sans-serif';
  ctx.fillText(fitCanvasText(ctx, shareUrl().replace('https://', ''), 710), 62, 1328);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#d9ef9e';
  ctx.font = '700 18px Inter, PingFang SC, sans-serif';
  ctx.fillText('扫码进入', 1018, 1317);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#a9bcb0';
  ctx.font = '17px Inter, PingFang SC, sans-serif';
  ctx.fillText(fitCanvasText(ctx, manager.lineupNote || '当前持有阵容 · 位置参考最近公开阵容 · Draft 无队长', 950), 62, 1377);
}

async function shareCanvasBlob() {
  getShareQrImage();
  await Promise.all([ensureShareKitImages(shareManager()), loadShareBrandImage(), SHARE_QR_STATE.promise]);
  renderShareCanvas();
  return new Promise((resolve, reject) => {
    $('#shareCanvas').toBlob((blob) => blob ? resolve(blob) : reject(new Error('图片生成失败')), 'image/png');
  });
}

function shareFileName() {
  const safeName = (shareManager()?.entryName || '我的阵容').replace(/[\\/:*?"<>|]/g, '-');
  return `FPL-Draft-交易名片-${safeName}.png`;
}

function setShareFeedback(message, isError = false) {
  const feedback = $('#shareFeedback');
  feedback.textContent = message;
  feedback.classList.toggle('error', isError);
}

async function downloadShareImage(message = '图片已下载，可以发送到微信群。') {
  const blob = await shareCanvasBlob();
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = shareFileName();
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  setShareFeedback(message);
}

$('#shareEntrySelect').addEventListener('change', (event) => {
  STATE.shareEntryId = Number(event.target.value);
  loadShareLocks(STATE.shareEntryId);
  setShareFeedback('');
  renderShare();
});

$('#shareSquadGrid').addEventListener('click', (event) => {
  const card = event.target.closest('.share-player-card[data-player-id]');
  if (!card) return;
  const id = Number(card.dataset.playerId);
  if (STATE.shareLockedIds.has(id)) STATE.shareLockedIds.delete(id);
  else STATE.shareLockedIds.add(id);
  saveShareLocks();
  setShareFeedback('标注已保存，分享图片已更新。');
  renderShare();
});

$('#shareClearLocks').addEventListener('click', () => {
  STATE.shareLockedIds.clear();
  saveShareLocks();
  setShareFeedback('已将全部球员设为可以谈。');
  renderShare();
});

$('#shareMessage').addEventListener('input', (event) => {
  STATE.shareMessage = event.target.value.slice(0, 90);
  renderShareCanvas();
});

$('#shareDownloadImage').addEventListener('click', async () => {
  try { await downloadShareImage(); }
  catch (error) { setShareFeedback(error.message, true); }
});

$('#shareCopyImage').addEventListener('click', async () => {
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('当前浏览器不支持复制图片');
    const blob = await shareCanvasBlob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    setShareFeedback('图片已复制，可以直接粘贴到微信。');
  } catch (error) {
    try { await downloadShareImage('当前浏览器无法复制，已改为下载 PNG。'); }
    catch (downloadError) { setShareFeedback(downloadError.message || error.message, true); }
  }
});

$('#shareCopyLink').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(shareUrl());
    setShareFeedback('网站链接已复制，粘贴到微信后可以直接点击。');
  } catch (error) {
    setShareFeedback(`复制失败，请手动复制：${shareUrl()}`, true);
  }
});

$('#shareNative').addEventListener('click', async () => {
  try {
    const blob = await shareCanvasBlob();
    const file = new File([blob], shareFileName(), { type: 'image/png' });
    if (!navigator.share || !navigator.canShare?.({ files: [file] })) {
      await downloadShareImage('当前设备不支持系统图片分享，已下载 PNG。');
      return;
    }
    await navigator.share({
      title: `${shareManager()?.entryName || '我的阵容'} · FPL Draft 交易清单`,
      text: STATE.shareMessage,
      url: shareUrl(),
      files: [file],
    });
    setShareFeedback('分享面板已打开。');
  } catch (error) {
    if (error.name !== 'AbortError') setShareFeedback(`分享失败：${error.message}`, true);
  }
});

/* ================= Tab 6: Compare ================= */
function initCompare() {
  const s = STATE.snap;
  const opts = s.managers.map((m) => `<option value="${m.entryId}">${esc(m.entryName)}</option>`).join('');
  $('#cmpLeft').innerHTML = opts;
  $('#cmpRight').innerHTML = opts;
  // default: Ken's team (加布惊焰软糖形态) vs rank 1
  const ken = s.managers.find((m) => /加布惊焰/.test(m.entryName)) || s.managers.find((m) => /Ken/i.test(m.playerName));
  const top = [...s.managers].sort((a, b) => (a.rank || 99) - (b.rank || 99))[0];
  if (!managerByEntry(STATE.cmpLeft)) STATE.cmpLeft = (ken || top)?.entryId;
  const other = s.managers.find((m) => m.entryId !== STATE.cmpLeft);
  if (!managerByEntry(STATE.cmpRight)) STATE.cmpRight = (top && top.entryId !== STATE.cmpLeft ? top : other)?.entryId;
  $('#cmpLeft').value = STATE.cmpLeft;
  $('#cmpRight').value = STATE.cmpRight;
  if ($('#btnSwap').dataset.bound) { renderCompare(); return; }
  $('#btnSwap').dataset.bound = 'true';
  $('#cmpLeft').addEventListener('change', () => { STATE.cmpLeft = Number($('#cmpLeft').value); renderCompare(); });
  $('#cmpRight').addEventListener('change', () => { STATE.cmpRight = Number($('#cmpRight').value); renderCompare(); });
  $('#btnSwap').addEventListener('click', () => {
    [STATE.cmpLeft, STATE.cmpRight] = [STATE.cmpRight, STATE.cmpLeft];
    $('#cmpLeft').value = STATE.cmpLeft;
    $('#cmpRight').value = STATE.cmpRight;
    renderCompare();
  });
  $('#cmpViewSwitch').addEventListener('click', (e) => {
    const btn = e.target.closest('.cmp-view-btn');
    if (!btn) return;
    STATE.cmpView = btn.dataset.view;
    $$('#cmpViewSwitch .cmp-view-btn').forEach((b) => {
      const active = b === btn;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    renderCompare();
  });
  renderCompare();
}

function squadSummaryHtml(m, formation = '') {
  return `
    <div class="cmp-side-title">
      <div class="cmp-team-line">
        <h3>${managerMark(m.entryName)}${esc(m.entryName)}</h3>
        ${formation ? `<span class="cmp-formation">阵型 ${formation}</span>` : ''}
      </div>
      <div class="cmp-stats">
        <span class="cmp-stat"><span class="cmp-stat-label">价值</span><b>${fmtM(m.squadValue)}</b></span>
        <span class="cmp-stat"><span class="cmp-stat-label">预计</span><b>${fmt1(m.projected)}</b></span>
        <span class="cmp-stat"><span class="cmp-stat-label">近5轮</span><b>${m.formAvg != null ? fmt1(m.formAvg) : '—'}</b></span>
      </div>
    </div>`;
}

function squadListSideHtml(m) {
  const picks = [...m.picks].sort((a, b) =>
    POS_ORDER[a.player.pos] - POS_ORDER[b.player.pos] || a.position - b.position);
  return `
    ${squadSummaryHtml(m)}
    <div class="squad-list">${picks.map((p) => {
      const pl = p.player;
      return `
        <div class="squad-row ${p.position > 11 ? 'bench' : ''}">
          <span class="pos-pill pos-${pl.pos}">${pl.pos}</span>
          <span class="squad-name">
            <span class="nm">${esc(pl.name)}</span>
            <span class="tm">${esc(pl.team)}</span>
          </span>
          <span class="squad-cost">上轮 ${pl.lastGwPoints ?? 0} · 总 ${pl.totalPoints ?? 0}</span>
          <span class="squad-pts">EP ${fmt1(pl.epNext)}</span>
        </div>`;
    }).join('')}</div>`;
}

function comparePlayerCard(pick, options = {}) {
  const pl = pick.player;
  const src = kitUrl(pl);
  const status = pl.status && pl.status !== 'a';
  const scoreLabel = options.scoreLabel || '上轮';
  const scoreAbbr = options.scoreLabel ? 'GW' : 'LW';
  const scoreKey = Object.prototype.hasOwnProperty.call(options, 'scoreKey') ? options.scoreKey : 'lastGwPoints';
  const roundPoints = scoreKey ? pl[scoreKey] : null;
  const pointsDescription = points => points == null ? '暂无得分' : `${points}pts`;
  return `
    <div class="cmp-pitch-player ${pick.position > 11 ? 'bench' : ''}" title="${esc(pl.teamName || pl.team)} · ${pl.pos}${pl.news ? ` · ${esc(pl.news)}` : ''}">
      <div class="cmp-kit ${src ? '' : 'kit-error'}">
        ${src ? `<img class="cmp-kit-img" src="${src}" alt="${esc(pl.teamName || pl.team)} ${pl.pos === 'GKP' ? '门将' : '主场'}球衣" loading="lazy" decoding="async" />` : ''}
        <span class="cmp-kit-fallback pos-photo-${pl.pos}">${esc(initialOf(pl.team || pl.name))}</span>
        ${status ? '<span class="cmp-player-alert">!</span>' : ''}
      </div>
      <div class="cmp-player-plate">
        <div class="cmp-player-name" title="${esc(pl.name)}">${esc(pl.name)}</div>
        <div class="cmp-player-scores" aria-label="${esc(scoreLabel)} ${pointsDescription(roundPoints)}，总分 ${pointsDescription(pl.totalPoints)}" title="${esc(scoreLabel)} ${pointsDescription(roundPoints)}，总分 ${pointsDescription(pl.totalPoints)}">
          <span>${scoreAbbr} <b>${roundPoints ?? '—'}</b></span>
          <span class="cmp-score-separator" aria-hidden="true">·</span>
          <span>T <b>${pl.totalPoints ?? '—'}</b></span>
        </div>
      </div>
    </div>`;
}

function squadPitchSideHtml(m, options = {}) {
  const picks = (m.picks || []).filter((p) => p.player);
  const xi = picks.filter((p) => p.position <= 11).sort((a, b) => a.position - b.position);
  const bench = picks.filter((p) => p.position > 11).sort((a, b) => a.position - b.position);
  const rows = { GKP: [], DEF: [], MID: [], FWD: [] };
  xi.forEach((p) => rows[p.player.pos]?.push(p));
  const formation = `${rows.DEF.length}-${rows.MID.length}-${rows.FWD.length}`;
  const scoreLegend = options.scoreLabel ? `GW＝${options.scoreLabel}得分` : 'LW＝上轮得分';
  const playerCard = (pick) => comparePlayerCard(pick, options);
  if (options.managerView && !picks.length) return '<p class="manager-view-empty">暂无可用阵容，数据更新后会在此显示。</p>';
  return `
    ${options.summary === false ? `<div class="manager-view-pitch-heading"><span>首发位置 · ${xi.length} 人</span><span>阵型 ${formation}</span></div>` : squadSummaryHtml(m, formation)}
    <div class="cmp-pitch-scroll">
      <div class="cmp-pitch">
        ${perspectiveFieldHtml()}
        ${['GKP', 'DEF', 'MID', 'FWD'].map((pos) => `
          <div class="cmp-pitch-row cmp-pitch-${pos.toLowerCase()}">
            ${rows[pos].map(playerCard).join('')}
          </div>`).join('')}
        <div class="cmp-pitch-legend"><span>${esc(scoreLegend)}</span><span>T＝赛季总分</span><span>单位：pts</span></div>
      </div>
    </div>
    <div class="cmp-bench-area">
      <div class="cmp-bench-label"><span>替补席${options.managerView ? ` · ${bench.length} 人` : ''}</span><span>${esc(options.scoreLabel || '上轮')} / 赛季总分</span></div>
      <div class="cmp-bench">${bench.map(playerCard).join('')}</div>
    </div>`;
}

let cmpRadar = null;
function renderCompare() {
  const s = STATE.snap;
  const L = managerByEntry(STATE.cmpLeft);
  const R = managerByEntry(STATE.cmpRight);
  if (!L || !R) return;

  const pitchView = STATE.cmpView !== 'list';
  const sideRenderer = pitchView ? squadPitchSideHtml : squadListSideHtml;

  $('#compareBody').innerHTML = `
    <p class="tx-meta">${esc(L.lineupNote || '当前持有阵容；位置参考最近公开阵容，截止前调整官方暂不公开。')}</p>
    <div class="cmp-grid ${pitchView ? 'pitch-view' : 'list-view'}">
      <div class="cmp-side">${sideRenderer(L)}</div>
      <div class="cmp-side">${sideRenderer(R)}</div>
    </div>
    <div class="radar-wrap chart-box"><canvas id="cmpRadar"></canvas></div>
    <div class="cmp-verdict" id="cmpVerdict"></div>`;
  if (pitchView) bindKitFallbacks('#compareBody .cmp-kit-img', '.cmp-kit');

  // radar: positional strength (ep_next sum of XI per pos), value, form, depth
  const dims = ['锋线', '中场', '后防', '门将', '阵容价值', '状态'];
  const mk = (m) => {
    const xi = m.picks.filter((p) => p.position <= 11);
    const posSum = (pos) => xi.filter((p) => p.player.pos === pos)
      .reduce((s, p) => s + p.player.epNext, 0);
    return [
      posSum('FWD'), posSum('MID'), posSum('DEF') + posSum('GKP') * 0.8, posSum('GKP'),
      m.squadValue, (m.formAvg ?? 0) * 10,
    ];
  };
  const dl = mk(L), dr = mk(R);
  const max = dl.map((v, i) => Math.max(v, dr[i]) * 1.15 || 1);

  if (cmpRadar) cmpRadar.destroy();
  cmpRadar = new Chart($('#cmpRadar'), {
    type: 'radar',
    data: {
      labels: dims,
      datasets: [
        { label: L.entryName, data: dl.map((v, i) => +(v / max[i]).toFixed(2)),
          borderColor: CHART_PRIMARY, backgroundColor: SCOUT_WORKSPACE ? 'rgba(79,126,78,.10)' : 'rgba(0,255,135,.10)', pointRadius: 3 },
        { label: R.entryName, data: dr.map((v, i) => +(v / max[i]).toFixed(2)),
          borderColor: CHART_SECONDARY, backgroundColor: SCOUT_WORKSPACE ? 'rgba(144,118,159,.10)' : 'rgba(79,140,255,.10)', pointRadius: 3 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: CHART_TEXT, boxWidth: 14 } } },
      scales: { r: { grid: { color: CHART_GRID }, angleLines: { color: CHART_GRID },
        ticks: { display: false }, pointLabels: { color: CHART_TEXT, font: { size: 12 } } } },
    },
  });

  // verdict
  const xiL = L.picks.filter((p) => p.position <= 11), xiR = R.picks.filter((p) => p.position <= 11);
  const posScore = (xi, pos) => xi.filter((p) => p.player.pos === pos)
    .reduce((s, p) => s + p.player.epNext, 0);
  const parts = [];
  const cmpPos = (pos, label) => {
    const a = posScore(xiL, pos), b = posScore(xiR, pos);
    if (Math.abs(a - b) < 0.5) parts.push(`${label}实力相当（${fmt1(a)} vs ${fmt1(b)} 预计分）`);
    else {
      const better = a > b ? L : R, worse = a > b ? R : L;
      parts.push(`<b>${esc(better.entryName)}</b> 的${label}更强（${fmt1(Math.max(a, b))} vs ${fmt1(Math.min(a, b))} 预计分）`);
    }
  };
  cmpPos('FWD', '锋线'); cmpPos('MID', '中场'); cmpPos('DEF', '后防');
  parts.push(L.projected > R.projected
    ? `${forecastLabel()}得分 <b class="win">${esc(L.entryName)} ${fmt1(L.projected)} 分</b>领先 ${fmt1(R.projected)} 分`
    : `${forecastLabel()}得分 <b class="win">${esc(R.entryName)} ${fmt1(R.projected)} 分</b>领先 ${fmt1(L.projected)} 分`);
  const injuredL = L.picks.filter((p) => p.player.status && p.player.status !== 'a').length;
  const injuredR = R.picks.filter((p) => p.player.status && p.player.status !== 'a').length;
  if (injuredL !== injuredR) parts.push(`${esc(injuredL > injuredR ? R.entryName : L.entryName)} 阵容更健康（对方有 ${Math.max(injuredL, injuredR)} 名球员伤停/存疑）`);
  if (Math.abs(L.squadValue - R.squadValue) >= 2)
    parts.push(`阵容价值差 <b>${fmtM(Math.abs(L.squadValue - R.squadValue))}</b>（${fmtM(L.squadValue)} vs ${fmtM(R.squadValue)}）`);
  $('#cmpVerdict').innerHTML = `对比结论：${parts.join('；')}。`;
}

/* ================= Tab 4: Predict ================= */
let projectedChart = null;
const projectedValueLabels = {
  id: 'projectedValueLabels',
  afterDatasetsDraw(chart) {
    const dataset = chart.data.datasets[0];
    const bars = chart.getDatasetMeta(0).data;
    const { ctx } = chart;
    ctx.save();
    ctx.font = '800 13px Inter, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    bars.forEach((bar, index) => {
      const label = fmt1(dataset.data[index]);
      const x = bar.base + 9;
      const width = ctx.measureText(label).width + 10;
      ctx.fillStyle = 'rgba(5, 12, 26, .72)';
      ctx.fillRect(x - 5, bar.y - 10, width, 20);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, x, bar.y);
    });
    ctx.restore();
  },
};
function renderPredict() {
  const s = STATE.snap;
  const { meta } = s;
  const targetGw = meta.upcomingGw || Math.max(1, meta.lastFinishedGw + 1);
  const period = TIMELINE.live(meta, targetGw) ? '本轮' : '下轮';
  $('#predictTitle').textContent = `${period}对阵预测`;
  $('#projectedTitle').textContent = `${period}预计得分排行`;
  $('#tabs [data-tab="predict"]').textContent = `${period}预测`;
  $('#predictLabel').textContent = `GW${targetGw}`;
  const sig = 8; // score difference std estimate
  const targetMatches = s.upcomingGwMatches || (s.h2hByGw && s.h2hByGw[targetGw]) || [];
  const rows = targetMatches.map((m) => {
    const L = managerByEntry(m.entry1Id) || { projected: 0 };
    const R = managerByEntry(m.entry2Id) || { projected: 0 };
    const diff = L.projected - R.projected;
    const winProb = normCdf(diff / sig);
    return { m, L, R, winProb };
  });
  const predictionRows = rows.length ? rows.map(({ m, L, R, winProb }) => {
    const pA = winProb * 100, pB = 100 - pA;
    return `
      <div class="pred-row">
        <div class="pred-side">
          <span class="pred-team">${esc(L.entryName)}</span>
          <span class="pred-pts">近5轮场均 ${fmt1(L.formAvg)} · 价值 ${fmtM(L.squadValue)}</span>
        </div>
        <div class="pred-est">${fmt1(L.projected)}<span style="font-size:11px;color:var(--text-faint)"> 分</span></div>
        <div class="pred-est">${fmt1(R.projected)}<span style="font-size:11px;color:var(--text-faint)"> 分</span></div>
        <div class="pred-side right">
          <span class="pred-team">${esc(R.entryName)}</span>
          <span class="pred-pts">近5轮场均 ${fmt1(R.formAvg)} · 价值 ${fmtM(R.squadValue)}</span>
        </div>
        <div class="pred-bar-zone">
          <div class="pred-bar">
            <div class="pred-bar-fill" style="width:${pA.toFixed(1)}%;background:linear-gradient(90deg,#00c96b,#00ff87)"></div>
            <div class="pred-bar-fill" style="width:${pB.toFixed(1)}%;background:linear-gradient(90deg,#4f8cff,#7aa7ff)"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-faint);margin-top:3px">
            <span>${pA.toFixed(0)}% 胜率</span><span>${pB.toFixed(0)}% 胜率</span>
          </div>
        </div>
      </div>`;
  }).join('') : `<div class="tx-meta">GW${targetGw} 暂无对阵数据</div>`;
  $('#predictBody').innerHTML = `<div class="predict-list">${predictionRows}</div>
  <div class="table-note">胜率为基于预计得分差与历史波动（σ≈${sig}分）的估计，仅供参考娱乐。</div>`;

  // projected ranking bar
  const sorted = [...s.managers].sort((a, b) => b.projected - a.projected);
  // Keep the same default highlight even when Compare has not been opened yet.
  const highlightedEntry = STATE.cmpLeft ?? (s.managers.find((m) => /加布惊焰/.test(m.entryName))
    || s.managers.find((m) => /Ken/i.test(m.playerName))
    || [...s.managers].sort((a, b) => (a.rank || 99) - (b.rank || 99))[0])?.entryId;
  if (projectedChart) projectedChart.destroy();
  projectedChart = new Chart($('#projectedChart'), {
    type: 'bar',
    data: {
      labels: sorted.map((m) => m.entryName),
      datasets: [{
        label: `GW${targetGw} 预计得分`,
        data: sorted.map((m) => m.projected),
        backgroundColor: sorted.map((m) => m.entryId === highlightedEntry ? CHART_POS_FILL : (SCOUT_WORKSPACE ? '#b1c6a0' : 'rgba(79,140,255,.55)')),
        borderRadius: 3,
      }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: CHART_FAINT }, grid: { color: CHART_GRID } },
        y: { ticks: { color: CHART_TEXT, font: { size: 11 } }, grid: { display: false } },
      },
    },
    plugins: [projectedValueLabels],
  });
}

/* ================= Tab 5: Trade evaluator ================= */
function initTrade() {
  setupPicker('A');
  setupPicker('B');
  renderTrade();
}

function setupPicker(side) {
  const input = $(`#tradeSearch${side}`);
  if (input.dataset.bound) return;
  input.dataset.bound = 'true';
  const results = $(`#pickerResults${side}`);
  const posBar = $(`#pickerPos${side}`);
  const POS_KEYS = { gkp: 'GKP', def: 'DEF', mid: 'MID', fwd: 'FWD', 门将: 'GKP', 后卫: 'DEF', 中场: 'MID', 前锋: 'FWD' };

  posBar.addEventListener('click', (e) => {
    const btn = e.target.closest('.sort-btn[data-pos]');
    if (!btn) return;
    STATE[`posFilter${side}`] = btn.dataset.pos;
    $$('#' + posBar.id + ' .sort-btn').forEach((b) => b.classList.toggle('active', b === btn));
    input.dispatchEvent(new Event('input'));
  });

  function searchAndRender() {
    const rawQ = input.value.trim();
    const q = normTxt(rawQ);
    // 查询词本身是位置关键词时，自动当作位置筛选
    let qPos = POS_KEYS[q] || null;
    const posFilter = STATE[`posFilter${side}`] || qPos || '';
    const picked = STATE[`trade${side}`].map((p) => p.id);
    const myEntry = getMyEntryId();
    const hits = (STATE.snap.players || [])
      .filter((p) => {
        if (picked.includes(p.id)) return false;
        if (posFilter && p.pos !== posFilter) return false;
        if (!q) return true; // 仅位置筛选：按实力给出推荐
        const nName = normTxt(p.name);
        const nFull = normTxt(p.fullName);
        const nTeam = normTxt(`${p.teamName} ${p.team}`);
        // 相关性分：名字前缀 > 全名任一单词前缀 > 名字包含 > 其他字段包含
        let score = 0;
        if (nName.startsWith(q)) score = 40;
        else if (nFull.split(/[\s.'\-]+/).some((w) => w.startsWith(q))) score = 30;
        else if (nName.includes(q) || nFull.includes(q)) score = 20;
        else if (nTeam.includes(q)) score = 10;
        return score > 0;
      })
      .map((p) => {
        const nName = normTxt(p.name);
        const nFull = normTxt(p.fullName);
        let score = 0;
        if (q) {
          if (nName.startsWith(q)) score = 40;
          else if (nFull.split(/[\s.'\-]+/).some((w) => w.startsWith(q))) score = 30;
          else if (nName.includes(q) || nFull.includes(q)) score = 20;
          else score = 10;
        }
        // 我方 / 非我方优先级加成
        const isMine = myEntry != null && p.owner === myEntry;
        if (side === 'A' && isMine) score += 100;
        if (side === 'B' && !isMine) score += 100;
        return { p, score, isMine };
      })
      .sort((a, b) => (b.score - a.score) || ((b.p.epNext + b.p.ppg) - (a.p.epNext + a.p.ppg)))
      .slice(0, 12);
    results.innerHTML = hits.length ? hits.map(({ p, isMine }) => {
      const owner = ownerName(p.owner);
      const tag = side === 'A'
        ? (isMine ? '<span class="own-tag mine">我方</span>' : '')
        : (isMine ? '<span class="own-tag warn">我方阵容</span>' : '<span class="own-tag ok">非我方</span>');
      return `
        <div class="pick-opt" data-id="${p.id}" data-side="${side}">
          <span class="pos-pill pos-${p.pos}">${p.pos}</span>
          <span><span class="nm">${esc(p.name)}</span> <span class="sub">${esc(p.team)}${owner ? ` · ${esc(owner)}` : ' · 自由球员'}</span></span>
          ${tag}
          <span class="cost">${fmtM(p.nowCost)} · f${fmt1(p.form)}</span>
        </div>`;
    }).join('') : `<div class="pick-opt"><span class="sub">无匹配球员${posFilter ? `（${posFilter}）` : ''}</span></div>`;
    results.classList.add('open');
  }

  input.addEventListener('input', searchAndRender);
  input.addEventListener('focus', searchAndRender);
  results.addEventListener('click', (e) => {
    const opt = e.target.closest('.pick-opt[data-id]');
    if (!opt) return;
    const id = Number(opt.dataset.id);
    const p = STATE.snap.players.find((x) => x.id === id);
    if (p && !STATE[`trade${opt.dataset.side}`].some((x) => x.id === id)) {
      STATE[`trade${opt.dataset.side}`].push(p);
      input.value = '';
      results.classList.remove('open');
      renderTrade();
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest(`.player-picker`)) results.classList.remove('open');
  });
}

function renderTrade() {
  renderPickedList('A');
  renderPickedList('B');
  renderTradeVerdict();
}

function renderPickedList(side) {
  const list = STATE[`trade${side}`];
  $(`#pickedList${side}`).innerHTML = list.length ? list.map((p) => {
    const owner = ownerName(p.owner);
    return `
      <div class="picked-row">
        <span class="pos-pill pos-${p.pos}">${p.pos}</span>
        <span class="squad-name">
          <span class="nm">${esc(p.name)}</span>
          <span class="tm">${esc(p.team)}${owner ? ` · ${esc(owner)}` : ' · 自由球员'}</span>
        </span>
        <span class="squad-cost">${fmtM(p.nowCost)}</span>
        <button class="rm" data-id="${p.id}" data-side="${side}" title="移除">✕</button>
      </div>`;
  }).join('') : '<div class="tx-meta" style="padding:6px 2px">尚未选择球员</div>';
}

document.addEventListener('click', (e) => {
  const rm = e.target.closest('.picked-row .rm');
  if (!rm) return;
  const side = rm.dataset.side, id = Number(rm.dataset.id);
  STATE[`trade${side}`] = STATE[`trade${side}`].filter((p) => p.id !== id);
  renderTrade();
});

function tradeAgg(list) {
  const n = list.length || 1;
  return {
    n: list.length,
    cost: list.reduce((s, p) => s + p.nowCost, 0),
    epNext: list.reduce((s, p) => s + p.epNext, 0),
    form: list.reduce((s, p) => s + p.form, 0) / n,
    ppg: list.reduce((s, p) => s + p.ppg, 0) / n,
    xg90: list.reduce((s, p) => s + p.xg90, 0),
    xa90: list.reduce((s, p) => s + p.xa90, 0),
    totalPoints: list.reduce((s, p) => s + p.totalPoints, 0),
    injured: list.filter((p) => p.status && p.status !== 'a'),
    minutes: list.reduce((s, p) => s + p.minutes, 0) / n,
  };
}

function renderTradeVerdict() {
  const A = tradeAgg(STATE.tradeA);
  const B = tradeAgg(STATE.tradeB);
  const box = $('#tradeVerdict');
  if (!STATE.tradeA.length || !STATE.tradeB.length) {
    box.innerHTML = `<div class="trade-verdict-card"><div class="tx-meta">请在两侧各选择至少一名球员后，这里会给出交易评估。</div></div>`;
    return;
  }

  // scoring: per-player composite score
  const scoreOf = (p) =>
    p.epNext * 2 + p.form * 1.5 + p.ppg * 2 + (p.minutes / 90) * 0.1 - (p.status !== 'a' ? 2 : 0);
  const scA = STATE.tradeA.reduce((s, p) => s + scoreOf(p), 0);
  const scB = STATE.tradeB.reduce((s, p) => s + scoreOf(p), 0);
  const diff = scA - scB;
  const ratio = Math.abs(diff) / Math.max(scA, scB, 0.01);
  let verdict, cls;
  if (ratio < 0.08) { verdict = '⚖️ 基本对等'; cls = 'v-even'; }
  else if (diff > 0) { verdict = '✅ 我方占优'; cls = 'v-good'; }
  else { verdict = '⚠️ 我方吃亏'; cls = 'v-bad'; }

  const rows = [
    ['球员数', A.n, B.n, null],
    ['合计价值', fmtM(A.cost), fmtM(B.cost), A.cost > B.cost ? 'A' : B.cost > A.cost ? 'B' : null],
    [`${forecastLabel()}得分`, fmt1(A.epNext), fmt1(B.epNext), A.epNext > B.epNext ? 'A' : B.epNext > A.epNext ? 'B' : null],
    ['近期状态 form', fmt1(A.form), fmt1(B.form), A.form > B.form ? 'A' : B.form > A.form ? 'B' : null],
    ['场均得分 PPG', fmt1(A.ppg), fmt1(B.ppg), A.ppg > B.ppg ? 'A' : B.ppg > A.ppg ? 'B' : null],
    ['xG/90 + xA/90', fmt1(A.xg90 + A.xa90), fmt1(B.xg90 + B.xa90), (A.xg90 + A.xa90) > (B.xg90 + B.xa90) ? 'A' : (B.xg90 + B.xa90) > (A.xg90 + A.xa90) ? 'B' : null],
    ['赛季总得分', A.totalPoints, B.totalPoints, A.totalPoints > B.totalPoints ? 'A' : B.totalPoints > A.totalPoints ? 'B' : null],
    ['场均出场时间', Math.round(A.minutes) + "'", Math.round(B.minutes) + "'", A.minutes > B.minutes ? 'A' : B.minutes > A.minutes ? 'B' : null],
  ];
  const cell = (v, better) =>
    `<td class="${better ? 'better' : ''}">${v}</td>`;
  const rowHtml = rows.map(([label, va, vb, better]) => `
    <tr><td>${label}</td>${cell(va, better === 'A')}${cell(vb, better === 'B')}</tr>`).join('');

  const reasons = [];
  if (A.epNext !== B.epNext) {
    const side = A.epNext > B.epNext ? '我方' : '对方';
    reasons.push(`${forecastLabel()}得分${side}更高（${fmt1(Math.max(A.epNext, B.epNext))} vs ${fmt1(Math.min(A.epNext, B.epNext))}），短期产出更有保障`);
  }
  if (Math.abs(A.form - B.form) >= 0.8)
    reasons.push(`${A.form > B.form ? '我方' : '对方'}球员近期状态明显更好（form ${fmt1(Math.max(A.form, B.form))} vs ${fmt1(Math.min(A.form, B.form))}）`);
  if (Math.abs(A.ppg - B.ppg) >= 0.5)
    reasons.push(`${A.ppg > B.ppg ? '我方' : '对方'}场均得分占优（PPG ${fmt1(Math.max(A.ppg, B.ppg))} vs ${fmt1(Math.min(A.ppg, B.ppg))}）`);
  if (Math.abs(A.minutes - B.minutes) >= 200)
    reasons.push(`${A.minutes > B.minutes ? '我方' : '对方'}球员出场时间更多（场均 ${Math.round(Math.max(A.minutes, B.minutes))}' vs ${Math.round(Math.min(A.minutes, B.minutes))}'），主力属性更强`);
  const injured = [...A.injured, ...B.injured];
  if (injured.length)
    reasons.push(`risk|注意伤停：${injured.map((p) => `${esc(p.name)}（${esc(p.news || '状态存疑')}）`).join('、')}`);

  box.innerHTML = `
    <div class="trade-verdict-card">
      <div class="verdict-score">
        <span class="verdict-badge ${cls}">${verdict}</span>
        <span class="verdict-diff">综合评分差 ${diff >= 0 ? '+' : ''}${fmt1(diff)} 分（正值=我方得到更多）</span>
      </div>
      <table class="trade-cmp-table">
        <thead><tr><th>维度</th><th>我方给出</th><th>对方给出</th></tr></thead>
        <tbody>${rowHtml}</tbody>
      </table>
      <ul class="trade-reasons">${reasons.map((r) =>
        r.startsWith('risk|') ? `<li class="risk">${r.slice(5)}</li>` : `<li>${r}</li>`).join('')}</ul>
      <div class="table-note" style="margin-top:8px">综合评分 = 2×预计得分 + 1.5×form + 2×PPG + 出场时间因子 − 伤停惩罚。仅供参考，足球世界一切皆有可能。</div>
    </div>`;
}

FPLMatchView.init({ getSnapshot: () => STATE.snap, fieldHtml: perspectiveFieldHtml });
boot();
