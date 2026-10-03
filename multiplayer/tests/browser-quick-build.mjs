import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {STRUCTURES} from '../shared/inventions.js';
import {worldTrees} from '../shared/world-content.js';
import {makeSave} from '../client/world-saves.js';
import {launch,BASE,record,save,shot,sleep} from './browser-acceptance-lib.mjs';
const sim=createSimulation({room:'SOLO'}),s=sim.adventureWorld();s.tick=1;s.landmarks=false;s.deposits=[];s.enemies=[];
s.harvestedTrees=worldTrees(s).map(t=>({id:t.id,cuts:3,cutHeight:terrainHeight(s,t.x,t.z)+.5,felledTick:1,fallYaw:0,landed:true}));
for(const k of Object.keys(s.inventions.stockpiles.party))s.inventions.stockpiles.party[k]=60;
// An intact storehouse makes the real shared stock available to the default Hero spawn.
s.inventions.structures.push({id:'qa-storehouse',type:'storehouse',position:[10,terrainHeight(s,10,8),8],yaw:0,hp:STRUCTURES.storehouse.hp,maxHp:STRUCTURES.storehouse.hp,side:'party',builtTick:0,readyTick:0,fireTick:-1000,open:false,charge:0,armed:false,aimYaw:0});
// Validate fixtures before launching Chromium: stale structure HP constants
// otherwise turn a precise schema rejection into a 30-second browser timeout.
loadSimulation(sim.checkpoint());
const fixture=Buffer.from(JSON.stringify(makeSave(sim.checkpoint())));
async function start(page,role){
 await page.goto(BASE+'/?acceptanceProbe');await page.waitForFunction(()=>window.brannHarness?.state().rendererReady);
 await page.fill('#name','Quick build QA');await page.check(`input[name="role"][value="${role}"]`,{force:true});
 await page.locator('#import').setInputFiles({name:'quick-build.json',mimeType:'application/json',buffer:fixture});
 await page.waitForFunction(()=>window.brannHarness?.state().phase==='game');await sleep(300);
}
const {browser,page}=await launch();
try{
 await start(page,'hero');
 const beforeTool=await page.evaluate(()=>window.brannHarness.controls().weapon.tool);
 await page.keyboard.press('b');await page.waitForFunction(()=>window.brannHarness.state().quickBuildOpen);
 assert.equal(await page.evaluate(()=>window.brannHarness.state().controlsActive),false);
 assert.equal(await page.locator('[data-qb-place="bridge"]').getAttribute('aria-disabled'),'true','bridge needs carried Wood even beside full shared stores');
 await page.keyboard.press('6');assert.equal(await page.evaluate(()=>window.brannHarness.state().quickBuildOpen),true);
 assert.equal(await page.evaluate(()=>window.brannHarness.controls().weapon.tool),beforeTool,'tray number does not equip a weapon');
 assert.match(await page.locator('[data-qb-place="bridge"]').innerText(),/Carry 3 more Wood/);
 await page.keyboard.press('b');assert.equal(await page.evaluate(()=>window.brannHarness.state().quickBuildOpen),false);
 await page.keyboard.press('b');await page.keyboard.press('2');
 await page.waitForFunction(()=>window.brannHarness.controls().inventionPlacement==='timberline');
 const specialBefore=await page.evaluate(()=>{const h=window.brannHarness;return h.snapshot().players.find(p=>p.id===h.state().playerId).specialTick;});await page.keyboard.press('q');await sleep(120);assert.equal(await page.evaluate(()=>{const h=window.brannHarness;return h.snapshot().players.find(p=>p.id===h.state().playerId).specialTick;}),specialBefore,'placement consumes special key');
 assert.equal(await page.evaluate(()=>window.brannHarness.state().quickBuildOpen),false);
 assert.equal(await page.evaluate(()=>window.brannHarness.controls().weapon.tool),beforeTool);
 await page.keyboard.press('Escape');await page.keyboard.press('t');
 await page.waitForFunction(()=>window.brannHarness.controls().inventionPlacement==='timberline');await page.keyboard.press('Escape');
 await page.keyboard.press('b');await page.keyboard.press('c');await page.waitForFunction(()=>window.brannHarness.state().forgeOpen);
 assert.equal(await page.locator('[data-ip-tab="build"]').getAttribute('aria-selected'),'true');await page.keyboard.press('Escape');
 await page.keyboard.press('b');await shot(page,'quick-build-desktop');await page.keyboard.press('Escape');
 assert.deepEqual(page.errors,[]);record('desktop-quick-build-key-routing-and-catalog','pass');
}catch(error){record('desktop-exception','fail',{message:error.message,errors:page.errors,text:await page.locator('body').innerText()});await shot(page,'quick-build-desktop-failure');process.exitCode=1;}
finally{await browser.close();}
const touch=await launch({touch:true,viewport:{width:844,height:390}});
try{
 const page=touch.page;await start(page,'god');
 assert.equal(await page.locator('.qb-entry').isVisible(),true,'touch Build is directly visible');
 await page.locator('.qb-entry').tap();await page.waitForFunction(()=>window.brannHarness.state().quickBuildOpen);
 assert.equal(await page.locator('[data-qb-place="foundation"]').getAttribute('aria-disabled'),'false');
 await shot(page,'quick-build-touch-landscape');
 await page.setViewportSize({width:390,height:650});await sleep(150);
 const bounds=await page.locator('.qb-tray').boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=391&&bounds.y+bounds.height<=650,'portrait tray fits viewport');
 await shot(page,'quick-build-touch-portrait');await page.locator('[data-qb-close]').tap();
 await page.setViewportSize({width:1280,height:720});await sleep(150);
 let built=false;
 for(const [x,y] of [[800,220],[650,180],[950,300],[350,200],[1000,220]]){
  await page.locator('.qb-entry').tap();await page.locator('[data-qb-place="foundation"]').tap();await page.touchscreen.tap(x,y);await sleep(220);
  if(await page.evaluate(()=>window.brannHarness.snapshot().inventions.structures.some(s=>s.type==='foundation'))){built=true;break;}
 }
 assert.ok(built,'touch quick-build places an authoritative foundation');
 await page.keyboard.press('t');assert.equal(await page.locator('[data-spell="frost"]').getAttribute('aria-checked'),'true','God T remains Frost');
 assert.deepEqual(page.errors,[]);record('touch-quick-build-portrait-landscape-foundation-and-god-T','pass');
}catch(error){record('touch-exception','fail',{message:error.message,errors:touch.page.errors,text:await touch.page.locator('body').innerText()});await shot(touch.page,'quick-build-touch-failure');process.exitCode=1;}
finally{save('quick-build');await touch.browser.close();}
