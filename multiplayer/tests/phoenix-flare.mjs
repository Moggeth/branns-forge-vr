import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {createEnemy,FLARE} from '../shared/combat.js';
import {specialCooldown} from '../shared/special-cooldowns.js';

const act=(s,seq,action,extra={})=>s.command('h',{type:'action',seq,action,...extra});
function fixture(){const s=createSimulation();s.addPlayer({id:'h'});const c=s.checkpoint();c.enemies=[createEnemy('enemy',[0,terrainHeight(c,0,-6),-6],'skeleton')];return loadSimulation(c);}
let s=fixture();const p=s.snapshot().players[0],origin=[p.position[0],p.position[1]+1.5,p.position[2]];
// Only Emberwing looses a flare, and only with a sane aim.
for(let i=0;i<specialCooldown('bow')+1;i++)s.step();

assert.equal(act(s,2,'equip',{tool:'bow'}).ok,true);
assert.equal(act(s,3,'special',{origin:[40,1,40],direction:[0,0,-1]}).code,'invalid_action');
const d=[0,.15,-1],l=Math.hypot(...d);
const r=act(s,4,'special',{origin,direction:d.map(n=>n/l)});assert.equal(r.ok,true,JSON.stringify(r));assert.ok(r.events.some(e=>e.kind==='shoot'&&e.flare));
assert.equal(act(s,5,'special',{origin,direction:d.map(n=>n/l)}).code,'cooldown');
assert.ok(s.snapshot().projectiles[0].flare);
// Survives a save mid-flight.
assert.deepEqual(loadSimulation(s.checkpoint()).snapshot().projectiles[0].flare,true);
// Bursts after the fuse: lights fuel under it and sets the skeleton under it burning.
let burst=null;for(let i=0;i<FLARE.fuse+2&&!burst;i++)burst=(s.step()||[]).find(e=>e.kind==='phoenix_flare');
assert.ok(burst&&burst.lit,'burst');assert.equal(s.snapshot().projectiles.length,0);
assert.ok(s.snapshot().fireCells.some(c=>c.burning),'embers light the ground');
assert.ok(burst.position[1]>terrainHeight(s.checkpoint(),burst.position[0],burst.position[2])+2,'bursts overhead');
// Recharges.
for(let i=0;i<specialCooldown('bow');i++)s.step();
assert.equal(act(s,6,'special',{origin:s.snapshot().players[0].position.map((n,i)=>n+(i===1?1.5:0)),direction:[0,1,0]}).ok,true);
console.log('phoenix-flare: Emberwing Q flare launches, bursts overhead, lights the ground, saves and recharges');
