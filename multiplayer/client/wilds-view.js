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
import {loadDeliveredTexture} from './texture-delivery.js';

const LEVELS = Object.freeze([
  {cell: .75, segs: 160, snap: 24},
  {cell: 3, segs: 160, snap: 96},
  {cell: 12, segs: 160, snap: 384},
  {cell: 48, segs: 128, snap: 1536},
]);
const TILE = 32, TILE_MAX = 900;
const QUALITY = {
  high: {budget: 4, mid: 230, far: 1500, cap: 16000, fogNear: 2.2, fogFar: 10},
  low: {budget: 2.5, mid: 150, far: 950, cap: 7000, fogNear: 2, fogFar: 6.5},
};
// Cheerful crafted palette (sRGB), one per generator biome id.
const BIOME_HEX = [0xd9c99a, 0x8f8a62, 0xe6d6a2, 0x86b552, 0x5e8f3c, 0x58804a, 0x748f4c, 0xbfae63, 0x8f877b, 0xf3f6f8, 0x9ea47e];
const BIOME_RGB = BIOME_HEX.map(h => new THREE.Color(h).toArray());
const ROCK = new THREE.Color(0x7d7468).toArray(), ALPINE = new THREE.Color(0x8d9a6a).toArray(), DIRT = new THREE.Color(0xa98b5e).toArray(), WET = new THREE.Color(0x5f5a3c).toArray();
const SAND = new THREE.Color(0xd8c690).toArray(), DEEP = new THREE.Color(0x2c6f78).toArray(), SNOW = new THREE.Color(0xf4f7fa).toArray();
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp3 = (out, c, t) => { out[0] += (c[0] - out[0]) * t; out[1] += (c[1] - out[1]) * t; out[2] += (c[2] - out[2]) * t; };

export function createWildsView({scene, renderer = null, quality = 'high', assetBase = '/assets/', report = () => {}}) {
  const Q = QUALITY[quality] || QUALITY.high;
  const group = new THREE.Group(); group.name = 'wilds'; group.visible = false; scene.add(group);
  const terrainMaterial = createTerrainMaterial(assetBase);
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
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), terrainMaterial);
    mesh.name = 'wilds-terrain-' + l; mesh.frustumCulled = false; mesh.visible = false; mesh.receiveShadow = l < 2;
    mesh.userData.ignoreContact = true; group.add(mesh);
    return {spec, l, mesh, cx: NaN, cz: NaN, innerKey: '', built: false};
  });
  let job = null, pending = null, buildsDone = 0, lastBuildMs = 0;
  const centreFor = (spec, cur, f) => (Number.isFinite(cur) && Math.abs(f - cur) <= spec.snap * .75) ? cur : Math.round(f / spec.snap) * spec.snap;
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
    const fine = (x, z) => { const fc = LEVELS[l - 1].cell, ix = Math.round(x / fc), iz = Math.round(z / fc); pos[v * 3] = x; pos[v * 3 + 1] = vertex(l - 1, ix, iz); pos[v * 3 + 2] = z; lat[v * 3] = l - 1; lat[v * 3 + 1] = ix; lat[v * 3 + 2] = iz; return v++; };
    // Edge A->B on the hole, C/D the outer vertices beside A/B: fan through the three finer points between A and B.
    const fan = (A, B, C, D) => {
      const ax = pos[A * 3], az = pos[A * 3 + 2], bx = pos[B * 3], bz = pos[B * 3 + 2];
      const f = [1, 2, 3].map(k => fine(ax + (bx - ax) * k / 4, az + (bz - az) * k / 4));
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
    // Normals from central differences on each vertex's own lattice: rims share their finer neighbour's shading exactly.
    const nrm = new Float32Array(v * 3);
    for (let k = 0; k < v; k++) {
      const lv = lat[k * 3], ix = lat[k * 3 + 1], iz = lat[k * 3 + 2], c2 = 2 * LEVELS[lv].cell;
      const nx = (vertex(lv, ix - 1, iz) - vertex(lv, ix + 1, iz)) / c2, nz = (vertex(lv, ix, iz - 1) - vertex(lv, ix, iz + 1)) / c2, len = Math.sqrt(nx * nx + 1 + nz * nz);
      nrm[k * 3] = nx / len; nrm[k * 3 + 1] = 1 / len; nrm[k * 3 + 2] = nz / len;
      if ((k & 1023) === 1023) yield;
    }
    geometry.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    const colors = new Float32Array(v * 3), surf = new Float32Array(v * 2), c = [0, 0, 0];
    for (let k = 0; k < v; k++) {
      surfaceColor(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2], nrm[k * 3 + 1], l, c, surf, k);
      colors[k * 3] = c[0]; colors[k * 3 + 1] = c[1]; colors[k * 3 + 2] = c[2];
      if ((k & 511) === 511) yield;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('surf', new THREE.BufferAttribute(surf, 2));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, 0, cz), half * 1.5 + 400);
    out.geometry = geometry;
  }
  const tmpBiome = [0, 0, 0];
  function surfaceColor(x, y, z, ny, l, c, surf, k) {
    // Biome colour, blended over four nearby samples so boundaries read as soft transitions.
    c[0] = c[1] = c[2] = 0;
    for (const [dx, dz] of [[-5, -3], [4, -5], [-4, 5], [5, 4]]) { const b = BIOME_RGB[world.biomeAt(x + dx, z + dz)] || BIOME_RGB[3]; c[0] += b[0] * .25; c[1] += b[1] * .25; c[2] += b[2] * .25; }
    const forest = world.forestAt(x, z), wetness = world.moistureAt(x, z);
    c[0] *= 1 - forest * .22; c[1] *= 1 - forest * .1; c[2] *= 1 - forest * .2;  // shaded forest floor
    c[1] *= .94 + wetness * .1;
    let rock = smooth(.82, .62, ny), soil = 0;
    const water = world.waterAt(x, z), depth = water - y;
    if (depth > -1.2 && water > -1e9) { const wet = smooth(-1.2, .05, depth); lerp3(c, depth > 0 ? SAND : WET, wet * .8); soil = Math.max(soil, wet); rock *= 1 - wet; }
    if (depth > 0) { lerp3(c, DEEP, smooth(.2, 7, depth)); }
    if (y < 2.2 && y > -1 && water === 0) { lerp3(c, SAND, smooth(2.2, .6, y)); soil = Math.max(soil, smooth(2.2, .6, y)); }
    if (l < 2 && world.roadAt(x, z) < 2.6) { const t = smooth(2.6, 1.2, world.roadAt(x, z)); lerp3(c, DIRT, t * .85); soil = Math.max(soil, t); }
    if (y > 70) lerp3(c, ALPINE, smooth(70, 130, y) * .5 * (1 - rock)); // high pasture before the snowline
    lerp3(c, ROCK, rock);
    if (y > 135) { const s = smooth(135, 185, y + world.forestAt(x, z) * -40) * smooth(.6, .85, ny); lerp3(c, SNOW, s); rock *= 1 - s; }
    surf[k * 2] = rock; surf[k * 2 + 1] = soil;
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
    if (changed) { p.needsUpdate = true; g.computeVertexNormals(); }
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
  const VARIANT_BY_BIOME = {[BIOME.MEADOW]: [0, 0, 2], [BIOME.FOREST]: [0, 1, 2], [BIOME.PINE]: [1, 1, 2], [BIOME.MARSH]: [1, 1, 0], [BIOME.STEPPE]: [2, 0, 2], [BIOME.TUNDRA]: [2, 1, 2], [BIOME.BEACH]: [2, 2, 2]};
  const TREE_TINT = {[BIOME.PINE]: [.78, .9, .86], [BIOME.TUNDRA]: [.92, .9, .78], [BIOME.MARSH]: [.9, .95, .72], [BIOME.STEPPE]: [1.08, 1.02, .78]};
  function* buildTrees(fx, fz, skip, felled) {
    const lists = [[], [], []], mid2 = Q.mid * Q.mid, far2 = Q.far * Q.far, seed = world.gen.seedHash;
    const push = (v, x, z, h, tint) => { const L = lists[v]; if (L.length / 6 < treeMeshes[v].instanceMatrix.count) L.push(x, z, h, tint[0], tint[1], tint[2]); };
    // Exact generated trees between the live window and the mid radius.
    const r = Math.ceil(Q.mid / CHUNK);
    const ccx = Math.floor(fx / CHUNK), ccz = Math.floor(fz / CHUNK);
    for (let cz = ccz - r; cz <= ccz + r; cz++) {
      for (let cx = ccx - r; cx <= ccx + r; cx++) {
        if (skip.has(cx + ',' + cz)) continue;
        const mx = (cx + .5) * CHUNK - fx, mz = (cz + .5) * CHUNK - fz; if (mx * mx + mz * mz > mid2) continue;
        for (const t of chunkContent(world, cx, cz).trees) {
          if (felled.has(t.id)) continue;
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
        const thin = d2 > far2 * .3 ? .45 : .8, n = cover > .55 ? 2 : 1;
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
    world = next; descriptor = nextDescriptor || null; tiles = new Map(); job = null; treeJob = null; treeKey = '';
    for (const L of levels) { L.built = false; L.cx = L.cz = L.wantX = L.wantZ = NaN; L.innerKey = ''; L.mesh.visible = false; }
    for (const m of treeMeshes) m.count = 0;
    for (const row of cragMeshes) for (const m of row) m.count = 0; cragJob = null; cragAt = [NaN, NaN];
    group.visible = !!world;
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
    time += dt; waterMaterial.userData.time.value = time;
    if (bake !== snapshot.terrainBake) { bake = snapshot.terrainBake; baseState.terrainBake = bake; tiles = new Map(); for (const L of levels) L.innerKey = 'stale'; }
    state = snapshot; const ek = (snapshot.edits || []).length + '|' + (snapshot.inventions?.structures || []).length; if (ek !== editKey) { editKey = ek; refreshEdits(); }
    if (!job) {
      const cfg = wantedConfig(focus.x, focus.z);
      if (levels.some((L, l) => !L.built || L.cx !== cfg[l].cx || L.cz !== cfg[l].cz || L.innerKey !== cfg[l].innerKey)) job = buildAll(cfg);
    }
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
    for (const L of levels) L.mesh.geometry.dispose();
    for (const m of [sea, lakes, rivers]) m?.geometry.dispose();
    for (const m of treeMeshes) { m.geometry.dispose(); m.dispose?.(); }
    for (const row of cragMeshes) for (const m of row) { m.geometry.dispose(); m.dispose?.(); }
    terrainMaterial.dispose(); waterMaterial.dispose(); treeMaterial.dispose(); cragMaterial.dispose();
  }
  return {group, setWorld, update, prime, terrainChanged, fog: {near: Q.fogNear, far: Q.fogFar}, active: () => !!world,
    nearMesh: () => levels[0].mesh, building: () => !!job || !!treeJob,
    stats: () => ({levels: levels.map(L => [L.cx, L.cz, L.mesh.geometry.index?.count / 3 | 0]), tiles: tiles.size, trees: treeCount, builds: buildsDone, lastBuildMs: Math.round(lastBuildMs)}), dispose};
}

// ---------- materials ----------
function createTerrainMaterial(assetBase) {
  const flat = rgb => { const t = new THREE.DataTexture(new Uint8Array([...rgb, 255]), 1, 1); t.needsUpdate = true; return t; };
  const uniforms = {
    wGrass: {value: flat([128, 128, 128])}, wSoil: {value: flat([128, 128, 128])}, wRock: {value: flat([128, 128, 128])},
    wMean: {value: new THREE.Matrix3().set(.5, .5, .5, .5, .5, .5, .5, .5, .5)},
  };
  const material = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .96, metalness: 0});
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 surf; varying vec2 vSurf; varying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSurf = surf; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D wGrass, wSoil, wRock; uniform mat3 wMean; varying vec2 vSurf; varying vec3 vWPos;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float dist = length(vWPos - cameraPosition);
          vec3 g = texture2D(wGrass, vWPos.xz / 3.0).rgb / max(wMean[0], vec3(.02));
          vec3 g2 = texture2D(wGrass, vWPos.zx / 17.0 + .37).rgb / max(wMean[0], vec3(.02));
          vec3 s = texture2D(wSoil, vWPos.xz / 2.2).rgb / max(wMean[1], vec3(.02));
          vec3 r = texture2D(wRock, vec2(vWPos.x + vWPos.z, vWPos.y * 1.6) / 5.0).rgb / max(wMean[2], vec3(.02));
          vec3 detail = mix(mix(g, s, vSurf.y), r, vSurf.x);
          float near = 1.0 - smoothstep(30.0, 240.0, dist), mid = 1.0 - smoothstep(120.0, 900.0, dist);
          detail = mix(vec3(1.0), detail, near * .85);
          detail *= mix(1.0, mix(.86, 1.12, clamp(g2.g * .5, 0.0, 1.0)), mid * (1.0 - vSurf.x)); // large-scale meadow variation
          diffuseColor.rgb *= clamp(detail, 0.35, 1.8);
        }`);
  };
  material.customProgramCacheKey = () => 'wilds-terrain-v1';
  if (typeof document !== 'undefined') {
    const loader = new THREE.TextureLoader();
    const slots = [['meadow_albedo', 'wGrass', 0], ['orchard_soil_albedo', 'wSoil', 1], ['terrain_strata_albedo', 'wRock', 2]];
    for (const [name, slot, row] of slots) loadDeliveredTexture(loader, `${assetBase}${name}.png`, tex => {
      tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = 4; tex.needsUpdate = true;
      uniforms[slot].value = tex;
      try { // mean colour (linear) so the texture only adds detail; the biome colour stays in charge
        const cv = document.createElement('canvas'); cv.width = cv.height = 4; const ctx = cv.getContext('2d'); ctx.drawImage(tex.image, 0, 0, 4, 4);
        const d = ctx.getImageData(0, 0, 4, 4).data; let r = 0, g = 0, b = 0; for (let i = 0; i < 64; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
        const c = new THREE.Color().setRGB(r / 16 / 255, g / 16 / 255, b / 16 / 255, THREE.SRGBColorSpace), e = uniforms.wMean.value.elements;
        e[row * 3] = c.r; e[row * 3 + 1] = c.g; e[row * 3 + 2] = c.b;
      } catch {}
    }, undefined, () => {});
  }
  return material;
}
function createWaterMaterial() {
  const material = new THREE.MeshStandardMaterial({color: 0x2e8fa3, roughness: .08, metalness: 0, transparent: true, opacity: .85, depthWrite: false, envMapIntensity: 1.3});
  const time = {value: 0}; material.userData.time = time;
  material.onBeforeCompile = shader => {
    shader.uniforms.wTime = time;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 water; varying vec3 vWater; varying vec3 vWWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWater = water; vWWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float wTime; varying vec3 vWater; varying vec3 vWWorld;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float river = vWater.z;
          vec2 p = mix(vWWorld.xz, vec2(vWater.x, vWater.y - wTime * 1.6), river);
          float t = wTime;
          vec2 g = vec2(sin(p.x * .35 + t * 1.1) + .8 * sin(p.x * .21 + p.y * .27 - t * .9) + .3 * sin(p.y * .93 + t * 1.7),
                        sin(p.y * .31 - t * 1.0) + .8 * sin(p.y * .19 - p.x * .25 + t * .8) + .3 * sin(p.x * .87 - t * 1.5));
          g += vec2(sin(p.x * 1.9 + p.y * .7 + t * 2.6), sin(p.y * 2.1 - p.x * .6 - t * 2.3)) * .35;
          float fade = 1.0 - smoothstep(40.0, 400.0, length(vWWorld - cameraPosition));
          normal = normalize(normal + (viewMatrix * vec4(g.x * .07 * fade, 0.0, g.y * .07 * fade, 0.0)).xyz);
          float fr = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
          diffuseColor.a = mix(.62, .97, fr);
        }`);
  };
  material.customProgramCacheKey = () => 'wilds-water-v1';
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
    for (let k = 0; k < n; k++) { const w = .34 * (1 - k / (n + .6)), h = 2.4 / n; block(new THREE.CylinderGeometry(w * .82, w, h, 6, 1), (rnd() - .5) * .05, y + h * .5, (rnd() - .5) * .05, 1, 1, 1, rnd() * 3, .1); y += h * .96; }
    block(new THREE.DodecahedronGeometry(1, 0), .26, .12, .1, .2, .16, .2, rnd() * 3);
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
