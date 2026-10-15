import {Group} from 'three';

// A forest can contain thousands of copies of the same geometry/material.
// Compile each exact combination once, preserving skinning, morphs, instancing
// and all hidden first-use representatives. The real scene supplies its lights,
// fog and environment; no live node is reparented or hidden.
export async function compileWorld(renderer,scene,camera,stats={}, {batchSize=Infinity,yieldTask=()=>Promise.resolve(),compile=(root,eye,world)=>renderer.compileAsync(root,eye,world)}={}){
  const stage=new Group(),seen=new Set(),representatives=[];let objects=0;
  scene.traverse(object=>{
    if(!(object.isMesh||object.isPoints||object.isLine||object.isSprite))return;
    objects++;
    const variant=[object.type,object.geometry?.id,!!object.isSkinnedMesh,!!object.isInstancedMesh,!!object.isBatchedMesh,!!object.instanceColor,!!object.morphTexture,!!object._colorsTexture,!!object.receiveShadow,[object.material].flat().map(m=>m?.id).join(',')].join('|');
    if(seen.has(variant)||!object.material)return;seen.add(variant);representatives.push(object);
  });
  // A read-only traversal avoids cloning circular runtime userData or copying
  // instance buffers. compileAsync only traverses this view; the real scene
  // supplies all lights exactly once through its targetScene argument.
  stage.traverse=callback=>{callback(stage);for(const object of representatives)callback(object);};
  stage.traverseVisible=()=>{};
  stats.objects=objects;stats.representatives=representatives.length;
  const all=representatives.slice();
  try{for(let i=0;i<all.length;i+=batchSize){representatives.splice(0,representatives.length,...all.slice(i,i+batchSize));await compile(stage,camera,scene);if(i+batchSize<all.length)await yieldTask();}}finally{representatives.length=0;}
}
