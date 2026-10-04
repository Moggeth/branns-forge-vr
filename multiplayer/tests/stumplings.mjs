// Stumplings: settled stumps wake at a seeded random time as root critters, wander, flee, burrow, drop loot, and
// hand their harvest slot back; a burrowing critter regrows its tree at its exact final position.
import assert from 'node:assert/strict';
import {createSimulation, loadSimulation} from '../shared/simulation.js';
import {worldTrees, restoreTreeRoots} from '../shared/world-content.js';
import {createTreeIndex, resolveTrees, chopTree} from '../shared/trees.js';
import {rememberAwakened} from '../shared/ents.js';
import {terrainHeight} from '../shared/terrain.js';
import {hitEnemyPart} from '../shared/combat.js';
import {STUMPLING, stumpWakes, treeCutMap, stumplingGoneTick, stumplingBurrowTick} from '../shared/stumplings.js';

const world = (seed = 7) => { const sim = createSimulation({room: 'STUMP', seed}); sim.addPlayer({id: 'h', role: 'hero'}); return sim; };
const state = sim => sim.adventureWorld();
const step = (sim, n = 1) => { const events = []; for (let i = 0; i < n; i++) events.push(...sim.step()); return events; };
const roundTrip = sim => loadSimulation(JSON.parse(JSON.stringify(sim.checkpoint())));
const ctx = {nextId: (s, p) => `${p}${++s.idCounter}`, terrainHeight};
const fell = (s, tree, felledTick = 1) => { const cut = {id: tree.id, cuts: 3, cutHeight: terrainHeight(s, tree.x, tree.z) + .8, felledTick, fallYaw: 0, landed: true}; s.harvestedTrees.push(cut); return cut; };
/** First roll tick (>= from) at which this stump wakes. */
const wakeTickFor = (seed, cut, from) => { for (let t = Math.ceil(from / STUMPLING.rollTicks) * STUMPLING.rollTicks; t < from + 600 * 400; t += STUMPLING.rollTicks) if (stumpWakes(seed, cut, t)) return t; return -1; };
const stepTo = (sim, tick) => step(sim, tick - state(sim).tick);
// Keep the hero far from the stump so the critter wanders instead of fleeing.
const park = (s, x = 40, z = -40) => { const h = s.players.find(p => p.role === 'hero'); h.position = [x, terrainHeight(s, x, z), z]; };

{ // The wake roll is deterministic, respects the rest period and lands near the designed rate.
  const cut = {id: 'tree3', cuts: 3, felledTick: 100, landed: true};
  assert.equal(stumpWakes(9, cut, 600 * 3), false, 'a fresh stump never wakes inside the first minute');
  assert.equal(stumpWakes(9, {...cut, landed: false}, 600 * 40), false, 'logs still falling: no wake');
  let hits = 0, rolls = 0;
  for (let i = 0; i < 400; i++) for (let t = 6000; t < 6000 + 600 * 30; t += 600) { rolls++; if (stumpWakes(i, {...cut, id: `s${i}`}, t)) hits++; }
  const rate = hits / rolls; assert.ok(rate > .022 && rate < .045, `wake rate ${rate}`);
  for (let t = 4200; t < 30000; t += 600) assert.equal(stumpWakes(9, cut, t), stumpWakes(9, cut, t), 'pure');
}

{ // A settled stump wakes as a critter in place; the stump's collision is skipped while it walks.
  const sim = world(), s = state(sim); park(s);
  const tree = worldTrees(s).find(t => t.id === 'tree4'), cut = fell(s, tree);
  const wake = wakeTickFor(s.seed, cut, STUMPLING.minAgeTicks + 1); assert.ok(wake > 0);
  let events = stepTo(sim, wake - 1); assert.ok(!s.enemies.some(e => e.kind === 'stumpling'), 'still asleep before its roll');
  events = step(sim, 1);
  const critter = s.enemies.find(e => e.kind === 'stumpling');
  assert.ok(critter, 'the stump woke'); assert.equal(critter.treeId, tree.id); assert.equal(critter.variant, tree.variant);
  assert.ok(events.some(e => e.kind === 'stump_wake' && e.id === critter.id));
  assert.ok(Math.hypot(critter.position[0] - tree.x, critter.position[2] - tree.z) < .01, 'it stands where the stump was');
  assert.equal(treeCutMap(s).get(tree.id).awake, true);
  assert.ok(s.harvestedTrees.some(h => h.id === tree.id), 'the stump record lasts while the critter lives');
  // Holds still while waking, then pootles about near home.
  const at = [...critter.position]; step(sim, STUMPLING.wakeTicks - 2);
  assert.ok(Math.hypot(critter.position[0] - at[0], critter.position[2] - at[2]) < 1e-6, 'no movement while pulling free');
  step(sim, 900);
  const home = Math.hypot(critter.position[0] - tree.x, critter.position[2] - tree.z);
  assert.ok(home < STUMPLING.homeRadius + 1.5, `stays near home (${home.toFixed(2)} m)`);
  // Saves keep the critter, and a broken one is refused.
  const again = roundTrip(sim), c2 = state(again).enemies.find(e => e.id === critter.id);
  assert.ok(c2 && c2.kind === 'stumpling' && c2.treeId === tree.id && c2.home.length === 2);
  const bad = JSON.parse(JSON.stringify(sim.checkpoint())); bad.harvestedTrees = bad.harvestedTrees.filter(h => h.id !== tree.id);
  assert.throws(() => loadSimulation(bad), /enemy/i, 'a critter without its stump is not a valid save');
  // It never attacks, and a close hero sends it running.
  const h = s.players.find(p => p.role === 'hero'), hp = h.hp;
  h.position = [critter.position[0] + 1.5, critter.position[1], critter.position[2]];
  const d0 = Math.hypot(critter.position[0] - h.position[0], critter.position[2] - h.position[2]);
  step(sim, 40); h.position[1] = terrainHeight(s, h.position[0], h.position[2]);
  const d1 = Math.hypot(critter.position[0] - h.position[0], critter.position[2] - h.position[2]);
  assert.ok(d1 > d0 + .5, `it flees (${d0.toFixed(2)} -> ${d1.toFixed(2)})`);
  assert.equal(h.hp, hp, 'harmless');
}

{ // Killed: a log (and sometimes ore) drops, the stump record is released and the tree stands again.
  const sim = world(3), s = state(sim); park(s);
  const tree = worldTrees(s).find(t => t.id === 'tree7'), cut = fell(s, tree);
  stepTo(sim, wakeTickFor(s.seed, cut, STUMPLING.minAgeTicks + 1) + 1);
  const critter = s.enemies.find(e => e.kind === 'stumpling'), logs = s.looseLogs.length, events = [];
  assert.ok(hitEnemyPart(s, critter, 'torso', 40, {tool: 'axe', point: critter.position}, ctx, events), 'axe bites');
  assert.ok(!s.enemies.includes(critter), 'the axe makes short work of a stumpling (double damage to wood)');
  assert.equal(s.looseLogs.length, logs + STUMPLING.logs);
  assert.ok(events.some(e => e.kind === 'stump_loot') && events.some(e => e.kind === 'death' && e.creature === 'stumpling'));
  assert.ok(events.every(e => e.kind !== 'detach'), 'no carried remains');
  assert.ok(!s.harvestedTrees.some(h => h.id === tree.id), 'harvest slot freed');
  roundTrip(sim);
  // Loot odds: about a quarter carry copper, a few carry gold.
  const ores = {copperOre: 0, goldOre: 0};
  for (let i = 0; i < 400; i++) { const e = {id: `stump${i}`, kind: 'stumpling', treeId: 'x', position: [0, 0, 0], yaw: 0};
    const t = {seed: 5, looseLogs: [], pickups: [], harvestedTrees: [], idCounter: 0};
    const ore = (await import('../shared/stumplings.js')).dropStumplingLoot(t, e, {...ctx, logLimit: 48}, []).ore; if (ore) ores[ore]++; }
  assert.ok(ores.copperOre > 70 && ores.copperOre < 130, `copper ${ores.copperOre}/400`);
  assert.ok(ores.goldOre > 6 && ores.goldOre < 40, `gold ${ores.goldOre}/400`);
}

{ // Left alone it burrows away after its life, freeing the slot just the same.
  const sim = world(11), s = state(sim); park(s);
  const tree = worldTrees(s).find(t => t.id === 'tree2'), cut = fell(s, tree);
  stepTo(sim, wakeTickFor(s.seed, cut, STUMPLING.minAgeTicks + 1) + 1);
  const critter = s.enemies.find(e => e.kind === 'stumpling');
  let events = stepTo(sim, stumplingBurrowTick(critter) + 1);
  assert.ok(events.some(e => e.kind === 'stump_burrow' && e.id === critter.id));
  const at = [...critter.position]; step(sim, 30); assert.deepEqual(critter.position, at, 'it digs in place');
  events = stepTo(sim, stumplingGoneTick(critter) + 1);
  assert.ok(!s.enemies.includes(critter)); assert.ok(events.some(e => e.kind === 'stump_gone'));
  assert.ok(!s.harvestedTrees.some(h => h.id === tree.id)); assert.ok(worldTrees(s).some(t => t.id === tree.id));
  const grown = worldTrees(s).find(t => t.id === tree.id);
  assert.deepEqual([grown.x, grown.z], [at[0], at[2]], 'regrowth is exactly at the burrow, not the original stump');
  assert.ok(Math.hypot(grown.x-tree.x,grown.z-tree.z)>.1, 'fixture actually moved away from the original root');
  const restored = roundTrip(sim);
  assert.deepEqual(worldTrees(state(restored)).find(t => t.id === tree.id), grown, 'save/reload retains relocated root');
  assert.deepEqual(worldTrees(sim.snapshot()).find(t => t.id === tree.id), grown, 'late join snapshot carries exact root');
  assert.equal(worldTrees(s).filter(t=>t.id===tree.id).length,1,'no duplicate original tree');
  const index = createTreeIndex(); index.update({...s,treeRoots:[]});
  assert.equal(index.update(s),true,'relocation invalidates the spatial index even though ids stay unchanged');
  assert.deepEqual(index.get(tree.id),grown);
  const position=[grown.x,terrainHeight(s,grown.x,grown.z),grown.z];
  resolveTrees(position,index,new Map(),(x,z)=>terrainHeight(s,x,z));
  assert.ok(Math.hypot(position[0]-grown.x,position[2]-grown.z)>.1,'collision follows new tree location');
  const chop=chopTree(s,grown,[grown.x+.2,terrainHeight(s,grown.x,grown.z)+.8,grown.z],[1,0,0],{terrainHeight:(x,z)=>terrainHeight(s,x,z)});
  assert.ok(chop.events?.some(e=>e.kind==='wood_hit'&&e.cuts===1),'regrown tree remains choppable at its new root');
  const checkpoint=sim.checkpoint();
  for(const invalid of [[{id:'unknown',x:0,z:0}], [...s.treeRoots,...s.treeRoots], [{id:tree.id,x:56,z:0}], [{id:tree.id,x:NaN,z:0}], [{id:tree.id,x:0,z:0,y:0}]]) {
    assert.throws(()=>loadSimulation({...checkpoint,treeRoots:invalid}),/tree root/i,'invalid relocation rejected');
  }
  // Awakening transfers the same position to the ent record and must not leave an orphan root override.
  const transfer=structuredClone(s); transfer.harvestedTrees=[];
  assert.equal(rememberAwakened(transfer,grown,[]),true);
  assert.equal(transfer.treeRoots.length,0);
  assert.deepEqual(restoreTreeRoots(transfer),[]);
}

{ // Overrides work equally for planted groves and ent-grown trees; legacy saves need no extension.
  const s={seed:7,tick:10,groves:[{id:'g1',trees:[[12,14,6,0,0]]}],wildTrees:[{id:'e1-tree',x:20,z:20,height:6,variant:1}]};
  assert.deepEqual(restoreTreeRoots(s),[]);
  s.treeRoots=[{id:'g1-tree0',x:12.123456789,z:13.987654321},{id:'e1-tree',x:24.1,z:22.8}];
  assert.deepEqual(restoreTreeRoots(s),s.treeRoots);
  for(const root of s.treeRoots){const tree=worldTrees(s).find(t=>t.id===root.id);assert.deepEqual([tree.x,tree.z],[root.x,root.z]);}
}

{ // Never more than maxLive critters at once, however many stumps there are.
  const sim = world(21), s = state(sim); park(s);
  for (const t of worldTrees(s).slice(0, 40)) fell(s, t);
  step(sim, 600 * 40);
  const live = s.enemies.filter(e => e.kind === 'stumpling').length;
  assert.ok(live > 0 && live <= STUMPLING.maxLive, `live ${live}`);
  roundTrip(sim);
}
console.log('stumplings ok');
