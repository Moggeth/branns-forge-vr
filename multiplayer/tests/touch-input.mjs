import test from 'node:test';
import assert from 'node:assert/strict';
import {bindStick, bindWorldTouch, bindTouchButton, stickVector} from '../client/touch-input.js';
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
test('Hero tap targets on release; inactive, drag, pinch and cancellation never attack',()=>{
 const canvas=new Surface(),calls=[];let enabled=false;
 const game={tapAt:(x,y)=>calls.push(['tap',x,y]),lookByPixels:()=>{}};
 const control=bindWorldTouch(canvas,game,{enabled:()=>enabled,role:()=> 'hero',sensitivity:()=>1});
 canvas.send('pointerdown',1,20,20);canvas.send('pointerup',1,20,20);assert.equal(calls.length,0);
 enabled=true;canvas.send('pointerdown',2,20,20);assert.equal(calls.length,0);canvas.send('pointerup',2,20,20);assert.deepEqual(calls,[['tap',20,20]]);calls.length=0;
 canvas.send('pointerdown',3,20,20);canvas.send('pointermove',3,70,20);canvas.send('pointerup',3,70,20);
 canvas.send('pointerdown',4,20,20);canvas.send('pointercancel',4,20,20);canvas.send('pointerup',4,20,20);
 canvas.send('pointerdown',5,20,20);canvas.send('pointerdown',6,60,20);canvas.send('pointerup',5,20,20);canvas.send('pointerup',6,60,20);
 assert.equal(calls.length,0);control.dispose();
});

function castingRig({line=false,quick=true}={}){
 const canvas=new Surface(),calls=[];let revision=0,start=false,active=true,target=false;
 const game={touchCastState:()=>({line,quick,revision,start}),aimAt:(x,y)=>{calls.push(['aim',x,y]);return x>=0;},beginAimLine:()=>{start=true;calls.push(['start']);},castAim:()=>{calls.push(['cast']);start=false;},cancelAim:()=>{calls.push(['cancel']);start=false;revision++;},lookByPixels:(...p)=>calls.push(['look',...p]),zoomBy:z=>calls.push(['zoom',z])};
 const control=bindWorldTouch(canvas,game,{enabled:()=>active,role:()=> 'god',sensitivity:()=>1,onTarget:value=>target=value});
 return {canvas,calls,control,get target(){return target;},change:()=>revision++,disable:()=>active=false};
}
test('quick point tap casts once on release; orbit and pinch never cast',()=>{
 const {canvas:c,calls,control}=castingRig();c.send('pointerdown',1,20,20);assert.equal(calls.length,0);c.send('pointerup',1,20,20);assert.deepEqual(calls,[['aim',20,20],['cast']]);
 calls.length=0;c.send('pointerdown',2,20,20);c.send('pointermove',2,45,20);c.send('pointerup',2,45,20);assert.equal(calls.filter(x=>x[0]==='cast').length,0);
 calls.length=0;c.send('pointerdown',3,20,20);c.send('pointerdown',4,50,20);c.send('pointermove',4,70,20);c.send('pointerup',4,70,20);c.send('pointerup',3,20,20);assert.deepEqual(calls,[['zoom',-1.4000000000000001]]);control.dispose();
});
test('line finger drag previews without orbit then quick casts at release',()=>{
 const {canvas:c,calls,control}=castingRig({line:true});c.send('pointerdown',1,20,20);c.send('pointermove',1,70,40);assert.equal(calls.some(x=>x[0]==='look'||x[0]==='cast'),false);c.send('pointerup',1,80,45);assert.deepEqual(calls,[['aim',20,20],['start'],['aim',70,40],['aim',80,45],['cast']]);control.dispose();
});
test('normal line drag waits for explicit Cast; quick line supports two taps',()=>{
 const normal=castingRig({line:true,quick:false});normal.canvas.send('pointerdown',1,20,20);normal.canvas.send('pointermove',1,70,40);normal.canvas.send('pointerup',1,70,40);assert.equal(normal.calls.some(x=>x[0]==='cast'),false);normal.control.dispose();
 const quick=castingRig({line:true});for(const [id,x] of [[1,20],[2,70]]){quick.canvas.send('pointerdown',id,x,20);quick.canvas.send('pointerup',id,x,20);}assert.equal(quick.calls.filter(x=>x[0]==='cast').length,1);quick.control.dispose();
});
test('line cancellation, pinch, invalid endpoints and changed spell cannot fire',()=>{
 for(const why of ['pointercancel','lostpointercapture','pinch','invalid','changed','disabled','reset']){
  const r=castingRig({line:true}),c=r.canvas;c.send('pointerdown',1,20,20);c.send('pointermove',1,70,40);
  if(why==='pinch'){c.send('pointerdown',2,90,40);c.send('pointerup',2,90,40);}else if(why==='changed')r.change();else if(why==='disabled')r.disable();else if(why==='reset')r.control.reset();else if(why.startsWith('pointer')||why==='lostpointercapture')c.send(why,1,70,40);
  c.send('pointerup',1,why==='invalid'?-1:70,40);assert.equal(r.calls.some(x=>x[0]==='cast'),false,why);assert.equal(r.target,false,'cancelled target hint: '+why);r.control.dispose();
 }
});


test('secondary-finger action dispatches once, native duplicate is suppressed, cancellation is safe',()=>{
 const button=new Surface();button.getBoundingClientRect=()=>({left:0,top:0,right:120,bottom:120});let count=0;
 const binding=bindTouchButton(button);button.click=()=>{const e=new Event('click');Object.assign(e,{detail:0});button.dispatchEvent(e);};button.addEventListener('click',()=>count++);
 button.send('pointerdown',8,50,50,{isPrimary:false});button.send('pointerup',8,50,50,{isPrimary:false});assert.equal(count,1);
 const native=new Event('click',{cancelable:true});Object.assign(native,{detail:1});button.dispatchEvent(native);assert.equal(count,1);
 button.send('pointerdown',9,50,50);button.send('pointercancel',9,50,50);button.send('pointerup',9,50,50);assert.equal(count,1);
 button.click();assert.equal(count,2,'keyboard activation retained');binding.dispose();
});
