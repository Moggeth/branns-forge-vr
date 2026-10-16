import test from 'node:test';
import assert from 'node:assert/strict';
import {PeerRoomConnection} from '../peer/browser.js';

class Socket extends EventTarget {
  static OPEN = 1;
  constructor() { super(); this.readyState = 1; this.sent = []; this.bufferedAmount = 0; }
  send(text) { this.sent.push(JSON.parse(text)); }
  close() { this.readyState = 3; }
  message(message) { this.dispatchEvent(new MessageEvent('message', {data:JSON.stringify(message)})); }
}
const channel = () => ({readyState:'open', bufferedAmount:0, send(){}, close(){this.readyState='closed';this.onclose?.();}});
class RTC {
  constructor() { this.connectionState = 'connected'; }
  createDataChannel() { return channel(); }
  async createOffer() { return {type:'offer'}; }
  async setLocalDescription(value) { this.localDescription = value; }
  async setRemoteDescription(value) { this.remoteDescription = value; }
  async createAnswer() { return {type:'answer'}; }
  close() { this.connectionState = 'closed'; }
}

function fixture(t, {hostOnline=true, isHost=true}={}) {
  const oldSocket=globalThis.WebSocket,oldRTC=globalThis.RTCPeerConnection;
  globalThis.WebSocket=Socket;globalThis.RTCPeerConnection=RTC;
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:10000});
  const self=isHost?'host':'guest',other=isHost?'guest':'host';
  const conn=new PeerRoomConnection({url:'ws://localhost/peer/cloud'});
  t.after(()=>{conn.close();t.mock.timers.reset();globalThis.WebSocket=oldSocket;globalThis.RTCPeerConnection=oldRTC;});
  conn.connect({room:'12345678',name:self});
  conn.socket.message({type:'welcome',room:'12345678',peerId:self,secret:'test',hostId:'host',epoch:1,relayConfigured:true,relayTransport:'websocket',peers:[{id:other,online:hostOnline,desktop:true}]});
  return {conn,other};
}

test('stalled ICE requests relay after 250ms, without waiting eight seconds',async t=>{
  const {conn,other}=fixture(t),edge=conn.peers.get(other);
  edge.channel.readyState='connecting';
  await new Promise(resolve=>setImmediate(resolve));
  t.mock.timers.tick(249);
  assert.equal(conn.socket.sent.some(m=>m.type==='relay_request'),false);
  t.mock.timers.tick(1);
  assert.ok(conn.socket.sent.some(m=>m.type==='relay_request'&&m.to===other));
  conn.socket.message({type:'relay_request',epoch:1,from:other});
  assert.equal(conn.send(other,{kind:'snapshot',epoch:1,snapshot:{tick:1}}),true);
  assert.equal(conn.socket.sent.at(-1).type,'relay');
  edge.channel.readyState='open';edge.channel.onopen();
  assert.equal(edge.relay,true,'late RTC cannot split the ordered stream');
});

test('fast direct connection cancels relay fallback',async t=>{
  const {conn,other}=fixture(t);
  await new Promise(resolve=>setImmediate(resolve));
  conn.peers.get(other).channel.onopen();
  t.mock.timers.tick(1000);
  assert.equal(conn.socket.sent.some(m=>m.type==='relay_request'),false);
  assert.equal(conn.peers.get(other).relay,undefined);
});

test('joining while the host is offline immediately requests recovery',t=>{
  const {conn}=fixture(t,{isHost:false,hostOnline:false});
  assert.ok(conn.socket.sent.some(m=>m.type==='retry_world'&&m.epoch===1));
  assert.equal(conn.peers.size,0,'no established edge is needed to recover');
});

test('host-loss notification requests recovery before the first data channel',t=>{
  const {conn}=fixture(t,{isHost:false});
  conn.socket.message({type:'owner_lost',epoch:1,deliberate:true});
  assert.ok(conn.socket.sent.some(m=>m.type==='retry_world'&&m.epoch===1));
});

test('signaling-only host-loss notification preserves a healthy direct authority',async t=>{
  const {conn,other}=fixture(t,{isHost:false});
  conn.socket.message({type:'signal',epoch:1,from:other,signal:{type:'offer',sdp:{type:'offer'}}});
  await new Promise(resolve=>setImmediate(resolve));
  const edge=conn.peers.get(other);edge.connection.ondatachannel({channel:channel()});edge.channel.onopen();edge.receivedAt=Date.now();
  const lost=[];conn.addEventListener('owner_lost',e=>lost.push(e.detail));
  conn.socket.message({type:'owner_lost',epoch:1,deliberate:false});
  assert.deepEqual(lost,[]);
  assert.equal(conn.socket.sent.some(m=>m.type==='retry_world'),false);
});

test('removed edges cannot request relay after their timer fires',async t=>{
  const {conn,other}=fixture(t);conn.peers.get(other).channel.readyState='connecting';
  await new Promise(resolve=>setImmediate(resolve));
  conn.socket.message({type:'peer_left',epoch:1,peerId:other,deliberate:true,removed:true});
  t.mock.timers.tick(1000);
  assert.equal(conn.socket.sent.some(m=>m.type==='relay_request'),false);
});

for(const isHost of [false,true]) test(`${isHost?'host':'guest'} recovers an unexpected direct-channel close using relay`, async()=>{
  const oldSocket=globalThis.WebSocket,oldRTC=globalThis.RTCPeerConnection;
  globalThis.WebSocket=Socket;globalThis.RTCPeerConnection=RTC;
  const self=isHost?'host':'guest',other=isHost?'guest':'host';
  const conn=new PeerRoomConnection({url:'ws://localhost/peer/cloud'}),departures=[];
  conn.addEventListener('peer_left',e=>departures.push(e.detail));
  try {
    conn.connect({room:'12345678',name:self});
    conn.socket.message({type:'welcome',room:'12345678',peerId:self,secret:'test',hostId:'host',epoch:1,relayConfigured:true,relayTransport:'websocket',peers:[{id:other,online:true,desktop:true}]});
    if(!isHost)conn.socket.message({type:'signal',epoch:1,from:other,signal:{type:'offer',sdp:{type:'offer'}}});
    await new Promise(resolve=>setImmediate(resolve));
    const edge=conn.peers.get(other);
    if(!isHost)edge.connection.ondatachannel({channel:channel()});
    edge.channel.onopen();
    const start=conn.socket.sent.length;
    edge.channel.close();
    assert.equal(conn.peers.get(other),edge,'edge retained for reciprocal relay handshake');
    assert.equal(conn.roster.get(other).online,true,'transport failure is not a member departure');
    assert.deepEqual(departures,[]);
    assert.ok(conn.socket.sent.slice(start).some(m=>m.type==='relay_request'&&m.to===other&&m.epoch===1));
    conn.socket.message({type:'relay_request',epoch:1,from:other});
    assert.equal(edge.relay,true);
    assert.equal(conn.send(other,{kind:'command',epoch:1,message:{type:'input'}}),true,'traffic resumes through relay');
    assert.equal(conn.socket.sent.at(-1).type,'relay');
    const beforeRemove=conn.socket.sent.length;
    conn.socket.message({type:'peer_left',epoch:1,peerId:other,deliberate:true,removed:true});
    assert.equal(conn.peers.has(other),false);
    assert.equal(departures.length,1);
    assert.equal(conn.socket.sent.slice(beforeRemove).some(m=>m.type==='relay_request'),false,'authoritative removal never reconnects');
  } finally {conn.close();globalThis.WebSocket=oldSocket;globalThis.RTCPeerConnection=oldRTC;}
});
