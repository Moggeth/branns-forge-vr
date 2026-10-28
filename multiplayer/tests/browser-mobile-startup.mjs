// Real DOM taps with the heavy game module and secondary GLBs deliberately held.
// Chromium touch emulation is not iPhone/Safari hardware acceptance.
import assert from 'node:assert/strict';
import {launch,BASE,record,save,shot,stubUnavailableRooms,enterSoloFromPlay} from './browser-acceptance-lib.mjs';
const {browser,page}=await launch({touch:true,turnPrompt:true,viewport:{width:390,height:844}});
let releaseGame,releaseExtras;
const gameGate=new Promise(r=>releaseGame=r),extrasGate=new Promise(r=>releaseExtras=r);
try {
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 const requested=[];
 page.on('request',r=>{if(r.url().endsWith('.glb'))requested.push(r.url());});
 await page.addInitScript(()=>{
   Object.defineProperty(document,'fullscreenEnabled',{get:()=>true});
   Element.prototype.requestFullscreen=()=>Promise.resolve();
   screen.orientation.lock=()=>new Promise(()=>{}); // platform promise may remain pending
   window.loadingProbe={tasks:[],tapAt:0,hiddenAt:0};
   new PerformanceObserver(list=>window.loadingProbe.tasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:true});
   new MutationObserver(changes=>{if(window.loadingProbe.tapAt&&changes.some(r=>r.target.classList?.contains('turn-phone')&&r.target.hidden))requestAnimationFrame(()=>window.loadingProbe.hiddenAt=performance.now());}).observe(document,{subtree:true,attributes:true,attributeFilter:['hidden']});
   document.addEventListener('click',e=>{if(e.target.closest('.tp-go'))window.loadingProbe.tapAt=performance.now();},true);
 });
 await page.route('**/client/game.js*',async r=>{await gameGate;await r.continue();});
 await page.route(/\/(grass_tuft|fern_delicate|heavy_launcher|waist_pouch)\.glb$/,async r=>{await extrasGate;await r.continue();});
 await stubUnavailableRooms(page);
 await page.goto(BASE+'/?acceptanceProbe',{waitUntil:'domcontentloaded'});
 await page.locator('.tp-go').tap();
 await page.waitForFunction(()=>document.querySelector('.turn-phone').hidden);
 await page.waitForFunction(()=>window.loadingProbe.hiddenAt>0);
 const ack=await page.evaluate(()=>window.loadingProbe.hiddenAt-window.loadingProbe.tapAt);
 assert.ok(ack<250,`rotation tap acknowledgement ${ack}ms`);
 assert.equal(await page.evaluate(()=>!!document.querySelector('#world').brannDiagnostics),false,'orientation works before renderer import');
 await page.waitForFunction(()=>window.brannHarness);
 const close=page.getByRole('button',{name:'Close patch notes',exact:true});if(await close.isVisible())await close.click();
 await page.locator('#friends').click();
 await page.locator('#statusCancel').click();
 releaseGame();
 await page.waitForFunction(()=>document.querySelector('#world').brannDiagnostics?.()?.startup.phase==='shadows',null,{timeout:120000});
 await page.setViewportSize({width:844,height:390});
 await page.waitForFunction(()=>document.querySelector('#world').brannDiagnostics?.()?.startup.ready,null,{timeout:120000});
 assert.equal(await page.evaluate(()=>window.brannHarness.state().phase),'lobby','cancelled early join must not enter later');
 const ready=await page.evaluate(()=>document.querySelector('#world').brannDiagnostics());
 assert.equal(ready.startup.error,null);assert.equal(ready.startup.secondaryReady,undefined,'blocked optional assets do not block entry');
 await enterSoloFromPlay(page);
 await page.waitForFunction(()=>window.brannHarness.state().connected);
 const atReady=requested.length;
 for(const viewport of [{width:844,height:390},{width:390,height:844},{width:844,height:390}]){await page.setViewportSize(viewport);await page.waitForTimeout(350);}
 assert.equal(requested.length,atReady,'rotation never restarts asset requests');
 const resized=await page.evaluate(()=>document.querySelector('#world').brannDiagnostics());
 assert.equal(resized.startup.readyMs,ready.startup.readyMs,'same scene survives rotation');
 releaseExtras();await page.waitForFunction(()=>document.querySelector('#world').brannDiagnostics().startup.secondaryReady,null,{timeout:30000});
 await page.locator('[data-touch-action="menu"]').tap();
 await page.locator('[data-mc-tab="controls"]').tap();
 await page.locator('#graphicsMode').selectOption('clarity');
 assert.equal(await page.evaluate(()=>document.querySelector('#world').brannDiagnostics().graphics.mode),'clarity');
 for(const viewport of [{width:390,height:650},{width:844,height:390}]){
   await page.setViewportSize(viewport);await page.waitForTimeout(150);
   const bounds=await page.locator('#graphicsMode').boundingBox();assert.ok(bounds&&bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=viewport.width&&bounds.y+bounds.height<=viewport.height,'graphics override is reachable on phone');
 }
 await shot(page,'mobile-graphics-settings');
 await page.locator('#graphicsMode').selectOption('auto');
 await page.locator('#resumePlay').tap();
 assert.deepEqual(page.errors,[]);
 record('mobile-early-input','pass',{emulation:'Chromium touch, CPU 4x; not iPhone 12',rotationAcknowledgementMs:ack,startup:ready.startup,graphics:resized.graphics,assetRequests:requested.length,capture:await shot(page,'mobile-startup-landscape')});
 save('mobile-startup');
} finally {releaseGame();releaseExtras();await browser.close();}
