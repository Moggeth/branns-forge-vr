import assert from 'node:assert/strict';
import {launch,enterWorld,me,record,save,shot,sleep} from './browser-acceptance-lib.mjs';
const {browser,page}=await launch();
try{
 await enterWorld(page,{role:'god',name:'Solo forge review'});
 assert.equal(await page.locator('.sb-card').count(),14);
 await page.locator('.sb-next').click();await sleep(150);
 await page.locator('[data-spell="frost"]').click();
 assert.equal(await page.locator('[data-spell="frost"]').getAttribute('aria-checked'),'true');
 record('last-spell-reachable','pass');
 await page.keyboard.press('Digit1');
 await page.mouse.move(550,310);await shot(page,'solo-skeleton-preview');
 const before=(await me(page)).s.enemies.length;
 await page.mouse.click(550,310);
 await page.waitForFunction(n=>window.brannHarness.snapshot().enemies.length>n,before);
 assert.ok(await page.locator('.sb-cooling').count()>0,'shared recovery appears on spell cards');
 record('cast-and-authoritative-cooldown','pass');
 await page.locator('#godHelp [data-open-forge]').click();
 assert.equal(await page.evaluate(()=>window.brannHarness.state().controlsActive),false);
 const tall=await page.locator('.fs-act-label').evaluateAll(xs=>xs.filter(x=>x.getBoundingClientRect().height>55).map(x=>x.textContent));
 assert.deepEqual(tall,[],'readable action labels');
 await page.locator('.fs-act').filter({hasText:'Summon worker'}).click();
 await page.waitForFunction(()=>window.brannHarness.snapshot().settlement.workers.length===1);
 const id=(await me(page)).s.settlement.workers[0].id;
 await page.locator(`[data-fs-worker="${id}"][data-fs-kind="stone"]`).click();
 await page.waitForFunction(()=>window.brannHarness.snapshot().settlement.workers[0].job==='stone');
 await shot(page,'solo-forge-desktop');
 record('worker-summon-and-job','pass');
 await page.locator('.fs-x').click();
 await page.locator('#godHelp [data-open-forge]').click();
 await page.locator('.fs-act').filter({hasText:'Challenge raid'}).click();
 assert.equal((await me(page)).s.settlement.encounter,null,'first click only confirms');
 await page.locator('.fs-act.fs-armed').click();
 await page.waitForFunction(()=>!!window.brannHarness.snapshot().settlement.encounter);
 record('deliberate-raid','pass');
 await page.locator('.fs-x').click();
 await page.locator('#menuButton').click();
 await page.locator('#damageNumbers').check();
 assert.equal(await page.evaluate(()=>localStorage.getItem('branns-forge.damage-numbers')),'on');
 await page.locator('#resumePlay').click();
 for(const size of [{width:390,height:844},{width:844,height:390},{width:1024,height:768}]){
  await page.setViewportSize(size);await sleep(100);
  await page.locator('#godHelp [data-open-forge]').click();
  await sleep(260); // measure the settled drawer, not its entrance translation
  const b=await page.locator('.fs-panel').boundingBox();assert.ok(b.x>=0&&b.y>=0&&b.x+b.width<=size.width+1&&b.y+b.height<=size.height+1);
  assert.deepEqual(await page.locator('.fs-act-label').evaluateAll(xs=>xs.filter(x=>x.getBoundingClientRect().height>60).map(x=>x.textContent)),[]);
  await shot(page,`solo-forge-${size.width}`);await page.locator('.fs-x').click();
 }
 record('responsive-forge-and-spellbar','pass');
 assert.deepEqual(page.errors,[]);record('console','pass');
}catch(e){record('exception','fail',{message:e.stack});await shot(page,'solo-feedback-failure');process.exitCode=1;}
finally{save('solo-feedback');await browser.close();}
