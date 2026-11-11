// Procedural geometry for the rabble critters (client/critter-view.js): Kettlebelly, Bramblehog and Kegtoter.
//
// Each critter body is ONE rigid-skinned buffer (every vertex rides one bone at weight 1), so a whole critter is one lit
// draw plus a small glow. Geometry is built once and shared by every critter of that kind. Models face -Z; +X is the
// critter's right. Bone names never match the limb words in combat-view canonicalPart, so every body triangle is the
// single 'torso' part the authority expects; only the Kegtoter's keg (a separate mesh named KegHead) is the 'head'.
import * as THREE from 'three';

const TAU = Math.PI * 2;
export const M = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
const rnd = n => { let h = Math.imul(n | 0 ^ 0x9e3779b1, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

/** Tapered tube along a Catmull-Rom curve through pts. */
export function tube(pts, r0, r1 = r0, radial = 8, steps = 10) {
  const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), fr = curve.computeFrenetFrames(steps, false), P = [], I = [];
  for (let i = 0; i <= steps; i++) { const t = i / steps, c = curve.getPointAt(t), r = r0 + (r1 - r0) * t;
    for (let j = 0; j <= radial; j++) { const a = j / radial * TAU, n = fr.normals[i].clone().multiplyScalar(Math.cos(a)).add(fr.binormals[i].clone().multiplyScalar(Math.sin(a))); P.push(c.x + n.x * r, c.y + n.y * r, c.z + n.z * r); } }
  for (let i = 0; i < steps; i++) for (let j = 0; j < radial; j++) { const a = i * (radial + 1) + j, b = a + radial + 1; I.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals(); return g;
}
const lathe = (pts, segs = 24) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);

/**
 * Bake [geometry, matrix, colour (rgb array or fn(x,y,z) -> rgb), bone] parts into one non-indexed buffer.
 * With bones (a name -> index map) the buffer is rigid-skinned; without, it is plain.
 */
export function bake(parts, bones = null) {
  const P = [], N = [], C = [], SI = [], SW = [], m3 = new THREE.Matrix3(), v = new THREE.Vector3();
  for (const [geo, matrix, rgb, bone] of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo; if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position, n = g.attributes.normal; m3.getNormalMatrix(matrix);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix); P.push(v.x, v.y, v.z);
      const c = typeof rgb === 'function' ? rgb(v.x, v.y, v.z) : rgb; C.push(c[0], c[1], c[2]);
      v.fromBufferAttribute(n, i).applyMatrix3(m3).normalize(); N.push(v.x, v.y, v.z);
      if (bones) { SI.push(bones[bone] ?? 0, 0, 0, 0); SW.push(1, 0, 0, 0); }
    }
    if (g !== geo) g.dispose(); geo.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  if (bones) { g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4)); }
  g.computeBoundingSphere(); g.computeBoundingBox(); return g;
}
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const noisy = (c, amt = .08, f = 9) => (x, y, z) => shade(c, 1 + amt * (Math.sin(x * f * 1.3 + y * f * .7) * .6 + Math.sin(z * f * 1.7 - y * f * 1.1) * .4));

// ---- Kettlebelly: a runaway dwarven boiler on two piston legs, valve-wheel hands, a spout it vents through. ----
export const KETTLE = Object.freeze({
  bones: [['Root', null, [0, 0, 0]], ['Boiler', 'Root', [0, .34, 0]], ['Lid', 'Boiler', [0, .99, .2]], ['Needle', 'Boiler', [0, .79, -.41]],
    ['ValveL', 'Boiler', [-.43, .66, 0]], ['ValveR', 'Boiler', [.43, .66, 0]], ['PistonL', 'Root', [-.22, .38, 0]], ['PistonR', 'Root', [.22, .38, 0]], ['RodL', 'PistonL', [-.22, .2, 0]], ['RodR', 'PistonR', [.22, .2, 0]]],
  gauge: .35, spout: [0, .8, -.71], spoutDir: [0, .42, -.91], whistle: [.17, 1.04, .26], exhaust: [[-.15, .4, .42], [.15, .4, .42]], rim: .455, belly: .6,
});
const COPPER = [.82, .47, .27], BRASS = [.9, .72, .34], IRON = [.2, .2, .23], CHROME = [.78, .8, .84], WOOD = [.52, .32, .17], DIAL = [.95, .93, .86], RED = [.86, .16, .1];
export function kettleGeometry() {
  const B = Object.fromEntries(KETTLE.bones.map(([n], i) => [n, i])), parts = [], add = (g, m, c, b = 'Boiler') => parts.push([g, m, c, b]);
  const patina = (x, y, z) => { const k = 1 + .07 * Math.sin(x * 23 + y * 9) * Math.sin(z * 17 - y * 5), green = Math.max(0, .34 - y) * 1.6; return [COPPER[0] * k * (1 - green * .5), COPPER[1] * k * (1 + green * .15), COPPER[2] * k * (1 + green * .4)]; };
  add(lathe([[0, .28], [.22, .28], [.34, .33], [.42, .45], [.455, .6], [.44, .74], [.38, .86], [.28, .95], [.22, .985], [.2, .99]], 30), M(0, 0, 0), patina);
  for (const [r, y, t] of [[.455, .6, .024], [.39, .85, .02], [.355, .36, .02]]) add(new THREE.TorusGeometry(r, t, 6, 36), M(0, y, 0, Math.PI / 2), BRASS);
  for (const [r, y] of [[.462, .64], [.462, .56], [.395, .88]]) for (let i = 0; i < 18; i++) { const a = i / 18 * TAU + (y > .6 ? .17 : 0); if (Math.abs(Math.sin(a)) > .95 && Math.cos(a) < 0) continue; add(new THREE.SphereGeometry(.016, 6, 4), M(Math.cos(a) * r, y, Math.sin(a) * r), BRASS); }
  // firebox door low on the front: iron frame and grate bars (the glow plate behind them is a separate mesh)
  for (const [w, h, x, y] of [[.3, .03, 0, .565], [.3, .03, 0, .375], [.03, .2, -.135, .47], [.03, .2, .135, .47]]) add(new THREE.BoxGeometry(w, h, .035), M(x, y, -.43), IRON);
  for (const y of [.42, .47, .52]) add(new THREE.BoxGeometry(.24, .022, .03), M(0, y, -.445), IRON);
  add(new THREE.SphereGeometry(.022, 8, 6), M(.11, .47, -.465), BRASS);
  // pressure gauge on the chest, tilted up toward whoever it is chasing
  const G = new THREE.Matrix4().makeTranslation(0, .79, -.41).multiply(new THREE.Matrix4().makeRotationX(KETTLE.gauge)).multiply(new THREE.Matrix4().makeRotationY(Math.PI));
  const g = m => G.clone().multiply(m);
  add(new THREE.TorusGeometry(.078, .017, 6, 24), g(M(0, 0, .01)), BRASS);
  add(new THREE.CircleGeometry(.078, 24), g(M(0, 0, .012)), DIAL);
  add(new THREE.RingGeometry(.05, .07, 12, 1, -.25, 1.05), g(M(0, 0, .014)), RED); // the red zone, upper right
  add(new THREE.CylinderGeometry(.03, .03, .1, 10), g(M(0, 0, -.04, Math.PI / 2)), BRASS);
  add(new THREE.BoxGeometry(.012, .062, .006), g(M(0, .026, .019)), RED, 'Needle');
  add(new THREE.SphereGeometry(.012, 6, 4), g(M(0, 0, .02)), IRON, 'Needle');
  // the spout it vents through, the carry handle, a rear whistle and two exhaust stubs that chuff when it steps
  add(tube([[0, .6, -.4], [0, .65, -.53], [0, .74, -.64], [0, .8, -.7]], .08, .042, 10, 10), M(0, 0, 0), COPPER);
  add(new THREE.TorusGeometry(.044, .012, 6, 14), M(0, .8, -.7, -1.14), BRASS);
  add(tube([[-.3, .86, 0], [-.27, 1.08, 0], [0, 1.2, 0], [.27, 1.08, 0], [.3, .86, 0]], .02, .02, 6, 16), M(0, 0, 0), IRON);
  add(new THREE.CylinderGeometry(.034, .034, .2, 10), M(0, 1.2, 0, 0, 0, Math.PI / 2), noisy(WOOD, .1, 30));
  for (const s of [-1, 1]) add(new THREE.SphereGeometry(.03, 8, 6), M(s * .3, .86, 0), BRASS);
  add(new THREE.CylinderGeometry(.026, .03, .15, 10), M(.17, .96, .26), BRASS);
  add(new THREE.SphereGeometry(.038, 10, 8), M(.17, 1.04, .26, 0, 0, 0, 1, .7, 1), BRASS);
  for (const [x, y, z] of KETTLE.exhaust) add(tube([[x, y + .04, z - .08], [x, y, z]], .028, .024, 8, 2), M(0, 0, 0), IRON);
  // lid: a dome that rattles on a rear hinge
  add(new THREE.SphereGeometry(.21, 22, 6, 0, TAU, 0, Math.PI / 2), M(0, .985, 0, 0, 0, 0, 1, .42, 1), COPPER, 'Lid');
  add(new THREE.TorusGeometry(.207, .013, 6, 28), M(0, .99, 0, Math.PI / 2), BRASS, 'Lid');
  add(new THREE.CylinderGeometry(.012, .016, .05, 8), M(0, 1.09, 0), IRON, 'Lid');
  add(new THREE.SphereGeometry(.036, 10, 8), M(0, 1.125, 0), noisy(WOOD, .1, 40), 'Lid');
  add(new THREE.BoxGeometry(.06, .025, .03), M(0, .995, .205), IRON, 'Lid');
  // valve-wheel hands on bent pipe arms
  for (const [s, b] of [[-1, 'ValveL'], [1, 'ValveR']]) {
    add(new THREE.SphereGeometry(.05, 10, 8), M(s * .43, .66, 0), BRASS, b);
    add(tube([[s * .43, .66, 0], [s * .52, .62, -.01], [s * .56, .52, -.04], [s * .565, .45, -.06]], .032, .028, 8, 10), M(0, 0, 0), IRON, b);
    const W = M(s * .57, .41, -.06, 0, Math.PI / 2, 0);
    add(new THREE.TorusGeometry(.06, .013, 6, 20), W, RED, b);
    for (const a of [0, Math.PI / 2]) add(new THREE.BoxGeometry(.11, .012, .012), W.clone().multiply(M(0, 0, 0, 0, 0, a)), RED, b);
    add(new THREE.CylinderGeometry(.02, .02, .03, 8), W.clone().multiply(M(0, 0, 0, Math.PI / 2)), BRASS, b);
  }
  // piston legs: iron sleeve on the hip, a chrome rod that telescopes, a hobnailed boot with a brass toecap
  for (const [s, p, r] of [[-1, 'PistonL', 'RodL'], [1, 'PistonR', 'RodR']]) {
    const x = s * .22;
    add(new THREE.CylinderGeometry(.075, .068, .27, 12), M(x, .32, 0), IRON, p);
    add(new THREE.TorusGeometry(.072, .014, 6, 16), M(x, .19, 0, Math.PI / 2), BRASS, p);
    add(new THREE.TorusGeometry(.078, .012, 6, 16), M(x, .41, 0, Math.PI / 2), BRASS, p);
    add(new THREE.CylinderGeometry(.04, .04, .18, 10), M(x, .14, 0), CHROME, r);
    add(new THREE.BoxGeometry(.15, .07, .22), M(x, .035, -.03), IRON, r);
    add(new THREE.SphereGeometry(.075, 12, 8, 0, TAU, 0, Math.PI / 2), M(x, .035, -.13, 0, 0, 0, 1, .7, .7), BRASS, r);
  }
  return bake(parts, B);
}
/** The firebox glow behind the grate (Boiler-bone local). */
export function kettleGlow() {
  const g = bake([[new THREE.PlaneGeometry(.25, .16), M(0, .47 - .34, -.426, 0, Math.PI, 0), [1.6, .62, .2]]]);
  return g;
}

// ---- Bramblehog: a thorny hedge-boar with a wild rose growing out of its back. ----
export const BRAMBLE = Object.freeze({
  bones: [['Root', null, [0, 0, 0]], ['Hedge', 'Root', [0, .44, 0]], ['Snout', 'Hedge', [0, .46, -.3]], ['TrotA', 'Root', [-.19, .27, -.2]], ['TrotB', 'Root', [.19, .27, -.2]],
    ['TrotC', 'Root', [-.19, .27, .22]], ['TrotD', 'Root', [.19, .27, .22]], ['Twirl', 'Hedge', [0, .5, .44]]],
  body: [.4, .34, .46], ball: .44,
});
export function brambleGeometry() {
  const B = Object.fromEntries(BRAMBLE.bones.map(([n], i) => [n, i])), parts = [], add = (g, m, c, b = 'Hedge') => parts.push([g, m, c, b]);
  const [ax, ay, az] = BRAMBLE.body, cy = .44, FUR = [.34, .24, .16], BELLY = [.4, .29, .2];
  add(new THREE.SphereGeometry(1, 28, 18), M(0, cy, 0, 0, 0, 0, ax, ay, az), (x, y, z) => { const under = Math.max(0, (cy - y) / ay - .2); return shade(under > .45 ? BELLY : FUR, 1 + .12 * Math.sin(x * 40 + z * 31) * Math.sin(y * 37)); });
  // thorns: Fibonacci-spread over the back and flanks, clear of the face and the belly
  const up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), n = new THREE.Vector3(), N = 130;
  for (let i = 0; i < N; i++) {
    const yy = 1 - (i + .5) / N * 2 * .98, rr = Math.sqrt(1 - yy * yy), a = i * 2.39996;
    const ux = Math.cos(a) * rr, uz = Math.sin(a) * rr;
    if (yy < -.9 || (uz < -.84 && Math.abs(ux) < .34 && yy < .34 && yy > -.4)) continue;
    const px = ux * ax, py = cy + yy * ay, pz = uz * az; n.set(ux / ax, yy / ay, uz / az).normalize();
    n.z += .35; n.y += .15; n.normalize(); // thorns sweep back like a hedgehog's
    const len = (yy < -.3 ? .09 : .13) + rnd(i) * .1, base = rnd(i + 99) < .3 ? [.32, .42, .16] : rnd(i + 7) < .5 ? [.36, .26, .13] : [.5, .38, .2];
    q.setFromUnitVectors(up, n);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(px + n.x * len * .42, py + n.y * len * .42, pz + n.z * len * .42), q, new THREE.Vector3(1, 1, 1));
    add(new THREE.ConeGeometry(.026 + rnd(i + 3) * .012, len, 5), m, (x, y, z) => { const t = (x - px) * n.x + (y - py) * n.y + (z - pz) * n.z; return t > len * .6 ? [.86, .8, .6] : base; });
  }
  for (let i = 0; i < 12; i++) { const a = rnd(i + 300) * TAU, yy = .2 + rnd(i + 400) * .7, rr = Math.sqrt(1 - yy * yy), ux = Math.cos(a) * rr, uz = Math.sin(a) * rr; if (uz < -.5) continue;
    add(new THREE.SphereGeometry(.06, 8, 4), M(ux * ax * 1.04, cy + yy * ay * 1.04, uz * az * 1.04, rnd(i) * 3, a, rnd(i + 1) * 2, 1, .25, .55), rnd(i + 5) < .5 ? [.36, .6, .22] : [.48, .7, .28]); }
  // the wild rose on its back
  const R = [.06, cy + ay * .97, .1];
  for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; add(new THREE.SphereGeometry(.045, 10, 6), M(R[0] + Math.cos(a) * .04, R[1] + .015, R[2] + Math.sin(a) * .04, 0, -a, .35, 1, .3, .7), [.98, .55, .66]); }
  add(new THREE.SphereGeometry(.022, 8, 6), M(R[0], R[1] + .035, R[2]), [1, .85, .25]);
  for (const s of [-1, 1]) add(new THREE.SphereGeometry(.05, 8, 4), M(R[0] + s * .07, R[1] - .005, R[2] + .04, 0, s * .7, 0, 1, .2, .5), [.3, .55, .2]);
  // snout, tusks, beady eyes and leafy ears (Snout bone)
  const S = 'Snout';
  add(new THREE.CylinderGeometry(.075, .13, .2, 12), M(0, .41, -.47, -Math.PI / 2 + .12), FUR, S);
  add(new THREE.CylinderGeometry(.08, .08, .03, 14), M(0, .4, -.575, -Math.PI / 2 + .12), [.3, .17, .15], S);
  for (const s of [-1, 1]) {
    add(new THREE.SphereGeometry(.018, 6, 4), M(s * .03, .4, -.592), [.08, .04, .04], S);
    add(new THREE.ConeGeometry(.016, .07, 6), M(s * .075, .38, -.53, -.5, 0, s * -.35), [.96, .92, .8], S);
    add(new THREE.SphereGeometry(.028, 8, 6), M(s * .12, .51, -.4), [.04, .03, .03], S);
    add(new THREE.SphereGeometry(.009, 4, 3), M(s * .114, .522, -.425), [2, 2, 2], S);
    add(new THREE.SphereGeometry(.07, 10, 6), M(s * .18, .62, -.3, -.3, 0, s * -.6, .55, .25, 1), [.48, .34, .22], S);
  }
  // four stubby legs with hooves, a curly bramble tail
  for (const b of ['TrotA', 'TrotB', 'TrotC', 'TrotD']) { const [x, , z] = BRAMBLE.bones[B[b]][2];
    add(new THREE.CylinderGeometry(.08, .068, .22, 10), M(x, .17, z), FUR, b);
    add(new THREE.CylinderGeometry(.07, .075, .06, 10), M(x, .03, z), [.16, .11, .09], b); }
  add(tube([[0, .5, .44], [0, .56, .55], [.06, .62, .52], [.04, .58, .47], [0, .6, .5]], .025, .01, 6, 14), M(0, 0, 0), [.36, .26, .13], 'Twirl');
  add(new THREE.SphereGeometry(.04, 8, 4), M(.0, .62, .5, .3, 0, .4, 1, .25, .6), [.4, .65, .24], 'Twirl');
  return bake(parts, B);
}
/** Three little leaves that circle a dizzy hog's head (one plain mesh, spun by the view). */
export function dizzyLeaves() {
  const parts = []; for (let i = 0; i < 3; i++) { const a = i / 3 * TAU; parts.push([new THREE.SphereGeometry(.06, 8, 4), M(Math.cos(a) * .2, Math.sin(a * 2) * .03, Math.sin(a) * .2, .2, -a, .5, 1, .22, .6), i === 1 ? [.98, .55, .66] : [.45, .72, .28]]); }
  return bake(parts);
}

// ---- Kegtoter: a star-nosed mole sapper in a miner's helmet, tottering under a powder keg. ----
export const KEG = Object.freeze({
  bones: [['Root', null, [0, 0, 0]], ['Mole', 'Root', [0, .06, 0]], ['Helmet', 'Mole', [0, .56, 0]], ['PawL', 'Mole', [-.2, .42, -.03]], ['PawR', 'Mole', [.2, .42, -.03]], ['ToeL', 'Root', [-.1, .08, -.02]], ['ToeR', 'Root', [.1, .08, -.02]]],
  carry: [0, .9, -.02], radius: .17, length: .36, rest: .17, fuse: .14,
});
export function moleGeometry() {
  const B = Object.fromEntries(KEG.bones.map(([n], i) => [n, i])), parts = [], add = (g, m, c, b = 'Mole') => parts.push([g, m, c, b]);
  const FUR = [.4, .32, .3], PINK = [.96, .62, .64], CLAW = [.95, .9, .82], HAT = [.97, .76, .2];
  add(lathe([[0, .04], [.17, .05], [.25, .14], [.28, .28], [.265, .42], [.215, .53], [.15, .6], [0, .63]], 26), M(0, 0, 0),
    (x, y, z) => { const belly = z < -.12 && y > .14 && y < .46 && Math.abs(x) < .17; return shade(belly ? [.56, .47, .44] : FUR, 1 + .1 * Math.sin(x * 50 + y * 33) * Math.sin(z * 41)); });
  // star nose: a pink muzzle ringed with eleven little tentacles
  add(new THREE.CylinderGeometry(.04, .075, .12, 12), M(0, .42, -.27, -Math.PI / 2 + .2), FUR);
  for (let i = 0; i < 11; i++) { const a = i / 11 * TAU; add(new THREE.CapsuleGeometry(.017, .06, 2, 6), new THREE.Matrix4().makeTranslation(Math.cos(a) * .065, .41 + Math.sin(a) * .065, -.34).multiply(new THREE.Matrix4().makeRotationZ(a - Math.PI / 2)).multiply(new THREE.Matrix4().makeRotationX(-.5)), PINK); } // a star of pink feelers facing forward
  add(new THREE.SphereGeometry(.04, 10, 8), M(0, .41, -.34), [.9, .45, .5]);
  for (const s of [-1, 1]) add(new THREE.SphereGeometry(.045, 8, 6), M(s * .14, .43, -.21, 0, 0, 0, 1, .6, .4), [.85, .55, .55]); // rosy cheeks
  for (const s of [-1, 1]) add(new THREE.SphereGeometry(.014, 6, 4), M(s * .075, .5, -.225), [.03, .02, .02]);
  // miner's helmet with its lamp (the lens glow is a separate mesh)
  const H = 'Helmet';
  add(new THREE.SphereGeometry(.185, 20, 8, 0, TAU, 0, Math.PI / 2), M(0, .555, 0, 0, 0, 0, 1, .82, 1), HAT, H);
  add(new THREE.CylinderGeometry(.235, .235, .022, 24), M(0, .56, 0), shade(HAT, .82), H);
  add(new THREE.TorusGeometry(.17, .012, 6, 24), M(0, .6, 0, Math.PI / 2), shade(HAT, .7), H);
  add(new THREE.CylinderGeometry(.052, .046, .06, 12), M(0, .65, -.17, Math.PI / 2 - .2), [.75, .62, .35], H);
  // digging paws held up for the keg; small pink feet
  for (const [s, b] of [[-1, 'PawL'], [1, 'PawR']]) {
    add(tube([[s * .2, .42, -.03], [s * .24, .56, -.03], [s * .21, .72, -.03]], .055, .045, 8, 8), M(0, 0, 0), FUR, b);
    add(new THREE.SphereGeometry(1, 12, 8), M(s * .2, .755, -.03, 0, 0, s * -.15, .085, .035, .09), PINK, b);
    for (let i = 0; i < 4; i++) add(new THREE.ConeGeometry(.013, .06, 5), M(s * .2 + (i - 1.5) * .03, .79, -.1, -1.2, 0, 0), CLAW, b);
  }
  for (const [s, b] of [[-1, 'ToeL'], [1, 'ToeR']]) add(new THREE.SphereGeometry(1, 10, 6), M(s * .1, .04, -.07, 0, 0, 0, .06, .035, .1), PINK, b);
  return bake(parts, B);
}
/** The powder keg (lying on its side along X, centred on its middle): staves, hoops, a red band and a bung. */
export function kegGeometry() {
  const parts = [], WOOD = [.62, .4, .22], L = KEG.length / 2, r = KEG.radius;
  const staves = (x, y, z) => { const a = Math.atan2(z, y), k = .82 + .18 * Math.abs(Math.sin(a * 7)); return Math.abs(x) < .035 ? [.8, .16, .1] : shade(WOOD, k * (1 + .06 * Math.sin(x * 60))); };
  parts.push([lathe([[r * .8, -L], [r * .94, -L * .55], [r, 0], [r * .94, L * .55], [r * .8, L]], 22), M(0, 0, 0, 0, 0, -Math.PI / 2), staves]);
  for (const s of [-1, 1]) {
    parts.push([new THREE.CircleGeometry(r * .8, 20), M(s * L, 0, 0, 0, s * Math.PI / 2, 0), [.5, .32, .17]]);
    for (const x of [.62, .9]) parts.push([new THREE.TorusGeometry(r * (x > .8 ? .86 : .97), .011, 5, 26), M(s * L * x, 0, 0, 0, Math.PI / 2, 0), [.22, .21, .22]]);
  }
  parts.push([new THREE.CylinderGeometry(.022, .026, .03, 10), M(0, r + .005, 0), [.3, .2, .12]]);
  return bake(parts);
}
/** The fuse: a short twisted cord rising from the bung (y=0 at the bung, scaled down as it burns). */
export function fuseGeometry() { return bake([[tube([[0, 0, 0], [.01, .05, 0], [.035, .1, .01], [.03, .14, .02]], .009, .007, 5, 8), M(0, 0, 0), [.18, .14, .1]]]); }
