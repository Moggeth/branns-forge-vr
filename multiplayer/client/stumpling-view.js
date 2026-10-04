// Stumpling presentation (client only): a felled stump that got up on its roots. The body is the stump itself, wearing
// the variant's own bark and the shared end-grain cap, on four root legs, with blue resonance eyes and a sprout on top.
//
// Ownership: entry.root stays simulation-owned (position/yaw). This module poses only the critter's bones and inner
// groups. Bone names (StumpRoot, Torso, RootA..D, TwigL/R) all map to the 'torso' combat part, so every rendered
// triangle is a valid hit on the single rigid body the authority expects.
//
// Draw calls per critter: bark body + legs (1 skinned), end-grain cap (1), eyes (1), sprout/moss/mushroom (1).
// Geometry is shared per bark variant; only bones and the eye material are per critter. No lights.
import * as THREE from 'three';
import {STUMPLING, stumplingBurrowTick} from '../shared/stumplings.js';
import {VARIANTS} from '../shared/trees.js';
import {createParticles, softTexture, GLOW} from './ent-view.js';

const TAU = Math.PI * 2, clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v), smooth = t => { t = clamp(t); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const rnd = (seed, n) => { let h = Math.imul(seed ^ Math.imul(n | 0, 0x9e3779b1), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

// ---- Rest layout, metres, built facing +Z (the visual is turned to the sim's -Z facing). y0 = body base / Torso pivot.
const Y0 = .2, TOP = Y0 + .5, BODY = [[.36, Y0 - .04], [.33, Y0 + .02], [.285, Y0 + .12], [.27, Y0 + .32], [.265, TOP]];
const LEGS = [['RootA', .6, .45], ['RootB', 2.3, .5], ['RootC', 3.9, .48], ['RootD', 5.45, .5]]; // [bone, angle, reach]; A+C and B+D step together
const EYE_Y = Y0 + .36, EYES = [[-.095, .06], [.095, .067]];
const BONES = ['StumpRoot', 'Torso', 'RootA', 'RootB', 'RootC', 'RootD', 'TwigL', 'TwigR'];
const B = Object.fromEntries(BONES.map((n, i) => [n, i]));
const PARENT = {Torso: 'StumpRoot', RootA: 'StumpRoot', RootB: 'StumpRoot', RootC: 'StumpRoot', RootD: 'StumpRoot', TwigL: 'Torso', TwigR: 'Torso'};
const REST = {StumpRoot: [0, 0, 0], Torso: [0, Y0, 0], TwigL: [-.24, Y0 + .26, .08], TwigR: [.24, Y0 + .28, .08],
 ...Object.fromEntries(LEGS.map(([n, a]) => [n, [Math.cos(a) * .27, Y0 + .02, Math.sin(a) * .27]]))};

/** Skinned bark: one buffer for the body lathe, eye sockets, root legs, toes and twig arms, each rigidly on its bone. */
function buildBark(tint) {
 const P = [], UV = [], C = [], SI = [], SW = [], I = [];
 const vert = (x, y, z, u, v, bone, shade = 1) => { P.push(x, y, z); UV.push(u, v); C.push(tint.r * shade, tint.g * shade, tint.b * shade); SI.push(B[bone], 0, 0, 0); SW.push(1, 0, 0, 0); };
 const grid = (rows, cols, base) => { for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { const a = base + i * (cols + 1) + j, b = a + cols + 1; I.push(a, a + 1, b, b, a + 1, b + 1); } };
 { // body lathe with a gently lumpy outline
  const segs = 28, base = P.length / 3; let vAcc = 0;
  for (let i = 0; i < BODY.length; i++) {
   if (i) vAcc += Math.hypot(BODY[i][0] - BODY[i - 1][0], BODY[i][1] - BODY[i - 1][1]);
   for (let j = 0; j <= segs; j++) { const a = j / segs * TAU, k = 1 + .05 * (Math.sin(a * 3 + 1.3) * .6 + Math.sin(a * 5 + 2.6) * .4), r = BODY[i][0] * k;
    vert(Math.cos(a) * r, BODY[i][1], Math.sin(a) * r, j / segs * TAU * .36 / .9, vAcc / .9, 'Torso', i === 0 ? .62 : i === 1 ? .8 : 1); }
  }
  grid(BODY.length - 1, segs, base);
 }
 // tapered tube along a Catmull-Rom curve (normals from computeVertexNormals; seams are hidden in bark)
 const tube = (pts, r0, r1, bone, {segs = 8, steps = 14, wob = .12, seed = 1, shade = 1} = {}) => {
  const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), fr = curve.computeFrenetFrames(steps, false), len = curve.getLength(), base = P.length / 3;
  for (let i = 0; i <= steps; i++) { const t = i / steps, c = curve.getPointAt(t), r = (r0 + (r1 - r0) * Math.pow(t, .8)) * (1 + wob * Math.sin(t * 9 + seed * 3.1));
   for (let j = 0; j <= segs; j++) { const a = j / segs * TAU, n = fr.normals[i].clone().multiplyScalar(Math.cos(a)).add(fr.binormals[i].clone().multiplyScalar(Math.sin(a)));
    vert(c.x + n.x * r, c.y + n.y * r, c.z + n.z * r, j / segs * Math.max(.25, TAU * r0 / .9), t * len / .9, bone, shade * (1 - .25 * t)); } }
  grid(steps, segs, base);
 };
 // Eye sockets: bark rims standing proud of the face.
 for (const [x, r] of EYES) { const segs = 18, ring = 7, R = r, k = r * .28, base = P.length / 3, ay = x * .9;
  for (let i = 0; i <= ring; i++) for (let j = 0; j <= segs; j++) { const u = j / segs * TAU, v = i / ring * TAU, px = (R + k * Math.cos(v)) * Math.cos(u), py = (R + k * Math.cos(v)) * Math.sin(u), pz = k * Math.sin(v);
   vert(x + px * Math.cos(ay) + pz * Math.sin(ay), EYE_Y + py, .248 - px * Math.sin(ay) + pz * Math.cos(ay), j / segs, i / ring * .3, 'Torso', .85); }
  grid(ring, segs, base);
 }
 for (const [bone, a, reach] of LEGS) { // hip -> knee arch -> planted foot, plus two splayed toes
  const h = REST[bone], f = [Math.cos(a) * reach, 0, Math.sin(a) * reach], k = [(h[0] + f[0]) * .575, Y0 + .12, (h[2] + f[2]) * .575], seed = B[bone];
  tube([h, k, [f[0] * .98, .05, f[2] * .98], f], .06, .018, bone, {seed});
  for (const da of [-.35, .35]) { const t = a + da; tube([f, [f[0] + Math.cos(t) * .05, -.005, f[2] + Math.sin(t) * .05], [f[0] + Math.cos(t) * .09, -.01, f[2] + Math.sin(t) * .09]], .021, .004, bone, {segs: 6, steps: 6, seed: seed + da * 4, shade: .8}); }
 }
 tube([REST.TwigR, [.36, Y0 + .36, .1], [.4, Y0 + .5, .07], [.36, Y0 + .58, .1]], .03, .006, 'TwigR', {seed: 5});
 tube([REST.TwigL, [-.34, Y0 + .2, .14], [-.38, Y0 + .12, .16]], .028, .006, 'TwigL', {seed: 7});
 const g = new THREE.BufferGeometry();
 g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
 g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
 g.setIndex(I); g.computeVertexNormals(); g.computeBoundingSphere(); g.computeBoundingBox(); return g;
}
/** End-grain cap, Torso-local (its UVs are a disc in [0,1]^2, like the endcap the trunks use). */
function buildCap(color) {
 const g = new THREE.CircleGeometry(1, 28), pos = g.attributes.position, top = BODY.at(-1)[0] * .985;
 for (let i = 1; i < pos.count; i++) { const a = Math.atan2(pos.getY(i), pos.getX(i)), k = 1 + .05 * (Math.sin(a * 3 + 1.3) * .6 + Math.sin(a * 5 + 2.6) * .4); pos.setXY(i, pos.getX(i) * k * top, pos.getY(i) * k * top); }
 g.rotateX(-Math.PI / 2); g.translate(0, TOP - Y0 + .002, 0);
 const c = new Float32Array(pos.count * 3); for (let i = 0; i < pos.count; i++) c.set([color.r, color.g, color.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(c, 3));
 g.computeBoundingSphere(); return g;
}
/** Bake a list of [geometry, matrix, rgb] into one vertex-coloured, non-indexed buffer. */
function bake(parts) {
 const P = [], N = [], C = [], m3 = new THREE.Matrix3(), v = new THREE.Vector3();
 for (const [geo, matrix, rgb] of parts) { const g = geo.index ? geo.toNonIndexed() : geo, p = g.attributes.position, n = g.attributes.normal; m3.getNormalMatrix(matrix);
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(matrix); P.push(v.x, v.y, v.z); v.fromBufferAttribute(n, i).applyMatrix3(m3).normalize(); N.push(v.x, v.y, v.z); C.push(...rgb); }
  if (g !== geo) g.dispose(); geo.dispose(); }
 const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.computeBoundingSphere(); return g;
}
const M = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
/** Eyes, Torso-local around the eye line so a y-scale is a blink: glowing whites, dark pupils, a white glint. */
function buildEyes() {
 const parts = [], white = [GLOW.r * 1.15, GLOW.g * 1.15, GLOW.b * 1.15];
 for (const [x, r] of EYES) { const ay = x * .9, rot = new THREE.Matrix4().makeRotationY(ay), at = (dx, dy, dz) => new THREE.Vector3(dx, dy, dz).applyMatrix4(rot).add(new THREE.Vector3(x, 0, .255));
  const w = at(0, 0, 0); parts.push([new THREE.SphereGeometry(r, 16, 12), M(w.x, w.y, w.z, 0, ay, 0, 1, 1, .55), white]);
  const p = at(r * .05, r * .035, r * .42); parts.push([new THREE.SphereGeometry(r * .48, 12, 8), M(p.x, p.y, p.z, 0, ay, 0, 1, 1, .5), [.02, .05, .08]]);
  const h = at(-r * .23, r * .3, r * .58); parts.push([new THREE.SphereGeometry(r * .16, 6, 4), M(h.x, h.y, h.z), [2, 2, 2]]); }
 return bake(parts);
}
/** Sprout, moss and a little mushroom on the cut; the mouth hollow on the face. Torso-local, one lit draw. */
function buildDeco() {
 const parts = [], top = TOP - Y0, leaf = (len, wid) => { const s = new THREE.Shape(); s.moveTo(0, 0); s.quadraticCurveTo(wid, len * .35, 0, len); s.quadraticCurveTo(-wid, len * .35, 0, 0);
  const g = new THREE.ShapeGeometry(s, 6), p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, Math.abs(p.getX(i)) * .6 - p.getY(i) ** 2 * .9); g.computeVertexNormals();
  const b = g.clone(); b.scale(1, 1, -1); b.translate(0, 0, -.002); const n = b.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i)); // double-sided by geometry
  return [g, b]; };
 parts.push([new THREE.CylinderGeometry(.008, .013, .15, 6), M(.05, top + .075, -.03, 0, 0, .1), [.32, .5, .16]]);
 for (const [i, rgb] of [[0, [.36, .62, .2]], [1, [.5, .72, .26]]]) for (const g of leaf(.14, .066)) parts.push([g, M(.04, top + .145, -.03, -.4, i * Math.PI + .3, i ? -1.05 : 1.05), rgb]);
 for (let i = 0; i < 5; i++) parts.push([new THREE.SphereGeometry(.045 + (i % 3) * .012, 8, 5), M(-.12 + Math.cos(i * 2.4) * .05, top, -.12 + Math.sin(i * 2.4) * .05, 0, 0, 0, 1, .42, 1), [.3, .46, .16]]);
 const sx = -.27, sy = .06, sz = -.05; // mushroom on the flank
 parts.push([new THREE.CylinderGeometry(.014, .019, .06, 8), M(sx, sy, sz, 0, 0, .5), [.92, .86, .74]]);
 parts.push([new THREE.SphereGeometry(.042, 12, 6, 0, TAU, 0, Math.PI / 2), M(sx - .02, sy + .03, sz, 0, 0, .5, 1, .7, 1), [.75, .3, .2]]);
 parts.push([new THREE.SphereGeometry(.042, 14, 10), M(0, .2, .262, 0, 0, 0, 1, .65, .35), [.07, .04, .02]]); // mouth: a little surprised "o"
 return bake(parts);
}

/**
 * createStumplingView({scene, templates, height(x,z), quality, onSound(event), stumpOf(treeId) -> {height}|null})
 *   build(data) -> visual Group (null until that bark variant and the endcap have loaded)
 *   update(actors, tick, dt)  pose every stumpling actor (after enemy motion, before combat contacts)
 *   release(entry, snapshot)  a removed critter keeps a short corpse (felled, or burrowed away)
 *   event(event)              wake/burrow/loot bursts
 *   tick(dt)                  particles and corpses
 */
export function createStumplingView({scene, templates, height = () => 0, quality = 'high', onSound = () => {}, stumpOf = () => null}) {
 const kits = new Map(), tex = softTexture(), low = quality === 'low';
 const debris = createParticles(scene, low ? 140 : 260, false, tex), motes = createParticles(scene, low ? 60 : 120, true, tex);
 const eyeBase = new THREE.MeshBasicMaterial({vertexColors: true, toneMapped: false});
 const decoMat = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .8});
 const decoGeo = buildDeco(), eyeGeo = buildEyes(), states = new WeakMap(), corpses = [], lastHit = new Map(), woke = new Set();
 let clock = 0;
 const meanColor = g => { const c = g?.attributes.color; if (!c) return new THREE.Color(.78, .74, .68); let r = 0, gg = 0, b = 0; for (let i = 0; i < c.count; i++) { r += c.getX(i); gg += c.getY(i); b += c.getZ(i); } return new THREE.Color(r / c.count, gg / c.count, b / c.count); };
 function kit(variant) {
  const name = VARIANTS[variant] || 'tree'; if (kits.has(name)) return kits.get(name);
  let trunk = null, cap = null;
  templates.get(name)?.scene?.getObjectByName('Trunk')?.traverse(c => { if (c.isMesh && !trunk) trunk = c; });
  templates.get('endcap')?.scene?.traverse(c => { if (c.isMesh && !cap) cap = c; });
  if (!trunk || !cap) return null;
  const k = {name, bark: trunk.material, grain: cap.material, barkGeo: buildBark(meanColor(trunk.geometry)), capGeo: buildCap(meanColor(cap.geometry))};
  kits.set(name, k); return k;
 }
 function build(data) {
  if (data?.kind !== 'stumpling') return null;
  const k = kit(data.variant); if (!k) return null;
  const bones = BONES.map(n => { const b = new THREE.Bone(); b.name = n; return b; });
  for (const n of BONES) { const b = bones[B[n]], par = PARENT[n], p = REST[n], pp = par ? REST[par] : [0, 0, 0]; b.position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]); if (par) bones[B[par]].add(b); }
  const mesh = new THREE.SkinnedMesh(k.barkGeo, k.bark); mesh.name = 'StumplingBark'; mesh.add(bones[0]); mesh.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(bones));
  mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
  const torso = bones[B.Torso];
  const cap = new THREE.Mesh(k.capGeo, k.grain); cap.name = 'StumplingCap'; cap.receiveShadow = true; torso.add(cap);
  const deco = new THREE.Mesh(decoGeo, decoMat); deco.name = 'StumplingSprout'; deco.castShadow = !low; deco.userData.ignoreContact = true; torso.add(deco);
  const eyeMat = eyeBase.clone(), eyes = new THREE.Group(), eyeMesh = new THREE.Mesh(eyeGeo, eyeMat); eyes.name = 'StumplingEyes'; eyes.userData.ignoreContact = true;
  eyes.position.y = EYE_Y - Y0; eyeMesh.position.y = -(EYE_Y - Y0); eyes.add(eyeMesh); torso.add(eyes);
  const body = new THREE.Group(); body.name = 'StumplingBody'; body.add(mesh); body.rotation.y = Math.PI; // built facing +Z; the sim faces -Z
  const lift = new THREE.Group(); lift.add(body);
  const visual = new THREE.Group(); visual.name = 'Stumpling'; visual.add(lift);
  const stump = stumpOf(data.treeId);
  visual.userData.stumpling = {mesh, bones: Object.fromEntries(BONES.map(n => [n, bones[B[n]]])), rest: Object.fromEntries(BONES.map(n => [n, bones[B[n]].quaternion.clone()])),
   body, lift, eyes, eyeMat, seed: hash(data.id), s0: clamp((stump?.height ?? TOP) / TOP, .9, 2.4)};
  return visual;
 }
 const e1 = new THREE.Euler(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), axis = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
 function rot(rig, name, x = 0, y = 0, z = 0) { rig.bones[name].quaternion.copy(rig.rest[name]).multiply(q1.setFromEuler(e1.set(x, y, z))); }
 function pose(entry, tick, dt) {
  const visual = entry.visual, rig = visual.userData.stumpling, d = entry.data; if (!rig || !d) return;
  entry.root.getWorldPosition(v1);
  let st = states.get(visual);
  if (!st) { st = {last: v1.clone(), stride: rnd(rig.seed, 1), move: 0, speed: 0, hurt: d.hurtTick ?? -1e9, hurtAt: -1e9, blinkAt: 1 + rnd(rig.seed, 2) * 3, dug: false}; states.set(visual, st); }
  const travel = Math.hypot(v1.x - st.last.x, v1.z - st.last.z); st.last.copy(v1);
  if (travel < 1) st.stride += travel / .32;
  const inst = dt > 0 ? travel / dt : 0; st.speed = lerp(st.speed, Math.min(inst, 4), 1 - Math.exp(-dt * 6));
  st.move = lerp(st.move, travel > .0004 * 60 * dt ? 1 : 0, 1 - Math.exp(-dt * 10));
  const m = st.move, ph = st.stride * TAU, panic = smooth((st.speed - 1.4) / 1);
  const age = (tick - d.wakeTick) / 60, burrow = (tick - stumplingBurrowTick(d)) / STUMPLING.burrowTicks;
  // Wake: the stump shudders, shrinks from stump size to critter size and pulls its roots out of the soil.
  const waking = age < STUMPLING.wakeTicks / 60, rise = smooth((age - .15) / .8), tremble = waking ? 1 - smooth((age - .2) / .7) : 0;
  rig.body.scale.setScalar(waking ? lerp(rig.s0, 1, smooth((age - .05) / .9)) : 1);
  const sink = burrow > 0 ? smooth(burrow) : 0;
  rig.lift.position.y = -(waking ? (1 - rise) * .22 : 0) - sink * (TOP + .05) + Math.abs(Math.sin(ph)) * .035 * m;
  rig.lift.rotation.set(Math.sin(clock * 41 + rig.seed) * .05 * (tremble + sink * .6), 0, Math.sin(clock * 47 + rig.seed) * .06 * (tremble + sink * .8));
  if (waking && !woke.has(d.id) && age >= 0 && age < .5) { woke.add(d.id); wakeBurst(entry); }
  if (burrow > 0 && !st.dug) { st.dug = true; dirt(v1, 18, .8); }
  if (burrow > 0 && burrow < 1 && Math.random() < dt * 14) dirt(v1, 2, .5);
  // Hurt: a squash and a squeal; eyes flare.
  if ((d.hurtTick ?? -1e9) !== st.hurt) { st.hurt = d.hurtTick; st.hurtAt = clock; onSound({kind: 'stump_squeak', id: d.id, position: v1.toArray()}); }
  const recoil = clock - st.hurtAt < 1 ? Math.exp(-(clock - st.hurtAt) * 8) : 0;
  // Waddle: diagonal root pairs swing and lift; the body rolls side to side and bobs; arms flail when it bolts.
  const legsOut = waking ? smooth((age - .3) / .7) : 1 - sink;
  for (const [bone, a] of LEGS) {
   const pair = bone === 'RootA' || bone === 'RootC' ? 0 : Math.PI, s = Math.sin(ph + pair), lift = Math.max(0, Math.cos(ph + pair)) * .55 * m;
   const tuck = (1 - legsOut) * .9; // folded under while waking/burrowing
   axis.set(-Math.sin(a), 0, Math.cos(a)); // horizontal, across the leg: +angle raises the foot
   rig.bones[bone].quaternion.copy(rig.rest[bone]).multiply(q1.setFromAxisAngle(up, s * .42 * m)).multiply(q2.setFromAxisAngle(axis, lift - tuck * .2 + Math.sin(clock * 3 + a) * .02));
  }
  const roll = Math.sin(ph) * .09 * m, breathe = Math.sin(clock * 2.2 + rig.seed) * .015;
  rig.bones.Torso.position.set(0, Y0 + breathe * .5 - recoil * .04, 0);
  rot(rig, 'Torso', -.08 * m - recoil * .25 + breathe, Math.sin(clock * .6 + rig.seed) * .12 * (1 - m), roll);
  rig.bones.Torso.scale.set(1 + recoil * .12, 1 - recoil * .15, 1 + recoil * .12);
  const wave = Math.sin(clock * 7 + rig.seed) * .5;
  rot(rig, 'TwigR', lerp(-Math.sin(ph) * .5 * m, wave * .4, panic), 0, lerp(.15 * (1 - m) * Math.sin(clock * 2.3 + rig.seed), -.9 + wave * .3, panic));
  rot(rig, 'TwigL', lerp(Math.sin(ph) * .5 * m, -wave * .4, panic), 0, lerp(0, 1.6 + wave * .3, panic));
  // Eyes: blink on during the wake, blink now and then, squint when hit, dim as it digs in.
  if (clock > st.blinkAt) st.blinkAt = clock + 2 + rnd(rig.seed, Math.floor(clock)) * 4;
  const blinkU = st.blinkAt - clock < .14 ? Math.abs((st.blinkAt - clock) / .07 - 1) : 1;
  const on = waking ? smooth((age - .55) / .3) : 1;
  rig.eyes.scale.set(1, Math.max(.06, Math.min(blinkU, 1 - recoil * .6) * (on > .02 ? 1 : .06)), 1);
  rig.eyeMat.color.setScalar(clamp(on * (1 - sink * .8) * (.9 + .1 * Math.sin(clock * 2.6 + rig.seed)) + recoil * .7, 0, 2));
 }
 function chips(at, n, spread, color = [.42, .3, .19]) { for (let i = 0; i < n; i++) { const a = Math.random() * TAU, s = spread * (.5 + Math.random());
  debris.emit({x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * s, vy: 1.4 + Math.random() * 1.8, vz: Math.sin(a) * s, life: .8 + Math.random() * .5, size: .045 + Math.random() * .04, grav: -9.8, drag: .3, ground: true,
   r: color[0] * (.8 + Math.random() * .4), g: color[1] * (.8 + Math.random() * .4), b: color[2] * (.8 + Math.random() * .4)}); } }
 function dirt(at, n, spread) { v2.set(at.x, height(at.x, at.z) + .05, at.z); chips(v2, n, spread, [.3, .22, .14]); }
 function glowMotes(at, n, radius, rise = 1.2) { for (let i = 0; i < n; i++) { const a = Math.random() * TAU, r = radius * Math.sqrt(Math.random());
  motes.emit({x: at.x + Math.cos(a) * r, y: at.y + Math.random() * .25, z: at.z + Math.sin(a) * r, vx: -Math.sin(a) * .4, vy: rise * (.5 + Math.random()), vz: Math.cos(a) * .4, life: .9 + Math.random() * .7, size: .07 + Math.random() * .06, grav: 0, drag: .8, r: GLOW.r, g: GLOW.g, b: GLOW.b}); } }
 function wakeBurst(entry) { entry.root.getWorldPosition(v1); const n = low ? .55 : 1; dirt(v1, Math.round(26 * n), 1.1); v2.set(v1.x, height(v1.x, v1.z) + .05, v1.z); glowMotes(v2, Math.round(16 * n), .5, 1.4); }
 function update(actors, tick, dt) { clock += dt; let n = 0; for (const entry of actors.values()) if (entry.enemy && entry.visual?.userData.stumpling) { pose(entry, tick, dt); n++; } return n; }
 function event(e) {
  if (!e?.kind) return;
  if ((e.kind === 'hit' || e.kind === 'headshot') && e.material === 'wood' && Array.isArray(e.normal)) lastHit.set(e.id, e.normal[0] >= 0 ? 1 : -1);
  if (e.kind === 'stump_wake') onSound({kind: 'stump_chirp', id: e.id, position: e.position});
  if (e.kind === 'stump_loot' && Array.isArray(e.position)) { v1.fromArray(e.position); chips(v1.setY(v1.y + .3), 20, 1.4); if (e.ore) glowMotes(v1, 10, .4); }
 }
 // A removed critter becomes a corpse: felled (it hops, flops over and sinks with a puff of chips) or burrowed (already
 // underground; it just finishes). The live actor gets an empty stand-in so the game frees nothing twice.
 function release(entry, snapshot) {
  const visual = entry.visual, rig = visual?.userData?.stumpling; if (!rig) return false;
  const id = entry.data?.id, burrowed = !!entry.data && (snapshot?.tick ?? 0) >= stumplingBurrowTick(entry.data);
  scene.attach(visual); entry.visual = new THREE.Group(); entry.visual.userData.released = true;
  entry.root.getWorldPosition(v1);
  const dir = lastHit.get(id) ?? (rnd(rig.seed, 3) < .5 ? -1 : 1), tip = new THREE.Vector3(Math.cos(entry.root.rotation.y), 0, -Math.sin(entry.root.rotation.y));
  corpses.push({visual, rig, kind: burrowed ? 'gone' : 'fall', age: 0, q0: visual.quaternion.clone(), p0: visual.position.clone(), axis: tip, dir});
  if (!burrowed) onSound({kind: 'stump_squeak', id, position: v1.toArray(), last: true});
  lastHit.delete(id); woke.delete(id);
  return true;
 }
 function endCorpse(c) { c.visual.removeFromParent(); c.rig.eyeMat.dispose(); c.rig.mesh.skeleton.dispose(); }
 function tick(dt) {
  for (let i = corpses.length - 1; i >= 0; i--) {
   const c = corpses[i], rig = c.rig; c.age += dt;
   if (c.kind === 'gone') { c.visual.visible = false; endCorpse(c); corpses.splice(i, 1); continue; }
   const hop = Math.max(0, Math.sin(clamp(c.age / .45) * Math.PI)) * .25, fall = smooth(c.age / .6) * 1.45;
   c.visual.position.set(c.p0.x, c.p0.y + hop, c.p0.z); c.visual.quaternion.copy(q1.setFromAxisAngle(c.axis, fall * c.dir)).multiply(c.q0);
   rig.eyeMat.color.setScalar(Math.max(0, 1 - c.age * 2.2)); rig.eyes.scale.y = Math.max(.06, 1 - c.age * 3);
   if (!c.puff && c.age > .55) { c.puff = true; c.visual.getWorldPosition(v1); dirt(v1, low ? 10 : 18, 1.2); chips(v1.setY(height(v1.x, v1.z) + .25), low ? 8 : 14, 1.6); glowMotes(v1, 8, .4, 1.6); }
   if (c.age > .8) { const s = smooth((c.age - .8) / .6); rig.lift.position.y = -s * .4; rig.body.scale.setScalar(Math.max(.001, 1 - s)); }
   if (c.age > 1.4) { endCorpse(c); corpses.splice(i, 1); }
  }
  debris.tick(dt, height); motes.tick(dt, height);
 }
 function stats() { return {corpses: corpses.length, debris: debris.count(), motes: motes.count(), kits: kits.size}; }
 function dispose() { for (const c of corpses) endCorpse(c); corpses.length = 0; debris.dispose(); motes.dispose(); tex.dispose(); for (const k of kits.values()) { k.barkGeo.dispose(); k.capGeo.dispose(); } decoGeo.dispose(); eyeGeo.dispose(); eyeBase.dispose(); decoMat.dispose(); }
 return {build, update, release, event, tick, stats, dispose, ready: variant => !!kit(variant)};
}
