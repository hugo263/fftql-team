'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '../public');
const read = file => fs.readFileSync(path.join(publicDir, file), 'utf8');
const pages = ['index.html', 'discover.html', 'admin.html'];
const iconUrl = '/favicon-32x32.png?v=60';
const iconIcoUrl = '/favicon.ico?v=60';
const touchIconUrl = '/apple-touch-icon.png?v=60';
const manifestUrl = '/site.webmanifest?v=60';
const wordmarkUrl = '/brand/tql-wordmark.png?v=43';
const previewWordmarkUrl = '/brand/tql-badge-preview-v47.png?v=47';
const brandCssUrl = '/tql-brand.css?v=46';

// These are cross-file integration checks, not visual/logo-cropping tests.
// Canvas rendering and image-error behavior have their own executable tests;
// desktop/mobile screenshots still verify the final layout before release.
function tags(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map(match => {
    const attributes = {};
    for (const attribute of match[0].matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)) {
      attributes[attribute[1].toLowerCase()] = attribute[3];
    }
    return attributes;
  });
}

for (const file of pages) {
  test(`${file} retains its approved identity and same-origin versioned assets`, () => {
    const html=read(file), links=tags(html,'link'), icons=links.filter(l=>l.rel==='icon');
    assert.match(html, /<title>[^<]*TQL[^<]*<\/title>/);
    assert.ok(icons.length); assert.ok(icons.every(l=>!l.media));
    for(const asset of [...links.filter(l=>l.rel==='stylesheet'||l.rel==='icon'||l.rel==='manifest'||l.rel==='apple-touch-icon'),...tags(html,'script').filter(l=>l.src)]) {
      const url=asset.href||asset.src;
      assert.ok(url.startsWith('/')); assert.ok(fs.statSync(path.join(publicDir,url.split('?')[0])).isFile(),url);
    }
    if(file==='admin.html') {
      assert.ok(icons.some(l=>l.href==='/admin-icon.svg?v=20261002a'));
      assert.match(html,/admin-brand/);
    } else {
      assert.ok(tags(html,'html')[0].class.includes('tql-brand'));
      assert.ok(icons.some(l=>l.href===iconUrl));
      assert.equal(links.filter(l=>l.rel==='stylesheet').at(-1).href,'/responsive.css?v=105');
      const mark=tags(html,'img').find(i=>i.src===previewWordmarkUrl);
      assert.ok(mark&&Number(mark.width)>0&&Number(mark.height)>0);
    }
  });
}

test('approved icon and wordmark are real PNGs with square and wide canvas dimensions', () => {
  function dimensions(file) {
    const bytes = fs.readFileSync(path.join(publicDir, file));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.subarray(12, 16).toString('ascii'), 'IHDR');
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  const icon = dimensions('brand/tql-icon.png');
  const wordmark = dimensions('brand/tql-wordmark.png');
  assert.ok(icon.width >= 64);
  assert.equal(icon.width, icon.height, 'browser/app icon must not use the horizontal wordmark');
  assert.ok(wordmark.width > wordmark.height * 2, 'wordmark retains its approved wide canvas');
  // Detailed favicon alpha/color checks live in favicon-assets.test.js; the
  // original wordmark and header artwork remain untouched by the icon update.
});

test('wordmark display neutralizes the opaque gray clearspace before blending with its header', () => {
  const css = read('tql-brand.css');
  const rule = css.match(/html\.tql-brand \.tql-wordmark img\s*\{([^}]+)\}/)?.[1];
  assert.ok(rule);
  assert.match(rule, /filter:\s*brightness\(1\.07\)/);
  assert.match(rule, /mix-blend-mode:\s*multiply/);
  assert.match(rule, /background:\s*transparent/);
  assert.ok(240 * 1.07 >= 255, 'measured clearspace minimum becomes white before multiply');
  assert.ok(56 * 1.07 < 65, 'the dark green mark stays dark, rather than being washed out');
});

test('legacy website brands and avatar/favicon references are removed from live entry points', () => {
  for (const file of [...pages, 'app.js', 'match-share.js']) {
    const source = read(file);
    assert.doesNotMatch(source, /brand-avatar\.jpg|["'\/]favicon\.png/);
    assert.doesNotMatch(source, /FPL\s+LAB\.?|Draft\s+Scout|FPL\s+Weekly\s+Analytics/i);
  }
  // This restriction applies only to fixed website chrome, not real league or
  // manager data, snapshots, configuration, fixtures, or historical documents.
  for (const file of pages) assert.doesNotMatch(read(file), /英超无双/);
});

test('branding preserves the actual league name and all workbench modules', () => {
  const html = read('index.html');
  const app = read('app.js');
  assert.match(html, /<h1\s+id="leagueName">Draft 联赛<\/h1>/);
  assert.match(app, /\$\('#leagueName'\)\.textContent\s*=\s*meta\.leagueName/);
  const expected = ['home', 'weekly', 'fixtures', 'standings', 'fun', 'trades', 'freeagents', 'trade', 'compare', 'share', 'predict'];
  const navigation = tags(html, 'button').filter(button => button['data-tab']).map(button => button['data-tab']);
  assert.deepEqual(navigation, expected);
  const panels = tags(html, 'section').map(section => section.id);
  for (const tab of expected) assert.ok(panels.includes(`tab-${tab}`));
  assert.match(app, /`\/api\/league\/\$\{REQUESTED_LEAGUE_ID\}`/);
  assert.match(app, /meta\.leagueName/);
});

test('public masthead is compact and shared while league context stays in the sidebar',()=>{
  const html=read('index.html'),header=html.match(/<header\b[^>]*>[\s\S]*?<\/header>/)[0];
  assert.match(header,/night-site-head/);assert.equal(tags(header,'img').length,1);
  assert.match(header,/id="btnRefresh"/);assert.doesNotMatch(header,/id="leagueName"/);
  for(const id of ['leagueName','seasonBadge','gwBadge','gwStateBadge','updatedAt'])assert.ok(html.includes(`id="${id}"`));
  assert.ok(tags(header,'a').some(l=>l['data-workbench-link']==='home'));
  for(const page of ['index.html','portal.html'])assert.ok(read(page).includes('/night-shell.css?v=96'));
});

test('entry and admin branding keeps existing navigation, privacy and login controls', () => {
  const discover = read('discover.html');
  const admin = read('admin.html');
  assert.ok(tags(discover, 'script').some(script => script.src === '/match-centre.js?v=105'));
  assert.ok(tags(discover, 'form').some(form => form.id === 'leagueForm' && form.action === '/' && form.method === 'get'));
  assert.ok(tags(discover, 'input').some(input => input.id === 'leagueId' && input.name === 'league'));
  assert.ok(tags(admin, 'meta').some(meta => meta.name === 'robots' && meta.content === 'noindex,nofollow'));
  assert.ok(tags(admin, 'form').some(form => form.id === 'loginForm'));
  assert.ok(tags(admin, 'input').some(input => input.id === 'adminPassword' && input.type === 'password'
    && input.autocomplete === 'current-password'));
  for (const file of ['index.html', 'discover.html']) {
    const html = read(file);
    assert.ok(tags(html, 'script').some(script => /^\/analytics\.js\?v=\d+$/.test(script.src || '')));
    assert.ok(tags(html, 'dialog').some(dialog => dialog.id === 'feedbackDialog'));
    assert.ok(!tags(html, 'a').some(link => /^\/admin(?:[/?#]|$)/.test(link.href || '')));
  }
});

test('header league search submits directly to a dedicated workspace without JavaScript', () => {
  const header = read('index.html').match(/<details\b[^>]*id="draftLeagueSwitch"[\s\S]*?<\/details>/)[0];
  assert.doesNotMatch(header, /官方 Draft 数据|查找其他联赛/);
  const form = tags(header, 'form').find(form => form.class.includes('draft-entry-form'));
  assert.equal(form.action, '/');
  assert.equal(form.method, 'get');
  assert.equal(form.role, 'search');
  const input = tags(header, 'input').find(input => input.id === 'headerLeagueId');
  assert.equal(input.name, 'league');
  assert.equal(input.inputmode, 'numeric');
  assert.equal(input.maxlength, '10');
  assert.match(header, /<label for="headerLeagueId">Draft 联赛 ID<\/label>/);
  assert.match(header, /<input[^>]+\brequired\b/);
  const validPattern = new RegExp(`^(?:${input.pattern})$`);
  for (const value of ['47275', '1', '1234567890', '00012']) assert.ok(validPattern.test(value));
  for (const value of ['', '0', '000', '-1', '1.2', 'abc', '12x', 'https://example.com']) assert.ok(!validPattern.test(value));
  assert.ok(header.indexOf('id="headerLeagueId"') < header.indexOf('>打开联赛 '));
  assert.ok(tags(header, 'button').some(button => button.type === 'submit'));
});

test('lime logo covers the workbench, match centre, admin and share exports', () => {
  assert.ok(read('index.html').includes(previewWordmarkUrl));
  assert.match(read('admin.html'),/admin-brand/);
  assert.ok(!read('admin.html').includes(wordmarkUrl));
  for (const file of ['discover.html']) {
    assert.ok(read(file).includes(previewWordmarkUrl));
    assert.ok(!read(file).includes(wordmarkUrl));
  }
  for (const file of ['app.js', 'match-share.js']) {
    assert.ok(read(file).includes(previewWordmarkUrl));
    assert.ok(!read(file).includes(wordmarkUrl));
  }
  const rule = read('compact-header.css').match(/\.tql-wordmark\.tql-logo-preview img\s*\{([^}]+)\}/)?.[1];
  assert.match(rule, /height:\s*auto/);
  assert.match(rule, /object-fit:\s*contain/);
  assert.match(rule, /filter:\s*none/);
  assert.match(rule, /mix-blend-mode:\s*normal/);
  const png = fs.readFileSync(path.join(publicDir, 'brand/tql-badge-preview-v47.png'));
  assert.equal(png.readUInt32BE(16), 1853);
  assert.equal(png.readUInt32BE(20), 849);
});

test('both share images carry TQL FPL while retaining league attribution and the original website', () => {
  for (const file of ['app.js', 'match-share.js']) {
    const source = read(file);
    assert.match(source, /TQL FPL/);
    assert.ok(source.includes(previewWordmarkUrl), `${file} uses the same approved header badge`);
    assert.match(source, /fftql\.team/);
    assert.match(source, /\?league=\$\{leagueId\}/);
    assert.match(source, /(?:meta|snapshot)\.leagueName/);
  }
  assert.match(read('app.js'), /\}\#share`/);
  assert.match(read('match-share.js'), /\}\#weekly`/);
});
