import test from 'node:test';
import assert from 'node:assert/strict';
import {PeerRoomConnection} from '../peer/browser.js';
import {SnapshotDeltaDecoder} from '../client/state-codec.js';
class Socket extends EventTarget {
  static OPEN=1;constructor(){super();this.readyState=1;this.sent=[];this.bufferedAmount=0;}
  send(text){this.sent.push(JSON.parse(text));}close(){this.readyState=3;}
  message(value){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(value)}));}
}
const channel=()=>({readyState:'open',bufferedAmount:0,send(){},close(){this.readyState='closed';this.onclose?.();}});
class RTC {
  constructor(){this.connectionState='connected';}createDataChannel(){return channel();}
  async createOffer(){return{type:'offer'};}async createAnswer(){return{type:'answer'};}
  async setLocalDescription(d){this.localDescription=d;}async setRemoteDescription(d){this.remoteDescription=d;}close(){}
}
const state=tick=>({tick,players:[{id:'host',position:[1.23456789123,tick*.000000019,0],seq:999}],terrainBake:{samples:[.123456789123,-.89123456789]},future:{unknown:'retained'}});
async function pair({legacy=false}={}){
  const oldSocket=globalThis.WebSocket,oldRTC=globalThis.RTCPeerConnection;globalThis.WebSocket=Socket;globalThis.RTCPeerConnection=RTC;
  const host=new PeerRoomConnection({url:'ws://local/peer/cloud'}),guest=new PeerRoomConnection({url:'ws://local/peer/cloud'}),wire=[];
  for(const [conn,id,other] of [[host,'host','guest'],[guest,'guest','host']]){
    conn.connect({room:'12345678',name:id,desktop:true});conn.socket.message({type:'welcome',room:'12345678',peerId:id,hostId:'host',epoch:1,secret:'secret',peers:[{id:other,online:true,desktop:true}],iceServers:[]});
  }
  guest.socket.message({type:'signal',from:'host',epoch:1,signal:{type:'offer',sdp:{type:'offer'}}});await new Promise(r=>setImmediate(r));
  const incoming=channel();guest.peers.get('host').connection.ondatachannel({channel:incoming});const outgoing=host.peers.get('guest').channel;
  const gates={drop:false,corrupt:false};
  outgoing.send=text=>{const frame=JSON.parse(text);wire.push(frame);if(gates.drop)return;if(gates.corrupt){const envelope=JSON.parse(Buffer.from(frame.body,'base64').toString());envelope.frame.h=(envelope.frame.h+1)>>>0;frame.body=Buffer.from(JSON.stringify(envelope)).toString('base64');}incoming.onmessage({data:JSON.stringify(frame)});};
  incoming.send=text=>{if(!legacy)outgoing.onmessage({data:text});};outgoing.onopen();incoming.onopen();
  return{host,guest,wire,gates,cleanup(){host.close();guest.close();globalThis.WebSocket=oldSocket;globalThis.RTCPeerConnection=oldRTC;}};
}
const envelope=frame=>JSON.parse(Buffer.from(frame.body,'base64').toString());
test('negotiated checkpoints round-trip exact unquantized state, unknown fields and periodic keyframes',async()=>{
  const p=await pair();try{
    for(let i=1;i<=25;i++){const s=state(i);p.host.setCheckpoint(s,i);assert.deepEqual(p.guest.checkpoint,s);assert.equal(p.guest.checkpointRevision,i);}
    const packets=p.wire.map(envelope).filter(e=>e.kind==='checkpoint_delta');
    assert.equal(packets.length,25);assert.ok(packets.some(e=>e.frame.b>=0));assert.ok(packets.filter(e=>e.frame.b===-1).length>=2);
    p.guest.checkpoint.players[0].position[0]=999;p.host.setCheckpoint(state(26),26);assert.deepEqual(p.guest.checkpoint,state(26),'consumers cannot corrupt decoder base');
  }finally{p.cleanup();}
});
test('legacy guests still receive exact full checkpoints without new protocol dependency',async()=>{
  const p=await pair({legacy:true});try{p.host.setCheckpoint(state(1),1);p.host.setCheckpoint(state(2),2);assert.deepEqual(p.guest.checkpoint,state(2));assert.ok(p.wire.map(envelope).every(e=>e.kind==='checkpoint'));}finally{p.cleanup();}
});
test('missing or corrupt delta base retains last good recovery state and requests a keyframe',async()=>{
  const p=await pair();try{
    p.host.setCheckpoint(state(1),1);p.gates.drop=true;p.host.setCheckpoint(state(2),2);p.gates.drop=false;
    p.host.peers.get('guest').checkpointHelloAt=-Infinity;p.host.setCheckpoint(state(3),3);
    assert.equal(p.guest.checkpointRevision,1,'lost frame cannot damage the usable recovery point');
    assert.equal(p.guest.checkpointDecoder.stats.rejected,1);
    p.host.setCheckpoint(state(4),4);assert.deepEqual(p.guest.checkpoint,state(4));
    p.guest.checkpointDecoder.lastRequest=-Infinity;p.host.peers.get('guest').checkpointHelloAt=-Infinity;
    p.gates.corrupt=true;p.host.setCheckpoint(state(5),5);p.gates.corrupt=false;assert.equal(p.guest.checkpointRevision,4);
    p.host.setCheckpoint(state(6),6);assert.deepEqual(p.guest.checkpoint,state(6));
  }finally{p.cleanup();}
});
test('backpressure triggers independent keyframe recovery; reconnect/new host stream cannot reuse obsolete bases',async()=>{
  const p=await pair();try{
    p.host.setCheckpoint(state(1),1);p.host.peers.get('guest').channel.bufferedAmount=2**21;p.host.setCheckpoint(state(2),2);assert.equal(p.guest.checkpointRevision,1);
    p.host.peers.get('guest').channel.bufferedAmount=0;p.host.setCheckpoint(state(3),3);assert.equal(envelope(p.wire.at(-1)).frame.b,-1);assert.deepEqual(p.guest.checkpoint,state(3));
    const oldStream=p.host.checkpointEncoder.stream;p.host.checkpointEncoder.reset();p.guest.checkpointDecoder.reset();p.host.setCheckpoint(state(4),4);
    assert.notEqual(p.host.checkpointEncoder.stream,oldStream);assert.deepEqual(p.guest.checkpoint,state(4));
  }finally{p.cleanup();}
});
test('mobile recovery cadence stays10s, skipped bases use keyframes, and old epochs cannot overwrite recovery',async()=>{
  const p=await pair();try{
    p.host.roster.set('guest',{desktop:false});p.host.setCheckpoint(state(1),1);p.host.setCheckpoint(state(2),2);assert.equal(p.guest.checkpointRevision,1);
    p.host.peers.get('guest').checkpointAt=0;p.host.setCheckpoint(state(3),3);assert.equal(envelope(p.wire.at(-1)).frame.b,-1);assert.deepEqual(p.guest.checkpoint,state(3));
    const f=JSON.parse(JSON.stringify(p.wire.at(-1)));f.epoch=0;p.guest.peers.get('host').channel.onmessage({data:JSON.stringify(f)});assert.equal(p.guest.checkpointRevision,3);
  }finally{p.cleanup();}
});
test('31-peer exact checkpoint deltas materially reduce a mostly static recovery stream',()=>{
  const host=new PeerRoomConnection();host.isHost=true;host.peerId='host';host.epoch=1;const decoders=new Map();let bytes=0,baseline=0;
  for(let i=1;i<32;i++){const id=`p${i}`;decoders.set(id,new SnapshotDeltaDecoder());host.checkpointEncoder.enable(id);host.roster.set(id,{desktop:true});host.peers.set(id,{channel:{readyState:'open',bufferedAmount:0,send(text){const packet=JSON.parse(text);bytes+=text.length;if(packet.total!==1)return;const e=envelope(packet);assert.ok(decoders.get(id).accept(e.frame).snapshot);}}});}
  for(let tick=1;tick<=40;tick++){const s={...state(tick),geology:Array.from({length:80},(_,i)=>({id:`rock${i}`,position:[i*.123456789,0,1],resources:100}))};host.setCheckpoint(s,tick);baseline+=Buffer.byteLength(JSON.stringify({kind:'checkpoint',state:s,revision:tick}))*4/3*31;}
  assert.ok(bytes<baseline*.3,`exact deltas ${bytes} versus full lower-bound ${baseline}`);
});
