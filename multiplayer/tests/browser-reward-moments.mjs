import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {STRUCTURES} from '../shared/inventions.js';
import {makeSave} from '../client/world-saves.js';
import {launch,BASE,record,save,shot,sleep} from './browser-acceptance-lib.mjs';

// Reward moments in the real client: a raid already won (validated fixture whose last foe is gone)
// and the fresh-world gift collected with E.
const sim=createSimulation({room:'SOLO'}),s=sim.adventureWorld();s.tick=1;
for(const k of Object.keys(s.inventions.stockpiles.party))s.inventions.stockpiles.party[k]=60;
s.inventions.structures.push({id:'qa-storehouse',type:'storehouse',position:[10,terrainHeight(s,10,8),8],yaw:0,hp:STRUCTURES.storehouse.hp,maxHp:STRUCTURES.storehouse.hp,side:'party',builtTick:0,readyTick:0,fireTick:-1000,open:false,charge:0,armed:false,aimYaw:0});
s.inventions.assault={side:'party',foes:['incursion-gone'],startTick:0};
loadSimulation(sim.checkpoint());
const fixture=Buffer.from(JSON.stringify(makeSave(sim.checkpoint())));
const diag=page=>page.evaluate(()=>document.querySelector('#world').brannDiagnostics().rewards);
async function burst(page,name,frames=[120,380,800]){const files=[];let at=0;for(const t of frames){await sleep(t-at);at=t;files.push(await shot(page,`${name}-${t}ms`));}return files;}

const {browser,page}=await launch();
try{
 await page.goto(BASE+'/?acceptanceProbe');await page.waitForFunction(()=>window.brannHarness?.state().rendererReady);
 await page.fill('#name','Reward QA');await page.check('input[name="role"][value="hero"]',{force:true});
 await page.locator('#import').setInputFiles({name:'reward-moments.json',mimeType:'application/json',buffer:fixture});
 await page.waitForFunction(()=>window.brannHarness?.state().phase==='game');
 await page.waitForFunction(()=>window.brannHarness.snapshot()?.inventions?.assault===null,null,{timeout:30000});
 const victory=await burst(page,'raid-victory',[60,300,700,1300]);
 const toast=await page.locator('#toast').innerText();
 assert.match(toast,/Raid repelled! Your stores gain 4 iron, 5 wood, 2 crystal and 1 star ore\./);
 const afterVictory=await diag(page);assert.ok(afterVictory.played>=1);
 record('raid-victory-plays-grand-moment-and-names-loot','pass',{toast,rewards:afterVictory,captures:victory});

 assert.deepEqual(page.errors,[]);
}catch(e){record('exception','fail',{message:e.message,errors:page.errors});await shot(page,'reward-failure');process.exitCode=1;}finally{await browser.close();}

const fresh=await launch();
try{
 const page=fresh.page;
 await page.goto(BASE+'/?acceptanceProbe');await page.waitForFunction(()=>window.brannHarness?.state().rendererReady);await page.locator('#solo').click({force:true,noWaitAfter:true});await page.waitForFunction(()=>window.brannHarness.state().controlsActive);await sleep(500);
 await page.mouse.click(640,360);await page.waitForFunction(()=>!!document.pointerLockElement);
 await page.keyboard.press('e');await page.waitForFunction(()=>!window.brannHarness.snapshot().pickups.some(q=>q.id.startsWith('timberlineGift_')),null,{timeout:30000});
 const gift=await burst(page,'gift-pickup',[60,250,500]);
 const r=await diag(page);assert.ok(r.played>=1);
 record('collecting-loot-plays-homing-pickup-moment','pass',{rewards:r,captures:gift});
 assert.deepEqual(page.errors,[]);
}catch(e){record('exception-fresh','fail',{message:e.message,errors:fresh.page.errors});await shot(fresh.page,'reward-fresh-failure');process.exitCode=1;}finally{await fresh.browser.close();save('reward-moments');}
