// Alpine conifer forest on the mountain colosseum: one instanced draw of small stylized firs scattered over the
// massif's gentler faces below the tree line, so the foothills read as forested slopes under the distant snow giants.
// Presentation only: reads the arena mesh's own vertices (which already sit on the authoritative surface), never
// collides, raycasts or casts shadows. Rescatters only when the arena rebuilds.
import * as THREE from 'three';
import {keepCarve} from '../shared/keep-sites.js';

export const ALPINE_FOREST_VERSION = 2;
const QUALITY = {high: {max: 2600, density: .5}, low: {max: 1000, density: .2}};
const FROST_FROM = 15, FROST_FULL = 26; // world Y (m) where fir tops start / finish frosting (default tree line is 25)

function hash(i, seed) {
  let h = (Math.imul((i + 4096) >>> 0, 0x8da6b343) ^ Math.imul((seed + 4096) >>> 0, 0xd8163841)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0; h = (h ^ (h >>> 15)) >>> 0;
  return (h & 0xffffff) / 16777215;
}
// Smooth 2D value noise on the integer lattice (deterministic, presentation-only colour grouping).
function standNoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z); let fx = x - ix, fz = z - iz; fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  const c = (a, b) => hash((a & 0xffff) * 65536 + (b & 0xffff), 29);
  const a = c(ix, iz) + (c(ix + 1, iz) - c(ix, iz)) * fx, b = c(ix, iz + 1) + (c(ix + 1, iz + 1) - c(ix, iz + 1)) * fx;
  return a + (b - a) * fz;
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
  // v2 palette (linear): lifted ~30% and nudged from olive toward a clean fir green so slopes read bright and
  // optimistic; rims alternate warm/cool around each tier so a single tree has sunlit and shaded flanks.
  for (const [ti, [y0, y1, r]] of tiers.entries()) {
    const twist = ti * .6, apex = v(0, y1, 0, ti === 2 ? [.11, .17, .08] : [.045, .095, .045]), under = v(0, y0 + (y1 - y0) * .32, 0, [.01, .02, .013]);
    const ring = [];
    for (let k = 0; k < sides; k++) { const a = k / sides * Math.PI * 2 + twist, droop = y0 - .03, warm = k % 2 ? 1.12 : .9;
      ring.push(v(Math.cos(a) * r, droop, Math.sin(a) * r, [(.036 + .016 * ti) * warm, .082 + .018 * ti, (.036 + .004 * ti) / warm])); }
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
    if (keepCarve(cx, cz) > .02) continue; // nor in the keeps' passes and back towns (the shell sinks there)
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
  // v2: frost-dusted upper tiers on the highest stands, so the forest fades into the snow line instead of stopping.
  // Keyed to the instance's world Y (instanceMatrix translation) and the up-facing tier tops; one varying, no
  // uniforms, no textures. The hook goes through the atmosphere accessor when installed (it runs first, atmosphere
  // after) and the default cache key derives from this function's source, so the program is not shared by mistake.
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying float vFirFrost;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
      vFirFrost = smoothstep(${FROST_FROM.toFixed(1)}, ${FROST_FULL.toFixed(1)}, instanceMatrix[3].y) * smoothstep(0.45, 1.0, position.y) * clamp(objectNormal.y * 1.5, 0.0, 1.0);
#else
      vFirFrost = 0.0;
#endif`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFirFrost;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.68, 0.76), vFirFrost * 0.6);');
  };
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
      // v2 tint: stands share a colour (40 m value noise) with only a small per-tree jitter, so slopes read as coherent
      // forest patches at 50-70 m instead of per-tree speckle; higher stands drift cooler/bluer toward the snow.
      const stand = standNoise(x * .025 + 3.1, z * .025 - 1.7), alt = Math.min(1, Math.max(0, (y - 10) / 15));
      const v = (.86 + .3 * stand) * (.95 + .1 * hash(i, 9)), warm = .06 * (stand - .5) - .05 * alt;
      mesh.setColorAt(i, tint.setRGB(v * (1 + warm), v, v * (1 - warm * .8 + .04 * alt)));
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
