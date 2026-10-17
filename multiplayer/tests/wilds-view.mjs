// Great Wilds renderer contract (headless): the finest terrain level IS the physics surface, coarser levels meet it
// without cracks, and walking rebuilds in bounded slices.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createWildsView} from '../client/wilds-view.js';
import {worldDescriptor, worldFor} from '../shared/worldgen/registry.js';
import {terrainHeight} from '../shared/terrain.js';
import {withWorld} from '../shared/world-extent.js';

const d = worldDescriptor({seed: 'ci-view', preset: 'highlands', size: 2048}), w = worldFor(d);
const scene = new THREE.Scene(), view = createWildsView({scene, quality: 'low'});
view.setWorld(w, d);
const snap = {world: d, edits: [{id: 'e1', kind: 'raise', x: 6, z: 14, radius: 4, height: 2}], tick: 0, players: [{id: 'a', role: 'hero', position: [0, 0, 8]}]};
let t = performance.now(); view.prime({focus: {x: 0, z: 8}, snapshot: snap}); const primeMs = performance.now() - t;
const [l0, l1] = view.group.children.filter(c => /wilds-terrain-[01]/.test(c.name));
const p0 = l0.geometry.attributes.position.array;
withWorld(w, () => { for (let k = 0; k < p0.length / 3; k += 97) assert.equal(p0[k * 3 + 1], Math.fround(terrainHeight(snap, p0[k * 3], p0[k * 3 + 2], false)), 'near terrain must equal the walkable surface'); });
// Every boundary vertex of the near level appears in the next level's stitched rim, at the height the near level morphs
// to by its edge (geomorph: the near level slides onto the coarser surface before it ends, so nothing pops or cracks).
const m0 = l0.geometry.attributes.morph.array;
const rim = new Map(), p1 = l1.geometry.attributes.position.array;
for (let k = 0; k < p1.length; k += 3) rim.set(`${p1[k]},${p1[k + 2]}`, p1[k + 1]);
const xs = [], zs = []; for (let k = 0; k < p0.length; k += 3) { xs.push(p0[k]); zs.push(p0[k + 2]); }
const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
let edge = 0;
for (let k = 0; k < p0.length; k += 3) {
  const x = p0[k], z = p0[k + 2]; if (x !== minX && x !== maxX && z !== minZ && z !== maxZ) continue;
  edge++; assert.ok(Math.abs(rim.get(`${x},${z}`) - m0[k]) < 2e-3, `crack at ${x},${z}: ${rim.get(`${x},${z}`)} vs ${m0[k]}`);
}
assert.ok(edge >= 600, `checked ${edge} rim vertices`);
// Where a near vertex sits on a coarse vertex, its morph target is that coarse vertex exactly.
const coarse = new Map(); for (let k = 0; k < p1.length; k += 3) coarse.set(`${p1[k]},${p1[k + 2]}`, p1[k + 1]);
let shared = 0; for (let k = 0; k < p0.length; k += 3) { const c = coarse.get(`${p0[k]},${p0[k + 2]}`); if (c === undefined) continue; shared++; assert.ok(Math.abs(c - m0[k]) < 1e-3, 'morph target off the coarse surface'); }
assert.ok(shared > 1000, `checked ${shared} shared vertices`);
// Walking: a recentre finishes in bounded slices.
let pumps = 0; const slice = []; view.update({focus: {x: 40, z: 8}, camera: null, snapshot: snap, budget: 0});
while (view.building() && pumps < 5000) { const s = performance.now(); view.update({focus: {x: 40, z: 8}, camera: null, snapshot: snap, budget: 3}); slice.push(performance.now() - s); pumps++; }
assert.ok(!view.building(), 'rebuild completes');
const worst = Math.max(...slice);
assert.ok(worst < 40, `a frame slice took ${worst.toFixed(1)} ms`);
const stats = view.stats();
assert.ok(stats.trees > 200, `far forests drawn (${stats.trees})`);
console.log(`PASS wilds view: near level is the physics surface, ${edge} rim vertices crack-free, prime ${primeMs | 0} ms, ${pumps} slices (worst ${worst.toFixed(1)} ms), ${stats.trees} far trees`);
