// Synthetic full-world renderer stress; deliberately not a 32-client network test.
import {launch,BASE,record,shot,save} from './browser-acceptance-lib.mjs';
import {createSimulation,terrainHeight,loadSimulation} from '../shared/simulation.js';
import {stepBattle} from '../shared/battle-mode.js';
import {createEnemy} from '../shared/combat.js';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {here} from './browser-acceptance-lib.mjs';
const sim=createSimulation({seed:41});for(let i=0;i<32;i++)sim.addPlayer({id:'render'+i});
sim.command('render0',{type:'battle',action:'start',seq:1});const state=sim.adventureWorld();
for(let i=0;i<4;i++){state.tick=i*900;stepBattle(state,{createEnemy,terrainHeight,nextId:(s,p)=>p+(++s.idCounter)},[]);}
state.tick+=240;
for(const [i,p] of state.players.entries()){const x=(i%8-3.5)*2,z=12-Math.floor(i/8)*2;p.position=[x,terrainHeight(state,x,z),z];p.side=i%2?'party':'rivals';p.yaw=Math.PI;p.tool=['axe','pick','hammer','crossbow','bow'][i%5];}
state.players[0].position=[0,terrainHeight(state,0,20),20];state.players[0].yaw=0;
for(const [i,e] of state.enemies.entries()){const x=(i%8-3.5)*2,z=3-Math.floor(i/8)*2;e.position=[x,terrainHeight(state,x,z),z];e.yaw=0;}
loadSimulation(sim.checkpoint());const fixture=sim.snapshot();
const {browser,page}=await launch({viewport:{width:960,height:540}});
try{
 // This isolated fixture has no HMR lifecycle. Remove Vite's dev websocket only;
 // all game modules/assets still come from the running Vite server unchanged.
 await page.route('**/@vite/client',route=>route.fulfill({contentType:'application/javascript',body:'export const createHotContext=()=>({accept(){},dispose(){},prune(){},invalidate(){},on(){},send(){},data:{}}); export const injectQuery=u=>u; export const updateStyle=()=>{}; export const removeStyle=()=>{};'}));
 const profiler=await page.context().newCDPSession(page);await profiler.send('Profiler.enable');await profiler.send('Profiler.start');
 await page.route('**/client/game.js*',async route=>{const response=await route.fetch(),body=await response.text();if(!body.includes('renderer.render(scene, camera);'))throw Error('Render instrumentation marker missing');await route.fulfill({response,body:body.replace('renderer.render(scene, camera);','window.profileRender(renderer, scene, camera);')});});
 await page.route('**/tests/battle-render-load.html',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}canvas{width:100%;height:100%;display:block}</style><canvas id="game"></canvas><script type="module">
 import {createGame} from '/client/game.js';
 window.measure={submit:[],gpu:[],pending:[],backend:null,gpuSupported:false,frames:0};
 window.profileRender=(renderer,scene,camera)=>{const m=window.measure,gl=renderer.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');
 if(!m.backend){const debug=gl.getExtension('WEBGL_debug_renderer_info');m.backend=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);m.gpuSupported=!!ext;}
 if(ext)for(let i=m.pending.length-1;i>=0;i--){const q=m.pending[i];if(gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE)){if(!gl.getParameter(ext.GPU_DISJOINT_EXT))m.gpu.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);gl.deleteQuery(q);m.pending.splice(i,1);}}
 const q=ext&&++m.frames%15===0&&m.pending.length<4?gl.createQuery():null;if(q)gl.beginQuery(ext.TIME_ELAPSED_EXT,q);
 const t=performance.now();renderer.render(scene,camera);m.submit.push(performance.now()-t);if(m.submit.length>2000)m.submit.shift();if(q){gl.endQuery(ext.TIME_ELAPSED_EXT);m.pending.push(q);}}
 window.game=createGame({canvas:document.querySelector('canvas'),isHost:()=>false});window.ready=true;
 </script>`}));
 await page.goto(BASE+'/tests/battle-render-load.html');await page.waitForFunction(()=>window.ready,null,{timeout:120000});
 // Match the actual lobby: assets become ready before joining a populated room.
 await page.waitForFunction(()=>window.game.diagnostics().startup?.ready??true,null,{timeout:120000});
 record('empty-lobby-readiness','measured',await page.evaluate(()=>window.game.diagnostics().startup||{legacy:true}));
 await page.evaluate(f=>{window.fixture=f;window.game.applySnapshot(f,'render0');window.game.setActive(true);let n=0;window.feed=setInterval(()=>{n++;const s=structuredClone(window.fixture);s.tick+=n*3;for(let i=1;i<s.players.length;i++){s.players[i].position[0]+=.15*Math.sin(n*.1+i);s.players[i].velocity=[.3*Math.cos(n*.1+i),0,0];}for(let i=0;i<s.enemies.length;i++)s.enemies[i].position[0]+=.1*Math.sin(n*.1+i);window.game.applySnapshot(s,'render0');},50);},fixture);
 await page.waitForFunction(()=>window.game.diagnostics().startup?.ready??true,null,{timeout:120000});
 record('readiness','measured',await page.evaluate(()=>window.game.diagnostics().startup||{legacy:true}));
 await page.waitForTimeout(12000);
 const {profile}=await profiler.send('Profiler.stop');writeFileSync(join(here,'startup.cpuprofile'),JSON.stringify(profile));
 const nodes=new Map(profile.nodes.map(n=>[n.id,n.callFrame])),totals=new Map();for(let i=0;i<(profile.samples||[]).length;i++){const f=nodes.get(profile.samples[i]),key=`${f?.functionName||'(anonymous)'} ${f?.url||''}:${(f?.lineNumber??-1)+1}`;totals.set(key,(totals.get(key)||0)+(profile.timeDeltas?.[i]||0));}
 record('startup-profile','measured',{topSelfMs:[...totals].sort((a,b)=>b[1]-a[1]).slice(0,15).map(([frame,us])=>({frame,ms:us/1000}))});
 for(const role of ['hero','god']){
  await page.evaluate(role=>{window.game.setRole(role);if(role==='god')window.game.zoomBy(8);window.measure.submit=[];window.measure.gpu=[];},role);
  await page.waitForTimeout(12000);
  const result=await page.evaluate(()=>{const stats=a=>{a=[...a].sort((a,b)=>a-b);return {samples:a.length,p50:a[Math.floor(a.length*.5)]??null,p95:a[Math.floor(a.length*.95)]??null,p99:a[Math.floor(a.length*.99)]??null,max:a.at(-1)??null};};const d=window.game.diagnostics(),m=window.measure;return {backend:m.backend,gpuSupported:m.gpuSupported,renderSubmitMs:stats(m.submit),gpuMs:stats(m.gpu),cpu:d.cpuTimings,calls:d.calls,triangles:d.triangles,geometries:d.geometries,textures:d.textures,heroes:d.heroes,creatures:d.creatures,world:d.world,fire:d.fire,effects:d.effects};});
  record('full-world-'+role,page.errors.length?'fail':'pass',{...result,fixture:'32 players /32 battle bots;20Hz moving snapshots; no networking or authority stepping',capture:await shot(page,'battle-full-'+role),errors:page.errors});
 }
 save('battle-full-render');if(page.errors.length)process.exitCode=1;
}finally{await browser.close();}
