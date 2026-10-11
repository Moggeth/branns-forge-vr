// Full game scene, matched source revisions and camera/light states. Baseline is
// python scripts/prepare_graphics_baseline.py <revision> prepares the source.
// Assets are shared: use only when the two revisions have identical public assets.
import {launch,BASE,here} from './browser-acceptance-lib.mjs';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const report=[];
const baseline=JSON.parse(readFileSync(new URL('./.graphics-baseline/baseline.json',import.meta.url),'utf8'));
const folder=join(here,'comparison');mkdirSync(folder,{recursive:true});
for(const touch of [true,false])for(const version of ['before','after']) {
 const {browser,page}=await launch({touch,viewport:{width:touch?844:1280,height:touch?390:720}});
 const moduleRoot=version==='before'?'/tests/.graphics-baseline':'';
 try {
  await page.route('**/@vite/client',route=>route.fulfill({contentType:'application/javascript',body:'export const createHotContext=()=>({accept(){},dispose(){},prune(){},invalidate(){},on(){},send(){},data:{}}); export const injectQuery=u=>u; export const updateStyle=()=>{}; export const removeStyle=()=>{};'}));
  await page.route(url=>url.pathname===moduleRoot+'/client/game.js',async route=>{
   const response=await route.fetch();let body=await response.text();
   assert.ok(body.includes('function frame(now) {'));
   body=body.replace('function frame(now) {','function frame(now) { if(globalThis.__graphicsClock!==undefined)now=globalThis.__graphicsClock;');
   assert.ok(body.includes('skyCycle.render(scene, camera);'),'render instrumentation marker');
   body=body.replace('skyCycle.render(scene, camera);','window.__graphicsScene={scene,camera,renderer};skyCycle.render(scene, camera);');
   await route.fulfill({response,body});
  });
  await page.route('**/tests/graphics-comparison.html',route=>route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}canvas{width:100%;height:100%;display:block}</style><canvas></canvas>'}));
  await page.goto(BASE+'/tests/graphics-comparison.html');
  await page.evaluate(async root=>{
   const {createGame}=await import(root+'/client/game.js');
   const {createSimulation,terrainHeight}=await import(root+'/shared/simulation.js');
   const sim=createSimulation({seed:41});sim.addPlayer({id:'review',role:'hero'});
   const s=sim.snapshot();s.players[0].position=[-10,terrainHeight(s,-10,-2),-2];s.players[0].yaw=0;
   window.review={s,game:createGame({canvas:document.querySelector('canvas'),isHost:()=>false})};
   review.game.applySnapshot(s,'review');review.game.setActive(true);
  },moduleRoot);
  await page.waitForFunction(()=>review.game.diagnostics().startup.ready,null,{timeout:120000});
  for(const [name,phase,role] of [['noon',.325,'hero'],['golden',.55,'hero'],['night',.85,'hero'],['overview',.325,'god']]) {
   await page.evaluate(({phase,role})=>{
    delete window.__graphicsClock;
    const s=structuredClone(review.s);s.tick=Math.round((phase-.06)*72000);
    s.weather={kind:'clear',startTick:s.tick-3000,untilTick:s.tick+3000,strength:1};
    s.players[0].role=role;review.game.applySnapshot(s,'review');review.game.setRole(role);
   },{phase,role});
   await page.waitForTimeout(1800);
   await page.evaluate(()=>{window.__graphicsClock=60000;});await page.waitForTimeout(100);
   const file=`${touch?'phone':'desktop'}-${name}-${version}.png`;
   await page.screenshot({path:join(folder,file)});
   const d=await page.evaluate(()=>{
    const {renderer,camera}=window.__graphicsScene,gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
    return {startup:review.game.diagnostics().startup,sky:review.game.diagnostics().sky,position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),backend:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};
   });
   report.push({version,baselineRevision:baseline.revision,touch,name,file,...d});
  }
  assert.deepEqual(page.errors,[],'no shader, asset or runtime errors');
  await page.evaluate(()=>review.game.dispose());
 }catch(error){console.error(page.errors);throw error;}finally{await browser.close();writeFileSync(join(folder,'report.json'),JSON.stringify(report,null,2));}
}
for(const touch of [true,false])for(const name of ['noon','golden','night','overview']) {
 const [before,after]=report.filter(r=>r.touch===touch&&r.name===name);
 assert.deepEqual(before.position,after.position,`${name}: matched camera position`);
 assert.deepEqual(before.quaternion,after.quaternion,`${name}: matched camera orientation`);
}
console.log(JSON.stringify({captures:report.length,folder,backend:report[0]?.backend}));
