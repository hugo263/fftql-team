'use strict';

// Historical inference, not browser-side measurement: a successful document
// followed by its matching successful data request is evidence of an open.
// The caller must supply only this site's logs and the collector's start time.
// Never write, return or print original IPs, user agents or complete log lines.
const crypto = require('node:crypto');
const { isIP } = require('node:net');
const WINDOW_MS = 120_000;
const MONTHS = new Map(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  .map((month, index) => [month, index]));
const COMBINED = /^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"((?:\\.|[^"\\])*)"\s+(\d{3})\s+(\d+|-)\s+"((?:\\.|[^"\\])*)"\s+"((?:\\.|[^"\\])*)"(?:\s+.*)?$/;
const BOT = /bot|crawler|spider|slurp|headless|preview|facebookexternalhit|bingpreview|selenium|playwright|puppeteer/i;
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function positiveId(value) {
  if (typeof value === 'string' && !/^\d+$/.test(value)) return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function logTime(raw) {
  const match = /^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(raw);
  if (!match || !MONTHS.has(match[2])) return null;
  const [, day, month, year, hour, minute, second, sign, offsetHour, offsetMinute] = match;
  const values = [Number(year), MONTHS.get(month), Number(day), Number(hour), Number(minute), Number(second)];
  if (values[0] < 1970 || values[2] < 1 || values[2] > 31 || values[3] > 23 || values[4] > 59 || values[5] > 59
    || Number(offsetHour) > 23 || Number(offsetMinute) > 59) return null;
  const local = Date.UTC(...values);
  const date = new Date(local);
  if (date.getUTCFullYear() !== values[0] || date.getUTCMonth() !== values[1] || date.getUTCDate() !== values[2]) return null;
  const offset = (Number(offsetHour) * 60 + Number(offsetMinute)) * 60_000 * (sign === '+' ? 1 : -1);
  return local - offset;
}

function decodeLogField(raw) {
  // Nginx default escaping uses hex bytes; decode bytes together so escaped
  // UTF-8 remains identical to the original UA used by the live HMAC identity.
  const chunks = [];
  let plain = '';
  const flush = () => { if (plain) { chunks.push(Buffer.from(plain)); plain = ''; } };
  for (let index = 0; index < raw.length; index++) {
    if (raw[index] === '\\' && raw[index + 1] === 'x' && /^[0-9a-fA-F]{2}$/.test(raw.slice(index + 2, index + 4))) {
      flush(); chunks.push(Buffer.from([parseInt(raw.slice(index + 2, index + 4), 16)])); index += 3;
    } else if (raw[index] === '\\' && ['\\', '"'].includes(raw[index + 1])) {
      plain += raw[++index];
    } else plain += raw[index];
  }
  flush();
  return Buffer.concat(chunks).toString('utf8');
}

function classify(method, target, status, defaultLeagueId) {
  // Do not normalise a probe such as /unknown/../ into a valid workspace URL.
  if (!target.startsWith('/') || target.startsWith('//') || target.includes('#')) return { kind: 'other' };
  const question = target.indexOf('?');
  const pathname = question < 0 ? target : target.slice(0, question);
  const query = new URLSearchParams(question < 0 ? '' : target.slice(question + 1));
  if (status === 200 && ((method === 'POST' && pathname === '/api/admin/login')
    || (method === 'GET' && pathname === '/api/admin/analytics'))) return { kind: 'admin' };
  if (method === 'GET' && [200, 304].includes(status) && ['/', '/index.html'].includes(pathname)) {
    const ids = query.getAll('league');
    if (ids.length > 1 || (ids.length === 1 && positiveId(ids[0]) == null)) return { kind: 'invalid-league-document' };
    const leagueId = ids.length ? positiveId(ids[0]) : defaultLeagueId;
    return { kind: 'document', leagueId, key: ids.length ? `league:${leagueId}` : 'snapshot' };
  }
  if (method === 'GET' && status === 200) {
    if (pathname === '/api/snapshot') return { kind: 'api', leagueId: defaultLeagueId, key: 'snapshot' };
    const match = /^\/api\/league\/(\d+)$/.exec(pathname);
    if (match && positiveId(match[1]) != null) return { kind: 'api', leagueId: positiveId(match[1]), key: `league:${positiveId(match[1])}` };
  }
  return { kind: 'other' };
}

function buildAccessLogBackfill(logs, options = {}) {
  const cutoff = options.cutoff;
  const defaultLeagueId = positiveId(options.defaultLeagueId);
  if (typeof cutoff !== 'number' || !Number.isFinite(cutoff) || cutoff <= 0) {
    throw new TypeError('Backfill requires a finite positive collector cutoff timestamp');
  }
  if (defaultLeagueId == null) throw new TypeError('Backfill requires a positive default league ID');
  if (options.hashVisitor !== undefined && typeof options.hashVisitor !== 'function') {
    throw new TypeError('hashVisitor must be a function returning the existing 20-character hexadecimal visitor ID');
  }
  const hashVisitor = options.hashVisitor || (value => sha256(value).slice(0, 20));
  const input = typeof logs === 'string' ? [logs] : Array.isArray(logs) ? logs : [];
  const diagnostics = {
    method: 'access-log-inference', approximate: true, windowMs: WINDOW_MS, cutoff,
    totalLines: 0, uniqueLines: 0, duplicateLines: 0, malformedLines: 0, parsedRequests: 0,
    excludedMissingUaRequests: 0, excludedBotRequests: 0, excludedNonBrowserRequests: 0,
    excludedInternalRequests: 0, cutoffExcludedRequests: 0, invalidLeagueDocuments: 0,
    documentsConsidered: 0, unconfirmedDocuments: 0, unmatchedApiRequests: 0,
    confirmedOpens: 0, internalVisitorCount: 0, firstLogAt: null, lastLogAt: null,
    firstConfirmedAt: null, lastConfirmedAt: null,
    limitation: '历史访问日志推断：仅回填成功文档后 120 秒内匹配成功数据请求的访问；不是精确全量统计。日志缺失、浏览器缓存、同秒重复请求及共享匿名身份可能造成遗漏或误差。',
  };
  const lineDigests = new Set();
  const internalIds = new Set((Array.isArray(options.excludedVisitorIds) ? options.excludedVisitorIds : [])
    .filter(value => typeof value === 'string' && /^[a-f0-9]{20}$/i.test(value)).map(value => value.toLowerCase()));
  const parsed = [];
  for (const text of input) {
    if (typeof text !== 'string') continue;
    for (const raw of text.split(/\r?\n/)) {
      if (!raw.trim()) continue;
      diagnostics.totalLines++;
      const digest = sha256(raw);
      if (lineDigests.has(digest)) { diagnostics.duplicateLines++; continue; }
      lineDigests.add(digest);
      diagnostics.uniqueLines++;
      const match = COMBINED.exec(raw);
      if (!match || !isIP(match[1])) { diagnostics.malformedLines++; continue; }
      const time = logTime(match[2]);
      const request = /^(GET|POST|HEAD|PUT|PATCH|DELETE|OPTIONS) ([^\s]+) HTTP\/\d(?:\.\d)?$/.exec(decodeLogField(match[3]));
      if (time == null || !request) { diagnostics.malformedLines++; continue; }
      diagnostics.parsedRequests++;
      diagnostics.firstLogAt = diagnostics.firstLogAt == null ? time : Math.min(diagnostics.firstLogAt, time);
      diagnostics.lastLogAt = diagnostics.lastLogAt == null ? time : Math.max(diagnostics.lastLogAt, time);
      const userAgent = decodeLogField(match[7]);
      if (!userAgent || userAgent === '-' || /[\x00-\x1f\x7f]/.test(userAgent)) { diagnostics.excludedMissingUaRequests++; continue; }
      const vid = hashVisitor(`${match[1]}|${userAgent}`);
      if (typeof vid !== 'string' || !/^[a-f0-9]{20}$/i.test(vid)) {
        throw new TypeError('hashVisitor must return a 20-character hexadecimal visitor ID');
      }
      const classification = classify(request[1], request[2], Number(match[4]), defaultLeagueId);
      const anonymous = vid.toLowerCase();
      // Login evidence can be later than the collector cutoff: known internal
      // identities must still be excluded from their earlier document opens.
      if (classification.kind === 'admin') internalIds.add(anonymous);
      if (BOT.test(userAgent)) { diagnostics.excludedBotRequests++; continue; }
      if (!/^Mozilla\//i.test(userAgent)) { diagnostics.excludedNonBrowserRequests++; continue; }
      parsed.push({ ts: time, vid: anonymous, digest, ...classification });
    }
  }
  diagnostics.internalVisitorCount = internalIds.size;
  const rank = { document: 0, api: 1 };
  parsed.sort((a, b) => a.ts - b.ts || (rank[a.kind] ?? 2) - (rank[b.kind] ?? 2) || a.digest.localeCompare(b.digest));
  const pending = new Map();
  const events = [];
  for (const record of parsed) {
    if (internalIds.has(record.vid)) { diagnostics.excludedInternalRequests++; continue; }
    if (record.kind === 'invalid-league-document') { diagnostics.invalidLeagueDocuments++; continue; }
    if (!['document', 'api'].includes(record.kind)) continue;
    if (record.ts >= cutoff) { diagnostics.cutoffExcludedRequests++; continue; }
    const key = `${record.vid}:${record.key}`;
    const candidates = (pending.get(key) || []).filter(document => record.ts - document.ts <= WINDOW_MS);
    pending.set(key, candidates);
    if (record.kind === 'document') {
      diagnostics.documentsConsidered++;
      candidates.push(record);
      continue;
    }
    const document = candidates.pop();
    if (!document) { diagnostics.unmatchedApiRequests++; continue; }
    // Older competing document requests may be cancelled loads, not additional
    // completed opens. Do not let a later 60-second poll claim them. This may
    // undercount simultaneous tabs, intentionally preferring conservative data.
    candidates.length = 0;
    events.push({
      v: 2, type: 'league_use', source: 'access-log-backfill', ts: document.ts,
      vid: document.vid, leagueId: document.leagueId,
      backfillId: sha256(`access-log-backfill:v1|${document.vid}|${document.digest}`),
    });
  }
  events.sort((a, b) => a.ts - b.ts || a.backfillId.localeCompare(b.backfillId));
  diagnostics.confirmedOpens = events.length;
  diagnostics.unconfirmedDocuments = diagnostics.documentsConsidered - events.length;
  diagnostics.firstConfirmedAt = events[0]?.ts ?? null;
  diagnostics.lastConfirmedAt = events.at(-1)?.ts ?? null;
  return { events, internalVisitorIds: [...internalIds].sort(), diagnostics };
}

module.exports = { buildAccessLogBackfill };
