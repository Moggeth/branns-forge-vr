// Presentation-only deformation field for freshly cut/raised ground (strata, wet floors, ejecta).
// It never owns height: every texel is derived from the caller's authoritative height(x, z) and authoritative
// undeformed baseHeight(x, z). Work is limited to dirty rectangles around added/removed accepted snapshot edits
// and drained by a time-budgeted job, so a spell never resamples the whole world synchronously.
//
// Texel layout (RGBA half-float, world XZ rect = [-half, half]^2, row j = +Z, linear-filterable in WebGL2):
//   R  base:   authoritative undeformed height at the texel (only meaningful where G != 0)
//   G  D:      height - base (signed displacement, metres)
//   B  peak:   largest centre displacement among raise edits covering the texel (for flank strata depth)
//   A  ejecta: thrown-soil ring just outside cuts (0..1)
// The shader computes strata depth as R - fragmentWorldY so bands sit at exact world heights on the real mesh.
import {DataUtils} from 'three';
import {terrainEditScale,terrainFrameKey} from '../shared/terrain.js';

export const DEFORM_FIELD_VERSION = 1;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const toHalf = DataUtils.toHalfFloat, fromHalf = DataUtils.fromHalfFloat;

// Rect (texel indices, inclusive) that an edit can influence, including its ejecta ring.
export function editTexelRect(e, size, half) {
  const step = half * 2 / size, r = Math.max(.01, e.radius || 0) * 1.6;
  const i0 = Math.max(0, Math.floor((e.x - r + half) / step)), i1 = Math.min(size - 1, Math.ceil((e.x + r + half) / step));
  const j0 = Math.max(0, Math.floor((e.z - r + half) / step)), j1 = Math.min(size - 1, Math.ceil((e.z + r + half) / step));
  return i0 > i1 || j0 > j1 ? null : [i0, j0, i1, j1];
}
const editKey = (e,tick) => terrainFrameKey([e],tick);

// One texel from authoritative functions plus per-edit decoration (which edits are cuts/raises).
export function sampleDeformTexel(x, z, height, baseHeight, edits, peakOf = e => height(e.x, e.z) - baseHeight(e.x, e.z), tick=Infinity) {
  const base = baseHeight(x, z), d = height(x, z) - base;
  let peak = 0, ejecta = 0;
  for (const e of edits) {
    const r = Math.max(.01, e.radius || 0), dist = Math.hypot(x - e.x, z - e.z); if (dist >= r * 1.6) continue;
    const h = (e.height || 0)*terrainEditScale(e,tick,x,z);
    if (h > 0 && dist < r) peak = Math.max(peak, peakOf(e));
    // Thrown soil lands just outside a cut: strongest near 1.05r, gone by 1.55r, scaled by cut depth.
    if (h < 0) ejecta = Math.max(ejecta, Math.min(1, -h / 1.5) * smooth(.8, 1.02, dist / r) * smooth(1.55, 1.08, dist / r));
  }
  return {base, d, peak, ejecta};
}

export function createDeformationField({size = 384, half = 60, height, baseHeight} = {}) {
  if (typeof height !== 'function' || typeof baseHeight !== 'function') throw new Error('deformation field requires height and baseHeight');
  const data = new Uint16Array(size * size * 4), step = half * 2 / size; // all-zero half floats == undeformed
  let known = new Map(), queue = [], cursor = 0, edits = [], terrainTick=Infinity, cpuMs = 0, lastStepMs = 0, maxStepMs = 0, texelsDone = 0, version = 0;
  let peaks = new Map(); // raise-edit centre displacement, sampled lazily inside step() (setEdits never samples)
  const peakOf = e => { let p = peaks.get(e); if (p === undefined) { p = height(e.x, e.z) - baseHeight(e.x, e.z); peaks.set(e, p); } return p; };
  const area = r => (r[2] - r[0] + 1) * (r[3] - r[1] + 1);
  function enqueue(rect) { // merge overlapping rects (a Sunder cast adds 3 neighbouring edits) unless merging wastes work
    if (!rect) return;
    for (let k = cursor ? 1 : 0; k < queue.length; k++) { const q = queue[k];
      if (rect[0] <= q[2] + 1 && rect[2] >= q[0] - 1 && rect[1] <= q[3] + 1 && rect[3] >= q[1] - 1) {
        const m = [Math.min(q[0], rect[0]), Math.min(q[1], rect[1]), Math.max(q[2], rect[2]), Math.max(q[3], rect[3])];
        if (area(m) <= (area(q) + area(rect)) * 1.25) { queue[k] = m; return; }
      } }
    queue.push(rect);
  }
  return {
    data, size, half,
    // Ground supports may change while edit IDs stay unchanged. Queue one bounded rebake.
    invalidate() {known=new Map();queue=[[0,0,size-1,size-1]];cursor=0;peaks=new Map();},
    get pending() { return queue.length > 0; }, get cpuMs() { return cpuMs; }, get lastStepMs() { return lastStepMs; }, get maxStepMs() { return maxStepMs; },
    get texelsDone() { return texelsDone; }, get version() { return version; }, get queuedRects() { return queue.length; },
    // Diff accepted edits and queue dirty rects. Never samples anything itself.
    setEdits(next = [],tick=Infinity) {
      edits = next.slice();terrainTick=tick; peaks = new Map(); const nextKeys = new Map(); let n = 0;
      for (const e of edits) nextKeys.set(editKey(e,tick), e);
      for (const [k, e] of nextKeys) if (!known.has(k)) { enqueue(editTexelRect(e, size, half)); n++; }
      for (const [k, e] of known) if (!nextKeys.has(k)) { enqueue(editTexelRect(e, size, half)); n++; }
      known = nextKeys; return n;
    },
    // Time-budgeted drain; returns true when texels changed (upload worthwhile).
    step(budgetMs = 1.5, maxTexels = 4096) {
      if (!queue.length) { lastStepMs = 0; return false; }
      const start = performance.now(); let done = 0;
      outer: while (queue.length && done < maxTexels) {
        const r = queue[0], w = r[2] - r[0] + 1, total = area(r);
        while (cursor < total) {
          const i = r[0] + cursor % w, j = r[1] + Math.floor(cursor / w);
          const s = sampleDeformTexel(-half + (i + .5) * step, -half + (j + .5) * step, height, baseHeight, edits, peakOf,terrainTick), o = (j * size + i) * 4;
          data[o] = toHalf(s.base); data[o + 1] = toHalf(s.d); data[o + 2] = toHalf(s.peak); data[o + 3] = toHalf(s.ejecta);
          cursor++; done++;
          if (done >= maxTexels || ((done & 7) === 0 && performance.now() - start >= budgetMs)) { if (cursor >= total) { queue.shift(); cursor = 0; } break outer; }
        }
        queue.shift(); cursor = 0;
      }
      lastStepMs = performance.now() - start; cpuMs += lastStepMs; maxStepMs = Math.max(maxStepMs, lastStepMs); texelsDone += done;
      if (done) version++;
      return done > 0;
    },
    flush() { while (queue.length) this.step(Infinity, Infinity); }, // tests / loading screens only
    sample(x, z) { // nearest texel decode (tests, contact classification)
      const i = Math.min(size - 1, Math.max(0, Math.floor((x + half) / step))), j = Math.min(size - 1, Math.max(0, Math.floor((z + half) / step))), o = (j * size + i) * 4;
      return {base: fromHalf(data[o]), d: fromHalf(data[o + 1]), peak: fromHalf(data[o + 2]), ejecta: fromHalf(data[o + 3])};
    },
  };
}
