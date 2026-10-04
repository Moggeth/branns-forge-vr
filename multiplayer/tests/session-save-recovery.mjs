import test from 'node:test';
import assert from 'node:assert/strict';
import {WorldSession} from '../client/session.js';
import {LocalRoomConnection} from '../client/local-room.js';
import {createSimulation,loadSimulation} from '../shared/simulation.js';
import {makeSave,WorldSaves} from '../client/world-saves.js';

class Connection extends EventTarget {
  constructor(){super();this.roster=new Map();this.hostId='new-owner';this.epoch=1;this.published=0;}
  connect(){this.closed=false;this.roster.set(this.hostId,{id:this.hostId,name:'Owner',role:'hero',online:true});this.dispatchEvent(new CustomEvent('welcome',{detail:{room:'87654321',peerId:this.hostId,hostId:this.hostId,role:'hero'}}));}
  close(){this.closed=true;}
  broadcast(){}
  send(){return true;}
  setCheckpoint(){this.published++;}
}
function fixture({full=true,stored=true}={}){
  const simulation=createSimulation({room:'12345678'});simulation.addPlayer({id:'old-owner',name:'Owner'});
  const state=simulation.adventureWorld();state.players[0].resources.mithril=75;state.players[0].heldOre='ironOre';
  if(full)while(state.pickups.length<256)state.pickups.push({id:`filler${state.pickups.length}`,kind:'wood',x:20,z:20,y:0,amount:1});
  const save=makeSave(simulation.checkpoint(),{id:'saved-world',name:'Orchard'}),values=new Map(),writes=[];
  let fail=false;
  const storage={getItem:k=>values.get(k),setItem:(k,v)=>{if(fail)throw Error('QuotaExceededError');values.set(k,v);writes.push(JSON.parse(v));}};
  if(stored)new WorldSaves(storage).put(save);
  writes.length=0;
  return {save,storage,values,writes,setFailure:v=>fail=v};
}
for(const stored of [true,false])test(`${stored?'Resume':'Import'} keeps undropped inventory in distinct durable recovery copy`,()=>{
  const f=fixture({stored}),connection=new Connection(),session=new WorldSession({connection,storage:f.storage}),notices=[];
  session.addEventListener('error',e=>notices.push(e.detail));
  // The backup path must continue to scrub connection credentials, even when a
  // caller supplied the checkpoint directly instead of using parseSave first.
  f.save.checkpoint.secret='private-secret';f.save.checkpoint.players[0].token='private-token';
  try{
    session.connect({save:f.save});clearInterval(session.timer);
    const notice=notices.find(n=>n.code==='inventory_recovery_saved');assert.ok(notice);
    assert.match(notice.reason,/not your new pack/);
    const all=session.saves.list(),backup=all.find(s=>s.id===notice.recoveryId);
    assert.notEqual(backup.id,f.save.id);assert.match(backup.name,/inventory recovery/);
    assert.deepEqual(backup.checkpoint,makeSave(f.save.checkpoint).checkpoint,'original complete checkpoint is recoverable');
    assert.equal(backup.checkpoint.players[0].resources.mithril,75);
    assert.equal(backup.checkpoint.players[0].heldOre,'ironOre');
    assert.doesNotThrow(()=>loadSimulation(backup.checkpoint));
    assert.ok(!JSON.stringify(backup).includes('private-'));
    assert.equal(f.writes[0][0].id,backup.id,'recovery is durable before active autosave');
    assert.equal(session.simulation.snapshot().players[0].id,'new-owner');
    assert.equal(session.simulation.snapshot().players[0].resources.mithril,0,'no invented identity ownership');
    for(let i=0;i<4;i++)session.autoSave(true);
    assert.deepEqual(session.saves.list().find(s=>s.id===backup.id),backup,'repeated autosaves cannot replace recovery');
    assert.equal(session.saves.list().length,2);
  }finally{session.dispose();}
});

test('backup write failure stops promotion without overwriting the existing save',()=>{
  const f=fixture(),before=[...f.values.entries()],connection=new Connection(),session=new WorldSession({connection,storage:f.storage}),errors=[];
  session.addEventListener('error',e=>errors.push(e.detail));f.setFailure(true);
  try{
    session.connect({save:f.save});
    assert.equal(session.simulation,null);assert.equal(session.latest,null);assert.equal(session.running,false);assert.equal(connection.closed,true);
    assert.equal(connection.published,0);assert.deepEqual([...f.values.entries()],before);assert.equal(f.writes.length,0);
    assert.equal(errors.at(-1).code,'resume_backup_failed');assert.match(errors.at(-1).reason,/Download your original save, free browser storage, then retry/);
    session.autoSave(true);assert.deepEqual([...f.values.entries()],before);
  }finally{session.dispose();}
});

test('a full eight-save index retains recovery through subsequent autosaves',()=>{
  const f=fixture(),store=new WorldSaves(f.storage);
  for(let i=0;i<7;i++)store.put(makeSave(f.save.checkpoint,{id:`other${i}`,now:Date.now()+i}));
  const session=new WorldSession({connection:new Connection(),storage:f.storage});
  try{session.connect({save:f.save});clearInterval(session.timer);for(let i=0;i<4;i++)session.autoSave(true);
    const list=store.list();assert.equal(list.length,8);assert.ok(list.some(s=>s.id!==f.save.id&&s.name.endsWith('(inventory recovery)')&&s.checkpoint.players[0].resources.mithril===75));
  }finally{session.dispose();}
});

test('room resume with pickup space needs no extra inventory backup',()=>{
  const f=fixture({full:false}),session=new WorldSession({connection:new Connection(),storage:f.storage});
  try{session.connect({save:f.save});clearInterval(session.timer);assert.equal(session.saves.list().length,1);
    const total=session.simulation.snapshot().pickups.filter(q=>q.kind==='mithril').reduce((n,q)=>n+q.amount,0);
    const original=f.save.checkpoint.pickups.filter(q=>q.kind==='mithril').reduce((n,q)=>n+q.amount,0);assert.equal(total,original+75);
  }finally{session.dispose();}
});

test('solo resume retains player identity and needs no recovery copy at full pickup capacity',()=>{
  const f=fixture(),session=new WorldSession({connection:new LocalRoomConnection(),storage:f.storage});
  try{session.connect({save:f.save});clearInterval(session.timer);assert.equal(session.identity.peerId,'old-owner');assert.equal(session.simulation.snapshot().players[0].resources.mithril,75);assert.equal(session.saves.list().length,1);
  }finally{session.dispose();}
});
