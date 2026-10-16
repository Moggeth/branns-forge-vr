// The Underways' prop kit, modelled in code: each prop is a small assembly of shaped parts (bevelled timbers, lathed
// pots and barrels, faceted crystals, strapped chests) with its own albedo per vertex and a glow channel for the parts
// that make light (flames, lamp glass, crystal hearts). Shared by every dungeon; instanced per type.
// Local frame: y up from the floor, -z forward (into the room), metres.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

const C = {
  timber: [.42, .27, .15], timberDark: [.3, .19, .1], timberPale: [.55, .38, .22], iron: [.2, .2, .22], ironWarm: [.28, .24, .22],
  brass: [.78, .58, .26], gold: [.95, .72, .28], rock: [.42, .35, .3], rockDark: [.3, .26, .23], clay: [.66, .38, .24], clayDark: [.46, .26, .17],
  cloth: [.62, .2, .18], clothBlue: [.2, .32, .58], lamp: [1, .78, .42], flame: [1, .55, .18], stone: [.55, .53, .5], stoneDark: [.4, .39, .37], moss: [.25, .38, .16],
  paper: [.88, .82, .66], ore: [.5, .46, .44],
};

/** One coloured part: geometry moved into place, with per-vertex colour and glow (0 none .. 1 full self-light). */
function part(geo, color, {at = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], glow = 0, jitter = 0, seed = 1} = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.deleteAttribute('uv');
  g.scale(...scale); g.rotateX(rot[0]); g.rotateY(rot[1]); g.rotateZ(rot[2]); g.translate(...at);
  const n = g.attributes.position.count, col = new Float32Array(n * 3), gl = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const tri = Math.floor(i / 3), k = jitter ? 1 + (((Math.imul(tri + seed * 131, 2654435761) >>> 0) % 1000) / 1000 - .5) * jitter : 1;
    col[i * 3] = color[0] * k; col[i * 3 + 1] = color[1] * k; col[i * 3 + 2] = color[2] * k; gl[i] = glow;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aGlow', new THREE.BufferAttribute(gl, 1));
  return g;
}
const merge = parts => { const g = mergeGeometries(parts, false); g.computeVertexNormals(); g.computeBoundingSphere(); return g; };
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s);
const lathe = (pts, s = 12) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), s);
// A timber with a chamfer feel: a box with a slightly smaller darker core showing at the ends.
const beam = (w, h, d, color, opts) => [part(box(w, h, d), color, {...opts, jitter: .12}), part(box(w * .86, h * 1.004, d * .86), C.timberDark, opts)];
const rng = seed => { let s = seed >>> 0 || 1; return () => (s = Math.imul(s ^ s >>> 15, 0x2c1b3c6d) + 0x6d2b79f5 >>> 0, (s >>> 8) / 16777216); };

// The guardian's crown: a dented miner's-gold band with five crystal points, the brightest set front and centre.
// Sized for a 1 m wide head; the view scales it to the golem it sits on.
function crown() {
  const parts = [part(cyl(.5, .46, .26, 14), C.gold, {at: [0, .13, 0], jitter: .12}), part(cyl(.53, .53, .06, 14), C.brass, {at: [0, .02, 0]}),
    part(cyl(.53, .53, .05, 14), C.brass, {at: [0, .25, 0]})];
  for (let k = 0; k < 5; k++) {
    const a = k / 5 * Math.PI * 2, h = k === 0 ? .62 : .38 + (k % 2) * .08, x = Math.sin(a) * .48, z = Math.cos(a) * .48;
    parts.push(part(cyl(0, .1, .22, 4), C.gold, {at: [x, .36, z], rot: [0, a, 0]}));
    parts.push(part(new THREE.OctahedronGeometry(.11, 0), k === 0 ? [1, .78, .36] : [.5, .85, 1], {at: [x * 1.02, .28 + h * .5, z * 1.02], scale: [1, h * 2.4, 1], glow: k === 0 ? .55 : .35}));
  }
  return merge(parts);
}

function crystalCluster(color, seed) {
  const r = rng(seed), parts = [], heart = color.map(v => Math.min(1, v * 1.1)), deep = color.map(v => v * .55);
  const count = 5 + Math.floor(r() * 3);
  for (let i = 0; i < count; i++) {
    const h = .35 + r() * .9 * (i === 0 ? 1.4 : 1), w = .07 + r() * .08, a = r() * 6.283, tilt = i === 0 ? r() * .2 : .25 + r() * .55;
    const geo = new THREE.CylinderGeometry(0, w, h * .35, 6, 1); geo.translate(0, h * .5 + h * .175, 0);
    const shaft = new THREE.CylinderGeometry(w, w * 1.15, h, 6, 1); shaft.translate(0, h * .5, 0);
    const g = mergeGeometries([geo.toNonIndexed(), shaft.toNonIndexed()]);
    const ox = Math.cos(a) * (i ? .08 + r() * .18 : 0), oz = Math.sin(a) * (i ? .08 + r() * .18 : 0);
    parts.push(part(g, i % 2 ? deep : heart, {at: [ox, -.04, oz], rot: [Math.sin(a) * tilt, a, Math.cos(a) * tilt], glow: i % 2 ? .12 + r() * .1 : .3 + r() * .15, jitter: .25, seed: seed + i}));
  }
  parts.push(part(new THREE.DodecahedronGeometry(.22, 0), C.rockDark, {at: [0, .02, 0], scale: [1.3, .45, 1.1], jitter: .2}));
  return merge(parts);
}

function lantern() {
  // A miner's lantern on a bracket post: post against the wall, arm reaching into the room, brass-capped lamp.
  return merge([
    ...beam(.14, 2.5, .14, C.timber, {at: [0, 1.25, .1]}),
    ...beam(.1, .1, .7, C.timber, {at: [0, 2.28, -.2]}),
    part(box(.06, .3, .06), C.timberDark, {at: [0, 2.1, .12], rot: [-.75, 0, 0]}),
    part(cyl(.012, .012, .2, 4), C.iron, {at: [0, 2.13, -.5]}),
    part(cyl(.05, .11, .08, 8), C.brass, {at: [0, 2.0, -.5]}),
    part(cyl(.1, .1, .22, 8), C.lamp, {at: [0, 1.84, -.5], glow: 1}),
    ...[0, 1, 2, 3].map(k => part(box(.018, .24, .018), C.brass, {at: [Math.cos(k * 1.571 + .785) * .1, 1.84, -.5 + Math.sin(k * 1.571 + .785) * .1]})),
    part(cyl(.11, .08, .05, 8), C.brass, {at: [0, 1.71, -.5]}),
    part(cyl(.035, .02, .07, 6), C.flame, {at: [0, 1.85, -.5], glow: 1}),
  ]);
}
function cart() {
  const parts = [
    part(box(1.4, .5, .86), C.timber, {at: [0, .62, 0], jitter: .1}),
    part(box(1.3, .08, .76), C.timberDark, {at: [0, .4, 0]}),
    ...[-.45, 0, .45].map(x => part(box(.05, .52, .9), C.iron, {at: [x, .62, 0]})),
    ...[[-.48, -.46], [.48, -.46], [-.48, .46], [.48, .46]].map(([x, z]) => part(cyl(.2, .2, .07, 12), C.iron, {at: [x, .22, z], rot: [Math.PI / 2, 0, 0]})),
    ...[[-.48, -.46], [.48, -.46], [-.48, .46], [.48, .46]].map(([x, z]) => part(cyl(.06, .06, .09, 8), C.brass, {at: [x, .22, z], rot: [Math.PI / 2, 0, 0]})),
  ];
  const r = rng(7);
  for (let i = 0; i < 9; i++) parts.push(part(new THREE.DodecahedronGeometry(.13 + r() * .1, 0), i % 4 === 0 ? [.55, .8, 1] : C.ore, {at: [(r() - .5) * 1.0, .9 + r() * .12, (r() - .5) * .55], rot: [r() * 3, r() * 3, 0], glow: i % 4 === 0 ? .8 : 0, jitter: .2}));
  return merge(parts);
}
function barrel() {
  const prof = [[0, 0], [.28, 0], [.33, .2], [.35, .42], [.33, .64], [.28, .84], [0, .84]];
  return merge([
    part(lathe(prof, 14), C.timberPale, {jitter: .18}),
    part(cyl(.345, .345, .05, 14), C.iron, {at: [0, .2, 0]}), part(cyl(.345, .345, .05, 14), C.iron, {at: [0, .64, 0]}),
    part(cyl(.28, .28, .02, 14), C.timberDark, {at: [0, .845, 0]}),
  ]);
}
function crate() {
  return merge([
    part(box(.7, .7, .7), C.timberPale, {at: [0, .35, 0], jitter: .15}),
    ...[[0, .03], [0, .67]].flatMap(([, y]) => [part(box(.74, .08, .1), C.timber, {at: [0, y, .33]}), part(box(.74, .08, .1), C.timber, {at: [0, y, -.33]}), part(box(.1, .08, .74), C.timber, {at: [.33, y, 0]}), part(box(.1, .08, .74), C.timber, {at: [-.33, y, 0]})]),
    part(box(.1, .9, .06), C.timber, {at: [0, .35, .36], rot: [0, 0, .78]}), part(box(.1, .9, .06), C.timber, {at: [0, .35, -.36], rot: [0, 0, -.78]}),
  ]);
}
function rubble(seed = 3) {
  const r = rng(seed), parts = [];
  for (let i = 0; i < 7; i++) parts.push(part(new THREE.DodecahedronGeometry(.12 + r() * .22, 0), r() > .5 ? C.rock : C.rockDark, {at: [(r() - .5) * 1.1, .08 + r() * .08, (r() - .5) * .9], rot: [r() * 3, r() * 3, r() * 3], scale: [1, .7, 1], jitter: .25, seed: i}));
  return merge(parts);
}
function mushrooms(seed = 5) {
  const r = rng(seed), parts = [];
  for (let i = 0; i < 4; i++) {
    const h = .12 + r() * .3, x = (r() - .5) * .4, z = (r() - .5) * .4, s = .08 + r() * .12;
    parts.push(part(cyl(.025, .035, h, 6), [.85, .82, .7], {at: [x, h / 2, z]}));
    parts.push(part(new THREE.SphereGeometry(s, 10, 6, 0, 6.283, 0, 1.4), [.35, .95, .85], {at: [x, h, z], scale: [1, .6, 1], glow: .85}));
  }
  return merge(parts);
}
// Corridor timbering: two posts and a cap beam, width 1 (scaled per corridor), height 1 (scaled to the roof).
function timberSet() {
  return merge([
    ...beam(.2, 1, .2, C.timber, {at: [-.5, .5, 0]}), ...beam(.2, 1, .2, C.timber, {at: [.5, .5, 0]}),
    ...beam(1.18, .2, .24, C.timber, {at: [0, .97, 0]}),
    part(box(.12, .32, .14), C.timberDark, {at: [-.4, .86, 0], rot: [0, 0, -.8]}), part(box(.12, .32, .14), C.timberDark, {at: [.4, .86, 0], rot: [0, 0, .8]}),
  ]);
}
// A pit prop against a cave wall: a post (unit height, scaled to the roof), a cap block and a raking brace.
function pitProp() {
  return merge([...beam(.22, 1, .22, C.timber, {at: [0, .5, 0]}), part(box(.5, .08, .4), C.timberDark, {at: [0, .97, -.05]}), part(box(.1, .45, .12), C.timberPale, {at: [0, .78, -.16], rot: [.6, 0, 0]})]);
}
// The ladder you came down: two rails and rungs, unit height (scaled to the roof), leaning on the wall behind.
function ladder() {
  const parts = [part(box(.08, 1, .08), C.timberPale, {at: [-.28, .5, 0], jitter: .1}), part(box(.08, 1, .08), C.timberPale, {at: [.28, .5, 0], jitter: .1})];
  for (let k = 0; k < 10; k++) parts.push(part(box(.56, .035, .05), C.timber, {at: [0, .06 + k * .1, 0]}));
  return merge(parts);
}
// Mine rails: a 2 m length (sleepers and two rails) along -z.
function rails() {
  const parts = [part(box(.06, .06, 2), C.iron, {at: [-.36, .07, 0]}), part(box(.06, .06, 2), C.iron, {at: [.36, .07, 0]})];
  for (let k = 0; k < 3; k++) parts.push(part(box(1.0, .06, .18), C.timberDark, {at: [0, .03, -.66 + k * .66], jitter: .2, seed: k}));
  return merge(parts);
}
function pot(seed = 2) {
  const prof = [[0, 0], [.16, 0], [.25, .12], [.27, .28], [.2, .44], [.13, .5], [.15, .56], [0, .56]];
  return merge([part(lathe(prof, 12), C.clay, {jitter: .12, seed}), part(cyl(.2, .26, .05, 12), C.clayDark, {at: [0, .26, 0]}), part(cyl(.1, .14, .04, 10), C.clayDark, {at: [0, .58, 0]})]);
}
function chestBase() {
  return merge([
    part(box(1.0, .5, .64), C.timber, {at: [0, .25, 0], jitter: .1}),
    ...[-.32, .32].map(x => part(box(.08, .52, .67), C.iron, {at: [x, .25, 0]})),
    part(box(1.04, .06, .68), C.ironWarm, {at: [0, .02, 0]}),
    part(box(.18, .2, .04), C.gold, {at: [0, .4, -.33], glow: .15}),
  ]);
}
function chestLid() {
  // Hinged at the back edge (+z): the mesh's origin sits on the hinge line.
  const g = new THREE.CylinderGeometry(.32, .32, 1.0, 12, 1, false, 0, Math.PI); g.rotateZ(Math.PI / 2); g.rotateY(Math.PI / 2); // half-drum lid
  return merge([part(g, C.timberPale, {at: [0, 0, -.32], scale: [1, .7, 1], jitter: .1}), ...[-.32, .32].map(x => part(new THREE.CylinderGeometry(.33, .33, .08, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), C.iron, {at: [x, 0, -.32], scale: [1, .7, 1]}))]);
}
function keyAndPlinth() {
  const plinth = merge([part(box(.8, .9, .8), C.stone, {at: [0, .45, 0], jitter: .1}), part(box(.95, .12, .95), C.stoneDark, {at: [0, .9, 0]}), part(box(.95, .12, .95), C.stoneDark, {at: [0, .06, 0]})]);
  const key = merge([
    part(new THREE.TorusGeometry(.16, .045, 8, 18), C.gold, {at: [0, .3, 0], glow: .35}),
    part(cyl(.035, .035, .55, 8), C.gold, {at: [0, -.05, 0], glow: .35}),
    part(box(.16, .07, .05), C.gold, {at: [.08, -.25, 0], glow: .35}), part(box(.11, .06, .05), C.gold, {at: [.06, -.13, 0], glow: .35}),
    part(new THREE.OctahedronGeometry(.07, 0), [.5, .9, 1], {at: [0, .3, 0], glow: 1}),
  ]);
  return {plinth, key};
}
function shrine() {
  // The Lantern Saint: a stone niche with a great lantern and a ring of candles.
  const parts = [
    part(box(1.4, .3, 1.0), C.stoneDark, {at: [0, .15, 0], jitter: .1}), part(box(1.1, 1.0, .7), C.stone, {at: [0, .8, .1], jitter: .1}),
    part(box(1.25, .14, .85), C.stoneDark, {at: [0, 1.34, .1]}),
    part(cyl(.22, .26, .1, 10), C.brass, {at: [0, 1.46, .1]}), part(cyl(.2, .2, .5, 10), C.lamp, {at: [0, 1.76, .1], glow: 1}),
    ...[0, 1, 2, 3, 4, 5].map(k => part(box(.03, .5, .03), C.brass, {at: [Math.cos(k * 1.047) * .2, 1.76, .1 + Math.sin(k * 1.047) * .2]})),
    part(new THREE.ConeGeometry(.28, .3, 10), C.brass, {at: [0, 2.16, .1]}), part(new THREE.TorusGeometry(.08, .02, 6, 12), C.brass, {at: [0, 2.36, .1]}),
  ];
  for (let k = 0; k < 7; k++) { const a = Math.PI * (.15 + .7 * k / 6), x = Math.cos(a) * .62, z = -Math.sin(a) * .5 - .1, h = .12 + (k % 3) * .06; parts.push(part(cyl(.035, .035, h, 6), C.paper, {at: [x, .3 + h / 2, z]}), part(new THREE.ConeGeometry(.025, .07, 5), C.flame, {at: [x, .35 + h, z], glow: 1})); }
  return merge(parts);
}
function hoardPile() {
  const r = rng(11), parts = [part(new THREE.SphereGeometry(1.5, 16, 8, 0, 6.283, 0, 1.2), C.gold, {at: [0, -.85, 0], scale: [1, .55, 1], glow: .12, jitter: .25})];
  for (let i = 0; i < 70; i++) { const a = r() * 6.283, d = r() * 1.35, y = Math.max(0, .55 - d * .4) + .02; parts.push(part(cyl(.07, .07, .018, 8), r() > .3 ? C.gold : C.brass, {at: [Math.cos(a) * d, y, Math.sin(a) * d], rot: [r() * 1.2 - .6, 0, r() * 1.2 - .6], glow: .18, seed: i})); }
  for (let i = 0; i < 8; i++) { const a = r() * 6.283, d = .3 + r() * 1; parts.push(part(new THREE.OctahedronGeometry(.08 + r() * .05, 0), [[.5, .9, 1], [.9, .4, 1], [.4, 1, .6]][i % 3], {at: [Math.cos(a) * d, .25 + r() * .2, Math.sin(a) * d], glow: .9})); }
  for (let i = 0; i < 3; i++) parts.push(part(cyl(.12, .1, .3, 10), C.gold, {at: [(r() - .5) * 1.6, .2, (r() - .5) * 1.2], rot: [r() * .4, 0, r() * .4], glow: .2}));
  return merge(parts);
}
function gateMine() {
  // A barricade of iron-banded logs with a great padlock; width 1 (scaled to the corridor), rises into the roof.
  const parts = [];
  for (let k = 0; k < 7; k++) parts.push(part(cyl(.075, .075, 3.4, 7), k % 2 ? C.timber : C.timberPale, {at: [-.43 + k * .143, 1.7, 0], jitter: .15, seed: k}));
  for (const y of [.6, 2.6]) parts.push(part(box(1.0, .14, .2), C.iron, {at: [0, y, 0]}));
  parts.push(part(box(.36, .34, .14), C.brass, {at: [0, 1.5, -.16]}), part(new THREE.TorusGeometry(.12, .035, 6, 12, Math.PI), C.iron, {at: [0, 1.67, -.16]}));
  parts.push(part(box(.05, .1, .02), [.5, .9, 1], {at: [0, 1.48, -.235], glow: 1}));
  return merge(parts);
}
function exitRing() {
  return merge([
    part(new THREE.TorusGeometry(1.2, .1, 10, 40), [.6, .9, 1], {at: [0, 1.4, 0], glow: 1}),
    part(new THREE.TorusGeometry(1.05, .035, 6, 40), [1, .85, .5], {at: [0, 1.4, 0], glow: 1}),
    ...Array.from({length: 8}, (_, k) => part(new THREE.OctahedronGeometry(.08, 0), [.7, .95, 1], {at: [Math.cos(k * .785) * 1.2, 1.4 + Math.sin(k * .785) * 1.2, 0], glow: 1})),
  ]);
}
function returnCircle() {
  const parts = [part(new THREE.RingGeometry(.8, .95, 40), [.55, .85, 1], {rot: [-Math.PI / 2, 0, 0], at: [0, .025, 0], glow: .8})];
  for (let k = 0; k < 6; k++) parts.push(part(new THREE.PlaneGeometry(.16, .26), [.6, .9, 1], {rot: [-Math.PI / 2, 0, k * 1.047], at: [Math.cos(k * 1.047) * .62, .026, Math.sin(k * 1.047) * .62], glow: .7}));
  return merge(parts);
}
function vent() {
  return merge([
    part(cyl(.62, .7, .1, 12), C.rockDark, {at: [0, .05, 0], jitter: .2}),
    part(cyl(.48, .48, .06, 12), C.iron, {at: [0, .1, 0]}),
    ...[-.3, -.15, 0, .15, .3].map(x => part(box(.04, .05, .9 * Math.sqrt(1 - (x / .48) ** 2)), C.ironWarm, {at: [x, .14, 0]})),
  ]);
}
function flameColumn() {
  // Three nested cones (unit height 1), additive-tinted by the material; scaled by the view as the vent roars.
  return merge([part(new THREE.ConeGeometry(.42, 1, 10, 1, true), [1, .42, .12], {at: [0, .5, 0], glow: 1}), part(new THREE.ConeGeometry(.28, .8, 10, 1, true), [1, .7, .3], {at: [0, .4, 0], glow: 1}), part(new THREE.ConeGeometry(.14, .55, 8, 1, true), [1, .95, .7], {at: [0, .28, 0], glow: 1})]);
}
function crackedRoof() {
  // A ring of hanging loose rock seen from below; sits at the roof.
  const r = rng(21), parts = [];
  for (let i = 0; i < 9; i++) { const a = r() * 6.283, d = r() * 1.2; parts.push(part(new THREE.DodecahedronGeometry(.18 + r() * .2, 0), r() > .5 ? C.rock : C.rockDark, {at: [Math.cos(a) * d, -.12 - r() * .1, Math.sin(a) * d], scale: [1, .6, 1], rot: [r() * 3, r() * 3, 0], jitter: .3, seed: i})); }
  for (let i = 0; i < 3; i++) parts.push(part(box(.12, .9, .12), C.timberDark, {at: [(r() - .5) * 2, -.2, (r() - .5) * 2], rot: [r() * .5, r() * 3, .4 + r() * .4]}));
  return merge(parts);
}
function fallenRock(seed) { return merge([part(new THREE.DodecahedronGeometry(.28, 0), C.rock, {jitter: .3, seed}), part(new THREE.DodecahedronGeometry(.18, 0), C.rockDark, {at: [.2, .05, .1], seed: seed + 1})]); }
function sign() {
  return merge([
    ...beam(.12, 1.5, .12, C.timber, {at: [0, .75, 0]}),
    part(box(1.0, .5, .05), C.brass, {at: [0, 1.4, -.08], glow: .05}), part(box(.92, .42, .02), [.25, .18, .1], {at: [0, 1.4, -.11]}),
    ...[[-.35, .1], [-.1, .06], [.15, .08], [-.3, -.06], [0, -.08], [.25, -.05]].map(([x, y], k) => part(box(.12 + (k % 3) * .04, .035, .01), C.paper, {at: [x, 1.4 + y, -.125], glow: .25})),
  ]);
}
function camp() {
  // The lost miner's camp: bedroll, cold fire ring with a kettle, a crate table with a candle and a half-written letter.
  const parts = [part(cyl(.2, .2, 1.4, 10), C.clothBlue, {at: [-.7, .2, 0], rot: [Math.PI / 2, 0, 0], jitter: .15}), part(cyl(.18, .18, .02, 10), C.cloth, {at: [-.7, .2, -.71], rot: [Math.PI / 2, 0, 0]})];
  for (let k = 0; k < 8; k++) parts.push(part(new THREE.DodecahedronGeometry(.1, 0), C.rockDark, {at: [.5 + Math.cos(k * .785) * .35, .06, Math.sin(k * .785) * .35], seed: k}));
  parts.push(part(box(.4, .05, .06), [.18, .12, .08], {at: [.5, .05, 0], rot: [0, .6, 0]}), part(box(.4, .05, .06), [.18, .12, .08], {at: [.5, .05, 0], rot: [0, -.6, 0]}));
  parts.push(part(lathe([[0, 0], [.13, 0], [.15, .1], [.1, .2], [0, .21]], 10), C.ironWarm, {at: [.5, .1, 0]}), part(cyl(.02, .02, .14, 5), C.ironWarm, {at: [.64, .22, 0], rot: [0, 0, .9]}));
  parts.push(part(box(.6, .5, .5), C.timberPale, {at: [.2, .25, .8], jitter: .15}), part(box(.3, .01, .2), C.paper, {at: [.1, .505, .8], rot: [0, .3, 0], glow: .1}));
  parts.push(part(cyl(.03, .03, .12, 6), C.paper, {at: [.38, .56, .72]}), part(new THREE.ConeGeometry(.022, .06, 5), C.flame, {at: [.38, .65, .72], glow: 1}));
  return merge(parts);
}
function pickRack() {
  // Twelve tiny pickaxes on hooks, smallest to largest, and one very big empty hook.
  const parts = [...beam(3.2, .14, .1, C.timber, {at: [0, 1.6, 0]})];
  for (let k = 0; k < 12; k++) {
    const s = .35 + k * .05, x = -1.45 + k * .22;
    parts.push(part(box(.03, .1, .03), C.iron, {at: [x, 1.5, -.06]}));
    parts.push(part(box(.03, .55 * s, .03), C.timberPale, {at: [x, 1.45 - .27 * s, -.08]}));
    parts.push(part(box(.32 * s, .045, .045), C.iron, {at: [x, 1.45 - .02, -.08], rot: [0, 0, .12]}));
  }
  parts.push(part(new THREE.TorusGeometry(.18, .045, 6, 12, Math.PI * 1.3), C.iron, {at: [1.42, 1.32, -.08], rot: [0, 0, Math.PI * 1.15]}));
  return merge(parts);
}


// ---- Crypt and sunken keep pieces.
function pillar(style) {
  // Unit height (scaled to the roof): plinth, shaft and capital. The crypt's is fluted grey stone; the keep's is warm
  // ashlar drums with an ivy collar.
  const st = style === 'keep' ? [.6, .55, .45] : C.stone, dk = style === 'keep' ? [.48, .44, .36] : C.stoneDark, parts = [];
  parts.push(part(box(1.1, .1, 1.1), dk, {at: [0, .05, 0]}), part(cyl(.42, .5, .06, 12), st, {at: [0, .12, 0]}));
  if (style === 'keep') for (let k = 0; k < 6; k++) parts.push(part(cyl(.4, .4, .14, 12), k % 2 ? st : dk, {at: [0, .2 + k * .135, 0], jitter: .15, seed: k}));
  else parts.push(part(cyl(.36, .4, .8, 12), st, {at: [0, .55, 0], jitter: .08}));
  parts.push(part(cyl(.5, .4, .06, 12), st, {at: [0, .97, 0]}), part(box(1.05, .06, 1.05), dk, {at: [0, 1.0, 0]}));
  if (style === 'keep') parts.push(part(new THREE.TorusGeometry(.42, .07, 6, 14), C.moss, {at: [0, .35, 0], rot: [Math.PI / 2, 0, 0], jitter: .3}));
  return merge(parts);
}
function torch() {
  return merge([part(box(.14, .3, .06), C.iron, {at: [0, 2.0, .04]}), part(box(.05, .05, .32), C.iron, {at: [0, 2.06, -.12], rot: [-.5, 0, 0]}),
    part(cyl(.05, .03, .5, 6), C.timber, {at: [0, 2.2, -.26], rot: [-.25, 0, 0]}), part(cyl(.08, .05, .1, 8), C.iron, {at: [0, 2.43, -.31]}),
    part(new THREE.ConeGeometry(.09, .32, 7), C.flame, {at: [0, 2.62, -.33], glow: 1}), part(new THREE.ConeGeometry(.05, .2, 6), [1, .9, .55], {at: [0, 2.56, -.33], glow: 1})]);
}
function brazier() {
  const parts = [part(lathe([[0, 0], [.3, 0], [.12, .1], [.08, .7], [.18, .78], [.42, .92], [.45, 1.0], [0, .96]], 12), C.ironWarm)];
  for (let k = 0; k < 6; k++) parts.push(part(new THREE.DodecahedronGeometry(.1, 0), [.3, .12, .06], {at: [Math.cos(k) * .2, 1.0, Math.sin(k) * .2], glow: .6}));
  parts.push(part(new THREE.ConeGeometry(.28, .6, 8), C.flame, {at: [0, 1.32, 0], glow: 1}), part(new THREE.ConeGeometry(.15, .4, 7), [1, .9, .55], {at: [0, 1.22, 0], glow: 1}));
  return merge(parts);
}
function sarcophagus() {
  return merge([part(box(.95, .7, 2.1), C.stone, {at: [0, .35, 0], jitter: .08}), part(box(1.05, .12, 2.2), C.stoneDark, {at: [0, .76, 0]}),
    part(box(.6, .14, 1.4), C.stone, {at: [0, .89, .05]}), part(new THREE.SphereGeometry(.2, 10, 8), C.stone, {at: [0, .95, -.7], scale: [1, .7, 1]}),
    part(box(.2, .1, .6), C.stone, {at: [-.15, .97, .1], rot: [0, .2, 0]}), part(box(.2, .1, .6), C.stone, {at: [.15, .97, .1], rot: [0, -.2, 0]}),
    part(box(.98, .05, .05), C.gold, {at: [0, .5, -1.06]})]);
}
function candles(seed = 4) {
  const r = rng(seed), parts = [];
  for (let k = 0; k < 6; k++) { const a = r() * 6.283, d = r() * .25, h = .08 + r() * .25, x = Math.cos(a) * d, z = Math.sin(a) * d; parts.push(part(cyl(.03, .035, h, 6), C.paper, {at: [x, h / 2, z]}), part(new THREE.ConeGeometry(.02, .06, 5), C.flame, {at: [x, h + .035, z], glow: 1})); }
  parts.push(part(cyl(.18, .2, .03, 10), [.85, .8, .62], {at: [0, .015, 0]}));
  return merge(parts);
}
function bones(seed = 6) {
  const r = rng(seed), bone = [.88, .84, .72], parts = [part(new THREE.SphereGeometry(.12, 10, 8), bone, {at: [.1, .1, 0], scale: [1, .9, 1.15]})];
  for (let k = 0; k < 5; k++) parts.push(part(cyl(.025, .025, .4 + r() * .2, 5), bone, {at: [(r() - .5) * .6, .04, (r() - .5) * .6], rot: [Math.PI / 2, r() * 3, 0]}));
  return merge(parts);
}
function urnPile() { const a = pot(3), b = pot(5); b.scale(.7, .7, .7); b.translate(.38, 0, .12); const c = pot(7); c.scale(.8, .55, .8); c.rotateZ(1.4); c.translate(-.3, .17, .2); return merge([a, b, c]); }
function roots(seed = 8) {
  // Roots hanging from the roof, unit height (the view scales them to the room): a few long tapering strands.
  const r = rng(seed), parts = [];
  for (let k = 0; k < 6; k++) { const len = .25 + r() * .45, x = (r() - .5) * .9, z = (r() - .5) * .9; parts.push(part(cyl(.05 * (1 - k * .05), .012, len, 5), k % 2 ? [.36, .26, .16] : [.3, .22, .14], {at: [x, 1 - len / 2, z], rot: [(r() - .5) * .3, 0, (r() - .5) * .3]})); }
  parts.push(part(new THREE.SphereGeometry(.12, 8, 6), C.moss, {at: [0, .98, 0], scale: [3, .5, 3], jitter: .3}));
  return merge(parts);
}
function masonry(seed = 9) { const r = rng(seed), parts = []; for (let k = 0; k < 4; k++) parts.push(part(box(.5 + r() * .3, .3, .35), r() > .5 ? [.6, .55, .45] : [.5, .46, .38], {at: [(r() - .5) * .7, .15 + (k > 2 ? .3 : 0), (r() - .5) * .5], rot: [0, r() * 3, (r() - .5) * .3], jitter: .15, seed: k})); return merge(parts); }
function banner(color) {
  const cloth = new THREE.PlaneGeometry(.8, 1.6, 1, 4); const p = cloth.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setZ(i, Math.sin((y + .8) * 2) * .04); if (y < -.75) p.setY(i, y - Math.abs(p.getX(i)) * .3); }
  return merge([part(cyl(.025, .025, 1, 6), C.iron, {at: [0, 3.1, -.06], rot: [0, 0, Math.PI / 2]}), part(cloth, color, {at: [0, 2.3, -.07], jitter: .1}), part(new THREE.CircleGeometry(.18, 12), C.gold, {at: [0, 2.45, -.085], rot: [0, Math.PI, 0], glow: .15})]);
}
function spikePlate() { const parts = [part(box(1.8, .06, 1.8), C.ironWarm, {at: [0, .03, 0]})]; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) parts.push(part(box(.08, .07, .08), C.iron, {at: [-.6 + i * .4, .06, -.6 + j * .4]})); return merge(parts); }
function spikes() { const parts = []; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) parts.push(part(new THREE.ConeGeometry(.07, .7, 5), [.75, .74, .72], {at: [-.6 + i * .4, .35, -.6 + j * .4]})); return merge(parts); }
function portcullis() {
  const parts = []; for (let k = 0; k < 7; k++) parts.push(part(box(.07, 3.4, .07), C.iron, {at: [-.43 + k * .143, 1.7, 0]}));
  for (const y of [.5, 1.4, 2.3, 3.2]) parts.push(part(box(1.0, .07, .09), C.iron, {at: [0, y, 0]}));
  for (let k = 0; k < 7; k++) parts.push(part(new THREE.ConeGeometry(.06, .18, 4), C.iron, {at: [-.43 + k * .143, -.08, 0], rot: [Math.PI, 0, 0]}));
  parts.push(part(box(.36, .34, .14), C.brass, {at: [0, 1.5, -.12]}), part(box(.05, .1, .02), [.5, .9, 1], {at: [0, 1.48, -.195], glow: 1}));
  return merge(parts);
}
function tableFeast() {
  const parts = [part(box(2.6, .1, 1.0), C.timber, {at: [0, .78, 0], jitter: .1}), ...[[-1.1, -.38], [1.1, -.38], [-1.1, .38], [1.1, .38]].map(([x, z]) => part(box(.1, .76, .1), C.timberDark, {at: [x, .38, z]}))];
  for (let k = 0; k < 5; k++) parts.push(part(lathe([[0, 0], [.05, 0], [.06, .14], [0, .14]], 8), C.brass, {at: [-1 + k * .5, .83, (k % 2 - .5) * .5]}));
  parts.push(part(new THREE.SphereGeometry(.22, 10, 8), [.55, .32, .16], {at: [0, .95, 0], scale: [1.4, .8, 1]}), part(cyl(.3, .3, .03, 12), C.paper, {at: [0, .845, 0]}));
  for (let k = 0; k < 4; k++) { const x = -.9 + k * .6; parts.push(part(box(.4, .45, .4), C.timberPale, {at: [x, .23, k % 2 ? .75 : -.75]})); parts.push(part(new THREE.SphereGeometry(.13, 10, 8), [.88, .84, .72], {at: [x, 1.25, k % 2 ? .75 : -.75], scale: [1, .95, 1.1]}), part(cyl(.12, .1, .45, 8), [.88, .84, .72], {at: [x, .9, k % 2 ? .75 : -.75]})); }
  return merge(parts);
}
function pudding() { return merge([part(lathe([[0, 0], [1.1, 0], [1.2, .3], [1.0, .9], [.5, 1.2], [0, 1.25]], 16), [.52, .3, .16], {jitter: .1}), part(new THREE.SphereGeometry(.7, 14, 6, 0, 6.283, 0, 1.0), [.95, .92, .82], {at: [0, .75, 0], scale: [1.5, .5, 1.5]}), part(new THREE.SphereGeometry(.12, 8, 6), [.85, .1, .12], {at: [0, 1.3, 0], glow: .1}), part(cyl(1.4, 1.4, .05, 16), C.brass, {at: [0, .02, 0]})]); }
function helmRack() { const parts = [...beam(2.4, .12, .1, C.timber, {at: [0, 1.5, 0]})]; for (let k = 0; k < 6; k++) parts.push(part(new THREE.SphereGeometry(.16, 10, 8, 0, 6.283, 0, 1.6), C.iron, {at: [-1 + k * .4, 1.45, -.12]}), part(box(.04, .12, .04), C.brass, {at: [-1 + k * .4, 1.5, -.29]})); return merge(parts); }

let kit = null;
/** The shared kit: geometry per prop type (built once, on first use). */
export function underwayKit() {
  if (kit) return kit;
  const {plinth, key} = keyAndPlinth();
  kit = {
    lantern: lantern(), cart: cart(), barrel: barrel(), crate: crate(), rubble: rubble(), mushroom: mushrooms(),
    'crystal-0': crystalCluster([.5, .85, 1], 3), 'crystal-1': crystalCluster([.75, .55, 1], 5), 'crystal-2': crystalCluster([.5, 1, .82], 9),
    timber: timberSet(), pitProp: pitProp(), ladder: ladder(), rails: rails(), urn: pot(), chestBase: chestBase(), chestLid: chestLid(), plinth, key, shrine: shrine(), hoard: hoardPile(),
    gate: gateMine(), exit: exitRing(), returnCircle: returnCircle(), vent: vent(), flame: flameColumn(), crackedRoof: crackedRoof(),
    rock0: fallenRock(1), rock1: fallenRock(4), sign: sign(), 'tale-mine-0': camp(), 'tale-mine-1': pickRack(),
    'pillar-crypt': pillar('crypt'), 'pillar-keep': pillar('keep'), torch: torch(), brazier: brazier(), sarcophagus: sarcophagus(), candles: candles(), bones: bones(), urnpile: urnPile(),
    roots: roots(), masonry: masonry(), 'banner-crypt': banner([.42, .16, .4]), 'banner-keep': banner([.2, .36, .62]), spikePlate: spikePlate(), spikes: spikes(), portcullis: portcullis(),
    'tale-crypt-0': tableFeast(), 'tale-crypt-1': candles(12), 'tale-keep-0': pudding(), 'tale-keep-1': helmRack(), crown: crown(),
  };
  return kit;
}
export const crystalType = hex => hex === 0xb48cff ? 'crystal-1' : hex === 0x7fffd0 ? 'crystal-2' : 'crystal-0';

/** The prop material: albedo per vertex, the shell's baked light per instance (aPropLight), and self-glow per vertex. */
const propUniforms = {uUwTime: {value: 0}};
export function propMaterial() {
  const m = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .78, metalness: .05, envMapIntensity: .3});
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, propUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow; attribute vec3 aPropLight; varying float vGlow; varying vec3 vPropLight; varying vec3 vPropWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGlow = aGlow; vPropLight = aPropLight; vPropWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow; varying vec3 vPropLight; varying vec3 vPropWorld; uniform float uUwTime;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float pf = .85 + .1 * sin(uUwTime * 9.0 + vPropWorld.x * 3.0 + vPropWorld.z * 2.0) + .06 * sin(uUwTime * 15.0 + vPropWorld.y * 5.0);
        totalEmissiveRadiance += diffuseColor.rgb * vPropLight + diffuseColor.rgb * vGlow * mix(1.0, pf, step(.95, vGlow)) * 1.6;`);
  };
  m.customProgramCacheKey = () => 'uw-prop';
  return m;
}
export const propTime = t => { propUniforms.uUwTime.value = t; };
