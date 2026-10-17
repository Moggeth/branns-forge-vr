import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {createEnemy,siegebirdGoldenChance,SIEGEBIRD,GOLDEN_FLOCK,projectileContact} from '../shared/combat.js';
import {HERO_LEVEL,XP_MAX,XP_REWARD,TALENTS,heroLevel,xpForLevel,heroMaxHp,damageScale,talentPoints,grantXp,hasTalent} from '../shared/hero-progress.js';
import {cleaveSpec,WHIRLWIND,AXE_CLEAVE} from '../shared/axe-cleave.js';
import {specialCooldown} from '../shared/special-cooldowns.js';
import {fireContact,FIREBOMB} from '../shared/fire.js';
import {progressModel} from '../client/hero-progress-ui.js';

// Curve: fast early levels, capped at HERO_LEVEL.max.
assert.equal(heroLevel(0),1);assert.equal(heroLevel(29),1);assert.equal(heroLevel(30),2);assert.equal(xpForLevel(3),80);
assert.equal(heroLevel(XP_MAX),HERO_LEVEL.max);assert.equal(heroLevel(XP_MAX*5),HERO_LEVEL.max);
assert.ok(2*XP_REWARD.skeleton>=xpForLevel(2),'two skeletons reach level 2');
assert.equal(heroMaxHp({xp:0}),100);assert.equal(heroMaxHp({xp:XP_MAX}),280);
assert.equal(damageScale({role:'hero',xp:xpForLevel(4)}),1.6);assert.equal(damageScale({role:'god',xp:XP_MAX}),1,'god casting never scales');
assert.equal(talentPoints({xp:xpForLevel(4),talents:{axe:['whirlwind']}}),2);

// Fixture: one hero at (x,z), optional foes ahead (metres along -Z).
function fixture({x=10,z=10,tool='axe',foes=[],xp,talents,name='Mitch'}={}) {
  const sim=createSimulation();sim.addPlayer({id:'h',name});
  const c=sim.checkpoint(),p=c.players[0];p.position=[x,terrainHeight(c,x,z),z];p.yaw=0;p.tool=tool;
  if(xp!==undefined)p.xp=xp;if(talents)p.talents=talents;p.hp=heroMaxHp(p);
  c.enemies=foes.map((ahead,i)=>createEnemy(`foe${i}`,[x,terrainHeight(c,x,z-ahead),z-ahead]));
  return loadSimulation(c);
}
const hero=s=>s.snapshot().players[0];
let seq=1;const act=(s,m)=>s.command('h',{type:'action',seq:seq++,...m});

// Kills grant XP; crossing a level emits level_up, restores the hero to the bigger health and adds a point.
let s=fixture({foes:[2,2.5]});
const cleave=act(s,{action:'special'});
assert.equal(cleave.ok,true);
assert.equal(hero(s).xp,2*XP_REWARD.skeleton);
const up=cleave.events.find(e=>e.kind==='level_up');
assert.ok(up&&up.id==='h'&&up.level===2&&up.points===1&&up.maxHp===120,'level_up event');
assert.equal(hero(s).maxHp,120);assert.equal(hero(s).hp,120);
// Progress survives a save round trip.
const saved=JSON.parse(JSON.stringify(s.checkpoint()));
assert.deepEqual(loadSimulation(saved).snapshot().players[0].xp,hero(s).xp);
assert.equal(saved.heroLedger.mitch.xp,40,'world ledger records progress by hero name');

// Talents: learn with a point, refuse without one, refuse unknown ones, free reset refunds.
assert.equal(act(s,{action:'talent',weapon:'axe',talent:'nope'}).code,'invalid_talent');
const learned=act(s,{action:'talent',weapon:'axe',talent:'whirlwind'});
assert.equal(learned.ok,true);assert.equal(learned.events[0].kind,'talent_learned');
assert.deepEqual(hero(s).talents,{axe:['whirlwind']});
assert.equal(act(s,{action:'talent',weapon:'axe',talent:'limbsplitter'}).code,'no_talent_points');
assert.equal(act(s,{action:'talent',weapon:'axe',talent:'whirlwind'}).code,'already_learned');
assert.equal(act(s,{action:'talent',reset:true}).ok,true);assert.deepEqual(hero(s).talents,{});
assert.equal(act(s,{action:'talent',reset:true}).code,'not_needed');
assert.ok(Object.hasOwn(TALENTS.axe,'limbsplitter')&&Object.keys(TALENTS).length===6&&Object.values(TALENTS).every(t=>Object.keys(t).length===2),'two specialties for each of six weapons');
assert.ok(!('hammer' in TALENTS),'hammer stays out for now');

// Rejoining (or a resumed save with new peer ids) picks progress back up by name, never twice at once.
s.removePlayer('h');s.addPlayer({id:'h2',name:'Mitch'});
assert.equal(s.snapshot().players[0].xp,40);assert.equal(s.snapshot().players[0].maxHp,120);
s.addPlayer({id:'h3',name:'mitch'});
assert.equal(s.snapshot().players.find(p=>p.id==='h3').xp,0,'a second hero with the same name starts fresh');

// Save validation: talents beyond the hero's level, or unknown talents, are refused.
const bad=JSON.parse(JSON.stringify(fixture({xp:0}).checkpoint()));bad.players[0].talents={axe:['whirlwind']};
assert.throws(()=>loadSimulation(bad),/player/);
const bad2=JSON.parse(JSON.stringify(fixture({xp:XP_MAX}).checkpoint()));bad2.players[0].talents={hammer:['x']};
assert.throws(()=>loadSimulation(bad2),/player/);
const bad3=JSON.parse(JSON.stringify(fixture({xp:0}).checkpoint()));bad3.players[0].hp=150;
assert.throws(()=>loadSimulation(bad3),/player/,'health above max');
const bad4=JSON.parse(JSON.stringify(fixture({xp:0}).checkpoint()));bad4.heroLedger={__proto__x:{xp:1,talents:{}},'Mitch':{xp:1,talents:{}}};
assert.throws(()=>loadSimulation(bad4),/ledger/);
// Old saves without progress still load at level 1.
const old=JSON.parse(JSON.stringify(fixture().checkpoint()));delete old.players[0].xp;delete old.players[0].talents;delete old.heroLedger;
assert.equal(loadSimulation(old).snapshot().players[0].xp,0);

// Damage scales with level: the same axe strike hurts a golem more at level 5.
const golemHit=xp=>{const t=fixture({xp,foes:[]});const c=t.checkpoint();c.enemies=[createEnemy('g',[10,terrainHeight(c,10,8.4),8.4],'golem')];c.enemies[0].armor=0;const u=loadSimulation(c);
  const r=u.command('h',{type:'action',seq:1,action:'strike',targetId:'g',point:[10,terrainHeight(c,10,8.4)+1.2,8.4],normal:[0,0,1],part:'torso'});assert.equal(r.ok,true);return 320-u.snapshot().enemies[0].hp;};
assert.ok(Math.abs(golemHit(xpForLevel(5))/golemHit(0)-1.8)<1e-9,'level 5 hits 1.8x');

// Limbsplitter: one axe swing to a skeleton's arm takes it off.
const limb=talents=>{const t=fixture({xp:xpForLevel(3),talents,foes:[1.6]});const e=t.snapshot().enemies[0],c=t.checkpoint();
  const point=[e.position[0]-.48,e.position[1]+1.12,e.position[2]];
  t.command('h',{type:'action',seq:1,action:'strike',targetId:'foe0',point,normal:[0,0,1],part:'rightArm'});return t.snapshot().enemies[0]?.missingParts||[];};
assert.deepEqual(limb({}),[],'without the talent the arm survives one swing');
assert.deepEqual(limb({axe:['limbsplitter']}),['rightArm']);

// Whirlwind: full circle, more reach, quicker recharge; a foe behind the hero is caught.
assert.equal(cleaveSpec({talents:{axe:['whirlwind']}}),WHIRLWIND);assert.equal(cleaveSpec({}),AXE_CLEAVE);
assert.equal(specialCooldown('axe',{talents:{axe:['whirlwind']}}),300);assert.equal(specialCooldown('axe'),420);
s=fixture({xp:xpForLevel(2),talents:{axe:['whirlwind']},foes:[-2,AXE_CLEAVE.reach+.5]});
const spin=act(s,{action:'special'});assert.equal(spin.ok,true);
assert.equal(spin.events[0].arc,360);assert.equal(s.snapshot().enemies.length,0,'behind and beyond the old reach both fall');

// Firestorm: half the Phoenix Flare recharge.
assert.equal(specialCooldown('bow',{talents:{bow:['firestorm']}}),300);

// Golden Flock triples the golden chance (and lifts its ceiling).
assert.equal(siegebirdGoldenChance(0,true),SIEGEBIRD.goldenBase*3);
assert.equal(siegebirdGoldenChance(1e6,true),GOLDEN_FLOCK.max);assert.equal(siegebirdGoldenChance(1e6),SIEGEBIRD.goldenMax);

// Skewer: an ordinary bolt passes through up to three bodies, then sticks in the fourth.
s=fixture({tool:'crossbow',xp:xpForLevel(2),talents:{crossbow:['skewer']},foes:[4,5,6,7]});
const shot=act(s,{action:'fire',origin:[10,terrainHeight(s.checkpoint(),10,10)+1.4,10],direction:[0,0,-1]});
assert.equal(shot.ok,true);assert.equal(shot.events[0].skewer,true);
s.step();
const live=s.adventureWorld(),bolt=live.projectiles[0];assert.equal(bolt.skewer,true);
let pierced=0;
for(const e of [...live.enemies]){
  const point=[e.position[0],e.position[1]+1.15,e.position[2]];
  bolt.trail=[[point[0],point[1],point[2]+.5],[point[0],point[1],point[2]-.5]];
  const r=s.projectileContact({projectileId:bolt.id,targetId:e.id,part:'torso',point,normal:[0,0,1],localPoint:[0,0,0],localQuaternion:[0,0,0,1]});
  assert.equal(r.ok,true);if(r.events.some(q=>q.kind==='pierce'&&q.skewer))pierced++;
  if(!live.projectiles.includes(bolt))break;
}
assert.equal(pierced,3);assert.equal(live.projectiles.length,0,'the fourth body stops it');
loadSimulation(JSON.parse(JSON.stringify(s.checkpoint())));

// Ember Volley: a full draw looses three arrows.
s=fixture({tool:'bow',xp:xpForLevel(2),talents:{bow:['volley']}});
const volley=act(s,{action:'fire',origin:[10,terrainHeight(s.checkpoint(),10,10)+1.4,10],direction:[0,0,-1],draw:1});
assert.equal(volley.ok,true);assert.equal(volley.events[0].volley.length,2);assert.equal(s.adventureWorld().projectiles.length,3);
for(let i=0;i<40;i++)s.step();
const half=act(s,{action:'fire',origin:[10,terrainHeight(s.checkpoint(),10,10)+1.4,10],direction:[0,0,-1],draw:.5});
assert.equal(half.ok,true);assert.equal(half.events[0].volley,undefined,'a partial draw is a single arrow');

// Motherlode: a fresh seam breaks one strike sooner and pays double.
const mine=talents=>{const t=fixture({tool:'pick',xp:xpForLevel(2),talents});const c=t.checkpoint();
  const ore={id:'oreT',x:10,z:8.6,kind:'stone',hits:0,maxHits:3,depleted:false};c.deposits.push(ore);const u=loadSimulation(c);let strikes=0;
  const y=terrainHeight(c,10,8.6);
  while(!u.snapshot().deposits.find(d=>d.id==='oreT').depleted&&strikes<5){for(let i=0;i<30;i++)u.step();u.command('h',{type:'action',seq:10+strikes,action:'strike',targetId:'oreT',point:[10,y+.3,8.6],normal:[0,0,1]});strikes++;}
  return {strikes,amount:u.snapshot().pickups.filter(q=>Math.hypot(q.x-10,q.z-8.6)<.5).reduce((n,q)=>n+q.amount,0),xp:u.snapshot().players[0].xp};};
const plain=mine({}),rich=mine({pick:['motherlode']});
assert.equal(rich.strikes,plain.strikes-1);assert.equal(rich.amount,plain.amount*2);assert.ok(plain.xp>xpForLevel(2),'breaking ore grants XP');

// Firebomb: a lit flask bursts, hurts and throws every foe nearby.
s=fixture({tool:'flask',xp:xpForLevel(2),talents:{flask:['firebomb']},foes:[3,3.8]});
const world=s.adventureWorld(),ground=terrainHeight(world,10,7);
const events=fireContact(world,{id:'q1',kind:'fuel',lit:true,ownerId:'h'},{point:[10,ground,7],normal:[0,1,0],targetId:'terrain'},{terrainHeight,nextId:(st,p)=>`${p}${++st.idCounter}`});
const bomb=events.find(e=>e.kind==='firebomb');assert.ok(bomb&&bomb.hits.length===2&&bomb.radius===FIREBOMB.radius);
assert.ok(world.enemies.every(e=>e.hp<100&&e.burnUntil>world.tick),'foes burned');

// Geode Burst: the third wall replaces the first, which bursts and hurts a foe standing beside it.
s=fixture({tool:'pick',xp:xpForLevel(2),talents:{pick:['geode']},x:0,z:30});
const wall=yaw=>{const w=s.adventureWorld();w.players[0].yaw=yaw;for(let i=0;i<250;i++)s.step();return act(s,{action:'special'});};
assert.equal(wall(0).ok,true);
const first=s.adventureWorld().edits.filter(e=>e.kind==='pick_wall');assert.ok(first.length>0);
assert.equal(wall(Math.PI/2).ok,true);
for(let i=0;i<250;i++)s.step();
const w=s.adventureWorld(),seg=first[2],foe=createEnemy('geodeFoe',[seg.x+1.6,terrainHeight(w,seg.x+1.6,seg.z),seg.z]);w.enemies.push(foe);
w.players[0].yaw=Math.PI;const third=act(s,{action:'special'});assert.equal(third.ok,true);
const burst=third.events.find(e=>e.kind==='geode_burst');
assert.ok(burst&&burst.hits.includes('geodeFoe'),'burst catches the foe beside the replaced wall');
assert.ok((w.enemies.find(e=>e.id==='geodeFoe')?.hp??0)<100);

// Panel model: six weapons, every specialty learnable (Wyrmspout's arrived with its uplift).
const model=progressModel({xp:xpForLevel(3),talents:{pick:['geode']}});
assert.equal(model.level,3);assert.equal(model.points,1);assert.equal(model.weapons.length,6);
assert.equal(model.weapons.find(w=>w.id==='wyrmspout').talents.every(t=>t.ready),true);
assert.equal(model.weapons.find(w=>w.id==='pick').talents.find(t=>t.id==='geode').learned,true);
assert.ok(hasTalent({talents:{pick:['geode']}},'pick','geode'));
void grantXp;void projectileContact;
console.log('hero progress ok');
