// Real Chromium + trusted touch gestures. API failure branches are explicitly injected;
// viewport/touch emulation does not establish physical Android/iOS behavior.
import assert from 'node:assert/strict';
import {launch, BASE, record, save, shot} from './browser-acceptance-lib.mjs';
const {browser, page} = await launch({touch:true, viewport:{width:390,height:844}});
page.setDefaultTimeout(20000);
const fs = () => page.locator('.mui-fs');
const check = (name, ok, detail={}) => { record(name, ok?'pass':'fail', detail); assert.ok(ok,name); };
async function surface(name) {
  await fs().evaluate(async el => {
    const animations=[];for(let node=el;node;node=node.parentElement)animations.push(...node.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity));
    await Promise.all(animations.map(a=>a.finished.catch(()=>{})));
  });
  const result = await fs().evaluate(el => {
    const dialog=el.closest('[role=dialog]');
    const r=el.getBoundingClientRect(), hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    const other=[...document.querySelectorAll('.mui-util, .hud-self, .xhud, .mui-stick, #resumePlay, #leave, #menuButton, #quickBuildButton, .mc-tabs, .ip-x, .fo-close')]
      .filter(e=>(!dialog||dialog.contains(e))&&e!==el&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden')
      .filter(e=>{const b=e.getBoundingClientRect();return b.width&&b.height&&r.left<b.right&&r.right>b.left&&r.top<b.bottom&&r.bottom>b.top;})
      .map(e=>e.className||e.id);
    return {width:r.width,height:r.height,x:r.x,y:r.y,right:r.right,bottom:r.bottom,viewport:[innerWidth,innerHeight],hit:hit===el||el.contains(hit),other};
  });
  check(name, result.width>=44&&result.height>=44&&result.x>=0&&result.y>=0&&result.right<=result.viewport[0]&&result.bottom<=result.viewport[1]&&result.hit&&!result.other.length,result);
}
async function enter() { await fs().tap(); await page.waitForFunction(()=>!!document.fullscreenElement && document.querySelector('.mui-fs').getAttribute('aria-pressed')==='true'); check('real-fullscreen-entered',await fs().getAttribute('aria-pressed')==='true'); }
async function exit() { await page.evaluate(()=>document.exitFullscreen()); await page.waitForFunction(()=>!document.fullscreenElement && document.querySelector('.mui-fs').getAttribute('aria-pressed')==='false'); check('external-exit-state',await fs().getAttribute('aria-pressed')==='false'); }
try {
  await page.goto(BASE+'/?acceptanceProbe',{waitUntil:'domcontentloaded'});
  record('loaded','pass');
  await page.waitForFunction(()=>window.brannHarness);
  record('harness-ready','pass');
  const closeNotes=page.getByRole('button',{name:'Close patch notes'});
  if(await closeNotes.isVisible()){await surface('patch-notes');await closeNotes.tap();}
  await surface('lobby');
  await enter(); await exit();
  await page.getByRole('button',{name:'Play solo',exact:false}).tap();
  await page.waitForFunction(()=>window.brannHarness.state().controlsActive);
  await enter(); await exit();
  // Hero and God, both orientations, narrow phone and tablet. Real CSS + hit tests.
  for(const role of ['hero','god']) {
    if(role==='god') {
      await page.locator('[data-touch-action=menu]').tap();
      await page.locator('input[name=menuRole][value=god]').check({force:true});
      if(await page.locator('#resumePlay').isVisible())await page.locator('#resumePlay').tap();
      await page.waitForFunction(()=>window.brannHarness.state().role==='god');
    }
    for(const [width,height] of [[320,640],[390,844],[640,360],[844,390],[1024,768]]) {
      await page.setViewportSize({width,height});
      await surface(`${role}-${width}x${height}`);
      if(width===390||width===844)await shot(page,`fullscreen-${role}-${width}`);
      await page.locator('.mq-more').tap(); await surface(`${role}-tools-${width}`);
      await page.locator('.mq-more').tap();
    }
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('[data-touch-action=menu]').tap();
  for(const tab of ['play','controls','world','supplies']) {
    await page.locator(`[data-mc-tab=${tab}]`).tap();
    await surface(`menu-${tab}`);
  }
  await shot(page,'fullscreen-menu');
  await page.setViewportSize({width:844,height:390});await surface('menu-landscape');
  await page.setViewportSize({width:390,height:844});
  await enter(); await exit();
  await page.locator('#resumePlay').tap();
  await surface('resumed');
  for(const size of [{width:390,height:844},{width:844,height:390}]) {
    await page.setViewportSize(size);
    await page.locator('.qb-entry').tap();await surface('quick-build-'+size.width);await page.keyboard.press('Escape');
    await page.locator('[data-touch-action=menu]').tap();
    await page.locator('[data-mc-tab=play]').tap();
    await page.locator('#menu [data-open-forge]').tap();
    await surface('forge-'+size.width);
    await page.locator('.ip-x').tap();
    if(await page.locator('#resumePlay').isVisible())await page.locator('#resumePlay').tap();
    await page.locator('.mq-more').tap();
    await page.locator('[data-fo-open=help]').tap();
    await surface('field-guide-'+size.width);
    await page.locator('.fo-close').tap();
  }
  await page.setViewportSize({width:390,height:844});
  await enter();
  await page.keyboard.press('Escape');
  try {
    await page.waitForFunction(()=>!document.fullscreenElement && document.querySelector('.mui-fs').getAttribute('aria-pressed')==='false',null,{timeout:1500});
    await surface('escape-exit');
  } catch {
    record('native-escape','unverified',{reason:'Playwright key injection did not exit browser fullscreen; physical OS input is not available here.'});
    await exit();
  }
  await page.evaluate(()=>{for(const [key,value] of Object.entries({'--mq-t':'24px','--mq-r':'32px','--mq-l':'24px','--mq-b':'20px'}))document.body.style.setProperty(key,value);});
  await surface('simulated-safe-area');
  await shot(page,'fullscreen-safe-area');
  await page.evaluate(()=>{for(const key of ['--mq-t','--mq-r','--mq-l','--mq-b'])document.body.style.removeProperty(key);});
  // Returning from a suspended page must re-read the browser, never request entry.
  await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));document.dispatchEvent(new Event('visibilitychange'));});
  check('resume-does-not-request',await page.evaluate(()=>!document.fullscreenElement));
  // API rejections and unavailable implementations: no real browser permission change.
  await page.evaluate(()=>{window.savedRequest=document.documentElement.requestFullscreen;document.documentElement.requestFullscreen=()=>Promise.reject(new TypeError('Injected denial'));});
  await fs().tap();
  await page.waitForFunction(()=>document.querySelector('.toast').textContent.includes('declined fullscreen'));
  await surface('denied-still-reachable'); await shot(page,'fullscreen-denied');
  check('denial-truthful',await fs().getAttribute('aria-pressed')==='false');
  await page.evaluate(()=>{document.documentElement.requestFullscreen=undefined;document.documentElement.webkitRequestFullscreen=undefined;window.dispatchEvent(new PageTransitionEvent('pageshow'));});
  check('unsupported-label',(await fs().getAttribute('aria-label')).includes('unavailable'));
  await fs().tap();
  await page.waitForFunction(()=>document.querySelector('.toast').textContent.includes('Fullscreen is unavailable'));
  await surface('unsupported-still-reachable'); await shot(page,'fullscreen-unsupported');
  await page.evaluate(()=>{document.documentElement.requestFullscreen=window.savedRequest;window.dispatchEvent(new PageTransitionEvent('pageshow'));});
  await enter(); await exit();
  await fs().focus(); await fs().press('Enter');
  await page.waitForFunction(()=>!!document.fullscreenElement);
  check('keyboard-entry',await fs().getAttribute('aria-pressed')==='true');
  await fs().tap();
  await page.waitForFunction(()=>!document.fullscreenElement && document.querySelector('.mui-fs').getAttribute('aria-pressed')==='false');
  check('one-tap-button-exit',true);
  // Fullscreen is independent of the user's touch-stick preference and app display mode.
  await page.locator('[data-touch-action=menu]').tap();
  await page.locator('[data-mc-tab=controls]').tap();
  await page.locator('#touchMode').selectOption('off');
  await surface('touch-sticks-off');
  await page.locator('#resumePlay').tap();
  for(const size of [{width:390,height:844},{width:844,height:390}]) {await page.setViewportSize(size);await surface('touch-sticks-off-game-'+size.width);}
  await page.locator('#menuButton').tap();
  await page.locator('[data-mc-tab=controls]').tap();
  await page.locator('#touchMode').selectOption('auto');
  await page.setViewportSize({width:390,height:844});
  await page.locator('#touchLeftHanded').check();
  await page.locator('#resumePlay').tap();
  await surface('left-handed');
  await page.evaluate(()=>{Object.defineProperty(navigator,'standalone',{value:true,configurable:true});window.dispatchEvent(new PageTransitionEvent('pageshow'));});
  await surface('standalone');check('standalone-is-not-fullscreen',await fs().getAttribute('aria-pressed')==='false');
  // Choosing the standard implementation must never also invoke the prefixed API.
  await page.evaluate(()=>{window.prefixedCalls=0;document.documentElement.webkitRequestFullscreen=()=>{window.prefixedCalls++;};});
  await enter(); await exit();
  check('no-double-request',await page.evaluate(()=>window.prefixedCalls===0));
  await page.evaluate(()=>{document.documentElement.requestFullscreen=()=>undefined;});
  await fs().tap();check('void-return-no-double-request',await page.evaluate(()=>window.prefixedCalls===0));
  check('void-return-does-not-fake-state',await fs().getAttribute('aria-pressed')==='false');
  // Explicit legacy API injection: old WebKit reports completion via an event, not a promise.
  await page.evaluate(()=>{
    Object.defineProperty(document,'fullscreenEnabled',{value:false,configurable:true});
    Object.defineProperty(document,'webkitFullscreenEnabled',{value:true,configurable:true});
    document.documentElement.webkitRequestFullscreen=()=>{window.prefixedCalls++;};
    document.webkitExitFullscreen=()=>{Object.defineProperty(document,'webkitFullscreenElement',{value:null,configurable:true});document.dispatchEvent(new Event('webkitfullscreenchange'));};
  });
  await fs().tap();check('legacy-request-once',await page.evaluate(()=>window.prefixedCalls===1));
  check('legacy-waits-for-real-state',await fs().getAttribute('aria-pressed')==='false');
  await page.evaluate(()=>{Object.defineProperty(document,'webkitFullscreenElement',{value:document.documentElement,configurable:true});document.dispatchEvent(new Event('webkitfullscreenchange'));});
  check('legacy-change-state',await fs().getAttribute('aria-pressed')==='true');
  await fs().tap();check('legacy-exit-state',await fs().getAttribute('aria-pressed')==='false');
  await page.evaluate(()=>document.dispatchEvent(new Event('webkitfullscreenerror')));
  check('legacy-error-message',await page.locator('.toast').textContent().then(t=>t.includes('declined fullscreen')));
  check('no-page-errors',!page.errors.length,{errors:page.errors});
  const desktop=await browser.newPage({viewport:{width:1280,height:720}});
  await desktop.goto(BASE+'/?acceptanceProbe');await desktop.waitForFunction(()=>window.brannHarness);
  check('desktop-no-touch-fullscreen',!await desktop.locator('.mui-fs').isVisible());
  await desktop.close();
} catch(error) { record('exception','fail',{message:error.stack}); await shot(page,'fullscreen-failure'); process.exitCode=1; }
finally { save('fullscreen'); await browser.close(); }
