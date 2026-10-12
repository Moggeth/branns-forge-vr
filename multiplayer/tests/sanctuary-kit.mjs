import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createStartingWorld} from '../client/starting-world.js';

// The shipped kit carries every piece the sanctuary asks for, each on the material its bucket expects.
const glb = readFileSync(new URL('../public/assets/landmarks_kit.glb', import.meta.url));
assert.equal(glb.toString('utf8', 0, 4), 'glTF');
const json = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)));
const node = n => json.nodes.find(x => x.name === n), matOf = n => json.materials[json.meshes[node(n).mesh].primitives[0].material].name;
const want = {Stone: ['Menhir_A', 'Menhir_B', 'Menhir_C', 'Menhir_D', 'Post_A', 'Post_B', 'Lintel', 'Altar', 'Rubble_A', 'Rubble_B', 'Rubble_C'],
  Moss: ['Moss_A', 'Moss_B', 'Moss_C'], Bronze: ['Hoop', 'Chain'], Crystal: ['LintelSeam', 'AltarCrystals', 'HoopInlay', 'TuneCrystal']};
const outcrop = {Stone: ['GeodeBoulder_A', 'GeodeBoulder_B', 'GeodeBoulder_C', 'Cup'], Wood: ['MineHead', 'OreCart'], Bronze: ['MineHead_Iron', 'OreCart_Iron'],
  Crystal: ['GeodeBoulder_A_Crystals', 'GeodeBoulder_B_Crystals', 'GeodeBoulder_C_Crystals', 'OreCart_Crystals']};
const arch = {Stone: ['Voussoir', 'Voussoir_Loose', 'Keystone', 'Plinth', 'HeartShell'], Ashlar: ['Pier_L', 'Pier_R', 'Tower'], Bronze: ['Basket', 'Dish'], Wood: ['Tower_Door', 'HeartShell_Roots'],
  Crystal: ['Keystone_Crystals', 'Tower_Vein', 'Basket_Coals', 'Basket_Eyes', 'Dish_Crystal', 'HeartShell_Lining']};
for (const [mat, names] of [...Object.entries(want), ...Object.entries(outcrop), ...Object.entries(arch)]) for (const n of names) { assert.ok(node(n), n + ' in kit'); assert.equal(matOf(n), mat, n + ' material'); }
for (const n of 'ABCD') assert.ok(node(`Menhir_${n}`).children.some(i => json.nodes[i].name === `Menhir_${n}_Rune`), `Menhir_${n} rune anchor`);
assert.ok(glb.length < 5.5e6, 'kit stays small enough for phones'); // loads after the world is up; code stand-ins until then

// Installing a kit swaps the code-built pieces for kit pieces with the same struck ids, and runes hug the stone.
const fake = new THREE.Group(), M = n => Object.assign(new THREE.MeshStandardMaterial(), {name: n});
const mats = {Stone: M('Stone'), Moss: M('Moss'), Bronze: M('Bronze'), Crystal: M('Crystal')};
const add = (name, mat, geo, parent = fake) => { const m = new THREE.Mesh(geo, mats[mat]); m.name = name; parent.add(m); return m; };
for (const [n, h] of [['A', 3], ['B', 3.5], ['C', 3.9], ['D', 4.3]]) {
  const g = new THREE.BoxGeometry(1, h, 0.6, 2, 6, 2); g.translate(0, h / 2, 0); const m = add('Menhir_' + n, 'Stone', g);
  const r = new THREE.Object3D(); r.name = `Menhir_${n}_Rune`; r.position.set(0, h * 0.55, -0.3); m.add(r);
}
for (const [mat, names] of Object.entries(want)) for (const n of names) if (!n.startsWith('Menhir')) add(n, mat, new THREE.BoxGeometry(0.4, 0.4, 0.4));
const scene = new THREE.Scene(), world = createStartingWorld({THREE, scene, height: () => 0});
const before = world.stats(); assert.equal(before.kit, false);
const codeBuilt = Object.fromEntries(world.group.children.filter(o => o.isMesh).map(o => [o.name, o.geometry.attributes.position.count]));
assert.equal(world.installKit({scene: fake}), true); assert.equal(world.installKit({scene: fake}), false, 'installs once');
const after = world.stats(); assert.equal(after.kit, true); assert.equal(after.dropped, 0); assert.equal(after.runes, 8);
const meshes = Object.fromEntries(world.group.children.filter(o => o.isMesh).map(o => [o.name.replace('StartingWorld_', ''), o]));
for (const k of ['kStone', 'kMoss', 'kBronze', 'kCrystal']) { assert.ok(meshes[k], k + ' drawn'); assert.ok(meshes[k].geometry.attributes.uv, k + ' textured'); }
const ids = new Set(); const kStone = meshes.kStone; for (let f = 0; f < kStone.geometry.attributes.position.count / 3; f++) ids.add(kStone.userData.faceTarget(f));
for (let i = 0; i < 8; i++) assert.ok(ids.has('waystone' + i), 'waystone' + i + ' strikeable on the kit stone');
assert.ok(ids.has('waygateAltar'));
const runes = world.group.getObjectByName('StartingWorld_runes'); runes.geometry.computeBoundingBox();
assert.ok(runes.geometry.attributes.position.count > 0);
// This kit has no outcrop pieces, so the outcrop keeps its code-built boulders, mine head and cart.
assert.equal(meshes.wood?.geometry.attributes.position.count, codeBuilt.StartingWorld_wood, 'mine head stays when the kit lacks it');
assert.ok(!meshes.kWood);
world.update(); assert.equal(world.stats().kit, true, 'terrain rebuilds keep the kit');
world.dispose(); assert.equal(scene.children.length, 0);
console.log('PASS: kit contract (sanctuary, outcrop, watch-arch, heartstone) (pieces, materials, rune anchors, size); install swaps pieces, keeps ids, textured buckets, runes; rebuild + dispose.');
