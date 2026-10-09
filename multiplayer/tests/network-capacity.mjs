import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MAX_PLAYERS,MAX_PENDING_ROOM_SOCKETS,SIGNAL_MESSAGES_PER_EDGE,RELAY_MESSAGES_PER_EDGE} from '../shared/multiplayer-limits.js';
import {SnapshotDeltaEncoder,SnapshotDeltaDecoder} from '../client/state-codec.js';
import {WorldSession} from '../client/session.js';

let source=await readFile(new URL('../cloud/worker.js',import.meta.url),'utf8');
source=source.replace("import { DurableObject } from 'cloudflare:workers';",'class DurableObject {}');
source=source.replace("export {ForgeDirectory} from './directory.js';",'');
source=source.replace("'./room-directory.js'",JSON.stringify(new URL('../cloud/room-directory.js',import.meta.url).href)).replace("'./ice-servers.js'",JSON.stringify(new URL('../cloud/ice-servers.js',import.meta.url).href));
source=source.replace("'../shared/multiplayer-limits.js'",JSON.stringify(new URL('../shared/multiplayer-limits.js',import.meta.url).href));
source=source.replace("'../peer/room-capacity.js'",JSON.stringify(new URL('../peer/room-capacity.js',import.meta.url).href));
const {ForgeRoom}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
function socket(id){let a={id,at:Date.now(),messages:0};return{readyState:1,sent:[],deserializeAttachment(){return a;},serializeAttachment(value){a=value;},send(value){this.sent.push(JSON.parse(value));},close(code){this.closedCode=code;this.readyState=3;}};}
async function roomFixture(count=MAX_PLAYERS){
  const old=globalThis.WebSocketRequestResponsePair;globalThis.WebSocketRequestResponsePair=class{};
  const sockets=Array.from({length:count},(_,i)=>socket(`p${i}`));let ready;
  const room={code:'12345678',peers:sockets.map((_,i)=>({id:`p${i}`,name:`P${i}`,role:'hero',simCapacity:MAX_PLAYERS})),hostId:'p0',epoch:1};
  const ctx={storage:{async get(){return room;},async put(){}},getWebSockets:()=>sockets,blockConcurrencyWhile(fn){ready=fn();},setWebSocketAutoResponse(){}};
  const service=new ForgeRoom(ctx,{});await ready;globalThis.WebSocketRequestResponsePair=old;
  return{service,sockets,ctx};
}
test('all31 guest codec streams reconstruct a32-human snapshot',()=>{
  assert.equal(MAX_PLAYERS,32);const encoder=new SnapshotDeltaEncoder(),decoders=[];
  for(let i=1;i<MAX_PLAYERS;i++){assert.ok(encoder.enable(`p${i}`));decoders.push(new SnapshotDeltaDecoder());}
  for(let tick=1;tick<=3;tick++){
    const snapshot={tick,players:Array.from({length:MAX_PLAYERS},(_,i)=>({id:`p${i}`,position:[i,tick,0]}))};encoder.publish(snapshot);
    decoders.forEach((d,i)=>assert.deepEqual(d.accept(JSON.parse(JSON.stringify(encoder.frame(`p${i+1}`,1)))).snapshot,snapshot));
  }
});
test('cloud permits31-edge host signaling while retaining one-edge guest limit',async()=>{
  const {service,sockets}=await roomFixture();
  for(let i=0;i<SIGNAL_MESSAGES_PER_EDGE+1;i++)await service.webSocketMessage(sockets[0],JSON.stringify({type:'ping',at:i}));
  assert.equal(sockets[0].closedCode,undefined,'normal full-room ICE/signaling burst cannot disconnect host');
  for(let i=0;i<SIGNAL_MESSAGES_PER_EDGE+1;i++)await service.webSocketMessage(sockets[1],JSON.stringify({type:'ping',at:i}));
  assert.equal(sockets[1].closedCode,1008,'guests retain their bounded budget');
});
test('cloud host relay budget scales to31edges and closes above the finite ceiling',async()=>{
  const {service,sockets}=await roomFixture(),host=sockets[0],a=host.deserializeAttachment();
  a.relayAt=Date.now();a.relayMessages=(MAX_PLAYERS-1)*RELAY_MESSAGES_PER_EDGE-1;
  await service.webSocketMessage(host,JSON.stringify({type:'relay',to:'p1',epoch:1,frame:'small'}));assert.equal(host.closedCode,undefined);
  await service.webSocketMessage(host,JSON.stringify({type:'relay',to:'p1',epoch:1,frame:'small'}));assert.equal(host.closedCode,1008);
});
test('pending sockets remain bounded above32joined seats',async()=>{
  const {service,ctx}=await roomFixture();ctx.getWebSockets=()=>Array(MAX_PLAYERS+MAX_PENDING_ROOM_SOCKETS).fill({});
  const response=await service.fetch(new Request('https://room/peer/cloud?mode=join&room=12345678'));assert.equal(response.status,429);
});
test('battle lifecycle controls are host-only; hero base attacks still reach simulation',()=>{
  class Connection extends EventTarget {constructor(){super();this.hostId='host';this.maxPeers=MAX_PLAYERS;this.epoch=1;this.sent=[];}send(id,data){this.sent.push({id,data});}broadcast(){}}
  const connection=new Connection(),s=new WorldSession({connection,storage:{getItem(){},setItem(){}}}),commands=[];s.identity={peerId:'host'};s.simulation={command(id,message){commands.push({id,message});return{ok:true};}};
  for(const action of ['start','stop','reset'])s.applyCommand('guest',{type:'battle',action,seq:1});assert.equal(commands.length,0);assert.equal(connection.sent.length,3);assert.ok(connection.sent.every(x=>x.data.code==='host_required'));
  s.applyCommand('host',{type:'battle',action:'start',seq:2});s.applyCommand('guest',{type:'battle',action:'attack_base',targetId:'enemy',seq:2});assert.equal(commands.length,2);
});
