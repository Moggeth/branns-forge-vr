import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {prepareAsset} from '../client/asset-pose.js';
import {updateSkinBounds} from '../client/skin-bounds.js';
import {applyEnemyMotion} from '../client/enemy-motion.js';
import {segmentSurfaceContacts} from '../client/combat-view.js';
import {loadGlb} from './glb-node.mjs';
import {dressSkeleton} from '../client/skeleton-look.js';
const start=performance.now(),bytes=0;
const template=await loadGlb(new URL('../public/assets/skeleton.glb',import.meta.url));
const {visual,model}=prepareAsset(template,'skeleton'), root=new T.Group();dressSkeleton(visual,0);root.add(visual);root.position.set(4,2,-5);root.rotation.y=.8;
const entry={root,visual,enemy:true,data:{id:'animated',kind:'skeleton',attackTick:1,missingParts:[]}},meshes=[];visual.traverse(n=>{if(n.isSkinnedMesh)meshes.push(n);});
// Skeletons are posed procedurally (no clips): walk, guard, claw swipe and recoil, each sampled over time.
let checked=0,tick=0;
for(const scene of ['idle','walk','guard','attack','hit']){
 if(scene==='attack')entry.data.attackTick=tick+2;if(scene==='hit')entry.data.hurtTick=tick+2;
 for(let f=0;f<20;f++){
  tick+=3;if(scene==='walk')root.position.x+=.1;
  applyEnemyMotion(entry,{tick,dt:.047,height:()=>2,threats:scene==='guard'?[[root.position.x-2*Math.sin(.8),2,root.position.z-2*Math.cos(.8)]]:[]});root.updateWorldMatrix(true,true);
  for(const mesh of meshes){mesh.skeleton.update();const conservative=updateSkinBounds(mesh).clone().expandByScalar(1e-6);mesh.computeBoundingBox();assert.ok(conservative.containsBox(mesh.boundingBox),`${scene} frame${f} ${mesh.name} bounds contain every exact skin vertex`);checked++;}
 }}
assert.ok(checked>=500,`posed bounds checked ${checked}`);
// Actual triangle results remain identical using exact or conservative preparation.
root.updateWorldMatrix(true,true);
function cache(fast){const bounds=new T.Box3();for(const mesh of meshes){mesh.skeleton.update();if(fast)updateSkinBounds(mesh);else mesh.computeBoundingBox();mesh.boundingSphere ||=new T.Sphere();mesh.boundingBox.getBoundingSphere(mesh.boundingSphere);bounds.union(mesh.boundingBox.clone().applyMatrix4(mesh.matrixWorld));}return{meshes,bounds};}
let comparisons=0;for(let y=2;y<3.8;y+=.12){const from=[4,y,0],to=[4,y,-10];const exact=segmentSurfaceContacts(visual,from,to,'e',cache(false),{includePartPoses:false});const fast=segmentSurfaceContacts(visual,from,to,'e',cache(true),{includePartPoses:false});assert.deepEqual(fast,exact);comparisons++;}
console.log(JSON.stringify({passed:true,animatedMeshBoundsChecked:checked,exactContactComparisons:comparisons,elapsedMs:performance.now()-start}));
