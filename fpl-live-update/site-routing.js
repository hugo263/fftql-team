'use strict';

// Local previews keep existing /?league= links intact. The portal has its own
// /portal route; in production it becomes fftql.team's root, not Draft's root.
const PORTAL_HOSTS = new Set(['fftql.team', 'www.fftql.team']);
function pageRoute(url) {
  const main = PORTAL_HOSTS.has(url.hostname.toLowerCase());
  const root = url.pathname === '/' || url.pathname === '/index.html';
  if (main && (root || /^\/discover\/?$/.test(url.pathname)) && url.searchParams.has('league')) {
    // Preserve existing league bookmarks until the new subdomain has DNS/TLS.
    return { file: '/index.html' };
  }
  if (url.pathname === '/portal' || url.pathname === '/portal/' || url.pathname === '/portal.html'
    || (main && root)) return { file: '/portal.html' };
  if (/^\/discover\/?$/.test(url.pathname)) return { redirect: main ? '/#news' : `/${url.search}#home` };
  if (url.pathname === '/draft' || url.pathname === '/draft/') return main
    ? { file: '/index.html' } : { redirect: `/${url.search}#home` };
  return {};
}
module.exports = { pageRoute };
