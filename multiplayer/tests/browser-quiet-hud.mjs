import assert from 'node:assert/strict';
import {launch,enterWorld,record,save,shot,sleep} from './browser-acceptance-lib.mjs';
const {browser,page}=await launch({touch:true,viewport:{width:844,height:390}});
const measure=()=>page.evaluate(()=>{
 const canvas=document.querySelector('canvas');let blocked=0,total=0,centerBlocked=0,centerTotal=0;
 for(let y=4;y<innerHeight;y+=8)for(let x=4;x<innerWidth;x+=8){const hit=document.elementFromPoint(x,y)!==canvas;total++;blocked+=+hit;if(x>innerWidth*.25&&x<innerWidth*.75&&y>innerHeight*.22&&y<innerHeight*.72){centerTotal++;centerBlocked+=+hit;}}
 return {width:innerWidth,height:innerHeight,blockedPct:100*blocked/total,centerBlockedPct:100*centerBlocked/centerTotal};
});
async function touchable(selector){
 const m=await page.locator(selector).first().evaluate(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {width:r.width,height:r.height,inside:r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,hit:e===hit||e.contains(hit)};});
 assert.ok(m.inside&&m.hit,selector+' reachable '+JSON.stringify(m));assert.ok(m.width>=43.5&&m.height>=43.5,selector+' touch size '+JSON.stringify(m));
}
try{
 await enterWorld(page,{role:'god',name:'Quiet HUD QA'});
 for(const [width,height] of [[844,390],[960,440],[1280,591],[390,844],[844,340]]){
  await page.setViewportSize({width,height});await sleep(200);
  const m=await measure();record('god-layout-'+width+'x'+height,'info',m);
  assert.ok(m.blockedPct<25,'HUD leaves at least 75% input area free');assert.ok(m.centerBlockedPct<8,'centre is clear');
  await touchable('[data-touch-action="menu"]');await touchable('.mq-more');await touchable('[data-spell][aria-checked="true"]');
  await shot(page,'god-'+width+'x'+height);
 }
 await page.setViewportSize({width:844,height:390});await sleep(100);
 const ids=await page.locator('[data-spell]').evaluateAll(es=>es.map(e=>e.dataset.spell));
 for(const id of ids){
  if(await page.locator('body').getAttribute('data-mq-tray')!=='spells')await page.locator('[data-spell][aria-checked="true"]').tap();
  await page.locator('[data-spell="'+id+'"]').scrollIntoViewIfNeeded();await touchable('[data-spell="'+id+'"]');
  await page.locator('[data-spell="'+id+'"]').tap();
  await page.waitForFunction(id=>document.querySelector('[data-spell="'+id+'"]').getAttribute('aria-checked')==='true',id);
  assert.notEqual(await page.locator('body').getAttribute('data-mq-tray'),'spells');
 }
 record('all-fourteen-spells-select-and-close','pass');
 await page.locator('#quickCast').check();
 let count=await page.evaluate(()=>window.brannHarness.snapshot().enemies.length);
 await page.locator('[data-spell][aria-checked="true"]').tap();await shot(page,'spell-palette');
 await page.touchscreen.tap(430,145);await sleep(200);
 assert.equal(await page.locator('body').getAttribute('data-mq-tray'),null);
 assert.equal(await page.evaluate(()=>window.brannHarness.snapshot().enemies.length),count,'closing palette never casts');
 record('scrim-dismiss-without-cast','pass');
 await page.locator('.mq-more').tap();await shot(page,'world-tools');
 await touchable('[data-fo-open="help"]');await page.locator('[data-fo-open="help"]').tap();
 await page.waitForFunction(()=>window.brannHarness.state().fieldOverlay);await page.locator('[data-fo-action="close"]').tap();
 await page.locator('.mq-more').tap();await page.locator('[data-fo-open="party"]').tap();await page.waitForFunction(()=>window.brannHarness.state().fieldOverlay);await page.locator('[data-fo-action="close"]').tap();
 record('help-party-reachable','pass');
 await page.locator('[data-touch-action="menu"]').tap();await page.check('input[name="menuRole"][value="hero"]',{force:true});await page.waitForFunction(()=>window.brannHarness.state().role==='hero'&&!window.brannHarness.state().menuOpen);
 for(const [width,height] of [[844,390],[390,844]]){
  await page.setViewportSize({width,height});await sleep(200);await touchable('[data-touch-action="strike"]');await touchable('[data-touch-action="jump"]');await touchable('#special');await shot(page,'hero-'+width+'x'+height);record('hero-layout-'+width,'info',await measure());
 }
 const weapons=await page.locator('[data-equip]').evaluateAll(es=>es.map(e=>e.dataset.equip).filter(id=>id!=='limb'));
 for(const id of weapons){
  if(await page.locator('body').getAttribute('data-mq-tray')!=='weapons')await page.locator('[data-equip][aria-pressed="true"]').tap();
  await touchable('[data-equip="'+id+'"]');await page.locator('[data-equip="'+id+'"]').tap();
  await page.waitForFunction(id=>window.brannHarness.controls().weapon.tool===id,id);
  await page.waitForFunction(id=>document.querySelector('[data-equip="'+id+'"]').getAttribute('aria-pressed')==='true',id);
 }
 record('all-owned-weapons-reachable','pass');
 await page.locator('[data-equip][aria-pressed="true"]').tap();await shot(page,'weapon-palette');await page.touchscreen.tap(190,250);
 await page.locator('.bf-actions-drawer > summary').tap();await sleep(80);
 for(const selector of ['#grab','#drop','#throw','#collect','#bridge','.ta-q[data-id="bandage"]','.ta-q[data-id="deliver"]'])await touchable(selector);
 await shot(page,'hero-actions');await page.locator('#drop').tap();
 assert.equal(await page.locator('.bf-actions-drawer').getAttribute('open'),null);
 record('secondary-actions-reachable','pass');
 assert.deepEqual(page.errors,[]);record('console','pass');
}catch(e){record('failure','fail',{message:e.stack});await shot(page,'quiet-failure');process.exitCode=1;}
finally{save('quiet-hud');await browser.close();}
