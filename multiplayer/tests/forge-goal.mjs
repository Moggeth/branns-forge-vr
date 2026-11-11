// The supplies strip's forge goal (client/forge-goal.js): next ladder weapon in the Wilds, else the next temper of the
// weapon in hand, with have/need per resource and "ready" once affordable. Carried iron ore counts as iron.
import assert from 'node:assert/strict';
import {createSimulation, terrainHeight} from '../shared/simulation.js';
import {worldDescriptor, worldFor} from '../shared/worldgen/registry.js';
import {withWorld} from '../shared/world-extent.js';
import {forgeGoal, goalProgress} from '../client/forge-goal.js';
import {TEMPER} from '../shared/weapon-temper.js';
let count = 0;
const test = (name, fn) => { fn(); count++; console.log('PASS', name); };

test('wilds: the goal is the next weapon, with have/need and ready at the forge', () => {
  const world = worldDescriptor({kind: 'wilds', seed: 'ci-goal', preset: 'continent', size: 2048});
  const sim = createSimulation({room: 'G', seed: 7, world}); sim.addPlayer({id: 'h1', name: 'Brann', role: 'hero'});
  const st = sim.adventureWorld(), p = st.players[0], w = worldFor(world);
  withWorld(w, () => { p.position = [80, terrainHeight(st, 80, 80), 80]; });
  p.resources = {wood: 2, ironOre: 4};
  let g = forgeGoal(st, p);
  assert.equal(g.kind, 'forge'); assert.equal(g.tool, 'crossbow'); assert.equal(g.title, 'Siegebird');
  assert.deepEqual(g.short, {wood: 4}); assert.equal(g.ready, false); assert.equal(g.here, false);
  assert.deepEqual(goalProgress(g), {wood: {have: 2, need: 6, met: false}, iron: {have: 4, need: 4, met: true}});
  p.resources.wood = 9; withWorld(w, () => { p.position = [3, terrainHeight(st, 3, 3), 3]; });
  g = forgeGoal(st, p); assert.equal(g.ready, true); assert.equal(g.here, true);
  st.arsenal.forged.brann = ['crossbow', 'bow', 'hammer', 'wyrmspout']; p.tool = 'bow'; p.temper = {bow: 1};
  g = forgeGoal(st, p); assert.equal(g.kind, 'temper'); assert.equal(g.tool, 'bow'); assert.equal(g.title, 'Temper II'); assert.deepEqual(g.cost, TEMPER.costs[1]);
  p.temper = {bow: 3}; assert.equal(forgeGoal(st, p), null, 'nothing left to work toward on a Masterwork');
});

test('valley: no ladder, so the goal is tempering what you hold; Gods get none', () => {
  const sim = createSimulation(); sim.addPlayer({id: 'h'}); const c = sim.checkpoint(), p = c.players[0];
  p.role = 'hero'; p.tool = 'axe'; p.resources = {};
  const g = forgeGoal(c, p); assert.equal(g.kind, 'temper'); assert.equal(g.title, 'Temper I'); assert.equal(g.ready, false);
  assert.equal(forgeGoal(c, {...p, role: 'god'}), null);
});
console.log(`forge-goal: ${count} passed`);
