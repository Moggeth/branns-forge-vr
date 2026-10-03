import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {spellUnavailable} from '../client/spell-availability.js';
import {SPELLS,settleCastPoint} from '../shared/spells.js';
import {expeditionRunning} from '../shared/adventure.js';
import {createSimulation} from '../shared/simulation.js';
import {createEnemy} from '../shared/combat.js';
import {depositCapacityUsed,reclaimDepletedDeposits} from '../shared/resources.js';
import {terrainHeight,terrainFrameKey,terrainDirtyEdits,createSunderRupture,foundationTerrainKey,terrainRenderVertex} from '../shared/terrain.js';
import {lineKernels} from '../client/spell-targeting.js';

// Capacity previews use the same protected-reference predicate as authority
// reclamation. Fixture-only references below test protection without pretending
// to be independently loadable combat/worker records. The 80-deposit command
// matrix separately verifies actual cast acceptance after reclamation.
// If a game closure gains another dependency, expose it in its controlled env:
// terrainRay/worldMatricesAt were required by the October 3 ground-cache update.
const started=performance.now(),failures=[];let cases=0;
const check=(label,fn)=>{cases++;try{fn();}catch(error){failures.push({label,error:error.message});}};
function fixture(){const sim=createSimulation();sim.addPlayer({id:'g',role:'god'});const world=sim.adventureWorld();world.tick=100;world.players[0].castTick=0;return {sim,world,player:world.players[0]};}
const fills={enemies:(w,n)=>{w.enemies=Array.from({length:n},(_,i)=>createEnemy('testenemy'+i,[40,0,40]));},edits:(w,n)=>{w.edits=Array.from({length:n},(_,i)=>({id:'testedit'+i,kind:'raise',x:30,z:30,radius:6,height:2}));},groves:(w,n)=>{w.groves=Array.from({length:n},(_,i)=>({id:'testgrove'+i,x:30,z:30}));},pending:(w,n)=>{w.pendingStarfalls=Array.from({length:n},(_,i)=>({id:'testfall'+i,x:30,z:30,radius:5,impactTick:200}));},deposits:(w,n)=>{w.deposits=Array.from({length:n},(_,i)=>({id:'testore'+i,kind:'stone',x:30,z:30,hits:0,maxHits:3,depleted:false}));}};
const scenarios=[['ready',()=>{}],['hero',(w,p)=>p.role='hero'],['forge-disabled',w=>w.shrine.hp=0],['cooldown44',(w,p)=>p.castTick=w.tick-44],['cooldown45',(w,p)=>p.castTick=w.tick-45],['mana0',(w,p)=>p.mana=0],['exact-mana',(w,p,id)=>p.mana=SPELLS.find(s=>s.id===id).cost],['one-mana-short',(w,p,id)=>p.mana=SPELLS.find(s=>s.id===id).cost-1]];
for(const [key,counts] of Object.entries({enemies:[60,61,63,64],edits:[60,61,62,63,64],groves:[63,64],pending:[7,8],deposits:[78,79,80]}))for(const n of counts)scenarios.push([key+n,w=>fills[key](w,n)]);
scenarios.push(['reserved-edit-edge',w=>{fills.edits(w,61);fills.pending(w,2);}],['reserved-ore-edge',w=>{fills.deposits(w,78);fills.pending(w,1);}],['reserved-ore-full',w=>{fills.deposits(w,78);fills.pending(w,2);}]);
scenarios.push(['all-ore-depleted',w=>{fills.deposits(w,80);for(const d of w.deposits){d.depleted=true;d.hits=3;}}],['one-ore-reclaimable',w=>{fills.deposits(w,80);w.deposits[0].depleted=true;w.deposits[0].hits=3;}],['reserved-ore-reclaimable',w=>{fills.deposits(w,78);fills.pending(w,2);w.deposits[0].depleted=true;w.deposits[0].hits=3;}]);
for(const [name,protect] of [
 ['embed',(w,d)=>w.embeds.push({targetId:d.id})],['surface',(w,d)=>w.fireSurfaces.push({targetId:d.id})],
 ['worker',(w,d)=>w.settlement.workers.push({targetId:d.id})],['pending',(w,d)=>w.pendingStarfalls.push({id:d.id})],
 ['active-quest',(w,d)=>{w.adventure.stage='camp';w.adventure.run=1;d.id='xv1s0';}],
 ['linked-wall',(w,d)=>{d.editId='liveWall';w.edits.push({id:'liveWall'});}]
])check('pure-capacity/protected-'+name,()=>{
 const {world,player}=fixture();fills.deposits(world,80);const d=world.deposits[0];d.depleted=true;d.hits=3;protect(world,d);
 const before=structuredClone(world),used=depositCapacityUsed(world);assert.ok(used>=80);assert.equal(spellUnavailable(world,player,'crystal'),'Deposit limit reached');assert.deepEqual(world,before,'capacity previews are pure');
 const copy=structuredClone(world);reclaimDepletedDeposits(copy);assert.equal(used,copy.deposits.length+copy.pendingStarfalls.length,'shared protection matches authority reclamation exactly');
});
for(const [id,setup,expected] of [
 ['skeleton',w=>fills.enemies(w,64),'Creature limit reached'],['raise',w=>fills.edits(w,64),'Terrain edit limit reached'],
 ['grove',w=>fills.groves(w,64),'Grove limit reached'],['starfall',w=>fills.pending(w,8),'Meteor limit reached'],
 ['crystal',w=>fills.deposits(w,80),'Deposit limit reached']
])check('capacity-reason/'+id,()=>{const {world,player}=fixture();setup(world);assert.equal(spellUnavailable(world,player,id),expected);});
for(const spec of SPELLS)for(const [name,setup] of scenarios)check(spec.id+'/'+name,()=>{const {sim,world,player}=fixture();setup(world,player,spec.id);const point=[16,0,16],before=world.adventure.hostileUsed,reason=spellUnavailable(world,player,spec.id,{point});assert.equal(world.adventure.hostileUsed,before,'availability must be read-only');const result=sim.command('g',{type:'cast',seq:1,spell:spec.id,point});assert.equal(!reason,result.ok,`client reason ${reason||'none'} / authority ${result.code||'ok'}`);});
for(const point of [[55,0,55],[55.001,0,0],[51,0,51],[51.001,0,0],[0,1000,0],[0,1000.001,0],[0,NaN,0],[0,0],[],{},'bad'])for(const id of ['raise','grove','ring'])check(id+'/point/'+JSON.stringify(point),()=>{const {sim,world,player}=fixture();const reason=spellUnavailable(world,player,id,{point});const result=sim.command('g',{type:'cast',seq:1,spell:id,point});assert.equal(!reason,result.ok,`client ${reason||'available'} / authority ${result.code||'ok'}`);});
// Challenge rules apply only in running expeditions, to all three hostile summons.
for(const stage of ['idle','camp','star','rekindle','victory'])for(const id of ['skeleton','squad','golem','raise'])for(const scenario of ['no-hero','forge','near-hero','spent','allowed'])check(id+'/expedition/'+stage+'/'+scenario,()=>{const {sim,world,player}=fixture();world.adventure.stage=stage;let point=[25,0,25];if(scenario!=='no-hero'){sim.addPlayer({id:'h',role:'hero'});world.players.find(p=>p.id==='h').position=scenario==='near-hero'?[25,0,24]:[-25,0,-25];}if(scenario==='forge')point=[0,0,0];if(scenario==='spent')world.adventure.hostileUsed=4;const before=structuredClone(world.adventure),reason=spellUnavailable(world,player,id,{point});assert.deepEqual(world.adventure,before,'availability cannot consume challenge budget');const result=sim.command('g',{type:'cast',seq:1,spell:id,point});assert.equal(!reason,result.ok,`client ${reason||'available'} / authority ${result.code||'ok'}`);});

// Execute the actual small game closures with controlled dependencies, without a browser/renderer.
// This tests the integration code itself rather than copying its endpoint or dirty-region algorithm.
const game=readFileSync(new URL('../client/game.js',import.meta.url),'utf8');
function closure(name,until,env){const start=game.indexOf('function '+name+'('),end=game.indexOf(until,start);assert.ok(start>=0&&end>start,name+' source boundary');return new Function('env','with(env){return '+game.slice(start,end).trim()+';}')(env);}
function previewFixture(id,point,castStart=null){const f=fixture();const env={THREE,active:true,role:'god',cursor:{visible:true},snapshot:f.world,playerId:'g',spell:id,hitPoint:new THREE.Vector3(...point),castStart:castStart?new THREE.Vector3(...castStart):null,spellUnavailable,isLineSpell:()=>['sunder','wall'].includes(id)};Object.assign(env,{settleCastPoint,expeditionRunning,heightAt:(x,z,edits)=>terrainHeight({...f.world,edits},x,z)});env.settledPoint=closure('settledPoint','function fitLine',env);env.fitLine=closure('fitLine','function targetPreview',env);return {...f,env,preview:closure('targetPreview','function cancelCast',env)};}
// Lines are never refused: under 0.5 m becomes the default 6 m line, over 18 m is shortened.
for(const id of ['sunder','wall'])for(const n of [.499,.5,2.5,2.501,17.999,18,18.001,30])check(id+'/explicit-length/'+n,()=>{const f=previewFixture(id,[n,30,16],[0,-30,16]),p=f.preview(),result=f.sim.command('g',{type:'cast',seq:1,spell:id,point:p.point,...(p.fallback?{}:{start:p.start,end:p.end})});assert.equal(p.valid,true);assert.equal(p.valid,result.ok,result.code);if(result.ok){assert.equal(f.world.edits.length,n<.5?3:Math.ceil(Math.min(n,17.99)/2.5)+1);assert.equal(p.fallback,n<.5);assert.equal(lineKernels(p.start[0],p.start[2],p.end[0],p.end[2],p.fallback).length,f.world.edits.length);}});
for(const id of ['sunder','wall'])for(const point of [[16,0,16],[55,0,55],[0,0,0],[.0001,0,0]])check(id+'/fallback/'+point,()=>{const f=previewFixture(id,point);f.player.position=[0,0,0];f.player.yaw=.7;const p=f.preview(),result=f.sim.command('g',{type:'cast',seq:1,spell:id,point});assert.equal(p.valid,result.ok);assert.equal(p.fallback,true);assert.equal(f.world.edits.length,3);const event=result.events.find(e=>e.kind==='spell');for(const k of ['start','end'])for(const axis of [0,2])assert.ok(Math.abs(p[k][axis]-event[k][axis])<1e-12,`${k} XZ preview must match authority`);assert.equal(lineKernels(p.start[0],p.start[2],p.end[0],p.end[2],p.fallback).length,3);});
for(const id of ['sunder','wall'])for(const count of [60,61,62])check(id+'/explicit-v-fallback-cap/'+count,()=>{for(const explicit of [false,true]){const f=previewFixture(id,[16,0,16],explicit?[10,0,16]:null);fills.edits(f.world,count);const p=f.preview(),result=f.sim.command('g',{type:'cast',seq:1,spell:id,point:p.point,...(explicit?{start:p.start,end:p.end}:{})});assert.equal(p.valid,result.ok,`edits=${count}, explicit=${explicit}`);}});
check('outside quick-cast start is invalid',()=>{const f=previewFixture('sunder',[54,0,10],[56,0,10]),p=f.preview(),result=f.sim.command('g',{type:'cast',seq:1,spell:'sunder',point:p.point,start:p.start,end:p.end});assert.equal(result.ok,false);assert.equal(p.valid,false);});
for(const flag of ['active','role','cursor'])check('hidden-preview/'+flag,()=>{const f=previewFixture('raise',[10,0,10]);if(flag==='active')f.env.active=false;if(flag==='role')f.env.role='hero';if(flag==='cursor')f.env.cursor.visible=false;assert.equal(f.preview(),null);});

check('initial empty-edits actual ground rebuild plus progressive collision parity',()=>{
 const segments=game.match(/const groundGeometry = new THREE.PlaneGeometry\(([^)]+)\)/)[1].split(',').map(Number),groundGeometry=new THREE.PlaneGeometry(...segments);groundGeometry.rotateX(-Math.PI/2);
 const initial=game.match(/let terrainSignature = ([^,;]+)/)[1],env={THREE,snapshot:{edits:[],tick:0},terrainSignature:new Function('return '+initial)(),terrainPreviousEdits:[],terrainPreviousTick:Infinity,terrainFrameKey,terrainDirtyEdits,foundationTerrainKey,terrainRenderVertex,terrainFoundationKey:'',frameMetrics:{record(){}},groundGeometry,fireVisual:{invalidateTerrain(){}},terrainRay:{invalidateTerrain(){}},worldMatricesAt:0,mountainArena:{sync(){}},alpineForest:{sync(){}},meadow:{terrainChanged(){}},orchard:{groundChanged(){}},heightAt:(x,z,edits)=>terrainHeight({edits,tick:env.snapshot.tick},x,z,false)};
 const rebuild=closure('rebuildGround','// Stone/canopy',env),mesh=new THREE.Mesh(groundGeometry,new THREE.MeshBasicMaterial()),ray=new THREE.Raycaster();mesh.updateMatrixWorld(true);rebuild();assert.equal(env.terrainSignature,'|',"empty edits plus no foundations");assert.equal(env.worldMatricesAt,-1);
 const phases=[{edits:[],tick:0},...Array.from({length:4},(_,i)=>({tick:i*24,edits:[{id:'s',kind:'sunder',x:16,z:16,radius:2.5,height:-1.5,rupture:createSunderRupture('s',[10,0,16],[22,0,16],0)}]}))];
 for(const state of phases){env.snapshot=state;rebuild();for(const [x,z] of [[10.1,4.2],[-30.6,30.2],[48.2,-47.7],[54.1,20.8],[15.7,16.1]]){ray.set(new THREE.Vector3(x,100,z),new THREE.Vector3(0,-1,0));const hit=ray.intersectObject(mesh)[0];assert.ok(hit);assert.ok(Math.abs(hit.point.y-terrainHeight(state,x,z,false))<1e-6,`ground parity ${x},${z} tick${state.tick}`);}}
 mesh.geometry.dispose();mesh.material.dispose();
});
console.log(JSON.stringify({suite:'spell-availability',cases,failures,elapsedSeconds:(performance.now()-started)/1000},null,2));
assert.equal(failures.length,0,'client/authority spell availability mismatches');

