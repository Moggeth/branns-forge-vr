// Source CSS can be reviewed against a root-owned built preview without replacing dist.
// PATCH_HUD_CSS=1 injects only the marked repair sections from the four owned stylesheets.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {launch,enterWorld,record,save,shot,sleep} from './browser-acceptance-lib.mjs';
const {browser,page:initialPage}=await launch({touch:true,viewport:{width:390,height:844}});let page=initialPage;
const name='AlexandertheWandererSmith'.slice(0,24); // legal protocol maximum, intentionally no spaces
const textNodes='.hud-name,.xhud-next,.xhud-title,.xhud-goal-label,.xhud-btn-label,.fo-title,.fo-ptext,.fo-primary-text,.fo-detail,.fo-quest-title,.fo-quest-sum';
async function inspect(){return page.locator(textNodes).evaluateAll(nodes=>nodes.filter(n=>n.checkVisibility({checkVisibilityCSS:true})&&getComputedStyle(n).clipPath==='none').map(n=>{const b=n.getBoundingClientRect(),c=getComputedStyle(n);return {selector:n.className,text:n.textContent,width:b.width,height:b.height,scrollWidth:n.scrollWidth,clientWidth:n.clientWidth,scrollHeight:n.scrollHeight,clientHeight:n.clientHeight,whiteSpace:c.whiteSpace,overflow:c.overflow,textOverflow:c.textOverflow,lineClamp:c.webkitLineClamp,left:b.left,right:b.right};}));}
async function assertText(label){const nodes=await inspect(),width=await page.evaluate(()=>innerWidth);for(const n of nodes){assert.ok(n.width>1&&n.height>1,`${label} hidden ${n.selector}`);assert.ok(n.right<=width+1&&n.left>=-1,`${label} outside viewport ${JSON.stringify(n)}`);if(n.clientWidth>0)assert.ok(n.scrollWidth<=n.clientWidth+1,`${label} horizontal overflow ${JSON.stringify(n)}`);assert.notEqual(n.textOverflow,'ellipsis',`${label} ellipsis ${n.selector}`);assert.ok(n.lineClamp==='none'||n.lineClamp==='unset',`${label} clamp ${n.selector}`);}return nodes;}
try{
 await enterWorld(page,{name});record('baseline-dom','info',{nodes:await inspect(),input:await page.locator('#name').inputValue(),max:await page.locator('#name').getAttribute('maxlength')});
 await page.context().close();
 for(const size of [{width:390,height:844},{width:844,height:390}])for(const zoom of [1,1.5]){
  // Browser zoom layout equivalent: 1.5 device pixels per CSS pixel in the same physical viewport.
  const layout={width:Math.round(size.width/zoom),height:Math.round(size.height/zoom)};
  const context=await browser.newContext({viewport:layout,deviceScaleFactor:zoom,isMobile:true,hasTouch:true});page=await context.newPage();page.errors=[];page.setDefaultTimeout(10000);
  page.on('pageerror',e=>page.errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('favicon'))page.errors.push(m.text());});
  await enterWorld(page,{name});
  if(process.env.PATCH_HUD_CSS==='1') for(const file of ['lobby.css','styles.css','expedition-hud.css','client/field-overlays.css']){const css=readFileSync(new URL('../'+file,import.meta.url),'utf8'),mark=css.indexOf('/* Text-fit repair:');assert.ok(mark>=0);await page.addStyleTag({content:css.slice(mark)});}
  await sleep(150);
  const key=`${size.width}-${zoom}`,label=`${size.width}x${size.height}@${zoom}`;
  assert.equal(await page.locator('#hudName').textContent(),name);
  let nodes=await assertText(label+' collapsed');
  const clearHeader=await page.evaluate(()=>{const a=document.querySelector('.hud-top').getBoundingClientRect(),b=document.querySelector('.xhud').getBoundingClientRect();return b.top>=a.bottom;});assert.equal(clearHeader,true,label+' objective clears header');
  await shot(page,'hud-text-'+key+'-collapsed');
  await page.locator('.xhud-toggle').tap();await sleep(120);assert.equal(await page.locator('.xhud').getAttribute('data-expanded'),'true');
  const title=await page.locator('.xhud-title').boundingBox();assert.ok(title.width>1&&title.height>1,'expanded title visible');
  nodes.push(...await assertText(label+' expanded'));assert.equal(await page.locator('.xhud-next').textContent(),'Gather. Recover a star. Defend the forge.');await shot(page,'hud-text-'+key+'-expanded');
  await page.locator('.xhud-toggle').tap();
  for(const kind of ['party','help']){
   await page.locator(`[data-fo-open="${kind}"]`).tap();await sleep(180);nodes.push(...await assertText(label+' '+kind));
   const panel=await page.locator('.fo-panel').boundingBox(),viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));assert.ok(panel.x>=0&&panel.y>=0&&panel.x+panel.width<=viewport.width+1&&panel.y+panel.height<=viewport.height+1,`${label} panel fit ${JSON.stringify({panel,viewport})}`);
   if(kind==='party')assert.equal(await page.locator('.fo-ptext').textContent(),name);
   await shot(page,'hud-text-'+key+'-'+kind);
   const scroll=await page.locator('.fo-body').evaluate(n=>{n.scrollTop=n.scrollHeight;return{top:n.scrollTop,needed:n.scrollHeight>n.clientHeight+1};});if(scroll.needed)assert.ok(scroll.top>0,'full body text is reachable by scrolling');
   await page.locator('.fo-close').tap();
  }
  await page.locator('.xhud [data-action="start"]').tap();await page.waitForFunction(()=>document.querySelector('.xhud').dataset.stage==='camp');
  nodes.push(...await assertText(label+' active-collapsed'));await page.locator('.xhud-toggle').tap();await sleep(100);
  nodes.push(...await assertText(label+' active-expanded'));assert.ok(await page.locator('.xhud-goal-label:visible').count()>0);await shot(page,'hud-text-'+key+'-active');
  const actual=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio}));assert.deepEqual(actual,{...layout,dpr:zoom});
  record('text-fit-'+key,'pass',{layout:actual,nodes});assert.deepEqual(page.errors,[]);await context.close();
 }
 record('console','pass');
}catch(e){record('failure','fail',{message:e.stack});await shot(page,'hud-text-failure');process.exitCode=1;}finally{save('hud-text');await browser.close();}
