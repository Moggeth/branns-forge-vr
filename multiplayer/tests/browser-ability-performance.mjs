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
const {browser,page}=await launch({viewport:{width:800,height:450}}),begin=performance.now(),label=process.env.PERF_LABEL||'current';
writeFileSync(fixture,'<style>html,body{margin:0}canvas{width:800px;height:450px}</style><canvas></canvas>');
try{
 await page.goto(`${process.env.FORGE_PERF_URL||'http://127.0.0.1:5195'}/tests/.ability-perf.html`,{waitUntil:'networkidle'});
 await page.evaluate(async()=>{
  const {createGame}=await import('/client/game.js'),{createSimulation}=await import('/shared/simulation.js');const sim=createSimulation({seed:41});sim.addPlayer({id:'p',role:'hero'});let seq=0;
  const game=createGame({canvas:document.querySelector('canvas'),isHost:()=>true,onAction:(action,body)=>{sim.command('p',{type:'action',seq:++seq,action,...body});game.applySnapshot(sim.snapshot(),'p');}});
  window.qa={game,sim};game.applySnapshot(sim.snapshot(),'p');game.setActive(true);game.setTouchEnabled(true);
  window.timer=setInterval(()=>{sim.step();sim.step();sim.step();game.applySnapshot(sim.snapshot(),'p');},50);
 });
 await page.waitForFunction(()=>qa.game.diagnostics().startup.ready,null,{timeout:120000});
 const cdp=await page.context().newCDPSession(page);await cdp.send('Profiler.enable');const results=[];
 for(const phase of ['idle','pickAim','pickCast','bowAim']){
  await page.evaluate(phase=>{const g=qa.game;if(phase==='pickAim'){g.equip('pick');g.specialPress(true);}if(phase==='pickCast')g.specialPress(false);if(phase==='bowAim'){g.equip('bow');g.primaryDown();g.special();}window.intervals=[];window.lastAt=performance.now();window.run=true;const generation=window.generation=(window.generation||0)+1;let step=0;const tick=t=>{if(!window.run||generation!==window.generation)return;step++;window.intervals.push(t-window.lastAt);window.lastAt=t;if(phase==='bowAim'||phase==='pickAim')g.lookByPixels(.8*Math.sin(step*.016),0);requestAnimationFrame(tick);};requestAnimationFrame(tick);},phase);
  await cdp.send('Profiler.start');await page.waitForTimeout(2500);const {profile}=await cdp.send('Profiler.stop');
  await page.screenshot({path:resolve(out,`${label}-${phase}.png`)});
  const result=await page.evaluate(()=>{window.run=false;const d=qa.game.diagnostics(),a=window.intervals.filter(x=>x>=0).sort((x,y)=>x-y);return{frameP50:a[a.length>>1],frameP95:a[Math.floor(a.length*.95)],frames:a.length,guide:d.guideTiming,terrain:d.terrainSampler,effects:d.effects,world:d.world,landmarks:d.landmarks,startup:d.startup};});
  const counts=new Map();for(const id of profile.samples||[])counts.set(id,(counts.get(id)||0)+1);result.top=profile.nodes.map(n=>({name:n.callFrame.functionName,url:n.callFrame.url.split('/').slice(-2).join('/'),hits:counts.get(n.id)||0})).sort((a,b)=>b.hits-a.hits).slice(0,14);result.phase=phase;results.push(result);writeFileSync(resolve(out,`${label}-${phase}.cpuprofile`),JSON.stringify(profile));
 }
 await page.evaluate(()=>{clearInterval(window.timer);qa.game.dispose()});writeFileSync(resolve(out,`${label}.json`),JSON.stringify({results,errors:page.errors,seconds:(performance.now()-begin)/1000},null,2));assert.deepEqual(page.errors,[]);assert.ok(!results[0].startup.error);assert.ok(results.find(r=>r.phase==='pickCast').world.crystalWalls.walls>0,'actual wall cast');assert.ok(results.find(r=>r.phase==='bowAim').guide.updates>0,'actual curved forecast');console.log(JSON.stringify({results:results.map(({phase,frameP50,frameP95,guide,landmarks})=>({phase,frameP50,frameP95,guide,landmarks})),seconds:(performance.now()-begin)/1000,out}));
}finally{await browser.close();unlinkSync(fixture);}
