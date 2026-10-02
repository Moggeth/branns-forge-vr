import test from 'node:test';
import assert from 'node:assert/strict';
import {WorldSession} from '../client/session.js';
import {createSimulation} from '../shared/simulation.js';
class FakeConnection extends EventTarget {
  constructor(){super();this.roster=new Map();this.hostId='one';this.epoch=1;this.messages=[];}
  emit(type,detail){this.dispatchEvent(new CustomEvent(type,{detail}));}
  connect(){this.roster.set('one',{id:'one',name:'Host',role:'god',online:true});this.emit('welcome',{room:'ABCDEFGH',peerId:'one',hostId:'one',role:'god',peers:[...this.roster.values()]});}
  broadcast(data){this.messages.push(data);}
  send(to,data){this.messages.push({to,...data});}
  setCheckpoint(state,revision){this.checkpoint=state;this.checkpointRevision=revision;}
  close(){}
}
const storage=()=>{const data=new Map();return {getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};};
test('host commands mutate world, late join receives state, and local backup works',()=>{
  const connection=new FakeConnection(), s=new WorldSession({connection,storage:storage()});
  try{
    s.connect(); assert.equal(s.simulation.snapshot().players.length,1);
    s.command('cast',{spell:'raise',point:[10,0,10]}); s.publish(true);
    assert.equal(connection.checkpoint.edits.length,1);
    connection.roster.set('two',{id:'two',name:'Friend',role:'hero',online:true});
    connection.emit('peer_connected',{peerId:'two'});
    assert.equal(s.simulation.snapshot().players.length,2);
    assert.equal(s.exportSave().checkpoint.edits.length,1);
    assert.equal(s.saves.list().length,1);
  } finally {s.dispose();}
});
test('host migration restores world while removing disconnected owner and fences old epoch',()=>{
  const connection=new FakeConnection(), s=new WorldSession({connection,storage:storage()});
  try{
    s.connect();s.command('cast',{spell:'raise',point:[10,0,10]});s.publish(true);
    const checkpoint=s.exportSave().checkpoint;
    connection.roster.set('two',{id:'two',name:'Friend',role:'hero',online:true});
    connection.roster.get('one').online=false;connection.hostId='two';connection.epoch=2;
    s.identity={peerId:'two',room:'ABCDEFGH',role:'hero'};
    s.promote(checkpoint);
    assert.deepEqual(s.simulation.snapshot().players.map(p=>p.id),['two']);
    assert.equal(s.simulation.snapshot().edits.length,1);
    const before=s.simulation.checkpoint();
    s.receive({from:'one',data:{kind:'command',epoch:1,message:{type:'cast',seq:2,spell:'raise',point:[0,0,0]}}});
    assert.deepEqual(s.simulation.checkpoint(),before);
  }finally{s.dispose();}
});
test('untrusted save cannot supply a broken simulation checkpoint',()=>{
  const s=new WorldSession({connection:new FakeConnection(),storage:storage()});
  assert.throws(()=>s.importSave(JSON.stringify({format:'branns-forge-world',version:1,savedAt:0,checkpoint:{seed:1}})));
  s.dispose();
});

test('reset preserves the entire live world when recovery storage is full',()=>{
  const connection=new FakeConnection(), backing=storage();let full=false;
  const s=new WorldSession({connection,storage:{getItem:k=>backing.getItem(k),setItem:(k,v)=>{if(full)throw new Error('QuotaExceededError');backing.setItem(k,v);}}});
  try {
    s.connect();s.command('cast',{spell:'raise',point:[10,0,10]});s.publish(true);
    const before=s.simulation.checkpoint(), worldId=s.worldId, revision=connection.checkpointRevision;
    full=true;
    assert.throws(()=>s.resetWorld(),/storage is full/);
    assert.deepEqual(s.simulation.checkpoint(),before);
    assert.equal(s.worldId,worldId);assert.equal(connection.checkpointRevision,revision);
    full=false;s.resetWorld();
    assert.equal(s.simulation.snapshot().edits.length,0);
    assert.ok(s.saves.list().some(save=>save.id===worldId&&save.checkpoint.edits.length===1));
  } finally {full=false;s.dispose();}
});

test('reset starts fresh but checkpoint revisions keep increasing',()=>{
  const connection=new FakeConnection(),s=new WorldSession({connection,storage:storage()});
  try{s.connect();s.command('cast',{spell:'raise',point:[10,0,10]});s.publish(true);
    const revision=connection.checkpointRevision;s.resetWorld();
    assert.equal(s.simulation.snapshot().edits.length,0);
    assert.ok(connection.checkpointRevision>revision);
    assert.equal(s.saves.list().length,2);
  }finally{s.dispose();}
});
