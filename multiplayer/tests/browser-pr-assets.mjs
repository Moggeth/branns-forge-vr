import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {worldTrees} from '../shared/world-content.js';
import {makeSave} from '../client/world-saves.js';
import {launch,BASE,record,save,shot,sleep} from './browser-acceptance-lib.mjs';
const sim=createSimulation({room:process.env.ASSET_CLOUD?'LOCAL':'SOLO'}),s=sim.adventureWorld();s.tick=1;s.landmarks=false;s.deposits=[];s.enemies=[];s.harvestedTrees=worldTrees(s).map(t=>({id:t.id,cuts:3,cutHeight:terrainHeight(s,t.x,t.z)+.5,felledTick:1,fallYaw:0,landed:true}));
for(const k of Object.keys(s.inventions.stockpiles.party))s.inventions.stockpiles.party[k]=80;
s.inventions.structures.push({id:'qa-timberline',type:'timberline',position:[0,terrainHeight(s,0,4.5,false),4.5],yaw:Math.PI/2,hp:200,maxHp:200,side:'party',builtTick:0,readyTick:0,fireTick:-1000,open:false,charge:0,armed:false,aimYaw:0});loadSimulation(sim.checkpoint());
const fixture=Buffer.from(JSON.stringify(makeSave(sim.checkpoint())));
for(const role of (process.env.ASSET_CLOUD?['god']:['god','hero'])){
 const {browser,page}=await launch({viewport:{width:1440,height:900}});
 try{
  await page.goto(BASE+'/?acceptanceProbe');await page.waitForFunction(()=>window.brannHarness?.state().rendererReady);await page.check(`input[name="role"][value="${role}"]`,{force:true});await page.locator('#import').setInputFiles({name:'asset-review.json',mimeType:'application/json',buffer:fixture});await page.waitForFunction(()=>window.brannHarness.state().phase==='game');
  await page.waitForFunction(()=>document.querySelector('#world').brannDiagnostics().inventions.models.some(m=>m.asset==='opus-twinbolt'));
  await sleep(700);await shot(page,'timberline-'+role+'-loaded');
  if(role==='god'){
   let guest=null;
   if(process.env.ASSET_CLOUD){const context=await browser.newContext({viewport:{width:1280,height:720}});guest=await context.newPage();guest.on('pageerror',e=>page.errors.push(e.message));const room=await page.evaluate(()=>window.brannHarness.snapshot().room);await guest.goto(BASE+'/?acceptanceProbe');await guest.waitForFunction(()=>window.brannHarness?.state().rendererReady);await guest.fill('#name','Asset guest');await guest.evaluate(r=>{document.getElementById('joinBlock').hidden=false;document.getElementById('room').value=r;},room);await guest.click('#join');await guest.waitForFunction(()=>window.brannHarness.snapshot()?.players.length===2);await guest.waitForFunction(()=>document.querySelector('#world').brannDiagnostics().inventions.models.some(m=>m.asset==='opus-twinbolt'));record('cloud-late-join-authored-asset','pass',{room});}

   await page.keyboard.press('b');await page.keyboard.press('c');await page.waitForSelector('.ip-panel');await page.locator('[data-ip-tab="built"]').click();await page.locator('[data-ip-operate="qa-timberline"]').click();await page.mouse.click(450,460);
   await page.waitForFunction(()=>window.brannHarness.snapshot().inventions.structures.find(b=>b.id==='qa-timberline').fireTick>0,{},{timeout:4000});
   await page.waitForFunction(()=>document.querySelector('#world').brannDiagnostics().inventions.models.find(b=>b.id==='qa-timberline').phase==='reloading');await shot(page,'timberline-reload');
   if(guest){await guest.waitForFunction(()=>document.querySelector('#world').brannDiagnostics().inventions.models.find(b=>b.id==='qa-timberline').phase==='reloading');const ticks=await Promise.all([page,guest].map(p=>p.evaluate(()=>window.brannHarness.snapshot().inventions.structures.find(b=>b.id==='qa-timberline').fireTick)));assert.equal(ticks[0],ticks[1]);await shot(guest,'timberline-guest-reload');record('cloud-shared-fire-tick-and-reload','pass',{ticks});}

   await page.waitForFunction(()=>document.querySelector('#world').brannDiagnostics().inventions.models.find(b=>b.id==='qa-timberline').phase==='loaded');
   record('timberline-authoritative-click-fire-reload','pass',{diagnostics:await page.evaluate(()=>document.querySelector('#world').brannDiagnostics().inventions)});
  }else{
   await page.keyboard.press('2');await sleep(500);await shot(page,'pick-charged');await page.locator('#world').click({position:{x:720,y:460}});await page.keyboard.press('q');await sleep(120);await shot(page,'pick-spent');await sleep(4300);await shot(page,'pick-recharged');
   record('hero-authored-machine-and-pick-shaders','pass');
  }
  assert.deepEqual(page.errors,[]);
 }catch(error){record('asset-browser-failure','fail',{role,message:error.message,errors:page.errors,text:(await page.locator('body').innerText()).slice(-1400)});await shot(page,'asset-failure-'+role);process.exitCode=1;}
 finally{await browser.close();}
}
save('pr-assets');
