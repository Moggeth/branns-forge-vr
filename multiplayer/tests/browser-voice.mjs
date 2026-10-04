import assert from 'node:assert/strict';
import {launch,BASE,record,save,sleep} from './browser-acceptance-lib.mjs';
const {browser,context,page:host}=await launch();const a=await context.newPage(),b=await context.newPage();
const pages=[host,a,b], endpoint=process.env.VOICE_WS_URL||'ws://127.0.0.1:8796/peer/ws';
const pose=async(page,position,forward=[0,0,-1])=>{await page.evaluate(({position,forward})=>v.updatePose({position,forward,up:[0,1,0]}),{position,forward});await sleep(450);};
try {
  for(const page of pages){await page.goto(BASE+'/tests/voice-harness.html');await page.waitForFunction(()=>window.makeVoice);}
  await host.evaluate(url=>makeVoice(url,{name:'Host',desktop:true}),endpoint);await host.waitForFunction(()=>c.room&&c.peerId);
  const room=await host.evaluate(()=>c.room);
  for(const [i,page] of [a,b].entries())await page.evaluate(({url,room,i})=>makeVoice(url,{room,name:'Guest '+i,desktop:true}),{url:endpoint,room,i});
  await host.waitForFunction(()=>c.peers.size===2&&[...c.peers.values()].every(p=>p.channel?.readyState==='open'));
  // Host deliberately stays out of voice: it must still relay metadata for guests.
  for(const page of [a,b])await page.click('#listen');
  await a.waitForFunction(()=>v.peers.size===1&&[...v.peers.values()][0].pc.connectionState==='connected',null,{timeout:25000});
  assert.equal(await a.evaluate(()=>captureCalls),0);assert.equal(await b.evaluate(()=>captureCalls),0);
  await b.evaluate(()=>window.deny=true);await b.click('#mic');await b.waitForFunction(()=>v.message.includes('site settings'));
  await b.evaluate(()=>window.deny=false);await b.click('#mic');await b.waitForFunction(()=>v.stream);
  await pose(b,[-4,1.65,-2]);await sleep(700);const left=await a.evaluate(()=>meter());
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
  await b.click('#mic');await b.waitForFunction(()=>v.stream);await sleep(500);assert(Math.max(...await a.evaluate(()=>meter()))>.001);
  record('permission-denial-retry-mute-deafen-track-release','pass');
  await b.evaluate(()=>v.retry());await a.waitForFunction(()=>v.peers.size===1&&[...v.peers.values()][0].pc.connectionState==='connected',null,{timeout:20000});
  assert.equal(await b.evaluate(()=>!!v.stream),false);await b.click('#mic');await sleep(700);assert(Math.max(...await a.evaluate(()=>meter()))>.001);
  // Simulate an ICE failure; the lower ID retries without recapturing a microphone.
  await a.evaluate(()=>{const [id,p]=[...v.peers][0];v.fail(id,p);v.members.get(id).retryAt=0;});
  await b.evaluate(()=>{const [id,p]=[...v.peers][0];if(p)v.fail(id,p);v.members.get(id).retryAt=0;});
  await a.waitForFunction(()=>v.peers.size===1&&[...v.peers.values()][0].pc.connectionState==='connected',null,{timeout:20000});
  await sleep(700);assert(Math.max(...await a.evaluate(()=>meter()))>.001);
  record('retry-and-failed-connection-recovery','pass');
  await b.evaluate(()=>cleanup());await a.waitForFunction(()=>v.peers.size===0&&v.members.size===0,null,{timeout:15000});assert.equal(await a.evaluate(()=>v.audio.sources.size),0);
  record('peer-departure-cleans-audio-and-rtc','pass');
} catch(error){record('exception','fail',{message:error.message});for(const p of pages)console.log(JSON.stringify(await p.evaluate(async()=>({state:window.v?.state(),tones:window.toneContexts?.map(c=>({state:c.state,time:c.currentTime})),audio:window.v?.audio?[...v.audio.sources].map(([id,s])=>({id,gain:s.gain.gain.value,position:[s.panner.positionX.value,s.panner.positionY.value,s.panner.positionZ.value],tracks:s.source.mediaStream.getTracks().map(t=>({muted:t.muted,state:t.readyState}))})):[],peers:window.v?await Promise.all([...v.peers].map(async([id,p])=>({id,connection:p.pc.connectionState,signal:p.pc.signalingState,stats:[...await p.pc.getStats()].filter(([,s])=>['inbound-rtp','outbound-rtp'].includes(s.type)).map(([,s])=>s)}))):[]})).catch(()=>null)));process.exitCode=1;}
finally{save('voice');for(const p of pages)await p.evaluate(()=>window.cleanup?.()).catch(()=>{});await browser.close();}
