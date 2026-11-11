// "Timber!" (axe talent): the tree you fell crushes the foes it lands on, at the tick it lands, and only theirs.
import assert from 'node:assert/strict';
import {createSimulation, loadSimulation, terrainHeight} from '../shared/simulation.js';
import {worldTrees} from '../shared/world-content.js';
import {trunkRadius, treeFall} from '../shared/trees.js';
import {createEnemy} from '../shared/combat.js';
import {TIMBER_RANKS} from '../shared/timber-crush.js';

function fell(talents) {
  let seq = 0;
  const base = createSimulation({seed: 41}); base.addPlayer({id: 'h', name: 'Brann'});
  const tree = worldTrees(base.checkpoint()).find(t => t.id === 'tree3');
  const floor = terrainHeight({edits: [], bridges: []}, tree.x, tree.z), r = trunkRadius(tree, 1);
  const s = base.checkpoint(), p = s.players[0]; p.position = [tree.x, floor, tree.z + 1.2]; p.yaw = 0;
  p.xp = 2000; p.talents = talents; p.tool = 'axe';
  const sim = loadSimulation(s), w = sim.adventureWorld();
  for (let i = 0; i < 30; i++) sim.step();
  let felled = null;
  for (let n = 0; n < 3 && !felled; n++) { felled = sim.command('h', {type: 'action', seq: ++seq, action: 'strike', targetId: tree.id, point: [tree.x, floor + 1, tree.z + r], normal: [0, 0, 1]}).events.find(e => e.kind === 'tree_fell'); if (!felled) for (let i = 0; i < 28; i++) sim.step(); }
  assert.ok(felled, 'tree falls');
  const cut = w.harvestedTrees.find(h => h.id === tree.id); assert.equal(cut.by, 'h', 'the tree remembers who felled it');
  const dir = treeFall(tree, cut, cut.felledTick + 1, floor, (x, z) => terrainHeight(w, x, z)).direction;
  const at = d => [tree.x + dir[0] * d, 0, tree.z + dir[2] * d].map((v, i) => i === 1 ? terrainHeight(w, tree.x + dir[0] * d, tree.z + dir[2] * d) : v);
  const under = createEnemy('under', at(Math.min(4, tree.height * .6)), 'skeleton'), aside = createEnemy('aside', [tree.x - dir[2] * 6, 0, tree.z + dir[0] * 6], 'skeleton');
  aside.position[1] = terrainHeight(w, aside.position[0], aside.position[2]);
  for (const e of [under, aside]) { e.hp = e.maxHp = 500; e.speed = 0; }
  w.enemies = [under, aside];
  const events = []; for (let i = 0; i < 400 && !events.some(e => e.kind === 'tree_land'); i++) events.push(...sim.step());
  assert.ok(events.some(e => e.kind === 'tree_land'), 'tree lands');
  return {events, under, aside, w};
}

{
  const {events, under, aside} = fell({axe: ['timber', 'timber']});
  const crush = events.find(e => e.kind === 'timber_crush');
  assert.ok(crush, 'timber_crush fires on landing'); assert.equal(crush.by, 'h'); assert.equal(crush.rank, 2);
  assert.deepEqual(crush.hits, ['under'], 'only the foe under the trunk is hit');
  assert.ok(under.hp < 500 - TIMBER_RANKS[1][1] * .9, `crushed: ${under.hp}`); assert.equal(aside.hp, 500, 'the foe beside it is untouched');
}
{
  const {events, under} = fell({});
  assert.ok(!events.some(e => e.kind === 'timber_crush'), 'no talent, no crush'); assert.equal(under.hp, 500);
}
console.log('timber-crush: ok');
