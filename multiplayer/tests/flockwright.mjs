// The Armoury and its Flockwright (2026-10-18): a Hero takes the crew crossbow down from the stand, it equips only
// once taken, fires heavy bolts on its own cycle, hits harder than the Siegebird, and the ownership saves.
import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {ARMOURY,armouryPiece,pieceWorld,TOWN_SOLIDS} from '../shared/home-bases.js';
import {ARMOURY_RULES,armouryStand,hasFlockwright} from '../shared/armoury.js';
import {FLOCKWRIGHT,SIEGEBIRD,createEnemy,partPosition,TOOLS} from '../shared/combat.js';
import {WEAPONS} from '../shared/spells.js';
let count=0;
function test(name,fn){fn();count++;console.log('PASS',name);}
let seq=0;const act=(sim,id,action,extra={})=>sim.command(id,{type:'action',action,seq:++seq,...extra});
const put=(w,p,[x,z])=>{p.position=[x,terrainHeight(w,x,z),z];p.vy=0;};
function rig(){
  const sim=createSimulation({seed:9});sim.addPlayer({id:'host'});sim.addPlayer({id:'foe'});const w=sim.adventureWorld();
  const [hero,foe]=w.players;hero.role=foe.role='hero';hero.side='party';foe.side='rivals';
  put(w,hero,[0,0]);put(w,foe,[0,30]);
  return {sim,w,hero,foe};
}

test('the Armoury stands off Dawnhold, its stand inside the hall',()=>{
  assert.ok(Math.hypot(ARMOURY.at[0]+34,ARMOURY.at[1]+34)<34,'near Dawnhold');
  const [x,z]=armouryStand(),[cx,cz]=pieceWorld(armouryPiece(),[0,0]);
  assert.ok(Math.hypot(x-cx,z-cz)<1,'stand near the middle of the hall');
  assert.ok(TOOLS.includes('flockwright')&&WEAPONS.some(w=>w.id==='flockwright'));
  assert.ok(TOWN_SOLIDS.armoury.length>=3);
});

test('a Hero must walk up to the stand; either side may take one, and it equips only once taken',()=>{
  const {sim,w,hero,foe}=rig();
  assert.equal(sim.command('host',{type:'action',action:'equip',tool:'flockwright',seq:++seq}).code,'no_flockwright');
  assert.equal(act(sim,'host','armouryTake').code,'too_far');
  const [x,z]=armouryStand();put(w,hero,[x+ARMOURY_RULES.reach*.6,z]);
  const r=act(sim,'host','armouryTake');assert.equal(r.ok,true,r.code);
  assert.equal(r.events[0].kind,'armoury_take');assert.equal(r.events[0].first,true);assert.ok(hasFlockwright(hero));
  assert.equal(act(sim,'host','armouryTake').events[0].first,false,'taking again is harmless');
  assert.equal(sim.command('host',{type:'action',action:'equip',tool:'flockwright',seq:++seq}).ok,true);
  assert.equal(hero.tool,'flockwright');
  put(w,foe,[x,z+.5]);assert.equal(act(sim,'foe','armouryTake').ok,true,'the rival side may borrow one too');
  const back=loadSimulation(sim.checkpoint()).snapshot().players.find(p=>p.id==='host');
  assert.equal(back.flockwright,true,'ownership saves');
});

test('heavy bolts on their own cycle, harder than a Siegebird bolt',()=>{
  const {sim,w,hero}=rig();hero.flockwright=true;hero.tool='flockwright';hero.attackTick=-999;
  assert.ok(FLOCKWRIGHT.damage>SIEGEBIRD.damage&&FLOCKWRIGHT.acceptTicks<=FLOCKWRIGHT.cycleTicks);
  const origin=[hero.position[0],hero.position[1]+1.5,hero.position[2]];
  const r=act(sim,'host','fire',{origin,direction:[0,0,-1]});assert.equal(r.ok,true,r.code);
  assert.equal(r.events[0].weapon,'flockwright');const shot=w.projectiles.find(q=>q.id===r.events[0].id);
  assert.equal(shot.heavy,true);assert.equal(Math.round(Math.hypot(...shot.velocity)),FLOCKWRIGHT.speed);
  w.tick+=FLOCKWRIGHT.acceptTicks-1;assert.equal(act(sim,'host','fire',{origin,direction:[0,0,-1]}).code,'cooldown');
  w.tick+=1;assert.equal(act(sim,'host','fire',{origin,direction:[0,0,-1]}).ok,true);
});

// One bolt from each crossbow into the same golem's torso, reported the way a client reports a contact.
function boltDamage(tool){
  const sim0=createSimulation({legacyBattle:true});sim0.addPlayer({id:'h'});const c=sim0.checkpoint();
  c.enemies=[createEnemy('dummy',[0,terrainHeight(c,0,6),6],'golem')];c.players[0].flockwright=true;
  const sim=loadSimulation(c),p=sim.snapshot().players[0],e=sim.snapshot().enemies[0],at=partPosition(e,'torso');
  const origin=[p.position[0],at[1],p.position[2]],d=at.map((n,i)=>n-origin[i]),l=Math.hypot(...d);
  assert.equal(sim.command('h',{type:'action',seq:1,action:'equip',tool}).ok,true);
  assert.equal(sim.command('h',{type:'action',seq:2,action:'fire',origin,direction:d.map(n=>n/l)}).ok,true);
  for(let i=0;i<3;i++)sim.step();
  const shot=sim.snapshot().projectiles[0],before=e.hp;
  const r=sim.projectileContact({targetId:e.id,part:'torso',point:at,normal:[0,0,1],localPoint:[0,0,0],localQuaternion:[0,0,0,1],boneName:'torso',projectileId:shot.id});
  assert.equal(r.ok,true,r.code);
  return {dealt:before-(sim.snapshot().enemies.find(x=>x.id===e.id)?.hp??0),hits:sim.snapshot().players[0].siegebird?.hits??0};
}
test('a heavy bolt lands harder than a Siegebird bolt and does not feed the Siegebird',()=>{
  const heavy=boltDamage('flockwright'),light=boltDamage('crossbow');
  assert.ok(heavy.dealt>light.dealt*2,`${heavy.dealt} vs ${light.dealt}`);
  assert.equal(heavy.hits,0);
});

console.log(`flockwright: ${count} checks`);
