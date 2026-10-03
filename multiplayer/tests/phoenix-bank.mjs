import assert from 'node:assert/strict';
import {Vector3,Quaternion} from 'three';
import {phoenixBank} from '../client/phoenix-bank.js';
const start=performance.now();
for(const pitch of [-.6,0,.6])for(const yaw of [-1.5,0,1.5]){
 const q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),yaw).multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),pitch));
 const v=new Vector3(0,0,-32).applyQuaternion(q),leftAxis=new Vector3(0,1,0).applyQuaternion(q);
 const left=phoenixBank(leftAxis.toArray(),v.toArray(),.1,q),right=phoenixBank(leftAxis.negate().toArray(),v.toArray(),.1,q);
 assert.ok(left>0);assert.ok(right<0);assert.ok(Math.abs(left+right)<1e-8);
 const leftWing=new Vector3(-1,0,0).applyAxisAngle(new Vector3(0,0,1),left);assert.ok(leftWing.y<0);
 assert.equal(phoenixBank([0,0,0],v.toArray(),0,q),0);assert.equal(phoenixBank([0,1,0],v.toArray(),1,q),0);
}
console.log(JSON.stringify({result:'pass',cases:9,seconds:(performance.now()-start)/1000}));
