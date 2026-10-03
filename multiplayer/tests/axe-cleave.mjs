import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {createEnemy} from '../shared/combat.js';
import {worldTrees} from '../shared/world-content.js';
import {isFelled} from '../shared/trees.js';
import {AXE_CLEAVE,planCleave} from '../shared/axe-cleave.js';
import {specialCooldown} from '../shared/special-cooldowns.js';
const started=performance.now();
const gameplay=c=>({...c,players:c.players.map(p=>({...p,seq:0}))});
// Hero at (x,z) facing yaw (0 faces -Z), axe in hand, optional foes at [forward, right] offsets.
function fixture({x=10,z=10,yaw=0,foes=[],golem=false,landmarks=false}={}) {
  const sim=createSimulation();sim.addPlayer({id:'h'});
  const c=sim.checkpoint();c.landmarks=landmarks;const p=c.players[0];p.position=[x,terrainHeight(c,x,z),z];p.yaw=yaw;p.tool='axe';
  const f=[-Math.sin(yaw),-Math.cos(yaw)],r=[Math.cos(yaw),-Math.sin(yaw)];
  c.enemies=foes.map(([ahead,right],i)=>{const ex=x+f[0]*ahead+r[0]*right,ez=z+f[1]*ahead+r[1]*right;return createEnemy(`foe${i}`,[ex,terrainHeight(c,ex,ez),ez],golem&&i===0?'golem':'skeleton');});
  return loadSimulation(c);
}
const special=(s,seq=1)=>s.command('h',{type:'action',action:'special',seq});

// Arc: everything in front within reach dies in one hit; behind, beyond reach and outside the arc are untouched.
const half=AXE_CLEAVE.arc/2*Math.PI/180,at=(d,a)=>[d*Math.cos(a),d*Math.sin(a)];
let s=fixture({foes:[[2,0],at(4,half-.15),at(4,-(half-.15)),[0,.3],[-2,0],[AXE_CLEAVE.reach+1.2,0],at(3,half+.35)]});
const before=s.checkpoint(),r=special(s);
assert.equal(r.ok,true);
const alive=s.snapshot().enemies.map(e=>e.id).sort();
assert.deepEqual(alive,['foe4','foe5','foe6'],'only foes inside the sweep fall');
const ev=r.events.find(e=>e.kind==='axe_cleave');
assert.deepEqual(ev.hits.sort(),['foe0','foe1','foe2','foe3']);assert.deepEqual(ev.direction,[0,0,-1]);
assert.equal(ev.reach,AXE_CLEAVE.reach);assert.equal(ev.arc,AXE_CLEAVE.arc);assert.equal(r.events[0],ev,'the sweep event leads its hits');
assert.equal(s.snapshot().players[0].stats.kills,4);
assert.equal(s.snapshot().edits.length,before.edits.length,'no terrain edits');assert.equal(s.snapshot().deposits.length,before.deposits.length,'no stones left behind');
// Duplicate packet, cooldown, and an exact reload.
assert.equal(special(s).code,'duplicate_sequence');
const cooled=s.checkpoint();assert.equal(special(s,2).code,'cooldown');assert.deepEqual(gameplay(s.checkpoint()),gameplay(cooled));
assert.deepEqual(loadSimulation(JSON.parse(JSON.stringify(s.checkpoint()))).snapshot(),s.snapshot());
for(let i=0;i<specialCooldown('axe')-1;i++)s.step();assert.equal(special(s,3).code,'cooldown');s.step();assert.equal(special(s,4).ok,true);

// An armoured golem survives, is hurt and thrown back along the sweep.
s=fixture({foes:[[2,0]],golem:true});const g0=s.snapshot().enemies[0];
assert.equal(special(s).ok,true);const g1=s.snapshot().enemies[0];
assert.ok(g1&&g1.hp<g0.hp&&g1.hp>0,'golem hurt, not killed');assert.ok(g1.position[2]<g0.position[2]-1,'golem knocked away from the hero');

// Trees: the nearest standing trees in the arc fall away from the hero, capped per cleave, and drop their logs.
let base=createSimulation();base.addPlayer({id:'h'});const trees=worldTrees(base.checkpoint());
const tree=trees.find(t=>Math.abs(t.x)<40&&Math.abs(t.z)<40);
s=fixture({x:tree.x,z:tree.z+2.2,yaw:0,landmarks:base.checkpoint().landmarks});
const plan=planCleave(s.checkpoint(),s.checkpoint().players[0]);
assert.ok(plan.trees.some(q=>q.t.id===tree.id),'tree in front is targeted');assert.ok(plan.trees.length<=AXE_CLEAVE.trees);
const cut=special(s);assert.equal(cut.ok,true);
const h=s.snapshot().harvestedTrees.find(q=>q.id===tree.id);assert.ok(isFelled(h),'felled in one cleave');
assert.ok(cut.events.some(e=>e.kind==='tree_fell'&&e.id===tree.id&&e.by==='h'));
assert.ok(Math.cos(h.fallYaw)>.9,'notch faces the hero, so the tree falls away');
assert.ok(cut.events.find(e=>e.kind==='axe_cleave').trees.includes(tree.id));
for(let i=0;i<400&&!s.snapshot().harvestedTrees.find(q=>q.id===tree.id).landed;i++)s.step();
assert.ok(s.snapshot().looseLogs.length>=2,'felled timber lands as logs');
// Already-felled trees are not targeted again; a migrated host continues identically.
assert.ok(!planCleave(s.checkpoint(),s.checkpoint().players[0]).trees.some(q=>q.t.id===tree.id));
const migrated=loadSimulation(JSON.parse(JSON.stringify(s.checkpoint())));for(let i=0;i<60;i++){s.step();migrated.step();}assert.deepEqual(s.snapshot(),migrated.snapshot());

// Saves from the Sunder era (axe_sunder scars and their stones) still load and keep their stones.
s=fixture();let c=s.checkpoint();
c.edits=[{id:'s1',kind:'axe_sunder',x:10,z:8,radius:1.35,height:-.12}];c.deposits.push({id:'o1',kind:'stone',x:10,z:8,hits:0,maxHits:3,depleted:false,special:'axe_sunder'});
const old=loadSimulation(c).snapshot();assert.ok(old.edits.some(e=>e.kind==='axe_sunder')&&old.deposits.some(d=>d.special==='axe_sunder'));
console.log(`axe-cleave: arc, one-hit kills, golem, trees, cooldown, reload and old saves pass (${((performance.now()-started)/1000).toFixed(3)}s)`);
