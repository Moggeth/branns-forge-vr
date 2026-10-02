// Optional real-browser acceptance. Start a local peer/Vite pair first.
// PW_CORE can name a cached playwright-core package; PW_CHROME can name Chromium.
// No simulation mutation or synthetic game commands: the probe only reads state.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync, writeFileSync} from 'node:fs';
const {chromium} = createRequire(import.meta.url)(process.env.PW_CORE || 'playwright-core');
const browser = await chromium.launch({headless:true, ...(process.env.PW_CHROME ? {executablePath:process.env.PW_CHROME} : {}), args:['--enable-unsafe-swiftshader']});
const page = await browser.newPage({viewport:{width:1280,height:720}});
const errors = [], results = [], started = performance.now();
page.on('pageerror',e=>errors.push(e.message));
const pause = ms=>new Promise(r=>setTimeout(r,ms));
const count = ()=>page.evaluate(()=>window.brannHarness.snapshot().edits.length);
async function check(name, actual, expected) { assert.equal(actual,expected,name);results.push({name,seconds:(performance.now()-started)/1000}); }
try {
 await page.goto(`${process.env.ACCEPT_BASE || 'http://127.0.0.1:5188'}/?acceptanceProbe`);
 await page.fill('#name','GestureReview');
 await page.check('input[name="role"][value="god"]',{force:true});
 await page.click('#create');
 await page.waitForFunction(()=>window.brannHarness?.snapshot()?.players.some(p=>p.id===window.brannHarness.state().playerId&&p.role==='god'));
 await pause(800);
 await page.locator('#quickCast').check();await page.locator('#quickCast').blur();
 await page.mouse.move(700,400);await pause(100);
 let before=await count();
 await page.keyboard.down('Digit5');await page.mouse.move(800,440,{steps:5});
 await page.keyboard.press('Escape');await page.keyboard.up('Digit5');await pause(300);
 await check('Escape cancels keyboard line',await count(),before);
 await pause(800);before=await count();
 await page.keyboard.down('Digit6');await page.mouse.move(650,440,{steps:4});
 await page.mouse.down();await page.mouse.up();await pause(200);
 await check('Mouse release cannot finish keyboard line',await count(),before);
 await page.keyboard.up('Digit6');await pause(300);
 await check('Matching key release commits line',await count()>before,true);
 await pause(800);before=await count();
 await page.mouse.move(700,400);await page.keyboard.down('Digit5');await page.mouse.move(730,450);
 await page.mouse.click(730,450,{button:'right'});await page.keyboard.up('Digit5');await pause(300);
 await check('Right click cancels line',await count(),before);
 await page.mouse.move(700,400);await page.keyboard.down('Digit5');
 await page.locator('#copyCode').hover();await page.keyboard.up('Digit5');await pause(300);
 await check('Release over interface cancels line',await count(),before);
 await page.locator('#quickCast').uncheck();await page.locator('#quickCast').blur();
 await page.locator('[data-spell="sunder"]').click();
 await page.mouse.move(700,400);await page.mouse.down();await page.mouse.move(780,430,{steps:4});await page.mouse.up();await pause(300);
 await check('Normal mouse drag still commits',await count()>before,true);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'pass',results}));
} finally {
 mkdirSync('logs',{recursive:true});
 writeFileSync('logs/browser-rts-gestures.json',JSON.stringify({results,errors,seconds:(performance.now()-started)/1000},null,2));
 await browser.close();
}
