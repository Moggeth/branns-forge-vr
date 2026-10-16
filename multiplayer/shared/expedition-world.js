// Expedition Roguelite on a generated world: where a run's destinations go, and the world-mode hooks that let the
// seeded-world simulation drive a run. Pure and deterministic; the world object is whatever worldgen/registry.js
// worldFor() returns (duck-typed here so this file does not depend on the generator).
import {createRun, stepRun, runAction, restoreRun, RUN_TUNING, mix} from './expedition-run.js';

export const RUN_WORLD = Object.freeze({near: 40, far: 320, spacing: 34, count: 30, entrances: 2});

/** Integer run seed for a world seed string (the same text always gives the same run). */
export function runSeedFor(text) {
  let h = 2166136261;
  for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return (h % 2147483646) + 1;
}

/**
 * Destinations for a run, chosen from the world around the starting village (sim origin): dry, gentle ground in a
 * ring from 40 to 320 m out, plus up to two real Underways entrances when the world has them in range. Camp sits on
 * the world spawn. Same world + same run seed = same sites.
 */
export function runSitesFromWorld(world, seed) {
  if (!world?.findSites) throw Error('No world');
  const W = RUN_WORLD, camp = [Math.round(world.spawn.x * 10) / 10, Math.round(world.spawn.z * 10) / 10];
  const sites = world.findSites({count: W.count, spacing: W.spacing, salt: `expedition-run-${seed}`, near: {x: 0, z: 0, min: W.near, max: W.far},
    filter: s => s.slope > .55 || s.road ? 0 : 1 - s.slope * .8})
    .map(s => ({id: `xr_${s.id}`.slice(0, 32), x: s.x, z: s.z}));
  const inRange = e => { const d = Math.hypot(e.x - camp[0], e.z - camp[1]); return d >= W.near * 2 && d <= W.far * .85; };
  const doors = (world.entrances || []).filter(inRange)
    .map(e => [mix(seed, 'door', String(e.id)), e]).sort((a, b) => a[0] - b[0]).slice(0, W.entrances)
    .map(([, e]) => ({id: `xr_${e.id}`.slice(0, 32), x: e.x, z: e.z, kind: 'underways'}));
  // Entrances replace any ordinary site too close to them.
  const open = sites.filter(s => doors.every(d => Math.hypot(d.x - s.x, d.z - s.z) >= RUN_TUNING.spacing * 2));
  return {camp, sites: [...doors, ...open], bound: Math.round(Math.min(world.extent, W.far + 80))};
}

/**
 * World-mode hooks for registerWorldMode('expedition', ...). `deps` supplies what the run needs from the simulation
 * that a world-mode ctx does not carry: {grantXp, heroMaxHp, makeBoss}. The run lives in state.run either way, so
 * the arena and the generated world share one save format.
 */
export function expeditionWorldMode(deps, worldFor) {
  const ctxOf = ctx => ({createEnemy: ctx.createEnemy, terrainHeight: ctx.terrainHeight, grantXp: deps.grantXp, heroMaxHp: deps.heroMaxHp, makeBoss: deps.makeBoss});
  return {
    newState(state, world, options = {}) {
      if (state.run) return;
      const seed = options.seed || runSeedFor(state.world?.seed || 'brann');
      const placed = runSitesFromWorld(world || worldFor(state), seed);
      state.run = createRun({format: options.format || 'expedition', seed, daily: options.daily || '', boss: options.boss || '', ...placed});
    },
    step(state, ctx, events) { return state.run ? stepRun(state, events, ctxOf(ctx)).events : []; },
    action(state, player, message, ctx) { return message?.mode === 'expedition' || message?.action ? (state.run ? runAction(state, player, message, ctxOf(ctx)) : {ok: false, error: 'no_run'}) : null; },
    restore(saved, state) { if (saved.run !== undefined) state.run = restoreRun(saved.run); },
    snapshot(state, out) { if (state.run) out.run = state.run; },
  };
}
