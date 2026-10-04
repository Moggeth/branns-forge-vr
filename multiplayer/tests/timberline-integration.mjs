import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createTimberlineBallista} from '../assets-source/timberline-twinbolt-20261003/runtime/timberline-ballista.js';
import {createTimberlineBoltPair} from '../assets-source/timberline-twinbolt-20261003/runtime/timberline-bolts.js';
import {timberlineLaunch,timberlineFlight,stepTimberline} from '../shared/timberline-flight.js';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {STRUCTURES} from '../shared/inventions.js';
const t0=performance.now();
async function load(name){const b=readFileSync(new URL('../public/assets/'+name+'.glb',import.meta.url)),n=b.readUInt32LE(12),j=JSON.parse(b.subarray(20,20+n));delete j.images;delete j.textures;delete j.samplers;for(const m of j.materials){delete m.pbrMetallicRoughness?.baseColorTexture;delete m.pbrMetallicRoughness?.metallicRoughnessTexture;delete m.normalTexture;}let t=Buffer.from(JSON.stringify(j));t=Buffer.concat([t,Buffer.alloc((4-t.length%4)%4,32)]);const out=Buffer.alloc(20+t.length+b.length-20-n);b.copy(out,0,0,20);out.writeUInt32LE(out.length,8);out.writeUInt32LE(t.length,12);t.copy(out,20);b.copy(out,20+t.length,20+n);return new GLTFLoader().parseAsync(out.buffer,'');}
const machine=createTimberlineBallista(await load('timberline_ballista'));
let releaseEvents=0;machine.on('release',()=>releaseEvents++);
for(const [age,phase,visible] of [[0,'firing',true],[.1,'firing',false],[1,'reloading',true],[3.8,'reloading',true],[4,'loaded',true],[1.5,'reloading',true],[4,'loaded',true]]){machine.seekCycle(age);assert.equal(machine.state,phase);assert.equal(machine.nodes.LoadedBolt_L.visible,visible);assert.ok(machine.object.children.length);}
assert.equal(releaseEvents,0,'seeking never replays authority events');
const q={origin:[0,1.3,0],target:[0,1.3,-20],launchTick:0,impactTick:28,hitIds:[],structureId:'machine',id:'shot',owner:'owner',side:'party'};
machine.aimImmediate(0,0);machine.seekCycle(.05);const frame=machine.launchFrame();assert.ok(frame.launch.origin.distanceTo(new THREE.Vector3(...timberlineLaunch(q).origin))<.002,'pure authority origin matches authored release sockets');
const pair=createTimberlineBoltPair(await load('timberline_bolts'));const state=timberlineFlight(q,20);pair.setState({eyeL:new THREE.Vector3(...state.left),eyeR:new THREE.Vector3(...state.right),forward:new THREE.Vector3(0,0,-1),up:new THREE.Vector3(0,1,0)});pair.group.updateMatrixWorld(true);assert.ok(pair.nodes.Bolt_L_FilamentEye.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(...state.left))<1e-5);
const sim=createSimulation();sim.addPlayer({id:'owner',role:'god'});const s=sim.adventureWorld(),p=s.players[0];for(const k of Object.keys(p.resources))p.resources[k]=50;
const b={id:'building1',type:'timberline',position:[-12,terrainHeight(s,-12,6,false),6],yaw:0,hp:200,maxHp:200,side:'party',builtTick:0,readyTick:0,fireTick:-1000,open:false,charge:0,armed:false,aimYaw:0};s.inventions.structures.push(b);s.inventions.seq=1;
assert.equal(sim.command('owner',{type:'action',seq:1,action:'inventionUse',structureId:b.id,target:[-12,b.position[1],-14]}).ok,true);assert.equal(s.inventions.shots[0].v,3);assert.ok(s.inventions.shots[0].impactTick>20);
const resume=loadSimulation(sim.checkpoint());for(let k=0;k<65;k++){sim.step();resume.step();assert.deepEqual(sim.checkpoint().inventions,resume.checkpoint().inventions,'migration deterministic tick '+k);}
const enemy={id:'victim',kind:'skeleton',position:[0,0,-6]},env={inventions:{structures:[]},deposits:[],groves:[],harvestedTrees:[],enemies:[enemy]};let damage=0;const c={terrainHeight:()=>0,damageEnemy:()=>damage++,hitEnemyPart:()=>{throw Error('not a golem')},chopTree:()=>({events:[]})};
for(let tick=1;tick<=16;tick++){env.tick=tick;stepTimberline(env,q,c,[],STRUCTURES);if(tick<=3)assert.equal(damage,0,'no damage before release');}assert.equal(damage,1,'moving filament hits each target once');
q.hitIds=[];damage=0;env.inventions.structures=[{id:'wall',type:'storehouse',hp:100,position:[0,0,-3]}];for(let tick=1;tick<=16;tick++){env.tick=tick;if(stepTimberline(env,q,c,[],STRUCTURES))break;}assert.equal(damage,0,'solid obstruction stops hits behind it');
pair.dispose();machine.dispose();console.log(`timberline-integration: authored socket match, deterministic reload seek, swept hits, obstruction, checkpoint continuity PASS (${((performance.now()-t0)/1000).toFixed(3)}s)`);

