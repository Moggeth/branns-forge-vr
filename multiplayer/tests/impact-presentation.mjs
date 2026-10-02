import assert from 'node:assert/strict';
import * as T from 'three';
import {createImpactPresentation,IMPACT_CAPS} from '../client/impact-presentation.js';
const a=new T.Scene(),b=new T.Scene(),one=createImpactPresentation({scene:a,height:()=>0}),two=createImpactPresentation({scene:b,height:()=>0});
for(const material of ['stone','metal','bone','wood']){const ev={material,position:[0,1,0],normal:[0,0,1],energy:1.2,seed:47};assert.deepEqual(one.emit(ev),two.emit(ev));}
one.update(1/60);two.update(1/60);a.children.forEach((m,i)=>assert.deepEqual(m.instanceMatrix.array,b.children[i].instanceMatrix.array));
assert.equal(one.emit({material:'nope',position:[0,0,0]}),null);
for(let i=0;i<100;i++)one.emit({material:'metal',position:[i%3,1,0],normal:[0,1,0],energy:2,seed:i});
for(let i=0;i<180;i++){one.update(1/60);for(const [key,cap] of Object.entries(IMPACT_CAPS))assert.ok(one.stats()[key]<=cap);a.children.forEach(m=>assert.ok(m.instanceMatrix.array.every(Number.isFinite)));}
assert.equal(one.stats().chips+one.stats().sparks+one.stats().dust,0);one.dispose();one.dispose();two.dispose();assert.equal(a.children.length+b.children.length,0);console.log('impact-presentation: deterministic materials, finite motion, bounded bursts, expiry and disposal pass');
