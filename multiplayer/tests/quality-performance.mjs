// Exact pre-optimization oracle, randomized contact equivalence, and measured CPU work.
// No screenshots or hardware FPS claims are inferred from this test.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {terrainHeight,createSunderRupture} from '../shared/terrain.js';
import {createTerrainSampler} from '../shared/terrain-sampler.js';
import {createTreeIndex,resolveTrees} from '../shared/trees.js';
import {keepCarve} from '../shared/keep-sites.js';
const start=performance.now(),reference='51e9e98';
async function before(file){
 const source=execFileSync('git',['show',`${reference}:multiplayer/shared/${file}`],{encoding:'utf8'}).replace(/from ['"](\.\/[^'"]+)['"]/g,(_,p)=>`from '${new URL('../shared/'+p,import.meta.url).href}'`);
 return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
}
const oldTerrain=await before('terrain.js'),oldTrees=await before('trees.js');
const state={seed:41,tick:40,edits:Array.from({length:64},(_,i)=>({id:'e'+i,kind:['raise','lower','axe_sunder','pick_wall'][i%4],x:i%8*9-31.5,z:Math.floor(i/8)*9-31.5,radius:i%5+1,height:i%2?-.4:2})),groves:Array.from({length:32},(_,i)=>({id:'g'+i,kind:'ring',x:i%8*8-28,z:Math.floor(i/8)*8-12})),bridges:[]};
const sampler=createTerrainSampler(state),points=[];
for(let i=0;i<4000;i++)points.push([(i*613%12300)/100-61.5,(i*397%12300)/100-61.5]);
points.push([60,60],[-60,-60],[0,0],[4,0],[7,0],[46,50]);
// The ring keeps (2026-10-08) deliberately reshaped their corners; the oracle covers the rest of the map.
const carved=(x,z)=>[-.8,0,.8].some(a=>[-.8,0,.8].some(b=>keepCarve(x+a,z+b))); // any grid corner of the triangle
for(let i=points.length-1;i>=0;i--)if(carved(...points[i]))points.splice(i,1);
let exact=0;
function verify(){sampler.setState(state);for(const [x,z] of points){const expected=oldTerrain.terrainHeight(state,x,z,false);assert.equal(terrainHeight(state,x,z,false),expected,'kernel broad phase must preserve exact height');assert.equal(sampler.height(x,z),expected,`cached height ${x},${z},tick ${state.tick}`);exact++;}}
verify();const cold=sampler.stats().samples;verify();assert.equal(sampler.stats().samples,cold,'unchanged snapshots must retain vertices');
state.edits[0].height=-2;state.edits[0].x+=3;verify();
state.edits.splice(3,1);verify();
state.edits=[{id:'progress',kind:'sunder',x:15,z:0,radius:4,height:-2,rupture:createSunderRupture('r',[10,0],[20,0],40)},...state.edits];
for(const tick of [40,41,60,80,105,200]){state.tick=tick;verify();}
state.edits=[];verify(); // reset removes every old cached crater
const index=createTreeIndex();index.update(state);const cuts=new Map(index.all().filter((t,i)=>i%3===0).map(t=>[t.id,{cuts:3,felledTick:1,cutHeight:1}]));
let baselineReads=0,optimizedReads=0,collisions=0;
for(const tree of index.all())for(const offset of [-2,-.42,0,.42,2])for(const y of [0,.7,2.6]){
 const a=[tree.x+offset,y,tree.z+.05],b=[...a];
 oldTrees.resolveTrees(a,index,cuts,(x,z)=>{baselineReads++;return terrainHeight(state,x,z,false);});
 resolveTrees(b,index,cuts,(x,z)=>{optimizedReads++;return terrainHeight(state,x,z,false);});
 assert.deepEqual(b,a,'tree collision broad phase must preserve exact displacement');collisions++;
}
assert.ok(optimizedReads<baselineReads*.3);
state.edits=Array.from({length:64},(_,i)=>({id:'e'+i,kind:'raise',x:i%8*9-31.5,z:Math.floor(i/8)*9-31.5,radius:4,height:2}));sampler.setState(state);
const bench=fn=>{const t=performance.now();let sum=0;for(let r=0;r<5;r++)for(const [x,z] of points)sum+=fn(x,z);return {ms:performance.now()-t,sum};};
const original=bench((x,z)=>oldTerrain.terrainHeight(state,x,z,false)),broadphase=bench((x,z)=>terrainHeight(state,x,z,false)),cached=bench((x,z)=>sampler.height(x,z));
assert.equal(cached.sum,original.sum);assert.equal(broadphase.sum,original.sum);
console.log(JSON.stringify({reference,exactHeightComparisons:exact,collisionComparisons:collisions,baselineReads,optimizedReads,original,broadphase,cached,cache:sampler.stats(),elapsedMs:performance.now()-start}));
