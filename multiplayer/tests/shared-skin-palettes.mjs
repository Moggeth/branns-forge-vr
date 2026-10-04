import assert from 'node:assert/strict';
import * as THREE from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {cloneSkinnedAsset} from '../client/clone-skinned-asset.js';
import {loadGlb} from './glb-node.mjs';

const started = performance.now(), results = [];
const meshes = root => { const out = []; root.traverse(n => { if(n.isSkinnedMesh) out.push(n); }); return out; };
const palettes = root => new Set(meshes(root).map(m => m.skeleton));
for (const name of ['hero','skeleton']) {
  const gltf = await loadGlb(new URL(`../public/assets/${name}.glb`,import.meta.url));
  const reference = clone(gltf.scene), actual = cloneSkinnedAsset(gltf.scene), other = cloneSkinnedAsset(gltf.scene);
  const a = meshes(reference), b = meshes(actual);
  assert.equal(a.length,b.length);
  assert.ok(palettes(actual).size < palettes(reference).size, 'authored multi-part actor shares palette');
  for(const s of palettes(actual)) assert.ok(!palettes(other).has(s), 'independent actor palette');
  const refBones = [], bones = [];
  reference.traverse(n=>{if(n.isBone)refBones.push(n);}); actual.traverse(n=>{if(n.isBone)bones.push(n);});
  let vertices = 0;
  for(let frame=0;frame<12;frame++) {
    for(let i=0;i<bones.length;i++) {
      const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(frame*.2+i)*.2,Math.cos(i+frame*.1)*.1,0));
      refBones[i].quaternion.copy(q); bones[i].quaternion.copy(q);
    }
    reference.position.set(frame*.1,1,-2); actual.position.copy(reference.position);
    reference.updateMatrixWorld(true); actual.updateMatrixWorld(true);
    for(let i=0;i<a.length;i++) {
      assert.equal(a[i].geometry,b[i].geometry); assert.equal(a[i].material,b[i].material);
      assert.deepEqual(a[i].bindMatrix.elements,b[i].bindMatrix.elements);
      a[i].skeleton.update(); b[i].skeleton.update();
      assert.deepEqual(a[i].skeleton.boneMatrices,b[i].skeleton.boneMatrices);
      const p=new THREE.Vector3(),q=new THREE.Vector3();
      for(let v=0;v<a[i].geometry.attributes.position.count;v+=7) {
        a[i].getVertexPosition(v,p);b[i].getVertexPosition(v,q);
        assert.ok(p.distanceToSquared(q)<1e-24);vertices++;
      }
    }
  }
  const time = root => { const skeletons=palettes(root), start=performance.now();for(let f=0;f<2000;f++)for(const s of skeletons)s.update(); return {palettes:skeletons.size,updateMs:performance.now()-start}; };
  results.push({name,meshes:a.length,vertices,before:time(reference),after:time(actual)});
  // Disposing one actor must not dispose another actor's GPU palette.
  for(const s of palettes(other)) s.computeBoneTexture();
  const textures=[...palettes(other)].map(s=>s.boneTexture);let disposed=0;
  textures.forEach(t=>t.addEventListener('dispose',()=>disposed++));
  for(const s of palettes(actual))s.dispose();
  assert.equal(disposed,0);
}
// Identical joint names are insufficient: ordering and inverse binds must match.
const root=new THREE.Group(),x=new THREE.Bone(),y=new THREE.Bone();root.add(x,y);
const geometry=new THREE.BufferGeometry(),material=new THREE.MeshBasicMaterial();
const add=(bones,inverses)=>{const m=new THREE.SkinnedMesh(geometry,material);m.bind(new THREE.Skeleton(bones,inverses),new THREE.Matrix4());root.add(m);return m;};
add([x,y],[new THREE.Matrix4(),new THREE.Matrix4()]);
add([x,y],[new THREE.Matrix4(),new THREE.Matrix4().makeTranslation(1,0,0)]);
add([y,x],[new THREE.Matrix4(),new THREE.Matrix4()]);
assert.equal(palettes(cloneSkinnedAsset(root)).size,3);
console.log(JSON.stringify({results,elapsedSeconds:(performance.now()-started)/1000}));
