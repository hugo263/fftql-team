'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const helpers = source.slice(source.indexOf('const SHARE_BRAND_URL ='), source.indexOf('function loadShareKitImage('));
const renderer = source.slice(source.indexOf('function renderShareCanvas()'), source.indexOf('function shareFileName()'));

// Run the actual brand loader and trade-card compositor with recorded Canvas API
// calls. These are content/geometry regressions, not pixel-level visual approval.
function harness(mode = 'success', dimensions = [1853, 849], preloaded = false) {
  const observed = { labels: [], fills: [], drawings: [], players: [], urls: [], timeouts: [], kitWaits: 0, clips: 0 };
  const ctx = new Proxy({
    clearRect() { observed.labels = []; observed.fills = []; observed.drawings = []; observed.players = []; },
    fillText(value, x, y) { observed.labels.push({ value, x, y, color: this.fillStyle }); },
    fillRect(x, y, width, height) { observed.fills.push({ x, y, width, height, color: this.fillStyle }); },
    drawImage(image, x, y, width, height) { observed.drawings.push({ url: image.url, x, y, width, height }); },
    clip() { observed.clips++; },
    createLinearGradient() { throw new Error('Brand header must stay flat forest green'); },
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  const canvas = { width: 1080, height: 1440, getContext: () => ctx,
    toBlob(callback, type) { callback(new Blob(['png'], { type })); } };
  const manager = { entryName: '保留球队名称', playerName: '保留经理名称',
    picks: ['GKP', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD', 'GKP', 'DEF', 'MID', 'FWD']
      .map((pos, index) => ({ position: index + 1, player: { id: index + 1, pos } })) };
  class Image {
    constructor() { [this.naturalWidth, this.naturalHeight] = dimensions; }
    set src(url) {
      this.url = url;
      observed.urls.push({ url, crossOrigin: this.crossOrigin });
      if (mode !== 'timeout') queueMicrotask(() => mode === 'error' ? this.onerror?.() : this.onload?.());
    }
  }
  const sandbox = {
    document: { images: preloaded ? [{ url: '/brand/tql-badge-preview-v47.png?v=47', getAttribute: () => '/brand/tql-badge-preview-v47.png?v=47', complete: true, naturalWidth: 1853, naturalHeight: 849 }] : [] },
    Image, Promise, Blob, Math,
    setTimeout(callback, delay) {
      observed.timeouts.push(delay);
      return setTimeout(callback, mode === 'timeout' ? 1 : delay);
    }, clearTimeout,
    $: (selector) => selector === '#shareCanvas' ? canvas : null,
    STATE: { snap: { meta: { leagueName: '专属验证联赛', currentGw: 3, upcomingGw: 4 } }, shareLockedIds: new Set([1, 2]), shareMessage: '只有标注的球员不出售' },
    SHARE_QR_STATE: { failed: false },
    shareManager: () => manager,
    shareUrl: () => 'https://fftql.team/?league=47275#share',
    getShareQrImage: () => ({ url: 'existing-qr' }),
    fitCanvasText: (context, value) => value,
    fillRoundedCanvasRect: (context, x, y, width, height, radius, color) => observed.fills.push({ x, y, width, height, color }),
    roundedCanvasRect: () => {},
    drawShareCanvasPitch: () => {},
    shareCanvasPitchBounds: () => ({ left: 48, right: 1032 }),
    drawShareCanvasPlayer: (context, pick, x, y, width) => observed.players.push({ id: pick.player.id, pos: pick.player.pos, x, y, width }),
    drawShareMessage: (context, value, x, y) => context.fillText(value, x, y),
    ensureShareKitImages: async () => { observed.kitWaits++; },
    module: { exports: {} },
  };
  vm.runInNewContext(`${helpers}\n${renderer}\nmodule.exports = { loadShareBrandImage, shareCanvasBlob, renderShareCanvas };`, sandbox);
  return { api: sandbox.module.exports, observed, canvas };
}

for (const mode of ['success', 'error', 'timeout']) {
  test(`trade card keeps dimensions, league details, pitches, QR and link with brand ${mode}`, async () => {
    const { api, observed, canvas } = harness(mode);
    const blob = await api.shareCanvasBlob();
    assert.equal(blob.type, 'image/png');
    assert.equal(canvas.width, 1080);
    assert.equal(canvas.height, 1440);
    assert.equal(observed.kitWaits, 1, 'brand loading does not replace official shirt loading');
    assert.deepEqual(observed.urls, [{ url: '/brand/tql-badge-preview-v47.png?v=47', crossOrigin: 'anonymous' }]);
    assert.deepEqual(observed.timeouts, [5000]);
    const labels = observed.labels.map(item => item.value);
    for (const value of ['DRAFT · GW4', '保留球队名称', '保留经理名称 · 专属验证联赛', '2 名非卖品', 'fftql.team/?league=47275#share', '扫码进入']) assert.ok(labels.includes(value), value);
    assert.ok(observed.fills.some(item => item.y === 0 && item.height === 262 && item.color === '#0b1f17'));
    assert.ok(observed.fills.some(item => item.y === 1251 && item.height === 189 && item.color === '#0b1f17'));
    assert.ok(observed.fills.some(item => item.y === 0 && item.height === 1440 && item.color === '#f3f5f1'));
    assert.ok(observed.labels.some(item => item.value === 'DRAFT · GW4' && item.color === '#d9ef9e'));
    const qr = observed.drawings.find(item => item.url === 'existing-qr');
    assert.deepEqual(qr, { url: 'existing-qr', x: 864, y: 1108, width: 144, height: 144 });
    assert.equal(observed.players.length, 15);
    for (const player of observed.players) {
      assert.equal(player.y, player.id > 11 ? 993 : { GKP: 345, DEF: 485, MID: 655, FWD: 820 }[player.pos]);
    }
    if (mode !== 'success') assert.ok(labels.includes('TQL FPL'), 'brand failure never hides its readable fallback');
    await api.shareCanvasBlob();
    assert.equal(observed.urls.length, 1, 'repeated previews/exports do not loop failed image requests');
  });
}

test('trade-card badge preserves proportions and clips the rounded corners', async () => {
  for (const dimensions of [[1853, 849], [1000, 200], [300, 900]]) {
    const { api, observed } = harness('success', dimensions);
    await api.shareCanvasBlob();
    const image = observed.drawings.find(item => item.url === '/brand/tql-badge-preview-v47.png?v=47');
    assert.ok(image);
    assert.ok(Math.abs(image.width / image.height - dimensions[0] / dimensions[1]) < .000001);
    assert.ok(image.x >= 62 && image.x + image.width <= 280);
    assert.ok(image.y >= 20 && image.y + image.height <= 84);
    assert.ok(observed.clips > 0);
    assert.ok(!observed.fills.some(item => item.x === 62 && item.y === 20 && item.color === '#0b1f17'));
  }
});

test('zero-sized trade-card wordmark degrades without drawing invalid geometry', async () => {
  const { api, observed } = harness('success', [0, 0]);
  await api.shareCanvasBlob();
  assert.ok(observed.labels.some(item => item.value === 'TQL FPL'));
  assert.ok(!observed.drawings.some(item => item.url.startsWith('/brand/')));
});

test('trade export reuses the loaded header badge without a second network request', async () => {
  const { api, observed } = harness('timeout', [1853, 849], true);
  await api.shareCanvasBlob();
  assert.equal(observed.urls.length, 0);
  assert.ok(observed.drawings.some(item => item.url === '/brand/tql-badge-preview-v47.png?v=47'));
  assert.ok(!observed.labels.some(item => item.value === 'TQL FPL'));
});
