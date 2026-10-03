'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/match-share.js'), 'utf8');

// Exercise the public browser API without a network or native canvas package.
// Recorded draw calls validate export content; actual PNG layout is checked in
// the browser separately, not inferred from these Canvas API stubs.
function harness(imageMode = 'success', canvasMode = 'success', brandMode = imageMode, brandDimensions = [1853, 849], preloaded = false) {
  const observed = { labels: [], fills: [], urls: [], imageOptions: [], images: 0, drawings: [], canvases: [], timeouts: [], blobs: 0 };
  const context = new Proxy({
    measureText(value) { return { width: String(value).length * 7 }; },
    fillText(value, x, y) { observed.labels.push({ value, x, y }); },
    fillRect(x, y, width, height) { observed.fills.push({ x, y, width, height, color: this.fillStyle }); },
    drawImage(image, x, y, width, height) {
      observed.images++;
      observed.drawings.push({ url: image.url, x, y, width, height });
    },
  }, {
    get(target, key) { return key in target ? target[key] : () => {}; },
    set(target, key, value) { target[key] = value; return true; },
  });
  class Image {
    constructor() { this.naturalWidth = 80; this.naturalHeight = 110; }
    set src(url) {
      this.url = url;
      const brand = url.startsWith('/brand/');
      const mode = brand ? brandMode : imageMode;
      if (brand) [this.naturalWidth, this.naturalHeight] = brandDimensions;
      observed.urls.push(url);
      observed.imageOptions.push({ crossOrigin: this.crossOrigin });
      if (mode !== 'timeout') {
        queueMicrotask(() => mode === 'error' ? this.onerror?.() : this.onload?.());
      }
    }
  }
  const browser = {
    Image, Intl, Blob,
    setTimeout(callback, delay) {
      observed.timeouts.push(delay);
      // Fire the real five-second deadline on the next timer turn in the test.
      return setTimeout(callback, imageMode === 'timeout' || brandMode === 'timeout' ? 1 : delay);
    },
    clearTimeout,
    document: {
      images: preloaded ? [{ url: '/brand/tql-badge-preview-v47.png?v=47', getAttribute: () => '/brand/tql-badge-preview-v47.png?v=47', complete: true, naturalWidth: 1853, naturalHeight: 849 }] : [],
      createElement(type) {
        assert.equal(type, 'canvas', 'export creates no download link or visible UI');
        const canvas = {
          getContext() { return canvasMode === 'no-context' ? null : context; },
          toBlob(callback, mime) {
            observed.blobs++;
            if (canvasMode === 'throw') throw new Error('encode failure');
            callback(canvasMode === 'empty-blob' ? null : new Blob(['test-png'], { type: mime }));
          },
        };
        observed.canvases.push(canvas);
        return canvas;
      },
    },
  };
  const sandbox={ window: browser, globalThis: browser, document:browser.document,Image:browser.Image,setTimeout:browser.setTimeout,clearTimeout:browser.clearTimeout,URL,URLSearchParams,location:{search:'?league=47275'}, Intl, Number, Date, Promise, Map, Object, Array, String, Error, Math };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/night-share.js'),'utf8'),sandbox);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/pitch.js'),'utf8'),sandbox);
  vm.runInNewContext(source,sandbox);
  return { api: browser.FPLMatchShare, observed };
}

function detailFixture() {
  const positions = ['GKP', 'DEF', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'FWD', 'GKP', 'DEF', 'MID', 'FWD'];
  return {
    leagueId: 47275, leagueName: '验证联赛', gw: 3, live: true, finished: false,
    updated: '2026-09-05T12:30:00Z',
    sides: [0, 1].map((side) => ({
      entryId: side + 1, entryName: `球队 ${side}`, playerName: `玩家 ${side}`,
      score: side === 0 ? -2 : 0, playedCount: 6, startingCount: 11, remainingCount: 6,
      benchPoints: 0, formation: '5-4-1',
      players: positions.map((pos, index) => ({
        id: side * 100 + index + 1,
        name: ['Goalkeeper', 'Pending defender', 'Unknown', 'Playing defender', 'Zero defender'][index] || (index > 10 ? `Bench ${index - 10}` : `Player ${index + 1}`),
        team: 'ARS', teamName: 'Arsenal', teamCode: index === 2 ? null : 3,
        pos, position: index + 1, countsForTeam: index < 11,
        points: [-2, 0, null, 1, 0][index] ?? (index === 2 ? null : 2),
        minutes: [90, 0, null, 72][index] ?? (index === 2 ? null : 90),
        status: ['played', 'pending', 'unknown', 'playing'][index] || 'played',
        fixtures: [{ opponent: 'BHA', home: true, started: index !== 1, finished: index !== 1 && index !== 3 }],
      })),
    })),
  };
}

function labels(observed) { return observed.labels.map((item) => item.value); }

test('future preview export labels current ownership instead of claiming locked GW results', async () => {
  const {api, observed} = harness();
  const detail = detailFixture();
  Object.assign(detail, {preview:true, gw:4, live:false, finished:false});
  detail.sides.forEach(side => Object.assign(side, {preview:true, score:null, playedCount:null, remainingCount:null,
    players:side.players.map(p=>({...p, points:null, minutes:0, status:'pending'}))}));
  await api.createBlob(detail);
  assert.ok(labels(observed).includes('赛前阵容预览'));
  assert.ok(labels(observed).some(text=>text.includes('当前阵容 · 非该轮锁定')));
  assert.ok(labels(observed).some(text=>text.includes('非该轮锁定阵容；截止前')));
  assert.ok(!labels(observed).includes('完赛快照'));
});

test('match export reuses the loaded header badge without another image request', async () => {
  const { api, observed } = harness('success', 'success', 'timeout', [1853, 849], true);
  await api.createBlob(detailFixture());
  assert.ok(!observed.urls.some(url => url.startsWith('/brand/')));
  assert.ok(observed.drawings.some(item => item.url === '/brand/tql-badge-preview-v47.png?v=47'));
  assert.ok(!labels(observed).includes('TQL FPL'));
});

for (const mode of ['success', 'error', 'timeout']) {
  test(`share export returns a PNG Blob when official kits ${mode}`, async () => {
    const { api, observed } = harness(mode);
    const blob = await api.createBlob(detailFixture());
    assert.equal(blob.type, 'image/png');
    assert.equal(observed.blobs, 1);
    assert.equal(observed.canvases[0].width, 1080);
    assert.equal(observed.canvases.at(-1).height, 1440, 'standard 30-player mobile portrait includes both pitches and benches');
    assert.ok(observed.images > 0, 'portrait always composites the rendered pitch');
    assert.deepEqual([...new Set(observed.urls)].sort(), ['/api/kit/3-gk.png', '/api/kit/3.png', '/brand/tql-badge-preview-v47.png?v=47', 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=4&format=png&data=https%3A%2F%2Ffftql.team%2F%3Fleague%3D47275%23weekly']);
    assert.equal(observed.urls.length, 4, 'each unique official kit and brand image is loaded once');
    assert.ok(observed.imageOptions.every((image) => image.crossOrigin === 'anonymous'));
    assert.ok(observed.timeouts.every((delay) => [3500,5000].includes(delay)), 'all loads are bounded to five seconds');
    if (mode !== 'success') assert.ok(labels(observed).includes('ARS'), 'failed kits draw a vector shirt with team identifier');
  });
}

test('async kit loading preserves the original displayed match snapshot', async () => {
  const { api, observed } = harness();
  const detail = detailFixture();
  const pending = api.createBlob(detail);
  detail.gw = 4;
  detail.updated = '2026-09-06T12:30:00Z';
  detail.leagueName = 'Changed league';
  detail.sides[0].entryName = 'Changed team';
  detail.sides[0].score = 99;
  detail.sides[0].players[0].name = 'Changed player';
  detail.sides[0].players[0].points = 99;
  detail.sides[0].players.reverse();
  await pending;
  const output = labels(observed);
  assert.ok(output.includes('GW3 · 验证联赛'));
  assert.ok(output.includes('球队 0'));
  assert.ok(output.includes('Goalkeeper'));
  assert.ok(output.includes('-2 分'));
  assert.ok(output.some((value) => value.includes('2026/09/05') && value.includes('20:30:00')));
  assert.ok(!output.some((value) => value.includes('Changed') || value.includes('99')));
});

test('badge uses its actual aspect ratio inside the compact header without moving the pitches', async () => {
  for (const dimensions of [[1853, 849], [1000, 200], [300, 900]]) {
    const { api, observed } = harness('success', 'success', 'success', dimensions);
    await api.createBlob(detailFixture());
    const brand = observed.drawings.find(item => item.url === '/brand/tql-badge-preview-v47.png?v=47');
    assert.ok(brand, 'same-origin wordmark is drawn');
    assert.ok(Math.abs(brand.width / brand.height - dimensions[0] / dimensions[1]) < .000001, 'contain does not crop or stretch the source');
    assert.ok(brand.x >= 32 && brand.x + brand.width <= 236);
    assert.ok(brand.y >= 16 && brand.y + brand.height <= 92);
    assert.equal(observed.canvases.at(-1).height, 1440);
    assert.ok(observed.fills.some(item => item.y === 0 && item.height === 108 && item.color === '#12382a'));
    assert.ok(labels(observed).includes('GW3 · 验证联赛'));
    assert.ok(labels(observed).includes('进行中快照'));
    assert.ok(!labels(observed).some(value => value.includes('FPL LAB')));
  }
});

for (const mode of ['error', 'timeout']) {
  test(`wordmark ${mode} falls back to readable TQL FPL and preserves match export`, async () => {
    const { api, observed } = harness('success', 'success', mode);
    const blob = await api.createBlob(detailFixture());
    assert.equal(blob.type, 'image/png');
    assert.ok(labels(observed).includes('TQL FPL'));
    assert.ok(labels(observed).includes('GW3 · 验证联赛'));
    assert.ok(labels(observed).includes('fftql.team/?league=47275#weekly'));
    assert.ok(observed.drawings.some(item => typeof item.url === 'string' && item.url.startsWith('/api/kit/')));
    assert.equal(observed.canvases.at(-1).height, 1440);
  });
}

test('unusable wordmark dimensions use text fallback and a cached successful logo is reused', async () => {
  const invalid = harness('success', 'success', 'success', [0, 0]);
  await invalid.api.createBlob(detailFixture());
  assert.ok(labels(invalid.observed).includes('TQL FPL'));
  assert.ok(!invalid.observed.drawings.some(item => typeof item.url === 'string' && item.url.startsWith('/brand/')));
  const cached = harness();
  await cached.api.createBlob(detailFixture());
  await cached.api.createBlob(detailFixture());
  assert.equal(cached.observed.urls.filter(url => url.startsWith('/brand/')).length, 1);
});

test('negative, played zero, pending zero and unknown remain distinct; only playing strips are highlighted', async () => {
  const { api, observed } = harness();
  await api.createBlob(detailFixture());
  for (const expected of ['-2 分', '0 分', '—', '暂无数据', '待开赛', '1 · 赛中', '72′ · 球队比赛中']) {
    assert.ok(labels(observed).includes(expected), expected);
  }
  for (const [name, expected] of [['Goalkeeper', '-2 分'], ['Zero defender', '0 分'], ['Pending defender', '—'], ['Unknown', '—'], ['Playing defender', '1 · 赛中']]) {
    const players = observed.labels.filter(item => item.value === name);
    assert.equal(players.length, 2);
    for (const item of players) assert.ok(observed.labels.some(label => label.x === item.x && label.y === item.y + 20 && label.value === expected), `${name} must retain its own score state`);
  }
  const highlighted = observed.fills.filter(fill => fill.color === '#e4572e');
  assert.equal(highlighted.length, 2, 'one actual playing participant per side');
  assert.ok(highlighted.every(fill => fill.height === 20));
});

test('both pitches put goalkeepers first and show all 15 players with a separate bench', async () => {
  const { api, observed } = harness();
  await api.createBlob(detailFixture());
  for (const side of [0, 1]) {
    const start = observed.labels.find(item => item.value === `球队 ${side}`).y;
    const end = side === 0 ? observed.labels.find(item => item.value === '球队 1').y : observed.canvases[0].height;
    const own = observed.labels.filter(item => item.y >= start && item.y < end);
    const point = (name) => own.find((item) => item.value === name);
    assert.ok(point('Goalkeeper').y < point('Zero defender').y);
    assert.ok(point('Zero defender').y < point('Player 7').y);
    assert.ok(point('Player 7').y < point('Player 11').y);
    assert.ok(point('Player 11').y < point('Bench 1').y);
    for (const player of detailFixture().sides[side].players) assert.ok(point(player.name), player.name);
    assert.ok(point('替补 · 不计总分'));
    assert.ok(own.some((item) => item.value.includes('余程 6')), 'DGW remaining fixtures are not called players yet to appear');
    assert.ok(own.every(item => item.x >= 32 && item.x <= 1048), 'both portrait fields stay in the mobile image bounds');
  }
  assert.ok(!labels(observed).some((value) => value.includes('待出战')));
});

test('zero-minute disciplinary deductions remain visible in the export, not a dash or a playing marker', async () => {
  const { api, observed } = harness();
  const detail = detailFixture();
  Object.assign(detail.sides[0].players[1], { name: 'Bench card', points: -1, minutes: 0, yellowCards: 1, status: 'waiting' });
  Object.assign(detail.sides[1].players[1], { name: 'Bench red', points: -3, minutes: 0, redCards: 1, status: 'dnp' });
  await api.createBlob(detail);
  for (const [name, score] of [['Bench card', '-1 分'], ['Bench red', '-3 分']]) {
    const nameLabel = observed.labels.find(item => item.value === name);
    assert.ok(observed.labels.some(item => item.x === nameLabel.x && item.y === nameLabel.y + 20 && item.value === score));
  }
  assert.equal(observed.fills.filter(fill => fill.color === '#e4572e').length, 2, 'disciplinary deduction alone never marks an appearance');
});

test('unknown positions and an extra bench row expand portrait height and remain above footer', async () => {
  const { api, observed } = harness();
  const detail = detailFixture();
  detail.sides[0].players[2].pos = '';
  detail.sides[1].players.push({ name: 'Extra bench', pos: 'MID', position: 16, countsForTeam: false, points: 0, minutes: 0, status: 'pending' });
  await api.createBlob(detail);
  assert.ok(observed.canvases[0].height > 1300, 'extra rows expand the source instead of dropping players');
  assert.equal(observed.canvases.at(-1).height,1440);
  const extra = observed.labels.find(item => item.value === 'Extra bench');
  const footer = observed.labels.find(item => item.value === 'fftql.team/?league=47275#weekly');
  assert.ok(extra && extra.y + 49 < observed.canvases[0].height && footer);
});

test('final and stale exports explicitly distinguish delayed snapshot state', async () => {
  const first = harness();
  await first.api.createBlob({ ...detailFixture(), live: false, finished: true });
  assert.ok(labels(first.observed).includes('完赛快照'));
  const stale = harness();
  await stale.api.createBlob({ ...detailFixture(), live: false, finished: true, stale: true });
  assert.ok(labels(stale.observed).includes('数据有延迟'));
});

test('export labels the snapshot time, phase and dedicated league URL', async () => {
  const { api, observed } = harness();
  await api.createBlob(detailFixture());
  assert.ok(labels(observed).includes('进行中快照'));
  assert.ok(labels(observed).includes('fftql.team/?league=47275#weekly'));
  assert.ok(labels(observed).some((value) => value.includes('北京时间')));
  assert.ok(labels(observed).some((value) => value.includes('防守贡献/奖励分')));
  assert.ok(labels(observed).some((value) => value.includes('仅有效首发计总分')));
});

test('portrait export preserves projected/official substitutions and pending score state in the frozen snapshot', async () => {
  const { api, observed } = harness();
  const detail = detailFixture();
  const side = detail.sides[0];
  side.provisional = true;
  side.substitutions = [{ element_out: 1, element_in: 12, source: 'projected', pending: true }, { element_out: 4, element_in: 13, source: 'official', pending: false }];
  Object.assign(side.players[0], { position: 12, countsForTeam: false });
  Object.assign(side.players[11], { position: 1, countsForTeam: true, minutes: 0, points: 0, status: 'pending' });
  const pending = api.createBlob(detail);
  side.substitutions[0].source = 'official';
  side.substitutions[0].pending = false;
  await pending;
  const output = labels(observed);
  for (const badge of ['预↑', '预↓', '替↑', '替↓']) assert.ok(output.includes(badge), badge);
  assert.ok(output.some(value => value.includes('预判 1 组') && value.includes('1 人待上场')));
  assert.ok(output.includes('预判替补 · 待上场'));
  assert.ok(output.some(value => value.includes('含预判自动替补，最终以官方结算为准')));
  const nameLabel = observed.labels.find(item => item.value === 'Bench 1');
  assert.ok(observed.labels.some(item => item.x === nameLabel.x && item.y === nameLabel.y + 20 && item.value === '—'));
  assert.equal(observed.canvases[0].width, 1080);
  assert.equal(observed.canvases.at(-1).height, 1440);
});

test('invalid input and unavailable canvas encoding fail explicitly', async () => {
  const { api } = harness();
  await assert.rejects(() => api.createBlob({ sides: [] }), /双方/);
  for (const mode of ['no-context', 'empty-blob', 'throw']) {
    const { api: failing } = harness('error', mode);
    await assert.rejects(() => failing.createBlob(detailFixture()), /不支持|生成失败|无法生成|无法导出/);
  }
});
