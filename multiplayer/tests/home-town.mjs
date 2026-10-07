// The keep town (2026-10-07): Gold from battle kills, the Quartermaster's items, Healing Draughts, the Gold mill and
// the three taverns (sanctuaries with a Hearty Ale). Rules only; the view has its own checks.
import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {HOME,HOME_LAYOUT,NEUTRAL_TAVERN,homePiece,homePoint,pieceWorld,resolveHomeStructures} from '../shared/home-bases.js';
import {ITEMS,ITEM_SLOTS,itemBonus} from '../shared/hero-items.js';
import {SHOP,counterAt} from '../shared/home-shop.js';
import {MILL,millAt} from '../shared/home-mill.js';
import {TAVERN,insideTavern,taverns,tavernBar} from '../shared/taverns.js';
import {heroMaxHp} from '../shared/hero-progress.js';
import {createEnemy} from '../shared/combat.js';
import {HOME_MANNED} from '../shared/home-ballista.js';
let count=0;
function test(name,fn){fn();count++;console.log('PASS',name);}
let seq=0;const act=(sim,id,action,extra={})=>sim.command(id,{type:'action',action,seq:++seq,...extra});
const steps=(sim,n)=>{const ev=[];for(let i=0;i<n;i++)ev.push(...sim.step());return ev;};
const put=(w,p,[x,z])=>{p.position=[x,terrainHeight(w,x,z),z];p.vy=0;};
function rig(){
  const sim=createSimulation({seed:9});sim.addPlayer({id:'host'});sim.addPlayer({id:'foe'});const w=sim.adventureWorld();
  const [hero,foe]=w.players;hero.role=foe.role='hero';hero.side='party';foe.side='rivals';foe.name='Foe';
  put(w,hero,homePoint('party',[0,8]));put(w,foe,[0,20]);
  return {sim,w,hero,foe};
}

test('felling an enemy troop pays its killer Gold; wild monsters and allies pay nothing',()=>{
  const {sim,w,hero}=rig();
  const troop=createEnemy('battle1_1_rivals_0',[...hero.position],'golem');Object.assign(troop,{side:'rivals',battleRun:w.battle.run,battleWaypoint:0});w.enemies.push(troop);
  troop.hp=1;troop.parts.torso=1;troop.armor=0;hero.tool='axe';hero.attackTick=-999;hero.yaw=0;
  troop.position=[hero.position[0],hero.position[1],hero.position[2]-1.2];
  const r=act(sim,'host','strike',{targetId:troop.id,tool:'axe',part:'torso',point:[troop.position[0],troop.position[1]+1,troop.position[2]],normal:[0,0,1]});
  assert.equal(r.ok,true,r.code);const paid=r.events.find(e=>e.kind==='gold_earned');
  assert.equal(paid?.amount,SHOP.killGold.golem);assert.equal(hero.resources.gold,3);
  const wild=createEnemy('wild1',[hero.position[0],hero.position[1],hero.position[2]-1.2]);wild.hp=1;wild.parts.torso=1;w.enemies.push(wild);hero.attackTick=-999;w.tick+=60;
  const r2=act(sim,'host','strike',{targetId:'wild1',tool:'axe',part:'torso',point:[wild.position[0],wild.position[1]+1,wild.position[2]],normal:[0,0,1]});
  assert.equal(r2.ok,true,r2.code);assert.ok(!r2.events.some(e=>e.kind==='gold_earned'));assert.equal(hero.resources.gold,3);
});

test('the Quartermaster sells items for Gold at your own keep, six slots, no doubles, half back on a sale',()=>{
  const {sim,w,hero,foe}=rig();hero.resources.gold=100;
  assert.equal(act(sim,'host','homeShop',{buy:'breastplate'}).code,'too_far');
  const [x,z]=counterAt('party');put(w,hero,[x,z]);
  const r=act(sim,'host','homeShop',{buy:'breastplate'});assert.equal(r.ok,true,r.code);assert.equal(r.events[0].kind,'shop_buy');
  assert.equal(hero.resources.gold,100-ITEMS.breastplate.cost);assert.equal(heroMaxHp(hero),140);assert.equal(hero.hp,140,'new health arrives filled');
  assert.equal(act(sim,'host','homeShop',{buy:'breastplate'}).code,'already_owned');
  assert.equal(act(sim,'host','homeShop',{buy:'nonsense'}).code,'invalid_item');
  for(const id of ['boots','whetstone','kettle','purse','belt'])assert.equal(act(sim,'host','homeShop',{buy:id}).ok,true,id);
  assert.equal(hero.items.length,ITEM_SLOTS);assert.equal(act(sim,'host','homeShop',{buy:'charm'}).code,'slots_full');
  const gold=hero.resources.gold,s=act(sim,'host','homeShop',{sell:'breastplate'});assert.equal(s.ok,true,s.code);
  assert.equal(hero.resources.gold,gold+Math.floor(ITEMS.breastplate.cost/2));assert.equal(hero.hp,100);
  hero.resources.gold=1;assert.equal(act(sim,'host','homeShop',{buy:'locket'}).code,'not_enough_gold');
  put(w,foe,[x,z]);foe.resources.gold=99;assert.equal(act(sim,'foe','homeShop',{buy:'boots'}).code,'too_far','only your own keep');
  const back=loadSimulation(sim.checkpoint());assert.deepEqual(back.snapshot().players.find(p=>p.id==='host').items,hero.items,'items save');
});

test('items change the hero: damage, armour, speed, regen and lifesteal',()=>{
  const {sim,w,hero,foe}=rig();
  hero.items=['whetstone','charm','boots','kettle','leech','hat'];
  assert.ok(Math.abs(itemBonus(hero,'damage')-.15)<1e-9);
  // Armour: a 100-point blow lands as 85.
  put(w,hero,[0,20]);hero.hp=heroMaxHp(hero);foe.tool='axe';foe.attackTick=-999;put(w,foe,[0,21.2]);foe.yaw=0;hero.protectedUntil=0;
  const blow=act(sim,'foe','strike',{targetId:'host',tool:'axe',point:[0,1,20],normal:[0,0,1]});assert.equal(blow.ok,true,blow.code);
  assert.ok(Math.abs(heroMaxHp(hero)-hero.hp-22*.85)<1e-6,`armour ${heroMaxHp(hero)-hero.hp}`);
  // Lifesteal: a 30-point hit on a troop heals 3.
  const troop=createEnemy('battle1_1_rivals_9',[hero.position[0],hero.position[1],hero.position[2]-1.2]);Object.assign(troop,{side:'rivals',battleRun:w.battle.run,battleWaypoint:0});w.enemies.push(troop);
  hero.hp=50;hero.attackTick=-999;hero.tool='axe';hero.yaw=0;w.tick+=60;
  const hit=act(sim,'host','strike',{targetId:troop.id,tool:'axe',part:'torso',point:[troop.position[0],troop.position[1]+1,troop.position[2]],normal:[0,0,1]});assert.equal(hit.ok,true,hit.code);
  const dealt=hit.events.find(e=>e.kind==='hit'&&e.id===troop.id).damage;assert.ok(Math.abs(hero.hp-50-dealt*.1)<1e-6,`leech ${hero.hp}`);
  // Speed: a held move covers 15% more ground.
  const {sim:s2,w:w2,hero:h2}=rig();put(w2,h2,[0,20]);const run=sim2=>{const at=[...sim2.adventureWorld().players[0].position];for(let i=0;i<30;i++){sim2.command('host',{type:'input',seq:++seq,move:{x:0,z:1},yaw:0});sim2.step();}const p=sim2.adventureWorld().players[0].position;return Math.hypot(p[0]-at[0],p[2]-at[2]);};
  const plain=run(s2);const {sim:s3,w:w3,hero:h3}=rig();put(w3,h3,[0,20]);h3.items=['boots'];const quick=run(s3);
  assert.ok(quick>plain*1.12,`boots ${quick} vs ${plain}`);
  // Regen: the kettle mends 2 a second.
  hero.hp=50;put(w,hero,[-6,-12]);put(w,foe,[30,30]);w.enemies.length=0;const ev=steps(sim,60);if(hero.hp<51)console.log(JSON.stringify(ev.filter(e=>e.id==='host'||e.targetId==='host')).slice(0,600));assert.ok(hero.hp>=51.9&&hero.hp<=54,`kettle ${hero.hp}`);
});

test('the healing well heals and fills a draught; a draught heals anywhere, two with a Draught Belt',()=>{
  const {sim,w,hero}=rig();const [x,z]=homePoint('party',HOME_LAYOUT.fountain);put(w,hero,[x+3,z]);hero.hp=30;
  const r=act(sim,'host','homeDrink');assert.equal(r.ok,true,r.code);assert.equal(hero.hp,70);assert.equal(hero.draughts,1);assert.equal(r.events[0].filled,1);
  assert.equal(act(sim,'host','homeDrink').code,'cooldown','each hero rests between drinks');
  put(w,hero,[-6,-12]);hero.hp=20;const d=act(sim,'host','drinkDraught');assert.equal(d.ok,true,d.code);assert.equal(hero.hp,20+SHOP.draught.heal);assert.equal(hero.draughts,0);
  assert.equal(act(sim,'host','drinkDraught').code,'no_draught');
  hero.items=['belt'];w.tick+=HOME.drink.cooldown;put(w,hero,[x+3,z]);act(sim,'host','homeDrink');assert.equal(hero.draughts,2);
  assert.equal(loadSimulation(sim.checkpoint()).snapshot().players.find(p=>p.id==='host').draughts,2,'draughts save');
});

test('the Gold mill grinds gold ore, copper ore and stone into coins for whoever fed it; cranking grinds faster',()=>{
  const {sim,w,hero,foe}=rig();Object.assign(hero.resources,{goldOre:3,copperOre:2,stone:9,iron:5});
  assert.equal(act(sim,'host','millFeed').code,'too_far');
  put(w,hero,millAt('party',[MILL.hopper[0],MILL.hopper[1]+1.2]));
  const r=act(sim,'host','millFeed');assert.equal(r.ok,true,r.code);
  assert.equal(r.events[0].gold,3*2+2+2);assert.deepEqual([hero.resources.goldOre,hero.resources.copperOre,hero.resources.stone,hero.resources.iron],[0,0,1,5],'stone grinds in fours; iron is kept');
  assert.equal(act(sim,'host','millFeed').code,'nothing_to_mill');
  const coins=steps(sim,MILL.coinTicks*2+1).filter(e=>e.kind==='mill_coin');assert.equal(coins.length,2);assert.equal(hero.resources.gold,2);
  const save=loadSimulation(sim.checkpoint());assert.deepEqual(save.snapshot().battle.bases[0].mill,w.battle.bases[0].mill,'the mill saves');
  put(w,hero,millAt('party',[MILL.crank[0],MILL.crank[1]+1]));
  let cranked=0;for(let i=0;i<MILL.coinTicks;i++){if(i%6===0)assert.equal(act(sim,'host','millCrank').ok,true);cranked+=sim.step().filter(e=>e.kind==='mill_coin').length;}
  assert.ok(cranked>=2,`cranked ${cranked}`);
  put(w,foe,millAt('rivals',[MILL.hopper[0],MILL.hopper[1]+1.2]));foe.resources.goldOre=1;assert.equal(act(sim,'foe','millFeed').ok,true,'each keep has its own mill');
});

test('taverns are sanctuaries: no harm in, no harm out, monsters shooed, slow mending and a Hearty Ale',()=>{
  const {sim,w,hero,foe}=rig();assert.equal(taverns(w).length,3);
  const mug=taverns(w).find(t=>t.side==='neutral');const inside=pieceWorld(mug.placed,[0,1]);
  assert.ok(insideTavern(w,[inside[0],0,inside[1]]));assert.ok(!insideTavern(w,[NEUTRAL_TAVERN.at[0]+15,0,NEUTRAL_TAVERN.at[1]]));
  // No harm in: a rival's axe does nothing to a hero inside.
  put(w,hero,inside);hero.hp=50;hero.protectedUntil=0;put(w,foe,pieceWorld(mug.placed,[0,2.2]));foe.yaw=Math.atan2(foe.position[0]-hero.position[0],foe.position[2]-hero.position[2]);foe.tool='axe';foe.attackTick=-999;
  act(sim,'foe','strike',{targetId:'host',tool:'axe',point:[hero.position[0],hero.position[1]+1,hero.position[2]],normal:[0,0,1]});assert.equal(hero.hp,50);
  // No harm out: from inside, the hero cannot strike the rival.
  foe.hp=100;foe.protectedUntil=0;hero.tool='axe';hero.attackTick=-999;hero.yaw=Math.atan2(hero.position[0]-foe.position[0],hero.position[2]-foe.position[2]);
  const out=act(sim,'host','strike',{targetId:'foe',tool:'axe',point:[foe.position[0],foe.position[1]+1,foe.position[2]],normal:[0,0,1]});assert.equal(foe.hp,100,out.code);
  // Monsters are shooed out of the door.
  const monster=createEnemy('wanderer',[inside[0],hero.position[1],inside[1]]);w.enemies.push(monster);sim.step();assert.ok(!insideTavern(w,monster.position),'shooed');
  // Mending: about 3 health a second.
  put(w,foe,[-6,-12]);const hp=hero.hp;steps(sim,60);assert.ok(hero.hp-hp>=2&&hero.hp-hp<=4,`mended ${hero.hp-hp}`);
  // The Hearty Ale: full health, then 20% less damage for three minutes.
  assert.equal(act(sim,'host','tavernAle').code,'too_far');
  put(w,hero,tavernBar(mug).map((v,i)=>v+(i?1.2*Math.cos(mug.placed.yaw):1.2*Math.sin(mug.placed.yaw))));
  const ale=act(sim,'host','tavernAle');assert.equal(ale.ok,true,ale.code);assert.equal(hero.hp,heroMaxHp(hero));assert.equal(hero.heartyUntil,w.tick+TAVERN.aleTicks);
  assert.equal(act(sim,'host','tavernAle').code,'cooldown');
  assert.equal(loadSimulation(sim.checkpoint()).snapshot().players.find(p=>p.id==='host').heartyUntil,hero.heartyUntil,'the ale saves');
});

test('nobody walks through the tavern walls, the shop stall or the mill; you walk into a tavern through its front',()=>{
  const {w}=rig();
  for(const [name,local] of [['quartermaster',[0,0]],['mill',[0,0]],['tavern',[0,-3]]]){const p=pieceWorld(homePiece('party',name),local),q=resolveHomeStructures(w,[p[0]+.01,0,p[1]]);assert.ok(Math.hypot(q[0]-p[0],q[2]-p[1])>.2,name);}
  const t=homePiece('party','tavern'),door=pieceWorld(t,[0,1]),q=resolveHomeStructures(w,[door[0],0,door[1]]);assert.ok(Math.hypot(q[0]-door[0],q[2]-door[1])<1e-6,'the hall floor is open');
  const mug={x:NEUTRAL_TAVERN.at[0],z:NEUTRAL_TAVERN.at[1],yaw:NEUTRAL_TAVERN.yaw},bar=pieceWorld(mug,[0,-2.9]),qb=resolveHomeStructures(w,[bar[0],0,bar[1]]);assert.ok(Math.hypot(qb[0]-bar[0],qb[2]-bar[1])>.2,'the Mug\'s bar is solid');
});

test('older saves load: the well\'s base cooldown, no items, no mill',()=>{
  const {sim,w}=rig();w.battle.bases[0].drinkReadyTick=w.tick+1100;const save=sim.checkpoint();
  for(const p of save.players){delete p.items;delete p.draughts;}for(const b of save.battle.bases)delete b.mill;
  const back=loadSimulation(save);assert.deepEqual(back.snapshot().players.map(p=>p.items),[[],[]]);
});

test('the Ballista Captain\'s Hat halves a crewed keep ballista\'s reload and adds half again to its shot',()=>{
  const fire=hat=>{
    const {sim,w,hero}=rig();const part=w.battle.bases[0].parts.find(p=>p.id==='battle-base-party-ballista-0');
    hero.items=hat?['hat']:[];hero.position=[part.position[0]+1,part.position[1],part.position[2]];
    assert.equal(act(sim,'host','inventionMount',{structureId:part.id}).ok,true);part.readyTick=0;
    act(sim,'host','inventionDraw',{structureId:part.id});steps(sim,10);
    const r=act(sim,'host','inventionUse',{structureId:part.id,aim:{yaw:0,pitch:0}});assert.equal(r.ok,true,r.code);
    return {reload:part.readyTick-w.tick,power:w.battle.keepShots.at(-1).power||1};
  };
  const plain=fire(false),capped=fire(true);
  assert.equal(plain.reload,HOME_MANNED.reloadTicks);assert.equal(plain.power,1);
  assert.equal(capped.reload,HOME_MANNED.reloadTicks/2);assert.equal(capped.power,1.5);
});

console.log(JSON.stringify({suite:'home-town',ok:true,checks:count}));
