'use strict';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const ADMIN_COLORS = ['#246b58', '#8eafa0', '#5b7daa', '#b58b50', '#9a8baa', '#6e9879'];
const adminState = { days: 30, data: null, charts: [], requestId: 0, controller: null };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function numericValue(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value) {
  const number = numericValue(value);
  return number == null ? '—' : new Intl.NumberFormat('zh-CN').format(number);
}

function formatDuration(seconds) {
  if (numericValue(seconds) == null) return '—';
  const value = Math.max(0, numericValue(seconds));
  if (value < 60) return `${Math.round(value)}秒`;
  return `${Math.floor(value / 60)}分${Math.round(value % 60)}秒`;
}

function formatDateTime(ts) {
  if (ts == null || ts === '' || !Number.isFinite(new Date(ts).getTime())) return '—';
  return new Date(ts).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function delta(current, previous, reverse = false) {
  current = numericValue(current);
  previous = numericValue(previous);
  if (current == null || previous == null) return { text: '对比数据待同步', cls: '' };
  if (!previous && !current) return { text: '暂无上期数据', cls: '' };
  if (!previous) return { text: '本期开始统计', cls: '' };
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const positive = reverse ? pct < 0 : pct > 0;
  const negative = reverse ? pct > 0 : pct < 0;
  return {
    text: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% 对比上期`,
    cls: positive ? 'good' : negative ? 'bad' : '',
  };
}

function renderFocusMetrics(data) {
  const today = data.today || {};
  const usage = data.leagueUsage || {};
  const day = /^\d{4}-\d{2}-\d{2}$/.test(today.date || '') ? today.date : '日期待同步';
  const historicalCaption = usage.historical?.imported === true ? '含历史补录'
    : usage.historical?.imported === false ? '历史尚未补录' : '历史补录状态待同步';
  const cards = [
    ['今日浏览量 · PV', formatNumber(today.pageviews), `${day} · 北京时间 00:00 至今`],
    ['今日用户 · UV', formatNumber(today.visitors), '匿名访客数，不是注册账户数'],
    ['累计使用联赛', formatNumber(usage.total), usage.trackingSince
      ? `${formatDateTime(usage.trackingSince)} 起统计 · ${historicalCaption} · 不随时段切换`
      : `等待首次联赛使用 · ${historicalCaption}`],
  ];
  $('#focusMetricGrid').innerHTML = cards.map(([label, value, caption]) => `<article class="focus-metric-card">
    <div class="metric-label">${escapeHtml(label)}</div><div class="metric-value">${escapeHtml(value)}</div>
    <p class="metric-caption">${escapeHtml(caption)}</p></article>`).join('');
  $('#todayScope').textContent = `今日指标：${day} 北京时间 00:00 至现在；用户按匿名访客识别，不是注册账户数。今日会话 ${formatNumber(today.sessions)} 次。`;
  const exclusions = data.exclusions || {};
  const since = exclusions.since ? `排除标记开始于 ${formatDateTime(exclusions.since)}` : '等待记录排除标记';
  $('#exclusionMeta').textContent = `${since} · 已识别本人匿名访客 ${formatNumber(exclusions.knownVisitors)} 个 · 所选 ${data.days} 天已排除浏览 ${formatNumber(exclusions.internalPageviews)} 次 / 事件 ${formatNumber(exclusions.internalEvents)} 次。`;
}

function renderLeagueUsage(data) {
  const usage = data.leagueUsage || {};
  const historical = usage.historical || {};
  $('#leagueUsageMeta').textContent = `累计 ${formatNumber(usage.total)} 个 · 累计打开 ${formatNumber(usage.opens)} 次 · 所选 ${data.days} 天使用 ${formatNumber(usage.period)} 个 · 今日使用 ${formatNumber(usage.today)} 个`;
  const since = usage.trackingSince ? `联赛使用记录开始于 ${formatDateTime(usage.trackingSince)}。` : '等待首次联赛使用。';
  const collector = usage.collectorSince ? `新埋点启用于 ${formatDateTime(usage.collectorSince)}。` : '新埋点启用时间待同步。';
  const historicalPeriod = historical.since && historical.until
    ? `（${formatDateTime(historical.since)} 至 ${formatDateTime(historical.until)}）` : '';
  const historyNote = historical.imported === true
    ? `历史已补录 ${formatNumber(historical.opens)} 次，涉及 ${formatNumber(historical.leagues)} 个联赛${historicalPeriod}。`
    : historical.imported === false ? '历史尚未补录。' : '历史补录状态待同步。';
  $('#leagueTrackingNote').textContent = `${since}${collector}新记录按成功打开工作台的使用事件统计，打开次数不是页面 PV。${historyNote}历史补录按网页打开 + 成功数据请求关联推断，排除已识别本人及机器人，不含 API 刷新，不保证历史完整；补录仅计联赛使用，不增加 PV / UV。`;
  const rows = Array.isArray(usage.rows) ? usage.rows.slice(0, 100) : [];
  $('#leagueUsageRows').innerHTML = rows.length ? rows.map((row) => {
    const rawId = String(row.leagueId ?? '');
    const safeId = /^\d{1,10}$/.test(rawId) && Number(rawId) > 0;
    const id = safeId ? `<a class="league-link" href="/?league=${rawId}" target="_blank" rel="noopener noreferrer">${rawId} ↗</a>` : escapeHtml(rawId || '—');
    return `<tr><td>${id}</td><td>${escapeHtml(row.name || '联赛名称待同步')}</td>
      <td class="numeric">${formatNumber(row.opens)}<br><small class="filter-note">其中历史 ${formatNumber(row.historicalOpens)} 次</small></td><td class="numeric">${formatNumber(row.visitors)}</td>
      <td>${escapeHtml(formatDateTime(row.lastSeen))}</td></tr>`;
  }).join('') : `<tr><td class="table-empty" colspan="5">${usage.trackingSince ? '保留日志内暂无联赛使用记录' : '等待首次联赛使用'}</td></tr>`;
}

function destroyCharts() {
  adminState.charts.forEach((chart) => chart.destroy());
  adminState.charts = [];
}

function chartDefaults() {
  return {
    color: '#667085',
    borderColor: '#e4e7ec',
    font: { family: '-apple-system, "PingFang SC", sans-serif', size: 11 },
  };
}

function createChart(id, config) {
  const element = $(`#${id}`);
  if (!element) return null;
  const chart = new Chart(element, config);
  adminState.charts.push(chart);
  return chart;
}

function renderMetrics(data) {
  const current = data.summary;
  const previous = data.previous;
  const metrics = [
    ['页面浏览量', formatNumber(current.pageviews), delta(current.pageviews, previous.pageviews)],
    ['独立访客', formatNumber(current.visitors), delta(current.visitors, previous.visitors)],
    ['会话数', formatNumber(current.sessions), delta(current.sessions, previous.sessions)],
    ['30 分钟活跃', formatNumber(current.activeVisitors), { text: '最近 30 分钟', cls: '' }],
    ['平均停留', formatDuration(current.avgDuration), delta(current.avgDuration, previous.avgDuration)],
    ['跳出率', numericValue(current.bounceRate) == null ? '—' : `${numericValue(current.bounceRate).toFixed(1)}%`, delta(current.bounceRate, previous.bounceRate, true)],
  ];
  $('#metricGrid').innerHTML = metrics.map(([label, value, change]) => `
    <article class="metric-card">
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric-value">${escapeHtml(value)}</div>
      <div class="metric-delta ${change.cls}">${escapeHtml(change.text)}</div>
    </article>`).join('');
}

function renderCharts(data) {
  destroyCharts();
  Chart.defaults.color = chartDefaults().color;
  Chart.defaults.font = chartDefaults().font;
  const commonScales = {
    x: { ticks: { color: '#667085' }, grid: { display: false } },
    y: { beginAtZero: true, ticks: { color: '#667085', precision: 0 }, grid: { color: '#e4e7ec' } },
  };

  createChart('trendChart', {
    type: 'line',
    data: {
      labels: data.trend.map((row) => row.date.slice(5)),
      datasets: [
        { label: '浏览量', data: data.trend.map((row) => row.pageviews), borderColor: ADMIN_COLORS[0], backgroundColor: 'rgba(36,107,88,.08)', fill: true, tension: .35, borderWidth: 2, pointRadius: 2 },
        { label: '访客', data: data.trend.map((row) => row.visitors), borderColor: ADMIN_COLORS[1], tension: .35, borderWidth: 2, pointRadius: 2 },
        { label: '会话', data: data.trend.map((row) => row.sessions), borderColor: ADMIN_COLORS[2], tension: .35, borderWidth: 1.5, pointRadius: 1 },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { boxWidth: 12 } } }, scales: commonScales },
  });

  createChart('moduleChart', {
    type: 'bar',
    data: { labels: data.modules.map((row) => row.label), datasets: [{ data: data.modules.map((row) => row.value), backgroundColor: '#4f46e5', borderRadius: 6 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: commonScales },
  });

  const sourceRows = data.sources.slice(0, 6);
  createChart('sourceChart', {
    type: 'doughnut',
    data: { labels: sourceRows.map((row) => row.label), datasets: [{ data: sourceRows.map((row) => row.value), backgroundColor: ADMIN_COLORS, borderColor: '#ffffff', borderWidth: 3 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '66%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 13 } } } },
  });

  createChart('deviceChart', {
    type: 'doughnut',
    data: { labels: data.devices.map((row) => row.label), datasets: [{ data: data.devices.map((row) => row.value), backgroundColor: [ADMIN_COLORS[1], ADMIN_COLORS[0], ADMIN_COLORS[3]], borderColor: '#ffffff', borderWidth: 3 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '66%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 13 } } } },
  });

  const calendar = data.matchdayCalendar || {};
  const counts = calendar.dayCounts || {};
  $('#hourChartNote').textContent = `北京时间 · 所选 ${data.days} 天的每小时累计浏览量（PV），非日均。比赛日按英超开球日期判定，非实时比赛中。比赛日 ${formatNumber(counts.matchday)} 天 / 非比赛日 ${formatNumber(counts.nonMatchday)} 天 / 待确认 ${formatNumber(counts.unknown)} 天。`
    + (!calendar.available ? ' 官方赛程暂不可用，访问量保留为待确认。' : calendar.stale ? ' 赛程更新失败，暂用上次赛程。' : '');
  const hourSeries = [
    { key: 'matchday', label: '比赛日', color: '#15803d', border: '#14532d' },
    { key: 'nonMatchday', label: '非比赛日', color: '#8b93f8', border: '#4f46e5' },
    { key: 'unknown', label: '待确认', color: '#b6bdc2', border: '#79848d' },
  ].filter(series => series.key !== 'unknown' || data.hourly.some(row => (row.unknown ?? row.value) > 0));
  $('#hourChart').setAttribute('role', 'img');
  $('#hourChart').setAttribute('aria-label', '按小时累计浏览量（PV）：' + data.hourly.map(row =>
    `${row.hour}时，比赛日 ${row.matchday ?? 0}，非比赛日 ${row.nonMatchday ?? 0}，待确认 ${row.unknown ?? row.value}`).join('；'));
  createChart('hourChart', {
    type: 'bar',
    data: { labels: data.hourly.map(row => `${String(row.hour).padStart(2, '0')}时`), datasets: hourSeries.map(series => ({
      label: series.label, data: data.hourly.map(row => row[series.key] ?? (series.key === 'unknown' ? row.value : 0)),
      backgroundColor: series.color, borderColor: series.border, borderWidth: 1,
    })) },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'top', labels: { boxWidth: 12 } }, tooltip: { callbacks: {
        footer: items => `合计 ${items.reduce((sum, item) => sum + item.parsed.y, 0)} PV`,
      } } }, scales: { x: { ...commonScales.x, stacked: true }, y: { ...commonScales.y, stacked: true, title: { display: true, text: '浏览量（PV）' } } } },
  });
}

function renderDetail(data) {
  $('#browserList').innerHTML = data.browsers.slice(0, 6).map((row) => `
    <span class="compact-item">${escapeHtml(row.label)} <b>${formatNumber(row.value)}</b></span>`).join('');
  $('#botNote').textContent = numericValue(data.filteredBots) == null ? '机器人过滤数据待同步' : data.filteredBots ? `已过滤 ${formatNumber(data.filteredBots)} 次机器人事件` : '未检测到机器人事件';
  $('#recentActivity').innerHTML = data.recent.length ? data.recent.map((row) => `
    <tr>
      <td>${escapeHtml(formatDateTime(row.ts))}</td>
      <td><span class="event-chip ${row.type === 'tab_view' ? 'tab' : ''}">${row.type === 'tab_view' ? '功能访问' : row.type === 'league_use' ? '打开联赛' : '进入页面'}</span></td>
      <td>${escapeHtml(row.module)}</td>
      <td>${escapeHtml(row.source)}</td>
      <td>${escapeHtml(`${row.device} · ${row.browser}`)}</td>
      <td>${escapeHtml(row.visitor)}</td>
    </tr>`).join('') : '<tr><td class="table-empty" colspan="6">暂无活动记录</td></tr>';
}

function renderDashboard(data) {
  data = { ...data, summary: data.summary || {}, previous: data.previous || {} };
  for (const key of ['trend', 'modules', 'sources', 'devices', 'hourly', 'browsers', 'recent']) {
    if (!Array.isArray(data[key])) data[key] = [];
  }
  adminState.data = data;
  $('#emptyState').classList.toggle('hidden', numericValue(data.summary.pageviews) !== 0);
  const since = data.trackingSince
    ? `统计开始于 ${new Date(data.trackingSince).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`
    : '统计已启用，等待首次访问';
  $('#trackingMeta').textContent = `${since} · 当前显示最近 ${data.days} 天 · 上海时区`;
  renderFocusMetrics(data);
  renderLeagueUsage(data);
  renderMetrics(data);
  renderCharts(data);
  renderDetail(data);
  decorateTables();
}

function showAnalyticsStatus(message, error = false) {
  const status = $('#analyticsStatus');
  status.textContent = message;
  status.classList.toggle('hidden', !message);
  status.classList.toggle('is-error', error);
  status.setAttribute('role', error ? 'alert' : 'status');
}

async function loadAnalytics() {
  const requestId = ++adminState.requestId;
  adminState.controller?.abort();
  const controller = new AbortController();
  adminState.controller = controller;
  const days = adminState.days;
  const button = $('#refreshAnalytics');
  button.disabled = true;
  button.textContent = '读取中…';
  showAnalyticsStatus(`正在读取最近 ${days} 天的数据…${adminState.data ? ` 暂时保留上次成功结果（最近 ${adminState.data.days} 天）。` : ''}`);
  try {
    const response = await fetch(`/api/admin/analytics?days=${days}`, { cache: 'no-store', signal: controller.signal });
    if (requestId !== adminState.requestId) return;
    if (response.status === 401) return showLogin();
    const data = await response.json();
    if (requestId !== adminState.requestId) return;
    if (!response.ok) throw new Error(data.error || '读取失败');
    if (!data || typeof data !== 'object' || Number(data.days) !== days) throw new Error('返回的统计时间范围不一致，请重试');
    renderDashboard(data);
    showAnalyticsStatus('');
  } catch (error) {
    if (requestId !== adminState.requestId || error.name === 'AbortError') return;
    showAnalyticsStatus(`读取最近 ${days} 天数据失败：${error.message}。${adminState.data ? `仍显示上次成功结果（最近 ${adminState.data.days} 天），未将失败当作零流量。` : '暂无可显示的统计结果，请刷新重试。'}`, true);
  } finally {
    if (requestId === adminState.requestId) {
      adminState.controller = null;
      button.disabled = false;
      button.textContent = '刷新';
    }
  }
}

function showLogin() {
  adminState.requestId++;
  adminState.controller?.abort();
  adminState.controller = null;
  $('#refreshAnalytics').disabled = false;
  $('#refreshAnalytics').textContent = '刷新';
  showAnalyticsStatus('');
  $('#loginView').classList.remove('hidden');
  $('#dashboardView').classList.add('hidden');
  $('#adminPassword').focus();
}

function showDashboard() {
  if (new URLSearchParams(location.search).get('section') === 'news') {
    location.replace('/admin/news');
    return;
  }
  $('#loginView').classList.add('hidden');
  $('#dashboardView').classList.remove('hidden');
  loadAnalytics();
}

$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#loginButton');
  button.disabled = true;
  $('#loginError').textContent = '';
  try {
    const response = await fetch('/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $('#adminPassword').value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '登录失败');
    $('#adminPassword').value = '';
    showDashboard();
  } catch (error) {
    $('#loginError').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$('#rangeSwitch').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-days]');
  if (!button) return;
  const days = Number(button.dataset.days);
  if (![7, 30, 90].includes(days)) return;
  adminState.days = days;
  $$('#rangeSwitch button').forEach((item) => item.classList.toggle('active', item === button));
  loadAnalytics();
});

$('#refreshAnalytics').addEventListener('click', loadAnalytics);
$('#logoutButton').addEventListener('click', async () => {
  adminState.requestId++;
  adminState.controller?.abort();
  try {
    const response = await fetch('/api/admin/logout', { method: 'POST' });
    if (!response.ok) throw new Error('退出失败，请重试');
    destroyCharts();
    adminState.data = null;
    showLogin();
  } catch (error) {
    showAnalyticsStatus(error.message, true);
    $('#refreshAnalytics').disabled = false;
    $('#refreshAnalytics').textContent = '刷新';
  }
});

(async function initAdmin() {
  try {
    const response = await fetch('/api/admin/session', { cache: 'no-store' });
    const session = await response.json();
    if (session.authenticated) showDashboard();
    else showLogin();
  } catch (e) {
    showLogin();
  }
})();

function decorateTables(){ $$('.activity-table').forEach(table=>{const labels=Array.from(table.querySelectorAll('th')).map(th=>th.textContent);table.querySelectorAll('tbody tr').forEach(row=>{Array.from(row.cells).forEach((cell,i)=>{cell.dataset.label=labels[i]||'';});});}); }
const sidebar=$('#admin-navigation'), shade=$('#adminShade'), menu=$('#adminMenu');
function closeAdminMenu(){sidebar.classList.remove('is-open');shade.classList.add('hidden');menu.setAttribute('aria-expanded','false');document.body.style.overflow='';if(sidebar.contains(document.activeElement))menu.focus();}
menu.addEventListener('click',()=>{sidebar.classList.add('is-open');shade.classList.remove('hidden');menu.setAttribute('aria-expanded','true');document.body.style.overflow='hidden';sidebar.querySelector('a').focus();});
shade.addEventListener('click',()=>{closeAdminMenu();menu.focus();});
$('#adminMenuClose').addEventListener('click',()=>{closeAdminMenu();menu.focus();});
sidebar.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{closeAdminMenu();if(a.hash){sidebar.querySelectorAll('.admin-nav-link').forEach(n=>n.classList.toggle('on',n===a));}}));
document.addEventListener('keydown',e=>{if(!sidebar.classList.contains('is-open'))return;if(e.key==='Escape'){closeAdminMenu();menu.focus();}if(e.key==='Tab'){const links=sidebar.querySelectorAll('a,button');if(e.shiftKey&&document.activeElement===links[0]){e.preventDefault();links[links.length-1].focus();}else if(!e.shiftKey&&document.activeElement===links[links.length-1]){e.preventDefault();links[0].focus();}}});
function updateAdminClock(){$('#adminClock').textContent='北京 '+new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});}
updateAdminClock();setInterval(updateAdminClock,60000);
