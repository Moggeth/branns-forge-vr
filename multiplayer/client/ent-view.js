// Ent presentation (client only). An ent is the tree it was: the crown is that tree's own authored Branches,
// Leaves and Fruit, carried on a skinned bark body with root legs and branch arms. Its fruit becomes blue resonance
// light and its face is cut with glowing eyes and veins, so it reads from the God's camera, a phone and a headset.
//
// Ownership: entry.root stays simulation-owned (position/yaw). This module poses only the ent's own bones and inner
// body group. Bones carry the combat part names (Torso, Head, LeftArm/ElbowL, LeftLeg/LeftKnee ...), so arrow embeds,
// triangle contacts, dismemberment masks and fire samples in combat-view work unchanged.
//
// Draw calls per ent: bark body (1 skinned), crown (2-3, the tree's own), face glow (1). Shared geometry per size class;
// only bones, the glow material and the crown wrapper are per ent. No lights. Particles: two pooled point draws.
import * as THREE from 'three';
import {ENT, ENT_SIZES, entHeight, entRootTick} from '../shared/ents.js';
import {VARIANTS} from '../shared/trees.js';
import {maskMissingParts} from './combat-view.js';

const TAU = Math.PI * 2, clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v), smooth = t => { t = clamp(t); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const rnd = (seed, n) => { let h = Math.imul(seed ^ Math.imul(n | 0, 0x9e3779b1), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
export const GLOW = new THREE.Color(0x7fd8ff);

// ---- Proportions (fractions of the size class height). Mirrors shared/ents.js ENT_ANATOMY. Model faces -Z; its left is -X.
const SHAPES = {
 elder: {hip: .30, spine: .47, head: .63, crownTop: 1.0, trunk: [[.2, .05], [.25, .11], [.31, .128], [.38, .118], [.46, .11], [.54, .107], [.61, .088], [.69, .055]],
  shoulder: [-.1, .565, -.005], elbow: [-.235, .425, -.04], wrist: [-.275, .29, -.075], arm: [.046, .036, .029],
  hipJoint: [-.075, .30, 0], knee: [-.1, .165, -.03], ankle: [-.112, .042, 0], leg: [.062, .05, .056], eye: .535, toes: 4},
 sapling: {hip: .34, spine: .49, head: .61, crownTop: 1.02, trunk: [[.25, .04], [.29, .085], [.35, .092], [.42, .085], [.5, .08], [.56, .077], [.61, .064], [.67, .042]],
  shoulder: [-.075, .56, -.005], elbow: [-.18, .45, -.05], wrist: [-.215, .345, -.09], arm: [.034, .027, .022],
  hipJoint: [-.058, .34, 0], knee: [-.078, .19, -.035], ankle: [-.086, .045, 0], leg: [.046, .038, .042], eye: .53, toes: 3},
};
const BONES = ['EntRoot', 'Torso', 'Spine', 'Head', 'LeftArm', 'ElbowL', 'RightArm', 'ElbowR', 'LeftLeg', 'LeftKnee', 'RightLeg', 'RightKnee'];
const B = Object.fromEntries(BONES.map((n, i) => [n, i]));
const PARENT = {Torso: 'EntRoot', Spine: 'Torso', Head: 'Spine', LeftArm: 'Spine', ElbowL: 'LeftArm', RightArm: 'Spine', ElbowR: 'RightArm', LeftLeg: 'Torso', LeftKnee: 'LeftLeg', RightLeg: 'Torso', RightKnee: 'RightLeg'};
const mirror = ([x, y, z], side) => [x * side, y, z];
function bonePositions(S, H) { // absolute rest positions, metres
 const p = {EntRoot: [0, 0, 0], Torso: [0, S.hip, 0], Spine: [0, S.spine, 0], Head: [0, S.head, 0]};
 for (const [side, s] of [['L', 1], ['R', -1]]) {
  const arm = side === 'L' ? 'LeftArm' : 'RightArm', elbow = side === 'L' ? 'ElbowL' : 'ElbowR', leg = side === 'L' ? 'LeftLeg' : 'RightLeg', knee = side === 'L' ? 'LeftKnee' : 'RightKnee';
  p[arm] = mirror(S.shoulder, s); p[elbow] = mirror(S.elbow, s); p[leg] = mirror(S.hipJoint, s); p[knee] = mirror(S.knee, s);
 }
 for (const k in p) p[k] = p[k].map(v => v * H);
 return p;
}

// ---- Procedural bark tubes, skinned rigidly with blends at the joints.
function createTubes() {
 const P = [], N = [], UV = [], C = [], SI = [], SW = [], I = [];
 const t = new THREE.Vector3(), n = new THREE.Vector3(), b = new THREE.Vector3(), up = new THREE.Vector3(), q = new THREE.Vector3();
 // nodes: [{p:[x,y,z], r, w:[[bone,weight]...], c}], opts: segs, uRep, vScale, seed, gnarl, face(y,angle)->extra radius
 function tube(nodes, {segs = 10, uRep = 2, vScale = 1.25, seed = 1, gnarl = .08, face = null, twist = .9} = {}) {
  const base = P.length / 3; let v = 0;
  for (let i = 0; i < nodes.length; i++) {
   const a = nodes[Math.max(0, i - 1)].p, c = nodes[Math.min(nodes.length - 1, i + 1)].p, p = nodes[i].p;
   t.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]).normalize();
   if (i === 0) { up.set(0, 0, 1); if (Math.abs(t.dot(up)) > .9) up.set(1, 0, 0); n.crossVectors(up, t).normalize(); }
   else { n.sub(q.copy(t).multiplyScalar(n.dot(t))).normalize(); } // parallel transport
   b.crossVectors(t, n).normalize();
   if (i > 0) { const pp = nodes[i - 1].p; v += Math.hypot(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]) * vScale; }
   const w = nodes[i].w, wsum = w.reduce((s, x) => s + x[1], 0);
   for (let j = 0; j <= segs; j++) {
    const ang = j / segs * TAU + i * twist * .1, ca = Math.cos(ang), sa = Math.sin(ang);
    const bumps = 1 + gnarl * (rnd(seed, i * 31 + (j % segs)) - .5) * 2 + gnarl * .6 * Math.sin(ang * 3 + seed + i * .7);
    const dx = n.x * ca + b.x * sa, dy = n.y * ca + b.y * sa, dz = n.z * ca + b.z * sa;
    const r = nodes[i].r * bumps + (face ? face(p[1], dx, dz) : 0);
    P.push(p[0] + dx * r, p[1] + dy * r, p[2] + dz * r); N.push(dx, dy, dz);
    UV.push(j / segs * uRep, v);
    const shade = nodes[i].c ?? 1, k = .82 + .18 * rnd(seed + 7, i * 13 + j);
    C.push(.78 * shade * k, .74 * shade * k, .68 * shade * k);
    for (let s = 0; s < 4; s++) { SI.push(w[s]?.[0] ?? 0); SW.push(w[s] ? w[s][1] / wsum : 0); }
   }
  }
  for (let i = 0; i < nodes.length - 1; i++) for (let j = 0; j < segs; j++) {
   const a = base + i * (segs + 1) + j, c = a + segs + 1;
   I.push(a, a + 1, c, a + 1, c + 1, c); // counter-clockwise seen from outside
  }
 }
 function geometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
  g.setIndex(I); g.computeBoundingSphere(); g.computeBoundingBox(); return g;
 }
 return {tube, geometry};
}
const W = (bone, k = 1, other, j = 0) => other ? [[B[bone], k], [B[other], j]] : [[B[bone], 1]];

function buildBodyGeometry(size) {
 const S = SHAPES[size], H = ENT_SIZES[size].height, bp = bonePositions(S, H), T = createTubes(), seed = size === 'elder' ? 11 : 23;
 const front = (y, dx, dz) => { // brow ridge above the eyes and a hollow under them: a face in the bark
  const e = S.eye * H, facing = clamp(-dz * 1.4 - .35); if (facing <= 0) return 0;
  return facing * (.012 * H * Math.exp(-(((y - e - .035 * H) / (.018 * H)) ** 2)) - .007 * H * Math.exp(-(((y - e + .01 * H) / (.02 * H)) ** 2)));
 };
 // Trunk (torso -> spine -> into the crown).
 T.tube(S.trunk.map(([y, r], i, all) => {
  const yy = y * H, w = y < .4 ? W('Torso') : y < .5 ? W('Torso', 1 - (y - .4) / .1, 'Spine', (y - .4) / .1) : i === all.length - 1 ? W('Spine', .65, 'Head', .35) : W('Spine');
  return {p: [0, yy, 0], r: r * H, w, c: i < 2 ? .7 : 1};
 }).concat([[.035, .55], [.045, .12]].map(([dy, k]) => ({p: [0, (S.trunk.at(-1)[0] + dy) * H, 0], r: S.trunk.at(-1)[1] * k * H, w: W('Spine', .65, 'Head', .35), c: .8}))), {segs: 14, uRep: 3, seed, gnarl: .07, face: front});
 for (const [side, s] of [['L', 1], ['R', -1]]) {
  const arm = s > 0 ? 'LeftArm' : 'RightArm', elbow = s > 0 ? 'ElbowL' : 'ElbowR', leg = s > 0 ? 'LeftLeg' : 'RightLeg', knee = s > 0 ? 'LeftKnee' : 'RightKnee';
  const sh = bp[arm], el = bp[elbow], wr = mirror(S.wrist, s).map(v => v * H), [ra, re, rw] = S.arm.map(r => r * H);
  const inner = [sh[0] * .35, sh[1] + .01 * H, sh[2]];
  const mid1 = sh.map((v, k) => lerp(v, el[k], .5) + (k === 0 ? s * -.012 * H : 0)), mid2 = el.map((v, k) => lerp(v, wr[k], .5));
  T.tube([{p: inner, r: ra * 1.1, w: W(arm)}, {p: sh, r: ra, w: W(arm)}, {p: mid1, r: (ra + re) / 2 * 1.08, w: W(arm)}, {p: el, r: re * 1.12, w: W(arm, .5, elbow, .5)},
   {p: mid2, r: (re + rw) / 2, w: W(elbow)}, {p: wr, r: rw, w: W(elbow)}], {segs: 9, uRep: 1.5, seed: seed + s * 3, gnarl: .11});
  // Twig fingers splay from the wrist; a side shoot breaks the silhouette of each forearm.
  for (let f = 0; f < 3; f++) {
   const a = (f - 1) * .55, len = (.085 + .02 * (f === 1)) * H, dir = [Math.sin(a) * .6 * s * -1 + s * -.25, -.85, -.35 + Math.cos(a) * .1];
   const L = Math.hypot(...dir), d = dir.map(v => v / L), tip = wr.map((v, k) => v + d[k] * len), mid = wr.map((v, k) => v + d[k] * len * .5 + (k === 0 ? s * -.01 * H : 0));
   T.tube([{p: wr, r: rw * .55, w: W(elbow)}, {p: mid, r: rw * .38, w: W(elbow)}, {p: tip, r: rw * .06, w: W(elbow)}], {segs: 5, uRep: .5, seed: seed + f * 5 + s, gnarl: .05});
  }
  const shoot = el.map((v, k) => lerp(v, wr[k], .35)), sTip = [shoot[0] + s * -.09 * H, shoot[1] + .07 * H, shoot[2] - .02 * H];
  T.tube([{p: shoot, r: re * .45, w: W(elbow)}, {p: shoot.map((v, k) => lerp(v, sTip[k], .5)), r: re * .3, w: W(elbow)}, {p: sTip, r: re * .05, w: W(elbow)}], {segs: 5, uRep: .5, seed: seed + 41 + s, gnarl: .05});
  // Root legs: thigh, knee, a flared ankle and splayed root toes that grip the ground.
  const hp = bp[leg], kn = bp[knee], an = mirror(S.ankle, s).map(v => v * H), [rl, rk, rn] = S.leg.map(r => r * H);
  T.tube([{p: [hp[0] * .4, hp[1] + .03 * H, 0], r: rl * 1.1, w: W('Torso', .5, leg, .5)}, {p: hp, r: rl, w: W(leg)}, {p: hp.map((v, k) => lerp(v, kn[k], .5)), r: (rl + rk) / 2 * 1.05, w: W(leg)},
   {p: kn, r: rk * 1.15, w: W(leg, .5, knee, .5)}, {p: kn.map((v, k) => lerp(v, an[k], .5)), r: (rk + rn) / 2, w: W(knee)}, {p: an, r: rn, w: W(knee), c: .75}], {segs: 10, uRep: 1.5, seed: seed + 60 + s, gnarl: .1});
  for (let f = 0; f < S.toes; f++) {
   const a = (f / S.toes) * TAU + (s > 0 ? .4 : -.4) - Math.PI / 2, len = (.11 + .03 * rnd(seed, f + s * 9)) * H, dx = Math.cos(a), dz = Math.sin(a) - .35;
   const L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
   const p1 = [an[0] + ux * len * .45, .018 * H, an[2] + uz * len * .45], p2 = [an[0] + ux * len, .004 * H, an[2] + uz * len];
   T.tube([{p: [an[0], an[1] + .01 * H, an[2]], r: rn * .55, w: W(knee), c: .7}, {p: p1, r: rn * .35, w: W(knee), c: .6}, {p: p2, r: rn * .05, w: W(knee), c: .55}], {segs: 6, uRep: .6, seed: seed + 80 + f + s, gnarl: .08});
  }
 }
 return {geometry: T.geometry(), bones: bp, H};
}

// Face and resonance veins: glowing slits on the trunk front, with veins running down into the roots and up into the crown.
function buildGlowGeometry(size) {
 const S = SHAPES[size], H = ENT_SIZES[size].height, spine = S.spine * H, P = [], C = [], I = [];
 const radiusAt = y => { const tr = S.trunk; for (let i = 1; i < tr.length; i++) if (y / H <= tr[i][0]) { const u = (y / H - tr[i - 1][0]) / (tr[i][0] - tr[i - 1][0]); return lerp(tr[i - 1][1], tr[i][1], u) * H; } return tr.at(-1)[1] * H; };
 const quad = (pts, k) => { const base = P.length / 3; for (const p of pts) { P.push(p[0], p[1] - spine, p[2]); C.push(GLOW.r * k, GLOW.g * k, GLOW.b * k); } I.push(base, base + 1, base + 2, base, base + 2, base + 3); };
 const surf = (y, ang, out = .006 * H) => { const r = radiusAt(y) + out; return [Math.sin(ang) * r, y, -Math.cos(ang) * r]; };
 const ey = S.eye * H;
 for (const s of [-1, 1]) { // angry almond eyes, tilted toward the brow
  const a0 = s * .42, w = .05 * H, h = .016 * H, tilt = s * .3;
  const c = surf(ey, a0, .008 * H), tx = Math.cos(a0), tz = Math.sin(a0);
  const along = [tx * w / 2, Math.sin(tilt) * w / 2, tz * w / 2];
  quad([[c[0] - along[0], c[1] - along[1], c[2] - along[2]], [c[0], c[1] - h, c[2]], [c[0] + along[0], c[1] + along[1], c[2] + along[2]], [c[0], c[1] + h * .6, c[2]]], 1.6);
 }
 const strip = (pts, wid, k) => { for (let i = 0; i < pts.length - 1; i++) { const [a, b] = [pts[i], pts[i + 1]], dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz) || 1;
  const nx = -dz / L * 0, ny = 1, nz = dx / L * 0; void nx; void nz; const o = wid / 2, kk = k * (1 - i / pts.length * .6);
  quad([[a[0], a[1] - o * ny, a[2]], [b[0], b[1] - o * ny, b[2]], [b[0], b[1] + o * ny, b[2]], [a[0], a[1] + o * ny, a[2]]], kk); } };
 // Mouth: a jagged horizontal crack.
 const my = ey - .075 * H; strip(Array.from({length: 7}, (_, i) => surf(my + (i % 2 ? .006 : -.004) * H, (i / 6 - .5) * .9, .006 * H)), .008 * H, 1);
 // Veins: thin vertical cracks (quads stand across the trunk, facing out).
 const vein = (ang0, y0, y1, k) => { const n = 9; for (let i = 0; i < n; i++) { const ya = lerp(y0, y1, i / n), yb = lerp(y0, y1, (i + 1) / n);
   const aa = ang0 + Math.sin(i * 1.7 + ang0 * 3) * .08, ab = ang0 + Math.sin((i + 1) * 1.7 + ang0 * 3) * .08, w = .0065 * H;
   const pa = surf(ya, aa, .005 * H), pb = surf(yb, ab, .005 * H), ta = [Math.cos(aa) * w, 0, Math.sin(aa) * w], tb = [Math.cos(ab) * w, 0, Math.sin(ab) * w];
   quad([[pa[0] - ta[0], pa[1], pa[2] - ta[2]], [pa[0] + ta[0], pa[1], pa[2] + ta[2]], [pb[0] + tb[0], pb[1], pb[2] + tb[2]], [pb[0] - tb[0], pb[1], pb[2] - tb[2]]], k * (1 - i / n * .7)); } };
 vein(-.15, ey - .1 * H, S.hip * H - .02 * H, .9); vein(.2, ey - .09 * H, S.hip * H + .01 * H, .8); vein(Math.PI * .55, ey + .06 * H, S.head * H, .7); vein(-Math.PI * .6, S.spine * H, S.head * H + .02 * H, .7); vein(Math.PI, S.hip * H + .03 * H, S.head * H, .6);
 const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setIndex(I); g.computeBoundingSphere();
 return g;
}

export function softTexture() {
 const n = 32, data = new Uint8Array(n * n * 4);
 for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const d = Math.hypot(x - n / 2 + .5, y - n / 2 + .5) / (n / 2), a = clamp(1 - d) ** 1.6; const i = (y * n + x) * 4; data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = a * 255; }
 const t = new THREE.DataTexture(data, n, n); t.needsUpdate = true; return t;
}
// Pooled CPU particles in one Points draw: leaves, bark chips, soil (normal blend) or resonance motes (additive).
export function createParticles(scene, cap, additive, texture) {
 const pos = new Float32Array(cap * 3), col = new Float32Array(cap * 3), aux = new Float32Array(cap * 2), list = [];
 const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('col', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('aux', new THREE.BufferAttribute(aux, 2).setUsage(THREE.DynamicDrawUsage));
 const m = new THREE.ShaderMaterial({uniforms: {map: {value: texture}, scale: {value: 420}}, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  vertexShader: 'attribute vec3 col;attribute vec2 aux;uniform float scale;varying vec3 vC;varying float vA;void main(){vC=col;vA=aux.y;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=min(96.,aux.x*scale/max(.1,-mv.z));gl_Position=projectionMatrix*mv;}',
  fragmentShader: 'uniform sampler2D map;varying vec3 vC;varying float vA;void main(){float a=texture2D(map,gl_PointCoord).a*vA;if(a<.02)discard;gl_FragColor=vec4(vC,a);}'});
 const points = new THREE.Points(g, m); points.frustumCulled = false; points.name = additive ? 'EntMotes' : 'EntDebris'; points.renderOrder = 3; scene.add(points);
 function emit(p) { if (list.length >= cap) list.shift(); list.push({x: p.x, y: p.y, z: p.z, vx: p.vx || 0, vy: p.vy || 0, vz: p.vz || 0, life: p.life || 1, age: 0, size: p.size || .1, r: p.r, g: p.g, b: p.b, grav: p.grav ?? -6, drag: p.drag ?? .6, ground: p.ground, flutter: p.flutter || 0, seed: Math.random() * 10}); }
 function tick(dt, height) {
  let k = 0;
  for (let i = list.length - 1; i >= 0; i--) { const q = list[i]; q.age += dt; if (q.age >= q.life) list.splice(i, 1); }
  for (const q of list) {
   const d = Math.exp(-q.drag * dt); q.vx *= d; q.vz *= d; q.vy = q.vy * d + q.grav * dt;
   if (q.flutter) { q.vx += Math.sin(q.age * 5 + q.seed) * q.flutter * dt; q.vz += Math.cos(q.age * 4 + q.seed) * q.flutter * dt; }
   q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
   if (q.ground) { const gy = height(q.x, q.z) + .03; if (q.y < gy) { q.y = gy; q.vy *= -.15; q.vx *= .5; q.vz *= .5; } }
   const u = q.age / q.life, a = Math.min(1, u * 8) * (1 - smooth((u - .6) / .4));
   pos[k * 3] = q.x; pos[k * 3 + 1] = q.y; pos[k * 3 + 2] = q.z; col[k * 3] = q.r; col[k * 3 + 1] = q.g; col[k * 3 + 2] = q.b; aux[k * 2] = q.size; aux[k * 2 + 1] = a; k++;
  }
  g.setDrawRange(0, k); for (const name of ['position', 'col', 'aux']) g.attributes[name].needsUpdate = true; points.visible = k > 0;
 }
 return {emit, tick, count: () => list.length, dispose() { points.removeFromParent(); g.dispose(); m.dispose(); }};
}

const LEAF = {tree: [[.36, .55, .2], [.5, .66, .26], [.62, .6, .22]], tree_b: [[.42, .6, .3], [.55, .7, .35], [.33, .5, .24]], tree_young: [[.5, .72, .28], [.62, .78, .32], [.4, .6, .2]]};

/**
 * createEntView({scene, templates, height(x,z), quality:'high'|'low', onSound(event), onRumble({position, strength, kind})})
 *   build(data) -> visual Group (null until that tree variant has loaded)
 *   update(actors, tick, dt)  pose every ent actor (call after mixers/enemy motion, before combat contacts)
 *   release(entry, snapshot)  hand a removed ent's visual to a corpse (felled, rooted or crumbled)
 *   event(event)              wake/limb/root bursts
 *   tick(dt)                  particles and corpses
 */
export function createEntView({scene, templates, height = () => 0, quality = 'high', onSound = () => {}, onRumble = () => {}}) {
 const bodies = new Map(), glows = new Map(), kits = new Map(), tex = softTexture();
 const debris = createParticles(scene, quality === 'low' ? 220 : 420, false, tex), motes = createParticles(scene, quality === 'low' ? 120 : 220, true, tex);
 const glowBase = new THREE.MeshBasicMaterial({vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide});
 const fruitGlow = new THREE.MeshBasicMaterial({color: GLOW.clone().multiplyScalar(1.25), toneMapped: false});
 const corpses = [], states = new WeakMap(), lastHit = new Map(), woke = new Set();
 let clock = 0;
 function body(size) { let b = bodies.get(size); if (!b) { b = buildBodyGeometry(size); bodies.set(size, b); } return b; }
 function glowGeometry(size) { let g = glows.get(size); if (!g) { g = buildGlowGeometry(size); glows.set(size, g); } return g; }
 function kit(variant) {
  const name = VARIANTS[variant] || 'tree', lodName = quality === 'low' && templates.has(name + '_lod') ? name + '_lod' : name;
  const key = lodName; if (kits.has(key)) return kits.get(key);
  const full = templates.get(name)?.scene?.getObjectByName('Tree'), crownSrc = templates.get(lodName)?.scene?.getObjectByName('Tree');
  if (!full || !crownSrc) return null;
  full.updateMatrixWorld(true); crownSrc.updateMatrixWorld(true);
  const mesh = (root, part) => { let m = null; root.getObjectByName(part)?.traverse(c => { if (c.isMesh && !m) m = c; }); return m; };
  const trunk = mesh(full, 'Trunk'), inv = new THREE.Matrix4().copy(crownSrc.matrixWorld).invert(), crown = [];
  for (const part of ['Branches', 'Leaves', 'Fruit']) { const m = mesh(crownSrc, part); if (m) crown.push({part, geometry: m.geometry, material: part === 'Fruit' ? fruitGlow : m.material, matrix: new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)}); }
  const box = new THREE.Box3(); for (const c of crown) { c.geometry.computeBoundingBox(); box.union(c.geometry.boundingBox.clone().applyMatrix4(c.matrix)); }
  const k = trunk ? {name, bark: trunk.material, crown, firstLimb: 2.45, top: box.isEmpty() ? 6 : box.max.y} : null;
  kits.set(key, k); return k;
 }
 function build(data) {
  if (data?.kind !== 'ent') return null;
  const size = ENT_SIZES[data.size] ? data.size : 'elder', S = SHAPES[size], k = kit(data.variant); if (!k) return null;
  const {geometry, bones: bp, H} = body(size), seed = hash(data.id);
  const bones = BONES.map(n => { const b = new THREE.Bone(); b.name = n; return b; });
  for (const n of BONES) { const b = bones[B[n]], par = PARENT[n], p = bp[n], pp = par ? bp[par] : [0, 0, 0]; b.position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]); if (par) bones[B[par]].add(b); }
  const mesh = new THREE.SkinnedMesh(geometry, k.bark); mesh.name = 'EntBark'; mesh.add(bones[0]); mesh.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(bones));
  mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
  // The tree's own crown, scaled onto the Head bone so its first limb meets the top of the trunk.
  const crown = new THREE.Group(); crown.name = 'Crown'; const c = (S.crownTop - S.head) * H / Math.max(1, k.top - k.firstLimb);
  crown.scale.setScalar(c); crown.position.set(0, -k.firstLimb * c, 0);
  for (const part of k.crown) { const m = new THREE.Mesh(part.geometry, part.material); m.name = part.part; m.matrixAutoUpdate = false; m.matrix.copy(part.matrix); m.castShadow = part.part !== 'Fruit'; crown.add(m); }
  bones[B.Head].add(crown);
  const glowMat = glowBase.clone(), glow = new THREE.Mesh(glowGeometry(size), glowMat); glow.name = 'EntGlow'; glow.userData.ignoreContact = true; glow.renderOrder = 2; bones[B.Spine].add(glow);
  const bodyGroup = new THREE.Group(); bodyGroup.name = 'EntBody'; bodyGroup.add(mesh);
  const visual = new THREE.Group(); visual.name = 'Ent'; visual.add(bodyGroup);
  visual.userData.ent = {size, H, S, mesh, bones: Object.fromEntries(BONES.map(n => [n, bones[B[n]]])), rest: Object.fromEntries(BONES.map(n => [n, {q: bones[B[n]].quaternion.clone(), p: bones[B[n]].position.clone()}])),
   crown, glow, glowMat, bodyGroup, seed, variant: VARIANTS[data.variant] || 'tree'};
  return visual;
 }
 const e1 = new THREE.Euler(), q1 = new THREE.Quaternion(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
 function rot(rig, name, x = 0, y = 0, z = 0) { const b = rig.bones[name]; b.quaternion.copy(rig.rest[name].q).multiply(q1.setFromEuler(e1.set(x, y, z))); }
 function pose(entry, tick, dt) {
  const visual = entry.visual, rig = visual.userData.ent, d = entry.data; if (!rig || !d) return;
  let st = states.get(visual);
  entry.root.getWorldPosition(v1);
  if (!st) { st = {last: v1.clone(), stride: rnd(rig.seed, 1), move: 0, sway: 0, swayV: 0, nod: 0, nodV: 0, hurt: d.hurtTick ?? -1e9, hurtAt: -1e9, slam: d.attackTick ?? -1e9, hitDir: 0}; states.set(visual, st); }
  const travel = Math.hypot(v1.x - st.last.x, v1.z - st.last.z); st.last.copy(v1);
  const spec = ENT_SIZES[rig.size], strideLen = rig.size === 'elder' ? 1.25 : .62;
  if (travel < 1.5) st.stride += travel / strideLen;
  st.move = lerp(st.move, travel > .0006 * 60 * dt ? 1 : 0, 1 - Math.exp(-dt * 8));
  const m = st.move, ph = st.stride * TAU, H = rig.H, scale = entHeight(d) / H;
  visual.scale.setScalar(scale);
  const age = (tick - d.wakeTick) / 60, rootIn = (tick - (entRootTick(d) - ENT.rootWindTicks)) / ENT.rootWindTicks;
  // Wake: the tree shudders, condenses from tree size to ent size and pulls its legs out of the ground.
  const wake = clamp(age / (ENT.wakeTicks / 60)), rise = smooth((age - .2) / .85), condense = smooth((age - .1) / .9), tremble = (1 - smooth((age - .05) / .55)) * (age >= 0 ? 1 : 0);
  const s0 = clamp((d.treeHeight || 6) * .82 / entHeight(d), 1, 2.4), sink = rootIn > 0 ? smooth(rootIn) : 0;
  rig.bodyGroup.scale.setScalar(wake < 1 ? lerp(s0, 1, condense) : 1);
  rig.bodyGroup.position.y = -(rig.S.hip * H) * ((wake < 1 ? 1 - rise : 0) + sink * .85);
  rig.bodyGroup.rotation.set(Math.sin(clock * 47 + rig.seed) * .025 * tremble, 0, Math.sin(clock * 53 + rig.seed * 2) * .03 * tremble);
  const branch = Math.max(wake < 1 ? 1 - smooth((age - .45) / .6) : 0, smooth(rootIn * 1.3)); // arms held up as limbs
  // Hurt recoil and attack timeline (strike lands on the shared tick 18).
  if ((d.hurtTick ?? -1e9) !== st.hurt) { st.hurt = d.hurtTick; st.hurtAt = clock; const h = lastHit.get(d.id); st.hitDir = h ? h : 0; }
  const recoil = Math.exp(-(clock - st.hurtAt) * 7) * (clock - st.hurtAt < 1.2 ? 1 : 0);
  const aAge = (tick - (d.attackTick ?? -1000)) / 60, attacking = aAge >= 0 && aAge < .8;
  let armX = 0, lean = -.09 * m, slamLean = 0;
  if (attacking) {
   const up = smooth(aAge / .27), down = smooth((aAge - .27) / .06), back = smooth((aAge - .45) / .35);
   armX = lerp(lerp(0, 2.55, up), .85, down) * (1 - back); slamLean = (lerp(.16 * up, -.38, down)) * (1 - back);
   if (aAge >= .3 && st.slam !== d.attackTick) { st.slam = d.attackTick; slam(entry, rig, d); }
  }
  // Locomotion: lumbering stride (elder) or springy trot (sapling); root legs swing, knees fold, the trunk lurches.
  const legA = (rig.size === 'elder' ? .5 : .62) * m, knee = (rig.size === 'elder' ? .75 : .9) * m;
  const sL = Math.sin(ph), sR = Math.sin(ph + Math.PI);
  rot(rig, 'LeftLeg', sL * legA, 0, -.04 * m); rot(rig, 'RightLeg', sR * legA, 0, .04 * m);
  rot(rig, 'LeftKnee', -Math.max(0, Math.sin(ph + 1.3)) * knee); rot(rig, 'RightKnee', -Math.max(0, Math.sin(ph + 1.3 + Math.PI)) * knee);
  const lurch = Math.sin(ph) * (rig.size === 'elder' ? .085 : .05) * m, bob = Math.abs(Math.cos(ph)) * (rig.size === 'elder' ? .025 : .05) * H * m;
  const breathe = Math.sin(clock * 1.3 + rig.seed) * .012;
  rig.bones.Torso.position.copy(rig.rest.Torso.p).add(v2.set(0, bob - (1 - Math.abs(Math.cos(ph))) * .01 * H * m, 0));
  rot(rig, 'Torso', lean + slamLean * .6 + recoil * .2 + breathe, 0, lurch + recoil * .06 * st.hitDir);
  rot(rig, 'Spine', slamLean * .5 + recoil * .12, Math.sin(clock * .7 + rig.seed) * .05 * (1 - m), -lurch * .4);
  // Crown: a damped spring that lags the body's lurch, plus wind; it shivers when struck.
  const target = -lurch * 1.6 + Math.sin(clock * .9 + rig.seed) * .025, targetNod = -(lean + slamLean) * .7;
  st.swayV += ((target - st.sway) * 38 - st.swayV * 6.5) * dt; st.sway += st.swayV * dt;
  st.nodV += ((targetNod - st.nod) * 30 - st.nodV * 6) * dt; st.nod += st.nodV * dt;
  rot(rig, 'Head', st.nod + Math.sin(clock * 31) * .03 * recoil, 0, st.sway + Math.sin(clock * 37 + 1) * .04 * recoil);
  // Arms: swing against the legs; lift together to slam; hold up and out as branches while waking or rooting.
  const swing = .38 * m;
  for (const [arm, elbow, s, leg] of [['LeftArm', 'ElbowL', 1, sL], ['RightArm', 'ElbowR', -1, sR]]) {
   const ax = lerp(-leg * swing + armX, .25, branch), az = lerp(s * -.08, s * -2.1, branch);
   rot(rig, arm, ax, 0, az + Math.sin(clock * 1.1 + rig.seed + s) * .03);
   rot(rig, elbow, lerp(.28 + (attacking ? -.2 * smooth(aAge / .27) : 0), .1, branch), 0, lerp(0, s * -.7, branch));
  }
  // Glow: eyes ignite as it wakes, flare when hit, dim as it roots.
  const eyes = (wake < 1 ? smooth((age - .45) / .4) : 1) * (1 - smooth(rootIn * 1.2)) * (.85 + .15 * Math.sin(clock * 2.6 + rig.seed)) + recoil * .8;
  rig.glowMat.color.setScalar(clamp(eyes, 0, 2)); rig.glow.visible = eyes > .02;
  if (wake < 1 && !woke.has(d.id) && age >= 0 && age < .6) { woke.add(d.id); wakeBurst(entry, rig, d, s0); }
 }
 function worldOf(rig, name, out) { return rig.bones[name].getWorldPosition(out); }
 function crownPoint(rig, out) { rig.crown.updateWorldMatrix(true, false); return out.set(0, (rig.S.crownTop - rig.S.head) * rig.H * .5, 0).applyMatrix4(rig.bones.Head.matrixWorld); }
 function leafColor(rig, i) { const p = LEAF[rig.variant] || LEAF.tree, c = p[i % p.length]; return {r: c[0], g: c[1], b: c[2]}; }
 function leaves(rig, at, n, spread, up = 1.2) { for (let i = 0; i < n; i++) { const a = Math.random() * TAU, s = spread * (.4 + Math.random() * .8);
  debris.emit({x: at.x + Math.cos(a) * spread * .4, y: at.y + (Math.random() - .3) * spread * .5, z: at.z + Math.sin(a) * spread * .4, vx: Math.cos(a) * s, vy: up * (.4 + Math.random()), vz: Math.sin(a) * s,
   life: 1.6 + Math.random() * 1.2, size: .07 + Math.random() * .06, grav: -1.4, drag: 1.6, flutter: 2.2, ground: true, ...leafColor(rig, i)}); } }
 function chips(at, n, spread, color = [.42, .3, .19]) { for (let i = 0; i < n; i++) { const a = Math.random() * TAU, s = spread * (.6 + Math.random());
  debris.emit({x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * s, vy: 1.6 + Math.random() * 2.2, vz: Math.sin(a) * s, life: .9 + Math.random() * .5, size: .05 + Math.random() * .05, grav: -9.8, drag: .3, ground: true, r: color[0] * (.8 + Math.random() * .4), g: color[1] * (.8 + Math.random() * .4), b: color[2] * (.8 + Math.random() * .4)}); } }
 function glowMotes(at, n, radius, rise = 1.4) { for (let i = 0; i < n; i++) { const a = Math.random() * TAU, r = radius * Math.sqrt(Math.random());
  motes.emit({x: at.x + Math.cos(a) * r, y: at.y + Math.random() * .4, z: at.z + Math.sin(a) * r, vx: -Math.sin(a) * .6, vy: rise * (.5 + Math.random()), vz: Math.cos(a) * .6, life: 1 + Math.random() * .9, size: .09 + Math.random() * .08, grav: 0, drag: .8, r: GLOW.r, g: GLOW.g, b: GLOW.b}); } }
 function wakeBurst(entry, rig, d, s0) {
  entry.root.getWorldPosition(v1); const g = height(v1.x, v1.z), n = quality === 'low' ? .55 : 1;
  v2.set(v1.x, g + (d.treeHeight || 6) * .7, v1.z); leaves(rig, v2, Math.round(46 * n), 1.6 * s0 * .6, 1.4);
  v2.set(v1.x, g + .05, v1.z); chips(v2, Math.round(26 * n), 1.6, [.3, .22, .14]); glowMotes(v2, Math.round(30 * n), rig.size === 'elder' ? 1.4 : .9, 1.8);
 }
 function slam(entry, rig, d) {
  rig.bones.ElbowL.updateWorldMatrix(true, false); entry.root.getWorldPosition(v1);
  const fwd = v2.set(-Math.sin(entry.root.rotation.y), 0, -Math.cos(entry.root.rotation.y)), reach = rig.size === 'elder' ? 1.6 : .9;
  const at = new THREE.Vector3(v1.x + fwd.x * reach * entHeight(d) / rig.H, 0, v1.z + fwd.z * reach * entHeight(d) / rig.H); at.y = height(at.x, at.z) + .04;
  chips(at, rig.size === 'elder' ? 18 : 7, rig.size === 'elder' ? 1.8 : 1, [.36, .28, .2]);
  onSound({kind: rig.size === 'elder' ? 'ent_slam' : 'ent_swipe', id: d.id, position: at.toArray(), size: rig.size});
  if (rig.size === 'elder') onRumble({position: at.toArray(), strength: .6, kind: 'slam'});
 }
 function update(actors, tick, dt) { clock += dt; let n = 0; for (const entry of actors.values()) if (entry.enemy && entry.visual?.userData.ent) { pose(entry, tick, dt); n++; } return n; }
 function event(e) {
  if (!e || !e.kind) return;
  if ((e.kind === 'hit' || e.kind === 'headshot') && e.material === 'wood' && Array.isArray(e.normal)) lastHit.set(e.id, e.normal[0] >= 0 ? 1 : -1);
  // Shared ent_* events already reach the wood kit through the game's event path; this module only voices what it
  // originates itself (slams, swipes, falls) and asks for rumble.
  if (e.kind === 'ent_wake') { onRumble({position: e.position, strength: e.size === 'elder' ? .8 : .45, kind: 'wake'}); }
  if (e.kind === 'ent_limb' && Array.isArray(e.position)) {
   v1.fromArray(e.position); chips(v1, e.part.endsWith('Leg') ? 16 : 22, 1.6); if (e.part === 'head') glowMotes(v1, 18, .8);
  }
 }
 // A removed ent becomes a corpse: felled (topples, its crown bursts into leaves, it sinks), rooted (sinks into its new
 // tree) or crumbled (a spot that could not hold a tree). The live actor gets an empty stand-in so the game frees nothing twice.
 function release(entry, snapshot) {
  const visual = entry.visual, rig = visual?.userData?.ent; if (!rig) return false;
  const id = entry.data?.id, rooted = (snapshot?.wildTrees || []).some(t => t.id === `${id}-tree`);
  maskMissingParts(visual, entry.data?.missingParts || []);
  scene.attach(visual); entry.visual = new THREE.Group(); entry.visual.userData.released = true;
  entry.root.getWorldPosition(v1);
  const dir = lastHit.get(id) ?? (rnd(rig.seed, 3) < .5 ? -1 : 1), axis = new THREE.Vector3(Math.cos(entry.root.rotation.y), 0, -Math.sin(entry.root.rotation.y));
  corpses.push({visual, rig, kind: rooted ? 'root' : 'fall', age: 0, base: v1.clone(), q0: visual.quaternion.clone(), axis, dir, burst: false, y0: rig.bodyGroup.position.y});
  if (!rooted) onSound({kind: 'ent_fall', id, position: v1.toArray(), size: rig.size});
  else { v2.set(v1.x, height(v1.x, v1.z) + .1, v1.z); glowMotes(v2, 24, 1.2, 2.2); leaves(rig, v2.set(v1.x, v2.y + rig.H * .7, v1.z), 18, 1, 1); }
  lastHit.delete(id); woke.delete(id);
  return true;
 }
 function endCorpse(c) { maskMissingParts(c.visual, []); c.visual.removeFromParent(); c.rig.glowMat.dispose(); c.rig.mesh.skeleton.dispose(); }
 function tick(dt) {
  for (let i = corpses.length - 1; i >= 0; i--) {
   const c = corpses[i], rig = c.rig; c.age += dt;
   if (c.kind === 'root') { // sink into the ground while the new tree grows from the same spot
    const u = smooth(c.age / 1.1); rig.bodyGroup.position.y = lerp(c.y0, -rig.H * 1.05, u); rig.glowMat.color.setScalar(Math.max(0, .6 - c.age));
    if (c.age > 1.2) { endCorpse(c); corpses.splice(i, 1); } continue;
   }
   const fall = clamp(c.age / .75) ** 2 * 1.35; c.visual.quaternion.copy(q1.setFromAxisAngle(c.axis, fall * c.dir)).multiply(c.q0);
   rig.glowMat.color.setScalar(Math.max(0, 1 - c.age * 2.5));
   if (!c.burst && c.age > .55) { c.burst = true; crownPoint(rig, v1); leaves(rig, v1, quality === 'low' ? 30 : 60, 1.4, .8); rig.crown.visible = false; c.visual.getWorldPosition(v2); chips(v2.setY(height(v2.x, v2.z) + .3), 24, 2.2); onRumble({position: v2.toArray(), strength: rig.size === 'elder' ? .7 : .35, kind: 'fall'}); }
   if (c.age > .9) { const s = smooth((c.age - .9) / .7); rig.bodyGroup.position.y = c.y0 - s * rig.H * .4; rig.bodyGroup.scale.setScalar(Math.max(.001, 1 - s)); }
   if (c.age > 1.6) { endCorpse(c); corpses.splice(i, 1); }
  }
  debris.tick(dt, height); motes.tick(dt, height);
 }
 function stats() { return {corpses: corpses.length, debris: debris.count(), motes: motes.count(), kits: kits.size, bodies: bodies.size}; }
 function dispose() { for (const c of corpses) endCorpse(c); corpses.length = 0; debris.dispose(); motes.dispose(); tex.dispose(); for (const b of bodies.values()) b.geometry.dispose(); for (const g of glows.values()) g.dispose(); glowBase.dispose(); fruitGlow.dispose(); }
 return {build, update, release, event, tick, stats, dispose, ready: variant => !!kit(variant)};
}
