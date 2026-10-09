const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require('/Users/ken/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const live = process.argv.includes('--live');
const phase = live ? 'live' : 'local';
const output = path.join(root, 'output/fpl-v107/browser');
const origin = 'https://fftql.team';
const files = new Map([
  ['/', ['portal.html', 'text/html']],
  ['/portal.css', ['portal.css', 'text/css']],
  ['/news-categories.css', ['news-categories.css', 'text/css']],
]);

(async () => {
  fs.mkdirSync(output, {recursive:true});
  const browser = await chromium.launch({headless:true, executablePath:'/Users/ken/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'});
  const results = [];
  try {
    for (const width of [1440, 768, 390, 320]) {
      const context = await browser.newContext({viewport:{width,height:900},colorScheme:'light'});
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      // Use real, read-only production news data; suppress test page-view events.
      await page.route(origin + '/**', async route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname.startsWith('/api/analytics')) return route.fulfill({status:204,body:''});
        const local = !live && files.get(pathname);
        if (local) return route.fulfill({status:200,contentType:local[1],body:fs.readFileSync(path.join(root,'public',local[0]))});
        return route.continue();
      });
      await page.goto(origin + '/#top', {waitUntil:'domcontentloaded', timeout:30000});
      await page.locator('.story .news-category').first().waitFor({timeout:30000});
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.evaluate(() => {
        const badge = document.querySelector('.story .news-category');
        const buttons = [...document.querySelectorAll('.category-tabs>button')];
        return {
          badgeHeight:badge.getBoundingClientRect().height,
          buttons:buttons.map(button => ({label:button.textContent,height:button.getBoundingClientRect().height})),
          overflow:document.documentElement.scrollWidth - window.innerWidth,
          category:badge.dataset.category,
          css:[...document.querySelectorAll('link[rel=stylesheet]')].filter(link => /(?:portal|news-categories)\.css/.test(link.href)).map(link => link.href),
        };
      });
      assert.equal(geometry.buttons.length, 11);
      for (const button of geometry.buttons) assert.ok(Math.abs(button.height - geometry.badgeHeight) < 0.25, button.label + ' height differs');
      assert.ok(Math.abs(geometry.badgeHeight - 24.5) < 0.25);
      assert.ok(geometry.overflow <= 1, 'Page overflows horizontally');
      assert.ok(geometry.css.every(href => href.includes('?v=107')));
      await page.locator('.news-controls').screenshot({path:path.join(output,`${phase}-${width}-filters.png`)});

      const filter = page.locator(`.category-tabs>button[data-category="${geometry.category}"]`);
      const response = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === '/api/news/pool' && url.searchParams.get('category') === geometry.category;
      });
      await filter.click();
      assert.equal((await response).status(), 200);
      await page.waitForFunction(category => {
        const list = document.getElementById('newsList');
        const stories = [...list.querySelectorAll('.story')];
        return list.getAttribute('aria-busy') === 'false' && stories.length && stories.every(story => story.dataset.category === category);
      }, geometry.category);
      assert.equal(await filter.getAttribute('aria-pressed'), 'true');
      await page.locator('.story h3 a').first().click();
      await page.locator('#newsDetailDialog[open] .detail-note').waitFor({timeout:15000});
      const alignment = await page.evaluate(() => {
        const button = document.getElementById('newsDetailClose');
        const b = button.getBoundingClientRect();
        const s = button.querySelector('svg').getBoundingClientRect();
        const dialog = document.getElementById('newsDetailDialog').getBoundingClientRect();
        return {dx:s.x+s.width/2-b.x-b.width/2,dy:s.y+s.height/2-b.y-b.height/2,width:b.width,height:b.height,dialogFits:dialog.left>=0 && dialog.right<=window.innerWidth,label:button.getAttribute('aria-label')};
      });
      assert.ok(Math.abs(alignment.dx) < 0.25 && Math.abs(alignment.dy) < 0.25, 'Close icon off center');
      assert.equal(alignment.width, 32);
      assert.equal(alignment.height, 32);
      assert.ok(alignment.dialogFits);
      assert.equal(alignment.label, '关闭资讯详情');
      await page.locator('#newsDetailDialog').screenshot({path:path.join(output,`${phase}-${width}-dialog.png`)});
      await page.getByRole('button', {name:'关闭资讯详情'}).click();
      await page.waitForFunction(() => !document.getElementById('newsDetailDialog').open);
      assert.ok(await page.locator('.story h3 a').first().evaluate(link => link === document.activeElement), 'Focus not restored');
      await page.locator('.story h3 a').first().click();
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('newsDetailDialog').open);
      assert.deepEqual(errors, []);
      results.push({width,geometry,alignment,filter:true,close:true,escape:true,focusRestored:true,pageErrors:errors});
      console.log(`${phase} ${width}px: category height ${geometry.badgeHeight}px, icon center ${alignment.dx}/${alignment.dy}px, close/filter/Esc passed`);
      await context.close();
    }
    fs.writeFileSync(path.join(output,phase+'-results.json'),JSON.stringify(results,null,2));
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
