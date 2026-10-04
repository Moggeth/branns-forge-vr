import assert from 'node:assert/strict';
import {createLeapGestures} from '../client/leap-gestures.js';

function fixture(){let x=0,now=1,calls=0;const g=createLeapGestures({cancelAim(){},touchCastState:()=>({revision:0,line:false,quick:true}),aimAt(v){x=v;calls++;return true;},castAim(){},beginAimLine(){}});
 return {get x(){return x;},get calls(){return calls;},step(mm,dt){now+=dt;g.update({status:'tracking',ageMs:0,hands:[{id:1,side:'right',pinch:0,palm:[mm,200,0]}]},{active:true,now,rect:{left:0,top:0,width:1000,height:700}});}};}
const fast=fixture();fast.step(0,1);fast.step(80,1000/60);
const response=(fast.x-500)/250,oldResponse=1-Math.exp(-(1/60)/.035);
assert.ok(response>.9&&response<1,'first rendered frame reaches over 90% without overshoot');
for(const hz of [30,60,90,120,144]){const f=fixture();f.step(0,1);for(let i=0;i<hz;i++)f.step(80,1000/hz);assert.equal(f.calls,hz+1,'no fixed input timer cap');assert.ok(Math.abs(f.x-750)<.1);for(let i=0;i<hz;i++){f.step(-80,1000/hz);assert.ok(f.x>=250&&f.x<=750,'no reversal overshoot');}}
const jitter=fixture();jitter.step(0,1);let square=0;for(let i=0;i<120;i++){jitter.step(i%2?1:-1,1000/120);if(i>=20)square+=(jitter.x-500)**2;}
const jitterRms=Math.sqrt(square/100);assert.ok(jitterRms<1,'subpixel resting jitter after filter');
console.log(JSON.stringify({firstFrameStepResponse:response,previous35msFilterResponse:oldResponse,jitterRmsPixels:jitterRms}));
