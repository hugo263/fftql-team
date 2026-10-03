'use strict';

// Only published, anonymous reads. Never forward visitor cookies to the news
// service, or allow a path/origin supplied by the reader to reach its admin API.
const PUBLIC_PATH = /^\/api\/news\/(?:timeline|pool|fpl\/prices|items\/[a-zA-Z0-9_-]{1,80})$/;
function createNewsProxy({ origin = process.env.TQL_NEWS_PUBLIC_ORIGIN || 'http://127.0.0.1:9011', fetcher = fetch } = {}) {
  const base = new URL(origin);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw Error('Invalid news service origin');
  return async (req, res, url) => {
    const fail = (status, message, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
      res.end(JSON.stringify({ error: message }));
    };
    if (!PUBLIC_PATH.test(url.pathname)) return fail(404, 'Public news endpoint not found');
    if (!['GET', 'HEAD'].includes(req.method)) return fail(405, 'GET only', { Allow: 'GET, HEAD' });
    if (url.search.length > 2048) return fail(400, 'Query too long');
    try {
      const target = new URL(url.pathname.replace('/api/news/', '/api/site/') + url.search, base);
      const headers = { Accept: 'application/json' };
      if (req.headers['if-none-match']) headers['If-None-Match'] = req.headers['if-none-match'];
      const upstream = await fetcher(target, { method: req.method, headers, redirect: 'error', signal: AbortSignal.timeout(8000) });
      const output = { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': upstream.headers.get('cache-control') || 'no-store' };
      for (const name of ['etag', 'retry-after', 'x-accel-expires']) if (upstream.headers.has(name)) output[name] = upstream.headers.get(name);
      if (upstream.status === 304 || req.method === 'HEAD') {
        res.writeHead(upstream.status, output); res.end(); return;
      }
      if (!upstream.headers.get('content-type')?.includes('application/json')) return fail(502, 'News response unavailable');
      if (Number(upstream.headers.get('content-length')) > 2_000_000) return fail(502, 'News response too large');
      let size = 0; const chunks = [];
      for await (const chunk of upstream.body) {
        size += chunk.length;
        if (size > 2_000_000) { await upstream.body.cancel().catch(() => {}); return fail(502, 'News response too large'); }
        chunks.push(Buffer.from(chunk));
      }
      if (res.destroyed) return;
      res.writeHead(upstream.status, output); res.end(Buffer.concat(chunks));
    } catch (_) { if (!res.destroyed) fail(503, 'News temporarily unavailable', { 'Retry-After': '10' }); }
  };
}
module.exports = { createNewsProxy, PUBLIC_PATH };
