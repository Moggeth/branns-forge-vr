import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createTerrainGeometryUpdater} from '../client/terrain-geometry.js';
import {createSimulation,loadSimulation} from '../shared/simulation.js';
import {terrainHeight,terrainRenderHeight,terrainRenderVertex,rawTerrainHeight,terrainFrameKey,terrainDirtyEdits,foundationTerrainKey,moveOnTerrain} from '../shared/terrain.js';
import {createTerrainSampler} from '../shared/terrain-sampler.js';
import {worldTrees} from '../shared/world-content.js';
import {damageInvention,resolveInventions,inventionView} from '../shared/inventions.js';
import {createInventionView} from '../client/invention-view.js';
const started=performance.now();
const sim=createSimulation();sim.addPlayer({id:'owner',role:'god'});
const s=sim.adventureWorld(),p=s.players[0];s.landmarks=false;s.deposits=[];s.groves=[];
for(const k of Object.keys(p.resources))p.resources[k]=100;
const act=(action,detail={})=>sim.command(p.id,{type:'action',seq:p.seq+1,action,...detail});
let tile;
for(let x=-36;x<=36&&!tile;x+=6)for(let z=-36;z<=36&&!tile;z+=6){if(act('inventionBuild',{kind:'foundation',position:[x,0,z],yaw:1}).ok)tile=s.inventions.structures.at(-1);}
assert.ok(tile);assert.equal(tile.yaw,0);assert.equal(p.resources.stone,92);
const [x,y,z]=tile.position;
assert.equal(act('inventionBuild',{kind:'foundation',position:[x,0,z]}).code,'occupied');
assert.equal(act('inventionBuild',{kind:'timberline',position:[x+2.5,0,z]}).code,'foundation_edge');
assert.equal(act('inventionBuild',{kind:'timberline',position:[x,0,z],yaw:0}).ok,true);
const machine=s.inventions.structures.at(-1);assert.equal(machine.position[1],y);
assert.equal(inventionView(s,p.id).structures.find(b=>b.id===tile.id).passive,true);
const sampler=createTerrainSampler(s);sampler.height(x,z);
s.edits.push({id:'foundation_crater',kind:'lower',x,z,radius:6,height:-2});sampler.setState(s);
for(const [dx,dz]of [[0,0],[2.9,0],[2.9,2.9],[-2.9,-2.9],[0,2.99]])assert.ok(Math.abs(terrainHeight(s,x+dx,z+dz,false)-y)<1e-6);
assert.ok(terrainHeight(s,x+4,z,false)<y);assert.equal(sampler.height(x,z),terrainHeight(s,x,z,false));
const foot=[x+2,y,z];assert.deepEqual(resolveInventions(s,[...foot]),foot);
const walker=[x+2,y,z];moveOnTerrain(s,walker,.1,0);assert.ok(walker[0]>x+2);
for(let n=0;n<60;n++)sim.step();assert.equal(tile.position[1],y);assert.ok(Math.abs(machine.position[1]-y)<1e-6);
const loaded=loadSimulation(sim.checkpoint());assert.equal(loaded.snapshot().inventions.structures.find(b=>b.id===tile.id).position[1],y);
assert.equal(terrainHeight(loaded.adventureWorld(),x,z,false),terrainHeight(s,x,z,false));
// Real invention model/view puts the plate top and machine foot on the same support plane.
const scene=new THREE.Scene(),view=createInventionView({scene});view.sync(s);view.update(0,s.tick);
const tileModel=scene.getObjectByName(tile.id),machineModel=scene.getObjectByName(machine.id);
assert.equal(tileModel.position.y,y);assert.ok(Math.abs(machineModel.position.y-y)<1e-6);
const bounds=new THREE.Box3().setFromObject(tileModel);assert.ok(bounds.min.x>=x-3-1e-6&&bounds.min.x<=x-2.99,'authored chamfer stays inside six-metre support');assert.ok(bounds.max.x<=x+3+1e-6&&bounds.max.x>=x+2.99);assert.ok(bounds.max.y-y<.03);
// Every visible paver/kerb/mortar hit is separated from rendered soil. This
// catches hidden mortar and bevel intersections, not merely coplanar top faces.
const artRay=new THREE.Raycaster();tileModel.updateWorldMatrix(true,true);let surfaceSamples=0,minClearance=Infinity;
for(let dx=-2.8;dx<=2.8;dx+=.2)for(let dz=-2.8;dz<=2.8;dz+=.2){artRay.set(new THREE.Vector3(x+dx,y+2,z+dz),new THREE.Vector3(0,-1,0));const hit=artRay.intersectObject(tileModel,true)[0];if(!hit)continue;const clearance=hit.point.y-terrainRenderHeight(s,x+dx,z+dz,false);minClearance=Math.min(minClearance,clearance);assert.ok(clearance>.015,`masonry/soil clearance ${clearance} at ${dx},${dz}`);surfaceSamples++;}
assert.ok(surfaceSamples>700);assert.ok(minClearance>.015);
// Execute the actual ground mesh rebuild closure, not a parallel mesh implementation.
const game=readFileSync(new URL('../client/game.js',import.meta.url),'utf8');
const body=game.slice(game.indexOf('  function rebuildGround('),game.indexOf('  // Stone/canopy'));
const geometry=new THREE.PlaneGeometry(120,120,160,160);geometry.rotateX(-Math.PI/2);
const env={snapshot:s,terrainSignature:null,terrainFoundationKey:null,terrainPreviousEdits:[],terrainPreviousTick:Infinity,terrainFrameKey,terrainDirtyEdits,foundationTerrainKey,terrainRenderVertex,groundGeometry:geometry,terrainGeometry:createTerrainGeometryUpdater(geometry),fireVisual:{invalidateTerrain(){}},terrainRay:{invalidateTerrain(){}},worldMatricesAt:0,mountainArena:{sync(){}},alpineForest:{sync(){}},meadow:{terrainChanged(){}},frameMetrics:{record(){}},orchard:{groundChanged(){}},heightAt:(a,b)=>sampler.height(a,b)};
Object.assign(env,{terrainShownTick:()=>env.snapshot.tick??Infinity,terrainLive:false,meadowPending:new Map(),flushMeadow(){},content:{terrainMoved(){}}});
const rebuild=new Function('env',`with(env){${body};return rebuildGround;}`)(env),mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial()),ray=new THREE.Raycaster();mesh.updateMatrixWorld(true);
function meshParity(){sampler.setState(s);rebuild();for(const [dx,dz]of [[0,0],[2.8,2.8],[3.6,1.2],[4.8,0]]){ray.set(new THREE.Vector3(x+dx,100,z+dz),new THREE.Vector3(0,-1,0));const hit=ray.intersectObject(mesh)[0];assert.ok(hit);assert.ok(Math.abs(hit.point.y-terrainRenderHeight(s,x+dx,z+dz,false))<1e-6);}}
meshParity();const oldKey=foundationTerrainKey(s);damageInvention(s,tile.id,70,'enemy',[],'rivals');assert.equal(foundationTerrainKey(s),oldKey);assert.equal(sampler.setState(s),false);meshParity();assert.ok(Math.abs(sampler.height(x,z)-y)<1e-6);
damageInvention(s,tile.id,400,'enemy',[],'rivals');meshParity();assert.ok(sampler.height(x,z)<y-1);
view.sync(s);view.update(0,s.tick);assert.equal(tileModel.visible,false);
assert.equal(act('inventionRepair',{structureId:tile.id}).ok,true);meshParity();assert.ok(Math.abs(sampler.height(x,z)-y)<1e-6);
const corrupt=sim.checkpoint();corrupt.inventions.structures.find(b=>b.id===tile.id).yaw=1;assert.throws(()=>loadSimulation(corrupt),/Invalid inventions/);
assert.doesNotThrow(()=>loadSimulation(sim.checkpoint()));view.dispose();geometry.dispose();mesh.material.dispose();
// Square-corner occupancy must cover resources and an isolated grove trunk.
const edgeSim=createSimulation();edgeSim.addPlayer({id:'edge',role:'god'});const edge=edgeSim.adventureWorld(),ep=edge.players[0];edge.landmarks=false;edge.deposits=[];for(const k of Object.keys(ep.resources))ep.resources[k]=100;
const buildAt=(x,z)=>edgeSim.command(ep.id,{type:'action',seq:ep.seq+1,action:'inventionBuild',kind:'foundation',position:[x,0,z],yaw:0});
edge.harvestedTrees=worldTrees(edge).map(t=>({id:t.id,cuts:3}));
edge.deposits=[{id:'cornerStone',x:-27.2,z:-27.2,kind:'stone',depleted:false}];assert.equal(buildAt(-30,-30).code,'occupied');edge.deposits=[];
edge.groves=[{id:'cornerGrove',x:-29.7,z:-27.2}];edge.harvestedTrees.push(...worldTrees(edge).filter(t=>t.id.startsWith('cornerGrove')&&t.id!=='cornerGrove-tree0').map(t=>({id:t.id,cuts:3})));
assert.equal(buildAt(-30,-30).code,'occupied');edge.groves=[];
assert.equal(buildAt(-36,-30).ok,true);const left=edge.inventions.structures.at(-1);assert.equal(buildAt(-24,-30).ok,true);const right=edge.inventions.structures.at(-1);right.position[1]=left.position[1]+.4;
assert.equal(buildAt(-30,-30).code,'uneven_ground','joining incompatible support planes must fail');right.position[1]=left.position[1];assert.equal(buildAt(-30,-30).ok,true);
const between=edge.inventions.structures.at(-1);assert.equal(between.position[1],left.position[1]);
// Skirts of separated supports blend continuously and independently of insertion order.
const supports={edits:[],inventions:{structures:[{type:'foundation',hp:1,position:[-30,0,0]},{type:'foundation',hp:1,position:[-22.5,1,0]}]}};
const reversed={...supports,inventions:{structures:[...supports.inventions.structures].reverse()}};
for(let n=0;n<=150;n++){const a=-30+n*.05;assert.ok(Math.abs(rawTerrainHeight(supports,a,0)-rawTerrainHeight(reversed,a,0))<1e-12);}
assert.ok(Math.abs(rawTerrainHeight(supports,-27+1e-6,0))<1e-8);assert.ok(Math.abs(rawTerrainHeight(supports,-25.5-1e-6,0)-1)<1e-8);
// E interaction must skip the passive support and reach its usable machine.
const interactionBody=game.slice(game.indexOf('  function interact(){'),game.indexOf('  function interact(){')+game.slice(game.indexOf('  function interact(){')).indexOf('\n'));
let used=null;const interaction=new Function('env',`with(env){${interactionBody};return interact;}`)({active:true,role:'hero',snapshot:s,appleSnack:{holding:()=>false},findCollectible:()=>null,aimProbe:()=>({}),localPosition:new THREE.Vector3(x,y,z),useInvention:id=>{used=id;},isHomeBallistaId:()=>false,useHomeBallista:()=>false,nearHomeBallista:()=>null,useHomePiece:()=>false,nearPlantedPack:()=>null});interaction();assert.equal(used,machine.id);
console.log(JSON.stringify({suite:'foundation-tiles',ok:true,seconds:(performance.now()-started)/1000,checks:['stone recipe','same-tile machine','edge rejection','anchoring','smooth edge','walking','checkpoint','model alignment','actual ground mesh','damage/destruction/repair cache','corrupt save']}));
