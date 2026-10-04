import assert from 'node:assert/strict';
import {launch,BASE,record,save,shot,sleep,chooseTouchWeapon} from './browser-acceptance-lib.mjs';
for(const mobile of [false,true]){
 const {browser,page,context}=await launch({viewport:mobile?{width:844,height:390}:{width:1440,height:900},touch:mobile});
 try{
  await page.goto(BASE+'/?acceptanceProbe');await page.waitForFunction(()=>window.brannHarness?.state().rendererReady);await page.locator('#solo').click();await page.waitForFunction(()=>window.brannHarness?.state().controlsActive);await sleep(1000);
  if(!mobile){
   await page.keyboard.press('Digit5');await page.locator('#world').click({position:{x:700,y:350}});await page.waitForFunction(()=>!!document.pointerLockElement);await page.mouse.move(1030,300);await sleep(120);await page.mouse.down({button:'right'});await page.mouse.down({button:'left'});await sleep(350);await page.mouse.move(1070,285);
  }else{
   await chooseTouchWeapon(page,'bow');const cdp=await context.newCDPSession(page),b=await page.locator('[data-touch-action="strike"]').boundingBox(),q=await page.locator('#special').boundingBox();const p1={x:b.x+b.width/2,y:b.y+b.height/2,id:1},p2={x:q.x+q.width/2,y:q.y+q.height/2,id:2};
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p1]});await sleep(350);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p1,p2]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[p2]});
  }
  await page.waitForFunction(()=>document.querySelector('#world').brannDiagnostics()?.trajectory);await sleep(400);await shot(page,mobile?'phoenix-guide-mobile':'phoenix-guide-desktop');
  assert.deepEqual(page.errors,[]);record('phoenix-guide-'+(mobile?'mobile':'desktop'),'pass',{diagnostics:await page.locator('#world').evaluate(c=>({visible:c.brannDiagnostics().trajectory,timing:c.brannDiagnostics().guideTiming})),weapon:await page.evaluate(()=>window.brannHarness.controls().weapon),errors:page.errors});
 }catch(e){record('guide-exception','fail',{mobile,message:e.message,errors:page.errors});await shot(page,'phoenix-guide-failure');process.exitCode=1;}finally{await browser.close();}
}
const {browser,page}=await launch({viewport:{width:900,height:500}});
try{await page.goto(BASE+'/tests/phoenix-guide-review.html');await page.waitForFunction(()=>window.review?.ready);const r=await page.evaluate(()=>window.review);assert.equal(r.occlusionDiff,0);assert.ok(r.visibleDiff>500);assert.ok(r.materials.every(m=>m.depthTest&&!m.depthWrite));assert.deepEqual(page.errors,[]);await shot(page,'phoenix-guide-depth-fixture');record('phoenix-guide-depth-gpu','pass',r);}finally{await browser.close();}save('phoenix-guide');
