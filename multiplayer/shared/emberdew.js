// Emberdew: thrown fire bottles. One table for authority (combat.js), the aim forecast and the HUD.
//   toss     hip throw (left click, not aiming): a short unlit lob that lays a fuel puddle, as before.
//   hurl     aimed throw (hold right click, then left click): the rag is lit and the bottle flies far.
//   cinder   the Ult, Cinder Cluster (Q / Special): a big lit jug lobbed high. At the top of its arc it pops its cork
//            and rains `bottles` little lit bottles in a ring; each smashes into a burning puddle like an aimed throw.
// Speeds are m/s along the aim, loft is extra upward m/s, gravity m/s^2 (stepCombat applies it for kind 'fuel').
export const EMBERDEW = Object.freeze({
  gravity: 15,
  toss: Object.freeze({speed: 6, loft: 2}),
  hurl: Object.freeze({speed: 13, loft: 2.5}),
  cinder: Object.freeze({up: 10, reach: 8, reachPerRad: 10, minReach: 3, maxReach: 14, bottles: 5, spread: 3.2, lift: 2.5, keep: .55, cooldown: 720}),
});

// Cinder Cluster's jug always goes up high (`up` m/s, so it pops about 3.3 m above the hand); the aim's pitch only sets
// how far it carries (`reach` m/s level, more when aimed up, less when aimed down). inherited: the thrower's velocity.
export function cinderLaunch(direction, inherited = [0, 0, 0], out = [0, 0, 0]) {
  const C = EMBERDEW.cinder, flat = Math.hypot(direction[0], direction[2]), pitch = Math.atan2(direction[1], flat);
  const reach = Math.min(C.maxReach, Math.max(C.minReach, C.reach + pitch * C.reachPerRad)), hx = flat > 1e-6 ? direction[0] / flat : 0, hz = flat > 1e-6 ? direction[2] / flat : -1;
  out[0] = hx * reach + (inherited[0] || 0); out[1] = C.up + (inherited[1] || 0); out[2] = hz * reach + (inherited[2] || 0);
  return out;
}

// The little bottles' launch velocities when the jug pops: an even ring around the jug's own drift, with a small
// upward kick. Deterministic (no randomness) so the host and the aim forecast agree exactly.
export function cinderVelocities(velocity, out = []) {
  const C = EMBERDEW.cinder, turn = Math.atan2(velocity[0], velocity[2]);
  out.length = C.bottles;
  for (let i = 0; i < C.bottles; i++) {
    const a = turn + i * 2 * Math.PI / C.bottles;
    out[i] = [velocity[0] * C.keep + Math.sin(a) * C.spread, Math.max(0, velocity[1]) + C.lift, velocity[2] * C.keep + Math.cos(a) * C.spread];
  }
  return out;
}
