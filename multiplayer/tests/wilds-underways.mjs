// The Underways as a world-menu start: the same seeded overworld, but Heroes arrive outside the first cave, walk in,
// and a dungeon opens from that cave's own seed; leaving brings them back out beside it, and a save keeps the run.
import assert from 'node:assert/strict';
import {createSimulation, loadSimulation, terrainHeight} from '../shared/simulation.js';
import {worldDescriptor, worldFor} from '../shared/worldgen/registry.js';
import {underwaySites} from '../shared/underways/sites.js';
import {inUnderway} from '../shared/underways/space.js';
import {withWorld} from '../shared/world-extent.js';

const world = worldDescriptor({kind: 'underways', seed: 'ci-delve', preset: 'continent', size: 2048});
const sim = createSimulation({room: 'U', seed: 41, world}); sim.addPlayer({id: 'h1', name: 'A', role: 'hero'});
const st = sim.adventureWorld(), w = worldFor(world), sites = underwaySites(st), u0 = sites.find(s => s.id === 'u0') || sites[0];
assert.ok(sites.length >= 3 && sites.every(s => /^u\d+$/.test(s.id)), 'every generated cave is an Underways site');
let hero = sim.snapshot().players[0];
const d0 = Math.hypot(hero.position[0] - u0.x, hero.position[2] - u0.z);
assert.ok(d0 > 3 && d0 < 16, `Hero arrives outside the first cave (${d0.toFixed(1)} m)`);
assert.ok(sim.snapshot().pickups.some(p => p.id === 'wstart0' && Math.hypot(p.x - u0.x, p.z - u0.z) < 20), 'starting supplies come along to the cave');
// Walk to the mouth: a dungeon opens from that cave.
withWorld(w, () => { st.players[0].position = [u0.mouth[0], terrainHeight(st, u0.mouth[0], u0.mouth[1]), u0.mouth[1]]; });
const events = []; for (let i = 0; i < 6; i++) events.push(...(sim.step()?.events || []));
hero = sim.snapshot().players[0];
assert.ok(inUnderway(hero.position[0], hero.position[2]), 'Hero went down into the Underways');
const run = st.underways.runs[0];
assert.equal(run.site, u0.id); assert.equal(run.style, u0.style);
// Two hosts agree on the dungeon from the descriptor alone.
const twin = createSimulation({room: 'U', seed: 41, world}); twin.addPlayer({id: 'h1', name: 'A', role: 'hero'});
const ts = twin.adventureWorld(); withWorld(w, () => { ts.players[0].position = [u0.mouth[0], terrainHeight(ts, u0.mouth[0], u0.mouth[1]), u0.mouth[1]]; }); for (let i = 0; i < 6; i++) twin.step();
assert.equal(ts.underways.runs[0].seed, run.seed, 'same seed, same dungeon');
// A save mid-delve restores the run and the Hero inside it.
const back = loadSimulation(JSON.parse(JSON.stringify(sim.checkpoint())));
assert.equal(back.snapshot().world.kind, 'underways');
assert.equal(back.adventureWorld().underways.runs[0].site, u0.id);
assert.ok(inUnderway(...[back.snapshot().players[0].position[0], back.snapshot().players[0].position[2]]), 'save keeps the Hero below');
// Great Wilds still start at the village.
const wilds = createSimulation({room: 'W', seed: 41, world: worldDescriptor({kind: 'wilds', seed: 'ci-delve', preset: 'continent', size: 2048})}); wilds.addPlayer({id: 'h', role: 'hero'});
const wp = wilds.snapshot().players[0].position; assert.ok(Math.hypot(wp[0], wp[2]) < 30);
console.log(`PASS underways start: arrive ${d0.toFixed(1)} m from ${u0.id} (${u0.style}), delve opens, peers agree, save keeps the run`);
// The guide card points a new Hero at the nearest unfound place, in plain words.
const {wildsGuideView, compassWord} = await import('../client/wilds-guide.js');
assert.equal(compassWord(0, -5), 'north'); assert.equal(compassWord(5, 0), 'east'); assert.equal(compassWord(-3, 3), 'south-west');
const fresh = createSimulation({room: 'G', seed: 41, world: worldDescriptor({kind: 'wilds', seed: 'ci-delve', preset: 'continent', size: 2048})}); fresh.addPlayer({id: 'h', role: 'hero'});
for (let i = 0; i < 20; i++) fresh.step();
const view = wildsGuideView(fresh.snapshot(), 'h');
assert.ok(view && view.title && view.next && view.total > 10 && /^Next: .+, \d.* (north|south|east|west)/.test(view.line), view?.line);
assert.equal(wildsGuideView(sim.snapshot(), 'h1'), null, 'hidden below ground');
console.log(`PASS guide: "${view.title}" · ${view.line} · found ${view.found}/${view.total}`);
{ const s2 = createSimulation({room: 'F', seed: 41, world}); s2.addPlayer({id: 'h', role: 'hero'}); const p = s2.snapshot().players[0];
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), dx = u0.x - p.position[0], dz = u0.z - p.position[2], d = Math.hypot(dx, dz);
  assert.ok((fx * dx + fz * dz) / d > .99, 'a new Hero faces the cave'); }
console.log('PASS spawn faces the cave');
