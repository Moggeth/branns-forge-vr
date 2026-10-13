// Authoritative remains physics: every detached part is a small rigid box (its frozen bone geometry's
// bounds) stepped with position-based dynamics. Contact corners take terrain normals, friction and
// torque, so a limb tips over and lies flat instead of balancing on a corner. A dead skeleton's parts
// stay pinned at their joints (neck, shoulders, hips) and fall as one ragdoll; a hard enough blow tears
// a joint. Fixed 1/60 s ticks, no randomness: every peer replays the host exactly.
// Bodies sleep once they settle and wake on any impulse, push or grab, so a field of bones costs nothing.
import {clampToWorld} from './keep-sites.js';
const G = 15, SUB = 2, ITER = 4, FOLD = .78, FOLD_ARM = .38, SLEEP_V = .06, SLEEP_W = .1, SLEEP_TICKS = 24, MU = .7, BREAK = 7.5, DEPEN = 1.5;
// Mass in arbitrary units (only ratios matter): the ribcage anchors a ragdoll, an arm swings off it.
const MASS = {skeleton: {head: 1, torso: 3, leftArm: .8, rightArm: .8, leftLeg: 1.3, rightLeg: 1.3}, golem: {head: 6, torso: 14, leftArm: 5, rightArm: 5, leftLeg: 6, rightLeg: 6}};
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const len = v => Math.hypot(v[0], v[1], v[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export function rotate(v, q) {
  const [x, y, z, w] = q, [a, b, c] = v, tx = 2 * (y * c - z * b), ty = 2 * (z * a - x * c), tz = 2 * (x * b - y * a);
  return [a + w * tx + y * tz - z * ty, b + w * ty + z * tx - x * tz, c + w * tz + x * ty - y * tx];
}
export const unrotate = (v, q) => rotate(v, [-q[0], -q[1], -q[2], q[3]]);
const box = d => d.localBounds || {min: [-.25, -.25, -.25], max: [.25, .25, .25]};
const centre = d => {const b = box(d); return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];};
export function partMass(d) {return (MASS[d.kind] || MASS.skeleton)[d.part] || 1;}
function inertia(d, m) {const b = box(d), s = sub(b.max, b.min); return Math.max(.004, m * (s[0] * s[0] + s[1] * s[1] + s[2] * s[2]) / 18);}
// Rotate quaternion q by the small rotation vector r (world space).
function spin(q, r) {
  const [x, y, z, w] = q, [a, b, c] = r;
  const n = [x + .5 * (a * w + b * z - c * y), y + .5 * (b * w + c * x - a * z), z + .5 * (c * w + a * y - b * x), w - .5 * (a * x + b * y + c * z)], l = Math.hypot(...n);
  return n.map(v => v / l);
}
const awake = d => !(d.rest >= SLEEP_TICKS);
export function wake(d) {if (d.rest) d.rest = 0;}

// Instant velocity change from an impulse J (world) at world point p. Tears a joint on a big enough blow.
export function applyImpulse(state, d, J, p) {
  if (!d || d.heldBy || d.carry) return; // a phoenix-carried skull follows its flight path (shared/phoenix-carry.js)
  const m = partMass(d), I = inertia(d, m), c = add(d.position, rotate(centre(d), d.quaternion));
  d.velocity = d.velocity.map((v, i) => clamp(v + J[i] / m, -60, 60));
  const t = cross(p ? sub(p, c) : [0, 0, 0], J);
  d.angularVelocity = d.angularVelocity.map((w, i) => clamp(w + t[i] / I, -28, 28));
  if (d.joint && len(J) / m > BREAK) tear(state, d);
  wake(d); for (const o of group(state, d)) wake(o);
}
function add(a, b) {return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];}
export function tear(state, d, events) {
  if (!d.joint) return;
  delete d.joint; events?.push({kind: 'joint_tear', id: d.id, position: [...d.position], part: d.part});
}
// Parts pinned to each other (a limb's joint names its torso; the torso is named by its limbs).
export function group(state, d) {
  const root = d.joint ? state.detachedParts.find(o => o.id === d.joint.to) : d;
  if (!root) return [d];
  return state.detachedParts.filter(o => o === root || o.joint?.to === root.id);
}

// Link the parts a dying skeleton left behind. jointAt(part) gives the world joint point.
export function linkRagdoll(parts, jointAt) {
  const torso = parts.find(p => p.part === 'torso'); if (!torso) return;
  for (const p of parts) {
    if (p === torso) continue;
    const at = jointAt(p);
    p.joint = {to: torso.id, a: round(unrotate(sub(at, torso.position), torso.quaternion)), b: round(unrotate(sub(at, p.position), p.quaternion))};
  }
}
const round = v => v.map(n => Math.round(clamp(n, -3.9, 3.9) * 1e5) / 1e5);

// One fixed tick for every free (not held) part. `kinematic` parts (held in a hero's hand) are
// solved as infinitely heavy anchors so a held arm drags its skeleton along.
export function stepRemains(state, ctx, dt = 1 / 60) {
  const all = state.detachedParts; if (!all.length) return;
  const byId = new Map(all.map(d => [d.id, d]));
  // A sleeping ragdoll wakes as a whole if any of its parts is disturbed.
  for (const d of all) if (d.joint) {const t = byId.get(d.joint.to); if (!t) {delete d.joint; continue;} if (awake(d) !== awake(t) && !d.heldBy && !t.heldBy) {wake(d); wake(t);} if (d.heldBy || t.heldBy) {wake(d); wake(t);}}
  const bodies = all.filter(d => !d.carry && (d.heldBy || awake(d))); if (!bodies.length) return;
  const h = dt / SUB, S = new Map();
  for (const d of bodies) {
    const m = partMass(d), c = centre(d);
    S.set(d, {d, w: d.heldBy ? 0 : 1 / m, iw: d.heldBy ? 0 : 1 / inertia(d, m), c, x: add(d.position, rotate(c, d.quaternion)), q: [...d.quaternion], x0: null, q0: null});
  }
  const joints = bodies.filter(d => d.joint && S.has(byId.get(d.joint.to)));
  for (let s = 0; s < SUB; s++) {
    for (const b of S.values()) {
      b.x0 = [...b.x]; b.q0 = [...b.q]; b.v0 = [...b.d.velocity]; b.w0 = len(b.d.angularVelocity); b.deep = false;
      if (!b.w) {b.x = add(b.d.position, rotate(b.c, b.d.quaternion)); b.q = [...b.d.quaternion]; continue;}
      const v = b.d.velocity; v[1] -= G * h;
      b.x = add(b.x, [v[0] * h, v[1] * h, v[2] * h]);
      const om = b.d.angularVelocity; b.q = spin(b.q, [om[0] * h, om[1] * h, om[2] * h]);
    }
    for (let it = 0; it < ITER; it++) {
      for (const d of joints) {
        const A = S.get(byId.get(d.joint.to)), B = S.get(d);
        const rA = rotate(sub(d.joint.a, A.c), A.q), rB = rotate(sub(d.joint.b, B.c), B.q);
        const delta = sub(add(A.x, rA), add(B.x, rB)), c = len(delta); if (c < 1e-6) continue;
        positional(A, B, rA, rB, delta.map(v => v / c), c);
        // No-fold: a limb's middle keeps its distance from the ribcage's middle, so a skull or a leg
        // can swing at its joint but never fold through the torso (bones do not interpenetrate).
        // An arm hangs close beside the ribs, so it may come nearer the ribcage's middle than a leg or skull.
        const min = (d.part.endsWith('Arm') ? FOLD_ARM : FOLD) * (len(sub(d.joint.a, A.c)) + len(sub(B.c, d.joint.b))), gap = sub(B.x, A.x), g = len(gap);
        if (g < min && g > 1e-6) {
          // A pose that starts folded (an arm hanging close beside the ribs) eases open instead of springing apart.
          const folded = len(sub(B.x0, A.x0)) < min - .01;
          positional(A, B, [0, 0, 0], [0, 0, 0], gap.map(v => v / g), folded ? Math.min(min - g, .004) : min - g);
        }
      }
      for (const b of S.values()) if (b.w) contacts(state, ctx, b);
    }
    for (const b of S.values()) {
      if (!b.w) continue;
      b.d.velocity = sub(b.x, b.x0).map(v => clamp(v / h, -60, 60));
      const dq = mulInv(b.q, b.q0), sign = dq[3] < 0 ? -1 : 1;
      b.d.angularVelocity = [dq[0], dq[1], dq[2]].map(v => clamp(2 * v * sign / h, -28, 28));
      // Pushing a bone that started inside the ground back out is a correction, not a kick: without this a limb
      // that came off with its foot planted a few centimetres deep would be fired into the sky.
      if (b.deep) {
        const dv = sub(b.d.velocity, b.v0), n = len(dv); if (n > DEPEN) b.d.velocity = add(b.v0, dv.map(v => v * DEPEN / n));
        const w = len(b.d.angularVelocity), cap = b.w0 + DEPEN * 2; if (w > cap) b.d.angularVelocity = b.d.angularVelocity.map(v => v * cap / w);
      }
      // Air and bone friction: a dead joint is stiff, so each limb gives up some spin to its torso.
      b.d.velocity = b.d.velocity.map(v => v * (1 - .2 * h));
      b.d.angularVelocity = b.d.angularVelocity.map(v => v * (1 - (b.d.joint ? 2.6 : 1.2) * h));
    }
  }
  for (const b of S.values()) {
    const d = b.d; if (!b.w) continue;
    d.quaternion = b.q; d.position = sub(b.x, rotate(b.c, b.q)); [d.position[0], d.position[2]] = clampToWorld(d.position[0], d.position[2], 54.5); d.position[1] = clamp(d.position[1], -150, 150);
    const still = len(d.velocity) < SLEEP_V && len(d.angularVelocity) < SLEEP_W && state.tick - d.bornTick > 20;
    d.rest = still ? Math.min(SLEEP_TICKS, (d.rest || 0) + 1) : 0;
    if (d.rest >= SLEEP_TICKS) {d.velocity = [0, 0, 0]; d.angularVelocity = [0, 0, 0];}
  }
  // A ragdoll sleeps only as a whole: a part still swinging keeps its partners awake.
  for (const d of joints) {const t = byId.get(d.joint.to); if ((d.rest >= SLEEP_TICKS) !== (t.rest >= SLEEP_TICKS)) {if (d.rest >= SLEEP_TICKS) d.rest = SLEEP_TICKS - 1; if (t.rest >= SLEEP_TICKS) t.rest = SLEEP_TICKS - 1;}}
}
function mulInv(a, b) { // a * b^-1
  const [x, y, z, w] = a, [bx, by, bz, bw] = [-b[0], -b[1], -b[2], b[3]];
  return [w * bx + x * bw + y * bz - z * by, w * by - x * bz + y * bw + z * bx, w * bz + x * by - y * bx + z * bw, w * bw - x * bx - y * by - z * bz];
}
// Move bodies A and B (A may be null: the world) so the points A.x+rA and B.x+rB close by `c` along n.
function positional(A, B, rA, rB, n, c, sign = 1) {
  const cA = A ? cross(rA, n) : null, cB = cross(rB, n);
  const wA = A ? A.w + A.iw * dot(cA, cA) : 0, wB = B.w + B.iw * dot(cB, cB), W = wA + wB; if (W < 1e-9) return 0;
  const lambda = c / W, p = n.map(v => v * lambda * sign);
  if (A && A.w) {A.x = sub(A.x, p.map(v => v * A.w)); A.q = spin(A.q, cross(rA, p).map(v => -v * A.iw));}
  if (B.w) {B.x = add(B.x, p.map(v => v * B.w)); B.q = spin(B.q, cross(rB, p).map(v => v * B.iw));}
  return lambda;
}
const CORNERS = [];
for (const i of [0, 1]) for (const j of [0, 1]) for (const k of [0, 1]) CORNERS.push([i, j, k]);
function contacts(state, ctx, b) {
  const bx = box(b.d);
  for (const [i, j, k] of CORNERS) {
    const local = [i ? bx.max[0] : bx.min[0], j ? bx.max[1] : bx.min[1], k ? bx.max[2] : bx.min[2]].map((v, a) => v - b.c[a]);
    const r = rotate(local, b.q), p = add(b.x, r), ground = ctx.terrainHeight(state, p[0], p[2]), depth = ground - p[1];
    if (depth <= 0) continue;
    if (ground - add(b.x0, rotate(local, b.q0))[1] > .01) b.deep = true; // this corner was already buried
    const e = .12, gx = ctx.terrainHeight(state, p[0] + e, p[2]) - ground, gz = ctx.terrainHeight(state, p[0], p[2] + e) - ground;
    const n0 = [-gx / e, 1, -gz / e], nl = len(n0), n = n0.map(v => v / nl), pen = depth * n[1];
    const lambda = positional(null, b, null, r, n, pen);
    // Static friction (position level): undo this substep's sliding of the contact point, up to mu * push.
    const prev = add(b.x0, rotate(local, b.q0)), now = add(b.x, rotate(local, b.q)), slide = sub(now, prev), along = dot(slide, n);
    const tangent = slide.map((v, a) => v - n[a] * along), tl = len(tangent);
    if (tl > 1e-7 && lambda > 0) positional(null, b, null, rotate(local, b.q), tangent.map(v => -v / tl), Math.min(tl, MU * pen));
  }
}
