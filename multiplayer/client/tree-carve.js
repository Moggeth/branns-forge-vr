// Real trunk carving for the authored 12-ring Trunk mesh: triangle splitting across cut planes (Sutherland-Hodgman
// per triangle, attributes interpolated), plus planar end-grain faces built from the exact clipped section vertices.
// All work is in authored Tree-root space (Y up, axis at x=z=0). Bark UV/normals/colour are preserved on surviving triangles.
import * as T from 'three';

const EPS = 1e-6;
/** Bake a mesh's geometry into Tree-root space as plain arrays {p,n,uv,c} per vertex, triangle list. */
export function bakeTriangles(mesh, root) {
 const g = mesh.geometry, pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv, col = g.attributes.color, idx = g.index;
 root.updateMatrixWorld(true); const m = new T.Matrix4().copy(root.matrixWorld).invert().multiply(mesh.matrixWorld), nm = new T.Matrix3().getNormalMatrix(m);
 const v = new T.Vector3(), out = [], count = idx ? idx.count : pos.count;
 for (let i = 0; i < count; i++) { const k = idx ? idx.getX(i) : i;
  const p = v.fromBufferAttribute(pos, k).applyMatrix4(m).toArray(); const n = nor ? v.fromBufferAttribute(nor, k).applyMatrix3(nm).normalize().toArray() : [0, 1, 0];
  out.push({p, n, uv: uv ? [uv.getX(k), uv.getY(k)] : [0, 0], c: col ? [col.getX(k), col.getY(k), col.getZ(k), col.itemSize > 3 ? col.getW(k) : 1] : null}); }
 const tris = []; for (let i = 0; i < out.length; i += 3) tris.push([out[i], out[i+1], out[i+2]]); return tris;
}
const lerp = (a, b, t) => a.map((x, i) => x + (b[i]-x)*t);
function mix(a, b, t) { const n = lerp(a.n, b.n, t), l = Math.hypot(...n) || 1; return {p: lerp(a.p, b.p, t), n: n.map(x => x/l), uv: lerp(a.uv, b.uv, t), c: a.c && b.c ? lerp(a.c, b.c, t) : a.c}; }
/** Keep the part of a convex polygon where f(p) >= 0. */
export function clipPolygon(poly, f) {
 const out = []; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i+1) % poly.length], fa = f(a.p), fb = f(b.p);
  if (fa >= 0) out.push(a); if ((fa >= 0) !== (fb >= 0)) { const t = fa/(fa-fb); const m = mix(a, b, t); m.onPlane = f; out.push(m); } }
 return out.length >= 3 ? out : [];
}
const fan = (poly, tris) => { for (let i = 1; i + 1 < poly.length; i++) tris.push([poly[0], poly[i], poly[i+1]]); };
const area2 = t => { const a = t[0].p, b = t[1].p, c = t[2].p, u = [b[0]-a[0], b[1]-a[1], b[2]-a[2]], v = [c[0]-a[0], c[1]-a[1], c[2]-a[2]]; return Math.hypot(u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]); };
/** Clip a triangle list by a chain of keep-functions (intersection). Degenerate slivers are dropped. */
export function clipTriangles(tris, ...fs) { const out = []; for (const t of tris) { let poly = t; for (const f of fs) { poly = clipPolygon(poly, f); if (!poly.length) break; } if (poly.length) fan(poly, out); } return out.filter(t => area2(t) > 1e-10); }

/** Notch planes in authored space. n: outward unit normal (x,z); h: hinge height; s0: hinge distance from axis. */
export function notchPlanes(notch) {
 const [nx, , nz] = notch.normal, s = p => p[0]*nx + p[2]*nz;
 return {s, fL: p => (notch.height - notch.lower*(s(p) - notch.hinge)) - p[1], fU: p => p[1] - (notch.height + notch.upper*(s(p) - notch.hinge)), fS: p => s(p) - notch.hinge};
}
/** Remove the wedge between lower plane L and upper plane U from bark triangles. Returns surviving bark triangles. */
export function carveWedge(tris, notch) {
 const {fL, fU, fS} = notchPlanes(notch), not = f => p => -f(p) - EPS;
 // A: below L (split at the hinge so the hinge corner is an explicit vertex); B: above U and strictly above L.
 return [...clipTriangles(tris, fL, fS), ...clipTriangles(tris, fL, p => -fS(p)), ...clipTriangles(tris, fU, not(fL))];
}
/** Planar face closing a section: points on a plane, ordered around the trunk axis, fanned from the centroid. */
export function sectionFace(tris, onPlane, normal, filter, uvMap, radius, tangent) {
 const pts = [], key = new Set();
 for (const t of tris) for (const v of t) if (Math.abs(onPlane(v.p)) < 1e-5 && filter(v.p)) { const k = v.p.map(x => Math.round(x*1e5)).join(','); if (!key.has(k)) { key.add(k); pts.push(v.p); } }
 if (pts.length < 3) return [];
 const c = pts.reduce((a, p) => a.map((x, i) => x + p[i]/pts.length), [0, 0, 0]);
 const b = [tangent[1]*normal[2]-tangent[2]*normal[1], tangent[2]*normal[0]-tangent[0]*normal[2], tangent[0]*normal[1]-tangent[1]*normal[0]];
 const ang = p => Math.atan2((p[0]-c[0])*b[0]+(p[1]-c[1])*b[1]+(p[2]-c[2])*b[2], (p[0]-c[0])*tangent[0]+(p[1]-c[1])*tangent[1]+(p[2]-c[2])*tangent[2]);
 pts.sort((p, q) => ang(p) - ang(q));
 const vert = p => ({p, n: normal, uv: uvMap(p[0]/radius, p[2]/radius), c: [1, 1, 1, 1]}), out = [], cv = vert(c);
 for (let i = 0; i < pts.length; i++) { const tri = [cv, vert(pts[i]), vert(pts[(i+1) % pts.length])];
  const a = tri[0].p, u = tri[1].p.map((x, k) => x - a[k]), w = tri[2].p.map((x, k) => x - a[k]), cr = [u[1]*w[2]-u[2]*w[1], u[2]*w[0]-u[0]*w[2], u[0]*w[1]-u[1]*w[0]];
  if (cr[0]*normal[0] + cr[1]*normal[1] + cr[2]*normal[2] < 0) tri.reverse(); if (area2(tri) > 1e-10) out.push(tri); }
 return out;
}
const unit = v => { const l = Math.hypot(...v); return v.map(x => x/l); };
/** Notch for cuts 1/2: carved bark + exposed wood faces (upper sloped face and lower floor). */
export function buildNotch(trunk, notch, uvMap) {
 const bark = carveWedge(trunk, notch), {s, fL, fU} = notchPlanes(notch), [nx, , nz] = notch.normal, t = [-nz, 0, nx];
 const nU = unit([notch.upper*nx, -1, notch.upper*nz]), nL = unit([notch.lower*nx, 1, notch.lower*nz]);
 const r = notch.radius, upper = sectionFace(bark, fU, nU, p => fL(p) <= 1e-5, uvMap, r, t), lower = sectionFace(bark, fL, nL, p => s(p) >= notch.hinge - 1e-5, uvMap, r, t);
 return {bark, wood: [...upper, ...lower], upper, lower};
}
/** Third cut: split the notched trunk at the exact hinge height into rooted stump and falling section, with two end caps. */
export function buildFelled(trunk, notch, uvMap) {
 const n = buildNotch(trunk, notch, uvMap), h = notch.height, above = p => p[1] - h, below = p => h - p[1], {s} = notchPlanes(notch), t = [-notch.normal[2], 0, notch.normal[0]];
 const stumpBark = clipTriangles(n.bark, below), topBark = clipTriangles(n.bark, above), behind = p => s(p) <= notch.hinge + 1e-5;
 const stumpCap = sectionFace(stumpBark, above, [0, 1, 0], behind, uvMap, notch.radius, t), topCap = sectionFace(topBark, above, [0, -1, 0], behind, uvMap, notch.radius, t);
 return {stump: {bark: stumpBark, wood: [...n.lower, ...stumpCap]}, top: {bark: topBark, wood: [...n.upper, ...topCap]}, caps: {stump: stumpCap, top: topCap}};
}
/** Triangle list -> non-indexed BufferGeometry with position/normal/uv(/color). */
export function toGeometry(tris, withColor = true) {
 const n = tris.length*3, P = new Float32Array(n*3), N = new Float32Array(n*3), U = new Float32Array(n*2), C = withColor ? new Float32Array(n*4) : null; let i = 0;
 for (const t of tris) for (const v of t) { P.set(v.p, i*3); N.set(v.n, i*3); U.set(v.uv, i*2); if (C) C.set(v.c || [1, 1, 1, 1], i*4); i++; }
 const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(P, 3)); g.setAttribute('normal', new T.BufferAttribute(N, 3)); g.setAttribute('uv', new T.BufferAttribute(U, 2)); if (C) g.setAttribute('color', new T.BufferAttribute(C, 4)); g.computeBoundingSphere(); g.computeBoundingBox(); return g;
}
/** Fit the endcap's planar UV disc: uv = o + k * (x/R, z/R). Falls back to the documented unit disc mapping. */
export function fitEndcapUV(mesh) {
 const g = mesh?.geometry, pos = g?.attributes.position, uv = g?.attributes.uv; if (!pos || !uv) return null;
 let R = 0; for (let i = 0; i < pos.count; i++) R = Math.max(R, Math.hypot(pos.getX(i), pos.getZ(i)));
 // Affine least squares over the flat face interior only (the bevelled rim carries a separate bark-band mapping).
 const rows = []; for (let i = 0; i < pos.count; i++) { const x = pos.getX(i)/R, z = pos.getZ(i)/R; if (Math.hypot(x, z) < .85 && pos.getY(i) > 0) rows.push([x, z, uv.getX(i), uv.getY(i)]); }
 if (rows.length < 3) return null;
 const solve = col => { const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0]; for (const r of rows) { const f = [1, r[0], r[1]]; for (let i = 0; i < 3; i++) { b[i] += f[i]*r[col]; for (let j = 0; j < 3; j++) A[i][j] += f[i]*f[j]; } }
  for (let i = 0; i < 3; i++) { const p = A[i][i] || 1e-12; for (let j = i + 1; j < 3; j++) { const k = A[j][i]/p; for (let c = i; c < 3; c++) A[j][c] -= k*A[i][c]; b[j] -= k*b[i]; } }
  const x = [0, 0, 0]; for (let i = 2; i >= 0; i--) { let s = b[i]; for (let j = i + 1; j < 3; j++) s -= A[i][j]*x[j]; x[i] = s/(A[i][i] || 1e-12); } return x; };
 const U = solve(2), V = solve(3); return (x, z) => [U[0] + U[1]*x + U[2]*z, V[0] + V[1]*x + V[2]*z];
}
/** Topology audit used by tests: open (boundary) edges after welding, and normal/winding agreement. */
export function audit(tris) {
 // Tolerance weld (1e-5 m) with neighbour-cell lookup, so rounding boundaries cannot fake open edges.
 const cells = new Map(), reps = [], k = p => { const c = p.map(x => Math.floor(x*1e4));
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let l = -1; l <= 1; l++) for (const r of cells.get(`${c[0]+i},${c[1]+j},${c[2]+l}`) || []) if (Math.hypot(p[0]-reps[r][0], p[1]-reps[r][1], p[2]-reps[r][2]) < 1e-5) return String(r);
  const key = c.join(','); if (!cells.has(key)) cells.set(key, []); cells.get(key).push(reps.length); reps.push(p); return String(reps.length - 1); };
 const edges = new Map(); let flipped = 0, missingUV = 0, badNormal = 0;
 for (const t of tris) { for (let i = 0; i < 3; i++) { const a = k(t[i].p), b = k(t[(i+1) % 3].p); if (a === b) continue; const e = a < b ? a + '|' + b : b + '|' + a; edges.set(e, (edges.get(e) || 0) + 1); }
  const a = t[0].p, u = t[1].p.map((x, i) => x - a[i]), w = t[2].p.map((x, i) => x - a[i]), cr = [u[1]*w[2]-u[2]*w[1], u[2]*w[0]-u[0]*w[2], u[0]*w[1]-u[1]*w[0]], avg = [0, 1, 2].map(i => t[0].n[i] + t[1].n[i] + t[2].n[i]);
  if (cr[0]*avg[0] + cr[1]*avg[1] + cr[2]*avg[2] < 0) flipped++; for (const v of t) { if (!v.uv.every(Number.isFinite)) missingUV++; if (Math.abs(Math.hypot(...v.n) - 1) > 1e-3) badNormal++; } }
 const open = [...edges].filter(([, c]) => c === 1).map(([e]) => e.split('|').map(Number).map(i => reps[i]));
 const openLength = open.reduce((s, [a, b]) => s + Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]), 0), openMaxY = Math.max(-Infinity, ...open.flat().map(p => p[1]));
 return {triangles: tris.length, open, openLength, openMaxY, flipped, missingUV, badNormal};
}
