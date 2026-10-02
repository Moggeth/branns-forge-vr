import assert from 'node:assert/strict';import * as T from 'three';import{createSpellPresentation}from '../client/spell-presentation.js';import{SPELLS}from '../shared/spells.js';
const scene=new T.Scene(),fx=createSpellPresentation({scene,height:(x,z)=>Math.sin(x)*.5,tickSeconds:1/60});
let time=0;for(const spec of SPELLS){fx.setTarget({spell:spec.id,point:[1,0,2],start:[-3,0,0],end:[3,0,0],valid:true});assert.equal(fx.play({spell:spec.id,id:spec.id,position:[1,0,2],start:[-3,0,0],end:[3,0,0]}),true);for(let j=0;j<10;j++)fx.update(time+=16.667,1/60);}
for(let i=0;i<64;i++)fx.play({spell:'raise',id:'burst'+i,position:[i%5,0,0]});assert.ok(fx.stats().events<=32);assert.ok(fx.stats().particles.total<=512);
scene.traverse(node=>{if(node.geometry?.attributes.position){assert.ok([...node.geometry.attributes.position.array].every(Number.isFinite),node.name+' finite vertices');}});
fx.setTarget(null);for(let j=0;j<900;j++)fx.update(time+=16.667,1/60);assert.equal(fx.stats().events,0);assert.equal(fx.stats().particles.total,0);fx.dispose();assert.equal(scene.children.length,0);console.log('spell-presentation:14effects,finitevertices,boundedburst,expiryanddisposalpass');

// Shader preparation must not briefly show phantom spells or consume effect slots.
const warmScene=new T.Scene(),warmFx=createSpellPresentation({scene:warmScene,height:()=>0});
const warmCamera=new T.PerspectiveCamera();let geometryReleased=false,previewRoot;
await warmFx.prepareShaders({compileAsync:async(preview,camera,target)=>{
  previewRoot=preview;assert.equal(preview.parent,null);assert.equal(target,warmScene);assert.equal(camera,warmCamera);
  assert.ok(preview.children.some(n=>n.isInstancedMesh&&n.instanceColor));
  preview.children[0].geometry.addEventListener('dispose',()=>geometryReleased=true);
  assert.equal(warmFx.stats().events,0);assert.equal(warmFx.stats().particles.total,0);
}},warmCamera,warmScene);
assert.equal(geometryReleased,true);assert.equal(previewRoot.children.length,0);
await assert.rejects(warmFx.prepareShaders({compileAsync:async()=>{throw new Error('compile failed');}},warmCamera,warmScene),/compile failed/);
assert.equal(warmFx.stats().events,0);assert.equal(warmScene.children.length,1);
warmFx.dispose();assert.equal(warmScene.children.length,0);
console.log('shader preparation: no world events, detached representatives, cleanup on completion/failure');
