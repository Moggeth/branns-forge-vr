import assert from 'node:assert/strict';
import {createSiegebirdWind, SIEGEBIRD_WIND} from '../client/siegebird-wind.js';
import {SIEGEBIRD_RELOAD as R, siegebirdMechanism, siegebirdHandCues} from '../client/siegebird-reload.js';
import {SIEGEBIRD} from '../shared/combat.js';
// Local Siegebird reload clock: perfect-wind presses (desktop, phone, VR trigger) and VR hand cranking.
const began=performance.now(),dt=1/60,TURN=Math.PI*4;
const run=(w,seconds,grip=()=>null)=>{const out={cues:[],winds:[],maxT:0};for(let i=0;i<Math.round(seconds/dt);i++){const r=w.update(dt,grip(i));out.cues.push(...r.cues);if(r.wind)out.winds.push(r.wind);if(Number.isFinite(w.time()))out.maxT=Math.max(out.maxT,w.time());}return out;};

// Auto wind: the clock is the reload; one press per reload, judged against the latch.
let w=createSiegebirdWind();assert.equal(w.time(),Infinity);assert.equal(w.press(),null,'not reloading: the press is a shot');
w.fired();run(w,Math.round(SIEGEBIRD.latch*60)/60);assert.ok(Math.abs(w.time()-R.windEnd)<1e-9);
assert.deepEqual(w.press(),{perfect:true,hand:false});assert.equal(w.press(),null,'one press per reload');assert.equal(w.verdict(),1);
run(w,.5);assert.ok(w.time()>=R.seconds,'reload completes on the clock');
w.fired();run(w,.3);assert.deepEqual(w.press(),{perfect:false,hand:false},'early press misses');assert.equal(w.verdict(),-1);
w.fired();run(w,(Math.round(SIEGEBIRD.latch*60)+SIEGEBIRD_WIND.predictWindow+1)/60);assert.equal(w.press().perfect,false,'prediction is stricter than the host window');
// Quick reload: the whole timeline runs at 1/0.75.
w.fired({quick:true});run(w,.45);assert.ok(Math.abs(w.time()-.6)<1e-6);assert.equal(w.press().perfect,true,'quick reload latches at 0.45 s');
run(w,.3+dt);assert.ok(w.time()>=R.seconds,'quick reload ready by 0.75 s');

// Hand wind: two crank turns in time latch the pawl before the bird seats and earn the quick reload.
w=createSiegebirdWind();w.fired();
let r=run(w,.45,i=>i>=4?{held:true,delta:TURN/22}:null);
assert.equal(r.winds.length,1);assert.deepEqual(r.winds[0],{perfect:true,hand:true});
assert.equal(r.cues.filter(c=>c.cue==='click').length,17);assert.equal(r.cues.at(-1).cue,'latch');assert.equal(w.hand(),1);
assert.equal(w.press(),null,'a hand-wound reload is judged by its latch, not a press');
// Backwards turns never unwind the ratchet; tracking jumps are capped.
w.fired();run(w,.1);r=run(w,.1,()=>({held:true,delta:-.5}));assert.equal(w.hand(),0);
r=run(w,dt,()=>({held:true,delta:10}));assert.ok(Math.abs(w.hand()-SIEGEBIRD_WIND.maxStep/TURN)<1e-9);
// A slow hand: the bird waits beside the rail (time holds at arrive) until the pawl latches; letting go resumes the winch.
w=createSiegebirdWind();w.fired();r=run(w,1.2,i=>i>=6?{held:true,delta:TURN/150}:null);
assert.ok(r.maxT<=R.arrive+1e-9&&w.time()===R.arrive,'bird holds before seating while the string is undrawn');assert.equal(r.winds.length,0);
const partial=w.hand();assert.ok(partial>.3&&partial<1);
r=run(w,SIEGEBIRD_WIND.resume-2*dt);assert.equal(w.hand(),partial,'brief slips do not restart the winch');
r=run(w,1.2);assert.equal(w.hand(),1,'released crank winds itself');assert.equal(r.winds.length,1);assert.equal(r.winds[0].perfect,false,'too slow for the quick reload');
assert.equal(r.cues.at(-1).cue,'latch');assert.ok(w.time()>R.arrive);run(w,1);assert.ok(w.time()>=R.seconds);

// Mechanism follows the hand: crank, drum and draw all from the wound fraction.
const m=siegebirdMechanism(.3,.5);assert.equal(m.cocked,.5);assert.ok(Math.abs(m.crank-TURN*.5)<1e-9&&Math.abs(m.pinion-m.crank)<1e-9&&Math.abs(m.drum+Math.PI)<1e-9);
assert.equal(siegebirdMechanism(.3,1).latch,0,'latched at full draw');
assert.deepEqual(siegebirdHandCues(0,1).map(c=>c.cue),[...Array(17).fill('click'),'latch']);assert.deepEqual(siegebirdHandCues(.5,.4),[]);
// Weapon swap back mid-reload: the timeline resumes from the bird's entry with no second wind verdict.
{const r=createSiegebirdWind();r.resume(.26);assert.equal(r.time(),.26);assert.equal(r.press(),null,'no verdict for a resumed reload');
 let w2=null;for(let i=0;i<60;i++){const u=r.update(1/60);w2=w2||u.wind;}assert.equal(w2,null);assert.ok(r.time()>1);}
console.log(`siegebird-wind: press judging, quick reloads, hand cranking, ratchet, waiting bird and resume pass (${((performance.now()-began)/1000).toFixed(3)} s)`);
