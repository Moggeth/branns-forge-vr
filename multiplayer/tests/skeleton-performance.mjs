import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {prepareAsset} from '../client/asset-pose.js';
import {createCombatView} from '../client/combat-view.js';
const b=readFileSync(new URL('../public/assets/skeleton.glb',import.meta.url));const template=await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
const scene=new T.Scene(),actors=new Map();let meshes=0,vertices=0,tris=0;template.scene.traverse(n=>{if(n.isMesh){meshes++;vertices+=n.geometry.attributes.position.count;tris+=(n.geometry.index?.count||n.geometry.attributes.position.count)/3;}});
for(let i=0;i<32;i++){const root=new T.Group(),visual=prepareAsset(template,'skeleton').visual;root.position.set((i%8-3.5)*3,0,(Math.floor(i/8)-1.5)*3);root.add(visual);scene.add(root);actors.set(`e:${i}`,{root,visual,enemy:true,data:{id:String(i)}});}
const view=createCombatView({scene,actors,templates:new Map()});
const t=performance.now();view.sync({enemies:[...actors.values()].map(a=>a.data)});const spawnSyncMs=performance.now()-t;
let skinnedVertices=0;for(const a of actors.values())a.visual.traverse(n=>{if(n.isSkinnedMesh){const original=n.getVertexPosition;n.getVertexPosition=function(...args){skinnedVertices++;return original.apply(this,args);};}});
let hits=0;const samples=[];for(let f=0;f<100;f++){view.tick(1/60);const t=performance.now();hits+=view.segmentContacts([30,1,30],[30,1,22],{includePartPoses:false}).length;samples.push(performance.now()-t);}
assert.equal(hits,0);assert.equal(skinnedVertices,0,'off-ray hover must reject without CPU skinning all enemy vertices');
samples.sort((a,b)=>a-b);console.log(JSON.stringify({meshes,vertices,tris,spawnSyncMs,skinnedVertices,missMeanMs:samples.reduce((a,b)=>a+b,0)/samples.length,missP95Ms:samples[95],hits}));view.dispose();
