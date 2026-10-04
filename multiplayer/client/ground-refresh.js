// Partial refresh of the ground PlaneGeometry (rotated flat with rotateX(-PI/2)) so terrain that animates
// (rising walls, tearing chasms, sinking segments) can follow the presentation clock every frame instead of
// stepping at snapshot rate. Normals are recomputed exactly as BufferGeometry.computeVertexNormals would
// (area-weighted face sums, same triangle order), so a partial refresh never leaves a seam against a full one.
// Uploads cover only the touched rows (three.js clears the ranges after each upload).

/** Grid rectangle [i0,i1]x[j0,j1] of vertices covering every circle {x,z,radius}, padded by `pad` vertices. */
export function groundRect(geometry, circles, pad = 1) {
  const {width, height, widthSegments: gx, heightSegments: gy} = geometry.parameters, sx = width / gx, sz = height / gy;
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
  for (const e of circles) {
    const r = e.radius + Math.max(sx, sz);
    i0 = Math.min(i0, Math.floor((e.x - r + width / 2) / sx)); i1 = Math.max(i1, Math.ceil((e.x + r + width / 2) / sx));
    j0 = Math.min(j0, Math.floor((e.z - r + height / 2) / sz)); j1 = Math.max(j1, Math.ceil((e.z + r + height / 2) / sz));
  }
  if (i0 > i1) return null;
  return {i0: Math.max(0, i0 - pad), i1: Math.min(gx, i1 + pad), j0: Math.max(0, j0 - pad), j1: Math.min(gy, j1 + pad)};
}

/** Separate rectangles for separate disturbances (three walls across the map refresh three strips, not their
 * bounding box). Rectangles whose normal rings could touch are merged, so refreshes stay independent. */
export function groundRects(geometry, circles) {
  const rects = circles.map(e => groundRect(geometry, [e], 0)).filter(Boolean);
  for (let merged = true; merged;) {
    merged = false;
    for (let a = 0; a < rects.length && !merged; a++) for (let b = a + 1; b < rects.length; b++) {
      const p = rects[a], q = rects[b];
      if (p.i0 <= q.i1 + 3 && q.i0 <= p.i1 + 3 && p.j0 <= q.j1 + 3 && q.j0 <= p.j1 + 3) {
        rects[a] = {i0: Math.min(p.i0, q.i0), i1: Math.max(p.i1, q.i1), j0: Math.min(p.j0, q.j0), j1: Math.max(p.j1, q.j1)}; rects.splice(b, 1); merged = true; break;
      }
    }
  }
  return rects;
}

/** Re-sample heights inside `rect` with y(x,z), then refresh normals one vertex beyond it. */
export function refreshGround(geometry, rect, y) {
  const {widthSegments: gx, heightSegments: gy} = geometry.parameters, row = gx + 1;
  const pos = geometry.attributes.position, nor = geometry.attributes.normal, p = pos.array, n = nor.array;
  for (let j = rect.j0; j <= rect.j1; j++) for (let i = rect.i0; i <= rect.i1; i++) { const k = (j * row + i) * 3; p[k + 1] = y(p[k], p[k + 2]); }
  // Normals depend on neighbours, so the ring just outside the re-sampled rectangle changes too.
  const ni0 = Math.max(0, rect.i0 - 1), ni1 = Math.min(gx, rect.i1 + 1), nj0 = Math.max(0, rect.j0 - 1), nj1 = Math.min(gy, rect.j1 + 1);
  for (let j = nj0; j <= nj1; j++) n.fill(0, (j * row + ni0) * 3, (j * row + ni1) * 3 + 3);
  const inside = v => { const i = v % row, j = (v - i) / row; return i >= ni0 && i <= ni1 && j >= nj0 && j <= nj1; };
  const face = (a, b, c) => {
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2], bx = p[b * 3], by = p[b * 3 + 1], bz = p[b * 3 + 2];
    const cbx = p[c * 3] - bx, cby = p[c * 3 + 1] - by, cbz = p[c * 3 + 2] - bz, abx = ax - bx, aby = ay - by, abz = az - bz;
    const fx = cby * abz - cbz * aby, fy = cbz * abx - cbx * abz, fz = cbx * aby - cby * abx;
    for (const v of [a, b, c]) if (inside(v)) { n[v * 3] += fx; n[v * 3 + 1] += fy; n[v * 3 + 2] += fz; }
  };
  for (let j = Math.max(0, nj0 - 1); j <= Math.min(gy - 1, nj1); j++) for (let i = Math.max(0, ni0 - 1); i <= Math.min(gx - 1, ni1); i++) {
    const a = j * row + i, b = (j + 1) * row + i, c = (j + 1) * row + i + 1, d = j * row + i + 1;
    face(a, b, d); face(b, c, d);
  }
  for (let j = nj0; j <= nj1; j++) for (let i = ni0; i <= ni1; i++) {
    const k = (j * row + i) * 3, l = Math.hypot(n[k], n[k + 1], n[k + 2]) || 1; n[k] /= l; n[k + 1] /= l; n[k + 2] /= l;
  }
  for (const [attr, j0, j1] of [[pos, rect.j0, rect.j1], [nor, nj0, nj1]]) {
    attr.addUpdateRange?.(j0 * row * 3, (j1 - j0 + 1) * row * 3); attr.needsUpdate = true;
  }
}
