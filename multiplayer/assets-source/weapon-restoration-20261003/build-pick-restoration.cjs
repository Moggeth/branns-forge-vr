#!/usr/bin/env node
// Deterministic Stonewhisper pick restoration (Opus 2026-10-03, restoration pass).
// Input: the current embellished pick.glb (reference/assets/pick.glb). Output: output/assets/pick.glb + reports.
// Change set (and ONLY this):
//   - REMOVE node "Embellish_Darkmetal_Spine" (+ its mesh/accessors/bufferViews, which are the GLB tail). Its two
//     22 mm-thick Steel_Blued arm-top plates (x 0.03..0.30, y up to 0.668) read as a second blade / metal ridge across
//     the top of the head - the user's explicit dislike.
//   - RE-EMIT the shaft langets from that same node, geometry byte-for-byte as authored, as "Embellish_Darkmetal_Langets"
//     (they sit on the shaft below the head, not across the top).
//   - ADD "Embellish_Gold_ShardSettings": Brass_Trim bezel collars seating the six existing arm-top resonance shards
//     into the head. Without the ridge the innermost pair (base y 0.655) would float ~4 mm over the head top (0.651).
// Untouched: every other node/transform (Grip, HitCentre, ChargeGlow, PickTipLeft/Right sockets), all 5 materials,
// all embedded images/textures/samplers, every other mesh. Y bounds (-0.045..0.718) and X bounds (+-0.32) asserted.
// Usage: node output/build-pick-restoration.cjs [inPick.glb] [outDir]
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const IN = path.resolve(process.argv[2] || path.join(ROOT, 'reference/assets/pick.glb'));
const OUT = path.resolve(process.argv[3] || path.join(__dirname, 'assets'));

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

// ---------- mesh kit (same conventions as reference/build-weapons.cjs) ----------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
class Geo {
  constructor() { this.p = []; this.n = []; this.uv = []; this.i = []; }
  get count() { return this.p.length / 3; }
  vert(p, n, uv = [0, 0]) { this.p.push(...p); this.n.push(...n); this.uv.push(...uv); return this.count - 1; }
  tri(a, b, c) { const n = norm(cross(sub(b, a), sub(c, a))); const i0 = this.vert(a, n, [0, 0]), i1 = this.vert(b, n, [1, 0]), i2 = this.vert(c, n, [0.5, 1]); this.i.push(i0, i1, i2); }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  merge(g) { const base = this.count; for (let k = 0; k < g.count; k++) this.vert(g.p.slice(k * 3, k * 3 + 3), norm(g.n.slice(k * 3, k * 3 + 3)), g.uv.slice(k * 2, k * 2 + 2)); for (const ix of g.i) this.i.push(ix + base); return this; }
  tris() { return this.i.length / 3; }
}
function lathe(o, ax, u, w, profile, seg) {
  const g = new Geo();
  for (let k = 0; k < profile.length; k++) for (let s = 0; s <= seg; s++) {
    const t = s / seg * Math.PI * 2, [r, h] = profile[k];
    const prev = profile[Math.max(0, k - 1)], next = profile[Math.min(profile.length - 1, k + 1)];
    const dr = next[0] - prev[0], dh = next[1] - prev[1], c = Math.cos(t), sn = Math.sin(t);
    const radial = [u[0] * c + w[0] * sn, u[1] * c + w[1] * sn, u[2] * c + w[2] * sn];
    g.vert([o[0] + ax[0] * h + radial[0] * r, o[1] + ax[1] * h + radial[1] * r, o[2] + ax[2] * h + radial[2] * r],
      norm([radial[0] * dh - ax[0] * dr, radial[1] * dh - ax[1] * dr, radial[2] * dh - ax[2] * dr]), [s / seg, h * 4]);
  }
  for (let k = 0; k < profile.length - 1; k++) for (let s = 0; s < seg; s++) { const a = k * (seg + 1) + s, b = a + 1, c = a + seg + 1, d = c + 1; g.i.push(a, c, b, b, c, d); }
  return g;
}
function plate(outline, map, thick) {
  const g = new Geo(), n = outline.length;
  const top = outline.map(([a, b]) => map(a, b, thick / 2)), bot = outline.map(([a, b]) => map(a, b, -thick / 2));
  const cA = outline.reduce((s, q) => s + q[0], 0) / n, cB = outline.reduce((s, q) => s + q[1], 0) / n;
  const ct = map(cA, cB, thick / 2), cb = map(cA, cB, -thick / 2);
  for (let k = 0; k < n; k++) { const j = (k + 1) % n; g.tri(ct, top[k], top[j]); g.tri(cb, bot[j], bot[k]); g.quad(top[j], top[k], bot[k], bot[j]); }
  return g;
}
function fixWinding(g, centre) {
  for (let t = 0; t < g.i.length; t += 3) {
    const [a, b, c] = [g.i[t], g.i[t + 1], g.i[t + 2]].map(k => g.p.slice(k * 3, k * 3 + 3));
    const n = cross(sub(b, a), sub(c, a)), m = [(a[0] + b[0] + c[0]) / 3 - centre[0], (a[1] + b[1] + c[1]) / 3 - centre[1], (a[2] + b[2] + c[2]) / 3 - centre[2]];
    if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) { const tmp = g.i[t + 1]; g.i[t + 1] = g.i[t + 2]; g.i[t + 2] = tmp; for (const k of [g.i[t], g.i[t + 1], g.i[t + 2]]) for (let q = 0; q < 3; q++) g.n[k * 3 + q] *= -1; }
  }
  return g;
}

// ---------- authored parts ----------
// Langets: identical code/values to reference/build-weapons.cjs pickParts() lines 236-239.
function langets() {
  const dark = new Geo();
  for (const z of [-1, 1]) {
    const outline = [[-0.009, 0.545], [0.009, 0.545], [0.006, 0.40], [0, 0.375], [-0.006, 0.40]];
    dark.merge(fixWinding(plate(outline, (a, b, d) => [a, b, z * (0.0215 + d)], 0.003), [0, 0.46, 0]));
  }
  return dark;
}
// Shard settings: bezel collars around each arm-top shard base (shard base/dir/radius copied from the reference
// builder: x = s*(0.085+k*0.05), y = 0.655-k*0.022, dir (s*0.55, 1, (k-1)*0.15), r = 0.0085-k*0.0012).
// Profile runs 11 mm down the shard axis into the head (head top measured: x.08 -> 0.651, x.14 -> 0.632,
// x.18 -> 0.616) and wraps the gem's lower facets so the crystal reads as set in gold, not a fin.
function shardSettings() {
  const g = new Geo();
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
    const base = [s * (0.085 + k * 0.05), 0.655 - k * 0.022, 0], dir = norm([s * 0.55, 1, (k - 1) * 0.15]), r = 0.0085 - k * 0.0012;
    const u = norm(cross(dir, [0, 0, 1])), w = cross(dir, u);
    const prof = [[r * 1.05, -0.011], [r * 1.38, -0.006], [r * 1.42, -0.001], [r * 1.30, 0.0035], [r * 1.06, 0.0055], [r * 0.96, 0.0045]];
    g.merge(lathe(base, dir, u, w, prof, 12));
  }
  return g;
}

// ---------- glTF surgery ----------
function removeTailNode(json, bin, nodeName) {
  const ni = json.nodes.findIndex(n => n.name === nodeName);
  if (ni !== json.nodes.length - 1) throw new Error(nodeName + ' is not the last node; refusing index remap');
  const mi = json.nodes[ni].mesh;
  if (mi !== json.meshes.length - 1) throw new Error(nodeName + ' mesh is not the last mesh');
  if (json.nodes.some((n, k) => k !== ni && n.mesh === mi)) throw new Error('mesh shared');
  const accs = new Set(); for (const p of json.meshes[mi].primitives) { Object.values(p.attributes).forEach(a => accs.add(a)); if (p.indices != null) accs.add(p.indices); }
  const minAcc = Math.min(...accs);
  if (minAcc + accs.size !== json.accessors.length) throw new Error('accessors are not the tail');
  const bvs = [...accs].map(a => json.accessors[a].bufferView), minBv = Math.min(...bvs);
  if (minBv + bvs.length !== json.bufferViews.length) throw new Error('bufferViews are not the tail');
  const usedElsewhere = json.accessors.slice(0, minAcc).some(a => a.bufferView >= minBv) || (json.images || []).some(im => im.bufferView >= minBv);
  if (usedElsewhere) throw new Error('tail bufferViews referenced elsewhere');
  const cut = json.bufferViews[minBv].byteOffset;
  const removed = {node: nodeName, mesh: json.meshes[mi].name, tris: json.accessors[json.meshes[mi].primitives[0].indices].count / 3,
    min: json.accessors[json.meshes[mi].primitives[0].attributes.POSITION].min, max: json.accessors[json.meshes[mi].primitives[0].attributes.POSITION].max};
  for (const n of json.nodes) if (n.children) n.children = n.children.filter(c => c !== ni);
  json.nodes.length = ni; json.meshes.length = mi; json.accessors.length = minAcc; json.bufferViews.length = minBv;
  return {bin: bin.subarray(0, cut), removed};
}
function appendMeshes(json, bin, parts, rootName) {
  const align = () => { const p = (4 - bin.length % 4) % 4; if (p) bin = Buffer.concat([bin, Buffer.alloc(p)]); };
  const view = (arr, Ctor, target) => { align(); const buf = Buffer.from(new Ctor(arr).buffer); json.bufferViews.push({buffer: 0, byteOffset: bin.length, byteLength: buf.length, target}); bin = Buffer.concat([bin, buf]); return json.bufferViews.length - 1; };
  const root = json.nodes.find(n => n.name === rootName);
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
  return {bin, report};
}

// ---------- reports ----------
function summary(json) {
  const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9], perMat = {};
  for (const n of json.nodes) if (n.mesh != null) for (const p of json.meshes[n.mesh].primitives) {
    const a = json.accessors[p.attributes.POSITION], t = n.translation || [0, 0, 0];
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], a.min[k] + t[k]); max[k] = Math.max(max[k], a.max[k] + t[k]); }
    const m = json.materials[p.material].name; perMat[m] = (perMat[m] || 0) + json.accessors[p.indices].count / 3;
  }
  const sockets = json.nodes.filter(n => n.mesh == null).map(n => ({name: n.name, translation: n.translation || null, rotation: n.rotation || null, scale: n.scale || null}));
  return {bounds: {min: min.map(v => +v.toFixed(4)), max: max.map(v => +v.toFixed(4))}, totalTris: Object.values(perMat).reduce((a, b) => a + b, 0),
    drawPrimitives: json.nodes.filter(n => n.mesh != null).reduce((s, n) => s + json.meshes[n.mesh].primitives.length, 0),
    trisPerMaterial: perMat, materials: json.materials.map(m => m.name), images: (json.images || []).map(i => i.uri || ('embedded:' + i.mimeType)), sockets,
    nodes: json.nodes.map(n => n.name)};
}

const doc = readGlb(IN);
const beforeJson = JSON.parse(JSON.stringify(doc.json));
const before = summary(beforeJson);
const {bin: trimmed, removed} = removeTailNode(doc.json, doc.bin, 'Embellish_Darkmetal_Spine');
const {bin, report} = appendMeshes(doc.json, trimmed, [
  {name: 'Embellish_Darkmetal_Langets', material: 'Steel_Blued', geo: langets()},
  {name: 'Embellish_Gold_ShardSettings', material: 'Brass_Trim', geo: shardSettings()},
], 'StonewhisperPick');
const after = summary(doc.json);

// ---------- contract assertions ----------
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
if (!eq(before.bounds, after.bounds)) throw new Error('bounds changed ' + JSON.stringify([before.bounds, after.bounds]));
if (!eq(before.sockets, after.sockets)) throw new Error('socket/empty node changed');
if (!eq(beforeJson.materials, doc.json.materials) || !eq(beforeJson.images, doc.json.images) || !eq(beforeJson.textures, doc.json.textures) || !eq(beforeJson.samplers, doc.json.samplers)) throw new Error('material/texture changed');
for (let k = 0; k < beforeJson.nodes.length - 1; k++) { const a = beforeJson.nodes[k], b = doc.json.nodes[k]; if (a.name === 'StonewhisperPick') continue; if (!eq(a, b)) throw new Error('node changed ' + a.name); }
for (const im of beforeJson.images || []) { const bv = beforeJson.bufferViews[im.bufferView]; if (Buffer.compare(doc.bin.subarray(bv.byteOffset, bv.byteOffset + bv.byteLength), bin.subarray(bv.byteOffset, bv.byteOffset + bv.byteLength))) throw new Error('image bytes changed'); }
if (Buffer.compare(doc.bin.subarray(0, trimmed.length), bin.subarray(0, trimmed.length))) throw new Error('retained binary prefix changed');

doc.json.asset.generator = (doc.json.asset.generator || '') + ' + opus build-pick-restoration.cjs 2026-10-03';
fs.mkdirSync(OUT, {recursive: true});
writeGlb(path.join(OUT, 'pick.glb'), doc.json, bin);
const out = {asset: 'pick', input: path.relative(ROOT, IN), removed, added: report, before, after,
  delta: {tris: after.totalTris - before.totalTris, drawPrimitives: after.drawPrimitives - before.drawPrimitives}};
fs.writeFileSync(path.join(OUT, 'pick-report.json'), JSON.stringify(out, null, 1));
console.log(`pick: tris ${before.totalTris} -> ${after.totalTris}, draws ${before.drawPrimitives} -> ${after.drawPrimitives}, bounds ${JSON.stringify(after.bounds)}; removed ${removed.node} (${removed.tris} tris); added ${report.map(r => r.name + ' ' + r.tris).join(', ')}`);
