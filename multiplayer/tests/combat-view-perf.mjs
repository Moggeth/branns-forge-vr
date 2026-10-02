import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {prepareAsset} from '../client/asset-pose.js';
import {createCombatView} from '../client/combat-view.js';
// 2026-10-02 measured baseline: 8.3255792 s / 1,096 hits. Recomputing every
// skinned bound and all part poses for each ray was the bottleneck. A per-frame
// cache plus exact posed-box rejection measured 0.7899967 s / 1,096 hits.
// Invalidate on every tick and snapshot; never reuse animated bounds across
// frames. This is a CPU batch benchmark, not an XR framerate claim.
const bytes = readFileSync(new URL('../public/assets/skeleton.glb', import.meta.url));
const template = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const scene = new THREE.Scene(), actors = new Map();
for (let i = 0; i < 32; i++) {
  const root = new THREE.Group(), visual = prepareAsset(template, 'skeleton').visual;
  root.position.set((i % 8 - 3.5) * 3, 0, (Math.floor(i / 8) - 1.5) * 3); root.add(visual); scene.add(root);
  actors.set(`e:${i}`, {root, visual, enemy: true, data: {id: String(i)}});
}
const view = createCombatView({scene, actors, templates: new Map()});
scene.updateMatrixWorld(true);
const start = performance.now(); let hits = 0;
for (let i = 0; i < 64; i++) hits += view.segmentContacts([(i % 8 - 3.5) * 3, .25 + Math.floor(i / 8) * .19, 12], [(i % 8 - 3.5) * 3, .25 + Math.floor(i / 8) * .19, -12]).length;
console.log(JSON.stringify({actors: 32, rays: 64, hits, elapsedSeconds: (performance.now() - start) / 1000}));
view.dispose();
