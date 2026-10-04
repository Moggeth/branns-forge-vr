// Crystal wall pick motion (presentation layer) and the smooth preview anchor. No WebGL needed.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {createPickWallMotion,PICK_WALL_MOTION} from '../client/pick-wall-motion.js';

const m=createPickWallMotion();
assert.equal(m.pose(0),null,'idle pick has no layer');
m.hold(10);
const start=m.pose(10);assert.ok(start.offset.length()<1e-9&&start.focus<1e-9,'rise starts from rest (no pop)');
const raised=m.pose(10+PICK_WALL_MOTION.rise);
assert.ok(raised.offset.y>.07&&raised.offset.x<0,'pick rises toward the centre of view');
const head=new THREE.Vector3(0,1,0).applyQuaternion(raised.quaternion);assert.ok(head.z<0&&head.z>-.3,'head leans a little toward the target, never into the camera');
// Held: continuous frame to frame (no jumps at 60/120 Hz) and stays near the raised pose.
let prev=m.pose(11).offset.clone(),worst=0;
for(let t=11;t<13;t+=1/120){const o=m.pose(t).offset;worst=Math.max(worst,o.distanceTo(prev));prev.copy(o);}
assert.ok(worst<.004,`held pose moves smoothly (${worst})`);
assert.ok(m.pose(12).focus>.99,'gems at full focus while held');
// Release: hitch, strike forward and down, rebound, back to rest; continuous throughout.
const before=m.pose(13).offset.clone();assert.equal(m.release(13),true);prev=m.pose(13).offset.clone();
assert.ok(prev.distanceTo(before)<1e-9,'slam starts exactly where the hold was');worst=0;let lowest=Infinity,forward=0;
for(let t=13;t<13+PICK_WALL_MOTION.slam;t+=1/240){const p=m.pose(t);if(!p)break;worst=Math.max(worst,p.offset.distanceTo(prev));prev.copy(p.offset);lowest=Math.min(lowest,p.offset.y);forward=Math.min(forward,p.offset.z);}
assert.ok(worst<.035,`slam is fast but continuous (${worst} m per 1/240 s)`);assert.ok(lowest<-.08&&forward<-.15,'slam drives the head forward and down');
assert.equal(m.pose(13+PICK_WALL_MOTION.slam+.01),null,'slam returns to rest and clears');
assert.equal(m.release(20),false,'release without a hold does nothing');
// A tap slams from partway; cancel eases back instead of snapping.
m.hold(30);m.release(30.05);assert.ok(m.pose(30.05).offset.y<.09,'tap slams from where the rise got to');
m.reset();m.hold(40);m.cancel(41);const c0=m.pose(41).offset.y,c1=m.pose(41+PICK_WALL_MOTION.relax/2).offset.y;
assert.ok(c0>c1&&c1>0,'cancel eases down');assert.equal(m.pose(41+PICK_WALL_MOTION.relax+.01),null);
// Reduced motion: no shiver while held.
const r=createPickWallMotion({reducedMotion:true});r.hold(0);assert.ok(Math.abs(r.pose(2).offset.y-r.pose(2.3).offset.y)<1e-9,'reduced motion holds still');

// The preview anchors on the locally predicted body (per frame), not the snapshot position (network rate).
const game=await readFile(new URL('../client/game.js',import.meta.url),'utf8');
const body=game.slice(game.indexOf('function updateWallPreview'),game.indexOf('function sendSpecial'));
assert.match(body,/localPosition\.toArray\(\)/,'preview uses the predicted position');
assert.match(body,/initialized\?yaw:p\.yaw/,'preview uses the local facing');
console.log('pick-wall-motion ok');
