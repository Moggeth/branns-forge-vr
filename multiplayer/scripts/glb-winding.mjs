// Backwards faces in shipped GLBs. A triangle whose winding points the opposite way to all three of its authored vertex
// normals is lit as if it faced out but culled as if it faced in: with single-sided materials (the keep, town and
// back-town kits force FrontSide at load) it is simply invisible from outside, and on double-sided ones it shades dark.
// `node scripts/glb-winding.mjs` lists them; `--fix` swaps two indices of each such triangle in place (same bytes, same
// sizes, deterministic) so the face turns the way its normals already say. tests/asset-geometry.mjs keeps them at zero.
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const DIR = fileURLToPath(new URL('../public/assets/', import.meta.url));
const SIZE = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4};
// Faces another thread owns this week stay untouched here (the axe rework and the new enemies).
export const WINDING_SKIP = new Set(['axe.glb', 'skeleton.glb']);

function parse(buf) {
  const jsonLen = buf.readUInt32LE(12), json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binOffset = 20 + jsonLen + 8;
  return {json, binOffset};
}
function view(buf, json, binOffset, index) {
  const a = json.accessors[index], v = json.bufferViews[a.bufferView], n = SIZE[a.type];
  const base = binOffset + (v.byteOffset || 0) + (a.byteOffset || 0);
  const bytes = {5126: 4, 5125: 4, 5123: 2, 5122: 2, 5121: 1, 5120: 1}[a.componentType], stride = v.byteStride || n * bytes;
  const read = {5126: o => buf.readFloatLE(o), 5125: o => buf.readUInt32LE(o), 5123: o => buf.readUInt16LE(o), 5121: o => buf.readUInt8(o), 5122: o => buf.readInt16LE(o), 5120: o => buf.readInt8(o)}[a.componentType];
  if (!read) throw Error(`accessor ${index}: component type ${a.componentType} unsupported`);
  const write = {5125: (o, x) => buf.writeUInt32LE(x, o), 5123: (o, x) => buf.writeUInt16LE(x, o), 5121: (o, x) => buf.writeUInt8(x, o)}[a.componentType];
  return {count: a.count, get: (k, c = 0) => read(base + k * stride + c * bytes), set: (k, x) => write(base + k * stride, x)};
}
/** Every backwards triangle in one GLB buffer: [{mesh, primitive, material, tri}]. With fix, turns them in the buffer. */
export function windingFaults(buf, {fix = false} = {}) {
  const {json, binOffset} = parse(buf), faults = [], done = new Set();
  json.meshes?.forEach((mesh, mi) => mesh.primitives.forEach((p, pi) => {
    if (p.indices === undefined || p.attributes.NORMAL === undefined || (p.mode ?? 4) !== 4) return;
    const key = `${p.indices}:${p.attributes.POSITION}:${p.attributes.NORMAL}`; if (done.has(key)) return; done.add(key);
    const P = view(buf, json, binOffset, p.attributes.POSITION), N = view(buf, json, binOffset, p.attributes.NORMAL), I = view(buf, json, binOffset, p.indices);
    for (let t = 0; t + 2 < I.count; t += 3) {
      const ids = [I.get(t), I.get(t + 1), I.get(t + 2)], v = ids.map(i => [P.get(i, 0), P.get(i, 1), P.get(i, 2)]);
      const e1 = [0, 1, 2].map(c => v[1][c] - v[0][c]), e2 = [0, 1, 2].map(c => v[2][c] - v[0][c]);
      const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], len = Math.hypot(...f);
      if (len < 1e-10) continue;
      // Backwards only when every corner's normal disagrees clearly; mixed corners are creases, not mistakes.
      if (!ids.every(i => (N.get(i, 0) * f[0] + N.get(i, 1) * f[1] + N.get(i, 2) * f[2]) / len < -.2)) continue;
      faults.push({mesh: mesh.name || `mesh${mi}`, primitive: pi, material: json.materials?.[p.material]?.name || '', tri: t / 3});
      if (fix) { I.set(t + 1, ids[2]); I.set(t + 2, ids[1]); }
    }
  }));
  return faults;
}
export const shippedGlbs = () => readdirSync(DIR).filter(f => f.endsWith('.glb')).sort();
export const glbPath = f => DIR + f;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fix = process.argv.includes('--fix');
  for (const f of shippedGlbs()) {
    if (WINDING_SKIP.has(f)) continue;
    const buf = readFileSync(DIR + f), faults = windingFaults(buf, {fix});
    if (!faults.length) continue;
    const by = {}; for (const x of faults) by[`${x.mesh}/${x.material}`] = (by[`${x.mesh}/${x.material}`] || 0) + 1;
    console.log(`${f}: ${faults.length} backwards ${JSON.stringify(by)}`);
    if (fix) writeFileSync(DIR + f, buf);
  }
}
