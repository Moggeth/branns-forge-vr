import * as THREE from 'three';
import {rigSkeleton, poseSkeletonBody, placeFeet, orientFoot, gaitProfile, SKELETON_STRIDE, FORGELING_GAIT} from './skeleton-motion.js';
import {skeletonKindIndex} from '../shared/skeleton-kinds.js';
import {EMERGE_TICKS, FLINCH_TICKS} from '../shared/enemy-behaviour.js';
import {GOLEM_CYCLE, golemSignals, applyGolemPose, golemRigInfo, NOTICE_SECONDS, NOTICE_BEATS, golemFidget} from './golem-motion.js';
export {GOLEM_CYCLE} from './golem-motion.js';
const FLINCH_SHOW = Math.round(FLINCH_TICKS * 1.4); // the reel outlasts the AI pause a little

// Enemy presentation polish layered AFTER AnimationMixer.update() and BEFORE
// combat.tick() contact sweeps. It never moves entry.root (simulation-owned),
// never changes bone translations/scales except the internal rig `Root` joint,
// and never reparents children, so bone-local arrow embeds follow naturally.
//
// Rotation axes are expressed in ACTOR space from the engine contract
// (+Y up, -Z forward, +X right; see asset-pose.js) and converted into each
// node's parent space at runtime. No bone-local axis is assumed.
//
// Rig contracts (verified from GLB JSON, see ENEMY-INTEGRATION.md):
//  skeleton: Root > Torso > {Head > HeadJaw, LeftArm > LeftForearm > LeftHand (shield),
//                            RightArm > RightForearm > RightHand > WeaponTip}
//            Root > {LeftLeg > LeftKnee > LeftFoot, RightLeg > RightKnee > RightFoot}
//            Posed entirely here (skeleton-motion.js); the GLB carries no clips.
//  golem:    Golem > {ArmL > ElbowL, ArmR > ElbowR, BodyCore, Head, LegL, LegR}
//            rigid, unskinned siblings, no knee/foot joints (no leg IK possible).

export const TICK_RATE = 60;
export const STRIKE_TICK = 18; // shared/simulation.js: damage at attackTick + 18.
// Golem gait and body language live in golem-motion.js: one full L+R cycle per GOLEM_CYCLE metres travelled
// (stride-locked, so feet never skate), rigid legs swinging about the hips, the weight rolling over each planted foot.

// ---------------------------------------------------------------------------
// Pure deterministic math (no THREE, no Math.random, no wall clock).
// ---------------------------------------------------------------------------

export function hashId(id) {
  let h = 0x811c9dc5;
  const s = String(id ?? '');
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function hash2(seed, n) {
  let h = Math.imul(seed ^ Math.imul(n | 0, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
export const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

// C1-continuous 1D value noise in [-1,1]; seeded per enemy and channel.
export function noise1(seed, channel, t) {
  const i = Math.floor(t), f = t - i, s = seed + Math.imul(channel, 0x27d4eb2d);
  return mix(hash2(s, i), hash2(s, i + 1), smooth(f)) * 2 - 1;
}

// Per-enemy personality, stable across peers.
export function traits(id, kind = 'skeleton') {
  const seed = hashId(id), r = n => hash2(seed, 1000 + n);
  const heavy = kind === 'golem';
  return {
    seed,
    breathHz: heavy ? .16 + r(0) * .05 : .26 + r(0) * .1,
    breathPhase: r(1) * Math.PI * 2,
    headTilt: (r(2) - .5) * (heavy ? .06 : .16),   // resting head cock
    slouch: (heavy ? .02 : .05) + r(3) * (heavy ? .03 : .07),
    lookRate: heavy ? .18 + r(4) * .1 : .35 + r(4) * .25,
    swayAmp: heavy ? .006 : .012 + r(5) * .01,
    jitter: heavy ? 0 : r(6),                        // skeletal twitchiness
    crouch: heavy ? 0 : .03 + r(7) * .025,           // always-bent knees (fraction of leg)
    gaitStyle: heavy ? 0 : r(8),                     // brisk march .. loose shamble
  };
}

// Attack envelope by ticks since attackTick. Gameplay strike is fixed at
// tick 18 for both kinds, so the golem gets a longer *visual* telegraph hold,
// a harder slam landing exactly at 18 and a long, heavy recovery.
// Returns {coil, strike, impact, phase}; coil/strike in [0,1], impact in [-1,1].
export function attackEnvelope(age, kind = 'skeleton', out = {coil: 0, strike: 0, impact: 0, phase: 'none'}) {
  out.coil = 0; out.strike = 0; out.impact = 0; out.heave = 0; out.phase = 'none';
  if (!(age >= 0)) return out;
  if (kind === 'golem') {
    // Wind-up, a straining hold, the drive down, fists stuck in the ground for a beat, a heave to pull them free.
    if (age < 11) { out.coil = smooth(age / 11); out.phase = 'telegraph'; }
    else if (age < 15.5) { out.coil = 1; out.phase = 'hold'; }
    else if (age < STRIKE_TICK) { const t = smooth((age - 15.5) / (STRIKE_TICK - 15.5)); out.coil = 1 - t; out.strike = t; out.phase = 'slam'; }
    else if (age < 64) {
      const u = age - STRIKE_TICK;
      out.strike = 1 - smooth((age - 27) / 33);
      out.impact = Math.sin(u * .9) * Math.exp(-u / 5);
      out.heave = age > 26 ? Math.sin(Math.PI * smooth((age - 26) / 22)) : 0;
      out.phase = age < 27 ? 'stuck' : 'recover';
    }
    return out;
  }
  if (age < 11) { out.coil = smooth(age / 11); out.phase = 'anticipate'; }
  else if (age < STRIKE_TICK + 2) { const t = smooth((age - 11) / (STRIKE_TICK + 2 - 11)); out.coil = 1 - t; out.strike = t; out.phase = 'strike'; }
  else if (age < 46) { out.strike = 1 - smooth((age - STRIKE_TICK - 2) / (46 - STRIKE_TICK - 2)); out.phase = 'recover'; }
  return out;
}

// Hit recoil: starts at exactly 0 (continuous), fast rise, damped overshoot.
// |value| <= 1 always. Golem is slower and smaller.
export function recoilEnvelope(age, kind = 'skeleton') {
  if (!(age >= 0)) return 0;
  const heavy = kind === 'golem';
  const rise = heavy ? 3 : 1.6, decay = heavy ? 14 : 8, w = heavy ? .22 : .38;
  if (age > decay * 7) return 0;
  const v = (1 - Math.exp(-age / rise)) * Math.exp(-age / decay) * Math.cos(age * w);
  return clamp(v * 1.45, -1, 1);
}

// Law-of-cosines two-bone solve. a=upper length, b=lower length, d=reach.
// Returns interior hip offset angle and knee interior angle (radians).
export function solveTwoBone(a, b, d) {
  const lo = Math.abs(a - b) + 1e-5, hi = (a + b) * .9995;
  const dd = clamp(d, lo, hi);
  const hip = Math.acos(clamp((a * a + dd * dd - b * b) / (2 * a * dd), -1, 1));
  const knee = Math.acos(clamp((a * a + b * b - dd * dd) / (2 * a * b), -1, 1));
  return {hip, knee, reach: dd, clamped: dd !== d};
}

// Actor-space pose signals for one frame. All angles radians, offsets metres
// (before world scale). Pure: same inputs -> same outputs on every peer.
// pitch: +forward lean, yaw: +turn left, roll: +lean right, arm*: +forward raise,
// drop: fraction of leg length, sideShift/lunge/bodyLift: world metres.
export function poseSignals(s, out) {
  const {kind, tr, t, attack, recoil, missing, moving} = s;
  if (kind === 'golem') return golemSignals(s, out);
  out.torsoPitch = 0; out.torsoYaw = 0; out.torsoRoll = 0;
  out.headPitch = 0; out.headYaw = 0; out.headRoll = 0;
  out.armL = 0; out.armR = 0; out.elbow = 0; out.armSwingL = 0; out.armSwingR = 0;
  out.drop = 0; out.sideShift = 0; out.bodyPitch = 0; out.bodyRoll = 0; out.bodyLift = 0;
  out.lunge = 0; out.legL = 0; out.legR = 0;

  // Idle personality: breath, slouch, look-around, weight shift.
  const breath = Math.sin(t * tr.breathHz * Math.PI * 2 + tr.breathPhase);
  const calm = 1 - Math.max(attack.coil, attack.strike, Math.abs(recoil.value));
  out.torsoPitch += tr.slouch + breath * .018;
  out.headPitch -= breath * .012;
  out.headYaw += noise1(tr.seed, 1, t * tr.lookRate) * .32 * calm;
  out.headRoll += tr.headTilt + noise1(tr.seed, 2, t * tr.lookRate * .7) * .05 * calm;
  if (tr.jitter > .55) out.headYaw += noise1(tr.seed, 3, t * 7) * .025 * calm; // bony twitch
  out.sideShift += noise1(tr.seed, 4, t * .23) * tr.swayAmp * (moving ? .3 : 1);
  out.drop += tr.crouch * .65; // fraction of leg length; adapter scales

  // Attack, guard and gait are posed in skeleton-motion.js from the same envelope.

  // Hit recoil, local to struck part. dir = actor-space push (x right, z back).
  const r = recoil.value, px = recoil.pushX, pz = recoil.pushZ, part = recoil.part;
  if (r) {
    const amp = 1;
    const back = pz * r * amp, side = px * r * amp;
    if (part === 'head') { out.headPitch -= back * .55; out.headRoll += side * .5; out.torsoPitch -= back * .1; }
    else if (part === 'leftArm') { out.armSwingL -= back * .7; out.torsoYaw += side * .15 + back * .12; }
    else if (part === 'rightArm') { out.armSwingR -= back * .7; out.torsoYaw += side * .15 - back * .12; }
    else if (part === 'leftLeg' || part === 'rightLeg') {
      out.drop += Math.abs(r) * .09 * amp; out.sideShift += Math.abs(r) * .04 * amp * (part === 'leftLeg' ? -1 : 1); // buckle onto struck leg
      out.torsoPitch += Math.abs(r) * .12 * amp; out.torsoRoll += (part === 'leftLeg' ? -1 : 1) * Math.abs(r) * .1 * amp;
    } else { out.torsoPitch -= back * .32; out.torsoRoll += side * .22; out.headPitch -= back * .2; out.drop += Math.abs(r) * .03 * amp; }
  }

  // Missing limbs: hobble over the remaining leg, drag with none.
  const legL = missing.leftLeg, legR = missing.rightLeg;
  if (legL !== legR) {
    const sign = legL ? 1 : -1; // lean over the surviving leg
    const limp = Math.abs(Math.sin(s.stride * Math.PI));
    out.torsoRoll += sign * (.16 + limp * .06);
    out.sideShift += sign * .05;
    out.drop += .1 + limp * .04;
    out.torsoPitch += .12;
  } else if (legL && legR) {
    out.drop += 1; // adapter clamps to leg length: torso rests at ground
    out.torsoPitch += .55 + Math.sin(s.stride * Math.PI * 2) * .06;
    out.headPitch -= .35;
  }
  if (missing.head) { out.headPitch = 0; out.headYaw = 0; out.headRoll = 0; }
  if (missing.leftArm) { out.armL = 0; out.armSwingL = 0; }
  if (missing.rightArm) { out.armR = 0; out.armSwingR = 0; }
  return out;
}


// ---------------------------------------------------------------------------
// THREE adapter.
// ---------------------------------------------------------------------------

const RIGS = {
  skeleton: {root: 'Root', torso: 'Torso', head: 'Head', jaw: 'HeadJaw', armL: 'LeftArm', armR: 'RightArm', foreL: 'LeftForearm', foreR: 'RightForearm', handL: 'LeftHand', handR: 'RightHand', legs: [['leftLeg', 'LeftLeg', 'LeftKnee', 'LeftFoot'], ['rightLeg', 'RightLeg', 'RightKnee', 'RightFoot']]},
  golem: {body: 'Golem', torso: 'BodyCore', head: 'Head', armL: 'ArmL', armR: 'ArmR', elbowL: 'ElbowL', elbowR: 'ElbowR', footL: 'LegL', footR: 'LegR'},
};
export const RIG_CONTRACTS = RIGS;

const states = new WeakMap();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _pq = new THREE.Quaternion();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _ws = new THREE.Vector3();
const H = new THREE.Vector3(), K = new THREE.Vector3(), A = new THREE.Vector3(), K2 = new THREE.Vector3(), A1 = new THREE.Vector3(), D = new THREE.Vector3(), TR = new THREE.Vector3();
const aR = new THREE.Vector3(), aU = new THREE.Vector3(), aF = new THREE.Vector3(), rootQ = new THREE.Quaternion();
const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), thighW = new THREE.Quaternion(), kneeW = new THREE.Quaternion(), footW = new THREE.Quaternion();
const envelope = {coil: 0, strike: 0, impact: 0, phase: 'none'};
const sig = {}, recoilSig = {value: 0, pushX: 0, pushZ: 0, part: 'torso'}, missingSig = {};
const PARTS5 = ['head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
const sigIn = {kind: 'skeleton', tr: null, t: 0, attack: envelope, recoil: recoilSig, missing: missingSig, moving: false, stride: 0, walk: 0, gait: 0}; // reused: no per-frame allocation

// Bones win over same-named mesh/group nodes (skeleton.glb has both a "Head"
// mesh node and a "Head" joint; GLTFLoader may uniquify one as "Head_1").
function find(root, name) {
  let bone = null, other = null;
  if (name) root.traverse(n => {
    if (n.name !== name && !(n.name.startsWith(name + '_') && /^\d+$/.test(n.name.slice(name.length + 1)))) return;
    if (n.isBone) { if (!bone || n.name === name) bone = bone && bone.name === name ? bone : n; }
    else if (!n.isMesh && !(other && other.name === name)) other = n;
  });
  return bone || other;
}

function track(st, node) {
  if (!node) return null;
  const rec = {node, baseQ: node.quaternion.clone(), baseP: node.position.clone(), wroteQ: new THREE.Quaternion(), wroteP: new THREE.Vector3(), fresh: true};
  st.tracked.push(rec); return rec;
}

function buildState(visual, kind) {
  const rig = RIGS[kind], st = {kind, tracked: [], nodes: {}, legs: [], hits: [], pending: null, lastHurt: null, lastPos: new THREE.Vector3(), stride: 0, init: false};
  for (const key of ['root', 'body', 'torso', 'head', 'jaw', 'armL', 'armR', 'foreL', 'foreR', 'handL', 'handR', 'elbowL', 'elbowR', 'footL', 'footR']) {
    const node = find(visual, rig[key]); if (node) st.nodes[key] = track(st, node);
  }
  for (const [part, thigh, knee, foot] of rig.legs || []) {
    const t = find(visual, thigh), k = find(visual, knee), f = find(visual, foot);
    if (!t || !k || !f || k.parent !== t || f.parent !== k) continue; // two-bone IK only where the hierarchy proves a chain
    st.legs.push({part, thigh: track(st, t), knee: track(st, k), foot: track(st, f), ankleH: Infinity, lift: 0,
      target: new THREE.Vector3(), lock: new THREE.Vector3(), lockW: 0, locked: false, a: 0, b: 0, active: false});
  }
  return st;
}

// Restore the mixer's (or rest) pose before layering. If the mixer did not
// rewrite a node since our last write, reuse the stored base: never accumulates.
function restore(st) {
  for (const r of st.tracked) {
    const n = r.node;
    if (r.fresh || !n.quaternion.equals(r.wroteQ)) r.baseQ.copy(n.quaternion);
    if (r.fresh || !n.position.equals(r.wroteP)) r.baseP.copy(n.position);
    r.fresh = false;
    n.quaternion.copy(r.baseQ); n.position.copy(r.baseP);
  }
}
function commit(st) { for (const r of st.tracked) { r.wroteQ.copy(r.node.quaternion); r.wroteP.copy(r.node.position); } }

// Rotate a node about its own authored pivot by a world-space axis/angle.
function rotateWorld(node, axis, angle) {
  if (!angle || !node.parent) return;
  node.parent.getWorldQuaternion(_pq);
  _q.setFromAxisAngle(axis, angle);
  _q2.copy(_pq).invert().multiply(_q).multiply(_pq);
  node.quaternion.premultiply(_q2);
}
function offsetWorld(node, delta) {
  if (!node.parent || !(delta.lengthSq() > 0)) return;
  node.parent.updateWorldMatrix(true, false);
  node.parent.matrixWorld.decompose(matrixPosition, _pq, _ws);
  _v3.copy(delta).applyQuaternion(_q.copy(_pq).invert()).divide(_ws);
  node.position.add(_v3);
}

function pushHit(st, hit) {
  const i = st.hits.findIndex(h => h.tick === hit.tick);
  if (i >= 0) st.hits[i] = hit; else { st.hits.push(hit); if (st.hits.length > 2) st.hits.shift(); }
}

// Optional: feed simulation 'hit'/'headshot' events ({id, part, normal, tick})
// for part-local, direction-aware recoil. Without it, hurtTick gives torso recoil.
export function noteEnemyHit(entry, event, fallbackTick) {
  const st = entry?.visual && states.get(entry.visual); if (!st || !event) return false;
  const n = event.normal || [0, 0, 1];
  _v.set(-n[0], 0, -n[2]); // push direction = into the struck surface
  entry.root.getWorldQuaternion(_q); _v.applyQuaternion(_q.invert());
  const len = Math.hypot(_v.x, _v.z);
  const info = {part: event.part || 'torso', x: len > 1e-6 ? _v.x / len : 0, z: len > 1e-6 ? _v.z / len : 1};
  if (Number.isFinite(event.tick)) { pushHit(st, {tick: event.tick, generic: false, ...info}); return true; }
  // Simulation events carry no tick. If hurtTick was already consumed as a
  // generic flinch, upgrade it in place; otherwise wait for the hurtTick change.
  const last = st.hits[st.hits.length - 1];
  if (last && last.generic && last.tick === st.lastHurt) { Object.assign(last, info); last.generic = false; }
  else st.pending = info;
  return true;
}

// entry: {root, visual, data}; ctx: {tick: float interpolated sim tick, height(x,z), dt}
export function applyEnemyMotion(entry, ctx) {
  const visual = entry.visual, data = entry.data;
  if (!visual || visual.userData.placeholder || !data || !entry.root || data.kind === 'ent' || visual.userData.ent || data.kind === 'stumpling' || visual.userData.stumpling || visual.userData.released) return null; // ents pose in ent-view
  const kind = data.kind === 'golem' ? 'golem' : 'skeleton';
  let st = states.get(visual);
  if (!st || st.kind !== kind) {
    st = buildState(visual, kind); st.visual = visual; st.traits = traits(data.id, kind); states.set(visual, st);
    if (kind === 'skeleton') { rigSkeleton(st, entry.root); measureLegs(st); }
  }
  restore(st);
  const tick = Number.isFinite(ctx.tick) ? ctx.tick : 0, t = tick / TICK_RATE, dt = clamp(Number.isFinite(ctx.dt) ? ctx.dt : 1 / 60, 0, .1);

  // Actor frame from the simulation-owned root (engine contract: -Z forward).
  entry.root.updateWorldMatrix(true, false);
  entry.root.matrixWorld.decompose(matrixPosition, rootQ, matrixScale);
  aR.set(1, 0, 0).applyQuaternion(rootQ); aU.set(0, 1, 0); aF.set(0, 0, -1).applyQuaternion(rootQ);
  _v.setFromMatrixPosition(entry.root.matrixWorld);
  const travel = st.init ? Math.hypot(_v.x - st.lastPos.x, _v.z - st.lastPos.z) : 0;
  const teleport = travel > 1.5;
  if (!teleport) st.stride = (st.stride + travel / .9) % 1024;
  st.lastPos.copy(_v);
  const moving = travel > .0008;
  if (kind === 'golem') {
    // Presentation speed from the rendered root; smoothed so network jitter and stops never pop the stride.
    const speed = teleport || !st.init ? 0 : travel / Math.max(dt, 1e-3);
    st.speed = (st.speed || 0) + (speed - (st.speed || 0)) * (1 - Math.exp(-dt / .12));
    // Turning on the spot steps too: a heavy pivot walks its feet round instead of sliding them.
    const yaw = Math.atan2(-aF.x, -aF.z), dyaw = st.init && !teleport ? Math.abs(Math.atan2(Math.sin(yaw - st.prevYaw), Math.cos(yaw - st.prevYaw))) : 0;
    st.prevYaw = yaw;
    const pivot = Math.min(dyaw, .2) * .55, turnRate = dyaw / Math.max(dt, 1e-3);
    st.turn = (st.turn || 0) + (turnRate - (st.turn || 0)) * (1 - Math.exp(-dt / .15));
    const want = st.speed > .2 || st.turn > .7 ? 1 : 0;
    st.walk = (st.walk || 0) + (want - (st.walk || 0)) * (1 - Math.exp(-dt / (want ? .2 : .35)));
    visual.getWorldScale(_ws);
    if (!teleport) st.gait = ((st.gait || 0) + (travel + pivot) / (GOLEM_CYCLE * Math.max(.2, _ws.y / 1.24)) * Math.PI * 2) % (Math.PI * 4096);
    // Unweighted, the legs keep easing toward the nearest planted pose rather than freezing mid-swing.
    if (st.walk < .5 && !teleport) { const target = Math.round(st.gait / Math.PI) * Math.PI; st.gait += (target - st.gait) * (1 - Math.exp(-dt / .25)); }
  } else {
    // Skeleton gait: phase in cycles, locked to distance so planted feet never skate.
    const speed = teleport || !st.init ? 0 : travel / Math.max(dt, 1e-3);
    st.speed = (st.speed || 0) + (speed - (st.speed || 0)) * (1 - Math.exp(-dt / .1));
    const want = st.speed > .25 ? 1 : 0;
    st.walk = (st.walk || 0) + (want - (st.walk || 0)) * (1 - Math.exp(-dt / (want ? .12 : .22)));
    // Each skeleton starts at its own point in the stride, steps its own length and wanders a little, so a crowd never marches in step.
    const P = st.gaitP ||= gaitProfile(st.traits.seed, gaitKind(visual, data));
    if (st.phase === undefined) st.phase = P.phase0;
    // Sideways and backwards steps are shorter and quicker than a forward stride (span shrinks with the stride, so feet stay matched).
    st.strideK = 1 - .45 * Math.abs(st.moveR ?? 0) - .2 * Math.max(0, -(st.moveF ?? 1));
    const stride = (st.legLenRest || .78) * SKELETON_STRIDE * P.stride * st.strideK * (1 + P.drift * noise1(st.traits.seed, 77, t * .35));
    if (!teleport) st.phase = (st.phase + travel / stride) % 4096;
    if (st.walk < .5 && !teleport) { const target = Math.round(st.phase * 2) / 2; st.phase += (target - st.phase) * (1 - Math.exp(-dt / .18)); }
    // Guard: the shield comes up while winding up or recoiling, and when a Hero is close in front.
    let threat = 0;
    for (const p of ctx.threats || []) {
      const dx = p[0] - _v.x, dz = p[2] - _v.z, d = Math.hypot(dx, dz);
      if (d < 6 && d > 1e-3) threat = Math.max(threat, smooth((5.5 - d) / 2.5) * smooth(((dx * aF.x + dz * aF.z) / d - .25) / .5));
    }
    const age = tick - (data.attackTick ?? -1000), hurt = tick - (data.hurtTick ?? -1000);
    // No shield to raise (lost arm, splintered shield) or still clawing out of the ground: no guard.
    const emerging = tick - (data.emergeTick ?? -1e9) < EMERGE_TICKS;
    const guardWant = Math.max(threat * .85, age >= 0 && age < 40 ? .4 : 0, hurt >= 0 && hurt < 50 ? .8 : 0) * (data.missingParts?.includes('leftArm') || data.shieldBroken || emerging ? 0 : 1);
    st.guard = (st.guard || 0) + (guardWant - (st.guard || 0)) * (1 - Math.exp(-dt / (guardWant > (st.guard || 0) ? .14 : .55)));
    // Notice: a Hero stepping up after a quiet spell startles it (once; a skeleton already squared up does not re-startle).
    if (data.side === 'party') st.calm = 0; // Dawnhold's own troops are not startled by their Heroes
    else if (threat < .08) st.calm = (st.calm || 0) + dt; else if (threat > .35 && (st.calm ?? 9) > 2.5 && !emerging && st.init) { st.noticeAt = t; st.calm = 0; } else st.calm = 0;
    // Travel direction in actor space (x right, z forward), smoothed: steps follow it, so backing off and sidling step too.
    if (travel > 1e-4 && !teleport) {
      const dx = _v.x - st.prevX, dz = _v.z - st.prevZ, d = Math.hypot(dx, dz) || 1, r = (dx * aR.x + dz * aR.z) / d, f = (dx * aF.x + dz * aF.z) / d, k = 1 - Math.exp(-dt / .15);
      st.moveR = (st.moveR ?? 0) + (r - (st.moveR ?? 0)) * k; st.moveF = (st.moveF ?? 1) + (f - (st.moveF ?? 1)) * k;
      const n = Math.hypot(st.moveR, st.moveF); if (n > 1e-3) { st.moveR /= Math.max(n, .35); st.moveF /= Math.max(n, .35); }
    }
  }
  st.prevX = _v.x; st.prevZ = _v.z;

  if (data.hurtTick !== undefined && data.hurtTick !== st.lastHurt) {
    // Spawned already-hurt actors do not replay an old flinch.
    if (st.init && !st.hits.some(h => h.tick === data.hurtTick)) pushHit(st, st.pending ? {tick: data.hurtTick, generic: false, ...st.pending} : {tick: data.hurtTick, generic: true, part: 'torso', x: 0, z: 1});
    st.pending = null; st.lastHurt = data.hurtTick;
  }
  recoilSig.value = 0; recoilSig.pushX = 0; recoilSig.pushZ = 0; recoilSig.part = 'torso';
  let best = 0;
  for (const h of st.hits) {
    const v = recoilEnvelope(tick - h.tick, kind);
    recoilSig.value = clamp(recoilSig.value + v, -1, 1);
    if (v && Math.abs(v) >= best) { best = Math.abs(v); recoilSig.part = h.part; recoilSig.pushX = h.x; recoilSig.pushZ = h.z; }
  }
  for (const p of PARTS5) missingSig[p] = !!data.missingParts?.includes(p);
  attackEnvelope(tick - (data.attackTick ?? -1000), kind, envelope);
  sigIn.kind = kind; sigIn.tr = st.traits; sigIn.t = t; sigIn.moving = moving; sigIn.stride = st.stride; sigIn.walk = st.walk || 0; sigIn.gait = st.gait || 0;
  if (kind === 'golem') golemInputs(st, ctx, data, tick, t, dt, teleport);
  poseSignals(sigIn, sig);
  secondaryMotion(st, kind, ctx, dt, teleport);

  visual.getWorldScale(_ws); const scale = _ws.y;
  if (kind === 'golem') applyGolemPose(st, sig, frameAxes, golemOps, ctx, missingSig);
  if (kind === 'golem') golemEvents(st, data, tick, t);
  else applySkeleton(st, ctx, scale, teleport, dt, tick, data);
  commit(st);
  st.init = true;
  return st;
}

// ---- Level 3 secondary motion: inertia and attention, shared by skeletons and golems.
// A damped spring per channel (semi-implicit Euler, sub-stepped): the body lags a start, pitches on through a stop and
// sways on a swerve; the head turns to keep a nearby Hero in view. Pure presentation, from the rendered root.
function spring(s, target, dt, w, z) {
  for (let n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n; n--;) { s.v += (w * w * (target - s.x) - 2 * z * w * s.v) * h; s.x += s.v * h; }
  return s.x;
}
function secondaryMotion(st, kind, ctx, dt, teleport) {
  const heavy = kind === 'golem', p = st.lastPos, dtc = Math.max(dt, 1e-3);
  if (st.vpx === undefined || teleport) { st.vpx = p.x; st.vpz = p.z; st.vx = 0; st.vz = 0; }
  const k = 1 - Math.exp(-dt / .06), ovx = st.vx, ovz = st.vz;
  st.vx += ((p.x - st.vpx) / dtc - st.vx) * k; st.vz += ((p.z - st.vpz) / dtc - st.vz) * k; st.vpx = p.x; st.vpz = p.z;
  const ax = (st.vx - ovx) / dtc, az = (st.vz - ovz) / dtc, aFwd = ax * aF.x + az * aF.z, aSide = ax * aR.x + az * aR.z;
  // Inertial lean: minus the acceleration (a start rocks it back, a stop pitches it on), springy with a little overshoot.
  const gain = heavy ? .012 : .022;
  st.lagF = spring(st.lagFs ||= {x: 0, v: 0}, -clamp(aFwd, -14, 14) * gain, dt, heavy ? 6 : 10, heavy ? .5 : .32);
  st.lagR = spring(st.lagRs ||= {x: 0, v: 0}, -clamp(aSide, -14, 14) * gain, dt, heavy ? 6 : 10, heavy ? .5 : .32);
  // Attention: the nearest Hero within reach of its interest, held a little late and never past the neck's comfort.
  let yaw = 0, pitch = 0, best = heavy ? 11 : 9;
  for (const h of ctx.threats || []) {
    const dx = h[0] - p.x, dz = h[2] - p.z, d = Math.hypot(dx, dz);
    if (d < best && d > .3) { best = d; const f = dx * aF.x + dz * aF.z, r = dx * aR.x + dz * aR.z; yaw = -Math.atan2(r, f); pitch = Math.atan2((h[1] ?? p.y) + 1.5 - (p.y + (heavy ? 2.4 : 1.55)), d); }
  }
  const want = Math.abs(yaw) < 2.2 ? 1 : 0, lim = heavy ? .7 : 1.05;
  st.lookYaw = spring(st.lookYs ||= {x: 0, v: 0}, clamp(yaw, -lim, lim) * want, dt, heavy ? 3.5 : 7, heavy ? .9 : .7);
  st.lookPitch = spring(st.lookPs ||= {x: 0, v: 0}, clamp(pitch, -.45, .35) * want, dt, heavy ? 3.5 : 7, .8);
  if (heavy) {
    sig.bodyPitch += st.lagF * .55; sig.bodyRoll -= st.lagR * .35;
    if (!missingSig.leftArm) sig.raiseL -= st.lagF * 1.1; if (!missingSig.rightArm) sig.raiseR -= st.lagF * 1.1;
    const attending = (1 - envelope.coil) * (1 - golemFidgetWeight(st)); // a fidget's own look-around wins while it lasts
    sig.headYaw += st.lookYaw * attending; sig.headPitch += st.lookPitch * .6 * attending;
    sig.torsoYaw += st.lookYaw * .25 * attending;
  }
}

// ---- golem inputs: rig side (read once), the footfall jolt spring and the chest-beat on first sight of a Hero.
const frameAxes = {aR, aU, aF}, golemOps = {rotateWorld, offsetWorld}, fidgetProbe = {};
function golemFidgetWeight(st) { golemFidget(st.traits.seed, sigIn.t, fidgetProbe); return fidgetProbe.w * (1 - (st.walk || 0)); }
function golemInputs(st, ctx, data, tick, t, dt, teleport) {
  if (!st.golemSide) {
    st.golemSide = golemRigInfo(st, aR);
    const v = st.visual; st.shoulderL = trackMesh(st, v, 'ShoulderL'); st.shoulderR = trackMesh(st, v, 'ShoulderR');
    if (st.nodes.footL) { st.nodes.footL.node.getWorldPosition(_v); st.golemLegLen = Math.max(.3, _v.y - st.lastPos.y); }
  }
  // Each footfall kicks a stiff spring: the body squashes, the head nods and the arms jiggle, then it settles.
  const stomp = st.stompS ||= {x: 0, v: 0};
  if (teleport) { stomp.x = 0; stomp.v = 0; }
  const half = Math.floor((st.gait || 0) / Math.PI + .5);
  if (st.init && st.stompHalf !== undefined && half !== st.stompHalf && (st.walk || 0) > .45) stomp.v -= 2.4 * (st.walk || 0);
  st.stompHalf = half;
  spring(stomp, 0, dt, 15, .32);
  sigIn.stomp = clamp(stomp.x * 6, -1.2, 1.2);
  // Notice: a Hero stepping up after a quiet spell gets a chest beat (Dawnhold's own forged golems never do).
  let near = Infinity;
  for (const h of ctx.threats || []) near = Math.min(near, Math.hypot(h[0] - st.lastPos.x, h[2] - st.lastPos.z));
  if (data.side === 'party' || data.meteorBorn && tick - (data.unfurlTick ?? -1e9) < 120) st.golemCalm = 0;
  else if (near > 13) st.golemCalm = (st.golemCalm || 0) + dt;
  else if (near < 10 && (st.golemCalm ?? 9) > 4 && st.init && !(tick - (data.attackTick ?? -1000) < 64)) { st.golemNoticeAt = t; st.golemCalm = 0; }
  else if (near < 13) st.golemCalm = 0;
  const since = Number.isFinite(st.golemNoticeAt) ? t - st.golemNoticeAt : -1;
  sigIn.notice = since >= 0 && since < NOTICE_SECONDS ? since / NOTICE_SECONDS : -1;
  sigIn.side = st.golemSide;
}
function trackMesh(st, visual, name) { const n = visual.getObjectByName(name); return n ? track(st, n) : null; }

// Presentation cues for golem-presentation.js (dust, sound, rumble, crystal light). Cleared every frame; each cue fires
// once per crossing of the shared tick/stride, so every peer sees the same beats and late joiners get no stale replay.
function golemEvents(st, data, tick, t) {
  const ev = st.events || (st.events = []); ev.length = 0;
  const half = Math.floor((st.gait || 0) / Math.PI + .5);           // footfalls land at sin(gait) = +-1
  if (st.init && st.half !== undefined && half !== st.half && st.walk > .45 && !(missingSig.leftLeg && missingSig.rightLeg))
    ev.push({type: 'step', side: half & 1 ? 'right' : 'left', strength: st.walk});
  st.half = half;
  const age = tick - (data.attackTick ?? -1000), prev = st.attackAge ?? age;
  if (st.init && prev < 0 && age >= 0 && age < 8) ev.push({type: 'telegraph'});
  if (st.init && prev < STRIKE_TICK && age >= STRIKE_TICK && age < STRIKE_TICK + 8) ev.push({type: 'slam'});
  st.attackAge = age;
  // Chest beats and head knocks: a hollow stone knock on each blow (a fist meeting its own body).
  const u = sigIn.notice, pu = st.noticeU ?? -1;
  if (u >= 0) for (const b of NOTICE_BEATS) if (pu < b && u >= b && pu >= 0) ev.push({type: 'thump', strength: 1});
  st.noticeU = u;
  golemFidget(st.traits.seed, t, fidgetProbe);
  const k = fidgetProbe.type === 'knock' ? fidgetProbe.u : -1, pk = st.knockU ?? -1;
  if (k >= 0 && pk >= 0 && (st.walk || 0) < .3) for (const b of [.44, .6]) if (pk < b && k >= b) ev.push({type: 'knock', strength: .5});
  st.knockU = k;
  st.telegraph = envelope.coil; st.recoil = Math.abs(recoilSig.value);
}

// Walk style: the warband archetype from the id, or the forgelings' own drill step.
const gaitKind = (visual, data) => visual?.userData.forgeling ? FORGELING_GAIT : skeletonKindIndex(data.id);

// Rest leg lengths and planted ankle height, measured once from the authored rig (procedural pose starts at rest).
function measureLegs(st) {
  let len = 0;
  for (const leg of st.legs) {
    leg.thigh.node.getWorldPosition(H); leg.knee.node.getWorldPosition(K); leg.foot.node.getWorldPosition(A);
    leg.a = H.distanceTo(K); leg.b = K.distanceTo(A); len = Math.max(len, leg.a + leg.b);
    leg.ankleH = Math.max(.005, leg.rest.y);
  }
  st.legLenRest = len || .78;
}

const bodyEnv = {};
function applySkeleton(st, ctx, scale, teleport, dt, tick, data) {
  const N = st.nodes;
  for (const leg of st.legs) leg.active = !missingSig[leg.part];
  const P = st.gaitP, w = st.walk || 0, ph = st.phase || 0, sc = st.legScale || 1, t = tick / TICK_RATE;
  const notice = Number.isFinite(st.noticeAt) && t - st.noticeAt < .9 && t >= st.noticeAt ? (t - st.noticeAt) / .9 : -1;
  const both = !missingSig.leftLeg && !missingSig.rightLeg;
  // Hops lift the whole body, feet and all: a Bloomcaller's skip on each stance, and the startle on noticing a Hero.
  const hopLift = both ? (P?.hop || 0) * w * .05 * sc * Math.pow(.5 - .5 * Math.cos(ph * Math.PI * 4), 3) + (notice >= 0 && notice < .3 ? .09 * sc * Math.sin(Math.PI * notice / .3) : 0) : 0;
  Object.assign(bodyEnv, {sig, attack: envelope, recoilValue: recoilSig.value, missing: missingSig, t, dt, teleport, aR, aU, aF, rootQ, notice, hopLift, lagF: st.lagF || 0, lagR: st.lagR || 0, lookYaw: st.lookYaw || 0, lookPitch: st.lookPitch || 0, moveR: st.moveR ?? 0, moveF: st.moveF ?? 1, strideK: st.strideK ?? 1,
    rootPos: st.lastPos, height: ctx.height, guard: st.guard || 0, shieldYaw: 0, walk: st.walk || 0, phase: st.phase || 0, traits: st.traits,
    kind: gaitKind(st.visual, data) % FORGELING_GAIT, shieldBroken: !!data.shieldBroken,
    flinch: Number.isFinite(data.flinchTick) && tick >= data.flinchTick && tick - data.flinchTick < FLINCH_SHOW ? (tick - data.flinchTick) / FLINCH_SHOW : -1});
  poseSkeletonBody(st, bodyEnv, offsetWorld, solveLeg);
  if (!ctx.height || !N.root || !st.legs.length) return;
  N.root.node.updateWorldMatrix(true, true);
  placeFeet(st, bodyEnv);
  // Lower the pelvis if a target is out of reach (downhill foot); presentation-only smoothing keeps it continuous.
  let extraDrop = 0;
  for (const leg of st.legs) {
    if (!leg.active) continue;
    leg.thigh.node.getWorldPosition(H);
    const reach = (leg.a + leg.b) * .985, h = Math.hypot(leg.target.x - H.x, leg.target.z - H.z);
    extraDrop = Math.max(extraDrop, H.y - (leg.target.y + Math.sqrt(Math.max(0, reach * reach - h * h))));
  }
  const legLen = st.legLenRest;
  const want = clamp(extraDrop, 0, .25 * legLen), prev = teleport || !st.init ? want : st.pelvisDrop ?? want;
  extraDrop = st.pelvisDrop = want > prev ? want : prev + (want - prev) * (1 - Math.exp(-dt / .12)); // drops at once (no knee snap), recovers smoothly
  if (extraDrop > 0) { _v.copy(aU).multiplyScalar(-extraDrop); offsetWorld(N.root.node, _v); N.root.node.updateWorldMatrix(true, true); }
  for (const leg of st.legs) if (leg.active) { orientFoot(leg, rootQ, aR, (st.gaitP?.toeOut || 0) * (1 - (st.guard || 0) * .5)); solveLeg(leg); }
}

const matrixPosition = new THREE.Vector3(), matrixScale = new THREE.Vector3();
function solveLeg(leg) {
  const thigh = leg.thigh.node, knee = leg.knee.node, foot = leg.foot.node, T = leg.target;
  // Refresh the chain once after the foot pose changes, then read its coherent matrices.
  foot.updateWorldMatrix(true, false);
  H.setFromMatrixPosition(thigh.matrixWorld); K.setFromMatrixPosition(knee.matrixWorld); A.setFromMatrixPosition(foot.matrixWorld);
  const a = leg.a, b = leg.b;
  D.copy(T).sub(H); const d = D.length();
  if (!(a > 1e-6 && b > 1e-6 && d > 1e-6)) return;
  D.divideScalar(d);
  const sol = solveTwoBone(a, b, d);
  TR.copy(H).addScaledVector(D, sol.reach); // reachable target on the hip->target ray
  // Bend plane: knees always point actor-forward (engine contract), whatever the
  // swing; the rest knee is straight, so its own offset is no usable pole.
  _v2.copy(aF); _v2.addScaledVector(D, -_v2.dot(D));
  if (_v2.lengthSq() < 1e-12) return;
  _v2.normalize();
  K2.copy(H).addScaledVector(D, Math.cos(sol.hip) * a).addScaledVector(_v2, Math.sin(sol.hip) * a);
  thigh.matrixWorld.decompose(matrixPosition, thighW, matrixScale);
  knee.matrixWorld.decompose(matrixPosition, kneeW, matrixScale);
  foot.matrixWorld.decompose(matrixPosition, footW, matrixScale);
  // Thigh: rotate H->K onto H->K2 (world), expressed in the thigh's parent space.
  q1.setFromUnitVectors(_v.copy(K).sub(H).normalize(), _v3.copy(K2).sub(H).normalize());
  thigh.parent.matrixWorld.decompose(matrixPosition, _pq, matrixScale);
  thighW.premultiply(q1);
  thigh.quaternion.copy(_pq).invert().multiply(thighW);
  // Shin: ankle carried by q1, then rotate K2->A1 onto K2->TR.
  A1.copy(A).sub(H).applyQuaternion(q1).add(H);
  q2.setFromUnitVectors(_v.copy(A1).sub(K2).normalize(), _v3.copy(TR).sub(K2).normalize());
  kneeW.premultiply(q1).premultiply(q2);
  knee.quaternion.copy(thighW).invert().multiply(kneeW);
  // Foot keeps its pre-IK world orientation: the sole stays planted/level.
  foot.quaternion.copy(kneeW).invert().multiply(footW);
  thigh.updateWorldMatrix(false, true);
}

// Bounded per-frame driver; returns number of enemies posed (cap 64).
export function updateEnemyMotion(actors, ctx) {
  let n = 0;
  for (const entry of actors.values()) {
    if (!entry.enemy) continue;
    if (n >= 64) break;
    if (applyEnemyMotion(entry, ctx)) n++;
  }
  return n;
}

export function enemyMotionState(visual) { return states.get(visual) || null; }
