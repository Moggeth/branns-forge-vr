import assert from 'node:assert/strict';
import * as T from 'three';
import {launch,record,save,shot,BASE,sleep,me} from './browser-acceptance-lib.mjs';
import {createSimulation,terrainHeight} from '../shared/simulation.js';
import {makeSave} from '../client/world-saves.js';
const {browser,page}=await launch({touch:true,viewport:{width:960,height:600}});
const sim=createSimulation({seed:17}),w=sim.adventureWorld();w.pickups=[];w.deposits=[{id:'oreReview',kind:'meteor',x:0,z:6.3,hits:0,maxHits:5,depleted:false}];
try{
 await page.goto(BASE+'/?acceptanceProbe');await page.waitForFunction(()=>window.brannHarness);await page.fill('#name','StarShard review');
 await page.locator('#import').setInputFiles({name:'fracture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(makeSave(sim.checkpoint())))});await page.waitForFunction(()=>window.brannHarness.snapshot()?.players.length);await sleep(900);
 await page.locator('[data-equip="pick"]').tap();
 const cd=await page.context().newCDPSession(page);
 await cd.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:460,y:190,id:1}]});await cd.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:460,y:330,id:1}]});await cd.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(180);await shot(page,'geode-browser-before');
 for(let i=1;i<=2;i++){
  const {s,self}=await me(page),c=await page.evaluate(()=>window.brannHarness.controls());const cam=new T.PerspectiveCamera(70,1.6,.05,180);cam.position.fromArray(self.position);cam.position.y+=1.65;cam.rotation.set(c.pitch,c.yaw,0,'YXZ');cam.updateMatrixWorld();
  const v=new T.Vector3(0,terrainHeight(s,0,6.3)+.6,6.3).project(cam);await page.touchscreen.tap((v.x+1)*480,(1-v.y)*300);
  await page.waitForFunction(n=>window.brannHarness.snapshot().deposits[0].hits>=n,i,{timeout:5000});await sleep(700);await shot(page,`geode-browser-hit-${i}`);
 }
 const d=await page.evaluate(()=>document.querySelector('canvas').brannDiagnostics().world.geodeLights);assert.equal(d.lit,1);assert.ok(d.geodes[0].holes>0);record('geode-light-two-real-swings','pass',{geode:d});assert.deepEqual(page.errors,[]);
}catch(e){record('exception','fail',{message:e.message,text:await page.locator('body').innerText()});await shot(page,'geode-browser-failure');process.exitCode=1;}finally{save('geode-light');await browser.close();}
