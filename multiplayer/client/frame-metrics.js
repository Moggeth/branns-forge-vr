// Constant-space rolling CPU timings. Percentiles are computed only on diagnostic
// reads, never in the frame loop. Render submission time is NOT GPU frame time.
export function createFrameMetrics(capacity=240) {
 const channels=new Map(['frameCpu','frameInterval','snapshotCpu','terrainCpu'].map(k=>[k,{values:new Float64Array(capacity),cursor:0,count:0,total:0,max:0}]));
 return {
  record(key,ms){const c=channels.get(key);if(!c||!Number.isFinite(ms)||ms<0)return;c.values[c.cursor]=ms;c.cursor=(c.cursor+1)%capacity;c.count=Math.min(capacity,c.count+1);c.total++;c.max=Math.max(c.max,ms);},
  stats(){return Object.fromEntries([...channels].map(([key,c])=>{const sorted=Array.from(c.values.subarray(0,c.count)).sort((a,b)=>a-b),q=p=>sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]??0;return [key,{samples:c.count,total:c.total,p50Ms:q(.5),p95Ms:q(.95),p99Ms:q(.99),maxMs:c.max}];}));}
 };
}
