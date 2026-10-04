import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as T from 'three';
import {loadGLB} from './glb.mjs';
import {worldTrees} from '../shared/world-content.js';
import * as R from '../shared/trees.js';
import {bakeTriangles,buildFelled,buildTimberSection,fitEndcapUV,audit} from '../client/tree-carve.js';
const start=performance.now();
const endcap=loadGLB(fileURLToPath(new URL('../public/assets/endcap.glb',import.meta.url)));
let cap;endcap.scene.traverse(o=>{if(o.isMesh)cap=o;});const uv=fitEndcapUV(cap);
let cases=0;
for(const variant of [0,1,2]){
 const kit=loadGLB(fileURLToPath(new URL(`../public/assets/${R.VARIANTS[variant]}.glb`,import.meta.url))),root=kit.scene.getObjectByName('Tree');
 let trunk;root.getObjectByName('Trunk').traverse(o=>{if(o.isMesh&&!trunk)trunk=o;}); // the trunk mesh itself (tree-view takes the first; oak ivy rides as a child)
 const triangles=bakeTriangles(trunk,root);
 for(const scale of [.7,1,1.4]){
  const tree={id:'tree1',variant,x:-2,z:6,height:R.TREE_PROFILES[R.VARIANTS[variant]].height*scale};
  const counts=[];
  for(const h of [.4,1,1.6]){
   const cut={id:'tree1',cuts:3,felledTick:100,cutHeight:h*scale,fallYaw:.8,landed:false},sections=R.timberSections(tree,cut,0);counts.push(sections.length);
   const notch=R.notchFor(tree,cut,0);for(const k of ['height','radius','depth','hinge'])notch[k]/=scale;
   const top=buildFelled(triangles,notch,uv).top;
   const fall=R.treeFall(tree,cut,100,0,()=>0),q=new T.Quaternion(...R.timberPose(tree,fall,0,0).quaternion);
   const hinge=new T.Vector3(...fall.hinge),treeOrigin=new T.Vector3(tree.x,0,tree.z);
   assert.equal(fall.doneTicks,fall.landTicks,'no static settle wait');
   for(let i=0;i<sections.length;i++){
    const piece=sections[i],mesh=buildTimberSection(top,...piece.section,uv,piece.radius/scale);
    if(i)assert.equal(sections[i-1].section[1],piece.section[0]);
    const auditResult=audit([...mesh.bark,...mesh.wood]);assert.equal(auditResult.open.length,0,`closed timber ${variant}/${h}/${i}`);
    const pose=R.timberPose(tree,fall,0,piece.center);
    for(const v of mesh.bark.flat()){
     const before=new T.Vector3(...v.p).multiplyScalar(scale).sub(hinge).applyQuaternion(q).add(hinge).add(treeOrigin);
     const after=new T.Vector3(...v.p).multiplyScalar(scale).sub(new T.Vector3(0,piece.center,0)).applyQuaternion(q).add(new T.Vector3(...pose.position));
     assert.ok(before.distanceTo(after)<1e-12,'every retained bark vertex continuous at release');
    }
   }
   cases++;
  }
  assert.ok(counts[0]>counts[2],`low cuts reward more lumber ${counts}`);
 }
}
// Host first-contact tick releases once at the exact mesh pose; capped physical logs conserve reward as pickup.
const state={seed:7,tick:100,groves:[],harvestedTrees:[],looseLogs:[],players:[]},tree=worldTrees(state)[0];
for(let i=0;i<3;i++)R.chopTree(state,tree,[tree.x,.5,tree.z+R.trunkRadius(tree,.5)],[0,0,1],{terrainHeight:()=>0});
const cut=state.harvestedTrees[0],f=R.treeFall(tree,cut,100,0,()=>0),index=R.createTreeIndex();let seq=0;
const ctx={terrainHeight:()=>0,nextId:()=>`log${++seq}`},events=[];
state.tick=100+f.landTicks-1;R.stepTrees(state,ctx,index,events);assert.equal(state.looseLogs.length,0);
state.tick++;R.stepTrees(state,ctx,index,events);const sections=R.timberSections(tree,cut,0);assert.equal(state.looseLogs.length,sections.length);
for(let i=0;i<sections.length;i++)assert.deepEqual(state.looseLogs[i].position,R.timberPose(tree,f,0,sections[i].center).position);
assert.equal(events.filter(e=>e.kind==='tree_land').length,1);
assert.deepEqual(R.restoreLogs(state,new Set()),state.looseLogs);
const bad=structuredClone(state);bad.looseLogs[0].section[1]=NaN;assert.throws(()=>R.restoreLogs(bad,new Set()));
console.log(`timber-continuity: ${cases} scaled/variant/cut cases; closed meshes, exact vertex handoff, higher low-cut yield, release tick, save validation passed ${(performance.now()-start).toFixed(1)}ms`);
