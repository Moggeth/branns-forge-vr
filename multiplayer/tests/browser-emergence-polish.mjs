import assert from 'node:assert/strict';
import {launch,enterWorld,record,save,shot,sleep} from './browser-acceptance-lib.mjs';
const {browser,page}=await launch({viewport:{width:1280,height:720}});
const diag=()=>page.evaluate(()=>document.querySelector('canvas').brannDiagnostics());
try{
 await enterWorld(page,{role:'god',name:'Assembly review'});
 await page.keyboard.press('Digit8');
 await page.mouse.move(690,285);await page.mouse.wheel(0,-400);await sleep(400);
 await page.mouse.move(950,400);
 await page.waitForFunction(()=>document.querySelector('canvas').brannDiagnostics().effects.targeting.visible);
 await shot(page,'golem-target-before');
 await page.mouse.click(950,400);
 await page.waitForFunction(()=>window.brannHarness.snapshot().enemies.some(e=>e.kind==='golem'));
 await page.waitForFunction(()=>document.querySelector('canvas').brannDiagnostics().effects.targeting.suppressed);
 await sleep(180);assert.equal((await diag()).effects.targeting.visible,false);
 await shot(page,'golem-rise');
 await sleep(600);await shot(page,'golem-assembly');
 const frames=await page.evaluate(()=>new Promise(resolve=>{
  const rows=[];let n=0;function frame(){const d=document.querySelector('canvas').brannDiagnostics();rows.push({t:d.presentationTick,pose:d.creatures.presentationTick,snapshot:window.brannHarness.snapshot().tick});if(++n<40)requestAnimationFrame(frame);else resolve(rows);}requestAnimationFrame(frame);
 }));
 assert.ok(frames.some(r=>Math.abs(r.pose-Math.round(r.pose))>.001),'live assembly receives fractional display time');
 assert.ok(frames.every(r=>Math.abs(r.pose-r.t)<1e-8),'creature and enemy motion use same presentation clock');
 for(let i=1;i<frames.length;i++)assert.ok(frames[i].t>=frames[i-1].t,'no presentation rewind');
 record('continuous-live-assembly','pass',{frames:frames.length,fractionalFrames:frames.filter(r=>r.pose%1>.001).length});
 await shot(page,'golem-complete');
 assert.equal((await diag()).effects.targeting.visible,false,'stationary pointer stays quiet after cooldown');
 await page.mouse.move(860,380);await page.waitForFunction(()=>document.querySelector('canvas').brannDiagnostics().effects.targeting.visible);
 record('accepted-cast-recedes-and-new-aim-returns','pass');
 assert.deepEqual(page.errors,[]);record('console','pass');
}catch(e){record('failure','fail',{message:e.stack,diagnostics:await diag()});await shot(page,'emergence-failure');process.exitCode=1;}
finally{save('emergence-polish');await browser.close();}
