import assert from 'node:assert/strict';
import * as T from 'three';
import {compileWorld} from '../client/compile-world.js';
const scene=new T.Scene(),geometry=new T.BoxGeometry(),material=new T.MeshStandardMaterial(),camera=new T.PerspectiveCamera();
const originals=[];
for(let i=0;i<100;i++){const mesh=new T.Mesh(geometry,material);mesh.userData.circular=mesh;scene.add(mesh);originals.push(mesh);}
const instances=new T.InstancedMesh(geometry,material,1),colored=new T.InstancedMesh(geometry,material,1),skin=new T.SkinnedMesh(geometry,material),other=new T.Mesh(geometry,material.clone());
colored.setColorAt(0,new T.Color('red'));other.visible=false;scene.add(instances,colored,skin,other,new T.DirectionalLight());
const initial=[...scene.children],stats={};let calls=0;
await compileWorld({async compileAsync(stage,eye,target){
  calls++;assert.equal(target,scene);assert.equal(eye,camera);
  const compiled=[];stage.traverse(node=>{if(node.material)compiled.push(node);});
  assert.deepEqual(compiled,[originals[0],instances,colored,skin,other]);
  let lights=0;stage.traverseVisible(()=>lights++);assert.equal(lights,0,'target scene supplies lights once');
  assert.ok(compiled.every(node=>node.parent===scene),'use original variant without moving it');
}},scene,camera,stats);
assert.equal(calls,1);assert.equal(stats.objects,104);assert.equal(stats.representatives,5);
assert.deepEqual(scene.children,initial);assert.equal(other.visible,false);
await assert.rejects(compileWorld({compileAsync:async()=>{throw Error('shader failure');}},scene,camera),/shader failure/);
assert.deepEqual(scene.children,initial);geometry.dispose();material.dispose();other.material.dispose();
console.log('compile-world: repeated geometry/materials compile once; exact hidden/skin/instance variants and live graph retained');
