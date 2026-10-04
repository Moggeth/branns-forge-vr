// Real welcome screen: measure main-thread availability while loading, then join
// solo. Uses a fresh browser/context; no XR, pointer lock or public room creation.
import assert from 'node:assert/strict';
import {launch,BASE,record,save,shot} from './browser-acceptance-lib.mjs';
for(const touch of [false,true]) {
  const {browser,page}=await launch({touch,viewport:touch?{width:390,height:844}:{width:1280,height:720}});
  try {
    await page.addInitScript(()=>{
      window.loadProbe={tasks:[],gaps:[],inputs:0};let last=performance.now();
      new PerformanceObserver(list=>{for(const e of list.getEntries())if(!window.loadProbe.finished)window.loadProbe.tasks.push(e.duration);}).observe({type:'longtask',buffered:true});
      const timer=setInterval(()=>{const now=performance.now();window.loadProbe.gaps.push(now-last);last=now;if(window.loadProbe.finished)clearInterval(timer);},50);
      document.addEventListener('input',()=>window.loadProbe.inputs++);
    });
    await page.goto(BASE+'/?acceptanceProbe',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.brannHarness,null,{timeout:120000});
    const close=page.getByRole('button',{name:'Close patch notes',exact:true});if(await close.isVisible())await close.click();
    await page.locator('#name').fill('Loading responsiveness');
    await page.waitForFunction(()=>document.querySelector('#world').brannDiagnostics?.()?.startup.ready,null,{timeout:120000});
    const result=await page.evaluate(()=>{window.loadProbe.finished=true;const p=window.loadProbe;return{...document.querySelector('#world').brannDiagnostics().startup,inputEvents:p.inputs,maxLongTaskMs:Math.max(0,...p.tasks),maxHeartbeatGapMs:Math.max(0,...p.gaps),longTasks:p.tasks.length};});
    assert.ok(result.inputEvents>0);assert.equal(result.error,null);
    await page.locator('#solo').click();
    await page.waitForFunction(()=>window.brannHarness.state().controlsActive,null,{timeout:30000});
    assert.deepEqual(page.errors,[]);
    record(touch?'mobile-loading':'desktop-loading','pass',{...result,capture:await shot(page,touch?'loading-mobile':'loading-desktop')});
  } finally {await browser.close();}
}
save('loading-response');
