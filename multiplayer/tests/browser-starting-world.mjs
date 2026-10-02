import assert from 'node:assert/strict';
import {launch,record,save,shot,BASE,sleep,enterWorld,me} from './browser-acceptance-lib.mjs';
import {createSimulation,terrainHeight} from '../shared/simulation.js';
import {createEnemy,hitEnemyPart} from '../shared/combat.js';
import {makeSave} from '../client/world-saves.js';
import * as T from 'three';
const {browser,page}=await launch({touch:true,viewport:{width:960,height:600}}),cd=await page.context().newCDPSession(page);
const sim=createSimulation({seed:17}),w=sim.adventureWorld();w.pickups=[];
const e=createEnemy('salvage',[0,terrainHeight(w,0,6),6],'golem');e.armor=0;w.enemies=[e];
hitEnemyPart(w,e,'torso',1000,{tool:'pick'},{terrainHeight,nextId:(s,k)=>k+(++s.idCounter)},[]);
w.detachedParts=w.detachedParts.filter(d=>d.part==='torso');const d=w.detachedParts[0];d.position=[0,terrainHeight(w,0,6)+.7,6];d.velocity=[0,0,0];d.angularVelocity=[0,0,0];
try{
 await enterWorld(page,{role:'god',name:'Landscape review'});await page.mouse.move(480,300);await page.mouse.wheel(0,850);await sleep(500);await shot(page,'starting-world-rts');
 await page.locator('[data-touch-action="menu"]').tap();await page.locator('#leave').click();await page.waitForSelector('#lobby:not([hidden])');
 await page.locator('#import').setInputFiles({name:'salvage-qa.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(makeSave(sim.checkpoint())))});await page.waitForFunction(()=>window.brannHarness.state().connected);await sleep(1300);
 // Import uses the lobby role last selected; choose Hero explicitly.
 if((await me(page)).self.role!=='hero'){await page.locator('[data-touch-action="menu"]').tap();await page.check('input[name="menuRole"][value="hero"]',{force:true});await page.locator('#resumePlay').tap();await sleep(200);}
 await page.locator('[data-equip="pick"]').tap();await sleep(180);
 await cd.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:460,y:190,id:1}]});await cd.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:460,y:380,id:1}]});await cd.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(180);
 async function target(){const {s,self}=await me(page),q=s.detachedParts.find(q=>q.id===d.id);const c=await page.evaluate(()=>window.brannHarness.controls());const cam=new T.PerspectiveCamera(70,960/600,.05,180);cam.position.fromArray(self.position);cam.position.y+=1.65;cam.rotation.set(c.pitch,c.yaw,0,'YXZ');cam.updateMatrixWorld();const v=new T.Vector3(...q.position).project(cam);return [(v.x+1)*480,(1-v.y)*300];}
 await shot(page,'golem-salvage-before');await page.touchscreen.tap(...await target());await page.waitForFunction(id=>window.brannHarness.snapshot().detachedParts.find(q=>q.id===id)?.miningHits===1,d.id,{timeout:5000});record('tap-pick-performs-real-mining-swing','pass');
 await sleep(600);await page.touchscreen.tap(...await target());await page.waitForFunction(id=>!window.brannHarness.snapshot().detachedParts.some(q=>q.id===id),d.id,{timeout:5000});assert.ok((await me(page)).s.pickups.some(p=>p.kind==='stone'));record('second-pick-swing-yields-stone','pass');await shot(page,'golem-salvage-after');
 for(const size of [{width:390,height:650},{width:844,height:340}]){await page.setViewportSize(size);await sleep(200);await shot(page,`direct-actions-${size.width}`);const blocks=await page.evaluate(()=>{const sels=['.ta-q','#special','[data-touch-action="strike"]','[data-touch-action="jump"]','[data-stick="left"]','[data-stick="right"]'];const a=sels.flatMap(s=>[...document.querySelectorAll(s)]).map(e=>({e,r:e.getBoundingClientRect()})).filter(({r})=>r.width&&r.height);return a.filter(({e,r})=>!e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))).map(({e})=>e.outerHTML.slice(0,140));});assert.deepEqual(blocks,[]);record(`direct-touch-reachability-${size.width}`,'pass');}
 assert.deepEqual(page.errors,[]);record('console','pass');
}catch(e){record('exception','fail',{message:e.message,state:await page.evaluate(()=>({state:window.brannHarness?.state(),controls:window.brannHarness?.controls(),text:document.body.innerText.slice(-1700)}))});await shot(page,'starting-world-failure');process.exitCode=1;}finally{save('starting-world');await browser.close();}
