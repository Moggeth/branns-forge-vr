// Stonewhisper pick refinement builder (2026-10-04). Deterministic: same input + textures → byte-identical GLB.
//
//   python paint_textures.py <texDir>
//   node build-pick.mjs <input pick.glb> <texDir> <output pick.glb>
//
// Keeps the shipped silhouette, materials (names/factors), every node name/order/transform, every socket and the
// exact bounds that prepareAsset normalises. Gems (ResonanceCrystal, Embellish_Crystal_Crown) keep their geometry;
// only the four crown side gems that floated ~2 cm off the arm cheeks are moved onto the cheeks.
// Rebuilt meshes are generated FROM THE SURFACE THEY SIT ON: every band, plate, strap, bezel and wire is an offset of
// the arm / socket / haft surface function, so nothing can clip through or float off what it decorates.
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import * as THREE from 'three'; // resolves to multiplayer/node_modules
const {Vector3} = THREE;
const [input, texDir, output] = process.argv.slice(2);
if (!input || !texDir || !output) throw new Error('usage: node build-pick.mjs <in.glb> <texDir> <out.glb>');

// ------------------------------------------------------------------ input
const src = readFileSync(input), jsonLength = src.readUInt32LE(12);
const J = JSON.parse(src.subarray(20, 20 + jsonLength).toString('utf8')), BIN = src.subarray(20 + jsonLength + 8);
function accessor(i) {
  const a = J.accessors[i], view = J.bufferViews[a.bufferView], n = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4}[a.type];
  const C = {5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array}[a.componentType];
  const offset = BIN.byteOffset + (view.byteOffset || 0) + (a.byteOffset || 0);
  return new C(BIN.buffer.slice(offset, offset + a.count * n * C.BYTES_PER_ELEMENT));
}
const nodeByName = name => J.nodes.find(n => n.name === name);
function inputMesh(name) {
  const p = J.meshes[nodeByName(name).mesh].primitives[0];
  return {position: accessor(p.attributes.POSITION), normal: accessor(p.attributes.NORMAL),
    uv: p.attributes.TEXCOORD_0 !== undefined ? accessor(p.attributes.TEXCOORD_0) : null,
    index: p.indices !== undefined ? accessor(p.indices) : null, material: p.material};
}
for (const n of J.nodes) if (n.mesh !== undefined && (n.translation || n.rotation || n.scale)) throw new Error(`mesh node ${n.name} is transformed`);
const BOUNDS = {min: [-.32, -.045, -.0428], max: [.32, .718, .0428]};

// ------------------------------------------------------------------ mesh builder
class Mesh {
  constructor() { this.p = []; this.n = []; this.uv = []; this.idx = []; }
  get count() { return this.p.length / 3; }
  vertex(p, uv = [0, 0]) { this.p.push(p.x, p.y, p.z); this.n.push(0, 0, 0); this.uv.push(uv[0], uv[1]); return this.count - 1; }
  tri(a, b, c) { this.idx.push(a, b, c); }
  // rows × cols grid of vertices (row-major) → quads. wrap: last column connects to first.
  grid(start, rows, cols, flip = false) {
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      const a = start + r * cols + c, b = a + 1, d = a + cols, e = d + 1;
      if (flip) { this.tri(a, b, d); this.tri(b, e, d); } else { this.tri(a, d, b); this.tri(b, d, e); }
    }
  }
  // Area-weighted smooth normals over the whole mesh; seams that duplicate a position are welded for shading.
  computeNormals() {
    const P = this.p, N = new Float64Array(P.length), key = new Map(), weld = new Int32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const k = `${Math.round(P[i * 3] * 2e5)},${Math.round(P[i * 3 + 1] * 2e5)},${Math.round(P[i * 3 + 2] * 2e5)}`;
      weld[i] = key.has(k) ? key.get(k) : (key.set(k, i), i);
    }
    const a = new Vector3(), b = new Vector3(), c = new Vector3();
    for (let t = 0; t < this.idx.length; t += 3) {
      const [i, j, k] = [this.idx[t], this.idx[t + 1], this.idx[t + 2]];
      a.fromArray(P, i * 3); b.fromArray(P, j * 3); c.fromArray(P, k * 3);
      const f = b.sub(a).cross(c.sub(a));
      for (const v of [i, j, k]) { const w = weld[v]; N[w * 3] += f.x; N[w * 3 + 1] += f.y; N[w * 3 + 2] += f.z; }
    }
    for (let i = 0; i < this.count; i++) {
      const w = weld[i]; a.set(N[w * 3], N[w * 3 + 1], N[w * 3 + 2]).normalize();
      this.n[i * 3] = a.x; this.n[i * 3 + 1] = a.y; this.n[i * 3 + 2] = a.z;
    }
    return this;
  }
  // Flip every triangle from `fromTri` on if, on balance, faces point against outward(vertexIndex).
  orient(outward, fromTri = 0) {
    const P = this.p, a = new Vector3(), b = new Vector3(), c = new Vector3(); let score = 0;
    for (let t = fromTri * 3; t < this.idx.length; t += 3) {
      const [i, j, k] = [this.idx[t], this.idx[t + 1], this.idx[t + 2]];
      a.fromArray(P, i * 3); b.fromArray(P, j * 3); c.fromArray(P, k * 3);
      const f = b.clone().sub(a).cross(c.clone().sub(a)); score += Math.sign(f.dot(outward(i)));
    }
    if (score < 0) for (let t = fromTri * 3; t < this.idx.length; t += 3) [this.idx[t + 1], this.idx[t + 2]] = [this.idx[t + 2], this.idx[t + 1]];
    return this;
  }
  append(other) {
    const base = this.count;
    this.p.push(...other.p); this.n.push(...other.n); this.uv.push(...other.uv); this.idx.push(...other.idx.map(i => i + base));
    return this;
  }
}
const mesh = () => new Mesh();
const lerp = (a, b, t) => a + (b - a) * t, clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = t => t * t * (3 - 2 * t);

// Closed centripetal Catmull-Rom through 2D points → n samples (smooth lozenge / rounded octagon outlines).
function closedSpline(points, n) {
  const out = [], m = points.length;
  for (let i = 0; i < n; i++) {
    const f = i / n * m, k = Math.floor(f), t = f - k;
    const [p0, p1, p2, p3] = [-1, 0, 1, 2].map(o => points[(k + o + m) % m]);
    const q = (a, b, c, d) => .5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
    out.push([q(p0[0], p1[0], p2[0], p3[0]), q(p0[1], p1[1], p2[1], p3[1])]);
  }
  return out;
}

// ------------------------------------------------------------------ surfaces
// Each surface S(a, s) → {p, n}: a is the "long" coordinate, s ∈ [0,1) goes around. Normals by finite difference.
function surfaceNormal(fn, a, s, outward) {
  const e = 1e-4, p = fn(a, s), pa = fn(a + e, s).sub(fn(a - e, s)), ps = fn(a, s + e).sub(fn(a, s - e));
  const n = pa.cross(ps).normalize(); if (n.dot(outward(p, a)) < 0) n.negate();
  return {p, n};
}

// Arm: the shipped hexagonal sections (measured from the input at 4 cm steps), interpolated smoothly along x and
// splined around. top/upper shoulder/lower shoulder/bottom keep the authored ridge heights, so gems stay seated.
const ARM = [ // |x|, yTop, yUpper, zUpper, yLower, zLower, yBottom
  [.04, .660, .637, .022, .604, .026, .584], [.08, .651, .631, .020, .602, .024, .584], [.12, .639, .622, .018, .597, .021, .582],
  [.16, .624, .610, .016, .590, .018, .577], [.20, .607, .596, .013, .580, .015, .569], [.24, .587, .579, .011, .567, .012, .559],
  [.28, .565, .559, .008, .551, .009, .547], [.32, .535, .535, 0, .535, 0, .535]];
function armParams(x) {
  const ax = clamp(Math.abs(x), .04, .32);
  let i = 0; while (i < ARM.length - 2 && ARM[i + 1][0] < ax) i++;
  const A = ARM[Math.max(0, i - 1)], B = ARM[i], C = ARM[i + 1], D = ARM[Math.min(ARM.length - 1, i + 2)], t = (ax - B[0]) / (C[0] - B[0]);
  return B.map((_, k) => .5 * (2 * B[k] + (-A[k] + C[k]) * t + (2 * A[k] - 5 * B[k] + 4 * C[k] - D[k]) * t * t + (-A[k] + 3 * B[k] - 3 * C[k] + D[k]) * t * t * t));
}
const ARM_AROUND = 28;
function armSection(x) {
  const [, yt, yu, zu, yl, zl, yb] = armParams(x);
  // Width taper to an honest point: the last 2 cm pinch smoothly instead of collapsing a hexagon.
  const tip = smooth(clamp((.32 - Math.abs(x)) / .02)), w = Math.max(tip, 1e-4);
  const yc = (yt + yb) / 2, s = (y) => yc + (y - yc) * Math.max(w, .02);
  return closedSpline([[0, s(yt)], [zu * w * 1.04, s(yu)], [zl * w * 1.06, s(yl)], [0, s(yb)], [-zl * w * 1.06, s(yl)], [-zu * w * 1.04, s(yu)]], 120);
}
const armCenterY = x => { const [, yt, , , , , yb] = armParams(x); return (yt + yb) / 2; };
function armPoint(x, s) {
  const sec = armSection(x), f = ((s % 1) + 1) % 1 * sec.length, k = Math.floor(f), t = f - k;
  const a = sec[k % sec.length], b = sec[(k + 1) % sec.length];
  return new Vector3(x, lerp(a[1], b[1], t), lerp(a[0], b[0], t));
}
const armOut = (p, x) => new Vector3(0, p.y - armCenterY(x), p.z);
const armSurf = (x, s) => surfaceNormal(armPoint, x, s, armOut);
const armSlope = x => (armCenterY(x + 1e-3) - armCenterY(x - 1e-3)) / 2e-3;

// Socket ("eye" block): rounded octagon, wide band .568–.655, tapering below to the haft and above to the crown point.
const OCT = [[.035, .016], [.015, .038], [-.015, .038], [-.035, .016], [-.035, -.016], [-.015, -.038], [.015, -.038], [.035, -.016]];
const OCT_ROUND = (() => { // rounded corners: each corner becomes a short arc
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const p = OCT[i], prev = OCT[(i + 7) % 8], next = OCT[(i + 1) % 8], r = .18;
    pts.push([lerp(p[0], prev[0], r), lerp(p[1], prev[1], r)], [p[0] * .985, p[1] * .985], [lerp(p[0], next[0], r), lerp(p[1], next[1], r)]);
  }
  return closedSpline(pts, 96);
})();
const SOCKET_PROFILE = [[.545, .74], [.556, .9], [.568, 1], [.655, 1], [.668, .86], [.680, .69], [.693, .55], [.705, .38], [.713, .2], [.718, 0]];
function socketScale(y) {
  if (y <= SOCKET_PROFILE[0][0]) return SOCKET_PROFILE[0][1];
  for (let i = 0; i < SOCKET_PROFILE.length - 1; i++) {
    const [y0, s0] = SOCKET_PROFILE[i], [y1, s1] = SOCKET_PROFILE[i + 1];
    if (y <= y1) return lerp(s0, s1, (y - y0) / (y1 - y0));
  }
  return 0;
}
function socketPoint(y, s) {
  const f = ((s % 1) + 1) % 1 * OCT_ROUND.length, k = Math.floor(f), t = f - k;
  const a = OCT_ROUND[k % OCT_ROUND.length], b = OCT_ROUND[(k + 1) % OCT_ROUND.length], sc = socketScale(y);
  return new Vector3(lerp(a[0], b[0], t) * sc, y, lerp(a[1], b[1], t) * sc);
}
const socketSurf = (y, s) => surfaceNormal(socketPoint, y, s, p => new Vector3(p.x, 0, p.z));

// Haft: the shipped elliptical ash profile (radius x / z by height).
const HAFT = [[-.030, .0198, .0173], [.002, .0200, .0174], [.068, .0212, .0184], [.132, .0222, .0194], [.198, .0231, .0201], [.262, .0237, .0207],
  [.327, .0241, .0210], [.393, .0242, .0210], [.458, .0240, .0208], [.522, .0235, .0205], [.587, .0230, .0200], [.620, .0227, .0197]];
function haftRadii(y) {
  if (y <= HAFT[0][0]) return [HAFT[0][1], HAFT[0][2]];
  for (let i = 0; i < HAFT.length - 1; i++) if (y <= HAFT[i + 1][0]) {
    const t = (y - HAFT[i][0]) / (HAFT[i + 1][0] - HAFT[i][0]);
    return [lerp(HAFT[i][1], HAFT[i + 1][1], t), lerp(HAFT[i][2], HAFT[i + 1][2], t)];
  }
  return [HAFT.at(-1)[1], HAFT.at(-1)[2]];
}
// s = 0 faces +X; .25 faces +Z (front, where the langet sits).
const haftPoint = (y, s) => { const [rx, rz] = haftRadii(y), a = s * Math.PI * 2; return new Vector3(Math.cos(a) * rx, y, Math.sin(a) * rz); };
const haftSurf = (y, s) => surfaceNormal(haftPoint, y, s, p => new Vector3(p.x, 0, p.z));

// ------------------------------------------------------------------ generators
// Sleeve: a band wrapped around a closed surface. across ∈ [-1,1] (width), around s ∈ [0,1].
// place(across, s) → surface {p,n}; height(across) → offset from the surface.
function sleeve({place, height, acrossSteps = 10, aroundSteps = 48, uvScale = [1, 1]}) {
  const m = mesh(), start = m.count;
  for (let i = 0; i <= acrossSteps; i++) {
    const across = -1 + 2 * i / acrossSteps;
    for (let j = 0; j <= aroundSteps; j++) {
      const s = j / aroundSteps, {p, n} = place(across, s);
      m.vertex(p.addScaledVector(n, height(across)), [s * uvScale[0], (across * .5 + .5) * uvScale[1]]);
    }
  }
  m.grid(start, acrossSteps + 1, aroundSteps + 1);
  const normals = []; for (let i = 0; i <= acrossSteps; i++) for (let j = 0; j <= aroundSteps; j++) normals.push(place(-1 + 2 * i / acrossSteps, j / aroundSteps).n);
  return m.orient(i => normals[i]);
}
// Ferrule profile: rounded rims at both edges over a slightly lower centre, feathered to the surface at the very edge.
const ferrule = (t, rim = 1, centre = .62) => across => {
  const e = Math.abs(across);
  if (e > .985) return t * .08;
  const rimShape = Math.exp(-(((e - .78) / .16) ** 2)) * rim, body = centre * Math.sqrt(Math.max(0, 1 - e ** 8));
  return .0003 + t * Math.max(body, rimShape * Math.sqrt(Math.max(0, 1 - ((e - .78) / .21) ** 2)) + body * .3);
};
// Plate: an open patch lying on a surface. along ∈ [0,1], across ∈ [-1,1] with half-width w(along) (in surface units).
function plate({place, width, thickness, alongSteps = 16, acrossSteps = 8, uvScale = [1, 1]}) {
  const m = mesh(), start = m.count;
  for (let i = 0; i <= alongSteps; i++) {
    const along = i / alongSteps, w = width(along);
    for (let j = 0; j <= acrossSteps; j++) {
      const across = -1 + 2 * j / acrossSteps, {p, n} = place(along, across * w);
      const e = Math.abs(across), h = thickness(along) * Math.sqrt(Math.max(0, 1 - e ** 6)) + .0002;
      m.vertex(p.addScaledVector(n, h), [(across * .5 + .5) * uvScale[0], along * uvScale[1]]);
    }
  }
  m.grid(start, alongSteps + 1, acrossSteps + 1, true);
  const normals = []; for (let i = 0; i <= alongSteps; i++) for (let j = 0; j <= acrossSteps; j++) normals.push(place(i / alongSteps, (-1 + 2 * j / acrossSteps) * width(i / alongSteps)).n);
  return m.orient(i => normals[i]);
}
// Wire: half-sunk round tube along a curve lying on a surface. curve(t) → {p, n}.
function wire({curve, radius, steps = 64, sides = 8, sink = .35, closed = false}) {
  const m = mesh(), start = m.count, T = new Vector3(), B = new Vector3(), centres = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, {p, n} = curve(t), q = curve(Math.min(1, t + 1e-3)).p, r = curve(Math.max(0, t - 1e-3)).p;
    T.copy(q).sub(r).normalize(); B.crossVectors(T, n).normalize(); const N = new Vector3().crossVectors(B, T);
    const c = p.clone().addScaledVector(N, radius * (1 - sink));
    for (let k = 0; k <= sides; k++) centres.push(c);
    for (let k = 0; k <= sides; k++) {
      const a = k / sides * Math.PI * 2;
      m.vertex(c.clone().addScaledVector(N, Math.cos(a) * radius).addScaledVector(B, Math.sin(a) * radius), [k / sides, t * steps / 8]);
    }
  }
  m.grid(start, steps + 1, sides + 1, true);
  m.orient(i => new Vector3().fromArray(m.p, i * 3).sub(centres[i]));
  const tubeTris = m.idx.length / 3;
  if (!closed) for (const end of [0, steps]) { // dome the ends
    const {p, n} = curve(end / steps), cap = m.vertex(p.clone().addScaledVector(n, radius * (1 - sink) * .9), [.5, .5]);
    for (let k = 0; k < sides; k++) { const a = start + end * (sides + 1) + k; m.tri(a, a + 1, cap); }
    const along = curve(Math.min(1, end / steps + 1e-3)).p.sub(curve(Math.max(0, end / steps - 1e-3)).p).multiplyScalar(end ? 1 : -1);
    m.orient(() => along, m.idx.length / 3 - sides);
  }
  void tubeTris; return m;
}
// Lathe in a local frame (origin, up axis): profile [[r, h]] bottom → top.
function lathe(profile, {origin, up, sides = 24, uvScale = 1, ellipse = [1, 1]}) {
  const m = mesh(), start = m.count, U = up.clone().normalize();
  const X = Math.abs(U.x) < .9 ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1); X.addScaledVector(U, -X.dot(U)).normalize();
  const Z = new Vector3().crossVectors(X, U);
  profile.forEach(([r, h], i) => {
    for (let k = 0; k <= sides; k++) {
      const a = k / sides * Math.PI * 2;
      m.vertex(origin.clone().addScaledVector(U, h).addScaledVector(X, Math.cos(a) * r * ellipse[0]).addScaledVector(Z, Math.sin(a) * r * ellipse[1]),
        [k / sides * uvScale, i / (profile.length - 1)]);
    }
  });
  m.grid(start, profile.length, sides + 1, true);
  return m.orient(i => { const v = new Vector3().fromArray(m.p, i * 3).sub(origin); return v.addScaledVector(U, -v.dot(U)); });
}

// ------------------------------------------------------------------ PickHead (blued star-steel arms)
function buildPickHead() {
  const m = mesh(), xs = [];
  const half = 48; // dense near the tips where the curve is tightest
  for (let i = 0; i <= half; i++) xs.push(-.32 + .32 * (1 - Math.cos(i / half * Math.PI / 2)));
  for (let i = half - 1; i >= 0; i--) xs.push(-xs[i]);
  const start = m.count;
  let u = 0, prev = null;
  for (const x of xs) {
    const c = new Vector3(x, armCenterY(x), 0); if (prev) u += c.distanceTo(prev); prev = c;
    for (let j = 0; j <= ARM_AROUND; j++) m.vertex(armPoint(x, j / ARM_AROUND), [u * 8, j / ARM_AROUND]);
  }
  m.grid(start, xs.length, ARM_AROUND + 1, true);
  return m.orient(i => new Vector3(0, m.p[i * 3 + 1] - armCenterY(m.p[i * 3]), m.p[i * 3 + 2])).computeNormals();
}

// ------------------------------------------------------------------ HeadSocket (blued steel eye block)
function buildSocket() {
  const m = mesh(), ys = [], start = m.count, around = 40;
  for (let i = 0; i < SOCKET_PROFILE.length - 1; i++) {
    const [y0] = SOCKET_PROFILE[i], [y1] = SOCKET_PROFILE[i + 1], n = Math.max(2, Math.round((y1 - y0) / .006));
    for (let k = 0; k < n; k++) ys.push(lerp(y0, y1, k / n));
  }
  ys.push(.718);
  for (const y of ys) for (let j = 0; j <= around; j++) m.vertex(socketPoint(y, j / around), [j / around * 1.2, (y - .545) * 7]);
  m.grid(start, ys.length, around + 1, true);
  m.orient(i => new Vector3(m.p[i * 3], 0, m.p[i * 3 + 2]));
  // Close the bottom (hidden by the throat, but keeps the block solid for contact rays).
  const c = m.vertex(new Vector3(0, .545, 0), [.5, 0]);
  const capFrom = m.idx.length / 3;
  for (let j = 0; j < around; j++) m.tri(start + j + 1, start + j, c);
  return m.orient(() => new Vector3(0, -1, 0), capFrom).computeNormals();
}

// ------------------------------------------------------------------ brass
const BRASS = [];
// Arm bands: perpendicular to the arm's own axis, wrapped on its true surface.
function armBand(x0, width) {
  const m0 = armSlope(x0), k = Math.hypot(1, m0), yc = armCenterY(x0);
  const place = (across, s) => {
    // Points of the band plane (perpendicular to the arm tangent) satisfy (x-x0) + m (y-yc) = a·k.
    let x = x0 + across * width / 2 * k;
    for (let it = 0; it < 4; it++) x = x0 + across * width / 2 * k - m0 * (armPoint(x, s).y - yc);
    return armSurf(x, s);
  };
  return sleeve({place, height: ferrule(.0026), acrossSteps: 8, aroundSteps: 32, uvScale: [6, .6]});
}
for (const x of [-.235, -.155, -.05, .05, .155, .235]) BRASS.push(['bands', armBand(x, x === .05 || x === -.05 ? .011 : .009)]);

// Socket bands: lower band with a crown of petals hanging onto the socket taper; upper band below the crown point.
function socketBand(y0, height, t) {
  return sleeve({place: (across, s) => socketSurf(y0 + across * height / 2, s), height: ferrule(t, 1, .7), acrossSteps: 8, aroundSteps: 48, uvScale: [8, .6]});
}
BRASS.push(['trim', socketBand(.5625, .012, .0024)], ['trim', socketBand(.6625, .011, .0022)]);
for (let i = 0; i < 8; i++) { // petals: one per octagon face, pointing down to the haft
  const sc = (3 * i + 2.5) / 24; // face centre between rounded corners 3i+1 and 3i+4 of OCT_ROUND's control points
  BRASS.push(['trim', plate({
    place: (along, across) => socketSurf(.557 - along * .0115, sc + across),
    width: along => .042 * Math.sqrt(Math.max(0, 1 - along ** 2.2)) + .001, thickness: along => .0016 * (1 - along * .5),
    alongSteps: 10, acrossSteps: 8, uvScale: [1, .6]})]);
}
// Heart-gem bezels: an oval wire following the socket face around each heart crystal.
for (const side of [1, -1]) BRASS.push(['trim', wire({closed: true, steps: 56, sides: 6, radius: .0019, sink: .45, curve: t => {
  const a = t * Math.PI * 2, x = Math.cos(a) * .0198, y = .614 + Math.sin(a) * .0362;
  // Project onto the socket surface from the front: find s whose point has this x on the given side.
  let lo = side > 0 ? .02 : .52, hi = side > 0 ? .48 : .98;
  for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2, px = socketPoint(y, mid).x; if ((side > 0 ? px > x : px < x)) lo = mid; else hi = mid; }
  return socketSurf(y, (lo + hi) / 2);
}})]);

// Throat: lathed brass cone that carries the haft into the socket, with a beaded lip.
BRASS.push(['bands', lathe([[.0228, .517], [.0258, .5185], [.0266, .522], [.0259, .5255], [.0251, .527], [.0250, .531], [.0262, .5335], [.0250, .536], [.0257, .541], [.0271, .5455], [.0268, .549], [.0262, .552]],
  {origin: new Vector3(0, 0, 0), up: new Vector3(0, 1, 0), sides: 28, uvScale: 6, ellipse: [1, .87]})]);

// Haft ferrules (top of grip, bottom of grip) and pommel.
function haftFerrule(y0, height, t) {
  return sleeve({place: (across, s) => haftSurf(y0 + across * height / 2, s), height: ferrule(t, 1, .66), acrossSteps: 8, aroundSteps: 32, uvScale: [6, .6]});
}
BRASS.push(['bands', haftFerrule(.345, .02, .0026)], ['bands', haftFerrule(.094, .02, .0026)], ['bands', haftFerrule(.441, .009, .0019)]);
BRASS.push(['trim', lathe([[.0, -.045], [.010, -.0448], [.0175, -.0425], [.0222, -.037], [.0236, -.029], [.0226, -.021], [.0205, -.016], [.0214, -.010], [.0232, -.005],
  [.0228, .006], [.0210, .010], [.0208, .022], [.0214, .027], [.0205, .030]], {origin: new Vector3(0, 0, 0), up: new Vector3(0, 1, 0), sides: 28, uvScale: 6, ellipse: [1, .875]})]);

// Side straps (brass, ±X) and langets (blued steel, ±Z): plates on the haft from the throat down, spear-pointed.
const strap = (s0, top, bottom, halfWidth, t) => plate({ // halfWidth is arc length on the haft
  place: (along, across) => haftSurf(lerp(top, bottom, along), s0 + across / (2 * Math.PI * .0235)),
  width: along => halfWidth * (along < .78 ? 1 : Math.max(0, 1 - ((along - .78) / .22) ** 1.4)) + .0003,
  thickness: () => t, alongSteps: 16, acrossSteps: 6, uvScale: [.4, 3]});
for (const s0 of [0, .5]) BRASS.push(['trim', strap(s0, .526, .392, .0055, .0014)]);
const LANGETS = mesh();
for (const s0 of [.25, .75]) LANGETS.append(strap(s0, .526, .372, .0072, .0017));
// Rivets: brass domes through the straps and langets.
function rivet(y, s, lift) {
  const {p, n} = haftSurf(y, s); p.addScaledVector(n, lift);
  return lathe([[.0021, -.0006], [.0021, .0002], [.0018, .0008], [.0011, .0012], [0, .00135]], {origin: p, up: n, sides: 8, uvScale: 1});
}
for (const s0 of [0, .5]) for (const y of [.43, .48]) BRASS.push(['trim', rivet(y, s0, .0013)]);
for (const s0 of [.25, .75]) for (const y of [.405, .455, .505]) BRASS.push(['trim', rivet(y, s0, .0016)]);
// Brass wire: 1.5 turns between the grip ferrule and the readiness tier, riding over straps and langets.
const PLATES = [[0, .526, .392, .0055, .0014], [.5, .526, .392, .0055, .0014], [.25, .526, .372, .0072, .0017], [.75, .526, .372, .0072, .0017]];
function plateLift(y, s) {
  let lift = 0;
  for (const [s0, top, bottom, half, t] of PLATES) {
    const along = (top - y) / (top - bottom); if (along < 0 || along > 1) continue;
    const w = half * (along < .78 ? 1 : Math.max(0, 1 - ((along - .78) / .22) ** 1.4)) + .0003;
    const d = Math.abs((((s - s0) % 1) + 1.5) % 1 - .5) * 2 * Math.PI * .0235;
    lift = Math.max(lift, t * smooth(clamp((w + .0012 - d) / .0024)));
  }
  return lift;
}
BRASS.push(['bands', wire({steps: 120, sides: 5, radius: .0012, sink: .2, curve: t => {
  const y = lerp(.358, .432, t), s = .12 + t * 1.5, {p, n} = haftSurf(y, s);
  return {p: p.addScaledVector(n, plateLift(y, s)), n};
}})]);

// Arm shard settings: cups on the arm ridge under each crown arm crystal, axis = ridge normal.
const crown = inputMesh('Embellish_Crystal_Crown');
function clusters(m) {
  const n = m.position.length / 3, parent = Int32Array.from({length: n}, (_, i) => i);
  const root = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const weld = new Map();
  for (let i = 0; i < n; i++) { const k = [0, 1, 2].map(c => Math.round(m.position[i * 3 + c] * 4000)).join(); if (weld.has(k)) parent[root(i)] = root(weld.get(k)); else weld.set(k, i); }
  for (let t = 0; t < m.index.length; t += 3) for (const o of [1, 2]) { const a = root(m.index[t]), b = root(m.index[t + o]); if (a !== b) parent[a] = b; }
  const groups = new Map();
  for (let i = 0; i < n; i++) { const r = root(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
  return [...groups.values()].map(v => {
    const box = new THREE.Box3(); for (const i of v) box.expandByPoint(new Vector3().fromArray(m.position, i * 3));
    return {v, box, c: box.getCenter(new Vector3()), size: box.getSize(new Vector3())};
  });
}
const SETTINGS = mesh();
const crownGroups = clusters(crown);
for (const g of crownGroups) {
  const ax = Math.abs(g.c.x);
  if (ax < .06 || ax > .2 || Math.abs(g.c.z) > .01) continue; // arm ridge crystals only
  const {p, n} = armSurf(g.c.x, 0); // s = 0 is the top ridge
  SETTINGS.append(lathe([[.0068, -.0035], [.0086, -.0004], [.0094, .0018], [.0088, .0042], [.0074, .0052], [.0066, .0044], [.0062, .0026]],
    {origin: p, up: n, sides: 12, uvScale: 2}));
  for (let k = 0; k < 4; k++) { // four claws gripping the crystal
    const a = k / 4 * Math.PI * 2 + Math.PI / 4, X = new Vector3(1, 0, 0).addScaledVector(n, -n.x).normalize(), Z = new Vector3().crossVectors(X, n);
    const dir = X.clone().multiplyScalar(Math.cos(a)).addScaledVector(Z, Math.sin(a));
    SETTINGS.append(wire({steps: 4, sides: 4, radius: .0011, sink: 0, curve: t => ({
      p: p.clone().addScaledVector(n, .004 + t * .0075).addScaledVector(dir, .0078 - t * .0032), n: dir.clone()})}));
  }
}
// Crown side gems: seat them on the arm cheeks (they floated ~2 cm off), each in a small bezel ring.
const crownPos = Float32Array.from(crown.position), moved = [];
for (const g of crownGroups) {
  if (Math.abs(g.c.z) < .025) continue;
  const side = Math.sign(g.c.z), s = side > 0 ? .25 : .75; // cheek directions
  // Find the cheek point at this x nearest the crystal's height.
  let best = null;
  for (let k = -40; k <= 40; k++) { const q = armSurf(g.c.x, s + k / 400); if (!best || Math.abs(q.p.y - g.c.y) < Math.abs(best.p.y - g.c.y)) best = q; }
  const target = best.p.clone().addScaledVector(best.n, g.size.z * .32), d = target.clone().sub(g.c);
  for (const i of g.v) { crownPos[i * 3] += d.x; crownPos[i * 3 + 1] += d.y; crownPos[i * 3 + 2] += d.z; }
  moved.push({from: g.c.toArray(), to: target.toArray()});
  SETTINGS.append(lathe([[.0074, -.0012], [.0086, .0004], [.0086, .0016], [.0076, .0024], [.0066, .0018]], {origin: best.p, up: best.n, sides: 12, uvScale: 2}));
}

// ------------------------------------------------------------------ wood haft and leather grip
function buildShaft() {
  const m = mesh(), start = m.count, around = 28, ys = [];
  for (let y = -.03; y <= .62 + 1e-9; y += .02) ys.push(+y.toFixed(5));
  for (const y of ys) for (let j = 0; j <= around; j++) m.vertex(haftPoint(y, j / around), [j / around, (y + .03) / .14]);
  m.grid(start, ys.length, around + 1, true);
  return m.orient(i => new Vector3(m.p[i * 3], 0, m.p[i * 3 + 2])).computeNormals();
}
function buildGrip() {
  // Overlapping helical leather strip: radius ramps across each strip so every turn laps the one below.
  const m = mesh(), start = m.count, around = 24, y0 = .104, y1 = .335, pitch = .0165, rows = 84;
  for (let i = 0; i <= rows; i++) {
    const y = lerp(y0, y1, i / rows);
    for (let j = 0; j <= around; j++) {
      const s = j / around, {p, n} = haftSurf(y, s);
      const phase = ((y - y0 - s * pitch) / pitch % 1 + 1) % 1; // 0 at a strip's lower edge, 1 at its top
      const lap = phase < .9 ? phase / .9 : 1 - (phase - .9) / .1 * .85;
      const ends = smooth(clamp((y - y0) / .004)) * smooth(clamp((y1 - y) / .004));
      p.addScaledVector(n, .0006 + (.0012 + .0017 * Math.sqrt(lap)) * ends);
      m.vertex(p, [(s + (y - y0) / pitch) * .5, phase]);
    }
  }
  m.grid(start, rows + 1, around + 1, true);
  return m.orient(i => new Vector3(m.p[i * 3], 0, m.p[i * 3 + 2])).computeNormals();
}

// ------------------------------------------------------------------ assemble
const merge = list => list.reduce((acc, m) => acc.append(m.idx.length && !m.n.some(Boolean) ? m.computeNormals() : m), mesh());
const brassTrim = merge(BRASS.filter(([k]) => k === 'trim').map(([, m]) => m));
const goldBands = merge(BRASS.filter(([k]) => k === 'bands').map(([, m]) => m));
const out = {
  PickHead: buildPickHead(), HeadSocket: buildSocket(), Shaft: buildShaft(), GripWrap: buildGrip(),
  BrassTrim: brassTrim, Embellish_Gold_Bands: goldBands, Embellish_Gold_ShardSettings: SETTINGS.computeNormals(),
  Embellish_Darkmetal_Langets: LANGETS.computeNormals(),
};
for (const m of Object.values(out)) if (!m.n.some(Boolean)) m.computeNormals();

// ------------------------------------------------------------------ GLB writer
const chunks = [], views = [], accessors = [];
let byteLength = 0;
function pushView(bytes, target) {
  const pad = (4 - byteLength % 4) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); byteLength += pad; }
  views.push({buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength, ...(target ? {target} : {})});
  chunks.push(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)); byteLength += bytes.byteLength;
  return views.length - 1;
}
function pushAccessor(array, type, componentType, target, minmax = false) {
  const n = {SCALAR: 1, VEC2: 2, VEC3: 3}[type], acc = {bufferView: pushView(array, target), componentType, count: array.length / n, type};
  if (minmax) {
    acc.min = []; acc.max = [];
    for (let c = 0; c < n; c++) { let lo = Infinity, hi = -Infinity; for (let i = c; i < array.length; i += n) { lo = Math.min(lo, array[i]); hi = Math.max(hi, array[i]); } acc.min.push(lo); acc.max.push(hi); }
  }
  accessors.push(acc); return accessors.length - 1;
}
function primitive({position, normal, uv, index}, material) {
  const p = {attributes: {POSITION: pushAccessor(Float32Array.from(position), 'VEC3', 5126, 34962, true), NORMAL: pushAccessor(Float32Array.from(normal), 'VEC3', 5126, 34962)}, material};
  if (uv) p.attributes.TEXCOORD_0 = pushAccessor(Float32Array.from(uv), 'VEC2', 5126, 34962);
  const big = position.length / 3 > 65535;
  p.indices = pushAccessor(big ? Uint32Array.from(index) : Uint16Array.from(index), 'SCALAR', big ? 5125 : 5123, 34963);
  return p;
}
const MATERIAL = Object.fromEntries(J.materials.map((m, i) => [m.name, i]));
const meshes = [], nodes = structuredClone(J.nodes);
for (const node of nodes) {
  if (node.mesh === undefined) continue;
  const name = node.name, original = J.meshes[node.mesh];
  let data;
  if (out[name]) { const m = out[name]; data = {position: m.p, normal: m.n, uv: m.uv, index: m.idx}; }
  else {
    const m = inputMesh(name);
    data = {position: name === 'Embellish_Crystal_Crown' ? crownPos : m.position, normal: m.normal, uv: m.uv, index: m.index};
  }
  const material = original.primitives[0].material;
  meshes.push({name: original.name, primitives: [primitive(data, material)]});
  node.mesh = meshes.length - 1;
}
// Textures: colour + normal per surface family. Brass colour multiplies the authored Brass_Trim factor.
const images = [], textures = [];
function texture(file) {
  const bytes = readFileSync(path.join(texDir, file));
  images.push({name: file.replace(/\.jpg$/, ''), mimeType: 'image/jpeg', bufferView: pushView(new Uint8Array(bytes))});
  textures.push({sampler: 0, source: images.length - 1}); return textures.length - 1;
}
const materials = structuredClone(J.materials);
const set = (name, color, normal, scale = 1) => {
  const m = materials[MATERIAL[name]];
  m.pbrMetallicRoughness.baseColorTexture = {index: texture(color)};
  m.normalTexture = {index: texture(normal), scale};
};
set('Steel_Blued', 'steel_color.jpg', 'steel_normal.jpg', .5);
set('Wood_Ash', 'wood_color.jpg', 'wood_normal.jpg', .5);
set('Leather_Wrap', 'leather_color.jpg', 'leather_normal.jpg', .9);
set('Brass_Trim', 'brass_color.jpg', 'brass_normal.jpg', .55);

// Bounds contract.
const box = new THREE.Box3();
for (const m of meshes) { const a = accessors[m.primitives[0].attributes.POSITION]; box.expandByPoint(new Vector3(...a.min)); box.expandByPoint(new Vector3(...a.max)); }
for (let c = 0; c < 3; c++) {
  if (Math.abs(box.min.getComponent(c) - BOUNDS.min[c]) > 6e-4 || Math.abs(box.max.getComponent(c) - BOUNDS.max[c]) > 6e-4)
    throw new Error(`bounds changed: ${box.min.toArray()} ${box.max.toArray()}`);
}

const gltf = {asset: {version: '2.0', generator: 'brann pick refinement 2026-10-04'}, scene: J.scene ?? 0, scenes: J.scenes, nodes, meshes,
  materials, textures, images, samplers: [{magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497}], accessors, bufferViews: views,
  buffers: [{byteLength: 0}]};
const bin = Buffer.concat(chunks.concat(Buffer.alloc((4 - byteLength % 4) % 4))); gltf.buffers[0].byteLength = bin.length;
let json = Buffer.from(JSON.stringify(gltf)); json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
const header = Buffer.alloc(12); header.write('glTF', 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(json.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
writeFileSync(output, Buffer.concat([header, jh, json, bh, bin]));
const tris = Object.fromEntries(meshes.map(m => [m.name, accessors[m.primitives[0].indices].count / 3]));
console.log(JSON.stringify({output: path.basename(output), bytes: 12 + 16 + json.length + bin.length, triangles: tris, total: Object.values(tris).reduce((a, b) => a + b, 0),
  bounds: {min: box.min.toArray(), max: box.max.toArray()}, movedSideGems: moved}, null, 1));
