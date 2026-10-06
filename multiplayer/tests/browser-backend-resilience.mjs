// Actual game/rendering acceptance. No VR, pointer capture or private diagnostic writes.
import assert from 'node:assert/strict';
import {launch,BASE,record,save,shot} from './browser-acceptance-lib.mjs';
const a=await launch({touch:true,viewport:{width:960,height:600}}),b=await launch({touch:true,viewport:{width:960,height:600}});
try {
  // Keep QA out of real players' rooms: only discovery is stubbed; creation/join/game traffic are live.
  await a.page.route('**/peer/rooms*',route=>route.fulfill({json:{rooms:[],region:'',nextCursor:null}}));
  await a.page.goto(BASE+'/?acceptanceProbe');await a.page.waitForFunction(()=>window.brannHarness);
  if(await a.page.locator('.pn-close').isVisible())await a.page.locator('.pn-close').click();
  await a.page.fill('#name','Recovery QA Host');await a.page.locator('#create').tap();
  await a.page.waitForFunction(()=>window.brannHarness.state().connected&&window.brannHarness.snapshot(),null,{timeout:30000});
  const room=await a.page.evaluate(()=>window.brannHarness.snapshot().room);
  await b.page.goto(BASE+'/?acceptanceProbe');await b.page.waitForFunction(()=>window.brannHarness);
  if(await b.page.locator('.pn-close').isVisible())await b.page.locator('.pn-close').click();
  await b.page.fill('#name','Recovery QA Guest');
  await b.page.evaluate(r=>{document.getElementById('joinBlock').hidden=false;document.getElementById('room').value=r;},room);
  await b.page.locator('#join').tap();
  await Promise.all([a.page,b.page].map(page=>page.waitForFunction(()=>window.brannHarness.snapshot()?.players.length===2,null,{timeout:30000})));
  // A connected world can precede asynchronous model/shader warm-up. Do not
  // mistake a working HUD over the loading backdrop for rendered-game acceptance.
  await Promise.all([a.page,b.page].map(page=>page.waitForFunction(()=>document.querySelector('#world').brannDiagnostics?.().startup.ready,null,{timeout:120000})));
  await b.page.waitForFunction(()=>window.brannHarness.network()?.transport?.recovery.accepted>=2,null,{timeout:15000});
  for(const page of [a.page,b.page]) {
    const d=await page.evaluate(()=>window.brannHarness.network());
    assert.equal(d.simulation.rejectedCheckpoints,0);assert.equal(d.transport.recovery.rejected,0);
    assert.ok(d.transport.ingress.length>0);assert.ok(d.transport.ingress.every(x=>x.rejected===0));
    record('rendered-game-network-diagnostics','pass',d);
  }
  await shot(b.page,'two-player-recovery');
  await a.browser.close();
  await b.page.waitForFunction(()=>window.brannHarness.state().host&&window.brannHarness.state().connected,null,{timeout:25000});
  const tick=await b.page.evaluate(()=>window.brannHarness.snapshot().tick);
  await b.page.waitForFunction(t=>window.brannHarness.snapshot().tick>t+30,tick);
  assert.equal(await b.page.evaluate(()=>window.brannHarness.network().simulation.rejectedCheckpoints),0);
  assert.deepEqual([...a.page.errors,...b.page.errors],[]);
  record('rendered-game-host-loss-and-continuing-world','pass');
} catch(error) {record('failure','fail',{message:error.message});process.exitCode=1;}
finally {save('backend-resilience');await a.browser.close();await b.browser.close();}
