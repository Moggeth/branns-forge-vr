import assert from 'node:assert/strict';
import {createLeapGestures} from '../client/leap-gestures.js';
let casts=0,starts=0,cancels=0,valid=true,now=0;
const state={line:false,quick:true,revision:0};
const game={cancelAim(){cancels++;state.revision++;},touchCastState:()=>({...state}),aimAt:()=>valid,beginAimLine(){starts++;},castAim(){casts++;}};
const g=createLeapGestures(game);
const tick=(pinch,{id=1,ageMs=0,active=true,hands=true}={})=>g.update({status:'tracking',ageMs,hands:hands?[{id,side:'right',pinch,palm:[0,200,0]}]:[]},{active,now:now+=33,rect:{left:0,top:0,width:1280,height:720}});
tick(.95);assert.equal(casts,0,'initial pinch cannot cast');
for(let i=0;i<20;i++){tick(0);tick(.95);tick(.95);tick(.5);}
assert.equal(casts,20,'twenty pinches are exactly twenty quick casts');
for(let i=0;i<20;i++){tick(.95,{hands:false});tick(.95);}
assert.equal(casts,20,'tracking loss cannot manufacture a pinch');
tick(0);tick(.95,{active:false});tick(.95);assert.equal(casts,20,'focus/menu loss requires release');
tick(0);tick(.95,{ageMs:300});tick(.95);assert.equal(casts,20,'stale frames require release');
tick(0);tick(.95,{id:2});assert.equal(casts,20,'new hand requires open pose');
tick(0);state.revision++;tick(.95);tick(.95);assert.equal(casts,20,'spell change cannot cast');
tick(0);valid=false;tick(.95);valid=true;tick(.95);assert.equal(casts,20,'invalid terrain cannot queue a cast');
g.reset(true);state.line=true;tick(0);tick(.95);tick(.95);assert.equal(starts,1);assert.equal(casts,20);tick(0);assert.equal(casts,21,'line casts on release');
tick(.95);tick(0,{hands:false});tick(0);assert.equal(casts,21,'lost line is cancelled');
state.line=false;state.quick=false;state.revision++;tick(0);tick(0);tick(.95);assert.equal(casts,21);tick(0);assert.equal(casts,22,'normal point cast on release');
assert.ok(cancels>0);
console.log('Leap gestures: exact-once casts, line release, stale/lost hand, focus/menu, spell change, invalid target and normal casting pass.');
