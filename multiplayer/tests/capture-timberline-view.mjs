// Review captures (not a CI check) of the manned Timberline: seated, then sighting, at desktop or phone size.
// A Timberline is built right beside the Hero's spawn at Dawnhold, facing out like the gate machines.
//   OUT=dir [PHONE=1] [TAG=prefix] node tests/capture-timberline-view.mjs   (needs the dev server, ACCEPT_BASE)
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {homeBallistaYaw} from '../shared/home-ballista.js';
import {createEnemy} from '../shared/combat.js';
import {makeSave} from '../client/world-saves.js';
import {launch,BASE,sleep} from './browser-acceptance-lib.mjs';
import {mkdirSync} from 'node:fs';
const OUT=process.env.OUT||'tests/captures',PHONE=!!process.env.PHONE,TAG=process.env.TAG||'',VIEW=PHONE?{width:844,height:390}:{width:1280,height:720};mkdirSync(OUT,{recursive:true});
const sim=createSimulation({room:'SOLO'}),s=sim.adventureWorld();s.tick=1;s.landmarks=false;s.enemies=[];s.pickups=[];s.battle.nextWaveTick=3600;
for(const k of Object.keys(s.inventions.stockpiles.party))s.inventions.stockpiles.party[k]=60;
// Where a lone Hero spawns in this world, worked out with the same rules the game uses.
const probe=loadSimulation(sim.checkpoint());probe.addPlayer({id:'probe',name:'p',role:'hero'});const spawn=probe.snapshot().players[0].position;
const yaw=homeBallistaYaw('party'),at=[spawn[0]-Math.sin(yaw)*2.2,0,spawn[2]-Math.cos(yaw)*2.2];at[1]=terrainHeight(s,at[0],at[2],false);
s.inventions.structures.push({id:'review-timberline',type:'timberline',position:at,yaw,hp:200,maxHp:200,side:'party',builtTick:0,readyTick:0,fireTick:-1000,open:false,charge:0,armed:false,aimYaw:0});
// A legless skeleton 40 m out to aim at.
const foe=createEnemy('qa-skeleton',[at[0]-Math.sin(yaw)*40,0,at[2]-Math.cos(yaw)*40]);foe.position[1]=terrainHeight(s,foe.position[0],foe.position[2],false);foe.yaw=yaw;foe.missingParts=['leftLeg','rightLeg'];foe.parts.leftLeg=foe.parts.rightLeg=0;s.enemies.push(foe);
const fixture=Buffer.from(JSON.stringify(makeSave(sim.checkpoint())));
const {browser,page}=await launch({viewport:VIEW,touch:PHONE,pointerLock:true,deviceScaleFactor:PHONE?2:1});page.setDefaultTimeout(240000);
const shot=async n=>{await page.screenshot({timeout:240000,path:`${OUT}/${TAG}${n}${PHONE?'-phone':''}.png`});console.log('shot',n);};
const gotIt=()=>page.evaluate(()=>{for(const b of document.querySelectorAll('button'))if(/^Got it$/.test(b.textContent.trim()))b.click();});
const look=(x,y)=>page.evaluate(([x,y])=>window.dispatchEvent(new PointerEvent('pointermove',{pointerType:'mouse',movementX:x,movementY:y})),[x,y]);
try{
 await page.goto(BASE+'/?acceptanceProbe'+(process.env.Q||''));await page.waitForFunction(()=>window.brannHarness?.state().rendererReady,null,{timeout:300000});
 await sleep(1500);await gotIt();
 await page.evaluate(()=>{const n=document.querySelector('#name');n.value='Mog';n.dispatchEvent(new Event('input',{bubbles:true}));const r=document.querySelector('input[name="role"][value="hero"]');r.checked=true;r.dispatchEvent(new Event('change',{bubbles:true}));});
 await page.locator('#import').setInputFiles({name:'review.json',mimeType:'application/json',buffer:fixture});
 await page.waitForFunction(()=>window.brannHarness?.state().phase==='game',null,{timeout:300000});await sleep(5000);await gotIt();
 if(!PHONE){await page.mouse.click(VIEW.width/2,VIEW.height/2);await page.waitForFunction(()=>!!document.pointerLockElement,null,{timeout:120000,polling:500}).catch(()=>console.log('no pointer lock'));}
 const id=await page.evaluate(()=>window.brannHarness.state().playerId);
 console.log('me',await page.evaluate(()=>{const h=window.brannHarness;return h.snapshot().players.find(p=>p.id===h.state().playerId)?.position}),'machine',at);
 for(let i=0;i<5;i++){await page.keyboard.press('e');const ok=await page.waitForFunction(id=>window.brannHarness.snapshot().inventions.structures.find(b=>b.id==='review-timberline')?.operator===id,id,{timeout:40000,polling:500}).then(()=>true,()=>false);if(ok)break;}
 await look(0,-20);await sleep(+(process.env.SETTLE||8000));await shot('seated');
 if(PHONE)await page.keyboard.press('q'); // the Sight button and Q both toggle sighting
 else await page.mouse.down({button:'right'});
 await page.waitForFunction(()=>window.brannHarness.controls().timberlineAim?.scope>=1,null,{timeout:120000,polling:300}).catch(()=>console.log('scope wait timed out'));
 await sleep(4000);await shot('sight');
 await look(0,-60);await sleep(8000);await shot('sight-high');
}catch(e){console.log('ERR',e.message.split('\n')[0]);await shot('failure').catch(()=>{});process.exitCode=1;}
finally{await browser.close();}
