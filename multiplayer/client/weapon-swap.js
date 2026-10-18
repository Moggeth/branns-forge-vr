// Presentation-only weapon swap for the first-person view: the held item is stashed out of frame in its own style,
// the next one is swapped in out of sight, then it is drawn into the hands in its own style. The shared simulation
// learns the new tool at once; this only decides when the local model changes and how the camera-held anchor is
// offset. In VR the item rides the real grip, so swaps there stay instant.
import * as T from 'three';

// Keys: {at 0..1, p: camera-space offset (m), r: camera-space XYZ rotation about the grip (rad)}. A stash starts at
// rest and ends out of frame; a draw starts out of frame and ends at rest. Paths are smooth through every key.
const K = (at, p = [0, 0, 0], r = [0, 0, 0]) => Object.freeze({at, p, r});
export const WEAPON_SWAP_STYLES = Object.freeze({
  // Axe: hefted onto the shoulder and gone; drawn back down in a short chop that bites, then settles.
  axe: {lower: .24, raise: .32,
    stash: [K(0), K(.3, [.02, -.03, 0], [-.22, 0, .1]), K(1, [.26, .3, .48], [1.55, -.3, -.6])],
    draw: [K(0, [.26, .3, .48], [1.55, -.3, -.6]), K(.55, [.01, -.06, -.01], [-.32, 0, .22]), K(.8, [0, .012, 0], [.05, 0, -.04]), K(1)]},
  // Pick: a little lift, then swung down to the hip; drawn up and given a prospector's tap.
  pick: {lower: .22, raise: .32,
    stash: [K(0), K(.3, [0, .035, 0], [.18, 0, 0]), K(1, [-.05, -.5, .15], [-1.4, .2, .5])],
    draw: [K(0, [-.05, -.5, .15], [-1.4, .2, .5]), K(.58, [0, .025, 0], [.14, 0, -.05]), K(.76, [0, -.028, 0], [-.13, 0, 0]), K(.9, [0, .006, 0], [.03, 0, 0]), K(1)]},
  // Hammer: heaved, then it sags out under its own weight; drawn with effort and lands with a thud.
  hammer: {lower: .28, raise: .32,
    stash: [K(0), K(.25, [0, .03, 0], [.08, 0, 0]), K(.55, [.01, -.12, .02], [-.28, 0, .08]), K(1, [.05, -.56, .1], [-.95, 0, .3])],
    draw: [K(0, [.05, -.56, .1], [-.95, 0, .3]), K(.55, [0, .05, .02], [.18, 0, -.05]), K(.74, [0, -.045, 0], [-.11, 0, .02]), K(.9, [0, .008, 0], [.02, 0, 0]), K(1)]},
  // Siegebird: rolled onto its side and slung; drawn canted to check the rail, then levelled.
  crossbow: {lower: .26, raise: .32,
    stash: [K(0), K(.3, [.02, .02, 0], [0, 0, -.35]), K(1, [.25, -.46, .15], [-.4, .6, -1.5])],
    draw: [K(0, [.25, -.46, .15], [-.4, .6, -1.5]), K(.55, [-.02, .012, 0], [.05, -.1, .34]), K(.8, [0, 0, .01], [0, 0, -.06]), K(1)]},
  // Flockwright: heavier, so it is slung lower and heaved up; the crew bobs on the settle.
  flockwright: {lower: .3, raise: .38,
    stash: [K(0), K(.3, [.02, .015, 0], [0, 0, -.3]), K(1, [.22, -.5, .15], [-.45, .55, -1.4])],
    draw: [K(0, [.22, -.5, .15], [-.45, .55, -1.4]), K(.55, [-.015, .02, 0], [.08, -.08, .28]), K(.78, [0, -.012, .012], [-.05, 0, -.05]), K(1)]},
  // Emberwing: turned flat and slid onto the back. Its own sweep up from below is the draw (emberwing-motion.js).
  bow: {lower: .22, raise: 0,
    stash: [K(0), K(.3, [.01, .02, 0], [0, 0, .25]), K(1, [-.22, -.42, .2], [-.3, 0, 1.4])],
    draw: null},
  // Wyrmspout: nozzle tipped up, then down and away; drawn up with a sputtering shiver.
  wyrmspout: {lower: .24, raise: .32,
    stash: [K(0), K(.3, [0, .04, 0], [.38, 0, 0]), K(1, [.1, -.5, .1], [-1.2, 0, .6])],
    draw: [K(0, [.1, -.5, .1], [-1.2, 0, .6]), K(.6, [0, .012, 0], [.1, 0, 0]), K(.7, [0, 0, 0], [-.04, 0, .05]), K(.78, [0, 0, 0], [.03, 0, -.05]), K(.87, [0, 0, 0], [-.015, 0, .025]), K(1)]},
  // Stormreel: swung down to the hip on its cable, then brought up with a little snap that settles the capacitors.
  stormreel: {lower: .22, raise: .3,
    stash: [K(0), K(.3, [0, .03, 0], [.2, 0, -.1]), K(1, [.18, -.5, .1], [-.9, .3, .5])],
    draw: [K(0, [.18, -.5, .1], [-.9, .3, .5]), K(.6, [0, .015, 0], [.08, 0, 0]), K(.8, [0, -.004, .006], [-.03, 0, 0]), K(1)]},
  // Flask: tucked into the belt; drawn with a toss that spins it once and a catch.
  flask: {lower: .2, raise: .4,
    stash: [K(0), K(.25, [.01, .02, 0], [0, 0, -.15]), K(1, [-.26, -.45, .2], [-.6, 0, .9])],
    draw: [K(0, [-.1, -.5, .1]), K(.45, [0, .12, 0], [0, Math.PI, 0]), K(.7, [0, -.02, 0], [0, Math.PI * 2, 0]), K(.86, [0, .008, 0], [0, Math.PI * 2, 0]), K(1, [0, 0, 0], [0, Math.PI * 2, 0])]},
  // Sunthread: the crown dips away like a lowered lantern; drawn up with a little upward flourish that settles.
  staff: {lower: .26, raise: .36,
    stash: [K(0), K(.3, [0, .03, 0], [.12, 0, -.08]), K(1, [.14, -.62, .12], [-.8, 0, .5])],
    draw: [K(0, [.14, -.62, .12], [-.8, 0, .5]), K(.55, [0, .05, 0], [.1, 0, -.06]), K(.78, [0, -.012, 0], [-.04, 0, .02]), K(1)]},
  // Reduced motion and anything unlisted: a plain dip out and back.
  plain: {lower: .22, raise: .28,
    stash: [K(0), K(1, [-.05, -.48, .08], [-1.2, 0, .3])],
    draw: [K(0, [-.05, -.48, .08], [-1.2, 0, .3]), K(1)]},
});

// One switch back to the plain dip for every weapon (the bow keeps its own raise). Reduced motion always uses it.
export const WEAPON_SWAP_SIMPLE = false;

const clamp01 = v => Math.min(1, Math.max(0, v));
const smooth = u => u * u * (3 - 2 * u);
// Smooth path through the keys (Catmull-Rom tangents, at rest at both ends).
function sample(keys, u, pos, rot) {
  const t = clamp01(u), last = keys.length - 1; let i = 0;
  while (i < last - 1 && t >= keys[i + 1].at) i++;
  const a = keys[i], b = keys[i + 1], span = b.at - a.at, s = span > 0 ? clamp01((t - a.at) / span) : 1;
  const s2 = s * s, s3 = s2 * s, h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  const out = [0, 0, 0, 0, 0, 0];
  for (let c = 0; c < 6; c++) {
    const v = k => (c < 3 ? k.p[c] : k.r[c - 3]);
    const ta = i === 0 ? 0 : (v(b) - v(keys[i - 1])) / (b.at - keys[i - 1].at) * span;
    const tb = i + 1 === last ? 0 : (v(keys[i + 2]) - v(a)) / (keys[i + 2].at - a.at) * span;
    out[c] = h00 * v(a) + h10 * ta + h01 * v(b) + h11 * tb;
  }
  pos.set(out[0], out[1], out[2]); rot.set(out[3], out[4], out[5], 'XYZ');
}

const PLAIN_BOW = Object.freeze({...WEAPON_SWAP_STYLES.plain, draw: null});
export function createWeaponSwap({styles = WEAPON_SWAP_STYLES, reducedMotion = false, simple = WEAPON_SWAP_SIMPLE} = {}) {
  const style = tool => (reducedMotion || simple ? (tool === 'bow' && !styles.bow?.draw ? PLAIN_BOW : styles.plain) : styles[tool] || styles.plain);
  let phase = 'idle', u = 0, stashTool = null, drawTool = null, target = null, blend = null;
  const out = {busy: false, commit: null, amount: 0, position: new T.Vector3(), quaternion: new T.Quaternion()};
  const pos = new T.Vector3(), rot = new T.Euler(), q = new T.Quaternion();

  /** Ask for `next` while `current` is (logically) in the hands. Returns false when there is nothing to animate. */
  function request(next, current) {
    if (phase === 'idle') {
      if (next === current) return false;
      stashTool = current; target = next; phase = 'stash'; u = 0; blend = null; return true;
    }
    if (phase === 'stash') { if (next === stashTool) phase = 'unstash'; else target = next; return true; }
    if (phase === 'unstash') { if (next !== stashTool) { phase = 'stash'; target = next; } return true; }
    // Mid-draw: stash the item being drawn, easing out of wherever it is now.
    if (next === drawTool) return true;
    blend = {position: out.position.clone(), quaternion: out.quaternion.clone()};
    stashTool = drawTool; target = next; phase = 'stash'; u = 0; return true;
  }
  /** Finish at once (VR, hidden anchor). Returns the tool that still needs committing, if any. */
  function cancel() {
    const pending = phase === 'stash' ? target : null;
    phase = 'idle'; u = 0; stashTool = drawTool = target = null; blend = null;
    out.position.set(0, 0, 0); out.quaternion.identity(); out.amount = 0;
    return pending;
  }

  function update(dt) {
    out.commit = null;
    dt = Math.max(0, Math.min(dt, .05));
    if (phase === 'stash') {
      const lower = style(stashTool).lower, next = u + dt / lower;
      u = clamp01(next);
      if (u >= 1) {
        // Time left over after the stash carries into the draw, so the swap lasts the same at any frame rate.
        out.commit = target; drawTool = target; blend = null; u = style(target).draw ? clamp01((next - 1) * lower / style(target).raise) : 0;
        phase = style(target).draw ? 'draw' : 'idle';
      }
    } else if (phase === 'unstash') {
      u = clamp01(u - dt / style(stashTool).lower);
      if (u <= 0) phase = 'idle';
    } else if (phase === 'draw') {
      u = clamp01(u + dt / style(drawTool).raise);
      if (u >= 1) phase = 'idle';
    }
    out.busy = phase !== 'idle' || out.commit !== null;
    if (out.commit) {
      // The models change this frame: keep the anchor out of frame until the new item's draw (or own raise) starts.
      sample(style(stashTool).stash, 1, pos, rot); q.setFromEuler(rot); out.amount = 1;
    } else if (phase === 'stash' || phase === 'unstash') {
      sample(style(stashTool).stash, u, pos, rot); q.setFromEuler(rot);
      if (blend) { const w = smooth(clamp01(u / .4)); pos.lerpVectors(blend.position, pos, w); q.slerpQuaternions(blend.quaternion, q, w); }
      out.amount = u;
    } else if (phase === 'draw') {
      sample(style(drawTool).draw, u, pos, rot); q.setFromEuler(rot); out.amount = 1 - u;
    } else { pos.set(0, 0, 0); q.identity(); out.amount = 0; }
    out.position.copy(pos); out.quaternion.copy(q);
    return out;
  }
  return {request, cancel, update, get busy() { return phase !== 'idle'; }, get target() { return target; }};
}
