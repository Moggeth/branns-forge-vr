// Presentation-only weapon swap for the first-person view: the held item drops out of frame, the
// next one is swapped in at the bottom, then it rises into the hands. The shared simulation learns
// the new tool at once; this only decides when the local model changes and how the camera-held
// anchor is offset. In VR the item rides the real grip, so swaps there stay instant.
import * as T from 'three';

export const WEAPON_SWAP = Object.freeze({
  lower: .25,             // s, old item down and out of frame
  raise: .3,              // s, new item up into the hands
  drop: .42,              // m the anchor falls at the bottom of the swap (off screen at every aspect)
  tuck: Object.freeze([.06, .08]), // m inward and toward the body while lowered
  pitch: -1.35,           // rad, the head tips forward and down out of view
  roll: .4,               // rad, the item rolls out as it goes
  overshoot: 1.3,         // easeOutBack strength on the raise (0 = none)
  ownRaise: Object.freeze(['bow']), // tools whose own equip motion rises from below
});

const clamp01 = v => Math.min(1, Math.max(0, v));
const smooth = u => u * u * (3 - 2 * u);
const easeIn = u => u * u * u;
const easeOutBack = (u, s) => { const v = u - 1; return 1 + (s + 1) * v * v * v + s * v * v; };

export function createWeaponSwap({config = WEAPON_SWAP, reducedMotion = false} = {}) {
  const c = config;
  let phase = 'idle', down = 0, target = null, shown = null;
  const out = {busy: false, commit: null, amount: 0, position: new T.Vector3(), quaternion: new T.Quaternion()};
  const euler = new T.Euler(0, 0, 0, 'XYZ');

  /** Ask for `next`. Returns false when it is already in the hands with no swap running (nothing to animate). */
  function request(next, current) {
    if (phase === 'idle' && next === current) return false;
    if (phase === 'idle') shown = current;
    target = next;
    // Asking for the item that is still in the hands while it drops brings it straight back up.
    phase = target === shown ? 'raise' : 'lower';
    return true;
  }
  /** Finish at once (VR, hidden anchor, death, menus). Returns the tool that still needs committing, if any. */
  function cancel() {
    const pending = phase !== 'idle' && target !== shown ? target : null;
    phase = 'idle'; down = 0; target = null; shown = null;
    return pending;
  }

  function update(dt) {
    out.commit = null;
    dt = Math.max(0, Math.min(dt, .05));
    if (phase === 'lower') {
      down = clamp01(down + dt / c.lower);
      if (down >= 1) {
        out.commit = target; shown = target;
        if (c.ownRaise.includes(target)) { phase = 'idle'; down = 0; }
        else phase = 'raise';
      }
    } else if (phase === 'raise') {
      down = clamp01(down - dt / c.raise);
      if (down <= 0) { phase = 'idle'; target = null; shown = null; }
    }
    out.busy = phase !== 'idle' || out.commit !== null;
    const a = phase === 'lower' ? easeIn(down) * .35 + smooth(down) * .65
      : phase === 'raise' ? 1 - easeOutBack(1 - down, reducedMotion ? 0 : c.overshoot) : 0;
    out.amount = a;
    out.position.set(-c.tuck[0] * a, -c.drop * a, c.tuck[1] * a);
    euler.set(c.pitch * a, 0, c.roll * a);
    out.quaternion.setFromEuler(euler);
    return out;
  }
  return {request, cancel, update, get busy() { return phase !== 'idle'; }, get target() { return target; }};
}
