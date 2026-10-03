import assert from 'node:assert/strict';
import {launch,record,save,shot,BASE,sleep,me} from './browser-acceptance-lib.mjs';
import {createSimulation,terrainHeight} from '../shared/simulation.js';
import {makeSave} from '../client/world-saves.js';
import {worldTrees} from '../shared/world-content.js';
const {browser,page}=await launch({touch:true,viewport:{width:960,height:600}});
const sim=createSimulation({seed:17}),w=sim.adventureWorld();w.pickups=[];
w.looseLogs=[{id:'log999',sourceId:worldTrees(w)[0].id,position:[.5,terrainHeight(w,.5,7)+.18,7],quaternion:[0,0,-Math.SQRT1_2,Math.SQRT1_2],velocity:[0,0,0],angularVelocity:[0,0,0],heldBy:null,bornTick:0,sleeping:true}];
try{
 await page.goto(`${BASE}/?acceptanceProbe`);await page.waitForFunction(()=>window.brannHarness);
 await page.fill('#name','Lumber review');await page.check('input[name="role"][value="hero"]',{force:true});
 await page.locator('#import').setInputFiles({name:'lumber-review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(makeSave(sim.checkpoint())))});
 await page.waitForFunction(()=>window.brannHarness.snapshot()?.players.length);await sleep(900);
 const diagnostic=await page.evaluate(()=>document.querySelector('canvas').brannDiagnostics().collection);
 assert.equal(diagnostic.visible,true);assert.equal(diagnostic.targetId,'log999');record('nearby-pickup-highlight','pass',diagnostic);await shot(page,'lumber-before');
 const before=await me(page);await page.keyboard.press('KeyE');
 await page.waitForFunction(()=>!window.brannHarness.snapshot().looseLogs.some(l=>l.id==='log999'),null,{timeout:5000});
 assert.equal((await me(page)).self.resources.wood,before.self.resources.wood+1);
 await page.keyboard.press('KeyE');await sleep(120);assert.equal((await me(page)).self.resources.wood,before.self.resources.wood+1);
 record('E-collects-log-once-no-grab-required','pass');assert.deepEqual(page.errors,[]);await shot(page,'lumber-collected');
}catch(e){record('exception','fail',{message:e.message,text:await page.locator('body').innerText()});await shot(page,'lumber-failure');process.exitCode=1;}finally{save('lumber-highlight');await browser.close();}
