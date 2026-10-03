/* Navigation only. Never changes league data, auth, SSE or hash contracts. */
(() => {
  'use strict';
  const local = ['localhost','127.0.0.1','[::1]'].includes(location.hostname);
  const portal = local ? '/portal' : 'https://fftql.team/';
  const draft = local ? location.origin : location.hostname === 'draft.fftql.team' ? location.origin : 'https://fftql.team/draft';
  const raw = new URLSearchParams(location.search).get('league');
  const valid = value => /^\d{1,10}$/.test(value || '') && Number(value) > 0 ? String(Number(value)) : null;
  let id = valid(raw);
  try {
    if (id) localStorage.setItem('tql:portal:recent-league',id);
    else id = valid(localStorage.getItem('tql:portal:recent-league'));
  } catch (_) { /* Optional preference, navigation still works. */ }
  document.querySelectorAll('[data-portal-link]').forEach(link => { link.href = portal + (link.dataset.portalLink || ''); });
  document.querySelectorAll('[data-workbench-link]').forEach(link => {
    link.href = document.documentElement.classList.contains('night-workspace')
      ? `${location.pathname}${location.search}#${link.dataset.workbenchLink || 'home'}`
      : `${draft}/${id ? `?league=${encodeURIComponent(id)}` : ''}#${link.dataset.workbenchLink || 'home'}`;
  });
  document.querySelectorAll('[data-share-styles-link]').forEach(link => { link.href = `${local ? '' : 'https://fftql.team'}/share-styles.html`; });
  const leagueSwitch = document.getElementById('draftLeagueSwitch');
  if (leagueSwitch) {
    const desktop = matchMedia('(min-width: 1200px)');
    leagueSwitch.open = desktop.matches;
    desktop.addEventListener('change', event => { leagueSwitch.open = event.matches; });
  }
  const form = document.querySelector('.draft-entry-form');
  const input = document.getElementById('headerLeagueId');
  if (form && input) {
    form.action = `${draft}/`;
    if (id) input.value = id;
    form.addEventListener('submit', event => {
      const nextId = valid(input.value);
      if (!nextId) return; // Native required/pattern validation keeps invalid IDs out.
      event.preventDefault();
      try { localStorage.setItem('tql:portal:recent-league', nextId); } catch (_) { /* Optional preference. */ }
      location.assign(`${draft}/?league=${encodeURIComponent(nextId)}#home`);
    });
  }
})();
