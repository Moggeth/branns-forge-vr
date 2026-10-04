import {launch,BASE,record,shot,save} from './browser-acceptance-lib.mjs';
const {browser,page}=await launch({viewport:{width:480,height:320}});
try{await page.goto(`${BASE}/tests/terrain-geometry.html`);await page.waitForFunction(()=>window.ready,null,{timeout:60000});
  const result=await page.evaluate(()=>({result:window.result,failure:window.failure}));
  record('terrain-gpu-equivalence',result.failure||page.errors.length?'fail':'pass',{...result,capture:await shot(page,'terrain-gpu-equivalence'),errors:page.errors});save('terrain-gpu-equivalence');
  if(result.failure||page.errors.length)process.exitCode=1;
}finally{await browser.close();}
