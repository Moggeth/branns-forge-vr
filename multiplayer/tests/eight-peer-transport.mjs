// Browser integration; use an owned local cloud coordinator, never fill a public player's room.
import assert from 'node:assert/strict';
import {launch,BASE,record,save} from './browser-acceptance-lib.mjs';
const endpoint=process.env.CLOUD_WS_URL || 'ws://127.0.0.1:8792/peer/cloud';
const {browser,context,page:host}=await launch();const pages=[host];
try {
  await host.goto(BASE+'/tests/transport-harness.html');await host.waitForFunction(()=>window.makeSession);
  await host.evaluate(url=>window.makeSession(url,{name:'Host',role:'hero',desktop:true}),endpoint);
  await host.waitForFunction(()=>window.s?.identity?.room);const room=await host.evaluate(()=>window.s.identity.room);
  for(let i=1;i<8;i++){
    const page=await context.newPage();pages.push(page);await page.goto(BASE+'/tests/transport-harness.html');await page.waitForFunction(()=>window.makeSession);
    await page.evaluate(({url,room,i})=>window.makeSession(url,{room,name:'Guest '+i,role:i===1?'god':'hero',desktop:true}),{url:endpoint,room,i});
    await page.waitForFunction(()=>window.s.latest?.players.length>=2,null,{timeout:25000});
  }
  await Promise.all(pages.map(page=>page.waitForFunction(()=>window.s.latest?.players.length===8,null,{timeout:25000})));
  await pages[1].evaluate(()=>window.s.command('cast',{spell:'raise',point:[10,0,10]}));
  await Promise.all(pages.map(page=>page.waitForFunction(()=>window.s.latest?.edits.length>0,null,{timeout:25000})));
  const first=await host.evaluate(()=>window.s.latest.tick);
  await host.waitForFunction(t=>window.s.latest.tick>t+90,first);
  const states=await Promise.all(pages.map(page=>page.evaluate(()=>({players:window.s.latest.players.length,tick:window.s.latest.tick,edits:window.s.latest.edits.length,
    transports:[...window.s.connection.peers.values()].map(p=>p.relay?'relay':p.channel?.readyState),metrics:window.s.metrics}))));
  for(const s of states){assert.equal(s.players,8);assert.ok(s.tick>first);assert.ok(s.edits>0);assert.ok(s.transports.every(t=>t==='open'||t==='relay'));}
  assert.equal(states[0].transports.length,7);
  record('eight-real-browser-sessions-replicate','pass',{states});
}finally{for(const page of pages)await page.evaluate(()=>window.s?.dispose()).catch(()=>{});save('eight-peer-transport');await browser.close();}
