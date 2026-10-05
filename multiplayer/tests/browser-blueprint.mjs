// Blueprint placement acceptance: real keyboard/mouse/touch input. The ghost follows the crosshair every frame,
// left-click places, right-click and Esc cancel, R turns it, Shift keeps building; touch taps move it and Place confirms.
import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {STRUCTURES} from '../shared/inventions.js';
import {worldTrees} from '../shared/world-content.js';
import {makeSave} from '../client/world-saves.js';
import {launch,BASE,record,save,shot,sleep} from './browser-acceptance-lib.mjs';
const sim=createSimulation({room:'SOLO'}),s=sim.adventureWorld();s.tick=1;s.landmarks=false;s.deposits=[];s.enemies=[];
s.harvestedTrees=worldTrees(s).map(t=>({id:t.id,cuts:3,cutHeight:terrainHeight(s,t.x,t.z)+.5,felledTick:1,fallYaw:0,landed:true}));
for(const k of Object.keys(s.inventions.stockpiles.party))s.inventions.stockpiles.party[k]=200;
s.inventions.structures.push({id:'qa-storehouse',type:'storehouse',position:[10,terrainHeight(s,10,8),8],yaw:0,hp:STRUCTURES.storehouse.hp,maxHp:STRUCTURES.storehouse.hp,side:'party',builtTick:0,readyTick:0,fireTick:-1000,open:false,charge:0,armed:false,aimYaw:0});
loadSimulation(sim.checkpoint());
const fixture=Buffer.from(JSON.stringify(makeSave(sim.checkpoint())));
async function start(page,role){
 page.setDefaultTimeout(90000);
 await page.goto(BASE+'/?acceptanceProbe');await page.waitForFunction(()=>window.brannHarness?.state().rendererReady);
 await sleep(800);const gotIt=page.getByRole('button',{name:'Got it'});if(await gotIt.isVisible().catch(()=>false))await gotIt.click();
 await page.fill('#name','Blueprint QA');await page.check(`input[name="role"][value="${role}"]`,{force:true});
 await page.locator('#import').setInputFiles({name:'blueprint.json',mimeType:'application/json',buffer:fixture});
 await page.waitForFunction(()=>window.brannHarness?.state().phase==='game');await sleep(1500);if(await gotIt.isVisible().catch(()=>false))await gotIt.click();record(`${role}-joined`,'info');
}
const mode=page=>page.evaluate(()=>window.brannHarness.controls().inventionPlacement);
const count=page=>page.evaluate(()=>window.brannHarness.snapshot().inventions.structures.length);
const grew=(page,n)=>page.waitForFunction(n=>window.brannHarness.snapshot().inventions.structures.length>n,n,{timeout:30000});
// Software-rendered Chromium can drop a key between slow frames; retry the tray until build mode is on.
async function choose(page,key,type){for(let i=0;i<6;i++){
  if(!(await page.evaluate(()=>window.brannHarness.state().quickBuildOpen))){await page.keyboard.press('b');try{await page.waitForFunction(()=>window.brannHarness.state().quickBuildOpen,null,{timeout:15000});}catch{continue;}}
  await page.keyboard.press(key);try{await page.waitForFunction(t=>window.brannHarness.controls().inventionPlacement===t,type,{timeout:15000});return;}catch{}}
 throw Error(`could not choose ${type}`);}
{
 const {browser,page}=await launch({pointerLock:true});
 try{
  await start(page,'hero');
  await page.mouse.click(640,360);await page.waitForFunction(()=>document.pointerLockElement);
  // Turn away from the Forge apron and look down at the meadow.
  await page.mouse.move(1340,690,{steps:3});await sleep(3000);
  await choose(page,'3','storehouse');await sleep(2000);
  assert.ok(await page.evaluate(()=>document.pointerLockElement),'the crosshair stays captured while building');
  const hud=page.locator('.bp-hud');assert.equal(await hud.isVisible(),true,'placement tooltip shows');
  assert.match(await hud.innerText(),/Placing Storehouse/);assert.match(await hud.innerText(),/Right-click/);
  await shot(page,'blueprint-desktop-storehouse');record('ghost-and-tooltip','pass',{hud:await hud.innerText()});
  await page.mouse.down({button:'right'});await page.mouse.up({button:'right'});await page.waitForFunction(()=>!window.brannHarness.controls().inventionPlacement);
  assert.equal(await hud.isVisible(),false);assert.equal((await page.evaluate(()=>window.brannHarness.controls().weapon)).aiming,false,'cancel never sights');record('right-click-cancel','pass');
  await choose(page,'3','storehouse');await page.keyboard.press('r');await sleep(2000);await shot(page,'blueprint-desktop-rotated');
  let n=await count(page);await page.mouse.down();await sleep(200);await page.mouse.up();await grew(page,n);
  assert.equal(await mode(page),null,'a plain click places once');record('left-click-place','pass');
  await page.mouse.move(1140,690,{steps:3});await sleep(2000);
  await choose(page,'1','foundation');await sleep(2000);await shot(page,'blueprint-desktop-foundation');
  n=await count(page);await page.keyboard.down('Shift');await page.mouse.down();await sleep(200);await page.mouse.up();await page.keyboard.up('Shift');await sleep(2000);
  assert.equal(await mode(page),'foundation','Shift-click keeps building');record('shift-repeat','pass',{built:await count(page)>n});
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.brannHarness.controls().inventionPlacement);record('escape-cancel','pass');
  assert.deepEqual(page.errors,[]);record('console','pass');
 }catch(e){record('desktop-exception','fail',{message:e.message});await shot(page,'blueprint-desktop-failure').catch(()=>{});process.exitCode=1;}finally{await browser.close();}
}
{
 const {browser,page}=await launch({touch:true,viewport:{width:844,height:390}});
 try{
  await start(page,'hero');
  await page.locator('.qb-entry').tap();await page.locator('[data-qb-place="sanctuary"]').tap();
  await page.waitForFunction(()=>window.brannHarness.controls().inventionPlacement==='sanctuary');await sleep(2000);
  assert.equal(await page.locator('.bp-hud [data-bp="place"]').isVisible(),true,'touch shows a Place button');
  await shot(page,'blueprint-phone-centre');
  await page.touchscreen.tap(140,250);await sleep(2000);assert.equal(await mode(page),'sanctuary','a tap moves the blueprint, it does not build');
  await shot(page,'blueprint-phone-tapped');
  await page.locator('.bp-hud [data-bp="rotate"]').tap();await sleep(1000);
  // The default spawn sits on the Forge apron, so this spot is refused: Place explains instead of building.
  const n=await count(page);await page.locator('.bp-hud [data-bp="place"]').tap({force:true});await sleep(1500);
  assert.equal(await count(page),n,'a refused spot never builds');assert.equal(await mode(page),'sanctuary');assert.match(await page.locator('.bp-why').innerText(),/Forge apron/);record('touch-refused-place','pass');
  await page.locator('.bp-hud [data-bp="cancel"]').tap();await page.waitForFunction(()=>!window.brannHarness.controls().inventionPlacement);record('touch-cancel','pass');
  assert.deepEqual(page.errors,[]);record('touch-console','pass');
 }catch(e){record('touch-exception','fail',{message:e.message});await shot(page,'blueprint-phone-failure').catch(()=>{});process.exitCode=1;}finally{save('blueprint');await browser.close();}
}
