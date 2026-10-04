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
function aim(rec, dir, weight, rootQ, sweep = null) {
  if (!rec?.restDir || !(weight > 1e-4)) return;
  const node = rec.node;
  node.updateWorldMatrix(true, false);
  _qi.copy(rootQ).invert();
  _qa.copy(_qi).multiply(node.getWorldQuaternion(_q));                       // current actor-relative orientation
  _a.copy(rec.restDir).applyQuaternion(_q2.copy(rec.restRel).invert()).applyQuaternion(_qa).normalize();
  _b.copy(dir).normalize();
  _qd.setFromUnitVectors(_a, _b); if (sweep) _qd.premultiply(sweep);
  _qd.slerp(_q.identity(), 1 - clamp(weight, 0, 1));
  _q2.copy(rootQ).multiply(_qd).multiply(_qa);                                 // desired world orientation
  node.parent.getWorldQuaternion(_q); node.quaternion.copy(_q.invert().multiply(_q2)).normalize();
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

  // ---- pelvis (rig Root joint): drop, bob, sway, roll, yaw
  if (N.root) {
    const bob = .028 * sc * w * (.5 + .5 * Math.cos(phase * TAU * 2)) * (1 + style * .4);
    const drop = Math.min(sig.drop * legLen, legLen * .88) + bob + (coil * .03 + strike * .05 + g * .03) * sc;
    _v.copy(aU).multiplyScalar(-drop).addScaledVector(aR, sig.sideShift + Math.sin(phase * TAU) * .022 * sc * w).addScaledVector(aF, sig.lunge + strike * .06 * sc);
    offsetWorld(N.root.node, _v);
    turn(N.root, 1, .1 * (fwdR - fwdL) * .5 * (1 - g * .5));
    turn(N.root, 2, -.045 * Math.sin(phase * TAU) * w + sig.bodyRoll);
    if (legsGone) turn(N.root, 0, -.5);
  }
  // ---- spine
  if (N.torso) {
    const lean = sig.torsoPitch + .07 * w + style * .12 * w + g * .12 + strike * .1;
    turn(N.torso, 0, -lean);
    turn(N.torso, 1, sig.torsoYaw - .07 * (fwdR - fwdL) * .5 + (N.armR ? N.armR.side : -1) * (.38 * coil - .42 * strike));
    turn(N.torso, 2, -sig.torsoRoll + .03 * Math.sin(phase * TAU) * w);
  }
  // ---- head and jaw: the head stays level against the stride, looks about at idle, tucks behind a raised shield
  if (N.head && !missing.head) {
    turn(N.head, 1, sig.headYaw + .06 * (fwdR - fwdL) * .5);
    turn(N.head, 0, sig.headPitch * -1 + .05 * w + g * .14 - coil * .08 + strike * .06 + Math.cos(phase * TAU * 2) * .025 * w);
    turn(N.head, 2, -sig.headRoll);
  }
  if (N.jaw && !missing.head) {
    const chatter = Math.max(0, Math.sin(t * 1.3 + tr.breathPhase) - .82) / .18;
    const clack = chatter * (.5 + .5 * Math.sin(t * 34)) * .16;
    const gape = coil * .42 + strike * .22 + Math.abs(env.recoilValue) * .25 + .03 + .02 * Math.sin(t * tr.breathHz * TAU);
    turn(N.jaw, 0, -(gape + clack));
  }
  // ---- arms
  const swing = (side) => side > 0 ? fwdL : fwdR; // arms swing with the opposite leg
  const shield = N.armL, claw = N.armR;
  if (shield && !missing.leftArm) {
    const s = shield.side;
    const relaxed = .06 + .12 * swing(s) + Math.sin(t * tr.breathHz * TAU) * .015;
    turn(shield, 0, mix(relaxed + sig.armSwingL, .62, g));
    turn(shield, 2, s * mix(.1 + .03 * w, -.38, g));
    turn(N.foreL, 0, mix(.32 + .08 * w, 1.25, g));
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
    turn(claw, 0, .04 + .38 * swing(s) + sig.armSwingR + sig.armR * .6 + ready * .45);
    turn(claw, 2, s * (.08 + ready * .12));
    turn(N.foreR, 0, .28 + .18 * Math.max(0, swing(s)) * w + ready * .9);
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
  // Legless: haul the body along on the arms.
  if (legsGone) {
    const pull = Math.sin(phase * TAU * 2);
    if (shield && !missing.leftArm) { turn(shield, 0, 1.3 + .5 * pull); turn(N.foreL, 0, -.4); }
    if (claw && !missing.rightArm) { turn(claw, 0, 1.3 - .5 * pull); turn(N.foreR, 0, -.4); }
  }
}

// Foot targets: stride-locked gait while walking, planted feet with little re-squaring steps at idle.
export function placeFeet(st, env) {
  const {aR, aF, rootPos, height, dt, teleport, walk: w, phase} = env;
  const sc = st.legScale || 1, span = (st.legLenRest || .78) * SKELETON_STRIDE * SKELETON_STANCE * .5;
  const groundY = rootPos.y;
  let stepping = st.legs.some(l => l.step);
  for (const leg of st.legs) {
    if (!leg.active) { leg.locked = false; leg.step = null; continue; }
    footCycle(phase + (leg.side > 0 ? 0 : .5), fc);
    // Gait target in world.
    const gx = leg.rest.x, gz = -leg.rest.z + fc.fwd * span * w; // (right, forward)
    const gwx = rootPos.x + aR.x * gx + aF.x * gz, gwz = rootPos.z + aR.z * gx + aF.z * gz;
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
    const lift = mix(ilift, fc.lift * .11 * sc, smooth(w));
    leg.toe = mix(itoe, fc.toe, smooth(w));
    const gy = height ? height(tx, tz) : NaN, legLen = leg.a + leg.b;
    const ground = Number.isFinite(gy) && Math.abs(gy - groundY) < .4 * legLen ? gy : groundY;
    leg.target.set(tx, ground + leg.ankleH + lift, tz);
    leg.lift = lift;
  }
}

// Foot world orientation: rest orientation in actor space, pitched heel-toe about the actor's right axis.
export function orientFoot(leg, rootQ, aRworld) {
  const foot = leg.foot.node;
  _q2.copy(rootQ).multiply(leg.foot.restRel);                         // rest world orientation
  _q.setFromAxisAngle(aRworld, leg.toe || 0); _q2.premultiply(_q);     // toe up (+) / down (-)
  foot.parent.getWorldQuaternion(_q); foot.quaternion.copy(_q.invert().multiply(_q2));
}
