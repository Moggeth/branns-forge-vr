import assert from 'node:assert/strict';import * as T from 'three';import {createWeaponSwap,WEAPON_SWAP_STYLES as S} from '../client/weapon-swap.js';
const run=(swap,seconds,hz=60)=>{const commits=[];let r;for(let i=0;i<Math.round(seconds*hz);i++){r=swap.update(1/hz);if(r.commit)commits.push(r.commit);}return {r,commits};};
const atRest=r=>r.position.length()<1e-9&&r.quaternion.angleTo(new T.Quaternion())<1e-6;
// Every tool's stash leaves rest smoothly and its draw arrives at rest; totals stay within 400 to 650 ms.
for(const [tool,s] of Object.entries(S)){
 const total=s.lower+(s.draw?s.raise:.34);assert.ok(total>=.4&&total<=.65,`${tool} total ${total}`);
 assert.equal(s.stash[0].at,0);assert.equal(s.stash.at(-1).at,1);if(s.draw){assert.equal(s.draw.at(-1).at,1);
  const end=s.draw.at(-1);assert.ok(end.p.every(v=>v===0)&&end.r.every(v=>Math.abs(Math.sin(v))<1e-9),`${tool} draw ends at rest`);}
 assert.ok(Math.hypot(...s.stash.at(-1).p)>.4,`${tool} stash leaves frame`);
}
// One commit out of frame; each tool's own draw plays; the path never jumps between frames except across the out-of-frame model change.
for(const [from,to] of [['axe','pick'],['pick','hammer'],['hammer','crossbow'],['crossbow','wyrmspout'],['wyrmspout','flask'],['flask','axe'],['axe','bow']]){
 const s=createWeaponSwap();assert.equal(s.request(to,from),true);let prev=new T.Vector3(),prevQ=new T.Quaternion(),commits=[],maxStep=0,maxTurn=0;
 let skip=false;for(let i=0;i<60;i++){const r=s.update(1/60);if(r.commit||skip){if(r.commit)commits.push(r.commit);skip=!!r.commit;prev.copy(r.position);prevQ.copy(r.quaternion);continue;}
  maxStep=Math.max(maxStep,r.position.distanceTo(prev));maxTurn=Math.max(maxTurn,r.quaternion.angleTo(prevQ));prev.copy(r.position);prevQ.copy(r.quaternion);}
 assert.deepEqual(commits,[to]);assert.ok(!s.busy);assert.ok(maxStep<.12,`${from}->${to} step ${maxStep}`);assert.ok(maxTurn<(to==="flask"?.7:.45),`${from}->${to} turn ${maxTurn}`);
 assert.ok(atRest(s.update(1/60)),`${from}->${to} back at rest`);
}
// Timing: the commit lands when the stash ends.
let s=createWeaponSwap();s.request('pick','axe');let {commits}=run(s,S.axe.lower-.03);assert.deepEqual(commits,[]);({commits}=run(s,.05));assert.deepEqual(commits,['pick']);
// Changing your mind mid-stash brings the same item back without a model change; a new pick mid-draw blends into a stash.
s=createWeaponSwap();s.request('pick','axe');run(s,.1);s.request('axe','axe');({commits}=run(s,.6));assert.deepEqual(commits,[]);assert.ok(!s.busy);
s=createWeaponSwap();s.request('pick','axe');run(s,.3);const mid=s.update(1/60).position.clone();s.request('hammer','pick');const next=s.update(1/60).position;assert.ok(next.distanceTo(mid)<.05,'mid-draw interrupt blends');
({commits}=run(s,.8));assert.deepEqual(commits,['hammer']);
assert.equal(createWeaponSwap().request('axe','axe'),false,'no swap to the item already held');
// The bow brings its own raise; cancel hands back the pending tool; reduced motion uses the plain dip.
s=createWeaponSwap();s.request('bow','axe');({commits}=run(s,.3));assert.deepEqual(commits,['bow']);assert.ok(!s.busy);
s=createWeaponSwap();s.request('pick','axe');run(s,.1);assert.equal(s.cancel(),'pick');assert.ok(!s.busy);
s=createWeaponSwap({reducedMotion:true});s.request('flask','axe');run(s,S.plain.lower+.02);let spin=0;for(let i=0;i<20;i++)spin=Math.max(spin,s.update(1/60).quaternion.angleTo(new T.Quaternion()));assert.ok(spin<1.3,'no flask toss under reduced motion');
// Frame-rate independent.
const at=hz=>{const v=createWeaponSwap();v.request('pick','axe');return run(v,.4,hz).r.position;};assert.ok(at(30).distanceTo(at(120))<.05);
console.log('PASS per-tool stash/draw styles, single commit, smooth paths, mind changes, bow raise, cancel, reduced motion, frame-rate independence');
