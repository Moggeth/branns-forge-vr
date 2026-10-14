// Keep siege damage: plain bolts and arrows only chip keep stonework, a golden bolt bites for full, and every hit
// reads in the world (chips, sparks, cracks at two-thirds and one-third health, a health bar over the struck part).
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createSimulation} from '../shared/simulation.js';
import {SIEGEBIRD,KEEP_STONE} from '../shared/combat.js';
import {createHomeBaseView} from '../client/home-base-view.js';
let count=0;
function test(name,fn){fn();count++;console.log('PASS',name);}

function shoot(golden){
 const sim=createSimulation({seed:9});sim.addPlayer({id:'host'});const w=sim.adventureWorld(),p=w.players[0];
 const pylon=w.battle.bases[1].parts.find(q=>q.kind==='pylon');p.side='party';p.siegebird={n:0,golden,hits:0};
 p.position=[pylon.position[0],pylon.position[1],pylon.position[2]+3];p.yaw=0;
 assert.equal(sim.command('host',{type:'action',action:'equip',tool:'crossbow',seq:2}).ok,true);
 assert.equal(sim.command('host',{type:'action',action:'fire',seq:3,origin:[p.position[0],p.position[1]+1.5,p.position[2]],direction:[0,0,-1]}).ok,true);
 sim.step();sim.step();const shot=w.projectiles[0],point=[...shot.position];
 const r=sim.projectileContact({projectileId:shot.id,targetId:pylon.id,part:'torso',point,normal:[0,0,1],localPoint:[0,1,0],localQuaternion:[0,0,0,1]});
 assert.equal(r.ok,true,r.code);return {pylon,hit:r.events.find(e=>e.kind==='home_part_hit'),point};
}

test('a plain Siegebird bolt only chips a keep pylon',()=>{
 const {pylon,hit,point}=shoot(false);assert.equal(pylon.maxHp-pylon.hp,SIEGEBIRD.damage*KEEP_STONE.plainShot);
 assert.equal(hit.blow,'chip');assert.deepEqual(hit.at,point.map(v=>Math.round(v*100)/100));
});
test('a golden bolt bites for full magic damage',()=>{
 const {pylon,hit}=shoot(true);assert.equal(pylon.maxHp-pylon.hp,SIEGEBIRD.damage*SIEGEBIRD.goldenMultiplier);assert.equal(hit.blow,'magic');
});

test('hits throw chips and sparks, crack the pylon as it weakens and show a draining health bar',()=>{
 const sim=createSimulation({seed:9});sim.addPlayer({id:'host'});const s=sim.snapshot();
 const scene=new THREE.Scene(),view=createHomeBaseView({scene}),camera=new THREE.PerspectiveCamera();
 view.sync(s);const base=s.battle.bases[1],pylon=base.parts.find(q=>q.kind==='pylon');camera.position.set(pylon.position[0],pylon.position[1]+2,pylon.position[2]+12);camera.lookAt(...pylon.position);
 const at=[pylon.position[0],pylon.position[1]+2,pylon.position[2]+.6];
 view.event({kind:'home_part_hit',id:pylon.id,part:'pylon',side:'rivals',hp:pylon.hp,position:[...pylon.position],at,blow:'chip'});
 view.update(1/60,camera,s.tick);let st=view.damageStats();assert.ok(st.chips>0&&st.sparks>0);assert.equal(st.bars,1);assert.equal(st.cracked,0,'no cracks while healthy');
 pylon.hp=Math.round(pylon.maxHp*.6);view.event({kind:'home_part_hit',id:pylon.id,part:'pylon',side:'rivals',hp:pylon.hp,position:[...pylon.position],blow:'magic'});
 view.update(1/60,camera,s.tick);st=view.damageStats();assert.equal(st.cracked,1,'cracks open below two-thirds');
 view.event({kind:'home_part_hit',id:base.id,side:'rivals',hp:base.hp,position:[...base.position]});view.update(1/60,camera,s.tick);assert.equal(view.damageStats().bars,2,'heart hits get their own bar');
 for(let i=0;i<300;i++)view.update(1/60,camera,s.tick);st=view.damageStats();assert.equal(st.bars,0,'bars fade after a few seconds');
 pylon.hp=pylon.maxHp;view.update(1/60,camera,s.tick);assert.equal(view.damageStats().cracked,0,'a mended pylon loses its cracks');
 view.dispose();
});
console.log(`Siege damage: ${count} checks passed`);
