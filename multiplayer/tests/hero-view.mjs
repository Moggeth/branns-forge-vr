// node tests/hero-check.mjs  — GLB contract + hero-view.js adapter behaviour (no GPU, no network).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createHeroView, heroSocket, HERO_PALETTES, heroVariant} from '../client/hero-view.js';

const here = path.dirname(fileURLToPath(import.meta.url)), OUT = path.join(here, '..', 'public', 'assets');
const fail = [], ok = (c, m) => { if (!c) fail.push(m); };
const parse = file => new Promise((res, rej) => { const b = fs.readFileSync(path.join(OUT, file));
  new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', res, rej); });
const tris = root => { let n = 0; root.traverse(o => { if (o.isMesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }); return n; };
const mats = root => { const s = new Set(); root.traverse(o => o.material && s.add(o.material.name)); return s; };
const t0 = performance.now();
const hero = await parse('hero.glb'), lod = await parse('hero_lod.glb'), hands = await parse('hero_hands.glb');
const report = {bytes: {}, triangles: {}, clips: {}};
for (const f of ['hero.glb', 'hero_lod.glb', 'hero_hands.glb']) { report.bytes[f] = fs.statSync(path.join(OUT, f)).size; ok(report.bytes[f] <= 2 * 1024 * 1024, `${f} > 2 MB`); }
const H = n => hero.scene.getObjectByName(n);
report.triangles.high = tris(H('HeroBody')) + tris(H('HeroHead'));
report.triangles.low = tris(H('HeroBody_LOD'));
report.triangles.lodFile = tris(lod.scene); report.triangles.gloves = tris(hands.scene);
ok(report.triangles.high <= 12000, 'high LOD > 12k tris'); ok(report.triangles.low <= 3000, 'low LOD > 3k tris');
ok(report.triangles.lodFile === report.triangles.low, 'hero_lod.glb differs from embedded LOD');
report.materials = [...mats(hero.scene)];
{ const g = mats(hands.scene); ok(g.has('HeroLeather') && g.has('HeroSkin') && g.size <= 4, `glove materials ${[...g]}`); }
ok(mats(H('HeroHead')).has('HeroLeather'), 'head lost its leather hair tie'); ok(report.materials.length <= 6, '> 6 materials');
for (const n of ['Head', 'Hand.L', 'Hand.R', 'WeaponGrip']) ok(heroSocket(hero.scene, n) && heroSocket(lod.scene, n), `missing socket ${n}`);
for (const n of ['GripAnchor.L', 'GripAnchor.R', 'Glove.L', 'Glove.R']) ok(heroSocket(hands.scene, n), `gloves missing ${n}`);
for (const c of hero.animations) report.clips[c.name] = +c.duration.toFixed(3);
for (const n of ['Idle', 'Walk', 'Run', 'Attack', 'Hit']) ok(report.clips[n] > 0, `missing clip ${n}`);
for (const [n, sec] of [['Idle', 2], ['Walk', 1], ['Run', 16 / 24]]) ok(Math.abs(report.clips[n] - sec) < 1e-3, `${n} loop length ${report.clips[n]} != ${sec} (seam hitch)`);
for (const n of ['Idle', 'Walk', 'Run']) { const c = hero.animations.find(a => a.name === n); for (const t of c.tracks) { const k = t.values.length / t.times.length;
  const first = t.values.slice(0, k), last = t.values.slice(-k); ok(first.every((v, i) => Math.abs(v - last[i]) < 1e-4), `${n} ${t.name} does not loop`); } }
// Axes: +Y up, feet at 0, ~1.75 m, -Z forward (toes and nose ahead of the heels/ponytail).
hero.scene.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(H('HeroBody')).union(new THREE.Box3().setFromObject(H('HeroHead')));
report.bounds = {min: box.min.toArray().map(v => +v.toFixed(3)), max: box.max.toArray().map(v => +v.toFixed(3))};
ok(Math.abs(box.min.y) < .02 && box.max.y > 1.7 && box.max.y < 1.8, `height ${box.max.y}`);
const p = n => heroSocket(hero.scene, n).getWorldPosition(new THREE.Vector3());
report.sockets = Object.fromEntries(['Head', 'Hand.L', 'Hand.R', 'WeaponGrip'].map(n => [n, p(n).toArray().map(v => +v.toFixed(3))]));
ok(p('Head').z < 0 && p('Head').y > 1.6, 'Head socket not forward eye height');
ok(p('Hand.R').x > 0 && p('Hand.L').x < 0, 'Hand.R must be +X (hero right with -Z forward)');
const gq = heroSocket(hero.scene, 'WeaponGrip').getWorldQuaternion(new THREE.Quaternion());
const haft = new THREE.Vector3(0, 1, 0).applyQuaternion(gq), edge = new THREE.Vector3(0, 0, -1).applyQuaternion(gq);
report.weaponGripRest = {haft: haft.toArray().map(v => +v.toFixed(3)), edge: edge.toArray().map(v => +v.toFixed(3))};
ok(haft.z < -.99 && edge.y < -.99, 'WeaponGrip rest axes (haft -Z, edge -Y)');

// Adapter: 8 heroes, shared materials, locomotion derive, hit from HP drop, VR reach, LOD, release/dispose.
const view = createHeroView(); view.install(hero);
const scene = new THREE.Scene(), cam = new THREE.Vector3(8, 1.65, -14), entries = [];
for (let i = 0; i < 8; i++) { const root = new THREE.Group(); root.position.set(i * 3 - 10, 0, -4 - i * 2); scene.add(root);
  const data = {id: `p${i}`, role: 'hero', position: root.position.toArray(), yaw: i, hp: 100};
  if (i === 7) { data.head = {position: [0, 1.6, 0], quaternion: [0, 0, 0, 1]}; data.hands = [{position: [-.25, 1.2, -.35], quaternion: [0, 0, 0, 1]}, {position: [.3, 1.3, -.4], quaternion: [0, 0, 0, 1]}]; }
  const visual = view.create(data); root.add(visual); entries.push({root, visual, data}); }
ok(view.stats().materials === Object.keys(HERO_PALETTES).length * report.materials.length, 'materials not shared per palette');
let shared = new Set(); scene.traverse(o => o.material && shared.add(o.material)); report.uniqueMaterialsIn8Heroes = shared.size;
ok(shared.size <= 12, 'heroes copied materials');
report.variants = entries.map(e => e.visual.userData.variant);
ok(new Set(report.variants).size === 2, 'expected both variants among 8 ids');
const dt = 1 / 60, tUpd = performance.now();
for (let f = 0; f < 600; f++) { for (const [i, e] of entries.entries()) {
  if (i < 4) e.root.position.z -= (i < 2 ? 1.5 : 4.5) * dt;               // walkers / runners
  if (f === 300 && i === 5) e.data = {...e.data, hp: 80};                     // authoritative damage
  e.root.updateMatrixWorld(true); view.update(e.visual, e.data, e.root, dt, cam); } }
report.updateMsPerFrame8 = +((performance.now() - tUpd) / 600).toFixed(3);
const w = e => Object.fromEntries(Object.entries(e.visual.userData.heroActions).map(([k, a]) => [k, +a.getEffectiveWeight().toFixed(2)]));
report.weights = {walker: w(entries[0]), runner: w(entries[2]), idle: w(entries[4])};
ok(report.weights.walker.Walk > .9, 'walker not walking'); ok(report.weights.runner.Run > .9, 'runner not running'); ok(report.weights.idle.Idle > .99, 'idle not idle');
ok(entries[5].visual.userData.heroActions.Hit.time > 0, 'HP drop did not play Hit');
ok(entries[0].visual.userData.heroActions.Attack.isRunning() === false, 'Attack must not autoplay (no authoritative swing state)');
const palm = entries[7].visual.userData.bones.PalmR.getWorldPosition(new THREE.Vector3());
report.vrPalmR = palm.toArray().map(v => +v.toFixed(3)); ok(palm.toArray().every(Number.isFinite), 'VR reach NaN');
const gripW = heroSocket(entries[7].visual, 'WeaponGrip').getWorldPosition(new THREE.Vector3());
const wantW = new THREE.Vector3(.3, 1.3, -.4).add(entries[7].root.position);
report.vrGripErrorM = +gripW.distanceTo(wantW).toFixed(3);
ok(report.vrGripErrorM < .03, 'VR WeaponGrip misses tracked grip');
report.lod = entries.map(e => e.visual.userData.lod);
for (const e of entries) view.release(e.visual);
ok(view.stats().live === 0, 'release leaked'); view.dispose(); ok(!view.ready(), 'dispose');
report.seconds = +((performance.now() - t0) / 1000).toFixed(3);
console.log(JSON.stringify(report, null, 1));
if (fail.length) { console.error('FAIL', fail); process.exit(1); } else console.log('HERO_CHECK_OK');
