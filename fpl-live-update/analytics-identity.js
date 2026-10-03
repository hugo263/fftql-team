'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const INTERNAL_COOKIE = 'fpl_analytics_internal';
const MARKER_MAX_AGE = 400 * 24 * 60 * 60;
const ID_PATTERN = /^[a-f0-9]{20}$/;

// This marker only removes traffic from analytics. It never authenticates an
// admin, and its signature uses a different domain from admin-session tokens.
function createInternalTrafficStore({ filePath, secret, now = Date.now }) {
  let state;
  function read() {
    if (state) return state;
    if (!fs.existsSync(filePath)) return (state = { version: 1, since: null, visitorIds: [] });
    const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (saved.version !== 1 || !Array.isArray(saved.visitorIds)
      || saved.visitorIds.some((id) => !ID_PATTERN.test(id))) {
      throw new Error('管理员流量排除记录格式无效，请检查统计数据文件');
    }
    state = { version: 1, since: Number(saved.since) || null, visitorIds: [...new Set(saved.visitorIds)] };
    return state;
  }

  function remember(visitorId) {
    if (!ID_PATTERN.test(visitorId)) throw new Error('Invalid anonymous visitor ID');
    const existing = read();
    if (existing.visitorIds.includes(visitorId)) return;
    const next = { version: 1, since: existing.since || now(), visitorIds: [...existing.visitorIds, visitorId] };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(next), { mode: 0o600 });
    fs.renameSync(temp, filePath);
    state = next;
  }

  function signature(payload) {
    return crypto.createHmac('sha256', secret).update(`analytics-internal-v1:${payload}`).digest('base64url');
  }

  function issueMarker() {
    if (!secret) throw new Error('Admin session secret unavailable');
    const payload = Buffer.from(JSON.stringify({ purpose: 'analytics-internal', exp: now() + MARKER_MAX_AGE * 1000,
      nonce: crypto.randomBytes(12).toString('hex') })).toString('base64url');
    return `${payload}.${signature(payload)}`;
  }

  function verifyMarker(token) {
    if (!secret || typeof token !== 'string' || token.length > 1024) return false;
    const [payload, provided, extra] = token.split('.');
    if (!payload || !/^[A-Za-z0-9_-]{43}$/.test(provided || '') || extra !== undefined) return false;
    const expected = signature(payload);
    if (provided.length !== expected.length
      || !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return false;
    try {
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return decoded.purpose === 'analytics-internal' && Number.isFinite(decoded.exp)
        && decoded.exp > now() && decoded.exp <= now() + MARKER_MAX_AGE * 1000;
    } catch (_) { return false; }
  }

  return { remember, issueMarker, verifyMarker, getState: () => ({ ...read(), visitorIds: [...read().visitorIds] }) };
}

module.exports = { createInternalTrafficStore, INTERNAL_COOKIE, MARKER_MAX_AGE };
