import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {HEARTSTONE,heartstoneLevel} from '../shared/heartstone.js';
import {BLOOM} from '../shared/bloom.js';

const sim=createSimulation({seed:37});sim.addPlayer({id:'hero',role:'hero'});sim.addPlayer({id:'rival',role:'hero'});
const w=sim.adventureWorld(),[hero,rival]=w.players;rival.side='rivals';w.enemies=[];
const stone=w.inventions.structures.find(b=>b.id==='party-influence'),theirs=w.inventions.structures.find(b=>b.id==='rival-influence');
const at=(p,b,d)=>{p.position=[b.position[0]+d,terrainHeight(w,b.position[0]+d,b.position[2]),b.position[2]];};
const pulse=()=>{const t=w.tick;while(w.tick-t<HEARTSTONE.every)sim.step();};

// Near your own Heartstone you mend; the rival's stone does nothing for you, and range matters.
at(hero,stone,3);at(rival,stone,3);hero.hp=50;hero.mana=20;rival.hp=50;
pulse();assert.ok(hero.hp>50&&hero.mana>20,'own side heals');assert.equal(rival.hp,50,'other side does not');
const perPulse=hero.hp-50;assert.equal(perPulse,HEARTSTONE.hp[0]);
at(hero,stone,HEARTSTONE.reach+0.5);const out=hero.hp;pulse();assert.equal(hero.hp,out,'out of reach');
at(rival,theirs,2);rival.hp=50;pulse();assert.ok(rival.hp>50,'rivals heal at their own stone');

// Bloom strengthens the pulse.
at(hero,stone,2);hero.hp=40;w.bloom=BLOOM.levels[2];assert.equal(heartstoneLevel(w),3);pulse();assert.equal(hero.hp,40+HEARTSTONE.hp[3]);
// Capped at full.
hero.hp=99.9;hero.mana=99.9;pulse();assert.equal(hero.hp,100);assert.equal(hero.mana,100);
// A broken Heartstone is silent.
stone.hp=0;hero.hp=40;pulse();assert.equal(hero.hp,40,'broken stone does not heal');
// Gods are never touched; the structure state still saves as before.
stone.hp=180;sim.addPlayer({id:'god',role:'god'});const god=w.players.find(p=>p.id==='god');at(god,stone,1);const gh=god.hp;pulse();assert.equal(god.hp,gh);
assert.ok(loadSimulation(sim.checkpoint()));
console.log('PASS: Heartstones mend their own side in reach, scale with Bloom, cap at full, fall silent when broken.');
