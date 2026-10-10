import assert from 'node:assert/strict';
import {createFrameMetrics} from '../client/frame-metrics.js';
import {createGpuFrameTimer} from '../client/gpu-frame-timer.js';

const metrics=createFrameMetrics(4);
for(const n of [16,34,51,101,16,NaN,-1])metrics.record('frameInterval',n);
assert.equal(metrics.stats().frameInterval.samples,4);
assert.equal(metrics.stats().frameInterval.total,5);
assert.equal(metrics.stats().frameInterval.over50,2);
assert.equal(metrics.stats().frameInterval.over100,1);
let next=0,current=null,disjoint=false,lost=false,available=false,reads=0;
const live=new Set(),samples=[];
const ext={TIME_ELAPSED_EXT:1,GPU_DISJOINT_EXT:2};
const gl={QUERY_RESULT_AVAILABLE:3,QUERY_RESULT:4,CURRENT_QUERY:5,
 getExtension:()=>ext,isContextLost:()=>lost,getParameter:()=>disjoint,getQuery:()=>current,
 createQuery(){const q=++next;live.add(q);return q;},deleteQuery:q=>live.delete(q),
 beginQuery(_,q){assert.equal(current,null);current=q;},endQuery(){current=null;},
 getQueryParameter(_,kind){if(kind===3)return available;assert.ok(available,'never block for a result');reads++;return 12500000;},
};
const timer=createGpuFrameTimer(gl,(...sample)=>samples.push(sample),{every:1,maxPending:2});
for(let i=0;i<20;i++){timer.begin();timer.end();}
assert.equal(next,2,'bounded even when the GPU never completes');assert.equal(reads,0);
available=true;timer.begin();timer.end();assert.deepEqual(samples,[['gpuFrame',12.5],['gpuFrame',12.5]]);
disjoint=true;timer.begin();assert.equal(live.size,0,'disjoint timings are discarded');
disjoint=false;available=false;timer.begin();timer.end();lost=true;timer.begin();assert.equal(live.size,0);
lost=false;current='external';timer.begin();assert.equal(current,'external','do not nest another profiler query');
current=null;timer.begin();timer.dispose();assert.equal(current,null);assert.equal(live.size,0);
timer.begin();assert.equal(live.size,0);
const unsupported=createGpuFrameTimer({getExtension:()=>null},()=>assert.fail());unsupported.begin();unsupported.end();unsupported.dispose();
assert.equal(unsupported.stats().supported,false);
console.log('frame-diagnostics: bounded async queries, disjoint/context loss, coexistence, teardown and hitch counts passed');
