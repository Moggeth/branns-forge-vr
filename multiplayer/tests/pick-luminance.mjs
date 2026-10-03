import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {prepareAsset} from '../client/asset-pose.js';
import {createWeaponReadiness} from '../client/weapon-readiness.js';
import {enhancePickTemplate, gemLit, PICK_GEM_KINDS} from '../client/pick-luminance.js';

const start = performance.now();
// Node has no image decoder: drop embedded textures, keep meshes, nodes and material factors.
function untextured(url) {
  const buf = readFileSync(url), jsonLength = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'));
  delete json.images; delete json.textures; delete json.samplers;
  for (const m of json.materials || []) { delete m.pbrMetallicRoughness?.baseColorTexture; delete m.normalTexture; }
  let text = Buffer.from(JSON.stringify(json)); text = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 0x20)]);
  const rest = buf.subarray(20 + jsonLength), out = Buffer.alloc(20 + text.length + rest.length);
  out.write('glTF', 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8); out.writeUInt32LE(text.length, 12); out.writeUInt32LE(0x4e4f534a, 16);
  text.copy(out, 20); rest.copy(out, 20 + text.length);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.length);
}
const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(untextured(new URL('../public/assets/pick.glb', import.meta.url)), '', resolve, reject));
const materialsBefore = new Set(); gltf.scene.traverse(o => o.isMesh && materialsBefore.add(o.material));

// The light-spill shader works in mesh-local space shared by every pick mesh: authored meshes must stay untransformed.
gltf.scene.traverse(o => { if (o.isMesh) { assert.deepEqual(o.position.toArray(), [0, 0, 0], o.name); assert.deepEqual(o.quaternion.toArray(), [0, 0, 0, 1], o.name); assert.deepEqual(o.scale.toArray(), [1, 1, 1], o.name); } });

assert.equal(enhancePickTemplate(gltf.scene), true);
assert.equal(enhancePickTemplate(gltf.scene), false, 'template patch is idempotent');
assert.equal(gltf.scene.userData.pickLuminance.gems, 25, 'every authored Resonance crystal found');
const after = new Set(); gltf.scene.traverse(o => o.isMesh && after.add(o.material));
assert.deepEqual([...after], [...materialsBefore], 'template keeps the same shared material objects');

// Charge sequence: hearts brighten continuously, arm shards ignite inner → outer, crown only when ready.
assert.ok(gemLit(PICK_GEM_KINDS.heart, 0, 0) > .1 && gemLit(PICK_GEM_KINDS.heart, 0, .5) < gemLit(PICK_GEM_KINDS.heart, 0, 1));
assert.ok(gemLit(PICK_GEM_KINDS.crown, 1, .97) < .1 && gemLit(PICK_GEM_KINDS.crown, 1, 1) === 1);

const {visual} = prepareAsset(gltf, 'pick', .75);
const holder = new THREE.Group(); holder.position.set(2, 1, -3); holder.rotation.y = .7; holder.add(visual); holder.updateWorldMatrix(true, true);
const authored = new Map(); visual.traverse(o => o.isMesh && authored.set(o, [o.geometry, o.material]));
const indicator = createWeaponReadiness({root: visual, tool: 'pick'});
assert.ok(indicator.drawCalls <= 3, `pick readiness draws ${indicator.drawCalls}`);
const gems = indicator.group.parent && (() => { let g; visual.traverse(o => { if (o.name === 'ResonanceCrystal') g = o; }); return g; })();
assert.ok(gems.geometry.attributes.pickGem, 'held gems carry per-crystal charge data');
assert.notEqual(gems.geometry, authored.get(gems)[0], 'shared template geometry is never written');
const data = gems.geometry.attributes.pickGem, pos = gems.geometry.attributes.position;
const arms = new Map();
for (let i = 0; i < data.count; i++) if (data.getZ(i) === PICK_GEM_KINDS.arm) arms.set(Math.abs(pos.getX(i)).toFixed(2), data.getX(i));
const ordered = [...arms.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
for (let i = 1; i < ordered.length; i++) assert.ok(ordered[i] >= ordered[i - 1] - 1e-6, 'arm shards ignite from the eye outward');
for (const charge of [0, .3, .7, 1]) indicator.update({specialReady: charge, time: charge * 4});
indicator.dispose();
visual.traverse(o => { if (authored.has(o)) { assert.equal(o.geometry, authored.get(o)[0], `${o.name} geometry restored`); assert.equal(o.material, authored.get(o)[1], `${o.name} material restored`); } });
console.log(`pick-luminance: gem discovery, charge order, budget and restore pass (${((performance.now() - start) / 1000).toFixed(3)}s)`);
