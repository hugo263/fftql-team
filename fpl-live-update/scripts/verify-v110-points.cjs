const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {chromium} = require('/Users/ken/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..'), live = process.argv.includes('--live');
const phase = live ? 'live' : 'local', output = path.join(root,'output/fpl-v110/browser');
const origin = 'https://fftql.team';
const localFiles = new Map([['/', ['index.html','text/html']],['/app.js',['app.js','application/javascript']],['/pitch.css',['pitch.css','text/css']]]);

async function inspect(page, selector, entries, managerView=false) {
  const data = await page.evaluate(({selector,entries,managerView}) => {
    const parent = document.querySelector(selector);
    const source = new Map(entries.flatMap(id => managerByEntry(id).picks).map(pick => [pick.player.name,pick.player]));
    const gw = TIMELINE.reportGw(STATE.snap.meta);
    const label = managerView ? gw > 0 ? `GW${gw}` : '本轮' : '上轮';
    const key = managerView ? gw > 0 ? 'liveGwPoints' : null : 'lastGwPoints';
    const caption = value => value == null ? '—' : value+'pts';
    const cards = [...parent.querySelectorAll('.cmp-pitch-player')].map(card => {
      const name = card.querySelector('.cmp-player-name').getAttribute('title');
      const player = source.get(name);
      const lines = [...card.querySelectorAll('.cmp-player-scores>span')];
      const values = lines.map(line => line.textContent.trim());
      const expected = [`${label} ${caption(key ? player[key] : null)}`,`总分 ${caption(player.totalPoints)}`];
      const plate = card.querySelector('.cmp-player-plate').getBoundingClientRect();
      const row = card.closest('.cmp-pitch,.cmp-bench').getBoundingClientRect();
      return {name,values,expected,scoreWidths:lines.map(line => ({available:line.clientWidth,content:line.scrollWidth,font:getComputedStyle(line).fontSize})),scoreFits:lines.every(line => line.scrollWidth<=line.clientWidth+1),plateFits:plate.bottom<=row.bottom+1,twoLines:lines[1].getBoundingClientRect().top>lines[0].getBoundingClientRect().top};
    });
    return {cards,overflow:document.documentElement.scrollWidth-window.innerWidth};
  },{selector,entries,managerView});
  assert.equal(data.cards.length, managerView ? 15 : 30);
  assert.ok(data.overflow <= 1, 'Horizontal page overflow');
  for (const card of data.cards) {
    assert.deepEqual(card.values,card.expected,card.name + ': score differs from source');
    assert.ok(card.scoreFits,card.name + ': score text overflows ' + JSON.stringify(card));
    assert.ok(card.plateFits,card.name + ': player clipped below pitch/bench');
    assert.ok(card.twoLines,card.name + ': captions are not separated');
  }
  return data;
}

(async () => {
  fs.mkdirSync(output,{recursive:true});
  const browser = await chromium.launch({headless:true,executablePath:'/Users/ken/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'});
  const results = [];
  try {
    const widthArg = process.argv.find(arg => arg.startsWith('--width='));
    for (const width of widthArg ? [Number(widthArg.slice(8))] : [1440,768,390,320]) {
      const context = await browser.newContext({viewport:{width,height:1000},colorScheme:'light'});
      const page = await context.newPage(), errors = [];
      page.on('pageerror',error => errors.push(error.message));
      await page.route(origin+'/**', async route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname.startsWith('/api/analytics')) return route.fulfill({status:204,body:''});
        const local = !live && localFiles.get(pathname);
        if (local) return route.fulfill({status:200,contentType:local[1],body:fs.readFileSync(path.join(root,'public',local[0]))});
        return route.continue();
      });
      await page.goto(origin+'/?league=47275#compare',{waitUntil:'domcontentloaded',timeout:30000});
      await page.locator('#compareBody .cmp-player-scores').first().waitFor({timeout:60000});
      await page.evaluate(() => document.fonts.ready);
      const entries = await page.evaluate(() => [STATE.cmpLeft,STATE.cmpRight]);
      const compare = await inspect(page,'#compareBody',entries);
      await page.locator('#compareBody .cmp-side').first().screenshot({path:path.join(output,`${phase}-${width}-compare.png`)});
      assert.ok(await page.locator('script[src*="app.js?v=110"]').count());
      assert.ok(await page.locator('link[href*="pitch.css?v=110"]').count());
      await page.locator('#tabs [data-group="rankings"]').click();
      await page.locator('#tabs [data-tab="standings"]').click();
      await page.locator(`#standingsBody tr[data-entry="${entries[0]}"]`).click();
      await page.locator('#squadModal.open .cmp-player-scores').first().waitFor();
      const modal = await inspect(page,'#squadModalBody',[entries[0]],true);
      await page.locator('#squadModal .cmp-pitch').screenshot({path:path.join(output,`${phase}-${width}-manager.png`)});
      await page.locator('#squadModalClose').click();
      assert.equal(await page.locator('#squadModal.open').count(),0);
      assert.deepEqual(errors,[]);
      results.push({width,compare,modal,pageErrors:errors});
      console.log(`${phase} ${width}px: 30 comparison + 15 manager captions match source, pts/geometry/close passed`);
      await context.close();
    }
    fs.writeFileSync(path.join(output,`${phase}-results.json`),JSON.stringify(results,null,2));
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
