// Siegebird quick swap capture: fire, swap away while the reload bird is beside the rail, swap straight back, and
// capture the relief bird's delivery so the two birds can be compared. Desktop and phone sizes, on a stepped frame
// clock so a slow software renderer still sees the real timing.
// ACCEPT_BASE=http://127.0.0.1:5178 node tests/browser-siegebird-relief.mjs   (captures in logs/browser-acceptance)
import assert from 'node:assert/strict';
import {launch,BASE,record,save,shot,sleep} from './browser-acceptance-lib.mjs';
const tag=process.env.RELIEF_TAG||'relief';
for(const touch of [false,true]){
 const view=touch?{width:844,height:390}:{width:1440,height:900};
 const {browser,page}=await launch({touch,viewport:view,pointerLock:!touch});
 await page.addInitScript(()=>{
  const real=performance.now.bind(performance),raf=window.requestAnimationFrame.bind(window);let vt=0,on=false,queue=[];
  performance.now=()=>on?vt:real();
  window.requestAnimationFrame=cb=>{if(!on)return raf(cb);queue.push(cb);return queue.length;};
  window.__vt={enable(){vt=real();on=true;},frame(ms=1000/60){vt+=ms;const run=queue;queue=[];for(const cb of run)cb(vt);return run.length;}};
 });
 const frames=async n=>{for(let i=0;i<n;i++){await page.evaluate(()=>window.__vt.frame(1000/60));await sleep(6);}};
 const until=async(fn,arg)=>{for(let i=0;i<600;i++){if(await page.evaluate(fn,arg))return;await frames(1);}throw Error('never: '+fn);};
 const dismiss=()=>page.evaluate(()=>{for(const b of document.querySelectorAll('button'))if(b.textContent.trim()==='Got it'&&b.offsetParent)b.click();}).catch(()=>{});
 const attackTick=()=>page.evaluate(()=>{const h=window.brannHarness;return h.snapshot().players.find(p=>p.id===h.state().playerId).attackTick;});
 const name=`${tag}-${touch?'phone':'desktop'}`;
 try{
  await page.goto(BASE+'/?acceptanceProbe');await page.waitForFunction(()=>window.brannHarness?.state().rendererReady,null,{timeout:240000});
  // Release notes open once per fresh browser and again when the world is up: a DOM click, as slow renderers stall real ones.
  await dismiss();await page.locator('#solo').evaluate(b=>b.click());
  await page.waitForFunction(()=>{const s=window.brannHarness?.state();return s?.phase==='game'&&s.connected;},null,{timeout:180000});
  for(let i=0;i<20&&!(await page.evaluate(()=>window.brannHarness.state().controlsActive));i++){await dismiss();await sleep(1000);}
  await page.evaluate(()=>window.__vt.enable());await frames(30);
  await page.keyboard.press('Digit4');await until(()=>window.brannHarness.controls().weapon.tool==='crossbow');await frames(70);
  if(!touch)for(let i=0;i<12&&!(await page.evaluate(()=>!!document.pointerLockElement));i++){await dismiss();await page.mouse.click(view.width/2,view.height/2);await frames(3);}
  const before=await attackTick();
  if(touch){const b=await page.locator('[data-touch-action="strike"]').boundingBox();await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);}
  else{await page.mouse.down();await frames(3);await page.mouse.up();}
  for(let i=0;i<600&&(await attackTick())<=before;i++)await frames(1);
  assert.ok((await attackTick())>before,'the shot was fired');
  // Reload time: the bird enters at 0.26 s and hovers beside the rail from 0.62 s.
  await frames(36);await shot(page,`${name}-0-first-bird`);
  await page.keyboard.press('Digit1');await until(()=>window.brannHarness.controls().weapon.tool!=='crossbow');await frames(4);
  await page.keyboard.press('Digit4');await until(()=>window.brannHarness.controls().weapon.tool==='crossbow');
  for(let i=1;i<=8;i++){await frames(6);await shot(page,`${name}-${i}-after-swap`);}
  record(name,'pass');assert.deepEqual(page.errors,[]);
 }catch(e){record(name,'fail',{message:e.message,errors:page.errors});await shot(page,`${name}-failure`).catch(()=>{});process.exitCode=1;}finally{await browser.close();}
}
save(tag);
