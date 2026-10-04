// Emberwing first-person life (2026-10-04). Presentation only: aim, shot direction and the shared simulation never
// read any of this. Camera space: +X right, +Y up, -Z forward. Like pick-wall-motion.js the result is a LAYER on the
// bow's rest pose: game.js adds `offset` to the anchor position and premultiplies `quaternion`, and held-sway.js then
// applies on top.
//   equip    the bow sweeps up from below with a little wing flourish.
//   draw     the bow straightens and comes in toward the sightline as the string comes back; a held full draw
//            settles into a faint strain tremble (calmed while zoomed).
//   phoenix  latching the curve makes the bow flare: a quick outward roll with spring overshoot, ember surge.
//   release  the bow kicks forward and rolls with the shot, then springs home; the string snaps and hums.
// Outputs for the asset: `ember` (0..1 extra glow for the Ember material), `string` (z offset of the string at
// the nock, m, for the snap/hum) and `stringGlow` (0..1).
import * as T from 'three';

export const EMBERWING_MOTION = Object.freeze({
  equip: .34,                          // s, raise from below
  drawIn: [.025, .02, .015],           // m at full draw: toward centre, up, toward camera
  drawCant: 3,                         // deg of roll that straightens the resting cant at full draw
  tremble: {after: 1.1, ramp: 1.4, pos: .0016, rot: .35, calm: .75},
  flare: {roll: 9, lift: .012, rate: 22, damping: 7.5},  // phoenix latch: spring kick (deg, m), 1/s, 1/s
  kick: {push: .055, lift: .012, pitch: 7, roll: 10, time: .45},
  hum: {amp: .022, rate: 38, decay: 9},   // string snap after release: m, Hz, 1/s
});
const D = T.MathUtils.DEG2RAD, X = new T.Vector3(1, 0, 0), Y = new T.Vector3(0, 1, 0), Z = new T.Vector3(0, 0, 1);
const clamp01 = v => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0)), smooth = u => u * u * (3 - 2 * u), easeOut = u => 1 - (1 - u) ** 3;

export function createEmberwingMotion({reducedMotion = false, config = EMBERWING_MOTION} = {}) {
  const c = config;
  let equipAt = null, drawnFor = 0, wasCurved = false, flare = 0, flareVel = 0, lastShot = -Infinity, lastRecoil = 0;
  const offset = new T.Vector3(), quaternion = new T.Quaternion(), _q = new T.Quaternion();
  const result = {offset, quaternion, ember: 0, string: 0, stringGlow: 0};
  return {
    /** The bow was just equipped (or became visible again). */
    equip(now) { equipAt = now; drawnFor = 0; flare = flareVel = 0; wasCurved = false; },
    reset() { equipAt = null; drawnFor = 0; flare = flareVel = 0; wasCurved = false; lastRecoil = 0; lastShot = -Infinity; },
    /**
     * state: weapon-controller state() ({drawing, draw, curved}); aiming: 0..1 zoom amount.
     * Returns the layer (reused objects) for this frame.
     */
    update(now, dt, {drawing = false, draw = 0, curved = false, recoil = 0} = {}, aiming = 0) {
      dt = Math.min(.05, Math.max(0, dt || 0));
      // The controller's recoil jumps to 1 on each shot (a cancelled draw never fires).
      if (recoil > .9 && lastRecoil <= .9) lastShot = now;
      lastRecoil = recoil;
      const amount = drawing ? smooth(clamp01((draw - .15) / .85)) : 0;
      drawnFor = drawing && draw >= .999 ? drawnFor + dt : 0;
      if (curved && !wasCurved && drawing) flareVel += c.flare.rate;   // impulse (peaks near 0.7); the spring rings it out
      wasCurved = curved && drawing;
      const k = c.flare.rate;
      flareVel += (-k * k * flare - 2 * c.flare.damping * flareVel) * dt; flare += flareVel * dt;

      let x = c.drawIn[0] * amount, y = c.drawIn[1] * amount, z = c.drawIn[2] * amount;
      let pitch = 0, roll = -c.drawCant * amount, yaw = 0;
      // Equip: up from below and outside, with a roll that settles as it arrives.
      if (equipAt !== null) {
        const u = clamp01((now - equipAt) / c.equip), e = 1 - easeOut(u);
        y -= .22 * e; x -= .06 * e; pitch -= 26 * e; roll -= 18 * e * (1 - u);
        if (u >= 1) equipAt = null;
      }
      if (!reducedMotion) {
        const t = c.tremble, strain = smooth(clamp01((drawnFor - t.after) / t.ramp)) * (1 - t.calm * clamp01(aiming));
        x += (Math.sin(now * 41) + .6 * Math.sin(now * 67 + 1.1)) * t.pos * strain;
        y += (Math.sin(now * 47 + .7) + .5 * Math.sin(now * 73)) * t.pos * strain;
        roll += Math.sin(now * 29 + .3) * t.rot * strain;
      }
      roll += c.flare.roll * flare; y += c.flare.lift * flare;
      // Release kick: forward shove and roll with the shot, sprung home.
      const since = now - lastShot;
      let string = 0, glowAfter = 0;
      if (since >= 0 && since < c.kick.time) {
        const u = since / c.kick.time, shove = Math.sin(Math.min(1, u * 2.2) * Math.PI) * (1 - u) ** 1.5;
        z -= c.kick.push * shove; y += c.kick.lift * shove; pitch += c.kick.pitch * shove; roll -= c.kick.roll * shove;
      }
      if (since >= 0 && since < 1) {
        string = Math.sin(since * c.hum.rate * Math.PI * 2) * c.hum.amp * Math.exp(-since * c.hum.decay);
        glowAfter = Math.exp(-since * 5);
      }
      if (reducedMotion) { pitch *= .4; roll *= .4; string *= .4; }
      offset.set(x, y, z);
      quaternion.setFromAxisAngle(Z, -roll * D).multiply(_q.setFromAxisAngle(Y, yaw * D)).multiply(_q.setFromAxisAngle(X, pitch * D));
      result.ember = clamp01(.55 * amount + .45 * (curved && drawing ? 1 : 0) + .6 * Math.abs(flare) + .5 * glowAfter);
      result.string = string; result.stringGlow = clamp01(amount * .8 + (curved && drawing ? .2 : 0) + glowAfter * .6);
      return result;
    },
  };
}
