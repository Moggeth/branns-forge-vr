// Against the checkout static server, independent of live game/peer rooms. Set ACCEPT_BASE to that loopback server.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {launch,record,save,BASE} from './browser-acceptance-lib.mjs';
mkdirSync('output/playwright',{recursive:true});
const {browser,page}=await launch();try{
 await page.goto(BASE+'/multiplayer/tests/tree-materials.html');await page.waitForFunction(()=>document.title==='done',null,{timeout:60000});
 const results=await page.evaluate(()=>window.forestReview.results);assert.equal(results.length,9);
 assert.ok(results.some(r=>r.label==='notch'&&r.wounded===1));assert.ok(results.some(r=>r.label==='fall'&&r.falling===1));
 const forest=results.at(-1);assert.equal(forest.trees,500);assert.equal(forest.draws,12);assert.equal(forest.materials.materials,27);
 record('integrated-forest-shaders','pass',{results});
 await page.screenshot({path:'output/playwright/forest-integrated-500.png'});
 await page.evaluate(()=>window.forestReview.showTree());await page.screenshot({path:'output/playwright/forest-integrated-fall.png'});
 assert.deepEqual(page.errors,[]);record('console','pass',{errors:page.errors});
}catch(e){record('failure','fail',{error:e.stack});process.exitCode=1;}finally{save('tree-materials');await browser.close();}
