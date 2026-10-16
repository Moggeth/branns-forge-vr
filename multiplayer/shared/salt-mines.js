// The Brinedeep salt mines: one in each of the two open mountain corners between the keeps, the same distance from
// both, so the two sides race for the same riches. A cutting climbs into the mountain foot to a timbered portal, a
// tunnel slopes down and bends into a pink rock-salt hall with brine pools at its back.
//
// Pure data and maths, shared by the terrain (shared/keep-sites.js carves the mine out of the mountains and lets
// walkers in, shared/terrain.js lays its floor), the mine rules (shared/salt-mine-rules.js) and the client view
// (client/salt-mine-view.js). No clocks, randomness or DOM.
//
// Coordinates: [u, v] are distances from the map centre toward a mine's corner. The east mine's corner is (+x, -z),
// the west mine's (-x, +z): east (x, z) = (u, -v), west (x, z) = (-u, v). The two mines are the same shape, turned
// half a circle about the centre, like the keeps.
export const MINE_SIDES = Object.freeze(['east', 'west']);
const P = (u, v) => Object.freeze([u, v]);
export const MINE = Object.freeze({
  // The path walked from the meadow to the hall: [u, v, half width, floor height]. Point 1 is the portal.
  path: Object.freeze([P(44.2, 44.2), P(50.6, 50.6), P(54.4, 51.0), P(56.0, 54.6)].map((p, i) => Object.freeze([...p, [2.3, 1.85, 1.75, 2][i], [0, -.25, -1.35, -2.55][i]]))),
  portal: 1,
  // The hall: two overlapping rounded chambers [u, v, radius along the corner diagonal, radius across, floor].
  halls: Object.freeze([Object.freeze([58.7, 57.9, 5.3, 4.5, -3.05]), Object.freeze([61.1, 53.6, 3.0, 2.4, -3.2])]),
  blend: 1.6,            // past the drawn wall the carve falls from 1 to 0 over this distance (the rock behind it)
  wall: .15,             // the drawn wall stands this far outside the field's zero line
  shelf: .95,            // the carved floor runs on this far behind the drawn wall before the rock rises
  walk: .34,             // walkers keep this far inside the drawn wall (a body's radius and a hand's breadth)
  round: 1.1,            // smooth-union radius where the tunnel opens into the hall
  ceiling: Object.freeze({tunnel: 3.45, hall: 6.8, wall: 2.15}), // arch crown over the floor; walls rise straight to `wall`
  // Brine pools at the back of the hall, where the Saltback crabs live: [u, v, radius, depth below the hall floor].
  pools: Object.freeze([Object.freeze([61.2, 53.4, 1.25, .34]), Object.freeze([59.9, 60.6, .95, .3])]),
});
const smooth = t => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const mineSideAt = (x, z) => x - z >= 0 ? 'east' : 'west';
/** World [x, z] of a corner-space point for one mine. */
export const minePoint = (side, [u, v]) => side === 'east' ? [u, -v] : [-u, v];
/** Corner-space [u, v] of a world point, toward whichever mine's corner it lies. */
export const mineLocal = (x, z) => x - z >= 0 ? [x, -z] : [-x, z];
/** World direction for a corner-space direction (the same rotation as minePoint, without the offset). */
export const mineDirection = (side, [du, dv]) => side === 'east' ? [du, -dv] : [-du, dv];

// Gentle wobble on the walls so the cave reads hewn, not stencilled (a few sines: smooth and the same everywhere).
const wobble = (u, v) => .16 * Math.sin(u * 1.7 + v * .6) + .11 * Math.sin(v * 2.3 - u * 1.1 + 1.3) + .07 * Math.sin((u + v) * 3.7);
const smin = (a, b, k) => { const h = clamp(.5 + .5 * (b - a) / k, 0, 1); return b + (a - b) * h - k * h * (1 - h); };

// Scratch for the nearest point on the path: segment index, fraction, distance and interpolated half width/floor.
const NEAR = {i: 0, t: 0, d: 0, half: 0, floor: 0, along: 0};
const SEG = MINE.path.slice(0, -1).map((a, i) => { const b = MINE.path[i + 1], du = b[0] - a[0], dv = b[1] - a[1], len = Math.hypot(du, dv); return {a, b, du, dv, len}; });
const ALONG = SEG.reduce((acc, s, i) => { acc.push(acc[i] + s.len); return acc; }, [0]);
function nearestOnPath(u, v) {
  let best = Infinity;
  for (let i = 0; i < SEG.length; i++) {
    const s = SEG[i], t = clamp(((u - s.a[0]) * s.du + (v - s.a[1]) * s.dv) / (s.len * s.len), 0, 1);
    const pu = s.a[0] + s.du * t, pv = s.a[1] + s.dv * t, half = s.a[2] + (s.b[2] - s.a[2]) * t;
    const d = Math.hypot(u - pu, v - pv) - half;
    if (d < best) { best = d; NEAR.i = i; NEAR.t = t; NEAR.d = d; NEAR.half = half; NEAR.floor = s.a[3] + (s.b[3] - s.a[3]) * smooth(t); NEAR.along = ALONG[i] + s.len * t; }
  }
  return NEAR;
}
const DIAG = Math.SQRT1_2;
function hallDistance(u, v, h) {
  // An ellipse with one axis along the corner diagonal: approximate distance (exact enough for a 1.6 m blend).
  const du = u - h[0], dv = v - h[1], a = (du + dv) * DIAG, b = (dv - du) * DIAG;
  const k = Math.hypot(a / h[2], b / h[3]);
  return (k - 1) * Math.min(h[2], h[3]) * (k < 1 ? 1 : .5 + .5 / Math.max(k, 1e-6) * 1);
}
/** Signed distance from the mine's wall line (negative inside), in corner space, into FIELD: d, how much of the
 * point belongs to the hall (0 in the tunnel, 1 in the hall; floor and ceiling blend by it), the floor level and
 * the distance along the path. One shared scratch object: read it before the next call. */
export const FIELD = {d: 0, hall: 0, floor: 0, along: 0, tunnel: 0};
export function mineField(u, v) {
  const n = nearestOnPath(u, v), tunnel = n.d;
  let hall = Infinity, hallFloor = MINE.halls[0][4];
  for (const h of MINE.halls) { const d = hallDistance(u, v, h); if (d < hall) { hall = d; hallFloor = h[4]; } }
  const d = smin(tunnel, hall, MINE.round) + wobble(u, v) * smooth((n.along - 3) / 4);
  const w = smooth(.5 + (tunnel - hall) / (2 * MINE.round + 1.2));
  FIELD.d = d; FIELD.hall = w; FIELD.tunnel = tunnel; FIELD.along = n.along;
  FIELD.floor = n.floor + (hallFloor - n.floor) * w;
  return FIELD;
}
// Bounds of the mine in corner space (the carve never reaches past these).
const BOX = {u0: 42, u1: 65.5, v0: 42, v1: 63.5};
const outside = (u, v) => u < BOX.u0 || u > BOX.u1 || v < BOX.v0 || v > BOX.v1 || Math.abs(u - v) > 13;
/** 1 where a mine has cut the mountain away (for keepCarve), 0 where the rock stands. */
export function mineCarve(x, z) {
  const [u, v] = mineLocal(x, z);
  if (outside(u, v)) return 0;
  const f = mineField(u, v);
  // The floor runs on a little past the drawn wall (the terrain lattice is .75 m) so no slope pokes into the cave.
  return 1 - smooth((f.d - MINE.wall - MINE.shelf) / MINE.blend);
}
/** True where walkers may stand in a mine: inside its walls (before or after the portal). */
export function mineWalkable(x, z) {
  return mineInside(x, z) >= MINE.walk;
}
/** Brine pool basin below the hall floor at a world point (0 elsewhere). */
export function mineBasin(x, z) {
  const [u, v] = mineLocal(x, z);
  let deep = 0;
  for (const p of MINE.pools) {
    const r = Math.hypot(u - p[0], v - p[1]) / p[2];
    if (r < 1) deep = Math.max(deep, p[3] * Math.pow(1 - r * r, .8));
  }
  return deep;
}
/** The mine floor's height at a world point (before the lattice): the path's slope, the hall's level and the pools. */
export function mineFloor(x, z) {
  const [u, v] = mineLocal(x, z), f = mineField(u, v);
  // a little roll in the hall floor so it reads as worked rock, fading out toward the walls
  const roll = .12 * Math.sin(u * .9 + 1) * Math.cos(v * .7) * f.hall;
  return f.floor + roll - mineBasin(x, z);
}
/** Inside distance (m) from the drawn wall, or negative outside. */
export function mineInside(x, z) {
  const [u, v] = mineLocal(x, z);
  if (outside(u, v)) return -9;
  return MINE.wall - mineField(u, v).d;
}
/** Height of the cave's roof above the mine floor at a world point: straight walls to `wall`, then an arch to the
 * crown (low in the tunnel, a high dome over the hall). 0 outside the walls or before the portal. */
export function mineCeiling(x, z) {
  const [u, v] = mineLocal(x, z);
  if (outside(u, v)) return 0;
  const f = mineField(u, v), inside = MINE.wall - f.d;
  if (inside <= 0 || f.along < portalAlong()) return 0;
  return archHeight(f, inside);
}
function archHeight(f, inside) {
  const C = MINE.ceiling, crown = C.tunnel + (C.hall - C.tunnel) * f.hall, reach = 1.75 + 2.4 * f.hall;
  const k = clamp(inside / reach, 0, 1);
  return C.wall + (crown - C.wall) * Math.sqrt(1 - (1 - k) * (1 - k));
}
/** The roof's height over the floor in corner space, on or inside the walls (`wall` at the wall line), for the
 * presentation's cave shell; also the inside distance from the wall and the distance along the path. */
export const ARCH = {height: 0, inside: 0, along: 0, hall: 0};
export function mineArch(u, v) {
  const f = mineField(u, v), inside = Math.max(0, MINE.wall - f.d);
  ARCH.height = archHeight(f, inside); ARCH.inside = MINE.wall - f.d; ARCH.along = f.along; ARCH.hall = f.hall;
  return ARCH;
}
/** Distance along the path from the meadow end to the portal, and to the hall. */
export const portalAlong = () => ALONG[MINE.portal];
export const pathLength = () => ALONG[ALONG.length - 1];
/** How deep into a mine a world point is: 0 out on the meadow and in the cutting, rising through the tunnel to 1
 * once round the bend in the hall. The client dims daylight and the sky by this (shared so tests can check it). */
export function mineDepth(x, z) {
  const [u, v] = mineLocal(x, z);
  if (outside(u, v)) return 0;
  const f = mineField(u, v);
  if (f.d > MINE.wall + .6) return 0;
  return smooth((f.along - portalAlong() + .4) / 6.2) * (1 - smooth((f.d - MINE.wall) / .6));
}
/** World {x, z, yaw} of the portal for one mine, facing out of the mountain along the path (three.js yaw: +Z faces
 * the meadow). Width is the opening the frame must span. */
export function minePortal(side) {
  const a = MINE.path[MINE.portal], b = MINE.path[MINE.portal - 1], [x, z] = minePoint(side, a), [dx, dz] = mineDirection(side, [b[0] - a[0], b[1] - a[1]]);
  return {x, z, yaw: Math.atan2(dx, dz), half: a[2]};
}
