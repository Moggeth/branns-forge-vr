// Alpine conifer forest on the mountain colosseum: one instanced draw of small stylized firs scattered over the
// massif's gentler faces below the tree line, so the foothills read as forested slopes under the distant snow giants.
// Presentation only: reads the arena mesh's own vertices (which already sit on the authoritative surface), never
// collides, raycasts or casts shadows. Rescatters only when the arena rebuilds.
import * as THREE from 'three';

export const ALPINE_FOREST_VERSION = 1;
const QUALITY = {high: {max: 2600, density: .5}, low: {max: 1000, density: .2}};

function hash(i, seed) {
  let h = (Math.imul((i + 4096) >>> 0, 0x8da6b343) ^ Math.imul((seed + 4096) >>> 0, 0xd8163841)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0; h = (h ^ (h >>> 15)) >>> 0;
  return (h & 0xffffff) / 16777215;
}

// Fir: three drooping five-sided tiers on a short trunk, unit height. Vertex colour carries the crown shading
// (dark interior and underside, sunlit tier rims, a pale tip) so it reads at 50-70 m with a single material.
export function firGeometry() {
  const pos = [], col = [], idx = [], sides = 5;
  const v = (x, y, z, c) => { pos.push(x, y, z); col.push(...c); return pos.length / 3 - 1; };
  const trunk = [.09, .06, .04];
  for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2, b = (k + 1) / 4 * Math.PI * 2, w = .04;
    const p = v(Math.cos(a) * w, 0, Math.sin(a) * w, trunk), q = v(Math.cos(b) * w, 0, Math.sin(b) * w, trunk), r = v(Math.cos(b) * w * .6, .3, Math.sin(b) * w * .6, trunk), s = v(Math.cos(a) * w * .6, .3, Math.sin(a) * w * .6, trunk);
    idx.push(p, r, q, p, s, r); }
  const tiers = [[.16, .52, .36], [.4, .74, .27], [.6, 1, .17]]; // [skirt y, apex y, radius]
  for (const [ti, [y0, y1, r]] of tiers.entries()) {
    const twist = ti * .6, apex = v(0, y1, 0, ti === 2 ? [.08, .13, .07] : [.035, .07, .035]), under = v(0, y0 + (y1 - y0) * .32, 0, [.008, .016, .01]);
    const ring = [];
    for (let k = 0; k < sides; k++) { const a = k / sides * Math.PI * 2 + twist, droop = y0 - .03;
      ring.push(v(Math.cos(a) * r, droop, Math.sin(a) * r, [.028 + .012 * ti, .062 + .014 * ti, .03])); }
    for (let k = 0; k < sides; k++) { const a = ring[k], b = ring[(k + 1) % sides]; idx.push(apex, b, a, under, a, b); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// Scatter over arena triangles. Returns [x, y, z, height, yaw] tuples, deterministic for a given surface.
export function scatterFirs(position, index, {density = .1, max = 2000, treeline = 25} = {}) {
  const out = [], a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
  for (let t = 0; t < index.length && out.length < max * 5; t += 3) {
    a.fromArray(position, index[t] * 3); b.fromArray(position, index[t + 1] * 3); c.fromArray(position, index[t + 2] * 3);
    e1.subVectors(b, a); e2.subVectors(c, a); n.crossVectors(e1, e2); const area = n.length() / 2; if (area < 1e-4) continue; n.normalize();
    if (n.y < 0) n.negate();
    const cx = (a.x + b.x + c.x) / 3, cz = (a.z + b.z + c.z) / 3, cy = (a.y + b.y + c.y) / 3;
    const s = Math.max(Math.abs(cx), Math.abs(cz)); if (s < 49) continue; // never on the walkable meadow side
    const inward = -(cx * n.x + cz * n.z) / Math.hypot(cx, cz); if (inward < -.05) continue; // faces turned away are never seen
    const line = treeline + 3 * (hash(t, 11) - .5);
    if (n.y < .45 || cy > line) continue;
    let k = area * density * (.4 + 1.2 * hash(Math.floor(cx * .08) * 131 + Math.floor(cz * .08), 5)); // clumped stands and glades
    for (let j = 0; k > 0 && out.length < max * 5; j++, k--) {
      if (k < 1 && hash(t, 40 + j) > k) break;
      let u = hash(t, 60 + j), w = hash(t, 80 + j); if (u + w > 1) { u = 1 - u; w = 1 - w; }
      const x = a.x + e1.x * u + e2.x * w, y = a.y + e1.y * u + e2.y * w, z = a.z + e1.z * u + e2.z * w;
      const alt = 1 - Math.min(1, Math.max(0, (y - 10) / (line - 10))); // smaller, sparser toward the tree line
      out.push([x, y - .15, z, (2.6 + 4.2 * hash(t, 100 + j)) * (.55 + .45 * alt), hash(t, 120 + j) * Math.PI * 2]);
    }
  }
  if (out.length > max) { const keep = []; for (let i = 0; i < out.length; i++) if (hash(i, 7) < max / out.length) keep.push(out[i]); return keep.slice(0, max); }
  return out;
}

export function createAlpineForest({scene, arena, quality = 'high'} = {}) {
  if (!scene || !arena?.mesh) throw new Error('createAlpineForest requires scene and the mountain arena');
  const cfg = QUALITY[quality] || QUALITY.high, geometry = firGeometry();
  const material = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .92, metalness: 0, side: THREE.DoubleSide, envMapIntensity: .5});
  const mesh = new THREE.InstancedMesh(geometry, material, cfg.max);
  mesh.name = 'alpine-forest'; mesh.raycast = () => {}; mesh.receiveShadow = false; mesh.castShadow = false; mesh.frustumCulled = false; mesh.count = 0;
  scene.add(mesh);
  let rebuilds = -1, last = 0, scatterMs = 0;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), tint = new THREE.Color();
  function rescatter() {
    const t0 = performance.now(), geo = arena.mesh.geometry;
    const list = scatterFirs(geo.attributes.position.array, geo.index.array, {density: cfg.density, max: cfg.max});
    list.forEach(([x, y, z, h, yaw], i) => {
      q.setFromAxisAngle(up, yaw); const lean = .9 + .2 * hash(i, 3);
      m.compose(p.set(x, y, z), q, s.set(h * .62 * lean, h, h * .62 * lean)); mesh.setMatrixAt(i, m);
      const v = .78 + .42 * hash(i, 9); mesh.setColorAt(i, tint.setRGB(v * (.92 + .1 * hash(i, 13)), v, v * (.9 + .12 * hash(i, 17))));
    });
    mesh.count = last = list.length; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    scatterMs = performance.now() - t0;
  }
  function sync() { const r = arena.stats().rebuilds; if (r !== rebuilds) { rebuilds = r; rescatter(); return true; } return false; }
  sync();
  return {
    mesh, sync,
    stats: () => ({version: ALPINE_FOREST_VERSION, draws: 1, firs: last, triangles: last * geometry.index.count / 3, scatterMs: +scatterMs.toFixed(2)}),
    dispose() { scene.remove(mesh); geometry.dispose(); material.dispose(); mesh.dispose?.(); },
  };
}
