// Mountain-foot ore veins: shared, tiered, roaming respawn, save-compatible.
import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {VEIN_RULES,VEIN_TIERS,veinKind,stepVeins,isVein} from '../shared/ore-veins.js';
import {DEPOSIT_CATALOG,ORE_RECIPES,MATERIAL_CATALOG,restoreMaterials} from '../shared/material-catalog.js';
import {moveOnTerrain} from '../shared/terrain.js';
import {worldTrees} from '../shared/world-content.js';
const start=performance.now();
const cheb=d=>Math.max(Math.abs(d.x),Math.abs(d.z));
const veinsOf=s=>s.deposits.filter(isVein);

// 1. A fresh world raises every slot along the rim, spaced apart, on walkable ground a Hero can reach.
const sim=createSimulation({room:'VEINS',seed:41});sim.addPlayer({id:'hero',role:'hero'});
for(let i=0;i<VEIN_RULES.check;i++)sim.step();
let s=sim.adventureWorld(),veins=veinsOf(s);
assert.equal(veins.length,VEIN_RULES.slots,'every slot holds a vein');
assert.deepEqual(new Set(veins.map(v=>v.vein)).size,VEIN_RULES.slots);
for(const v of veins){
  assert.ok(cheb(v)>=VEIN_RULES.inner-1e-6&&cheb(v)<=VEIN_RULES.outer+1e-6,`${v.id} sits in the rim band`);
  assert.ok(Object.hasOwn(DEPOSIT_CATALOG,v.kind));assert.equal(v.maxHits,DEPOSIT_CATALOG[v.kind].maxHits);
  assert.ok(worldTrees(s).every(t=>Math.hypot(t.x-v.x,t.z-v.z)>=3),'clear of trees');
  for(const w of veins)if(w!==v)assert.ok(Math.hypot(v.x-w.x,v.z-w.z)>=VEIN_RULES.spacing-1e-6,'veins keep apart');
  // Walk in from the meadow side; the authoritative mover must bring a Hero within pick reach.
  const k=(cheb(v)-8)/cheb(v),p=[v.x*k,0,v.z*k];p[1]=terrainHeight(s,p[0],p[2]);
  for(let i=0;i<240&&Math.hypot(v.x-p[0],v.z-p[2])>1.2;i++){const dx=v.x-p[0],dz=v.z-p[2],d=Math.hypot(dx,dz);moveOnTerrain(s,p,dx/d*.08,dz/d*.08);p[1]=terrainHeight(s,p[0],p[2]);}
  assert.ok(Math.hypot(v.x-p[0],v.z-p[2])<=2.6,`${v.id} (${v.kind}) is reachable on foot`);
  assert.ok(Math.abs(terrainHeight(s,v.x,v.z,false)-p[1])<=3,'within vertical reach');
}

// 2. Tiered rarity: common copper/iron at the meadow edge, uncommon gold/mithril further in, rare star deep in.
const count={};let deepStar=0,stars=0;
for(let i=0;i<20000;i++){const d=(i+.5)/20000,k=veinKind(d,((i*7919)%20000)/20000);count[k]=(count[k]||0)+1;if(k==='star'){stars++;if(d>.68)deepStar++;}}
const share=k=>(count[k]||0)/20000;
assert.ok(share('copper')+share('iron')>.6,'common ores dominate');
assert.ok(share('gold')+share('mithril')>.15&&share('gold')+share('mithril')<.35,'uncommon tier');
assert.ok(share('star')>.02&&share('star')<.08,'star veins are rare');
assert.equal(deepStar,stars,'star veins only deep in the mountain foot');
assert.equal(veinKind(0,.999),'iron');assert.equal(VEIN_TIERS.length,5);

// 3. New ores refine into new metals; old material saves still restore.
for(const k of ['copper','gold']){assert.ok(MATERIAL_CATALOG[k]&&MATERIAL_CATALOG[k+'Ore']);assert.equal(ORE_RECIPES[k+'Ore'].output,k);}
assert.equal(DEPOSIT_CATALOG.copper.resource,'copperOre');assert.equal(DEPOSIT_CATALOG.gold.resource,'goldOre');assert.equal(DEPOSIT_CATALOG.star.resource,'starOre');
assert.equal(restoreMaterials({wood:3,ironOre:2}).copperOre,0,'pre-vein inventories load');

// 4. Shared node: mining it out pays its ore once, starts a 3-5 minute timer, then a fresh vein rises elsewhere in the slot.
const target=veins.find(v=>v.kind==='copper')||veins[0],slot=target.vein,hero=s.players[0];
const inward=1.4/cheb(target);hero.position=[target.x*(1-inward),0,target.z*(1-inward)];hero.position[1]=terrainHeight(s,hero.position[0],hero.position[2]);
hero.yaw=Math.atan2(-(target.x-hero.position[0]),-(target.z-hero.position[2]));
let seq=1;sim.command('hero',{type:'action',seq:seq++,action:'equip',tool:'pick'});
const floor=terrainHeight(s,target.x,target.z,false);
for(let h=0;h<target.maxHits;h++){for(let i=0;i<30;i++)sim.step();hero.position[1]=terrainHeight(s,hero.position[0],hero.position[2]);
  const r=sim.command('hero',{type:'action',seq:seq++,action:'strike',tool:'pick',targetId:target.id,point:[target.x,floor+.5,target.z],normal:[0,1,0]});assert.ok(r.ok,`strike ${h}`);}
s=sim.adventureWorld();
const spent=s.deposits.find(d=>d.id===target.id);assert.equal(spent.depleted,true,'mined out');
const reward=DEPOSIT_CATALOG[target.kind];assert.ok(s.pickups.some(q=>q.kind===reward.resource&&q.amount===reward.amount),'ore pickup dropped');
for(let i=0;i<VEIN_RULES.check;i++)sim.step();s=sim.adventureWorld();
const timer=s.deposits.find(d=>d.id===target.id).respawnTick-s.tick;
assert.ok(timer>=VEIN_RULES.respawn[0]-VEIN_RULES.check&&timer<=VEIN_RULES.respawn[1],`respawn in ${timer} ticks`);
// Reclamation (spells, specials) keeps the timer; save/load keeps it too.
const {reclaimDepletedDeposits}=await import('../shared/resources.js');reclaimDepletedDeposits(s);assert.ok(s.deposits.some(d=>d.id===target.id),'spent vein keeps its timer');
const mid=loadSimulation(sim.checkpoint());assert.equal(mid.adventureWorld().deposits.find(d=>d.id===target.id).respawnTick,s.deposits.find(d=>d.id===target.id).respawnTick);
for(let i=0;i<timer-VEIN_RULES.check*2;i++)sim.step();s=sim.adventureWorld();
assert.ok(!veinsOf(s).some(v=>v.vein===slot&&!v.depleted),'no early respawn');
hero.position=[0,terrainHeight(s,0,8),8];
for(let i=0;i<VEIN_RULES.check*4;i++)sim.step();s=sim.adventureWorld();
const fresh=veinsOf(s).find(v=>v.vein===slot);
assert.ok(fresh&&!fresh.depleted&&fresh.id!==target.id,'replacement vein rose');
assert.ok(Math.hypot(fresh.x-target.x,fresh.z-target.z)>=VEIN_RULES.moveAway,'at a different spot along the edge');
assert.ok(!s.deposits.some(d=>d.id===target.id&&isVein(d)),'old vein released its slot');
assert.equal(veinsOf(s).length,VEIN_RULES.slots);

// 5. Respawns never pop up beside a Hero; the shared deposit budget is respected.
const crowd=loadSimulation(sim.checkpoint()),cw=crowd.adventureWorld(),v0=veinsOf(cw)[0];
v0.hits=v0.maxHits;v0.depleted=true;v0.respawnTick=cw.tick+1;
cw.players[0].position=[v0.x*.97,0,v0.z*.97];
const budget=loadSimulation(sim.checkpoint()),bw=budget.adventureWorld(),b0=veinsOf(bw)[0];b0.hits=b0.maxHits;b0.depleted=true;b0.respawnTick=bw.tick+1;
for(let i=0;bw.deposits.length<80;i++)bw.deposits.push({id:`fill${i}`,x:0,z:-30+i*.1,kind:'stone',hits:0,maxHits:3,depleted:false});
const ctx={terrainHeight};bw.tick=Math.ceil((bw.tick+1)/VEIN_RULES.check)*VEIN_RULES.check;
assert.equal(stepVeins(bw,ctx,[]),0,'full deposit budget raises nothing');assert.equal(bw.deposits.length,80);
cw.tick=Math.ceil((cw.tick+1)/VEIN_RULES.check)*VEIN_RULES.check;const events=[];stepVeins(cw,ctx,events);
for(const e of events){assert.equal(e.kind,'geology_emerge');assert.ok(Math.hypot(e.position[0]-cw.players[0].position[0],e.position[2]-cw.players[0].position[2])>=VEIN_RULES.heroClear);}

// 6. Saves: pre-vein saves load and gain veins; malformed vein fields are refused.
const legacy=sim.checkpoint();legacy.deposits=legacy.deposits.filter(d=>!isVein(d)).map(({vein,respawnTick,...d})=>d);
const old=loadSimulation(legacy);for(let i=0;i<VEIN_RULES.check;i++)old.step();assert.equal(veinsOf(old.adventureWorld()).length,VEIN_RULES.slots,'old saves gain veins');
const dup=sim.checkpoint();const dv=dup.deposits.filter(isVein);dv[1].vein=dv[0].vein;assert.throws(()=>loadSimulation(dup),/Invalid vein/);
const live=sim.checkpoint();live.deposits.find(isVein).respawnTick=live.tick+5;assert.throws(()=>loadSimulation(live),/Invalid vein/,'live veins carry no timer');
const far=sim.checkpoint();const fv=far.deposits.find(isVein);fv.hits=fv.maxHits;fv.depleted=true;fv.respawnTick=far.tick+VEIN_RULES.respawn[1]+1;assert.throws(()=>loadSimulation(far),/Invalid vein/);
const stray=sim.checkpoint();stray.deposits.find(d=>!isVein(d)).respawnTick=5;assert.throws(()=>loadSimulation(stray),/Invalid vein/);

// 7. Determinism: the same seed and inputs raise identical veins.
const twin=createSimulation({room:'VEINS',seed:41});twin.addPlayer({id:'hero',role:'hero'});for(let i=0;i<VEIN_RULES.check;i++)twin.step();
const a=veinsOf(twin.adventureWorld()).map(v=>[v.id,v.kind,v.x,v.z]),b=veinsOf(createSimulation({room:'VEINS',seed:41}).adventureWorld());void b;
const again=createSimulation({room:'VEINS',seed:41});again.addPlayer({id:'hero',role:'hero'});for(let i=0;i<VEIN_RULES.check;i++)again.step();
assert.deepEqual(veinsOf(again.adventureWorld()).map(v=>[v.id,v.kind,v.x,v.z]),a);
const other=createSimulation({room:'VEINS',seed:42});other.addPlayer({id:'hero',role:'hero'});for(let i=0;i<VEIN_RULES.check;i++)other.step();
assert.notDeepEqual(veinsOf(other.adventureWorld()).map(v=>[v.x,v.z]),a.map(v=>[v[2],v[3]]),'seeds differ');

console.log(JSON.stringify({passed:true,veins:veins.map(v=>v.kind),shares:Object.fromEntries(Object.entries(count).map(([k,n])=>[k,+(n/20000).toFixed(3)])),respawnTicks:timer,elapsedSeconds:+((performance.now()-start)/1000).toFixed(2)}));
