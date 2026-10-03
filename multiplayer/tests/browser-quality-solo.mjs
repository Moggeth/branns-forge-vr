import assert from 'node:assert/strict';
import {launch,BASE,record,save,shot,sleep} from './browser-acceptance-lib.mjs';
const {browser,page}=await launch({touch:true,viewport:{width:844,height:390}});
let sockets=0;page.on('websocket',ws=>{if(!ws.url().includes('token='))sockets++;});
try{
 await page.goto(BASE+'/?acceptanceProbe');await page.waitForFunction(()=>window.brannHarness?.state().rendererReady);
 await page.fill('#name','Solo quality');await page.locator('#solo').click();
 await page.waitForFunction(()=>window.brannHarness?.state().phase==='game'&&window.brannHarness.state().snapshots>5&&window.brannHarness.state().controlsActive);
 assert.equal(await page.evaluate(()=>window.brannHarness.state().solo),true);
 await page.waitForFunction(()=>document.querySelector('#world').brannDiagnostics().forge.loaded>0);
 record('loaded','info',await page.evaluate(()=>window.brannHarness.state()));
 await sleep(600);await shot(page,'quality-solo-hero');
 const id=await page.evaluate(()=>window.brannHarness.state().playerId),y=await page.evaluate(id=>window.brannHarness.snapshot().players.find(p=>p.id===id).position[1],id);
 await page.locator('[data-touch-action="jump"]').tap();
 await page.waitForFunction(({id,y})=>window.brannHarness.snapshot().players.find(p=>p.id===id).position[1]>y+.15,{id,y});
 const swing=await page.evaluate(()=>window.brannHarness.controls().swingAt);await page.locator('[data-touch-action="strike"]').tap();
 await page.waitForFunction(t=>window.brannHarness.controls().swingAt>t,swing);record('hero-inputs','pass');
 if(await page.locator('.mq-more').isVisible())await page.locator('.mq-more').click();
 await page.locator('#perspectiveButton').click();await page.waitForFunction(()=>window.brannHarness.state().role==='god');
 await sleep(300);await shot(page,'quality-solo-god');
 await page.setViewportSize({width:844,height:600});await sleep(200);await page.locator('#quickCast').check();
 const enemies=await page.evaluate(()=>window.brannHarness.snapshot().enemies.length);
 // The forge apron is deliberately protected; cast in the meadow, not the centre of the view.
 await page.touchscreen.tap(320,340);await page.waitForFunction(n=>window.brannHarness.snapshot().enemies.length===n+1,enemies);record('god-quick-cast','pass');
 const snapshot=await page.evaluate(()=>window.brannHarness.snapshot()),stats=await page.evaluate(()=>document.querySelector('#world').brannDiagnostics());
 assert.ok(snapshot.tick>60);assert.ok(stats.terrainSampler.hits>stats.terrainSampler.samples);assert.ok(stats.cpuTimings.frameCpu.total>0);assert.ok(stats.cpuTimings.snapshotCpu.total>0);
 assert.equal(await page.locator('#copyInvite').isDisabled(),true);assert.equal(sockets,0);assert.deepEqual(page.errors,[]);
 record('solo-real-renderer','pass',{sockets,tick:snapshot.tick,stats});
 // Fresh portrait lobby must retain reachable solo/create/join controls.
 await page.goto(BASE+'/?acceptanceProbe');await page.setViewportSize({width:390,height:650});await page.waitForFunction(()=>window.brannHarness?.state().rendererReady);
 const bounds=await page.locator('#solo').boundingBox();assert.ok(bounds.y+bounds.height<=650);await shot(page,'quality-solo-lobby-phone');
 record('phone-lobby','pass',{bounds});
}catch(e){record('exception','fail',{message:e.message,errors:page.errors,state:await page.evaluate(()=>({controls:window.brannHarness?.controls(),state:window.brannHarness?.state(),text:document.body.innerText.slice(-1200)}))});await shot(page,'quality-solo-failure');process.exitCode=1;}finally{save('quality-solo');await browser.close();}
