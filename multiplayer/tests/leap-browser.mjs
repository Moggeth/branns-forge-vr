import assert from 'node:assert/strict';
import {launch,sleep} from './browser-acceptance-lib.mjs';
import {writeFileSync} from 'node:fs';
const began=performance.now();const {browser,page}=await launch();
try{
 await page.addInitScript(()=>localStorage.setItem('brann.patchNotes.seen','9999-12-31'));
 await page.addInitScript(()=>{
  window.leapFixture={pinch:0,hand:true,palm:[0,200,0]};
  window.EventSource=class {constructor(){this.readyState=1;this.timer=setInterval(()=>{const f=window.leapFixture;this.onmessage?.({data:JSON.stringify({status:'tracking',ageMs:0,sentAt:Date.now(),hands:f.hand?[{id:1,side:'right',pinch:f.pinch,palm:f.palm}]:[]})});},8);}close(){clearInterval(this.timer);this.readyState=2;}};
 });
 await page.goto((process.env.LEAP_BASE||'http://127.0.0.1:5194')+'/?leap',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('#world').brannDiagnostics()?.startup.ready,null,{timeout:90000});
 const dialogs=await page.locator('[role="dialog"]:visible').count();
 if(dialogs)await page.keyboard.press('Escape');
 await page.check('input[name="role"][value="god"]',{force:true});
 await page.click('#solo');
 await page.waitForFunction(()=>window.brannHarness.state().controlsActive);
 await page.check('#quickCast',{force:true});
 await page.click('#leapToggle');await sleep(250);
 const before=await page.evaluate(()=>window.brannHarness.snapshot().enemies.length);
 await page.evaluate(()=>window.leapFixture.pinch=.98);await sleep(300);const after=await page.evaluate(()=>window.brannHarness.snapshot().enemies.length);
 assert.equal(after,before+1,'pinch spawns one actual skeleton');
 await sleep(300);assert.equal(await page.evaluate(()=>window.brannHarness.snapshot().enemies.length),after,'held pinch does not repeat');
 await page.evaluate(()=>window.leapFixture.hand=false);await sleep(150);await page.evaluate(()=>window.leapFixture.hand=true);await sleep(150);assert.equal(await page.evaluate(()=>window.brannHarness.snapshot().enemies.length),after,'tracking loss does not recast');
 await page.evaluate(()=>window.leapFixture.pinch=0);await sleep(150);await page.click('[data-spell="sunder"]',{force:true});await sleep(150);
 await page.evaluate(()=>window.leapFixture.pinch=.98);await sleep(150);assert.ok(await page.evaluate(()=>window.brannHarness.controls().castStart),'line started');
 const editsBefore=await page.evaluate(()=>window.brannHarness.snapshot().edits.length);
 await page.evaluate(()=>window.leapFixture.palm=[85,200,0]);await sleep(250);await page.evaluate(()=>window.leapFixture.pinch=0);await sleep(400);
 assert.equal(await page.evaluate(()=>window.brannHarness.controls().castStart),null,'line released');
 const editsAfter=await page.evaluate(()=>window.brannHarness.snapshot().edits.length);
 assert.ok(editsAfter>editsBefore,'drawn line changes actual terrain');
 await page.evaluate(()=>window.leapFixture.pinch=.98);await sleep(150);await page.click('#menuButton');await page.evaluate(()=>window.leapFixture.pinch=0);await sleep(150);
 assert.equal(await page.evaluate(()=>window.brannHarness.controls().castStart),null,'menu cancels line');
 const output={before,after,editsBefore,editsAfter,errors:page.errors,elapsedSeconds:(performance.now()-began)/1000};
 assert.deepEqual(page.errors,[]);writeFileSync(new URL('../../logs/leap-browser-stream.json',import.meta.url),JSON.stringify(output,null,2));console.log(JSON.stringify(output));
}finally{await browser.close();}
