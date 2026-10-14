import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createSimulation,terrainHeight} from '../shared/simulation.js';
import {createEnemy} from '../shared/combat.js';
import {createHurtFeedback,HURT_TUNING} from '../client/hurt-feedback.js';
let passed=0;const test=(name,fn)=>{fn();passed++;console.log('PASS',name);};

test('a Hero hit event carries the damage taken and where the blow came from',()=>{
  const sim=createSimulation({seed:3});sim.addPlayer({id:'h',role:'hero'});const w=sim.adventureWorld(),p=w.players[0];
  p.position=[30,terrainHeight(w,30,0),0];w.enemies=[createEnemy('foe',[30,terrainHeight(w,30,1.6),1.6])];
  const ev=[];for(let i=0;i<20;i++)ev.push(...sim.step());
  const hit=ev.find(e=>e.kind==='hit'&&e.id==='h');
  assert.ok(hit,'the skeleton lands a blow');
  assert.equal(hit.hero,true);assert.equal(hit.damage,10);
  assert.deepEqual(hit.from.map(v=>+v.toFixed(3)),w.enemies[0].position.map(v=>+v.toFixed(3)));
});

function rig(hp=80){
  const camera=new THREE.PerspectiveCamera(70,16/9,.05,100);camera.rotation.order='YXZ';
  const me={id:'h',role:'hero',hp,maxHp:100},pulses=[];
  const fx=createHurtFeedback({camera,self:()=>me,haptic:(steps,hand)=>pulses.push(hand)});
  return {camera,me,fx,pulses,view:{position:new THREE.Vector3(0,1.6,0),yaw:0}};
}
test('a blow from the left blooms on the left edge; from behind on the bottom edge',()=>{
  const r=rig();
  r.fx.hurt({kind:'hit',hero:true,id:'h',damage:10,from:[-3,1,0]},r.view);r.fx.update(1/60);
  let b=r.fx.stats().blooms;assert.equal(b.length,1);assert.ok(b[0].x<-.99,'left');
  r.fx.hurt({kind:'hit',hero:true,id:'h',damage:10,from:[0,1,4]},r.view);r.fx.update(1/60);
  b=r.fx.stats().blooms;assert.equal(b.length,2);assert.ok(b.some(s=>s.y<-.99),'behind = bottom');
  assert.equal(r.fx.stats().visible,true);
});
test('repeated blows from one side build one bloom; everything fades back to nothing',()=>{
  const r=rig();
  for(let i=0;i<5;i++){r.fx.hurt({kind:'hit',hero:true,id:'h',damage:6,from:[3,1,-.2]},r.view);r.camera.rotation.set(0,0,0);r.fx.update(.05);}
  assert.equal(r.fx.stats().blooms.length,1);
  for(let i=0;i<120;i++){r.camera.rotation.set(0,0,0);r.fx.update(1/30);} // game.js re-poses the camera every frame
  assert.equal(r.fx.stats().blooms.length,0);assert.equal(r.fx.stats().visible,false);
  assert.ok(Math.abs(r.camera.rotation.x)<1e-3,'nudge springs home');
});
test('the view nudge is a spring, not a shake, and the low-health glow follows health',()=>{
  const r=rig(25);
  r.fx.hurt({kind:'hit',hero:true,id:'h',damage:20,from:[0,1,-3]},r.view);
  let peak=0,flips=0,last=0;for(let i=0;i<60;i++){r.camera.rotation.set(0,0,0);r.fx.update(1/60);const x=r.camera.rotation.x;peak=Math.max(peak,Math.abs(x));if(Math.sign(x)!==Math.sign(last)&&Math.abs(x)>1e-4&&Math.abs(last)>1e-4)flips++;last=x;}
  assert.ok(peak>.002&&peak<.05,`gentle nudge (${peak})`);assert.ok(flips<=1,'no oscillating shake');
  assert.ok(r.fx.stats().low>.3,'below 30% health glows');
  r.me.hp=90;for(let i=0;i<200;i++)r.fx.update(1/30);
  assert.ok(r.fx.stats().low<.02,'healed: glow fades');assert.equal(r.fx.stats().visible,false);
  assert.ok(HURT_TUNING.low===.3);
});
test('fire and sourceless hurts glow all round; haptics pick the struck hand in VR',()=>{
  const r=rig();r.fx.hurt({kind:'hit',hero:true,id:'h',damage:2,fire:true},r.view);r.fx.update(1/60);
  assert.ok(r.fx.stats().glow>.2);assert.equal(r.fx.stats().blooms.length,0);
  const camera=new THREE.PerspectiveCamera(),me={hp:50,maxHp:100},hands=[];
  const vr=createHurtFeedback({camera,presenting:()=>true,self:()=>me,haptic:(steps,hand)=>hands.push([hand,steps[0].amplitude])});
  vr.hurt({kind:'hit',hero:true,id:'h',damage:20,from:[4,1,0]},{position:new THREE.Vector3(),yaw:0});vr.update(1/60);
  assert.equal(hands[0][0],'right');assert.ok(hands[0][1]>hands[1][1],'struck side rumbles harder');
  assert.equal(camera.rotation.x,0,'no camera motion in VR');
});
test('the bloom and crescent keep pointing at the blow as you turn toward it',()=>{
  const camera=new THREE.PerspectiveCamera(),me={hp:80,maxHp:100},eye={position:new THREE.Vector3(),yaw:0};
  const fx=createHurtFeedback({camera,self:()=>me,view:()=>eye});
  fx.hurt({kind:'hit',hero:true,id:'h',damage:10,from:[-3,1,0]},eye);fx.update(1/60);
  let b=fx.stats().blooms[0];assert.ok(b.x<-.99&&b.arc>.5,'left, with a crescent');
  eye.yaw=Math.PI/2;for(let i=0;i<10;i++)fx.update(1/60);   // turned left to face it
  b=fx.stats().blooms[0];assert.ok(b.y>.95,`now ahead (${b.x.toFixed(2)},${b.y.toFixed(2)})`);
});
test('healing breathes a gold-green glow that fades; a respawn does not count as a heal',()=>{
  const camera=new THREE.PerspectiveCamera(),me={hp:50,maxHp:100},fx=createHurtFeedback({camera,self:()=>me});
  fx.update(1/60);me.hp=70;fx.update(1/60);assert.ok(fx.stats().heal>.4);
  for(let i=0;i<120;i++)fx.update(1/30);assert.equal(fx.stats().heal,0);assert.equal(fx.stats().visible,false);
  me.hp=10;fx.update(1/60);me.hp=100;fx.update(1/60);assert.equal(fx.stats().heal,0,'respawn');
});
console.log(`hurt-feedback: ${passed} passed`);
