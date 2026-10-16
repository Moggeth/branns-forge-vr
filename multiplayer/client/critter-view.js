// Rabble critter presentation (client only): Kettlebelly, Bramblehog and Kegtoter (shared/critters.js).
//
// Every pose is a pure function of the critter's saved ticks (ventTick, leakTick, curlTick, dizzyTick, plantTick,
// blastTick, attackTick, hurtTick, emergeTick) at the interpolated render tick, plus distance-locked gaits from the
// interpolated root, so nothing steps at the simulation rate. entry.root (position/yaw) stays simulation-owned; this
// module poses bones and inner groups only.
//
// Draws per critter: one rigid-skinned body (client/critter-geometry.js) and one glow; a Kegtoter adds its keg, fuse and
// spark. Geometry and the lit materials are shared per kind. No lights: glows are unlit emissive meshes and particles.
import * as THREE from 'three';
import {CRITTER, isCritter} from '../shared/critters.js';
import {KETTLE, BRAMBLE, KEG, kettleGeometry, kettleGlow, brambleGeometry, dizzyLeaves, moleGeometry, kegGeometry, fuseGeometry, bake, M} from './critter-geometry.js';
import {softTexture} from './ent-view.js';

const TAU = Math.PI * 2, clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v), smooth = t => { t = clamp(t); return t * t * (3 - 2 * t); }, lerp = (a, b, t) => a + (b - a) * t;
const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const rnd = (seed, n) => { let h = Math.imul(seed ^ Math.imul(n | 0, 0x9e3779b1), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
const S = CRITTER, VENT_BUILD = S.kettlebelly.ventStrike / 60, VENT_END = S.kettlebelly.ventTicks / 60, LEAK = S.kettlebelly.leakTicks / 60;
const CURL = S.bramblehog.curlTicks / 60, ROLL = S.bramblehog.rollTicks / 60, DIZZY = S.bramblehog.dizzyTicks / 60;
const FUSE = S.kegtoter.fuseTicks / 60, CHEER = S.kegtoter.cheerTicks / 60, BURROW = S.kegtoter.burrowTicks / 60;
const PIVOT = {kettlebelly: .6, bramblehog: .44, kegtoter: .32};

/** Soft round particles that can grow as they age (steam, smoke) or stay small (sparks, chips, dirt). */
function createPuffs(scene, cap, additive, texture, name) {
  const pos = new Float32Array(cap * 3), col = new Float32Array(cap * 3), aux = new Float32Array(cap * 2), list = [];
  const g = new THREE.BufferGeometry(); for (const [k, a, n] of [['position', pos, 3], ['col', col, 3], ['aux', aux, 2]]) g.setAttribute(k, new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage));
  const m = new THREE.ShaderMaterial({uniforms: {map: {value: texture}, scale: {value: 420}}, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: 'attribute vec3 col;attribute vec2 aux;uniform float scale;varying vec3 vC;varying float vA;void main(){vC=col;vA=aux.y;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=min(160.,aux.x*scale/max(.1,-mv.z));gl_Position=projectionMatrix*mv;}',
    fragmentShader: 'uniform sampler2D map;varying vec3 vC;varying float vA;void main(){float a=texture2D(map,gl_PointCoord).a*vA;if(a<.02)discard;gl_FragColor=vec4(vC,a);}'});
  const points = new THREE.Points(g, m); points.frustumCulled = false; points.name = name; points.renderOrder = 3; points.visible = false; scene.add(points);
  function emit(p) { if (list.length >= cap) list.shift(); list.push({x: p.x, y: p.y, z: p.z, vx: p.vx || 0, vy: p.vy || 0, vz: p.vz || 0, life: p.life || 1, age: 0, size: p.size || .1, grow: p.grow || 0, alpha: p.alpha ?? 1,
    r: p.r ?? 1, g: p.g ?? 1, b: p.b ?? 1, grav: p.grav ?? 0, drag: p.drag ?? .6, ground: p.ground, flutter: p.flutter || 0, seed: Math.random() * 10}); }
  function tick(dt, height) {
    let k = 0;
    for (let i = list.length - 1; i >= 0; i--) if ((list[i].age += dt) >= list[i].life) list.splice(i, 1);
    for (const q of list) {
      const d = Math.exp(-q.drag * dt); q.vx *= d; q.vz *= d; q.vy = q.vy * d + q.grav * dt;
      if (q.flutter) { q.vx += Math.sin(q.age * 5 + q.seed) * q.flutter * dt; q.vz += Math.cos(q.age * 4 + q.seed) * q.flutter * dt; }
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.ground) { const gy = height(q.x, q.z) + .03; if (q.y < gy) { q.y = gy; q.vy *= -.25; q.vx *= .55; q.vz *= .55; } }
      const u = q.age / q.life, a = Math.min(1, u * 8) * (1 - smooth((u - .45) / .55)) * q.alpha;
      pos[k * 3] = q.x; pos[k * 3 + 1] = q.y; pos[k * 3 + 2] = q.z; col[k * 3] = q.r; col[k * 3 + 1] = q.g; col[k * 3 + 2] = q.b; aux[k * 2] = q.size * (1 + q.grow * q.age); aux[k * 2 + 1] = a; k++;
    }
    g.setDrawRange(0, k); for (const n of ['position', 'col', 'aux']) g.attributes[n].needsUpdate = true; points.visible = k > 0;
  }
  return {emit, tick, count: () => list.length, dispose() { points.removeFromParent(); g.dispose(); m.dispose(); }};
}

/**
 * createCritterView({scene, height(x,z), quality, onSound(event), onRumble({position, strength})})
 *   build(data) -> visual Group for a critter kind (null for anything else)
 *   update(actors, tick, dt)  pose every critter actor (after enemy motion, before combat contacts)
 *   release(entry, snapshot)  a removed critter becomes a corpse (a burst kettle, a flopped hog or mole, or nothing if it dug away)
 *   event(event)              blasts, vents, curls, plants: one-shot bursts and sounds
 *   tick(dt)                  particles, blasts and corpses
 */
export function createCritterView({scene, height = () => 0, quality = 'high', onSound = () => {}, onRumble = () => {}}) {
  const low = quality === 'low', n = k => Math.max(1, Math.round(k * (low ? .55 : 1))), tex = softTexture();
  const steam = createPuffs(scene, low ? 220 : 420, false, tex, 'CritterSteam'), sparks = createPuffs(scene, low ? 140 : 260, true, tex, 'CritterSparks'), chips = createPuffs(scene, low ? 160 : 300, false, tex, 'CritterChips');
  const mats = {
    metal: new THREE.MeshStandardMaterial({vertexColors: true, metalness: .55, roughness: .36, name: 'CritterCopper'}),
    matte: new THREE.MeshStandardMaterial({vertexColors: true, roughness: .82, name: 'CritterFur'}),
    wood: new THREE.MeshStandardMaterial({vertexColors: true, roughness: .7, name: 'CritterKeg'}),
    glow: new THREE.MeshBasicMaterial({vertexColors: true, toneMapped: false, name: 'CritterGlow'}),
  };
  const geo = {}, need = (k, f) => geo[k] ||= f();
  const flash = new THREE.MeshBasicMaterial({color: 0xffc070, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false});
  const flashGeo = new THREE.SphereGeometry(1, 18, 12), ringGeo = new THREE.RingGeometry(.9, 1, 48).rotateX(-Math.PI / 2);
  const states = new WeakMap(), corpses = [], blasts = [], pieces = [], seenBlast = new Set(), stopInfo = new Map();
  let clock = 0;
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), e1 = new THREE.Euler(), q1 = new THREE.Quaternion();

  function rig(spec, geometry, material) {
    const bones = spec.bones.map(([name]) => { const b = new THREE.Bone(); b.name = name; return b; }), idx = Object.fromEntries(spec.bones.map(([name], i) => [name, i]));
    spec.bones.forEach(([, parent, at], i) => { const p = parent ? spec.bones[idx[parent]][2] : [0, 0, 0]; bones[i].position.set(at[0] - p[0], at[1] - p[1], at[2] - p[2]); if (parent) bones[idx[parent]].add(bones[i]); });
    if (idx.Needle !== undefined) bones[idx.Needle].quaternion.setFromEuler(e1.set(KETTLE.gauge, Math.PI, 0));
    const mesh = new THREE.SkinnedMesh(geometry, material); mesh.add(bones[0]); mesh.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(bones));
    mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = !low;
    return {mesh, bones: Object.fromEntries(bones.map(b => [b.name, b])), restP: Object.fromEntries(bones.map(b => [b.name, b.position.clone()])), restQ: Object.fromEntries(bones.map(b => [b.name, b.quaternion.clone()]))};
  }
  const rot = (r, name, x = 0, y = 0, z = 0) => r.bones[name].quaternion.copy(r.restQ[name]).multiply(q1.setFromEuler(e1.set(x, y, z)));
  const off = (r, name, x = 0, y = 0, z = 0) => r.bones[name].position.copy(r.restP[name]).add(v3.set(x, y, z));
  const scl = (r, name, x = 1, y = x, z = x) => r.bones[name].scale.set(x, y, z);

  function build(data) {
    if (!isCritter(data?.kind)) return null;
    const kind = data.kind, seed = hash(data.id), visual = new THREE.Group(), lift = new THREE.Group(), pivot = new THREE.Group(), base = new THREE.Group();
    visual.name = kind === 'kettlebelly' ? 'Kettlebelly' : kind === 'bramblehog' ? 'Bramblehog' : 'Kegtoter';
    pivot.position.y = PIVOT[kind]; base.position.y = -PIVOT[kind]; visual.add(lift); lift.add(pivot); pivot.add(base);
    const c = {kind, seed, lift, pivot, base};
    if (kind === 'kettlebelly') {
      Object.assign(c, rig(KETTLE, need('kettle', kettleGeometry), mats.metal));
      c.glowMat = mats.glow.clone(); const glow = new THREE.Mesh(need('kettleGlow', kettleGlow), c.glowMat); glow.name = 'KettleFirebox'; glow.userData.ignoreContact = true; c.bones.Boiler.add(glow);
    } else if (kind === 'bramblehog') {
      Object.assign(c, rig(BRAMBLE, need('bramble', brambleGeometry), mats.matte));
      c.dizzy = new THREE.Mesh(need('dizzy', dizzyLeaves), mats.matte); c.dizzy.name = 'BramblehogDizzy'; c.dizzy.userData.ignoreContact = true; c.dizzy.visible = false; lift.add(c.dizzy);
    } else {
      c.moleMat = mats.matte.clone(); Object.assign(c, rig(KEG, need('mole', moleGeometry), c.moleMat));
      c.glowMat = mats.glow.clone(); const lamp = new THREE.Mesh(new THREE.CircleGeometry(.042, 14), c.glowMat); lamp.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Array(lamp.geometry.attributes.position.count).fill(0).flatMap(() => [1.6, 1.35, .7]), 3));
      lamp.position.set(0, .655 - .56, -.205); lamp.rotation.set(-.2, Math.PI, 0); lamp.name = 'KegtoterLamp'; lamp.userData.ignoreContact = true; c.bones.Helmet.add(lamp);
      c.keg = new THREE.Mesh(need('keg', kegGeometry), mats.wood); c.keg.name = 'KegHead'; c.keg.castShadow = true; visual.add(c.keg);
      c.fuse = new THREE.Mesh(need('fuse', fuseGeometry), mats.matte); c.fuse.position.y = KEG.radius + .02; c.fuse.userData.ignoreContact = true; c.keg.add(c.fuse);
      c.spark = new THREE.Mesh(need('spark', () => bake([[new THREE.SphereGeometry(.03, 8, 6), M(0, 0, 0), [2, 1.4, .5]]])), mats.glow); c.spark.userData.ignoreContact = true; c.keg.add(c.spark);
      c.carrier = new THREE.Group(); lift.add(c.carrier);
    }
    base.add(c.mesh); c.mesh.name = visual.name + 'Body';
    visual.userData.critter = c; return visual;
  }

  // ---- shared helpers ----
  const age = (tick, at) => at === undefined ? -Infinity : (tick - at) / 60; // never-set ticks read as 'not yet'
  const inWorld = (entry, x, y, z, out = v2) => out.set(x, y, z).applyMatrix4(entry.root.matrixWorld);
  function dirt(x, y, z, count, spread, up = 1.6, color = [.34, .25, .16]) { for (let i = 0; i < count; i++) { const a = Math.random() * TAU, s = spread * (.4 + Math.random());
    chips.emit({x, y, z, vx: Math.cos(a) * s, vy: up * (.5 + Math.random()), vz: Math.sin(a) * s, life: .6 + Math.random() * .5, size: .05 + Math.random() * .05, grav: -9.8, drag: .4, ground: true,
      r: color[0] * (.8 + Math.random() * .4), g: color[1] * (.8 + Math.random() * .4), b: color[2] * (.8 + Math.random() * .4)}); } }
  function puff(x, y, z, vx, vy, vz, {size = .14, grow = 2.2, life = .9, alpha = .7, drag = 1.6, grav = .6, tint = .94} = {}) { steam.emit({x, y, z, vx, vy, vz, size, grow, life, alpha, drag, grav, r: tint, g: tint + .02, b: tint + .04}); }
  function emerge(entry, c, st, tick) { // risen from the earth by the God's Rabble call
    const a = age(tick, entry.data.emergeTick); if (!(a >= 0 && a < .9)) return 0;
    const u = smooth(a / .7); if (!st.rose) { st.rose = true; entry.root.getWorldPosition(v1); dirt(v1.x, height(v1.x, v1.z) + .05, v1.z, n(24), 1.4, 2.4); }
    return -(1 - u) * (PIVOT[c.kind] * 2 + .1);
  }
  function stride(entry, c, dt, per) {
    let st = states.get(entry.visual); entry.root.getWorldPosition(v1);
    if (!st) { st = {last: v1.clone(), stride: rnd(c.seed, 1), move: 0, speed: 0, hurt: entry.data.hurtTick, hurtAt: -1e9, roll: 0, lifts: [0, 0]}; states.set(entry.visual, st); }
    const travel = Math.hypot(v1.x - st.last.x, v1.z - st.last.z); st.last.copy(v1); st.travel = travel < 1.5 ? travel : 0;
    st.stride += st.travel / per; st.speed = lerp(st.speed, dt > 0 ? Math.min(st.travel / dt, 9) : 0, 1 - Math.exp(-dt * 6));
    st.move = lerp(st.move, st.travel > .0004 * 60 * dt ? 1 : 0, 1 - Math.exp(-dt * 9));
    return st;
  }
  function hurt(entry, st, sound) {
    if ((entry.data.hurtTick ?? -1e9) !== (st.hurt ?? -1e9)) { st.hurt = entry.data.hurtTick; st.hurtAt = clock; entry.root.getWorldPosition(v1); onSound({kind: sound, id: entry.data.id, position: v1.toArray()}); }
    const t = clock - st.hurtAt; return t < 1.2 ? Math.exp(-t * 7) : 0;
  }

  // ---- Kettlebelly ----
  function poseKettle(entry, c, tick, dt) {
    const d = entry.data, st = stride(entry, c, dt, .8), m = st.move, ph = st.stride * TAU, rec = hurt(entry, st, 'kettle_clang'), wob = Math.sin((clock - st.hurtAt) * 34) * rec;
    const va = age(tick, d.ventTick), la = d.leakTick !== undefined ? age(tick, d.leakTick) : -1, leaking = la >= 0;
    const build = !leaking && va >= 0 && va < VENT_BUILD ? smooth(va / VENT_BUILD) : 0, ventU = !leaking && va >= VENT_BUILD && va < VENT_END ? (va - VENT_BUILD) / (VENT_END - VENT_BUILD) : -1;
    entry.root.updateMatrixWorld();
    // legs: pistons swing from the hip, rods telescope up as each boot lifts; a chuff of steam from the exhaust on each landing
    for (const [i, side, rod, o] of [[0, 'PistonL', 'RodL', 0], [1, 'PistonR', 'RodR', Math.PI]]) {
      let swing = Math.sin(ph + o) * .42 * m, lift = Math.max(0, Math.cos(ph + o)) * m;
      if (leaking) { swing = Math.sin(clock * 16 + o) * .75; lift = .5 + .5 * Math.sin(clock * 21 + o); }
      rot(c, side, swing, 0, leaking ? Math.sin(clock * 13 + o) * .25 : 0); off(c, rod, 0, lift * .09 + build * .05, 0);
      if (st.lifts[i] > .05 && lift <= .05 && !leaking) { const [x, y, z] = KETTLE.exhaust[i], w = inWorld(entry, x, y, z + .05); puff(w.x, w.y, w.z, 0, .5, 0, {size: .16, grow: 2.4, life: .8, alpha: .4}); onSound({kind: 'kettle_chuff', id: d.id, position: w.toArray()}); }
      st.lifts[i] = lift;
    }
    // body: a stance-to-stance waddle, a forward lean, breathing belly; builds pressure, vents, or skids about leaking
    let bob = Math.abs(Math.sin(ph)) * .035 * m, roll = Math.sin(ph) * .09 * m + wob * .07, yawT = Math.sin(ph) * .06 * m, pitch = -.06 * m, push = 0, swell = .012 * Math.sin(clock * 2 + c.seed % 7), sy = 0;
    let lid = Math.abs(Math.sin(clock * 38)) * .06 * Math.max(0, Math.sin(clock * .9 + c.seed)) ** 8 + rec * .3, needle = .55 + .1 * Math.sin(clock * 1.3 + c.seed) + Math.sin(clock * 31) * .02, glow = 1 + .15 * Math.sin(clock * 3.1 + c.seed);
    let hug = 0, fling = 0;
    if (build) {
      bob -= .05 * build; swell += .1 * build; sy = .06 * build; roll += Math.sin(clock * 55) * .025 * build; lid = Math.max(lid, Math.abs(Math.sin(clock * (30 + 30 * build))) * .2 * build);
      needle = lerp(needle, -1.25, build) + Math.sin(clock * 40) * .03 * build; glow += 1.3 * build; hug = .5 * build;
      if (va > VENT_BUILD * .4 && Math.random() < dt * 30) { const w = inWorld(entry, ...KETTLE.whistle); puff(w.x, w.y, w.z, (Math.random() - .5) * .3, 2.2, (Math.random() - .5) * .3, {size: .1, grow: 3, life: .6, alpha: .45}); }
    }
    if (ventU >= 0) {
      const thrust = Math.sin(Math.min(1, ventU / .12) * Math.PI / 2) * Math.exp(-ventU * 3);
      pitch -= .28 * thrust; push = -.07 * thrust; swell += ventU < .2 ? lerp(.1, -.05, smooth(ventU / .2)) : lerp(-.05, 0, smooth((ventU - .2) / .8));
      lid = Math.max(lid, .95 * (ventU < .08 ? smooth(ventU / .08) : Math.exp(-(ventU - .08) * 7)) * (1 + .15 * Math.sin(ventU * 60)));
      needle = lerp(-1.25, .55, smooth(ventU / .5)); glow += .9 * (1 - ventU); fling = thrust; hug = .5 * (1 - smooth(ventU / .15));
      if (ventU < .55) ventCone(entry, dt, 1 - ventU / .55);
    }
    if (leaking) {
      const u = clamp(la / LEAK), spin = d.leakSpin || 1;
      bob += Math.abs(Math.sin(clock * 13)) * .05; roll = .22 * spin + Math.sin(clock * 47) * .04 * (.3 + u); pitch = Math.sin(clock * 9) * .08; swell += .08 + .05 * u + Math.sin(clock * 30) * .015;
      lid = Math.abs(Math.sin(clock * 45)) * (.25 + .3 * u); needle = -1.35 + Math.sin(clock * 40) * .05; glow = 1.6 + Math.sin(clock * 12) * .5 + u * 1.2; hug = -.4 + .45 * Math.sin(clock * 18);
      leakJet(entry, spin, dt, u);
    }
    const rise = emerge(entry, c, st, tick);
    c.lift.position.y = rise;
    off(c, 'Boiler', 0, bob, push); rot(c, 'Boiler', pitch, yawT, roll); scl(c, 'Boiler', 1 + swell, 1 + sy + swell * .5, 1 + swell);
    rot(c, 'Lid', lid); rot(c, 'Needle', 0, 0, needle);
    for (const [name, s] of [['ValveL', 1], ['ValveR', -1]]) rot(c, name, Math.sin(ph + (s > 0 ? Math.PI : 0)) * .35 * m - .7 * fling, 0, s * (hug + .5 * fling) + s * rec * .25);
    c.glowMat.color.setScalar(glow);
  }
  function ventCone(entry, dt, k) { // the cone shared/critters.js scalds: CRITTER.kettlebelly.ventRange and ventAngle
    const w = inWorld(entry, ...KETTLE.spout, v1), fx = v2.set(0, 0, -1).transformDirection(entry.root.matrixWorld), spread = S.kettlebelly.ventAngle * .8;
    for (let i = 0, count = Math.round(dt * (low ? 90 : 170) * k); i < count; i++) {
      const a = (Math.random() - .5) * 2 * spread, e = (Math.random() - .2) * .35, sp = 5.2 + Math.random() * 2.2, c = Math.cos(a), s = Math.sin(a);
      const dx = fx.x * c - fx.z * s, dz = fx.x * s + fx.z * c;
      puff(w.x, w.y, w.z, dx * sp, e * sp + .4, dz * sp, {size: .2, grow: 4.2, life: .7 + Math.random() * .35, alpha: .5, drag: 2.4, grav: .9});
    }
  }
  function leakJet(entry, spin, dt, u) {
    const a = 1.9 * spin, jx = Math.sin(a), jz = Math.cos(a), w = inWorld(entry, jx * KETTLE.rim, KETTLE.belly + .02, jz * KETTLE.rim, v1);
    const dir = v2.set(jx, .12, jz).transformDirection(entry.root.matrixWorld);
    for (let i = 0, count = Math.round(dt * (low ? 60 : 110)); i < count; i++) { const sp = 6 + Math.random() * 3;
      puff(w.x, w.y, w.z, dir.x * sp + (Math.random() - .5), dir.y * sp + (Math.random() - .5), dir.z * sp + (Math.random() - .5), {size: .14, grow: 3.4, life: .45 + Math.random() * .3, alpha: .55, drag: 3}); }
    if (Math.random() < dt * (3 + 8 * u)) sparks.emit({x: w.x, y: w.y, z: w.z, vx: dir.x * 3, vy: 1.5, vz: dir.z * 3, life: .4, size: .05, grav: -6, drag: .5, r: 1.6, g: .9, b: .4});
  }

  // ---- Bramblehog ----
  function bramblePhaseAt(d, tick) {
    const ca = age(tick, d.curlTick), da = age(tick, d.dizzyTick);
    if (da >= 0 && da < DIZZY) return ['dizzy', da];
    if (ca >= 0 && ca < CURL) return ['curl', ca];
    if (ca >= CURL && ca < CURL + ROLL && !(da >= 0)) return ['roll', ca - CURL];
    return ['trot', 0];
  }
  function poseBramble(entry, c, tick, dt) {
    const d = entry.data, st = stride(entry, c, dt, .45), m = st.move, ph = st.stride * TAU, rec = hurt(entry, st, 'hog_squeal'), [phase, pa] = bramblePhaseAt(d, tick);
    entry.root.updateMatrixWorld();
    let round = 0, pitch = -.03 * m + Math.sin(ph * 2) * .03 * m, roll = 0, yawT = 0, bob = Math.abs(Math.sin(ph)) * .03 * m, squash = 1 - rec * .15;
    let snP = 0, snY = Math.sin(clock * .8 + c.seed) * .15 * (1 - m), snZ = 0, legSplay = 0;
    const sniff = Math.sin(clock * 1.7 + c.seed % 11) > .55 ? Math.sin(clock * 24) * .07 : 0; snP += sniff * (1 - .5 * m) - rec * .2;
    if (phase === 'curl') {
      round = smooth(pa / (CURL * .7)); const u = pa / CURL; pitch = Math.sin(u * Math.PI * 4) * .28 * u; bob = -.03 * (1 - round);
      if (u > .6 && Math.random() < dt * 40) { const w = inWorld(entry, 0, .05, .4); dirt(w.x, w.y, w.z, 1, .8, 1.2); }
      st.roll = 0; st.rollEnd = undefined;
    } else if (phase === 'roll') {
      round = 1; st.roll -= st.travel / BRAMBLE.ball; pitch = st.roll; roll = Math.sin(clock * 7) * .06; bob = Math.abs(Math.sin(st.roll)) * .035;
      st.rollEnd = st.roll;
      if (st.travel > 0) { const w = inWorld(entry, (Math.random() - .5) * .4, .04, .35);
        if (Math.random() < st.speed * dt * 4) dirt(w.x, w.y, w.z, 2, .9, 1.8);
        if (Math.random() < st.speed * dt * .5) chips.emit({x: w.x, y: w.y + .5, z: w.z, vx: (Math.random() - .5), vy: 1.5, vz: (Math.random() - .5), life: 1.4, size: .07, grav: -2.4, drag: 1.2, flutter: 3, ground: true, r: .4, g: .66, b: .26}); }
    } else if (phase === 'dizzy') {
      const pop = smooth(pa / .22), u = pa / DIZZY, end = st.rollEnd ?? 0, upright = Math.round(end / TAU) * TAU;
      round = 1 - pop; pitch = lerp(end, upright, pop) + .16 * pop; roll = Math.sin(clock * 5) * .12 * (1 - u) * pop;
      const crash = stopInfo.get(d.id)?.crash; squash *= 1 - (crash ? .3 : .12) * Math.exp(-pa * 8) * pop;
      snP += Math.cos(clock * 6) * .15 * (1 - u * .6); snY = Math.sin(clock * 6) * .3 * (1 - u * .6); legSplay = .3 * (1 - u);
    } else st.rollEnd = undefined;
    const na = age(tick, d.attackTick); if (phase === 'trot' && na >= 0 && na < .35) { const k = Math.sin(Math.PI * na / .35); snZ = -.1 * k; pitch -= .1 * k; }
    const rise = emerge(entry, c, st, tick);
    c.lift.position.y = rise + bob;
    const R = BRAMBLE.body, b = BRAMBLE.ball;
    scl(c, 'Hedge', lerp(1, b / R[0], round), lerp(1, b / R[1], round) * squash, lerp(1, b / R[2], round));
    off(c, 'Hedge', 0, -(1 - squash) * .2, 0); rot(c, 'Hedge', pitch, yawT, roll);
    const tuck = 1 - .85 * round; off(c, 'Snout', 0, 0, .22 * round + snZ); scl(c, 'Snout', tuck); rot(c, 'Snout', snP, snY, 0);
    scl(c, 'Twirl', Math.max(.01, 1 - round)); rot(c, 'Twirl', 0, 0, Math.sin(clock * 9 + c.seed) * .35 * (1 - round));
    for (const [name, o, sx] of [['TrotA', 0, -1], ['TrotD', 0, 1], ['TrotB', Math.PI, 1], ['TrotC', Math.PI, -1]]) {
      const [x, , z] = c.restP[name]; off(c, name, -x * .4 * round, .14 * round, -z * .4 * round); scl(c, name, lerp(1, .2, round));
      rot(c, name, Math.sin(ph + o) * .55 * m * (1 - round), 0, sx * legSplay);
    }
    c.dizzy.visible = phase === 'dizzy' && pa > .2; if (c.dizzy.visible) { const u = (pa - .2) / (DIZZY - .2); c.dizzy.position.set(0, .98 + Math.sin(clock * 3) * .03, -.22); c.dizzy.rotation.set(.2, clock * 5, 0); c.dizzy.scale.setScalar(Math.max(.01, Math.min(smooth(u * 6), 1 - smooth((u - .8) / .2)))); }
  }

  // ---- Kegtoter ----
  function kegPhaseAt(d, tick) {
    const ba = age(tick, d.blastTick), pa = age(tick, d.plantTick);
    if (ba >= 0) return ba < CHEER ? ['cheer', ba] : ['burrow', ba - CHEER];
    if (pa >= 0 && d.kegAt) return ['fuse', pa];
    return ['carry', 0];
  }
  function poseKeg(entry, c, tick, dt) {
    const d = entry.data, st = stride(entry, c, dt, .3), m = st.move, ph = st.stride * TAU, rec = hurt(entry, st, 'mole_squeak'), [phase, pa] = kegPhaseAt(d, tick);
    let roll = Math.sin(ph) * .13 * m + Math.sin(clock * 1.9 + c.seed) * .03, pitch = -.06 * m, yawT = 0, bob = Math.abs(Math.sin(ph)) * .03 * m, sy = 1 - rec * .12, flip = 0, sink = 0;
    let pawX = 0, pawY = 0, pawZ = 0, pawRx = 0, pawRz = Math.sin(ph - .6) * .1 * m, helmX = 0, helmZ = 0, kegRoll = Math.sin(ph - .6) * .16 * m, soot = st.soot || 0, spark = .6;
    // now and then the keg gets away from it: a lurch, a scramble, a recovery
    const w = Math.max(0, Math.sin(clock * 1.7 + c.seed % 13)) ** 12 * m; roll += w * .22 * Math.sin(clock * 5); kegRoll += w * .3; pawRz += w * .3 * Math.sin(clock * 20);
    let kegWorld = null;
    if (phase === 'fuse') {
      const bend = Math.sin(Math.PI * clamp(pa / .45)), ears = smooth((pa - .45) / .25), plant = smooth(pa / .4);
      pitch = -.5 * bend; pawY = -.18 * bend; pawZ = -.12 * bend; roll = Math.sin(clock * 50) * .03 * ears; yawT = Math.sin(clock * 2.2 + c.seed) * .25 * ears; sy *= 1 - .1 * ears;
      pawX = .06 * ears; pawY += -.15 * ears; pawRz += -.25 * ears; kegRoll = 0; spark = 1 + 1.5 * clamp(pa / FUSE);
      kegWorld = plant; c.fuse.scale.y = Math.max(.12, 1 - clamp(pa / FUSE) * .88);
    } else c.fuse.scale.y = 1;
    if (phase === 'cheer') {
      const u = pa / .6; flip = u < 1 ? TAU * smooth(u) : 0; bob = u < 1 ? 2 * .55 * u * (1 - u) : Math.abs(Math.sin(clock * 9)) * .09;
      soot = st.soot = 1; helmZ = .32; helmX = -.2; pawRz = u < 1 ? .6 : Math.sin(clock * 12) * .35; pawY = u < 1 ? 0 : .04 * Math.sin(clock * 9);
      if (u >= 1 && !st.landed) { st.landed = true; entry.root.getWorldPosition(v1); dirt(v1.x, height(v1.x, v1.z) + .05, v1.z, n(10), .9); onSound({kind: 'mole_cheer', id: d.id, position: v1.toArray()}); }
    }
    if (phase === 'burrow') {
      const u = clamp(pa / (BURROW * .9)); soot = 1; helmZ = .32; helmX = -.2; pitch = -.55 * smooth(u * 4); sink = smooth(u) * .85; pawRx = Math.sin(clock * 22) * .7; pawRz = .3;
      if (Math.random() < dt * 40) { entry.root.getWorldPosition(v1); const f = v2.set(0, 0, -1).transformDirection(entry.root.matrixWorld); dirt(v1.x + f.x * .25, height(v1.x, v1.z) + .05, v1.z + f.z * .25, 2, .9, 2.2); }
    }
    const rise = emerge(entry, c, st, tick);
    c.lift.position.y = rise + bob - sink; c.pivot.rotation.set(flip, 0, 0);
    off(c, 'Mole', 0, 0, 0); rot(c, 'Mole', pitch, yawT, roll); scl(c, 'Mole', 1 + (1 - sy) * .5, sy, 1 + (1 - sy) * .5);
    rot(c, 'Helmet', helmX + Math.sin(ph) * .05 * m, 0, helmZ - roll * .4);
    for (const [name, s] of [['PawL', -1], ['PawR', 1]]) { off(c, name, s * pawX, pawY, pawZ); rot(c, name, pawRx * (s < 0 ? 1 : -1), 0, -s * pawRz * (phase === 'cheer' ? -1 : 1)); }
    for (const [name, o] of [['ToeL', 0], ['ToeR', Math.PI]]) { rot(c, name, Math.sin(ph + o) * .6 * m + (phase === 'burrow' ? Math.sin(clock * 22 + o) * .6 : 0)); off(c, name, 0, Math.max(0, Math.cos(ph + o)) * .04 * m, 0); }
    c.moleMat.color.setScalar(1 - .45 * soot);
    c.glowMat.color.setScalar(phase === 'burrow' ? 1 - sink : .9 + .1 * Math.sin(clock * 7));
    // the keg: carried overhead (follows the mole's sway with a lag), set down in front of it, or gone in the bang
    const kegShown = phase === 'carry' || phase === 'fuse'; c.keg.visible = kegShown; if (!kegShown) return;
    entry.visual.updateMatrixWorld(true);
    c.carrier.position.set(0, 0, 0); c.carrier.rotation.set(pitch * .8, yawT, roll + kegRoll);
    c.carrier.updateMatrixWorld(true); const carry = v1.set(...KEG.carry).applyMatrix4(c.carrier.matrixWorld);
    if (kegWorld !== null) { v2.set(d.kegAt[0], d.kegAt[1] + KEG.rest, d.kegAt[2]); carry.lerp(v2, kegWorld); carry.y += Math.sin(Math.PI * kegWorld) * .08; }
    c.keg.position.copy(entry.visual.worldToLocal(carry)); c.keg.rotation.set(0, 0, kegWorld !== null ? (1 - kegWorld) * (roll + kegRoll) : roll + kegRoll);
    const tip = .14 * c.fuse.scale.y; c.spark.position.set(.03 * c.fuse.scale.y, KEG.radius + .02 + tip, .02 * c.fuse.scale.y); c.spark.scale.setScalar((.7 + .5 * Math.random()) * spark);
    if (Math.random() < dt * 30 * spark) { c.spark.getWorldPosition(v2); sparks.emit({x: v2.x, y: v2.y, z: v2.z, vx: (Math.random() - .5) * 1.6, vy: .8 + Math.random() * 1.6, vz: (Math.random() - .5) * 1.6, life: .3 + Math.random() * .3, size: .035 + Math.random() * .03, grav: -5, drag: .6, r: 1.8, g: 1.1, b: .4}); }
    if (phase === 'fuse' && Math.random() < dt * 6) { c.spark.getWorldPosition(v2); puff(v2.x, v2.y, v2.z, 0, .5, 0, {size: .05, grow: 2, life: .8, alpha: .35, tint: .5}); }
  }

  function update(actors, tick, dt) {
    clock += dt; let count = 0;
    for (const entry of actors.values()) {
      const c = entry.enemy && entry.visual?.userData.critter; if (!c || !entry.data) continue;
      if (c.kind === 'kettlebelly') poseKettle(entry, c, tick, dt); else if (c.kind === 'bramblehog') poseBramble(entry, c, tick, dt); else poseKeg(entry, c, tick, dt);
      count++;
    }
    return count;
  }

  // ---- blasts and one-shot events ----
  function boom(position, style, radius) {
    const [x, y, z] = position, keg = style === 'keg', gy = height(x, z);
    const ball = new THREE.Mesh(flashGeo, flash.clone()), ring = new THREE.Mesh(ringGeo, flash.clone());
    ball.material.color.set(keg ? 0xffb050 : 0xfff0d0); ring.material.color.set(keg ? 0xffa040 : 0xe8f4ff);
    ball.position.set(x, y + (keg ? .35 : .6), z); ring.position.set(x, gy + .06, z); ball.renderOrder = ring.renderOrder = 4; scene.add(ball, ring);
    blasts.push({ball, ring, age: 0, radius, keg});
    if (keg) {
      for (let i = 0; i < n(26); i++) { const a = Math.random() * TAU, e = Math.random() * .9, s = 2 + Math.random() * 4;
        sparks.emit({x, y: y + .3, z, vx: Math.cos(a) * Math.cos(e) * s, vy: Math.sin(e) * s + 1, vz: Math.sin(a) * Math.cos(e) * s, life: .35 + Math.random() * .35, size: .22 + Math.random() * .2, grav: 1, drag: 3, r: 1.8, g: .8 + Math.random() * .3, b: .25}); }
      for (let i = 0; i < n(18); i++) { const a = Math.random() * TAU, s = .6 + Math.random() * 1.4; puff(x + Math.cos(a) * .3, y + .4, z + Math.sin(a) * .3, Math.cos(a) * s, .8 + Math.random() * 1.2, Math.sin(a) * s, {size: .35, grow: 1.6, life: 1.6 + Math.random(), alpha: .7, drag: 1.4, grav: .5, tint: .32}); }
      dirt(x, gy + .1, z, n(30), 3, 4.5, [.55, .36, .2]); // staves and soil
      dirt(x, gy + .1, z, n(8), 2.4, 3.5, [.25, .25, .27]); // hoop iron
    } else {
      for (let i = 0; i < n(30); i++) { const a = Math.random() * TAU, e = Math.random() * .8, s = 2 + Math.random() * 3; puff(x, y + .6, z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s, Math.sin(a) * Math.cos(e) * s, {size: .4, grow: 2.6, life: 1.2 + Math.random() * .8, alpha: .6, drag: 2, grav: .8}); }
      dirt(x, y + .6, z, n(22), 3.2, 3.8, [.86, .5, .28]); // copper plates
      dirt(x, y + .6, z, n(16), 2.6, 3.2, [.95, .78, .38]); // rivets
      lidPiece(x, y + 1, z);
    }
  }
  const lidGeo = () => need('lid', () => bake([[new THREE.SphereGeometry(.21, 18, 6, 0, TAU, 0, Math.PI / 2), M(0, 0, 0, 0, 0, 0, 1, .42, 1), [.82, .47, .27]], [new THREE.TorusGeometry(.207, .013, 6, 24), M(0, .005, 0, Math.PI / 2), [.9, .72, .34]], [new THREE.SphereGeometry(.036, 10, 8), M(0, .14, 0), [.52, .32, .17]]]));
  function lidPiece(x, y, z) { // the lid goes sky-high and clangs back down
    const mesh = new THREE.Mesh(lidGeo(), mats.metal); mesh.position.set(x, y, z); mesh.castShadow = true; scene.add(mesh);
    const a = Math.random() * TAU; pieces.push({mesh, v: new THREE.Vector3(Math.cos(a) * 1.2, 7.5, Math.sin(a) * 1.2), spin: new THREE.Vector3(6 + Math.random() * 4, Math.random() * 3, 3), age: 0, bounces: 0});
  }
  function event(e) {
    if (!e?.kind || !Array.isArray(e.position)) return;
    const at = e.position;
    if (e.kind === 'critter_blast') {
      const key = `${e.id}@${e.tick}`; if (seenBlast.has(key)) return; seenBlast.add(key); if (seenBlast.size > 64) seenBlast.delete(seenBlast.values().next().value);
      boom(at, e.style, e.radius || 3); onSound({kind: e.style === 'keg' ? 'keg_boom' : 'kettle_burst', id: e.id, position: at}); onRumble({position: at, strength: e.style === 'keg' ? 1 : .7});
    } else if (e.kind === 'kettle_build') onSound({kind: 'kettle_whistle', id: e.id, position: at});
    else if (e.kind === 'kettle_vent') { onSound({kind: 'kettle_vent', id: e.id, position: at}); onRumble({position: at, strength: .25}); }
    else if (e.kind === 'kettle_leak') { onSound({kind: 'kettle_leak', id: e.id, position: at}); sparks.emit({x: at[0], y: at[1] + .8, z: at[2], vy: 2, life: .3, size: .3, r: 1.6, g: 1.4, b: 1}); }
    else if (e.kind === 'bramble_curl') onSound({kind: 'hog_rev', id: e.id, position: at});
    else if (e.kind === 'bramble_bowl') { onSound({kind: 'hog_bowl', id: e.id, position: at}); dirt(at[0], at[1] + .3, at[2], n(8), 1.6, 2.4); }
    else if (e.kind === 'bramble_stop') {
      stopInfo.set(e.id, {crash: !!e.crash}); if (stopInfo.size > 64) stopInfo.delete(stopInfo.keys().next().value);
      onSound({kind: e.crash ? 'hog_crash' : 'hog_stop', id: e.id, position: at}); dirt(at[0], at[1] + .1, at[2], n(e.crash ? 16 : 8), 1.4, 2);
      if (e.crash) for (let i = 0; i < n(8); i++) chips.emit({x: at[0], y: at[1] + .7, z: at[2], vx: (Math.random() - .5) * 2, vy: 2 + Math.random(), vz: (Math.random() - .5) * 2, life: 1.6, size: .07, grav: -2.4, drag: 1.2, flutter: 3, ground: true, r: .4, g: .66, b: .26});
    } else if (e.kind === 'bramble_nip') onSound({kind: 'hog_nip', id: e.id, position: at});
    else if (e.kind === 'keg_plant') { onSound({kind: 'keg_plant', id: e.id, position: at}); dirt(at[0], at[1] + .05, at[2], n(6), .6, 1.2); }
  }

  // ---- corpses ----
  function release(entry, snapshot) {
    const visual = entry.visual, c = visual?.userData?.critter; if (!c) return false;
    entry.root.updateMatrixWorld(); entry.root.getWorldPosition(v1);
    const d = entry.data || {}, burrowed = c.kind === 'kegtoter' && d.blastTick !== undefined && (snapshot?.tick ?? 0) - d.blastTick >= S.kegtoter.cheerTicks + S.kegtoter.burrowTicks - 1;
    scene.attach(visual); entry.visual = new THREE.Group(); entry.visual.userData.released = true;
    if (c.kind === 'kettlebelly') { // it always goes up: the blast event (or this, if that event never reached us) bursts it
      const key = [...seenBlast].find(k => k.startsWith(`${d.id}@`)); if (!key) { boom([v1.x, v1.y, v1.z], 'kettle', S.kettlebelly.burstRadius); seenBlast.add(`${d.id}@release`); onSound({kind: 'kettle_burst', id: d.id, position: v1.toArray()}); }
      endCorpse({visual, c}); return true;
    }
    if (burrowed) { endCorpse({visual, c}); return true; }
    if (c.keg) c.keg.visible = false;
    const side = rnd(c.seed, 5) < .5 ? -1 : 1;
    corpses.push({visual, c, age: 0, side, axis: v2.set(0, 0, 1).applyQuaternion(visual.quaternion).clone()});
    onSound({kind: c.kind === 'bramblehog' ? 'hog_squeal' : 'mole_squeak', id: d.id, position: v1.toArray(), last: true});
    return true;
  }
  function endCorpse(k) { k.visual.removeFromParent(); k.c.mesh.skeleton.dispose(); k.c.glowMat?.dispose(); k.c.moleMat?.dispose(); states.delete(k.visual); }
  function tick(dt) {
    for (let i = corpses.length - 1; i >= 0; i--) { // flops over (a hog lands on its back, legs up) and sinks into a puff
      const k = corpses[i], c = k.c; k.age += dt;
      const fall = smooth(k.age / .45) * (c.kind === 'bramblehog' ? 2.6 : 1.5) * k.side; c.pivot.rotation.set(0, 0, fall);
      c.lift.position.y = Math.max(0, Math.sin(clamp(k.age / .35) * Math.PI)) * .18;
      if (c.kind === 'bramblehog') for (const name of ['TrotA', 'TrotB', 'TrotC', 'TrotD']) rot(c, name, Math.sin(k.age * 30 + name.charCodeAt(4)) * .4 * Math.exp(-k.age * 2));
      if (!k.puff && k.age > .5) { k.puff = true; k.visual.getWorldPosition(v1); dirt(v1.x, height(v1.x, v1.z) + .1, v1.z, n(16), 1.2); puff(v1.x, height(v1.x, v1.z) + .2, v1.z, 0, .6, 0, {size: .3, grow: 1.5, life: 1.1, alpha: .5, tint: .7}); }
      if (k.age > .9) { const s = smooth((k.age - .9) / .6); c.base.position.y = -PIVOT[c.kind] - s * .5; c.pivot.scale.setScalar(Math.max(.001, 1 - s)); }
      if (k.age > 1.5) { endCorpse(k); corpses.splice(i, 1); }
    }
    for (let i = blasts.length - 1; i >= 0; i--) {
      const b = blasts[i]; b.age += dt; const u = b.age / (b.keg ? .55 : .45), r = b.age / .5;
      b.ball.scale.setScalar(b.radius * (b.keg ? .38 : .28) * (.3 + .7 * smooth(u))); b.ball.material.opacity = (1 - smooth(u)) ** 2 * (b.keg ? .6 : .35);
      b.ring.scale.setScalar(.4 + b.radius * smooth(r)); b.ring.material.opacity = (1 - smooth(r)) ** 1.5 * .45;
      if (b.age > .6) { b.ball.removeFromParent(); b.ring.removeFromParent(); b.ball.material.dispose(); b.ring.material.dispose(); blasts.splice(i, 1); }
    }
    for (let i = pieces.length - 1; i >= 0; i--) {
      const p = pieces[i]; p.age += dt; p.v.y -= 14 * dt; p.mesh.position.addScaledVector(p.v, dt); p.mesh.rotation.x += p.spin.x * dt; p.mesh.rotation.y += p.spin.y * dt; p.mesh.rotation.z += p.spin.z * dt;
      const gy = height(p.mesh.position.x, p.mesh.position.z) + .05;
      if (p.mesh.position.y < gy && p.v.y < 0) { p.mesh.position.y = gy; p.v.y *= -.35; p.v.x *= .5; p.v.z *= .5; p.spin.multiplyScalar(.4); if (p.bounces++ < 2) onSound({kind: 'kettle_clang', position: p.mesh.position.toArray(), small: true}); }
      if (p.age > 3.2) { const s = smooth((p.age - 3.2) / .5); p.mesh.scale.setScalar(Math.max(.001, 1 - s)); }
      if (p.age > 3.7) { p.mesh.removeFromParent(); pieces.splice(i, 1); }
    }
    steam.tick(dt, height); sparks.tick(dt, height); chips.tick(dt, height);
  }
  function stats() { return {corpses: corpses.length, blasts: blasts.length, pieces: pieces.length, steam: steam.count(), sparks: sparks.count(), chips: chips.count()}; }
  function dispose() {
    for (const k of corpses) endCorpse(k); corpses.length = 0;
    for (const b of blasts) { b.ball.removeFromParent(); b.ring.removeFromParent(); b.ball.material.dispose(); b.ring.material.dispose(); } blasts.length = 0;
    for (const p of pieces) p.mesh.removeFromParent(); pieces.length = 0;
    steam.dispose(); sparks.dispose(); chips.dispose(); tex.dispose(); flash.dispose(); flashGeo.dispose(); ringGeo.dispose();
    for (const g of Object.values(geo)) g.dispose(); for (const m of Object.values(mats)) m.dispose();
  }
  return {build, update, release, event, tick, stats, dispose};
}
