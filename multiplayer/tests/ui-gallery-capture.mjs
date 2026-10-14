// Scratch capture (not committed): welcome, HUD, dragon call, talents, shop, world menu on desktop and phone.
import {launch,sleep} from './browser-acceptance-lib.mjs';
import {join} from 'node:path';import {mkdirSync} from 'node:fs';
const OUT=process.env.UI_OUT||'/tmp/claude-0/qa/now';mkdirSync(OUT,{recursive:true});
const BASE=process.env.ACCEPT_BASE||'http://127.0.0.1:5188';
const shot=(p,n)=>p.screenshot({path:join(OUT,n+'.png'),timeout:120000}).catch(e=>console.log('shot fail',n,e.message.slice(0,80)));
const only=process.env.ONLY?process.env.ONLY.split(','):null;
const devices=[{id:'desk',viewport:{width:1440,height:900}},{id:'phone',viewport:{width:844,height:390},touch:true,deviceScaleFactor:2}].filter(d=>!only||only.includes(d.id));
const js=(p,f,a)=>p.evaluate(f,a).catch(e=>console.log('js fail',e.message.slice(0,100)));
const closeNotes=p=>js(p,()=>{for(const b of document.querySelectorAll('.pn-backdrop:not([hidden]) button'))if(/Got it|Back to/.test(b.textContent))b.click();});
await Promise.all(devices.map(async d=>{
 const {browser,page}=await launch({viewport:d.viewport,touch:!!d.touch,deviceScaleFactor:d.deviceScaleFactor||1});
 try{
  await page.goto(BASE+'/?acceptanceProbe&sky=noon');await page.waitForFunction(()=>window.brannHarness,null,{timeout:60000});await sleep(4000);
  await closeNotes(page);await sleep(400);await shot(page,d.id+'-01-welcome');
  await js(page,()=>{document.querySelector('#name').value='Mitch';const r=document.querySelector('input[name="role"][value="hero"]');r.checked=true;r.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#create').click();});
  await page.waitForFunction(()=>{const s=document.querySelector('#statusSolo');if(s&&s.offsetParent)s.click();return window.brannHarness.state().phase==='game';},null,{timeout:90000,polling:500});
  await sleep(4000);await closeNotes(page);await sleep(800);
  await shot(page,d.id+'-02-hero-hud');
  await js(page,()=>{const c=document.querySelector('.dragon-call');if(c){c.hidden=false;if(matchMedia('(pointer:coarse)').matches)c.closest('.dragon-hud')?.classList.add('is-touch');}});await sleep(300);await shot(page,d.id+'-03-dragon-call');
  await js(page,()=>{const c=document.querySelector('.dragon-call');if(c)c.hidden=true;});
  await js(page,()=>window.__qaUI.heroProgress.toggle());await sleep(600);await shot(page,d.id+'-04-talents');await js(page,()=>window.__qaUI.heroProgress.close());await sleep(200);
  await js(page,()=>window.__qaUI.quartermaster.show());await sleep(600);await shot(page,d.id+'-05-shop');
  await js(page,()=>{const s=document.querySelector('.qm-scroll');if(s)s.scrollTop=9999;});await sleep(200);await shot(page,d.id+'-05b-shop-scrolled');
  await js(page,()=>window.__qaUI.quartermaster.close());await sleep(200);
  await js(page,()=>(document.querySelector('[data-touch-action="menu"]')||document.querySelector('#menuButton')).click());await sleep(600);await shot(page,d.id+'-06-menu');
  await js(page,()=>document.querySelector('#resumePlay')?.click());await sleep(300);
  await js(page,()=>document.querySelector('#perspectiveButton')?.click());await sleep(4000);await closeNotes(page);await shot(page,d.id+'-07-god-hud');
  console.log(d.id,'errors',page.errors.slice(0,5));
 }catch(e){console.log('fail',d.id,e.message.slice(0,300));await shot(page,d.id+'-fail');}
 finally{await browser.close();}
}));
