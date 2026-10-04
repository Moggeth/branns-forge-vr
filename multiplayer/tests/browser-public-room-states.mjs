// Isolated actual-component checks; no game/session or room service mutations.
import assert from 'node:assert/strict';
import {launch,BASE,record,shot,save} from './browser-acceptance-lib.mjs';
const {browser,page}=await launch({viewport:{width:390,height:844},touch:true});
const check=async(id,fn)=>{try{await fn();record(id,'pass');}catch(e){record(id,'fail',{message:e.message});process.exitCode=1;}};
try{
 await page.route('**/tests/public-room-states.html',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/client/public-rooms.css"><link rel="stylesheet" href="/client/battle-panel.css"><style>body{margin:8px;background:#181410;color:#efe5d1}button{min-height:44px}#battle{max-width:540px}</style><button id="launch">Browse worlds</button><div id="battle"></div><script type="module">
 import {createPublicRoomBrowser} from '/client/public-rooms.js';import {createBattlePanel} from '/client/battle-panel.js';
 window.events=[];window.rooms=createPublicRoomBrowser({onJoin:code=>events.push(['join',code]),onMore:cursor=>events.push(['more',cursor]),onRefresh:()=>events.push(['refresh']),onClose:()=>events.push(['close']),onCreate:()=>events.push(['create'])});
 window.panel=createBattlePanel({mount:document.querySelector('#battle'),onAction:a=>events.push(['action',a])});window.model={status:'off',isHost:true,connected:true,canChangeSide:true,selfSide:'party',bases:[],bots:{party:0,rivals:0}};window.panel.update(window.model);
 window.a={code:'12345678',hostName:'<img src=x onerror=1>',count:2,maxPlayers:32,joinable:true,status:'playing',players:[{name:'<svg onload=alert(1)>',role:'hero'}]};window.b={...a,code:'87654321',hostName:'Second'};rooms.render({rooms:[a,b]});document.querySelector('#launch').onclick=()=>rooms.open(document.querySelector('#launch'));window.ready=true;
 </script>`}));
 await page.goto(BASE+'/tests/public-room-states.html');await page.waitForFunction(()=>window.ready);
 await page.click('#launch');
 await check('keyed-refresh-focus-expanded-and-safe-name-text',async()=>{
  await page.locator('[data-code="12345678"] .bf-pr-toggle').click();
  await page.locator('[data-code="12345678"] .bf-pr-join').focus();
  const result=await page.evaluate(()=>{const focus=document.activeElement,row=focus.closest('li');rooms.render({rooms:[b,{...a,count:3}]});return {same:document.activeElement===focus,row:document.querySelector('[data-code="12345678"]')===row,expanded:row.querySelector('.bf-pr-toggle').getAttribute('aria-expanded'),host:row.querySelector('.bf-pr-host').textContent,name:row.querySelector('.bf-pr-person-name').textContent,injected:row.querySelectorAll('img,svg,script').length};});
  assert.equal(result.same,true);assert.equal(result.row,true);assert.equal(result.expanded,'true');assert.equal(result.host,'<img src=x onerror=1>');assert.equal(result.name,'<svg onload=alert(1)>');assert.equal(result.injected,0);
 });
 await check('full32-retains-focus-and-blocks-join',async()=>{
  await page.evaluate(()=>{events.length=0;rooms.render({rooms:[{...a,count:32},b]});});
  assert.equal(await page.locator('[data-code="12345678"] .bf-pr-count').textContent(),'32/32');
  assert.equal(await page.evaluate(()=>document.activeElement.closest('[data-code]')?.dataset.code),'12345678');
  await page.keyboard.press('Enter');assert.deepEqual(await page.evaluate(()=>events),[]);
 });
 await check('removed-row-focus-fallback-empty-and-error-retry',async()=>{
  await page.evaluate(()=>rooms.render({rooms:[]}));assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('bf-pr-refresh')),true);
  assert.equal(await page.locator('.bf-pr-empty-create').isVisible(),true);
  await page.evaluate(()=>rooms.render({error:'Synthetic unavailable',loading:false}));assert.equal(await page.locator('[role="alert"]').isVisible(),true);
  await page.locator('.bf-pr-retry').click();assert.deepEqual(await page.evaluate(()=>events.at(-1)),['refresh']);
 });
 await check('pagination-pending-close-and-return-focus',async()=>{
  await page.evaluate(()=>{events.length=0;rooms.render({rooms:[a,b],error:'',nextCursor:'room:87654321',loading:false});});
  await page.locator('.bf-pr-more').click();assert.deepEqual(await page.evaluate(()=>events.at(-1)),['more','room:87654321']);
  await page.evaluate(()=>{rooms.render({loading:true});events.length=0;});
  await page.locator('.bf-pr-more').focus();await page.keyboard.press('Enter');assert.deepEqual(await page.evaluate(()=>events),[]);
  await page.evaluate(()=>rooms.render({loading:false,pendingCode:a.code}));
  await page.locator('[data-code="87654321"] .bf-pr-join').focus();await page.keyboard.press('Enter');assert.deepEqual(await page.evaluate(()=>events),[]);
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>rooms.isOpen),false);assert.equal(await page.evaluate(()=>document.activeElement.id),'launch');assert.deepEqual(await page.evaluate(()=>events),[['close']]);
 });
 await check('host-confirm-safe-default-cancel-and-confirm-once',async()=>{
  await page.evaluate(()=>events.length=0);await page.locator('.bf-bt-primary').click();assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('bf-bt-no')),true);
  await page.keyboard.press('Enter');assert.deepEqual(await page.evaluate(()=>events),[]);assert.equal(await page.locator('.bf-bt-confirm').isVisible(),false);
  await page.locator('.bf-bt-primary').click();await page.locator('.bf-bt-yes').click();assert.deepEqual(await page.evaluate(()=>events),[['action',{action:'start'}]]);
 });
 await check('host-loss-and-disconnect-cancel-stale-confirmations',async()=>{
  await page.evaluate(()=>events.length=0);await page.locator('.bf-bt-primary').click();
  await page.evaluate(()=>panel.update({...model,isHost:false}));assert.equal(await page.locator('.bf-bt-confirm').isVisible(),false);
  await page.evaluate(()=>document.querySelector('.bf-bt-yes').click());assert.deepEqual(await page.evaluate(()=>events),[]);
  await page.evaluate(()=>panel.update(model));await page.locator('.bf-bt-primary').click();await page.evaluate(()=>panel.update({...model,connected:false}));
  await page.evaluate(()=>document.querySelector('.bf-bt-yes').click());assert.deepEqual(await page.evaluate(()=>events),[]);
 });
 await check('expedition-start-cancels-stale-enable-confirmation',async()=>{
  await page.evaluate(()=>{events.length=0;panel.update(model);});await page.locator('.bf-bt-primary').click();await page.evaluate(()=>panel.update({...model,expeditionActive:true}));
  assert.equal(await page.locator('.bf-bt-confirm').isVisible(),false,'enabling confirmation must close when an expedition begins');
 });
 await check('legacy-member-cancels-enable-and-explains-refresh',async()=>{
  await page.evaluate(()=>{events.length=0;panel.update(model);});await page.locator('.bf-bt-primary').click();
  await page.evaluate(()=>panel.update({...model,battleCompatible:false}));assert.equal(await page.locator('.bf-bt-confirm').isVisible(),false);
  assert.equal(await page.locator('.bf-bt-primary').getAttribute('aria-disabled'),'true');assert.match(await page.locator('.bf-bt-host .bf-bt-reason').innerText(),/everyone refresh/);
  await page.evaluate(()=>document.querySelector('.bf-bt-yes').click());assert.deepEqual(await page.evaluate(()=>events),[]);
 });
 record('component-capture','measured',{capture:await shot(page,'public-room-battle-states'),errors:page.errors});assert.deepEqual(page.errors,[]);
}finally{save('public-room-states');await browser.close();}
