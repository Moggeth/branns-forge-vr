import assert from 'node:assert/strict';
import {launch,BASE,record,save,sleep} from './browser-acceptance-lib.mjs';
import {waitForReplacement,waitForRecoveredAudio} from './voice-recovery-helpers.mjs';
const {browser,context,page:host}=await launch();const a=await context.newPage(),b=await context.newPage();
const pages=[host,a,b], endpoint=process.env.VOICE_WS_URL||'ws://127.0.0.1:8796/peer/ws';
const errors=[];for(const page of pages)page.on('pageerror',error=>errors.push(error.message));
const readPair=()=>Promise.all([a,b].map(page=>page.evaluate(()=>voiceConnectionSnapshot())));
const pose=async(page,position,forward=[0,0,-1])=>{await page.evaluate(({position,forward})=>v.updatePose({position,forward,up:[0,1,0]}),{position,forward});await sleep(650);};
try {
  for(const page of pages){await page.goto(BASE+'/tests/voice-harness.html');await page.waitForFunction(()=>window.makeVoice);}
  await host.evaluate(url=>makeVoice(url,{name:'Host',desktop:true}),endpoint);await host.waitForFunction(()=>c.room&&c.peerId);
  const room=await host.evaluate(()=>c.room);
  for(const [i,page] of [a,b].entries())await page.evaluate(({url,room,i})=>makeVoice(url,{room,name:'Guest '+i,desktop:true}),{url:endpoint,room,i});
  await host.waitForFunction(()=>c.peers.size===2&&[...c.peers.values()].every(p=>p.channel?.readyState==='open'));
  // Host deliberately stays out of voice: it must still relay metadata for guests.
  for(const page of [a,b])await page.click('#listen');
  await Promise.all([a,b].map(page=>page.waitForFunction(()=>v.peers.size===1&&[...v.peers.values()][0].pc.connectionState==='connected',null,{timeout:25000})));
  assert.equal(await a.evaluate(()=>captureCalls),0);assert.equal(await b.evaluate(()=>captureCalls),0);
  await b.evaluate(()=>window.deny=true);await b.click('#mic');await b.waitForFunction(()=>v.message.includes('site settings'));
  await b.evaluate(()=>window.deny=false);await b.click('#mic');await b.waitForFunction(()=>v.stream);
  await pose(b,[-4,1.65,-2]);const left=await waitForRecoveredAudio(readPair,await readPair(),()=>a.evaluate(()=>meter()));
  assert(left[0]>.001&&left[0]>left[1]*1.15,`left spatial energy ${left}`);
  await pose(b,[4,1.65,-2]);const right=await a.evaluate(()=>meter());assert(right[1]>right[0]*1.15,`right spatial energy ${right}`);
  await pose(a,[0,1.65,0],[0,0,1]);const turn=await a.evaluate(()=>meter());assert(turn[0]>turn[1]*1.15,`head turn reverses direction ${turn}`);
  await pose(a,[0,1.65,0]);await pose(b,[0,1.65,-3]);const near=await a.evaluate(()=>meter());
  await pose(b,[0,1.65,-24]);const far=await a.evaluate(()=>meter());assert(far[0]<near[0]*.5,`attenuation ${near} -> ${far}`);
  await pose(b,[0,1.65,-40]);const outside=await a.evaluate(()=>meter());assert(Math.max(...outside)<.0001,`range cutoff ${outside}`);
  record('guest-to-guest-real-webrtc-and-spatial-output','pass',{left,right,turn,near,far,outside,hostVoice:false});
  await pose(b,[0,1.65,-3]);await a.evaluate(()=>v.mute([...v.members.keys()][0],true));const muted=await a.evaluate(()=>meter());assert(Math.max(...muted)<.0001);
  await a.evaluate(()=>{v.mute([...v.members.keys()][0],false);v.deafen(true);});const deaf=await a.evaluate(()=>meter());assert(Math.max(...deaf)<.0001);await a.evaluate(()=>v.deafen(false));
  await b.evaluate(()=>v.stopMicrophone());assert.equal(await b.evaluate(()=>syntheticTracks.every(t=>t.readyState==='ended')),true);await sleep(300);assert(Math.max(...await a.evaluate(()=>meter()))<.0001);
  await b.click('#mic');await b.waitForFunction(()=>v.stream);await waitForRecoveredAudio(readPair,await readPair(),()=>a.evaluate(()=>meter()));
  record('permission-denial-retry-mute-deafen-track-release','pass');
  // Exercise both protocol roles every run, independent of random room peer IDs.
  const initial=await readPair(),offerer=initial[0].id<initial[1].id?0:1;
  for(const [role,index] of [['offerer',offerer],['answerer',1-offerer]]){
    const retrying=[a,b][index],listener=[a,b][1-index];
    for(const page of [a,b])await page.evaluate(()=>v.stopMicrophone());
    await retrying.click('#mic');await retrying.waitForFunction(()=>v.stream);
    const before=await readPair();
    await waitForRecoveredAudio(readPair,before,()=>listener.evaluate(()=>meter()));
    const calls=await retrying.evaluate(()=>captureCalls);
    await retrying.evaluate(()=>v.retry());
    const newSession=await retrying.evaluate(()=>v.session),sessions=before.map((p,i)=>i===index?newSession:p.session);
    assert.notEqual(newSession,before[index].session);
    assert.equal(await retrying.evaluate(()=>!!v.stream),false);
    assert.equal(await retrying.evaluate(()=>syntheticTracks.every(t=>t.readyState==='ended')),true);
    const replacement=await waitForReplacement(readPair,before,sessions);
    assert.equal(await retrying.evaluate(()=>captureCalls),calls,'replacement never recaptures microphone');
    await retrying.click('#mic');await retrying.waitForFunction(()=>v.stream);
    const energy=await waitForRecoveredAudio(readPair,replacement,()=>listener.evaluate(()=>meter()));
    record(`retry-${role}-replacement-and-audio`,'pass',{retrying:index,newSession,negotiation:replacement[0].negotiation,energy});
  }
  for(const page of [a,b])await page.evaluate(()=>v.stopMicrophone());
  await b.click('#mic');await b.waitForFunction(()=>v.stream);
  const beforeFailure=await readPair();
  await waitForRecoveredAudio(readPair,beforeFailure,()=>a.evaluate(()=>meter()));
  // Simulate an ICE failure; the lower ID retries without recapturing a microphone.
  // Leave retryAt at Infinity until both old edges have been closed, preventing
  // the second failure injection from accidentally closing a new negotiation.
  for(const page of [a,b])await page.evaluate(()=>{for(const [id,member] of v.members){const p=v.peers.get(id);if(p)v.fail(id,p);member.retryAt=Infinity;}});
  for(const page of [a,b])await page.evaluate(()=>{for(const member of v.members.values())member.retryAt=0;});
  const repaired=await waitForReplacement(readPair,beforeFailure,beforeFailure.map(p=>p.session));
  await waitForRecoveredAudio(readPair,repaired,()=>a.evaluate(()=>meter()));
  record('retry-and-failed-connection-recovery','pass');
  await b.evaluate(()=>cleanup());await a.waitForFunction(()=>v.peers.size===0&&v.members.size===0,null,{timeout:15000});assert.equal(await a.evaluate(()=>v.audio.sources.size),0);
  await b.evaluate(()=>cleanup());assert.deepEqual(errors,[],'including repeated cleanup, no unhandled browser errors');
  record('peer-departure-cleans-audio-and-rtc','pass');
} catch(error){record('exception','fail',{message:error.message});for(const p of pages)console.log(JSON.stringify(await p.evaluate(async()=>({state:window.v?.state(),tones:window.toneContexts?.map(c=>({state:c.state,time:c.currentTime})),audio:window.v?.audio?[...v.audio.sources].map(([id,s])=>({id,gain:s.gain.gain.value,position:[s.panner.positionX.value,s.panner.positionY.value,s.panner.positionZ.value],tracks:s.source.mediaStream.getTracks().map(t=>({muted:t.muted,state:t.readyState}))})):[],peers:window.v?await Promise.all([...v.peers].map(async([id,p])=>({id,connection:p.pc.connectionState,signal:p.pc.signalingState,stats:[...await p.pc.getStats()].filter(([,s])=>['inbound-rtp','outbound-rtp'].includes(s.type)).map(([,s])=>s)}))):[]})).catch(()=>null)));process.exitCode=1;}
finally{save('voice');for(const p of pages)await p.evaluate(()=>window.cleanup?.()).catch(()=>{});await browser.close();}
