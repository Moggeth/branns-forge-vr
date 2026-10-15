// Run against a production build/preview: development deliberately uses authored GLBs.
import assert from 'node:assert/strict';
import {launch,BASE,record,save,shot,stubUnavailableRooms,enterSoloFromPlay} from './browser-acceptance-lib.mjs';
for(const mode of ['packed','unsupported','failed-packed']){
  const {browser,page}=await launch({touch:mode==='unsupported',viewport:mode==='unsupported'?{width:390,height:844}:{width:1280,height:720}});
  const requests=[];page.on('request',request=>requests.push(new URL(request.url()).pathname));
  try{
    if(mode==='unsupported')await page.addInitScript(()=>Object.defineProperty(window,'DecompressionStream',{value:undefined,configurable:true}));
    if(mode==='failed-packed')await page.route(/\/assets\/packed\/pick\.[a-f0-9]+\.glb\.gz$/,route=>route.fulfill({status:503,body:'Deliberate unavailable packed model'}));
    await stubUnavailableRooms(page);
    await page.goto(BASE+'/?acceptanceProbe',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelector('#world')?.brannDiagnostics?.()?.startup.ready,null,{timeout:120000});
    if(mode==='failed-packed')await page.waitForFunction(()=>document.querySelector('#world').brannDiagnostics().startup.secondaryReady,null,{timeout:120000});
    const startup=await page.evaluate(()=>document.querySelector('#world').brannDiagnostics().startup);
    assert.equal(startup.error,null,'warmup must complete, not merely recover from an exception');
    assert.ok(startup.shaderVariants.representatives<startup.shaderVariants.objects);
    if(mode==='unsupported'){
      assert.equal(requests.some(path=>path.startsWith('/assets/packed/')&&!path.endsWith('.webp')),false);
      assert.ok(requests.includes('/assets/axe.glb'));
    }else{
      assert.ok(requests.some(path=>/^\/assets\/packed\/axe\./.test(path)));
      assert.equal(startup.deliveryFallbacks||0,mode==='failed-packed'?1:0);
      assert.equal(requests.includes('/assets/pick.glb'),mode==='failed-packed');
    }
    const close=page.getByRole('button',{name:'Close patch notes',exact:true});if(await close.isVisible())await close.click();
    await enterSoloFromPlay(page);
    await page.waitForFunction(()=>window.brannHarness.state().controlsActive,null,{timeout:30000});
    assert.deepEqual(page.errors.filter(error=>mode!=='failed-packed'||!/HTTP 503 .*\/assets\/packed\/pick\./.test(error)),[]);
    record(`cold-assets-${mode}`,'pass',{startup,capture:await shot(page,`cold-assets-${mode}`)});
  }finally{await browser.close();}
}
save('cold-assets');
