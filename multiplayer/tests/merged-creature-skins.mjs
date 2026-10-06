import assert from 'node:assert/strict';
import * as THREE from 'three';
import {cloneSkinnedAsset} from '../client/clone-skinned-asset.js';
import {mergeCreatureSkins} from '../client/merge-creature-skins.js';
import {loadGlb} from './glb-node.mjs';
const started=performance.now(), results=[];
const all = root => {const out=[];root.traverse(n=>{if(n.isMesh)out.push(n);});return out;};
for(const name of ['skeleton','forgeling']) {
 const gltf=await loadGlb(new URL(`../public/assets/${name}.glb`,import.meta.url));
 const reference=cloneSkinnedAsset(gltf.scene), count=all(reference).length;
 const saved=mergeCreatureSkins(gltf), actual=cloneSkinnedAsset(gltf.scene);
 assert.equal(saved,name==='skeleton'?5:13);assert.equal(all(actual).length,count-saved);
 assert.equal(mergeCreatureSkins(gltf),0,'idempotent preparation');
 const pairs=[];
 for(const mesh of all(actual)) {
  let offset=0;
  for(const src of mesh.userData.mergedSources||[{name:mesh.name,vertices:mesh.geometry.attributes.position.count}]) {
   const old=reference.getObjectByName(src.name);assert.ok(old,src.name);
   assert.equal(mesh.material,old.material,'authored material retained');
   for(const [key,attr] of Object.entries(old.geometry.attributes)) {
    const after=mesh.geometry.attributes[key];assert.equal(attr.itemSize,after.itemSize);assert.equal(attr.normalized,after.normalized);
    assert.deepEqual(after.array.slice(offset*attr.itemSize,(offset+src.vertices)*attr.itemSize),attr.array,`${name}/${src.name}/${key}`);
   }
   pairs.push({old,mesh,offset});offset+=src.vertices;
  }
 }
 // Arbitrary rotations exercise every joint, including jaw, feet and severable limbs.
 let checked=0;
 for(let frame=0;frame<10;frame++) {
  for(const root of [reference,actual]) {
   let i=0;root.traverse(n=>{if(n.isBone){n.quaternion.setFromEuler(new THREE.Euler(Math.sin(frame*.2+i)*.3,Math.cos(frame+i)*.2,.1));i++;}});
   root.position.set(2,frame*.05,-1);root.rotation.y=frame*.1;root.scale.setScalar(1.3);root.updateMatrixWorld(true);
   for(const m of all(root))if(m.isSkinnedMesh)m.skeleton.update();
  }
  const p=new THREE.Vector3(),q=new THREE.Vector3();
  for(const {old,mesh,offset} of pairs)for(let v=0;v<old.geometry.attributes.position.count;v++) {
   old.getVertexPosition(v,p).applyMatrix4(old.matrixWorld);mesh.getVertexPosition(offset+v,q).applyMatrix4(mesh.matrixWorld);
   assert.ok(p.distanceToSquared(q)<1e-20,`${name}/${old.name} posed vertex ${v}`);checked++;
  }
 }
 // Every triangle still addresses exactly the same weighted vertices, in the same order.
 for(const mesh of all(actual).filter(m=>m.userData.mergedSources)) {
  let vertex=0,index=0;
  for(const src of mesh.userData.mergedSources) {
   const old=reference.getObjectByName(src.name);
   for(const i of old.geometry.index.array)assert.equal(mesh.geometry.index.array[index++],i+vertex);
   vertex+=src.vertices;
  }
 }
 results.push({name,saved,posedVertices:checked});
}
// New authored animations / transformed meshes must not silently lose their transforms.
const gltf=await loadGlb(new URL('../public/assets/forgeling.glb',import.meta.url));
gltf.animations=[new THREE.AnimationClip('future',1,[])];assert.equal(mergeCreatureSkins(gltf),0);
gltf.animations=[];const arm=gltf.scene.getObjectByName('LeftArm_2');arm.position.x=.1;
mergeCreatureSkins(gltf);assert.ok(arm.parent,'non-identity part remains independent');
console.log(JSON.stringify({results,elapsedSeconds:(performance.now()-started)/1000}));
