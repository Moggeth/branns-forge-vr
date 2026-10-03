import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createWorldContent} from '../client/world-content-view.js';
import {createSimulation} from '../shared/simulation.js';
import {geodeLightGlobalStats,GEODE_LIGHT_BUDGET} from '../client/geode-light.js';

// Parse the real authored GLB geometry/material topology. Textures need a browser
// image decoder and are irrelevant to fracture geometry, ownership and draw caps.
async function asset(name){
 const data=await readFile(new URL(`../public/assets/${name}.glb`,import.meta.url));
 const loader=new GLTFLoader();loader.register(()=>({name:'TestTextureDecoder',loadTexture:()=>Promise.resolve(null)}));
 return await loader.parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'');
}
const templates=new Map(await Promise.all(['meteor','boulder'].map(async name=>[name,await asset(name)])));
const deposit=(id,x,hits=1,kind='meteor')=>({id,x,z:0,hits,kind,maxHits:kind==='meteor'?5:3,depleted:false});
function fixture(deposits){
 const scene=new T.Scene(),camera=new T.PerspectiveCamera();camera.position.set(0,1.6,0);scene.add(camera);
 const state=createSimulation().snapshot();state.deposits=deposits;
 const view=createWorldContent({scene,templates,instantiate:()=>null,height:()=>0,camera});
 view.sync(state);view.tick(0);view.tick(100);return {scene,camera,state,view};
}
test('real StarShard saved damage opens light only in fracture holes and preserves shared assets',()=>{
 const source=[];for(const {scene} of templates.values())scene.traverse(n=>{if(n.isMesh)source.push({mesh:n,geometry:n.geometry,material:n.material,visible:n.visible});});
 let sourceDisposals=0;for(const e of source)e.geometry.addEventListener('dispose',()=>sourceDisposals++);
 const f=fixture([deposit('star',3,2),deposit('intactStar',5,0),deposit('stone',7,1,'stone')]);
 try{
  const stats=f.view.stats(),lights=stats.geodeLights;
  assert.equal(lights.users,1);assert.equal(lights.geodes[0].id,'star');assert.ok(lights.geodes[0].holes>0);assert.ok(lights.geodes[0].fractureRemoved>0);
  assert.equal(lights.geodes[0].draws,2);assert.ok(stats.fractures.every(x=>x.chips===0),'restored damage never spawns replay chips');
  const shells=[];f.scene.traverse(n=>{if(n.userData.geodeLight)shells.push(n);});assert.equal(shells.length,2);
  assert.ok(shells.every(n=>n.material.depthTest&&!n.material.depthWrite&&!n.castShadow&&n.userData.ignoreContact));
  assert.ok(shells.every(n=>n.count>0&&n.count<=10));
  const interiors=new Set();f.scene.traverse(n=>{if(n.material?.name==='FractureInterior')interiors.add(n.material);});
  assert.equal([...interiors].filter(m=>m.emissive.getHex()>0).length,1,'only the StarShard chamber glows; ordinary stone stays unlit');
  assert.equal([...interiors].find(m=>m.emissive.getHex()>0).emissiveIntensity,.06+.36*.4);
  const holes=lights.geodes[0].holes;f.state.deposits[0].hits=4;f.view.sync(f.state);f.view.tick(200);
  assert.ok(f.view.stats().geodeLights.geodes[0].holes>=holes);assert.equal(f.view.stats().geodeLights.geodes[0].level,.8);
  f.state.deposits[0].hits=0;f.view.sync(f.state);assert.equal(f.view.stats().geodeLights.users,0,'rewinding damage rebuilds intact geometry and releases light');
  f.state.deposits[0].hits=3;f.view.sync(f.state);f.view.tick(300);assert.equal(f.view.stats().geodeLights.users,1);
  f.state.deposits[0].depleted=true;f.view.sync(f.state);assert.equal(f.view.stats().geodeLights.users,0,'depletion releases both light draws');
 }finally{f.view.dispose();}
 for(const e of source){assert.equal(e.mesh.geometry,e.geometry);assert.equal(e.mesh.material,e.material);assert.equal(e.mesh.visible,e.visible);}
 assert.equal(sourceDisposals,0);assert.equal(geodeLightGlobalStats().users,0);assert.equal(geodeLightGlobalStats().lit,0);
});
test('nearest twelve damaged geodes get at most twenty-four extra draws and distant deposits switch off',()=>{
 const f=fixture(Array.from({length:25},(_,i)=>deposit(`star${i+1}`,i+1,3)));
 try{
  const lit=()=>f.view.stats().geodeLights.geodes.filter(g=>g.lit);
  assert.equal(lit().length,GEODE_LIGHT_BUDGET);assert.equal(lit().reduce((n,g)=>n+g.draws,0),24);
  assert.deepEqual(lit().map(g=>g.id),Array.from({length:12},(_,i)=>`star${i+1}`));
  f.camera.position.x=30;f.view.tick(200);assert.deepEqual(lit().map(g=>g.id),Array.from({length:12},(_,i)=>`star${i+14}`),'priority changes in the same frame without old-slot starvation');
  f.camera.position.x=100;f.view.tick(300);assert.equal(lit().length,0);assert.equal(f.view.stats().geodeLights.geodes.reduce((n,g)=>n+g.draws,0),0);
  f.camera.position.x=0;f.view.tick(400);assert.equal(lit().length,12);
 }finally{f.view.dispose();}
 assert.deepEqual(geodeLightGlobalStats(),{users:0,lit:0,budget:12,programs:0});
});
