import assert from 'node:assert/strict';
import {launch,enterWorld,me,ctl,record,save,shot,sleep} from './browser-acceptance-lib.mjs';
const {browser,page}=await launch({touch:true,viewport:{width:960,height:600}});
const diag=()=>page.evaluate(()=>document.querySelector('canvas').brannDiagnostics());
try{
 await enterWorld(page,{name:'A long wandering adventurer'});
 await page.locator('[data-equip="crossbow"]').tap();await sleep(150);
 assert.equal(await page.locator('.rr-root').getAttribute('data-weapon'),'siegebird');await shot(page,'polish-siegebird');
 await page.locator('[data-equip="bow"]').tap();
 const attack=page.locator('[data-touch-action="strike"]'),b=await attack.boundingBox();
 await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await sleep(900);await page.keyboard.press('KeyQ');
 await page.waitForFunction(()=>document.querySelector('canvas').brannDiagnostics().trajectory);await shot(page,'polish-bow-guide');
 record('trajectory-live-budget','pass',{timing:(await diag()).guideTiming});
 assert.equal((await ctl(page)).weapon.drawing,true);await page.mouse.up();
 await page.waitForFunction(()=>!document.querySelector('canvas').brannDiagnostics().trajectory);record('bow-reticle-curved-guide-release','pass');
 await page.locator('[data-equip="flask"]').tap();await page.keyboard.press('KeyQ');await page.waitForFunction(()=>document.querySelector('canvas').brannDiagnostics().bottle.litAmount>.9);
 assert.equal((await diag()).bottle.lit,true);assert.ok((await diag()).bottle.litAmount>.9);await shot(page,'polish-emberdew-lit');
 await page.keyboard.down('KeyW');await sleep(350);await page.locator('[data-touch-action="strike"]').tap();await page.keyboard.up('KeyW');await sleep(150);
 record('emberdew-lit-moving-throw','pass',{bottle:(await diag()).bottle});
 await page.locator('[data-equip="wyrmspout"]').tap();const f=await attack.boundingBox();await page.mouse.move(f.x+f.width/2,f.y+f.height/2);await page.mouse.down();await sleep(1400);
 const fire=await diag();assert.ok(fire.fire.instances>0);assert.ok(fire.fire.draws<=4);assert.ok(fire.terrainRay.queries>0);await shot(page,'polish-wyrmspout');await page.mouse.up();record('fire-live-bounded-effects','pass',{fire:fire.fire,terrainRay:fire.terrainRay});
 await page.keyboard.press('F9');await page.waitForFunction(()=>window.brannHarness.snapshot().players.find(p=>p.id===window.brannHarness.state().playerId)?.role==='god');
 assert.equal(await page.locator('.rr-root').isVisible(),false);record('f9-perspective','pass');
 await sleep(2100);await page.locator('#perspectiveButton').tap();await page.waitForFunction(()=>window.brannHarness.snapshot().players.find(p=>p.id===window.brannHarness.state().playerId)?.role==='hero');
 record('one-tap-perspective','pass');
 await sleep(2100);await page.keyboard.press('F9');await sleep(250);
 for(const size of [{width:390,height:844},{width:844,height:390},{width:1280,height:720}]){
  await page.setViewportSize(size);await sleep(260);
  const clipped=await page.locator('.sb-card .bf-name').evaluateAll(xs=>xs.filter(x=>x.scrollHeight>x.clientHeight+1||x.scrollWidth>x.clientWidth+1).map(x=>x.textContent));assert.deepEqual(clipped,[]);
  await page.keyboard.down('F1');await sleep(180);await shot(page,`polish-help-${size.width}`);await page.keyboard.up('F1');
  await shot(page,`polish-ui-${size.width}`);
 }
 record('responsive-complete-spell-labels','pass');
 assert.deepEqual(page.errors,[]);record('console','pass');
}catch(e){record('exception','fail',{message:e.stack,errors:page.errors.slice(0,3)});await shot(page,'polish-failure');process.exitCode=1;}
finally{save('mining-polish');await browser.close();}
