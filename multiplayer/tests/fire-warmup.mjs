import assert from 'node:assert/strict';
import * as T from 'three';
import {createFirePresentation} from '../client/fire-presentation.js';
const start=performance.now(),scene=new T.Scene(),view=createFirePresentation({scene,height:()=>0});
// Startup compiles hidden effects and uploads their real buffers without leaving
// fire visible or leaking render target / viewport changes, including failures.
const v=new T.Vector4(2,3,80,90),sc=new T.Vector4(4,5,60,70),originalTarget={name:'original'};
let target=originalTarget,currentViewport=v.clone(),currentScissor=sc.clone(),scissorOn=true,compiled=0,drawn=0,throwDraw=false;
const renderer={compileAsync:async(preview,camera,world)=>{compiled=preview.children.length;assert.equal(world,scene);assert.ok(preview.children.every(m=>m.visible));},getRenderTarget:()=>target,getViewport:o=>o.copy(currentViewport),getScissor:o=>o.copy(currentScissor),getScissorTest:()=>scissorOn,setRenderTarget:t=>target=t,setViewport:o=>currentViewport.copy(o),setScissor:o=>currentScissor.copy(o),setScissorTest:v=>scissorOn=v,render:()=>{drawn++;assert.equal(target.width,1);assert.equal(target.height,1);const meshes=scene.getObjectByName('FirePresentation').children.filter(o=>o.isMesh);assert.equal(meshes.filter(o=>o.visible).length,4);assert.ok(meshes.every(m=>m.geometry.isInstancedBufferGeometry?m.geometry.instanceCount>=1:m.geometry.drawRange.count>=6));if(throwDraw)throw Error('synthetic warm draw failure');}};
await view.prepareShaders(renderer,new T.PerspectiveCamera(),scene);
assert.equal(compiled,4);assert.equal(drawn,1);assert.equal(target,originalTarget);assert.deepEqual(currentViewport,v);assert.deepEqual(currentScissor,sc);assert.equal(scissorOn,true);assert.equal(view.stats().draws,0);
throwDraw=true;await assert.rejects(view.prepareShaders(renderer,new T.PerspectiveCamera(),scene),/synthetic warm draw failure/);assert.equal(target,originalTarget);assert.equal(view.stats().draws,0);assert.equal(scissorOn,true);
view.dispose();
console.log(`Fire warmup: hidden shader compilation, real buffer upload and failure cleanup pass (${((performance.now()-start)/1000).toFixed(3)}s)`);
