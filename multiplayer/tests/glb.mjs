// Minimal Node GLB reader for tests: real node hierarchy, TRS, meshes/primitives/attributes. Materials are named
// placeholders (no textures decoded) so geometry checks run without a browser. Not used at runtime.
import {readFileSync} from 'node:fs';
import * as T from 'three';
const SIZE = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4}, TYPES = {5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array}, NORM = {5121: 255, 5123: 65535, 5120: 127, 5122: 32767};
export function loadGLB(path) {
 const buf = readFileSync(path), jsonLen = buf.readUInt32LE(12), json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')), binStart = 20 + jsonLen + 8, bin = buf.subarray(binStart);
 const accessor = (i, normalize) => { const a = json.accessors[i], v = json.bufferViews[a.bufferView], C = TYPES[a.componentType], n = SIZE[a.type], stride = v.byteStride || n*C.BYTES_PER_ELEMENT, out = new Float32Array(a.count*n);
  const dv = new DataView(bin.buffer, bin.byteOffset + (v.byteOffset || 0) + (a.byteOffset || 0));
  const get = {5126: o => dv.getFloat32(o, true), 5125: o => dv.getUint32(o, true), 5123: o => dv.getUint16(o, true), 5121: o => dv.getUint8(o), 5122: o => dv.getInt16(o, true), 5120: o => dv.getInt8(o)}[a.componentType];
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) { let x = get(k*stride + c*C.BYTES_PER_ELEMENT); if (normalize && NORM[a.componentType]) x /= NORM[a.componentType]; out[k*n + c] = x; }
  return {array: out, size: n, count: a.count}; };
 const mats = (json.materials || []).map(m => { const mat = new T.MeshStandardMaterial({name: m.name}); return mat; });
 const meshCache = new Map();
 const buildMesh = i => { const def = json.meshes[i], objs = def.primitives.map(p => { const g = new T.BufferGeometry();
   for (const [name, key, norm] of [['position', 'POSITION'], ['normal', 'NORMAL'], ['uv', 'TEXCOORD_0'], ['color', 'COLOR_0', true]]) if (p.attributes[key] !== undefined) { const a = accessor(p.attributes[key], norm); g.setAttribute(name, new T.BufferAttribute(a.array, a.size)); }
   if (p.indices !== undefined) { const a = accessor(p.indices); g.setIndex(new T.BufferAttribute(Uint32Array.from(a.array), 1)); }
   const m = mats[p.material] || new T.MeshStandardMaterial(); if (g.attributes.color) m.vertexColors = true; return new T.Mesh(g, m); });
  return objs; };
 const node = i => { const d = json.nodes[i]; let o;
  const prims = d.mesh !== undefined ? buildMesh(d.mesh) : [];
  if (prims.length === 1) o = prims[0]; else { o = new T.Group(); for (const p of prims) o.add(p); }
  o.name = d.name || ''; if (d.matrix) new T.Matrix4().fromArray(d.matrix).decompose(o.position, o.quaternion, o.scale);
  if (d.translation) o.position.fromArray(d.translation); if (d.rotation) o.quaternion.fromArray(d.rotation); if (d.scale) o.scale.fromArray(d.scale);
  for (const c of d.children || []) o.add(node(c)); return o; };
 const scene = new T.Group(); for (const n of json.scenes[json.scene || 0].nodes) scene.add(node(n)); scene.updateMatrixWorld(true);
 return {scene, json};
}
