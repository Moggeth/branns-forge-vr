import assert from 'node:assert/strict';
import {launch,BASE,record,save,shot,sleep,chooseTouchWeapon} from './browser-acceptance-lib.mjs';
for(const touch of [false,true]){
 const {browser,page}=await launch({touch,viewport:touch?{width:844,height:390}:{width:1440,height:900}});
 try{
  await page.goto(BASE+'/?acceptanceProbe');await page.waitForFunction(()=>window.brannHarness?.state().rendererReady);await page.locator('#solo').click();await page.waitForFunction(()=>window.brannHarness?.state().controlsActive);
  await sleep(1200);
  if(touch)await chooseTouchWeapon(page,'crossbow');else await page.keyboard.press('Digit4');
  await page.waitForFunction(()=>window.brannHarness.controls().weapon.tool==='crossbow');await sleep(500);await shot(page,'siegebird-'+(touch?'touch':'desktop')+'-hip');
  if(touch){await page.waitForFunction(()=>document.querySelector('#special .bf-name').textContent==='Aim');await page.locator('#special').tap();}
  else{await page.locator('#world').click({position:{x:720,y:360}});await page.waitForFunction(()=>!!document.pointerLockElement);await page.mouse.down({button:'right'});}
  await page.waitForFunction(()=>window.brannHarness.controls().weapon.ads>.99);const ads=await page.evaluate(()=>window.brannHarness.controls().weapon);assert.ok(ads.fov<59);await shot(page,'siegebird-'+(touch?'touch':'desktop')+'-ads');
  const before=await page.evaluate(()=>{const h=window.brannHarness;return h.snapshot().players.find(p=>p.id===h.state().playerId).attackTick;});
  if(touch)await page.locator('[data-touch-action="strike"]').tap();else {await page.mouse.down({button:'left'});await page.mouse.up({button:'left'});}
  await page.waitForFunction(before=>{const h=window.brannHarness;return h.snapshot().players.find(p=>p.id===h.state().playerId).attackTick>before;},before);record((touch?'touch':'desktop')+'-sight-and-fire','pass',{ads});
  if(touch)await page.locator('#special').tap();else await page.mouse.up({button:'right'});
  await page.waitForFunction(()=>window.brannHarness.controls().weapon.ads<.01);assert.deepEqual(page.errors,[]);
  await page.keyboard.press('KeyQ');await sleep(100);await page.keyboard.down('F1');await page.waitForFunction(()=>!window.brannHarness.controls().weapon.aiming);await page.keyboard.up('F1');
 }catch(e){record('exception','fail',{touch,message:e.message,errors:page.errors,state:await page.evaluate(()=>window.brannHarness?.controls())});await shot(page,'siegebird-failure-'+touch);process.exitCode=1;}finally{await browser.close();}
}
save('siegebird');
