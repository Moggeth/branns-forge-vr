// Phoenix skull carry-off (Emberwing, 2026-10-04). A curved (phoenix) Emberwing arrow that headshots a skeleton
// does not just stick: the phoenix grabs the skull and flaps off with it, enthusiastic and clearly overloaded:
// it surges, sags, nearly drops it twice, then fumbles it far away, where it lands as an ordinary skull.
//
// The flight is a pure function of the carry record and the tick, so the host steps it authoritatively and every
// client draws the same path every frame without waiting for snapshots. `carry` is presentation-sized state on a
// detached part and is never saved (restoreCombat keeps known fields only): a reloaded world simply has the skull
// fall from wherever it was, because the carried part always holds its current flight velocity.

export const PHOENIX_CARRY = Object.freeze({
  seconds: 5.4,        // flight before the fumble
  distance: 38,        // m along the shot's heading
  climb: 5,            // m gained by the end (on top of the first lift)
  lift: .45,           // m snatched upward at once
  clearance: .7,       // m kept above the ground under the skull
  bounds: 53,          // m; the world edge (+/-55) ends a flight early
  maxActive: 4,        // simultaneous carries; extra headshots just stick like normal arrows
  dropSpeed: 3.5,      // m/s forward toss as the phoenix lets go
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
 * Pose of a carried skull. tick may be fractional (client frames). height(x, z) = ground height.
 * Returns {position, quaternion (x,y,z,w), velocity (m/s), effort 0..1 (how hard it is flapping), t, done}.
 */
export function carryPose(carry, tick, height = () => -Infinity) {
  const C = PHOENIX_CARRY, t = Math.max(0, (tick - carry.at) / 60), u = Math.min(1, t / C.seconds), phase = carry.seed * TAU;
  const at = time => {
    const v = Math.min(1, time / C.seconds);
    // Forward surges with each burst of effort; it never goes backwards (derivative stays positive).
    const s = C.distance * (v + .045 * Math.sin(TAU * v * 3 + phase) - .045 * Math.sin(phase));
    const w = .9 * Math.sin(time * 1.6 + phase) * Math.min(1, time);
    const settle = Math.min(1, time / .35);
    let h = C.lift * smooth(settle) + C.climb * smooth(v) + .16 * Math.sin(time * TAU * 2.3 + phase) * settle;
    // Two near-drops: the skull plunges, the phoenix flails and hauls it back up.
    h -= 1.25 * bump(time, 1.55, .85) + .7 * bump(time, 3.45, .6);
    const [dx, dz] = carry.dir, x = carry.from[0] + dx * s - dz * w, z = carry.from[2] + dz * s + dx * w;
    return [x, Math.max(carry.from[1] + h, height(x, z) + C.clearance), z];
  };
  const position = at(t), ahead = at(t + 1 / 60), velocity = ahead.map((n, i) => (n - position[i]) * 60);
  // The skull dangles: pendulum swing across the heading and a nodding pitch, wilder during the near-drops.
  const panic = bump(t, 1.55, .85) + bump(t, 3.45, .6);
  const yaw = Math.atan2(carry.dir[0], carry.dir[1]) + .25 * Math.sin(t * 2.1 + phase);
  const roll = (.28 + .35 * panic) * Math.sin(t * 5.3 + phase), pitch = (.2 + .3 * panic) * Math.sin(t * 4.1 + 1.3 + phase);
  const quaternion = eulerYXZ(pitch, yaw, roll);
  const done = u >= 1 || Math.abs(position[0]) > C.bounds || Math.abs(position[2]) > C.bounds;
  return {position, quaternion, velocity, effort: Math.min(1, .55 + .45 * panic + .2 * Math.max(0, -velocity[1]) / 3), t, done};
}

// Quaternion of Euler angles applied yaw (Y), then pitch (X), then roll (Z): the same as THREE's 'YXZ' order.
function eulerYXZ(x, y, z) {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2), s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
}
