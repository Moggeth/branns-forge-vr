// Real scene pixel coverage after cold startup and resize, with optional stale-RAF injection.
import assert from 'node:assert/strict';
import {launch,BASE,record,save,shot,stubUnavailableRooms,enterSoloFromPlay} from './browser-acceptance-lib.mjs';
async function coverage(page){
 const png=(await page.screenshot()).toString('base64');
 return page.evaluate(async png=>{
   const image=new Image();image.src='data:image/png;base64,'+png;await image.decode();
   const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
   const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const {data}=ctx.getImageData(0,0,canvas.width,canvas.height);
   let black=0,total=0;for(let y=Math.floor(canvas.height*.25);y<canvas.height*.75;y+=4)for(let x=Math.floor(canvas.width*.2);x<canvas.width*.8;x+=4){const i=(y*canvas.width+x)*4;total++;if(Math.max(data[i],data[i+1],data[i+2])<8)black++;}
   return {blackFraction:black/total,total};
 },png);
}
for(const config of [
 {name:'desktop-tall',touch:false,viewport:{width:1504,height:1590},query:''},
 {name:'phone-default',touch:true,viewport:{width:390,height:844},query:''},
 {name:'phone-post',touch:true,viewport:{width:844,height:390},query:'&fx=high'},
]){
 const {browser,page}=await launch(config);
 try {
   // Deterministically reproduce a RAF queued before asynchronous warm-up finishes.
   // Match pathname: Vite appends ?t= timestamps after edits.
   if(process.env.STARTUP_STALE_FRAME === '1') await page.route(url=>url.pathname==='/client/game.js',async route=>{
     const response=await route.fetch();let body=await response.text();
     const needle='previous=performance.now();api.setActive(requestedActive);';
     assert.ok(body.includes(needle),'Startup clock injection must match the real game');
     body=body.replace(needle,'previous=performance.now()+2500;globalThis.__startupClockProbe={scene,deltas:[]};api.setActive(requestedActive);');
     assert.ok(body.includes('previous = now; renderTick='),'Frame probe must match the real game');
     body=body.replace('previous = now; renderTick=', 'if(globalThis.__startupClockProbe && globalThis.__startupClockProbe.deltas.length<8)globalThis.__startupClockProbe.deltas.push(dt);previous = now; renderTick=');
     await route.fulfill({response,body});
   });
   await stubUnavailableRooms(page);
 await page.goto(BASE+'/?acceptanceProbe'+config.query,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.brannHarness,null,{timeout:60000});
   const close=page.locator('.pn-close');if(await close.isVisible())await close.click();
   await enterSoloFromPlay(page);
   await page.waitForFunction(()=>document.querySelector('#world').brannDiagnostics?.().startup.ready,null,{timeout:120000});
   await page.waitForTimeout(500);
   if(process.env.STARTUP_STALE_FRAME === '1') {
     const deltas=await page.evaluate(()=>globalThis.__startupClockProbe?.deltas);
     assert.ok(deltas?.length>0&&deltas[0]===0&&deltas.every(x=>x>=0&&x<=.05),`Stale RAF must not reverse animation time: ${deltas}`);
     const scales=await page.evaluate(()=>{const out=[];globalThis.__startupClockProbe?.scene.traverse(o=>{
       if(/_BallistaBolt$/.test(o.name))out.push(...o.scale.toArray());
       // Authored keep rigs replaced the old named placeholder. The reload scale
       // now lives on their parent bolt pivot, not on the GLB's bolt root.
       if(o.name==='S_Bolt'||o.name==='G_Harpoon')out.push(...o.scale.toArray(),...o.parent.scale.toArray());
     });return out;});
     assert.ok(scales.length>0,'Must inspect actual base ballista bolts');
     assert.ok(scales.every(x=>Number.isFinite(x)&&x>=.001&&x<=1),`${config.name}: unstable bolt scale ${scales}`);
   }
   const first=await coverage(page);assert.ok(first.blackFraction<.2,`${config.name} black startup: ${JSON.stringify(first)}`);
   await shot(page,config.name);
   await page.setViewportSize(config.touch?{width:config.viewport.height,height:config.viewport.width}:{width:1280,height:720});
   await page.waitForTimeout(300);const resized=await coverage(page);assert.ok(resized.blackFraction<.2,`${config.name} black resize: ${JSON.stringify(resized)}`);
   assert.deepEqual(page.errors,[]);
   record(config.name,'pass',{first,resized,startup:await page.evaluate(()=>document.querySelector('#world').brannDiagnostics().startup)});
 }finally{await browser.close();}
}
save('startup-render');
