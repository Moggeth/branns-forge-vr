// Verify exact wire compatibility against the pre-optimization encoder.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {encodeDelta, applyDelta} from '../client/state-codec.js';
const source=execFileSync('git',['show','702f9ea:multiplayer/client/state-codec.js'],{encoding:'utf8'});
const previous=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const copy=x=>JSON.parse(JSON.stringify(x));
let cases=0;
function check(a,b){
 const expected=previous.encodeDelta(a,b),actual=encodeDelta(a,b);
 assert.equal(JSON.stringify(actual),JSON.stringify(expected),'wire patch must remain identical');
 assert.equal(JSON.stringify(applyDelta(copy(a),actual===undefined?undefined:copy(actual))),JSON.stringify(b));cases++;
}
const variants=[[],[null],['x',1],[{id:1,v:0},{id:'1',v:1}], [{id:'a'},{id:'a'}],
 [{x:1,z:2},{x:2,z:3}],[{x:'1',z:2}],[{x:1,z:2,id:null}], [{id:null}],[[1],[2]], [{other:1}], [{id:'a'},null]];
for(const a of variants)for(const b of variants)check(a,b);
for(let n=0;n<1000;n++){
 const a=Array.from({length:n%65},(_,i)=>n%2?{id:i%2?'e'+i:i,v:i,nested:{p:[i,0,1]}}:{x:i,z:-i,v:i});
 const b=copy(a);for(let i=0;i<b.length;i+=3)b[i].v+=n;
 if(n%5===0)b.reverse();if(n%7===0)b.pop();if(n%11===0)b.push(n%2?{id:'new',v:1}:{x:90,z:90,v:1});
 check(a,b);check({entities:a,tick:n},{entities:b,tick:n+1});
}
// Representative moving roster plus stable world collections, all freshly serialized.
const a={players:Array.from({length:32},(_,i)=>({id:'p'+i,position:[i,1,0],hp:100})),
 enemies:Array.from({length:96},(_,i)=>({id:'e'+i,position:[i,0,1],hp:100})),
 pickups:Array.from({length:256},(_,i)=>({id:'r'+i,x:i,z:i,value:1})),
 fireCells:Array.from({length:128},(_,i)=>({x:i,z:0,heat:.5,fuel:1}))};
const b=copy(a);for(const p of [...b.players,...b.enemies])p.position[0]+=.01;
check(a,b);
const rounds=1000;
function bench(fn){const start=performance.now();for(let i=0;i<rounds;i++)fn(a,b);return performance.now()-start;}
for(let i=0;i<200;i++){previous.encodeDelta(a,b);encodeDelta(a,b);}
const old=[],now=[];for(let i=0;i<5;i++){old.push(bench(previous.encodeDelta));now.push(bench(encodeDelta));}
const median=v=>v.sort((a,b)=>a-b)[2];
console.log(JSON.stringify({cases,rounds,baselineMs:median(old),optimizedMs:median(now),patchBytes:Buffer.byteLength(JSON.stringify(encodeDelta(a,b))),wireIdentical:true}));
