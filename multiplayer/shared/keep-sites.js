import {movedList, movedTable} from './map-layout.js';
// Where the two keeps stand, and the ground carved for them out of the corner mountains: a round bowl for the
// half-ring keep, a narrow pass straight back toward the corner, and a walled back town filling the corner itself,
// out past the old map edge. Shared by the terrain (shared/terrain.js), movement and the keep rules
// (shared/home-bases.js). Pure data and maths. Larimar Cove (shared/larimar-cove.js) opens off each back town's yard.
import {coveCarve} from './larimar-cove.js';
import {activeWorld, inUnderwayBand} from './world-extent.js';
export const HOME_SITES = Object.freeze({party: Object.freeze([-34, -34]), rivals: Object.freeze([34, 34])});
export const KEEP_CARVE = Object.freeze({
  bowl: 20, bowlBlend: 3,          // flat to 20 m from the heart, cliffs rise over the next 3 m
  pass: Object.freeze({to: 29.5, half: 2.25, blend: 1.5}), // 4.5 m wide, straight back from the heart into the town
  // The back town: a square courtyard in the very corner, axis-aligned with the map edges. `from`/`to` are distances
  // from the map centre along each axis (so party's town spans x, z in [-68, -53]); corners rounded by `round`.
  town: Object.freeze({from: 53, to: 68, round: 2.5, blend: 2}),
});
// The furthest anything can be from the centre on either axis. Only the carved keep corners reach past the old
// ±55 edge (the open meadow still stops at ±50 for walkers and ±55 for things).
export const WORLD_EXTENT = 70; // arena only; generated worlds use extentLimit() (shared/world-extent.js)
const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/** 1 where a keep has cut the mountains away, 0 where they stand, smooth between. */
export function keepCarve(x, z) {
  let carve = 0;
  for (const [sx, sz] of Object.values(HOME_SITES)) {
    const g = Math.sign(sx), u = x * g, v = z * g; // distances toward this keep's corner
    if (u < 10 || v < 10) continue;
    const dx = x - sx, dz = z - sz, d = Math.hypot(dx, dz);
    const back = (dx + dz) * g / Math.SQRT2, side = Math.abs(dx - dz) / Math.SQRT2;
    const {pass: P, town: T} = KEEP_CARVE;
    const bowl = 1 - smooth((d - KEEP_CARVE.bowl) / KEEP_CARVE.bowlBlend);
    const pass = (1 - smooth((side - P.half) / P.blend)) * (back > 0 && back < P.to + P.blend ? 1 - smooth((back - P.to) / P.blend) : 0);
    // Rounded box: signed distance from the courtyard's edge (negative inside).
    const c = (T.from + T.to) / 2, h = (T.to - T.from) / 2 - T.round;
    const qx = Math.abs(u - c) - h, qz = Math.abs(v - c) - h;
    const edge = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - T.round;
    const town = 1 - smooth(edge / T.blend);
    carve = Math.max(carve, bowl, pass, town);
  }
  return Math.max(carve, coveCarve(x, z));
}
// The keeps' fronts and the lane between them stay clear of new rocks (ore veins, renewed seams): nothing rises within
// `bowl + front` of a keep's heart (the gate ballistas stand at ~20.4 m) or within `lane` of the main road from
// one keep to the other, where the troops walk.
// The main road from one keep's gate to the other's: straight down the diagonal, then a 45° jog round the Forge's
// south-east side and back, so there is no straight sightline from corner to corner. Symmetric across x = -z, so both
// keeps march the same distance. Party gate first. Drives the worn ground, the lanterns and the rock-free lane.
export const MAIN_ROAD = Object.freeze({
  half: 1.6, // worn width either side of the centreline; nothing solid stands on it
  points: Object.freeze([[-20, -20], [-12, -12], [0, -12], [12, 0], [12, 12], [20, 20]].map(p => Object.freeze(p))),
});
/** Distance from (x, z) to the main road's centreline. */
export function mainRoadDistance(x, z) {
  let best = Infinity;
  const P = MAIN_ROAD.points;
  for (let i = 1; i < P.length; i++) {
    const [ax, az] = P[i - 1], [bx, bz] = P[i], dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}
export const KEEP_APPROACH = Object.freeze({front: 6.5, lane: 4, yard: 13}); // the Forge yard keeps its own ore
/** True where a rock must not rise: a keep's bowl and gate front, or the lane between the keeps. */
export function inKeepApproach(x, z) {
  for (const [sx, sz] of Object.values(HOME_SITES)) if (Math.hypot(x - sx, z - sz) < KEEP_CARVE.bowl + KEEP_APPROACH.front) return true;
  return Math.hypot(x, z) > KEEP_APPROACH.yard && mainRoadDistance(x, z) < KEEP_APPROACH.lane;
}
/** True on a keep's carved floor (bowl, pass or town), where walkers may go past the open meadow's edge. */
export function onKeepGround(x, z) {
  return Math.abs(x) <= WORLD_EXTENT && Math.abs(z) <= WORLD_EXTENT && keepCarve(x, z) > .5;
}
/** Clamp a ground point to the world: inside ±limit on the open map, or anywhere on a keep's carved floor. */
export function clampToWorld(x, z, limit = 55) {
  const w = activeWorld();
  if (w) { if (inUnderwayBand(x, z)) return [x, z]; const b = w.bounds; return [clamp(x, b.minX, b.maxX), clamp(z, b.minZ, b.maxZ)]; }
  if ((Math.abs(x) <= limit && Math.abs(z) <= limit) || onKeepGround(x, z)) return [x, z];
  return [clamp(x, -limit, limit), clamp(z, -limit, limit)];
}
/** True once a point has left the world: past ±limit and not over a keep's carved floor. */
export function beyondWorld(x, z, limit = 55) {
  const w = activeWorld();
  if (w) { const [cx, cz] = clampToWorld(x, z); return cx !== x || cz !== z; }
  return (Math.abs(x) > limit || Math.abs(z) > limit) && !onKeepGround(x, z);
}

// The back town's buildings, in corner coordinates: [u, v] are distances from the map centre toward the keep's
// corner along x and z (party's corner is -x, -z). `face` is the point each front (+Z of its model) turns toward.
// The Workshop fills the far corner facing the pass; the Stores and a cottage back onto the two outer cliffs, a
// second cottage onto the inner cliff, the well stands in the yard, and lanterns light the pass.
const C = (u, v) => Object.freeze([u, v]);
const at = (where, face) => Object.freeze({at: where, face});
export const BACK_TOWN = movedTable('town', {
  workshop: at(C(63.2, 63.2), C(50, 50)),
  stores: at(C(65.5, 56.5), C(53, 56.5)),
  cottage: at(C(56.5, 65.5), C(56.5, 53)),
  cottage2: at(C(55.3, 58.6), C(68, 58.6)),
  well: at(C(60.6, 57.6), C(53, 53)),
});
// Lanterns up the pass and round the yard, [u, v] like the buildings.
export const BACK_TOWN_LANTERNS = movedList('town.lanterns', [C(51.7, 48.9), C(51.7, 54.5), C(53.8, 61.5), C(61.5, 53.8)]);
/** World {x, z, yaw} of a back-town piece for one side ('party' or 'rivals'). */
export function backTownPiece(side, name) {
  const g = side === 'rivals' ? 1 : -1, {at: [u, v], face: [fu, fv]} = BACK_TOWN[name];
  const x = g * u, z = g * v;
  return {x, z, yaw: Math.atan2(g * fu - x, g * fv - z)};
}
/** World [x, z] of a corner-coordinate point for one side. */
export const backTownPoint = (side, [u, v]) => side === 'rivals' ? [u, v] : [-u, -v];
