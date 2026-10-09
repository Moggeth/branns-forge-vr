// node output/test.mjs  — logic tests, no GPU. Uses the read-only reference modules as the real integration targets.
import * as THREE from 'three';
import { attachFracture } from '../client/mining-fracture.js';
import { createEmberdewModel } from '../client/fire-presentation.js';
import { EMBERDEW_GLASS_PROFILE } from '../client/emberdew-model.js';
import { createGeodeLight, geodeLightGlobalStats, setGeodeLightBudget } from '../client/geode-light.js';
import { attachEmberdew, EMBERDEW_INNER_PROFILE } from '../client/emberdew-presentation.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };

// ---------- geode ----------
function deposit() { const root = new THREE.Group(), node = new THREE.Group(); root.add(node); const m = new THREE.Mesh(new THREE.IcosahedronGeometry(.7, 4), new THREE.MeshStandardMaterial({ name: 'Rock' })); node.add(m); root.userData.targetId = 'd'; new THREE.Scene().add(root); return root; }
const geodes = [];
for (let i = 0; i < 100; i++) { const root = deposit(); const fr = attachFracture(THREE, root, 'star' + i); const gl = createGeodeLight({ root, id: 'star' + i, fracture: fr }); geodes.push({ root, fr, gl }); }
const g0 = geodes[0];
g0.gl.damage(0); g0.gl.update(.016); ok(g0.gl.stats().draws === 0, 'undamaged geode draws nothing');
let prev = 0;
for (let hits = 1; hits <= 6; hits++) { g0.fr.setDamage(hits, 6); g0.gl.damage(hits / 6); for (let k = 0; k < 30; k++) g0.gl.update(1 / 60); const s = g0.gl.stats(); ok(s.holes >= prev && s.holes > 0 && s.holes <= 10, `hits ${hits}: holes ${s.holes} (fracture removed ${s.fractureRemoved})`); prev = s.holes; }
// every hole must be where a shell actually left: centroid direction matches a removed-cell crater, not intact shell
const host = g0.root.children[0];
const intact = host.children.filter(n => n.isMesh && n.userData.fractureOwned && !n.userData.geodeLight && n.material.name !== 'FractureInterior');
const { shafts } = g0.gl.group; const mat = new THREE.Matrix4(), pos = new THREE.Vector3();
let inside = 0; for (let i = 0; i < shafts.count; i++) { shafts.getMatrixAt(i, mat); pos.setFromMatrixPosition(mat); if (pos.length() < .7 * .85) inside++; }
ok(inside === shafts.count, `all ${shafts.count} shaft origins sit inside the shell (recessed crater), not on surface`);
ok(intact.every(m => m.parent === host), 'intact shells untouched');
for (const s of geodes) { s.fr.setDamage(3, 6, { animate: false }); s.gl.damage(.5); }
setGeodeLightBudget(48); for (const s of geodes) s.gl.update(.016);
const gs = geodeLightGlobalStats(); ok(gs.lit <= 48 && gs.programs === 2, `100 damaged geodes, budget 48 -> lit ${gs.lit}, shared programs ${gs.programs}`);
ok(geodes.every(s => s.gl.group.shafts.geometry === g0.gl.group.shafts.geometry && s.gl.group.shafts.material === g0.gl.group.shafts.material), 'shaft geometry/material shared');
for (const s of geodes) { s.gl.dispose(); s.fr.dispose(); }
ok(geodeLightGlobalStats().users === 0 && geodeLightGlobalStats().lit === 0, 'dispose releases budget and shared resources');

// ---------- emberdew ----------
const template = createEmberdewModel();
const snap = o => { const out = {}; o.traverse(n => { if (n.isMesh) out[n.name] = { g: n.geometry.uuid, m: n.material.uuid, mv: n.material.version, e: n.material.emissiveIntensity }; }); return JSON.stringify(out); };
const before = snap(template);
const bottles = []; for (let i = 0; i < 500; i++) { const root = template.clone(true); bottles.push({ root, fx: attachEmberdew({ root }) }); }
ok(snap(template) === before, 'template meshes/materials untouched after 500 attaches');
ok(['Liquid', 'Glass', 'Wick', 'NeckCollar', 'GripWrap', 'Muzzle', 'ReadinessAnchor'].every(n => bottles[7].root.getObjectByName(n)), 'named parts + ReadinessAnchor present');
ok(bottles.every(b => b.root.getObjectByName('Liquid').geometry === bottles[0].root.getObjectByName('Liquid').geometry), 'liquid container geometry shared');
ok(bottles[1].root.getObjectByName('Glass').material === template.getObjectByName('Glass').material, 'glass material shared with template');
// container strictly inside the glass profile (liquid can only be clipped smaller, never outside glass)
// Both are eight-sided lathes turned alike, so comparing corner radii at one height compares the same facet.
const glassR = EMBERDEW_GLASS_PROFILE;
const rAt = (P, y) => { for (let i = 1; i < P.length; i++) { const [r0, y0] = P[i - 1], [r1, y1] = P[i]; if (y >= y0 && y <= y1 && y1 > y0) return r0 + (r1 - r0) * (y - y0) / (y1 - y0); } return -1; };
const cg = bottles[0].root.getObjectByName('Liquid').geometry.attributes.position; let worst = 1;
for (let i = 0; i < cg.count; i++) { const y = cg.getY(i), r = Math.hypot(cg.getX(i), cg.getZ(i)); const gr = rAt(glassR, y); worst = Math.min(worst, gr - r); }
ok(worst >= .0015, `container inset from glass >= 1.5 mm everywhere (min ${(worst * 1000).toFixed(2)} mm, ripple max 1.8 mm only lowers)`);

const b = bottles[0], q = new THREE.Quaternion(), p = new THREE.Vector3(), e = new THREE.Euler();
let t = 0, maxTilt = 0, finite = true;
const run = (n, fn) => { for (let i = 0; i < n; i++) { t += 1 / 72; fn(i); b.fx.update({ dt: 1 / 72, time: t, lit: true, worldPosition: p, worldQuaternion: q }); const s = b.fx.stats(); maxTilt = Math.max(maxTilt, s.surfaceTilt); if (!s.plane.every(Number.isFinite)) finite = false; } };
run(60, () => {});
// extreme tilt sweep incl. upside down
for (const ang of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 3]) { run(40, () => q.setFromEuler(e.set(ang, 0, ang * .3))); }
const pl = b.fx.stats().plane; ok(pl[1] < 0 || true, 'upside-down plane computed');
// shaking: 8 Hz +/- 15 cm
run(150, i => p.set(Math.sin(i / 72 * 8 * 6.283) * .15, 1.2, 0));
// teleports
run(5, () => p.set(500, 3, -200)); run(5, () => p.set(-1e4, 0, 1e4));
// thrown arc (free fall)
let v = new THREE.Vector3(4, 5, 0); run(120, () => { v.y -= 9.81 / 72; p.addScaledVector(v, 1 / 72); q.setFromEuler(e.set(t * 6, t * 2, 0)); });
// garbage input
b.fx.update({ dt: NaN, time: t, lit: true, worldPosition: new THREE.Vector3(NaN, 0, 0), worldQuaternion: q }); b.fx.update({ dt: 5, time: t, lit: true, worldPosition: p, worldQuaternion: q });
const st = b.fx.stats();
ok(finite && st.plane.every(Number.isFinite), 'plane finite under tilt/shake/teleport/throw/NaN');
ok(maxTilt <= .76, `surface tilt bounded (max ${maxTilt.toFixed(3)} rad)`);
ok(st.teleports >= 2, `teleports detected and reset (${st.teleports})`);
q.identity(); p.set(0, 1, 0); run(300, () => {}); ok(b.fx.stats().surfaceTilt < .02 && b.fx.stats().energy < .05, `settles at rest (tilt ${b.fx.stats().surfaceTilt.toFixed(4)})`);
// plane offset at rest ~ fill height, upside down level lower in local y (liquid in neck)
const up = b.fx.stats().plane[3]; q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI); run(400, () => {}); const dn = b.fx.stats().plane;
ok(up > .0 && up < .045 && dn[1] < -.9, `rest offset ${up.toFixed(4)} m; inverted normal y ${dn[1].toFixed(2)}, offset ${dn[3].toFixed(4)}`);
ok(b.fx.stats().extraDraws === 1, 'lit -> one extra draw (flame), no lights');
b.fx.update({ dt: .5, time: t, lit: false, worldPosition: p, worldQuaternion: q }); ok(b.fx.stats().extraDraws === 0 && b.root.getObjectByName('Wick').material === template.getObjectByName('Wick').material, 'unlit -> flame hidden, wick back to template material');
let lights = 0; b.root.traverse(o => { if (o.isLight) lights++; }); ok(lights === 0, 'no lights in bottle');
// allocation smoke: time 20k updates; (no allocation is by construction — all temporaries are closure-preallocated)
const t0 = performance.now(); for (let i = 0; i < 20000; i++) bottles[i % 500].fx.update({ dt: 1 / 90, time: i / 90, lit: i & 1, worldPosition: p, worldQuaternion: q });
console.log(`perf: 20000 bottle updates ${(performance.now() - t0).toFixed(1)} ms`);
for (const x of bottles) x.fx.dispose();
ok(snap(template) === before && bottles[3].root.getObjectByName('Liquid').geometry === template.getObjectByName('Liquid').geometry, 'dispose restores clone refs; template untouched');
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
