'use strict';

const fs = require('fs');
const path = require('path');
const { gzip } = require('zlib');
const { promisify } = require('util');

const gzipAsync = promisify(gzip);
const COMPRESS_MIN_BYTES = 1024;
const VERSIONED_CACHE_SECONDS = 3600;
const COMPRESSIBLE = /^(?:text\/|application\/(?:javascript|json)(?:;|$)|image\/svg\+xml(?:;|$))/i;

// Honor explicit exclusions (including gzip;q=0) before wildcard defaults.
function encodingPreferences(header = '') {
  const values = new Map();
  for (const part of String(header).split(',')) {
    const [rawName, ...parameters] = part.trim().toLowerCase().split(';');
    if (!rawName) continue;
    let quality = 1;
    for (const parameter of parameters) {
      const match = /^\s*q\s*=\s*(.*?)\s*$/.exec(parameter);
      if (match) quality = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(match[1]) ? Number(match[1]) : 0;
    }
    values.set(rawName, quality);
  }
  return {
    gzip: values.get('gzip') ?? values.get('*') ?? 0,
    identity: values.get('identity') ?? (values.get('*') === 0 ? 0 : 1),
  };
}

async function sendBuffer(req, res, status, input, headers) {
  const body = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const preferences = encodingPreferences(req.headers?.['accept-encoding']);
  const compressible = COMPRESSIBLE.test(headers['Content-Type'] || '');
  const useGzip = compressible && preferences.gzip > 0
    && preferences.gzip >= preferences.identity
    && (body.length >= COMPRESS_MIN_BYTES || preferences.identity === 0);
  if (!useGzip && preferences.identity === 0) {
    res.writeHead(406, { 'Cache-Control': 'no-store', Vary: 'Accept-Encoding', 'Content-Length': 0 });
    res.end();
    return;
  }
  const encoded = useGzip ? await gzipAsync(body) : body;
  res.writeHead(status, {
    ...headers,
    Vary: 'Accept-Encoding',
    ...(useGzip ? { 'Content-Encoding': 'gzip' } : {}),
    'Content-Length': encoded.length,
  });
  res.end(req.method === 'HEAD' ? undefined : encoded);
}

function sendPublicJson(req, res, status, payload) {
  return sendBuffer(req, res, status, JSON.stringify(payload), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
}

function staticCacheControl(target, version) {
  // HTML must revalidate so a deployment's new resource versions are seen.
  // Versioned assets get a bounded browser cache; existing URLs remain valid.
  return path.extname(target).toLowerCase() !== '.html' && /^\d{1,10}$/.test(String(version || ''))
    ? `public, max-age=${VERSIONED_CACHE_SECONDS}` : 'no-cache';
}

function matchesEtag(header, etag) {
  const normalized = etag.replace(/^W\//, '');
  return String(header || '').split(',').some((value) => {
    const token = value.trim();
    return token === '*' || token.replace(/^W\//, '') === normalized;
  });
}

async function sendStaticFile(req, res, target, { contentType, version, headers = {} } = {}) {
  const stat = await fs.promises.stat(target);
  // Weak validators describe equivalent decoded bytes for both encodings.
  const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
  const responseHeaders = {
    'Content-Type': contentType || 'application/octet-stream',
    'Cache-Control': staticCacheControl(target, version),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    ...headers,
    ETag: etag,
    Vary: 'Accept-Encoding',
  };
  if ((req.method === 'GET' || req.method === 'HEAD') && matchesEtag(req.headers?.['if-none-match'], etag)) {
    res.writeHead(304, responseHeaders);
    res.end();
    return;
  }
  const body = await fs.promises.readFile(target);
  return sendBuffer(req, res, 200, body, responseHeaders);
}

module.exports = { encodingPreferences, sendPublicJson, sendStaticFile, staticCacheControl, matchesEtag };
