// Where the Underways live in world space, and how bodies stand and collide there. Pure and deterministic.
//
// Each running dungeon is a pocket instance in a reserved band far from any overworld (x and z from 9000), one 160 m
// slot per instance along x. The layout is regenerated from the run's seed (shared/underways/gen.js); only the run's
// progress is saved (shared/underways/rules.js). Ground height, walking and enemy steering branch on inUnderway()
// before any surface rule, so the surface map's bounds, cliffs and props never apply down here.
import {generateUnderway, floorHeight, floorTile, ceilingAt, tileAt, GRID, TILE} from './gen.js';

export const SPACE = Object.freeze({x0: 9000, z0: 9000, pitch: 160, slots: 8});
const X1 = SPACE.x0 + SPACE.pitch * SPACE.slots, Z1 = SPACE.z0 + SPACE.pitch;
/** Is this world point in the Underways band? (Cheap: called from ground height and every validator.) */
export const inUnderway = (x, z) => x >= SPACE.x0 && x < X1 && z >= SPACE.z0 && z < Z1;
export const slotOf = (x, z) => inUnderway(x, z) ? Math.floor((x - SPACE.x0) / SPACE.pitch) : -1;
/** World [x, z] of a slot's dungeon centre (the generator's local origin). */
export const slotOrigin = slot => [SPACE.x0 + slot * SPACE.pitch + SPACE.pitch / 2, SPACE.z0 + SPACE.pitch / 2];
/** Same space test for targeting: surface bodies (-1) never chase into a dungeon and the reverse. */
export const sameSpace = (a, b) => slotOf(a[0], a[2]) === slotOf(b[0], b[2]);

export const runInSlot = (state, slot) => state?.underways?.runs?.find(r => r.slot === slot) || null;
export const dungeonOf = run => generateUnderway(run.seed, {style: run.style, depth: run.depth});
/** The run and dungeon under a world point, plus the point in the dungeon's local frame. */
export function underwayAt(state, x, z) {
  const slot = slotOf(x, z); if (slot < 0) return null;
  const run = runInSlot(state, slot); if (!run) return null;
  const [ox, oz] = slotOrigin(slot);
  return {run, d: dungeonOf(run), lx: x - ox, lz: z - oz, ox, oz};
}
/** Walking height in the Underways (0 where no run is open: a stale body sits on a flat floor until it is cleared). */
export function underwayFloor(state, x, z) {
  const u = underwayAt(state, x, z);
  return u ? floorHeight(u.d, u.lx, u.lz) : 0;
}
export function underwayCeiling(state, x, z) {
  const u = underwayAt(state, x, z);
  return u ? floorHeight(u.d, u.lx, u.lz) + ceilingAt(u.d, u.lx, u.lz) : 4;
}

/** The gate blocks its corridor until it has been open for this long (the bars rise over GATE_RISE ticks). */
export const GATE_RISE = 75;
export const gateClosed = (run, tick) => !(run.gateTick >= 0 && tick - run.gateTick >= GATE_RISE * .7);

/** Push a body out of rock, pillars and a closed gate (mutates position; local tile maths in world space). */
export function resolveUnderway(state, position, radius = .3, tick = state?.tick ?? 0) {
  const u = underwayAt(state, position[0], position[2]);
  if (!u) return position;
  const {d, run, ox, oz} = u;
  let lx = position[0] - ox, lz = position[2] - oz;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    const [ti, tj] = tileAt(lx, lz);
    for (let j = tj - 1; j <= tj + 1; j++) for (let i = ti - 1; i <= ti + 1; i++) {
      if (floorTile(d, i, j)) continue;
      const x0 = (i - GRID / 2) * TILE, z0 = (j - GRID / 2) * TILE, x1 = x0 + TILE, z1 = z0 + TILE;
      [lx, lz, moved] = pushOutBox(lx, lz, radius, x0, z0, x1, z1, moved);
    }
    for (const c of d.colliders) {
      const dx = lx - c.x, dz = lz - c.z, dist = Math.hypot(dx, dz), min = c.r + radius;
      if (dist >= min || dist > 6) continue;
      if (dist > 1e-4) { lx = c.x + dx / dist * min; lz = c.z + dz / dist * min; } else lx = c.x + min;
      moved = true;
    }
    if (d.gate && gateClosed(run, tick)) {
      const g = d.gate;
      [lx, lz, moved] = pushOutBox(lx, lz, radius, g.x - g.half[0], g.z - g.half[1], g.x + g.half[0], g.z + g.half[1], moved);
    }
    if (!moved) break;
  }
  // Never leave the grid, whatever pushed us.
  const lim = GRID * TILE / 2 - radius;
  position[0] = ox + Math.max(-lim, Math.min(lim, lx)); position[2] = oz + Math.max(-lim, Math.min(lim, lz));
  return position;
}
function pushOutBox(x, z, r, x0, z0, x1, z1, moved) {
  const cx = Math.max(x0, Math.min(x1, x)), cz = Math.max(z0, Math.min(z1, z)), dx = x - cx, dz = z - cz, dist = Math.hypot(dx, dz);
  if (dist >= r) return [x, z, moved];
  if (dist > 1e-5) return [cx + dx / dist * r, cz + dz / dist * r, true];
  // Centre inside the box: leave by the nearest face.
  const l = x - x0, rt = x1 - x, t = z - z0, b = z1 - z, m = Math.min(l, rt, t, b);
  if (m === l) return [x0 - r, z, true]; if (m === rt) return [x1 + r, z, true]; if (m === t) return [x, z0 - r, true]; return [x, z1 + r, true];
}
/** One fixed-step walk in the Underways: move each axis, then resolve (slides along walls). */
export function moveUnderway(state, position, dx, dz, radius = .28) {
  position[0] += dx; position[2] += dz;
  return resolveUnderway(state, position, radius);
}
/** Is a local tile open for walking right now (rock and a closed gate are not)? */
export function openAt(state, x, z, radius = .3) {
  const q = [x, 0, z], before = [...q];
  resolveUnderway(state, q, radius);
  return Math.hypot(q[0] - before[0], q[2] - before[2]) < .02;
}
