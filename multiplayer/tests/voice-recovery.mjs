import assert from 'node:assert/strict';
import {replacementReady,waitForReplacement,waitForRecoveredAudio} from './voice-recovery-helpers.mjs';

const original = [
  {id:'a',session:'a-before',remoteId:'b',remoteSession:'b-before',negotiation:'old',connectionState:'connected'},
  {id:'b',session:'b-before',remoteId:'a',remoteSession:'a-before',negotiation:'old',connectionState:'connected'},
];
for (const retrying of [0,1]) {
  let time=0, reads=0, samples=0;
  const sessions=original.map((p,i)=>i===retrying?`${p.id}-after`:p.session), remote=1-retrying;
  const ready=original.map((p,i)=>({...p,session:sessions[i],remoteSession:sessions[1-i],negotiation:'replacement'}));
  const options={now:()=>time,pause:async ms=>{time+=ms;}};
  const readPair=async()=>{
    reads++;
    if(time>=1700)return structuredClone(ready);
    const pair=structuredClone(original);
    pair[retrying]={...ready[retrying],connectionState:'connecting'};
    // The other browser keeps its old, connected edge until new presence arrives.
    if(time>=950)pair[remote].remoteSession=sessions[retrying];
    // New session observed does not establish a replacement connection.
    if(time>=1250)pair[remote]={...ready[remote]};
    return pair;
  };
  const stale=await readPair();
  assert.equal(stale[remote].connectionState,'connected','old one-sided test would pass immediately');
  assert.equal(replacementReady(stale,original,sessions),false);
  const connected=await waitForReplacement(readPair,original,sessions,options);
  assert.equal(time,1700,'waits for both replacements, beyond the old 700ms assumption');
  assert(reads>1);
  const energy=await waitForRecoveredAudio(readPair,connected,async()=>{samples++;time+=400;return time>=2800?[.02,.02]:[0,0];},options);
  assert(samples>=3,'connected transport can still need time before audible samples arrive');
  assert.deepEqual(energy,[.02,.02]);

  // A stale connected edge must time out, never satisfy the success barrier.
  time=0;
  await assert.rejects(waitForReplacement(async()=>stale,original,sessions,{...options,timeoutMs:1000}),/negotiation timed out/);
  assert.equal(time,1000);
  // Silence remains a failure at the deadline; do not weaken the RMS assertion.
  time=0;
  await assert.rejects(waitForRecoveredAudio(async()=>ready,ready,async()=>[0,0],{...options,timeoutMs:1000}),/audio timed out/);
  assert.equal(time,1000);
  // Loud samples from a connection replaced during measurement are not recovery.
  time=0;let pair=structuredClone(ready);
  await assert.rejects(waitForRecoveredAudio(async()=>pair,ready,async()=>{pair=original;return [.1,.1];},{...options,timeoutMs:1000}),/audio timed out/);
}
console.log('PASS voice recovery: delayed session propagation, both replacement connections, bounded audio recovery, stale/silent rejection for offerer and answerer retries');
