import assert from 'node:assert/strict';
import {launch,enterWorld,me,record,save,shot,sleep} from './browser-acceptance-lib.mjs';
const {browser,page}=await launch({touch:true,viewport:{width:960,height:600}});
try{
 await enterWorld(page,{name:'Mastery review'});
 await page.waitForFunction(()=>document.querySelector('canvas').brannDiagnostics?.()?.mountains);
 await page.locator('[data-equip="axe"]').tap();
 const before=await me(page);await page.keyboard.press('KeyQ');
 await sleep(120);assert.equal((await me(page)).s.edits.filter(e=>e.kind==='axe_sunder').length,0,'no wave before release');
 await page.waitForFunction(()=>window.brannHarness.snapshot().edits.some(e=>e.kind==='axe_sunder'));
 let result=await me(page);assert.equal(result.s.edits.filter(e=>e.kind==='axe_sunder').length,6);assert.equal(result.s.deposits.filter(e=>e.special==='axe_sunder').length,3);
 record('axe-delayed-underhand-release-and-mineable-scar','pass',{tick:result.s.tick});await shot(page,'mastery-axe');
 await page.locator('[data-equip="pick"]').tap();
 await page.waitForFunction(()=>{const s=window.brannHarness.snapshot(),p=s.players.find(p=>p.id===window.brannHarness.state().playerId);return s.tick-p.specialTick>=240;});
 await page.keyboard.press('KeyQ');
 await page.waitForFunction(()=>window.brannHarness.snapshot().deposits.filter(d=>d.special==='pick_wall').length===7);
 await sleep(900);await shot(page,'mastery-crystal-wall');
 result=await me(page);assert.equal(result.s.edits.filter(e=>e.kind==='pick_wall').length,7);
 record('pick-persistent-curved-wall','pass',{deposits:result.s.deposits.filter(e=>e.special==='pick_wall').map(d=>[d.x,d.z])});
 const diagnostics=await page.evaluate(()=>document.querySelector('canvas').brannDiagnostics());record('render-budget','pass',diagnostics);
 await page.locator('[data-equip="bow"]').tap();await sleep(250);await shot(page,'mastery-left-bow');
 assert.deepEqual(page.errors,[]);record('console','pass');
}catch(e){record('exception','fail',{message:e.message});await shot(page,'mastery-failure');process.exitCode=1;}finally{save('weapon-mastery');await browser.close();}
