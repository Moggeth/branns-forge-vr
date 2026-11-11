// The Pick of Riches: presentation for the HELD pick (assets-source/pick-of-riches, public/assets/pick.glb).
// Everything here is local and per frame on the presentation clock; the shared simulation owns every hit and charge.
//
// The pick is an assayer's tool: its gold seam carries resonance, its crystals answer stone and ore, its points are
// glass-hard steel. What you see follows from that (mechanical coherence):
//   * Strike stone, ore or crystal: the struck point flashes hot, a bright front runs down the gold seam to the heart,
//     the heart rings (light flash, chime) and the ring runs on out along the other arm. Blue crystal shards and gold
//     flecks leave the bite. Rich ore rings harder and sheds gold dust.
//   * Dowsing: the nearer ore lies, the faster the heart beats, and the arm that points at it glows brighter.
//   * Light: ONE permanent blue point light rides the heart (the light budget slots it; never added or removed).
//     Stronger at night, flares on strikes and when the charge completes. Off on phones (the gem glow carries it).
//   * Glints: sun glints on the points and the crown when they catch it, and a glint that sweeps the spine from the
//     eye to each point when you draw the pick, when it comes back to full charge and when you admire it.
//   * Motes: blue resonance motes rise from the crystals (more when charged) and trail behind a swing; gold dust falls.
//   * Pose layer: a tuning-fork shiver when the charge completes, and after a while standing still, the hero turns the
//     pick to look at the heart stone. Any input cancels it at once.
//   * Charm: the assayer's tag swings on its thong from the pommel.
// Budget: 1 light (desktop), 2 draws (motes/shards, glints), no textures, ~100 instances. Reduced motion: no admire,
// no shiver, no drifting motes; strikes still read.
import * as THREE from 'three';
import {PICK_FX, pickGemClusters} from './pick-luminance.js';

export const RICHES = Object.freeze({
  light: {color: 0x7ab8ff, distance: 3.4, day: .45, night: 1.5, flash: 2.6, ready: 1.8},
  seam: {run: .2, ring: .28},
  heat: {seconds: 1.1},
  dowse: {range: 14, every: 6},
  admire: {after: 8, rise: .85, hold: 1.4, fall: .7, rest: 24},
  pool: 112, glints: 8,
});

// The arm's spine in the model's own space (mirrors build_pick_of_riches.py): glTF y = Blender z.
const REACH = .322, EYE_Z = .622;
const clamp01 = x => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));
const smooth = x => { x = clamp01(x); return x * x * (3 - 2 * x); };
function spinePoint(x, target = new THREE.Vector3()) {
  const t = clamp01(Math.abs(x) / REACH), fillet = 1 + .42 * Math.exp(-((t / .115) ** 2));
  return target.set(x, EYE_Z + .012 - .118 * t ** 1.85 + (.03 * (1 - t) ** .82 + .0011) * fillet + .001, 0);
}

// ---------------------------------------------------------------- particles (motes, dust, shards): one draw
const PARTICLE_VERTEX = /* glsl */`
attribute vec4 aTint;
attribute vec3 aVel;
varying vec4 vTint;
varying vec2 vUv;
varying float vStretch;
void main() {
  vTint = aTint; vUv = position.xy * 2.;
  vec4 mv = viewMatrix * vec4(instanceMatrix[3].xyz, 1.);
  float size = length(instanceMatrix[0].xyz);
  vec3 vv = (viewMatrix * vec4(aVel, 0.)).xyz;
  float speed = length(vv.xy);
  vec2 along = speed > 1e-4 ? vv.xy / speed : vec2(0., 1.);
  float stretch = 1. + min(speed * .045 / max(size, 1e-4), 5.);
  vStretch = stretch;
  vec2 across = vec2(-along.y, along.x);
  mv.xy += (across * position.x + along * position.y * stretch) * size;
  gl_Position = projectionMatrix * mv;
}
`;
const PARTICLE_FRAGMENT = /* glsl */`
varying vec4 vTint;
varying vec2 vUv;
varying float vStretch;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1. || vTint.a <= .001) discard;
  float core = exp(-r2 * 9.), soft = (1. - r2) * (1. - r2);
  gl_FragColor = vec4(vTint.rgb * (core * 1.1 + soft * .3) * vTint.a, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
// Star glints: a hot core and four tapering rays, rotated per instance.
const GLINT_VERTEX = /* glsl */`
attribute vec4 aGlint; // rgb, angle
varying vec2 vUv;
varying vec3 vColor;
void main() {
  float size = length(instanceMatrix[0].xyz);
  vColor = aGlint.rgb; float c = cos(aGlint.a), s = sin(aGlint.a);
  vUv = mat2(c, -s, s, c) * position.xy * 2.;
  vec4 mv = viewMatrix * vec4(instanceMatrix[3].xyz, 1.);
  mv.xyz += normalize(-mv.xyz) * size * .2;
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;
}
`;
const GLINT_FRAGMENT = /* glsl */`
varying vec2 vUv;
varying vec3 vColor;
void main() {
  vec2 a = abs(vUv);
  if (max(a.x, a.y) > 1. || dot(vColor, vColor) < 1e-6) discard;
  float r2 = dot(vUv, vUv);
  float rays = exp(-a.y * 46.) * (1. - a.x) + exp(-a.x * 46.) * (1. - a.y);
  float diag = (exp(-abs(vUv.x - vUv.y) * 60.) + exp(-abs(vUv.x + vUv.y) * 60.)) * max(0., 1. - sqrt(r2) * 1.6) * .35;
  float core = exp(-r2 * 60.) * 1.4 + exp(-r2 * 9.) * .25;
  gl_FragColor = vec4(vColor * (rays + diag + core), 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const KIND = {mote: 0, dust: 1, shard: 2, spark: 3};
const BLUE = new THREE.Color(.32, .68, 1.0), PALE = new THREE.Color(.75, .9, 1.0), GOLD = new THREE.Color(1.0, .76, .32), HOT = new THREE.Color(1.0, .55, .18);

/**
 * createPickRiches({scene, camera, realLight, reducedMotion, audio}) -> {attach(model|null), update(frame), strike(hit),
 * slam(), pose(time) -> {offset, quaternion} | null, stats(), dispose()}.
 * frame: {time, dt, charge, shown, swinging, moving, sun: Vector3 (direction to the sun), night: 0..1,
 *         deposits: [{x, z, kind, depleted}], player: Vector3, vr}
 * hit:   {material, kind, point: [x,y,z], normal: [x,y,z], rich}
 */
export function createPickRiches({scene, camera, realLight = true, reducedMotion = false, audio = () => null} = {}) {
  // ---- particles
  const quad = new THREE.PlaneGeometry(1, 1);
  const tint = new THREE.InstancedBufferAttribute(new Float32Array(RICHES.pool * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const vel = new THREE.InstancedBufferAttribute(new Float32Array(RICHES.pool * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const pGeometry = quad.clone(); pGeometry.setAttribute('aTint', tint); pGeometry.setAttribute('aVel', vel);
  const pMaterial = new THREE.ShaderMaterial({vertexShader: PARTICLE_VERTEX, fragmentShader: PARTICLE_FRAGMENT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending});
  pMaterial.name = 'pick-riches:particles';
  const particles = new THREE.InstancedMesh(pGeometry, pMaterial, RICHES.pool);
  particles.frustumCulled = false; particles.renderOrder = 3; particles.count = 0; particles.userData.ignoreContact = true; particles.name = 'pick-riches:particles';
  particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(particles);
  const P = Array.from({length: RICHES.pool}, () => ({alive: false, kind: 0, age: 0, life: 1, size: .01, seed: 0,
    p: new THREE.Vector3(), v: new THREE.Vector3(), color: new THREE.Color()}));
  let nextSlot = 0;
  function spawn(kind, position, velocity, life, size, color) {
    let slot = null;
    for (let i = 0; i < RICHES.pool; i++) { const c = P[(nextSlot + i) % RICHES.pool]; if (!c.alive) { slot = c; nextSlot = (nextSlot + i + 1) % RICHES.pool; break; } }
    if (!slot) { slot = P[nextSlot]; nextSlot = (nextSlot + 1) % RICHES.pool; }  // oldest-ish gets recycled
    Object.assign(slot, {alive: true, kind, age: 0, life, size, seed: Math.random() * 100});
    slot.p.copy(position); slot.v.copy(velocity); slot.color.copy(color);
    return slot;
  }

  // ---- glints
  const glintAttr = new THREE.InstancedBufferAttribute(new Float32Array(RICHES.glints * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const gGeometry = quad.clone(); gGeometry.setAttribute('aGlint', glintAttr);
  const gMaterial = new THREE.ShaderMaterial({vertexShader: GLINT_VERTEX, fragmentShader: GLINT_FRAGMENT, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending});
  gMaterial.name = 'pick-riches:glints';
  const glints = new THREE.InstancedMesh(gGeometry, gMaterial, RICHES.glints);
  glints.frustumCulled = false; glints.renderOrder = 4; glints.count = 0; glints.userData.ignoreContact = true; glints.name = 'pick-riches:glints';
  glints.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(glints);

  // ---- light (permanent; intensity 0 when away)
  const light = realLight ? new THREE.PointLight(RICHES.light.color, 0, RICHES.light.distance, 2) : null;
  if (light) { light.name = 'pick-riches:heart-light'; light.userData.ignoreContact = true; scene.add(light); }

  // ---- held model
  let model = null, root = null, nodes = null, emitters = [], charm = null;
  const W = {heart: new THREE.Vector3(), tipR: new THREE.Vector3(), tipL: new THREE.Vector3(), crown: new THREE.Vector3(), up: new THREE.Vector3(), side: new THREE.Vector3(), out: new THREE.Vector3()};
  const rootQ = new THREE.Quaternion(), invRootQ = new THREE.Quaternion(), lastHeart = new THREE.Vector3(), headVel = new THREE.Vector3();
  let hasLast = false;
  function attach(next) {
    if (next === model) return;
    model = next; root = null; nodes = null; emitters = []; charm = null; hasLast = false;
    if (!model) return;
    root = model.getObjectByName('StonewhisperPick') || model;
    const find = name => model.getObjectByName(name);
    nodes = {heart: find('Heart') || find('ChargeGlow'), tipR: find('PickTipRight'), tipL: find('PickTipLeft'), crown: find('Crown')};
    if (!nodes.heart || !nodes.tipR || !nodes.tipL) { nodes = null; return; }
    model.updateWorldMatrix(true, true);
    const gems = ['ResonanceCrystal', 'Embellish_Crystal_Crown'].map(find).filter(o => o?.isMesh);
    try { emitters = pickGemClusters(gems, root).map(c => ({center: c.center.clone(), size: Math.max(c.size.x, c.size.y, c.size.z), crown: c.mesh.name === 'Embellish_Crystal_Crown'})); } catch { emitters = []; }
    const pivot = find('Charm');
    if (pivot && !reducedMotion) {
      charm = {node: pivot, rest: pivot.quaternion.clone(), bob: new THREE.Vector3(), prev: new THREE.Vector3(), length: 0, ready: false};
    }
    trigger('sweep', .28); flash = Math.max(flash, .5);
  }

  // ---- state
  let time = 0, flash = 0, beatPhase = 0, beat = 0, dowse = 0, dowseTarget = 0, frame = 0, wasReady = null;
  const dowseDir = new THREE.Vector3(1, 0, 0), dowseWorld = new THREE.Vector3();
  let seam = null, heat = [0, 0], sweep = null, shiver = -Infinity, admire = null, still = 0, lastAdmire = -Infinity, chimeGate = -Infinity;
  const timers = [];
  function trigger(what, delay = 0) { timers.push({what, at: time + delay}); }

  // ---- audio: struck crystal, synthesised (no assets)
  function chime(freqs, gain = .05, decay = 1.4, at = 0) {
    const c = audio?.(); if (!c || c.state !== 'running') return;
    const t = c.currentTime + at, out = c.createGain(); out.gain.value = gain; out.connect(c.destination);
    freqs.forEach((f, i) => {
      for (const [mult, amp] of [[1, 1], [2.76, .28], [5.4, .08]]) {
        const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = f * mult * (1 + (Math.random() - .5) * .004);
        g.gain.setValueAtTime(0, t + i * .035); g.gain.linearRampToValueAtTime(amp / freqs.length, t + i * .035 + .004);
        g.gain.exponentialRampToValueAtTime(.0001, t + i * .035 + decay / mult ** .4);
        o.connect(g).connect(out); o.start(t + i * .035); o.stop(t + i * .035 + decay + .1);
      }
    });
  }

  // ---- world helpers
  const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _n = new THREE.Vector3(), _c = new THREE.Color(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
  const toWorld = (local, target) => root.localToWorld(target.copy(local));
  function emitterWorld(e, target) { return toWorld(e.center, target); }

  /** A blow landed (called the frame the strike packet leaves). */
  function strike(hit = {}) {
    if (!nodes || !hit.point) return;
    const hard = ['stone', 'crystal', 'metal'].includes(hit.material), rich = !!hit.rich || hit.material === 'crystal';
    const point = hit.point.isVector3 ? _v.copy(hit.point) : _v.fromArray(hit.point);
    const normal = hit.normal?.isVector3 ? _n.copy(hit.normal) : _n.fromArray(hit.normal || [0, 1, 0]); normal.normalize();
    if (hard) {
      seam = {at: time, strength: rich ? 1.25 : 1};
      heat[0] = Math.min(1.2, heat[0] + (hit.material === 'metal' ? .55 : .95));
      flash = Math.max(flash, rich ? 1 : .7);
      const shards = rich ? 16 : 9;
      for (let i = 0; i < shards; i++) {
        const out = new THREE.Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(2.2).addScaledVector(normal, 1.6 + Math.random() * 1.6);
        const gold = i % 3 === 0 || (rich && i % 2 === 0);
        spawn(KIND.shard, point, out, .32 + Math.random() * .35, gold ? .0045 : .006, gold ? GOLD : PALE);
      }
      if (rich) for (let i = 0; i < 14; i++) {
        const out = new THREE.Vector3((Math.random() - .5) * .9, .6 + Math.random() * 1.2, (Math.random() - .5) * .9).addScaledVector(normal, .5);
        spawn(KIND.dust, point, out, .9 + Math.random() * .8, .0035 + Math.random() * .003, GOLD);
      }
      if (time - chimeGate > .09) {
        chimeGate = time;
        // The heart rings as the front arrives: a fifth for stone, a bright major chord for rich ore.
        chime(rich ? [1318.5, 1661.2, 1975.5, 2637] : hit.material === 'metal' ? [1174.7, 1760] : [1046.5, 1568], rich ? .055 : .035, rich ? 2 : 1.3, RICHES.seam.run);
      }
    } else if (hit.material === 'earth' || hit.material === 'wood') {
      seam = {at: time, strength: .35};
    }
  }
  /** The crystal-wall slam landed: everything flares and the seam rings both ways at once. */
  function slam(delay = 0) {
    if (!nodes) return;
    if (delay > 0) { trigger('slam', delay); return; }
    seam = {at: time - RICHES.seam.run, strength: 1.3}; flash = 1.2; heat[0] = heat[1] = .8;
    chime([783.99, 1174.66, 1567.98], .05, 2.2);
    trigger('sweep', .05);
  }

  // ---- pose layer (camera space; game.js adds offset and premultiplies quaternion, like the wall motion)
  const layer = {offset: new THREE.Vector3(), quaternion: new THREE.Quaternion()};
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1), D = Math.PI / 180;
  function pose() {
    if (!nodes || reducedMotion) return null;
    let x = 0, y = 0, z = 0, pitch = 0, yaw = 0, roll = 0, any = false;
    const sh = time - shiver;
    if (sh >= 0 && sh < .55) {
      const k = (1 - sh / .55) ** 2; roll += Math.sin(sh * 74) * 1.3 * k; pitch += Math.sin(sh * 61 + 1) * .5 * k; y += Math.sin(sh * 53) * .0015 * k; any = true;
    }
    if (admire) {
      const A = RICHES.admire, t = time - admire.at;
      const w = admire.leaving !== undefined ? (1 - smooth((time - admire.leaving) / .22)) * admire.from
        : t < A.rise ? smooth(t / A.rise) : t < A.rise + A.hold ? 1 : 1 - smooth((t - A.rise - A.hold) / A.fall);
      if (admire.leaving === undefined) admire.from = w;
      const breathe = Math.sin(t * 1.7) * .05;
      x += -.07 * w; y += .045 * w; z += .03 * w; yaw += (34 + breathe * 20) * w; roll += -14 * w; pitch += 8 * w; any = w > 1e-3;
    }
    if (!any) return null;
    layer.offset.set(x, y, z);
    layer.quaternion.setFromAxisAngle(Z, -roll * D).multiply(_q.setFromAxisAngle(Y, yaw * D)).multiply(_q.setFromAxisAngle(X, pitch * D));
    return layer;
  }

  // ---- per frame
  const sunDir = new THREE.Vector3(.4, .8, .3), view = new THREE.Vector3(), refl = new THREE.Vector3();
  function specular(position, normals, power = 70) {
    view.copy(camera.getWorldPosition(_w)).sub(position).normalize();
    let best = 0;
    for (const n of normals) { refl.copy(sunDir).reflect(n).negate(); best = Math.max(best, refl.dot(view)); }
    return Math.max(0, best) ** power;
  }
  const tipNormals = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const crownNormals = Array.from({length: 6}, () => new THREE.Vector3());
  let glintCount = 0;
  function glint(position, size, color, strength, angle) {
    if (strength < .02 || glintCount >= RICHES.glints) return;
    glints.setMatrixAt(glintCount, _m.compose(position, _q.identity(), _s.setScalar(size)));
    glintAttr.setXYZW(glintCount, color.r * strength, color.g * strength, color.b * strength, angle);
    glintCount++;
  }

  function update({time: now = 0, dt = 1 / 60, charge = 1, shown = false, swinging = false, moving = false, sun, night = 0, deposits = [], player, vr = false} = {}) {
    time = now; dt = Math.min(.1, Math.max(0, dt)); frame++;
    if (sun) sunDir.copy(sun).normalize();
    const active = shown && !!nodes;
    // timers
    for (let i = timers.length - 1; i >= 0; i--) if (time >= timers[i].at) { const t = timers.splice(i, 1)[0]; if (t.what === 'sweep' && active) sweep = {at: time}; else if (t.what === 'slam') slam(); }
    // charge completion: shiver, sweep, chime, flare
    const ready = charge >= .999;
    if (active && wasReady === false && ready) { shiver = time; sweep = {at: time}; flash = Math.max(flash, .8); chime([1568, 2349.3], .03, 1.6); }
    wasReady = active ? ready : null;

    flash = Math.max(0, flash - dt * 2.4);
    heat[0] = Math.max(0, heat[0] - dt / RICHES.heat.seconds); heat[1] = Math.max(0, heat[1] - dt / RICHES.heat.seconds);

    // seam front: right point -> heart (run), heart rings, then heart -> left point (ring)
    const S = PICK_FX.uPickSeam.value; S.set(0, 0, 0, 0);
    let seamFlash = 0;
    if (seam) {
      const e = time - seam.at, {run, ring} = RICHES.seam;
      if (e < run) S.set(1 - e / run, seam.strength, 0, 0);
      else if (e < run + ring) {
        const u = (e - run) / ring; S.set(0, seam.strength * (1 - u) * .6, u, seam.strength * .85 * (1 - u * .5));
        seamFlash = Math.exp(-(e - run) * 9) * seam.strength;
      } else if (e < run + ring + .4) { const f = 1 - (e - run - ring) / .4; S.set(0, 0, 1, seam.strength * .4 * f); }
      else seam = null;
      if (seamFlash > .5 && !seam?.flashed) { seam.flashed = true; flash = Math.max(flash, seamFlash * .9); }
    }

    // dowsing: nearest ore within range (rich ore counts double), every few frames, eased every frame
    if (active && player && frame % RICHES.dowse.every === 0) {
      let best = Infinity, bx = 0, bz = 0;
      for (const d of deposits) {
        if (!d || d.depleted) continue;
        const rich = d.kind && d.kind !== 'stone', dist = Math.hypot(d.x - player.x, d.z - player.z) / (rich ? 1.35 : 1);
        if (dist < best) { best = dist; bx = d.x; bz = d.z; }
      }
      dowseTarget = best < RICHES.dowse.range ? (1 - best / RICHES.dowse.range) ** 1.6 : 0;
      if (dowseTarget > 0) dowseWorld.set(bx, player.y ?? 0, bz);
    }
    dowse += ((active ? dowseTarget : 0) - dowse) * Math.min(1, dt * 3);
    // heartbeat: lub-dub, faster as ore nears
    beatPhase = (beatPhase + dt * (.55 + 1.7 * dowse)) % 1;
    const lub = Math.exp(-(((beatPhase - .08) / .045) ** 2)), dub = Math.exp(-(((beatPhase - .26) / .05) ** 2)) * .6;
    beat = (lub + dub) * (.12 + .88 * dowse) * (ready ? 1 : .5);
    PICK_FX.uPickBeat.value = active ? Math.min(1.6, beat * .75 + flash * .9) : 0;
    PICK_FX.uPickHeat.value.set(heat[0], heat[1]);
    PICK_FX.uPickReady.value = active ? (ready ? 1 : .25 * charge) : 0;
    PICK_FX.uPickFxTime.value = time % 1000;

    glintCount = 0; let pc = 0;
    if (active) {
      model.updateWorldMatrix(true, true);
      root.getWorldQuaternion(rootQ); invRootQ.copy(rootQ).invert();
      nodes.heart.getWorldPosition(W.heart); nodes.tipR.getWorldPosition(W.tipR); nodes.tipL.getWorldPosition(W.tipL);
      if (nodes.crown) nodes.crown.getWorldPosition(W.crown); else W.crown.copy(W.heart);
      W.up.set(0, 1, 0).applyQuaternion(rootQ); W.side.set(0, 0, 1).applyQuaternion(rootQ); W.out.set(1, 0, 0).applyQuaternion(rootQ);
      if (hasLast && dt > 0) headVel.copy(W.heart).sub(lastHeart).divideScalar(dt); else headVel.set(0, 0, 0);
      lastHeart.copy(W.heart); hasLast = true;
      const speed = headVel.length();
      if (dowse > .01) PICK_FX.uPickDowse.value.set(_v.copy(dowseWorld).sub(W.heart).applyQuaternion(invRootQ).normalize().x, 0, 0, dowse);
      else PICK_FX.uPickDowse.value.set(0, 0, 0, 0);

      // light
      if (light) {
        light.position.copy(W.heart).addScaledVector(W.up, .02);
        const L = RICHES.light, base = THREE.MathUtils.lerp(L.day, L.night, night) * (.25 + .75 * charge * charge);
        light.intensity = base * (1 + beat * .35) + flash * L.flash + (time - shiver < .5 ? L.ready * (1 - (time - shiver) / .5) : 0);
      }

      // motes: blue from the crystals (rise), more when charged; trail naturally because they live in world space
      if (!reducedMotion && emitters.length) {
        const rate = (1.2 + 5 * charge * charge + 7 * dowse + Math.min(speed, 6) * 2.2) * dt;
        let n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
        while (n-- > 0) {
          const e = emitters[(Math.random() * emitters.length) | 0];
          emitterWorld(e, _v).addScaledVector(W.up, e.size * .3);
          const v = new THREE.Vector3((Math.random() - .5) * .04, .05 + Math.random() * .08, (Math.random() - .5) * .04).addScaledVector(headVel, -.08);
          spawn(KIND.mote, _v, v, 1.1 + Math.random() * 1.1, (e.crown ? .0075 : .0055) * (.7 + Math.random() * .6), BLUE);
        }
        // gold dust shaken off the seam by fast swings
        if (swinging && speed > 2.5 && Math.random() < dt * 14) {
          spinePoint((Math.random() < .5 ? 1 : -1) * (.06 + Math.random() * .17), _w);
          spawn(KIND.dust, toWorld(_w, _v), headVel.clone().multiplyScalar(.25).add(new THREE.Vector3(0, -.2, 0)), .8 + Math.random() * .6, .003 + Math.random() * .0025, GOLD);
        }
      }

      // glints: sun on the points and crown facets; the sweep along the spine
      const scale = W.out.length() > 0 ? root.getWorldScale(_s).x : 1;
      tipNormals[0].copy(W.up); tipNormals[1].copy(W.side); tipNormals[2].copy(W.side).negate(); tipNormals[3].copy(W.up).negate().addScaledVector(W.out, .5).normalize();
      const sR = specular(W.tipR, tipNormals), sL = specular(W.tipL, tipNormals);
      const sunUp = clamp01(sunDir.y * 3) * (1 - night * .8);
      glint(W.tipR, .07 * scale, PALE, Math.min(1.4, sR * 2.2 * sunUp + heat[0] * .45), time * .4);
      glint(W.tipL, .07 * scale, PALE, Math.min(1.4, sL * 2.2 * sunUp + heat[1] * .45), -time * .3);
      for (let k = 0; k < 6; k++) {
        const a = k / 6 * Math.PI * 2 + .3;
        crownNormals[k].copy(W.up).multiplyScalar(.45).addScaledVector(W.side, Math.cos(a)).addScaledVector(W.out, Math.sin(a)).normalize();
      }
      const sC = specular(W.crown, crownNormals, 50);
      glint(W.crown, .06 * scale, BLUE.clone().lerp(PALE, .6), Math.min(1.2, sC * 1.8 * sunUp + flash * .6), .6);
      if (sweep) {
        const u = (time - sweep.at) / .42;
        if (u >= 1) sweep = null;
        else for (const side of [1, -1]) {
          const x = side * (.05 + (REACH - .06) * smooth(u));
          toWorld(spinePoint(x, _w), _v);
          glint(_v, (.05 + .05 * Math.sin(Math.PI * u)) * scale, PALE, Math.sin(Math.PI * u) * 1.3, side * u * 2);
        }
      }

      // the charm swings on its thong (verlet bob under gravity, length taken from the authored tag)
      if (charm) {
        const pivotW = charm.node.getWorldPosition(_w);
        if (!charm.ready) {
          charm.node.quaternion.copy(charm.rest); charm.node.updateWorldMatrix(false, false);
          charm.length = charm.node.localToWorld(_v.set(0, -.026, 0)).distanceTo(pivotW);
          charm.bob.copy(_v); charm.prev.copy(_v); charm.ready = true;
        }
        const next = charm.bob.clone().multiplyScalar(2).sub(charm.prev).addScaledVector(charm.bob.clone().sub(charm.prev), -.12);
        next.y -= 9.8 * dt * dt;
        charm.prev.copy(charm.bob); charm.bob.copy(next);
        const d = charm.bob.clone().sub(pivotW); if (d.lengthSq() < 1e-10) d.set(0, -1, 0);
        charm.bob.copy(pivotW).addScaledVector(d.normalize(), charm.length);
        // orient: the node's local -Y toward the bob, in its parent's space
        const parentQ = charm.node.parent.getWorldQuaternion(_q).invert();
        const local = d.applyQuaternion(parentQ).normalize();
        charm.node.quaternion.setFromUnitVectors(_n.set(0, -1, 0), local);
      }
    } else {
      if (light) light.intensity = 0;
      PICK_FX.uPickDowse.value.set(0, 0, 0, 0); hasLast = false;
      if (charm) charm.ready = false;
    }

    // idle admire: standing still, not swinging, a while since the last one
    if (active && !vr && !reducedMotion) {
      const busy = swinging || moving;
      if (busy) { still = 0; if (admire && admire.leaving === undefined) admire.leaving = time; }
      else still += dt;
      const A = RICHES.admire;
      if (!admire && still > A.after && time - lastAdmire > A.rest) { admire = {at: time}; lastAdmire = time; trigger('sweep', A.rise + .25); }
      if (admire && (admire.leaving !== undefined ? time - admire.leaving > .22 : time - admire.at > A.rise + A.hold + A.fall)) admire = null;
    } else { admire = null; still = 0; }

    // integrate particles
    for (const c of P) {
      if (!c.alive) continue;
      c.age += dt; if (c.age >= c.life) { c.alive = false; continue; }
      if (c.kind === KIND.mote) {
        c.v.multiplyScalar(1 - dt * 1.4); c.v.y += dt * .03;
        c.v.x += Math.sin(time * 2.1 + c.seed) * dt * .05; c.v.z += Math.cos(time * 1.7 + c.seed) * dt * .05;
      } else if (c.kind === KIND.dust) { c.v.multiplyScalar(1 - dt * 2.2); c.v.y -= dt * 1.4; }
      else { c.v.multiplyScalar(1 - dt * 1.2); c.v.y -= dt * 9.8; }
      c.p.addScaledVector(c.v, dt);
      const u = c.age / c.life;
      let a = c.kind === KIND.mote ? Math.sin(Math.PI * u) * .55 : c.kind === KIND.dust ? (1 - u) * (.55 + .45 * Math.sin(time * 31 + c.seed * 7)) : (1 - u * u) * 1.2;
      if (pc >= RICHES.pool) break;
      particles.setMatrixAt(pc, _m.makeScale(c.size, c.size, c.size).setPosition(c.p));
      _c.copy(c.color); if (c.kind === KIND.shard && u < .25) _c.lerp(HOT, 1 - u * 4);
      tint.setXYZW(pc, _c.r, _c.g, _c.b, Math.max(0, a));
      vel.setXYZ(pc, c.kind === KIND.mote ? 0 : c.v.x, c.kind === KIND.mote ? 0 : c.v.y, c.kind === KIND.mote ? 0 : c.v.z);
      pc++;
    }
    particles.count = pc; glints.count = glintCount;
    if (pc) { particles.instanceMatrix.needsUpdate = true; tint.needsUpdate = true; vel.needsUpdate = true; }
    if (glintCount) { glints.instanceMatrix.needsUpdate = true; glintAttr.needsUpdate = true; }
    particles.visible = pc > 0; glints.visible = glintCount > 0;
  }

  function dispose() {
    attach(null);
    particles.removeFromParent(); glints.removeFromParent(); light?.removeFromParent();
    quad.dispose(); pGeometry.dispose(); gGeometry.dispose(); pMaterial.dispose(); gMaterial.dispose(); particles.dispose(); glints.dispose();
    PICK_FX.uPickSeam.value.set(0, 0, 0, 0); PICK_FX.uPickDowse.value.set(0, 0, 0, 0); PICK_FX.uPickHeat.value.set(0, 0); PICK_FX.uPickBeat.value = 0;
  }
  return {attach, update, strike, slam, pose, dispose,
    get admiring() { return !!admire; },
    stats: () => ({particles: particles.count, glints: glints.count, light: light?.intensity ?? null, dowse, beat, seam: !!seam, admiring: !!admire})};
}
