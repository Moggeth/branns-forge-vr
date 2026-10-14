// Larimar Cove: a hidden lake cut into the cliffs beside each keep's back town, home to Shellbright, the larimar
// turtle (client/larimar-cove-view.js). The cove opens off the back town's yard, away from the pass, so you find it by
// wandering through the town. Pure data and maths, shared by the terrain (shared/keep-sites.js carves the cove,
// shared/terrain.js digs the lake bed), movement (heroes and walkers wade in the shallows but never into deep water)
// and the client view.
//
// Coordinates follow shared/keep-sites.js: [u, v] are distances from the map centre toward a keep's corner along x
// and z, so the rivals' corner is (+u, +v) and the party's (-u, -v). Both coves are the same shape, mirrored.
export const COVE = Object.freeze({
  // The cove floor: a rounded box carved out of the mountains, overlapping the back town's yard edge (v >= 53).
  box: Object.freeze({u0: 57, u1: 68.5, v0: 43, v1: 54.5, round: 3.5, blend: 2}),
  // The lake: an ellipse (radii along u and v) with a gently wobbling shore. `depth` is the bowl's depth below the cove
  // floor at the centre; the water stands `drop` below the floor, so the shore is a low lip, not a wall.
  lake: Object.freeze({u: 63.1, v: 48.4, ru: 4.5, rv: 3.9, depth: 1.9, drop: .42}),
  // How deep walkers may wade before the water turns them back (metres of water at the feet).
  wade: .32,
  // The basking rock: a flat-topped stone shelf at the south shore, half in the water. Its top stands `top` above the
  // water so the turtle hauls out onto it. `face` is the yaw (radians, game convention atan2(dx, dz) in corner space)
  // the turtle settles to, looking back across the lake toward the town.
  rock: Object.freeze({u: 61.5, v: 45.1, r: 1.3, top: .26, face: Math.atan2(.25, 1)}),
});
const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
/** Corner sign for a side, and the side whose corner (x, z) lies toward. */
export const coveSign = side => side === 'rivals' ? 1 : -1;
export const coveSideAt = (x, z) => x + z < 0 ? 'party' : 'rivals';
/** World [x, z] of a corner-space point for one side. */
export const covePoint = (side, [u, v]) => { const g = coveSign(side); return [g * u, g * v]; };
/** World yaw for a corner-space yaw (the party's corner is the rivals' turned half a circle). */
export const coveYaw = (side, yaw) => side === 'rivals' ? yaw : yaw + Math.PI;

/** 1 where the cove has cut the mountains away (for keepCarve), 0 where they stand. */
export function coveCarve(x, z) {
  const g = x + z < 0 ? -1 : 1, u = x * g, v = z * g, B = COVE.box;
  if (u < B.u0 - B.blend - 1 || v < B.v0 - B.blend - 1) return 0;
  const cu = (B.u0 + B.u1) / 2, cv = (B.v0 + B.v1) / 2, hu = (B.u1 - B.u0) / 2 - B.round, hv = (B.v1 - B.v0) / 2 - B.round;
  const qx = Math.abs(u - cu) - hu, qz = Math.abs(v - cv) - hv;
  const edge = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - B.round;
  return 1 - smooth(edge / B.blend);
}

// The shore wobbles a little so the lake reads as a pond, not a stencilled oval (same function everywhere).
export const shoreScale = a => 1 + .07 * Math.sin(3 * a + 1.1) + .045 * Math.sin(5 * a + 2.3) + .03 * Math.sin(2 * a - .4);
/** Normalised distance from the lake's centre: 0 at the centre, 1 on the bowl's rim. Uses corner space. */
export function lakeRadius(u, v) {
  const L = COVE.lake, du = (u - L.u) / L.ru, dv = (v - L.v) / L.rv;
  return Math.hypot(du, dv) / shoreScale(Math.atan2(dv, du));
}
/** Depth of the lake bowl below the cove floor at a world point (0 outside the lake). */
export function lakeBasin(x, z) {
  const g = x + z < 0 ? -1 : 1, u = x * g, v = z * g, L = COVE.lake;
  if (Math.abs(u - L.u) > L.ru * 1.3 || Math.abs(v - L.v) > L.rv * 1.3) return 0;
  const r = lakeRadius(u, v);
  if (r >= 1) return 0;
  const bowl = L.depth * Math.pow(1 - r * r, .75);
  // The basking rock's shelf: the bed rises under it so its foot sits in shallow water.
  const R = COVE.rock, dr = Math.hypot(u - R.u, v - R.v) / (R.r * 1.9);
  return bowl * (1 - .7 * (1 - smooth(dr)));
}
/** World x, z of the lake centre, and the water surface height given the keep heart's floor height. */
export const lakeCentre = side => covePoint(side, [COVE.lake.u, COVE.lake.v]);
export const waterLevel = floor => floor - COVE.lake.drop;
/** Water depth over the bed at a world point (0 on dry ground). `floor` is the cove floor height. */
export function waterDepth(x, z) {
  return Math.max(0, lakeBasin(x, z) - COVE.lake.drop);
}

/** Keep walkers out of water deeper than COVE.wade: push them back to the wading line along the lake's radius. */
export function resolveCoveLakes(position, radius = .3) {
  // the rock and the wading line can each push into the other near the rock's foot: settle in a few passes
  for (let pass = 0; pass < 3; pass++) if (!resolveOnce(position, radius)) break;
  return position;
}
function resolveOnce(position, radius) {
  const x = position[0], z = position[2];
  if (Math.abs(x) < 50 || Math.abs(z) < 38) return false;
  const g = x + z < 0 ? -1 : 1, u = x * g, v = z * g, L = COVE.lake;
  if (Math.abs(u - L.u) > L.ru * 1.4 || Math.abs(v - L.v) > L.rv * 1.4) return false;
  // Find the wading line along this ray: where the bowl is drop + wade deep, then stand `radius` outside it.
  // The basking rock is solid: step round it.
  const R = COVE.rock, ru = u - R.u, rv = v - R.v, rd = Math.hypot(ru, rv), rmin = R.r + radius;
  const limit = L.drop + COVE.wade;
  if (rd < rmin - 1e-6) {
    // out to the rock's edge, the nearest way that is not into deep water (the rock's lake side stands in the lake)
    const a0 = rd > 1e-4 ? Math.atan2(rv, ru) : 0;
    for (let k = 0; k <= 32; k++) {
      const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 16, pu = R.u + Math.cos(a) * (rmin + 1e-4), pv = R.v + Math.sin(a) * (rmin + 1e-4);
      if (lakeBasin(g * pu, g * pv) <= limit || k === 32) { position[0] = g * pu; position[2] = g * pv; break; }
    }
    return false;
  }
  const deep = lakeBasin(x, z);
  if (deep <= limit) return false;
  let du = u - L.u, dv = v - L.v, len = Math.hypot(du, dv);
  if (len < 1e-3) { du = 0; dv = 1e-3; len = 1e-3; } // dead centre: out toward the town
  let lo = len, hi = len;
  // march outward to dry-enough ground (the bowl rises monotonically along a ray from the centre)
  for (let i = 0; i < 40 && lakeBasin(g * (L.u + du / len * hi), g * (L.v + dv / len * hi)) > limit; i++) hi += .15;
  for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (lakeBasin(g * (L.u + du / len * mid), g * (L.v + dv / len * mid)) > limit) lo = mid; else hi = mid; }
  const out = hi + radius * .5;
  position[0] = g * (L.u + du / len * out); position[2] = g * (L.v + dv / len * out);
  return true;
}
/** The basking rock as a solid circle for the presentation and tests: world {x, z, r, side}. */
export const baskingRock = side => { const [x, z] = covePoint(side, [COVE.rock.u, COVE.rock.v]); return {x, z, r: COVE.rock.r, side}; };
