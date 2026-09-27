'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {World}=require('./world'),ledger=require('./workshop-ledger');
const {UPGRADES}=require('./progression');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'brann-workshop-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const w=new World(dir);w.updateContext({zone:'forge_yard',position:{x:5,y:1.7,z:-3},visiting:false});let serial=0;return {w,dir,act:(a,b={})=>ledger.act(w,a,{...b,requestId:'fixture-'+(++serial)})};}
test('all four physical stages survive disk reload with exact conservation',t=>{
 const {w,dir,act}=fixture(t);
 for(const upgrade of UPGRADES){
  const option=upgrade.tier===2?1:0,cost=upgrade.costs[option];act('option',{option});
  for(const [resource,amount] of Object.entries(cost)){
   w.gather({id:`tier-${upgrade.tier}-${resource}`,resource,amount});
   for(let i=0;i<amount;i++)act('donate',{option,tokenId:act('material-take',{resource}).token.id});
  }
  const saved=new World(dir);assert.deepEqual(saved.progression().workshop.donations.counts,cost);assert.equal(saved.player.tier,upgrade.tier-1);
  const body={tier:upgrade.tier,requestId:'commit-tier-'+upgrade.tier};ledger.act(w,'commit',body);ledger.act(w,'commit',body);
  assert.equal(w.player.tier,upgrade.tier);assert.equal(new World(dir).player.tier,upgrade.tier);assert.equal(w.player.workshop.tokens.length,0);
  for(const resource of Object.keys(cost))assert.equal(w.progression().resources[resource],0);
 }
 assert.equal(w.progression().workshop.donations.tier,null);assert.throws(()=>act('commit',{tier:4}),/highest/);
});
test('pouch works away from forge, donated pieces survive death and cannot be refunded twice',t=>{
 const {w,dir,act}=fixture(t);w.gather({id:'tails',resource:'rat_tail',amount:3});
 const bucket=act('material-take',{resource:'rat_tail'}).token;act('donate',{tokenId:bucket.id,option:0});
 w.updateContext({zone:'pinewood_ruins',position:{x:-49,y:1.7,z:4},visiting:false});
 const loose=act('material-take',{resource:'rat_tail'}).token;
 act('material-place',{tokenId:loose.id,zone:'pinewood_ruins',position:{x:-50,y:0.1,z:4}});
 assert.throws(()=>act('donate',{tokenId:loose.id,option:0}),/Forge Yard/);
 assert.throws(()=>act('withdraw',{tokenId:bucket.id}),/Forge Yard/);
 w.death();assert.equal(w.player.drop.resources.rat_tail,1);
 assert.equal(new World(dir).player.workshop.tokens.length,2);
 act('material-return',{tokenId:loose.id});assert.equal(w.player.tails,1);
 assert.throws(()=>act('material-return',{tokenId:loose.id}),/Unknown/);assert.equal(w.player.tails,1);
 assert.equal(w.progression().workshop.donations.counts.rat_tail,1);
});
test('failed commit and failed module craft keep ingredients and retry receipts unchanged',t=>{
 const {w,act}=fixture(t);w.gather({id:'tails',resource:'rat_tail',amount:3});
 for(let i=0;i<3;i++)act('donate',{option:0,tokenId:act('material-take',{resource:'rat_tail'}).token.id});
 const before=structuredClone(w.player),save=w.save;w.save=()=>{throw Error('disk full');};
 assert.throws(()=>act('commit',{tier:2}),/disk full/);assert.deepEqual(w.player,before);w.save=save;act('commit',{tier:2});
 w.gather({id:'iron',resource:'iron',amount:2});w.gather({id:'tail',resource:'rat_tail',amount:1});const stocked=structuredClone(w.player);
 w.save=()=>{throw Error('disk full');};assert.throws(()=>act('module-craft',{kind:'quickwind'}),/disk full/);assert.deepEqual(w.player,stocked);
});
test('every carried ingredient has an explicit use and socket replacement persists both modules',t=>{
 const {w,dir,act}=fixture(t);w.player.tier=3;w.player.workshop.donations={tier:4,option:0};
 for(const [resource,amount] of Object.entries({apple:4,spore:2}))w.gather({id:resource,resource,amount});
 const first=act('module-craft',{kind:'verdant'}).module,second=act('module-craft',{kind:'verdant'}).module;
 act('module-install',{moduleId:first.id,itemId:'woodland_axe'});
 assert.throws(()=>act('module-install',{moduleId:first.id,itemId:'quarry_pick'}),/already installed/);
 act('module-install',{moduleId:second.id,itemId:'woodland_axe'});
 const saved=new World(dir).progression().workshop;assert.equal(saved.modules.length,2);assert.equal(saved.sockets.woodland_axe,second.id);
 assert.equal(saved.materials.length,10);for(const material of saved.materials)assert.ok(material.use.length>5);
 assert.throws(()=>act('module-remove',{itemId:'toString'}),/no installed module/);
});
