import assert from 'node:assert/strict';
import {launch,BASE,record,save,shot,sleep} from './browser-acceptance-lib.mjs';
const {browser,page}=await launch({viewport:{width:1440,height:900}});
try{
 await page.goto(BASE+'/?acceptanceProbe');await page.waitForFunction(()=>window.brannHarness?.state().rendererReady);await page.locator('#solo').click();await page.waitForFunction(()=>window.brannHarness?.state().controlsActive);await sleep(1200);await page.keyboard.press('Digit5');
 await page.locator('#world').click({position:{x:700,y:350}});await page.waitForFunction(()=>!!document.pointerLockElement);
 await page.mouse.down({button:'right'});await page.waitForFunction(()=>window.brannHarness.controls().weapon.ads>.98);assert.ok((await page.evaluate(()=>window.brannHarness.controls().weapon.fov))<57);
 await page.mouse.down({button:'left'});await page.keyboard.down('KeyW');await sleep(500);await page.keyboard.up('KeyW');await sleep(200);assert.equal(await page.evaluate(()=>window.brannHarness.controls().weapon.drawing),true);
 // Right click (zoom) owns the phoenix: drawing while zoomed latches the curve; Q is the Phoenix Flare.
 await page.mouse.move(780,340);await sleep(250);assert.equal(await page.evaluate(()=>window.brannHarness.controls().weapon.curved),true);await shot(page,'emberwing-curved-ads');
 const before=await page.evaluate(()=>{const h=window.brannHarness;return h.snapshot().players.find(p=>p.id===h.state().playerId).attackTick;});
 await page.mouse.up({button:'left'});await page.waitForFunction(before=>{const h=window.brannHarness;return h.snapshot().players.find(p=>p.id===h.state().playerId).attackTick>before;},before);
 await page.mouse.up({button:'right'});await page.waitForFunction(()=>window.brannHarness.controls().weapon.ads<.01);record('bow-ads-chord-move-phoenix','pass');
 // Real browser focus switching: capture must restore when Chromium permits,
 // or expose a single actionable gesture message if security blocks it.
 await page.evaluate(()=>{window.focusEvidence={blur:0,focus:0,visibility:0};for(const kind of ['blur','focus'])window.addEventListener(kind,()=>window.focusEvidence[kind]++);document.addEventListener('visibilitychange',()=>window.focusEvidence.visibility++);});const away=await page.context().newPage();await away.goto('about:blank');await away.bringToFront();await sleep(100);await page.bringToFront();await sleep(400);
 const capture=await page.evaluate(()=>!!document.pointerLockElement);const feedback=await page.locator('body').innerText();const evidence=await page.evaluate(()=>window.focusEvidence);if(!capture)assert.match(feedback,/Browser requires a gesture|Mouse capture was blocked|Mouse capture failed|Click the world to look around/);record('browser-focus-return',evidence.blur&&evidence.focus?'pass':'environment-limited',{capture,events:evidence,gestureFallback:!capture});await away.close();
 await page.keyboard.press('Escape');await sleep(100);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await sleep(150);assert.equal(await page.evaluate(()=>!!document.pointerLockElement),false);record('deliberate-escape-stays-free','pass');assert.deepEqual(page.errors,[]);
}catch(e){record('exception','fail',{message:e.message,errors:page.errors});await shot(page,'emberwing-failure');process.exitCode=1;}finally{await browser.close();save('emberwing');}
