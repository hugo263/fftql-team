'use strict';
const crypto = require('crypto');

// Host-only cookies stay unchanged. A one-use POST ticket bridges the two admin modules.
function adminNewsResponse(authenticated, sessionExp, secret, now = Date.now()) {
  const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' };
  if (!authenticated) return { status: 302, headers: { ...headers, Location: '/admin?section=news' }, body: '' };
  if (typeof secret !== 'string' || secret.length < 32 || !Number.isSafeInteger(sessionExp) || sessionExp <= now || sessionExp > now + 7 * 86400_000) {
    return { status: 503, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' }, body: '<meta charset="utf-8"><p>资讯后台登录尚未配置，请稍后再试。</p><a href="/admin">返回管理后台</a>' };
  }
  const payload = Buffer.from(JSON.stringify({ iss: 'https://fftql.team', aud: 'https://news.fftql.team', sub: 'tql-admin', iat: now, exp: now + 60_000, sessionExp, jti: crypto.randomBytes(16).toString('hex') })).toString('base64url');
  const ticket = `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`;
  const nonce = crypto.randomBytes(16).toString('base64url');
  headers['Content-Type'] = 'text/html; charset=utf-8';
  headers['Content-Security-Policy'] = `default-src 'none'; script-src 'nonce-${nonce}'; form-action https://news.fftql.team; base-uri 'none'; frame-ancestors 'none'`;
  return { status: 200, headers, body: `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>进入资讯管理 · TQL</title><p>正在进入资讯管理…</p><form method="post" action="https://news.fftql.team/api/auth/draft-sso"><input type="hidden" name="ticket" value="${ticket}"><button type="submit">进入资讯管理</button></form><script nonce="${nonce}">document.querySelector('form').submit()</script></html>` };
}
module.exports = { adminNewsResponse };
