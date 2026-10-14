// Ent face (client only): a grumpy old tree with a carved, living face, built from the tree's own bark.
// Bushy bark brows, deep sockets with glowing resonance eyes that look about and blink under bark lids, a big knotted
// nose, a hinged mouth with crooked wooden teeth, and a beard of hanging moss and root strands that swings with the
// body. Shelf fungus and moss cushions sit on the trunk. Grumpy and charming rather than spooky.
//
// The face rides the Spine bone (it sits on the upper trunk). Every piece is ignoreContact: the bark trunk underneath
// stays the hit surface, so combat parts, arrows and dismemberment are unchanged. Geometry is shared per size class;
// per ent only the small pivots and the glow material (cloned already by ent-view) are new. Draw calls: bark pieces
// share the bark material and are merged into one mesh per pivot group; ~9 small draws per ent.
import * as THREE from 'three';

const TAU = Math.PI * 2, clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v), smooth = t => { t = clamp(t); return t * t * (3 - 2 * t); };
const rnd = (seed, n) => { let h = Math.imul(seed ^ Math.imul(n | 0, 0x9e3779b1), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

// Lumpy, organic deform of any geometry: radial noise along its normals.
function lumpy(g, amount, seed, freq = 3) {
 const p = g.attributes.position, n = g.attributes.normal;
 for (let i = 0; i < p.count; i++) {
  const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
  const k = amount * (Math.sin(x * freq * 7.1 + seed) * Math.sin(y * freq * 6.3 + seed * 1.7) * Math.sin(z * freq * 5.9 + seed * 2.3) + .5 * Math.sin((x + y + z) * freq * 13 + seed));
  p.setXYZ(i, x + n.getX(i) * k, y + n.getY(i) * k, z + n.getZ(i) * k);
 }
 g.computeVertexNormals(); return g;
}
const tinted = (g, rgb) => { const c = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < c.length; i += 3) { c[i] = rgb[0]; c[i + 1] = rgb[1]; c[i + 2] = rgb[2]; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; };
function merge(list) { // [{geometry, matrix}] -> one indexed geometry (position, normal, uv)
 let vCount = 0, iCount = 0; for (const {geometry: g} of list) { vCount += g.attributes.position.count; iCount += g.index ? g.index.count : g.attributes.position.count; }
 const P = new Float32Array(vCount * 3), N = new Float32Array(vCount * 3), UV = new Float32Array(vCount * 2), I = new Uint32Array(iCount), nm = new THREE.Matrix3(), v = new THREE.Vector3();
 let vo = 0, io = 0;
 for (const {geometry: g, matrix} of list) {
  nm.getNormalMatrix(matrix); const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
   v.fromBufferAttribute(p, i).applyMatrix4(matrix); P.set([v.x, v.y, v.z], (vo + i) * 3);
   v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); N.set([v.x, v.y, v.z], (vo + i) * 3);
   UV.set(uv ? [uv.getX(i), uv.getY(i)] : [0, 0], (vo + i) * 2);
  }
  if (g.index) for (let i = 0; i < g.index.count; i++) I[io++] = g.index.getX(i) + vo; else for (let i = 0; i < p.count; i++) I[io++] = i + vo;
  vo += p.count; g.dispose();
 }
 const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3)); out.setAttribute('uv', new THREE.BufferAttribute(UV, 2)); out.setIndex(new THREE.BufferAttribute(I, 1));
 out.computeBoundingSphere(); return out;
}
const M = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));

const kits = new Map();
// layout: {H, eyeY, spineY, r(y)} in metres; geometry in Spine space (origin at the spine joint, -Z is the face).
function kit(size, L) {
 if (kits.has(size)) return kits.get(size);
 const {H} = L, eyeY = L.eyeY - L.spineY, R = L.r(L.eyeY), u = H / 3.4 * 2.1; // u: feature unit (sizes keep proportions; a big, readable face)
 const front = (y, side = 0, out = 0) => { const r = L.r(y + L.spineY) + out, a = side; return [Math.sin(a) * r, y, -Math.cos(a) * r]; };
 const k = {eyeY, R, u};
 // Brows: heavy, shaggy bark ridges (one per side, pivoted at the inner end so they can furrow and lift).
 k.brow = s => { const parts = [];
  for (let i = 0; i < 3; i++) { const t = i / 2, g = lumpy(new THREE.SphereGeometry(.075 * u * (1 - t * .25), 10, 7), .012 * u, 3 + i + (s > 0 ? 7 : 0), 2.5);
   parts.push({geometry: g, matrix: M(s * (.02 + t * .13) * u, (.012 + t * .03 - t * t * .01) * u, -.005 * u * t, 0, 0, s * .25, 1.35, .62, .85)}); }
  for (let i = 0; i < 4; i++) { const g = new THREE.ConeGeometry(.018 * u, .09 * u, 5); g.translate(0, -.045 * u, 0); // shaggy splinters curling off the outer brow
   parts.push({geometry: g, matrix: M(s * (.1 + i * .035) * u, .04 * u, -.02 * u, .3 - i * .1, 0, s * (2 + i * .18))}); }
  return merge(parts); };
 k.browAt = s => front(eyeY + .075 * u, s * .42, .03 * u);
 // Sockets: dark hollows the eyes sit back in.
 k.socket = tinted(lumpy(new THREE.SphereGeometry(.07 * u, 12, 9), .006 * u, 5), [.12, .08, .05]);
 k.socketAt = s => front(eyeY + .015 * u, s * .44, .004 * u);
 // Eyes: glowing irises (vertex colour drives the shared additive glow material) with a bright core.
 k.eye = (() => { const g = new THREE.SphereGeometry(.036 * u, 12, 9); const c = []; const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const f = clamp((-p.getZ(i) / (.036 * u) - .55) / .45), w = 1.1 + f * 1.4; c.push(.5 * w, .85 * w, 1 * w); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); return g; })();
 // Lids: bark half-shells that roll down over the eye to blink, squint and glare.
 k.lid = (() => { const g = new THREE.SphereGeometry(.046 * u, 12, 6, 0, TAU, 0, Math.PI / 2); g.scale(1.05, 1, .8); return lumpy(g, .003 * u, 9); })(); // cap up = open; rolls toward -Z to shut
 // Nose: a big knotted burl, slightly crooked.
 k.nose = merge([
  {geometry: lumpy(new THREE.SphereGeometry(.06 * u, 12, 9), .014 * u, 2, 2.2), matrix: M(0, 0, 0, 0, 0, 0, 1, 1.25, 1.1)},
  {geometry: lumpy(new THREE.SphereGeometry(.045 * u, 10, 8), .012 * u, 4, 2.4), matrix: M(.01 * u, -.06 * u, -.035 * u, 0, 0, .2, 1.15, .9, 1)},
  {geometry: lumpy(new THREE.SphereGeometry(.022 * u, 8, 6), .004 * u, 6), matrix: M(-.05 * u, -.02 * u, -.01 * u)}, // a wart
 ]);
 k.noseAt = front(eyeY - .07 * u, .03, .04 * u);
 // Mouth: a dark hollow, upper lip with crooked wooden teeth, and a heavy lower jaw on a hinge.
 k.mouth = tinted(new THREE.SphereGeometry(.1 * u, 14, 8), [.09, .05, .03]);
 k.mouthAt = front(eyeY - .16 * u, 0, -.012 * u);
 k.upperLip = merge([0, 1, 2, 3, 4].map(i => { const t = i / 4 - .5; return {geometry: lumpy(new THREE.SphereGeometry(.045 * u, 9, 6), .008 * u, 11 + i), matrix: M(t * .2 * u, -t * t * .05 * u, -Math.cos(t * 1.6) * .015 * u, 0, 0, 0, 1.5, .65, .8)}; }));
 k.teeth = (() => { const parts = [], spots = [-.075, -.03, .02, .065];
  spots.forEach((x, i) => { const g = new THREE.ConeGeometry(.016 * u * (i === 1 ? 1.3 : 1), .05 * u * (i === 2 ? .7 : 1), 5); g.rotateX(Math.PI); g.translate(0, -.025 * u, 0);
   parts.push({geometry: g, matrix: M(x * u, -.012 * u, -.01 * u, .15, 0, (rnd(5, i) - .5) * .5)}); });
  return tinted(merge(parts), [.86, .78, .6]); })();
 k.jawPivot = front(eyeY - .14 * u, 0, -.03 * u);
 k.jaw = merge([0, 1, 2, 3, 4, 5].map(i => { const t = i / 5 - .5; return {geometry: lumpy(new THREE.SphereGeometry(.055 * u, 9, 7), .012 * u, 21 + i), matrix: M(t * .24 * u, (-.07 - (1 - t * t * 4) * .02) * u, (-.03 - Math.cos(t * 1.5) * .045) * u, 0, 0, 0, 1.55, .85, 1)}; })
  .concat([{geometry: (() => { const g = new THREE.ConeGeometry(.02 * u, .065 * u, 5); g.translate(0, .03 * u, 0); return g; })(), matrix: M(-.07 * u, -.04 * u, -.06 * u, 0, 0, -.15)},
   {geometry: (() => { const g = new THREE.ConeGeometry(.018 * u, .055 * u, 5); g.translate(0, .028 * u, 0); return g; })(), matrix: M(.08 * u, -.045 * u, -.058 * u, 0, 0, .2)}])); // two snaggle tusks
 // Beard: strands of moss and fine root hanging from the jaw; each swings on its own spring.
 k.strand = (len, w) => { const g = new THREE.CylinderGeometry(w * .2, w, len, 6, 5, false); g.translate(0, -len / 2, 0);
  const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = -p.getY(i) / len; p.setX(i, p.getX(i) + Math.sin(y * 5) * w * .6); } g.computeVertexNormals(); return g; };
 k.strands = Array.from({length: 9}, (_, i) => { const t = i / 8 - .5, len = (.16 + .12 * (1 - Math.abs(t) * 2) + rnd(31, i) * .05) * u; return {x: t * .24 * u, len, geometry: k.strand(len, (.014 + rnd(32, i) * .008) * u), moss: i % 3 !== 1}; });
 // Shelf fungus and moss cushions on the trunk (static, on the Spine).
 k.fungus = merge([[.95, -.06, 1], [1.1, -.14, .8], [-2.3, .14, .9]].map(([a, dy, s], i) => { const g = new THREE.CylinderGeometry(.075 * u * s, .06 * u * s, .022 * u, 12, 1, false, 0, Math.PI); g.rotateY(Math.PI / 2);
  const p = front(eyeY + dy * u, a, -.005 * u); return {geometry: lumpy(g, .004 * u, 40 + i), matrix: M(p[0], p[1], p[2], 0, -a, 0)}; }));
 k.moss = merge([[.7, .26, 1.2], [-.6, .3, .9], [2.6, .05, 1.1], [-2.9, -.2, 1]].map(([a, dy, s], i) => { const p = front(eyeY + dy * u, a, .005 * u);
  return {geometry: lumpy(new THREE.SphereGeometry(.07 * u * s, 10, 6, 0, TAU, 0, Math.PI * .5), .015 * u, 50 + i, 4), matrix: M(p[0], p[1], p[2], -Math.PI / 2 + .4, -a, 0, 1, 1, .45)}; }));
 kits.set(size, k); return k;
}

// Carved features read a shade lighter than the trunk (worn, sun-bleached bark), so the face carries from a distance.
const lighter = new WeakMap();
function featureBark(bark) { let m = lighter.get(bark); if (!m) { m = bark.clone(); m.name = 'EntFeatureBark'; m.vertexColors = false; m.color = new THREE.Color(.95, .88, .8); lighter.set(bark, m); } return m; }
const mossMat = new THREE.MeshStandardMaterial({name: 'EntMoss', color: 0x6c8a3c, roughness: 1});
const fungusMat = new THREE.MeshStandardMaterial({name: 'EntFungus', color: 0xd9a35a, roughness: .85});
const darkMat = new THREE.MeshStandardMaterial({name: 'EntHollow', vertexColors: true, roughness: 1, color: 0xffffff, emissive: 0x061418});
const toothMat = new THREE.MeshStandardMaterial({name: 'EntTeeth', vertexColors: true, roughness: .7});
const rootMat = new THREE.MeshStandardMaterial({name: 'EntRootStrand', color: 0x5a4430, roughness: .95});

/** Build the face on the Spine bone. Returns a face record for poseEntFace. */
export function buildEntFace({size, layout, spine, bark, glowMat, seed}) {
 const k = kit(size, layout), face = new THREE.Group(); bark = featureBark(bark); face.name = 'EntFace'; face.userData.ignoreContact = true;
 const mesh = (g, m, name, at, parent = face) => { const o = new THREE.Mesh(g, m); o.name = name; if (at) o.position.set(at[0], at[1], at[2]); o.castShadow = m !== glowMat; parent.add(o); return o; };
 const eyes = [], lids = [], brows = [];
 for (const s of [-1, 1]) {
  const sock = mesh(k.socket, darkMat, 'EntSocket', k.socketAt(s)); sock.scale.set(1.1, .85, .55);
  const eye = mesh(k.eye, glowMat, 'EntEye', [k.socketAt(s)[0], k.socketAt(s)[1], k.socketAt(s)[2] - .028 * k.u]); eye.castShadow = false; eye.renderOrder = 2;
  const lid = mesh(k.lid, bark, 'EntLid', [eye.position.x, eye.position.y, eye.position.z + .004 * k.u]);
  const brow = new THREE.Group(); brow.position.fromArray(k.browAt(s)); brow.rotation.y = s * -.2; face.add(brow); mesh(k.brow(s), bark, 'EntBrow', null, brow);
  eyes.push({mesh: eye, base: eye.position.clone(), s}); lids.push({mesh: lid, s}); brows.push({g: brow, s});
 }
 mesh(k.nose, bark, 'EntNose', k.noseAt);
 const mouth = mesh(k.mouth, darkMat, 'EntMouth', k.mouthAt); mouth.scale.set(1.25, .55, .5);
 mesh(k.upperLip, bark, 'EntLip', [k.mouthAt[0], k.mouthAt[1] + .045 * k.u, k.mouthAt[2] - .03 * k.u]);
 mesh(k.teeth, toothMat, 'EntTeeth', [k.mouthAt[0], k.mouthAt[1] + .035 * k.u, k.mouthAt[2] - .045 * k.u]);
 const jaw = new THREE.Group(); jaw.name = 'EntJaw'; jaw.position.fromArray(k.jawPivot); face.add(jaw); mesh(k.jaw, bark, 'EntJawBark', null, jaw);
 const strands = k.strands.map((d, i) => { const p = new THREE.Group(); p.position.set(d.x, -.075 * k.u, -.065 * k.u - Math.cos((d.x / k.u) * 6) * .02 * k.u); jaw.add(p); mesh(d.geometry, d.moss ? mossMat : rootMat, 'EntBeard', null, p);
  return {g: p, a: 0, av: 0, b: 0, bv: 0, k: 26 + rnd(seed, 60 + i) * 14, phase: rnd(seed, 70 + i) * TAU}; });
 mesh(k.fungus, fungusMat, 'EntFungus'); mesh(k.moss, mossMat, 'EntMossPatch');
 spine.add(face);
 face.traverse(o => { o.userData.ignoreContact = true; });
 return {group: face, eyes, lids, brows, jaw, strands, u: k.u, seed, blinkAt: 1.5 + rnd(seed, 1) * 3, blink: -1, look: new THREE.Vector2(), lookV: new THREE.Vector2(), prev: null, vel: new THREE.Vector3(), mood: 0};
}

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _inv = new THREE.Matrix4();
/**
 * Per frame. env: {clock, dt, awake 0..1, attack {up, down} 0..1, recoil 0..1, walk 0..1, step (footfall pulse 0..1), target Vector3|null (world)}
 * Returns nothing; poses lids, eyes, brows, jaw and beard springs.
 */
export function poseEntFace(f, env) {
 const {clock: t, dt} = env, u = f.u, awake = env.awake ?? 1, up = env.attack?.up || 0, down = env.attack?.down || 0, recoil = env.recoil || 0;
 // Look: eyes follow a nearby Hero (or wander), springy, clamped inside the sockets.
 let lx = Math.sin(t * .37 + f.seed) * .5 + Math.sin(t * 1.3 + f.seed * 2) * .2, ly = Math.sin(t * .29 + f.seed * 3) * .3;
 if (env.target) { f.group.updateWorldMatrix(true, false); _p.copy(env.target).applyMatrix4(_inv.copy(f.group.matrixWorld).invert()); const d = Math.hypot(_p.x, _p.z) || 1; lx = clamp(_p.x / d * 2.2, -1, 1); ly = clamp((_p.y + .6) / d * 1.5, -1, 1); }
 f.lookV.x += ((lx - f.look.x) * 90 - f.lookV.x * 14) * dt; f.lookV.y += ((ly - f.look.y) * 90 - f.lookV.y * 14) * dt;
 f.look.x += f.lookV.x * dt; f.look.y += f.lookV.y * dt;
 for (const e of f.eyes) e.mesh.position.set(e.base.x + clamp(f.look.x, -1, 1) * .016 * u, e.base.y + clamp(f.look.y, -1, 1) * .011 * u, e.base.z);
 // Mood: scowl when winding up or struck, wide-eyed surprise while waking.
 const anger = Math.max(up, recoil * .8, env.angry || 0), surprise = (1 - awake) * smooth(awake * 3);
 // Blink: every few seconds, sometimes a slow grumpy double-blink; asleep the lids are shut.
 if (f.blink < 0 && t >= f.blinkAt) { f.blink = t; f.double = rnd(f.seed, Math.floor(t)) < .25; }
 let close = 0;
 if (f.blink >= 0) { const b = (t - f.blink) / (f.double ? .55 : .2); close = f.double ? Math.max(Math.sin(clamp(b * 2) * Math.PI), Math.sin(clamp(b * 2 - 1) * Math.PI)) : Math.sin(clamp(b) * Math.PI); if (b >= 1) { f.blink = -1; f.blinkAt = t + 2.5 + rnd(f.seed, Math.floor(t * 7)) * 4; } }
 const shut = Math.max(close, 1 - smooth(awake * 1.6)), squint = anger * .45 + recoil * .5;
 for (const l of f.lids) { const lidOpen = 1 - Math.max(shut, squint); l.mesh.rotation.set(-.2 - (1 - lidOpen) * 1.35 + surprise * .4, l.s * .12 * anger, 0); }
 // Brows: furrow down and in when angry, lift on surprise and hurt, a grumpy asymmetric twitch at rest.
 for (const b of f.brows) {
  const twitch = Math.max(0, Math.sin(t * .8 + f.seed + b.s)) ** 8 * .25;
  b.g.rotation.set(0, b.s * -.2, b.s * (-.28 * anger + .22 * surprise + .1 * recoil + (b.s > 0 ? twitch : 0) - .05));
  b.g.userData.y0 ??= b.g.position.y;
  b.g.position.y = b.g.userData.y0 - .02 * u * anger + .025 * u * (surprise + recoil * .6 + twitch * .3);
 }
 // Jaw: a slow grumpy chew at rest, a creak with each footfall, a roar on the wind-up that snaps shut on the slam.
 const chew = Math.max(0, Math.sin(t * 1.7 + f.seed)) * .07 * (1 - anger) * awake, creak = (env.step || 0) * .12;
 f.jaw.rotation.x = clamp(chew + creak + up * .55 * (1 - down) + recoil * .45 + surprise * .5 + (env.talk || 0), 0, .7);
 // Beard: springs driven by the face's world acceleration (lurch, slam, recoil) plus a little breeze.
 f.group.updateWorldMatrix(true, false); _p.setFromMatrixPosition(f.group.matrixWorld);
 if (!f.prev || dt <= 0) { f.prev = _p.clone(); f.vel.set(0, 0, 0); }
 const vx = (_p.x - f.prev.x) / Math.max(dt, 1e-3), vz = (_p.z - f.prev.z) / Math.max(dt, 1e-3), vy = (_p.y - f.prev.y) / Math.max(dt, 1e-3);
 const ax = clamp((vx - f.vel.x) / Math.max(dt, 1e-3), -40, 40), az = clamp((vz - f.vel.z) / Math.max(dt, 1e-3), -40, 40), ay = clamp((vy - f.vel.y) / Math.max(dt, 1e-3), -40, 40);
 f.vel.set(vx, vy, vz); f.prev.copy(_p);
 f.group.getWorldQuaternion(_q).invert(); _p.set(ax, ay, az).applyQuaternion(_q); // acceleration in face space
 for (const s of f.strands) {
  const wind = Math.sin(t * 1.4 + s.phase) * .6;
  s.av += (-s.a * s.k - s.av * 3.2 + _p.z * .9 + wind) * dt; s.a = clamp(s.a + s.av * dt, -.9, .9);
  s.bv += (-s.b * s.k - s.bv * 3.2 - _p.x * .9 + wind * .5) * dt; s.b = clamp(s.b + s.bv * dt, -.7, .7);
  s.g.rotation.set(s.a - f.jaw.rotation.x * .6, 0, s.b);
 }
}
