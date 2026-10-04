import test from 'node:test';
import assert from 'node:assert/strict';
import {PeerRoomConnection} from '../peer/browser.js';

function fixture({relay = false} = {}) {
  const conn = new PeerRoomConnection(), sent = new Map();
  conn.isHost = true; conn.peerId = 'host'; conn.epoch = 7;
  conn.socket = {readyState:1, bufferedAmount:0, send(text){const m=JSON.parse(text);sent.get(m.to).push(JSON.parse(m.frame));}};
  for (let i=0;i<7;i++) {
    const id=`p${i}`;sent.set(id,[]);conn.roster.set(id,{desktop:true});
    conn.peers.set(id,{relay,channel:{readyState:'open',bufferedAmount:0,send(text){sent.get(id).push(JSON.parse(text));}}});
  }
  return {conn,sent};
}
function decode(frames) {
  assert.equal(frames.length,frames[0].total);
  frames.forEach((f,i)=>assert.equal(f.part,i));
  return JSON.parse(Buffer.concat(frames.map(f=>Buffer.from(f.body,'base64'))).toString('utf8'));
}
for (const relay of [false,true]) test(`prepared publication preserves fragmented Unicode and peer identity (${relay?'relay':'direct'})`,()=>{
  const before=globalThis.WebSocket;globalThis.WebSocket={OPEN:1};
  try {
    const {conn,sent}=fixture({relay}),payload={tick:1,text:'火🌳'.repeat(9000)},expected=structuredClone(payload);
    let serialized=0;Object.defineProperty(payload,'toJSON',{value(){serialized++;return expected;}});
    const prepared=conn.prepareMessage(payload);payload.tick=999;
    for(const id of conn.peers.keys())assert.equal(conn.sendPrepared(id,prepared),true);
    assert.equal(serialized,1,'one encoding for seven destinations');
    const ids=new Set();for(const frames of sent.values()){assert.deepEqual(decode(frames),{kind:'message',data:expected});ids.add(frames[0].id);assert.equal(frames[0].epoch,7);}
    assert.equal(ids.size,7,'each peer retains its own fragment assembly identity');
    assert.ok(Object.isFrozen(prepared)&&Object.isFrozen(prepared.bodies));
  } finally {globalThis.WebSocket=before;}
});
test('prepared messages cannot cross epochs, owners or guest authority',()=>{
  const {conn}=fixture(),p=conn.prepareMessage({tick:1});
  assert.equal(conn.sendPrepared('p0',{...p}),false);
  const other=fixture().conn;assert.equal(other.sendPrepared('p0',p),false);
  conn.epoch++;assert.equal(conn.sendPrepared('p0',p),false);conn.epoch--;
  conn.isHost=false;conn.hostId='p0';assert.equal(conn.sendPrepared('p1',p),false);assert.equal(conn.sendPrepared('p0',p),true);
});
test('send rejects oversize, circular, closed and backpressured messages; send races never throw',()=>{
  const {conn,sent}=fixture();
  assert.equal(conn.prepareMessage({text:'x'.repeat(600_000)}),false);
  const cyclic={};cyclic.self=cyclic;assert.equal(conn.prepareMessage(cyclic),false);
  const p=conn.prepareMessage({text:'x'.repeat(40_000)}),channel=conn.peers.get('p0').channel;
  channel.readyState='closed';assert.equal(conn.sendPrepared('p0',p),false);channel.readyState='open';
  channel.bufferedAmount=2**21;assert.equal(conn.sendPrepared('p0',p),false);channel.bufferedAmount=0;
  const send=channel.send;channel.send=text=>{send(text);channel.bufferedAmount=2**21;};
  assert.equal(conn.sendPrepared('p0',p),false);assert.equal(sent.get('p0').length,1,'stop between fragments instead of flooding the buffer');
  channel.bufferedAmount=0;channel.send=()=>{throw Error('channel closed during send');};
  assert.equal(conn.sendPrepared('p0',p),false);
});
test('checkpoint fanout serializes once and preserves exact state/revision',()=>{
  const {conn,sent}=fixture();let serializations=0;
  const state={tick:57,players:[],precise:1.234567891234567};
  Object.defineProperty(state,'toJSON',{value(){serializations++;return {tick:this.tick,players:this.players,precise:this.precise};}});
  assert.equal(conn.setCheckpoint(state,9),true);assert.equal(serializations,1);
  for(const frames of sent.values())assert.deepEqual(decode(frames),{kind:'checkpoint',state:{tick:57,players:[],precise:1.234567891234567},revision:9});
  assert.equal(conn.checkpoint,state);assert.equal(conn.checkpointRevision,9);
});
