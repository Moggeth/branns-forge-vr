import assert from 'node:assert/strict';
import {VoiceRoute, validVoiceBody} from '../client/voice-route.js';
import {ProximityVoice} from '../client/proximity-voice.js';
import {acousticPosition, VoiceAudio, VOICE_RANGE} from '../client/voice-audio.js';

const emit = (target, type, detail) => target.dispatchEvent(new CustomEvent(type, {detail}));
class Connection extends EventTarget {
  constructor(id, host = 'h') { super(); this.peerId = id; this.hostId = host; this.isHost = id === host; this.epoch = 1; this.roster = new Map(['h','a','b'].map(id => [id,{id,name:id,online:true}])); this.sent = []; }
  send(to, data) { this.sent.push({to,data}); return true; }
}
const state = {type:'state',session:'session-a',active:true,mic:false,position:[1,2,3]};
assert(validVoiceBody(state)); assert(!validVoiceBody({...state,position:[Infinity,0,0]})); assert(!validVoiceBody({...state,position:[10001,0,0]}));
assert(!validVoiceBody({type:'offer',session:'s',targetSession:'t',description:{type:'offer',sdp:'x'}}));
const h = new Connection('h'), received = [], route = new VoiceRoute(h, (...v) => received.push(v));
emit(h,'message',{from:'a',data:{kind:'voice',epoch:1,to:'*',from:'b',body:state}}); route.flush();
assert.equal(received[0][0],'a','host derives sender from authenticated edge, never payload');
assert.equal(h.sent[0].data.items[0].from,'a'); assert.equal(h.sent[0].to,'b');
const before=h.sent.length;
emit(h,'message',{from:'outsider',data:{kind:'voice',epoch:1,to:'*',body:state}});
emit(h,'message',{from:'a',data:{kind:'voice',epoch:0,to:'*',body:state}});route.flush();assert.equal(h.sent.length,before);
const b = new Connection('b'), delivered = [], guestRoute = new VoiceRoute(b,(...v)=>delivered.push(v));
emit(b,'message',{from:'a',data:h.sent[0].data});assert.equal(delivered.length,0,'guest rejects non-host forwarding');
emit(b,'message',{from:'h',data:h.sent[0].data});assert.equal(delivered.length,1);
for(let i=0;i<80;i++)emit(h,'message',{from:'a',data:{kind:'voice',epoch:1,to:'*',body:state}});
assert.equal(received.length,60,'metadata is rate bounded');route.flush();
assert.equal(h.sent.at(-1).data.items.length,1,'latest position coalesces');
route.dispose();guestRoute.dispose();

const eight = new Connection('h');eight.roster=new Map(['h','a','b','c','d','e','f','g'].map(id=>[id,{id,online:true}]));
const eightRoute=new VoiceRoute(eight,()=>{});
for(let frame=0;frame<10;frame++){
  for(const id of ['a','b','c','d','e','f','g'])emit(eight,'message',{from:id,data:{kind:'voice',epoch:1,to:'*',body:state}});
  eightRoute.send('*',state);eightRoute.flush();
}
assert.equal(eight.sent.length,70,'eight peers need only ten metadata batches per outgoing edge each second');
assert(eight.sent.every(m=>m.data.items.length===7&&JSON.stringify(m.data).length<32000));
eight.epoch++;eightRoute.forward('a',{kind:'voice',epoch:1,to:'*',body:state});eightRoute.flush();assert.equal(eight.sent.length,70,'old epoch queued metadata is discarded');eightRoute.dispose();

assert.deepEqual(acousticPosition({role:'god',xr:false,position:[0,80,0],focus:[5,3,7]}),[5,4.65,7]);
assert.deepEqual(acousticPosition({role:'hero',xr:false,position:[1,2,3]}),[1,2,3]);
assert.deepEqual(acousticPosition({role:'god',xr:true,position:[9,8,7]}),[9,8,7]);
const param = () => ({value:0,setTargetAtTime(v){this.value=v;}});
const node = () => ({gain:param(),connect(){return this;},disconnect(){this.disconnected=true;},...Object.fromEntries(['position','forward','up'].flatMap(prefix=>[...'XYZ'].map(axis=>[prefix+axis,param()]))) });
const context = () => ({state:'running',currentTime:0,destination:{},listener:node(),resume:async()=>{},close:async function(){this.state='closed';},createGain:node,createPanner:node,createMediaStreamSource:node});
const audio = new VoiceAudio(context()); audio.add('a',{});audio.position('a',[2,3,4]);
assert.equal(audio.sources.get('a').panner.maxDistance,VOICE_RANGE);assert.equal(audio.sources.get('a').panner.distanceModel,'linear');assert.equal(audio.sources.get('a').panner.panningModel,'HRTF');
audio.mute('a',true);audio.position('a',[2,3,4]);assert.equal(audio.sources.get('a').gain.gain.value,0);
audio.deafen(true);assert.equal(audio.output.gain.value,0);audio.dispose();assert.equal(audio.sources.size,0);

globalThis.RTCPeerConnection = class {}; // capability only; peers are injected below
globalThis.document = new EventTarget();document.hidden=false;
let calls=0,resolveCapture, rejectCapture;
const mediaDevices={getUserMedia:()=>{calls++;return new Promise((resolve,reject)=>{resolveCapture=resolve;rejectCapture=reject;});}};
const c = new Connection('a');let time=1000;
const voice = new ProximityVoice(c,{mediaDevices,createContext:context,createPeer:()=>{throw Error('blocked');},now:()=>time});
voice.updatePose({position:[0,1.65,0],forward:[0,0,-1],up:[0,1,0]});
emit(c,'status',{state:'connected'});await voice.join();assert.equal(calls,0,'joining never asks for microphone');
const stream = () => {const track={readyState:'live',stop(){this.readyState='ended';}};return {getTracks:()=>[track],getAudioTracks:()=>[track]};};
let pending=voice.enableMicrophone();assert.equal(calls,1);rejectCapture(Object.assign(Error(),{name:'NotAllowedError'}));await pending;assert.match(voice.message,/site settings/);assert.equal(voice.pending,false);
pending=voice.enableMicrophone();const first=stream();resolveCapture(first);await pending;assert(voice.state().microphone);
voice.stopMicrophone();assert.equal(first.getTracks()[0].readyState,'ended');assert(!voice.stream);
pending=voice.enableMicrophone();voice.leave();const late=stream();resolveCapture(late);await pending;assert.equal(late.getTracks()[0].readyState,'ended','late permission after leave releases track');
await voice.join();pending=voice.enableMicrophone();const next=stream();resolveCapture(next);await pending;voice.deafen(true);assert.equal(next.getTracks()[0].readyState,'ended');voice.deafen(false);assert(!voice.stream,'undeafen never reopens mic');
pending=voice.enableMicrophone();const disconnected=stream();resolveCapture(disconnected);await pending;emit(c,'status',{state:'signaling_reconnecting'});assert.equal(disconnected.getTracks()[0].readyState,'ended');
emit(c,'status',{state:'connected'});emit(c,'welcome',{});assert(!voice.stream,'reconnect never reopens mic');
pending=voice.enableMicrophone();const hidden=stream();resolveCapture(hidden);await pending;document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));assert.equal(hidden.getTracks()[0].readyState,'ended');document.hidden=false;
pending=voice.enableMicrophone();emit(c,'host_changed',{});const migrated=stream();resolveCapture(migrated);await pending;assert.equal(migrated.getTracks()[0].readyState,'ended','host migration invalidates pending capture');
voice.receive('b',{...state,session:'b-session',mic:true});assert.equal(voice.members.size,1);time+=13000;voice.tick();assert.equal(voice.members.size,0,'stale participants cleaned up');
voice.receive('b',{...state,session:'b-session'});voice.receive('b',{...state,session:'new-session'});assert.equal(voice.members.get('b').session,'new-session');
voice.dispose();assert.equal(voice.peers.size,0);assert.equal(voice.members.size,0);assert.equal(voice.audio,null);
delete globalThis.document;
console.log('PASS proximity voice: authenticated bounded routing, positional semantics, audio graph, opt-in, denial/retry, mute/deafen, late permission, reconnect and cleanup');
