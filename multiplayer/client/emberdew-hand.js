import * as THREE from 'three';
// First-person Emberdew motion layer (presentation only, render clock). Rides on the bottle's base pose like the
// Emberwing and pick layers; the sway layer applies on top.
//   aim     right click held: the bottle is cocked back at the shoulder, rag lit, ready to hurl.
//   throw   the arm snaps forward and the bottle leaves the hand (hidden), then a fresh one bobs up from below.
//   cinder  Cinder Cluster: a big high overhand lob.
// update() returns {offset, quaternion, visible, ads, kick} where kick is a one-frame slosh push [x, z] or null.

export const EMBERDEW_HAND = Object.freeze({aimRate: 11, release: .07, gone: .42, rise: .3, ads: .55});
const ease = t => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const back = t => { t = Math.min(1, Math.max(0, t)); const c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

export function createEmberdewHand({reducedMotion = false} = {}) {
  const H = EMBERDEW_HAND, offset = new THREE.Vector3(), quaternion = new THREE.Quaternion(), euler = new THREE.Euler(0, 0, 0, 'XYZ');
  const out = {offset, quaternion, visible: true, ads: 0, kick: null}, kick = [0, 0];
  let aim = 0, thrownAt = -Infinity, style = 'toss', wasAiming = false, risen = true;
  function thrown(time, how = 'toss') { thrownAt = time; style = how; risen = false; }
  function reset() { aim = 0; thrownAt = -Infinity; wasAiming = false; risen = true; }
  function update(time, dt, {aiming = false} = {}) {
    aim += ((aiming ? 1 : 0) - aim) * (1 - Math.exp(-H.aimRate * Math.max(0, dt)));
    out.kick = null;
    if (aiming && !wasAiming) { kick[0] = .9; kick[1] = 1.4; out.kick = kick; } // raising it sloshes the dew back
    wasAiming = aiming;
    const t = time - thrownAt, a = reducedMotion ? Math.min(aim, .6) : aim;
    // Cocked at the shoulder: up, in, closer, top tipped back toward the thrower and rolled out a little.
    offset.set(-.03 * a, .15 * a, .1 * a);
    euler.set(.5 * a, -.15 * a, -.28 * a);
    let visible = true;
    if (t >= 0 && t < H.gone + H.rise) {
      if (t < H.gone) {
        const f = Math.min(1, t / .16), snap = Math.sin(f * Math.PI * .5) * (1 - ease((t - .16) / .2));
        if (style === 'cinder') { offset.y += .16 * snap; offset.z -= .14 * snap; euler.x -= 1.7 * snap; euler.z += .25 * snap; }
        else { offset.y += .05 * snap; offset.z -= .2 * snap; euler.x -= 1.3 * snap; }
        visible = t < H.release;
        if (!visible) offset.y -= .4; // the empty hand drops away while the next bottle is fetched
      } else {
        // A fresh bottle bobs up from below with a little overshoot, and its dew sloshes as it settles.
        const r = back((t - H.gone) / H.rise);
        offset.y -= .4 * (1 - r); euler.x += .35 * (1 - r); euler.z -= .2 * (1 - r);
        if (!risen) { risen = true; kick[0] = -.6; kick[1] = 1.8; out.kick = kick; }
      }
    }
    quaternion.setFromEuler(euler);
    out.visible = visible; out.ads = aim * H.ads;
    return out;
  }
  return {update, thrown, reset, state: () => ({aim, thrownAt, style})};
}
