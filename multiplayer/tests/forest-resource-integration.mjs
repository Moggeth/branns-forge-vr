import assert from 'node:assert/strict';
import * as T from 'three';
import {createWorldContent} from '../client/world-content-view.js';
const start=performance.now(),scene=new T.Scene(),templates=new Map();
const view=createWorldContent({scene,templates,height:()=>0});
const s={seed:3,tick:1,edits:[],groves:[],harvestedTrees:[],looseLogs:[],deposits:['iron','mithril','crystal'].map((kind,i)=>({id:'ore'+i,kind,x:i*3,z:0,hits:0,maxHits:5})),pickups:['ironOre','mithrilOre','starOre','iron','mithril','starMetal','gems','apple','stone'].map((kind,i)=>({id:'pick'+i,kind,x:i,z:5,amount:1})),bridges:[],inventions:{structures:[]}};
view.sync(s);view.tick(1000,60);const stats=view.stats();assert.equal(stats.resourceModels.length,10,'3 authored deposits and 7 resources, no primitive apple/stone fallback');assert.equal(view.collectibleTargets().length,7);assert.equal(view.targets().length,3);
for(const model of view.collectibleTargets()){assert.equal(model.userData.authoredPickup,true);assert.ok(model.userData.resourceArt);model.traverse(m=>{if(m.isMesh)for(const a of Object.values(m.geometry.attributes))assert.ok(a.array.every(Number.isFinite));});}
const tris=stats.resourceArt.triangles;s.deposits.forEach(d=>d.hits=2);view.sync(s);view.tick(1100,66);assert.equal(view.stats().fractures.length,3);for(const f of view.stats().fractures)assert.ok(f.removed>0);
const authored=new T.Group();authored.add(new T.Mesh(new T.BoxGeometry(.2,.2,.2),new T.MeshStandardMaterial()));templates.set('orchard_apple',{scene:authored});templates.set('stone_chunk',{scene:authored});view.reload();assert.equal(view.collectibleTargets().length,9,'authored late arrivals appear');assert.equal(view.stats().resourceArt.triangles,tris,'reload retains shared authored resources');
s.deposits=[];s.pickups=[];view.sync(s);view.tick(1200,72);assert.equal(view.collectibleTargets().length,0);assert.equal(view.stats().fractures.length,0);view.dispose();assert.equal(view.stats().resourceArt.geometries,0);authored.children[0].geometry.dispose();authored.children[0].material.dispose();
console.log(JSON.stringify({suite:'forest-resource-integration',ok:true,seconds:(performance.now()-start)/1000,checks:['authored resource selection','distinct ore/refined/crystal','no primitive loading fallback','finite geometry','progressive fracture','asset reload','shared geometry lifecycle']}));
