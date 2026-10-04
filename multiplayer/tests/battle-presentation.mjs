import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createInventionView} from '../client/invention-view.js';
import {decideCue} from '../client/interaction-cue.js';

const scene=new THREE.Scene(),view=createInventionView({scene});
const bases=['party','rivals'].map((side,i)=>({id:`battle-base-${side}`,side,position:[i?20:-20,0,0],hp:400,maxHp:400}));
const state={seed:1,tick:0,edits:[],players:[],pickups:[],battle:{status:'running',bases}};
view.sync(state);
assert.equal(view.targets().length,2);
for(const base of bases){
 const target=view.targets().find(o=>o.name===base.id);
 assert.equal(target.userData.inventionType,'sanctuary');
 assert.ok(target.children.length>15,'uses the authored sanctuary assembly');
 target.updateWorldMatrix(true,true);
 const from=target.position.clone().add(new THREE.Vector3(1.6,1.4,5));
 const hits=new THREE.Raycaster(from,new THREE.Vector3(0,0,-1),0,8).intersectObject(target,true);
 assert.ok(hits.length,'actual objective geometry receives ranged and physical contacts');
 assert.equal(hits[0].object.userData.targetId,base.id);
}
const hero={id:'p',position:[0,0,2],yaw:0,side:'party',resources:{},tool:'axe'};
const base={...bases[1],position:[0,0,0],hp:150};
const snapshot={...state,battle:{status:'running',bases:[base]},looseLogs:[],detachedParts:[],pickups:[],enemies:[]};
const aim={origin:[0,1.6,2],direction:[0,0,-1],hit:{targetId:base.id,point:[0,1,0],distance:2}};
const mode={active:true,role:'hero',mode:'touch'};
let cue=decideCue(mode,hero,snapshot,aim,{});
assert.equal(cue.action,'Attack this sanctuary');assert.equal(cue.control,'Attack');assert.equal(cue.progress.done,150);
cue=decideCue(mode,{...hero,side:'rivals'},snapshot,aim,{});
assert.equal(cue.action,'Defend this sanctuary');assert.equal(cue.control,'');
view.sync({...state,battle:{status:'off',bases:[]}});
assert.equal(view.targets().length,0,'disabling mode removes objectives and contacts');
view.dispose();
console.log('Battle presentation: authored objectives, geometry contacts, side-aware cues, teardown passed');
