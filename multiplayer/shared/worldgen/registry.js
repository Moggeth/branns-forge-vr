// One generated world per descriptor, shared by the simulation, terrain, renderer and the other modes.
//
// A world descriptor is the ONLY generated-world data a save or snapshot carries:
//   state.world = {kind:'wilds'|'expedition'|..., seed:'mossy-heron-417', preset:'continent', size:4096, gen:1}
// Arena worlds have no state.world at all (old saves load unchanged).
//
// Sim coordinates are the generated world shifted so the starting village's square sits at the origin. That is where
// Brann's Forge stands in every world, so the forge, shrine and their protected aprons work exactly as in the arena.
import {generateWorld, WORLDGEN_VERSION} from './generate.js';
import {PRESETS} from './presets.js';
import {cleanSeed} from './random.js';

export const WORLD_KINDS = Object.freeze(['wilds', 'expedition', 'underways']);
const cache = new Map();
const MAX_CACHED = 3;

/** Validate and normalise a descriptor (from a save, snapshot, menu or another mode). Throws on anything odd. */
export function restoreWorldDescriptor(w) {
  if (w === undefined || w === null) return undefined;
  if (typeof w !== 'object' || Array.isArray(w)) throw Error('Invalid world');
  const keys = Object.keys(w);
  if (keys.some(k => !['kind', 'seed', 'preset', 'size', 'gen'].includes(k))) throw Error('Invalid world');
  if (!WORLD_KINDS.includes(w.kind) || typeof w.seed !== 'string' || cleanSeed(w.seed) !== w.seed || !Object.hasOwn(PRESETS, w.preset)) throw Error('Invalid world');
  if (!Number.isSafeInteger(w.size) || w.size < 1024 || w.size > 8192 || w.size % 256) throw Error('Invalid world size');
  if (!Number.isSafeInteger(w.gen) || w.gen < 1 || w.gen > WORLDGEN_VERSION) throw Error('Invalid world generator');
  return {kind: w.kind, seed: w.seed, preset: w.preset, size: w.size, gen: w.gen};
}
/** Build a descriptor for a new world. */
export function worldDescriptor({kind = 'wilds', seed = 'brann', preset = 'continent', size} = {}) {
  const P = PRESETS[preset] || PRESETS.continent;
  return restoreWorldDescriptor({kind, seed: cleanSeed(seed), preset: P.id, size: size ?? P.size, gen: WORLDGEN_VERSION});
}
const keyOf = d => `${d.gen}|${d.preset}|${d.size}|${d.seed}`;

/**
 * The generated world for a descriptor (or for a state carrying one), wrapped in sim coordinates. null for arena.
 * Returned object: everything generateWorld returns (in generator coordinates) plus sim-space helpers:
 *   heightAt(x,z), waterAt(x,z), biomeAt, forestAt, dangerAt, regionAt, isWater, toSim(p), toGen(p), bounds, offset
 * Lists in sim space: settlements, entrances, discoveries, landmarks, roads, rivers, lakes, regions (cloned, shifted).
 */
export function worldFor(source) {
  const d = source?.world !== undefined ? source.world : source;
  if (!d || typeof d !== 'object' || !d.seed) return null;
  const key = keyOf(d);
  let w = cache.get(key);
  if (w) { cache.delete(key); cache.set(key, w); return w; }
  w = wrap(generateWorld({seed: d.seed, preset: d.preset, size: d.size}));
  cache.set(key, w);
  while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value);
  return w;
}
export const clearWorldCache = () => cache.clear();

function wrap(gen) {
  const ox = gen.start.x, oz = gen.start.z; // generator point that becomes sim (0,0)
  const toSim = p => ({...p, x: p.x - ox, z: p.z - oz});
  const shiftPts = list => list.map(p => ({...p, x: p.x - ox, z: p.z - oz}));
  const village = gen.settlements.find(s => s.start) || {radius: 40};
  // The village square: flat ground (the forge yard) blended into the land around it.
  const plazaY = Math.max(1.5, gen.heightAt(ox, oz)), PLAZA = village.radius * .5, BLEND = village.radius * .6;
  const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const plaza = (x, z, h) => { const d = Math.sqrt(x * x + z * z); if (d >= PLAZA + BLEND) return h; return plazaY + (h - plazaY) * smooth(PLAZA, PLAZA + BLEND, d); };
  // Other settlements get gentle level yards too (in generator space).
  const yards = gen.settlements.filter(s => !s.start).map(s => ({x: s.x, z: s.z, r: s.radius * .45, b: s.radius * .5, y: Math.max(1.5, gen.heightAt(s.x, s.z))}));
  const yard = (gx, gz, h) => { for (const s of yards) { const dx = gx - s.x, dz = gz - s.z; if (Math.abs(dx) > s.r + s.b || Math.abs(dz) > s.r + s.b) continue; const d = Math.sqrt(dx * dx + dz * dz); if (d < s.r + s.b) h = s.y + (h - s.y) * smooth(s.r, s.r + s.b, d); } return h; };
  const heightAt = (x, z) => plaza(x, z, yard(x + ox, z + oz, gen.heightAt(x + ox, z + oz)));
  const bounds = {minX: -gen.half - ox, maxX: gen.half - ox, minZ: -gen.half - oz, maxZ: gen.half - oz};
  // Players stay a little inside the generated square (the sea beyond is drawn to the horizon).
  const margin = 64;
  const walkBounds = {minX: bounds.minX + margin, maxX: bounds.maxX - margin, minZ: bounds.minZ + margin, maxZ: bounds.maxZ - margin};
  return {
    gen, offset: [ox, oz], bounds, walkBounds,
    extent: Math.max(-bounds.minX, bounds.maxX, -bounds.minZ, bounds.maxZ),
    seed: gen.seed, preset: gen.preset, presetName: gen.presetName, size: gen.size, version: gen.version,
    toSim, toGen: p => ({...p, x: p.x + ox, z: p.z + oz}),
    heightAt,
    waterAt: (x, z) => gen.waterAt(x + ox, z + oz),
    isWater: (x, z) => gen.waterAt(x + ox, z + oz) > heightAt(x, z) + .05,
    biomeAt: (x, z) => gen.biomeAt(x + ox, z + oz),
    forestAt: (x, z) => gen.forestAt(x + ox, z + oz),
    moistureAt: (x, z) => gen.moistureAt(x + ox, z + oz),
    temperatureAt: (x, z) => gen.temperatureAt(x + ox, z + oz),
    slopeAt: (x, z) => gen.slopeAt(x + ox, z + oz),
    hillAt: (x, z) => gen.hillAt(x + ox, z + oz),
    scarpAt: (x, z) => gen.scarpAt(x + ox, z + oz),
    roadAt: (x, z) => gen.roadAt(x + ox, z + oz),
    dangerAt: (x, z) => gen.dangerAt(x + ox, z + oz),
    regionAt: (x, z) => { const r = gen.regionAt(x + ox, z + oz); return r && toSim(r); },
    riverNear: (x, z, radius) => gen.riverNear(x + ox, z + oz, radius),
    findSites: opts => gen.findSites({...opts, near: opts?.near ? {...opts.near, x: opts.near.x + ox, z: opts.near.z + oz} : null,
      avoid: (opts?.avoid || []).map(a => ({...a, x: a.x + ox, z: a.z + oz}))}).map(toSim),
    plaza: {y: plazaY, radius: PLAZA},
    settlements: shiftPts(gen.settlements), entrances: shiftPts(gen.entrances), discoveries: shiftPts(gen.discoveries),
    landmarks: shiftPts(gen.landmarks), regions: gen.regions.map(r => ({...toSim(r), peak: r.peak && toSim(r.peak)})),
    lakes: gen.lakes.map(l => ({...toSim(l), bounds: [l.bounds[0] - ox, l.bounds[1] - oz, l.bounds[2] - ox, l.bounds[3] - oz]})),
    rivers: gen.rivers.map(r => ({...r, points: shiftPts(r.points), mouth: toSim(r.mouth), source: toSim(r.source)})),
    roads: gen.roads.map(r => ({...r, points: shiftPts(r.points), bridges: shiftPts(r.bridges)})),
    spawn: toSim(gen.spawn),
  };
}
