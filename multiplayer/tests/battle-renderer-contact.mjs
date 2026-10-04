import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import * as THREE from 'three';
import {createInventionView} from '../client/invention-view.js';
import {createSimulation,loadSimulation} from '../shared/simulation.js';

const started=performance.now();
// Exercise the actual renderer contact functions and commissioned base geometry,
// rather than constructing a hand-written contact with already-correct coordinates.
const source=readFileSync(new URL('../client/game.js',import.meta.url),'utf8');
const functions=source.slice(source.indexOf('  function surfaceVisible('),source.indexOf('  let lastPhysicalTip='));
assert.ok(functions.includes('function worldContact('));
const makeContact=new Function('THREE','content','inventionVisual','shrine','startingWorld','terrainRay','snapshot',
  `let worldTargets=[],worldMatricesAt=-1,contactFrame=1;${functions};return worldContact;`);
for(const targetSide of ['party','rivals']){
  const sim=createSimulation();sim.addPlayer({id:'shooter'});
  sim.command('shooter',{type:'battle',action:'start',seq:1});
  const world=sim.adventureWorld(),base=world.battle.bases.find(b=>b.side===targetSide),player=world.players[0];
  player.side=targetSide==='party'?'rivals':'party';
  const [x,y,z]=base.position;
  player.position=[x,y,z+3];player.yaw=0;
  const scene=new THREE.Scene(),view=createInventionView({scene});view.sync(sim.snapshot());view.update(0,world.tick);
  const contact=makeContact(THREE,{targets:()=>[],resolveTarget:()=>null},view,new THREE.Group(),{group:new THREE.Group()},{segment:()=>null},sim.snapshot());
  const hit=contact([x,y+1.4,z+3],[x,y+1.4,z-1]);
  assert.equal(hit?.targetId,base.id,'authored sanctuary must actually intercept the ray');
  assert.ok(hit.localPoint.every(v=>Math.abs(v)<8));
  assert.deepEqual(hit.localPoint,hit.point.map((v,i)=>v-base.position[i]));
  assert.equal(sim.command('shooter',{type:'action',action:'equip',tool:'crossbow',seq:2}).ok,true);
  assert.equal(sim.command('shooter',{type:'action',action:'fire',seq:3,origin:[x,y+1.4,z+3],direction:[0,0,-1]}).ok,true);
  for(let n=0;n<6;n++)sim.step();
  const shot=world.projectiles[0];assert.ok(shot);
  assert.equal(sim.projectileContact({...hit,projectileId:shot.id}).ok,true,'real renderer contact must pass authority validation');
  assert.equal(base.hp,352);assert.equal(world.projectiles.length,0);loadSimulation(sim.checkpoint());
  // Ordinary ground contacts retain their established world-space convention.
  const groundHit=makeContact(THREE,{targets:()=>[]},{targets:()=>[]},new THREE.Group(),{group:new THREE.Group()},
    {segment:()=>({point:[x,y,z],normal:[0,1,0],distance:1})},sim.snapshot())([x,y+1,z],[x,y-1,z]);
  assert.equal(groundHit.targetId,'world');assert.deepEqual(groundHit.localPoint,[x,y,z]);
  view.dispose();
}
console.log(`PASS: authored base contacts at both ±40 m pass projectile authority; ground convention preserved (${((performance.now()-started)/1000).toFixed(3)} s)`);
