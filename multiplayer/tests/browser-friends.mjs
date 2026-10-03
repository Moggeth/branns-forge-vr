import assert from 'node:assert/strict';
import {launch,enterWorld,BASE,record,save,shot,sleep,chooseTouchSpell} from './browser-acceptance-lib.mjs';
import {disableIce} from './no-ice-fixture.mjs';
const a=await launch({touch:true,viewport:{width:960,height:600}}),b=await launch({touch:true,viewport:{width:960,height:600}});
const sockets=[];for(const p of [a.page,b.page])p.on('websocket',ws=>sockets.push(ws.url()));
try{
 if(process.env.FORCE_RELAY==='1')await Promise.all([a.context,b.context].map(disableIce));
 await enterWorld(a.page,{name:'Friend Hero'});const room=await a.page.evaluate(()=>window.brannHarness.snapshot().room);
 await b.page.goto(BASE+'/?acceptanceProbe');await b.page.waitForFunction(()=>window.brannHarness);await b.page.fill('#name','Friend God');await b.page.check('input[name="role"][value="god"]',{force:true});await b.page.fill('#room',room);await b.page.locator('#join').tap();
 await Promise.all([a.page,b.page].map(p=>p.waitForFunction(()=>window.brannHarness.snapshot()?.players.length===2,null,{timeout:30000})));
 for(const p of [a.page,b.page])assert.equal(await p.evaluate(()=>window.brannHarness.snapshot().landmarks),true);
 record('two-friends-shared-starting-world','pass',{room});
 await a.page.locator('.xhud-actions [data-action="start"]').tap();
 await Promise.all([a.page,b.page].map(p=>p.waitForFunction(()=>window.brannHarness.snapshot().adventure.stage==='camp')));
 record('hero-starts-expedition-visible-to-god','pass');
 await b.page.locator('#quickCast').check();await chooseTouchSpell(b.page,'raise');await b.page.touchscreen.tap(580,280);
 await Promise.all([a.page,b.page].map(p=>p.waitForFunction(()=>window.brannHarness.snapshot().edits.some(e=>e.kind==='raise'))));
 record('god-terrain-cast-visible-to-hero','pass');await sleep(350);await shot(a.page,'friends-starting-fps');await shot(b.page,'friends-starting-rts');
 if(process.env.EXPECT_CLOUD==='1'){const gameSockets=sockets.filter(url=>{const u=new URL(url);return !(u.host===new URL(BASE).host&&u.pathname==='/'&&u.searchParams.has('token'));});assert.equal(gameSockets.length>=2,true);assert.ok(gameSockets.every(url=>url.startsWith('wss://branns-forge-rooms.fauxgrady.workers.dev/peer/cloud')));record('no-desktop-hosting-dependency','pass',{sockets});}
 assert.deepEqual([...a.page.errors,...b.page.errors],[]);record('console','pass');
 if(process.env.HOST_CRASH==='1'){
  // Allow the 2 Hz recovery cadence; the assertion after takeover verifies the saved edit.
  await sleep(700);
  await a.browser.close();
  await b.page.getByRole('button',{name:'Continue world here',exact:true}).waitFor({state:'visible',timeout:25000});
  await b.page.getByRole('button',{name:'Continue world here',exact:true}).click();
  await b.page.waitForFunction(()=>window.brannHarness.state().host && window.brannHarness.state().connected);
  assert.ok(await b.page.evaluate(()=>window.brannHarness.snapshot().edits.some(e=>e.kind==='raise')));
  record('public-host-browser-exit-and-continue-button','pass');await shot(b.page,'friends-recovered-host');
 }
}catch(e){record('exception','fail',{message:e.message});if(!a.page.isClosed())await shot(a.page,'friends-failure-hero');await shot(b.page,'friends-failure-god');process.exitCode=1;}finally{save('friends');await a.browser.close();await b.browser.close();}
