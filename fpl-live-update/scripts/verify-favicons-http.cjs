#!/usr/bin/env node
'use strict';

// Run from the application directory. Also supports:
// node - --loopback < scripts/verify-favicons-http.cjs
// Loopback changes only DNS; the production Host and TLS verification remain.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const args = process.argv.slice(2);
const loopback = args.includes('--loopback');
const positional = args.filter(arg => arg !== '--loopback');
assert.ok(positional.length <= 1 && positional.every(arg => !arg.startsWith('--')), 'usage: node verify-favicons-http.cjs [https://origin] [--loopback]');
const origin = new URL(positional[0] || 'https://fpl.xiaokailabs.com');
assert.equal(origin.protocol, 'https:', 'HTTPS is required');
assert.equal(origin.username + origin.password + origin.search + origin.hash, '', 'origin must not contain credentials, query or fragment');
assert.ok(origin.pathname === '/', 'provide an origin, not a page URL');
const publicDir = path.resolve(process.cwd(), 'public');
const MAX_BODY = 2 * 1024 * 1024;
const assets = [
  ['favicon.ico', 'image/x-icon'],
  ['favicon.png', 'image/png'],
  ['favicon-16x16.png', 'image/png'],
  ['favicon-32x32.png', 'image/png'],
  ['favicon-48x48.png', 'image/png'],
  ['brand/tql-icon.png', 'image/png'],
  ['apple-touch-icon.png', 'image/png'],
  ['apple-touch-icon-precomposed.png', 'image/png'],
  ['icon-192.png', 'image/png'],
  ['icon-512.png', 'image/png'],
  ['site.webmanifest', 'application/manifest+json'],
];
assets.push(...assets.filter(([file]) => !file.startsWith('brand/')).map(([file, mime]) => [`admin-icons/${file}`, mime]));

function request(pathname, { method = 'GET', headers = {} } = {}) {
  const url = new URL(pathname, origin);
  assert.equal(url.origin, origin.origin, 'verification must stay on the requested origin');
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method,
      headers: { 'Accept-Encoding': 'identity', ...headers },
      ...(loopback ? {
        lookup(_hostname, options, callback) {
          if (options?.all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
          else callback(null, '127.0.0.1', 4);
        },
      } : {}),
    }, res => {
      const chunks = [];
      let length = 0;
      res.on('data', chunk => {
        length += chunk.length;
        if (length > MAX_BODY) {
          res.destroy(new Error(`response too large: ${pathname}`));
          return;
        }
        chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('aborted', () => reject(new Error(`response aborted: ${pathname}`)));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.setTimeout(15000, () => req.destroy(new Error(`request timed out: ${pathname}`)));
    req.on('error', reject);
    req.end();
  });
}

const contentType = response => String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();

async function verifyAsset([file, mime]) {
  const expected = fs.readFileSync(path.join(publicDir, file));
  const pathname = `/${file}`;
  const get = await request(pathname);
  assert.equal(get.status, 200, `${file}: GET status`);
  assert.equal(contentType(get), mime, `${file}: GET MIME (HTML fallback is not an icon)`);
  assert.equal(get.headers['content-encoding'], undefined, `${file}: identity encoding`);
  assert.ok(get.body.equals(expected), `${file}: served bytes differ from published public asset`);
  assert.ok(get.headers.etag, `${file}: ETag required`);
  const head = await request(pathname, { method: 'HEAD' });
  assert.equal(head.status, 200, `${file}: HEAD status`);
  assert.equal(contentType(head), mime, `${file}: HEAD MIME`);
  assert.equal(head.body.length, 0, `${file}: HEAD has no body`);
  assert.equal(Number(head.headers['content-length']), expected.length, `${file}: HEAD length`);
  assert.equal(head.headers.etag, get.headers.etag, `${file}: HEAD ETag`);
  const cached = await request(pathname, { headers: { 'If-None-Match': get.headers.etag } });
  assert.equal(cached.status, 304, `${file}: conditional GET status`);
  assert.equal(cached.body.length, 0, `${file}: 304 has no body`);
  assert.equal(cached.headers.etag, get.headers.etag, `${file}: 304 ETag`);
  return expected.length;
}

function parseLinks(html) {
  return [...html.matchAll(/<link\b[^>]*>/gi)].map(([tag]) => {
    const attributes = {};
    for (const [, name, , value] of tag.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)) attributes[name.toLowerCase()] = value;
    return attributes;
  });
}

async function verifyPage(pathname) {
  const response = await request(pathname);
  assert.equal(response.status, 200, `${pathname}: HTML status`);
  assert.equal(contentType(response), 'text/html', `${pathname}: HTML MIME`);
  const links = parseLinks(response.body.toString('utf8'))
    .filter(link => ['icon', 'apple-touch-icon', 'apple-touch-icon-precomposed', 'mask-icon', 'manifest', 'shortcut icon'].includes(link.rel));
  const expected = [
    { rel: 'icon', href: '/favicon.ico?v=60', type: 'image/x-icon', sizes: '16x16 32x32 48x48' },
    { rel: 'icon', href: '/favicon-16x16.png?v=60', type: 'image/png', sizes: '16x16' },
    { rel: 'icon', href: '/favicon-32x32.png?v=60', type: 'image/png', sizes: '32x32' },
    { rel: 'apple-touch-icon', href: '/apple-touch-icon.png?v=60', sizes: '180x180' },
    { rel: 'manifest', href: '/site.webmanifest?v=60' },
  ];
  assert.equal(links.length, expected.length, `${pathname}: no competing legacy icon`);
  for (const required of expected) {
    if (pathname === '/admin') required.href = required.href.replace(/^\//, '/admin-icons/').replace('v=60', 'v=62');
    const matches = links.filter(link => link.rel === required.rel && link.href === required.href);
    assert.equal(matches.length, 1, `${pathname}: ${required.href}`);
    for (const [key, value] of Object.entries(required)) assert.equal(matches[0][key], value, `${pathname}: ${key}`);
    assert.equal(Object.hasOwn(matches[0], 'media'), false, `${pathname}: no theme-specific icon`);
  }
}

async function main() {
  const sizes = [];
  // Small bounded batches avoid a verification burst against the shared host.
  for (let index = 0; index < assets.length; index += 3) {
    sizes.push(...await Promise.all(assets.slice(index, index + 3).map(verifyAsset)));
  }
  await Promise.all(['/', '/discover', '/admin'].map(verifyPage));
  console.log(`PASS v62 favicon HTTP: ${assets.length} assets byte-identical; MIME, HEAD and ETag/304 verified; public lime/admin orange; ${sizes.reduce((a, b) => a + b, 0)} bytes${loopback ? '; verified TLS via loopback' : ''}.`);
}

main().catch(error => {
  console.error(`FAIL favicon HTTP: ${error.message}`);
  process.exitCode = 1;
});
