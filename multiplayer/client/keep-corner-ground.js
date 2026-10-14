// Ground for the keep corners past the old map edge: each keep's back town sits in its corner beyond the 120 m
// ground mesh (shared/keep-sites.js), so two L-shaped patches per corner carry the same surface out to Chebyshev 76.
// - Same 0.75 m lattice as the ground mesh (aligned at -60), so the seam shares vertices and heights exactly.
// - Heights come from the shared surface (the analytic terrain is defined everywhere; edits never reach this far).
// - Past the cliffs' crest (Chebyshev 71) the patch rolls down behind the ridge, like the mountain shell's back side.
// - Uses whatever material the ground mesh wears (the orchard presentation swaps it in), so it shades identically.
// Presentation only: no collision, raycasts or shadow casting. One draw call, ~3.6k triangles.
import * as THREE from 'three';
import {TERRAIN_GRID} from '../shared/terrain.js';

const STEP = TERRAIN_GRID.step, HALF = TERRAIN_GRID.half;
export const CORNER_GROUND = Object.freeze({inner: 48.75, cove: 38.25, outer: 76.5, crest: 71});
// Patches in corner coordinates [u0, u1, v0, v1] (distance from centre toward the corner along x and z).
// The first patch reaches further along the outer edge to floor Larimar Cove (shared/larimar-cove.js), cut beside the town.
const PATCHES = [[HALF, CORNER_GROUND.outer, CORNER_GROUND.cove, CORNER_GROUND.outer], [CORNER_GROUND.inner, HALF, HALF, CORNER_GROUND.outer]];

export function createKeepCornerGround({scene, ground, height}) {
  const pos = [], index = [];
  const sstep = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
  for (const g of [-1, 1]) for (const [u0, u1, v0, v1] of PATCHES) {
    // Grid in world x/z, walked in increasing world order so triangles match PlaneGeometry's winding and diagonal.
    const xs = [], zs = [];
    const [x0, x1] = g < 0 ? [-u1, -u0] : [u0, u1], [z0, z1] = g < 0 ? [-v1, -v0] : [v0, v1];
    for (let x = x0; x <= x1 + 1e-6; x += STEP) xs.push(Math.round(x / STEP) * STEP);
    for (let z = z0; z <= z1 + 1e-6; z += STEP) zs.push(Math.round(z / STEP) * STEP);
    const base = pos.length / 3, W = xs.length;
    for (const z of zs) for (const x of xs) {
      const s = Math.max(Math.abs(x), Math.abs(z)), fall = sstep((s - CORNER_GROUND.crest) / (CORNER_GROUND.outer - CORNER_GROUND.crest));
      pos.push(x, height(x, z) - 16 * fall * fall, z);
    }
    for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < W - 1; i++) {
      const a = base + j * W + i, b = a + 1, c = a + W, d = c + 1;
      index.push(a, c, b, c, d, b); // PlaneGeometry rotated -PI/2 about X: same diagonal, normals up
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
  geometry.setIndex(index); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, ground.material);
  mesh.name = 'keep-corner-ground'; mesh.raycast = () => {}; mesh.castShadow = false; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
  mesh.userData.presentationOnly = true; mesh.updateMatrix();
  scene.add(mesh);
  return {
    mesh,
    // The orchard presentation (and tests) can swap the ground's material; follow it.
    sync() { if (mesh.material !== ground.material) mesh.material = ground.material; mesh.receiveShadow = ground.receiveShadow; },
    dispose() { scene.remove(mesh); geometry.dispose(); },
    stats: () => ({draws: 1, triangles: index.length / 3, vertices: pos.length / 3}),
  };
}
