// Desktop manned Timberline: E mounts into the operator seat, the mouse swings a heavy carriage, click fires along
// the barrel, holding R winds faster and E steps off. Needs the dev server (ACCEPT_BASE) like the other browser checks.
import assert from 'node:assert/strict';
import {createSimulation,terrainHeight} from '../shared/simulation.js';
import {worldTrees} from '../shared/world-content.js';
import {makeSave} from '../client/world-saves.js';
import {launch,BASE,record,save,shot,sleep} from './browser-acceptance-lib.mjs';
const sim=createSimulation({room:'SOLO'}),s=sim.adventureWorld();s.tick=1;s.landmarks=false;s.enemies=[];s.pickups=[];
s.harvestedTrees=worldTrees(s).map(t=>({id:t.id,cuts:3,cutHeight:terrainHeight(s,t.x,t.z)+.5,felledTick:1,fallYaw:0,landed:true}));
for(const k of Object.keys(s.inventions.stockpiles.party))s.inventions.stockpiles.party[k]=60;
s.inventions.structures.push({id:'manned-check',type:'timberline',position:[0,terrainHeight(s,0,5,false),5],yaw:0,hp:200,maxHp:200,side:'party',builtTick:0,readyTick:0,fireTick:-1000,open:false,charge:0,armed:false,aimYaw:0});
const fixture=Buffer.from(JSON.stringify(makeSave(sim.checkpoint())));
const {browser,page}=await launch({viewport:{width:1280,height:720}});
const machine=()=>page.evaluate(()=>window.brannHarness.snapshot().inventions.structures.find(b=>b.id==='manned-check'));
// Captures are evidence, not the check: a software renderer can take longer than a screenshot timeout per frame.
const capture=name=>shot(page,name).catch(e=>record('capture-'+name,'environment-limited',{message:e.message.split('\n')[0]}));
const myId=()=>page.evaluate(()=>window.brannHarness.state().playerId);
try{
 await page.goto(BASE+'/?acceptanceProbe');await page.waitForFunction(()=>window.brannHarness?.state().rendererReady);
 await page.fill('#name','Manned QA');await page.check('input[name="role"][value="hero"]',{force:true});
 await page.locator('#import').setInputFiles({name:'manned.json',mimeType:'application/json',buffer:fixture});
 await page.waitForFunction(()=>window.brannHarness?.state().phase==='game');await sleep(800);
 // The carriage follows mouse-look, which needs pointer capture like the other look-driven checks.
 await page.mouse.click(640,360);await page.waitForFunction(()=>!!document.pointerLockElement,null,{timeout:120000,polling:500});await sleep(300);
 await page.keyboard.press('e');
 const id=await myId();
 await page.waitForFunction(id=>window.brannHarness.snapshot().inventions.structures.find(b=>b.id==='manned-check')?.operator===id,id,{timeout:180000,polling:500});
 record('E-mounts-operator-seat','pass');await sleep(400);await capture('timberline-manned-seat');
 // Software-rendered CI browsers can run at a few frames per second, so every check waits on authority state, not time.
 const until=(fn,arg)=>page.waitForFunction(fn,arg,{timeout:180000,polling:500});
 const aimYaw=()=>machine().then(b=>b.aimYaw);
 // Swing left with the mouse: the carriage follows with weight, so the replicated aim keeps changing for a while.
 // Headless Chromium recentres the captured cursor, so Playwright moves arrive as cancelling movementX pairs (measured
 // 340 then -340). Send one real pointer-lock-style delta through the game's own pointermove handler instead.
 await page.evaluate(()=>window.dispatchEvent(new PointerEvent('pointermove',{pointerType:'mouse',movementX:-300,movementY:-30})));
 await until(()=>window.brannHarness.snapshot().inventions.structures.find(b=>b.id==='manned-check').aimYaw>.05);
 const mid=await aimYaw();await until(m=>window.brannHarness.snapshot().inventions.structures.find(b=>b.id==='manned-check').aimYaw>m+.05,mid);
 const late=await aimYaw();record('heavy-swing','pass',{mid,late});await capture('timberline-manned-swung');
 await page.mouse.down();await page.mouse.up();
 await until(()=>window.brannHarness.snapshot().inventions.structures.find(b=>b.id==='manned-check').fireTick>1);
 const fired=await machine();record('click-fires-along-barrel','pass',{aimYaw:fired.aimYaw,aimPitch:fired.aimPitch});await capture('timberline-manned-fired');
 // Winding starts after the 0.75 s Fire clip; without a crank readyTick never moves, so any decrease is the crank.
 await until(f=>window.brannHarness.snapshot().tick>f+50,fired.fireTick);
 const r0=(await machine()).readyTick;await page.keyboard.down('r');
 await until(r=>window.brannHarness.snapshot().inventions.structures.find(b=>b.id==='manned-check').readyTick<r,r0);
 await page.keyboard.up('r');record('hold-R-winds','pass',{r0,r1:(await machine()).readyTick});
 await page.keyboard.press('e');await until(()=>!window.brannHarness.snapshot().inventions.structures.find(b=>b.id==='manned-check').operator);
 record('E-steps-off','pass');assert.deepEqual(page.errors,[]);
}catch(e){record('exception','fail',{message:e.message,stack:e.stack?.split('\n').slice(0,3).join(' | '),look:await page.evaluate(()=>{const c=window.brannHarness.controls();return {manned:c.manned,yaw:c.yaw,pitch:c.pitch,locked:!!document.pointerLockElement};}).catch(()=>null),machine:await machine().catch(()=>null),me:await page.evaluate(()=>{const h=window.brannHarness;return h.snapshot().players.find(p=>p.id===h.state().playerId).position}).catch(()=>null)});await capture('timberline-manned-failure');process.exitCode=1;}
finally{save('timberline-manned');await browser.close();}
