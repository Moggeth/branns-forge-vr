import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {worldTrees} from '../shared/world-content.js';
import {makeSave} from '../client/world-saves.js';
import {launch,BASE,record,save,shot,sleep} from './browser-acceptance-lib.mjs';
const sim=createSimulation({room:'SOLO'}),s=sim.adventureWorld();s.tick=1;s.landmarks=false;s.deposits=[];s.enemies=[];
s.harvestedTrees=worldTrees(s).map(t=>({id:t.id,cuts:3,cutHeight:terrainHeight(s,t.x,t.z)+.5,felledTick:1,fallYaw:0,landed:true}));
s.pickups=[{id:'cue-stone',kind:'stone',x:0,z:5.6,y:terrainHeight(s,0,5.6),amount:2}];
loadSimulation(sim.checkpoint());
const fixture=Buffer.from(JSON.stringify(makeSave(sim.checkpoint())));
const {browser,context,page}=await launch({touch:true,viewport:{width:844,height:390}});
const cdp=await context.newCDPSession(page);
async function importFixture(data){
 await page.goto(BASE+'/?acceptanceProbe');await page.waitForFunction(()=>window.brannHarness?.state().rendererReady);
 await page.fill('#name','Cue projection QA');await page.check('input[name="role"][value="hero"]',{force:true});
 await page.locator('#import').setInputFiles({name:'cue.json',mimeType:'application/json',buffer:data});
 await page.waitForFunction(()=>window.brannHarness?.state().phase==='game');await sleep(300);
}
async function drag(dx,dy){
 const {width,height}=page.viewportSize(),x=width*.5,y=height*.28;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/8,y:y+dy*i/8}]});await sleep(20);}
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(650);
}
async function check(name){
 await page.waitForFunction(()=>document.querySelector('.bf-cue--placed:not([hidden])'),null,{timeout:5000});
 const read=await page.evaluate(()=>({s:window.brannHarness.snapshot(),c:window.brannHarness.controls(),id:window.brannHarness.state().playerId,
  circle:{x:+document.querySelector('.bf-cue-leader circle').getAttribute('cx'),y:+document.querySelector('.bf-cue-leader circle').getAttribute('cy')},
  label:document.querySelector('.bf-cue').getBoundingClientRect().toJSON(),leader:document.querySelector('.bf-cue-leader polyline').getAttribute('points'),
  text:document.querySelector('.bf-cue').innerText,canvas:document.querySelector('canvas').getBoundingClientRect().toJSON()}));
 const me=read.s.players.find(p=>p.id===read.id),p=read.s.pickups.find(p=>p.id==='cue-stone'),{width,height}=page.viewportSize();
 const camera=new THREE.PerspectiveCamera(read.c.weapon.fov,width/height,.1,1000);
 camera.position.set(me.position[0],me.position[1]+1.65,me.position[2]);camera.rotation.set(read.c.pitch,read.c.yaw,0,'YXZ');camera.updateMatrixWorld();
 const target=new THREE.Vector3(p.x,terrainHeight(read.s,p.x,p.z)+.25,p.z).project(camera);
 const expected={x:read.canvas.x+(target.x+1)*read.canvas.width/2,y:read.canvas.y+(1-target.y)*read.canvas.height/2};
 const b=read.label,r=read.circle;
 record(name,'observed',{expected,ring:r,label:b,text:read.text,controls:read.c,player:me.position});await shot(page,name);
 assert.ok(Math.hypot(expected.x-r.x,expected.y-r.y)<1.5,'leader ring must match independent projection of actual pickup');
 assert.ok(b.x>=0&&b.y>=0&&b.right<=width+1&&b.bottom<=height+1,'label stays fully on screen');
 assert.ok(!(r.x>=b.x-9&&r.x<=b.right+9&&r.y>=b.y-9&&r.y<=b.bottom+9),'label leaves target ring visible');
 const endpoint=read.leader.trim().split(' ').at(-1).split(',').map(Number);
 assert.ok(endpoint[0]>=b.x-1&&endpoint[0]<=b.right+1&&endpoint[1]>=b.y-1&&endpoint[1]<=b.bottom+1,'leader reaches actual label bounds');
 assert.match(read.text,/Collect/);assert.deepEqual(page.errors,[]);record(name,'pass');
}
try{
 await importFixture(fixture);
 await drag(0,170);await check('cue-landscape');
 await page.setViewportSize({width:390,height:650});await sleep(650);await check('cue-portrait');
 await drag(95,0);await check('cue-portrait-edge');
 await page.setViewportSize({width:844,height:390});await sleep(650);await check('cue-landscape-edge');
 await page.locator('.ta-chip').tap();await page.waitForFunction(()=>!window.brannHarness.snapshot().pickups.some(p=>p.id==='cue-stone'));
 await drag(-95,-170);await page.keyboard.down('w');await sleep(900);await page.keyboard.up('w');await sleep(400);
 await page.waitForFunction(()=>document.querySelector('.ta-chip:not([hidden])')?.textContent.includes('Open workshop'),null,{timeout:4000});
 await shot(page,'cue-forge-proximity');
 await page.keyboard.press('e');await page.waitForFunction(()=>window.brannHarness.state().forgeOpen,null,{timeout:4000});
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.brannHarness.state().forgeOpen);await sleep(350);
 await page.locator('.ta-chip').tap();await page.waitForFunction(()=>window.brannHarness.state().forgeOpen,null,{timeout:4000});
 await shot(page,'cue-touch-workshop-open');assert.deepEqual(page.errors,[]);record('forge-E-and-direct-touch-workshop','pass');
 for(const kind of ['tree','ore']){
  const specimen=createSimulation({room:'SOLO'}),world=specimen.adventureWorld();Object.assign(world,{tick:1,landmarks:false,enemies:[],pickups:[],deposits:[]});
  const tree=worldTrees(world).find(t=>t.x===1.8&&t.z===6.5);
  assert.ok(tree,'known nearby authored tree fixture');
  world.harvestedTrees=worldTrees(world).filter(t=>kind!=='tree'||t.id!==tree.id).map(t=>({id:t.id,cuts:3,cutHeight:terrainHeight(world,t.x,t.z)+.5,felledTick:1,fallYaw:0,landed:true}));
  if(kind==='ore')world.deposits=[{id:'cue-ore',kind:'stone',x:0,z:5.6,hits:0,maxHits:3,depleted:false}];
  loadSimulation(specimen.checkpoint());await importFixture(Buffer.from(JSON.stringify(makeSave(specimen.checkpoint()))));
  if(kind==='ore')await page.keyboard.press('2');
  await drag(kind==='tree'?Math.atan2(1.8,1.5)/.003:0,kind==='tree'?90:120);
  await page.waitForFunction(k=>document.querySelector('.bf-cue--placed:not([hidden])')?.dataset.kind===k,kind,{timeout:4000});
  const ring=await page.locator('.bf-cue-leader circle').evaluate(n=>({x:+n.getAttribute('cx'),y:+n.getAttribute('cy')}));
  assert.ok(Math.hypot(ring.x-422,ring.y-195)<1,'actual mesh ray impact projects to aim center');
  const label=await page.locator('.bf-cue').boundingBox();assert.ok(!(422>=label.x&&422<=label.x+label.width&&195>=label.y&&195<=label.y+label.height));
  await shot(page,'cue-'+kind+'-actual-mesh');record(kind+'-actual-mesh-projection','pass',{ring});
 }
}catch(error){record('cue-exception','fail',{message:error.message,errors:page.errors,controls:await page.evaluate(()=>window.brannHarness?.controls()),text:await page.locator('body').innerText()});await shot(page,'cue-failure');process.exitCode=1;}
finally{save('interaction-cue');await browser.close();}
