import assert from 'node:assert/strict';
import {launch, BASE, record, save} from './browser-acceptance-lib.mjs';
import {disableIce} from './no-ice-fixture.mjs';
const endpoint = process.env.CLOUD_WS_URL || 'ws://127.0.0.1:8791/peer/cloud';
const forcedRelay = process.env.FORCE_RELAY === '1';
const {browser,context,page:host} = await launch();
const guest = await context.newPage();
const routes = []; let blocked = false;
await host.routeWebSocket('**/peer/cloud*', route => { if (blocked) route.close(); else { route.connectToServer(); routes.push(route); } });
try {
  if (forcedRelay) await disableIce(context);
  for (const page of [host,guest]) { await page.goto(BASE+'/tests/transport-harness.html'); await page.waitForFunction(()=>window.makeSession); }
  await host.evaluate(url=>window.makeSession(url,{name:'Host',role:'hero',desktop:true}),endpoint);
  await host.waitForFunction(()=>window.s?.identity?.room);
  const room = await host.evaluate(()=>window.s.identity.room);
  const joinStarted = performance.now();
  await guest.evaluate(({url,room})=>window.makeSession(url,{room,name:'God',role:'god',desktop:true}),{url:endpoint,room});
  await guest.waitForFunction(()=>window.s.latest?.players.length===2,null,{timeout:25000});
  const relay = await guest.evaluate(()=>[...window.s.connection.peers.values()].some(p=>p.relay)); assert.equal(relay,forcedRelay);
  await guest.evaluate(()=>window.s.command('cast',{spell:'raise',point:[10,0,10]}));
  await host.waitForFunction(()=>window.s.simulation.snapshot().edits.length>0);
  const joinMs = Math.round(performance.now()-joinStarted);
  if (forcedRelay) assert.ok(joinMs < 2000, `stalled direct connection took ${joinMs}ms to deliver recovery state`);
  record('two-real-sessions-and-replication','pass',{room,transport:relay?'cloud-relay':'direct-rtc',joinMs});
  for(const page of [host,guest]) {
    const d=await page.evaluate(()=>window.s.connection.diagnostics());
    assert.ok(d.edges>0 && d.ingress.length>0);assert.ok(d.ingress.every(edge=>edge.rejected===0));assert.equal(d.recovery.rejected,0);
  }
  if (process.env.HOST_CRASH === '1') {
    await guest.waitForFunction(()=>window.s.connection.checkpoint?.edits.length===1);
    await host.close();
    await guest.waitForFunction(()=>window.events.some(e=>e.name==='continue_world_offer'),null,{timeout:25000});
    // WorldSession now accepts continuation automatically; a second request is an error.
    await guest.waitForFunction(()=>window.s.simulation && window.s.connection.epoch===2);
    assert.equal(await guest.evaluate(()=>window.s.simulation.snapshot().edits.length),1);
    record('unexpected-host-tab-loss-recovers-checkpoint','pass');
  } else {
  if (!forcedRelay) {
    await host.evaluate(()=>{window.oldSim=window.s.simulation;window.beforeTick=window.s.simulation.snapshot().tick;});
    blocked=true; for(const route of routes)route.close();
    await guest.waitForFunction(()=>window.s.latest.tick>100);
    await new Promise(resolve=>setTimeout(resolve,1500));
    assert.equal(await host.evaluate(()=>window.s.simulation===window.oldSim && window.s.simulation.snapshot().tick>window.beforeTick+30),true);
    assert.equal(await guest.evaluate(()=>window.s.connection.peers.get(window.s.connection.hostId)?.channel.readyState),'open');
    blocked=false;
    await host.waitForFunction(()=>window.s.connection.joined && window.s.connection.socket.readyState===1,null,{timeout:20000});
    assert.equal(await host.evaluate(()=>window.s.simulation===window.oldSim),true);
    record('signaling-outage-preserves-rtc-and-live-simulation','pass');
  }
  // Current host explicitly hands off its browser-hosted world, then leaves.
  await guest.waitForFunction(()=>window.s.connection.checkpointRevision>=0);
  const guestId=await guest.evaluate(()=>window.s.identity.peerId);
  await host.evaluate(id=>window.s.connection.transferHost(id),guestId);
  await guest.waitForFunction(()=>window.events.some(e=>e.name==='continue_world_offer'));
  // WorldSession accepts continuation automatically.
  await guest.waitForFunction(()=>window.s.simulation && window.s.connection.epoch===2);
  await host.waitForFunction(()=>window.s.latest?.players.length===2 && !window.s.simulation,null,{timeout:20000});
  await host.waitForFunction(()=>window.events.some(e=>e.name==='status' && e.detail.state==='connected'),null,{timeout:20000});
  const oldHostId = await host.evaluate(()=>window.s.identity.peerId);
  const seq = await host.evaluate(()=>{window.s.command('input',{move:{x:1,z:0},yaw:0});return window.s.sequence;});
  await guest.waitForFunction(({id,seq})=>window.s.simulation.checkpoint().players.find(p=>p.id===id)?.seq===seq,{id:oldHostId,seq});
  record('old-host-commands-reach-new-host','pass');
  await host.evaluate(()=>window.s.dispose());
  const tick=await guest.evaluate(()=>window.s.simulation.snapshot().tick);
  await guest.waitForFunction(t=>window.s.simulation.snapshot().tick>t+15,tick);
  record('host-transfer-and-original-host-offline','pass');
  }
  const diagnostics=await guest.evaluate(()=>({transport:window.s.connection.diagnostics(),simulation:window.s.metrics}));
  assert.equal(diagnostics.transport.recovery.rejected,0);assert.equal(diagnostics.simulation.rejectedCheckpoints,0);
  assert.ok(diagnostics.transport.ingress.every(edge=>edge.rejected===0));
  record('bounded-ingress-and-loadable-recovery','pass',diagnostics);
  const errors=await guest.evaluate(()=>window.events.filter(e=>e.name==='error').map(e=>e.detail)); assert.deepEqual(errors,[]);
} catch(e) {
  record('exception','fail',{message:e.message});
  for(const [name,page] of [['host',host],['guest',guest]]) {
    const state = await page.evaluate(()=>({events:window.events?.map(e=>({name:e.name,state:e.detail?.state,code:e.detail?.code})),identity:window.s?.identity?.peerId,epoch:window.s?.connection?.epoch,tick:window.s?.latest?.tick})).catch(()=>null);
    console.log(name,state);
  }
  process.exitCode=1;
}
finally { save(forcedRelay?'cloud-relay':'cloud-direct'); await browser.close(); }
