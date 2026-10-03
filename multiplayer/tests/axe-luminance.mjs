import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {prepareAsset} from '../client/asset-pose.js';
import {createWeaponReadiness} from '../client/weapon-readiness.js';
import {enhanceAxeTemplate, axeEdgeFrame, axeLit, axeFlow, edgeThreshold, AXE_SCHEDULE} from '../client/axe-luminance.js';
import {createAxeReadyCue} from '../client/axe-ready-cue.js';

const start = performance.now();
// Node has no image decoder: drop embedded textures, keep meshes, nodes and material factors.
function untextured(url) {
  const buf = readFileSync(url), jsonLength = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'));
  delete json.images; delete json.textures; delete json.samplers;
  for (const m of json.materials || []) { delete m.pbrMetallicRoughness?.baseColorTexture; delete m.pbrMetallicRoughness?.metallicRoughnessTexture; delete m.normalTexture; }
  let text = Buffer.from(JSON.stringify(json)); text = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 0x20)]);
  const rest = buf.subarray(20 + jsonLength), out = Buffer.alloc(20 + text.length + rest.length);
  out.write('glTF', 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8); out.writeUInt32LE(text.length, 12); out.writeUInt32LE(0x4e4f534a, 16);
  text.copy(out, 20); rest.copy(out, 20 + text.length);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.length);
}
const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(untextured(new URL('../public/assets/axe.glb', import.meta.url)), '', resolve, reject));
const materialsBefore = new Set(); gltf.scene.traverse(o => o.isMesh && materialsBefore.add(o.material));

// The edge and cheek shaders work in mesh-local space: those meshes must stay untransformed in the edge frame.
for (const name of ['Head_Blade', 'Head_CuttingEdge']) {
  const o = gltf.scene.getObjectByName(name);
  assert.deepEqual(o.position.toArray(), [0, 0, 0], name); assert.deepEqual(o.quaternion.toArray(), [0, 0, 0, 1], name); assert.deepEqual(o.scale.toArray(), [1, 1, 1], name);
}

// The fitted arc matches the authored edge: every honed-edge vertex lies between bevel and apex, apex ≈ the markers.
gltf.scene.updateWorldMatrix(true, true);
const frame = axeEdgeFrame(gltf.scene);
const mid = gltf.scene.getObjectByName('CuttingEdge_Mid').position;
assert.ok(Math.abs(frame.center.distanceTo(new THREE.Vector2(mid.x, mid.y)) - frame.apex) < .004, 'edge arc passes through the authored edge markers');
assert.ok(frame.apex - frame.bevel > .02 && frame.apex - frame.bevel < .08, `bevel width ${(frame.apex - frame.bevel).toFixed(3)}`);
assert.ok(frame.span > .4 && frame.span < 1, `edge span ${frame.span.toFixed(3)} rad`);

assert.equal(enhanceAxeTemplate(gltf.scene), true);
assert.equal(enhanceAxeTemplate(gltf.scene), false, 'template patch is idempotent');
assert.equal(gltf.scene.userData.axeLuminance.materials, 4, 'edge, cheek, brass and forged steel patched');
const after = new Set(); gltf.scene.traverse(o => o.isMesh && after.add(o.material));
assert.deepEqual([...after], [...materialsBefore], 'template keeps the same shared material objects');

// Ignition order: blossom → vine (blossom end first) → edge line (vine end first) → honed edge (middle first).
const channel = name => gltf.scene.getObjectByName(name).geometry.attributes.axeChannel;
assert.ok(channel('Ferrule_Brass_Pommel').array.every((v, i) => i % 2 || v < 0), 'non-inlay brass never carries the charge');
assert.equal(channel('Inlay_Brass_Blossom_PosY').getX(0), AXE_SCHEDULE.blossom[0]);
const vine = gltf.scene.getObjectByName('Inlay_Brass_Vine_PosY'), vt = channel('Inlay_Brass_Vine_PosY'), vp = vine.geometry.attributes.position;
let near = null, far = null;
for (let i = 0; i < vp.count; i++) { if (!near || vp.getX(i) < near[0]) near = [vp.getX(i), vt.getX(i)]; if (!far || vp.getX(i) > far[0]) far = [vp.getX(i), vt.getX(i)]; }
assert.ok(near[1] < far[1], 'vine fills from the blossom toward the edge');
const line = channel('Inlay_Brass_EdgeLine_NegY'), lineMax = Math.max(...Array.from({length: line.count}, (_, i) => line.getX(i)));
const vineMax = Math.max(...Array.from({length: vt.count}, (_, i) => vt.getX(i)));
assert.ok(lineMax > vineMax && lineMax <= edgeThreshold(0) + 1e-6, 'edge line fills after the vine and before the edge');
assert.ok(edgeThreshold(0) < edgeThreshold(1) && edgeThreshold(1) + AXE_SCHEDULE.edge[2] <= 1.02, 'edge sweeps middle → horns and completes on ready');
assert.ok(axeLit(.5, .05, .4) < .1 && axeLit(.5, .05, .6) === 1, 'a channel point lights only once the front reaches it');
assert.ok(axeFlow(.4, .05, .7) > .9 && axeFlow(.4, .05, 1) < .15, 'inlays hand their light to the edge when ready');

// Held axe: private materials, one extra draw, all restored on dispose.
const {visual} = prepareAsset(gltf, 'axe', .7);
const holder = new THREE.Group(); holder.position.set(2, 1, -3); holder.rotation.y = .7; holder.add(visual); holder.updateWorldMatrix(true, true);
const authored = new Map(); visual.traverse(o => o.isMesh && authored.set(o, o.material));
const indicator = createWeaponReadiness({root: visual, tool: 'axe'});
assert.ok(indicator.drawCalls <= 3, `axe readiness draws ${indicator.drawCalls}`);
let edgeMesh; visual.traverse(o => { if (o.name === 'Head_CuttingEdge') edgeMesh = o; });
assert.notEqual(edgeMesh.material, authored.get(edgeMesh), 'held axe has its own edge material');
assert.ok(materialsBefore.has(authored.get(edgeMesh)), 'clones still render the shared template material');
for (const charge of [1, 0, .3, .7, 1]) indicator.update({specialReady: charge, time: charge * 4});
indicator.dispose();
visual.traverse(o => { if (authored.has(o)) assert.equal(o.material, authored.get(o), `${o.name} material restored`); });

// Ready cue: once per recharge, only on the axe, never on equip.
let ticks = 0; const cue = createAxeReadyCue({haptic: () => ticks++});
const fired = [['axe', 1], ['axe', 0], ['axe', .6], ['axe', 1], ['axe', 1], ['pick', 0], ['axe', 1], ['axe', 0], [null, 1], ['axe', 1]].map(([t, v]) => cue.update(t, v));
assert.deepEqual(fired, [false, false, false, true, false, false, false, false, false, false]);
assert.equal(ticks, 1);
console.log(`axe-luminance: edge frame, ignition order, budget, restore and ready cue pass (${((performance.now() - start) / 1000).toFixed(3)}s)`);
