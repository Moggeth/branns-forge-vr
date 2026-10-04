import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createSimulation,loadSimulation,MAX_PLAYERS,terrainHeight} from '../shared/simulation.js';
import {BATTLE,stepBattle,damageBattleBase,battleBot,enemyHostileTo} from '../shared/battle-mode.js';
import {createEnemy,hitEnemyPart} from '../shared/combat.js';
import {stepEnemies} from '../shared/enemy-behaviour.js';
const start=performance.now();let count=0;
function test(name,fn){fn();count++;console.log('PASS',name);}
function rig(){const sim=createSimulation({legacyBattle:true,seed:4});sim.addPlayer({id:'host'});let seq=0;return {sim,w:sim.adventureWorld(),command:(action,extra={})=>sim.command('host',{type:'battle',action,seq:++seq,...extra})};}
const ctx={createEnemy,terrainHeight,nextId:(s,p)=>p+(++s.idCounter)};

test('32 human seats plus bounded deterministic paired skeleton waves',()=>{
 const r=rig();for(let n=1;n<32;n++)assert.equal(r.sim.addPlayer({id:'h'+n}).ok,true);assert.equal(MAX_PLAYERS,32);assert.equal(r.sim.addPlayer({id:'extra'}).code,'room_full');
 assert.equal(r.command('start').ok,true);for(let n=0;n<12;n++){r.w.tick=n*BATTLE.waveTicks;stepBattle(r.w,ctx,[]);}
 assert.equal(r.w.enemies.length,32);for(const side of ['party','rivals'])assert.equal(r.w.enemies.filter(e=>e.side===side).length,16);
 const saved=r.sim.checkpoint(),restored=loadSimulation(saved);assert.deepEqual(restored.snapshot().battle,r.sim.snapshot().battle);assert.deepEqual(restored.snapshot().enemies,r.sim.snapshot().enemies);
 r.sim.step();restored.step();assert.deepEqual(restored.snapshot().enemies,r.sim.snapshot().enemies);assert.deepEqual(restored.snapshot().battle,r.sim.snapshot().battle);
});

test('scarce world capacity reserves matched pairs',()=>{for(const count of [62,63]){const r=rig();r.w.enemies=Array.from({length:count},(_,n)=>createEnemy('neutral'+n,[n%10,0,20]));r.command('start');stepBattle(r.w,ctx,[]);assert.equal(r.w.enemies.filter(battleBot).length,count===62?2:0);assert.equal(r.w.enemies.filter(e=>e.side==='party').length,r.w.enemies.filter(e=>e.side==='rivals').length);}});

test('opposing bots commit and exchange simultaneous hits; friends are ignored',()=>{
 const r=rig();r.command('start');r.w.players[0].position=[50,0,50];r.w.tick=1000;
 const a=Object.assign(createEnemy('battle1_1_party_0',[25,0,0]),{side:'party',battleRun:1,battleWaypoint:2,yaw:Math.PI});
 const b=Object.assign(createEnemy('battle1_1_rivals_0',[25,0,1.6]),{side:'rivals',battleRun:1,battleWaypoint:3,yaw:0});
 const friend=Object.assign(createEnemy('battle1_1_party_1',[24,0,0]),{side:'party',battleRun:1,battleWaypoint:2});r.w.enemies=[a,b,friend];
 const step=()=>stepEnemies(r.w,{ground:()=>0,resolve:p=>p,events:[],damageHero:()=>assert.fail('must not strike distant hero'),damageEnemy:(e,n)=>hitEnemyPart(r.w,e,'torso',n,{side:e.side==='party'?'rivals':'party'},ctx,[])});
 step();assert.equal(a.attackTarget,b.id);assert.equal(b.attackTarget,a.id);const hp=[a.hp,b.hp];r.w.tick+=18;step();assert.equal(a.hp,hp[0]-10);assert.equal(b.hp,hp[1]-10);assert.ok(friend.hp>0);
});

test('friendly human melee and shared damage preserve allied bots',()=>{
 const r=rig();r.command('start');r.sim.step();const e=r.w.enemies.find(e=>e.side==='party'),p=r.w.players[0];p.position=[e.position[0],e.position[1],e.position[2]+1.5];p.yaw=0;const hp=e.hp;
 assert.equal(hitEnemyPart(r.w,e,'torso',90,{ownerId:p.id},ctx,[]),false);assert.equal(e.hp,hp);assert.equal(enemyHostileTo(e,'party'),false);assert.equal(enemyHostileTo(createEnemy('neutral',[0,0,0]),'party'),true);
 const result=r.sim.command(p.id,{type:'action',action:'strike',seq:2});assert.equal(result.ok,true);assert.equal(e.hp,hp);
});

test('normal melee base strikes, victory cleanup, reset and stop preserve neutral content',()=>{
 const r=rig();const neutral=createEnemy('neutral',[10,0,10]);r.w.enemies.push(neutral);r.command('start');r.sim.step();const b=r.w.battle.bases[1],p=r.w.players[0];p.position=[b.position[0],b.position[1],b.position[2]+2];p.yaw=0;
 assert.equal(r.sim.command('host',{type:'action',action:'strike',seq:2,targetId:b.id,point:[...b.position],normal:[0,1,0]}).ok,true);assert.equal(b.hp,375);
 assert.equal(damageBattleBase(r.w,b.id,100,'rivals',[]),false);damageBattleBase(r.w,b.id,375,'party',[]);assert.equal(r.w.battle.status,'victory');assert.equal(r.w.battle.winner,'party');assert.deepEqual(r.w.enemies,[neutral]);loadSimulation(r.sim.checkpoint());
 assert.equal(r.sim.command('host',{type:'battle',action:'reset',seq:3}).ok,true);assert.equal(r.w.battle.run,2);r.sim.step();assert.ok(r.w.enemies.some(battleBot));assert.equal(r.sim.command('host',{type:'battle',action:'stop',seq:4}).ok,true);assert.deepEqual(r.w.enemies,[neutral]);assert.equal(r.w.battle.status,'off');loadSimulation(r.sim.checkpoint());
});

test('invalid commands and Expedition conflict do not mutate battle',()=>{
 const r=rig();assert.equal(r.command('wat').code,'invalid_battle_action');assert.equal(r.command('reset').code,'battle_inactive');r.w.adventure.stage='camp';assert.equal(r.command('start').code,'expedition_active');r.w.adventure.stage='idle';assert.equal(r.command('start').ok,true);assert.equal(r.command('start').code,'battle_active');assert.equal(r.command('attack_base',{targetId:'fake'}).code,'invalid_battle_target');assert.equal(r.sim.command('host',{type:'adventure',action:'start',seq:20}).code,'battle_active');assert.equal(r.sim.command('host',{type:'battle',action:'stop',seq:0}).code,'invalid_sequence');
});

test('restore rejects malformed teams, bot ownership, objectives, caps and duplicate victory',()=>{
 const r=rig();r.command('start');r.sim.step();const saved=r.sim.checkpoint();
 for(const mutate of [s=>s.battle.bases[0].hp=NaN,s=>s.battle.bases[0].position[0]=0,s=>s.enemies[0].side='neutral',s=>s.enemies[0].battleRun=3,s=>s.enemies[0].battleWaypoint=10,s=>s.battle.status='off',s=>s.battle.nextWaveTick=s.tick+901,s=>s.battle.winner='party',s=>s.adventure.stage='camp']){const bad=structuredClone(saved);mutate(bad);assert.throws(()=>loadSimulation(bad));}
 const legacy=rig().sim.checkpoint();delete legacy.battle;assert.equal(loadSimulation(legacy).snapshot().battle.status,'off');
});

test('battle stop removes only battle remains and attached arrows',()=>{
 const r=rig();r.command('start');r.sim.step();const e=r.w.enemies[0];hitEnemyPart(r.w,e,'torso',999,{side:e.side==='party'?'rivals':'party'},{...ctx,nextId:(s,p)=>p+(++s.idCounter)},[]);assert.ok(r.w.detachedParts.some(d=>d.sourceId===e.id));assert.equal(r.command('stop').ok,true);assert.ok(!r.w.detachedParts.some(d=>d.sourceId===e.id));loadSimulation(r.sim.checkpoint());
});

test('actual projectile path damages opposing base and respects friendly ownership',()=>{
 const r=rig();r.command('start');const p=r.w.players[0],base=r.w.battle.bases[1];p.position=[40,base.position[1],43];p.yaw=0;
 assert.equal(r.sim.command('host',{type:'action',action:'equip',tool:'crossbow',seq:2}).ok,true);
 assert.equal(r.sim.command('host',{type:'action',action:'fire',seq:3,origin:[40,base.position[1]+1,43],direction:[0,0,-1]}).ok,true);
 for(let n=0;n<5;n++)r.sim.step();const shot=r.w.projectiles[0],point=[40,base.position[1]+1,40];
 assert.equal(loadSimulation(r.sim.checkpoint()).snapshot().projectiles[0].side,'party');r.sim.removePlayer('host');assert.equal(r.sim.projectileContact({projectileId:shot.id,targetId:base.id,part:'torso',point,normal:[0,0,1],localPoint:[0,1,0],localQuaternion:[0,0,0,1]}).ok,true);assert.equal(base.hp,352);assert.equal(r.w.projectiles.length,0);loadSimulation(r.sim.checkpoint());
});

test('live authored world routes waves into combat and a base victory',()=>{
 const r=rig();r.w.players[0].role='god';r.command('start');let hits=0;const begun=performance.now();
 for(let n=0;n<12000&&r.w.battle.status==='running';n++){hits+=r.sim.step().filter(e=>e.kind==='hit'&&e.id?.startsWith('battle')).length;if(n===500){const twin=loadSimulation(r.sim.checkpoint());for(let t=0;t<90;t++){r.sim.step();twin.step();}assert.deepEqual(r.sim.snapshot().battle,twin.snapshot().battle);assert.deepEqual(r.sim.snapshot().enemies,twin.snapshot().enemies);}}
 assert.ok(hits>100);assert.equal(r.w.battle.status,'victory');assert.ok(!r.w.enemies.some(battleBot));loadSimulation(r.sim.checkpoint());console.log('Live battle seconds:',((performance.now()-begun)/1000).toFixed(3));
});


test('God healing, wards, offensive spells and battle respawns honor sides',()=>{
 const r=rig();r.command('start');r.sim.step();r.w.bloom=999;const p=r.w.players[0];p.role='god';
 const ally=r.w.enemies.find(e=>e.side==='party'),foe=r.w.enemies.find(e=>e.side==='rivals');ally.position=[30,0,0];foe.position=[30,0,1];ally.hp=50;foe.hp=50;
 let seq=10;const cast=spell=>{p.castTick=-1000;p.mana=100;return r.sim.command(p.id,{type:'cast',spell,point:[30,0,0],seq:++seq});};
 assert.equal(cast('heal').ok,true);assert.equal(ally.hp,90);assert.equal(foe.hp,50);assert.equal(cast('quake').ok,true);assert.equal(ally.hp,90);assert.equal(foe.hp,20);assert.equal(ally.slowUntil,undefined);assert.ok(foe.slowUntil>r.w.tick);
 r.w.inventions.structures.push({id:'testWard',type:'ward',side:'party',position:[30,0,0],hp:100,charge:100});assert.equal(hitEnemyPart(r.w,ally,'torso',50,{side:'rivals'},ctx,[]),false);assert.equal(ally.hp,90);r.w.inventions.structures.pop();
 const enemyBase=r.w.battle.bases[1];p.mana=100;p.castTick=-1000;assert.equal(r.sim.command(p.id,{type:'cast',spell:'lightning',point:[...enemyBase.position],seq:++seq}).ok,true);assert.equal(enemyBase.hp,335);
 p.role='hero';p.side='rivals';p.position=[30,terrainHeight(r.w,30,0),0];p.hp=1;const neutral=createEnemy('respawn-check',[30,p.position[1],1.6]);neutral.attackTick=r.w.tick-17;neutral.attackTarget=p.id;neutral.yaw=0;r.w.enemies=[neutral];r.sim.step();assert.equal(p.hp,100);assert.ok(Math.hypot(p.position[0]-40,p.position[2]-40)<15);loadSimulation(r.sim.checkpoint());
});


test('axe cleave excludes allied bot damage, knockback and hit feedback',()=>{
 const r=rig();r.command('start');r.sim.step();const p=r.w.players[0],ally=r.w.enemies.find(e=>e.side==='party'),foe=r.w.enemies.find(e=>e.side==='rivals');p.position=[30,0,4];p.yaw=0;ally.position=[30,0,1];foe.position=[31,0,1];const original=structuredClone(ally);
 const result=r.sim.command('host',{type:'action',action:'special',seq:2});assert.equal(result.ok,true);assert.deepEqual(ally,original);assert.ok(!result.events.find(e=>e.kind==='axe_cleave').hits.includes(ally.id));assert.ok(result.events.find(e=>e.kind==='axe_cleave').hits.includes(foe.id));
 assert.equal(hitEnemyPart(r.w,ally,'torso',50,{ownerId:'departed'},ctx,[]),false);assert.equal(ally.hp,original.hp,'unknown legacy delayed owner cannot bypass faction protection');
});

console.log(`${count} battle mode tests passed in ${((performance.now()-start)/1000).toFixed(3)}s`);
