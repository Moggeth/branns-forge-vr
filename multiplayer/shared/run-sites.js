// Expedition Roguelite destination sites for today's arena. A generated world supplies its own sites (stable ids,
// reachable on foot, with a kind and danger) through createSimulation({run: {..., sites}}); this module is the
// fallback so runs play on the current map until then. Pure and deterministic: open ground is found by asking the
// same collision resolvers the simulation uses whether a 2.5 m circle fits, so new map pieces are respected.
import {baseHeight} from './terrain.js';
import {HOME_SITES} from './keep-sites.js';
import {homePoint} from './home-bases.js';
import {STARTING_SITES, resolveStartingWorld} from './starting-world.js';
import {resolveMapExtras} from './map-extras.js';
import {resolveCoveLakes} from './larimar-cove.js';
import {resolveHomeStructures} from './home-bases.js';
import {resolveBackTowns} from './home-workshop.js';

export const ARENA_RUN = Object.freeze({limit: 47, step: 3.5, keepClear: 25, forgeClear: 13, landmarkClear: 3, slope: 1.6});
let cached = null;

function open(x, z) {
  const L = ARENA_RUN;
  if (Math.abs(x) > L.limit || Math.abs(z) > L.limit) return false;
  if (Object.values(HOME_SITES).some(([hx, hz]) => Math.hypot(x - hx, z - hz) < L.keepClear)) return false;
  if (Math.hypot(x, z) < L.forgeClear) return false;
  if (STARTING_SITES.some(s => Math.hypot(x - s.x, z - s.z) < s.radius + L.landmarkClear)) return false;
  const y = baseHeight(x, z);
  for (const [dx, dz] of [[2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]]) if (Math.abs(baseHeight(x + dx, z + dz) - y) > L.slope) return false;
  const p = [x, y, z], fake = {battle: {v: 2, status: 'running', bases: []}, inventions: {structures: []}};
  const moved = q => Math.hypot(q[0] - x, q[2] - z) > .01;
  if (moved(resolveStartingWorld([x, y, z], baseHeight, 2.5))) return false;
  if (moved(resolveMapExtras([...p], 2.5))) return false;
  if (moved(resolveCoveLakes([...p], 2.5))) return false;
  try { if (moved(resolveHomeStructures(fake, [...p], 2.5)) || moved(resolveBackTowns(fake, [...p], 2.5))) return false; } catch { /* resolvers that need a live world skip */ }
  return true;
}

/** Open, reachable points of today's map, in a fixed order (cached; the map is static between deploys). */
export function arenaOpenGround() {
  if (cached) return cached;
  const out = [], L = ARENA_RUN;
  for (let x = -L.limit; x <= L.limit; x += L.step) for (let z = -L.limit; z <= L.limit; z += L.step) if (open(x, z)) out.push([Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
  return (cached = Object.freeze(out.map(p => Object.freeze(p))));
}

/** Where a run on today's map sets out from: just outside Dawnhold's gate, where Heroes spawn. */
export const arenaCamp = () => homePoint('party', [0, 7]);
