#!/usr/bin/env node
// Deterministic weapon embellishment builder (Opus 2026-10-03).
// Reads reference/assets/{axe,pick}.glb, keeps every original node, socket, material and texture byte-identical,
// and appends authored embellishment meshes that REUSE the existing materials (no new textures, no material mutation).
// Additions stay inside the original Y bounds, so asset-pose.js prepareAsset() height normalisation is unchanged.
// Usage: node output/build-weapons.cjs [refDir] [outDir]   -> outDir/axe.glb, outDir/pick.glb, outDir/build-report.json
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const REF = path.resolve(process.argv[2] || path.join(ROOT, 'reference/assets'));
const OUT = path.resolve(process.argv[3] || path.join(__dirname, 'assets'));

// ---------- GLB io ----------
function readGlb(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error('not glb ' + file);
  let off = 12, json = null, bin = null;
  while (off < b.length) {
    const len = b.readUInt32LE(off), type = b.readUInt32LE(off + 4), data = b.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8')); else if (type === 0x004e4942) bin = Buffer.from(data);
    off += 8 + len;
  }
  return {json, bin};
}
function writeGlb(file, json, bin) {
  const pad = (buf, c) => { const p = (4 - buf.length % 4) % 4; return p ? Buffer.concat([buf, Buffer.alloc(p, c)]) : buf; };
  json.buffers[0].byteLength = bin.length;
  const j = pad(Buffer.from(JSON.stringify(json), 'utf8'), 0x20), bb = pad(bin, 0);
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + j.length + 8 + bb.length, 8);
  const ch = (len, type) => { const h = Buffer.alloc(8); h.writeUInt32LE(len, 0); h.writeUInt32LE(type, 4); return h; };
  fs.writeFileSync(file, Buffer.concat([head, ch(j.length, 0x4e4f534a), j, ch(bb.length, 0x004e4942), bb]));
}

// ---------- tiny mesh kit (flat-shaded where faceted, smooth where lathed) ----------
const v3 = (x, y, z) => [x, y, z];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
class Geo {
  constructor() { this.p = []; this.n = []; this.uv = []; this.i = []; }
  get count() { return this.p.length / 3; }
  vert(p, n, uv = [0, 0]) { this.p.push(...p); this.n.push(...n); this.uv.push(...uv); return this.count - 1; }
  tri(a, b, c, flat = true) { // flat triangle with its own vertices
    const n = norm(cross(sub(b, a), sub(c, a)));
    const i0 = this.vert(a, n, [0, 0]), i1 = this.vert(b, n, [1, 0]), i2 = this.vert(c, n, [0.5, 1]);
    this.i.push(i0, i1, i2);
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  merge(g, xf = p => p, nf = n => n) { const base = this.count; for (let k = 0; k < g.count; k++) { this.vert(xf(g.p.slice(k * 3, k * 3 + 3)), norm(nf(g.n.slice(k * 3, k * 3 + 3))), g.uv.slice(k * 2, k * 2 + 2)); } for (const ix of g.i) this.i.push(ix + base); return this; }
  tris() { return this.i.length / 3; }
}
// Ring/lathe around an axis frame (origin o, axis ax, perpendicular u,w). profile: [[radius, along]...]; smooth normals.
function lathe(o, ax, u, w, profile, seg, uvScale = 1) {
  const g = new Geo();
  const P = (r, h, t) => { const c = Math.cos(t), s = Math.sin(t); return [o[0] + ax[0] * h + (u[0] * c + w[0] * s) * r, o[1] + ax[1] * h + (u[1] * c + w[1] * s) * r, o[2] + ax[2] * h + (u[2] * c + w[2] * s) * r]; };
  for (let k = 0; k < profile.length; k++) for (let s = 0; s <= seg; s++) {
    const t = s / seg * Math.PI * 2, [r, h] = profile[k];
    const prev = profile[Math.max(0, k - 1)], next = profile[Math.min(profile.length - 1, k + 1)];
    const dr = next[0] - prev[0], dh = next[1] - prev[1];
    const c = Math.cos(t), sn = Math.sin(t), radial = [u[0] * c + w[0] * sn, u[1] * c + w[1] * sn, u[2] * c + w[2] * sn];
    const n = norm([radial[0] * dh - ax[0] * dr, radial[1] * dh - ax[1] * dr, radial[2] * dh - ax[2] * dr]);
    g.vert(P(r, h, t), n, [s / seg * uvScale, h * uvScale * 4]);
  }
  for (let k = 0; k < profile.length - 1; k++) for (let s = 0; s < seg; s++) {
    const a = k * (seg + 1) + s, b = a + 1, c = a + seg + 1, d = c + 1;
    g.i.push(a, c, b, b, c, d);
  }
  return g;
}
// Helical wire (tube) around a vertical shaft: centre cx,cz, radius R, from y0 to y1, turns, wire radius r.
function helix(cx, cz, R, y0, y1, turns, r, steps, sides, phase = 0, ellipseZ = 1) {
  const g = new Geo(), rows = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps, a = phase + t * turns * Math.PI * 2, y = y0 + (y1 - y0) * t;
    const c = [cx + Math.cos(a) * R, y, cz + Math.sin(a) * R * ellipseZ];
    const radial = norm([Math.cos(a), 0, Math.sin(a)]);
    const tangent = norm([-Math.sin(a) * R * turns * 2 * Math.PI, y1 - y0, Math.cos(a) * R * ellipseZ * turns * 2 * Math.PI]);
    const bin = norm(cross(tangent, radial));
    const row = [];
    for (let s = 0; s <= sides; s++) { const th = s / sides * Math.PI * 2; const n = [radial[0] * Math.cos(th) + bin[0] * Math.sin(th), radial[1] * Math.cos(th) + bin[1] * Math.sin(th), radial[2] * Math.cos(th) + bin[2] * Math.sin(th)]; row.push(g.vert([c[0] + n[0] * r, c[1] + n[1] * r, c[2] + n[2] * r], n, [s / sides, t])); }
    rows.push(row);
  }
  for (let k = 0; k < steps; k++) for (let s = 0; s < sides; s++) { const a = rows[k][s], b = rows[k][s + 1], c = rows[k + 1][s], d = rows[k + 1][s + 1]; g.i.push(a, b, c, b, d, c); }
  return g;
}
// Tube of radius r along centreline f(t), t in 0..1 (parallel-transport-free: uses radial-from-Y frame, fine for wraps).
function tube(f, r, steps, sides) {
  const g = new Geo(), rows = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps, c = f(t), c2 = f(Math.min(1, t + 1e-3)), c1 = f(Math.max(0, t - 1e-3));
    const tan = norm(sub(c2, c1));
    const side = norm(cross(tan, [0, 1, 0])), up = norm(cross(side, tan)), row = [];
    for (let s = 0; s <= sides; s++) { const th = s / sides * Math.PI * 2; const n = [side[0] * Math.cos(th) + up[0] * Math.sin(th), side[1] * Math.cos(th) + up[1] * Math.sin(th), side[2] * Math.cos(th) + up[2] * Math.sin(th)]; row.push(g.vert([c[0] + n[0] * r, c[1] + n[1] * r, c[2] + n[2] * r], n, [s / sides, t])); }
    rows.push(row);
  }
  for (let k = 0; k < steps; k++) for (let s = 0; s < sides; s++) { const a = rows[k][s], b = rows[k][s + 1], c = rows[k + 1][s], d = rows[k + 1][s + 1]; g.i.push(a, b, c, b, d, c); }
  return g;
}
// Faceted crystal: n-gon prism with pointed tip, base at b along dir, deterministic jitter.
function crystal(base, dir, radius, length, sides, rnd, tipFrac = 0.32) {
  const g = new Geo(); dir = norm(dir);
  const ref = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], u = norm(cross(dir, ref)), w = cross(dir, u);
  const at = (h, r, t) => [base[0] + dir[0] * h + (u[0] * Math.cos(t) + w[0] * Math.sin(t)) * r, base[1] + dir[1] * h + (u[1] * Math.cos(t) + w[1] * Math.sin(t)) * r, base[2] + dir[2] * h + (u[2] * Math.cos(t) + w[2] * Math.sin(t)) * r];
  const jit = Array.from({length: sides}, () => 0.85 + rnd() * 0.3);
  const shoulder = length * (1 - tipFrac), tip = at(length, 0, 0), bottom = at(-radius * 0.15, 0, 0);
  for (let s = 0; s < sides; s++) {
    const t0 = s / sides * Math.PI * 2, t1 = (s + 1) / sides * Math.PI * 2, r0 = radius * jit[s], r1 = radius * jit[(s + 1) % sides];
    const a = at(0, r0 * 0.92, t0), b = at(0, r1 * 0.92, t1), c = at(shoulder, r1, t1), d = at(shoulder, r0, t0);
    g.quad(a, b, c, d); g.tri(d, c, tip); g.tri(b, a, bottom);
  }
  return g;
}
// Extruded flat plate from a 2D outline in a plane: points [[a,b]], plane maps (a,b,depth) -> xyz.
function plate(outline, map, thick) {
  const g = new Geo(), n = outline.length;
  const top = outline.map(([a, b]) => map(a, b, thick / 2)), bot = outline.map(([a, b]) => map(a, b, -thick / 2));
  const cA = outline.reduce((s, q) => s + q[0], 0) / n, cB = outline.reduce((s, q) => s + q[1], 0) / n;
  const ct = map(cA, cB, thick / 2), cb = map(cA, cB, -thick / 2);
  for (let k = 0; k < n; k++) { const j = (k + 1) % n; g.tri(ct, top[k], top[j]); g.tri(cb, bot[j], bot[k]); g.quad(top[j], top[k], bot[k], bot[j]); }
  return g;
}
function fixWinding(g, centre) { // make each flat triangle face away from centre (robust for convex-ish pieces)
  for (let t = 0; t < g.i.length; t += 3) {
    const [a, b, c] = [g.i[t], g.i[t + 1], g.i[t + 2]].map(k => g.p.slice(k * 3, k * 3 + 3));
    const n = cross(sub(b, a), sub(c, a)), m = [(a[0] + b[0] + c[0]) / 3 - centre[0], (a[1] + b[1] + c[1]) / 3 - centre[1], (a[2] + b[2] + c[2]) / 3 - centre[2]];
    if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) { const tmp = g.i[t + 1]; g.i[t + 1] = g.i[t + 2]; g.i[t + 2] = tmp; for (const k of [g.i[t], g.i[t + 1], g.i[t + 2]]) for (let q = 0; q < 3; q++) g.n[k * 3 + q] *= -1; }
  }
  return g;
}
function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------- append meshes into glTF ----------
function appendMeshes(doc, parts, rootName) {
  const {json} = doc; let bin = doc.bin;
  const align = () => { const p = (4 - bin.length % 4) % 4; if (p) bin = Buffer.concat([bin, Buffer.alloc(p)]); };
  const view = (arr, Ctor, target) => { align(); const buf = Buffer.from(new Ctor(arr).buffer); const bv = {buffer: 0, byteOffset: bin.length, byteLength: buf.length, target}; bin = Buffer.concat([bin, buf]); json.bufferViews.push(bv); return json.bufferViews.length - 1; };
  const rootIdx = json.scenes[json.scene || 0].nodes.find(i => json.nodes[i].name === rootName);
  if (rootIdx == null) throw new Error('root ' + rootName + ' missing');
  const root = json.nodes[rootIdx]; root.children = root.children || [];
  const matIdx = name => { const i = json.materials.findIndex(m => m.name === name); if (i < 0) throw new Error('material ' + name); return i; };
  const report = [];
  for (const part of parts) {
    const g = part.geo, min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
    for (let k = 0; k < g.p.length; k++) { min[k % 3] = Math.min(min[k % 3], g.p[k]); max[k % 3] = Math.max(max[k % 3], g.p[k]); }
    const acc = (bv, count, type, ctype, extra = {}) => { json.accessors.push({bufferView: bv, componentType: ctype, count, type, ...extra}); return json.accessors.length - 1; };
    const POSITION = acc(view(g.p, Float32Array, 34962), g.count, 'VEC3', 5126, {min, max});
    const NORMAL = acc(view(g.n, Float32Array, 34962), g.count, 'VEC3', 5126);
    const TEXCOORD_0 = acc(view(g.uv, Float32Array, 34962), g.count, 'VEC2', 5126);
    const indices = acc(view(g.i, Uint32Array, 34963), g.i.length, 'SCALAR', 5125);
    json.meshes.push({name: part.name + '_Mesh', primitives: [{attributes: {POSITION, NORMAL, TEXCOORD_0}, indices, material: matIdx(part.material)}]});
    json.nodes.push({name: part.name, mesh: json.meshes.length - 1});
    root.children.push(json.nodes.length - 1);
    report.push({name: part.name, material: part.material, tris: g.tris(), min: min.map(v => +v.toFixed(4)), max: max.map(v => +v.toFixed(4))});
  }
  doc.bin = bin;
  return report;
}

// ---------- AXE: "Orchard's Edge" refinement ----------
// Identity kept: applewood haft, leather grip, engraved dark forged steel, brass/gold inlays. Added: gold wire binding
// above the grip, gold collar rings under the head, engraved darkmetal bearded spur rings, gold poll cap + studs,
// gold pommel finial (inside existing y-min), gold edge-bead rivets on blade cheeks.
function axeParts() {
  const parts = [], X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
  // Haft cross-section measured from Haft_Applewood_Mesh (2026-10-03): y -> [centre x, half x, half z].
  const HAFT = [[0.25, 0.0100, 0.0338, 0.0283], [0.29, 0.0098, 0.0330, 0.0276], [0.33, 0.0092, 0.0319, 0.0267], [0.41, 0.0068, 0.0304, 0.0254], [0.47, 0.0044, 0.0309, 0.0258]];
  const haftAt = y => { let k = 0; while (k < HAFT.length - 2 && y > HAFT[k + 1][0]) k++; const a = HAFT[k], b = HAFT[k + 1], t = Math.min(1, Math.max(0, (y - a[0]) / (b[0] - a[0]))); return [1, 2, 3].map(q => a[q] + (b[q] - a[q]) * t); };
  // Gold wire binding hugging the haft between grip ferrule (0.248) and throat band (0.478); vertices re-seated per height.
  const wire = new Geo();
  const onHaft = (y0, y1, turns, phase) => tube(t => { const y = y0 + (y1 - y0) * t, [cx, rx, rz] = haftAt(y), a = phase + t * turns * Math.PI * 2; return [cx + Math.cos(a) * (rx + 0.0009), y, Math.sin(a) * (rz + 0.0009)]; }, 0.0019, turns * 28, 5);
  wire.merge(onHaft(0.262, 0.322, 4, 0)); wire.merge(onHaft(0.414, 0.466, 3.5, Math.PI));
  parts.push({name: 'Embellish_Gold_HaftWire', material: 'OE_Brass_Inlay', geo: wire});
  // Darkmetal collar rings framing the wire bands (stepped engraved profile), seated on the measured ellipse.
  const collars = new Geo();
  for (const y of [0.256, 0.328, 0.408, 0.472]) { const [cx, rx, rz] = haftAt(y); collars.merge(lathe([0, y, 0], Y, X, Z, [[0.999, -0.0045], [1.06, -0.0032], [1.085, 0], [1.06, 0.0032], [0.999, 0.0045]].map(([r, h]) => [r, h]), 24), p => [cx + p[0] * rx, p[1], p[2] * rz]); }
  parts.push({name: 'Embellish_Darkmetal_Collars', material: 'OE_Steel_ForgedDark', geo: collars});
  // Gold poll cap: thin bevelled plate on the poll face (poll face x=-0.089, y 0.65..0.75) + four studs
  const cap = new Geo();
  const poll = [[-0.044, -0.024], [0.044, -0.024], [0.05, 0], [0.044, 0.024], [-0.044, 0.024], [-0.05, 0]].map(([a, b]) => [a * 0.9, b]);
  cap.merge(plate(poll, (a, b, d) => [-0.0905 + d, 0.700 + a, b], 0.004));
  const rnd = mulberry(7);
  for (const [a, b] of [[-0.03, -0.014], [0.03, -0.014], [-0.03, 0.014], [0.03, 0.014]]) cap.merge(lathe([-0.0925, 0.700 + a, b], [-1, 0, 0], Y, Z, [[0.0045, 0], [0.004, 0.0015], [0.0022, 0.0028], [0.0001, 0.0032]], 8));
  fixWinding(cap, [-0.07, 0.70, 0]);
  parts.push({name: 'Embellish_Gold_PollCap', material: 'OE_Brass_Inlay', geo: cap});
  // Engraved darkmetal cheek ridge plates on the socket (both faces) with gold rivet heads along blade throat
  // Blade half-thickness measured from Head_Blade_Mesh: x -> z.
  const BLADE = [[0.06, 0.0232], [0.1, 0.0189], [0.2, 0.0099], [0.235, 0.0077], [0.3, 0.0049]];
  const bladeZ = x => { let k = 0; while (k < BLADE.length - 2 && x > BLADE[k + 1][0]) k++; const a = BLADE[k], b = BLADE[k + 1]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); };
  const studs = new Geo();
  for (const s of [-1, 1]) for (const [x, y] of [[0.075, 0.665], [0.075, 0.718], [0.215, 0.735], [0.215, 0.615], [0.29, 0.675]]) {
    const zz = bladeZ(x) - 0.0008; // seated into the cheek surface
    studs.merge(lathe([x, y, s * zz], [0, 0, s], X, Y, [[0.0052, 0], [0.0046, 0.0016], [0.0026, 0.003], [0.0001, 0.0035]], 10));
  }
  parts.push({name: 'Embellish_Gold_CheekStuds', material: 'OE_Brass_Inlay', geo: studs});
  // Pommel finial: stepped gold knob kept above existing y-min (-0.065) so normalisation is unchanged.
  const fin = lathe([0.0025, -0.014, 0], [0, -1, 0], X, Z, [[0.039, 0], [0.042, 0.006], [0.036, 0.014], [0.028, 0.022], [0.033, 0.03], [0.026, 0.040], [0.012, 0.046], [0.0001, 0.048]], 24);
  parts.push({name: 'Embellish_Gold_PommelFinial', material: 'OE_Brass_Inlay', geo: fin});
  return parts;
}

// ---------- PICK: "Stonewhisper" refinement ----------
// Identity kept: ash wood shaft, leather wrap, blued darkmetal head, brass trim, glowing blue resonance crystals.
// Added: faceted crystal crown cluster in the head socket, crystal shards seated along both arms, engraved darkmetal
// spine ridges + langets, gold arm bands and filigree rings, gold pommel with crystal, more crystal sockets near tips.
function pickParts() {
  const parts = [], X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1], rnd = mulberry(1337);
  const crystals = new Geo();
  // Crown cluster rising from the socket top (socket max y 0.718; root bounds max 0.718 -> keep tips <= 0.716).
  const crown = [[0, 0.668, 0, [0, 1, 0], 0.016, 0.046], [0.016, 0.668, 0.012, [0.35, 1, 0.25], 0.010, 0.036], [-0.016, 0.668, -0.010, [-0.4, 1, -0.2], 0.010, 0.034], [0.006, 0.668, -0.018, [0.1, 1, -0.5], 0.008, 0.028], [-0.010, 0.668, 0.017, [-0.2, 1, 0.5], 0.008, 0.028]];
  for (const [x, y, z, d, r, l] of crown) crystals.merge(crystal([x, y, z], d, r, l, 6, rnd));
  // Shards seated along each arm top edge, leaning outward like resonance fins.
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
    const x = s * (0.085 + k * 0.05), y = 0.655 - k * 0.022, len = 0.034 - k * 0.007;
    crystals.merge(crystal([x, y, 0.0], [s * 0.55, 1, (k - 1) * 0.15], 0.0085 - k * 0.0012, len, 5, rnd));
  }
  // Inset crystal studs on both faces of the head arms.
  for (const s of [-1, 1]) for (const z of [-1, 1]) crystals.merge(crystal([s * 0.205, 0.595, z * 0.03], [s * 0.15, 0, z], 0.007, 0.012, 6, rnd, 0.5));
  parts.push({name: 'Embellish_Crystal_Crown', material: 'Resonance_Crystal', geo: crystals});
  // Gold bands wrapping each arm near the socket and mid-arm (elliptical rings around the arm cross-section).
  const gold = new Geo();
  for (const s of [-1, 1]) for (const [x, cy, ry, rz] of [[0.05, 0.619, 0.037, 0.0255], [0.155, 0.601, 0.0238, 0.0183], [0.235, 0.578, 0.0165, 0.0135]]) {
    gold.merge(lathe([s * x, cy, 0], [s, 0, 0], Y, Z, [[1.0, -0.005], [1.07, -0.0035], [1.1, 0], [1.07, 0.0035], [1.0, 0.005]], 18), p => { const dy = p[1] - cy, dz = p[2]; const r = Math.hypot(dy, dz) || 1; const a = Math.atan2(dz, dy); return [p[0], cy + Math.cos(a) * r * ry, Math.sin(a) * r * rz]; });
  }
  // Gold collar rings + pommel cap on shaft.
  for (const [y, rx, rz] of [[0.093, 0.0255, 0.0225], [0.347, 0.0255, 0.0225], [0.522, 0.0236, 0.0206]]) gold.merge(lathe([0, y, 0], Y, X, Z, [[1.0, -0.0045], [1.1, -0.003], [1.14, 0], [1.1, 0.003], [1.0, 0.0045]], 20), p => [p[0] * rx, p[1], p[2] * rz]);
  // (no extra pommel cap: it z-fought the authored brass pommel in the 2026-10-03 review render)
  // Gold filigree wire spiralling up the shaft between grip and head.
  gold.merge(helix(0, 0, 0.0246, 0.36, 0.515, 3, 0.0016, 90, 5, 0, 0.865));
  parts.push({name: 'Embellish_Gold_Bands', material: 'Brass_Trim', geo: gold});
  // Engraved darkmetal: spine ridge along both arms' top, and langets down the shaft front/back.
  const dark = new Geo();
  for (const s of [-1, 1]) {
    const outline = [[0.03, 0.668], [0.12, 0.655], [0.22, 0.625], [0.30, 0.552], [0.22, 0.612], [0.12, 0.642], [0.03, 0.652]];
    dark.merge(fixWinding(plate(outline.map(([a, b]) => [s * a, b]), (a, b, d) => [a, b, d], 0.022), [s * 0.15, 0.6, 0]));
  }
  for (const z of [-1, 1]) {
    const outline = [[-0.009, 0.545], [0.009, 0.545], [0.006, 0.40], [0, 0.375], [-0.006, 0.40]];
    dark.merge(fixWinding(plate(outline, (a, b, d) => [a, b, z * (0.0215 + d)], 0.003), [0, 0.46, 0]));
  }
  parts.push({name: 'Embellish_Darkmetal_Spine', material: 'Steel_Blued', geo: dark});
  return parts;
}

function build(name, rootName, partsFn) {
  const doc = readGlb(path.join(REF, name + '.glb'));
  const before = bounds(doc.json, rootName);
  const report = appendMeshes(doc, partsFn(), rootName);
  const after = bounds(doc.json, rootName);
  for (let k = 0; k < 3; k++) if (k === 1 && (after.min[1] < before.min[1] - 1e-6 || after.max[1] > before.max[1] + 1e-6)) throw new Error(name + ': Y bounds changed; normalisation would shift');
  doc.json.asset.generator = (doc.json.asset.generator || '') + ' + opus build-weapons.cjs 2026-10-03';
  fs.mkdirSync(OUT, {recursive: true});
  writeGlb(path.join(OUT, name + '.glb'), doc.json, doc.bin);
  const tris = doc.json.meshes.reduce((s, m) => s + m.primitives.reduce((t, p) => t + doc.json.accessors[p.indices].count / 3, 0), 0);
  return {asset: name, totalTris: tris, addedTris: report.reduce((s, r) => s + r.tris, 0), materials: doc.json.materials.length, images: (doc.json.images || []).length, boundsBefore: before, boundsAfter: after, parts: report};
}
// Bounds over mesh nodes using node translations only (all source mesh nodes have no rotation/scale except identity).
function bounds(json, rootName) {
  const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
  for (const n of json.nodes) if (n.mesh != null) { const t = n.translation || [0, 0, 0], s = n.scale || [1, 1, 1]; for (const p of json.meshes[n.mesh].primitives) { const a = json.accessors[p.attributes.POSITION]; for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], a.min[k] * s[k] + t[k]); max[k] = Math.max(max[k], a.max[k] * s[k] + t[k]); } } }
  return {min: min.map(v => +v.toFixed(4)), max: max.map(v => +v.toFixed(4))};
}

const result = [build('axe', 'OrchardsEdge', axeParts), build('pick', 'StonewhisperPick', pickParts)];
fs.writeFileSync(path.join(OUT, 'build-report.json'), JSON.stringify(result, null, 1));
for (const r of result) console.log(`${r.asset}: ${r.totalTris} tris (+${r.addedTris}), materials ${r.materials}, images ${r.images}, Y ${r.boundsAfter.min[1]}..${r.boundsAfter.max[1]}`);
