import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {GEODES,GEODE_RULES} from '../shared/geode-outcrop.js';
import {resolveStartingWorld} from '../shared/starting-world.js';

const sim=createSimulation({seed:29});sim.addPlayer({id:'hero',role:'hero'});
const w=sim.adventureWorld(),hero=w.players[0];let seq=0;w.pickups=[];
// Stand as close as the outcrop's collision allows, facing the cluster.
function approach(g){let best=null;
 for(let k=0;k<32;k++){const a=k/32*Math.PI*2;for(let d=6;d>.5;d-=.05){const x=g.x+Math.cos(a)*d,z=g.z+Math.sin(a)*d,q=[x,terrainHeight(w,x,z),z],r=[...q];resolveStartingWorld(r,(x,z)=>terrainHeight(w,x,z));if(Math.hypot(r[0]-x,r[2]-z)>1e-6)break;if(!best||d<best.d)best={d,x,z};}}
 hero.position=[best.x,terrainHeight(w,best.x,best.z),best.z];hero.yaw=Math.atan2(-(g.x-best.x),-(g.z-best.z));return best.d;}
const strike=(g,tool='pick')=>{hero.tool=tool;w.tick+=40;const y=terrainHeight(w,g.x,g.z)+g.lift+g.size*.4;
 return sim.command('hero',{type:'action',action:'strike',seq:++seq,targetId:g.id,tool,point:[g.x+.3,y,g.z],normal:[1,0,0]});};

const old=sim.checkpoint();assert.equal(old.geodes,undefined);assert.equal(loadSimulation(old).snapshot().geodes,undefined,'old saves load untouched');
for(const g of GEODES){const d=approach(g);console.log(g.id,'closest',d.toFixed(2));assert.ok(d<=GEODE_RULES.reach-.3,`${g.id} is reachable`);}

const g=GEODES[0];approach(g);
assert.deepEqual(strike(g,'axe').events,[],'only the pick cracks crystal');
for(let k=1;k<g.maxHits;k++){const r=strike(g);assert.equal(r.ok,true);assert.ok(r.events.some(e=>e.kind==='geode_crack'&&e.hits===k));}
assert.equal(loadSimulation(sim.checkpoint()).snapshot().geodes[0].hits,g.maxHits-1,'cracks survive save/load');
const broke=strike(g);assert.ok(broke.events.some(e=>e.kind==='geode_break'&&e.amount===g.yield));
const gem=w.pickups.find(p=>p.kind==='gems');assert.ok(gem&&gem.amount===g.yield,'Crystal drops');assert.ok(Math.hypot(gem.x-hero.position[0],gem.z-hero.position[2])<2,'drop lands by the miner');
assert.deepEqual(strike(g).events,[],'a broken cluster cannot be mined while it regrows');
// Regrows on time with a chime, then mines again.
w.tick=w.geodes[0].regrowTick-1;assert.ok(sim.step().some(e=>e.kind==='geode_regrown'&&e.index===0));
assert.ok(strike(g).events.some(e=>e.kind==='geode_crack'&&e.hits===1));
// Too far away does nothing; world pickup cap is reported.
hero.position=[0,terrainHeight(w,0,8),8];assert.deepEqual(strike(GEODES[4]).events,[]);
const s=GEODES[4];approach(s);w.geodes[4].hits=s.maxHits-1;w.pickups=Array.from({length:256},(_,i)=>({id:'f'+i,kind:'stone',amount:1,x:40,z:40,y:0}));
assert.equal(strike(s).code,'world_limit');assert.equal(w.geodes[4].hits,s.maxHits-1);w.pickups=[];
// Corrupt saves are rejected.
const bad=sim.checkpoint();bad.geodes=[{hits:0,regrowTick:0}];assert.throws(()=>loadSimulation(bad),/geodes/);
const bad2=sim.checkpoint();bad2.geodes[1]={hits:99,regrowTick:0};assert.throws(()=>loadSimulation(bad2),/geodes/);
console.log('PASS: every cluster reachable; pick-only cracks; break drops Crystal by the miner; regrow on time; reach, cap and save checks.');
