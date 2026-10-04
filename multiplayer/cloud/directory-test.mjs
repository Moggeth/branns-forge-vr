import assert from 'node:assert/strict';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {MAX_PLAYERS} from '../shared/multiplayer-limits.js';
const base=process.env.CLOUD_TEST_URL || 'http://127.0.0.1:8792', origin='http://127.0.0.1:5178', sockets=[];
const started=performance.now();
async function list(){const r=await fetch(base+'/peer/rooms',{headers:{Origin:origin}});assert.equal(r.status,200);assert.equal(r.headers.get('access-control-allow-origin'),origin);return(await r.json()).rooms;}
async function connect(room){const url=new URL('/peer/cloud',base);url.protocol=url.protocol==='https:'?'wss:':'ws:';if(room)url.searchParams.set('room',room);
 const ws=new WebSocket(url,{origin});sockets.push(ws);const messages=[];ws.on('message',raw=>{if(raw.toString()!=='pong')messages.push(JSON.parse(raw));});await once(ws,'open');
 const send=m=>ws.send(JSON.stringify(m));const wait=async predicate=>{for(let i=0;i<100;i++){const m=messages.find(predicate);if(m)return m;await new Promise(r=>setTimeout(r,30));}throw Error('Timed out waiting for room state');};
 send({type:room?'join':'create',room,name:room?'Guest':'Directory host',role:'hero',desktop:true});return{ws,send,wait,welcome:await wait(m=>m.type==='welcome')};}
try{
 assert.equal((await fetch(base+'/peer/rooms',{headers:{Origin:'https://evil.example'}})).status,403);
 assert.equal((await fetch(base+'/peer/rooms',{method:'POST',headers:{Origin:origin}})).status,405);
 const host=await connect(),code=host.welcome.room;
 let row=(await list()).find(r=>r.code===code);assert.equal(row.count,1);assert.equal(row.joinable,true);assert.equal(row.hostName,'Directory host');
 assert.ok(!JSON.stringify(row).includes(host.welcome.secret));assert.ok(!JSON.stringify(row).includes(host.welcome.peerId));
 const guests=[];for(let i=0;i<MAX_PLAYERS-1;i++)guests.push(await connect(code));
 row=(await list()).find(r=>r.code===code);assert.equal(row.count,MAX_PLAYERS);assert.equal(row.maxPlayers,MAX_PLAYERS);assert.equal(row.status,'full');assert.equal(row.joinable,false);
 guests[0].send({type:'checkpoint_ready',revision:10});guests[0].send({type:'ping',at:77});await guests[0].wait(m=>m.type==='pong'&&m.at===77);
 host.send({type:'transfer_host',to:guests[0].welcome.peerId});await guests[0].wait(m=>m.type==='continue_world_offer');guests[0].send({type:'continue_world',epoch:1});await host.wait(m=>m.type==='host_changed');
 row=(await list()).find(r=>r.code===code);assert.equal(row.hostName,'Guest');
 guests[0].send({type:'leave'});await once(guests[0].ws,'close');
 row=(await list()).find(r=>r.code===code);assert.equal(row.status,'waiting');assert.equal(row.joinable,false);
 for(const c of [host,...guests.slice(1)]){c.send({type:'leave'});await once(c.ws,'close');}
 assert.ok(!(await list()).some(r=>r.code===code));
 console.log(JSON.stringify({ok:true,checks:['cors','read-only','create-list','names-no-secrets','full','host-transfer','waiting','empty-removal'],seconds:(performance.now()-started)/1000}));
}finally{for(const ws of sockets){if(ws.readyState===1)ws.send(JSON.stringify({type:'leave'}));ws.close();}}
