import assert from 'node:assert/strict';
import {launch,BASE,stubUnavailableRooms,enterSoloFromPlay,record,save,shot} from './browser-acceptance-lib.mjs';
for(const config of [
 {name:'desktop',touch:false,viewport:{width:1280,height:720},query:''},
 {name:'touch',touch:true,viewport:{width:844,height:390},query:''},
 {name:'touch-hdr',touch:true,viewport:{width:844,height:390},query:'&fx=high'},
]){
 const {browser,page}=await launch(config);
 try{
  await stubUnavailableRooms(page);await page.goto(BASE+'/?acceptanceProbe'+config.query,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#world')?.brannDiagnostics?.()?.startup.secondaryReady,null,{timeout:120000});
  const close=page.getByRole('button',{name:'Close patch notes',exact:true});if(await close.isVisible())await close.click();await enterSoloFromPlay(page);
  await page.waitForFunction(()=>window.brannHarness.state().controlsActive);
  await page.waitForFunction(()=>document.querySelector('#world').brannDiagnostics().world.decorations.fading===0);
  await page.waitForTimeout(700);const before=await page.evaluate(()=>document.querySelector('#world').brannDiagnostics());assert.ok(before.startup.weaponPreparation.pick);
  const swaps=[];
  for(const [key,want]of [['Digit2','pick'],['Digit1','axe'],['Digit2','pick']]){
   await page.evaluate(()=>{window.pickFrames=[];let last=performance.now();function frame(now){window.pickFrames.push(now-last);last=now;if(window.pickFrames.length<90)requestAnimationFrame(frame);}requestAnimationFrame(frame);});
   await page.keyboard.press(key);await page.waitForFunction(want=>window.brannHarness.controls().weapon.tool===want,want);await page.waitForFunction(()=>window.pickFrames.length>=90);
   const frames=await page.evaluate(()=>window.pickFrames);frames.sort((a,b)=>a-b);const max=Math.max(...frames),p95=frames[Math.floor(frames.length*.95)];swaps.push({want,max,p95});assert.ok(max<80,`${config.name} ${want} frame gap ${max} ms`);
  }
  const after=await page.evaluate(()=>document.querySelector('#world').brannDiagnostics());assert.equal(after.readiness.constructed,before.readiness.constructed,'equipping reuses already prepared local effects');assert.equal(after.startup.error,null);assert.deepEqual(page.errors,[]);
  record('prepared-pick-'+config.name,'pass',{swaps,readiness:after.readiness,programsBefore:before.programs,programsAfter:after.programs,capture:await shot(page,'prepared-pick-'+config.name)});
 }finally{await browser.close();}
}
save('pick-readiness');
