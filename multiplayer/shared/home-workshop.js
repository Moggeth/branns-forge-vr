// The back town behind each keep (2026-10-08): through the pass, in the corner past the old map edge.
// - Workshop: a Hero who walks up to their own keep's anvil with ore has it smelted into bars, one every half
//   second, straight into their pack (the home-forge job the Central Forge used to be the only place for).
// - Stores: standing at their own keep's Stores counts as being at the Forge for banking (shared/inventions.js).
// - Cottages, the well and the lanterns are solid scenery (all of it stands while the keep battle runs, like the keeps).
// Pure simulation rules: fixed ticks, no clocks, rendering or random streams. No saved state: smelting is paced by
// the world tick, so old saves and new ones load the same.
import {ORE_RECIPES} from './material-catalog.js';
import {BACK_TOWN_LANTERNS, backTownPiece, backTownPoint} from './keep-sites.js';

// Model-frame spots (three.js x right, z toward the front) in metres; the town kit puts its anchors on them.
export const WORKSHOP = Object.freeze({
  anvil: Object.freeze([.4, 1.3]), hopper: Object.freeze([1.9, 1.4]), furnace: Object.freeze([-1.3, -1.2]), rack: Object.freeze([-2.15, 1.2]),
  reach: 3, every: 30, cap: 999,
});
export const STORES = Object.freeze({door: Object.freeze([0, 2.2]), reach: 3.5});
// Solid footprints in each piece's own frame: boxes {at, half} and circles {at, r}. The Workshop is an open-fronted
// smithy you walk into (walls, furnace, anvil, hopper and rack are solid); the others are closed buildings.
export const BACK_TOWN_SOLIDS = Object.freeze({
  workshop: Object.freeze([
    {at: [0, -2.3], half: [3, .25]}, {at: [-2.8, -.2], half: [.25, 2.3]}, {at: [2.8, -.2], half: [.25, 2.3]},
    {at: [-1.3, -1.2], r: 1.05}, {at: [.4, 1.3], r: .45}, {at: [1.9, 1.4], r: .5}, {at: [-2.15, 1.2], r: .4},
    {at: [-2.8, 2.3], r: .22}, {at: [2.8, 2.3], r: .22}, {at: [2.1, -1.3], half: [.31, .6]}]),
  stores: Object.freeze([{at: [0, .2], half: [2.6, 1.95]}]),
  cottage: Object.freeze([{at: [0, 0], half: [2.25, 2]}]),
  cottage2: Object.freeze([{at: [0, 0], half: [2.25, 2]}]),
  well: Object.freeze([{at: [0, 0], r: 1}]),
});
const SIDES = ['party', 'rivals'];
const local = ({x, z, yaw}, [px, pz]) => { const c = Math.cos(yaw), s = Math.sin(yaw); return [x + px * c + pz * s, z - px * s + pz * c]; };
const toLocal = ({x, z, yaw}, [wx, wz]) => { const c = Math.cos(yaw), s = Math.sin(yaw), dx = wx - x, dz = wz - z; return [dx * c - dz * s, dx * s + dz * c]; };
/** World [x, z] of a spot in a back-town piece's own frame. */
export const backTownSpot = (side, name, spot) => local(backTownPiece(side, name), spot);
const near = (p, [x, z], r) => Math.hypot(p.position[0] - x, p.position[2] - z) <= r;
/** True when a player stands at their own keep's Stores. */
export const atHomeStores = p => p?.role === 'hero' && near(p, backTownSpot(p.side || 'party', 'stores', STORES.door), STORES.reach);
const inBattle = state => state.battle?.v === 2 && state.battle.status === 'running';

/** Every `every` ticks, each Hero at their own Workshop's anvil turns one ore from their pack into one bar. */
export function stepWorkshops(state, ctx, events) {
  if (!inBattle(state) || state.tick % WORKSHOP.every) return;
  for (const p of state.players) {
    if (p.role !== 'hero' || p.hp <= 0 || !p.resources) continue;
    const side = p.side || 'party', anvil = backTownSpot(side, 'workshop', WORKSHOP.anvil);
    if (!near(p, anvil, WORKSHOP.reach)) continue;
    const ore = Object.keys(ORE_RECIPES).find(k => (p.resources[k] || 0) > 0 && (p.resources[ORE_RECIPES[k].output] || 0) < WORKSHOP.cap);
    if (!ore) continue;
    const metal = ORE_RECIPES[ore].output;
    p.resources[ore] -= 1; p.resources[metal] = (p.resources[metal] || 0) + 1;
    events.push({kind: 'workshop_smelt', id: p.id, side, ore, metal, left: Object.keys(ORE_RECIPES).reduce((n, k) => n + (p.resources[k] || 0), 0),
      position: [anvil[0], ctx.terrainHeight(state, anvil[0], anvil[1]) + 1, anvil[1]]});
  }
}

function pushOut(position, placed, solids, radius) {
  for (const sol of solids) {
    const [u, v] = toLocal(placed, [position[0], position[2]]), [cu, cv] = sol.at;
    let nu = u, nv = v;
    if (sol.r !== undefined) {
      const du = u - cu, dv = v - cv, d = Math.hypot(du, dv), min = sol.r + radius;
      if (d >= min) continue;
      if (d > 1e-4) { nu = cu + du / d * min; nv = cv + dv / d * min; } else nu = cu + min;
    } else {
      const hu = sol.half[0] + radius, hv = sol.half[1] + radius, du = u - cu, dv = v - cv;
      if (Math.abs(du) >= hu || Math.abs(dv) >= hv) continue;
      if (hu - Math.abs(du) < hv - Math.abs(dv)) nu = cu + Math.sign(du || 1) * hu; else nv = cv + Math.sign(dv || 1) * hv;
    }
    [position[0], position[2]] = local(placed, [nu, nv]);
  }
}
/** Push a body out of the back towns' buildings, well and lantern posts (drawn, like the keeps, while the battle runs). */
export function resolveBackTowns(state, position, radius = .3) {
  if (!inBattle(state)) return position;
  for (const side of SIDES) {
    const g = side === 'rivals' ? 1 : -1;
    if (position[0] * g < 46 || position[2] * g < 46) continue;
    for (const name of Object.keys(BACK_TOWN_SOLIDS)) pushOut(position, backTownPiece(side, name), BACK_TOWN_SOLIDS[name], radius);
    for (const at of BACK_TOWN_LANTERNS) {
      const [x, z] = backTownPoint(side, at), dx = position[0] - x, dz = position[2] - z, d = Math.hypot(dx, dz), min = .15 + radius;
      if (d < min && d > 1e-4) { position[0] = x + dx / d * min; position[2] = z + dz / d * min; }
    }
  }
  return position;
}
