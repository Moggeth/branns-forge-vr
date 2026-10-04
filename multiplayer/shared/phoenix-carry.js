// Phoenix skull carry-off (Emberwing, 2026-10-04). A curved (phoenix) Emberwing arrow that headshots a skeleton
// does not just stick: the phoenix grabs the skull and flaps off with it, enthusiastic and clearly overloaded:
// it surges, sags, nearly drops it twice, loops round and proudly drops it at the archer's feet (Mitch's pick),
// where it lands as an ordinary skull to pick up and throw.
//
// The flight is a pure function of the carry record and the tick, so the host steps it authoritatively and every
// client draws the same path every frame without waiting for snapshots. `carry` is presentation-sized state on a
// detached part and is never saved (restoreCombat keeps known fields only): a reloaded world simply has the skull
// fall from wherever it was, because the carried part always holds its current flight velocity.

export const PHOENIX_CARRY = Object.freeze({
  seconds: 6.5,        // whole trip: struggle away, loop round, bring it home
  out: 13,             // m the loop reaches along the shot's heading
  wide: 8,             // m the loop swings sideways as it turns for home
  climb: 3.6,          // m of height gained at the top of the loop
  lift: .45,           // m snatched upward at once
  home: .55,           // fraction of the trip after which it homes on the archer
  present: [0, 1.7, 0],// the skull is let go this far above the archer's feet (+ 0.9 m toward the bird)
  clearance: .7,       // m kept above the ground under the skull
  bounds: 54,          // m; the world edge (+/-55)
  maxActive: 4,        // simultaneous carries; extra headshots just stick like normal arrows
});
const TAU = Math.PI * 2;
const smooth = u => u * u * (3 - 2 * u);
const bump = (t, start, length) => { const x = (t - start) / length; return x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x) ** 2; };

/** New carry record for a skull at `position`, flying along the horizontal of `velocity` (fallback: away from `from`). */
export function startCarry({position, velocity, from, by, arrow, tick}) {
  let hx = velocity?.[0] || 0, hz = velocity?.[2] || 0;
  if (Math.hypot(hx, hz) < 1e-3 && from) { hx = position[0] - from[0]; hz = position[2] - from[2]; }
  const l = Math.hypot(hx, hz) || 1;
  let seed = 0; for (const c of String(arrow)) seed = (Math.imul(seed, 31) + c.charCodeAt(0)) | 0;
  return {by: String(by || ''), arrow: String(arrow || ''), at: tick, from: [...position], dir: [hx / l, hz / l], seed: (seed >>> 0) % 1000 / 1000};
}

/**
 * Pose of a carried skull. tick may be fractional (client frames). height(x, z) = ground height. home = the archer's
 * current feet position (null: back where it was grabbed). Like a cat with a mouse: the phoenix struggles off with
 * the skull, loops round, and proudly lets it go just in front of the archer.
 * Returns {position, quaternion (x,y,z,w), velocity (m/s), effort 0..1 (how hard it is flapping), t, done}.
 */
export function carryPose(carry, tick, height = () => -Infinity, home = null) {
  const C = PHOENIX_CARRY, t = Math.max(0, (tick - carry.at) / 60), phase = carry.seed * TAU, side = carry.seed < .5 ? -1 : 1;
  const [dx, dz] = carry.dir, base = home || carry.from;
  // Where the skull is let go: above the archer, nudged toward where the bird comes from.
  let ax = carry.from[0] - base[0], az = carry.from[2] - base[2]; const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
  const drop = [base[0] + ax * .9 + C.present[0], base[1] + C.present[1], base[2] + az * .9 + C.present[2]];
  const at = time => {
    const u = Math.min(1, time / C.seconds), settle = Math.min(1, time / .35);
    // The loop: out along the heading and back while swinging wide to one side.
    const f = C.out * Math.sin(Math.PI * u), w = side * C.wide * (1 - Math.cos(Math.PI * u)) / 2 + .5 * Math.sin(time * 1.6 + phase) * settle;
    let x = carry.from[0] + dx * f - dz * w, z = carry.from[2] + dz * f + dx * w;
    let y = carry.from[1] + C.lift * smooth(settle) + C.climb * Math.sin(Math.PI * Math.min(1, u * 1.4)) + .16 * Math.sin(time * TAU * 2.3 + phase) * settle;
    // Two near-drops: the skull plunges, the phoenix flails and hauls it back up.
    y -= 1.1 * bump(time, 1.55, .85) + .6 * bump(time, 3.3, .6);
    // Homing: the second half bends the loop onto the archer, wherever they have walked to.
    const k = smooth(Math.max(0, (u - C.home) / (1 - C.home)));
    x += (drop[0] - x) * k; z += (drop[2] - z) * k; y += (drop[1] + .12 * Math.sin(time * TAU * 2.3) * (1 - u) - y) * k;
    x = Math.max(-C.bounds, Math.min(C.bounds, x)); z = Math.max(-C.bounds, Math.min(C.bounds, z));
    return [x, Math.max(y, height(x, z) + C.clearance * (1 - k * .5)), z];
  };
  const position = at(t), ahead = at(t + 1 / 60), velocity = ahead.map((n, i) => (n - position[i]) * 60);
  // The skull dangles: pendulum swing across the heading and a nodding pitch, wilder during the near-drops.
  const panic = bump(t, 1.55, .85) + bump(t, 3.3, .6);
  const yaw = Math.atan2(velocity[0], velocity[2] || 1e-9) + .25 * Math.sin(t * 2.1 + phase);
  const roll = (.28 + .35 * panic) * Math.sin(t * 5.3 + phase), pitch = (.2 + .3 * panic) * Math.sin(t * 4.1 + 1.3 + phase);
  const quaternion = eulerYXZ(pitch, Math.hypot(velocity[0], velocity[2]) > .05 ? yaw : Math.atan2(dx, dz), roll);
  return {position, quaternion, velocity, effort: Math.min(1, .55 + .45 * panic + .2 * Math.max(0, -velocity[1]) / 3), t, done: t >= C.seconds};
}

// Quaternion of Euler angles applied yaw (Y), then pitch (X), then roll (Z): the same as THREE's 'YXZ' order.
function eulerYXZ(x, y, z) {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2), s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
}
