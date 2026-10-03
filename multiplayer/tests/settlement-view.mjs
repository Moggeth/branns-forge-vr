import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createSettlementView} from '../client/settlement-view.js';
test('worker view waits for shared hero asset, animates attributed work and releases only its clones',()=>{
 const scene=new THREE.Scene(),calls=[];let ready=false;
 const heroView={ready:()=>ready,create:(data)=>ready?new THREE.Group():null,update:(g,d)=>calls.push(['update',d.tool]),event:(g,e,d)=>calls.push(['event',d.id]),release:g=>{calls.push(['release']);g.removeFromParent();},dispose:()=>assert.fail('shared templates belong to the game')};
 const view=createSettlementView({scene,heroView}),worker={id:'worker1',position:[1,0,6],yaw:.3,job:'wood',phase:'working',cargo:0};
 view.sync({settlement:{workers:[worker]}});assert.equal(view.stats().workers,0);ready=true;view.update(.016,new THREE.Vector3());assert.equal(view.stats().workers,1);assert.equal(scene.children[0].userData.workerId,'worker1');
 view.event({kind:'wood_hit',by:'someone_else'});view.event({kind:'wood_hit',by:'worker1'});assert.equal(calls.filter(c=>c[0]==='event').length,1);
 view.sync({settlement:{workers:[{...worker,job:'stone'}]}});view.update(.016,new THREE.Vector3());assert.equal(calls.at(-1)[1],'pick');
 view.sync({settlement:{workers:[]}});assert.equal(scene.children.length,0);view.dispose();assert.equal(calls.filter(c=>c[0]==='release').length,1);
});
