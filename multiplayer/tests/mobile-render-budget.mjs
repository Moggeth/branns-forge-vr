import assert from 'node:assert/strict';
import {createRenderBudget,renderSize} from '../client/render-budget.js';
import {createAssetQueue,prepareAssetTextures} from '../client/startup-work.js';

const q=createRenderBudget({mobile:true,dpr:3});
assert.equal(q.ratio(),1.25);
let now=0;
function run(seconds,frame,cpu,eligible=true){for(let i=0;i<seconds*1000/frame;i++){now+=frame;q.sample(now,frame,cpu,eligible);q.ratio(frame/1000);}}
run(2,40,32);assert.equal(q.stats().changes,0,'one busy window cannot toggle quality');
run(5,40,32);assert.ok(q.stats().target<1.25);
run(40,40,32);assert.equal(q.stats().target,1,'CPU-bound overload must not blur below CSS resolution');
const low=q.stats().target;run(10,16.667,8);assert.equal(q.stats().target,low,'recovery needs sustained headroom');
run(15,16.667,8);assert.ok(q.stats().target>low);
q.mode('clarity');run(60,40,32);assert.equal(q.stats().target,1.5,'manual override remains fixed');
q.mode('auto');const before=q.stats().target;run(90,100,80,false);assert.equal(q.stats().target,before,'background/menus cannot drag quality down');
q.mode('battery');run(1,16,8);assert.equal(q.stats().target,1);
assert.equal(q.mode('invalid'),false);
assert.deepEqual(renderSize(844,390,1),renderSize(844,390,1.001),'tiny quality deltas do not reallocate targets');

let running=0,peak=0;const order=[],blocked=[];
const queue=createAssetQueue({concurrency:2,yieldTask:()=>Promise.resolve()});
const jobs=[];
for(const [name,essential] of [['decoration',false],['world',true],['weapon',true],['enemy',true]]){
 jobs.push(queue.add(async()=>{order.push(name);peak=Math.max(peak,++running);await new Promise(r=>blocked.push(r));running--;},essential));
}
queue.start();await new Promise(r=>setTimeout(r,0));assert.deepEqual(order,['world','weapon']);
blocked.splice(0).forEach(r=>r());await new Promise(r=>setTimeout(r,0));assert.deepEqual(order,['world','weapon','enemy']);
blocked.splice(0).forEach(r=>r());await Promise.all(jobs.slice(1));assert.equal(queue.stats().pending,1);
queue.background();await new Promise(r=>setTimeout(r,0));blocked.splice(0).forEach(r=>r());await Promise.all(jobs);
assert.equal(peak,2);assert.equal(queue.stats().completed,4);

// Two maps sharing a GLTF texture source are resized/uploaded consistently.
let closed=0,uploads=0;const image={width:2048,height:1024,close(){closed++;}},source={data:image};
const a={isTexture:true,source},b={isTexture:true,source};
globalThis.createImageBitmap=async (input,opts)=>({width:opts.resizeWidth,height:opts.resizeHeight,close(){}});
const stats={};await prepareAssetTextures({traverse(fn){fn({material:{map:a,normalMap:b}});}}, {renderer:{initTexture(){uploads++;}},maxSize:1024,stats,yieldTask:()=>Promise.resolve()});
assert.equal(source.data.width,1024);assert.equal(source.data.height,512);assert.equal(closed,1);assert.equal(uploads,2);assert.equal(stats.texturesResized,1);
console.log('mobile-render-budget: stable pacing policy, overrides, resize quantization, progressive queue and texture budget passed');

const gpu=createRenderBudget({mobile:true,dpr:3});for(let t=0;t<60000;t+=40)gpu.sample(t,40,8);assert.equal(gpu.stats().target,.75,'GPU-limited rendering may use the lower resolution range');

// Rotation during an asynchronous warm draw must not restore the old viewport.
const T=await import('three'),{warmRender}=await import('../client/warm-render.js');
const scene=new T.Scene(),mesh=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial());scene.add(mesh);
mesh.layers.set(2);const camera=new T.PerspectiveCamera(),viewport=new T.Vector4(0,0,320,240),scissor=viewport.clone();let target=null;
const renderer={domElement:{width:320,height:240},shadowMap:{needsUpdate:false},getPixelRatio:()=>1,
 getRenderTarget:()=>target,setRenderTarget:v=>{target=v;},getViewport:v=>v.copy(viewport),getScissor:v=>v.copy(scissor),getScissorTest:()=>false,
 setViewport:(...v)=>v[0]?.isVector4?viewport.copy(v[0]):viewport.set(...v),setScissor:()=>{},setScissorTest:()=>{},render:()=>{renderer.domElement.width=640;renderer.domElement.height=360;}};
globalThis.requestAnimationFrame=fn=>setTimeout(fn,0);
await warmRender({renderer,scene,camera});assert.deepEqual(viewport.toArray(),[0,0,640,360]);assert.equal(mesh.layers.mask,4);assert.equal(mesh.frustumCulled,true);
renderer.render=()=>{throw Error('draw failure')};await assert.rejects(warmRender({renderer,scene,camera}),/draw failure/);
assert.equal(mesh.layers.mask,4,'failed preparation restores layers');assert.equal(mesh.frustumCulled,true);mesh.geometry.dispose();mesh.material.dispose();

// HDR startup must prepare the same target/color variants used during play.
const hdr={name:'actual-hdr'},priorTarget={name:'previous'},targets=[];target=priorTarget;
renderer.render=()=>targets.push(target);renderer.domElement.width=640;renderer.domElement.height=360;
await warmRender({renderer,scene,camera,target:hdr});
assert.deepEqual(targets,[hdr]);assert.equal(target,priorTarget,'HDR warmup restores prior target');
