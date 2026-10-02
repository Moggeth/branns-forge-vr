import test from 'node:test';
import assert from 'node:assert/strict';
import {bindStick, bindWorldTouch, stickVector} from '../client/touch-input.js';
class Surface extends EventTarget {
  capture = new Set();
  getBoundingClientRect(){return {left:0,top:0,width:120,height:120};}
  setPointerCapture(id){this.capture.add(id);}
  hasPointerCapture(id){return this.capture.has(id);}
  releasePointerCapture(id){this.capture.delete(id);}
  send(type,id,x,y,extra={}){const e = new Event(type,{cancelable:true});Object.assign(e,{pointerId:id,clientX:x,clientY:y,pointerType:'touch',button:0,...extra});this.dispatchEvent(e);return e;}
}
test('stick has a dead zone and diagonal speed never exceeds full deflection',()=>{
  assert.deepEqual(stickVector(2,2,50),{x:0,y:0});
  const full=stickVector(100,100,50);assert.ok(Math.abs(Math.hypot(full.x,full.y)-1)<1e-10);
  assert.ok(stickVector(25,0,50).x>0 && stickVector(25,0,50).x<1);
});
test('two sticks retain independent pointer ownership, cancellation and focus reset stop movement',()=>{
  const left=new Surface(),right=new Surface();let a,b;
  const one=bindStick(left,(x,y)=>a={x,y}),two=bindStick(right,(x,y)=>b={x,y});
  left.send('pointerdown',1,60,15);right.send('pointerdown',2,100,60);
  assert.ok(a.y<-.9);assert.ok(b.x>.9);
  left.send('pointermove',2,0,120);assert.ok(a.y<-.9,'another finger must not steal movement');
  right.send('pointercancel',2,100,60);assert.deepEqual(b,{x:0,y:0});assert.ok(a.y<-.9);
  one.reset();assert.deepEqual(a,{x:0,y:0});assert.equal(left.capture.size,0);
  right.send('pointerdown',3,80,60);right.send('lostpointercapture',3,80,60);assert.deepEqual(b,{x:0,y:0});
  one.dispose();two.dispose();
});
test('God tap only aims; drags, pinch and cancelled touches never cast or set a stray target',()=>{
  const canvas=new Surface(),calls=[];const game={aimAt:(...p)=>{calls.push(['aim',...p]);return true;},lookByPixels:(...p)=>calls.push(['look',...p]),zoomBy:z=>calls.push(['zoom',z])};
  const controls=bindWorldTouch(canvas,game,{enabled:()=>true,role:()=> 'god',sensitivity:()=>1});
  canvas.send('pointerdown',1,20,20);canvas.send('pointerup',1,20,20);assert.equal(calls[0][0],'aim');
  calls.length=0;canvas.send('pointerdown',2,20,20);canvas.send('pointermove',2,50,20);canvas.send('pointerup',2,50,20);assert.deepEqual(calls,[['look',30,0]]);
  calls.length=0;canvas.send('pointerdown',3,20,20);canvas.send('pointerdown',4,80,20);canvas.send('pointermove',4,100,20);canvas.send('pointerup',4,100,20);canvas.send('pointerup',3,20,20);assert.equal(calls.length,1);assert.equal(calls[0][0],'zoom');assert.ok(calls[0][1]<0);
  calls.length=0;canvas.send('pointerdown',5,20,20);canvas.send('pointercancel',5,20,20);assert.equal(calls.length,0);
  canvas.send('pointerdown',6,20,20);controls.reset();canvas.send('pointerup',6,20,20);assert.equal(calls.length,0);controls.dispose();
});
test('inactive controls ignore touches and Hero tap does not auto-attack',()=>{
  const canvas=new Surface(),calls=[];let enabled=false;
  const control=bindWorldTouch(canvas,{aimAt:()=>calls.push('aim'),lookByPixels:()=>calls.push('look')},{enabled:()=>enabled,role:()=> 'hero',sensitivity:()=>1});
  canvas.send('pointerdown',1,20,20);canvas.send('pointermove',1,60,20);assert.equal(calls.length,0);
  enabled=true;canvas.send('pointerdown',2,20,20);canvas.send('pointerup',2,20,20);assert.equal(calls.length,0);control.dispose();
});
