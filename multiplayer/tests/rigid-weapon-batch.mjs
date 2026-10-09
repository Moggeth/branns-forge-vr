import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Vector3} from 'three';
import {batchRigidWeapon} from '../client/rigid-weapon-batch.js';
import {prepareAsset,weaponTip} from '../client/asset-pose.js';
globalThis.self ??= globalThis;
function surface(root){
 root.updateMatrixWorld(true);const values=[],v=new Vector3();let triangles=0;
 root.traverseVisible(n=>{if(!n.isMesh)return;const g=n.geometry,p=g.attributes.position,ids=g.index;
  triangles+=(ids?.count??p.count)/3;
  for(let i=0;i<(ids?.count??p.count);i++){const index=ids?ids.getX(i):i;v.fromBufferAttribute(p,index).applyMatrix4(n.matrixWorld);values.push(`${n.material.uuid}:${v.toArray().map(x=>Math.round(x*10000)).join(',')}`);}
 });return {triangles,values:values.sort()};
}
for(const [name,height] of [['axe',.7],['pick',.75],['hammer',.95]]){
 const b=readFileSync(new URL(`../public/assets/${name}.glb`,import.meta.url));const warn=console.warn,error=console.error;let gltf;
 try{console.warn=console.error=()=>{};gltf=await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');}finally{console.warn=warn;console.error=error;}
 const batch=batchRigidWeapon(gltf),before=prepareAsset(gltf,name,height).visual,after=prepareAsset(batch.gltf,name,height).visual;
 assert.deepEqual(surface(after),surface(before),`${name}: exact posed triangles and material identity`);
 assert.ok(weaponTip(before,name).distanceTo(weaponTip(after,name))<1e-8,'named anchors retained');
 if(name==='axe')assert.ok(batch.savedDraws>=10,'meaningful submission reduction');
 if(name==='pick')assert.ok(batch.savedDraws>0);
 console.log(name,{savedDraws:batch.savedDraws});batch.dispose();
}
