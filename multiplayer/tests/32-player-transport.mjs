// Real Chromium WorldSessions, no renderer: isolates transport/simulation from GPU work.
// Requires local Vite (ACCEPT_BASE) and cloud emulator (CLOUD_WS_URL).
import assert from 'node:assert/strict';
import {launch,BASE,record,save,sleep} from './browser-acceptance-lib.mjs';
import {MAX_PLAYERS} from '../shared/multiplayer-limits.js';
import {disableIce} from './no-ice-fixture.mjs';
const endpoint=process.env.CLOUD_WS_URL || 'ws://127.0.0.1:8796/peer/cloud';
const forcedRelay=process.env.FORCE_RELAY==='1';
const {browser,context,page:host}=await launch(),pages=[host];
async function prepare(page){await page.goto(BASE+'/tests/transport-harness.html');await page.waitForFunction(()=>window.makeSession);await page.evaluate(()=>{window.samples={count:0,last:0,gaps:[]};window.bytesOut=0;for(const proto of [window.RTCDataChannel?.prototype,WebSocket.prototype]){if(!proto?.send)continue;const send=proto.send;proto.send=function(data){window.bytesOut+=typeof data==='string'?data.length:(data.byteLength||0);return send.call(this,data);};}const make=window.makeSession;window.makeSession=(...args)=>{make(...args);window.s.addEventListener('snapshot',e=>{const now=performance.now();if(window.samples.last)window.samples.gaps.push(now-window.samples.last);window.samples.last=now;window.samples.count++;window.lastSnapshot=e.detail;});};});}
try{
  if(forcedRelay)await disableIce(context);
  await prepare(host);await host.evaluate(url=>window.makeSession(url,{name:'Host32',role:'hero',desktop:true}),endpoint);
  await host.waitForFunction(()=>window.s?.identity?.room);const room=await host.evaluate(()=>window.s.identity.room);
  for(let start=1;start<MAX_PLAYERS;start+=5){
    await Promise.all(Array.from({length:Math.min(5,MAX_PLAYERS-start)},async(_,offset)=>{
      const page=await context.newPage();pages.push(page);await prepare(page);
      await page.evaluate(({url,room,name})=>window.makeSession(url,{room,name,role:'hero',desktop:true}),{url:endpoint,room,name:`P${start+offset}`});
      await page.waitForFunction(()=>window.s?.identity?.peerId,null,{timeout:20000});
    }));
  }
  await Promise.all(pages.map(p=>p.waitForFunction(n=>window.lastSnapshot?.players.length===n,MAX_PLAYERS,{timeout:60000})));
  record('32-browser-sessions-replicate','pass',{players:MAX_PLAYERS,room,forcedRelay});
  await pages[1].evaluate(()=>window.s.command('battle',{action:'start'}));
  await pages[1].waitForFunction(()=>window.events.some(e=>e.name==='error'&&e.detail.code==='host_required'));
  assert.equal(await host.evaluate(()=>window.s.simulation.snapshot().battle.status),'off');
  await pages[1].evaluate(()=>{window.events=window.events.filter(e=>!(e.name==='error'&&e.detail.code==='host_required'));});
  await host.evaluate(()=>window.s.command('battle',{action:'start'}));
  await Promise.all(pages.map(p=>p.waitForFunction(()=>window.lastSnapshot?.battle?.status==='running'&&window.lastSnapshot.enemies.some(e=>e.battleRun!==undefined),null,{timeout:20000})));
  record('32-player-battle-bots-and-host-permission','pass',{bots:await host.evaluate(()=>window.s.simulation.snapshot().enemies.filter(e=>e.battleRun!==undefined).length)});
  const inputStart=performance.now();
  const commands=await Promise.all(pages.map((p,i)=>p.evaluate(yaw=>{window.s.command('input',{move:{x:0,z:0},yaw});return{id:window.s.identity.peerId,seq:window.s.sequence};},i*.025)));
  await host.waitForFunction(commands=>commands.every(c=>window.s.acceptedSequence(c.id)>=c.seq),commands);
  record('32-independent-inputs-accepted','pass',{milliseconds:performance.now()-inputStart});
  await Promise.all(pages.map(p=>p.evaluate(()=>{window.samples={count:0,last:0,gaps:[]};window.bytesOut=0;window.loadInput=setInterval(()=>window.s.command('input',{move:{x:0,z:0},yaw:Math.sin(performance.now()/1000)*.3}),50);})));
  await sleep(6000);
  const results=await Promise.all(pages.map(p=>p.evaluate(()=>{clearInterval(window.loadInput);const gaps=window.samples.gaps.sort((a,b)=>a-b);return{count:window.samples.count,bytesOut:window.bytesOut,checkpoint:window.s.connection.checkpointDecoder.stats,p95Gap:gaps[Math.floor(gaps.length*.95)],maxGap:gaps.at(-1),relay:[...window.s.connection.peers.values()].filter(p=>p.relay).length,decoder:window.s.decoder.stats,errors:window.events.filter(e=>e.name==='error').map(e=>e.detail.code),stepMax:window.s.metrics.maxStepMs};})));
  assert.ok(results.every(r=>r.count>=50),'every client must receive at least50 snapshots during6s load');assert.ok(results.every(r=>!r.errors.length),JSON.stringify(results.map(r=>r.errors)));
  assert.ok(results.slice(1).every(r=>r.checkpoint.applied>0),'every guest must use exact checkpoint deltas');record('32-clients-20hz-input-load','pass',{seconds:6,results});
  const successor=pages[1],successorId=await successor.evaluate(()=>window.s.identity.peerId);
  await successor.waitForFunction(()=>window.s.connection.checkpoint?.players.length===32);
  const expected=await successor.evaluate(()=>window.s.connection.checkpoint.players.map(p=>p.id).sort());
  await host.evaluate(id=>window.s.connection.transferHost(id),successorId);await successor.waitForFunction(()=>window.events.some(e=>e.name==='continue_world_offer'));
  await successor.evaluate(()=>window.s.connection.continueWorld());
  await successor.waitForFunction(()=>!!window.s.simulation&&window.s.connection.epoch===2,null,{timeout:30000});
  assert.deepEqual(await successor.evaluate(()=>window.s.simulation.snapshot().players.map(p=>p.id).sort()),expected);
  await Promise.all(pages.map(p=>p.waitForFunction(()=>window.s.connection.epoch===2&&window.lastSnapshot?.players.length===32,null,{timeout:60000})));
  assert.equal(await successor.evaluate(()=>window.s.simulation.snapshot().battle.status),'running');record('32-player-checkpoint-host-transfer','pass',{players:expected.length,battle:'running'});
}catch(error){record('32-player-exception','fail',{message:error.message});for(let i=0;i<pages.length;i++){const state=await pages[i].evaluate(()=>({players:window.lastSnapshot?.players.length,events:window.events?.slice(-4).map(e=>({name:e.name,code:e.detail?.code,state:e.detail?.state})),peers:window.s?.connection.peers.size})).catch(()=>null);console.log(i,state);}process.exitCode=1;}
finally{save(forcedRelay?'32-player-relay':'32-player-direct');await Promise.all(pages.map(p=>p.evaluate(()=>window.s?.dispose()).catch(()=>{})));await browser.close();}
