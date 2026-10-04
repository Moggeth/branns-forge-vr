// Crystal Outcrop: a living geode. Shared, deterministic, host-authoritative.
// Six crystal clusters grow from the outcrop. Each pick strike cracks one further (big clusters take 4, small 3); the
// last strike breaks it into Crystal (gems) on the ground. A broken cluster regrows from a stub over 3 minutes, then can
// be mined again. Everyone sees the same clusters; the first pick to break one gets the Crystal.
// State lives in state.geodes = [{hits, regrowTick}] (cluster order); worlds saved before it load without it.
import {STARTING_SITES} from './starting-world.js';

export const GEODE_RULES = Object.freeze({regrowTicks: 180 * 60, reach: 4.2, height: 3.2});
const site = STARTING_SITES.find(s => s.id === 'outcrop');
// [dx, dz, size, lift above ground]; size sets hits and yield. Matches the cluster art in client/starting-world.js.
export const GEODE_LAYOUT = Object.freeze([
  [0.2, 0.3, 2.4, 2.0], [2.6, -1.4, 1.8, 1.45], [-2.0, 1.4, 1.6, 1.5], [1.2, 3.0, 1.2, 0.8], [4.4, 1.0, 1.0, 0], [-3.1, -4.4, 0.9, 0],
]);
export const GEODES = Object.freeze(GEODE_LAYOUT.map(([dx, dz, size, lift], index) => Object.freeze({
  id: 'geode' + index, index, x: site.x + dx, z: site.z + dz, size, lift,
  maxHits: size >= 1.6 ? 4 : 3, yield: size >= 2 ? 4 : size >= 1.4 ? 3 : 2,
})));

export function geodeState(state) {
  if (!state.geodes) state.geodes = GEODES.map(() => ({hits: 0, regrowTick: 0}));
  return state.geodes;
}
export const geodeReady = (state, index) => !state.geodes || state.tick >= state.geodes[index].regrowTick;

/** Strike resolution for outcrop clusters: events, 'world_limit', or null when the target is not a cluster. */
export function strikeGeode(state, p, message, events, {terrainHeight, addPickup}) {
  const g = state.landmarks && GEODES.find(q => q.id === message.targetId);
  if (!g) return null;
  if (p.tool !== 'pick') return [];
  const ground = terrainHeight(state, g.x, g.z);
  if (Math.hypot(p.position[0] - g.x, p.position[2] - g.z) > GEODE_RULES.reach || Math.abs(p.position[1] - ground) > GEODE_RULES.height ||
      Math.hypot(message.point[0] - g.x, message.point[2] - g.z) > g.size * 0.9 + 0.6) return [];
  const all = geodeState(state), s = all[g.index];
  if (state.tick < s.regrowTick) return [];
  if (s.hits === g.maxHits - 1 && state.pickups.length >= 256) return 'world_limit';
  s.hits++;
  events.push({kind: 'geode_crack', id: g.id, index: g.index, hits: s.hits, maxHits: g.maxHits, position: [...message.point], normal: [...message.normal], material: 'stone'});
  if (s.hits >= g.maxHits) {
    s.hits = 0; s.regrowTick = state.tick + GEODE_RULES.regrowTicks;
    const dx = p.position[0] - g.x, dz = p.position[2] - g.z, d = Math.hypot(dx, dz) || 1, near = Math.min(d - 0.6, g.size * 0.8 + 0.9);
    addPickup('gems', g.x + dx / d * near, g.z + dz / d * near, g.yield);
    events.push({kind: 'geode_break', id: g.id, index: g.index, position: [g.x, ground + g.lift + g.size * 0.5, g.z], amount: g.yield, regrowTick: s.regrowTick});
  }
  return events;
}

/** Per-tick: announce a cluster that has just finished regrowing (presentation chime only). */
export function stepGeodes(state, events) {
  if (!state.geodes || !state.landmarks) return;
  for (const g of GEODES) if (state.geodes[g.index].regrowTick === state.tick)
    events.push({kind: 'geode_regrown', id: g.id, index: g.index, position: [g.x, 0, g.z]});
}

export function restoreGeodes(saved) {
  const list = saved.geodes;
  if (list === undefined) return undefined;
  if (!Array.isArray(list) || list.length !== GEODES.length || !list.every((s, i) => s && typeof s === 'object' &&
      Number.isSafeInteger(s.hits) && s.hits >= 0 && s.hits < GEODES[i].maxHits &&
      Number.isSafeInteger(s.regrowTick) && s.regrowTick >= 0 && s.regrowTick <= saved.tick + GEODE_RULES.regrowTicks)) throw Error('Invalid geodes');
  return list.map(({hits, regrowTick}) => ({hits, regrowTick}));
}
