import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {prepareAsset} from '../client/asset-pose.js';
import {createCombatView} from '../client/combat-view.js';
import {createCreatureLifeDeath} from '../client/creature-life-death.js';
import {createPresentationClock} from '../client/presentation-clock.js';
import {createSpellTargeting,SPELL_SHAPES} from '../client/spell-targeting.js';
import {createSpellPresentation} from '../client/spell-presentation.js';

const started=performance.now(),data=await readFile(new URL('../public/assets/golem.glb',import.meta.url));
const loader=new GLTFLoader();loader.register(()=>({name:'NoImages',loadTexture:()=>Promise.resolve(null)}));
const template=await loader.parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'');
function actor(){
 const {visual}=prepareAsset(template,'golem'),root=new T.Group();root.add(visual);
 return {enemy:true,visual,root,data:{id:'smooth-golem',kind:'golem',emergeTick:100,hp:320,armor:3,parts:{},missingParts:[],attackTick:-1000}};
}
// Real authored component trajectories are independent of render frequency.
const paths=[];
for(const hz of [60,72,90,120,144,240]){
 const scene=new T.Scene(),e=actor();scene.add(e.root);
 const fx=createCreatureLifeDeath({scene,height:()=>0}),clock=createPresentationClock();clock.observe(100,0);
 const samples=[],node=e.visual.getObjectByName('BodyCore');
 let packet=0,lastPosition=null,movingFrames=0,repeatedSnapshotMotion=0,previousTick=-1;
 for(let i=0;i<=hz*4;i++){
  const now=i/hz*1000,packetNow=Math.floor(now/50+1e-8);
  if(packetNow!==packet){packet=packetNow;clock.observe(100+packet*3,packet*50);}
  const tick=clock.sample(now);fx.beginFrame();fx.sync(e,tick,1/hz);fx.tick(1/hz);
  const position=node.getWorldPosition(new T.Vector3());
  if(i/hz>.85&&i/hz<1.35&&lastPosition&&position.distanceTo(lastPosition)>1e-6){movingFrames++;if(previousTick===100+packet*3)repeatedSnapshotMotion++;}
  if(i>0&&i%(hz/2)===0)samples.push(position.toArray());
  lastPosition=position.clone();previousTick=100+packet*3;
 }
 assert.ok(movingFrames>hz*.40,hz+' updates assembly every display frame');
 assert.ok(repeatedSnapshotMotion>0,hz+' poses advance between packets');
 if(paths.length)for(let k=0;k<samples.length;k++)for(let j=0;j<3;j++)assert.ok(Math.abs(samples[k][j]-paths[0][k][j])<1e-5,hz+' same elapsed-time pose');
 paths.push(samples);fx.dispose();
}
// Packet jitter never rewinds; stalled network caps extrapolation; restore resets.
{
 const clock=createPresentationClock();clock.observe(100,0);let last=100;
 for(let i=1;i<=180;i++){const now=i*1000/144;if(i%8===0)clock.observe(100+Math.floor(now*.06/3)*3,now);const t=clock.sample(now);assert.ok(t>=last);last=t;}
 const at=clock.sample(3000);assert.equal(clock.sample(9000),at);
 clock.observe(0,10000);assert.equal(clock.sample(10000),0);
}
// Integration contract: combat must use the fractional pose time, not snapshot tick.
{
 const scene=new T.Scene(),e=actor(),actors=new Map([['e:smooth-golem',e]]);scene.add(e.root);
 const combat=createCombatView({scene,templates:new Map(),actors});
 combat.sync({tick:130,enemies:[e.data],projectiles:[],embeds:[],detachedParts:[]});
 combat.beginCreatureFrame();combat.tick(1/144,false,1,130.375);
 assert.equal(combat.creatureStats().presentationTick,130.375);combat.dispose();
}
// Every spatial marker recedes on successful casts, remains quiet over the
// effect, and returns for a new aim. Invalid/rejected previews still show.
for(const spell of Object.keys(SPELL_SHAPES)){
 for(const reducedMotion of [false,true]){
  const scene=new T.Scene(),fx=createSpellTargeting({scene,height:()=>0,reducedMotion});
  const target={spell,point:[2,0,3],start:[-1,0,3],end:[2,0,3],valid:true};
  fx.setTarget(target);for(let i=0;i<20;i++)fx.update(i*10,.01);
  assert.ok(fx.stats().visible);
  fx.commit(target);
  for(let i=0;i<15;i++){fx.setTarget({...target,valid:false});fx.update(200+i*10,.01);}
  assert.equal(fx.stats().visible,false,spell+' recedes within 150ms');
  for(let i=0;i<100;i++){fx.setTarget(target);fx.update(400+i*10,.01);}
  assert.equal(fx.stats().visible,false,spell+' stays out of the effect');
  fx.setTarget({...target,point:[3,0,3],end:[3,0,3]});fx.update(1500,.1);
  assert.ok(fx.stats().visible,spell+' re-arms when aiming elsewhere');
  fx.setTarget({...target,point:[4,0,3],valid:false});fx.update(1600,.1);
  assert.ok(fx.stats().visible,spell+' rejected cast leaves preview informative');
  fx.dispose();
 }
}
// Golem spell presentation contains no duplicate body, block proxies or rings.
{
 const scene=new T.Scene(),fx=createSpellPresentation({scene,height:()=>0});
 assert.equal(fx.play({spell:'golem',id:'golem-clean',position:[0,0,0]}),true);
 for(let i=0;i<400;i++){
  fx.update(i*1000/144,1/144);
  scene.traverseVisible(n=>assert.ok(!n.isMesh||n.isInstancedMesh||n.geometry?.type!=='BoxGeometry','no visible placeholder box'));
 }
 assert.equal(fx.stats().events,0);assert.equal(fx.stats().particles.total,0);fx.dispose();
}
console.log(JSON.stringify({passed:true,refreshRates:[60,72,90,120,144,240],snapshotHz:20,markerCases:28,seconds:(performance.now()-started)/1000}));
