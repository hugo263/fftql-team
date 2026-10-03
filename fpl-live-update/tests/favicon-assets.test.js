'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '../public');
const read = file => fs.readFileSync(path.join(publicDir, file));
const expectedLinks = [
  { rel: 'icon', href: '/favicon.ico?v=60', type: 'image/x-icon', sizes: '16x16 32x32 48x48' },
  { rel: 'icon', href: '/favicon-16x16.png?v=60', type: 'image/png', sizes: '16x16' },
  { rel: 'icon', href: '/favicon-32x32.png?v=60', type: 'image/png', sizes: '32x32' },
  { rel: 'apple-touch-icon', href: '/apple-touch-icon.png?v=60', sizes: '180x180' },
  { rel: 'manifest', href: '/site.webmanifest?v=60' },
];

function linksFrom(html) {
  return [...html.matchAll(/<link\b[^>]*>/gi)].map(([tag]) => {
    const attributes = {};
    for (const [, name, , value] of tag.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)) {
      attributes[name.toLowerCase()] = value;
    }
    return attributes;
  });
}

function resolvePublicUrl(href) {
  const url = new URL(href, 'https://fpl.xiaokailabs.com/');
  assert.equal(url.origin, 'https://fpl.xiaokailabs.com', 'icons must be same-origin');
  const filename = path.resolve(publicDir, `.${decodeURIComponent(url.pathname)}`);
  assert.ok(filename.startsWith(`${publicDir}${path.sep}`), 'icon URL must stay inside public/');
  assert.ok(fs.statSync(filename).isFile(), `${href} must exist, not rely on SPA HTML fallback`);
  return filename;
}

for (const page of ['index.html', 'discover.html']) {
  test(`${page} has the same approved favicon, touch icon and manifest in all themes`, () => {
    const links = linksFrom(read(page).toString('utf8'))
      .filter(link => ['icon', 'apple-touch-icon', 'apple-touch-icon-precomposed', 'manifest', 'mask-icon', 'shortcut icon'].includes(link.rel));
    assert.equal(links.length, expectedLinks.length, 'do not leave competing legacy or theme-specific icon links');
    for (const expected of expectedLinks) {
      const matches = links.filter(link => link.rel === expected.rel && link.href === expected.href);
      assert.equal(matches.length, 1, expected.href);
      for (const [name, value] of Object.entries(expected)) assert.equal(matches[0][name], value);
      assert.equal(Object.hasOwn(matches[0], 'media'), false, 'all browser themes use the selected palette');
      resolvePublicUrl(expected.href);
    }
  });
}

const pngSizes = new Map([
  ['favicon.png', 512],
  ['brand/tql-icon.png', 512],
  ['favicon-16x16.png', 16],
  ['favicon-32x32.png', 32],
  ['favicon-48x48.png', 48],
  ['apple-touch-icon.png', 180],
  ['apple-touch-icon-precomposed.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
]);
for (const [file, size] of [...pngSizes]) if (!file.startsWith('brand/')) pngSizes.set(`admin-icons/${file}`, size);

test('admin-only orange favicon links and current header logo cannot affect public favicons', () => {
  const html = read('admin.html').toString();
  const links = linksFrom(html).filter(link => ['icon', 'apple-touch-icon', 'manifest'].includes(link.rel));
  assert.equal(links.length,1);
  assert.equal(links[0].href,'/admin-icon.svg?v=20261002a');
  resolvePublicUrl(links[0].href);
  assert.match(read('admin-icon.svg').toString(),/#f6a05e/i);
  assert.match(html,/admin-brand/);
  assert.ok(!read('admin-icons/favicon-32x32.png').equals(read('favicon-32x32.png')));
  const manifest = JSON.parse(read('admin-icons/site.webmanifest'));
  assert.match(manifest.name, /后台/);
  for (const icon of manifest.icons) { assert.match(icon.src, /^\/admin-icons\//); resolvePublicUrl(icon.src); }
});

for (const [filename, size] of pngSizes) {
  test(`${filename} is a genuine ${size}px PNG with image data`, () => {
    const bytes = read(filename);
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(8), 13, 'IHDR length');
    assert.equal(bytes.subarray(12, 16).toString('ascii'), 'IHDR');
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
    assert.ok([2, 6].includes(bytes[25]), 'RGB or RGBA raster, not a mislabeled document');
    let offset = 8, imageBytes = 0, ended = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset);
      const kind = bytes.subarray(offset + 4, offset + 8).toString('ascii');
      assert.ok(offset + length + 12 <= bytes.length, `${kind} chunk lies inside file`);
      if (kind === 'IDAT') imageBytes += length;
      offset += length + 12;
      if (kind === 'IEND') {
        assert.equal(length, 0);
        ended = true;
        break;
      }
    }
    assert.ok(imageBytes > 0, 'contains PNG image data');
    assert.equal(ended, true, 'complete PNG terminator');
    assert.equal(offset, bytes.length, 'no truncated or trailing payload');
  });
}

test('root favicon and old brand icon fallback contain the same approved image', () => {
  assert.deepEqual(read('favicon.png'), read('brand/tql-icon.png'));
  assert.deepEqual(read('apple-touch-icon.png'), read('apple-touch-icon-precomposed.png'));
});

test('favicon.ico contains bounded 16/32/48px 32-bit DIB images and transparency masks', () => {
  const bytes = read('favicon.ico');
  assert.equal(bytes.readUInt16LE(0), 0, 'reserved');
  assert.equal(bytes.readUInt16LE(2), 1, 'ICO rather than cursor');
  assert.equal(bytes.readUInt16LE(4), 3, 'three small-size fallback frames');
  const spans = [];
  for (let frame = 0; frame < 3; frame += 1) {
    const size = [16, 32, 48][frame];
    const entry = 6 + frame * 16;
    assert.equal(bytes[entry] || 256, size);
    assert.equal(bytes[entry + 1] || 256, size);
    assert.equal(bytes[entry + 2], 0, 'true-color frame has no palette');
    assert.equal(bytes[entry + 3], 0, 'reserved');
    assert.equal(bytes.readUInt16LE(entry + 4), 1, 'one plane');
    assert.equal(bytes.readUInt16LE(entry + 6), 32, 'BGRA pixels');
    const length = bytes.readUInt32LE(entry + 8);
    const offset = bytes.readUInt32LE(entry + 12);
    assert.ok(offset >= 6 + 3 * 16, 'image starts beyond icon directory');
    assert.ok(offset + length <= bytes.length, 'frame data fits inside ICO');
    const dib = bytes.subarray(offset, offset + length);
    assert.equal(dib.readUInt32LE(0), 40, 'BITMAPINFOHEADER');
    assert.equal(dib.readInt32LE(4), size);
    assert.equal(dib.readInt32LE(8), size * 2, 'DIB height includes XOR and AND masks');
    assert.equal(dib.readUInt16LE(12), 1);
    assert.equal(dib.readUInt16LE(14), 32);
    assert.equal(dib.readUInt32LE(16), 0, 'uncompressed DIB');
    const andBytes = Math.ceil(size / 32) * 4 * size;
    assert.equal(length, 40 + size * size * 4 + andBytes, 'complete pixels and DWORD-aligned AND mask');
    const pixelData = dib.subarray(40, 40 + size * size * 4);
    assert.ok(pixelData.some((value, index) => index % 4 === 3 && value === 0), 'transparent rounded outer corners');
    assert.ok(pixelData.some((value, index) => index % 4 === 3 && value === 255), 'opaque logo pixels');
    spans.push([offset, offset + length]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  for (let index = 1; index < spans.length; index += 1) assert.ok(spans[index][0] >= spans[index - 1][1], 'ICO frames do not overlap');
  assert.equal(spans.at(-1)[1], bytes.length, 'last frame ends at EOF');
});

test('manifest advertises the approved icons without taking over bookmarked league URLs', () => {
  const manifest = JSON.parse(read('site.webmanifest').toString('utf8'));
  assert.equal(manifest.display, 'browser');
  assert.equal(Object.hasOwn(manifest, 'start_url'), false, 'do not replace a bookmarked league or fragment');
  assert.equal(Object.hasOwn(manifest, 'scope'), false, 'do not alter navigation scope');
  assert.ok(manifest.name && manifest.short_name, 'readable app identity');
  assert.equal(manifest.icons.length, 2);
  for (const size of [192, 512]) {
    const icon = manifest.icons.find(item => item.sizes === `${size}x${size}`);
    assert.ok(icon, `${size}px manifest icon`);
    assert.equal(icon.type, 'image/png');
    assert.equal(icon.purpose, 'any', 'do not advertise an untested maskable crop');
    const filename = resolvePublicUrl(icon.src);
    const bytes = fs.readFileSync(filename);
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
  }
});
