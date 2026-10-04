import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createSimulation} from '../shared/simulation.js';
import {worldTrees} from '../shared/world-content.js';
import {validateInventionPlacement,inventionAction,inventionPlacementReason} from '../shared/inventions.js';
import {terrainHeight,terrainRenderHeight,FOUNDATION_SOIL_RECESS} from '../shared/terrain.js';
import {createInventionView} from '../client/invention-view.js';
const started=performance.now(),sim=createSimulation();sim.addPlayer({id:'builder',role:'god'});
const s=sim.adventureWorld(),p=s.players[0];s.landmarks=false;s.deposits=[];s.groves=[];
s.harvestedTrees=worldTrees(s).map(t=>({id:t.id,cuts:3}));for(const k of Object.keys(p.resources))p.resources[k]=100;
const ctx={terrainHeight:()=>0},at=(x=18,z=0,kind='foundation')=>({action:'inventionBuild',kind,position:[x,0,z],yaw:0});
const check=(message,code,extraCtx=ctx)=>{const before=JSON.stringify(s);const preview=validateInventionPlacement(s,p,message,extraCtx);assert.equal(preview.code,code);assert.equal(JSON.stringify(s),before,'preview never mutates authority');const result=inventionAction(s,p,message,extraCtx);assert.equal(result.code,preview.code);assert.equal(result.reason,preview.reason);assert.ok(preview.reason.length>12);return preview;};
check(at(47),'outside_boundary');check(at(49),'outside_boundary');check(at(0),'protected_forge');check(at(18),'uneven_ground',{terrainHeight:(_s,x)=>x*.5});
s.deposits.push({id:'blocking-ore',x:18,z:0,depleted:false});assert.match(check(at(),'occupied').reason,/Mine it/);s.deposits=[];
p.resources.stone=0;const poor=check(at(),'insufficient_resources');assert.equal(poor.missing.stone,8);assert.match(poor.reason,/8 Stone/);p.resources.stone=100;
p.role='hero';p.position=[0,0,0];check(at(),'too_far');p.role='god';
const ready=validateInventionPlacement(s,p,at(),ctx);assert.equal(ready.ok,true);assert.equal(inventionAction(s,p,at(),ctx).ok,true);const tile=s.inventions.structures.at(-1);assert.equal(p.resources.stone,92);
assert.match(check(at(),'occupied').reason,/edge-to-edge/);check(at(20.5,0,'timberline'),'foundation_edge');
assert.equal(validateInventionPlacement(s,p,at(18,0,'timberline'),ctx).ok,true);
for(const [dx,dz] of [[0,0],[2.25,2.25],[3,3],[-3,-3]]){const x=18+dx,z=dz;assert.equal(terrainHeight(s,x,z,false),0);assert.ok(Math.abs(terrainRenderHeight(s,x,z,false)+FOUNDATION_SOIL_RECESS)<1e-6);}
assert.equal(terrainRenderHeight(s,25,0,false),terrainHeight(s,25,0,false));tile.hp=0;assert.equal(terrainRenderHeight(s,18,0,false),terrainHeight(s,18,0,false));tile.hp=400;
// Overlapping skirts lower soil once, never once per neighbouring tile.
s.inventions.structures.push({...structuredClone(tile),id:'neighbour',position:[24,0,0]});assert.ok(Math.abs(terrainRenderHeight(s,21,0,false)+FOUNDATION_SOIL_RECESS)<1e-8);
const scene=new THREE.Scene(),view=createInventionView({scene});view.sync(s);view.preview(new THREE.Vector3(47,0,0),'foundation',{ok:false,code:'outside_boundary',reason:inventionPlacementReason('outside_boundary'),position:[47,0,0]});
const outline=scene.children.find(n=>n.isLineLoop);assert.equal(outline.material.color.getHex(),0xf06458);assert.equal(outline.visible,true);assert.equal(view.stats().placement.code,'outside_boundary');let ghost=view.stats().blueprint;assert.equal(ghost.visible,true);assert.equal(ghost.type,'foundation');assert.equal(ghost.valid,false);
view.preview(new THREE.Vector3(18,0,0),'foundation',{ok:true,position:[18,0,0],reason:'Ready to build'});assert.equal(outline.material.color.getHex(),0x7fd0ff);assert.equal(view.stats().blueprint.valid,true);view.preview(new THREE.Vector3(18,0,0),'storehouse',{ok:true,position:[18,0,0],yaw:1.2,reason:'Ready to build'},{yaw:1.2});ghost=view.stats().blueprint;assert.equal(ghost.type,'storehouse');assert.ok(Math.abs(ghost.yaw-1.2)<1e-9,'first show snaps to the requested turn');assert.ok(ghost.edgeSets>0,'blueprint draws glowing edges');
view.preview(new THREE.Vector3(20,0,0),'storehouse',{ok:true,position:[20,0,0],yaw:1.2},{dt:1/60});assert.ok(view.stats().blueprint.position[0]>18&&view.stats().blueprint.position[0]<20,'blueprint glides between aim points rather than stepping');
view.preview(new THREE.Vector3(20,0,0),'operate:x',null);assert.equal(view.stats().blueprint.visible,false,'operating a machine aims a ring, not a ghost');view.preview(null,'foundation');assert.equal(outline.visible,false);assert.equal(view.stats().placement,null);assert.equal(view.stats().blueprint.visible,false);view.dispose();
console.log(JSON.stringify({suite:'placement-preview',ok:true,seconds:(performance.now()-started)/1000,checks:['shared authority/preview validation','specific recourse','missing resource counts','footprint boundary','no preview mutation','soil recess without physics drift','no double recess','destruction restores soil','red/valid preview','blueprint ghost tint, turn and glide']}));
