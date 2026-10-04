import assert from 'node:assert/strict';import * as T from 'three';import {createWeaponSwap,WEAPON_SWAP} from '../client/weapon-swap.js';
const run=(swap,seconds,hz=60)=>{const commits=[];let r;for(let i=0;i<Math.round(seconds*hz);i++){r=swap.update(1/hz);if(r.commit)commits.push(r.commit);}return {r,commits};};
// Stash then draw: one commit at the bottom, total time is lower + raise (400 to 600 ms).
let s=createWeaponSwap();assert.equal(s.request('pick','axe'),true);assert.ok(s.busy);
let {r,commits}=run(s,WEAPON_SWAP.lower-.02);assert.deepEqual(commits,[]);assert.ok(r.amount>.8,'nearly out of frame before the swap');
({r,commits}=run(s,.04));assert.deepEqual(commits,['pick']);
({r}=run(s,WEAPON_SWAP.raise+.02));assert.ok(!s.busy&&r.amount===0&&r.position.length()===0,'back at rest');
const total=WEAPON_SWAP.lower+WEAPON_SWAP.raise;assert.ok(total>=.4&&total<=.6,'400 to 600 ms');
// The raise settles with a small overshoot, never a pop.
s=createWeaponSwap();s.request('pick','axe');let prev=0,maxStep=0,minAmount=1;for(let i=0;i<40;i++){const a=s.update(1/60).amount;maxStep=Math.max(maxStep,Math.abs(a-prev));minAmount=Math.min(minAmount,a);prev=a;}
assert.ok(maxStep<.25,'no single-frame jump');assert.ok(minAmount<0&&minAmount>-.15,'gentle overshoot');
// Changing your mind mid-drop brings the same item back without a model change; a new pick mid-raise goes back down.
s=createWeaponSwap();s.request('pick','axe');run(s,.1);s.request('axe','axe');({commits}=run(s,.6));assert.deepEqual(commits,[]);assert.ok(!s.busy);
s=createWeaponSwap();s.request('pick','axe');run(s,.3);s.request('hammer','pick');({commits}=run(s,.8));assert.deepEqual(commits,['hammer']);
assert.equal(createWeaponSwap().request('axe','axe'),false,'no swap to the item already held');
// The bow brings its own raise, so the swap ends at the bottom; cancel hands back the pending tool.
s=createWeaponSwap();s.request('bow','axe');({commits}=run(s,.3));assert.deepEqual(commits,['bow']);assert.ok(!s.busy);
s=createWeaponSwap();s.request('pick','axe');run(s,.1);assert.equal(s.cancel(),'pick');assert.ok(!s.busy);
// Frame-rate independent and reduced motion drops the overshoot.
const at=hz=>{const v=createWeaponSwap();v.request('pick','axe');return run(v,.4,hz).r.amount;};assert.ok(Math.abs(at(30)-at(120))<.06);
s=createWeaponSwap({reducedMotion:true});s.request('pick','axe');let low=1;for(let i=0;i<40;i++)low=Math.min(low,s.update(1/60).amount);assert.ok(low>=0);
console.log('PASS weapon swap stash/draw timing, single commit, overshoot, mind changes, bow raise, cancel, frame-rate independence');
