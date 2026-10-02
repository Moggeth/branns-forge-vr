import assert from 'node:assert/strict';
// Optional real-browser acceptance; mirrors the existing browser-rts-gestures harness.
// Start peer/Vite or set ACCEPT_BASE. PW_CORE/PW_CHROME select an installed browser.
// Probe reads only; every game action uses actual keyboard/mouse input.
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
const {chromium}=createRequire(import.meta.url)(process.env.PW_CORE||'playwright-core');
const started=performance.now(),results=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const record=(id,status,detail={})=>results.push({id,status,...detail,seconds:(performance.now()-started)/1000});
const save=name=>{mkdirSync('logs',{recursive:true});writeFileSync(`logs/${name}.json`,JSON.stringify({results,seconds:(performance.now()-started)/1000},null,2));console.log(JSON.stringify(results));};
const snap=page=>page.evaluate(()=>window.brannHarness.snapshot());
async function launch(){
 const browser=await chromium.launch({headless:true,...(process.env.PW_CHROME?{executablePath:process.env.PW_CHROME}:{}),args:['--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1280,height:720}});page.errors=[];page.on('pageerror',error=>page.errors.push(error.message));return {browser,page};
}
async function enterWorld(page,{role,name}){
 await page.goto(`${process.env.ACCEPT_BASE||'http://127.0.0.1:5188'}/?acceptanceProbe`);
 await page.fill('#name',name);await page.check(`input[name="role"][value="${role}"]`,{force:true});await page.click('#create');
 await page.waitForFunction(role=>window.brannHarness?.snapshot()?.players.some(p=>p.id===window.brannHarness.state().playerId&&p.role===role),role);
 await sleep(800);
}
const {browser,page}=await launch();
try {
 await enterWorld(page,{role:'god',name:'KeyboardQA'});
 await page.locator('#quickCast').check();
 await page.mouse.move(740,420);await sleep(100);
 let before=(await snap(page)).edits.length;
 await page.keyboard.down('Digit2');await sleep(150);
 assert.equal((await snap(page)).edits.length,before+1);record('quick-point-keydown','pass');
 // Wait beyond the server cast cooldown: it must not hide a repeated-key bug.
 const castObservedTick=(await snap(page)).tick;
 await page.waitForFunction(t=>window.brannHarness.snapshot().tick>=t+46,castObservedTick);
 await page.keyboard.down('Digit2');await sleep(150);await page.keyboard.up('Digit2');await sleep(150);
 assert.equal((await snap(page)).edits.length,before+1);record('repeat-and-release-no-duplicate','pass');
 before=(await snap(page)).edits.length;
 await page.locator('#copyCode').hover();await page.keyboard.press('Minus');await sleep(150);
 assert.equal((await snap(page)).edits.length,before);record('quick-point-over-ui-blocked','pass');
 await page.locator('#quickCast').uncheck();await page.mouse.move(740,420);
 await page.keyboard.press('Minus');await sleep(150);
 assert.equal((await snap(page)).edits.length,before);record('nonquick-key-select-only','pass');
 await page.locator('#menuButton').click();
 assert.equal(await page.evaluate(()=>document.activeElement.id),'resumePlay');
 for(let i=0;i<24;i++){
  await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(()=>document.getElementById('menu').contains(document.activeElement)),`Tab escaped at ${i}`);
 }
 for(let i=0;i<24;i++){
  await page.keyboard.press('Shift+Tab');
  assert.ok(await page.evaluate(()=>document.getElementById('menu').contains(document.activeElement)),`Shift+Tab escaped at ${i}`);
 }
 record('menu-tab-contained','pass');
 await page.locator('#menuControls').click();
 assert.equal(await page.evaluate(()=>document.activeElement.id),'controlsTitle');
 await page.locator('#controlsDone').click();
 assert.equal(await page.evaluate(()=>document.activeElement.id),'menuControls');record('guide-focus-restored','pass');
 await page.keyboard.press('Digit2');await sleep(150);
 assert.equal((await snap(page)).edits.length,before);record('menu-blocks-gameplay','pass');
 await page.keyboard.press('Escape');
 assert.equal(await page.evaluate(()=>document.activeElement.id),'menuButton');
 assert.equal(await page.locator('#menu').isVisible(),false);record('escape-restores-menu-button','pass');
 assert.deepEqual(page.errors,[]);record('errors','pass');
}catch(e){record('exception','fail',{message:e.message});mkdirSync('logs',{recursive:true});await page.screenshot({path:'logs/browser-keyboard-failure.png'});process.exitCode=1;}
finally{save('browser-keyboard');await browser.close();}

