import {MOUNTAIN_ROCK_GLSL} from './material-refinements.js';
import {keepCarve} from '../shared/keep-sites.js';
export {MOUNTAIN_ROCK_GLSL};
// Mountain colosseum boundary: one batched, seeded, presentation-only rock massif that hugs the authoritative
// terrain ring and rises into a broken snowy summit silhouette behind the walkable domain.
// - Every vertex is height(x, z) + lift(s, u) with lift >= 0.05 on the visible inner side, so the massif sits ON the
//   authoritative surface (no floating rock, no unrelated far-away mountains, no grass curtain hiding a wall).
// - Square-ring parametrisation (Chebyshev distance s, perimeter coordinate u) => continuous at the corners.
// - Inner edge starts at s = SHELL_START (beyond the movement clamp); s in [46, SHELL_START] is the ground mesh
//   itself, dressed by mountain-ground-treatment.js (moss foot, strata rock, snow) so rock appears exactly where the
//   shared slope becomes impassable.
// - Never adds collision, raycast targets, lights or shadow casters. 1 draw call, ~22k triangles.
export const MOUNTAIN_ARENA_VERSION = 3;
export const ARENA = Object.freeze({walk: 55, mountainStart: 46, crest: 55, shellStart: 52, outer: 65, columnsPerSide: 160, rows: 18});

// Deterministic integer hash (same family as orchard-presentation hash2) and periodic 1D value noise.
function hash(i, seed) {
  let h = (Math.imul((i + 4096) >>> 0, 0x8da6b343) ^ Math.imul((seed + 4096) >>> 0, 0xd8163841)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0; h = (h ^ (h >>> 15)) >>> 0;
  return (h & 0xffffff) / 16777215;
}
function pnoise(x, period, seed) { // periodic in x with integer period
  const i = Math.floor(x), f = x - i, t = f * f * (3 - 2 * f), m = k => ((k % period) + period) % period;
  return hash(m(i), seed) * (1 - t) + hash(m(i + 1), seed) * t;
}
const clamp01 = v => Math.min(1, Math.max(0, v));
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// u in [0, 4): unit-square perimeter point with max(|x|,|z|) = 1 (corners at integer u).
export function squarePoint(u) {
  const k = Math.floor(u) & 3, f = u - Math.floor(u);
  return k === 0 ? [-1 + 2 * f, -1] : k === 1 ? [1, -1 + 2 * f] : k === 2 ? [1 - 2 * f, 1] : [-1, 1 - 2 * f];
}

// Ridge profile along the perimeter (u in [0,4)). Periodic, seeded, stable.
export function ridgeProfile(u, seed = 7) {
  const P = 4, macro = .6 * pnoise(u * 3, 12, seed) + .4 * pnoise(u * 7, 28, seed + 1);
  const r = pnoise(u * 23, 92, seed + 2), ribs = 1 - Math.abs(r * 2 - 1); // ridged: sharp ribs, rounded gullies
  const fine = pnoise(u * 61, 244, seed + 3), fu = u - Math.floor(u), corner = sstep(.09, 0, Math.min(fu, 1 - fu)); // corner bastions
  void P;
  return {
    peak: 4 + 10 * Math.pow(macro, 1.5) + 2.6 * ribs + 1.4 * fine + 5 * corner, // alpine foothills: forested shoulders under the distant giants // summit height above the crest surface (m)
    at: 60.2 + 2.4 * (pnoise(u * 5, 20, seed + 4) - .5), // summit Chebyshev distance
    bay: pnoise(u * 11, 44, seed + 5), // 0 spur .. 1 bay (horizontal breakup of the wall)
    ribs, macro,
  };
}

// Lift above the authoritative surface. s = Chebyshev distance, u = perimeter coordinate.
export function liftAt(s, u, seed = 7) {
  const R = ridgeProfile(u, seed), rowRib = pnoise(u * 23 + s * .09, 92, seed + 2), rib = 1 - Math.abs(rowRib * 2 - 1);
  const A = ARENA;
  if (s <= A.crest) { // shoulders: low cliff ribs on the impassable upper slope, 5 cm floor so it never z-fights
    const t = clamp01((s - A.shellStart) / (A.crest - A.shellStart));
    // Floor rises 5 cm -> 35 cm within 1 m: the shared crest is concave-down, so a thinner floor lets the ground's
    // curve poke above the shell's row chords (seen as glinting ground lines on the face).
    return .05 + .3 * sstep(ARENA.shellStart, ARENA.shellStart + 1, s) + rib * 1.1 * Math.sin(Math.PI * t * .5) * sstep(0, .35, t);
  }
  const shoulder = .35 + rib * 1.1;
  if (s <= R.at) {
    const t = clamp01((s - A.crest) / (R.at - A.crest)), q = R.peak * Math.pow(sstep(0, 1, t), 1.6); // concave scree apron, steep summit
    const step = 2.3, terr = Math.floor(q / step) * step + sstep(.45, 1, q / step - Math.floor(q / step)) * step; // strata benches
    return shoulder + q * .72 + terr * .28 + rib * 2.2 * t; // benches only hint, no contour lines
  }
  const t = clamp01((s - R.at) / (A.outer - R.at)); // back side falls below the surface into the skirt
  return (shoulder + R.peak + rib * 1.6) * (1 - sstep(0, 1, t)) - 8 * sstep(.4, 1, t);
}

function createMaterial(THREE) {
  const material = new THREE.MeshStandardMaterial({color: 0xffffff, vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: .6});
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vMtnWorld;\nvarying vec3 vMtnNormal;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvMtnWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvMtnNormal = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vMtnWorld;\nvarying vec3 vMtnNormal;\n' + MOUNTAIN_ROCK_GLSL)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mountainRock(vMtnWorld, normalize(vMtnNormal), vColor.rgb);');
  };
  material.customProgramCacheKey = () => `mountain-arena-v${MOUNTAIN_ARENA_VERSION}`;
  return material;
}

// Shared GLSL (also used by mountain-ground-treatment.js): strata bands keyed to exact world Y, moss on low benches,
// snow on high up-facing faces with a broken line. Linear-space colours.


export function createMountainArena({THREE, scene, height, seed = 7, columnsPerSide = ARENA.columnsPerSide, rows = ARENA.rows} = {}) {
  if (!THREE || !scene || typeof height !== 'function') throw new Error('createMountainArena requires THREE, scene and height(x, z)');
  const C = columnsPerSide * 4, R = rows, count = C * R; // closed loop: column C wraps to 0 (no seam at u = 0)
  // Non-uniform rows: dense at the inner shoulder and summit, sparse on the hidden back.
  const ringS = Array.from({length: R}, (_, r) => { const t = r / (R - 1); return ARENA.shellStart + (ARENA.outer - ARENA.shellStart) * (t < .72 ? t / .72 * .62 : .62 + (t - .72) / .28 * .38); });
  const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3), index = new (count > 65535 ? Uint32Array : Uint16Array)(C * (R - 1) * 6);
  let k = 0;
  for (let c = 0; c < C; c++) for (let r = 0; r < R - 1; r++) {
    const a = c * R + r, b = ((c + 1) % C) * R + r;
    index.set([a, b, a + 1, b, b + 1, a + 1], k); k += 6; // front faces toward the arena (normals up/inward)
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = createMaterial(THREE);
  material.polygonOffset = true; material.polygonOffsetFactor = -1; material.polygonOffsetUnits = -2; // wins the 5 cm inner seam
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'mountain-arena'; mesh.raycast = () => {}; mesh.castShadow = false; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
  mesh.userData.presentationOnly = true;
  scene.add(mesh);

  const st = {rebuilds: 0, lastRebuildMs: 0, signature: null, minLift: Infinity, maxY: -Infinity};
  function rebuild() {
    const t0 = performance.now(); let minLift = Infinity, maxY = -Infinity;
    for (let c = 0; c < C; c++) {
      const u = c / columnsPerSide, [dx, dz] = squarePoint(u), R0 = ridgeProfile(u, seed);
      for (let r = 0; r < R; r++) {
        const s = ringS[r], lift = liftAt(s, u, seed), o = (c * R + r) * 3;
        // Beyond the crest: bays push the face back up to 2.6 m and far corners round off (superellipse), so the ring
        // reads as spurs and amphitheatre bowls instead of four flat walls. The inner seam (s <= crest) stays exact.
        const w = sstep(ARENA.crest, ARENA.crest + 3, s), sr = s + w * 2.6 * sstep(.3, .8, R0.bay);
        const pn = Math.pow(Math.pow(Math.abs(dx), 6) + Math.pow(Math.abs(dz), 6), 1 / 6), k = sr * (1 + (1 / pn - 1) * w * sstep(ARENA.crest, ARENA.outer, s));
        const kk = Math.min(k, ARENA.outer), x = dx * kk, z = dz * kk, carve = keepCarve(x, z);
        // Where a keep has cut its pass and back town out of the corner the rock steps aside: the shell sinks under
        // the carved floor and the real cliffs (ground mesh + keep-corner-ground.js) show instead.
        const y = height(x, z) + lift * (1 - carve) - 2.5 * carve; // never beyond Chebyshev 65
        positions[o] = x; positions[o + 1] = y; positions[o + 2] = z;
        if (s <= ARENA.crest + 1 && carve < .01) minLift = Math.min(minLift, lift); maxY = Math.max(maxY, y);
        // Vertex tint = baked occlusion: gullies and the shoulder foot darker, rib crests catch light.
        const rowRib = pnoise(u * 23 + s * .09, 92, seed + 2), rib = 1 - Math.abs(rowRib * 2 - 1);
        const ao = .74 + .26 * rib, foot = .86 + .14 * sstep(ARENA.shellStart, ARENA.crest + 1.5, s), warm = .92 + .16 * R0.macro;
        colors[o] = ao * foot * warm; colors[o + 1] = ao * foot; colors[o + 2] = ao * foot * (2 - warm);
      }
    }
    geometry.attributes.position.needsUpdate = true; geometry.attributes.color.needsUpdate = true;
    geometry.computeVertexNormals(); geometry.computeBoundingSphere(); geometry.computeBoundingBox();
    mesh.updateMatrix(); mesh.updateMatrixWorld(true);
    st.rebuilds++; st.lastRebuildMs = performance.now() - t0; st.minLift = minLift; st.maxY = maxY;
  }
  // Only edits whose footprint reaches the shell can change it (the shared surface also protects s >= 50).
  const reaches = e => Math.max(Math.abs(e.x), Math.abs(e.z)) + Math.max(.01, e.radius || 0) >= ARENA.shellStart - .5;
  function update(edits = []) {
    const sig = JSON.stringify((edits || []).filter(reaches).map(e => [e.x, e.z, e.radius, e.height, e.kind]));
    if (sig === st.signature) return false;
    st.signature = sig; rebuild(); return true;
  }
  update([]);
  return {
    mesh, material,
    sync(snapshot = {}) { return update(snapshot.edits || []); },
    update,
    rebuild,
    dispose() { scene.remove(mesh); geometry.dispose(); material.dispose(); },
    stats() { return {draws: 1, triangles: index.length / 3, vertices: count, rebuilds: st.rebuilds, lastRebuildMs: st.lastRebuildMs, minInnerLift: st.minLift, maxY: st.maxY, shellStart: ARENA.shellStart, outer: ARENA.outer, lights: 0, collision: false}; },
  };
}
