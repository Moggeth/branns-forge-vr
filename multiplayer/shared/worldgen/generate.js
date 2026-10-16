// Brann's Forge world generator: seed + preset -> one coherent, deterministic baseline world.
//
// Pipeline (all on a coarse grid, then refined on demand by heightAt):
//   1. landform   preset elevation (continent / isles / highlands / basin) from seeded noise
//   2. erosion    rain droplets carve gullies and lay down sediment, so slopes read as weathered, not as noise
//   3. drainage   priority-flood from the sea: every cell gets one downhill receiver; closed basins fill up to their
//                 spill point and become lakes that drain out at their lowest rim
//   4. climate    prevailing wind carries moisture inland; mountains wring it out (wet windward, dry rain shadow);
//                 temperature falls with latitude and altitude
//   5. rivers     flow accumulates down the receivers; streams merge into tributaries, rivers end in a lake or the sea;
//                 river surfaces only ever fall downstream
//   6. biomes     from temperature, moisture, slope, altitude and water (Whittaker-style)
//   7. people     settlements where it is flat, watered and reachable; roads follow the cheapest ground between them
//   8. regions    named regions with identities, landmarks (peaks, falls, lakes) and discoveries; dungeon entrances
//                 at cliff feet; danger rises with distance from the welcoming start
//
// Determinism: only + - * / and Math.sqrt/floor/min/max/abs (all exactly specified by IEEE/ECMAScript) touch
// generated values, so every device - host, guest, phone, Quest - computes bit-identical worlds. Nothing here is
// ever saved: saves store {seed, preset, version} and the player-change layer (see shared/worldgen/README.md).
import {createRandom, hashSeed, hash01, hashInts} from './random.js';
import {createNoise} from './noise.js';
import {PRESETS} from './presets.js';
import {regionName, placeName, featureName} from './names.js';

export const WORLDGEN_VERSION = 1;
export const BIOME = Object.freeze({OCEAN: 0, LAKE: 1, BEACH: 2, MEADOW: 3, FOREST: 4, PINE: 5, MARSH: 6, STEPPE: 7, ROCK: 8, SNOW: 9, TUNDRA: 10});
export const BIOME_NAMES = Object.freeze(['ocean', 'lake', 'beach', 'meadow', 'forest', 'pine', 'marsh', 'steppe', 'rock', 'snow', 'tundra']);
const CELL = 16;           // metres per coarse cell
const CONTENT_CHUNK = 64;  // metres per content chunk (trees/rocks ids are chunk-local)

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
const D8_LEN = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

/** Minimal binary min-heap of cell indices keyed by a Float64Array (priority-flood). Ties break by index. */
function createHeap(key, capacity) {
  const a = new Int32Array(capacity); let n = 0;
  const less = (i, j) => key[a[i]] < key[a[j]] || key[a[i]] === key[a[j]] && a[i] < a[j];
  const swap = (i, j) => { const t = a[i]; a[i] = a[j]; a[j] = t; };
  return {
    get size() { return n; },
    push(v) { let i = n++; a[i] = v; while (i) { const p = (i - 1) >> 1; if (!less(i, p)) break; swap(i, p); i = p; } },
    pop() {
      const top = a[0]; a[0] = a[--n]; let i = 0;
      for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < n && less(l, m)) m = l; if (r < n && less(r, m)) m = r; if (m === i) break; swap(i, m); i = m; }
      return top;
    },
  };
}

/**
 * Generate the baseline world.
 * @param {{seed:string|number, preset?:string, size?:number}} options size in metres (multiple of 256), default per preset
 */
export function generateWorld({seed = 'brann', preset = 'continent', size} = {}) {
  const P = PRESETS[preset] || PRESETS.continent;
  const seedText = String(seed), seedHash = hashSeed(seedText);
  const SIZE = Math.max(1024, Math.min(8192, Math.round((size || P.size) / 256) * 256));
  const N = SIZE / CELL, HALF = SIZE / 2, NN = N * N;
  const rand = createRandom(hashInts(seedHash, 1));
  const noise = createNoise(hashInts(seedHash, 2)), detailNoise = createNoise(hashInts(seedHash, 3));
  const reliefNoise = createNoise(hashInts(seedHash, 5));
  const setup = P.setup(rand);
  const timing = {}, tStart = now();
  let t0 = tStart;
  const idx = (i, j) => j * N + i;
  const cellX = i => (i + .5) * CELL - HALF, cellZ = j => (j + .5) * CELL - HALF;

  // ---------- 1. landform ----------
  const elev = new Float64Array(NN), hilly = new Float64Array(NN), relief = new Float64Array(NN);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const nx = ((i + .5) / N) * 2 - 1, nz = ((j + .5) / N) * 2 - 1;
    let h = P.elevation(nx, nz, noise, setup);
    // Hill country, gathered in patches so open plains remain between: rolling downs and knolls, with long dales
    // (inverted ridges) running through them. Added after erosion (which would plane them away) but before drainage,
    // so rivers, lakes and biomes still follow the new shape.
    const hill = (.25 + .75 * smooth(-.3, .3, reliefNoise.fbm(nx * 2.1 + 31, nz * 2.1 - 17, 3))) * (P.relief ?? 1);
    hilly[idx(i, j)] = hill;
    if (hill > 0) {
      const roll = reliefNoise.fbm(nx * 8.5 + 5, nz * 8.5 - 2, 4), knoll = reliefNoise.fbm(nx * 22 - 9, nz * 22 + 4, 3);
      const dale = reliefNoise.ridged(nx * 4.6 - 8, nz * 4.6 + 3, 3);
      relief[idx(i, j)] = P.dales === 0 ? hill * Math.max(0, 40 * roll + 12 * knoll + 6) : hill * (46 * roll + 14 * knoll + 34 - 70 * dale * dale); // a basin gets rounded hills only (dales would pond)
    }
    const edge = Math.max(Math.abs(nx), Math.abs(nz));
    if (edge > .94) h = Math.min(h, -8 - (edge - .94) * 600); // every world is wrapped in sea
    elev[idx(i, j)] = h;
  }
  timing.landform = lap();

  // ---------- 2. erosion (droplets on the coarse grid) ----------
  if (!globalThis.__NOERODE) erode(elev, N, createRandom(hashInts(seedHash, 4)), Math.floor(NN * .8));
  for (let c = 0; c < NN; c++) if (relief[c]) elev[c] += relief[c] * smooth(-3, 8, elev[c]); // hills stop at the shore
  timing.erosion = lap();

  // ---------- 3. sea, drainage and lakes ----------
  const ocean = new Uint8Array(NN);
  {
    const stack = [];
    for (let k = 0; k < N; k++) for (const c of [idx(k, 0), idx(k, N - 1), idx(0, k), idx(N - 1, k)]) if (!ocean[c] && elev[c] < 0) { ocean[c] = 1; stack.push(c); }
    while (stack.length) {
      const c = stack.pop(), i = c % N, j = (c - i) / N;
      for (let d = 0; d < 4; d++) { const a = i + D8[d][0], b = j + D8[d][1]; if (a < 0 || b < 0 || a >= N || b >= N) continue; const q = idx(a, b); if (!ocean[q] && elev[q] < 0) { ocean[q] = 1; stack.push(q); } }
    }
  }
  const filled = new Float64Array(NN), receiver = new Int32Array(NN).fill(-1), order = new Int32Array(NN), done = new Uint8Array(NN);
  let orderN = 0;
  {
    const heap = createHeap(filled, NN), EPS = 1e-3;
    for (let c = 0; c < NN; c++) {
      const i = c % N, j = (c - i) / N;
      if (ocean[c] || i === 0 || j === 0 || i === N - 1 || j === N - 1) { filled[c] = ocean[c] ? Math.min(elev[c], 0) : elev[c]; done[c] = 1; heap.push(c); }
    }
    while (heap.size) {
      const c = heap.pop(); order[orderN++] = c;
      const i = c % N, j = (c - i) / N;
      for (let d = 0; d < 8; d++) {
        const a = i + D8[d][0], b = j + D8[d][1]; if (a < 0 || b < 0 || a >= N || b >= N) continue;
        const q = idx(a, b); if (done[q]) continue;
        done[q] = 1; filled[q] = Math.max(elev[q], filled[c] + EPS * D8_LEN[d]); receiver[q] = c; heap.push(q);
      }
    }
  }
  // Lakes: connected cells noticeably below their filled level. Puddles are filled in (raised) instead.
  const lakeId = new Int16Array(NN).fill(-1), lakes = [];
  {
    const seen = new Uint8Array(NN);
    for (let c = 0; c < NN; c++) {
      if (seen[c] || ocean[c] || filled[c] - elev[c] < .8) continue;
      const cells = [], stack = [c]; seen[c] = 1; let level = -Infinity;
      while (stack.length) {
        const q = stack.pop(); cells.push(q); level = Math.max(level, filled[q]);
        const i = q % N, j = (q - i) / N;
        for (let d = 0; d < 8; d++) { const a = i + D8[d][0], b = j + D8[d][1]; if (a < 0 || b < 0 || a >= N || b >= N) continue; const r = idx(a, b); if (!seen[r] && !ocean[r] && filled[r] - elev[r] >= .8) { seen[r] = 1; stack.push(r); } }
      }
      let low = Infinity; for (const q of cells) low = Math.min(low, elev[q]);
      if (cells.length < 9 || level - low < 2.5) { for (const q of cells) elev[q] = filled[q]; continue; }
      const id = lakes.length; let sx = 0, sz = 0, minI = N, maxI = 0, minJ = N, maxJ = 0, deepest = cells[0];
      for (const q of cells) { lakeId[q] = id; const i = q % N, j = (q - i) / N; sx += i; sz += j; minI = Math.min(minI, i); maxI = Math.max(maxI, i); minJ = Math.min(minJ, j); maxJ = Math.max(maxJ, j); if (elev[q] < elev[deepest]) deepest = q; }
      lakes.push({id, level, cells: cells.length, area: cells.length * CELL * CELL, x: cellX(sx / cells.length - .5 + .5), z: cellZ(sz / cells.length - .5 + .5),
        bounds: [cellX(minI) - CELL, cellZ(minJ) - CELL, cellX(maxI) + CELL, cellZ(maxJ) + CELL], depth: level - elev[deepest], outlet: -1, name: ''});
    }
    // Flatten each lake's filled level to its spill height so the surface is truly level.
    for (let c = 0; c < NN; c++) if (lakeId[c] >= 0) filled[c] = lakes[lakeId[c]].level;
    for (let c = 0; c < NN; c++) if (lakeId[c] < 0 && !ocean[c] && filled[c] > elev[c]) elev[c] = filled[c]; // smoothed tiny pits
  }
  timing.drainage = lap();

  // ---------- 4. climate ----------
  const windDir = Math.floor(rand.next() * 4); // 0 from west, 1 from east, 2 from north, 3 from south
  const rain = new Float64Array(NN), humid = new Float64Array(NN), temp = new Float64Array(NN), moist = new Float64Array(NN);
  for (let line = 0; line < N; line++) {
    let m = 1, prev = 0;
    for (let s = 0; s < N; s++) {
      const [i, j] = windDir === 0 ? [s, line] : windDir === 1 ? [N - 1 - s, line] : windDir === 2 ? [line, s] : [line, N - 1 - s];
      const c = idx(i, j), water = ocean[c] || lakeId[c] >= 0, h = Math.max(0, water ? 0 : elev[c]);
      if (water) { m = Math.min(1.1, m + .06); rain[c] = .2 * m; }
      else {
        // Air loses a little moisture over every cell and a lot when forced up a slope (orographic rain).
        const lift = Math.max(0, h - prev) / (CELL * 8), p = Math.min(m * .3, m * (.004 + lift * .6) / P.wetness);
        m = Math.max(0, m - p + .0012 * P.wetness); rain[c] = p * 6;
      }
      humid[c] = m; prev = prev * .92 + h * .08; // a broad upwind average: whole ranges lift the air, not single bumps
    }
  }
  blur(rain, N, 3); blur(rain, N, 3); blur(humid, N, 2);
  let rainMax = 0; for (let c = 0; c < NN; c++) if (!ocean[c]) rainMax = Math.max(rainMax, rain[c]);
  {
    // Distance to water (in cells, chamfer) keeps shores and riverbanks green even in the rain shadow.
    const dist = waterDistance(N, c => ocean[c] || lakeId[c] >= 0);
    for (let c = 0; c < NN; c++) {
      const i = c % N, j = (c - i) / N, lat = (j + .5) / N; // 0 north .. 1 south
      const h = Math.max(0, elev[c]);
      temp[c] = clamp(P.warmth + (lat - .5) * .3 - h / 900 + .06 * noise.fbm(i * .03 + 50, j * .03 + 50, 3), 0, 1);
      moist[c] = humid[c] * .7 + rain[c] / (rainMax || 1) * .5 + .3 * (1 - smooth(0, 8, dist[c])) + .1 * noise.fbm(i * .05 - 20, j * .05 + 11, 3);
    }
    // Rank-normalise over land so every world spans dry to wet; the preset's wetness then skews the spread.
    const land = []; for (let c = 0; c < NN; c++) if (!ocean[c]) land.push(c);
    land.sort((a, b) => moist[a] - moist[b] || a - b);
    const skew = 1 / P.wetness;
    for (let k = 0; k < land.length; k++) { const f = (k + .5) / land.length; moist[land[k]] = skewPow(f, skew); }
    for (let c = 0; c < NN; c++) if (ocean[c]) moist[c] = 1;
  }
  timing.climate = lap();

  // ---------- 5. flow and rivers ----------
  const acc = new Float64Array(NN), downLen = new Float64Array(NN);
  for (let k = 0; k < orderN; k++) { const c = order[k], r = receiver[c]; downLen[c] = r >= 0 ? downLen[r] + 1 : 0; }
  for (let k = orderN - 1; k >= 0; k--) { const c = order[k]; acc[c] += .25 + rain[c] / (rainMax || 1); const r = receiver[c]; if (r >= 0) acc[r] += acc[c]; }
  let landCells = 0; for (let c = 0; c < NN; c++) if (!ocean[c]) landCells++;
  // Threshold: about 2.2% of land is river-bearing; never so low that every gully is a river.
  const riverThreshold = Math.max(60, quantile(acc, c => !ocean[c] && lakeId[c] < 0, 1 - .022));
  const isRiver = c => acc[c] >= riverThreshold && !ocean[c] && lakeId[c] < 0;
  const riverOf = new Int32Array(NN).fill(-1), rivers = [];
  {
    const sources = [];
    for (let c = 0; c < NN; c++) {
      if (!isRiver(c)) continue;
      // A source has no river-bearing cell draining into it.
      let fed = false; const i = c % N, j = (c - i) / N;
      for (let d = 0; d < 8 && !fed; d++) { const a = i + D8[d][0], b = j + D8[d][1]; if (a < 0 || b < 0 || a >= N || b >= N) continue; const q = idx(a, b); if (receiver[q] === c && isRiver(q)) fed = true; }
      // Lake outlets are sources too: the first river cell below a lake.
      // (A lake outlet is a source too: the lake cells above it are not river cells.)
      if (!fed) sources.push(c);
    }
    sources.sort((a, b) => downLen[b] - downLen[a] || a - b); // longest main stems first, tributaries join them
    for (const src of sources) {
      if (riverOf[src] >= 0) continue;
      const cells = [], id = rivers.length; let c = src, end = 'sea', into = -1;
      for (;;) {
        if (riverOf[c] >= 0) { end = 'river'; into = riverOf[c]; cells.push(c); break; }
        if (ocean[c]) { end = 'sea'; cells.push(c); break; }
        if (lakeId[c] >= 0) { end = 'lake'; into = lakeId[c]; cells.push(c); break; }
        riverOf[c] = id; cells.push(c);
        if (receiver[c] < 0) { end = 'sea'; break; }
        c = receiver[c];
      }
      if (cells.length < 4) { for (const q of cells) if (riverOf[q] === id) riverOf[q] = -1; continue; }
      // Which lake (if any) feeds this river: a neighbour of the source that drains into it.
      let from = -1; { const i = src % N, j = (src - i) / N; for (let d = 0; d < 8; d++) { const a = i + D8[d][0], b = j + D8[d][1]; if (a < 0 || b < 0 || a >= N || b >= N) continue; const q = idx(a, b); if (receiver[q] === src && lakeId[q] >= 0) { from = lakeId[q]; break; } } }
      if (from >= 0) lakes[from].outlet = id;
      rivers.push({id, cells, end, into, from, flow: acc[cells[cells.length - 2] ?? src]});
    }
  }
  timing.rivers = lap();

  // ---------- coarse helpers (bicubic) ----------
  const at = (a, i, j) => a[clamp(j, 0, N - 1) * N + clamp(i, 0, N - 1)];
  function cubic(a, x, z) {
    const fx = (x + HALF) / CELL - .5, fz = (z + HALF) / CELL - .5, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const wu = catmull(u), wv = catmull(v); let s = 0;
    for (let m = 0; m < 4; m++) { const row = at(a, i - 1, j - 1 + m) * wu[0] + at(a, i, j - 1 + m) * wu[1] + at(a, i + 1, j - 1 + m) * wu[2] + at(a, i + 2, j - 1 + m) * wu[3]; s += row * wv[m]; }
    return s;
  }
  function bilinear(a, x, z) {
    const fx = (x + HALF) / CELL - .5, fz = (z + HALF) / CELL - .5, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    return (at(a, i, j) * (1 - u) + at(a, i + 1, j) * u) * (1 - v) + (at(a, i, j + 1) * (1 - u) + at(a, i + 1, j + 1) * u) * v;
  }
  const cellAt = (x, z) => idx(clamp(Math.floor((x + HALF) / CELL), 0, N - 1), clamp(Math.floor((z + HALF) / CELL), 0, N - 1));
  // Slope (m per m) on the coarse grid.
  const slope = new Float64Array(NN);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const gx = (at(elev, i + 1, j) - at(elev, i - 1, j)) / (2 * CELL), gz = (at(elev, i, j + 1) - at(elev, i, j - 1)) / (2 * CELL);
    slope[idx(i, j)] = Math.sqrt(gx * gx + gz * gz);
  }

  // ---------- river geometry: smoothed polylines with widths and monotone surfaces ----------
  const seg = createSegmentIndex(HALF, 64);
  for (const r of rivers) {
    let pts = r.cells.map(c => { const i = c % N, j = (c - i) / N; return [cellX(i), cellZ(j), acc[c]]; });
    // Meander: nudge interior points sideways with low-frequency noise before smoothing.
    pts = pts.map((p, k) => k === 0 || k === pts.length - 1 ? p : [p[0] + 9 * noise.noise(p[0] * .007 + 3, p[1] * .007), p[1] + 9 * noise.noise(p[0] * .007, p[1] * .007 + 7), p[2]]);
    pts = chaikin(chaikin(chaikin(pts)));
    const flowMax = riverThreshold * 40;
    r.points = pts.map(([x, z, f]) => {
      const t = Math.sqrt(clamp(f / flowMax, 0, 1));
      return {x, z, width: 3 + 31 * t, depth: .9 + 2.6 * t, surface: 0};
    });
    // Surface: a little below the land, never rising downstream, and meeting the water it flows into.
    let s = Infinity;
    for (const p of r.points) { const ground = cubic(elev, p.x, p.z); s = Math.min(s, ground - .55 - p.width * .02); p.surface = s; }
    const endLevel = r.end === 'lake' ? lakes[r.into].level : r.end === 'river' ? riverSurfaceNear(rivers[r.into], r.points[r.points.length - 1]) : 0;
    for (let k = r.points.length - 1; k >= 0; k--) { const p = r.points[k]; p.surface = Math.max(p.surface, endLevel); }
    if (r.end === 'sea') r.points[r.points.length - 1].surface = 0;
    r.length = 0; for (let k = 1; k < r.points.length; k++) r.length += dist2(r.points[k - 1], r.points[k]);
    r.mouth = {x: r.points[r.points.length - 1].x, z: r.points[r.points.length - 1].z};
    r.source = {x: r.points[0].x, z: r.points[0].z};
    for (let k = 1; k < r.points.length; k++) seg.add(0, r.id, k, r.points[k - 1], r.points[k], (Math.max(r.points[k - 1].width, r.points[k].width)) * 1.3 + 10);
  }
  function riverSurfaceNear(r, p) { let best = Infinity, s = 0; for (const q of r.points) { const d = dist2(q, p); if (d < best) { best = d; s = q.surface; } } return s; }

  // ---------- 6. biomes ----------
  const biome = new Uint8Array(NN), forest = new Float64Array(NN);
  const riverNear = waterDistance(N, c => riverOf[c] >= 0);
  for (let c = 0; c < NN; c++) {
    const i = c % N, j = (c - i) / N, h = elev[c], t = temp[c], m = moist[c], sl = slope[c];
    let b;
    if (ocean[c]) b = BIOME.OCEAN;
    else if (lakeId[c] >= 0) b = BIOME.LAKE;
    else if (h < 3.2 && sl < .12 && nearOcean(c)) b = BIOME.BEACH;
    else if (t < .12 && h > 110) b = BIOME.SNOW;
    else if (sl > .62 || h > 300 && sl > .3) b = BIOME.ROCK;
    else if (t < .18) b = BIOME.TUNDRA;
    else if (m > .72 && sl < .05 && h < 40) b = BIOME.MARSH;
    else if (m < .3 && t > .45) b = BIOME.STEPPE;
    else if (t < .36) b = m > .28 ? BIOME.PINE : BIOME.TUNDRA;
    else if (m > .52) b = BIOME.FOREST;
    else b = BIOME.MEADOW;
    biome[c] = b;
    // Forest cover: biome base, broken into groves and clearings by noise; riverbanks wooded even when dry.
    const base = [0, 0, 0, .12, .78, .7, .18, .04, .05, 0, .08][b];
    const groves = smooth(-.15, .35, noise.fbm(i * .045 + 90, j * .045 - 40, 4));
    const banks = (1 - smooth(1, 4, riverNear[c])) * (b === BIOME.MEADOW || b === BIOME.STEPPE ? .45 : .1);
    forest[c] = clamp(base * (.25 + .9 * groves) + banks, 0, 1) * (1 - smooth(.45, .8, sl));
  }
  function nearOcean(c) { const i = c % N, j = (c - i) / N; for (let b = -3; b <= 3; b++) for (let a = -3; a <= 3; a++) { const q = at(ocean, i + a, j + b); if (q) return true; } return false; }
  timing.biomes = lap();

  // ---------- 7. settlements and roads ----------
  const settleRand = createRandom(hashInts(seedHash, 7));
  const coastNear = waterDistance(N, c => ocean[c]), lakeNear = waterDistance(N, c => lakeId[c] >= 0);
  const settleScore = c => {
    if (ocean[c] || lakeId[c] >= 0 || riverOf[c] >= 0) return -1;
    const b = biome[c]; if (b === BIOME.ROCK || b === BIOME.SNOW || b === BIOME.MARSH || b === BIOME.BEACH) return -1;
    const flat = 1 - smooth(.04, .14, slope[c]), water = Math.max(1 - smooth(1, 9, riverNear[c]), 1 - smooth(1, 7, coastNear[c]), 1 - smooth(1, 7, lakeNear[c]));
    const mild = 1 - smooth(.15, .55, Math.abs(temp[c] - .62)), high = 1 - smooth(60, 220, elev[c]);
    return flat * (.35 + water) * (.5 + .5 * mild) * high * (b === BIOME.MEADOW ? 1.25 : 1);
  };
  const scores = new Float64Array(NN); for (let c = 0; c < NN; c++) scores[c] = settleScore(c);
  const settlements = [];
  {
    const spacing = (SIZE / 4096) * 560, wanted = Math.round(7 * (SIZE / 4096) * (SIZE / 4096));
    const cand = []; for (let c = 0; c < NN; c++) if (scores[c] > .55) cand.push(c);
    cand.sort((a, b) => scores[b] - scores[a] || a - b);
    // The welcoming start: the best spot near the middle of the land with both water and woods in reach.
    const startScore = c => { const i = c % N, j = (c - i) / N, nx = (i + .5) / N * 2 - 1, nz = (j + .5) / N * 2 - 1;
      const woods = localMean(forest, c, 8), central = 1 - smooth(.15, .75, Math.sqrt(nx * nx + nz * nz)); return scores[c] * (.4 + woods) * (.3 + central); };
    let start = -1, best = -1; for (const c of cand) { const s = startScore(c); if (s > best) { best = s; start = c; } }
    if (start < 0) { for (let c = 0; c < NN; c++) if (scores[c] > best) { best = scores[c]; start = c; } }
    const chosen = start >= 0 ? [start] : [];
    for (const c of cand) { if (chosen.length >= wanted) break; if (chosen.every(q => cellDist(q, c) * CELL >= spacing)) chosen.push(c); }
    for (const [k, c] of chosen.entries()) {
      const i = c % N, j = (c - i) / N, x = cellX(i), z = cellZ(j);
      const coastal = coastNear[c] < 8, river = riverNear[c] < 6, lake = lakeNear[c] < 6, woods = localMean(forest, c, 6) > .35, hills = localMean(slope, c, 10) > .16;
      const kind = k === 0 ? 'village' : coastal ? 'harbour' : river ? 'mill' : lake ? 'fishery' : woods ? 'lumber' : hills ? 'mine' : 'farm';
      settlements.push({id: 's' + k, kind, x, z, start: k === 0, name: placeName(hashInts(seedHash, 70, k), kind), size: k === 0 ? 3 : scores[c] > 1.1 ? 2 : 1, radius: k === 0 ? 48 : scores[c] > 1.1 ? 36 : 26});
    }
  }
  const startSettlement = settlements[0] || {x: 0, z: 0};
  // Roads: minimum spanning tree over settlements (plus a couple of loops), each routed by A* over slope/water cost.
  const roadCells = new Uint8Array(NN), roads = [];
  {
    const edges = [];
    for (let a = 0; a < settlements.length; a++) for (let b = a + 1; b < settlements.length; b++) edges.push([dist2(settlements[a], settlements[b]), a, b]);
    edges.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
    const parent = settlements.map((_, k) => k), find = k => parent[k] === k ? k : parent[k] = find(parent[k]);
    const links = [];
    for (const e of edges) { const ra = find(e[1]), rb = find(e[2]); if (ra !== rb) { parent[ra] = rb; links.push(e); } }
    for (const e of edges) if (links.length < settlements.length + 1 && !links.includes(e) && e[0] < SIZE * .35) links.push(e);
    for (const [, a, b] of links) {
      const path = routeRoad(cellAt(settlements[a].x, settlements[a].z), cellAt(settlements[b].x, settlements[b].z));
      if (!path) continue;
      for (const c of path) roadCells[c] = 1;
      const pts = chaikin(chaikin(path.map(c => { const i = c % N, j = (c - i) / N; return [cellX(i), cellZ(j), 0]; })));
      const road = {id: 'r' + roads.length, from: settlements[a].id, to: settlements[b].id, points: pts.map(([x, z]) => ({x, z, width: 4.2})), bridges: []};
      for (const p of road.points) p.y = Math.max(cubic(elev, p.x, p.z), 0);
      smoothRoadHeights(road.points);
      for (let k = 1; k < road.points.length; k++) {
        seg.add(1, roads.length, k, road.points[k - 1], road.points[k], 9);
        const mid = {x: (road.points[k - 1].x + road.points[k].x) / 2, z: (road.points[k - 1].z + road.points[k].z) / 2};
        const c = cellAt(mid.x, mid.z); if (riverOf[c] >= 0 && !road.bridges.some(b => dist2(b, mid) < 40)) road.bridges.push({x: mid.x, z: mid.z, river: riverOf[c], yaw: yawOf(road.points[k - 1], road.points[k])});
      }
      roads.push(road);
    }
  }
  function routeRoad(from, to) {
    const cost = new Float64Array(NN).fill(Infinity), prev = new Int32Array(NN).fill(-1), f = new Float64Array(NN).fill(Infinity), closed = new Uint8Array(NN);
    const ti = to % N, tj = (to - ti) / N, h = c => { const i = c % N, j = (c - i) / N; return Math.sqrt((i - ti) * (i - ti) + (j - tj) * (j - tj)); };
    const heap = createHeap(f, NN * 2); cost[from] = 0; f[from] = h(from); heap.push(from);
    let steps = 0;
    while (heap.size && steps++ < NN * 4) {
      const c = heap.pop(); if (closed[c]) continue; closed[c] = 1;
      if (c === to) break;
      const i = c % N, j = (c - i) / N;
      for (let d = 0; d < 8; d++) {
        const a = i + D8[d][0], b = j + D8[d][1]; if (a < 1 || b < 1 || a >= N - 1 || b >= N - 1) continue;
        const q = idx(a, b); if (closed[q] || ocean[q] || lakeId[q] >= 0) continue;
        const climb = Math.abs(elev[q] - elev[c]) / (CELL * D8_LEN[d]);
        let step = D8_LEN[d] * (1 + climb * climb * 220 + (biome[q] === BIOME.MARSH ? 3 : 0) + (biome[q] === BIOME.FOREST || biome[q] === BIOME.PINE ? .4 : 0));
        if (riverOf[q] >= 0) step += 14; // bridges are expensive: roads cross rivers rarely and at narrow points
        if (roadCells[q]) step *= .45;   // join existing roads
        const g = cost[c] + step; if (g < cost[q]) { cost[q] = g; prev[q] = c; f[q] = g + h(q); heap.push(q); }
      }
    }
    if (prev[to] < 0 && to !== from) return null;
    const path = []; for (let c = to; c >= 0; c = prev[c]) { path.push(c); if (c === from) break; }
    return path.reverse();
  }
  timing.roads = lap();

  // ---------- 8. regions, landmarks, discoveries, dungeon entrances ----------
  const startX = startSettlement.x, startZ = startSettlement.z;
  const regionRand = createRandom(hashInts(seedHash, 8)), regionCount = Math.max(5, Math.round(9 * (SIZE / 4096) * (SIZE / 4096)));
  const regionSeeds = [{x: startX, z: startZ}];
  for (let tries = 0; regionSeeds.length < regionCount && tries < 4000; tries++) {
    const x = regionRand.range(-HALF * .85, HALF * .85), z = regionRand.range(-HALF * .85, HALF * .85), c = cellAt(x, z);
    if (ocean[c]) continue;
    if (regionSeeds.every(s => dist2(s, {x, z}) > SIZE * .19)) regionSeeds.push({x, z});
  }
  const regionOf = new Int16Array(NN).fill(-1);
  for (let c = 0; c < NN; c++) {
    if (ocean[c]) continue;
    const i = c % N, j = (c - i) / N, x = cellX(i) + 120 * noise.fbm(i * .02 + 5, j * .02, 3), z = cellZ(j) + 120 * noise.fbm(i * .02, j * .02 + 5, 3);
    let best = 0, bd = Infinity; for (const [k, s] of regionSeeds.entries()) { const d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z); if (d < bd) { bd = d; best = k; } }
    regionOf[c] = best;
  }
  const regions = regionSeeds.map((s, k) => {
    const counts = new Array(11).fill(0); let cells = 0, hsum = 0, peak = -1;
    for (let c = 0; c < NN; c++) if (regionOf[c] === k) { counts[biome[c]]++; cells++; hsum += elev[c]; if (peak < 0 || elev[c] > elev[peak]) peak = c; }
    let dominant = BIOME.MEADOW, dc = -1; for (let b = 2; b < 11; b++) if (counts[b] > dc) { dc = counts[b]; dominant = b; }
    const d = dist2(s, {x: startX, z: startZ}) / (SIZE * .5);
    return {id: 'g' + k, x: s.x, z: s.z, cells, area: cells * CELL * CELL, biome: BIOME_NAMES[dominant], meanHeight: cells ? hsum / cells : 0,
      danger: k === 0 ? 0 : clamp(Math.round(d * 3 + (cells ? hsum / cells : 0) / 160), 1, 4), name: regionName(hashInts(seedHash, 80, k), BIOME_NAMES[dominant]),
      peak: peak >= 0 ? {x: cellX(peak % N), z: cellZ((peak - peak % N) / N), height: elev[peak]} : null};
  });
  // Name the water and the mountains.
  lakes.sort((a, b) => b.area - a.area).forEach((l, k) => { l.name = featureName(hashInts(seedHash, 90, l.id), 'lake'); l.rank = k; });
  lakes.sort((a, b) => a.id - b.id);
  const riverRank = [...rivers].sort((a, b) => b.length - a.length);
  riverRank.forEach((r, k) => { r.name = k < 6 ? featureName(hashInts(seedHash, 91, r.id), 'river') : ''; r.major = k < 6; });
  const landmarks = [], discoveries = [];
  for (const g of regions) if (g.peak && g.peak.height > 90) landmarks.push({id: 'peak-' + g.id, kind: 'peak', x: g.peak.x, z: g.peak.z, region: g.id, name: featureName(hashInts(seedHash, 92, landmarks.length), 'peak')});
  for (const l of lakes) if (l.rank < 4) landmarks.push({id: 'lake-' + l.id, kind: 'lake', x: l.x, z: l.z, name: l.name});
  // Waterfalls: where a river surface drops sharply.
  for (const r of rivers) for (let k = 3; k < r.points.length; k += 2) {
    const drop = r.points[k - 3].surface - r.points[k].surface, run = dist2(r.points[k - 3], r.points[k]);
    if (drop > 5 && drop / run > .22 && !landmarks.some(l => l.kind === 'falls' && dist2(l, r.points[k]) < 300)) {
      landmarks.push({id: `falls-${r.id}-${k}`, kind: 'falls', x: r.points[k - 1].x, z: r.points[k - 1].z, drop, river: r.id, name: featureName(hashInts(seedHash, 93, r.id, k), 'falls')});
    }
  }
  const lmRegion = (x, z) => { const c = cellAt(x, z); return regionOf[c] >= 0 ? regions[regionOf[c]].id : null; };
  for (const l of landmarks) l.region = l.region || lmRegion(l.x, l.z);

  // Dungeon entrances (The Underways): flat ground at the foot of a cliff, facing away from it.
  const entrances = [];
  {
    const cand = [];
    for (let j = 3; j < N - 3; j++) for (let i = 3; i < N - 3; i++) {
      const c = idx(i, j); if (ocean[c] || lakeId[c] >= 0 || riverOf[c] >= 0 || slope[c] > .16 || roadCells[c]) continue;
      let best = 0, dir = 0;
      for (let d = 0; d < 8; d++) { const q = at(elev, i + D8[d][0] * 2, j + D8[d][1] * 2), rise = (q - elev[c]) / (2 * CELL * D8_LEN[d]); if (rise > best) { best = rise; dir = d; } }
      if (best < .38) continue;
      cand.push({c, score: best + .2 * hash01(seedHash, c), dir});
    }
    cand.sort((a, b) => b.score - a.score || a.c - b.c);
    const spacing = 380 * SIZE / 4096;
    // The first cave sits a short walk from the start village.
    const near = cand.filter(e => { const d = cellDist(e.c, cellAt(startX, startZ)) * CELL; return d > 160 && d < 650; });
    const pickList = (near.length ? [near[0]] : []).concat(cand);
    for (const e of pickList) {
      if (entrances.length >= Math.round(14 * (SIZE / 4096) * (SIZE / 4096))) break;
      const i = e.c % N, j = (e.c - i) / N, x = cellX(i), z = cellZ(j);
      if (entrances.some(o => dist2(o, {x, z}) < spacing) || settlements.some(s => dist2(s, {x, z}) < s.radius + 40)) continue;
      const [dx, dz] = D8[e.dir], yaw = yawOf({x: 0, z: 0}, {x: -dx, z: -dz}); // faces away from the cliff
      const k = entrances.length, d = dist2({x, z}, {x: startX, z: startZ}) / (SIZE * .5);
      entrances.push({id: 'u' + k, kind: 'dungeon', x, z, yaw, cliffDir: [dx, dz], biome: BIOME_NAMES[biome[e.c]], region: lmRegion(x, z),
        tier: k === 0 ? 1 : clamp(1 + Math.round(d * 3.2), 1, 5), seed: hashInts(seedHash, 100, k), name: featureName(hashInts(seedHash, 101, k), 'cave')});
    }
  }
  // Discoveries: ruins, shrines, groves, camps and caches placed by terrain rules (not uniformly).
  {
    const kinds = [
      {kind: 'ruin', want: 6, ok: c => slope[c] < .12 && (biome[c] === BIOME.MEADOW || biome[c] === BIOME.STEPPE || biome[c] === BIOME.FOREST) && riverNear[c] > 4},
      {kind: 'shrine', want: 5, ok: c => elev[c] > 70 && slope[c] < .2 && biome[c] !== BIOME.SNOW},
      {kind: 'grove', want: 5, ok: c => forest[c] > .7 && slope[c] < .12},
      {kind: 'camp', want: 6, ok: c => slope[c] < .1 && riverNear[c] < 5 && riverNear[c] > 1},
      {kind: 'cache', want: 8, ok: c => slope[c] < .25 && (biome[c] === BIOME.ROCK || biome[c] === BIOME.PINE || biome[c] === BIOME.TUNDRA || coastNear[c] < 3)},
    ];
    const dr = createRandom(hashInts(seedHash, 9)), scale = (SIZE / 4096) * (SIZE / 4096);
    for (const k of kinds) {
      let placed = 0;
      for (let tries = 0; tries < 3000 && placed < Math.round(k.want * scale); tries++) {
        const i = dr.int(4, N - 5), j = dr.int(4, N - 5), c = idx(i, j);
        if (ocean[c] || lakeId[c] >= 0 || riverOf[c] >= 0 || roadCells[c] || !k.ok(c)) continue;
        const x = cellX(i) + dr.range(-6, 6), z = cellZ(j) + dr.range(-6, 6);
        if ([...discoveries, ...entrances, ...settlements].some(o => dist2(o, {x, z}) < (o.radius || 0) + 140)) continue;
        const d = dist2({x, z}, {x: startX, z: startZ}) / (SIZE * .5);
        discoveries.push({id: `d${discoveries.length}`, kind: k.kind, x, z, region: lmRegion(x, z), tier: clamp(Math.round(d * 4), 0, 4), name: featureName(hashInts(seedHash, 102, discoveries.length), k.kind)});
        placed++;
      }
    }
  }
  timing.regions = lap();

  // ---------- fine surface ----------
  // Roughness by place: crags in the mountains, soft roll on meadows, almost none near water.
  const rough = new Float64Array(NN);
  for (let c = 0; c < NN; c++) rough[c] = ocean[c] ? .6 : lakeId[c] >= 0 ? .3 : clamp(.7 + slope[c] * 10 + Math.max(0, elev[c] - 120) / 50, .5, 9) * smooth(0, 3, riverNear[c] + .5);
  // Ledges: in hill country the slopes break into terraces with short steep risers (the scarps and shelves that make
  // a hillside read as rock and grass), kept off water, flat floors and the lowland plains.
  const scarp = new Float64Array(NN);
  // Only in patches (a few hillsides, not every slope), and never on mountain faces, where 7 m steps read as sawteeth.
  for (let c = 0; c < NN; c++) { const i = c % N, j = (c - i) / N; scarp[c] = ocean[c] || lakeId[c] >= 0 ? 0 : hilly[c] * smooth(.05, .2, slope[c]) * (1 - smooth(.28, .5, slope[c])) * (1 - smooth(140, 210, elev[c]))
    * smooth(.05, .3, reliefNoise.fbm(i * .045 + 11, j * .045 - 7, 2)) * smooth(2, 5, riverNear[c]) * smooth(2, 5, lakeNear[c]) * smooth(2, 5, coastNear[c]); }
  const SEGS = seg.freeze();
  const QUERY = {d: 0, t: 0, k: -1};

  /** Ground height in metres at world (x, z): the authoritative baseline every device agrees on. */
  function heightAt(x, z) {
    let h = cubic(elev, x, z);
    const r = bilinear(rough, x, z);
    h += r * (detailNoise.fbm(x * .018, z * .018, 4) * .9 + detailNoise.ridged(x * .006 + 3, z * .006, 3) * r * .12 - r * .05);
    const hl = bilinear(hilly, x, z);
    if (hl > .02) h += hl * (4.5 * detailNoise.fbm(x * .011 + 7, z * .011 - 3, 3) + 2.2 * detailNoise.fbm(x * .03 - 5, z * .03 + 8, 2)); // knolls and hummocks
    const sc = bilinear(scarp, x, z);
    if (sc > .03) { // terrace: hold each 7 m band flat, then step up over its last 30% (a smooth riser, never a vertical wall)
      const step = 7, t = h / step + detailNoise.fbm(x * .02 + 2, z * .02 + 6, 2) * .35, f = t - Math.floor(t), q = smooth(.62, .92, f);
      h += ((Math.floor(t) + q) * step - t * step) * Math.min(.85, sc * 1.3);
    }
    // Roads: flatten toward their smoothed bed.
    let rd = Infinity, ry = 0;
    SEGS.forEachNear(x, z, 1, (k, d, t) => { if (d < rd) { rd = d; ry = SEGS.lerpY(k, t); } });
    if (rd < 9) h += (ry + .12 - h) * (1 - smooth(2.4, 9, rd));
    // Rivers: a channel below the surface, banks easing up to the land, levees if the land dipped below water.
    let best = Infinity, bk = -1, bt = 0;
    SEGS.forEachNear(x, z, 0, (k, d, t) => { if (d - SEGS.width(k, t) * .5 < best) { best = d - SEGS.width(k, t) * .5; bk = k; bt = t; } });
    if (bk >= 0) {
      const w = SEGS.width(bk, bt) * .5, s = SEGS.surface(bk, bt), depth = SEGS.depth(bk, bt), d = best + w, bank = w + 5 + w * .7;
      if (d < w) { const q = d / w; h = Math.min(h, s - depth * (1 - q * q) - .1); }
      else if (d < bank) { const k = smooth(0, 1, (d - w) / (bank - w)), lip = s + .35; h = lip + (h - lip) * k; if (h < lip && k < 1) h = Math.max(h, lip - .25 * k); }
    }
    return h;
  }
  /** Water surface at (x, z), or -Infinity where it is dry: sea (0), lake level, or the local river surface. */
  function waterAt(x, z) {
    let best = -Infinity;
    SEGS.forEachNear(x, z, 0, (k, d, t) => { if (d <= SEGS.width(k, t) * .5 + .6) best = Math.max(best, SEGS.surface(k, t)); });
    const c = cellAt(x, z);
    if (lakeId[c] >= 0) best = Math.max(best, lakes[lakeId[c]].level);
    else { const fx = (x + HALF) / CELL - .5, fz = (z + HALF) / CELL - .5; // lake shore cells: check neighbours
      for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const q = at(lakeId, Math.floor(fx) + a, Math.floor(fz) + b); if (q >= 0) best = Math.max(best, lakes[q].level); } }
    if (bilinear(oceanF, x, z) > .02 || heightAtCoarse(x, z) < 0) best = Math.max(best, 0);
    return best;
  }
  const oceanF = Float64Array.from(ocean);
  const heightAtCoarse = (x, z) => bilinear(elev, x, z);
  /** Biome id at (x, z) with natural, noise-broken boundaries. */
  function biomeAt(x, z) {
    const jx = x + 22 * detailNoise.noise(x * .02, z * .02 + 9), jz = z + 22 * detailNoise.noise(x * .02 + 9, z * .02);
    return biome[cellAt(jx, jz)];
  }
  const sampleField = a => (x, z) => bilinear(a, x, z);
  /** Danger tier 0..5 at (x, z): grows with distance from the start and with altitude; regions carry their own tier. */
  function dangerAt(x, z) {
    const d = Math.sqrt((x - startX) * (x - startX) + (z - startZ) * (z - startZ)) / (SIZE * .5);
    return clamp(d * 4 + Math.max(0, heightAtCoarse(x, z) - 80) / 140, 0, 5);
  }
  function regionAt(x, z) { const c = cellAt(x, z); return regionOf[c] >= 0 ? regions[regionOf[c]] : null; }
  /** Nearest river within `radius` metres: {river, distance, surface, width, along:[dx,dz]} or null. */
  function riverNearPoint(x, z, radius = 60) {
    let best = null;
    SEGS.forEachNear(x, z, 0, (k, d, t) => { if (d <= radius && (!best || d < best.distance)) best = {river: SEGS.owner(k), distance: d, surface: SEGS.surface(k, t), width: SEGS.width(k, t), along: SEGS.dir(k)}; });
    return best;
  }
  const isWater = (x, z) => waterAt(x, z) > heightAt(x, z) + .05;

  /**
   * Seeded placement hook (dungeons, camps, roguelite destinations...). Deterministic for the same world + salt.
   * @param {{count:number, spacing?:number, salt?:number|string, avoid?:{x:number,z:number,r?:number}[],
   *          filter?:(s:{x,z,height,slope,biome,danger,region,water})=>number|boolean, near?:{x,z,min?:number,max?:number}}} opts
   * filter returns false/0 to reject or a positive score (higher is preferred). Returns [{id,x,z,y,yaw,biome,danger,region}].
   */
  function findSites({count = 1, spacing = 200, salt = 0, avoid = [], filter = () => 1, near = null} = {}) {
    const r = createRandom(hashInts(seedHash, 500, typeof salt === 'number' ? salt : hashSeed(salt)));
    const picks = [], tries = count * 400;
    const cands = [];
    for (let k = 0; k < tries; k++) {
      let x, z;
      if (near) { const a = r.range(0, 1), d = (near.min || 0) + ((near.max || SIZE * .5) - (near.min || 0)) * Math.sqrt(r.next()); const ang = a * 6.283185307179586; x = near.x + d * cosQ(ang); z = near.z + d * sinQ(ang); }
      else { x = r.range(-HALF * .92, HALF * .92); z = r.range(-HALF * .92, HALF * .92); }
      if (Math.abs(x) > HALF * .94 || Math.abs(z) > HALF * .94) continue;
      const c = cellAt(x, z); if (ocean[c] || lakeId[c] >= 0) continue;
      const sample = {x, z, height: heightAt(x, z), slope: slope[c], biome: BIOME_NAMES[biome[c]], danger: dangerAt(x, z), region: regionOf[c] >= 0 ? regions[regionOf[c]].id : null, water: isWater(x, z), road: !!roadCells[c]};
      if (sample.water) continue;
      const s = filter(sample); if (!s) continue;
      cands.push({score: (s === true ? 1 : s) + r.next() * 1e-6, sample});
    }
    cands.sort((a, b) => b.score - a.score);
    for (const {sample} of cands) {
      if (picks.length >= count) break;
      if (picks.some(p => dist2(p, sample) < spacing) || avoid.some(a => dist2(a, sample) < (a.r ?? spacing))) continue;
      // Face downhill (out of the slope), the natural way for an entrance or camp to open.
      const gx = heightAt(sample.x + 4, sample.z) - heightAt(sample.x - 4, sample.z), gz = heightAt(sample.x, sample.z + 4) - heightAt(sample.x, sample.z - 4);
      picks.push({id: `site-${typeof salt === 'number' ? salt : hashSeed(salt)}-${picks.length}`, x: sample.x, z: sample.z, y: sample.height, yaw: yawOf({x: 0, z: 0}, {x: -gx, z: -gz}), biome: sample.biome, danger: sample.danger, region: sample.region});
    }
    return picks;
  }

  const spawn = (() => {
    // Stand just outside the start village on its road side, on dry gentle ground.
    for (let k = 0; k < 64; k++) {
      const a = k * 2.399963, d = startSettlement.radius ? startSettlement.radius * .55 + k * 1.5 : k * 3;
      const x = startX + d * cosQ(a), z = startZ + d * sinQ(a);
      if (!isWater(x, z) && slope[cellAt(x, z)] < .2) return {x, z, y: heightAt(x, z)};
    }
    return {x: startX, z: startZ, y: heightAt(startX, startZ)};
  })();
  timing.total = now() - tStart;

  return {
    version: WORLDGEN_VERSION, seed: seedText, seedHash, preset: P.id, presetName: P.name, size: SIZE, half: HALF, cell: CELL, n: N,
    contentChunk: CONTENT_CHUNK, windDir: ['west', 'east', 'north', 'south'][windDir], riverThreshold,
    heightAt, waterAt, biomeAt, dangerAt, regionAt, riverNear: riverNearPoint, isWater, findSites,
    moistureAt: sampleField(moist), temperatureAt: sampleField(temp), forestAt: (x, z) => bilinear(forest, x, z), slopeAt: sampleField(slope), hillAt: sampleField(hilly), scarpAt: sampleField(scarp),
    roadAt: (x, z) => { let rd = Infinity; SEGS.forEachNear(x, z, 1, (k, d) => { if (d < rd) rd = d; }); return rd; },
    settlements, roads, rivers, lakes, regions, landmarks, discoveries, entrances, spawn, start: {x: startX, z: startZ, settlement: startSettlement.id},
    grids: {elev, biome, forest, moist, temp, ocean, lakeId, riverOf, regionOf, roadCells, slope},
    timing,
  };

  // ----- local helpers that close over N -----
  function cellDist(a, b) { const ai = a % N, aj = (a - ai) / N, bi = b % N, bj = (b - bi) / N; return Math.sqrt((ai - bi) * (ai - bi) + (aj - bj) * (aj - bj)); }
  function localMean(a, c, r) { const i = c % N, j = (c - i) / N; let s = 0, n = 0; for (let b = -r; b <= r; b += 2) for (let q = -r; q <= r; q += 2) { s += at(a, i + q, j + b); n++; } return s / n; }
  function lap() { const t = now(), d = t - t0; t0 = t; return +d.toFixed(1); }
}
const now = () => (globalThis.performance?.now?.() ?? 0);
const dist2 = (a, b) => Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z));
// Yaw convention matches the game: yaw 0 looks toward -z; atan2 replaced by a deterministic approximation.
function yawOf(a, b) { return atanQ2(-(b.x - a.x), -(b.z - a.z)); }
function catmull(t) { const t2 = t * t, t3 = t2 * t; return [(-t3 + 2 * t2 - t) * .5, (3 * t3 - 5 * t2 + 2) * .5, (-3 * t3 + 4 * t2 + t) * .5, (t3 - t2) * .5]; }
function chaikin(pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1];
    out.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25, a[2] * .75 + b[2] * .25], [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75, a[2] * .25 + b[2] * .75]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
function smoothRoadHeights(pts) { for (let pass = 0; pass < 6; pass++) for (let k = 1; k < pts.length - 1; k++) pts[k].y = (pts[k - 1].y + pts[k].y * 2 + pts[k + 1].y) / 4; }
function blur(a, N, r) {
  const tmp = new Float64Array(a.length);
  for (let j = 0; j < N; j++) { let s = 0; for (let i = -r; i <= r; i++) s += a[j * N + Math.max(0, Math.min(N - 1, i))]; for (let i = 0; i < N; i++) { tmp[j * N + i] = s / (2 * r + 1); s += a[j * N + Math.min(N - 1, i + r + 1)] - a[j * N + Math.max(0, i - r)]; } }
  for (let i = 0; i < N; i++) { let s = 0; for (let j = -r; j <= r; j++) s += tmp[Math.max(0, Math.min(N - 1, j)) * N + i]; for (let j = 0; j < N; j++) { a[j * N + i] = s / (2 * r + 1); s += tmp[Math.min(N - 1, j + r + 1) * N + i] - tmp[Math.max(0, j - r) * N + i]; } }
}
/** Chamfer distance (cells) to the nearest cell where `is(c)` holds; capped at 64. */
function waterDistance(N, is) {
  const d = new Float64Array(N * N).fill(64);
  for (let c = 0; c < N * N; c++) if (is(c)) d[c] = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const c = j * N + i; if (i) d[c] = Math.min(d[c], d[c - 1] + 1); if (j) d[c] = Math.min(d[c], d[c - N] + 1); if (i && j) d[c] = Math.min(d[c], d[c - N - 1] + 1.414); if (j && i < N - 1) d[c] = Math.min(d[c], d[c - N + 1] + 1.414); }
  for (let j = N - 1; j >= 0; j--) for (let i = N - 1; i >= 0; i--) { const c = j * N + i; if (i < N - 1) d[c] = Math.min(d[c], d[c + 1] + 1); if (j < N - 1) d[c] = Math.min(d[c], d[c + N] + 1); if (i < N - 1 && j < N - 1) d[c] = Math.min(d[c], d[c + N + 1] + 1.414); if (j < N - 1 && i) d[c] = Math.min(d[c], d[c + N - 1] + 1.414); }
  return d;
}
// f^p for p near 1 without Math.pow: blend of f, f^2 and sqrt(f).
function skewPow(f, p) { return p >= 1 ? f + (f * f - f) * Math.min(1, p - 1) * 2 : f + (Math.sqrt(f) - f) * Math.min(1, (1 - p) * 3); }
function quantile(a, keep, q) {
  const vals = []; for (let c = 0; c < a.length; c++) if (keep(c)) vals.push(a[c]);
  if (!vals.length) return Infinity;
  vals.sort((x, y) => x - y); return vals[Math.min(vals.length - 1, Math.floor(vals.length * q))];
}
/** Droplet hydraulic erosion (after Hans Beyer / Sebastian Lague), heights in metres, deterministic. */
function erode(h, N, rand, drops) {
  const S = 1 / 380; // work in normalised heights so tuning is scale-free
  for (let c = 0; c < h.length; c++) h[c] *= S;
  const INERTIA = .06, CAPACITY = 5, MIN_CAP = .01, DEPOSIT = .3, ERODE = .32, EVAP = .02, GRAV = 4, STEPS = 40, R = 2;
  // Precomputed erosion brush (cells within radius R, weights by distance).
  const brush = []; let wsum = 0;
  for (let b = -R; b <= R; b++) for (let a = -R; a <= R; a++) { const d = Math.sqrt(a * a + b * b); if (d <= R) { const w = 1 - d / R; brush.push([a, b, w]); wsum += w; } }
  for (const br of brush) br[2] /= wsum;
  const grad = (x, z, out) => {
    const i = Math.floor(x), j = Math.floor(z), u = x - i, v = z - j, c = j * N + i;
    const nw = h[c], ne = h[c + 1], sw = h[c + N], se = h[c + N + 1];
    out[0] = (ne - nw) * (1 - v) + (se - sw) * v; out[1] = (sw - nw) * (1 - u) + (se - ne) * u;
    out[2] = nw * (1 - u) * (1 - v) + ne * u * (1 - v) + sw * (1 - u) * v + se * u * v;
  };
  const g = [0, 0, 0], g2 = [0, 0, 0];
  for (let n = 0; n < drops; n++) {
    let x = 1 + rand.next() * (N - 3), z = 1 + rand.next() * (N - 3), dx = 0, dz = 0, speed = 1, water = 1, sed = 0;
    for (let s = 0; s < STEPS; s++) {
      const i = Math.floor(x), j = Math.floor(z), u = x - i, v = z - j;
      grad(x, z, g);
      dx = dx * INERTIA - g[0] * (1 - INERTIA); dz = dz * INERTIA - g[1] * (1 - INERTIA);
      const len = Math.sqrt(dx * dx + dz * dz); if (len < 1e-9) break;
      dx /= len; dz /= len; const nx = x + dx, nz = z + dz;
      if (nx < 1 || nz < 1 || nx >= N - 2 || nz >= N - 2) break;
      grad(nx, nz, g2);
      const dh = g2[2] - g[2], cap = Math.max(-dh * speed * water * CAPACITY, MIN_CAP * .001);
      if (g[2] < 0) break; // reached the sea
      if (sed > cap || dh > 0) {
        const amt = dh > 0 ? Math.min(dh, sed) : (sed - cap) * DEPOSIT; sed -= amt;
        const c = j * N + i;
        h[c] += amt * (1 - u) * (1 - v); h[c + 1] += amt * u * (1 - v); h[c + N] += amt * (1 - u) * v; h[c + N + 1] += amt * u * v;
      } else {
        const amt = Math.min((cap - sed) * ERODE, -dh);
        for (const [a, b, w] of brush) { const ci = i + a, cj = j + b; if (ci < 0 || cj < 0 || ci >= N || cj >= N) continue; const c = cj * N + ci, take = amt * w; h[c] -= take; sed += take; }
      }
      speed = Math.sqrt(Math.max(0, speed * speed + dh * GRAV)); water *= 1 - EVAP; x = nx; z = nz;
    }
  }
  for (let c = 0; c < h.length; c++) h[c] /= S;
}
/** Segment index: rivers (layer 0) and roads (layer 1) in a bucket grid, with per-vertex width/surface/depth/y. */
function createSegmentIndex(half, bucket) {
  const B = Math.ceil(half * 2 / bucket), buckets = [new Map(), new Map()], segs = [];
  return {
    add(layer, owner, k, a, b, reach) {
      const id = segs.length; segs.push({layer, owner, a, b});
      const x0 = Math.floor((Math.min(a.x, b.x) - reach + half) / bucket), x1 = Math.floor((Math.max(a.x, b.x) + reach + half) / bucket);
      const z0 = Math.floor((Math.min(a.z, b.z) - reach + half) / bucket), z1 = Math.floor((Math.max(a.z, b.z) + reach + half) / bucket);
      for (let j = Math.max(0, z0); j <= Math.min(B - 1, z1); j++) for (let i = Math.max(0, x0); i <= Math.min(B - 1, x1); i++) {
        const key = j * B + i, m = buckets[layer]; if (!m.has(key)) m.set(key, []); m.get(key).push(id);
      }
    },
    freeze() {
      const n = segs.length, ax = new Float64Array(n), az = new Float64Array(n), bx = new Float64Array(n), bz = new Float64Array(n);
      const wa = new Float64Array(n), wb = new Float64Array(n), sa = new Float64Array(n), sb = new Float64Array(n), da = new Float64Array(n), db = new Float64Array(n), ya = new Float64Array(n), yb = new Float64Array(n), owner = new Int32Array(n);
      segs.forEach((s, k) => { ax[k] = s.a.x; az[k] = s.a.z; bx[k] = s.b.x; bz[k] = s.b.z; wa[k] = s.a.width || 0; wb[k] = s.b.width || 0; sa[k] = s.a.surface || 0; sb[k] = s.b.surface || 0; da[k] = s.a.depth || 0; db[k] = s.b.depth || 0; ya[k] = s.a.y || 0; yb[k] = s.b.y || 0; owner[k] = s.owner; });
      const lists = buckets.map(m => { const out = new Map(); for (const [k, v] of m) out.set(k, Int32Array.from(v)); return out; });
      return {
        forEachNear(x, z, layer, fn) {
          const i = Math.floor((x + half) / bucket), j = Math.floor((z + half) / bucket); if (i < 0 || j < 0 || i >= B || j >= B) return;
          const list = lists[layer].get(j * B + i); if (!list) return;
          for (let n = 0; n < list.length; n++) {
            const k = list[n], dx = bx[k] - ax[k], dz = bz[k] - az[k], l2 = dx * dx + dz * dz || 1e-9;
            const t = clamp(((x - ax[k]) * dx + (z - az[k]) * dz) / l2, 0, 1), px = ax[k] + dx * t - x, pz = az[k] + dz * t - z;
            fn(k, Math.sqrt(px * px + pz * pz), t);
          }
        },
        width: (k, t) => wa[k] + (wb[k] - wa[k]) * t, surface: (k, t) => sa[k] + (sb[k] - sa[k]) * t, depth: (k, t) => da[k] + (db[k] - da[k]) * t,
        lerpY: (k, t) => ya[k] + (yb[k] - ya[k]) * t, owner: k => owner[k],
        dir: k => { const dx = bx[k] - ax[k], dz = bz[k] - az[k], l = Math.sqrt(dx * dx + dz * dz) || 1; return [dx / l, dz / l]; },
        count: n,
      };
    },
  };
}
// Deterministic trig for placement only (never Math.sin/cos/atan2 in generated values).
function sinQ(a) { a = a % 6.283185307179586; if (a > 3.141592653589793) a -= 6.283185307179586; if (a < -3.141592653589793) a += 6.283185307179586; const a2 = a * a; return a * (1 - a2 / 6 * (1 - a2 / 20 * (1 - a2 / 42 * (1 - a2 / 72 * (1 - a2 / 110))))); }
const cosQ = a => sinQ(a + 1.5707963267948966);
function atanQ2(y, x) {
  // Polynomial atan2 (max error ~1e-5 rad), exact sign handling.
  if (x === 0 && y === 0) return 0;
  const ax = Math.abs(x), ay = Math.abs(y), a = Math.min(ax, ay) / Math.max(ax, ay), s = a * a;
  let r = ((-.0464964749 * s + .15931422) * s - .327622764) * s * a + a;
  if (ay > ax) r = 1.5707963267948966 - r; if (x < 0) r = 3.141592653589793 - r; if (y < 0) r = -r;
  return r;
}
export {sinQ, cosQ, atanQ2};
