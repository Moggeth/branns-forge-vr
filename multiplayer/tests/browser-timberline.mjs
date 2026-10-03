import assert from 'node:assert/strict';
import { createSimulation, terrainHeight } from '../shared/simulation.js';
import { makeSave } from '../client/world-saves.js';
import { launch, BASE, record, save, shot, sleep } from './browser-acceptance-lib.mjs';
const sim = createSimulation(), state = sim.adventureWorld();
for (const key of Object.keys(state.inventions.stockpiles.party)) state.inventions.stockpiles.party[key] = 60;
state.inventions.structures.push({id:'timberline-ui-check',type:'timberline',position:[8,terrainHeight(state,8,2,false),2],yaw:0,hp:200,maxHp:200,side:'party',builtTick:0,readyTick:0,fireTick:-1000,open:false,charge:0,armed:false,aimYaw:0});
const {browser,page} = await launch({touch:true,viewport:{width:1280,height:720}});
try {
  await page.goto(BASE+'/?acceptanceProbe'); await page.waitForFunction(()=>window.brannHarness);
  await page.fill('#name','Timberline check'); await page.check('input[name="role"][value="god"]',{force:true});
  await page.locator('#import').setInputFiles({name:'timberline-check.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(makeSave(sim.checkpoint())))});
  await page.waitForFunction(()=>window.brannHarness.snapshot()?.inventions?.structures.some(s=>s.type==='timberline'));
  await sleep(500);
  for (const [x,y] of [[700,300],[650,250],[550,300],[750,350]]) {
    await page.locator('[data-touch-action="menu"]').click(); await page.locator('#menu [data-open-forge]').click();
    await page.locator('[data-ip-tab="built"]').click();
    await page.locator('[data-ip-operate="timberline-ui-check"]').click();
    await page.touchscreen.tap(x,y); await sleep(250);
    if (await page.evaluate(()=>window.brannHarness.snapshot().inventions.structures.find(s=>s.id==='timberline-ui-check').fireTick>0)) break;
  }
  const result=await page.evaluate(()=>window.brannHarness.snapshot().inventions);
  assert.ok(result.structures.find(s=>s.id==='timberline-ui-check').fireTick>0,'Aim & fire -> ground tap launches');
  assert.equal(result.stockpiles.party.wood,58); assert.equal(result.stockpiles.party.iron,59);
  record('Timberline-touch-aim-fire-ammunition','pass'); await shot(page,'timberline-operating');
  assert.deepEqual(page.errors,[]);
} catch(e) { record('exception','fail',{message:e.message}); await shot(page,'timberline-failure'); process.exitCode=1; }
finally { save('timberline'); await browser.close(); }
