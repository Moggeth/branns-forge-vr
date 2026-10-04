import assert from 'node:assert/strict';
import {launch,BASE,record,save,shot,sleep} from './browser-acceptance-lib.mjs';
const desktop=await launch(),mobile=await launch({touch:true,viewport:{width:390,height:650}});
const pages=[desktop.page,mobile.page];
// The shared development server also serves transport fixtures with no default
// endpoint. Inject only the test configuration, never gameplay state or commands.
if(process.env.TEST_PEER_URL)for(const page of pages)await page.route('**/lobby.js',async route=>{
 const response=await route.fetch();let source=await response.text();source=source.replace('import.meta.env = {',`import.meta.env = {"VITE_PEER_WS_URL":${JSON.stringify(process.env.TEST_PEER_URL)},`);await route.fulfill({response,body:source});
});
async function ready(page,name){await page.goto(BASE+'/?acceptanceProbe');await page.waitForFunction(()=>window.brannHarness);await page.fill('#name',name);const close=page.locator('.pn-close');if(await close.isVisible())await close.click();}
async function battleMenu(page,touch=false){if(touch)await page.locator('[data-touch-action="menu"]').tap();else await page.locator('#menuButton').click();if(await page.locator('[data-mc-tab="battle"]').isVisible())await page.locator('[data-mc-tab="battle"]').click();}
async function fits(page,selector,id){const r=await page.locator(selector).evaluate(e=>({height:e.clientHeight,scroll:e.scrollHeight,width:e.clientWidth,scrollWidth:e.scrollWidth,bottom:e.getBoundingClientRect().bottom,viewport:innerHeight}));assert.ok(r.scroll<=r.height+2&&r.scrollWidth<=r.width+2&&r.bottom<=r.viewport+2,`${id}: ${JSON.stringify(r)}`);record(id,'pass',r);}
try{
 await ready(desktop.page,'Dawn host');await desktop.page.locator('#create').click();await desktop.page.waitForFunction(()=>brannHarness.snapshot()?.players.length===1);
 const room=await desktop.page.evaluate(()=>brannHarness.snapshot().room);
 await ready(mobile.page,'Dusk guest');await fits(mobile.page,'#lobby > .card','phone-lobby');await mobile.page.locator('#browseWorlds').tap();
 const row=mobile.page.locator(`.bf-pr-row[data-code="${room}"]`);await row.waitFor();assert.match(await row.innerText(),/Dawn host/);await row.locator('.bf-pr-toggle').tap();assert.match(await row.locator('.bf-pr-people').innerText(),/Dawn host/);await shot(mobile.page,'public-worlds-phone');
 await row.locator('.bf-pr-join').tap();await Promise.all(pages.map(p=>p.waitForFunction(()=>brannHarness.snapshot()?.players.length===2,null,{timeout:30000})));assert.equal(await mobile.page.locator('.bf-pr').evaluate(e=>e.open),false);record('discover-and-join-real-public-world','pass',{room});
 await battleMenu(desktop.page);await desktop.page.locator('.bf-bt-primary').click();await desktop.page.locator('.bf-bt-yes').click();
 await Promise.all(pages.map(p=>p.waitForFunction(()=>brannHarness.snapshot()?.battle.status==='running')));
 await desktop.page.locator('#resumePlay').click();await battleMenu(mobile.page,true);assert.equal(await mobile.page.locator('.bf-bt-host').isVisible(),false);await mobile.page.locator('.bf-bt-sidebtn[data-side="rivals"]').tap();
 await mobile.page.waitForFunction(()=>brannHarness.snapshot().players.find(p=>p.id===brannHarness.state().playerId).side==='rivals');
 await fits(mobile.page,'#menu .menu-card','phone-battle-menu');await shot(mobile.page,'battle-menu-phone');
 await mobile.page.setViewportSize({width:844,height:340});await sleep(200);await fits(mobile.page,'#menu .menu-card','landscape-battle-menu');await shot(mobile.page,'battle-menu-landscape');
 await mobile.page.locator('#resumePlay').tap();await Promise.all(pages.map(p=>p.waitForFunction(()=>brannHarness.snapshot().enemies.some(e=>e.battleRun),null,{timeout:20000})));record('host-enables-guest-chooses-side-bots-replicate','pass');
 await shot(desktop.page,'battle-fps-world');await battleMenu(desktop.page);await desktop.page.locator('.bf-bt-primary').click();await desktop.page.locator('.bf-bt-no').press('Escape');assert.equal(await desktop.page.locator('#menu').isVisible(),true);assert.equal(await desktop.page.locator('.bf-bt-confirm').isVisible(),false);
 await desktop.page.locator('.bf-bt-primary').click();await desktop.page.locator('.bf-bt-yes').click();await Promise.all(pages.map(p=>p.waitForFunction(()=>brannHarness.snapshot().battle.status==='off'&&!brannHarness.snapshot().enemies.some(e=>e.battleRun))));record('cancel-and-disable-cleans-only-battle','pass');
 // Real mobile host menu, including confirmation, must fit without scrolling.
 await mobile.page.setViewportSize({width:390,height:650});await ready(mobile.page,'Solo host');await mobile.page.locator('#solo').tap();
 await mobile.page.waitForFunction(()=>brannHarness.state().solo&&brannHarness.state().rendererReady);
 await battleMenu(mobile.page,true);await mobile.page.locator('.bf-bt-primary').tap();
 await fits(mobile.page,'#menu .menu-card','phone-host-confirmation');await shot(mobile.page,'battle-host-confirmation-phone');
 await mobile.page.setViewportSize({width:844,height:340});await sleep(200);await fits(mobile.page,'#menu .menu-card','landscape-host-confirmation');
 await mobile.page.locator('.bf-bt-yes').tap();await mobile.page.waitForFunction(()=>brannHarness.snapshot()?.battle.status==='running');await fits(mobile.page,'#menu .menu-card','landscape-running-host');record('solo-mobile-host-enables-battle','pass');
 assert.deepEqual(pages.flatMap(p=>p.errors),[]);record('application-errors','pass');
}catch(error){record('exception','fail',{message:error.message});for(let i=0;i<pages.length;i++){console.log(await pages[i].evaluate(()=>({state:window.brannHarness?.state(),status:document.querySelector('#lobbyStatus')?.textContent})).catch(()=>null));await shot(pages[i],'public-battle-failure-'+i).catch(()=>{});}process.exitCode=1;}
finally{save('public-battle');await desktop.browser.close();await mobile.browser.close();}
