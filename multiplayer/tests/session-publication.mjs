import test from 'node:test';
import assert from 'node:assert/strict';
import {WorldSession} from '../client/session.js';
import {SnapshotDeltaDecoder} from '../client/state-codec.js';

class Connection extends EventTarget {
  constructor(){super();this.epoch=1;this.hostId='host';this.peers=new Map();this.prepared=[];this.sent=[];this.fail=new Set();}
  prepareMessage(data){this.prepared.push(data);return JSON.parse(JSON.stringify(data));}
  sendPrepared(id,data){this.sent.push({id,data});return !this.fail.has(id);}
  send(id,data){this.sent.push({id,data});return true;}
  broadcast(data){this.sent.push({data});}
  setCheckpoint(){}
  close(){}
}
function fixture(){
  const connection=new Connection(),session=new WorldSession({connection,storage:{getItem(){},setItem(){}}});
  let tick=0,reads=0;
  session.connection.validateCheckpoint=()=>{}; // This scheduling fixture intentionally uses a partial simulation stub.
  session.identity={peerId:'host'};session.running=true;session.last=performance.now();session.lastCheckpoint=performance.now();
  session.simulation={step(){tick++;return [{type:'step',tick}];},snapshot(){reads++;return {tick,players:[],projectiles:[]};},checkpoint(){return {tick,players:[]};}};
  return {session,connection,getTick:()=>tick,getReads:()=>reads};
}
test('delayed host timer runs every simulation step and event but only publishes its newest snapshot',()=>{
  const {session,connection,getTick,getReads}=fixture();const snapshots=[],events=[];
  session.addEventListener('snapshot',e=>snapshots.push(e.detail));session.addEventListener('event',e=>events.push(e.detail));
  session.last-=100;session.tick();
  assert.ok(getTick()>=5&&getTick()<=6);assert.equal(events.length,getTick());assert.equal(session.metrics.steps,getTick());
  assert.equal(getReads(),1);assert.equal(snapshots.length,1);assert.equal(snapshots[0].tick,getTick());
  assert.equal(connection.sent.filter(m=>m.data?.kind==='snapshot').length,0,'no network snapshot with no remote peers');
});
test('one local snapshot still arrives at normal 20 Hz without remotes',()=>{
  const {session,getReads}=fixture();session.accumulator=51;session.tick();
  assert.equal(session.metrics.steps,3);assert.equal(getReads(),1);
});
test('mixed peers share prepared payloads; failed sends recover independently with a keyframe',()=>{
  const {session,connection}=fixture();
  for(let i=0;i<7;i++){const id=`p${i}`;connection.peers.set(id,{});if(i<6)session.codec.enable(id);}
  const decoders=new Map([...connection.peers.keys()].map(id=>[id,new SnapshotDeltaDecoder()]));
  session.publish();assert.equal(connection.prepared.length,2,'one keyframe and one legacy snapshot');
  for(const {id,data} of connection.sent)if(data.kind==='snapshot_delta')assert.ok(decoders.get(id).accept(data).snapshot);
  connection.sent=[];connection.prepared=[];connection.fail.add('p0');session.simulation.step();session.publish();
  for(const {id,data} of connection.sent)if(id!=='p0'&&data.kind==='snapshot_delta')assert.ok(decoders.get(id).accept(data).snapshot);
  connection.sent=[];connection.prepared=[];connection.fail.clear();session.simulation.step();session.publish();
  assert.equal(connection.prepared.length,3,'one recovery keyframe, one shared delta, one legacy');
  assert.equal(connection.sent.find(m=>m.id==='p0').data.b,-1);
  for(const {id,data} of connection.sent)if(data.kind==='snapshot_delta')assert.ok(decoders.get(id).accept(data).snapshot,`decoder ${id}`);
});
