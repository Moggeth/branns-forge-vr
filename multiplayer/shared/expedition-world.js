// Expedition Roguelite on a generated world: where a run's destinations go, and the world-mode hooks that let the
// seeded-world simulation drive a run. Pure and deterministic; the world object is whatever worldgen/registry.js
// worldFor() returns (duck-typed here so this file does not depend on the generator).
import {createRun, RUN_TUNING, mix} from './expedition-run.js';
import {registerWorldMode} from './world-modes.js';

export const RUN_WORLD = Object.freeze({near: 40, far: 380, spacing: 45, count: 24, entrances: 2});

/** Integer run seed for a world seed string (the same text always gives the same run). */
export function runSeedFor(text) {
  let h = 2166136261;
  for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return (h % 2147483646) + 1;
}

/**
 * Destinations for a run, chosen from the world around the starting village (sim origin): dry, gentle ground in a
 * ring from 40 to 380 m out, plus up to two real Underways entrances when the world has them in range. Camp is the
 * village plaza at the origin. Same world + same run seed = same sites.
 */
export function runSitesFromWorld(world, seed) {
  if (!world?.findSites) throw Error('No world');
  const W = RUN_WORLD, camp = [0, 0]; // the village forge plaza
  const sites = world.findSites({count: W.count, spacing: W.spacing, salt: `expedition-run-${seed}`, near: {x: 0, z: 0, min: W.near, max: W.far},
    filter: s => s.slope > .55 || s.road ? 0 : 1 - s.slope * .8})
    .map(s => ({id: `xr_${s.id}`.slice(0, 32), x: s.x, z: s.z}));
  const inRange = e => { const d = Math.hypot(e.x - camp[0], e.z - camp[1]); return d >= W.near * 2 && d <= W.far * .85; };
  const doors = (world.entrances || []).filter(inRange)
    .map(e => [mix(seed, 'door', String(e.id)), e]).sort((a, b) => a[0] - b[0]).slice(0, W.entrances)
    .map(([, e]) => ({id: `xr_${e.id}`.slice(0, 32), x: e.x, z: e.z, kind: 'underways'}));
  // Entrances replace any ordinary site too close to them.
  const open = sites.filter(s => doors.every(d => Math.hypot(d.x - s.x, d.z - s.z) >= RUN_TUNING.spacing * 2));
  const wb = world.walkBounds || {minX: -world.extent, maxX: world.extent, minZ: -world.extent, maxZ: world.extent};
  return {camp, sites: [...doors, ...open], bound: Math.round(Math.min(-wb.minX, wb.maxX, -wb.minZ, wb.maxZ, 4000))};
}

/**
 * The 'expedition' world mode. The shared simulation already steps, saves and snapshots state.run for arena runs, so
 * the mode only has to build the run when a generated world is created: newState(state, world, runOptions).
 * (Registering step/restore/snapshot too would run the director twice.)
 */
export const EXPEDITION_MODE = Object.freeze({
  newState(state, world, options = {}) {
    if (state.run || !world) return;
    const seed = Number.isSafeInteger(options.seed) && options.seed > 0 ? options.seed : runSeedFor(state.world?.seed || 'brann');
    state.run = createRun({format: options.format || 'expedition', seed, daily: options.daily || '', boss: options.boss || '', ...runSitesFromWorld(world, seed)});
  },
});
registerWorldMode('expedition', EXPEDITION_MODE);
