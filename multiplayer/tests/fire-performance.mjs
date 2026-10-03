import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import * as T from 'three';
import {createFirePresentation} from '../client/fire-presentation.js';
import {stepFire} from '../shared/fire.js';
import {terrainHeight,createSunderRupture} from '../shared/terrain.js';
const start=performance.now(),report={suite:'fire-performance',visualCases:0,benchmarks:[],scale:[]};
const baselineArg=process.argv.find(a=>a.startsWith('--baseline='));let oldPresentation,oldEcology;
if(baselineArg){const ref=baselineArg.split('=')[1];assert.match(ref,/^[a-zA-Z0-9._/-]+$/);const source=file=>execFileSync('git',['show',ref+':multiplayer/'+file],{encoding:'utf8'}),load=source=>import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 oldPresentation=(await load(source('client/fire-presentation.js').replace("from 'three'","from '"+new URL('../node_modules/three/build/three.module.js',import.meta.url).href+"'"))).createFirePresentation;
 oldEcology=(await load(source('shared/fire.js').replace("from './combat.js'","from '"+new URL('../shared/combat.js',import.meta.url).href+"'"))).stepFire;report.baseline=ref;
}
const edits=Array.from({length:64},(_,i)=>({id:'e'+i,kind:i%2?'raise':'lower',x:(i%8)*2,z:Math.floor(i/8)*2,radius:6,height:i%2?2:-2}));
const cells=n=>Array.from({length:n},(_,i)=>({x:i%16*.5,z:Math.floor(i/16)*.5,fuel:.8,heat:1,burning:true,wetUntil:0,expiresTick:10000}));
const snapshot=n=>({tick:100,fireCells:cells(n),fireSurfaces:[],projectiles:Array.from({length:n},(_,i)=>({id:'q'+i,kind:'flame',position:[i%10,1,Math.floor(i/10)],velocity:[0,0,-10]}))});
const fuel=view=>view.group.children.find(n=>n.geometry?.attributes.aF).geometry;
function compareViews(a,b){const ga=fuel(a),gb=fuel(b);assert.equal(ga.drawRange.count,gb.drawRange.count);const count=ga.drawRange.count/96*25;for(const key of ['position','aF']){const aa=ga.attributes[key],bb=gb.attributes[key];for(let i=0;i<count*aa.itemSize;i++)assert.ok(Math.abs(aa.array[i]-bb.array[i])<1e-6,`${key}[${i}] visual geometry/gradient changed`);}for(const key of ['instances','draws','flame','ember','smoke','fuelTriangles'])assert.equal(a.stats()[key],b.stats()[key],key);report.visualCases++;}
for(const n of [1,10,100,500]){
 const state={edits:structuredClone(edits),tick:100};let reads=0;const height=(x,z)=>{reads++;return terrainHeight(state,x,z,false);},view=createFirePresentation({scene:new T.Scene(),height,terrainGrid:true}),old=oldPresentation?.({scene:new T.Scene(),height});
 const snap=snapshot(n),initialStart=performance.now();view.sync(snap);const initialSyncMs=performance.now()-initialStart;old?.sync(snap);view.update(0,1/60);old?.update(0,1/60);if(old)compareViews(old,view);
 const geometry=fuel(view),positions=geometry.attributes.position.array,attributes=geometry.attributes.aF.array,topologies=view.stats().topologyBuilds;
 reads=0;for(const c of snap.fireCells)c.fuel=.6;const changedStart=performance.now();view.sync(snap);const changeMs=performance.now()-changedStart;report.scale.push({requested:n,cells:view.stats().cells,packets:view.stats().packets,initialSyncMs,changeMs});assert.equal(reads,0,'burning fuel alone never resamples terrain');assert.equal(view.stats().topologyBuilds,topologies);old?.sync(snap);if(old)compareViews(old,view);
 // Same-count topology relocation, quenching, removal, and in-place terrain edits.
 snap.fireCells=snap.fireCells.map(c=>({...c,x:c.x+10}));view.sync(snap);old?.sync(snap);if(old)compareViews(old,view);assert.equal(view.stats().topologyBuilds,topologies+1);
 state.edits[0].height=5;view.invalidateTerrain();old?.invalidateTerrain();view.sync(snap);old?.sync(snap);if(old)compareViews(old,view);
 for(const c of snap.fireCells){c.burning=false;c.heat=0;}view.sync(snap);old?.sync(snap);view.update(50,1/60);old?.update(50,1/60);if(old)compareViews(old,view);
 snap.fireCells=[];view.sync(snap);old?.sync(snap);if(old)compareViews(old,view);
 assert.equal(geometry.attributes.position.array,positions);assert.equal(geometry.attributes.aF.array,attributes);assert.ok(view.stats().cachedGroundSamples<=32768);assert.ok(view.stats().cachedTerrainVertices<=32768);assert.ok(view.stats().cells<=256&&view.stats().packets<=96&&view.stats().instances<=768);
 view.dispose();old?.dispose();
}
function benchView(make,nEdits,n){let reads=0;const state={edits:nEdits?edits:[],tick:100},view=make({scene:new T.Scene(),terrainGrid:true,height:(x,z)=>{reads++;return terrainHeight(state,x,z,false);}}),snap=snapshot(n),times=[];
 for(let i=0;i<30;i++){for(const c of snap.fireCells)c.fuel=i%2?.74:.82;reads=0;const t=performance.now();view.sync(snap);if(i>=10)times.push(performance.now()-t);}const steadyReads=reads,t=performance.now();view.invalidateTerrain();view.sync(snap);const terrainChangedMs=performance.now()-t;
 const update=performance.now();for(let i=0;i<600;i++)view.update(i*16.67,1/60);const row={edits:nEdits,cells:n,meanSyncMs:times.reduce((a,b)=>a+b,0)/times.length,maxSyncMs:Math.max(...times),steadyHeightReads:steadyReads,terrainChangedMs,meanParticleMs:(performance.now()-update)/600};view.dispose();return row;}
for(const nEdits of [0,64])for(const n of [32,256])report.benchmarks.push({path:'fire-surface',before:oldPresentation?benchView(oldPresentation,nEdits,n):undefined,after:benchView(createFirePresentation,nEdits,n)});
function ecologyState(n=256){return {tick:0,edits:structuredClone(edits),fireCells:cells(n),fireSurfaces:[],players:[],enemies:[],shrine:{hp:100}};}
function benchEcology(fn){const s=ecologyState(),times=[];let reads=0;const ctx={terrainHeight:(state,x,z)=>{reads++;return terrainHeight(state,x,z);},damageEnemy(){},damageHero(){}};
 for(let i=0;i<50;i++){s.tick=i*6;s.fireCells=cells(256);reads=0;const t=performance.now();fn(s,ctx,[]);if(i>=10)times.push(performance.now()-t);}return {meanMs:times.reduce((a,b)=>a+b,0)/times.length,maxMs:Math.max(...times),heightReads:reads};}
report.benchmarks.push({path:'ecology',before:oldEcology?benchEcology(oldEcology):undefined,after:benchEcology(stepFire)});
if(oldEcology){const a=ecologyState(),b=structuredClone(a),ctx={terrainHeight,damageEnemy(){},damageHero(){}};for(let i=0;i<80;i++){a.tick=b.tick=i*6;if(i===25){a.edits[0].height=b.edits[0].height=-4;}if(i===50){a.edits=b.edits=[];}oldEcology(a,ctx,[]);stepFire(b,ctx,[]);assert.deepEqual(b,a,'same authoritative fuel/heat evolution');}}
// Active rupture advances and rewinds through the same explicit invalidation hook.
{
 const state={tick:0,edits:[{id:'s',kind:'sunder',x:5,z:5,radius:2.5,height:-1.5,rupture:createSunderRupture('s',[0,0,5],[10,0,5],0)}]},view=createFirePresentation({scene:new T.Scene(),terrainGrid:true,height:(x,z)=>terrainHeight(state,x,z,false)}),snap=snapshot(10);snap.fireCells=snap.fireCells.map(c=>({...c,x:c.x+3,z:5}));
 for(const tick of [0,20,40,70,10]){state.tick=tick;view.invalidateTerrain();view.sync(snap);const g=fuel(view),p=g.attributes.position,count=g.drawRange.count/96*25;for(let i=0;i<count;i++){const h=terrainHeight(state,p.getX(i),p.getZ(i),false),lift=p.getY(i)-h;assert.ok(lift>=.02999&&lift<=.04201,'fuel remains .03-.042m above real ground');}}view.dispose();
}
report.elapsedSeconds=(performance.now()-start)/1000;console.log(JSON.stringify(report,null,2));
