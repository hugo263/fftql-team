const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {chromium} = require('/Users/ken/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..'), live = process.argv.includes('--live');
const phase = live ? 'live' : 'local', output = path.join(root,'output/fpl-v111/browser');
const origin = 'https://fftql.team';
const localFiles = new Map([['/', ['index.html','text/html']],['/app.js',['app.js','application/javascript']],['/pitch.css',['pitch.css','text/css']]]);

async function settleImages(page, selector) {
  return page.evaluate(async selector => {
    const images=[...document.querySelectorAll(selector+' .cmp-kit-img')];
    images.forEach(image=>image.loading='eager');
    await Promise.all(images.map(image => image.complete ? null : new Promise(resolve => {
      const timer=setTimeout(resolve,8000);
      const done=()=>{clearTimeout(timer);resolve();};
      image.addEventListener('load',done,{once:true});image.addEventListener('error',done,{once:true});
    })));
    return {total:images.length,loaded:images.filter(image=>image.complete&&image.naturalWidth>0).length};
  },selector);
}

async function inspect(page, selector, entries, managerView=false) {
  const data = await page.evaluate(({selector,entries,managerView}) => {
    const parent = document.querySelector(selector);
    const source = new Map(entries.flatMap(id => managerByEntry(id).picks).map(pick => [pick.player.name,pick.player]));
    const gw = TIMELINE.reportGw(STATE.snap.meta);
    const label = managerView ? gw > 0 ? `GW${gw}` : '本轮' : '上轮';
    const key = managerView ? gw > 0 ? 'liveGwPoints' : null : 'lastGwPoints';
    const abbr = managerView ? 'GW' : 'LW';
    const value = n => n == null ? '—' : String(n);
    const description = n => n == null ? '暂无得分' : n+'pts';
    const rect = el => {const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
    const cards = [...parent.querySelectorAll('.cmp-pitch-player')].map(card => {
      const name = card.querySelector('.cmp-player-name').getAttribute('title');
      const player = source.get(name), scores = card.querySelector('.cmp-player-scores');
      const spans = [...scores.children], values = spans.map(line => line.textContent.trim());
      const round = key ? player[key] : null;
      const expected = [`${abbr} ${value(round)}`,'·',`T ${value(player.totalPoints)}`];
      const expectedDescription = `${label} ${description(round)}，总分 ${description(player.totalPoints)}`;
      const plate = rect(card.querySelector('.cmp-player-plate'));
      const row = rect(card.closest('.cmp-pitch,.cmp-bench'));
      const textRows = spans.map(rect);
      return {name,values,expected,aria:scores.getAttribute('aria-label'),title:scores.title,expectedDescription,
        scoreWidth:{available:scores.clientWidth,content:scores.scrollWidth,font:getComputedStyle(scores).fontSize},
        scoreFits:scores.scrollWidth<=scores.clientWidth+1,plateFits:plate.bottom<=row.bottom+1,
        singleLine:Math.max(...textRows.map(r=>r.top))<Math.min(...textRows.map(r=>r.bottom)),scoreHeight:rect(scores).height};
    });
    const legends = [...parent.querySelectorAll('.cmp-pitch-legend')].map(legend => {
      const pitch=legend.closest('.cmp-pitch'), r=rect(legend), p=rect(pitch);
      const overlaps = [...pitch.querySelectorAll('.cmp-pitch-player')].filter(card => {
        const c=rect(card);return c.left<r.right && c.right>r.left && c.top<r.bottom && c.bottom>r.top;
      }).map(card=>card.querySelector('.cmp-player-name').title);
      return {values:[...legend.children].map(el=>el.textContent),expected:[managerView?`GW＝${label}得分`:'LW＝上轮得分','T＝赛季总分','单位：pts'],
        inside:r.left>=p.left && r.right<=p.right+1 && r.top>=p.top && r.bottom<=p.bottom+1,overlaps};
    });
    return {cards,legends,overflow:document.documentElement.scrollWidth-window.innerWidth};
  },{selector,entries,managerView});
  assert.equal(data.cards.length, managerView ? 15 : 30);
  assert.equal(data.legends.length,managerView?1:2);
  assert.ok(data.overflow <= 1, 'Horizontal page overflow');
  for (const card of data.cards) {
    assert.deepEqual(card.values,card.expected,card.name + ': score differs from source');
    assert.equal(card.aria,card.expectedDescription);
    assert.equal(card.title,card.expectedDescription);
    assert.ok(card.scoreFits,card.name + ': score text overflows ' + JSON.stringify(card));
    assert.ok(card.plateFits,card.name + ': player clipped below pitch/bench');
    assert.ok(card.singleLine,card.name + ': captions are not a single row');
    assert.ok(card.scoreHeight<=28,card.name + ': row too tall');
  }
  for (const legend of data.legends) {
    assert.deepEqual(legend.values,legend.expected);
    assert.ok(legend.inside,'Legend outside pitch');
    assert.deepEqual(legend.overlaps,[],'Legend overlaps player');
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
      compare.images=await settleImages(page,'#compareBody');
      await page.locator('#compareBody .cmp-side').first().screenshot({path:path.join(output,`${phase}-${width}-compare.png`)});
      assert.ok(await page.locator('script[src*="app.js?v=111"]').count());
      assert.ok(await page.locator('link[href*="pitch.css?v=111"]').count());
      await page.locator('#tabs [data-group="rankings"]').click();
      await page.locator('#tabs [data-tab="standings"]').click();
      await page.locator(`#standingsBody tr[data-entry="${entries[0]}"]`).click();
      await page.locator('#squadModal.open .cmp-player-scores').first().waitFor();
      const modal = await inspect(page,'#squadModalBody',[entries[0]],true);
      modal.images=await settleImages(page,'#squadModalBody');
      await page.locator('#squadModal .cmp-pitch').screenshot({path:path.join(output,`${phase}-${width}-manager.png`)});
      await page.locator('#squadModalClose').click();
      assert.equal(await page.locator('#squadModal.open').count(),0);
      assert.deepEqual(errors,[]);
      results.push({width,compare,modal,pageErrors:errors});
      console.log(`${phase} ${width}px: 30 comparison + 15 manager captions match source; single row, legend, geometry and close passed`);
      await context.close();
    }
    fs.writeFileSync(path.join(output,`${phase}-results.json`),JSON.stringify(results,null,2));
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
