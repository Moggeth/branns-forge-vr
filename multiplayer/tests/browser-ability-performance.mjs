// Run after starting Vite: FORGE_PERF_URL=http://127.0.0.1:5195 node tests/browser-ability-performance.mjs
import {launch} from './browser-acceptance-lib.mjs';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const out=resolve(root,'logs/ability-performance');
const fixture=fileURLToPath(new URL('.ability-perf.html',import.meta.url));
import {writeFileSync,unlinkSync,mkdirSync} from 'node:fs';
mkdirSync(out,{recursive:true});
const {browser,page}=await launch({touch:process.env.PERF_TOUCH==='1',deviceScaleFactor:Number(process.env.PERF_DPR)||1,viewport:{width:800,height:450}}),begin=performance.now(),label=process.env.PERF_LABEL||'current';
writeFileSync(fixture,'<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0}canvas{width:800px;height:450px}</style><canvas></canvas>');
try{
 await page.route('**/@vite/client',route=>route.fulfill({contentType:'application/javascript',body:'export const createHotContext=()=>({accept(){},dispose(){},prune(){},invalidate(){},on(){},send(){},data:{}}); export const injectQuery=u=>u; export const updateStyle=()=>{}; export const removeStyle=()=>{};'}));
 await page.goto(`${process.env.FORGE_PERF_URL||'http://127.0.0.1:5195'}/tests/.ability-perf.html`,{waitUntil:'networkidle'});
 await page.evaluate(async ({enemyCount,sourceRoot})=>{
  const {createGame}=await import(sourceRoot+'/client/game.js'),{createSimulation}=await import(sourceRoot+'/shared/simulation.js');const sim=createSimulation({seed:41});sim.addPlayer({id:'p',role:'hero'});let seq=0;
  const state=sim.adventureWorld(),player=state.players[0];
  if(enemyCount){const {createEnemy}=await import(sourceRoot+'/shared/combat.js');const {terrainHeight}=await import(sourceRoot+'/shared/simulation.js');for(let i=0;i<enemyCount;i++){const a=i/enemyCount*Math.PI*2,x=player.position[0]+Math.cos(a)*10,z=player.position[2]+Math.sin(a)*10;state.enemies.push(createEnemy('perf-enemy'+i,[x,terrainHeight(state,x,z),z]));}}
  window.actionResults=[];
  const game=createGame({canvas:document.querySelector('canvas'),isHost:()=>true,onInput:input=>sim.command('p',{type:'input',seq:++seq,...input}),onAction:(action,body)=>{const r=sim.command('p',{type:'action',seq:++seq,action,...body});window.actionResults.push({action,result:r});for(const e of r.events||[])game.handleEvent(e);}});
  window.qa={game,sim};game.applySnapshot(sim.snapshot(),'p');game.setActive(true);game.setTouchEnabled(true);
  window.timer=setInterval(()=>{if(enemyCount)player.hp=Math.max(player.hp,100);for(let i=0;i<3;i++)for(const event of sim.step())game.handleEvent(event);game.applySnapshot(sim.snapshot(),'p');},50);
 },{enemyCount:Number(process.env.PERF_ENEMIES)||0,sourceRoot:process.env.PERF_SOURCE_ROOT||''});
 await page.waitForFunction(()=>qa.game.diagnostics().startup.ready,null,{timeout:120000});
 const cdp=await page.context().newCDPSession(page);await cdp.send('Profiler.enable');const results=[];
 for(const phase of ['idle','pickAim','pickCast','bowAim']){
  if(phase==='pickAim'||phase==='bowAim'){await page.evaluate(tool=>qa.game.equip(tool),phase==='pickAim'?'pick':'bow');await page.waitForTimeout(800);}
  await cdp.send('Profiler.start');
  await page.evaluate(phase=>{const actionStart=performance.now();const g=qa.game;if(phase==='pickAim'){g.specialPress(true);}if(phase==='pickCast'){g.specialPress(false);g.setTouchAxes('left',0,0);}if(phase==='bowAim'){g.primaryDown();g.special();}window.actionCpuMs=performance.now()-actionStart;window.intervals=[];window.lastAt=null;window.run=true;const generation=window.generation=(window.generation||0)+1;let step=0;const tick=t=>{if(!window.run||generation!==window.generation)return;step++;if(phase==='pickAim')g.setTouchAxes('left',.2*Math.sin(step*.015),0);if(window.lastAt!==null)window.intervals.push(t-window.lastAt);window.lastAt=t;if(phase==='bowAim'||phase==='pickAim')g.lookByPixels(.8*Math.sin(step*.016),0);requestAnimationFrame(tick);};requestAnimationFrame(tick);},phase);
  await page.waitForTimeout(Number(process.env.PERF_PHASE_MS)||2500);
  const result=await page.evaluate(()=>{window.run=false;const d=qa.game.diagnostics(),a=window.intervals.filter(x=>x>=0).sort((x,y)=>x-y);return{actionCpuMs:window.actionCpuMs,frameP50:a[a.length>>1],frameP95:a[Math.floor(a.length*.95)],frameP99:a[Math.floor(a.length*.99)],over50:a.filter(ms=>ms>50).length,frames:a.length,cpu:d.cpuTimings,gpu:d.gpuTiming,calls:d.calls,triangles:d.triangles,geometries:d.geometries,textures:d.textures,actions:window.actionResults,player:qa.sim.snapshot().players[0].position,enemies:qa.sim.snapshot().enemies.length,graphics:d.graphics,guide:d.guideTiming,terrain:d.terrainSampler,effects:d.effects,world:d.world,landmarks:d.landmarks,startup:d.startup};});
  // Exclude profiler start/stop and screenshot IPC from gameplay intervals.
  const {profile}=await cdp.send('Profiler.stop');
  await page.screenshot({path:resolve(out,`${label}-${phase}.png`)});
  const counts=new Map();for(const id of profile.samples||[])counts.set(id,(counts.get(id)||0)+1);result.top=profile.nodes.map(n=>({name:n.callFrame.functionName,url:n.callFrame.url.split('/').slice(-2).join('/'),hits:counts.get(n.id)||0})).sort((a,b)=>b.hits-a.hits).slice(0,14);result.phase=phase;results.push(result);writeFileSync(resolve(out,`${label}-${phase}.cpuprofile`),JSON.stringify(profile));
 }
 await page.evaluate(()=>{clearInterval(window.timer);qa.game.dispose()});writeFileSync(resolve(out,`${label}.json`),JSON.stringify({results,errors:page.errors,seconds:(performance.now()-begin)/1000},null,2));assert.deepEqual(page.errors,[]);assert.ok(!results[0].startup.error);assert.ok(results.find(r=>r.phase==='pickCast').world.crystalWalls.walls>0,'actual wall cast');assert.ok(results.find(r=>r.phase==='bowAim').guide.updates>0,'actual curved forecast');console.log(JSON.stringify({results:results.map(({phase,frameP50,frameP95,guide,landmarks})=>({phase,frameP50,frameP95,guide,landmarks})),seconds:(performance.now()-begin)/1000,out}));
}finally{await browser.close();unlinkSync(fixture);}
