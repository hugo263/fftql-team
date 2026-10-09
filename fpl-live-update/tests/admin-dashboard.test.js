'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const adminHtml = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(__dirname, '../public/admin.js'), 'utf8');

function payload(days = 30, overrides = {}) {
  return {
    days, trackingSince: '2026-09-07T01:00:00Z',
    summary: { pageviews: 99, visitors: 28, sessions: 38, activeVisitors: 3, avgDuration: 72, bounceRate: 24.5 },
    previous: { pageviews: 80, visitors: 20, sessions: 30, avgDuration: 60, bounceRate: 30 },
    today: { date: '2026-09-08', start: '2026-09-07T16:00:00Z', end: '2026-09-08T08:00:00Z', pageviews: 13, visitors: 4, sessions: 6 },
    leagueUsage: { total: 7, opens: 25, period: 3, today: 2, trackingSince: '2026-09-07T01:00:00Z', collectorSince: '2026-09-07T01:00:00Z', legacyPageviews: 41,
      historical: { imported: false, opens: 0, leagues: 0, since: null, until: null, method: 'document-and-successful-data-request' },
      rows: [{ leagueId: 47275, name: 'Example Draft', opens: 11, historicalOpens: 0, visitors: 5, firstSeen: '2026-09-07T01:00:00Z', lastSeen: '2026-09-08T08:00:00Z' }] },
    exclusions: { since: '2026-09-07T03:00:00Z', internalEvents: 25, internalPageviews: 8, knownVisitors: 2 },
    trend: [{ date: '2026-09-08', pageviews: 13, visitors: 4, sessions: 6 }],
    modules: [], sources: [], devices: [], hourly: [], browsers: [], recent: [], filteredBots: 0,
    ...overrides,
  };
}

async function harness() {
  const elements = new Map();
  const requests = [];
  const chartCalls = [];
  class Element {
    constructor() {
      this.innerHTML = ''; this.textContent = ''; this.disabled = false; this.listeners = new Map(); this.classes = new Set(); this.attributes = new Map();
      this.classList = { contains: value => this.classes.has(value), add: value => this.classes.add(value), remove: value => this.classes.delete(value), toggle: (value, show) => show ? this.classes.add(value) : this.classes.delete(value) };
    }
    addEventListener(name, fn) { this.listeners.set(name, fn); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    focus() { this.focused = true; }
    closest() { return this; }
    querySelectorAll() { return []; }
    querySelector() { return new Element(); }
    contains() { return false; }
  }
  for (const match of adminHtml.matchAll(/\bid="([^"]+)"/g)) elements.set(`#${match[1]}`, new Element());
  const ranges = [7, 30, 90].map(days => { const button = new Element(); button.dataset = { days: String(days) }; return button; });
  class Chart {
    static defaults = {};
    constructor(element, config) { this.config = config; this.element = element; chartCalls.push(this); }
    destroy() { this.destroyed = true; }
  }
  const context = vm.createContext({ Intl, Date, AbortController, Chart, URLSearchParams, location: { search: '' }, setInterval() {},
    document: {
      body: { style: {} }, addEventListener() {},
      querySelector(selector) { assert.ok(elements.has(selector), `real HTML provides ${selector}`); return elements.get(selector); },
      querySelectorAll(selector) { return selector === '#rangeSwitch button' ? ranges : []; },
    },
    fetch(url, options) {
      if (url === '/api/admin/session') return Promise.resolve({ json: async () => ({ authenticated: false }) });
      return new Promise(resolve => requests.push({ url, options, resolve }));
    },
  });
  vm.runInContext(adminJs, context);
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  await flush();
  return {
    context, requests, chartCalls, element: id => elements.get(`#${id}`),
    render: data => context.renderDashboard(data),
    load: () => context.loadAnalytics(),
    show: () => context.showDashboard(),
    range: days => elements.get('#rangeSwitch').listeners.get('click')({ target: ranges.find(button => Number(button.dataset.days) === days) }),
    reply: async (index, data, status = 200) => { requests[index].resolve({ ok: status >= 200 && status < 300, status, json: async () => data }); await flush(); },
  };
}

test('admin assets are cache-busted and the three focus metrics precede selected-period analytics', () => {
  assert.match(adminHtml, /admin\.css\?v=20261002a/);
  assert.match(adminHtml, /admin\.js\?v=20261008c/);
  assert.ok(adminHtml.indexOf('id="focusMetricGrid"') < adminHtml.indexOf('id="metricGrid"'));
  assert.ok(adminHtml.indexOf('id="focusMetricGrid"') < adminHtml.indexOf('id="rangeSwitch"'));
  assert.match(adminHtml, /打开次数/);
  assert.match(adminHtml, /其他设备或浏览器需登录后台一次/);
  assert.match(adminHtml, /不能保证全部历史都已排除/);
  assert.ok(!adminHtml.includes('无法回填'));
});

test('hour chart preserves PV as labeled matchday/non-matchday/unknown stacked bars', async () => {
  const h = await harness();
  h.render(payload(7, { hourly: [{ hour: 0, value: 9, matchday: 5, nonMatchday: 3, unknown: 1 }],
    matchdayCalendar: { available: true, dayCounts: { matchday: 2, nonMatchday: 4, unknown: 1 } } }));
  const chart = h.chartCalls.at(-1).config;
  assert.equal(chart.type, 'bar'); assert.equal(chart.options.scales.y.beginAtZero, true);
  assert.equal(chart.options.scales.y.stacked, true);
  assert.deepEqual(Array.from(chart.data.datasets, d => d.label), ['比赛日', '非比赛日', '待确认']);
  assert.equal(chart.data.datasets.reduce((sum,d) => sum + d.data[0],0), 9);
  assert.equal(new Set(chart.data.datasets.map(d => d.backgroundColor)).size, 3);
  assert.match(h.element('hourChartNote').textContent, /累计浏览量（PV），非日均/);
  assert.match(h.element('hourChartNote').textContent, /比赛日 2 天/);
});

test('today PV/UV and cumulative leagues stay independent from the selected period; definitions are explicit', async () => {
  const h = await harness();
  h.render(payload());
  const focus = h.element('focusMetricGrid').innerHTML;
  assert.equal((focus.match(/class="focus-metric-card"/g) || []).length, 3);
  for (const value of [13, 4, 7]) assert.ok(focus.includes(`class="metric-value">${value}</div>`));
  assert.match(focus, /起统计 · 历史尚未补录 · 不随时段切换/);
  assert.match(h.element('metricGrid').innerHTML, />99<\/div>/);
  assert.match(h.element('todayScope').textContent, /2026-09-08 北京时间 00:00 至现在/);
  assert.match(h.element('todayScope').textContent, /不是注册账户数/);
  assert.match(h.element('leagueUsageMeta').textContent, /所选 30 天使用 3 个/);
  assert.match(h.element('leagueUsageMeta').textContent, /累计打开 25 次/);
  assert.match(h.element('leagueTrackingNote').textContent, /打开次数不是页面 PV/);
  assert.match(h.element('leagueTrackingNote').textContent, /历史尚未补录/);
  assert.match(h.element('exclusionMeta').textContent, /已识别本人匿名访客 2 个/);
  assert.match(h.element('exclusionMeta').textContent, /已排除浏览 8 次 \/ 事件 25 次/);
  h.render(payload(7, { summary: { pageviews: 9 }, leagueUsage: { ...payload().leagueUsage, period: 1 } }));
  assert.equal(h.element('focusMetricGrid').innerHTML, focus);
  assert.match(h.element('metricGrid').innerHTML, />9<\/div>/);
  assert.match(h.element('leagueUsageMeta').textContent, /所选 7 天使用 1 个/);
  assert.equal(h.chartCalls.length, 10);
  assert.ok(h.chartCalls.slice(0, 5).every(chart => chart.destroyed), 'period chart refresh disposes old chart instances');
});

test('null metrics remain unknown, real zeros remain zero, and first league usage never gets a fabricated date', async () => {
  const h = await harness();
  h.render(payload(30, { today: { date: null, pageviews: null, visitors: 0, sessions: null }, summary: { pageviews: null, bounceRate: null }, previous: {},
    leagueUsage: { total: null, trackingSince: null, legacyPageviews: null, rows: [] }, exclusions: {} }));
  const focus = h.element('focusMetricGrid').innerHTML;
  assert.equal((focus.match(/class="metric-value">—<\/div>/g) || []).length, 2);
  assert.equal((focus.match(/class="metric-value">0<\/div>/g) || []).length, 1);
  assert.match(focus, /等待首次联赛使用/);
  assert.match(h.element('leagueTrackingNote').textContent, /^等待首次联赛使用。/);
  assert.match(h.element('leagueUsageRows').innerHTML, /等待首次联赛使用/);
  assert.ok(!h.element('leagueTrackingNote').textContent.includes('1970'));
  assert.ok(!h.element('metricGrid').innerHTML.includes('NaN'));
  assert.ok(h.element('emptyState').classes.has('hidden'), 'unavailable PV is not the zero-traffic empty state');
  assert.equal(h.context.formatNumber(null), '—');
  assert.equal(h.context.formatNumber(undefined), '—');
  assert.equal(h.context.formatNumber(false), '—');
  assert.equal(h.context.formatNumber(NaN), '—');
  assert.equal(h.context.formatNumber(0), '0');
});

test('league usage table displays opens, safe workbench links, escaped names and at most 100 rows', async () => {
  const h = await harness();
  const rows = Array.from({ length: 101 }, (_, index) => ({ leagueId: 1000 + index, name: index === 0 ? '<img src=x onerror=bad()>' : `League ${index}`, opens: index, visitors: 1, lastSeen: null }));
  h.render(payload(30, { leagueUsage: { ...payload().leagueUsage, rows } }));
  const html = h.element('leagueUsageRows').innerHTML;
  assert.equal((html.match(/<tr>/g) || []).length, 100);
  assert.match(html, /href="\/\?league=1000" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /&lt;img src=x onerror=bad\(\)&gt;/);
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('league=1100'));
  h.render(payload(30, { leagueUsage: { rows: [{ leagueId: 'javascript:bad()', name: 'Bad ID', opens: null, visitors: null }] } }));
  assert.ok(!h.element('leagueUsageRows').innerHTML.includes('href='));
  assert.match(h.element('leagueUsageRows').innerHTML, /numeric">—<\/td>/);
});

test('historical league usage shows authoritative totals, inference dates and per-league historical opens without adding PV or UV', async () => {
  const h = await harness();
  h.render(payload());
  const originalMetrics = h.element('metricGrid').innerHTML;
  const originalToday = h.element('todayScope').textContent;
  const originalCharts = JSON.stringify(h.chartCalls.map(chart => chart.config.data));
  const since = Date.parse('2026-09-01T04:00:00Z');
  const until = Date.parse('2026-09-06T08:00:00Z');
  const collectorSince = Date.parse('2026-09-07T01:00:00Z');
  h.render(payload(30, { leagueUsage: {
    ...payload().leagueUsage, total: 9, opens: 73, trackingSince: since, collectorSince,
    historical: { imported: true, opens: 60, leagues: 6, since, until, method: 'document-and-successful-data-request' },
    rows: [{ leagueId: 47275, name: 'Example Draft', opens: 33, historicalOpens: 22, visitors: 8, lastSeen: collectorSince }],
  } }));
  const focus = h.element('focusMetricGrid').innerHTML;
  assert.match(focus, /class="metric-value">9<\/div>/);
  assert.match(focus, /起统计 · 含历史补录 · 不随时段切换/);
  assert.ok(focus.includes(h.context.formatDateTime(since)));
  assert.match(h.element('leagueUsageMeta').textContent, /累计 9 个 · 累计打开 73 次/);
  assert.ok(!h.element('leagueUsageMeta').textContent.includes('133'), 'API total already includes historical opens');
  const note = h.element('leagueTrackingNote').textContent;
  assert.match(note, /历史已补录 60 次，涉及 6 个联赛/);
  assert.ok(note.includes(`新埋点启用于 ${h.context.formatDateTime(collectorSince)}`));
  assert.ok(note.includes(`${h.context.formatDateTime(since)} 至 ${h.context.formatDateTime(until)}`));
  assert.match(note, /网页打开 \+ 成功数据请求关联推断/);
  assert.match(note, /排除已识别本人及机器人，不含 API 刷新，不保证历史完整/);
  assert.match(note, /补录仅计联赛使用，不增加 PV \/ UV/);
  assert.ok(!note.includes('无法回填'));
  assert.match(h.element('leagueUsageRows').innerHTML, /numeric">33<br><small class="filter-note">其中历史 22 次<\/small>/);
  assert.equal(h.element('metricGrid').innerHTML, originalMetrics);
  assert.equal(h.element('todayScope').textContent, originalToday);
  assert.equal(JSON.stringify(h.chartCalls.slice(5).map(chart => chart.config.data)), originalCharts);
});

test('not-yet-imported, imported-zero and missing historical counts stay distinct without fabricated dates or zeros', async () => {
  const h = await harness();
  h.render(payload());
  assert.match(h.element('leagueTrackingNote').textContent, /历史尚未补录/);
  assert.match(h.element('leagueUsageRows').innerHTML, /其中历史 0 次/);
  h.render(payload(30, { leagueUsage: { ...payload().leagueUsage, opens: null, collectorSince: null,
    historical: { imported: true, opens: 0, leagues: 0, since: null, until: null },
    rows: [{ leagueId: 47275, opens: 0, historicalOpens: null, visitors: null }],
  } }));
  assert.match(h.element('leagueUsageMeta').textContent, /累计打开 — 次/);
  assert.match(h.element('leagueTrackingNote').textContent, /新埋点启用时间待同步/);
  assert.match(h.element('leagueTrackingNote').textContent, /历史已补录 0 次，涉及 0 个联赛。/);
  assert.ok(!h.element('leagueTrackingNote').textContent.includes('1970'));
  assert.ok(!h.element('leagueTrackingNote').textContent.includes('历史尚未补录'));
  assert.match(h.element('leagueUsageRows').innerHTML, /numeric">0<br><small class="filter-note">其中历史 — 次/);
  h.render(payload(30, { leagueUsage: { total: null, rows: [] } }));
  assert.match(h.element('leagueTrackingNote').textContent, /历史补录状态待同步/);
  assert.ok(!h.element('leagueTrackingNote').textContent.includes('历史已补录 0'));
});

test('latest range wins even if the older response arrives later; the old finally cannot unlock an active refresh', async () => {
  const h = await harness();
  h.show();
  assert.match(h.requests[0].url, /days=30$/);
  h.range(7);
  assert.match(h.requests[1].url, /days=7$/);
  assert.equal(h.requests[0].options.signal.aborted, true);
  await h.reply(0, payload(30));
  assert.equal(h.element('refreshAnalytics').disabled, true);
  assert.equal(h.element('metricGrid').innerHTML, '');
  await h.reply(1, payload(7, { summary: { pageviews: 7 } }));
  assert.match(h.element('trackingMeta').textContent, /当前显示最近 7 天/);
  assert.equal(h.element('refreshAnalytics').disabled, false);
  assert.match(h.element('metricGrid').innerHTML, />7<\/div>/);
  assert.ok(h.element('analyticsStatus').classes.has('hidden'));
});

test('a stale unauthorized response cannot close the dashboard after a newer successful range', async () => {
  const h = await harness();
  h.show(); h.range(90);
  await h.reply(1, payload(90));
  await h.reply(0, { error: 'Unauthorized' }, 401);
  assert.ok(!h.element('dashboardView').classes.has('hidden'));
  assert.match(h.element('trackingMeta').textContent, /最近 90 天/);
});

test('failed range request retains all successful data and visibly identifies the displayed old range', async () => {
  const h = await harness();
  h.show();
  await h.reply(0, payload());
  const focus = h.element('focusMetricGrid').innerHTML;
  const metrics = h.element('metricGrid').innerHTML;
  const rows = h.element('leagueUsageRows').innerHTML;
  h.range(7);
  await h.reply(1, { error: '暂时不可用' }, 503);
  assert.equal(h.element('focusMetricGrid').innerHTML, focus);
  assert.equal(h.element('metricGrid').innerHTML, metrics);
  assert.equal(h.element('leagueUsageRows').innerHTML, rows);
  assert.ok(h.element('analyticsStatus').classes.has('is-error'));
  assert.match(h.element('analyticsStatus').textContent, /读取最近 7 天数据失败/);
  assert.match(h.element('analyticsStatus').textContent, /仍显示上次成功结果（最近 30 天）/);
  assert.equal(h.element('analyticsStatus').attributes.get('role'), 'alert');
  assert.equal(h.chartCalls.length, 5, 'failure cannot clear successful chart data');
});

test('a mismatched response range is rejected instead of showing incorrect filtered data', async () => {
  const h = await harness();
  h.range(7);
  await h.reply(0, payload(30));
  assert.equal(h.element('metricGrid').innerHTML, '');
  assert.match(h.element('analyticsStatus').textContent, /统计时间范围不一致/);
  assert.match(h.element('analyticsStatus').textContent, /暂无可显示的统计结果/);
});
