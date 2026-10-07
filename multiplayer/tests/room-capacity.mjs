import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {clientCapacity,roomCapacity} from '../peer/room-capacity.js';
import {roomListing} from '../cloud/room-directory.js';
import {MAX_PLAYERS,OFFLINE_SEAT_GRACE_MS} from '../shared/multiplayer-limits.js';

let source=await readFile(new URL('../cloud/worker.js',import.meta.url),'utf8');
source=source.replace("import { DurableObject } from 'cloudflare:workers';",'class DurableObject {}').replace("export {ForgeDirectory} from './directory.js';",'');
for(const path of ['./room-directory.js','./ice-servers.js','../shared/multiplayer-limits.js','../peer/room-capacity.js'])source=source.replace(JSON.stringify(path).replaceAll('"',"'"),JSON.stringify(new URL(path,new URL('../cloud/worker.js',import.meta.url)).href));
const {ForgeRoom}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
function fixture(){
  const service=Object.create(ForgeRoom.prototype);service.room=null;service.sockets=new Map();service.env={};
  service.ctx={storage:{async put(){},async setAlarm(){},async deleteAlarm(){}},getWebSockets:()=>[...service.sockets.values()]};return service;
}
function socket(mode='join'){
  let attachment={at:Date.now(),opened:Date.now(),messages:0,mode,code:'12345678'};
  return{readyState:1,sent:[],deserializeAttachment:()=>attachment,serializeAttachment:v=>{attachment=v;},send(raw){this.sent.push(JSON.parse(raw));},close(){this.readyState=3;}};
}
async function join(service,{mode='join',simCapacity,secret}={}){
  const ws=socket(mode);await message(service,ws,{type:mode,room:'12345678',name:'Test',role:'hero',desktop:true,...(simCapacity===undefined?{}:{simCapacity}),...(secret?{secret}:{})});return ws;
}
const message=(service,ws,value)=>service.webSocketMessage(ws,JSON.stringify(value));
const last=ws=>ws.sent.at(-1);
const welcome=ws=>ws.sent.find(m=>m.type==='welcome');

test('absent or invalid capability remains legacy eight; all retained members constrain capacity',()=>{
  for(const value of [undefined,null,0,-1,33,'32',NaN])assert.equal(clientCapacity(value),8);
  const room={peers:[{simCapacity:32},{simCapacity:32}]};assert.equal(roomCapacity(room),32);assert.equal(roomCapacity(room,8),8);
  room.peers.push({});assert.equal(roomCapacity(room),8);assert.equal(roomCapacity({peers:new Map(room.peers.map((p,i)=>[i,p]))}),8);
});
test('old host plus new guests stays at eight and rejects ninth without evicting anyone',async()=>{
  const s=fixture(),host=await join(s,{mode:'create'});assert.equal(welcome(host).maxPeers,8);
  for(let i=1;i<8;i++)assert.equal(welcome(await join(s,{simCapacity:32})).maxPeers,8);
  const denied=await join(s,{simCapacity:32});assert.equal(last(denied).code,'room_full');assert.equal(s.peers().length,8);
  const row=roomListing(s.room,id=>s.online(id));assert.equal(row.maxPlayers,8);assert.equal(row.joinable,false);
  const upgraded=await join(s,{simCapacity:32,secret:welcome(host).secret});assert.equal(welcome(upgraded).maxPeers,32);
  assert.equal(welcome(await join(s,{simCapacity:32})).maxPeers,32);assert.equal(s.peers().length,9);
});
test('new world rejects old join, but both new clients are listed with32 seats',async()=>{
  const s=fixture();await join(s,{mode:'create',simCapacity:32});
  const old=await join(s);assert.equal(last(old).code,'client_update_required');assert.match(last(old).message,/Refresh/);assert.equal(s.peers().length,1);
  await join(s,{simCapacity:32});const row=roomListing(s.room,id=>s.online(id));assert.equal(row.count,2);assert.equal(row.maxPlayers,32);
});
test('all old members must refresh; reconnect upgrades preserve identity and recovery revision',async()=>{
  const s=fixture(),host=await join(s,{mode:'create'}),guest=await join(s);
  await message(s,guest,{type:'checkpoint_ready',revision:91});
  const h=await join(s,{simCapacity:32,secret:welcome(host).secret});assert.equal(welcome(h).maxPeers,8);
  const g=await join(s,{simCapacity:32,secret:welcome(guest).secret});assert.equal(welcome(g).maxPeers,32);assert.equal(welcome(g).peerId,welcome(guest).peerId);assert.equal(s.peers()[1].revision,91);
});
test('legacy full-room release alarm and directory permit replacing an expired guest seat',async()=>{
  const s=fixture();await join(s,{mode:'create'});let guest;
  for(let i=1;i<8;i++)guest=await join(s,{simCapacity:32});
  const p=s.peers().at(-1);s.sockets.delete(p.id);p.offlineAt=Date.now()-OFFLINE_SEAT_GRACE_MS-1;
  assert.equal(s.seatReleaseDeadlines().length,1);assert.equal(roomListing(s.room,id=>s.online(id)).joinable,true);
  assert.ok(welcome(await join(s,{simCapacity:32})));assert.equal(s.peers().length,8);assert.ok(!s.peers().includes(p));
});
test('old reconnect cannot downgrade a nine-person room and incapable candidates cannot take ownership',async()=>{
  const s=fixture(),host=await join(s,{mode:'create',simCapacity:32});let guest;
  for(let i=1;i<9;i++)guest=await join(s,{simCapacity:32});
  const denied=await join(s,{secret:welcome(guest).secret});assert.equal(last(denied).code,'client_update_required');assert.equal(s.peers().at(-1).simCapacity,32);
  const p=s.peers().at(-1);p.simCapacity=8;p.revision=100; // persisted mixed-version state must not lose existing members
  await message(s,host,{type:'transfer_host',to:p.id});assert.equal(last(host).code,'client_update_required');
  await s.nextOffer();assert.equal(s.room.offer,null,'no compatible backup exists');assert.equal(s.peers().length,9);
  s.room.offer={peerId:p.id};await message(s,guest,{type:'continue_world',epoch:1});assert.equal(last(guest).code,'client_update_required');assert.equal(s.room.hostId,welcome(host).peerId);
  const row=roomListing(s.room,id=>s.online(id));assert.equal(row.count,9);assert.equal(row.maxPlayers,9);assert.equal(row.joinable,false);
});
test('new32room still admits all32 and compatible exact-revision transfer works',async()=>{
  const s=fixture(),host=await join(s,{mode:'create',simCapacity:MAX_PLAYERS});let guest;
  for(let i=1;i<MAX_PLAYERS;i++)guest=await join(s,{simCapacity:MAX_PLAYERS});assert.equal(s.peers().length,MAX_PLAYERS);
  assert.equal(last(await join(s,{simCapacity:MAX_PLAYERS})).code,'room_full');
  await message(s,guest,{type:'checkpoint_ready',revision:231});await message(s,host,{type:'transfer_host',to:welcome(guest).peerId});
  assert.equal(last(guest).revision,231);await message(s,guest,{type:'continue_world',epoch:1});assert.equal(s.room.epoch,2);assert.equal(s.room.hostId,welcome(guest).peerId);
});

// Test the browser's actual signaling event path, not a duplicate capacity model.
import {PeerRoomConnection} from '../peer/browser.js';
import {WorldSession} from '../client/session.js';
test('browser retains negotiated capacity across welcome, current membership and ownership events',()=>{
  class Socket extends EventTarget {
    static OPEN=1;
    constructor(){super();this.readyState=1;this.sent=[];}
    send(raw){this.sent.push(JSON.parse(raw));}
    close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
    message(value){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(value)}));}
  }
  const old=globalThis.WebSocket;globalThis.WebSocket=Socket;
  const c=new PeerRoomConnection({url:'ws://localhost/peer/cloud'}),events=[];c.addEventListener('roster',e=>events.push(e.detail.maxPeers));
  try{
    c.connect({room:'12345678'});c.socket.dispatchEvent(new Event('open'));assert.equal(c.socket.sent[0].simCapacity,32);
    c.socket.message({type:'welcome',room:'12345678',peerId:'guest',hostId:'host',secret:'test',epoch:1,peers:[]});assert.equal(c.maxPeers,8,'old coordinator defaults to eight');
    c.socket.message({type:'peer_joined',epoch:1,maxPeers:32,peer:{id:'host',online:false}});assert.equal(c.maxPeers,32);assert.equal(events.at(-1),32);
    c.socket.message({type:'peer_joined',epoch:0,maxPeers:8,peer:{id:'stale'}});assert.equal(c.maxPeers,32,'old epoch cannot change capacity');
    c.socket.message({type:'peer_left',epoch:1,maxPeers:8,peerId:'host',removed:true});assert.equal(c.maxPeers,8);assert.equal(events.at(-1),8);
    c.socket.message({type:'host_changed',epoch:2,maxPeers:32,hostId:'replacement'});assert.equal(c.maxPeers,32);
    c.socket.message({type:'host_changed',epoch:4,maxPeers:8,hostId:'stale'});assert.equal(c.maxPeers,32);
    c.connect({room:'87654321'});assert.equal(c.maxPeers,8,'new connection clears previous capability');
  }finally{c.close();globalThis.WebSocket=old;}
});
test('mixed-version host cannot start/reset battle, all-updated and solo hosts can; stop remains available',()=>{
  class Connection extends EventTarget{constructor(){super();this.hostId='host';this.epoch=1;this.maxPeers=8;}send(){}}
  const connection=new Connection(),session=new WorldSession({connection,storage:{getItem(){},setItem(){}}}),commands=[],errors=[];
  session.identity={peerId:'host'};session.simulation={command(id,message){commands.push(message);return{ok:true};}};session.addEventListener('error',e=>errors.push(e.detail));
  for(const action of ['start','reset'])session.applyCommand('host',{type:'battle',action});
  assert.equal(session.battleCompatible,false);assert.equal(commands.length,0);assert.equal(errors.length,2);assert.ok(errors.every(e=>e.code==='client_update_required'&&/refresh/.test(e.message)));
  session.applyCommand('host',{type:'battle',action:'stop'});assert.equal(commands.length,1);
  connection.maxPeers=32;assert.equal(session.battleCompatible,true);session.applyCommand('host',{type:'battle',action:'start'});assert.equal(commands.length,2);
  connection.maxPeers=undefined;session.applyCommand('host',{type:'battle',action:'reset'});assert.equal(commands.length,2);
  connection.local=true;assert.equal(session.battleCompatible,true);session.applyCommand('host',{type:'battle',action:'reset'});assert.equal(commands.length,3);
});
test('legacy refresh and departure broadcast new capacity before host enables battle',async()=>{
  const s=fixture(),oldHost=await join(s,{mode:'create'}),oldGuest=await join(s);
  const host=await join(s,{simCapacity:32,secret:welcome(oldHost).secret});assert.equal(welcome(host).maxPeers,8);
  const guest=await join(s,{simCapacity:32,secret:welcome(oldGuest).secret});assert.equal(last(host).type,'peer_joined');assert.equal(last(host).maxPeers,32);
  await message(s,guest,{type:'checkpoint_ready',revision:10});await message(s,host,{type:'transfer_host',to:welcome(guest).peerId});await message(s,guest,{type:'continue_world',epoch:1});assert.equal(last(host).maxPeers,32);assert.equal(last(host).type,'host_changed');
  const s2=fixture(),h=await join(s2,{mode:'create'}),g=await join(s2);const refreshed=await join(s2,{simCapacity:32,secret:welcome(h).secret});
  await message(s2,g,{type:'leave'});assert.equal(last(refreshed).type,'peer_left');assert.equal(last(refreshed).maxPeers,32);
});

test('credential reconnect cannot downgrade even a two-person new-format room',async()=>{
  const s=fixture(),host=await join(s,{mode:'create',simCapacity:32}),guest=await join(s,{simCapacity:32});
  const originalPeer=s.peers()[1];originalPeer.revision=77;
  const rejected=await join(s,{secret:welcome(guest).secret});
  assert.equal(last(rejected).code,'client_update_required');assert.match(last(rejected).message,/Refresh/);
  assert.equal(s.sockets.get(originalPeer.id),guest);assert.equal(guest.readyState,1);assert.equal(originalPeer.simCapacity,32);assert.equal(originalPeer.revision,77);assert.equal(roomCapacity(s.room),32);
  const rejectedHost=await join(s,{secret:welcome(host).secret});assert.equal(last(rejectedHost).code,'client_update_required');assert.equal(s.sockets.get(s.room.hostId),host);
});
