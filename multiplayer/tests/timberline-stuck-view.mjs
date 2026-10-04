// Stuck Timberline pairs on the client: the buried bolt holds its anchor, the twin swings on the wire, settles on
// or above the ground within the wire's length, sleeps, and two peers rebuild the same rest pose.
// node tests/timberline-stuck-view.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createSimulation,terrainHeight} from '../shared/simulation.js';
import {worldTrees} from '../shared/world-content.js';
import {createTimberlineStuck,STUCK_TETHER} from '../client/timberline-stuck.js';
const t0=performance.now();
async function load(name){const b=readFileSync(new URL('../public/assets/'+name+'.glb',import.meta.url)),n=b.readUInt32LE(12),j=JSON.parse(b.subarray(20,20+n));delete j.images;delete j.textures;delete j.samplers;for(const m of j.materials){delete m.pbrMetallicRoughness?.baseColorTexture;delete m.pbrMetallicRoughness?.metallicRoughnessTexture;delete m.normalTexture;delete m.emissiveTexture;delete m.occlusionTexture;}let t=Buffer.from(JSON.stringify(j));t=Buffer.concat([t,Buffer.alloc((4-t.length%4)%4,32)]);const out=Buffer.alloc(20+t.length+b.length-20-n);b.copy(out,0,0,20);out.writeUInt32LE(out.length,8);out.writeUInt32LE(t.length,12);t.copy(out,20);b.copy(out,20+t.length,20+n);return new GLTFLoader().parseAsync(out.buffer,'');}
const gltf=await load('timberline_bolts');
const sim=createSimulation();sim.addPlayer({id:'gunner',role:'hero'});const s=sim.adventureWorld();s.enemies=[];s.deposits=[];s.pickups=[];s.landmarks=false;
s.harvestedTrees=worldTrees(s).map(t=>({id:t.id,cuts:3,cutHeight:0,felledTick:1,fallYaw:0,landed:true}));
const p=s.players[0];for(const k of Object.keys(p.resources))p.resources[k]=200;const at=(x,z)=>[x,terrainHeight(s,x,z,false),z];
const b={id:'building1',type:'timberline',position:at(0,-8),yaw:0,hp:200,maxHp:200,side:'party',builtTick:0,readyTick:0,fireTick:-1000,open:false,charge:0,armed:false,aimYaw:0};s.inventions.structures.push(b);s.inventions.seq=1;p.position=at(0,-6);
let seq=0;const act=(action,extra={})=>sim.command('gunner',{type:'action',seq:++seq,action,structureId:b.id,...extra});assert.equal(act('inventionMount').ok,true);
const wall={id:'store9',type:'storehouse',position:at(1,-20),yaw:0,hp:240,maxHp:240,side:'party',builtTick:0,readyTick:0,fireTick:-1000,open:false,charge:0,armed:false,aimYaw:0};s.inventions.structures.push(wall);
for(const aim of [{yaw:0,pitch:0},{yaw:.6,pitch:-.05}]){b.readyTick=0;assert.equal(act('inventionUse',{aim}).ok,true);const q=s.inventions.shots.at(-1);for(let k=0;k<400&&s.inventions.shots.includes(q);k++)sim.step();}
assert.equal(s.inventions.stuck.length,2);assert.deepEqual(s.inventions.stuck.map(r=>r.hostKind).sort(),['block','ground']);
const ground=(x,z)=>terrainHeight(s,x,z,false),scene=new THREE.Scene();
const a=createTimberlineStuck({scene,gltf,ground});a.sync(s);a.update(s,s.tick);
for(let k=0;k<700;k++){sim.step();a.update(s,s.tick);}
for(const r of s.inventions.stuck){const pose=a.pose(r.id);assert.deepEqual(pose.anchor.map(v=>+v.toFixed(4)),r.at.map(v=>+v.toFixed(4)),'the buried bolt stays at its anchor');
 for(const f of Object.values(pose.free)){const eye=new THREE.Vector3(...f.eye),nock=new THREE.Vector3(...f.nock);
  assert.ok(eye.distanceTo(new THREE.Vector3(...pose.anchor))<=STUCK_TETHER.rope+.01,'the twin stays within the wire');
  assert.ok(Math.abs(eye.distanceTo(nock)-STUCK_TETHER.rod)<.01,'the twin stays rigid');
  for(const v of [eye,nock])assert.ok(v.y>=ground(v.x,v.z)+STUCK_TETHER.ground-.01,'the twin rests on or above the ground');
  assert.ok(f.asleep,'the twin settles and sleeps');}}
// A peer joining later rebuilds the same rest pose from the record alone.
const late=createTimberlineStuck({scene:new THREE.Scene(),gltf,ground});late.sync(s);late.update(s,s.tick);
for(const r of s.inventions.stuck){const x=a.pose(r.id),y=late.pose(r.id);for(const k of Object.keys(x.free))for(const f of ['eye','nock'])assert.ok(new THREE.Vector3(...x.free[k][f]).distanceTo(new THREE.Vector3(...y.free[k][f]))<1e-6,'late joiners agree');}
const stats=a.stats();assert.ok(stats.drawCalls<=24,`stuck bolts batch into few draw calls (${stats.drawCalls})`);assert.equal(stats.pairs,2);
wall.hp=0;sim.step();a.sync(s);a.update(s,s.tick);assert.equal(a.stats().pairs,1,'bolts leave with their wall');
a.dispose();late.dispose();console.log(`timberline-stuck-view: buried anchor, wire length, rigid twin, ground rest, sleep, late-join agreement, batching PASS (${((performance.now()-t0)/1000).toFixed(3)}s)`);
