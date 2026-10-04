import assert from 'node:assert/strict';
import {launch,BASE,record,save,shot,sleep} from './browser-acceptance-lib.mjs';
const desktop=await launch(), mobile=await launch({touch:true,viewport:{width:390,height:844}});
const pages=[desktop.page,mobile.page];
try {
  for(const ctx of [desktop.context,mobile.context])await ctx.addInitScript(()=>{
    window.captureCalls=0;window.syntheticTracks=[];window.syntheticContexts=[];
    // No fallback to the machine microphone, even if a test accidentally clicks it.
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
      captureCalls++; if(window.denyMic)throw new DOMException('Test denial','NotAllowedError');
      const ctx=new AudioContext(),osc=ctx.createOscillator(),gain=ctx.createGain(),out=ctx.createMediaStreamDestination();
      syntheticContexts.push(ctx);osc.frequency.value=440;gain.gain.value=.08;osc.connect(gain).connect(out);osc.start();await ctx.resume();syntheticTracks.push(...out.stream.getTracks());return out.stream;
    }});
  });
  for(const page of pages){await page.goto(BASE+'/?acceptanceProbe');await page.waitForFunction(()=>window.brannHarness);await page.keyboard.press('Escape');}
  const [hero,god]=pages;
  await hero.fill('#name','Voice Hero');await hero.click('#create');await hero.waitForFunction(()=>brannHarness.state().phase==='game',null,{timeout:60000});
  const room=await hero.evaluate(()=>brannHarness.snapshot().room);
  await god.fill('#name','Voice God');await god.check('input[name="role"][value="god"]',{force:true});await god.fill('#room',room);await god.locator('#join').tap();
  for(const page of pages)await page.waitForFunction(()=>brannHarness.snapshot()?.players.length===2,null,{timeout:60000});
  for(const page of pages){assert.equal(await page.evaluate(()=>captureCalls),0);await page.locator(page===god?'[data-touch-action="menu"]':'#menuButton').click();await page.locator('[data-voice="join"]').click();}
  await hero.waitForFunction(()=>brannHarness.voice()?.peers[0]?.state==='connected',null,{timeout:30000});
  for(const page of pages)assert.equal(await page.evaluate(()=>captureCalls),0);
  await god.evaluate(()=>window.denyMic=true);await god.locator('[data-voice="mic"]').tap();await god.waitForFunction(()=>brannHarness.voice().message.includes('site settings'));
  await god.evaluate(()=>window.denyMic=false);await god.locator('[data-voice="mic"]').tap();await god.waitForFunction(()=>brannHarness.voice().microphone);
  assert.equal(await god.locator('[data-voice]').evaluateAll(buttons=>buttons.every(b=>b.scrollWidth<=b.clientWidth+1)),true,'voice button labels fit phone width');
  await shot(god,'voice-mobile-menu');
  await shot(hero,'voice-desktop-menu');
  const godPose=await god.evaluate(()=>({voice:brannHarness.voice().pose,controls:brannHarness.controls()}));
  assert(Math.abs(godPose.voice.position[0]-godPose.controls.pan[0])<.01);assert(Math.abs(godPose.voice.position[2]-godPose.controls.pan[2])<.01);
  await god.locator('#resumePlay').tap();
  // Touch camera orbit/pan uses real gestures; compare listener orientation before/after.
  const before=await god.evaluate(()=>brannHarness.voice().pose);
  const stick=await god.locator('[data-stick="right"]').boundingBox(),cdp=await mobile.context.newCDPSession(god);
  const x=stick.x+stick.width/2,y=stick.y+stick.height/2;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+24,y:y-8}]});await sleep(500);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();await sleep(200);
  const after=await god.evaluate(()=>brannHarness.voice().pose);
  assert(Math.hypot(...after.forward.map((n,i)=>n-before.forward[i]))>.02,'touch camera orbit updates listener orientation');
  await god.locator('.mq-more').tap();await god.locator('[data-voice-badge]').click();await god.waitForFunction(()=>!brannHarness.voice().microphone);
  assert.equal(await god.evaluate(()=>syntheticTracks.every(t=>t.readyState==='ended')),true);
  record('actual-desktop-hero-mobile-god-menu-opt-in-and-quick-mute','pass',{godFocus:godPose.voice.position,before:before.forward,after:after.forward});
  await hero.locator('[data-voice="mic"]').click();await hero.waitForFunction(()=>brannHarness.voice().microphone);
  await hero.locator('[data-voice="deafen"]').click();assert.equal(await hero.evaluate(()=>syntheticTracks.every(t=>t.readyState==='ended')),true);
  await hero.locator('[data-voice="deafen"]').click();assert.equal(await hero.evaluate(()=>brannHarness.voice().microphone),false);
  await hero.locator('[data-voice="join"]').click();await god.locator('[data-touch-action="menu"]').tap();await god.locator('[data-voice="join"]').tap();
  for(const page of pages)assert.equal(await page.evaluate(()=>brannHarness.voice().active),false);
  assert.deepEqual([...hero.errors,...god.errors],[]);record('actual-game-leave-deafen-console','pass');
}catch(error){record('exception','fail',{message:error.message});for(const [i,page] of pages.entries()){console.log(await page.evaluate(()=>({state:window.brannHarness?.state(),voice:window.brannHarness?.voice(),errors:document.querySelector('#lobbyStatus')?.textContent})).catch(()=>null));await shot(page,'voice-game-failure-'+i).catch(()=>{});}process.exitCode=1;}
finally{save('voice-game');await desktop.browser.close();await mobile.browser.close();}
