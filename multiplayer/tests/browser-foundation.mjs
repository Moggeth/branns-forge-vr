import assert from 'node:assert/strict';
import {createSimulation,terrainHeight} from '../shared/simulation.js';import {worldTrees} from '../shared/world-content.js';import {makeSave} from '../client/world-saves.js';
import {launch,BASE,record,save,shot,sleep} from './browser-acceptance-lib.mjs';
const sim=createSimulation(),s=sim.adventureWorld();s.tick=1;s.landmarks=false;s.deposits=[];
s.harvestedTrees=worldTrees(s).map(t=>({id:t.id,cuts:3,cutHeight:terrainHeight(s,t.x,t.z)+.5,felledTick:1,fallYaw:0,landed:true}));
for(const k of Object.keys(s.inventions.stockpiles.party))s.inventions.stockpiles.party[k]=60;
const {browser,page}=await launch({touch:true,viewport:{width:1280,height:720}});
async function place(type){await page.locator('[data-touch-action="menu"]').click();await page.locator('#menu [data-open-forge]').click();await page.locator('[data-ip-tab="build"]').click();await page.locator(`[data-ip-place="${type}"]`).click();}
try{
 await page.goto(BASE+'/?acceptanceProbe');await page.waitForFunction(()=>window.brannHarness?.state().rendererReady);await page.fill('#name','Foundation QA');await page.check('input[name="role"][value="god"]',{force:true});
 await page.locator('#import').setInputFiles({name:'foundation-qa.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(makeSave(sim.checkpoint())))});await page.waitForFunction(()=>window.brannHarness?.state().phase==='game');await sleep(500);
 let spot=null;
 for(const [x,y] of [[800,220],[650,180],[950,300],[350,200],[1000,220]]){await place('foundation');await page.touchscreen.tap(x,y);await sleep(250);if(await page.evaluate(()=>window.brannHarness.snapshot().inventions.structures.some(b=>b.type==='foundation'))){spot=[x,y];break;}}
 assert.ok(spot,'touch build foundation');await place('timberline');await page.touchscreen.tap(...spot);await page.waitForFunction(()=>window.brannHarness.snapshot().inventions.structures.some(b=>b.type==='timberline'));
 const result=await page.evaluate(()=>window.brannHarness.snapshot().inventions),tile=result.structures.find(b=>b.type==='foundation'),machine=result.structures.find(b=>b.type==='timberline');assert.ok(Math.abs(tile.position[1]-machine.position[1])<1e-6);assert.equal(result.stockpiles.party.stone,52);assert.equal(result.stockpiles.party.wood,50);assert.deepEqual(page.errors,[]);
 record('touch-build-foundation-then-supported-timberline','pass',{spot,tile:tile.position,machine:machine.position});await shot(page,'foundation-built');
}catch(e){record('exception','fail',{message:e.message,errors:page.errors,text:await page.locator('body').innerText()});await shot(page,'foundation-failed');process.exitCode=1;}finally{save('foundation');await browser.close();}
