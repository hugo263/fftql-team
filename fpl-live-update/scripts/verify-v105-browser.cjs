const {chromium}=require('/Users/ken/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../output/fpl-v105');fs.mkdirSync(out,{recursive:true});
(async()=>{
  const browser=await chromium.launch({executablePath:'/Users/ken/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});
  const page=await context.newPage(),errors=[],checks=[];page.on('pageerror',e=>errors.push(String(e)));
  for(const width of [320,390,768]) {
    await page.setViewportSize({width,height:844});await page.emulateMedia({colorScheme:'dark'});
    await page.goto('http://127.0.0.1:4430/',{waitUntil:'networkidle'});
    await page.locator('.price-bulletin').first().waitFor();
    const state=await page.evaluate(()=>({gw:document.querySelector('#portalGw').textContent,theme:getComputedStyle(document.documentElement).colorScheme,
      overflow:document.documentElement.scrollWidth>innerWidth,heights:[...document.querySelectorAll('.category-tabs>button')].map(e=>e.getBoundingClientRect().height),dots:[...document.querySelectorAll('.news-category')].map(e=>getComputedStyle(e,'::before').content)}));
    assert.ok(!state.overflow);assert.equal(new Set(state.heights).size,1);assert.ok(state.theme.includes('only'));assert.ok(state.dots.every(v=>v==='none'));assert.doesNotMatch(state.gw,/GW\s+\d/);
    checks.push({page:'portal',width,...state});await page.screenshot({path:out+`/portal-${width}.png`,fullPage:true});
  }
  await page.locator('.story h3 a').first().click();await page.locator('.price-bulletin--detail').waitFor();
  assert.equal(await page.locator('.price-bulletin--detail li').count(),3);await page.screenshot({path:out+'/price-detail.png',fullPage:true});
  for(const width of [390,1280]){
    await page.setViewportSize({width,height:900});await page.goto('http://127.0.0.1:4432/topics',{waitUntil:'networkidle'});
    assert.equal(await page.locator('.topic-card-art--club').count(),20);assert.ok(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth));
    await page.screenshot({path:out+`/topics-${width}.png`,fullPage:true});checks.push({page:'topics',width,clubs:20});
  }
  await page.setViewportSize({width:390,height:844});
  await page.goto('http://127.0.0.1:4430/?league=47275#weekly',{waitUntil:'domcontentloaded'});
  await page.locator('[data-match-gw]').first().waitFor({timeout:60000});
  await page.locator('[data-match-gw]').first().click();await page.locator('.md-player-name').first().waitFor({timeout:60000});
  for(const width of [320,390,768,1280]){
    await page.setViewportSize({width,height:844});
    const state=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,theme:getComputedStyle(document.documentElement).colorScheme,
      names:[...document.querySelectorAll('.md-player-name')].map(e=>({text:e.textContent,wrap:getComputedStyle(e).whiteSpace})),pitch:getComputedStyle(document.querySelector('.md-pitch')).backgroundColor,grass:document.querySelector('.md-pitch svg path').getAttribute('fill')}));
    assert.ok(!state.overflow);assert.equal(state.names.length,30);assert.ok(state.names.every(n=>n.wrap==='nowrap'));assert.equal(state.pitch,'rgb(243, 246, 239)');assert.equal(state.grass,'#a5ccab');
    checks.push({page:'match',width,...state});await page.screenshot({path:out+`/match-${width}.png`});
  }
  await page.evaluate(()=>{const original=window.FPLMatchShare;window.FPLMatchShare={createBlob:async detail=>{const blob=await original.createBlob(detail);window.__v105png=await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.readAsDataURL(blob);});return blob;}};Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write:async()=>{}}});});
  await page.locator('#matchDetailShare').click();await page.waitForFunction(()=>window.__v105png,{timeout:60000});
  fs.writeFileSync(out+'/match-share.png',Buffer.from((await page.evaluate(()=>window.__v105png)).split(',')[1],'base64'));
  await page.locator('#matchDetailClose').click();
  for(const width of [320,390,768])for(const mode of ['weekly','compare','share','standings']){
    await page.setViewportSize({width,height:844});await page.goto(`http://127.0.0.1:4430/?league=47275#${mode}`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.getElementById('leagueName')?.textContent!=='Draft 联赛',{timeout:60000});
    if(mode==='weekly'){await page.locator('[data-gw="5"]').click();await page.locator('#dreamTeamPitch .dt-name').first().waitFor();}
    if(mode==='standings'){await page.locator('#standingsBody tr[data-entry]').first().click();await page.locator('#squadModal.open').waitFor();}
    const selector=mode==='weekly'?'.dt-name':mode==='share'?'.share-player-name':'.cmp-player-name';
    await page.locator(selector+':visible').first().waitFor({timeout:60000});
    const state=await page.evaluate(sel=>({overflow:document.documentElement.scrollWidth>innerWidth,names:[...document.querySelectorAll(sel)].filter(e=>e.getBoundingClientRect().width>0).map(e=>({text:e.textContent,wrap:getComputedStyle(e).whiteSpace}))}),selector);
    assert.ok(!state.overflow,mode+' overflow '+width);assert.ok(state.names.length>0,mode+' missing names');assert.ok(state.names.every(n=>n.wrap==='nowrap'));
    checks.push({page:mode,width,...state});if(width===390)await page.screenshot({path:out+`/${mode}-390.png`});
    if(mode==='standings')await page.locator('#squadModalClose').click();
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(out+'/browser-checks.json',JSON.stringify({checks,errors},null,2));await browser.close();console.log('Browser checks passed');
})().catch(e=>{console.error(e);process.exit(1);});
