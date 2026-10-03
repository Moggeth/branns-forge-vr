// Procedural 6 x 6 m stone foundation for Brann's Forge. +Y up, metres.
// Authoritative walkable surface is LOCAL y = 0 (no vertex is above it).
// Joint bed top sits at BED_Y (< -0.12); paver bottoms pass through it, so
// there are no coplanar overlapping faces. Perimeter kerb reaches FOOT_Y.
// Only dependency: three. Geometry + materials are built once and shared.
import * as THREE from 'three';

export const FOUNDATION_HALF = 3;
export const FOUNDATION_WALK_Y = 0;
export const FOUNDATION_BED_Y = -0.135;
export const FOUNDATION_FOOT_Y = -0.42;
const BED_Y = FOUNDATION_BED_Y, FOOT_Y = FOUNDATION_FOOT_Y;
const PAVER_BOTTOM = -0.175;  // field pavers end below the bed top
const KERB = 0.5;             // perimeter course width (corner stones are KERB x KERB)
const FIELD = FOUNDATION_HALF - KERB;

let M = null;
const G = new Map(); // seed -> {stone, bed, stats}

function materials() {
  if (M) return M;
  M = {
    stone: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }),
    bed: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }),
  };
  M.stone.name = 'foundation-stone'; M.bed.name = 'foundation-bed';
  return M;
}

// ------------------------------------------------------------- utilities
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const fract = (v) => v - Math.floor(v);
const hash2 = (x, z) => fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453);
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
// Moss favours one damp corner and drifts in patches; 0..1.
const mossField = (x, z) => Math.min(1, Math.max(0,
  vnoise(x * 0.9 + 3.1, z * 0.9 - 1.7) * 0.75 + vnoise(x * 2.7, z * 2.7) * 0.35 + (-x - z) * 0.06 - 0.35) * 1.6);

// Mineral palette: weathered granite, buff sandstone, blue slate, iron-stained, pale limestone.
const PALETTE = [
  [0x8e8a82, 0.34], [0x9a8a72, 0.22], [0x737a80, 0.18], [0x8f7560, 0.12], [0xa8a294, 0.14],
].map(([h, w]) => [new THREE.Color(h), w]);
function pickMineral(r, out) {
  let x = r(), i = 0;
  for (; i < PALETTE.length - 1 && x > PALETTE[i][1]; i++) x -= PALETTE[i][1];
  out.copy(PALETTE[i][0]);
  const v = 0.9 + r() * 0.18; out.multiplyScalar(v);
  out.offsetHSL((r() - 0.5) * 0.02, (r() - 0.5) * 0.04, 0);
  return out;
}

// Indexed accumulation bucket (merged later into one geometry per material).
function bucket() { return { p: [], c: [], i: [] }; }
function vert(b, x, y, z, col) { b.p.push(x, y, z); b.c.push(col.r, col.g, col.b); return b.p.length / 3 - 1; }
function finish(b) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.c, 3));
  g.setIndex(b.i);
  g.computeVertexNormals();
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------- one block
// Lofted worn block: centre fan + rings (top arris, bevel mid, bevel foot, base).
// Outline is a chamfered rectangle with edge midpoints (12 points).
const _base = new THREE.Color(), _c = new THREE.Color(), _moss = new THREE.Color(0x4f6a2c),
  _mossDark = new THREE.Color(0x2f4020), _lichen = new THREE.Color(0xb8b07a), _grime = new THREE.Color(0x3a352e);
function block(b, r, x0, z0, x1, z1, o) {
  const { bottom, bevel = 0.03, chamfer = 0.04, outerBevel = null, wear = 0.006, chips = 0.35, tone = 1 } = o;
  pickMineral(r, _base).multiplyScalar(tone);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hx = (x1 - x0) / 2, hz = (z1 - z0) / 2;
  const ch = Math.min(chamfer, hx * 0.4, hz * 0.4);
  // Outline (counter-clockwise seen from +Y) as unit offsets.
  const ol = [
    [hx - ch, -hz], [hx, -hz + ch], [hx, 0], [hx, hz - ch], [hx - ch, hz], [0, hz],
    [-hx + ch, hz], [-hx, hz - ch], [-hx, 0], [-hx, -hz + ch], [-hx + ch, -hz], [0, -hz],
  ];
  const n = ol.length;
  // Per-point arris jitter and chips (inset + drop at one or two arris points).
  const chipAt = new Float32Array(n);
  if (r() < chips) chipAt[Math.floor(r() * n)] = 0.5 + r() * 0.5;
  if (r() < chips * 0.4) chipAt[Math.floor(r() * n)] = 0.4 + r() * 0.4;
  const ring = (k, inset, y, shadeFn) => {
    const ids = new Array(n);
    for (let j = 0; j < n; j++) {
      const [ox, oz] = ol[j];
      // Outward direction for this outline point.
      const dx = Math.abs(ox) >= hx - 1e-6 ? Math.sign(ox) : (Math.abs(ox) > hx - ch - 1e-6 ? Math.sign(ox) * 0.7 : 0);
      const dz = Math.abs(oz) >= hz - 1e-6 ? Math.sign(oz) : (Math.abs(oz) > hz - ch - 1e-6 ? Math.sign(oz) * 0.7 : 0);
      let ins = inset(dx, dz, j), yy = typeof y === 'function' ? y() : y;
      const chip = chipAt[j];
      if (chip && k <= 1) { ins += chip * 0.035; yy -= chip * (k === 0 ? 0.022 : 0.012); }
      const jit = k <= 2 ? (hash2(cx * 7 + j, cz * 5 + k) - 0.5) * 0.006 : 0;
      const px = cx + ox - dx * (ins + jit), pz = cz + oz - dz * (ins + jit);
      shadeFn(_c, px, pz, j, chip);
      ids[j] = vert(b, px, yy, pz, _c);
    }
    return ids;
  };
  const ob = outerBevel; // optional {side:[sx,sz], bevel}: bigger arris on kerb outer face
  const bev = (dx, dz) => (ob && ((ob[0] && dx * ob[0] > 0.5) || (ob[1] && dz * ob[1] > 0.5)) ? ob[2] : bevel);
  const topY = () => -wear * (0.4 + r() * 0.8);
  const lichen = r() < 0.12;
  const shadeTop = (c, px, pz, j, chip) => {
    c.copy(_base).multiplyScalar(1.05 + (hash2(px * 13, pz * 17) - 0.5) * 0.08);
    if (chip) c.lerp(_base, 0.3).multiplyScalar(1.12); // fresh broken stone reads paler
    if (lichen && hash2(px * 3, pz * 3) > 0.6) c.lerp(_lichen, 0.25);
  };
  const shadeLow = (amt) => (c, px, pz) => {
    c.copy(_base).multiplyScalar(1 - amt * 0.45).lerp(_grime, amt * 0.25);
    const m = mossField(px, pz) * amt; if (m > 0.05) c.lerp(_moss, Math.min(0.75, m));
  };
  const r0 = ring(0, (dx, dz) => bev(dx, dz), topY, shadeTop);
  const r1 = ring(1, (dx, dz) => bev(dx, dz) * 0.32, -bevel * 0.45, (c, px, pz, j, chip) => {
    c.copy(_base).multiplyScalar(1.12); if (chip) c.multiplyScalar(1.05); // worn, sunlit arris
  });
  const r2 = ring(2, () => 0, -bevel * 1.25, shadeLow(0.55));
  const r3 = ring(3, () => 0.004, bottom, shadeLow(1));
  // Centre fan, slightly dished but never above y=0.
  shadeTop(_c, cx, cz, 0, 0); _c.multiplyScalar(1.03);
  const ctr = vert(b, cx, -wear * r() * 0.35, cz, _c);
  for (let j = 0; j < n; j++) b.i.push(ctr, r0[(j + 1) % n], r0[j]);
  for (const [a, c] of [[r0, r1], [r1, r2], [r2, r3]])
    for (let j = 0; j < n; j++) {
      const j1 = (j + 1) % n;
      b.i.push(a[j], a[j1], c[j1], a[j], c[j1], c[j]);
    }
}

// ------------------------------------------------------------- layout
function build(seed) {
  const r = rng(seed * 2654435761 + 17);
  const stone = bucket(), bed = bucket(), joints = [];
  const J = () => 0.018 + r() * 0.01; // joint width per stone edge

  // Corner stones: darker, squarer, heavier arris on both outer faces.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x0 = sx < 0 ? -3 : 3 - KERB, z0 = sz < 0 ? -3 : 3 - KERB;
    const j = J();
    block(stone, r, x0 + (sx < 0 ? 0.004 : j / 2), z0 + (sz < 0 ? 0.004 : j / 2), x0 + KERB - (sx < 0 ? j / 2 : 0.004), z0 + KERB - (sz < 0 ? j / 2 : 0.004), {
      bottom: FOOT_Y, bevel: 0.035, chamfer: 0.07, outerBevel: [sx, sz, 0.07], wear: 0.004, chips: 0.6, tone: 0.86,
    });
  }
  // Kerb runs between corners: long stones, strong outer arris.
  for (const side of [0, 1, 2, 3]) {
    const along = [];
    let t = -FIELD;
    while (t < FIELD - 1e-6) {
      let len = 0.75 + r() * 0.5;
      if (FIELD - (t + len) < 0.5) len = FIELD - t;
      along.push([t, t + len]); t += len;
    }
    for (const [a0, a1] of along) {
      const j = J(), inner = FIELD + j / 2, outer = 3 - 0.004;
      let x0, x1, z0, z1, ob;
      const a = a0 + j / 2, c = a1 - j / 2;
      if (side === 0) { x0 = a; x1 = c; z0 = -outer; z1 = -inner; ob = [0, -1, 0.06]; }
      else if (side === 1) { x0 = a; x1 = c; z0 = inner; z1 = outer; ob = [0, 1, 0.06]; }
      else if (side === 2) { z0 = a; z1 = c; x0 = -outer; x1 = -inner; ob = [-1, 0, 0.06]; }
      else { z0 = a; z1 = c; x0 = inner; x1 = outer; ob = [1, 0, 0.06]; }
      block(stone, r, x0, z0, x1, z1, { bottom: FOOT_Y, bevel: 0.03, chamfer: 0.035, outerBevel: ob, wear: 0.005, chips: 0.45, tone: 0.95 });
      const m = side < 2 ? [a1, side === 0 ? -FIELD - KERB / 2 : FIELD + KERB / 2] : null;
      if (a1 < FIELD - 1e-6) joints.push(side < 2 ? [m[0], m[1], 0, 1, KERB] : [side === 2 ? -FIELD - KERB / 2 : FIELD + KERB / 2, a1, 1, 0, KERB]);
    }
  }
  // Field: running bond ashlar, courses of varying depth, staggered joints.
  let z = -FIELD, prevJoints = [];
  while (z < FIELD - 1e-6) {
    let depth = 0.42 + r() * 0.2;
    if (FIELD - (z + depth) < 0.35) depth = FIELD - z;
    const cuts = [];
    let x = -FIELD + (prevJoints.length ? 0 : 0);
    // Start with a part stone so joints never line up with the course below.
    let first = 0.3 + r() * 0.45;
    while (x < FIELD - 1e-6) {
      let len = cuts.length === 0 ? first : 0.55 + r() * 0.4;
      if (FIELD - (x + len) < 0.3) len = FIELD - x;
      // Nudge a cut away from any joint in the previous course.
      const end = x + len;
      if (end < FIELD - 1e-6) for (const pj of prevJoints) if (Math.abs(pj - end) < 0.14) { len += 0.16; break; }
      if (FIELD - (x + len) < 0.3) len = FIELD - x;
      cuts.push([x, x + len]); x += len;
    }
    const nowJoints = [];
    for (const [x0, x1] of cuts) {
      const j = J();
      const ex0 = x0 <= -FIELD + 1e-6 ? -FIELD + j / 2 : x0 + j / 2, ex1 = x1 >= FIELD - 1e-6 ? FIELD - j / 2 : x1 - j / 2;
      const ez0 = z + j / 2, ez1 = z + depth - j / 2;
      block(stone, r, ex0, ez0, ex1, ez1, { bottom: PAVER_BOTTOM, bevel: 0.022 + r() * 0.014, chamfer: 0.025 + r() * 0.03, wear: 0.004 + r() * 0.005, chips: 0.35 });
      if (x1 < FIELD - 1e-6) { nowJoints.push(x1); joints.push([x1, z + depth / 2, 0, 1, depth]); }
    }
    if (z + depth < FIELD - 1e-6) joints.push([0, z + depth, 1, 0, FIELD * 2]);
    prevJoints = nowJoints; z += depth;
  }
  // Inner kerb/field seam on all four sides.
  for (const s of [-1, 1]) { joints.push([0, s * FIELD, 1, 0, FIELD * 2]); joints.push([s * FIELD, 0, 0, 1, FIELD * 2]); }

  // Joint bed: mortar/soil grid seen only through joints, mossy in damp patches.
  const N = 30, H = 3 - 0.01, mortar = new THREE.Color(0x4a4239), soil = new THREE.Color(0x3b2f24);
  const ids = [];
  for (let iz = 0; iz <= N; iz++) for (let ix = 0; ix <= N; ix++) {
    const px = -H + (2 * H * ix) / N, pz = -H + (2 * H * iz) / N;
    _c.copy(mortar).lerp(soil, vnoise(px * 3, pz * 3) * 0.6);
    const m = mossField(px, pz); if (m > 0.02) _c.lerp(m > 0.6 ? _mossDark : _moss, Math.min(0.85, m * 1.1));
    ids.push(vert(bed, px, BED_Y, pz, _c));
  }
  for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
    const a = iz * (N + 1) + ix, b2 = a + 1, c = a + N + 1, d = c + 1;
    bed.i.push(a, c, b2, b2, c, d);
  }

  // Crevice detail: moss cushions and grit wedged in joints (all well below y=0).
  const tuft = (px, pz, sx, sz, h, col) => {
    const top = vert(bed, px, BED_Y + h, pz, _c.copy(col).multiplyScalar(1.25));
    const ring = [];
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + r() * 0.4;
      _c.copy(col).multiplyScalar(0.8 + r() * 0.25);
      ring.push(vert(bed, px + Math.cos(a) * sx, BED_Y + h * 0.35, pz + Math.sin(a) * sz, _c));
    }
    for (let k = 0; k < 5; k++) bed.i.push(top, ring[(k + 1) % 5], ring[k]);
  };
  const pebble = (px, pz, s) => {
    pickMineral(r, _c).multiplyScalar(0.8);
    const y0 = BED_Y + 0.002, a = r() * Math.PI * 2;
    const t = vert(stone, px, y0 + s * 1.1, pz, _c);
    const q = [0, 1, 2].map((k) => vert(stone, px + Math.cos(a + k * 2.09) * s, y0, pz + Math.sin(a + k * 2.09) * s, _c.multiplyScalar(0.92)));
    stone.i.push(t, q[1], q[0], t, q[2], q[1], t, q[0], q[2]);
  };
  let tufts = 0, pebbles = 0;
  for (const [jx, jz, ax, az, len] of joints) {
    const count = Math.max(1, Math.round(len * 2.2));
    for (let k = 0; k < count; k++) {
      const u = (r() - 0.5) * len * 0.92, lim = 3 - 0.1;
      const px = Math.max(-lim, Math.min(lim, jx + ax * u)), pz = Math.max(-lim, Math.min(lim, jz + az * u));
      const m = mossField(px, pz);
      if (m > 0.25 && r() < 0.85) {
        // Narrow across the joint, longer along it; rises to within ~2.5 cm of the walk plane.
        const across = 0.012, alongS = 0.03 + r() * 0.05;
        tuft(px, pz, ax ? alongS : across, az ? alongS : across, 0.07 + m * 0.035, m > 0.6 ? _mossDark : _moss); tufts++;
      } else if (r() < 0.35) { pebble(px, pz, 0.006 + r() * 0.006); pebbles++; }
    }
  }

  const gStone = finish(stone), gBed = finish(bed);
  const tris = (g) => g.index.count / 3;
  return { stone: gStone, bed: gBed, stats: { triangles: tris(gStone) + tris(gBed), stoneTriangles: tris(gStone), bedTriangles: tris(gBed), tufts, pebbles, drawCalls: 2 } };
}

// ------------------------------------------------------------- public API
// Returns a new Group sharing cached geometry/materials (2 draw calls).
export function createStoneFoundation({ seed = 1, castShadow = true, receiveShadow = true } = {}) {
  const mat = materials();
  let g = G.get(seed);
  if (!g) { g = build(seed); G.set(seed, g); }
  const root = new THREE.Group();
  root.name = 'stone-foundation';
  const stone = new THREE.Mesh(g.stone, mat.stone);
  stone.name = 'foundation-stones'; stone.castShadow = castShadow; stone.receiveShadow = receiveShadow;
  const bed = new THREE.Mesh(g.bed, mat.bed);
  bed.name = 'foundation-bed'; bed.receiveShadow = receiveShadow;
  root.add(stone, bed);
  root.userData.foundation = {
    walkY: FOUNDATION_WALK_Y, bedY: BED_Y, footY: FOOT_Y, half: FOUNDATION_HALF,
    footprint: { minX: -3, maxX: 3, minZ: -3, maxZ: 3 }, ...g.stats,
  };
  return root;
}

export function disposeStoneFoundationArt() {
  for (const g of G.values()) { g.stone.dispose(); g.bed.dispose(); }
  G.clear();
  if (M) { M.stone.dispose(); M.bed.dispose(); }
  M = null;
}
