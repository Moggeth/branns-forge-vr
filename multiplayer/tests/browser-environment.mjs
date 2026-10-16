import assert from 'node:assert/strict';
import {launch,BASE,stubUnavailableRooms,record,save,shot} from './browser-acceptance-lib.mjs';
// Visual equivalence runs on Vite's isolated fixture; game acceptance runs on
// the production build so compressed delivery and immutable URLs are exercised.
if(process.env.BAKE_BASE){
 const {browser,page}=await launch();try{
  await page.goto(process.env.BAKE_BASE+'/tests/environment-bake.html');await page.waitForFunction(()=>window.compareBakedRoomEnvironment);
  for(const size of [128,256]){const result=await page.evaluate(size=>window.compareBakedRoomEnvironment(size),size);assert.equal(result.different,0,'metallic/matte reflections match the generated environment bit for bit');record('environment-pixels-'+size,'pass',result);}
  assert.deepEqual(page.errors,[]);
 }finally{await browser.close();}
}
for(const mode of ['desktop','touch','fallback']){
 const {browser,page}=await launch({touch:mode==='touch',viewport:mode==='touch'?{width:844,height:390}:{width:1280,height:720}});
 try{
  await stubUnavailableRooms(page);
  if(mode==='fallback')await page.route(/room-256\..*\.bfenv\.gz$/,route=>route.fulfill({status:503,body:'Deliberate lighting cache failure'}));
  await page.goto(BASE+'/?acceptanceProbe',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#world')?.brannDiagnostics?.()?.startup.ready,null,{timeout:120000});
  const startup=await page.evaluate(()=>document.querySelector('#world').brannDiagnostics().startup);assert.equal(startup.error,null);assert.equal(startup.environment.source,mode==='fallback'?'generated':'baked');
  assert.deepEqual(page.errors.filter(e=>mode!=='fallback'||!/503 .*room-256\./.test(e)),[]);record('environment-'+mode,'pass',{startup,capture:await shot(page,'environment-'+mode)});
 }finally{await browser.close();}
}
save('environment');
