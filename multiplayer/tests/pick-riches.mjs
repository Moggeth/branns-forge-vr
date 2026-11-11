import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {enhancePickTemplate, PICK_FX} from '../client/pick-luminance.js';
import {createPickRiches, RICHES} from '../client/pick-riches.js';

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
// The presentation finds these by name; renaming them in the builder would silently kill the effects.
for (const name of ['StonewhisperPick', 'Heart', 'Crown', 'Charm', 'PickTipRight', 'PickTipLeft', 'Grip', ...Array.from({length: 12}, (_, i) => `Gauge${i}`)])
  if (name !== 'StonewhisperPick') assert.ok(gltf.scene.getObjectByName(name), `pick.glb has ${name}`);
enhancePickTemplate(gltf.scene);

const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(70, 16 / 9, .05, 500);
scene.add(camera); const holder = new THREE.Group(); holder.name = 'StonewhisperPick'; holder.add(gltf.scene); camera.add(holder); holder.position.set(.3, -.3, -.6);
const fx = createPickRiches({scene, camera, realLight: true});
const sun = new THREE.Vector3(.3, 1, .2).normalize(), player = new THREE.Vector3();
let time = 0;
const step = (frames, extra = {}) => { for (let i = 0; i < frames; i++) { time += 1 / 60; scene.updateMatrixWorld(true); fx.update({time, dt: 1 / 60, charge: 0, shown: true, swinging: false, moving: false, sun, night: 0, deposits: [], player, vr: false, ...extra}); } };

// Before attach nothing throws and nothing spawns.
step(5); fx.strike({material: 'stone', kind: 'stone', point: [0, 0, -1], normal: [0, 0, 1]});
fx.attach(holder);
step(60);
const idle = fx.stats();
assert.ok(idle.particles <= RICHES.pool, 'particle pool bounded');
assert.ok(idle.light > 0, 'held pick gives light');

// Strike on stone: seam runs, particles burst, heat rises; earth gives far less.
fx.strike({material: 'stone', kind: 'stone', point: new THREE.Vector3(0, 0, -1.2), normal: [0, 0, 1], rich: true});
step(3);
const hit = fx.stats();
assert.ok(hit.seam, 'stone strike starts the seam pulse');
assert.ok(hit.particles > idle.particles + 8, `strike sprays shards (${idle.particles} -> ${hit.particles})`);
assert.ok(PICK_FX.uPickHeat.value.x > 0 || PICK_FX.uPickHeat.value.y > 0, 'points heat up');
step(120);
assert.equal(fx.stats().seam, false, 'seam pulse ends');

// Many strikes never overflow the pool or produce NaN.
for (let i = 0; i < 40; i++) { fx.strike({material: 'crystal', kind: 'crystal', point: [0, 0, -1], normal: [0, 1, 0], rich: true}); step(1); }
assert.ok(fx.stats().particles <= RICHES.pool);
const m = new THREE.Matrix4(); const particles = scene.getObjectByName('pick-riches:particles');
for (let i = 0; i < particles.count; i++) { particles.getMatrixAt(i, m); assert.ok(m.elements.every(Number.isFinite), 'finite particle matrix'); }

// Dowsing: a near deposit quickens the gems; depleted deposits are ignored.
step(240, {deposits: [{x: 2, z: 0, kind: 'gold', depleted: false}]});
assert.ok(fx.stats().dowse > 0, 'dowses toward a nearby deposit');
step(240, {deposits: [{x: 2, z: 0, kind: 'gold', depleted: true}]});
assert.ok(fx.stats().dowse < .05, 'depleted deposits are ignored');

// Night brightens the light; hidden pick goes dark.
step(120, {night: 1}); const night = fx.stats().light;
step(120, {night: 0}); assert.ok(night > fx.stats().light, 'brighter at night');
step(60, {shown: false}); assert.ok(!(fx.stats().light > .01), 'no light while the pick is put away');

// Admire idle after standing still, cancelled by moving.
for (let i = 0; i < 60 * (RICHES.admire.after + RICHES.admire.rest + 2) && !fx.stats().admiring; i++) step(1); // may still be resting from an earlier admire
assert.ok(fx.stats().admiring, 'admires after standing still');
step(30); assert.ok(fx.pose(), 'admire supplies a pose layer');
step(2, {moving: true}); step(60, {moving: true});
assert.ok(!fx.stats().admiring, 'moving ends the admire');

const before = scene.children.length; fx.dispose();
assert.ok(scene.children.length < before, 'dispose removes particles and glints');
assert.equal(PICK_FX.uPickBeat.value, 0);
console.log('pick-riches: ok', JSON.stringify(hit));
