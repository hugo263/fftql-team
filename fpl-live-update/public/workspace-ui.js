/* Accessible workbench navigation. Data refresh is owned by app.js. */
(() => {
  const tabs = [...document.querySelectorAll('#tabs .tab')];
  const tablist = document.querySelector('#tabs');
  tablist.setAttribute('aria-label', 'Draft 联赛功能');
  const groups = [...tablist.querySelectorAll('.nav-group')];
  const secondary = [...tablist.querySelectorAll('.nav-secondary')];
  const remembered = new Map();
  tablist.querySelector('.nav-primary').setAttribute('role','tablist');
  groups.forEach(button=>button.setAttribute('role','tab'));
  secondary.forEach(list => { list.setAttribute('role','tablist'); list.setAttribute('aria-label',groups.find(g=>g.dataset.group===list.dataset.navGroup)?.textContent || '子功能'); });
  tabs.forEach((tab) => {
    tab.id = `nav-${tab.dataset.tab}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `tab-${tab.dataset.tab}`);
    const panel = document.getElementById(`tab-${tab.dataset.tab}`);
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
  });
  const syncTabs = () => { tabs.forEach((tab) => {
    const active = tab.classList.contains('active');
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  });
    const active = tabs.find(tab=>tab.classList.contains('active'));
    const group = active?.closest('.nav-secondary')?.dataset.navGroup;
    if(group) remembered.set(group,active);
    secondary.forEach(list=>{list.hidden=list.dataset.navGroup!==group;});
    groups.forEach(button=>{const selected=button.dataset.group===group;button.classList.toggle('active',selected);button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;const leaf=remembered.get(button.dataset.group)||secondary.find(list=>list.dataset.navGroup===button.dataset.group)?.querySelector('.tab');button.setAttribute('aria-controls',`tab-${leaf.dataset.tab}`);});
  };
  tablist.addEventListener('click', (event) => {
    const group = event.target.closest('.nav-group');
    if(group) { const list=secondary.find(list=>list.dataset.navGroup===group.dataset.group); (remembered.get(group.dataset.group)||list?.querySelector('.tab'))?.click(); return; }
    const tab = event.target.closest('.tab');
    if (!tab) return;
    syncTabs();
    history.replaceState(null, '', `${location.pathname}${location.search}#${tab.dataset.tab}`);
    if (innerWidth < 781) tab.scrollIntoView({block:'nearest', inline:'nearest'});
  });
  tablist.addEventListener('keydown', (event) => {
    const currentList = document.activeElement.closest('.nav-primary,.nav-secondary');
    const visibleTabs = currentList ? [...currentList.querySelectorAll('button')] : [];
    const current = visibleTabs.indexOf(document.activeElement);
    if (current < 0 || !['ArrowRight','ArrowLeft','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? visibleTabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + visibleTabs.length) % visibleTabs.length;
    visibleTabs[next].click();
    visibleTabs[next].focus();
  });
  syncTabs();
  // Brand navigation goes to the site portal; #home still means Draft match centre.
  window.addEventListener('hashchange', () => {
    const target = tabs.find(tab => tab.dataset.tab === location.hash.slice(1));
    if (target && !target.classList.contains('active')) target.click();
  });
  document.querySelector('#squadModal').setAttribute('role','dialog');
  document.querySelector('#squadModal').setAttribute('aria-modal','true');
  document.querySelector('#squadModal').setAttribute('aria-labelledby','squadModalTitle');
  document.querySelector('#squadModalClose').setAttribute('aria-label','关闭阵容');
})();
