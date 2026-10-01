'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {World}=require('./world');
const ledger=require('./workshop-ledger');

test('planet positions and workshop tokens accept 6 km coordinates but reject invalid points',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'brann-planet-coordinate-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const world=new World(directory);
 const planet={x:6000,y:85,z:0};
 assert.deepEqual(world.updateContext({zone:'orchard_planet',position:planet,targets:[{...planet,id:'planet-rat',type:'rat',alive:true}]}),{ok:true});
 world.gather({id:'planet-lumber',resource:'lumber',amount:1});
 const token=ledger.act(world,'material-take',{resource:'lumber',requestId:'planet-take'}).token;
 assert.equal(ledger.act(world,'material-place',{tokenId:token.id,zone:'orchard_planet',position:planet,requestId:'planet-place'}).token.position.x,6000);
 for(const coordinate of [NaN,10001,-10001]){
  assert.throws(()=>world.updateContext({zone:'orchard_planet',position:{...planet,x:coordinate}}),/Invalid position/);
  assert.throws(()=>ledger.act(world,'material-place',{tokenId:token.id,zone:'orchard_planet',position:{...planet,x:coordinate},requestId:'planet-invalid-'+String(coordinate)}),/Invalid token position/);
 }
});
