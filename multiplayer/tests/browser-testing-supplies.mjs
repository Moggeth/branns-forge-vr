import assert from 'node:assert/strict';
import {launch,BASE,record,save,shot,sleep} from './browser-acceptance-lib.mjs';
import {STRUCTURES} from '../shared/inventions.js';
const {browser,page}=await launch();
try{
 await page.goto(BASE+'/?acceptanceProbe');await page.waitForFunction(()=>window.brannHarness?.state().rendererReady);await page.locator('#solo').click();await page.waitForFunction(()=>window.brannHarness.state().controlsActive);await sleep(500);
 await page.locator('#world').click({position:{x:640,y:360}});await page.waitForFunction(()=>!!document.pointerLockElement);

 await page.keyboard.press('e');await page.waitForFunction(()=>!window.brannHarness.snapshot().pickups.some(q=>q.id.startsWith('timberlineGift_')),null,{timeout:5000});
 const p=await page.evaluate(()=>{const h=window.brannHarness;return h.snapshot().players.find(p=>p.id===h.state().playerId);});
 for(const[k,n]of Object.entries(STRUCTURES.timberline.cost))assert.equal(p.resources[k],n);
 await page.keyboard.press('b');assert.equal(await page.locator('[data-qb-place="timberline"]').getAttribute('aria-disabled'),'false');await shot(page,'timberline-gift-collected');assert.deepEqual(page.errors,[]);record('fresh-world-E-collects-exact-machine-recipe','pass',{resources:p.resources});
}catch(e){record('exception','fail',{message:e.message,state:await page.evaluate(()=>({state:window.brannHarness?.state(),snapshot:window.brannHarness?.snapshot()}))});await shot(page,'gift-failure');process.exitCode=1;}finally{await browser.close();save('testing-supplies');}

