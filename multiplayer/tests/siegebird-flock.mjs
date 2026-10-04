import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {createEnemy,partPosition,SIEGEBIRD,siegebirdGoldenChance,siegebirdRoll,siegebirdPerfect} from '../shared/combat.js';
import {weaponReadiness} from '../client/ability-readiness.js';
// Shared Siegebird rules: 1.0 s bird reload, deterministic golden bird roll, quad-damage golden bolts and mastery.
const begin=performance.now();
function fixture(kind='golem',edit=()=>{}){const s=createSimulation({legacyBattle:true,legacyBattle:true});s.addPlayer({id:'h'});const c=s.checkpoint();c.enemies=[createEnemy('enemy',[0,terrainHeight(c,0,6),6],kind)];edit(c);return loadSimulation(c);}
let seq=1;const act=(s,action,extra={})=>s.command('h',{type:'action',seq:seq++,action,...extra});
const advance=(s,n)=>{for(let i=0;i<n;i++)s.step();};
function fire(s,part='torso'){const p=s.snapshot().players[0],e=s.snapshot().enemies[0],at=partPosition(e,part),origin=[p.position[0],at[1],p.position[2]],d=at.map((n,i)=>n-origin[i]),l=Math.hypot(...d);return {result:act(s,'fire',{origin,direction:d.map(n=>n/l)}),at,part};}
function land(s,{at,part}){advance(s,3);const shot=s.snapshot().projectiles.at(-1);return s.projectileContact({targetId:'enemy',part,point:at,normal:[0,0,1],localPoint:[0,0,0],localQuaternion:[0,0,0,1],boneName:part,projectileId:shot.id});}

// Reload: 60-tick presentation, accepted from 54 ticks so jitter cannot swallow a visibly ready shot.
let s=fixture();assert.equal(act(s,'equip',{tool:'crossbow'}).ok,true);
const first=fire(s);assert.equal(first.result.ok,true);
const shoot=first.result.events.find(e=>e.kind==='shoot');assert.deepEqual(Object.keys(shoot.reload),['n','golden']);assert.equal(shoot.reload.n,1);
assert.equal(s.snapshot().players[0].siegebird.n,1);
advance(s,SIEGEBIRD.acceptTicks-1);assert.equal(fire(s).result.code,'cooldown','bird has not delivered yet');
advance(s,1);assert.equal(fire(s).result.ok,true,'accepted once the reload window opens');
assert.equal(s.snapshot().players[0].siegebird.n,2,'reload index drives left/right alternation');
const tick=s.snapshot().players[0].attackTick;assert.equal(weaponReadiness(s.snapshot().players[0],'crossbow',tick+30).attackReady,.5,'HUD shows the 1.0 s reload');

// Deterministic golden roll and mastery-scaled chance.
assert.equal(siegebirdRoll('h',3,500),siegebirdRoll('h',3,500));assert.notEqual(siegebirdRoll('h',3,500),siegebirdRoll('h',4,500));
assert.equal(siegebirdGoldenChance(0),SIEGEBIRD.goldenBase);assert.ok(siegebirdGoldenChance(40)>siegebirdGoldenChance(0));assert.equal(siegebirdGoldenChance(1e6),SIEGEBIRD.goldenMax);
let golden=0;for(let n=1;n<=4000;n++)if(siegebirdRoll('h',n,n*61)<siegebirdGoldenChance(0))golden++;
assert.ok(golden>80&&golden<160,`novice golden rate near 3% (${golden}/4000)`);

// Golden bolt does quad damage and is carried by projectile, embed and events; regular bolts count mastery.
const damage=goldenNext=>{const g=fixture('golem',c=>{c.players[0].tool='crossbow';c.players[0].siegebird={n:5,golden:goldenNext,hits:7};});const shot=fire(g);assert.equal(shot.result.ok,true);
 assert.equal(!!g.snapshot().projectiles[0].golden,goldenNext);assert.equal(!!shot.result.events[0].golden,goldenNext);
 const hp=g.snapshot().enemies[0].hp,hit=land(g,shot);assert.equal(hit.ok,true);
 if(goldenNext){
  // Radiant: a golden bolt bursts through the golem (no embed in it), keeps flying, and only ever hits it once.
  const pierce=hit.events.find(e=>e.kind==='pierce');assert.ok(pierce?.golden);assert.ok(hit.events.some(e=>e.kind==='radiant_burst'));
  assert.equal(g.snapshot().embeds.length,0);assert.deepEqual(g.snapshot().projectiles[0].pierced,[g.snapshot().enemies[0].id]);
  assert.equal(land(g,shot).ok,false,'a pierced target is never hit twice by the same bolt');
 }else{assert.equal(!!hit.events.find(e=>e.kind==='embed').golden,false);assert.equal(!!g.snapshot().embeds[0].golden,false);}
 assert.equal(g.snapshot().players[0].siegebird.hits,8,'a landed bolt grows mastery');
 const restored=loadSimulation(g.checkpoint());assert.deepEqual(restored.snapshot(),g.snapshot(),'golden state survives save/restore');
 return hp-g.snapshot().enemies[0].hp;};
const plain=damage(false),gold=damage(true);assert.ok(Math.abs(gold-plain*SIEGEBIRD.goldenMultiplier)<1e-9,`golden ${gold} = 4 x ${plain}`);

// A golden projectile in flight survives checkpoint/restore; malformed saves are refused.
s=fixture('golem',c=>{c.players[0].tool='crossbow';c.players[0].siegebird={n:0,golden:true,hits:0};});fire(s);
const saved=s.checkpoint();assert.equal(saved.projectiles[0].golden,true);assert.equal(loadSimulation(saved).snapshot().projectiles[0].golden,true);
for(const bad of [{n:-1,golden:false,hits:0},{n:1,golden:'yes',hits:0},{n:1,golden:false,hits:0,extra:1}])assert.throws(()=>loadSimulation({...saved,players:saved.players.map(p=>({...p,siegebird:bad}))}));
assert.throws(()=>loadSimulation({...saved,projectiles:saved.projectiles.map(p=>({...p,golden:false}))}));
// Perfect wind: the first press during a reload is judged against the latch; a hit makes the next reload quick.
const L=Math.round(SIEGEBIRD.latch*SIEGEBIRD.reloadTicks),W=SIEGEBIRD.windowTicks;
assert.ok(siegebirdPerfect(L)&&siegebirdPerfect(L-W)&&siegebirdPerfect(L+W)&&!siegebirdPerfect(L+W+1)&&!siegebirdPerfect(L-W-1));
assert.ok(siegebirdPerfect(Math.round(SIEGEBIRD.latch*SIEGEBIRD.quickTicks),{quick:true}),'quick reloads latch earlier');
assert.ok(siegebirdPerfect(30,{hand:true})&&siegebirdPerfect(Math.round(SIEGEBIRD.handLatch*60)+W,{hand:true})&&!siegebirdPerfect(10,{hand:true})&&!siegebirdPerfect(60,{hand:true}),'hand winding beats the bird');
const sb=s=>s.snapshot().players[0].siegebird;
function cycle(pressAt,hand){const w=fixture('golem',c=>{c.players[0].tool='crossbow';});assert.equal(fire(w).result.ok,true);advance(w,pressAt);
  assert.equal(act(w,'wind',hand?{hand:true}:{}).ok,true);return w;}
let w=cycle(L,false);assert.equal(sb(w).wind,1,'press on the latch is perfect');
assert.equal(act(w,'wind').ok,true);assert.equal(sb(w).wind,1,'repeat presses change nothing');
advance(w,SIEGEBIRD.acceptTicks-L);const quick=fire(w);assert.equal(quick.result.ok,true);assert.equal(quick.result.events[0].reload.quick,true,'the next reload is quick');
assert.deepEqual([sb(w).quick,sb(w).wind],[true,0]);
advance(w,SIEGEBIRD.quickAcceptTicks-1);assert.equal(fire(w).result.code,'cooldown');advance(w,1);const after=fire(w);assert.equal(after.result.ok,true,'quick reload accepted from 40 ticks');
assert.equal(after.result.events[0].reload.quick,undefined,'without another perfect wind the reload is normal again');assert.equal(sb(w).quick,false);
w=cycle(L-W-2,false);assert.equal(sb(w).wind,-1,'an early press forfeits it');assert.equal(act(w,'wind').ok,true);assert.equal(sb(w).wind,-1,'no second try');
advance(w,SIEGEBIRD.acceptTicks);assert.equal(fire(w).result.events[0].reload.quick,undefined);
w=cycle(40,true);assert.equal(sb(w).wind,1,'hand-wound latch before the bird seats');
w=fixture('golem',c=>{c.players[0].tool='crossbow';});assert.equal(act(w,'wind').ok,true);assert.equal(sb(w),undefined,'no reload, nothing to judge');
assert.equal(act(w,'wind',{hand:'yes'}).ok,false);
w=cycle(L,false);const quickSave=w.checkpoint();assert.deepEqual(loadSimulation(quickSave).snapshot(),w.snapshot(),'wind verdict survives save/restore');
assert.deepEqual(Object.keys(quickSave.players[0].siegebird).sort(),['golden','hits','n','quick','wind']);
for(const bad of [{n:1,golden:false,hits:0,quick:true},{n:1,golden:false,hits:0,quick:1,wind:0},{n:1,golden:false,hits:0,quick:false,wind:2}])assert.throws(()=>loadSimulation({...quickSave,players:quickSave.players.map(p=>({...p,siegebird:bad}))}));
console.log(`siegebird-flock: reload window, golden roll, quad damage, mastery, perfect wind and persistence pass (${((performance.now()-begin)/1000).toFixed(3)} s)`);
