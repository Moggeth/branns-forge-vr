import assert from 'node:assert/strict';import * as T from 'three';import {swingPose,SWING_PROFILES} from '../client/weapon-motion.js';
const rest={position:new T.Vector3(.33,-.38,-.48),quaternion:new T.Quaternion().setFromEuler(new T.Euler(-.2,.55,.12))},tip=new T.Vector3(0,.5,-.38);
for(const name of ['axe','pick']){const s=SWING_PROFILES[name];for(const p of [0,1]){const r=swingPose(name,p,rest,tip,2);assert.ok(r.position.distanceTo(rest.position)<1e-8);assert.ok(r.quaternion.angleTo(rest.quaternion)<1e-7);}
const contact=swingPose(name,.5,rest,tip,2);assert.ok(tip.clone().applyQuaternion(contact.quaternion).add(contact.position).distanceTo(new T.Vector3(0,0,-2))<1e-8);
const before=swingPose(name,.49,rest,tip,2).tip,after=swingPose(name,.51,rest,tip,2).tip;assert.ok(after.x<before.x&&after.y<before.y,'down-left at contact');
for(const joint of [s.a,.5,s.f]){const left=swingPose(name,joint-1e-5,rest,tip,2).tip,right=swingPose(name,joint+1e-5,rest,tip,2).tip;assert.ok(left.distanceTo(right)<.001,'continuous phase join');}
}console.log('PASS native swing endpoints, exact contact, diagonal velocity and phase continuity');
