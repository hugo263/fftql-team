/* Mount the existing match centre inside the shared workbench navigation.
 * Shadow DOM isolates the two mature stylesheets without an iframe/extra pageview. */
(() => {
  'use strict';
  const host = document.getElementById('homeContent');
  if (!host) return;
  let active = false, pending = null, controller = null, root = null;
  let leagueSnapshot = null;
  let countdownTimer = null;
  function drawCountdowns() {
    const target = root?.getElementById('homeTradeCountdowns');
    if (!target || !window.FPLTradeCountdown) return;
    if (!leagueSnapshot?.tradeWindows?.length) { target.hidden = true; return; }
    target.hidden = false;
    const now = Date.now();
    target.innerHTML = ['open','close'].map(kind => window.FPLTradeCountdown.cardHtml(leagueSnapshot.tradeWindows,kind,now)).join('');
  }
  function scheduleCountdowns() {
    clearInterval(countdownTimer); countdownTimer = null;
    drawCountdowns();
    if (active && !document.hidden) countdownTimer = setInterval(drawCountdowns,1000);
  }
  const scripts = new Map();
  function script(src) {
    if (!scripts.has(src)) scripts.set(src, new Promise((resolve, reject) => {
      const node = document.createElement('script'); node.src = src;
      let settled = false;
      const finish = error => {
        if (settled) return; settled = true; clearTimeout(timeout);
        node.onload = node.onerror = null;
        if (error) { node.remove(); scripts.delete(src); reject(error); } else resolve();
      };
      const timeout = setTimeout(() => finish(Error('首页组件加载超时')), 20000);
      node.onload = () => finish();
      node.onerror = () => finish(Error('首页组件加载失败'));
      document.head.append(node);
    }));
    return scripts.get(src);
  }
  async function mount() {
    if (controller) return controller;
    if (pending) return pending;
    pending = (async () => {
      // Download independent modules beside the template, not one after another.
      // Attach rejection handling now so a failed template cannot leave an
      // unhandled module promise. Match centre consumes both dependencies below.
      const modules = Promise.all([script('/match-centre-share.js?v=105'), script('/live-render.js?v=79')])
        .then(() => script('/match-centre.js?v=105')).then(() => null, error => error);
      const response = await fetch('/discover.html?v=106', { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw Error('首页内容暂时无法加载');
      const template = new DOMParser().parseFromString(await response.text(), 'text/html');
      const main = template.querySelector('main');
      if (!main?.querySelector('#matches') || !main.querySelector('#feed')) throw Error('首页内容不完整');
      root = host.shadowRoot || host.attachShadow({ mode: 'open' });
      root.replaceChildren();
      // Import only trusted, same-origin content nodes. Never run template scripts,
      // duplicate analytics, or add its standalone header/footer.
      for (const href of ['/match-centre.css?v=63', '/home-tab.css?v=66', '/match-centre-layout.css?v=90', '/night-tokens.css?v=91', '/trade-countdown.css?v=97', '/night-match.css?v=95', '/night-ui.css?v=106', '/light-surfaces.css?v=105', '/responsive.css?v=105']) {
        const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = href; root.append(style);
      }
      main.querySelector('h1').textContent = '比赛中心';
      const countdowns = document.createElement('div');
      countdowns.id = 'homeTradeCountdowns'; countdowns.className = 'trade-countdowns';
      countdowns.setAttribute('aria-label','自由市场开放与阵容截止倒计时'); countdowns.hidden = true;
      main.querySelector('.round-bar').before(countdowns);
      root.append(document.importNode(main, true));
      scheduleCountdowns();
      template.querySelectorAll('dialog').forEach(dialog => root.append(document.importNode(dialog, true)));
      const enterLeague = root.getElementById('recentLeagueLink');
      enterLeague?.addEventListener('click', event => {
        event.preventDefault(); document.querySelector('#tabs [data-tab="weekly"]').click();
      });
      const moduleError = await modules;
      if (moduleError) throw moduleError;
      controller = window.TQLMatchCentre.mount(root);
      if (leagueSnapshot) controller.setLeagueSnapshot(leagueSnapshot);
      controller.setActive(active);
      host.querySelector('.home-loading')?.remove();
      return controller;
    })().catch(error => {
      const target = root || host;
      target.replaceChildren();
      const message = document.createElement('p'); message.textContent = `${error.message}，请重试。`;
      const retry = document.createElement('button'); retry.textContent = '重新加载首页';
      retry.addEventListener('click', () => mount()); target.append(message, retry);
      return null;
    }).finally(() => { pending = null; });
    return pending;
  }
  function show(value) {
    active = Boolean(value);
    scheduleCountdowns();
    if (controller) controller.setActive(active);
    else if (active) mount();
    // League-loading feedback belongs to league modules, not the independent homepage.
    if (active) document.getElementById('initialLoadNotice')?.setAttribute('hidden', '');
  }
  window.TQLHome = { show, isActive: () => active, setLeagueSnapshot(snapshot) {
    leagueSnapshot = snapshot;
    drawCountdowns();
    controller?.setLeagueSnapshot(snapshot);
  }, async refresh() {
    const view = await mount(); if (!view) throw Error('首页组件未能加载');
    return view.refresh();
  } };
  document.addEventListener('visibilitychange',scheduleCountdowns);
  show(document.querySelector('#tabs .tab.active')?.dataset.tab === 'home');
})();
