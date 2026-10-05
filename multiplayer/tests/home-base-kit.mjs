// Dawnhold and Grumblekeep kit contract: the shipped GLB carries every piece and pivot anchor the view asks for,
// stays phone-sized, and a laid-out base bakes its decor into a handful of draws while every hittable part keeps its id.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {prepareHomeKit, buildKitBase} from '../client/home-base-art.js';
import {createSimulation} from '../shared/simulation.js';
import {HOME_LAYOUT, homePoint, resolveHomeStructures} from '../shared/home-bases.js';

const glb = readFileSync(new URL('../public/assets/bases_kit.glb', import.meta.url));
assert.equal(glb.toString('utf8', 0, 4), 'glTF');
const json = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)));
const byName = new Map(json.nodes.map(n => [n.name, n]));
const PIECES = {Heart: ['Heart_Core'], HeartCrystal: [], HeartRingA: [], HeartRingB: [], Barracks: ['Barracks_Bell'], Bell: [], Fountain: ['Fountain_Crystal'],
  FountainWater: [], FountainCrystal: [], Pylon: ['Pylon_Crystal'], PylonCrystal: [], Spire: ['Spire_Crystal'], SpireCrystal: [],
  BallistaBase: ['BallistaBase_Yoke'], BallistaYoke: ['BallistaYoke_Bow'], BallistaBow: ['BallistaBow_Bolt'], BallistaBolt: [], Gate: [], Ward: []};
for (const pre of ['D', 'G']) for (const [piece, anchors] of Object.entries(PIECES)) {
  const n = byName.get(`${pre}_${piece}`); assert.ok(n && n.mesh !== undefined, `${pre}_${piece} in kit`);
  for (const a of anchors) assert.ok((n.children || []).some(i => json.nodes[i].name === `${pre}_${a}`), `${pre}_${a} anchor under ${pre}_${piece}`);
}
const mats = new Set(json.materials.map(m => m.name));
for (const m of ['Stone', 'Plaster', 'Slate', 'Wood', 'Brass', 'Cloth', 'Iron', 'Basalt', 'Bone', 'Crystal', 'Amethyst', 'Ember', 'Ooze']) assert.ok(mats.has(m), m + ' material');
for (const m of json.meshes) for (const p of m.primitives) { const c = json.accessors[p.attributes.COLOR_0]; assert.ok(c && c.componentType === 5121 && c.normalized, m.name + ' packed colours'); }
assert.ok(glb.length < 4.5e6, `kit stays small enough for phones (${glb.length})`);

// A stand-in kit with the same names lays out both bases.
const scene = new THREE.Group(), M = n => Object.assign(new THREE.MeshStandardMaterial(), {name: n});
const mat = {Stone: M('Stone'), Basalt: M('Basalt'), Crystal: M('Crystal'), Brass: M('Brass')};
const box = () => { const g = new THREE.BoxGeometry(.5, .5, .5); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3)); return g; };
for (const pre of ['D', 'G']) for (const [piece, anchors] of Object.entries(PIECES)) {
  const g = new THREE.Group(); g.name = `${pre}_${piece}`; scene.add(g);
  g.add(new THREE.Mesh(box(), /Crystal/.test(piece) ? mat.Crystal : mat[pre === 'D' ? 'Stone' : 'Basalt']), new THREE.Mesh(box(), mat.Brass));
  for (const a of anchors) { const o = new THREE.Object3D(); o.name = `${pre}_${a}`; o.position.set(0, 1.5, 0); g.add(o); }
}
const kit = prepareHomeKit({scene}); assert.ok(kit, 'stand-in kit accepted');
assert.equal(prepareHomeKit({scene: new THREE.Group()}), null, 'an incomplete kit is refused');
const sim = createSimulation({seed: 4}); sim.addPlayer({id: 'k'}); const snap = sim.snapshot();
for (const data of snap.battle.bases) {
  const built = buildKitBase(kit, data, {height: () => 0, glowColor: 0xffffff, ball: new THREE.SphereGeometry(1), ooze: M('ooze'), glow: M('glow'), ring: new THREE.TorusGeometry(1, .05)});
  assert.equal(built.parts.size, 7);
  for (const part of data.parts) { const p = built.parts.get(part.id); const ids = new Set(); p.group.traverse(o => { if (o.isMesh) ids.add(o.userData.targetId); }); assert.deepEqual([...ids], [part.id], part.id + ' hits route to the part'); }
  assert.equal(built.heart.proxy.userData.targetId, data.id);
  assert.ok(built.draws <= 4, `static decor baked to ${built.draws} draws`);
  const statics = built.baked.reduce((n, m) => n + m.geometry.attributes.position.count, 0); assert.ok(statics > 0);
  const ballista = [...built.parts.values()].find(p => p.kind === 'ballista'); assert.ok(ballista.head && ballista.bow && ballista.bolt, 'ballista yaw, pitch and bolt pivots');
}

// What you see is what you collide with: the gate pillars and boundary wards are solid.
const w = sim.adventureWorld();
for (const at of [...HOME_LAYOUT.gatePillars, HOME_LAYOUT.wards[0]]) {
  const [x, z] = homePoint('party', at), p = resolveHomeStructures(w, [x + .05, 0, z]);
  assert.ok(Math.hypot(p[0] - x, p[2] - z) > .7, `solid at ${at}`);
}
const [gx, gz] = homePoint('party', HOME_LAYOUT.gate), mid = resolveHomeStructures(w, [gx, 0, gz]);
assert.deepEqual([mid[0], mid[2]], [gx, gz], 'the gate passage stays open');
console.log('home base kit: pieces, anchors, packed colours, baked layout and colliders pass');
