const {chromium}=require('/Users/ken/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const base=process.env.V106_BASE||'http://127.0.0.1:4430',label=base.includes('127.0.0.1')?'local':'production';
const out=path.resolve(__dirname,'../output/fpl-v106');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:'/Users/ken/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000},extraHTTPHeaders:{DNT:'1'}}),errors=[],checks=[];
 page.on('pageerror',error=>errors.push(String(error)));
 await page.route('**/api/analytics**',route=>route.fulfill({status:204}));
 try {
  await page.goto(base+'/?league=47275#home',{waitUntil:'domcontentloaded'});
  await page.locator('#homeContent .event-filters button').first().waitFor({timeout:60000});
  await page.waitForFunction(()=>[...document.getElementById('homeContent').shadowRoot.querySelectorAll('link[rel=stylesheet]')].every(link=>link.sheet));
  for(const width of [1440,768,390,320]) {
   await page.setViewportSize({width,height:1000});
   const geometry=await page.evaluate(()=>{
    const root=document.getElementById('homeContent').shadowRoot;
    const panels=['.events-panel','.scores-panel'].map(selector=>{
     const panel=root.querySelector(selector),title=panel.querySelector('h2'),filter=panel.querySelector(selector==='.events-panel'?'.event-filters':'.segmented');
     return {title:title.getBoundingClientRect().left,button:filter.querySelector('button').getBoundingClientRect().left,padding:getComputedStyle(filter).paddingLeft,panel:panel.getBoundingClientRect().left};
    });
    return {panels,removed:!root.querySelector('.prototype-note'),overflow:document.documentElement.scrollWidth>innerWidth};
   });
   assert.ok(geometry.removed);assert.ok(!geometry.overflow);
   for(const p of geometry.panels){assert.ok(Math.abs(p.title-p.button)<1,JSON.stringify({width,p}));assert.ok(p.button-p.panel>=16);}
   checks.push({page:'home',width,...geometry});
   if(width===1440||width===390)await page.locator('#homeContent').screenshot({path:out+`/${label}-home-${width}.png`});
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('#tabs [data-tab=fixtures]').click();
  await page.locator('.fx-gw-pill').first().waitFor({timeout:60000});
  const rail=()=>page.locator('.fx-gw-pill').evaluateAll(buttons=>buttons.map(b=>Number(b.dataset.round)));
  const selected=()=>page.locator('.fx-gw-pill[aria-pressed=true]').getAttribute('data-round').then(Number);
  const initial=await rail(),interior=initial[3];
  await page.evaluate(()=>{window.__v106nodes=[...document.querySelectorAll('.fx-gw-pill')];window.__v106positions=window.__v106nodes.map(n=>n.getBoundingClientRect().left);});
  await page.locator(`.fx-gw-pill[data-round="${interior}"]`).click();
  assert.deepEqual(await rail(),initial);
  assert.ok(await page.evaluate(()=>window.__v106nodes.every((node,index)=>node===document.querySelectorAll('.fx-gw-pill')[index]&&Math.abs(node.getBoundingClientRect().left-window.__v106positions[index])<1)));
  await page.locator('.fx-gw-pill').first().click();
  const left=await rail();assert.deepEqual(left,initial.map(gw=>gw-1));
  await page.locator('.fx-gw-pill').last().click();assert.deepEqual(await rail(),initial);
  await page.evaluate(()=>window.FPLFixtures.render(STATE.snap));assert.deepEqual(await rail(),initial);
  await page.locator('.fx-manager-choice').first().click();assert.deepEqual(await rail(),initial);
  await page.locator('#fxMatchPrev').click();assert.deepEqual(await rail(),initial);
  for(let i=0;i<38&&!await page.locator('#fxMatchNext').isDisabled();i++)await page.locator('#fxMatchNext').click();
  assert.equal(await selected(),38);assert.deepEqual(await rail(),[32,33,34,35,36,37,38]);assert.ok(await page.locator('#fxMatchNext').isDisabled());
  for(let i=0;i<38&&!await page.locator('#fxMatchPrev').isDisabled();i++)await page.locator('#fxMatchPrev').click();
  assert.equal(await selected(),1);assert.deepEqual(await rail(),[1,2,3,4,5,6,7]);assert.ok(await page.locator('#fxMatchPrev').isDisabled());
  await page.locator('#fxMatchReset').click();assert.deepEqual(await rail(),initial);
  checks.push({page:'fixtures',width:1440,initial,interior,nodeIdentityPreserved:true,edgeReveal:true,refreshStable:true,boundaries:true});
  await page.locator('#fxMatchPanel').screenshot({path:out+`/${label}-fixtures-1440.png`});
  for(const width of [390,320]){
   await page.setViewportSize({width,height:900});
   const before=await rail();await page.locator('#fxMatchNext').click();assert.deepEqual(await rail(),before);
   const visible=await page.locator('.fx-gw-pill[aria-pressed=true]').evaluate(button=>{const a=button.getBoundingClientRect(),b=button.parentElement.getBoundingClientRect();return a.left>=b.left-1&&a.right<=b.right+1;});
   assert.ok(visible);assert.ok(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth));
   checks.push({page:'fixtures',width,selectedVisible:visible,windowStable:true});
   await page.locator('#fxMatchReset').click();
  }
  await page.screenshot({path:out+`/${label}-fixtures-320.png`});
  assert.deepEqual(errors,[]);fs.writeFileSync(out+`/${label}-checks.json`,JSON.stringify({base,checks,errors},null,2));console.log(label+' browser checks passed');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
