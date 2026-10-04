import assert from 'node:assert/strict';
import {proximityGraph,VOICE_NEIGHBORS} from '../client/voice-topology.js';
import {ProximityVoice} from '../client/proximity-voice.js';
const started=performance.now(),members=Array.from({length:32},(_,i)=>({id:`p${String(i).padStart(2,'0')}`,active:true,position:[i%8*3,0,Math.floor(i/8)*3]}));
function verify(graph){for(const [id,links]of graph){assert.ok(links.size<=VOICE_NEIGHBORS);for(const other of links)assert.ok(graph.get(other)?.has(id),'undirected eligibility');}}
const graph=proximityGraph(members);verify(graph);assert.equal(graph.size,32);assert.ok([...graph.values()].every(s=>s.size>0));assert.deepEqual(proximityGraph([...members].reverse()),graph,'roster order is irrelevant');
for(const count of [10,19,28,32]){const tied=proximityGraph(members.slice(0,count).map(m=>({...m,position:[0,0,0]})));verify(tied);assert.ok([...tied.values()].every(s=>s.size>0),'no roster-tail exclusion at coincident positions');}
const dense=members.map(m=>({...m,position:[0,0,0]})),oldDense=proximityGraph(dense.slice(0,31)),joinedDense=proximityGraph(dense,oldDense);verify(joinedDense);assert.ok(joinedDense.get('p31').size>0,'late joiner gets a slot in a saturated established graph');assert.ok([...joinedDense.values()].every(s=>s.size>0));
let pair=proximityGraph(members.slice(0,2).map((m,i)=>({...m,position:[i*31,0,0]})));assert.equal(pair.get('p00').size,1);
pair=proximityGraph(members.slice(0,2).map((m,i)=>({...m,position:[i*36,0,0]})),pair);assert.equal(pair.get('p00').size,1,'retain through hysteresis band');
pair=proximityGraph(members.slice(0,2).map((m,i)=>({...m,position:[i*41,0,0]})),pair);assert.equal(pair.get('p00').size,0);
pair=proximityGraph(members.slice(0,2).map((m,i)=>({...m,position:[i*36,0,0]})),pair);assert.equal(pair.get('p00').size,0,'no fresh connection beyond audible range');
let now=1000,batches=0,states=0,pcs=0;const realNow=Date.now;Date.now=()=>now;const connections=new Map(),voices=[];
class Connection extends EventTarget{
 constructor(id){super();this.peerId=id;this.hostId='p00';this.isHost=id==='p00';this.epoch=1;this.roster=new Map(members.map(m=>[m.id,{id:m.id,online:true}]));this.iceServers=[];}
 send(to,data){if(data.kind==='voice_batch'){batches++;states+=data.items.filter(i=>i.body.type==='state').length;}connections.get(to).dispatchEvent(new CustomEvent('message',{detail:{from:this.peerId,data}}));return true;}}
class Peer{
 constructor(){pcs++;this.connectionState='connected';this.signalingState='stable';this.sender={replaceTrack:async()=>{}};}
 addTransceiver(){return {sender:this.sender};}getTransceivers(){return [{receiver:{track:{kind:'audio'}},sender:this.sender}];}
 async createOffer(){return {type:'offer',sdp:'synthetic'};}async createAnswer(){return {type:'answer',sdp:'synthetic'};}
 async setLocalDescription(d){this.localDescription={...d,toJSON:()=>d};this.signalingState=d.type==='offer'?'have-local-offer':'stable';}
 async setRemoteDescription(d){this.remoteDescription=d;this.signalingState=d.type==='offer'?'have-remote-offer':'stable';}
 async addIceCandidate(){}close(){this.connectionState='closed';}}
for(const m of members)connections.set(m.id,new Connection(m.id));
try{
 for(const m of members){const v=new ProximityVoice(connections.get(m.id),{now:()=>now,createPeer:()=>new Peer()});v.active=true;v.online=true;v.audio={position(){},remove(){},dispose(){},listener(){},mute(){}};v.updatePose({position:m.position});voices.push(v);}
 for(const v of voices)v.announce();
 for(let f=0;f<40;f++){now+=100;for(const v of voices)v.tick();voices[0].route.flush();await new Promise(r=>setImmediate(r));}
 for(const v of voices){assert.equal(v.route.members().length,32);assert.ok(v.peers.size>0&&v.peers.size<=8);assert.ok(v.selected.size<=8);assert.ok(!v.stream,'test never enables microphone');for(const id of v.peers.keys())assert.ok(v.eligible(id));}
 const connected=[...voices].reduce((n,v)=>n+v.peers.size,0)/2;assert.ok(connected<=128&&connected>0);
 const beginStates=states,beginBatches=batches;
 for(let f=0;f<100;f++){now+=100;for(const v of voices){v.pose.position=v.pose.position.map((x,i)=>i===0?x+.1:x);v.tick();}voices[0].route.flush();await new Promise(r=>setImmediate(r));}
 const movementStates=states-beginStates;assert.ok(movementStates<=32*31*21,'moving presence capped near2Hz, not10Hz');assert.ok(batches-beginBatches<=31*21);
 // Unselected or old-session topology cannot grow peer fanout or reopen media.
 const v=voices[31],before=[...v.selected];v.receive('p01',{type:'neighbors',session:v.session,peers:[]});assert.deepEqual([...v.selected],before);
 v.receive('p00',{type:'neighbors',session:'old-session',peers:[]});assert.deepEqual([...v.selected],before);
 v.reset();assert.equal(v.peers.size,0);assert.equal(v.selected.size,0);assert.ok(!v.stream);
 for(let f=0;f<40;f++){now+=100;for(const voice of voices)voice.tick();voices[0].route.flush();await new Promise(r=>setImmediate(r));}
 assert.ok(v.peers.size>0&&v.peers.size<=8,'session replacement reacquires current selected neighbors');
 v.pose.position=[500,0,500];v.announce();voices[0].route.flush();assert.equal(v.peers.size,0,'out-of-range topology closes audio immediately');
 for(const voice of voices)assert.ok(voice.peers.size<=8);
 // Host migration changes both game epoch and every voice session. Old host
 // topology cannot survive; active listeners recover without mic permission.
 for(const c of connections.values()){c.hostId='p01';c.isHost=c.peerId==='p01';c.epoch=2;}
 for(const c of connections.values())c.dispatchEvent(new CustomEvent('host_changed',{detail:{}}));
 for(let f=0;f<60;f++){now+=100;for(const voice of voices)voice.tick();voices[1].route.flush();await new Promise(r=>setImmediate(r));}
 for(const voice of voices){assert.ok(voice.peers.size<=8);assert.ok(!voice.stream);}
 assert.ok(voices.slice(0,31).every(v=>v.peers.size>0),'new host restores nearby listener graph');
 assert.equal(voices[31].peers.size,0,'distant listener stays unconnected');
 console.log(JSON.stringify({members:32,connectedPairs:connected,maxPairs:128,movementStatesOver10s:movementStates,fullMesh10HzStates:32*31*100,peerConnectionsCreated:pcs,elapsedMs:performance.now()-started}));
}finally{for(const v of voices)v.dispose();Date.now=realNow;}
