// Seamless host handover: the world moves to the next player with no button, no long grace
// wait and no rewinding on screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MAX_PLAYERS} from '../shared/multiplayer-limits.js';
import {WorldSession} from '../client/session.js';
import {createPresentationClock} from '../client/presentation-clock.js';

let source=await readFile(new URL('../cloud/worker.js',import.meta.url),'utf8');
source=source.replace("import { DurableObject } from 'cloudflare:workers';",'class DurableObject {}').replace("export {ForgeDirectory} from './directory.js';",'');
for(const path of ['./room-directory.js','../shared/multiplayer-limits.js','../peer/room-capacity.js'])
  source=source.replace(`'${path}'`,JSON.stringify(new URL((path.startsWith('./')?'../cloud/':'../')+path.replace(/^\.\.?\//,''),import.meta.url).href));
const {ForgeRoom}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

function socket(id){return{readyState:1,sent:[],att:{id,at:Date.now(),messages:0},send(t){this.sent.push(JSON.parse(t));},close(){this.readyState=3;},deserializeAttachment(){return this.att;},serializeAttachment(a){this.att=a;}};}
function room(){
  const s=Object.create(ForgeRoom.prototype),now=Date.now();
  s.room={code:'12345678',hostId:'h',epoch:1,created:now,lastActivity:now,graceAt:0,tried:[],migrating:false,offer:null,
    peers:['h','a','b'].map((id,i)=>({id,name:id,role:'hero',desktop:true,simCapacity:MAX_PLAYERS,revision:i?i+4:-1,offlineAt:0}))};
  s.sockets=new Map(s.room.peers.map(p=>[p.id,socket(p.id)]));s.env={};
  s.ctx={getWebSockets:()=>[...s.sockets.values()],storage:{put:async()=>{},setAlarm:async()=>{},deleteAlarm:async()=>{}}};
  return s;
}
const said=(s,id,type)=>s.sockets.get(id)?.sent.filter(m=>m.type===type)||[];

test('room: a guest that stops hearing a departed host skips the 15 s reconnect grace',async()=>{
  const s=room(),host=s.sockets.get('h');
  await s.depart(host);
  assert.ok(s.room.graceAt>Date.now()+10000,'abrupt loss still starts the long grace');
  assert.equal(said(s,'b','continue_world_offer').length,0);
  await s.webSocketMessage(s.sockets.get('a'),JSON.stringify({type:'retry_world',epoch:1}));
  assert.equal(s.room.graceAt,0);
  assert.equal(said(s,'b','continue_world_offer').length,1,'freshest recovery point is offered the world at once');
});

test('room: a host frozen in the background is replaced once every other player reports silence',async()=>{
  const s=room();
  await s.webSocketMessage(s.sockets.get('a'),JSON.stringify({type:'retry_world',epoch:1}));
  assert.equal(said(s,'b','continue_world_offer').length,0,'one player losing the host is not enough');
  await s.webSocketMessage(s.sockets.get('b'),JSON.stringify({type:'retry_world',epoch:1}));
  assert.equal(said(s,'a','owner_lost').length,1);
  assert.equal(said(s,'b','continue_world_offer').length,1);
  await s.webSocketMessage(s.sockets.get('b'),JSON.stringify({type:'continue_world',epoch:1}));
  assert.equal(s.room.hostId,'b');assert.equal(said(s,'h','host_changed').at(-1).hostId,'b','old host learns it is a guest now');
  // Straight after a change, silence reports cannot bounce the world around.
  for(const id of ['a','h'])await s.webSocketMessage(s.sockets.get(id),JSON.stringify({type:'retry_world',epoch:2}));
  assert.equal(s.room.hostId,'b');assert.equal(s.room.migrating,false);
});

class FakeConnection extends EventTarget {
  constructor(){super();this.roster=new Map();this.hostId='one';this.epoch=1;this.signals=[];this.peers=new Map();}
  emit(type,detail){this.dispatchEvent(new CustomEvent(type,{detail}));}
  connect(){this.roster.set('one',{id:'one',name:'Host',role:'hero',online:true});this.emit('welcome',{room:'12345678',peerId:'one',hostId:'one',role:'hero',peers:[...this.roster.values()]});}
  broadcast(){} send(){return true;}
  setCheckpoint(state,revision){this.checkpoint=state;this.checkpointRevision=revision;this.signals.push({type:'checkpoint',revision});}
  successor(){return 'two';}
  transferHost(to){this.signals.push({type:'transfer_host',to});}
  continueWorld(){this.signals.push({type:'continue_world'});} declineWorld(){this.signals.push({type:'decline_world'});} retryWorld(){}
  close(){}
}
const storage=()=>{const data=new Map();return {getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};};

test('session: an offered world is taken over at once, or passed on from a background page',()=>{
  const connection=new FakeConnection(),s=new WorldSession({connection,storage:storage()});
  try{
    connection.hostId='two';connection.emit('welcome',{room:'12345678',peerId:'one',hostId:'two',role:'hero',peers:[]});
    connection.emit('continue_world_offer',{epoch:1,revision:3,graceful:false});
    assert.deepEqual(connection.signals.map(m=>m.type),['continue_world']);
    const original=globalThis.document;globalThis.document={hidden:true};
    try{connection.emit('continue_world_offer',{epoch:1,revision:3,graceful:false});}finally{globalThis.document=original;}
    assert.equal(connection.signals.at(-1).type,'decline_world');
  }finally{s.dispose();}
});

test('session: a host stepping away publishes a fresh recovery point, then hands over',()=>{
  const connection=new FakeConnection(),s=new WorldSession({connection,storage:storage()});
  try{
    s.connect();connection.roster.set('two',{id:'two',name:'Friend',role:'hero',online:true});connection.peers.set('two',{});connection.emit('peer_connected',{peerId:'two'});
    connection.signals.length=0;
    assert.equal(s.handOver(),true);
    assert.deepEqual(connection.signals.map(m=>m.type),['checkpoint','transfer_host']);
    assert.equal(connection.signals[1].to,'two');
    connection.successor=()=>null;assert.equal(s.handOver(),false,'alone: keep hosting');
  }finally{s.dispose();}
});

test('screen: the new host resuming slightly behind slows time briefly instead of rewinding it',()=>{
  const clock=createPresentationClock();let ms=0,tick=1000,last=-Infinity,minStep=Infinity;const shown=[];
  for(let f=0;f<480;f++){ms+=1000/60;
    if(f<120){if(f%3===0)clock.observe(tick+=3,ms);}
    else if(f===150)clock.observe(tick-=30,ms); // host gone for half a second, new host resumes 0.5 s back
    else if(f>150&&f%3===0)clock.observe(tick+=3,ms);
    const t=clock.sample(ms);assert.ok(t>=last,'never backwards');if(f>152)minStep=Math.min(minStep,t-last);last=t;shown.push(t);}
  assert.ok(minStep>.7,'keeps moving (slowed, not frozen) while the new host catches up');
  assert.ok(Math.abs(shown.at(-1)-tick)<20,'lines back up with the new host');
  clock.observe(0,ms+16);assert.equal(clock.sample(ms+16),0,'a real world restore still resets');
});
