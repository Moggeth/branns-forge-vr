// Prepared matrix reads must preserve the exact authored pose while avoiding
// repeated ancestor refreshes during VR IK. Uses actual shipped hero geometry.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {loadGlb} from './glb-node.mjs';
import {createHeroView} from '../client/hero-view.js';
const started=performance.now(),sourceURL=new URL('../client/hero-view.js',import.meta.url);
let reference=readFileSync(sourceURL,'utf8');
for(const [from,to] of [
 ['function preparedPosition(node,out){return out.setFromMatrixPosition(node.matrixWorld);}','function preparedPosition(node,out){return node.getWorldPosition(out);}'],
 ['function preparedQuaternion(node,out){node.matrixWorld.decompose(_matrixPosition,out,_matrixScale);return out;}','function preparedQuaternion(node,out){return node.getWorldQuaternion(out);}'],
]){assert.ok(reference.includes(from),'reference fallback anchor');reference=reference.replace(from,to);}
reference=reference.replace(/from '([^']+)'/g,(_,spec)=>`from '${spec.startsWith('.')?new URL(spec,sourceURL).href:import.meta.resolve(spec)}'`);
const {createHeroView:slowView}=await import('data:text/javascript;base64,'+Buffer.from(reference).toString('base64'));
const template=await loadGlb(new URL('../public/assets/hero.glb',import.meta.url));
function crowd(factory){const view=factory(),scene=new THREE.Scene(),entries=[];view.install(template);
 for(let i=0;i<32;i++){const root=new THREE.Group();root.position.set(i%8*3-12,0,Math.floor(i/8)*3-8);scene.add(root);const data={id:'p'+i,role:'hero',hp:100,tool:'axe'};const visual=view.create(data);root.add(visual);entries.push({root,data,visual});}
 return {view,scene,entries};}
const old=crowd(slowView),fast=crowd(createHeroView),camera=new THREE.Vector3(0,2,10),q=new THREE.Quaternion(),euler=new THREE.Euler();
function update(c,f){c.scene.rotation.y=Math.sin(f*.01)*.2;c.scene.position.x=Math.sin(f*.03)*.5;
 for(let i=0;i<c.entries.length;i++){const e=c.entries[i];e.root.position.z+=i%3?.02:0;e.root.rotation.y=i%2?0:Math.sin(f*.01);
  // VR crouch/reach/head turn, FPS transition, translated and rotating parent,
  // crossing existing LOD threshold, hit and attack evidence, then VR again.
  e.data.hp=f>=60?80:100;
  if(i%2&&!(f>=90&&f<110)){e.data.head={position:[Math.sin(f*.04)*.1,1.45+Math.sin(f*.03)*.2,0],quaternion:q.setFromEuler(euler.set(Math.sin(f*.01)*.3,Math.sin(f*.02),.1,'YXZ')).toArray()};e.data.hands=[{position:[-.3,1.1,-.4],quaternion:[0,0,0,1]},{position:[.3,1.3,-.4-Math.sin(f*.03)*.1],quaternion:[0,0,0,1]}];}
  else{delete e.data.head;delete e.data.hands;}
  if(f===45)c.view.trigger(e.visual,'Attack');
  c.view.update(e.visual,e.data,e.root,1/60,camera);
 }
 c.scene.updateMatrixWorld(true);
}
let matrices=0;
for(let f=0;f<160;f++){update(old,f);update(fast,f);
 for(let i=0;i<32;i++){const a=old.entries[i].visual.userData,b=fast.entries[i].visual.userData;
  for(const name of Object.keys(a.bones)){const x=a.bones[name].matrixWorld.elements,y=b.bones[name].matrixWorld.elements;
   for(let j=0;j<16;j++)assert.ok(Math.abs(x[j]-y[j])<1e-12,`pose frame${f} hero${i} bone${name} component${j}: ${x[j]} / ${y[j]}`);matrices++;}
  assert.equal(a.lod,b.lod);assert.deepEqual(a.look,b.look);
 }}
function measure(c){const original=THREE.Object3D.prototype.updateWorldMatrix;let ancestors=0;THREE.Object3D.prototype.updateWorldMatrix=function(...args){ancestors++;return original.apply(this,args);};
 const samples=[];try{for(let f=160;f<400;f++){const t=performance.now();update(c,f);samples.push(performance.now()-t);}}finally{THREE.Object3D.prototype.updateWorldMatrix=original;}
 samples.sort((a,b)=>a-b);return {meanMs:samples.reduce((a,b)=>a+b,0)/samples.length,p95Ms:samples[Math.floor(samples.length*.95)],worldMatrixCalls:ancestors};}
const before=measure(old),after=measure(fast);assert.ok(after.worldMatrixCalls<before.worldMatrixCalls*.5,'skip redundant ancestor updates without dropping pose work');
console.log(JSON.stringify({heroes:32,vrHeroes:16,poseMatricesCompared:matrices,before,after,elapsedMs:performance.now()-started}));
old.view.dispose();fast.view.dispose();
