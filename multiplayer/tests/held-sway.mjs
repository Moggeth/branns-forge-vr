import assert from 'node:assert/strict';import * as T from 'three';import {createHeldSway,HELD_SWAY} from '../client/held-sway.js';
const run=(sway,frames,input)=>{let r;for(let i=0;i<frames;i++)r=sway.update(1/60,typeof input==='function'?input(i):input);return r;};
// Turning left (yaw rising) leaves the item trailing to the right, then it springs home with no drift.
let s=createHeldSway();const turning=run(s,20,i=>({yaw:i*.03}));
assert.ok(turning.position.x>.004,'item trails a left turn to the right');assert.ok(turning.quaternion.angleTo(new T.Quaternion())>.01,'item rotates behind the turn');
const settled=run(s,180,{yaw:19*.03});assert.ok(settled.position.length()<1e-4&&settled.quaternion.angleTo(new T.Quaternion())<1e-4,'returns to rest');
// A mouse flick is capped; a teleport-sized snap is ignored.
s=createHeldSway();s.update(1/60,{yaw:0});const flick=s.update(1/60,{yaw:.85});assert.ok(flick.quaternion.angleTo(new T.Quaternion())<=HELD_SWAY.limit*2.2,'flick capped');
s=createHeldSway();s.update(1/60,{yaw:0});assert.ok(s.update(1/60,{yaw:2.5}).position.length()<1e-9,'snap ignored');
s=createHeldSway();s.update(1/60,{yaw:0});s.snap();assert.ok(s.update(1/60,{yaw:.5}).position.length()<1e-9,'explicit snap');
// Heavier tools lag further; aiming calms it; reduced motion softens it.
const lag=(o,input)=>run(createHeldSway(o),12,i=>({yaw:i*.03,...input})).position.x;
assert.ok(lag({},{tool:'hammer'})>lag({},{tool:'pick'}),'hammer heavier than pick');
assert.ok(lag({},{calm:1})<lag({},{})*.3,'aiming calms sway');assert.ok(lag({reducedMotion:true},{})<lag({},{})*.5,'reduced motion');
// Walking bobs; landing dips; hidden resets. Frame-rate independent within tolerance.
s=createHeldSway();const walk=[];run(s,90,i=>{const r=s.update(1/60,{move:{x:0,z:-5}});walk.push(r.position.y);return {move:{x:0,z:-5}};});
assert.ok(Math.max(...walk)-Math.min(...walk)>.005,'walking bob');
s=createHeldSway();s.update(1/60,{grounded:false,verticalSpeed:-8});let dip=0;for(let i=0;i<20;i++)dip=Math.min(dip,s.update(1/60,{grounded:true}).position.y);assert.ok(dip<-.01,'landing dip');
assert.equal(s.update(1/60,{visible:false}).position.length(),0);
const at=hz=>{const v=createHeldSway();let r;for(let i=0;i<hz/5;i++)r=v.update(1/hz,{yaw:i*(1.5/hz)});return r.position.x;};
assert.ok(Math.abs(at(30)-at(120))<.002,'30 Hz and 120 Hz agree');
console.log('PASS held item look lag, flick cap, snap, mass, aim calm, gait bob, landing dip, frame-rate independence');
