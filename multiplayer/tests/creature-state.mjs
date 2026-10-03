import assert from 'node:assert/strict';
import {applyEnemyScorch,createEnemy,hitEnemyPart,PARTS} from '../shared/combat.js';
import {fireContact,stepFire} from '../shared/fire.js';
import {createSimulation,loadSimulation} from '../shared/simulation.js';

const started=performance.now();
const enemy=createEnemy('bone1',[0,0,0]);
assert.equal(enemy.scorch,undefined,'unburned enemies carry no six-bone payload');
assert.equal(applyEnemyScorch(enemy,'leftArm',.12),true);
assert.equal(applyEnemyScorch(enemy,'leftArm',.2),true);
assert.equal(enemy.scorch.leftArm,.32);
assert.equal(enemy.scorch.rightArm,0);
applyEnemyScorch(enemy,'leftArm',2);
assert.equal(enemy.scorch.leftArm,1,'exposure is bounded');
assert.equal(applyEnemyScorch(enemy,'unknown',.5),false);

const sim=createSimulation();sim.addPlayer({id:'h'});
const saved=sim.checkpoint();saved.enemies.push(enemy);
const replay=loadSimulation(saved);
assert.deepEqual(replay.snapshot().enemies[0].scorch,enemy.scorch,'per-bone scorch survives save/load');
for(const bad of [NaN,-.01,1.01]){
  const malformed=structuredClone(saved);malformed.enemies[0].scorch.leftArm=bad;
  assert.throws(()=>loadSimulation(malformed),'invalid scorch cannot enter imported saves');
}

const direct=createEnemy('fire1',[0,0,0]),fireState={enemies:[direct],fireCells:[],fireSurfaces:[],players:[],tick:0,shrine:{hp:0}};
let fireDamage=0;
const fireCtx={terrainHeight:()=>0,damageEnemy:(_state,_enemy,amount)=>{fireDamage+=amount;}};
fireContact(fireState,{kind:'flame'}, {point:[0,1,0],normal:[0,1,0],targetId:'fire1',part:'rightLeg'},fireCtx);
assert.equal(fireDamage,4);
assert.ok(direct.scorch.rightLeg>0&&direct.scorch.leftLeg===0,'direct fire blackens the contacted bone first');
fireState.tick=30;fireState.fireCells.push({x:0,z:0,fuel:1,heat:1,burning:true,wetUntil:0,expiresTick:1800});
stepFire(fireState,fireCtx,[]);
assert.ok(direct.scorch.leftLeg>0&&direct.scorch.torso>0,'ground fire climbs from both legs toward torso');

const fallen=createEnemy('fall1',[0,0,0]);
const state={enemies:[fallen],detachedParts:[],embeds:[],players:[],tick:45};
let next=0;const events=[];
assert.equal(hitEnemyPart(state,fallen,'head',38,{point:[0,1.7,0],normal:[0,0,1],energy:1.4},{nextId:()=>`d${++next}`},events,{projectile:true}),true);
assert.equal(state.enemies.length,0);assert.equal(state.detachedParts.length,PARTS.length);
assert.ok(state.detachedParts.every(part=>part.velocity[2]<0),'the killing blow carries every bone in its direction');
assert.ok(new Set(state.detachedParts.map(part=>part.velocity.join(','))).size>3,'bones receive varied collapse momentum');
assert.ok(events.some(event=>event.kind==='death'&&event.id==='fall1'&&event.part==='head'));
console.log(`creature-state: scorch persistence, fire locality and varied death momentum pass (${((performance.now()-started)/1000).toFixed(3)}s)`);
