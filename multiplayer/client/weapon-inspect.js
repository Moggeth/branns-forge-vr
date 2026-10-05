// Weapon Inspect: bring the held weapon up to the middle of the view and turn it over, admiring it.
// Presentation only (first person, not in VR, where the weapon is already in your hand).
//   tap I (desktop) / Inspect in Actions ⋯ (phone): a short choreographed turn — side, top, a stare
//     down the business end, the other side — then it settles back.
//   hold I and move the mouse (desktop) / drag the look stick (phone, while inspecting): spin it yourself.
// The pose is solved around the model's own centre, so every weapon, long bow or stubby flask, turns in
// place and fills the same part of the screen. Everything is evaluated per frame on the presentation clock.
import * as THREE from 'three';

const BLEND_IN = .32, BLEND_OUT = .38, HOLD_TO_SPIN = .18;
const deg = Math.PI / 180;
// [time s, yaw, pitch, roll] in the camera frame; yaw +90° turns the weapon's tip to the left of the screen.
export const INSPECT_KEYS = Object.freeze([
  [0, 0, 0, 0],
  [.55, 82 * deg, 10 * deg, 8 * deg],      // its right side
  [1.45, 96 * deg, 4 * deg, -4 * deg],     // ...a slow drift while you look
  [2.15, 78 * deg, 48 * deg, 0],           // tip the top toward you
  [2.85, 176 * deg, 8 * deg, -6 * deg],    // and it stares straight back at you
  [3.25, 184 * deg, 4 * deg, 4 * deg],
  [4.0, 268 * deg, 14 * deg, -10 * deg],   // its left side
  [4.6, 270 * deg, 8 * deg, -6 * deg],
]);
export const INSPECT_DURATION = INSPECT_KEYS.at(-1)[0];
// Presenting orientation per weapon in the anchor frame (every model is prepared to face -Z, up +Y);
// the choreography turns it from there. Empty means "as prepared".
export const INSPECT_BASE = Object.freeze({});

const ease = t => t * t * (3 - 2 * t);
const _e = new THREE.Euler(0, 0, 0, 'YXZ'), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _v = new THREE.Vector3();

function keyQuat(k, out) { return out.setFromEuler(_e.set(k[2], k[1], k[3], 'YXZ')); }
/** Choreographed orientation (relative to the weapon's rest pose) at time t. */
export function choreography(t, out = new THREE.Quaternion()) {
  const keys = INSPECT_KEYS;
  if (t <= 0) return keyQuat(keys[0], out);
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const a = keys[i - 1], b = keys[i], f = ease((t - a[0]) / (b[0] - a[0]));
      // Interpolate the angles, not the quaternions, so the half-turn goes the way the keys say.
      return out.setFromEuler(_e.set(a[2] + (b[2] - a[2]) * f, a[1] + (b[1] - a[1]) * f, a[3] + (b[3] - a[3]) * f, 'YXZ'));
    }
  }
  return keyQuat(keys.at(-1), out);
}

export function createWeaponInspect({reducedMotion = () => false} = {}) {
  let mode = null;            // null | 'auto' | 'manual'
  let t = 0, amount = 0, held = false, heldFor = 0, spun = false, pinned = null;   // pinned: captures freeze the turn at one moment
  // Manual spin: angles chase their targets with a little weight.
  const spin = {yaw: 0, pitch: 0, tyaw: 0, tpitch: 0, vyaw: 0, vpitch: 0};
  const pose = {amount: 0, position: new THREE.Vector3(), quaternion: new THREE.Quaternion()};
  const relative = new THREE.Quaternion(), target = new THREE.Vector3();

  function start() { mode = 'auto'; t = 0; spun = false; Object.assign(spin, {yaw: 0, pitch: 0, tyaw: 0, tpitch: 0, vyaw: 0, vpitch: 0}); }
  function stop() { mode = null; held = false; pinned = null; }
  function toManual() {
    if (mode === 'manual') return;
    // Pick up from wherever the turn is now, so taking over never snaps.
    if (mode === 'auto') { _e.setFromQuaternion(choreography(t, _qa), 'YXZ'); spin.yaw = spin.tyaw = _e.y; spin.pitch = spin.tpitch = _e.x; }
    mode = 'manual';
  }

  return {
    /** Desktop key down: start a turn, or end one with a second tap. */
    press() { if (mode && !held) { stop(); return; } if (!mode) start(); held = true; heldFor = 0; },
    /** Desktop key up: a spin you were driving settles back; a tap keeps playing its turn. */
    release() { if (!held) return; held = false; if (mode === 'manual') stop(); },
    /** Phone: Inspect toggles. */
    toggle() { if (mode) stop(); else start(); },
    /** Captures and tests: hold the turn at time `at` (null resumes). */
    pin(at) { pinned = Number.isFinite(at) ? at : null; if (pinned !== null && !mode) start(); },
    cancel: stop,
    /** Look input while inspecting; true when it was used to turn the weapon (the camera should stay put). */
    spin(dx, dy, {touch = false} = {}) {
      if (!mode || (!touch && !held)) return false;
      toManual(); spun = true;
      spin.tyaw += dx; spin.tpitch = THREE.MathUtils.clamp(spin.tpitch + dy, -1.2, 1.2);
      return true;
    },
    /** True while the key is held during an inspect: mouse look belongs to the weapon. */
    owningLook: () => !!mode && held,
    active: () => !!mode || amount > .001,
    mode: () => mode,
    /**
     * dt: frame seconds. fit: {center: model centre in the anchor's local frame, radius}.
     * Returns the inspect pose for the weapon anchor in camera space, and how much of it to apply.
     */
    update(dt, {visible = true, fit} = {}) {
      dt = Math.min(.1, Math.max(0, dt || 0));
      if (!visible) stop();
      if (held && (heldFor += dt) > HOLD_TO_SPIN && mode === 'auto' && spun) toManual();
      if (mode === 'auto') { if (pinned !== null) { t = pinned; amount = 1; } else { t += dt * (reducedMotion() ? .8 : 1); if (t >= INSPECT_DURATION) stop(); } }
      const want = mode ? 1 : 0;
      amount = want > amount ? Math.min(1, amount + dt / BLEND_IN) : Math.max(0, amount - dt / BLEND_OUT);
      if (mode === 'manual') {
        // Critically damped chase: weighty, never overshooting into a wobble.
        const k = 140, c = 2 * Math.sqrt(k);
        spin.vyaw += ((spin.tyaw - spin.yaw) * k - spin.vyaw * c) * dt; spin.yaw += spin.vyaw * dt;
        spin.vpitch += ((spin.tpitch - spin.pitch) * k - spin.vpitch * c) * dt; spin.pitch += spin.vpitch * dt;
        relative.setFromEuler(_e.set(spin.pitch, spin.yaw, 0, 'YXZ'));
      } else if (mode === 'auto') choreography(t, relative);
      // (blending out keeps the last orientation so the weapon swings home from where it was)
      pose.amount = ease(amount);
      const center = fit?.center || _v.set(0, 0, -.2), radius = Math.max(.12, fit?.radius || .3);
      // Hold it a comfortable arm's length away: far enough to fit the whole weapon, never pressed to the lens.
      const distance = THREE.MathUtils.clamp(radius * 1.55 + .1, .36, 1.35);
      const bob = mode ? .006 * Math.sin(performance.now() / 1000 * 1.7) : 0;
      target.set(0, -.03 + bob, -distance);
      // Each weapon has a presenting orientation (fit.base, e.g. an axe held blade-up); the turn is applied on top of it.
      pose.quaternion.copy(relative);
      if (fit?.base) pose.quaternion.multiply(fit.base);
      // Turn about the model's centre, not the grip: put the centre at the target point.
      pose.position.copy(target).sub(_v.copy(center).applyQuaternion(pose.quaternion));
      return pose;
    },
  };
}

/** The model's centre and size in the anchor's frame (computed once per equip). */
export function measureWeapon(model, anchor) {
  if (!model) return null;
  anchor.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(anchor.matrixWorld).invert(), box = new THREE.Box3(), p = new THREE.Vector3();
  model.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox, m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    for (let i = 0; i < 8; i++) box.expandByPoint(p.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(m));
  });
  if (box.isEmpty()) return null;
  return {center: box.getCenter(new THREE.Vector3()), radius: box.getSize(new THREE.Vector3()).length() / 2};
}
