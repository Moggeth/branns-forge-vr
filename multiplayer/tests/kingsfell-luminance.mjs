import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {prepareAsset} from '../client/asset-pose.js';
import {createWeaponReadiness} from '../client/weapon-readiness.js';
import {enhanceKingsfellTemplate, kingsfellFrame, veinLit, heartLit, edgeThreshold, heartbeat, KINGSFELL_SCHEDULE} from '../client/kingsfell-luminance.js';
import {createAxeReadyCue} from '../client/axe-ready-cue.js';

const start = performance.now();
// Node has no image decoder: drop embedded textures, keep meshes, nodes and material factors.
function untextured(url) {
  const buf = readFileSync(url), jsonLength = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'));
  delete json.images; delete json.textures; delete json.samplers;
  for (const m of json.materials || []) { delete m.pbrMetallicRoughness?.baseColorTexture; delete m.pbrMetallicRoughness?.metallicRoughnessTexture; delete m.normalTexture; delete m.emissiveTexture; }
  let text = Buffer.from(JSON.stringify(json)); text = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 0x20)]);
  const rest = buf.subarray(20 + jsonLength), out = Buffer.alloc(20 + text.length + rest.length);
  out.write('glTF', 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8); out.writeUInt32LE(text.length, 12); out.writeUInt32LE(0x4e4f534a, 16);
  text.copy(out, 20); rest.copy(out, 20 + text.length);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.length);
}
const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(untextured(new URL('../public/assets/axe.glb', import.meta.url)), '', resolve, reject));
const materialsBefore = new Set(); gltf.scene.traverse(o => o.isMesh && materialsBefore.add(o.material));

// Kingsfell's named parts: the luminance and the pose rely on them.
for (const name of ['Head_Blade', 'Head_CuttingEdge', 'Heart_Amber', 'Veins_Gold', 'Grip_Center', 'Heartstone', 'CuttingEdge_Top', 'CuttingEdge_Mid', 'CuttingEdge_Bottom'])
  assert.ok(gltf.scene.getObjectByName(name), `${name} present`);
let tris = 0; gltf.scene.traverse(o => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
assert.ok(tris < 9000, `phone-safe triangle count (${tris})`);

// The fitted arc matches the authored edge, and the heartstone sits inside the blade, behind the edge.
gltf.scene.updateWorldMatrix(true, true);
const frame = kingsfellFrame(gltf.scene);
assert.ok(frame, 'edge frame fits');
assert.ok(frame.apex - frame.bevel > .01 && frame.apex - frame.bevel < .1, `bevel width ${(frame.apex - frame.bevel).toFixed(3)}`);
assert.ok(frame.span > .4 && frame.span < 1.4, `edge span ${frame.span.toFixed(3)} rad`);
assert.ok(frame.heart.distanceTo(frame.center) < frame.bevel, 'heartstone inside the blade');

assert.equal(enhanceKingsfellTemplate(gltf.scene), true);
assert.equal(enhanceKingsfellTemplate(gltf.scene), false, 'template patch is idempotent');
assert.equal(gltf.scene.userData.kingsfellLuminance.materials, 4, 'edge, ring steel, veins and heartstone patched');
const after = new Set(); gltf.scene.traverse(o => o.isMesh && after.add(o.material));
assert.deepEqual([...after], [...materialsBefore], 'template keeps the same shared material objects');

// Ignition order: the heart wakes first, the veins fill from heart to edge, then the edge lights middle → horns.
assert.ok(heartLit(.25) > .95 && heartLit(0) < .2, 'heart lights early in the recharge');
assert.ok(veinLit(0, .3) > veinLit(1, .3), 'veins fill from the heart outward');
assert.ok(veinLit(1, .86) > .95, 'veins reach the edge as it starts to light');
assert.ok(edgeThreshold(0) >= KINGSFELL_SCHEDULE.vein[0] + KINGSFELL_SCHEDULE.vein[1] - .01, 'edge after the veins');
assert.ok(edgeThreshold(0) < edgeThreshold(1) && edgeThreshold(1) <= 1, 'edge sweeps middle → horns and completes on ready');
const beats = Array.from({length: 160}, (_, i) => heartbeat(i / 100));
assert.ok(Math.max(...beats) > .9 && Math.min(...beats) < .05, 'heartbeat thumps and rests');
assert.ok(Math.abs(heartbeat(.3) - heartbeat(1.9)) < 1e-9, 'heartbeat period 1.6 s');

// Held axe: private materials, at most one extra draw (the edge ribbon), all restored on dispose.
const {visual} = prepareAsset(gltf, 'axe', .7);
const holder = new THREE.Group(); holder.position.set(2, 1, -3); holder.rotation.y = .7; holder.add(visual); holder.updateWorldMatrix(true, true);
const authored = new Map(); visual.traverse(o => o.isMesh && authored.set(o, o.material));
const indicator = createWeaponReadiness({root: visual, tool: 'axe'});
assert.ok(indicator.drawCalls <= 3, `axe readiness draws ${indicator.drawCalls}`);
let edgeMesh; visual.traverse(o => { if (o.name === 'Head_CuttingEdge') edgeMesh = o; });
assert.notEqual(edgeMesh.material, authored.get(edgeMesh), 'held axe has its own edge material');
for (const charge of [1, 0, .3, .7, 1]) indicator.update({specialReady: charge, time: charge * 4, focus: charge > .5 ? 1 : 0});
indicator.dispose();
visual.traverse(o => { if (authored.has(o)) assert.equal(o.material, authored.get(o), `${o.name} material restored`); });

// Ready cue: once per recharge, only on the axe, never on equip.
let ticks = 0; const cue = createAxeReadyCue({haptic: () => ticks++});
const fired = [['axe', 1], ['axe', 0], ['axe', .6], ['axe', 1], ['axe', 1], ['pick', 0], ['axe', 1], ['axe', 0], [null, 1], ['axe', 1]].map(([t, v]) => cue.update(t, v));
assert.deepEqual(fired, [false, false, false, true, false, false, false, false, false, false]);
assert.equal(ticks, 1);
console.log(`kingsfell-luminance: parts, edge frame, ignition order, heartbeat, budget, restore and ready cue pass (${((performance.now() - start) / 1000).toFixed(3)}s)`);
