const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {chromium}=require('/Users/ken/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const out=path.resolve(__dirname,'../output/fpl-v105');
const files=['pitch.js','pitch.css','light-surfaces.css','responsive.css','news-categories.css','app.js','portal.js','match-centre.js','match-centre-share.js','home-tab.js','share-styles.js','portal-news-model.js','price-bulletin.css','share-styles.html','discover.html','index.html','portal.html'];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 const results=[];
 for(const file of files){const r=await fetch('https://fftql.team/'+file+'?v=105'+(file==='index.html'?'&league=47275':''),{signal:AbortSignal.timeout(15000)});assert.equal(r.status,200,file);assert.equal(hash(Buffer.from(await r.arrayBuffer())),hash(fs.readFileSync(path.resolve(__dirname,'../public',file))),file);results.push({file,status:200,hashMatches:true});}
 for(const url of ['https://fftql.team/','https://fftql.team/draft/?league=47275','https://fftql.team/admin','https://news.fftql.team/topics','https://news.fftql.team/all?category=prices','https://news.fftql.team/admin/login']){const r=await fetch(url,{signal:AbortSignal.timeout(15000)});assert.equal(r.status,200,url);await r.arrayBuffer();results.push({url,status:200});}
 const pool=await(await fetch('https://fftql.team/api/news/pool?category=prices',{signal:AbortSignal.timeout(15000)})).json();
 assert.equal(pool.items.length,2);assert.equal(pool.items.reduce((n,i)=>n+i.priceBatch.changes.length,0),10);
 for(const item of pool.items){const r=await fetch('https://fftql.team/api/news/items/'+item.id,{signal:AbortSignal.timeout(15000)});assert.equal(r.status,200);const detail=await r.json();assert.ok(JSON.stringify(detail).includes('priceBatch'));}
 const browser=await chromium.launch({executablePath:'/Users/ken/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844},colorScheme:'dark',extraHTTPHeaders:{DNT:'1'}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/api/analytics**',route=>route.fulfill({status:204}));
 await page.goto('https://fftql.team/',{waitUntil:'domcontentloaded'});await page.locator('.story').first().waitFor({timeout:30000});
 await page.locator('.category-tabs [data-category="prices"]').click();
 await page.waitForFunction(()=>document.querySelectorAll('.story').length===2&&document.querySelectorAll('.story .price-bulletin').length===2,{},{timeout:30000});
 assert.equal(await page.locator('.story').count(),2);assert.equal(await page.locator('#featuredNews').count(),0);
 const state=await page.evaluate(()=>({theme:getComputedStyle(document.documentElement).colorScheme,heights:[...document.querySelectorAll('.category-tabs>button')].map(e=>e.getBoundingClientRect().height),gw:document.querySelector('#portalGw').textContent,overflow:document.documentElement.scrollWidth>innerWidth}));
 assert.ok(state.theme.includes('only'));assert.equal(new Set(state.heights).size,1);assert.ok(!state.overflow);assert.doesNotMatch(state.gw,/GW\s+\d/);
 await page.screenshot({path:out+'/production-portal.png',fullPage:true});await page.locator('.story h3 a').first().click();await page.locator('.price-bulletin--detail li').first().waitFor();await page.screenshot({path:out+'/production-price-detail.png'});
 await page.goto('https://fftql.team/?league=47275#weekly',{waitUntil:'domcontentloaded'});await page.locator('[data-match-gw]').first().waitFor({timeout:60000});await page.locator('[data-match-gw]').first().click();await page.locator('.md-player-name:visible').first().waitFor({timeout:60000});
 assert.ok(await page.locator('.md-player-name').evaluateAll(es=>es.every(e=>getComputedStyle(e).whiteSpace==='nowrap')));
 await page.waitForFunction(()=>[...document.querySelectorAll('.md-kit img')].every(img=>img.complete&&img.naturalWidth>0),{},{timeout:60000});
 await page.screenshot({path:out+'/production-match.png'});
 await page.goto('https://news.fftql.team/topics',{waitUntil:'networkidle'});assert.equal(await page.locator('.topic-card-art--club').count(),20);await page.screenshot({path:out+'/production-topics.png'});
 assert.deepEqual(errors,[]);await browser.close();fs.writeFileSync(out+'/production-checks.json',JSON.stringify({results,priceBatches:pool.items.length,priceChanges:10,state,errors},null,2));console.log('Production checks passed');
})().catch(e=>{console.error(e);process.exit(1);});
