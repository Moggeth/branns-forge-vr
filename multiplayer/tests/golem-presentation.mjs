// Geode golem presentation on the real golem.glb: per-golem crystal light, cues from the shared motion layer, bounded
// ground effects, rumble ownership and the death fade. No WebGL or audio context needed.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {prepareAsset} from '../client/asset-pose.js';
import {applyEnemyMotion} from '../client/enemy-motion.js';
import {createGolemPresentation} from '../client/golem-presentation.js';

const started = performance.now(), data = await readFile(new URL('../public/assets/golem.glb', import.meta.url));
const loader = new GLTFLoader(); loader.register(() => ({name: 'NoImages', loadTexture: () => Promise.resolve(null)}));
const template = await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');

// The asset contract the runtime relies on: three shared materials, crystals on the core, and the armour/limb names.
const materials = new Set(); let triangles = 0;
template.scene.traverse(n => { if (n.isMesh) { for (const m of [n.material].flat()) materials.add(m.name); triangles += n.geometry.index.count / 3; } });
assert.deepEqual([...materials].sort(), ['Crystal', 'Iron', 'Stone']);
assert.ok(triangles < 18000, `triangle budget ${triangles}`);
assert.ok(data.byteLength < 3e6, `golem.glb stays phone-sized ${data.byteLength}`);
for (const n of ['Golem', 'BodyCore', 'CoreGlow', 'ChestPlate', 'Head', 'ArmL', 'ArmR', 'ElbowL', 'ElbowR', 'ShoulderL', 'ShoulderR', 'ForearmL', 'ForearmR', 'LegL', 'LegR'])
  assert.ok(template.scene.getObjectByName(n), n);
const core = template.scene.getObjectByName('CoreGlow'), coreMat = [core.children[0]?.material || core.material].flat()[0];
assert.equal(coreMat.name, 'Crystal');

const scene = new THREE.Scene(), rumbles = [];
const fx = createGolemPresentation({scene, height: () => 0, haptic: (a, ms) => rumbles.push([a, ms]), listener: () => ({position: [0, 1.6, 4], forward: [0, 0, -1], up: [0, 1, 0]})});
function golem(id, x) {
  const {visual} = prepareAsset(template, 'golem', 2.8), root = new THREE.Group(); root.add(visual); root.position.x = x; scene.add(root);
  return {enemy: true, visual, root, data: {id, kind: 'golem', hp: 320, armor: 3, missingParts: [], attackTick: -1000}};
}
const a = golem('g1', 0), b = golem('g2', 3), actors = new Map([['e:g1', a], ['e:g2', b]]);
const crystalOf = e => { let m = null; e.visual.traverse(n => { if (n.isMesh) for (const x of [n.material].flat()) if (x.name === 'Crystal') m = x; }); return m; };
function frame(tick) { for (const e of actors.values()) applyEnemyMotion(e, {tick, dt: 1 / 60, height: () => 0}); fx.update(actors, tick, 1 / 60, tick / 60); }

frame(0); frame(1);
assert.notEqual(crystalOf(a), crystalOf(b), 'each golem owns its crystal light');
assert.notEqual(crystalOf(a), coreMat, 'the shared template material is never driven');
const calm = crystalOf(a).emissiveIntensity;
a.data.attackTick = 10;
for (let t = 2; t < 22; t++) frame(t);
assert.ok(crystalOf(a).emissiveIntensity > calm + 1, `telegraph flares the crystals ${calm} -> ${crystalOf(a).emissiveIntensity}`);
assert.ok(crystalOf(b).emissiveIntensity < calm + .5, 'other golems are unaffected');
for (let t = 22; t < 30; t++) frame(t);
let s = fx.stats();
assert.equal(s.slams, 1); assert.equal(s.telegraphs, 1); assert.ok(s.rings === 1 && s.puffs >= 10, JSON.stringify(s));
assert.ok(rumbles.some(([amp]) => amp > .3), 'a nearby slam rumbles the local Hero');

// Walking: footfalls kick dust; budget stays bounded however long the golems walk.
for (let t = 30; t < 900; t++) { a.root.position.z -= 1.25 / 60; b.root.position.z -= 1.25 / 60; frame(t); }
s = fx.stats();
assert.ok(s.steps > 20, `footfalls ${s.steps}`); assert.ok(s.puffs <= 48 && s.rings <= 6);

// Hit stutter and the death fade.
b.data.hurtTick = 900; frame(900); frame(901);
fx.handleEvent({kind: 'death', id: 'g1', creature: 'golem', position: [0, 0, 0]}); actors.delete('e:g1');
const flare = crystalOf(a).emissiveIntensity;
for (let t = 902; t < 1100; t++) frame(t);
assert.ok(crystalOf(a).emissiveIntensity < .3 && flare >= crystalOf(a).emissiveIntensity, `remains gutter ${flare} -> ${crystalOf(a).emissiveIntensity}`);
assert.equal(fx.stats().breaks, 1);
fx.handleEvent({kind: 'detach', sourceId: 'unknown', position: [0, 0, 0]});
assert.equal(fx.stats().breaks, 1, 'skeleton limbs are not golem breaks');
fx.dispose();
console.log(JSON.stringify({suite: 'golem-presentation', ok: true, triangles, bytes: data.byteLength, stats: s, seconds: (performance.now() - started) / 1000}));
