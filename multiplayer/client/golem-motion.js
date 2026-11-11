import * as THREE from 'three';

// Geode golem body language (presentation only), layered by enemy-motion.js on the rigid golem.glb pieces.
// A big, patient, slightly dim stone guardian: it waddles with its weight rolling over each planted foot, stomps hard
// enough to jolt its own head, beats its chest when it first spots a Hero, knocks on its own head while it waits, and
// commits to its slam with a two-fisted overhead wind-up, a whole-body drive into the ground, fists stuck for a beat
// and a heave to pull them free. Everything is a pure function of the shared tick, the rendered root and the enemy id,
// so every peer sees the same golem; nothing feeds back into the simulation (strike damage stays at tick 18).
//
// Rig (verified from golem.glb): Golem > {ArmL > {ElbowL, ShoulderL, UpperArmL}, ArmR > ..., BodyCore, Head, LegL, LegR}.
// Every piece is a rigid sibling under `Golem`, so the torso does not carry the head or arms: this layer swings them
// about the BodyCore pivot itself, and pitches/rolls the body about the hips so planted feet stay planted.

export const GOLEM_CYCLE = 1.75, GOLEM_SWING = .44, GOLEM_HIP = 1.18;
const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const bell = (u, c, w) => { const d = (u - c) / w; return Math.exp(-d * d); };
function hash2(seed, n) {
  let h = Math.imul(seed ^ Math.imul(n | 0, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function noise1(seed, channel, t) {
  const i = Math.floor(t), f = t - i, s = seed + Math.imul(channel, 0x27d4eb2d);
  return mix(hash2(s, i), hash2(s, i + 1), smooth(f)) * 2 - 1;
}

// Idle fidgets on a seeded schedule: one slot every FIDGET_SLOT seconds, most of them used.
export const FIDGET_SLOT = 6.5, NOTICE_SECONDS = 1.7;
const FIDGETS = [['look', 2.8], ['knock', 2.2], ['shrug', 2.0], ['look', 2.8]];
export function golemFidget(seed, t, out = {type: null, u: 0, w: 0, side: 1}) {
  const k = t / FIDGET_SLOT + hash2(seed, 7), slot = Math.floor(k), into = (k - slot) * FIDGET_SLOT - .6;
  out.type = null; out.u = 0; out.w = 0;
  if (hash2(seed, slot * 3 + 1) > .78) return out;
  const [type, length] = FIDGETS[Math.floor(hash2(seed, slot * 3 + 2) * FIDGETS.length)];
  if (into < 0 || into > length) return out;
  out.type = type; out.u = into / length; out.side = hash2(seed, slot * 3 + 3) < .5 ? -1 : 1;
  out.w = smooth(out.u / .18) * smooth((1 - out.u) / .22);
  return out;
}

// Chest beat on first sight: three alternating thumps (left, right, left).
export const NOTICE_BEATS = [.3, .47, .64];

function zero(out) {
  out.bodyLift = 0; out.bodyShift = 0; out.bodyPitch = 0; out.bodyRoll = 0;
  out.torsoYaw = 0; out.torsoPitch = 0; out.torsoRoll = 0;
  out.headYaw = 0; out.headPitch = 0; out.headRoll = 0;
  out.raiseL = 0; out.raiseR = 0; out.spreadL = 0; out.spreadR = 0; out.elbowL = 0; out.elbowR = 0; out.twistL = 0; out.twistR = 0;
  out.legL = 0; out.legR = 0; out.pauldron = .62;
  return out;
}

const fid = {type: null, u: 0, w: 0, side: 1};
// Arm poses solved offline against golem.glb's real pivots (shoulder, elbow, fist): [raise, spread, elbow, twist].
// raise: forward; spread: + out to the side; twist: + turns the forearm in across the body.
export const ARM_POSES = Object.freeze({
  chest: [.02, .2, 1.66, 1.24],      // fist on the chest plate, elbow at its side
  wide: [.95, -.15, 1.35, -.6],      // wound out between beats, fist up by its ear
  knock: [2.4, -.77, .95, -.5],      // fist on top of its own head
  overhead: [2.6, -.57, .76, 0],     // both fists together above and behind the head
  slam: [.98, -.2, .12, 0],          // driven down in front
});
function addArm(out, isL, pose, k) {
  if (!k) return;
  if (isL) { out.raiseL += pose[0] * k; out.spreadL += pose[1] * k; out.elbowL += pose[2] * k; out.twistL += pose[3] * k; }
  else { out.raiseR += pose[0] * k; out.spreadR += pose[1] * k; out.elbowR += pose[2] * k; out.twistR += pose[3] * k; }
}
// s: {tr, t, attack:{coil,strike,impact,heave,phase}, recoil:{value,pushX,pushZ,part}, missing, walk, gait, notice, stomp, side}
// side: +1 when the authored L limbs are on the golem's actor right, -1 when on its left (read from the rig).
// Outputs are per AUTHORED limb (L = ArmL/LegL); body roll/shift are actor space (+ = toward actor right).
export function golemSignals(s, out) {
  zero(out);
  const {tr, t, attack, recoil, missing} = s, w = s.walk || 0, ph = s.gait || 0, sigma = s.side || 1;
  const {coil, strike, impact} = attack, heave = attack.heave || 0;
  const busy = Math.max(coil, strike, Math.abs(recoil.value)), calm = 1 - busy;

  // ---- idle: breath, a slow weight shift, arms hanging heavy with a little bend.
  const breath = Math.sin(t * tr.breathHz * TAU + tr.breathPhase);
  out.bodyLift += breath * .014 * (1 - w);
  out.raiseL -= breath * .03; out.raiseR -= breath * .03;
  out.torsoPitch += tr.slouch + breath * .012; out.headPitch -= breath * .006;
  out.headYaw += noise1(tr.seed, 1, t * tr.lookRate) * .2 * calm;
  out.headRoll += tr.headTilt + noise1(tr.seed, 2, t * tr.lookRate * .7) * .04 * calm;
  const lean = noise1(tr.seed, 11, t * .11) * (1 - w) * calm;
  out.bodyShift += lean * .05; out.bodyRoll += lean * .03;
  out.elbowL += .2; out.elbowR += .2; out.spreadL += .07; out.spreadR += .07;

  // ---- walk: rigid-leg scissor locked to distance, the weight rolling over the stance leg (a waddle that lifts the
  // swing foot), shoulders counter-twisting the hips, arms swinging late and heavy, and a jolt on every footfall.
  const sw = Math.sin(ph), cw = Math.cos(ph), swing = sw * GOLEM_SWING * w;
  out.legL += swing; out.legR -= swing;
  out.bodyLift -= (1 - Math.cos(swing)) * GOLEM_HIP;               // chord drop: both soles stay on the ground
  // cos(ph) > 0: the L leg swings forward, so the R leg carries the weight (and the R side is -sigma).
  out.bodyRoll += -sigma * cw * .085 * w; out.bodyShift += -sigma * cw * .07 * w;
  out.bodyPitch += (.08 + .03 * Math.abs(cw)) * w;
  out.torsoYaw += sw * .13 * w * sigma;                               // shoulders twist against the hips
  const late = Math.sin(ph - .55);
  out.raiseL -= late * .36 * w; out.raiseR += late * .36 * w;
  out.elbowL += Math.max(0, late) * .3 * w; out.elbowR += Math.max(0, -late) * .3 * w; // the forward arm bends a little
  out.spreadL += .06 * w; out.spreadR += .06 * w;
  out.headYaw -= sw * .09 * w * sigma; out.headRoll += -sigma * cw * .04 * w; out.headPitch -= .04 * w; // the head stays on target
  const stomp = s.stomp || 0;                                         // spring kicked on each footfall (<0 = squash)
  out.bodyLift += stomp * .045; out.headPitch -= stomp * .1; out.elbowL -= stomp * .12; out.elbowR -= stomp * .12;
  out.raiseL += stomp * .04; out.raiseR += stomp * .04;

  // ---- fidgets: only while standing calm.
  golemFidget(tr.seed, t, fid);
  const fw = fid.w * (1 - w) * calm * (s.notice >= 0 ? 0 : 1);
  if (fw > 0) {
    const u = fid.u, sideArmL = fid.side === sigma; // which authored arm is the fidget's side
    if (fid.type === 'look') {
      const sweep = Math.sin(u * Math.PI) * fid.side;
      out.headYaw += sweep * .85 * fw; out.torsoYaw += sweep * .28 * fw; out.headPitch -= Math.sin(u * TAU) * .08 * fw;
    } else if (fid.type === 'knock') {
      // A big fist comes up and raps the top of its own head twice, the head ducking a little on each knock.
      const tap = bell(u, .44, .045) + bell(u, .6, .045), reach = smooth((u - .08) / .25) * smooth((.95 - u) / .2);
      addArm(out, sideArmL, ARM_POSES.knock, reach * fw);
      if (sideArmL) out.raiseL -= tap * .2 * reach * fw; else out.raiseR -= tap * .2 * reach * fw; // lift off and rap
      out.headRoll += fid.side * .16 * reach * fw; out.headPitch += (.12 * reach + tap * .1) * fw; out.torsoRoll -= fid.side * .05 * reach * fw;
    } else if (fid.type === 'shrug') {
      // Shoulder roll: one big shoulder circles while the body leans into it.
      const a = u * TAU, env = Math.sin(u * Math.PI);
      const raise = (.32 + .22 * Math.sin(a)) * env, spread = .26 * Math.cos(a) * env;
      if (sideArmL) { out.raiseL += raise * fw; out.spreadL += spread * fw; } else { out.raiseR += raise * fw; out.spreadR += spread * fw; }
      out.torsoRoll += fid.side * .07 * env * fw; out.headRoll -= fid.side * .1 * env * fw; out.bodyShift += fid.side * .04 * env * fw;
    }
  }

  // ---- notice: rears up and beats its chest, left-right-left, head thrown back.
  if (s.notice >= 0) {
    const u = s.notice, env = smooth(u / .16) * smooth((1 - u) / .2), quiet = 1 - Math.max(coil, strike);
    const b = env * quiet;
    out.bodyPitch -= .2 * b; out.torsoPitch -= .1 * b; out.headPitch -= .38 * b; out.bodyLift += .05 * b;
    const beatL = bell(u, NOTICE_BEATS[0], .05) + bell(u, NOTICE_BEATS[2], .05), beatR = bell(u, NOTICE_BEATS[1], .05);
    const pose = (beat, isL) => { addArm(out, isL, ARM_POSES.wide, (1 - beat) * b); addArm(out, isL, ARM_POSES.chest, beat * b); }; // wound out wide, fist to the chest on a beat
    const actorLeftIsL = sigma < 0;
    pose(actorLeftIsL ? beatL : beatR, true); pose(actorLeftIsL ? beatR : beatL, false);
    out.torsoYaw += (beatL - beatR) * .08 * b; // the chest turns into each blow
  }

  // ---- slam: overhead double fist (arms in toward each other, elbows bent, leaning back), a whole-body drive down,
  // fists stuck in the ground for a beat, then a heave to pull them free.
  {
    for (const isL of [true, false]) { addArm(out, isL, ARM_POSES.overhead, coil); addArm(out, isL, ARM_POSES.slam, strike); }
    out.bodyPitch += -coil * .2 + strike * .56 - heave * .2;
    out.torsoPitch += -coil * .08 + strike * .16;
    out.bodyLift += coil * .06 - strike * .12 + impact * .06 + heave * .07;
    out.headPitch += coil * .14 - strike * .02 + impact * .14;
    out.legL += (coil + strike) * .2; out.legR -= (coil + strike) * .16;   // braced, staggered stance
    if (attack.phase === 'hold') { const q = noise1(tr.seed, 9, t * 22) * .05; out.raiseL += q; out.raiseR -= q; out.bodyLift += q * .3; } // straining tremble
    if (attack.phase === 'stuck') { const q = noise1(tr.seed, 10, t * 18) * .03 * strike; out.bodyRoll += q; out.torsoYaw += q; }
    if (heave) { const q = Math.sin(t * 34) * .07 * heave; out.raiseL += q; out.raiseR -= q; out.elbowL += heave * .25; out.elbowR += heave * .25; out.headRoll += q * .5; }
  }

  // ---- hit recoil, local to the struck part (dir = actor-space push: x right, z back).
  const r = recoil.value;
  if (r) {
    const back = recoil.pushZ * r, side = recoil.pushX * r, part = recoil.part;
    out.bodyPitch -= back * .26; out.bodyRoll += side * .16; out.bodyLift -= Math.abs(r) * .05; out.bodyShift += side * .06;
    out.headPitch -= back * .22; out.headRoll += side * .2;
    if (part === 'head') { out.headPitch -= back * .35; out.headYaw += side * .25; }
    else if (part === 'leftArm') { out.raiseL -= back * .55; out.spreadL += .2 * Math.abs(r); out.torsoYaw += side * .1 - back * .12 * sigma; }
    else if (part === 'rightArm') { out.raiseR -= back * .55; out.spreadR += .2 * Math.abs(r); out.torsoYaw += side * .1 + back * .12 * sigma; }
    else { out.torsoPitch -= back * .2; out.raiseL -= back * .25; out.raiseR -= back * .25; out.spreadL += Math.abs(r) * .12; out.spreadR += Math.abs(r) * .12; }
    out.legL -= Math.max(0, back) * .14; out.legR += Math.max(0, back) * .05;          // a stagger step back
  }

  // ---- missing limbs: lurch over a surviving leg, haul itself by the arms with none.
  const legL = missing.leftLeg, legR = missing.rightLeg;
  if (legL !== legR) {
    const limp = Math.abs(sw) * w, toward = (legL ? -sigma : sigma); // lean over the leg that is left
    out.bodyRoll = toward * (.12 + limp * .06); out.bodyShift = toward * .1;
    out.bodyLift -= .1 + limp * .07; out.bodyPitch += .08;
  } else if (legL && legR) {
    const pull = Math.sin(ph * 2) * w;
    out.bodyLift -= GOLEM_HIP * .82; out.bodyPitch += .5; out.headPitch -= .4; out.bodyRoll *= .3; out.bodyShift = 0;
    out.raiseL += 1.1 + pull * .5; out.raiseR += 1.1 - pull * .5;
  }
  if (missing.head) { out.headPitch = 0; out.headYaw = 0; out.headRoll = 0; }
  if (missing.leftArm) { out.raiseL = 0; out.spreadL = 0; out.elbowL = 0; out.twistL = 0; }
  if (missing.rightArm) { out.raiseR = 0; out.spreadR = 0; out.elbowR = 0; out.twistR = 0; }
  return out;
}

// ---------------------------------------------------------------------------
// THREE adapter: applies the signals to the rigid pieces. ops = {rotateWorld, offsetWorld} from enemy-motion.
// ---------------------------------------------------------------------------
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _hip = new THREE.Vector3(), _piv = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qr = new THREE.Quaternion();

// Rotate `node` about a world pivot by a world axis/angle: orbit its origin, then turn its orientation.
function orbit(node, pivot, axis, angle, rotateWorld) {
  if (!angle || !node.parent) return;
  node.getWorldPosition(_a); _q.setFromAxisAngle(axis, angle);
  _a.sub(pivot).applyQuaternion(_q).add(pivot);
  node.parent.updateWorldMatrix(true, false); node.position.copy(node.parent.worldToLocal(_a));
  rotateWorld(node, axis, angle);
}

// Read once per golem from its rest pose: which side the authored L limbs are on, hip centre and pivots.
export function golemRigInfo(st, aR) {
  const N = st.nodes;
  if (!N.footL || !N.footR) return 1;
  N.footL.node.getWorldPosition(_a); N.footR.node.getWorldPosition(_b);
  return _a.sub(_b).dot(aR) > 0 ? 1 : -1;
}

export function applyGolemPose(st, sig, frame, ops, ctx, missing) {
  const N = st.nodes, {aR, aU, aF} = frame, {rotateWorld, offsetWorld} = ops;
  const body = N.body?.node;
  if (body) {
    // Hips: midpoint of the leg pivots (rest pose, before anything moves this frame).
    if (N.footL && N.footR) { N.footL.node.getWorldPosition(_a); N.footR.node.getWorldPosition(_b); _hip.copy(_a).add(_b).multiplyScalar(.5); }
    else body.getWorldPosition(_hip);
    const halfHip = N.footL && N.footR ? _a.distanceTo(_b) * .5 : .35;
    let roll = sig.bodyRoll;
    if (N.footL && N.footR && ctx.height) { // settle toward the lower side on a slope
      const hL = ctx.height(_a.x, _a.z), hR = ctx.height(_b.x, _b.z), y0 = st.lastPos.y;
      if (Number.isFinite(hL) && Number.isFinite(hR) && Math.abs(hL - y0) < .5 && Math.abs(hR - y0) < .5) {
        const lIsRight = _c.copy(_a).sub(_b).dot(aR) > 0, leftMinusRight = lIsRight ? hR - hL : hL - hR;
        roll += clamp(Math.atan2(leftMinusRight, Math.max(.2, halfHip * 2)), -.08, .08);
      }
    }
    // Pitch and roll about the hips; the legs are counter-turned below so the feet stay where they are.
    const p0 = _piv.copy(_hip);
    body.getWorldPosition(_c); body.updateWorldMatrix(true, false);
    _q.setFromAxisAngle(aR, -sig.bodyPitch).premultiply(_qr.setFromAxisAngle(aF, roll));
    _c.sub(p0).applyQuaternion(_q).add(p0);
    // Lift (the stance hip stays down while the swing hip hikes) and the sideways weight shift.
    _c.addScaledVector(aU, sig.bodyLift + Math.abs(Math.sin(roll)) * halfHip * .9).addScaledVector(aR, sig.bodyShift);
    body.getWorldPosition(_b); _b.subVectors(_c, _b); offsetWorld(body, _b);
    rotateWorld(body, aR, -sig.bodyPitch); rotateWorld(body, aF, roll);
    body.updateWorldMatrix(true, true);
    st.bodyRollApplied = roll;
  }
  // Torso twist/bend about the core pivot, carrying the head and both arms (they are siblings, not children).
  const core = N.torso?.node;
  if (core) {
    core.getWorldPosition(_piv);
    const carried = [N.head?.node, N.armL?.node, N.armR?.node].filter(Boolean);
    for (const [axis, angle] of [[aU, sig.torsoYaw], [aR, -sig.torsoPitch * .6], [aF, sig.torsoRoll]]) {
      if (!angle) continue;
      rotateWorld(core, axis, angle);
      for (const n of carried) orbit(n, _piv, axis, angle, rotateWorld);
    }
  }
  if (N.head && !missing.head) { rotateWorld(N.head.node, aU, sig.headYaw); rotateWorld(N.head.node, aR, -sig.headPitch); rotateWorld(N.head.node, aF, sig.headRoll); }
  // Arms: spread out/in first (about forward), then the forward raise; the shoulder boulder only follows part of the
  // raise so it stays seated on the body as a pauldron instead of flying up with the arm.
  const sigma = st.golemSide || 1;
  for (const [arm, elbow, pauldron, raise, spread, bend, twist, gone, sideSign] of [
    [N.armL, N.elbowL, st.shoulderL, sig.raiseL, sig.spreadL, sig.elbowL, sig.twistL, missing.leftArm, sigma],
    [N.armR, N.elbowR, st.shoulderR, sig.raiseR, sig.spreadR, sig.elbowR, sig.twistR, missing.rightArm, -sigma]]) {
    if (!arm || gone) continue;
    rotateWorld(arm.node, aF, -sideSign * spread);
    rotateWorld(arm.node, aR, raise);
    if (twist) rotateWorld(arm.node, aU, sideSign * twist);
    if (pauldron) { rotateWorld(pauldron.node, aR, -raise * sig.pauldron); rotateWorld(pauldron.node, aF, sideSign * spread * .5); if (twist) rotateWorld(pauldron.node, aU, -sideSign * twist * .5); }
    if (elbow && bend) rotateWorld(elbow.node, twist ? _c.copy(aR).applyAxisAngle(aU, sideSign * twist) : aR, bend); // the elbow hinge turns with the arm
  }
  // Legs: counter the body's pitch/roll (planted, vertical), lean out to meet the sideways shift, then the stride.
  const legLen = st.golemLegLen || 1.18;
  const legLean = Math.atan2(sig.bodyShift, legLen);
  for (const [leg, swing, gone] of [[N.footL, sig.legL, missing.leftLeg], [N.footR, sig.legR, missing.rightLeg]]) {
    if (!leg || gone) continue;
    rotateWorld(leg.node, aF, -(st.bodyRollApplied || 0) + legLean);
    rotateWorld(leg.node, aR, swing + sig.bodyPitch);
  }
}
