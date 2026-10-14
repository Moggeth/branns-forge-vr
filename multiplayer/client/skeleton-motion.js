import * as THREE from 'three';

// Procedural skeleton body (warband rig, assets/skeleton-warband-20261004): stride-locked walk with heel-toe feet,
// pelvis bob/sway, counter-swinging arms, a relaxed shield carry that comes up to a guard, a cocked claw swipe,
// a chattering jaw, turn-in-place stepping and a legless crawl. Driven by enemy-motion.js after its shared
// signals (personality, recoil, hobble) are computed; everything is presentation-only and never touches entry.root.
//
// Rotations are FK about each joint's REST axes expressed in actor space (x right, y up, z back), measured from the
// GLB at build time, so no bone-local axis convention is assumed. "+x" raises a hanging limb forward and tips an
// upright one back; "+y" turns left; "+z" swings a hanging limb toward actor-right.

export const SKELETON_STRIDE = 1.85; // gait cycle (left + right step) in leg lengths
export const SKELETON_STANCE = .58;  // fraction of the cycle each foot is planted
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _rq = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

// Called once per state: rest-relative axes and sides, rest foot placement.
export function rigSkeleton(st, root) {
  root.updateWorldMatrix(true, true);
  root.getWorldQuaternion(_rq); const inv = _rq.clone().invert();
  const rootPos = root.getWorldPosition(new THREE.Vector3());
  for (const rec of st.tracked) {
    const restRel = inv.clone().multiply(rec.node.getWorldQuaternion(_q));
    const back = restRel.clone().invert();
    rec.ax = [X.clone().applyQuaternion(back), Y.clone().applyQuaternion(back), Z.clone().applyQuaternion(back)];
    rec.restRel = restRel;
    rec.restPos = rec.node.getWorldPosition(new THREE.Vector3()).sub(rootPos).applyQuaternion(inv); // actor-space offset
  }
  const N = st.nodes;
  for (const k of ['armL', 'armR']) if (N[k]) N[k].side = Math.sign(N[k].restPos.x) || 1;
  for (const [a, b] of [['armL', 'foreL'], ['foreL', 'handL'], ['armR', 'foreR'], ['foreR', 'handR']]) if (N[a] && N[b]) N[a].restDir = N[b].restPos.clone().sub(N[a].restPos).normalize();
  for (const leg of st.legs) {
    leg.side = Math.sign(leg.thigh.restPos.x) || 1;
    leg.rest = leg.foot.restPos.clone();   // actor-space ankle at rest (x right, y up, z back)
    leg.lockW = 0; leg.locked = false; leg.step = null; leg.lock.set(0, 0, 0);
  }
  st.legScale = st.legs.length ? st.legs.reduce((s, l) => s + l.thigh.restPos.y, 0) / st.legs.length / .86 : 1; // hip height vs authored .86
  st.skel = true;
}

// Swing a limb segment (rest direction rec.restDir) toward an actor-space direction, by weight.
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _qa = new THREE.Quaternion(), _qd = new THREE.Quaternion(), _qi = new THREE.Quaternion();
// With `sweep` (an actor-space rotation) the segment is first aimed at `dir`, then carried by `sweep`: a
// swing far past the segment's own axis then follows one continuous arc instead of a re-solved shortest one.
const matrixPosition = new THREE.Vector3(), matrixScale = new THREE.Vector3();
function aim(rec, dir, weight, rootQ, sweep = null) {
  if (!rec?.restDir || !(weight > 1e-4)) return;
  const node = rec.node;
  node.updateWorldMatrix(true, false);
  _qi.copy(rootQ).invert();
  node.matrixWorld.decompose(matrixPosition, _q, matrixScale);
  _qa.copy(_qi).multiply(_q);                       // current actor-relative orientation
  _a.copy(rec.restDir).applyQuaternion(_q2.copy(rec.restRel).invert()).applyQuaternion(_qa).normalize();
  _b.copy(dir).normalize();
  _qd.setFromUnitVectors(_a, _b); if (sweep) _qd.premultiply(sweep);
  _qd.slerp(_q.identity(), 1 - clamp(weight, 0, 1));
  _q2.copy(rootQ).multiply(_qd).multiply(_qa);                                 // desired world orientation
  node.parent.matrixWorld.decompose(matrixPosition, _q, matrixScale); node.quaternion.copy(_q.invert().multiply(_q2)).normalize();
}
const _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3();
const _s1 = new THREE.Vector3(), _sq = new THREE.Quaternion();
// Actor-space rotation carrying unit direction `from` a fraction u of the way to (x, y, z).
function sweepTo(from, x, y, z, u) {
  _s1.set(x, y, z).normalize();
  return _sq.setFromUnitVectors(from, _s1).slerp(_q.identity(), 1 - u);
}

function turn(rec, axis, angle) {
  if (!rec || !angle) return;
  rec.node.quaternion.multiply(_q.setFromAxisAngle(rec.ax[axis], angle)).normalize();
}

// Gait sample for one leg at cycle phase p: forward offset (fraction of half step span), lift (0..1), toe pitch.
export function footCycle(p, out = {fwd: 0, lift: 0, toe: 0, stance: true}) {
  p = ((p % 1) + 1) % 1;
  const b = SKELETON_STANCE;
  if (p < b) {
    const u = p / b;
    out.fwd = 1 - 2 * u; out.lift = 0; out.stance = true;
    out.toe = u < .16 ? .28 * (1 - u / .16) : u > .7 ? -.42 * smooth((u - .7) / .3) : 0; // heel strike, flat, heel rise
  } else {
    const u = (p - b) / (1 - b), e = u * u * (3 - 2 * u);
    out.fwd = -1 + 2 * e; out.stance = false;
    out.lift = Math.sin(Math.PI * Math.min(1, u * 1.08)) ** .85;
    out.toe = u < .35 ? -.42 * (1 - u / .35) : u > .72 ? .3 * smooth((u - .72) / .28) : .06;
  }
  return out;
}
const fc = {fwd: 0, lift: 0, toe: 0, stance: true}, fcO = {fwd: 0, lift: 0, toe: 0, stance: true};

// ---- per-skeleton gait: no two warband members walk alike, and a column of them never falls into step.
const h01 = (seed, n) => { let h = Math.imul(seed ^ Math.imul(n + 7, 0x9e3779b1), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
const range = (seed, n, a, b) => a + (b - a) * h01(seed, n);
// kind: warband archetype index (shared/skeleton-kinds.js). Old Bones (3) mostly limp; Rustguard (1) marches.
// Each archetype walks like who it is (multipliers on the per-skeleton spread below; 1 = neutral).
//  Mossward: easy rolling plod. Rustguard: crisp parade march, knees up, chin up. Thornhood: low sneaky prowl, short quick steps.
//  (chin: head tipped back, i.e. eyes up; armOut: elbows out while walking; hop: a skip on each step.)
//  Old Bones: stooped shuffle, feet barely leave the ground. Bloomcaller: bouncy skip with arms out. Antlerbound: proud chest-out strut.
export const KIND_GAIT = [
  {stride: 1, lift: .95, bob: 1.1, sway: 1.35, lean: 0, swagger: 1, armSwing: 1, hop: 0, crouch: 0, chin: 0, armOut: .04},
  {stride: 1.02, lift: 1.4, bob: .8, sway: .6, lean: -.05, swagger: .6, armSwing: .9, hop: 0, crouch: 0, chin: .1, armOut: 0},
  {stride: .84, lift: .85, bob: .55, sway: .8, lean: .16, swagger: .7, armSwing: .6, hop: 0, crouch: .07, chin: .12, armOut: .12},
  {stride: .82, lift: .55, bob: .7, sway: 1.2, lean: .1, swagger: .8, armSwing: .6, hop: 0, crouch: .03, chin: -.02, armOut: 0},
  {stride: 1.04, lift: 1.25, bob: .9, sway: 1, lean: .02, swagger: 1.2, armSwing: 1.35, hop: 1, crouch: .03, chin: .06, armOut: .22},
  {stride: 1.12, lift: 1.05, bob: .8, sway: .9, lean: -.08, swagger: 1.7, armSwing: 1.1, hop: 0, crouch: 0, chin: .14, armOut: .08},
  // Forgeling (Dawnhold's stone-and-brass troops, FORGELING_GAIT): a steady, sure-footed drill step, in good order.
  {stride: .96, lift: 1.2, bob: .7, sway: .7, lean: .03, swagger: .5, armSwing: 1.05, hop: 0, crouch: .02, chin: .05, armOut: .05},
];
export const FORGELING_GAIT = 6;
export function gaitProfile(seed, kind = 0) {
  const limping = kind !== FORGELING_GAIT && h01(seed, 9) < (kind === 3 ? .7 : .14), K = KIND_GAIT[kind] || KIND_GAIT[0];
  return {kindGait: K, hop: K.hop, crouch: K.crouch, chin: K.chin, armOut: K.armOut,
    phase0: h01(seed, 1),                         // where in its stride it starts
    stride: range(seed, 2, .88, 1.13) * K.stride,            // step length (and so cadence at the same speed)
    drift: range(seed, 3, .025, .06),             // slow stride wander: identical walkers still drift apart
    armSwing: range(seed, 4, .7, 1.3) * K.armSwing,
    bob: range(seed, 5, .7, 1.4) * K.bob, sway: range(seed, 6, .6, 1.4) * K.sway, lift: range(seed, 7, .85, 1.25) * K.lift,
    lean: range(seed, 8, -.03, .08) + K.lean, nod: range(seed, 10, .4, 1.6), swagger: range(seed, 11, .6, 1.4) * K.swagger,
    toeOut: range(seed, 12, -.04, .16), elbow: range(seed, 13, .75, 1.35), headCock: range(seed, 14, -.12, .12),
    limp: limping ? range(seed, 15, .3, .65) : 0, limpSide: h01(seed, 16) < .5 ? -1 : 1,
  };
}

// ---- idle fidgets: every few seconds an idle skeleton does something small and odd, now and then something odder.
const FIDGETS = {
  yawn: 2.4, scratch: 2.6, look: 3, rattle: 1.4, knock: 2.4, jawdrop: 2.6, neck: 1.8, stretch: 2.6, fingers: 2.4, spin: 2.2,
};
// Weights per archetype (shared/skeleton-kinds.js order): personality in what they fidget with.
const FIDGET_WEIGHTS = [
  {yawn: 2, scratch: 3, look: 3, rattle: 1, knock: 1, jawdrop: 1, neck: 2, stretch: 2, fingers: 2},            // Mossward: scratches its moss
  {yawn: 1, scratch: 1, look: 3, rattle: 1, knock: 4, jawdrop: 1, neck: 3, stretch: 2, fingers: 1},            // Rustguard: drums on its shield
  {yawn: 1, scratch: 1, look: 4, rattle: 2, knock: 1, jawdrop: 1, neck: 2, stretch: 1, fingers: 3},            // Thornhood: watchful, picks at its claws
  {yawn: 3, scratch: 2, look: 1, rattle: 3, knock: 1, jawdrop: 4, neck: 3, stretch: 1, fingers: 1},            // Old Bones: falls apart a little
  {yawn: 2, scratch: 1, look: 3, rattle: 1, knock: 1, jawdrop: 1, neck: 1, stretch: 4, fingers: 2},            // Bloomcaller: stretches in the sun
  {yawn: 1, scratch: 4, look: 3, rattle: 1, knock: 2, jawdrop: 1, neck: 3, stretch: 1, fingers: 1},            // Antlerbound: scratches round its antlers
];
function pickFidget(seed, n, kind) {
  if (h01(seed, 500 + n) < .06) return 'spin';                               // rare: the skull turns all the way round
  const w = FIDGET_WEIGHTS[kind] || FIDGET_WEIGHTS[0], total = Object.values(w).reduce((a, b) => a + b, 0);
  let r = h01(seed, 600 + n) * total;
  for (const [k, v] of Object.entries(w)) if ((r -= v) < 0) return k;
  return 'look';
}
// Studios: start a named fidget now (st from enemyMotionState).
export function forceFidget(st, type, t) { if (!FIDGETS[type]) return false; st.fidget = {n: (st.fidget?.n || 0) + 1, type, start: t, next: t + 99, w: 1}; return true; }
export const FIDGET_NAMES = Object.keys(FIDGETS);
const bell = (u, a, b) => smooth((u - a) / .14) * (1 - smooth((u - b) / .16));
// Advance the fidget clock; returns {type, u, w} or null. idle: 0..1 how idle the skeleton is now.
function fidgetFor(st, t, idle, seed, kind) {
  const f = st.fidget ||= {n: 0, type: null, start: 0, next: t + range(seed, 700, 2, 7), w: 0};
  if (f.type) {
    const u = (t - f.start) / FIDGETS[f.type];
    if (u >= 1 || u < 0) { f.type = null; f.next = t + range(seed, 800 + f.n, 4, 11); }
  }
  if (!f.type && t >= f.next && idle > .9) { f.type = pickFidget(seed, f.n++, kind); f.start = t; }
  if (!f.type) { if (t >= f.next) f.next = t + 1.5; return null; }
  f.w = idle; // any call to action (a Hero steps up, a hit) drops the fidget at once
  return {type: f.type, u: (t - f.start) / FIDGETS[f.type], w: idle};
}

// env: {sig, attack, recoilValue, missing, t, dt, teleport, aR, aU, aF, rootQ, rootPos, height, guard, walk, phase, traits}
export function poseSkeletonBody(st, env, offsetWorld, solveLeg) {
  const N = st.nodes, {sig, attack, missing, t, aR, aU, aF, walk: w} = env, tr = env.traits;
  const coil = attack.coil, strike = attack.strike, g = env.guard;
  const legLen = st.legLenRest || .78, sc = st.legScale || 1;
  const phase = env.phase;
  const legsGone = missing.leftLeg && missing.rightLeg;
  // Per-leg forward signal (-1 back .. 1 front) drives pelvis yaw and arm swing.
  const fwdBy = {}; for (const leg of st.legs) { footCycle(phase + (leg.side > 0 ? 0 : .5), fc); fwdBy[leg.side] = fc.fwd * w; }
  const fwdR = fwdBy[1] || 0, fwdL = fwdBy[-1] || 0;
  const style = tr.gaitStyle || 0; // 0 brisk .. 1 shambling
  const P = st.gaitP ||= gaitProfile(tr.seed || 0, env.kind || 0);
  // Limp: the bad leg's stance dips the pelvis toward it.
  let dip = 0;
  if (P.limp) { footCycle(phase + (P.limpSide > 0 ? 0 : .5), fcO); dip = fcO.stance ? 1 - fcO.fwd * fcO.fwd : 0; }
  const fl = env.flinch >= 0 ? env.flinch : -1, flinch = fl >= 0 ? smooth(fl / .1) * (1 - smooth((fl - .35) / .65)) : 0;
  // Notice: the moment a Hero steps up it startles: a little hop, jaw agape, elbows flung out, then it squares up.
  const nu = env.notice >= 0 ? env.notice : -1, startle = nu >= 0 ? smooth(nu / .12) * (1 - smooth((nu - .3) / .45)) : 0;
  const crouchNotice = nu >= 0 ? smooth((nu - .35) / .2) * (1 - smooth((nu - .7) / .3)) : 0; // ...then a ready crouch

  // ---- pelvis (rig Root joint): drop, bob, sway, roll, yaw
  if (N.root) {
    const bob = .028 * sc * w * (.5 + .5 * Math.cos(phase * TAU * 2)) * (1 + style * .4) * P.bob;
    const drop = Math.min(sig.drop * legLen, legLen * .88) + bob + (coil * .03 + strike * .05 + g * .03) * sc + P.limp * .05 * sc * w * dip + flinch * .05 * sc
      + P.crouch * legLen * (.45 + .55 * w) + crouchNotice * .08 * sc - (env.hopLift || 0);
    _v.copy(aU).multiplyScalar(-drop).addScaledVector(aR, sig.sideShift + Math.sin(phase * TAU) * .022 * sc * w * P.sway).addScaledVector(aF, sig.lunge + strike * .06 * sc - flinch * .09 * sc);
    offsetWorld(N.root.node, _v);
    turn(N.root, 1, .1 * (fwdR - fwdL) * .5 * (1 - g * .5) * P.swagger);
    turn(N.root, 2, -.045 * Math.sin(phase * TAU) * w * P.sway + sig.bodyRoll + P.limpSide * P.limp * .09 * dip * w);
    if (legsGone) turn(N.root, 0, -.5);
  }
  // ---- spine
  if (N.torso) {
    const lean = sig.torsoPitch + .07 * w + style * .12 * w + P.lean * w + g * .12 + strike * .1 - flinch * .42 - startle * .18 + crouchNotice * .12;
    turn(N.torso, 0, -lean);
    turn(N.torso, 1, sig.torsoYaw - .07 * (fwdR - fwdL) * .5 + (N.armR ? N.armR.side : -1) * (.38 * coil - .42 * strike));
    turn(N.torso, 2, -sig.torsoRoll + .03 * Math.sin(phase * TAU) * w + (env.lagR || 0) * .8);
    turn(N.torso, 0, -(env.lagF || 0) * .9);                                                   // inertia: rocks back on a start, pitches on through a stop
    turn(N.torso, 1, (env.lookYaw || 0) * .25 * (1 - Math.max(coil, strike)));
  }
  // ---- head and jaw: the head stays level against the stride, looks about at idle, tucks behind a raised shield
  if (N.head && !missing.head) {
    const sh = N.armL ? N.armL.side : 1, look = fl >= 0 ? smooth((fl - .25) / .2) * (1 - smooth((fl - .75) / .25)) : 0;
    turn(N.head, 1, sig.headYaw + .06 * (fwdR - fwdL) * .5 + sh * (.25 * flinch + .75 * look));   // looks to the empty shield hand
    turn(N.head, 0, sig.headPitch * -1 + .05 * w + g * .14 - coil * .08 + strike * .06 + Math.cos(phase * TAU * 2) * .025 * w * P.nod - flinch * .35 + look * .3);
    turn(N.head, 2, -sig.headRoll + P.headCock * (1 - w * .5));
    const attend = 1 - Math.max(coil, strike) * .7;                                              // keeps the Hero in view, over its shoulder if need be
    turn(N.head, 1, (env.lookYaw || 0) * .75 * attend); turn(N.head, 0, (env.lookPitch || 0) * .8 * attend + (env.lagF || 0) * .5);
    turn(N.head, 0, P.chin * (.4 + .6 * w) + (P.lean + style * .12) * .5 * w + startle * .3);       // eyes up the road, not at the feet
  }
  if (N.jaw && !missing.head) {
    const chatter = Math.max(0, Math.sin(t * 1.3 + tr.breathPhase) - .82) / .18;
    const clack = chatter * (.5 + .5 * Math.sin(t * 34)) * .16;
    const gape = Math.max(0, -(env.lagF || 0)) * .9 + coil * .42 + strike * .22 + Math.abs(env.recoilValue) * .25 + .03 + .02 * Math.sin(t * tr.breathHz * TAU) + flinch * .55 + startle * .7;
    turn(N.jaw, 0, -(gape + clack));
  }
  // ---- arms
  const swing = (side) => side > 0 ? fwdL : fwdR; // arms swing with the opposite leg
  const shield = N.armL, claw = N.armR;
  if (shield && !missing.leftArm) {
    const s = shield.side;
    const relaxed = .06 + .12 * swing(s) * P.armSwing + Math.sin(t * tr.breathHz * TAU) * .015;
    turn(shield, 0, mix(relaxed + sig.armSwingL + (env.lagF || 0) * 1.3, .62, g) - flinch * .75);                      // flinch: arm flung back where the shield burst
    turn(shield, 2, s * (mix(.1 + .03 * w + P.armOut * w, -.38, g) + flinch * .55 + startle * .5));
    turn(N.foreL, 0, mix((.32 + .08 * w) * P.elbow, 1.25, g) + flinch * .3);
    if (flinch > 0) turn(N.handL, 2, Math.sin(t * 31) * .5 * flinch * (1 - fl));               // shaking the sting out
    turn(N.handL, 0, .05 * (1 - g));
    // Guard: the arm brings the shield across the chest; the wrist squares it to the front, upright, top tipped back.
    if (g > .001 && N.handL) {
      const hand = N.handL.node;
      _q2.setFromAxisAngle(Y, s * (.95 + env.shieldYaw)).multiply(_q.setFromAxisAngle(X, .14)); // actor-space turn of the rest shield
      _q2.premultiply(env.rootQ).multiply(N.handL.restRel);                                       // desired hand world orientation
      hand.parent.updateWorldMatrix(true, false);
      hand.getWorldQuaternion(_q).slerp(_q2, smooth(g));
      hand.parent.getWorldQuaternion(_rq); hand.quaternion.copy(_rq.invert().multiply(_q));
    }
  }
  if (claw && !missing.rightArm) {
    const s = claw.side, ready = g * (1 - Math.max(coil, strike));
    turn(claw, 0, .04 + (env.lagF || 0) * 1.3 * (1 - ready) + .38 * swing(s) * P.armSwing + sig.armSwingR + sig.armR * .6 + ready * .45 + flinch * .5);
    turn(claw, 2, s * (.08 + ready * .12 + flinch * .45 + P.armOut * w * (1 - ready) + startle * .55));
    turn(N.foreR, 0, (.28 + .18 * Math.max(0, swing(s)) * w) * P.elbow + ready * .9);
    // Claw swipe: cock the arm high and back beside the skull, then rake down and across the front.
    const k = coil + strike;
    if (k > 1e-3) {
      // One even great-circle sweep from the cocked pose to the follow-through (no speed spike mid-swing):
      // u undoes the envelope's smoothstep so the arc is covered at constant speed.
      const u = .5 - Math.sin(Math.asin(clamp(1 - 2 * strike / k, -1, 1)) / 3);
      _c1.set(s * .55, .55, .62).normalize();
      const wgt = Math.min(1, k);
      aim(claw, _c1, wgt, env.rootQ, sweepTo(_c1, s * .05, -.3, -.95, u));
      turn(N.foreR, 0, wgt * (1.05 - .95 * u));                       // elbow hinge: folded when cocked, near straight on the rake
    }
    turn(N.handR, 0, -.35 * coil + .4 * strike);
  }
  // Idle fidgets (presentation only; any reason to act cancels them at once).
  const idleNow = (1 - w) * (1 - g) * (1 - Math.min(1, (coil + strike) * 4)) * (1 - Math.min(1, Math.abs(env.recoilValue) * 3)) * (fl >= 0 ? 0 : 1) * (1 - startle) * (legsGone || missing.head ? 0 : 1);
  st.idleW = (st.idleW ?? idleNow) + (idleNow - (st.idleW ?? idleNow)) * (idleNow < (st.idleW ?? 0) ? 1 : 1 - Math.exp(-(env.dt || 1 / 60) / .4));
  const fid = env.teleport ? null : fidgetFor(st, t, st.idleW, (tr.seed || 0) ^ 0x5f3759df, env.kind || 0);
  if (fid) fidget(st, N, fid, env, missing);
  // Legless: haul the body along on the arms.
  if (legsGone) {
    const pull = Math.sin(phase * TAU * 2);
    if (shield && !missing.leftArm) { turn(shield, 0, 1.3 + .5 * pull); turn(N.foreL, 0, -.4); }
    if (claw && !missing.rightArm) { turn(claw, 0, 1.3 - .5 * pull); turn(N.foreR, 0, -.4); }
  }
}

// Foot targets: stride-locked gait while walking, planted feet with little re-squaring steps at idle.
// Stance feet are pinned in the world (a turn or a curve never skates them); a swing foot flies from where it
// lifted to where the stride puts it down. Steps follow the travel direction, so backing off and side-steps step too.
export function placeFeet(st, env) {
  const {aR, aF, rootPos, height, dt, teleport, walk: w, phase} = env;
  const P = st.gaitP, sc = st.legScale || 1, legLen = st.legLenRest || .78, span = legLen * SKELETON_STRIDE * SKELETON_STANCE * .5 * (P?.stride || 1) * (env.strideK ?? 1);
  const groundY = rootPos.y, mdR = env.moveR ?? 0, mdF = env.moveF ?? 1;
  const ev = st.stepEvents ||= []; ev.length = 0;
  let stepping = st.legs.some(l => l.step);
  for (const leg of st.legs) {
    if (!leg.active) { leg.locked = false; leg.step = null; leg.plant = null; continue; }
    footCycle(phase + (leg.side > 0 ? 0 : .5), fc);
    // Gait target in world, relative to the body now.
    const gx = leg.rest.x + fc.fwd * span * w * mdR, gz = -leg.rest.z + fc.fwd * span * w * mdF; // (right, forward)
    let gwx = rootPos.x + aR.x * gx + aF.x * gz, gwz = rootPos.z + aR.z * gx + aF.z * gz;
    let turned = false;
    if (teleport || w < .05) { leg.plant = null; leg.from = null; leg.resid = null; }
    else if (fc.stance) {
      if (!leg.plant) { turned = !!leg.last; leg.plant = leg.last ? {x: leg.last.x, z: leg.last.z} : {x: gwx, z: gwz}; if (leg.wasSwing && w > .4) ev.push({type: 'step', side: leg.side > 0 ? 'right' : 'left', strength: w}); }
      // Held where it landed; only a hard pivot or a shove drags it back toward the stride (never past knee reach).
      const dx = leg.plant.x - gwx, dz = leg.plant.z - gwz, dev = Math.hypot(dx, dz), max = .42 * legLen;
      if (dev > max) { leg.plant.x = gwx + dx / dev * max; leg.plant.z = gwz + dz / dev * max; }
      gwx = leg.plant.x; gwz = leg.plant.z; leg.from = null;
    } else {
      if (!leg.from) { turned = !!leg.last; leg.from = leg.last ? {x: leg.last.x, z: leg.last.z} : leg.plant ? {x: leg.plant.x, z: leg.plant.z} : {x: gwx, z: gwz}; }
      leg.plant = null;
      const e = smooth((fc.fwd + 1) / 2);
      gwx = mix(leg.from.x, gwx, e); gwz = mix(leg.from.z, gwz, e);
    }
    // A gait reversal (the stride easing back to a planted pose) can enter a phase from its far end: any jump that
    // makes is carried as a residual that fades out in a few frames, so a foot never pops.
    if (leg.plant || leg.from) {
      const r = leg.resid ||= {x: 0, z: 0}, k = Math.exp(-(dt || 1 / 60) / .07);
      r.x *= k; r.z *= k;
      if (turned) { r.x += leg.last.x - (gwx + r.x); r.z += leg.last.z - (gwz + r.z); }
      if (leg.plant) { leg.plant.x += r.x; leg.plant.z += r.z; r.x = 0; r.z = 0; } // a planted foot simply stays where it is
      gwx += r.x; gwz += r.z;
      (leg.last ||= {x: 0, z: 0}).x = gwx; leg.last.z = gwz;
    } else leg.last = null;
    leg.wasSwing = !fc.stance;
    // Idle target: where the foot belongs under the body now.
    const rx = rootPos.x + aR.x * leg.rest.x - aF.x * leg.rest.z, rz = rootPos.z + aR.z * leg.rest.x - aF.z * leg.rest.z;
    if (!leg.locked || teleport) { leg.lock.set(rx, 0, rz); leg.locked = true; leg.step = null; }
    if (w > .05) { leg.lock.set(mix(leg.lock.x, gwx, smooth(w)), 0, mix(leg.lock.z, gwz, smooth(w))); leg.step = null; }
    else if (!leg.step && !stepping && Math.hypot(rx - leg.lock.x, rz - leg.lock.z) > .1 * sc) {
      leg.step = {fx: leg.lock.x, fz: leg.lock.z, tx: rx, tz: rz, u: 0}; stepping = true;
    }
    let ix = leg.lock.x, iz = leg.lock.z, ilift = 0, itoe = 0;
    if (leg.step) {
      const s = leg.step; s.u = Math.min(1, s.u + dt / .26); s.tx = rx; s.tz = rz;
      const e = smooth(s.u); ix = mix(s.fx, s.tx, e); iz = mix(s.fz, s.tz, e); ilift = Math.sin(Math.PI * s.u) * .06 * sc; itoe = -.2 * Math.sin(Math.PI * s.u);
      if (s.u >= 1) { leg.lock.set(s.tx, 0, s.tz); leg.step = null; }
    }
    const tx = mix(ix, gwx, smooth(w)), tz = mix(iz, gwz, smooth(w));
    const lift = mix(ilift, fc.lift * .11 * sc * (P?.lift || 1) * (P?.limp && leg.side === P.limpSide ? 1 - .6 * P.limp : 1), smooth(w));
    leg.toe = mix(itoe, fc.toe, smooth(w));
    const gy = height ? height(tx, tz) : NaN, chain = leg.a + leg.b;
    const ground = Number.isFinite(gy) && Math.abs(gy - groundY) < .4 * chain ? gy : groundY;
    leg.target.set(tx, ground + leg.ankleH + lift + (env.hopLift || 0), tz);
    leg.lift = lift;
  }
}

// Foot world orientation: rest orientation in actor space, pitched heel-toe about the actor's right axis.
export function orientFoot(leg, rootQ, aRworld, toeOut = 0) {
  const foot = leg.foot.node;
  _q2.copy(rootQ).multiply(leg.foot.restRel);                         // rest world orientation
  if (toeOut) _q2.premultiply(_q.setFromAxisAngle(Y, -leg.side * toeOut)); // splayed toes (actor up is world up)
  _q.setFromAxisAngle(aRworld, leg.toe || 0); _q2.premultiply(_q);     // toe up (+) / down (-)
  foot.parent.getWorldQuaternion(_q); foot.quaternion.copy(_q.invert().multiply(_q2));
}

// Fidget poses. u: 0..1 through the fidget; W: idle weight. All layered on top of the idle pose.
const _f = new THREE.Vector3();
function fidget(st, N, f, env, missing) {
  const u = f.u, W = f.w, t = env.t, claw = !missing.rightArm && N.armR, cs = N.armR ? N.armR.side : -1, ss = N.armL ? N.armL.side : 1;
  const env1 = smooth(u / .16) * (1 - smooth((u - .78) / .22)) * W;
  const jaw = a => N.jaw && turn(N.jaw, 0, -a * W), headRaw = (yaw, pitch, roll) => { if (N.head) { turn(N.head, 1, yaw); turn(N.head, 0, pitch); turn(N.head, 2, roll); } }, head = (yaw, pitch, roll) => headRaw(yaw * W, pitch * W, roll * W);
  switch (f.type) {
    case 'yawn': {
      const open = bell(u, .12, .62);
      jaw(.75 * open); head(0, -.38 * open, .08 * open); turn(N.torso, 0, .1 * open * W);
      if (claw) { turn(N.armR, 0, .35 * open * W); turn(N.foreR, 0, .8 * open * W); }
      if (u > .62 && u < .72) jaw(-.1 * Math.sin((u - .62) * 60));  // clack shut
      break;
    }
    case 'scratch': {
      if (claw) { aim(N.armR, _f.set(cs * .5, .85, -.25), env1, env.rootQ); turn(N.foreR, 0, 2.2 * env1); turn(N.handR, 0, Math.sin(t * 19) * .45 * bell(u, .25, .7)); turn(N.handR, 2, Math.sin(t * 13) * .25 * env1); }
      headRaw(.22 * cs * env1, .12 * env1, -.28 * cs * env1);
      break;
    }
    case 'look': {
      const yaw = 1.05 * (smooth((u - .05) / .2) - 2 * smooth((u - .4) / .22) + smooth((u - .8) / .17));
      head(yaw, -.08 * Math.abs(yaw), 0); if (N.torso) turn(N.torso, 1, yaw * .22 * W);
      if (Math.abs(u - .52) < .04) jaw(.2);
      break;
    }
    case 'rattle': {
      const r = bell(u, .05, .8);
      if (N.torso) { turn(N.torso, 2, Math.sin(t * 41) * .06 * r * W); turn(N.torso, 1, Math.sin(t * 37) * .05 * r * W); }
      head(Math.sin(t * 33) * .14 * r, Math.sin(t * 29) * .06 * r, 0); jaw(Math.abs(Math.sin(t * 30)) * .2 * r);
      if (claw) turn(N.armR, 2, Math.sin(t * 39) * .12 * r * W);
      if (N.armL && !missing.leftArm) turn(N.armL, 2, Math.sin(t * 35) * .1 * r * W);
      break;
    }
    case 'knock': {
      if (claw && !missing.leftArm && !env.shieldBroken) {
        aim(N.armR, _f.set(-cs * .62, -.28, -.74), env1, env.rootQ);
        const tap = u > .32 && u < .74 ? Math.max(0, Math.sin((u - .32) * 46)) : 0;
        turn(N.foreR, 0, (1.15 + .45 * tap) * env1);
        if (N.armL) turn(N.armL, 0, .3 * env1);
      }
      headRaw(-cs * .35 * env1, .28 * env1, 0);
      break;
    }
    case 'jawdrop': {
      const hang = u < .08 ? smooth(u / .08) : u < .6 ? 1 + .1 * Math.sin(u * 40) * (1 - u) : 1 - smooth((u - .6) / .05);
      jaw(.95 * hang); head(.1 * Math.sin(u * 22) * bell(u, .1, .5), .3 * bell(u, .05, .65), 0);
      if (claw) { const lift = bell(u, .38, .64); aim(N.armR, _f.set(cs * .22, .2, -.95), lift * W, env.rootQ); turn(N.foreR, 0, 2.05 * lift * W); }
      if (u > .6 && u < .66) head(0, -.25, 0); // snapped back into place
      break;
    }
    case 'neck': {
      const a = bell(u, .05, .4), b = bell(u, .45, .85);
      head(0, .05 * (a + b), .5 * ss * a - .5 * ss * b);
      if (Math.abs(u - .38) < .03 || Math.abs(u - .82) < .03) jaw(.15);
      break;
    }
    case 'stretch': {
      const up = bell(u, .1, .7);
      if (claw) { aim(N.armR, _f.set(cs * .45, .9, .1), up * W, env.rootQ); turn(N.foreR, 0, .3 * up * W); }
      if (N.armL && !missing.leftArm) turn(N.armL, 0, 1.2 * up * W);
      if (N.torso) turn(N.torso, 0, .2 * up * W); head(0, -.3 * up, 0); jaw(.35 * up);
      break;
    }
    case 'fingers': {
      if (claw) { aim(N.armR, _f.set(cs * .18, .25, -.95), env1, env.rootQ); turn(N.foreR, 0, 1.95 * env1); turn(N.handR, 1, Math.sin(t * 3.1) * .5 * env1); turn(N.handR, 0, Math.sin(t * 7) * .3 * env1); }
      headRaw(.12 * cs * env1, .32 * env1, .2 * cs * env1);
      break;
    }
    case 'spin': {
      // The skull turns a full circle on its neck, then carries on as if nothing happened.
      if (N.head) turn(N.head, 1, Math.PI * 2 * smooth((u - .12) / .62)); // always completes: a half-turned skull never snaps back
      if (N.jaw) turn(N.jaw, 0, -.25 * bell(u, .7, .9));
      break;
    }
  }
}
