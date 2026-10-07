// Where the two keeps stand, and the ground carved for them out of the corner mountains: a round bowl for the
// half-ring keep, a narrow pass straight back toward the corner, and a hollow at its end. Shared by the terrain
// (shared/terrain.js) and the keep rules (shared/home-bases.js). Pure data and maths.
export const HOME_SITES = Object.freeze({party: Object.freeze([-34, -34]), rivals: Object.freeze([34, 34])});
export const KEEP_CARVE = Object.freeze({
  bowl: 20, bowlBlend: 3,          // flat to 20 m from the heart, cliffs rise over the next 3 m
  pass: Object.freeze({to: 23, half: 2, blend: 1.5}), // 4 m wide, straight back from the heart
  hollow: Object.freeze({at: 25.5, r: 4, blend: 2}),             // metres behind the heart along the pass
});
const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
/** 1 where a keep has cut the mountains away, 0 where they stand, smooth between. */
export function keepCarve(x, z) {
  let carve = 0;
  for (const [sx, sz] of Object.values(HOME_SITES)) {
    const dx = x - sx, dz = z - sz, d = Math.hypot(dx, dz);
    if (d > KEEP_CARVE.hollow.at + KEEP_CARVE.hollow.r + KEEP_CARVE.hollow.blend + 1) continue;
    const l = Math.hypot(sx, sz), fx = -sx / l, fz = -sz / l; // forward: toward the world centre
    const back = -(dx * fx + dz * fz), side = Math.abs(dx * -fz + dz * fx);
    const {pass: P, hollow: H} = KEEP_CARVE;
    const bowl = 1 - smooth((d - KEEP_CARVE.bowl) / KEEP_CARVE.bowlBlend);
    const pass = (1 - smooth((side - P.half) / P.blend)) * (back > 0 && back < P.to + P.blend ? 1 - smooth((back - P.to) / P.blend) : 0);
    const hollow = 1 - smooth((Math.hypot(back - H.at, side) - H.r) / H.blend);
    carve = Math.max(carve, bowl, pass, hollow);
  }
  return carve;
}
