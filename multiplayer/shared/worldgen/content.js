// Generated world content in 64 m chunks (sim coordinates): choppable trees, mineable deposits and ground dressing.
// Deterministic per (world, chunk): every device derives the same trees with the same stable ids, so the simulation
// only ever stores what players CHANGED (felled trees, spent rocks) and never the baseline itself.
//
// Stable ids: trees `wt{cx}_{cz}_{n}`, deposits `wr{cx}_{cz}_{n}` (cx/cz may be negative). Decor has no ids.
// The simulation keeps a small active window of chunks around Heroes (activeChunks) in its tree/deposit lists;
// renderers draw everything else from the same functions.
import {hash01, hashInts} from './random.js';
import {TREE_TAGS, RESOURCE_TAGS, DECOR_TAGS} from './asset-tags.js';
import {BIOME_NAMES, atanQ2} from './generate.js';
import {DEPOSIT_CATALOG} from '../material-catalog.js';

export const CHUNK = 64;
export const ACTIVE_RADIUS = 80;   // metres around a Hero whose trees/rocks are live in the simulation
const TREE_CELL = 4.6;             // jittered candidate lattice for trees
const ROCK_TRIES = 7;
const CACHE_MAX = 2048;
const cache = new WeakMap();       // world -> Map(chunkKey -> content)

export const chunkKey = (cx, cz) => `${cx},${cz}`;
export const chunkOf = (x, z) => [Math.floor(x / CHUNK), Math.floor(z / CHUNK)];
const TREE_ID = /^wt(-?\d{1,4})_(-?\d{1,4})_(\d{1,4})$/, ROCK_ID = /^wr(-?\d{1,4})_(-?\d{1,4})_(\d{1,3})$/;
export const isGeneratedTreeId = id => TREE_ID.test(id);
export const isGeneratedRockId = id => ROCK_ID.test(id);

/** Keep-clear test shared by trees, rocks and decor: water, roads, settlement yards, entrances, the forge apron. */
function blocked(world, x, z, pad) {
  if (x * x + z * z < (world.plaza.radius + 6 + pad) * (world.plaza.radius + 6 + pad)) return true;
  if (x < world.walkBounds.minX || x > world.walkBounds.maxX || z < world.walkBounds.minZ || z > world.walkBounds.maxZ) return true;
  for (const s of world.settlements) if (!s.start) { const dx = x - s.x, dz = z - s.z, r = s.radius * .7 + pad; if (dx * dx + dz * dz < r * r) return true; }
  for (const e of world.entrances) { const dx = x - e.x, dz = z - e.z; if (dx * dx + dz * dz < (12 + pad) * (12 + pad)) return true; }
  for (const d of world.discoveries) { const dx = x - d.x, dz = z - d.z; if (dx * dx + dz * dz < (7.5 + pad) * (7.5 + pad)) return true; }
  if (world.roadAt(x, z) < 4.5 + pad) return true;
  return world.isWater(x, z) || world.isWater(x + 1.5, z) || world.isWater(x - 1.5, z) || world.isWater(x, z + 1.5) || world.isWater(x, z - 1.5);
}
const pickWeighted = (tags, biome, r) => {
  let total = 0; for (const t of tags) total += t.biomes[biome] || 0;
  if (!total) return null;
  let v = r * total; for (const t of tags) { v -= t.biomes[biome] || 0; if (v <= 0) return t; }
  return null;
};

/** Content of one chunk: {cx, cz, trees:[{id,x,z,height,variant}], rocks:[{id,x,z,kind}], decor:[{asset,x,z,yaw,scale}],
 *  crags:[{x,z,kind,yaw,s,r,h}]} (crags are solid landforms, not resources: see craggery). */
export function chunkContent(world, cx, cz) {
  let map = cache.get(world); if (!map) { map = new Map(); cache.set(world, map); }
  const key = chunkKey(cx, cz); let c = map.get(key);
  if (c) return c;
  const seed = world.gen.seedHash, x0 = cx * CHUNK, z0 = cz * CHUNK, trees = [], rocks = [], decor = [], crags = craggery(world, cx, cz);
  const nearCrag = (x, z, pad) => crags.some(g => (g.x - x) * (g.x - x) + (g.z - z) * (g.z - z) < (g.r + pad) * (g.r + pad));
  // Trees: a jittered lattice thinned by forest cover, species by biome.
  const cells = Math.floor(CHUNK / TREE_CELL);
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    const h = hashInts(seed, 11, cx, cz, i, j), r1 = (h & 0xffff) / 65536, r2 = (h >>> 16) / 65536;
    const x = x0 + (i + .15 + .7 * r1) * TREE_CELL, z = z0 + (j + .15 + .7 * r2) * TREE_CELL;
    const cover = world.forestAt(x, z), keep = hash01(seed, 12, cx, cz, i, j);
    if (keep > cover * 1.08) continue;
    const biome = BIOME_NAMES[world.biomeAt(x, z)], slope = world.slopeAt(x, z);
    const tag = pickWeighted(TREE_TAGS, biome, hash01(seed, 13, cx, cz, i, j));
    if (!tag || slope > tag.slope[1] || blocked(world, x, z, 1.5) || nearCrag(x, z, 1.2)) continue;
    const s = tag.scale[0] + (tag.scale[1] - tag.scale[0]) * hash01(seed, 14, cx, cz, i, j);
    const base = tag.variant === 2 ? 4.1 : tag.variant === 1 ? 6.3 : 6;
    trees.push({id: `wt${cx}_${cz}_${trees.length}`, x: +x.toFixed(3), z: +z.toFixed(3), height: +(base * s).toFixed(2), variant: tag.variant});
  }
  // Deposits: a few tries per chunk; geology (slope, cliffs, altitude) and danger decide the kind.
  for (let k = 0; k < ROCK_TRIES; k++) {
    const x = x0 + hash01(seed, 21, cx, cz, k) * CHUNK, z = z0 + hash01(seed, 22, cx, cz, k) * CHUNK;
    const biome = BIOME_NAMES[world.biomeAt(x, z)], slope = world.slopeAt(x, z), danger = world.dangerAt(x, z);
    const ok = RESOURCE_TAGS.filter(t => (t.biomes[biome] || 0) > 0 && slope >= t.slope[0] && slope <= t.slope[1] && (!t.danger || danger >= t.danger[0] - .5));
    const tag = pickWeighted(ok, biome, hash01(seed, 23, cx, cz, k));
    // Chance: steeper/rockier ground holds more stone; soft lowland meadows hold little.
    const chance = .07 + Math.min(.32, slope * .45) + (biome === 'rock' ? .1 : 0);
    if (!tag || hash01(seed, 24, cx, cz, k) > chance || blocked(world, x, z, 2)) continue;
    if (rocks.some(r => (r.x - x) * (r.x - x) + (r.z - z) * (r.z - z) < tag.spacing * tag.spacing)) continue;
    if (trees.some(t => (t.x - x) * (t.x - x) + (t.z - z) * (t.z - z) < 4)) continue;
    if (nearCrag(x, z, 1.5)) continue;
    rocks.push({id: `wr${cx}_${cz}_${rocks.length}`, x: +x.toFixed(3), z: +z.toFixed(3), kind: tag.asset});
  }
  // Decor: per tag, a few tries scaled by its biome weight; near-band dressing is dense, boulders sparse.
  for (const [ti, tag] of DECOR_TAGS.entries()) {
    const tries = tag.lod === 'near' ? 14 : 4;
    for (let k = 0; k < tries; k++) {
      const x = x0 + hash01(seed, 31, ti, cx, cz, k) * CHUNK, z = z0 + hash01(seed, 32, ti, cx, cz, k) * CHUNK;
      const biome = BIOME_NAMES[world.biomeAt(x, z)], w = tag.biomes[biome] || 0;
      if (!w || hash01(seed, 33, ti, cx, cz, k) > w / 8) continue;
      const slope = world.slopeAt(x, z); if (slope < tag.slope[0] || slope > tag.slope[1]) continue;
      if (tag.near === 'water') { const rv = world.riverNear(x, z, 26); if (!rv && !world.isWater(x + 6, z) && !world.isWater(x - 6, z)) continue; if (rv && rv.distance < rv.width * .5 + .6) continue; }
      else if (blocked(world, x, z, tag.footprint)) continue;
      decor.push({asset: tag.asset, x, z, yaw: hash01(seed, 34, ti, cx, cz, k) * 6.2831853, scale: tag.scale[0] + (tag.scale[1] - tag.scale[0]) * hash01(seed, 35, ti, cx, cz, k)});
    }
  }
  c = {cx, cz, trees, rocks, decor, crags};
  if (map.size >= CACHE_MAX) map.delete(map.keys().next().value);
  map.set(key, c);
  return c;
}

// Environmental geometry: the rock that makes hill country read as land, not a smooth sheet. Solid (Heroes, foes and
// mounts walk round them; resolveCrags), never mined. Kinds, each where its landform says it belongs:
//   tor      stacked weathered blocks crowning a hill crest
//   outcrop  a tilted slab breaking out of a ledge or steep slope, leaning downhill
//   boulder  a rounded stone, in loose fields across hill country
//   spire    a weathered rock stack among the high rock
// Each record: {x, z, kind, yaw, s (size, metres), r (collision radius), h (height above ground)}.
export const CRAG_KINDS = Object.freeze(['tor', 'outcrop', 'boulder', 'spire']);
const CRAG_TRIES = 10;
function craggery(world, cx, cz) {
  if (!world.hillAt) return [];
  const seed = world.gen.seedHash, x0 = cx * CHUNK, z0 = cz * CHUNK, out = [];
  const put = (kind, x, z, s, yaw, k) => {
    const r = kind === 'tor' ? s * .62 : kind === 'outcrop' ? s * .5 : kind === 'spire' ? s * .34 : s * .5, h = kind === 'tor' ? s * .9 : kind === 'outcrop' ? s * .7 : kind === 'spire' ? s * 1.8 : s * .7;
    if (blocked(world, x, z, r + 1) || out.some(g => (g.x - x) * (g.x - x) + (g.z - z) * (g.z - z) < (g.r + r + .8) * (g.r + r + .8))) return;
    out.push({x: +x.toFixed(3), z: +z.toFixed(3), kind, yaw: +(yaw).toFixed(3), s: +s.toFixed(2), r: +r.toFixed(2), h: +h.toFixed(2), v: k % 4});
  };
  for (let k = 0; k < CRAG_TRIES; k++) {
    const x = x0 + hash01(seed, 41, cx, cz, k) * CHUNK, z = z0 + hash01(seed, 42, cx, cz, k) * CHUNK, roll = hash01(seed, 43, cx, cz, k);
    const hill = world.hillAt(x, z), sc = world.scarpAt(x, z), slope = world.slopeAt(x, z), biome = BIOME_NAMES[world.biomeAt(x, z)];
    const size = hash01(seed, 44, cx, cz, k), yaw = hash01(seed, 45, cx, cz, k) * 6.2831853;
    if ((biome === 'rock' || biome === 'tundra' || biome === 'snow') && slope > .18 && roll < .32) { put('spire', x, z, 2.4 + 2 * size, yaw, k); continue; }
    if (sc > .1 && roll < .7 * sc + .15) { // a slab out of the ledge, leaning downhill
      const e = .8, gx = world.heightAt(x + e, z) - world.heightAt(x - e, z), gz = world.heightAt(x, z + e) - world.heightAt(x, z - e);
      put('outcrop', x, z, 2.2 + 2.4 * size, atanQ2(-gx, -gz), k); continue;
    }
    if (hill > .3) {
      const y = world.heightAt(x, z), ring = (world.heightAt(x + 14, z) + world.heightAt(x - 14, z) + world.heightAt(x, z + 14) + world.heightAt(x, z - 14)) / 4;
      if (y - ring > 1.1 && roll < .7) { put('tor', x, z, 2.6 + 2.6 * size, yaw, k); continue; }
      if (roll < .22 * hill) { const n = 2 + Math.floor(size * 3); for (let b = 0; b < n; b++) put('boulder', x + (hash01(seed, 46, cx, cz, k, b) - .5) * 9, z + (hash01(seed, 47, cx, cz, k, b) - .5) * 9, .9 + 1.3 * hash01(seed, 48, cx, cz, k, b), hash01(seed, 49, cx, cz, k, b) * 6.28, k + b); }
    }
  }
  return out;
}
/** Push a walker out of every crag it overlaps (one cylinder per crag; the tall ones also block flying-low foes). */
export function resolveCrags(world, position, radius = .28) {
  if (!world?.hillAt) return position;
  const [cx0, cz0] = chunkOf(position[0] - 8, position[2] - 8), [cx1, cz1] = chunkOf(position[0] + 8, position[2] + 8);
  for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) for (const g of chunkContent(world, cx, cz).crags) {
    const dx = position[0] - g.x, dz = position[2] - g.z, min = g.r + radius, d2 = dx * dx + dz * dz;
    if (d2 >= min * min) continue;
    const d = Math.sqrt(d2) || 1e-6; position[0] = g.x + dx / d * min; position[2] = g.z + dz / d * min;
  }
  return position;
}

/** Chunks within ACTIVE_RADIUS of any Hero, as sorted [cx, cz] pairs (stable for identical positions). */
export function activeChunks(state, radius = ACTIVE_RADIUS) {
  const out = new Map();
  for (const p of state.players || []) {
    if (p.role !== 'hero' || !p.position) continue;
    const [x, z] = [p.position[0], p.position[2]];
    for (let cz = Math.floor((z - radius) / CHUNK); cz <= Math.floor((z + radius) / CHUNK); cz++)
      for (let cx = Math.floor((x - radius) / CHUNK); cx <= Math.floor((x + radius) / CHUNK); cx++) {
        const nx = Math.max(cx * CHUNK, Math.min(x, cx * CHUNK + CHUNK)), nz = Math.max(cz * CHUNK, Math.min(z, cz * CHUNK + CHUNK));
        if ((nx - x) * (nx - x) + (nz - z) * (nz - z) <= radius * radius) out.set(chunkKey(cx, cz), [cx, cz]);
      }
  }
  return [...out.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}
/** The generated tree record for a stable id (or null). */
export function generatedTree(world, id) {
  const m = TREE_ID.exec(id); if (!m) return null;
  return chunkContent(world, +m[1], +m[2]).trees[+m[3]] || null;
}
export function generatedRock(world, id) {
  const m = ROCK_ID.exec(id); if (!m) return null;
  const r = chunkContent(world, +m[1], +m[2]).rocks[+m[3]];
  return r && r.id === id ? r : null;
}
/** A fresh simulation deposit for a generated rock. */
export const depositFor = rock => ({id: rock.id, x: rock.x, z: rock.z, kind: rock.kind, hits: 0, maxHits: DEPOSIT_CATALOG[rock.kind].maxHits, depleted: false});
