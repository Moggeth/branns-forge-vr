// Manual real-network check: three browsers share a world through the real room Worker and WebRTC,
// then the host leaves three ways. The world must carry on with the next player hosting, with no
// button pressed, no world rewind and the God's terrain edit intact. Uses the no-render transport
// fixture so software-rendered CI browsers keep a real 60 Hz simulation; the page hooks it drives
// (hide -> handOver, pagehide -> dispose) are the ones lobby.js wires.
// Needs local Vite + Wrangler dev (cloud/README.md); ACCEPT_BASE is Vite, CLOUD_WS_URL the Worker.
import assert from 'node:assert/strict';
import {launch,BASE,record,save,sleep} from './browser-acceptance-lib.mjs';

const endpoint=process.env.CLOUD_WS_URL||'ws://127.0.0.1:8791/peer/cloud';
const players=[];
const live=()=>players.filter(p=>!p.gone);
async function join(name,{role='hero',room=''}={}){
  const b=await launch({viewport:{width:320,height:200}});b.name=name;
  await b.page.goto(BASE+'/tests/transport-harness.html');await b.page.waitForFunction(()=>window.makeSession);
  await b.page.evaluate(({endpoint,name,role,room})=>{
    window.makeSession(endpoint,{name,role,room,desktop:true});
    // Note every gap between snapshots and every backwards step of the world clock.
    const w=window.watch={last:0,gap:0,rewind:0,lastTick:0,buttons:0};
    window.s.addEventListener('snapshot',e=>{const now=performance.now(),t=e.detail.tick;if(w.last)w.gap=Math.max(w.gap,now-w.last);w.last=now;if(w.lastTick&&t<w.lastTick)w.rewind=Math.max(w.rewind,w.lastTick-t);w.lastTick=t;});
  },{endpoint,name,role,room});
  await b.page.waitForFunction(()=>window.watch.last>0,null,{timeout:30000});players.push(b);return b;
}
const hostOf=async()=>{for(const p of live())if(await p.page.evaluate(()=>!!window.s.simulation))return p;return null;};
const reset=()=>Promise.all(live().map(p=>p.page.evaluate(()=>{const w=window.watch;w.gap=0;w.rewind=0;w.last=performance.now();})));
async function carriesOn(old,label){
  const t0=Date.now();let next=null;
  while(Date.now()-t0<30000){next=await hostOf();if(next&&next!==old)break;await sleep(50);}
  assert.ok(next&&next!==old,`${label}: nobody took the world over`);
  const tookMs=Date.now()-t0;
  await sleep(2500);
  const observers=await Promise.all(live().map(async p=>({name:p.name,...await p.page.evaluate(()=>({
    gapMs:Math.round(Math.max(window.watch.gap,performance.now()-window.watch.last)),rewindTicks:window.watch.rewind,
    players:window.s.connection.roster.size,edit:!!window.s.connection.checkpoint?.edits?.some(e=>e.kind==='raise')||!!window.s.simulation?.snapshot().edits.some(e=>e.kind==='raise'),
    offers:window.events.filter(e=>e.name==='continue_world_offer').length,errors:window.events.filter(e=>e.name==='error').map(e=>e.detail.code)}))})));
  for(const o of observers){
    assert.ok(o.edit,`${label}: ${o.name} lost the terrain edit`);
    // A crash still needs four seconds of missing traffic to avoid false migration.
    // Graceful handoffs should resume within two seconds, including relay fallback.
    assert.ok(o.gapMs<(label==='host-crashes'?6000:2000),`${label}: ${o.name} waited ${o.gapMs} ms`);
    assert.ok(o.rewindTicks<=60,`${label}: ${o.name} saw the world rewind ${o.rewindTicks} ticks`);
  }
  record(label,'pass',{newHost:next.name,tookMs,observers});
  return next;
}
try{
  const a=await join('Host');const room=await a.page.evaluate(()=>window.s.identity.room);
  const god=await join('God',{role:'god',room}),c=await join('Friend',{room});
  await Promise.all(players.map(p=>p.page.waitForFunction(()=>window.s.connection.roster.size===3&&window.lastTick!==0)));
  await god.page.evaluate(()=>window.s.command('cast',{spell:'raise',point:[6,0,6]}));
  await a.page.waitForFunction(()=>window.s.simulation.snapshot().edits.some(e=>e.kind==='raise'),null,{timeout:10000});
  await sleep(1500);record('three-players-and-a-god-edit','pass',{room});

  // 1. The host's page goes to the background: lobby.js calls handOver() on visibilitychange.
  await reset();
  await a.page.evaluate(()=>window.s.handOver());
  let host=await carriesOn(a,'host-backgrounded-hands-over');

  // 2. The host closes the tab: pagehide/beforeunload dispose the session, which says goodbye.
  await reset();
  host.gone=true;await host.page.evaluate(()=>window.s.dispose());await host.browser.close();
  host=await carriesOn(host,'host-closes-tab');

  // 3. The host's browser dies without a goodbye (crash, battery, lost signal).
  await reset();
  host.gone=true;await host.browser.close();
  host=await carriesOn(host,'host-crashes');
}catch(error){
  const states=await Promise.all(live().map(p=>p.page.evaluate(()=>({host:!!window.s.simulation,hostId:window.s.connection.hostId,epoch:window.s.connection.epoch,events:window.events.slice(-6).map(e=>e.name+':'+(e.detail?.state||e.detail?.code||''))})).catch(e=>e.message)));
  record('failure','fail',{message:error.message.split('\n')[0],states});process.exitCode=1;
}finally{save('host-handover');for(const p of players)await p.browser.close().catch(()=>{});}
