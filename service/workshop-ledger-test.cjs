'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {init,snapshot,act} = require('./workshop-ledger');
const {RESOURCES,TOOLS} = require('./progression');

function world(overrides={}) {
  const resources=Object.fromEntries(RESOURCES.map(r=>[r,0]));
  const p={tails:0,resources, tier:1, unlocks:[], tools:TOOLS.filter(t=>t.tier===1).map(t=>t.id)};
  const w={player:p,context:{zone:'forge_yard',position:{x:1,y:2,z:3}},seen:Date.now(),save(){ if(this.failSave) throw Error('disk failed'); },progression(){return {tier:this.player.tier,resources:{...this.player.resources,rat_tail:this.player.tails}};}};
  Object.assign(w.player,overrides.player||{}); const {player:_ignored,...worldOverrides}=overrides; Object.assign(w,worldOverrides); w.player.resources.rat_tail=w.player.tails; init(w); return w;
}
let serial=0;
function call(w,action,body={},store=null) { return act(w,action,{...body,requestId:'r'+(++serial)},store); }
function take(w,r) { return call(w,'material-take',{resource:r}).token; }
function expectError(fn,match) { assert.throws(fn,match&&new RegExp(match)); }

test('materials are conserved and donations persist across reload',()=>{
  const w=world(); w.player.tails=3;w.player.resources.rat_tail=3;
  const tokens=[take(w,'rat_tail'),take(w,'rat_tail'),take(w,'rat_tail')];
  assert.equal(w.player.tails,0);
  for(const token of tokens) call(w,'donate',{tokenId:token.id,option:0});
  assert.deepEqual(snapshot(w).donations.counts,{rat_tail:3});
  const reloaded=world({player:structuredClone(w.player)});
  assert.deepEqual(snapshot(reloaded).donations.counts,{rat_tail:3});
  call(reloaded,'withdraw',{tokenId:tokens[0].id});
  assert.equal(snapshot(reloaded).donations.counts.rat_tail,2);
  assert.equal(reloaded.player.tails,0);
  call(reloaded,'material-return',{tokenId:tokens[0].id});
  assert.equal(reloaded.player.tails,1);
});

test('commit is locked until exact physical donation and does not create debt',()=>{
  const w=world(); w.player.tails=3;w.player.resources.rat_tail=3;
  expectError(()=>call(w,'commit',{tier:2}),'exact selected');
  const t=take(w,'rat_tail');call(w,'donate',{tokenId:t.id,option:0});
  expectError(()=>call(w,'commit',{tier:3}),'next workshop');
  for(let i=0;i<2;i++) call(w,'donate',{tokenId:take(w,'rat_tail').id,option:0});
  expectError(()=>call(w,'material-take',{resource:'rat_tail'}),'Insufficient');
  call(w,'commit',{tier:2});
  assert.equal(w.player.tier,2);assert.equal(w.player.tails,0);assert.deepEqual(snapshot(w).donations.counts,{});
});

test('request receipts deduplicate and reject mismatched reuse',()=>{
  const w=world();w.player.tails=1;w.player.resources.rat_tail=1;
  const first=act(w,'material-take',{resource:'rat_tail',requestId:'same'});
  const repeat=act(w,'material-take',{resource:'rat_tail',requestId:'same'});
  assert.equal(first.token.id,repeat.token.id);assert.equal(w.player.tails,0);assert.equal(snapshot(w).tokens.length,1);
  expectError(()=>act(w,'material-take',{resource:'lumber',requestId:'same'}),'different workshop action');
});

test('save failure restores all in-memory mutations',()=>{
  const w=world();w.player.tails=1;w.player.resources.rat_tail=1;const before=structuredClone(w.player);w.failSave=true;
  expectError(()=>call(w,'material-take',{resource:'rat_tail'}),'disk failed');
  assert.deepEqual(w.player,before);
});

test('cost options, context, and malformed persisted state are rejected',()=>{
  const w=world();w.player.resources.lumber=3;w.player.resources.stone=3;
  call(w,'option',{option:1});const t=take(w,'lumber');call(w,'donate',{tokenId:t.id,option:1});
  expectError(()=>call(w,'option',{option:0}),'Withdraw all');
  w.seen=Date.now()-5001;expectError(()=>call(w,'withdraw',{tokenId:t.id}),'Refresh');
  const bad=world();bad.player.workshop.tokens.push({});expectError(()=>snapshot(bad),'Invalid workshop token');
});

test('module tiers, compatibility, installation, replacement, and removal',()=>{
  const w=world({player:{tier:2,resources:Object.fromEntries(RESOURCES.map(r=>[r,0]))}});
  w.player.resources.iron=2;w.player.tails=1;w.player.resources.rat_tail=1;
  const quick=call(w,'module-craft',{kind:'quickwind'}).module;
  expectError(()=>call(w,'module-install',{moduleId:quick.id,itemId:'apprentice_hammer'}),'incompatible');
  const store={ready:id=>id==='20dc22c5-7bcc-43df-b07f-e81eab521b0f'?{id}:null};
  call(w,'module-install',{moduleId:quick.id,itemId:'20dc22c5-7bcc-43df-b07f-e81eab521b0f'},store);
  w.player.tier=3;w.player.workshop.donations={tier:4,option:0};w.player.resources.crystal=2;w.player.resources.haunted_bone=1;
  const sight=call(w,'module-craft',{kind:'truesight'}).module;
  const replaced=call(w,'module-install',{moduleId:sight.id,itemId:'20dc22c5-7bcc-43df-b07f-e81eab521b0f'},store);
  assert.equal(replaced.replacedModuleId,quick.id);assert.equal(snapshot(w).sockets['20dc22c5-7bcc-43df-b07f-e81eab521b0f'],sight.id);
  call(w,'module-remove',{itemId:'20dc22c5-7bcc-43df-b07f-e81eab521b0f'});
  assert.deepEqual(snapshot(w).sockets,{});assert.equal(snapshot(w).modules.length,2);
  expectError(()=>call(w,'module-craft',{kind:'hearth'}),'tier 4');
});
