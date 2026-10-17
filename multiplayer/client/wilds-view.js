// The Great Wilds (and every generated world): the land to the horizon, its water and its far forests.
// Presentation only. Reads the shared generated world (shared/worldgen/registry.js) and the snapshot's terrain state;
// never changes heights, collision or simulation state.
//
// Terrain: four nested square levels centred on the view focus (0.75 m, 3 m, 12 m, 48 m cells). The finest level uses
// exactly the physics lattice (shared/terrain.js samples .75 m triangles), so what you walk on is what you see. Each
// coarser level cuts a hole where the finer one sits and stitches its rim to the finer level's boundary vertices, so
// the levels meet without cracks. Levels rebuild in small time slices into spare geometry and swap together, so
// walking never hitches. Base heights are cached in tiles; earthworks and foundations bypass the cache.
// Water: the sea to the horizon, flat lake sheets at their spill level, and river ribbons on their monotone surfaces.
// Forests: the Simulation's live trees near Heroes are drawn by tree-view; beyond them, faceted instanced trees at the
// same stable positions (shared/worldgen/content.js), then a thinner canopy from the forest grid to the haze.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {rawTerrainHeight, terrainRenderVertex, FOUNDATION_HALF} from '../shared/terrain.js';
import {chunkContent, activeChunks, CHUNK, CRAG_KINDS} from '../shared/worldgen/content.js';
import {BIOME, BIOME_NAMES} from '../shared/worldgen/generate.js';
import {hash01} from '../shared/worldgen/random.js';
import {createGroundMaterial} from './kit/ground-material.js';
import {ATMOSPHERE} from './atmosphere-materials.js';
import {impostorSources, bakeImpostors, createImpostorField} from './kit/tree-impostors.js';
import {VARIANTS, treeScale} from '../shared/trees.js';

// morph: Chebyshev metres from the focus over which a level slides onto the next coarser one. It must finish before the
// nearest the level's edge can be (half extent minus the recentring slack of .75 snap), so rims always meet exactly.
const LEVELS = Object.freeze([
  {cell: .75, segs: 160, snap: 24, morph: [28, 40]},
  {cell: 3, segs: 160, snap: 96, morph: [115, 160]},
  {cell: 12, segs: 160, snap: 384, morph: [460, 650]},
  {cell: 48, segs: 128, snap: 1536, morph: null},
]);
const TILE = 32, TILE_MAX = 900;
const QUALITY = {
  high: {budget: 4, mid: 230, far: 1500, cap: 16000, fogNear: 6, fogFar: 22, aerial: 1 / 1500},
  low: {budget: 2.5, mid: 150, far: 950, cap: 7000, fogNear: 4, fogFar: 13, aerial: 1 / 1100},
};
// Ground kit layers per generator biome id: lush, meadow, forest floor, soil, sand, then rock and snow leanings.
const BIOME_KIT = [
  [0, 0, 0, .3, .7, 0, 0], [0, 0, 0, .5, .5, 0, 0], [0, 0, 0, 0, 1, 0, 0], [.74, .26, 0, 0, 0, 0, 0], [.35, .1, .55, 0, 0, 0, 0],
  [.15, .25, .6, 0, 0, 0, 0], [.65, 0, .1, .25, 0, 0, 0], [.1, .9, 0, 0, 0, 0, 0], [0, .3, 0, .2, 0, .5, 0], [0, .2, 0, 0, 0, 0, .8], [0, .6, 0, .25, 0, .15, 0]];
// A gentle tint per biome over the painted layers (linear multipliers): cool pines, olive marsh, sun-baked steppe.
const BIOME_TINT = [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], [.94, .98, .92], [.84, .94, .93], [.9, .95, .76], [1.05, 1, .86], [1, .98, .96], [1, 1, 1], [.95, .96, .94]];
const DEEP_TINT = [.42, .66, .7];
export const SNOW_LINE = Object.freeze([135, 185]);
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp3 = (out, c, t) => { out[0] += (c[0] - out[0]) * t; out[1] += (c[1] - out[1]) * t; out[2] += (c[2] - out[2]) * t; };

export function createWildsView({scene, renderer = null, templates = null, quality = 'high', assetBase = '/assets/', report = () => {}}) {
  const Q = QUALITY[quality] || QUALITY.high;
  const group = new THREE.Group(); group.name = 'wilds'; group.visible = false; scene.add(group);
  const kitFocus = {value: new THREE.Vector2()}, kitSnow = {value: new THREE.Vector2(...SNOW_LINE)}, kitTime = {value: 0};
  const waterMaterial = createWaterMaterial();
  let world = null, descriptor = null, state = null, bake = null, tiles = new Map(), editRects = [], editKey = '';
  // ---------- heights ----------
  const baseState = {world: null, edits: [], terrainBake: null};
  function full(x, z) { return terrainRenderVertex(state, x, z, false, rawTerrainHeight(state, x, z)); }
  function tileFor(l, tx, tz) {
    const key = l * 1e8 + (tx + 5000) * 1e4 + (tz + 5000);
    let t = tiles.get(key);
    if (t) { tiles.delete(key); tiles.set(key, t); return t; }
    const cell = LEVELS[l].cell, h = new Float32Array((TILE + 1) * (TILE + 1)), x0 = tx * TILE * cell, z0 = tz * TILE * cell;
    for (let j = 0; j <= TILE; j++) for (let i = 0; i <= TILE; i++) h[j * (TILE + 1) + i] = rawTerrainHeight(baseState, x0 + i * cell, z0 + j * cell);
    t = {h, x0, z0, x1: x0 + TILE * cell, z1: z0 + TILE * cell};
    tiles.set(key, t); while (tiles.size > TILE_MAX) tiles.delete(tiles.keys().next().value);
    return t;
  }
  const touched = (x0, z0, x1, z1) => { for (const r of editRects) if (r[0] <= x1 && r[2] >= x0 && r[1] <= z1 && r[3] >= z0) return true; return false; };
  /** Exact surface at lattice vertex (ix, iz) of level l: the same number physics produces there. */
  function vertex(l, ix, iz) {
    const tx = Math.floor(ix / TILE), tz = Math.floor(iz / TILE), t = tileFor(l, tx, tz);
    const cell = LEVELS[l].cell, x = ix * cell, z = iz * cell;
    if (editRects.length && touched(x, z, x, z)) return full(x, z);
    return t.h[(iz - tz * TILE) * (TILE + 1) + (ix - tx * TILE)];
  }
  function refreshEdits() {
    editRects = [];
    for (const e of state.edits || []) { const r = (e.radius || 0) + 2; editRects.push([e.x - r, e.z - r, e.x + r, e.z + r]); }
    for (const b of state.inventions?.structures || []) if (b.type === 'foundation') { const r = FOUNDATION_HALF + 1.5; editRects.push([b.position[0] - r, b.position[2] - r, b.position[0] + r, b.position[2] + r]); }
  }
  // ---------- terrain levels ----------
  const levels = LEVELS.map((spec, l) => {
    const ring = {value: new THREE.Vector3(0, 0, 1e9)};
    const material = createGroundMaterial({assetBase, focus: kitFocus, morph: spec.morph, ring, snow: kitSnow, time: kitTime, quality});
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    mesh.name = 'wilds-terrain-' + l; mesh.frustumCulled = false; mesh.visible = false; mesh.receiveShadow = l < 2;
    mesh.userData.ignoreContact = true; group.add(mesh);
    return {spec, l, mesh, ring, cx: NaN, cz: NaN, innerKey: '', built: false};
  });
  let job = null, pending = null, buildsDone = 0, lastBuildMs = 0;
  const centreFor = (spec, cur, f) => (Number.isFinite(cur) && Math.abs(f - cur) <= spec.snap * .75) ? cur : Math.round(f / spec.snap) * spec.snap;
  /** Lattice normal (central differences) at vertex (ix, iz) of level l, as [nx, ny, nz]. */
  function latticeNormal(l, ix, iz) {
    const c2 = 2 * LEVELS[l].cell, nx = (vertex(l, ix - 1, iz) - vertex(l, ix + 1, iz)) / c2, nz = (vertex(l, ix, iz - 1) - vertex(l, ix, iz + 1)) / c2, len = Math.sqrt(nx * nx + 1 + nz * nz);
    return [nx / len, 1 / len, nz / len];
  }
  /**
   * Where a point of level l sits on level l+1's surface: height and normal (as slopes nx/ny, nz/ny), interpolated on
   * the same triangles level l+1 draws ((a, c, b) and (c, d, b)). cache memoises the coarse corners for one build.
   */
  function morphAt(l, x, z, out, o, cache) {
    if (l >= LEVELS.length - 1) { out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; return; }
    const C = LEVELS[l + 1].cell, X = x / C, Z = z / C, i0 = Math.floor(X + 1e-7), j0 = Math.floor(Z + 1e-7);
    const fx = Math.min(1, Math.max(0, X - i0)), fz = Math.min(1, Math.max(0, Z - j0));
    const corner = (i, j) => {
      const key = i * 131072 + j; let c = cache.get(key);
      if (!c) { c = [vertex(l + 1, i, j), ...latticeNormal(l + 1, i, j)]; cache.set(key, c); }
      return c;
    };
    const a = corner(i0, j0), b = corner(i0 + 1, j0), c = corner(i0, j0 + 1), d = corner(i0 + 1, j0 + 1);
    let wa, wb, wc, wd;
    if (fx + fz <= 1) { wa = 1 - fx - fz; wb = fx; wc = fz; wd = 0; } else { wa = 0; wb = 1 - fz; wc = 1 - fx; wd = fx + fz - 1; }
    const h = a[0] * wa + b[0] * wb + c[0] * wc + d[0] * wd, ny = a[2] * wa + b[2] * wb + c[2] * wc + d[2] * wd;
    out[o] = h; out[o + 1] = (a[1] * wa + b[1] * wb + c[1] * wc + d[1] * wd) / ny; out[o + 2] = (a[3] * wa + b[3] * wb + c[3] * wc + d[3] * wd) / ny;
  }
  function* buildLevel(L, cx, cz, inner, out) {
    const {cell, segs} = L.spec, l = L.l, side = segs + 1, half = segs * cell / 2;
    const ox = Math.round((cx - half) / cell), oz = Math.round((cz - half) / cell); // lattice index of the corner
    const pos = new Float32Array((side * side + segs * 16) * 3), lat = new Int32Array((side * side + segs * 16) * 3); // lattice (level, ix, iz) per vertex
    let v = 0;
    for (let j = 0; j < side; j++) {
      for (let i = 0; i < side; i++, v++) { const ix = ox + i, iz = oz + j; pos[v * 3] = ix * cell; pos[v * 3 + 1] = vertex(l, ix, iz); pos[v * 3 + 2] = iz * cell; lat[v * 3] = l; lat[v * 3 + 1] = ix; lat[v * 3 + 2] = iz; }
      yield;
    }
    // Hole where the finer level sits (grid indices), and its stitched rim.
    let i0 = -1, i1 = -1, j0 = -1, j1 = -1;
    if (inner) { i0 = Math.round((inner.cx - inner.half) / cell) - ox; i1 = Math.round((inner.cx + inner.half) / cell) - ox; j0 = Math.round((inner.cz - inner.half) / cell) - oz; j1 = Math.round((inner.cz + inner.half) / cell) - oz; }
    const index = [], at = (i, j) => j * side + i;
    const tri = (a, b, c) => {
      const ax = pos[a * 3], az = pos[a * 3 + 2], ny = (pos[b * 3 + 2] - az) * (pos[c * 3] - ax) - (pos[b * 3] - ax) * (pos[c * 3 + 2] - az);
      if (ny >= 0) index.push(a, b, c); else index.push(a, c, b);
    };
    // Rim points sit exactly on the straight coarse edge: the finer level has fully morphed onto that edge by its rim.
    const rim = [];
    const fine = (A, B, t) => {
      pos[v * 3] = pos[A * 3] + (pos[B * 3] - pos[A * 3]) * t; pos[v * 3 + 1] = pos[A * 3 + 1] + (pos[B * 3 + 1] - pos[A * 3 + 1]) * t; pos[v * 3 + 2] = pos[A * 3 + 2] + (pos[B * 3 + 2] - pos[A * 3 + 2]) * t;
      lat[v * 3] = -1; rim.push(v, A, B, t); return v++;
    };
    // Edge A->B on the hole, C/D the outer vertices beside A/B: fan through the three finer points between A and B.
    const fan = (A, B, C, D) => {
      const f = [1, 2, 3].map(k => fine(A, B, k / 4));
      tri(C, A, f[0]); tri(C, f[0], f[1]); tri(C, f[1], D); tri(D, f[1], f[2]); tri(D, f[2], B);
    };
    for (let j = 0; j < segs; j++) {
      for (let i = 0; i < segs; i++) {
        if (inner && i >= i0 && i < i1 && j >= j0 && j < j1) continue;
        if (inner && i >= i0 && i < i1 && j === j0 - 1) { fan(at(i, j0), at(i + 1, j0), at(i, j), at(i + 1, j)); continue; }
        if (inner && i >= i0 && i < i1 && j === j1) { fan(at(i, j1), at(i + 1, j1), at(i, j + 1), at(i + 1, j + 1)); continue; }
        if (inner && j >= j0 && j < j1 && i === i0 - 1) { fan(at(i0, j), at(i0, j + 1), at(i, j), at(i, j + 1)); continue; }
        if (inner && j >= j0 && j < j1 && i === i1) { fan(at(i1, j), at(i1, j + 1), at(i + 1, j), at(i + 1, j + 1)); continue; }
        const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
        // Same diagonal as Three's PlaneGeometry (and so the physics triangles): (a, c, b) and (c, d, b).
        tri(a, c, b); tri(c, d, b);
      }
      if ((j & 3) === 3) yield;
    }
    yield;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, v * 3), 3));
    geometry.setIndex(v > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
    // Normals from central differences on each vertex's lattice; rim points blend their edge's ends, exactly what the
    // finer level's rim morphs to.
    const nrm = new Float32Array(v * 3);
    for (let k = 0; k < v; k++) {
      if (lat[k * 3] < 0) continue;
      const n = latticeNormal(lat[k * 3], lat[k * 3 + 1], lat[k * 3 + 2]); nrm[k * 3] = n[0]; nrm[k * 3 + 1] = n[1]; nrm[k * 3 + 2] = n[2];
      if ((k & 1023) === 1023) yield;
    }
    for (let r = 0; r < rim.length; r += 4) {
      const k = rim[r], A = rim[r + 1], B = rim[r + 2], t = rim[r + 3];
      let nx = nrm[A * 3] + (nrm[B * 3] - nrm[A * 3]) * t, ny = nrm[A * 3 + 1] + (nrm[B * 3 + 1] - nrm[A * 3 + 1]) * t, nz = nrm[A * 3 + 2] + (nrm[B * 3 + 2] - nrm[A * 3 + 2]) * t;
      const len = Math.hypot(nx, ny, nz) || 1; nrm[k * 3] = nx / len; nrm[k * 3 + 1] = ny / len; nrm[k * 3 + 2] = nz / len;
    }
    geometry.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    const morph = new Float32Array(v * 3), cache = new Map();
    for (let k = 0; k < v; k++) { morphAt(l, pos[k * 3], pos[k * 3 + 2], morph, k * 3, cache); if ((k & 511) === 511) yield; }
    geometry.setAttribute('morph', new THREE.BufferAttribute(morph, 3));
    const colors = new Float32Array(v * 3), ka = new Float32Array(v * 4), kb = new Float32Array(v * 4), wl = new Float32Array(v);
    for (let k = 0; k < v; k++) {
      surfaceKit(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2], l, colors, ka, kb, wl, k);
      if ((k & 255) === 255) yield;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('kitA', new THREE.BufferAttribute(ka, 4));
    geometry.setAttribute('kitB', new THREE.BufferAttribute(kb, 4));
    geometry.setAttribute('water', new THREE.BufferAttribute(wl, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, 0, cz), half * 1.5 + 400);
    out.geometry = geometry;
  }
  const kitW = new Float32Array(7), cavCache = new Map();
  /** Concavity on the 12 m lattice (48 m for the farthest level; cached), bilinear between lattice points. Positive in hollows. */
  function cavityAt(x, z, cl) {
    const C = LEVELS[cl].cell, X = x / C, Z = z / C, i = Math.floor(X), j = Math.floor(Z), fx = X - i, fz = Z - j;
    const at = (a, b) => {
      const key = cl * 1e10 + a * 131072 + b; let c = cavCache.get(key);
      if (c === undefined) { c = ((vertex(cl, a + 1, b) + vertex(cl, a - 1, b) + vertex(cl, a, b + 1) + vertex(cl, a, b - 1)) * .25 - vertex(cl, a, b)) / C; cavCache.set(key, c); if (cavCache.size > 60000) cavCache.clear(); }
      return c;
    };
    return (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fz) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fz;
  }
  /** Ground kit weights and tint at a vertex: biome mix, forest floor, moisture, shores, beaches, roads, high pasture. */
  function surfaceKit(x, y, z, l, colors, ka, kb, wl, k) {
    const w = kitW; w.fill(0); let tr = 0, tg = 0, tb = 0;
    // Biome, blended over four nearby samples so boundaries read as soft transitions.
    for (const [dx, dz] of [[-5, -3], [4, -5], [-4, 5], [5, 4]]) {
      const b = world.biomeAt(x + dx, z + dz), m = BIOME_KIT[b] || BIOME_KIT[3], t = BIOME_TINT[b] || BIOME_TINT[3];
      for (let i = 0; i < 7; i++) w[i] += m[i] * .25;
      tr += t[0] * .25; tg += t[1] * .25; tb += t[2] * .25;
    }
    const forest = world.forestAt(x, z), moist = world.moistureAt(x, z);
    const shade = smooth(.35, .85, forest) * .7; w[2] += (w[0] + w[1]) * shade; w[0] *= 1 - shade; w[1] *= 1 - shade;
    const lush = Math.max(-1, Math.min(1, (moist - .5) * 1.2)) * .6;
    if (lush > 0) { const d = w[1] * lush; w[1] -= d; w[0] += d; } else { const d = w[0] * -lush; w[0] -= d; w[1] += d; }
    if (y > 70) { const t = smooth(70, 130, y) * .6, d = w[0] * t; w[0] -= d; w[1] += d; } // high pasture before the snowline
    let wet = 0;
    const water = world.waterAt(x, z), depth = water - y; wl[k] = water > -1e9 ? water : -1e4;
    if (depth > -1 && water > -1e9) { const t = smooth(-1, .1, depth); for (let i = 0; i < 4; i++) w[i] *= 1 - t * .85; w[4] += t * .85; wet = smooth(-1.2, .2, depth) * (depth > 0 ? .5 : 1); }
    if (depth > 0) { const t = smooth(.2, 7, depth); tr += (DEEP_TINT[0] - tr) * t; tg += (DEEP_TINT[1] - tg) * t; tb += (DEEP_TINT[2] - tb) * t; }
    if (y < 2.2 && y > -1 && water === 0) { const t = smooth(2.2, .6, y); for (let i = 0; i < 4; i++) w[i] *= 1 - t; w[4] += t; }
    if (l < 2) { const r = world.roadAt(x, z); if (r < 2.6) { const t = smooth(2.6, 1.2, r) * .9; for (let i = 0; i < 5; i++) if (i !== 3) w[i] *= 1 - t; w[3] += t; } }
    const sum = w[0] + w[1] + w[2] + w[3] + w[4] || 1;
    ka[k * 4] = w[0] / sum; ka[k * 4 + 1] = w[1] / sum; ka[k * 4 + 2] = w[2] / sum; ka[k * 4 + 3] = w[3] / sum;
    kb[k * 4] = w[4] / sum; kb[k * 4 + 1] = wet; kb[k * 4 + 2] = w[6]; kb[k * 4 + 3] = w[5];
    // Cavity: hollows and gullies a little darker, crests a little brighter (sky light they see), at one world scale so
    // every level agrees.
    const cav = cavityAt(x, z, Math.max(2, l));
    const ao = Math.min(1.06, Math.max(.76, 1 - cav * .9));
    colors[k * 3] = tr * ao; colors[k * 3 + 1] = tg * ao; colors[k * 3 + 2] = tb * ao;
  }
  function wantedConfig(fx, fz) {
    const cfg = []; let prev = null;
    levels.forEach((L, l) => { const cx = centreFor(L.spec, L.wantX ?? L.cx, fx), cz = centreFor(L.spec, L.wantZ ?? L.cz, fz); L.wantX = cx; L.wantZ = cz;
      const inner = prev ? {cx: prev.cx, cz: prev.cz, half: prev.half} : null; cfg.push({cx, cz, half: L.spec.segs * L.spec.cell / 2, inner, innerKey: inner ? `${inner.cx},${inner.cz}` : ''}); prev = cfg[l]; });
    return cfg;
  }
  function* buildAll(cfg) {
    const started = performance.now(), outs = [];
    for (const [l, L] of levels.entries()) {
      const c = cfg[l];
      if (L.built && L.cx === c.cx && L.cz === c.cz && L.innerKey === c.innerKey) { outs.push(null); continue; }
      const out = {}; yield* buildLevel(L, c.cx, c.cz, c.inner, out); outs.push(out);
    }
    for (const [l, L] of levels.entries()) {
      const out = outs[l]; if (!out) continue;
      L.mesh.geometry.dispose(); L.mesh.geometry = out.geometry; L.mesh.visible = true; L.built = true;
      L.cx = cfg[l].cx; L.cz = cfg[l].cz; L.innerKey = cfg[l].innerKey;
      L.ring.value.set(L.cx, L.cz, l < levels.length - 1 ? cfg[l].half : 1e9);
    }
    buildsDone++; lastBuildMs = performance.now() - started;
  }
  /** Earthworks changed near the view: patch the finest level in place (cheap), stitch rims follow on the next build. */
  function terrainChanged(dirty) {
    if (!world || !state) return;
    refreshEdits();
    const L = levels[0]; if (!L.built) return;
    const g = L.mesh.geometry, p = g.attributes.position;
    let changed = false;
    const rects = dirty ? dirty.map(e => { const r = (e.radius || 0) + 1; return [e.x - r, e.z - r, e.x + r, e.z + r]; }) : null;
    const side = L.spec.segs + 1, count = side * side;
    for (let k = 0; k < count; k++) {
      const x = p.array[k * 3], z = p.array[k * 3 + 2];
      if (rects && !rects.some(r => x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3])) continue;
      const y = Math.fround(full(x, z)); if (y !== p.array[k * 3 + 1]) { p.array[k * 3 + 1] = y; changed = true; }
    }
    if (changed) {
      p.needsUpdate = true; g.computeVertexNormals();
      const m = g.attributes.morph, cache = new Map();
      if (m) { for (let k = 0; k < count; k++) { const x = p.array[k * 3], z = p.array[k * 3 + 2]; if (rects && !rects.some(r => x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3])) continue; morphAt(0, x, z, m.array, k * 3, cache); } m.needsUpdate = true; }
    }
  }
  // ---------- water ----------
  let sea = null, lakes = null, rivers = null;
  function buildWater() {
    for (const m of [sea, lakes, rivers]) if (m) { group.remove(m); m.geometry.dispose(); }
    const seaGeo = new THREE.PlaneGeometry(30000, 30000, 1, 1); seaGeo.rotateX(-Math.PI / 2);
    seaGeo.setAttribute('water', new THREE.BufferAttribute(new Float32Array(4 * 3), 3));
    sea = new THREE.Mesh(seaGeo, waterMaterial); sea.name = 'wilds-sea'; sea.renderOrder = 1; sea.userData.ignoreContact = true; group.add(sea);
    // Lakes: the lake cells grown by one cell, as flat sheets at the spill level (terrain hides the overlap).
    const g = world.gen, N = g.n, cell = g.cell, half = g.half, [ox, oz] = world.offset, lakeId = g.grids.lakeId;
    const lp = [], li = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let id = -1;
      for (let b = -1; b <= 1 && id < 0; b++) for (let a = -1; a <= 1 && id < 0; a++) { const ii = i + a, jj = j + b; if (ii >= 0 && jj >= 0 && ii < N && jj < N && lakeId[jj * N + ii] >= 0) id = lakeId[jj * N + ii]; }
      if (id < 0) continue;
      const y = g.lakes[id].level, x0 = i * cell - half - ox, z0 = j * cell - half - oz, base = lp.length / 3;
      lp.push(x0, y, z0, x0 + cell, y, z0, x0, y, z0 + cell, x0 + cell, y, z0 + cell); li.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
    }
    const lakeGeo = new THREE.BufferGeometry(); lakeGeo.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); lakeGeo.setIndex(li);
    lakeGeo.setAttribute('water', new THREE.Float32BufferAttribute(new Float32Array(lp.length), 3)); lakeGeo.computeVertexNormals();
    lakes = new THREE.Mesh(lakeGeo, waterMaterial); lakes.name = 'wilds-lakes'; lakes.renderOrder = 1; lakes.userData.ignoreContact = true; group.add(lakes);
    // Rivers: ribbons on their surfaces; `water` carries (across, along, 1) so ripples run downstream.
    const rp = [], ri = [], rw = [];
    for (const r of world.rivers) {
      let along = 0;
      for (let k = 0; k < r.points.length; k++) {
        const p = r.points[k], q = r.points[Math.min(k + 1, r.points.length - 1)], o = r.points[Math.max(k - 1, 0)];
        let dx = q.x - o.x, dz = q.z - o.z; const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
        if (k) along += Math.hypot(p.x - r.points[k - 1].x, p.z - r.points[k - 1].z);
        const w = p.width * .5 + 1.4, base = rp.length / 3, y = p.surface + .02;
        rp.push(p.x - dz * w, y, p.z + dx * w, p.x + dz * w, y, p.z - dx * w);
        rw.push(-w, along, 1, w, along, 1);
        if (k) ri.push(base - 2, base, base - 1, base, base + 1, base - 1);
      }
    }
    const riverGeo = new THREE.BufferGeometry(); riverGeo.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
    riverGeo.setAttribute('water', new THREE.Float32BufferAttribute(rw, 3)); riverGeo.setIndex(ri); riverGeo.computeVertexNormals();
    // Ribbons may wind either way; make every normal face up.
    const rn = riverGeo.attributes.normal.array; for (let k = 0; k < rn.length; k += 3) { rn[k] = 0; rn[k + 1] = 1; rn[k + 2] = 0; }
    rivers = new THREE.Mesh(riverGeo, waterMaterial); rivers.name = 'wilds-rivers'; rivers.renderOrder = 2; rivers.userData.ignoreContact = true; group.add(rivers);
    waterMaterial.side = THREE.DoubleSide;
  }
  // ---------- far forests ----------
  const treeKinds = [makeTreeGeometry(0), makeTreeGeometry(1), makeTreeGeometry(2)];
  const treeMaterial = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .92, metalness: 0, flatShading: true});
  const treeMeshes = treeKinds.map((geo, v) => {
    const m = new THREE.InstancedMesh(geo, treeMaterial, Math.ceil(Q.cap * (v === 2 ? .45 : .7)));
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(m.count * 3), 3);
    m.count = 0; m.frustumCulled = false; m.name = 'wilds-trees-' + v; m.userData.ignoreContact = true; group.add(m); return m;
  });
  let treeJob = null, treeKey = '', treeAt = [NaN, NaN], treeCount = 0;
  // Impostors (once the species models have loaded and been baked) replace the faceted stand-ins above.
  let impostors = null, impostorFailed = false;
  const impFade = {value: new THREE.Vector2(Q.mid * 1.4, Q.far)};
  function tryImpostors() {
    if (impostors || impostorFailed || !templates || !renderer || renderer.xr?.isPresenting) return;
    const sources = impostorSources(templates, VARIANTS); if (!sources) return;
    try {
      const bake = bakeImpostors(renderer, sources, quality === 'low' ? 128 : 256);
      impostors = createImpostorField({bake, capacity: Math.ceil(Q.cap * 2), fade: impFade, time: kitTime}); group.add(impostors.mesh);
      for (const m of treeMeshes) { m.count = 0; m.visible = false; }
      treeKey = ''; treeJob = null; // rebuild the forest as impostors
    } catch (e) { impostorFailed = true; report('wilds-impostors', String(e?.message || e)); }
  }
  const VARIANT_BY_BIOME = {[BIOME.MEADOW]: [0, 0, 2], [BIOME.FOREST]: [0, 1, 2], [BIOME.PINE]: [1, 1, 2], [BIOME.MARSH]: [1, 1, 0], [BIOME.STEPPE]: [2, 0, 2], [BIOME.TUNDRA]: [2, 1, 2], [BIOME.BEACH]: [2, 2, 2]};
  const TREE_TINT = {[BIOME.PINE]: [.78, .9, .86], [BIOME.TUNDRA]: [.92, .9, .78], [BIOME.MARSH]: [.9, .95, .72], [BIOME.STEPPE]: [1.08, 1.02, .78]};
  function* buildTrees(fx, fz, skip, felled) {
    const lists = [[], [], []], mid2 = Q.mid * Q.mid, far2 = Q.far * Q.far, seed = world.gen.seedHash;
    const imp = impostors, room = v => imp ? imp.capacity / 2 : treeMeshes[v].instanceMatrix.count;
    const push = (v, x, z, h, tint) => { const L = lists[v]; if (L.length / 6 < room(v)) L.push(x, z, h, tint[0], tint[1], tint[2]); };
    // Exact generated trees between the live window and the mid radius.
    const r = Math.ceil(Q.mid / CHUNK);
    const ccx = Math.floor(fx / CHUNK), ccz = Math.floor(fz / CHUNK);
    for (let cz = ccz - r; cz <= ccz + r; cz++) {
      for (let cx = ccx - r; cx <= ccx + r; cx++) {
        if (skip.has(cx + ',' + cz)) continue;
        const mx = (cx + .5) * CHUNK - fx, mz = (cz + .5) * CHUNK - fz; if (mx * mx + mz * mz > mid2) continue;
        for (const t of chunkContent(world, cx, cz).trees) {
          if (felled.has(t.id)) continue;
          if (imp) { push(t.variant, t.x, t.z, t.height, [1, 1, 1]); continue; } // exactly as the live tree will draw it
          const b = world.biomeAt(t.x, t.z), shade = .85 + hash01(seed, 71, t.x * 7 | 0, t.z * 7 | 0) * .3, tint = TREE_TINT[b] || [1, 1, 1];
          push(t.variant, t.x, t.z, t.height, [tint[0] * shade, tint[1] * shade, tint[2] * shade]);
        }
        yield;
      }
    }
    // The far canopy from the forest grid: thinner with distance, same seed so it never shimmers.
    const g = world.gen, N = g.n, cell = g.cell, half = g.half, [ox, oz] = world.offset, forest = g.grids.forest, biome = g.grids.biome;
    const gi0 = Math.max(0, Math.floor((fx + ox - Q.far + half) / cell)), gi1 = Math.min(N - 1, Math.ceil((fx + ox + Q.far + half) / cell));
    const gj0 = Math.max(0, Math.floor((fz + oz - Q.far + half) / cell)), gj1 = Math.min(N - 1, Math.ceil((fz + oz + Q.far + half) / cell));
    for (let j = gj0; j <= gj1; j++) {
      for (let i = gi0; i <= gi1; i++) {
        const c = j * N + i, cover = forest[c]; if (cover < .2) continue;
        const b = biome[c], variants = VARIANT_BY_BIOME[b]; if (!variants) continue;
        const cxs = (i + .5) * cell - half - ox, czs = (j + .5) * cell - half - oz, dx = cxs - fx, dz = czs - fz, d2 = dx * dx + dz * dz;
        if (d2 < mid2 * .92 || d2 > far2) continue;
        const thin = impostors ? .8 : d2 > far2 * .3 ? .45 : .8, n = cover > .55 ? 2 : 1;
        for (let k = 0; k < n; k++) {
          if (hash01(seed, 81, i, j, k) > cover * thin) continue;
          const x = cxs + (hash01(seed, 82, i, j, k) - .5) * cell * .9, z = czs + (hash01(seed, 83, i, j, k) - .5) * cell * .9;
          const v = variants[Math.floor(hash01(seed, 84, i, j, k) * 3)], h = (v === 2 ? 4.4 : 6.6) * (.85 + hash01(seed, 85, i, j, k) * .45);
          const shade = .82 + hash01(seed, 86, i, j, k) * .3, tint = TREE_TINT[b] || [1, 1, 1];
          push(v, x, z, h * 1.15, [tint[0] * shade, tint[1] * shade, tint[2] * shade]);
        }
      }
      if ((j & 7) === 7) yield;
    }
    // Heights last (the costliest part), then write every instance in one go.
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const ys = lists.map(L => new Float32Array(L.length / 6));
    for (const [v, L] of lists.entries()) for (let k = 0; k < L.length / 6; k++) { ys[v][k] = world.heightAt(L[k * 6], L[k * 6 + 1]); if ((k & 511) === 511) yield; }
    treeCount = 0;
    if (imp) {
      const n = lists.reduce((a, L) => a + L.length / 6, 0), data = new Float32Array(n * 9); let o = 0;
      for (const [v, L] of lists.entries()) for (let k = 0; k < L.length / 6; k++, o += 9) {
        const x = L[k * 6], z = L[k * 6 + 1];
        data[o] = x; data[o + 1] = ys[v][k] - .1; data[o + 2] = z; data[o + 3] = treeScale({variant: v, height: L[k * 6 + 2]});
        data[o + 4] = v; data[o + 5] = hash01(seed, 92, x * 10 | 0, z * 10 | 0); data[o + 6] = L[k * 6 + 3]; data[o + 7] = L[k * 6 + 4]; data[o + 8] = L[k * 6 + 5];
      }
      imp.set(data, n); treeCount = imp.count(); return;
    }
    for (const [v, L] of lists.entries()) {
      const mesh = treeMeshes[v], n = L.length / 6;
      for (let k = 0; k < n; k++) {
        const x = L[k * 6], z = L[k * 6 + 1], h = L[k * 6 + 2];
        q.setFromAxisAngle(up, hash01(seed, 91, x * 10 | 0, z * 10 | 0) * 6.283);
        p.set(x, ys[v][k] - .15, z); s.set(h * (.9 + (k % 5) * .04), h, h * (.9 + (k % 3) * .05));
        mesh.setMatrixAt(k, m4.compose(p, q, s)); mesh.instanceColor.setXYZ(k, L[k * 6 + 3], L[k * 6 + 4], L[k * 6 + 5]);
      }
      mesh.count = n; mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; treeCount += n;
    }
  }
  // ---------- crags (tors, outcrops, boulders, spires) ----------
  // Solid landforms from the same chunk content the simulation collides with. Drawn everywhere within reach, live
  // window included (nothing else draws them). Tall ones (tors, spires) carry further so ridgelines keep their teeth.
  const CRAG_VARIANTS = 2, cragMaterial = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .95, metalness: 0, flatShading: true});
  const cragMeshes = CRAG_KINDS.map(kind => Array.from({length: CRAG_VARIANTS}, (_, v) => {
    const m = new THREE.InstancedMesh(makeCragGeometry(kind, v), cragMaterial, Math.ceil(Q.cap * (kind === 'boulder' ? .12 : .08)));
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(m.count * 3), 3);
    m.count = 0; m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; m.name = `wilds-crag-${kind}-${v}`; m.userData.ignoreContact = true; group.add(m); return m;
  }));
  const CRAG_TINT = {rock: [1, .97, .93], snow: [.95, .97, 1.03], tundra: [.93, .95, .98], pine: [.9, .93, .95], steppe: [1.08, 1, .86], beach: [1.1, 1.04, .9], meadow: [1.04, 1, .92], forest: [.94, .96, .9], marsh: [.88, .92, .86]};
  let cragJob = null, cragAt = [NaN, NaN], cragCount = 0;
  function* buildCrags(fx, fz) {
    const near = Q.mid * 1.1, far = Q.mid * 2.2, r = Math.ceil(far / CHUNK), ccx = Math.floor(fx / CHUNK), ccz = Math.floor(fz / CHUNK);
    const lists = cragMeshes.map(row => row.map(() => [])), seed = world.gen.seedHash;
    for (let cz = ccz - r; cz <= ccz + r; cz++) {
      for (let cx = ccx - r; cx <= ccx + r; cx++) {
        const mx = (cx + .5) * CHUNK - fx, mz = (cz + .5) * CHUNK - fz, d2 = mx * mx + mz * mz; if (d2 > far * far) continue;
        for (const g of chunkContent(world, cx, cz).crags) {
          if (d2 > near * near && g.kind !== 'tor' && g.kind !== 'spire') continue;
          const k = CRAG_KINDS.indexOf(g.kind), v = g.v % CRAG_VARIANTS, L = lists[k][v]; if (L.length >= cragMeshes[k][v].instanceMatrix.count) continue;
          L.push(g);
        }
        yield;
      }
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    cragCount = 0;
    for (const [k, row] of lists.entries()) for (const [v, L] of row.entries()) {
      const mesh = cragMeshes[k][v];
      L.forEach((g, n) => {
        // Seat it on the lowest ground under its footprint so no edge floats on a slope.
        const rr = g.r * .8, y = Math.min(world.heightAt(g.x, g.z), world.heightAt(g.x + rr, g.z), world.heightAt(g.x - rr, g.z), world.heightAt(g.x, g.z + rr), world.heightAt(g.x, g.z - rr));
        const lean = g.kind === 'outcrop' ? .32 : g.kind === 'spire' ? (hash01(seed, 97, n, k) - .5) * .14 : 0;
        e.set(lean, g.yaw, (hash01(seed, 98, g.x * 10 | 0, g.z * 10 | 0) - .5) * (g.kind === 'boulder' ? .5 : .1), 'YXZ'); q.setFromEuler(e);
        p.set(g.x, y - g.s * (g.kind === 'boulder' ? .22 : .12), g.z); sc.setScalar(g.s);
        mesh.setMatrixAt(n, m4.compose(p, q, sc));
        const t = CRAG_TINT[BIOME_NAMES[world.biomeAt(g.x, g.z)]] || [1, 1, 1], shade = .88 + hash01(seed, 99, g.x * 10 | 0, g.z * 10 | 0) * .22;
        mesh.instanceColor.setXYZ(n, t[0] * shade, t[1] * shade, t[2] * shade);
        if ((n & 127) === 127) return;
      });
      mesh.count = L.length; mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; cragCount += L.length;
      yield;
    }
  }
  // ---------- per frame ----------
  let time = 0;
  function setWorld(next, nextDescriptor) {
    if (next === world) return;
    world = next; descriptor = nextDescriptor || null; tiles = new Map(); cavCache.clear(); job = null; treeJob = null; treeKey = '';
    for (const L of levels) { L.built = false; L.cx = L.cz = L.wantX = L.wantZ = NaN; L.innerKey = ''; L.mesh.visible = false; }
    for (const m of treeMeshes) m.count = 0;
    for (const row of cragMeshes) for (const m of row) m.count = 0; cragJob = null; cragAt = [NaN, NaN];
    group.visible = !!world; ATMOSPHERE.bfAerial.value.set(world ? Q.aerial : 0, 220, world ? 1 : 0);
    if (world) { baseState.world = descriptor; buildWater(); }
  }
  /** Run queued builds for up to `budget` ms (a bigger budget on the loading screen). */
  function pump(budget) {
    const t0 = performance.now();
    while (performance.now() - t0 < budget) {
      if (job) { if (job.next().done) job = null; continue; }
      if (treeJob) { if (treeJob.next().done) treeJob = null; continue; }
      if (cragJob) { if (cragJob.next().done) cragJob = null; continue; }
      break;
    }
  }
  function update({focus, camera, snapshot, dt = 0, budget = Q.budget}) {
    if (!world || !snapshot) return;
    time += dt; waterMaterial.userData.time.value = time; kitFocus.value.set(focus.x, focus.z); kitTime.value = time;
    if (bake !== snapshot.terrainBake) { bake = snapshot.terrainBake; baseState.terrainBake = bake; tiles = new Map(); for (const L of levels) L.innerKey = 'stale'; }
    state = snapshot; const ek = (snapshot.edits || []).length + '|' + (snapshot.inventions?.structures || []).length; if (ek !== editKey) { editKey = ek; refreshEdits(); }
    if (!job) {
      const cfg = wantedConfig(focus.x, focus.z);
      if (levels.some((L, l) => !L.built || L.cx !== cfg[l].cx || L.cz !== cfg[l].cz || L.innerKey !== cfg[l].innerKey)) job = buildAll(cfg);
    }
    tryImpostors();
    if (!treeJob) {
      const skip = new Set(activeChunks(snapshot).map(([a, b]) => a + ',' + b)), felled = snapshot.wilds?.felled || [];
      const key = [...skip].join(';') + '|' + felled.length + '|' + (snapshot.harvestedTrees || []).length;
      if (key !== treeKey || Math.hypot(focus.x - treeAt[0], focus.z - treeAt[1]) > 40 || !Number.isFinite(treeAt[0])) {
        treeKey = key; treeAt = [focus.x, focus.z];
        treeJob = buildTrees(focus.x, focus.z, skip, new Set(felled.map(f => f[0]).concat((snapshot.harvestedTrees || []).map(h => h.id))));
      }
    }
    if (!cragJob && (!Number.isFinite(cragAt[0]) || Math.hypot(focus.x - cragAt[0], focus.z - cragAt[1]) > 30)) { cragAt = [focus.x, focus.z]; cragJob = buildCrags(focus.x, focus.z); }
    pump(budget);
    if (sea && camera) { sea.position.set(Math.round(camera.position.x / 64) * 64, 0, Math.round(camera.position.z / 64) * 64); }
  }
  /** Synchronous first build (loading screen): every level and the forests. */
  function prime({focus, snapshot}) { update({focus, camera: null, snapshot, budget: 0}); while (job || treeJob || cragJob) pump(50); }
  function dispose() {
    scene.remove(group);
    for (const L of levels) { L.mesh.geometry.dispose(); L.mesh.material.dispose(); }
    ATMOSPHERE.bfAerial.value.x = 0;
    for (const m of [sea, lakes, rivers]) m?.geometry.dispose();
    for (const m of treeMeshes) { m.geometry.dispose(); m.dispose?.(); }
    impostors?.dispose();
    for (const row of cragMeshes) for (const m of row) { m.geometry.dispose(); m.dispose?.(); }
    waterMaterial.dispose(); treeMaterial.dispose(); cragMaterial.dispose();
  }
  return {group, setWorld, update, prime, terrainChanged, fog: {near: Q.fogNear, far: Q.fogFar}, active: () => !!world,
    nearMesh: () => levels[0].mesh, building: () => !!job || !!treeJob,
    stats: () => ({levels: levels.map(L => [L.cx, L.cz, L.mesh.geometry.index?.count / 3 | 0]), tiles: tiles.size, trees: treeCount, builds: buildsDone, lastBuildMs: Math.round(lastBuildMs)}), dispose};
}

// ---------- materials ----------
function createWaterMaterial() {
  // Clear water: what you see of depth is the ground's own absorption and caustics underneath (kit ground material);
  // the surface adds sky reflection, sun glints, rings of ripples and, on rivers, foam streaks running downstream.
  const material = new THREE.MeshStandardMaterial({color: 0x1d6e82, roughness: .06, metalness: 0, transparent: true, opacity: .85, depthWrite: false, envMapIntensity: 1.15});
  const time = {value: 0}; material.userData.time = time;
  material.onBeforeCompile = shader => {
    shader.uniforms.wTime = time;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 water; varying vec3 vWater; varying vec3 vWWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWater = water; vWWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        uniform float wTime; varying vec3 vWater; varying vec3 vWWorld;
        float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float wNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(wHash(i), wHash(i + vec2(1, 0)), f.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), f.x), f.y); }
        // Gradient of a few travelling wave trains at different angles and lengths: no visible grid, no single direction.
        vec2 wWaves(vec2 p, float t) {
          vec2 g = vec2(0.0);
          const int N = 6;
          for (int i = 0; i < N; i++) {
            float fi = float(i), a = fi * 2.399 + .4, k = .28 * pow(1.55, fi), amp = 1.0 / (1.0 + fi * .9);
            vec2 d = vec2(cos(a), sin(a));
            g += d * cos(dot(d, p) * k + t * sqrt(9.8 * k) * .55 + fi * 1.7) * amp * k;
          }
          return g;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float wRiver = vWater.z;
        vec2 wP = mix(vWWorld.xz, vec2(vWater.x, vWater.y - wTime * 1.6), wRiver);
        float wDist = length(vWWorld - cameraPosition);
        // Foam streaks on rivers, stretched along the flow.
        float wStreak = wRiver * .6 * smoothstep(.72, .9, wNoise(vec2(wP.x * 1.4, wP.y * .22)) * .7 + wNoise(vec2(wP.x * 3.1, wP.y * .5)) * .3) * (1.0 - smoothstep(30.0, 160.0, wDist));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.9, .94, .95), wStreak * .8);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float fade = 1.0 - smoothstep(30.0, 260.0, wDist);
          vec2 g = wWaves(wP, wTime) * (.05 + wRiver * .03);
          vec2 q = wP * 1.7 + vec2(wTime * .4, -wTime * .3);
          g += (vec2(wNoise(q + vec2(.13, 0)), wNoise(q + vec2(0, .13))) - wNoise(q)) * 1.6 * fade;
          g *= mix(.35, 1.0, fade);
          normal = normalize(normal + (viewMatrix * vec4(-g.x, 0.0, -g.y, 0.0)).xyz);
          float fr = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 4.0);
          diffuseColor.a = clamp(mix(.4, .97, fr) + wStreak * .5, 0.0, 1.0);
        }`);
  };
  material.customProgramCacheKey = () => 'wilds-water-v2';
  return material;
}
// Faceted low-poly trees, unit height, coloured per vertex (bark, shaded crown). v0 broad, v1 weeping, v2 young.
function makeTreeGeometry(variant) {
  const parts = [];
  const paint = (geo, top, bottom, y0, y1) => {
    const p = geo.attributes.position, c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { const t = Math.min(1, Math.max(0, (p.getY(i) - y0) / (y1 - y0))); for (let k = 0; k < 3; k++) c[i * 3 + k] = bottom[k] + (top[k] - bottom[k]) * t; }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); return geo;
  };
  const bark = new THREE.Color(0x6b4a33).toArray(), barkDark = new THREE.Color(0x4a3323).toArray();
  const leaf = new THREE.Color([0x6aa53f, 0x5f9a52, 0x86b84a][variant]).toArray(), leafDark = new THREE.Color([0x3f6e2a, 0x37643a, 0x4f7f2c][variant]).toArray();
  const trunkH = [.42, .38, .45][variant], trunkR = [.05, .045, .03][variant];
  const trunk = new THREE.CylinderGeometry(trunkR * .7, trunkR, trunkH, 5, 1).translate(0, trunkH / 2, 0);
  parts.push(paint(trunk.toNonIndexed(), bark, barkDark, 0, trunkH));
  const blobs = variant === 0 ? [[0, .66, 0, .3], [.14, .58, .08, .2], [-.13, .6, -.06, .21], [.02, .82, -.03, .19]]
    : variant === 1 ? [[0, .62, 0, .22], [0, .8, 0, .17], [.1, .5, .05, .16], [-.1, .52, -.06, .16]]
    : [[0, .7, 0, .19], [0, .88, 0, .12]];
  for (const [x, y, z, r] of blobs) {
    const g = new THREE.IcosahedronGeometry(r, 0); g.scale(1, variant === 1 ? 1.25 : variant === 2 ? 1.3 : .92, 1); g.translate(x, y, z);
    parts.push(paint(g.index ? g.toNonIndexed() : g, leaf, leafDark, y - r, y + r));
  }
  const merged = mergeGeometries(parts.map(g => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k); return g; }));
  merged.computeVertexNormals();
  return merged;
}

// Faceted crags at unit size, coloured per vertex: warm weathered stone, darker in the cracks and at the foot, a
// lichen-and-moss cap on the upward faces. kind: tor (stacked blocks), outcrop (a leaning slab breaking from the
// ground), boulder (rounded stone), spire (tapering needle). Two shape variants each, fixed per variant (no shimmer).
function makeCragGeometry(kind, variant) {
  let seed = 9173 + variant * 7919 + kind.length * 31;
  const rnd = () => (seed = Math.imul(seed ^ seed >>> 15, 0x2c1b3c6d) + 0x6d2b79f5 >>> 0, (seed >>> 8) / 16777216);
  const stone = new THREE.Color(0xa49a8c), stoneDark = new THREE.Color(0x6f675e), lichen = new THREE.Color(0x8fae5a), moss = new THREE.Color(0x6e9444);
  const parts = [];
  const block = (geo, x, y, z, sx, sy, sz, yaw = 0, jitter = .12) => {
    const g = geo.index ? geo.toNonIndexed() : geo, p = g.attributes.position;
    // Jitter shared corners together (same position, same nudge) so the faceted block stays closed.
    const nudge = new Map();
    for (let i = 0; i < p.count; i++) {
      const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      if (!nudge.has(key)) nudge.set(key, [1 + (rnd() - .5) * jitter * 2, 1 + (rnd() - .5) * jitter * 2, 1 + (rnd() - .5) * jitter * 2]);
      const [a, b, c] = nudge.get(key); p.setXYZ(i, p.getX(i) * a, p.getY(i) * b, p.getZ(i) * c);
    }
    g.scale(sx, sy, sz); g.rotateY(yaw); g.translate(x, y, z); parts.push(g);
  };
  if (kind === 'tor') {
    let y = 0; const n = 3 + variant;
    for (let k = 0; k < n; k++) { const w = .62 - k * .1 + rnd() * .08, h = .22 + rnd() * .1; block(new THREE.DodecahedronGeometry(1, 0), (rnd() - .5) * .14, y + h * .5, (rnd() - .5) * .14, w, h * .62, w * (.8 + rnd() * .25), rnd() * 3); y += h * .82; }
    block(new THREE.DodecahedronGeometry(1, 0), .5, .12, .22, .22, .16, .2, rnd() * 3); block(new THREE.DodecahedronGeometry(1, 0), -.42, .1, -.3, .18, .13, .17, rnd() * 3);
  } else if (kind === 'outcrop') {
    block(new THREE.BoxGeometry(1, 1, 1, 2, 2, 2), 0, .32, 0, .5, .72, .9 + variant * .2, 0, .14);
    block(new THREE.BoxGeometry(1, 1, 1, 1, 2, 1), .3, .2, -.32, .3, .44, .4, .4, .16);
    block(new THREE.DodecahedronGeometry(1, 0), -.32, .06, .4, .2, .12, .2, rnd() * 3);
  } else if (kind === 'boulder') {
    block(new THREE.IcosahedronGeometry(1, 1), 0, .34, 0, .52, .4 + variant * .06, .48, 0, .16);
  } else {
    let y = 0; const n = 4 + variant;
    // A weathered rock stack: broad footing, chunky leaning blocks, a blunt cap (not a needle).
    let lean = 0;
    for (let k = 0; k < n; k++) { const w = .5 * (1 - k / (n + 1.4)), h = 1.8 / n; block(new THREE.CylinderGeometry(w * .8, w, h, 5 + (k & 1), 1), lean + (rnd() - .5) * .08, y + h * .5, (rnd() - .5) * .08, 1, 1, 1, rnd() * 3, .18); y += h * .94; lean += .03; }
    block(new THREE.DodecahedronGeometry(1, 0), lean, y, 0, .2, .14, .18, rnd() * 3);
    block(new THREE.DodecahedronGeometry(1, 0), .42, .14, .12, .26, .2, .24, rnd() * 3); block(new THREE.DodecahedronGeometry(1, 0), -.36, .1, -.28, .2, .14, .2, rnd() * 3);
  }
  const merged = mergeGeometries(parts.map(g => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k); return g; }));
  merged.computeVertexNormals();
  // Colour by facing and height: moss on the tops, darker in the low crevices, a little speckle per face.
  const p = merged.attributes.position, nrm = merged.attributes.normal, col = new Float32Array(p.count * 3), c = new THREE.Color();
  let top = 0; for (let i = 0; i < p.count; i++) top = Math.max(top, p.getY(i));
  for (let i = 0; i < p.count; i += 3) {
    const ny = (nrm.getY(i) + nrm.getY(i + 1) + nrm.getY(i + 2)) / 3, y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, speck = .92 + rnd() * .16;
    c.copy(stoneDark).lerp(stone, Math.min(1, .35 + y / Math.max(.01, top) * .9));
    if (ny > .55) c.lerp(rnd() < .5 ? lichen : moss, Math.min(.85, (ny - .55) * 2.4));
    c.multiplyScalar(speck);
    for (let k = 0; k < 3; k++) { col[(i + k) * 3] = c.r; col[(i + k) * 3 + 1] = c.g; col[(i + k) * 3 + 2] = c.b; }
  }
  merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return merged;
}
