// Timberline gameplay-side logic, engine-agnostic (no Three.js, no DOM).
// Intended for whichever side owns authority (server, host peer or solo
// client). Presentation modules consume its outputs; nothing here renders.
//
//  - Mount timing: loaded -> firing -> reloading -> loaded on a fixed cooldown.
//  - Volley stepping: eye positions per tick from timberline-flight.js.
//  - Filament sweep: the moving wire between the two eyes is tested against
//    vertical cylinders (trees, posts) and vertical capsules (creatures).
//
// Vectors are [x, y, z] arrays, metres, +Y up. Times are seconds.
import {TIMBERLINE_FLIGHT, timberlinePairState} from './timberline-flight.js';

export const TIMBERLINE_RULES = Object.freeze({
  cooldown: 4.0,          // s between shots (matches the current gameplay cooldown)
  releaseDelay: 0.05,     // s from trigger to release (Fire clip 'release' marker)
  reloadStart: 0.75,      // s after trigger when the Reload clip begins (end of Fire clip)
  reloadDuration: 3.15,   // s, Reload clip length (ends with 'reload_complete')
  boltRadius: 0.045,      // collision capsule radius for each bolt
  filamentRadius: 0.01,   // swept wire thickness used for contact
  maxRange: TIMBERLINE_FLIGHT.range,
});

// ---------------------------------------------------------------- mount timing

export function createTimberlineMount(rules = TIMBERLINE_RULES) {
  let lastFire = -Infinity;
  return {
    get rules() { return rules; },
    canFire(now) { return now - lastFire >= rules.cooldown; },
    // Returns {fired:false} or {fired:true, releaseAt, readyAt}.
    tryFire(now) {
      if (now - lastFire < rules.cooldown) return {fired: false, readyAt: lastFire + rules.cooldown};
      lastFire = now;
      return {fired: true, releaseAt: now + rules.releaseDelay, readyAt: now + rules.cooldown};
    },
    // Presentation phase for a given time (useful for late joiners / snapshots).
    phase(now) {
      const t = now - lastFire;
      if (!Number.isFinite(t) || t >= rules.reloadStart + rules.reloadDuration) return {name: 'loaded', t: 0};
      if (t < rules.reloadStart) return {name: 'firing', t};
      return {name: 'reloading', t: t - rules.reloadStart};
    },
    restore(lastFireTime) { lastFire = lastFireTime; },
    get lastFire() { return lastFire; },
  };
}

// ---------------------------------------------------------------- volley

// launch: {origin, forward, right, up} as arrays (from the ballista release
// payload, or computed by the authority from the mount transform).
export function createTimberlineVolley(launch, {flight = TIMBERLINE_FLIGHT, loadedHalf = null} = {}) {
  const cfg = loadedHalf ? {...flight, loadedHalf} : flight;
  let t = 0;
  let impact = null;
  let prev = timberlinePairState(0, launch, cfg);
  let cur = prev;
  return {
    get time() { return t; },
    get state() { return cur; },
    get previous() { return prev; },
    get impact() { return impact; },
    get done() {
      if (impact && cur.speedScale < 0.02 && t - impact.time > 0.6) return true;
      const d = sub(cur.centre, launch.origin);
      return dot(d, launch.forward) > cfg.range;
    },
    step(dt) {
      prev = cur;
      t += dt;
      cur = timberlinePairState(t, launch, cfg, impact);
      return cur;
    },
    // Register resistance once the authority has decided what was struck.
    // resistance 0 slices straight through, 1 stops the pair dead.
    strike(resistance, time = t) {
      if (!impact) impact = {time, resistance};
      return impact;
    },
  };
}

// ---------------------------------------------------------------- sweep tests

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lerp = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];

// Closest point on segment AB to point P in the XZ plane. Returns {s, d2}.
function segPointXZ(A, B, P) {
  const ax = B[0] - A[0], az = B[2] - A[2];
  const len2 = ax * ax + az * az || 1e-12;
  let s = ((P[0] - A[0]) * ax + (P[2] - A[2]) * az) / len2;
  s = Math.min(1, Math.max(0, s));
  const dx = A[0] + ax * s - P[0], dz = A[2] + az * s - P[2];
  return {s, d2: dx * dx + dz * dz};
}

// Signed side of P relative to the directed line A->B in XZ.
function sideXZ(A, B, P) {
  return (B[0] - A[0]) * (P[2] - A[2]) - (B[2] - A[2]) * (P[0] - A[0]);
}

// Sweep the filament from (prevL, prevR) to (curL, curR) against a vertical
// cylinder or capsule {centre:[x,y,z] (base), radius, height}.
// Returns null, or {u: 0..1 fraction of the step, s: 0..1 along L->R,
// point: [x,y,z] contact on the wire, part: 'filament'|'bolt_L'|'bolt_R'}.
export function sweepFilament(prevL, prevR, curL, curR, target, {substeps = 6, rules = TIMBERLINE_RULES} = {}) {
  const r = target.radius + rules.filamentRadius;
  const y0 = target.centre[1], y1 = target.centre[1] + target.height;
  let lastSide = null;
  for (let i = 0; i <= substeps; i++) {
    const u = i / substeps;
    const L = lerp(prevL, curL, u), R = lerp(prevR, curR, u);
    const {s, d2} = segPointXZ(L, R, target.centre);
    const side = sideXZ(L, R, target.centre);
    const crossed = lastSide !== null && Math.sign(side) !== Math.sign(lastSide) && s > 0 && s < 1;
    lastSide = side;
    if (d2 <= r * r || crossed) {
      const point = lerp(L, R, s);
      if (point[1] < y0 || point[1] > y1) continue;
      const part = s <= 0.001 ? 'bolt_L' : s >= 0.999 ? 'bolt_R' : 'filament';
      return {u, s, point, part};
    }
  }
  return null;
}

// Typical resistance by material for the presentation response. Gameplay
// can override per target (armour, trunk girth, magic wards...).
export function timberlineResistance({kind = 'tree', radius = 0.25} = {}) {
  if (kind === 'tree' || kind === 'log') return Math.min(0.95, Math.max(0.15, radius / 0.34));
  if (kind === 'creature') return Math.min(0.9, Math.max(0.25, radius / 0.5));
  if (kind === 'stone') return 1;
  return 0.5;
}
