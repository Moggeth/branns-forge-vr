import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {addFuel,applyHeat,quenchFire,stepFire,restoreFire,FIRE_LIMITS} from '../shared/fire.js';
import {createWeaponController} from '../client/weapon-controller.js';
import {WYRMSPOUT,sprayTuning} from '../shared/wyrmspout.js';
const begin=performance.now(),advance=(s,n)=>{for(let i=0;i<n;i++)s.step();};
let seq=0;const action=(s,action,rest={})=>s.command('h',{type:'action',seq:++seq,action,...rest});
const make=()=>{const s=createSimulation({legacyBattle:true,legacyBattle:true});s.addPlayer({id:'h'});return s;};
let s=make();assert.equal(action(s,'equip',{tool:'wyrmspout'}).ok,true);
const origin=[0,1.5,8],direction=[0,0,-1];
// Wyrmspout tank: 21 globs empty it (1.75 s at 12 per second); an empty tank locks for 3 s while it refills.
assert.equal(action(s,'flame',{origin,direction}).ok,true);
assert.equal(action(s,'flame',{origin,direction}).code,'cooldown');
for(let i=1;i<WYRMSPOUT.globs;i++){advance(s,5);assert.equal(action(s,'flame',{origin,direction}).ok,true,`glob ${i}`);}
assert.equal(s.snapshot().players[0].heat,1);assert.ok(s.snapshot().players[0].overheatUntil>s.snapshot().tick);
assert.equal(action(s,'special',{origin,direction}).code,'overheated');assert.equal(action(s,'flame',{origin,direction}).code,'overheated');
advance(s,WYRMSPOUT.refillTicks);assert.equal(s.snapshot().players[0].heat,0);assert.equal(action(s,'flame',{origin,direction}).ok,true);
// Letting go early refills after a short pause.
const early=s.snapshot().players[0].heat;advance(s,WYRMSPOUT.refillDelay);assert.equal(s.snapshot().players[0].heat,early);advance(s,20);assert.ok(s.snapshot().players[0].heat<early);
// Gout: a lobbed splash that costs part of the tank and has its own cooldown.
assert.equal(action(s,'special',{origin,direction}).ok,true);assert.ok(s.snapshot().projectiles.at(-1).gout);assert.ok(s.snapshot().players[0].heat>=WYRMSPOUT.gout.cost);
advance(s,5);assert.equal(action(s,'special',{origin,direction}).code,'cooldown');
// Wyrmflood: a longer burst with more globs that reach further.
{const base=sprayTuning({}),flood=sprayTuning({talents:{wyrmspout:['flood']}});assert.ok(flood.burstTicks>=base.burstTicks*1.45&&flood.globs>base.globs&&flood.speed>base.speed&&flood.lifeTicks>base.lifeTicks);
 const cling=sprayTuning({talents:{wyrmspout:['cling']}});assert.equal(cling.burnTicks,base.burnTicks*2);assert.ok(cling.burnTicks<=240);}
// Only host-validated swept contacts ignite; flame packets do not become arrows.
s=make();action(s,'equip',{tool:'wyrmspout'});action(s,'flame',{origin:[0,.3,8],direction:[0,-1,0]});advance(s,2);
const q=s.snapshot().projectiles[0],point=q.position;
const contact={projectileId:q.id,targetId:'world',part:'torso',point,normal:[0,1,0],localPoint:point,localQuaternion:[0,0,0,1]};
assert.equal(s.projectileContact({...contact,point:[40,0,40]}).ok,false);
assert.equal(s.projectileContact(contact).ok,true);assert.equal(s.snapshot().embeds.length,0);assert.ok(s.snapshot().fireCells.some(c=>c.burning));
// Emberdew supports unlit fuel and lit throws; all state round-trips deterministically.
action(s,'equip',{tool:'flask'});advance(s,60);action(s,'special');assert.equal(s.snapshot().players[0].flaskLit,true);
assert.equal(action(s,'pour',{origin,direction}).ok,true);assert.equal(s.snapshot().projectiles.at(-1).kind,'fuel');assert.equal(s.snapshot().projectiles.at(-1).lit,true);
let restored=loadSimulation(s.checkpoint());assert.deepEqual(restored.snapshot(),s.snapshot());advance(s,120);advance(restored,120);assert.deepEqual(s.snapshot(),restored.snapshot());
const state={tick:0,fireCells:[],fireSurfaces:[],players:[],enemies:[],shrine:{hp:0}},ctx={terrainHeight:()=>0,damageEnemy:()=>{},damageHero:()=>{}};
addFuel(state,[10,0,10],1.5,.8);applyHeat(state,[10,0,10],.1,1,ctx);assert.equal(state.fireCells.filter(c=>c.burning).length,1);
for(let i=0;i<30;i++){state.tick++;stepFire(state,ctx,[]);}assert.ok(state.fireCells.filter(c=>c.burning).length>1,'heat spreads across connected fuel');
quenchFire(state,[10,0,10],3);applyHeat(state,[10,0,10],3,1,ctx);assert.ok(state.fireCells.every(c=>!c.burning),'wet fire stays quenched');
state.tick+=300;applyHeat(state,[10,0,10],3,1,ctx);assert.ok(state.fireCells.some(c=>c.burning));
let enemyHits=0,heroHits=0;state.enemies=[{position:[10,0,10]}];state.players=[{role:'hero',position:[10,0,10]}];state.tick=360;
stepFire(state,{...ctx,damageEnemy:()=>enemyHits++,damageHero:()=>heroHits++},[]);assert.equal(enemyHits,1);assert.equal(heroHits,1);
for(let x=-50;x<50;x+=2)addFuel(state,[x,0,0],4,1,true);assert.equal(state.fireCells.length,FIRE_LIMITS.cells);
const save=s.checkpoint();for(const corrupt of [c=>c.fireCells[0].fuel=NaN,c=>c.fireCells.push({...c.fireCells[0]}),c=>c.players[0].heat=3,c=>c.fireCells=Array(257).fill(c.fireCells[0])]){const c=structuredClone(save);corrupt(c);assert.throws(()=>loadSimulation(c));}
const old=make().checkpoint();delete old.fireCells;delete old.fireSurfaces;assert.deepEqual(loadSimulation(old).snapshot().fireCells,[]);
// Held input is bounded, stops on release/cancel, and never emits while overheated.
let now=0,tool='wyrmspout',hot=false,count=0,pours=0;
const control=createWeaponController({getTool:()=>tool,getAim:()=>({origin,direction}),clock:()=>now,fire:()=>{},special:()=>{},emitFlame:()=>count++,pourFuel:()=>pours++,canFlame:()=>!hot});
control.begin();for(now=1;now<=1000;now++)control.tick();assert.equal(count,10);hot=true;now+=200;control.tick();assert.equal(count,10);hot=false;control.end();now+=200;control.tick();assert.equal(count,10);control.begin();control.cancel();now+=200;control.tick();assert.equal(count,11);tool='flask';control.begin();control.end();assert.equal(pours,1);
console.log(`fire: ignition, quenching, rate/heat limits, contact authority, save/replay and controls pass (${((performance.now()-begin)/1000).toFixed(3)} s)`);
