import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {createEnemy} from '../shared/combat.js';
import {STRUCTURES} from '../shared/inventions.js';
import {STORMREEL,terminalPoint,wornTower} from '../shared/stormreel.js';

// Fixture: a hero beside a Stormspire at (8, 20) with optional skeletons `ahead` metres along -Z of the hero (a clear line).
function fixture({charge=240,gems=3,foes=[],heroAt=[10,24]}={}) {
  const sim=createSimulation();sim.addPlayer({id:'h',name:'Mitch'});
  const c=sim.checkpoint(),p=c.players[0];p.position=[heroAt[0],terrainHeight(c,...heroAt),heroAt[1]];p.yaw=0;p.tool='axe';p.resources.gems=gems;
  c.inventions.structures.push({id:'spire1',type:'stormspire',position:[8,terrainHeight(c,8,20),20],yaw:0,hp:240,maxHp:240,side:'party',builtTick:0,readyTick:0,fireTick:-1000,open:false,charge,armed:false,aimYaw:0});
  c.enemies=foes.map((f,i)=>{const [dx,dz,dy=0]=Array.isArray(f)?f:[0,-f];const x=heroAt[0]+dx,z=heroAt[1]+dz;return createEnemy(`foe${i}`,[x,terrainHeight(c,x,z)+dy,z]);});
  return loadSimulation(c);
}
const hero=s=>s.checkpoint().players[0],tower=s=>s.checkpoint().inventions.structures.find(b=>b.id==='spire1');
let seq=1;const act=(s,m)=>s.command('h',{type:'action',seq:seq++,...m});
const run=(s,n)=>{for(let i=0;i<n;i++)s.step();};
const aimAt=(s,target)=>{const p=hero(s),o=[p.position[0],p.position[1]+1.5,p.position[2]],d=target.map((v,i)=>v-o[i]),n=Math.hypot(...d);return {origin:o,direction:d.map(v=>v/n)};};

// Feeding Crystal charges four full shots each, up to twelve; it costs one Crystal from the hero.
let s=fixture({charge:0});
let r=act(s,{action:'inventionUse',structureId:'spire1',feed:true});
assert.equal(r.ok,true,r.code);assert.equal(tower(s).charge,STORMREEL.crystalCharge);assert.equal(hero(s).resources.gems,2);
assert.ok(r.events.some(e=>e.kind==='storm_charge'&&e.crystal));
act(s,{action:'inventionUse',structureId:'spire1',feed:true});act(s,{action:'inventionUse',structureId:'spire1',feed:true});
assert.equal(tower(s).charge,240);assert.equal(act(s,{action:'inventionUse',structureId:'spire1',feed:true}).code,'not_needed');

// The Stormreel only comes off the hook; E takes the pack and equips it, and the pack can't be equipped from the hotbar.
s=fixture({charge:100,gems:2});
assert.equal(act(s,{action:'equip',tool:'stormreel'}).code,'no_pack');
r=act(s,{action:'inventionUse',structureId:'spire1'});
assert.equal(r.ok,true,r.code);assert.equal(hero(s).tool,'stormreel');assert.equal(tower(s).operator,'h');
assert.ok(r.events.some(e=>e.kind==='storm_pack_take'));
assert.equal(tower(s).charge,180,'taking the pack drops in one Crystal when a whole one fits');assert.equal(hero(s).resources.gems,1);

// The cable is the range limit: walking away stops at 30 m flat from the terminal.
for(let i=0;i<60*12;i++){s.command('h',{type:'input',seq:seq++,move:{x:-1,z:0},yaw:0});s.step();}
const t=terminalPoint(tower(s)),d=Math.hypot(hero(s).position[0]-t[0],hero(s).position[2]-t[2]);
assert.ok(d<=STORMREEL.cable+1e-6&&d>STORMREEL.cable-.5,`held at the end of the cable (was ${d.toFixed(2)} m)`);

// Switching to another weapon sends the pack home.
r=act(s,{action:'equip',tool:'pick'});
assert.equal(r.ok,true);assert.equal(hero(s).tool,'pick');assert.equal(tower(s).operator,null);assert.ok(r.events.some(e=>e.kind==='storm_pack_home'));

// A full-charge shot at a grounded skeleton: bolt + shock, and the neighbour standing beside it is jolted through the soil.
s=fixture({foes:[8,[1.2,-8]]});
act(s,{action:'inventionUse',structureId:'spire1'});
let c=s.checkpoint(),foe=c.enemies[0],aim=aimAt(s,[foe.position[0],foe.position[1]+1.1,foe.position[2]]);
r=act(s,{action:'storm',...aim,charge:1});
assert.equal(r.ok,true,r.code);
const bolt=r.events.find(e=>e.kind==='storm_bolt');
assert.equal(bolt.targetId,'foe0');assert.equal(bolt.live,true);assert.equal(bolt.grounded,true);assert.deepEqual(bolt.splash,['foe1']);
assert.ok(!s.checkpoint().enemies.some(e=>e.id==='foe0'),'a full shock fells a skeleton');
assert.ok(s.checkpoint().enemies.find(e=>e.id==='foe1').hp<100,'step voltage hurts the neighbour');
assert.equal(tower(s).charge,240-STORMREEL.shotCost,'one full shot of charge spent');
assert.equal(act(s,{action:'storm',...aim,charge:1}).code,'cooldown');

// Walls stop the bolt: a storehouse between the hero and the skeleton takes the hit, and the current runs down into the soil.
s=fixture({foes:[10]});
{const k=s.checkpoint();k.inventions.structures.push({id:'shed',type:'storehouse',position:[10,terrainHeight(k,10,19),19],yaw:0,hp:STRUCTURES.storehouse.hp,maxHp:STRUCTURES.storehouse.hp,side:'party',builtTick:0,readyTick:0,fireTick:-1000,open:false,charge:0,armed:false,aimYaw:0});s=loadSimulation(k);}
act(s,{action:'inventionUse',structureId:'spire1'});
c=s.checkpoint();foe=c.enemies[0];aim=aimAt(s,[foe.position[0],foe.position[1]+1.1,foe.position[2]]);
r=act(s,{action:'storm',...aim,charge:1});
assert.equal(r.events.find(e=>e.kind==='storm_bolt').blockedId,'shed');assert.equal(s.checkpoint().enemies[0].hp,100,'the skeleton behind the wall is untouched');

// A target off the ground has no path to earth: no shock, only the bolt and static.
s=fixture({foes:[[0,-8,4]]});
act(s,{action:'inventionUse',structureId:'spire1'});
c=s.checkpoint();foe=c.enemies[0];aim=aimAt(s,[foe.position[0],foe.position[1]+1.1,foe.position[2]]);
r=act(s,{action:'storm',...aim,charge:1});
assert.equal(r.events.find(e=>e.kind==='storm_bolt').grounded,false);
assert.ok(s.checkpoint().enemies[0].hp>40,'airborne foe survives the static');

// An empty tower still throws the bolt, without lightning.
s=fixture({charge:0,gems:0,foes:[8]});
act(s,{action:'inventionUse',structureId:'spire1'});
c=s.checkpoint();foe=c.enemies[0];aim=aimAt(s,[foe.position[0],foe.position[1]+1.1,foe.position[2]]);
r=act(s,{action:'storm',...aim,charge:1});
assert.equal(r.events.find(e=>e.kind==='storm_bolt').live,false);
assert.ok(s.checkpoint().enemies[0].hp>=60,'bolt only');

// A God's lightning bolt on the tower fills it rather than damaging it.
{
  const sim=createSimulation();sim.addPlayer({id:'g',name:'God',role:'god'});
  const k=sim.checkpoint();k.players[0].role='god';k.players[0].mana=100;
  k.inventions.structures.push({id:'spire1',type:'stormspire',position:[20,terrainHeight(k,20,20),20],yaw:0,hp:240,maxHp:240,side:'party',builtTick:0,readyTick:0,fireTick:-1000,open:false,charge:0,armed:false,aimYaw:0});
  const g=loadSimulation(k);const res=g.command('g',{type:'cast',seq:1,spell:'lightning',point:[20,terrainHeight(k,20,20),20]});
  assert.equal(res.ok,true,res.code);
  const b=g.checkpoint().inventions.structures.find(b=>b.id==='spire1');
  assert.equal(b.charge,240);assert.equal(b.hp,240);
}

// Saves round-trip a worn pack.
s=fixture();act(s,{action:'inventionUse',structureId:'spire1'});
const saved=loadSimulation(JSON.parse(JSON.stringify(s.checkpoint())));
assert.equal(wornTower(saved.checkpoint(),saved.checkpoint().players[0])?.id,'spire1');
console.log('stormreel: ok');
