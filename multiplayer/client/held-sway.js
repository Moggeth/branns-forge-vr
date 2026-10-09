// Presentation-only inertia for the first-person held item (desktop and touch).
// The item resists each look turn, then springs back; walking bobs it, strafing banks it,
// jumping lifts it and landing dips it. Aim, contact rays and the shared simulation never
// read these offsets. In VR the item rides the real controller grip, so this never runs.
import * as T from 'three';

export const HELD_SWAY = Object.freeze({
  follow: .32,          // share of each look turn the item resists (0 rigid, 1 stays put in the world)
  limit: .16,           // rad, soft cap on the lag angle so a mouse flick can't fling the item off screen
  stiffness: 95,        // angular spring; with damping this settles with one small overshoot
  damping: 13,
  lever: .3,            // m of on-screen travel per radian of lag (the item swings about the shoulder)
  roll: .55,            // a lagging turn also cants the head of the item behind it
  strafeRoll: .07,      // rad of bank at full strafe speed
  strafeLag: .02,       // m the item trails a full-speed strafe
  pushBack: .016,       // m the item draws in toward the body at full forward speed
  moveResponse: 6,      // 1/s, how quickly the body-motion pose catches up
  bob: Object.freeze({rate: .3, side: .007, drop: .011, roll: .012}), // rate in stride cycles per metre
  posStiffness: 120,    // positional spring for jump lift and landing dip
  posDamping: 14,
  jumpLift: .0045,      // m per m/s of vertical speed (rising hangs the item low, falling floats it)
  landDip: .09,         // spring kick per m/s of landing speed
  snapAngle: .9,        // rad in one frame: a teleport or scripted snap, not a turn
  aimCalm: .85,         // aiming down sights removes this share of the sway
  swingWeight: .5,      // authored swing paths keep their shape under a fast turn
  reducedMotion: .35,
  mass: Object.freeze({hammer: 1.35, limb: 1.25, crossbow: 1.15, stormreel: 1.1, axe: 1, wyrmspout: 1, pick: .85, bow: .8, flask: .65}),
});

const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const STEP = 1 / 120;

export function createHeldSway({strength = 1, reducedMotion = false, config = HELD_SWAY} = {}) {
  const c = config;
  let lagYaw = 0, lagPitch = 0, velYaw = 0, velPitch = 0, prevYaw = null, prevPitch = null;
  let side = 0, forward = 0, gait = 0, phase = 0, swingBlend = 0, wasGrounded = true, lastVertical = 0;
  const offset = new T.Vector3(), velocity = new T.Vector3(), target = new T.Vector3();
  const out = {position: new T.Vector3(), quaternion: new T.Quaternion()}, euler = new T.Euler(0, 0, 0, 'YXZ');

  function reset() {
    lagYaw = lagPitch = velYaw = velPitch = side = forward = gait = swingBlend = 0; prevYaw = prevPitch = null;
    offset.set(0, 0, 0); velocity.set(0, 0, 0); wasGrounded = true; lastVertical = 0;
    out.position.set(0, 0, 0); out.quaternion.identity();
    return out;
  }
  // The next update takes the current view as its reference instead of reading a jump as a turn.
  function snap() { prevYaw = prevPitch = null; }

  // yaw/pitch: camera angles (rad). move: world-space horizontal velocity (m/s). calm: 0..1 aim amount.
  function update(dt, {yaw = 0, pitch = 0, move = null, grounded = true, verticalSpeed = 0, tool = 'axe', calm = 0, swinging = false, visible = true} = {}) {
    if (!visible) return reset();
    dt = Math.min(Math.max(dt, 0), .05);
    const mass = c.mass[tool] ?? 1, follow = c.follow * Math.min(1.25, Math.sqrt(mass));
    const k = c.stiffness / mass, damp = c.damping / Math.sqrt(mass);

    // Look inertia: the item keeps part of its world orientation as the camera turns away from it.
    if (prevYaw !== null) {
      const dYaw = wrap(yaw - prevYaw), dPitch = pitch - prevPitch;
      if (Math.hypot(dYaw, dPitch) < c.snapAngle) { lagYaw -= dYaw * follow; lagPitch -= dPitch * follow; }
    }
    prevYaw = yaw; prevPitch = pitch;
    lagYaw = c.limit * Math.tanh(lagYaw / c.limit); lagPitch = c.limit * Math.tanh(lagPitch / c.limit);

    // Body motion in camera-relative terms (+side = strafing right, +forward = moving where you look).
    const mx = move?.x || 0, mz = move?.z || 0, speed = Math.hypot(mx, mz);
    const wantSide = mx * Math.cos(yaw) - mz * Math.sin(yaw), wantForward = -mx * Math.sin(yaw) - mz * Math.cos(yaw);
    const ease = 1 - Math.exp(-c.moveResponse * dt);
    side += (wantSide - side) * ease; forward += (wantForward - forward) * ease;
    swingBlend += ((swinging ? 1 : 0) - swingBlend) * (1 - Math.exp(-20 * dt)); // no pop when a swing starts
    gait += ((grounded ? Math.min(1, speed / 5) : 0) - gait) * ease;
    if (grounded) phase += speed * dt * c.bob.rate * Math.PI * 2;
    phase %= Math.PI * 200;

    if (grounded && !wasGrounded) velocity.y -= Math.min(Math.abs(lastVertical), 14) * c.landDip;
    wasGrounded = grounded; lastVertical = verticalSpeed;
    target.set(-side / 5 * c.strafeLag, grounded ? 0 : -T.MathUtils.clamp(verticalSpeed, -10, 8) * c.jumpLift, Math.max(0, forward) / 5 * c.pushBack);

    for (let left = dt; left > 1e-6; left -= STEP) {
      const h = Math.min(STEP, left);
      velYaw += (-k * lagYaw - damp * velYaw) * h; lagYaw += velYaw * h;
      velPitch += (-k * lagPitch - damp * velPitch) * h; lagPitch += velPitch * h;
      velocity.x += (c.posStiffness * (target.x - offset.x) - c.posDamping * velocity.x) * h;
      velocity.y += (c.posStiffness * (target.y - offset.y) - c.posDamping * velocity.y) * h;
      velocity.z += (c.posStiffness * (target.z - offset.z) - c.posDamping * velocity.z) * h;
      offset.addScaledVector(velocity, h);
    }

    const weight = strength * (1 - c.aimCalm * T.MathUtils.clamp(calm, 0, 1)) * (1 - (1 - c.swingWeight) * swingBlend) * (reducedMotion ? c.reducedMotion : 1);
    const stride = Math.sin(phase), step = (Math.cos(2 * phase) - 1) / 2;
    out.position.set(
      -lagYaw * c.lever + offset.x + stride * c.bob.side * gait,
      lagPitch * c.lever + offset.y + step * c.bob.drop * gait,
      offset.z,
    ).multiplyScalar(weight);
    euler.set(lagPitch * weight, lagYaw * weight, (lagYaw * c.roll - side / 5 * c.strafeRoll + stride * c.bob.roll * gait) * weight);
    out.quaternion.setFromEuler(euler);
    return out;
  }
  return {update, snap, reset};
}
