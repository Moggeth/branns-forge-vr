import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import * as THREE from 'three';
import {createSimulation,terrainHeight} from '../shared/simulation.js';
import {classifyReward,rewardBanner,createRewardMoments,REWARD_CAPS} from '../client/reward-moments.js';

// Reward moments: run with node tests/reward-moments.mjs.
const results=[];
function check(name,fn){const start=performance.now();try{fn();results.push({name,ok:true,seconds:(performance.now()-start)/1000});}catch(error){results.push({name,ok:false,seconds:(performance.now()-start)/1000,error:error.stack});}}
const at=[10,1,10],me={playerId:'me',side:'party',position:[10,1,11]},far={...me,position:[60,1,60]};

check('every silent win and craft event earns a moment; unrelated events do not',()=>{
  for(const kind of ['invention_victory','forge_reward','meteor_reward','geology_emerge','seam_survey','salvage','pickup','refinery_output','invention_build','defender_recruit','invention_deposit','camp_return'])
    assert.ok(classifyReward({kind,position:at},me),kind);
  for(const kind of ['hit','tree_fell','spell','respawn'])assert.equal(classifyReward({kind,position:at},me),null,kind);
  assert.equal(classifyReward({kind:'pickup'},me),null,'needs a position');
});

check('raid victory is grand for the winners and ominous for their rivals',()=>{
  const ours=classifyReward({kind:'invention_victory',side:'party',position:at},me),theirs=classifyReward({kind:'invention_victory',side:'rivals',position:at},me);
  assert.equal(ours.tier,2);assert.equal(ours.chime,'victory');assert.ok(ours.pillar&&ours.ring);assert.equal(ours.rumble.repeat,3);
  assert.equal(theirs.chime,'warning');assert.equal(theirs.rumble,null);
});

check('rumble and homing loot are local: near pickups fly to you, far ones rise',()=>{
  const near=classifyReward({kind:'pickup',position:at,material:'iron'},me),away=classifyReward({kind:'pickup',position:at,material:'iron'},far);
  assert.equal(near.flyTo,'player');assert.ok(near.rumble);assert.equal(away.flyTo,'up');assert.equal(away.rumble,null);
  assert.ok(classifyReward({kind:'invention_build',by:'me',position:at},far).rumble,'your own build always rumbles');
  assert.equal(classifyReward({kind:'invention_build',by:'other',position:at},far).rumble,null);
});

check('banner names the actual raid loot and only for the winning side',()=>{
  const e={kind:'invention_victory',side:'party',reward:{iron:4,wood:5,gems:2,starOre:1},position:at};
  assert.equal(rewardBanner(e,'party'),'Raid repelled! Your stores gain 4 iron, 5 wood, 2 crystal and 1 star ore.');
  assert.equal(rewardBanner(e,'rivals'),null);
  assert.equal(rewardBanner({kind:'pickup',position:at},'party'),null);
});

check('authority reports raid victory with side, loot and forge ground height',()=>{
  const sim=createSimulation();sim.addPlayer({id:'owner',role:'god'});const s=sim.adventureWorld(),p=s.players[0];p.position=[0,terrainHeight(s,0,0),0];
  assert.equal(sim.command(p.id,{type:'action',seq:p.seq+1,action:'inventionAssault'}).ok,true);
  const before={...s.inventions.stockpiles.party};
  s.enemies=s.enemies.filter(e=>!s.inventions.assault.foes.includes(e.id));
  let victory=null;for(let n=0;n<31&&!victory;n++)victory=sim.step().find(e=>e.kind==='invention_victory');
  assert.ok(victory,'victory event');assert.equal(victory.side,'party');assert.deepEqual(victory.reward,{iron:4,wood:5,gems:2,starOre:1});
  assert.ok(Math.abs(victory.position[1]-terrainHeight(s,0,0,false))<1e-6);
  assert.equal(s.inventions.stockpiles.party.iron,Math.min(999,before.iron+4));
  assert.ok(JSON.parse(JSON.stringify(victory)),'event stays wire-safe');
});

function stage(options={}){const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();camera.position.set(10,1.6,12);camera.updateMatrixWorld();
  return {scene,fx:createRewardMoments({scene,camera,context:()=>me,clock:()=>clockNow,schedule:(f)=>pending.push(f),...options})};}
let clockNow=0;const pending=[];

check('pooled effects stay within caps under a flood and fully retire',()=>{
  const {scene,fx}=stage();
  for(let n=0;n<20;n++)fx.handle({kind:'invention_victory',side:'party',position:at});
  const s=fx.stats();assert.equal(s.liveMotes,REWARD_CAPS.motes);assert.ok(s.motesDropped>0);assert.ok(s.liveRings<=REWARD_CAPS.rings);assert.ok(s.livePillars<=REWARD_CAPS.pillars);
  const drawables=[];scene.traverse(o=>{if(o.isMesh)drawables.push(o);});assert.equal(drawables.length,1+REWARD_CAPS.rings+REWARD_CAPS.pillars,'no per-event meshes');
  for(let n=0;n<200;n++)fx.update(1/30);
  const after=fx.stats();assert.equal(after.liveMotes+after.liveRings+after.livePillars,0);assert.equal(after.visible,false);
  fx.dispose();assert.equal(scene.children.length,0);
});

check('homing motes end at the viewer',()=>{
  const {scene,fx}=stage();fx.handle({kind:'pickup',material:'gems',position:[10,1,11.5]});
  const mesh=scene.getObjectByName('reward-moments').children[0],m=new THREE.Matrix4(),p=new THREE.Vector3();
  let last=null;for(let n=0;n<60;n++){fx.update(1/60);for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,m);p.setFromMatrixPosition(m);if(m.elements[0]!==0)last=p.clone();}}
  assert.ok(last&&last.distanceTo(new THREE.Vector3(10,1,11.55))<.6,`last mote at ${last?.toArray()}`);fx.dispose();
});

check('chimes respect throttles, the voice cap and release their nodes',()=>{
  const nodes=[];const node=()=>{const n={connect:(x)=>x||n,disconnect(){n.off=true;},start(){},stop(){},gain:{value:1,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},frequency:{value:0},pan:{value:0}};nodes.push(n);return n;};
  const ctx={currentTime:0,destination:{},createGain:node,createOscillator:node,createStereoPanner:node};
  const {fx}=stage({audio:()=>ctx});
  fx.handle({kind:'pickup',material:'wood',position:at});fx.handle({kind:'pickup',material:'wood',position:at});
  assert.equal(fx.stats().voices,1,'second pickup inside 70 ms is throttled');
  for(let n=0;n<30;n++){clockNow+=1000;fx.handle({kind:'invention_build',position:at});}
  assert.equal(fx.stats().voices,REWARD_CAPS.voices);
  while(pending.length)pending.shift()();
  assert.ok(nodes.filter(n=>n.off).length>0,'voice outputs disconnect');fx.dispose();
});

for(const r of results)console.log(`${r.ok?'PASS':'FAIL'} ${r.name} (${r.seconds.toFixed(3)}s)${r.error?'\n'+r.error:''}`);
console.log(JSON.stringify({tests:results.length,passed:results.filter(r=>r.ok).length,seconds:results.reduce((n,r)=>n+r.seconds,0)}));
if(results.some(r=>!r.ok))process.exitCode=1;
