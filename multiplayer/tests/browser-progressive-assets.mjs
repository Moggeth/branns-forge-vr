// Real controls, intentionally stalled optional models; no public room creation.
import assert from 'node:assert/strict';
import {launch,BASE,stubUnavailableRooms,enterSoloFromPlay,record,save,shot} from './browser-acceptance-lib.mjs';
for(const touch of [false,true]){
 const {browser,page}=await launch({touch,viewport:touch?{width:844,height:390}:{width:1280,height:720}});
 let release;const gate=new Promise(r=>release=r),waiting=[];
 try{
  await stubUnavailableRooms(page);
  await page.route(/\/assets\/(?:packed\/)?(?:pick|hammer|crossbow|bow|wyrmspout|stormreel|staff)(?:\.[a-f0-9]+)?\.glb(?:\.gz)?$/,async route=>{waiting.push(new URL(route.request().url()).pathname);await gate;await route.continue();});
  await page.goto(BASE+'/?acceptanceProbe',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#world')?.brannDiagnostics?.()?.startup.ready,null,{timeout:120000});
  const entry=await page.evaluate(()=>document.querySelector('#world').brannDiagnostics());
  assert.equal(entry.startup.error,null);assert.equal(entry.startup.initialModels,39);assert.equal(entry.startup.secondaryReady,undefined);
  const close=page.getByRole('button',{name:'Close patch notes',exact:true});if(await close.isVisible())await close.click();
  await enterSoloFromPlay(page);await page.waitForFunction(()=>window.brannHarness.state().controlsActive);
  const initial=await page.evaluate(()=>window.brannHarness.controls().weapon.tool);assert.equal(initial,'axe');
  await page.keyboard.press('Digit4');await page.waitForFunction(()=>document.querySelector('#world').brannDiagnostics().startup.pendingTool==='crossbow');
  await page.waitForFunction(()=>window.brannHarness.controls().weapon.tool==='axe');
  const until=Date.now()+5000;while(!waiting.some(p=>p.includes('crossbow'))&&Date.now()<until)await new Promise(r=>setTimeout(r,25));
  assert.ok(waiting.some(p=>p.includes('crossbow')),'requested tool bypasses stalled background delivery');
  await page.keyboard.press('Digit1');release();
  await page.waitForFunction(()=>document.querySelector('#world').brannDiagnostics().startup.secondaryReady,null,{timeout:120000});
  assert.equal(await page.evaluate(()=>window.brannHarness.controls().weapon.tool),'axe','cancelled selection cannot equip later');
  await page.keyboard.press('Digit4');await page.waitForFunction(()=>window.brannHarness.controls().weapon.tool==='crossbow');
  await page.keyboard.press('Digit2');await page.waitForFunction(()=>window.brannHarness.controls().weapon.tool==='pick');
  await page.waitForFunction(()=>document.querySelector('#world').brannDiagnostics().world.decorations.fading===0);
  const final=await page.evaluate(()=>document.querySelector('#world').brannDiagnostics());assert.equal(final.startup.error,null);assert.equal(final.world.decorations.groups,10);
  assert.deepEqual(page.errors,[]);record(touch?'progressive-touch':'progressive-desktop','pass',{entry:entry.startup,final:final.startup,world:final.world.decorations,waiting,capture:await shot(page,touch?'progressive-touch':'progressive-desktop')});
 }finally{release?.();await browser.close();}
}
save('progressive-assets');
