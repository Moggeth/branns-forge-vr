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
