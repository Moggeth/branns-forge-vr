import * as THREE from 'three';
import {TIMBERFALL, timberfallLane} from '../shared/timberfall.js';

// Kingsfell's Timberfall presentation (2026-10-16). Presentation only: everything here is drawn from the shared cast
// event (lane start, direction, length, speed) and the 'heartwood' events; it never decides a hit or a felled tree.
//   preview   while Special is held: the lane on the live terrain as an amber band with chevrons streaming away, and a
//             ring at the foot of every tree it will fell (the same plan the authority runs). Dim and dashed when
//             Timberfall is still recharging.
//   wave      the cast: a standing blade of amber light, shaped like Kingsfell's own edge, runs down the lane at the
//             authority's speed (rendered every frame from the time since the cast, so it is smooth at any frame
//             rate). Behind it the ground is scored with a glowing seam that cools, chips and leaves spray from the
//             front, and a shock ring blooms where the axe bit.
//   heartwood a felled tree with a rich heart throws a column of light and a fountain of glints in its treasure's
//             colour, with a chime. The promised amberheart gets the biggest one.
// Budget: wave = 4 draws (blade, seam, sparks, ring) while alive, pool of 3; preview = 2 draws; heartwood = 2 draws,
// pool of 6. Preallocated geometry, no lights, no post, no per-frame allocation. Reduced motion drops sparks.

const AMBER = new THREE.Color(1.0, .38, .03), HOT = new THREE.Color(1.0, .72, .3), DIM = new THREE.Color(.62, .44, .26);
export const HEART_COLOURS = Object.freeze({amber: [1.0, .52, .1], gold: [1.0, .82, .32], gems: [.72, .5, 1.0]});
const POOL = 3, HEART_POOL = 6, ALONG = 48, SPARKS = 72, GLINTS = 28, RING_MARKS = TIMBERFALL.trees;
export const TIMBERFALL_VIEW = Object.freeze({fade: 1.3, bladeHeight: 3.4, bladeHalf: 1.7, bulge: 1.1, heartLife: 1.7});

const finish = `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>`;
const additive = (uniforms, vertexShader, fragmentShader, extra = {}) => new THREE.ShaderMaterial({uniforms, vertexShader, fragmentShader,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: true, ...extra});

// ---------------------------------------------------------------- the blade of light
// aBlade.x: -1..1 across the lane, aBlade.y: 0 ground .. 1 crest. The crest is a half-ellipse (the axe's edge stood on
// end) that bulges forward at its middle, so from above it reads as a crescent leading down the lane.
const BLADE_VERTEX = `
attribute vec2 aBlade;
uniform float uHalf, uHeight, uBulge, uLean;
varying vec2 vBlade;
void main() {
  vBlade = aBlade;
  float crest = sqrt(max(0., 1. - aBlade.x * aBlade.x));
  float y = aBlade.y * uHeight * (.28 + .72 * crest);
  vec3 p = vec3(aBlade.x * uHalf, y, -uBulge * crest * (.4 + .6 * aBlade.y) - uLean * y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.);
}`;
const BLADE_FRAGMENT = `
uniform float uFade, uFlicker;
uniform vec3 uGlow, uHot;
varying vec2 vBlade;
void main() {
  float crest = sqrt(max(0., 1. - vBlade.x * vBlade.x));
  float edge = exp(-(1. - vBlade.y) * 22.);            // the burning cutting line along the crest
  float halo = exp(-(1. - vBlade.y) * 5.) * .22;       // its glow just beneath
  float streak = pow(.5 + .5 * sin(vBlade.x * 31. + uFlicker * 23.), 6.) * (1. - vBlade.y) * .35; // rising shreds of light
  float foot = exp(-vBlade.y * 12.) * .5;              // where it tears the ground
  float sides = smoothstep(1., .55, abs(vBlade.x)) * (.35 + .65 * crest);
  float a = (edge * 1.7 + halo * 1.6 + streak * 1.4 + foot * 1.5) * sides * uFade;
  vec3 c = mix(uGlow, uHot, clamp(edge * .7 + foot * .3, 0., 1.));
  gl_FragColor = vec4(c * a, 1.);${finish}
}`;

// ---------------------------------------------------------------- the scored seam behind it
// aSeam.x: metres along the lane, aSeam.y: -1..1 across. Lit only behind the front; cools over a second.
const SEAM_VERTEX = `
attribute vec2 aSeam;
varying vec2 vSeam;
void main() { vSeam = aSeam; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
const SEAM_FRAGMENT = `
uniform float uFront, uSpeed, uFade, uLength;
uniform vec3 uGlow, uHot;
varying vec2 vSeam;
void main() {
  float behind = uFront - vSeam.x;
  if (behind < 0. || vSeam.x > uLength) discard;
  float age = behind / uSpeed;                           // seconds since the front passed this point
  float heat = exp(-age * 2.2);
  float jag = sin(vSeam.x * 5.3) * .18 + sin(vSeam.x * 13.1) * .07;
  float line = exp(-pow((vSeam.y - jag) * 7., 2.));       // the cut itself, a ragged glowing seam
  float scorch = exp(-vSeam.y * vSeam.y * 2.4) * .32;      // light spilling either side of it
  float lead = exp(-behind * 1.4);                         // brightest right behind the blade
  float a = (line * (.55 + .9 * heat) + scorch * heat + lead * .8 * exp(-vSeam.y * vSeam.y * 4.)) * uFade;
  vec3 c = mix(uGlow * .8, uHot, clamp(heat * line + lead * .5, 0., 1.));
  gl_FragColor = vec4(c * a, 1.);${finish}
}`;

// ---------------------------------------------------------------- chips and embers from the front (all in the shader)
// aSpark: along (m), across (-1..1), up speed, side speed. Each is born as the front passes its spot, flies, falls.
const SPARK_VERTEX = `
attribute vec4 aSpark;
attribute float aGround;
uniform float uFront, uSpeed, uScale;
uniform vec3 uStart, uDir;
varying float vLife;
void main() {
  float age = (uFront - aSpark.x) / uSpeed;
  vLife = age < 0. ? -1. : 1. - age / .9;
  vec3 side = vec3(-uDir.z, 0., uDir.x);
  float t = max(age, 0.);
  vec3 p = uStart + uDir * (aSpark.x + t * 3.2) + side * (aSpark.y * 1.4 + aSpark.w * t);
  p.y = aGround + .15 + aSpark.z * t - 6.5 * t * t;
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = vLife > 0. ? uScale * (.6 + .4 * vLife) / max(.5, -mv.z) : 0.;
}`;
const SPARK_FRAGMENT = `
uniform vec3 uGlow, uHot;
varying float vLife;
void main() {
  if (vLife <= 0.) discard;
  vec2 q = gl_PointCoord * 2. - 1.; float r = dot(q, q); if (r > 1.) discard;
  float a = (1. - r) * vLife;
  gl_FragColor = vec4(mix(uGlow, uHot, vLife) * a * 1.4, 1.);${finish}
}`;

// ---------------------------------------------------------------- the shock ring where the axe bit
const RING_VERTEX = `
varying vec2 vUv;
void main() { vUv = uv * 2. - 1.; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
const RING_FRAGMENT = `
uniform float uAge, uFade;
uniform vec3 uGlow, uHot;
varying vec2 vUv;
void main() {
  float r = length(vUv), k = clamp(uAge / .45, 0., 1.), at = .15 + .85 * (1. - (1. - k) * (1. - k));
  float ring = exp(-pow((r - at) * 16., 2.)) * (1. - k);
  float flash = exp(-r * r * 9.) * exp(-uAge * 9.) * 1.4;
  float a = (ring + flash) * uFade; if (a < .002) discard;
  gl_FragColor = vec4(mix(uGlow, uHot, flash) * a, 1.);${finish}
}`;

// ---------------------------------------------------------------- heartwood: a column of light and glints
const BEAM_VERTEX = `
varying vec2 vUv;
uniform float uHeight;
void main() {
  vUv = uv;
  vec3 p = position; p.y *= uHeight;
  // Billboard round the vertical axis: the beam always faces the camera.
  vec4 base = modelViewMatrix * vec4(0., p.y, 0., 1.);
  base.x += p.x;
  gl_Position = projectionMatrix * base;
}`;
const BEAM_FRAGMENT = `
uniform float uFade;
uniform vec3 uColour;
varying vec2 vUv;
void main() {
  float x = vUv.x * 2. - 1.;
  float core = exp(-x * x * 18.), soft = exp(-x * x * 3.) * .35;
  float a = (core + soft) * pow(1. - vUv.y, 1.6) * uFade;
  gl_FragColor = vec4(mix(uColour, vec3(1.), core * .4) * a * 2.2, 1.);${finish}
}`;
const GLINT_VERTEX = `
attribute vec4 aGlint;
uniform float uAge, uScale;
uniform vec3 uBase;
varying float vLife;
void main() {
  float t = uAge - aGlint.w * .25;
  vLife = t < 0. ? -1. : 1. - t / 1.3;
  float tt = max(t, 0.);
  vec3 p = uBase + vec3(aGlint.x * tt, .4 + aGlint.y * tt - 3.2 * tt * tt, aGlint.z * tt);
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  float twinkle = .6 + .4 * sin(uAge * 30. + aGlint.w * 40.);
  gl_PointSize = vLife > 0. ? uScale * twinkle / max(.5, -mv.z) : 0.;
}`;
const GLINT_FRAGMENT = `
uniform vec3 uColour;
varying float vLife;
void main() {
  if (vLife <= 0.) discard;
  vec2 q = abs(gl_PointCoord * 2. - 1.);
  float star = max(exp(-q.x * 9.) * exp(-q.y * 2.5), exp(-q.y * 9.) * exp(-q.x * 2.5)) + exp(-dot(q, q) * 6.);
  gl_FragColor = vec4(mix(uColour, vec3(1.), .4) * star * vLife * 1.3, 1.);${finish}
}`;

// ---------------------------------------------------------------- the hold-to-aim lane
const LANE_VERTEX = `
attribute vec2 aLane;
varying vec2 vLane;
void main() { vLane = aLane; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
const LANE_FRAGMENT = `
uniform float uTime, uLength, uBad;
uniform vec3 uGlow, uDim;
varying vec2 vLane;
void main() {
  if (vLane.x > uLength + .2) discard;
  float edge = smoothstep(.72, 1., abs(vLane.y)) * smoothstep(1.08, 1., abs(vLane.y));
  float chev = fract((vLane.x - abs(vLane.y) * .9) * .55 - uTime * (uBad > .5 ? .25 : 1.4));
  float arrows = smoothstep(.0, .12, chev) * smoothstep(.34, .2, chev) * smoothstep(1., .55, abs(vLane.y));
  float dash = uBad > .5 ? step(.5, fract(vLane.x * .9)) : 1.;
  float tail = smoothstep(uLength + .2, uLength - 1.4, vLane.x) * smoothstep(-.4, .4, vLane.x);
  float a = (edge * .8 * dash + arrows * .55 + .06) * tail * (uBad > .5 ? .45 : 1.);
  gl_FragColor = vec4(mix(uGlow, uDim, uBad) * a, 1.);${finish}
}`;
const MARK_VERTEX = `
varying vec2 vUv;
void main() { vUv = uv * 2. - 1.; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.); }`;
const MARK_FRAGMENT = `
uniform float uTime, uBad;
uniform vec3 uGlow, uDim;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  float ring = exp(-pow((r - .74) * 8., 2.)) * (.8 + .2 * sin(uTime * 6. - r * 4.));
  float fill = smoothstep(1., .3, r) * .22 * (.6 + .4 * sin(uTime * 3.));
  float a = (ring * 1.3 + fill) * (uBad > .5 ? .4 : 1.); if (a < .003) discard;
  gl_FragColor = vec4(mix(uGlow, uDim, uBad) * a, 1.);${finish}
}`;

function seeded(i, k) { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); }

export function createTimberfallView({scene, height = () => 0, reducedMotion = false, quality = 'high'} = {}) {
  const colours = () => ({uGlow: {value: AMBER.clone()}, uHot: {value: HOT.clone()}});
  const sparkCount = reducedMotion ? 0 : quality === 'low' ? SPARKS / 2 : SPARKS;
  const waves = [];
  for (let w = 0; w < POOL; w++) {
    // Blade: a fixed grid in (across, up), positioned at the front each frame.
    const bladeData = [], bladeIndex = [], AC = 24, UP = 6;
    for (let i = 0; i <= AC; i++) for (let j = 0; j <= UP; j++) bladeData.push(-1 + 2 * i / AC, j / UP);
    for (let i = 0; i < AC; i++) for (let j = 0; j < UP; j++) { const k = i * (UP + 1) + j; bladeIndex.push(k, k + UP + 1, k + 1, k + 1, k + UP + 1, k + UP + 2); }
    const bladeGeometry = new THREE.BufferGeometry();
    bladeGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bladeData.length / 2 * 3), 3));
    bladeGeometry.setAttribute('aBlade', new THREE.Float32BufferAttribute(bladeData, 2)); bladeGeometry.setIndex(bladeIndex);
    bladeGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.4, 0), 4);
    const blade = new THREE.Mesh(bladeGeometry, additive({uHalf: {value: TIMBERFALL_VIEW.bladeHalf}, uHeight: {value: TIMBERFALL_VIEW.bladeHeight},
      uBulge: {value: TIMBERFALL_VIEW.bulge}, uLean: {value: .18}, uFade: {value: 0}, uFlicker: {value: 0}, ...colours()}, BLADE_VERTEX, BLADE_FRAGMENT));
    // Seam: ALONG x 3 strip, heights baked at cast time from the live terrain.
    const seamPositions = new Float32Array(ALONG * 3 * 3), seamData = new Float32Array(ALONG * 3 * 2), seamIndex = [];
    for (let i = 0; i < ALONG - 1; i++) for (let j = 0; j < 2; j++) { const k = i * 3 + j; seamIndex.push(k, k + 3, k + 1, k + 1, k + 3, k + 4); }
    const seamGeometry = new THREE.BufferGeometry();
    seamGeometry.setAttribute('position', new THREE.BufferAttribute(seamPositions, 3)); seamGeometry.setAttribute('aSeam', new THREE.BufferAttribute(seamData, 2)); seamGeometry.setIndex(seamIndex);
    const seam = new THREE.Mesh(seamGeometry, additive({uFront: {value: 0}, uSpeed: {value: TIMBERFALL.speed}, uFade: {value: 0}, uLength: {value: 0}, ...colours()}, SEAM_VERTEX, SEAM_FRAGMENT));
    // Sparks: fixed random spec per pool slot; ground heights baked per cast.
    const sparkSpec = new Float32Array(Math.max(1, sparkCount) * 4), sparkGround = new Float32Array(Math.max(1, sparkCount));
    for (let i = 0; i < sparkCount; i++) sparkSpec.set([seeded(i + w * 97, 1), seeded(i + w * 97, 2) * 2 - 1, 2.2 + seeded(i + w * 97, 3) * 3.6, (seeded(i + w * 97, 4) * 2 - 1) * 1.6], i * 4);
    const sparkGeometry = new THREE.BufferGeometry();
    sparkGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, sparkCount) * 3), 3));
    sparkGeometry.setAttribute('aSpark', new THREE.BufferAttribute(sparkSpec, 4)); sparkGeometry.setAttribute('aGround', new THREE.BufferAttribute(sparkGround, 1));
    sparkGeometry.setDrawRange(0, sparkCount);
    const sparks = new THREE.Points(sparkGeometry, additive({uFront: {value: 0}, uSpeed: {value: TIMBERFALL.speed}, uScale: {value: 34},
      uStart: {value: new THREE.Vector3()}, uDir: {value: new THREE.Vector3(0, 0, -1)}, ...colours()}, SPARK_VERTEX, SPARK_FRAGMENT));
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2), additive({uAge: {value: 0}, uFade: {value: 0}, ...colours()}, RING_VERTEX, RING_FRAGMENT));
    for (const [m, name, order] of [[blade, 'timberfall-blade', 5], [seam, 'timberfall-seam', 4], [sparks, 'timberfall-sparks', 6], [ring, 'timberfall-ring', 4]]) {
      m.name = name; m.visible = false; m.frustumCulled = m !== blade; m.renderOrder = order; m.userData.ignoreContact = true; m.raycast = () => {}; scene.add(m);
    }
    seam.frustumCulled = sparks.frustumCulled = false;
    waves.push({blade, seam, sparks, ring, at: -Infinity, length: 0, speed: TIMBERFALL.speed, start: new THREE.Vector3(), dir: new THREE.Vector3(), ground: new Float32Array(ALONG), live: false});
  }
  let nextWave = 0;

  function groundAt(x, z, fallback) { const h = height(x, z); return Number.isFinite(h) ? h : fallback; }
  function laneGround(w, a) { const f = Math.max(0, Math.min(ALONG - 1, a / Math.max(.01, w.length + 1) * (ALONG - 1))), i = Math.floor(f), t = f - i;
    return w.ground[i] * (1 - t) + w.ground[Math.min(ALONG - 1, i + 1)] * t; }

  /** The cast: `event` is the shared axe_cleave event; its `timberfall` field carries the lane. now: ms. */
  function play(event, now) {
    const tf = event?.timberfall;
    if (!tf || !Array.isArray(tf.start) || !Array.isArray(tf.direction)) return false;
    const w = waves[nextWave]; nextWave = (nextWave + 1) % POOL;
    w.at = now; w.length = Math.max(0, Number(tf.length) || 0); w.speed = Number(tf.speed) || TIMBERFALL.speed; w.live = true;
    w.start.set(tf.start[0], tf.start[1], tf.start[2]); w.dir.set(tf.direction[0], 0, tf.direction[2]).normalize();
    const nx = -w.dir.z, nz = w.dir.x, half = TIMBERFALL.treeWidth * .9, span = w.length + 1, pos = w.seam.geometry.attributes.position, data = w.seam.geometry.attributes.aSeam;
    for (let i = 0; i < ALONG; i++) {
      const a = span * i / (ALONG - 1), cx = w.start.x + w.dir.x * a, cz = w.start.z + w.dir.z * a;
      w.ground[i] = groundAt(cx, cz, w.start.y);
      for (let j = 0; j < 3; j++) { const c = j - 1, x = cx + nx * c * half, z = cz + nz * c * half, k = i * 3 + j;
        pos.setXYZ(k, x, groundAt(x, z, w.start.y) + .07, z); data.setXY(k, a, c); }
    }
    pos.needsUpdate = data.needsUpdate = true; w.seam.geometry.computeBoundingSphere();
    w.seam.material.uniforms.uLength.value = w.length; w.seam.material.uniforms.uSpeed.value = w.speed;
    const sparkGround = w.sparks.geometry.attributes.aGround, spec = w.sparks.geometry.attributes.aSpark;
    for (let i = 0; i < sparkCount; i++) { const a = seeded(i + nextWave * 97, 1) * w.length; spec.setX(i, a); sparkGround.setX(i, laneGround(w, a)); }
    spec.needsUpdate = sparkGround.needsUpdate = true;
    Object.assign(w.sparks.material.uniforms, {}); w.sparks.material.uniforms.uStart.value.copy(w.start); w.sparks.material.uniforms.uDir.value.copy(w.dir); w.sparks.material.uniforms.uSpeed.value = w.speed;
    const yaw = Math.atan2(-w.dir.x, -w.dir.z);
    w.blade.rotation.set(0, yaw, 0);
    const origin = Array.isArray(event.position) ? event.position : tf.start;
    w.ring.position.set(origin[0] + w.dir.x * .9, groundAt(origin[0] + w.dir.x * .9, origin[2] + w.dir.z * .9, origin[1]) + .06, origin[2] + w.dir.z * .9);
    w.blade.visible = w.seam.visible = w.ring.visible = true; w.sparks.visible = sparkCount > 0;
    update(now);
    return true;
  }

  function update(now) {
    for (const w of waves) {
      if (!w.live) continue;
      const t = (now - w.at) / 1000, run = w.length / w.speed, end = run + TIMBERFALL_VIEW.fade;
      if (t < 0 || t > end) { w.live = w.blade.visible = w.seam.visible = w.sparks.visible = w.ring.visible = false; continue; }
      const front = Math.min(w.length, t * w.speed);
      // The blade: rises out of the ground in the first instant, runs, and at the far end flares up and dies.
      const rise = Math.min(1, t / .06), out = t > run ? Math.max(0, 1 - (t - run) / .28) : 1;
      const bu = w.blade.material.uniforms;
      bu.uFade.value = rise * out; bu.uFlicker.value = t;
      bu.uHeight.value = TIMBERFALL_VIEW.bladeHeight * (.55 + .45 * rise) * (t > run ? 1 + (t - run) * 1.6 : 1);
      w.blade.visible = bu.uFade.value > .002;
      w.blade.position.set(w.start.x + w.dir.x * front, laneGround(w, front), w.start.z + w.dir.z * front);
      const su = w.seam.material.uniforms;
      su.uFront.value = front + (t > run ? (t - run) * w.speed : 0); su.uFade.value = t > run ? Math.max(0, 1 - (t - run) / TIMBERFALL_VIEW.fade) : 1;
      w.sparks.material.uniforms.uFront.value = t * w.speed;
      const ru = w.ring.material.uniforms; ru.uAge.value = t; ru.uFade.value = 1; w.ring.visible = t < .6;
    }
    for (const h of hearts) {
      if (!h.live) continue;
      const t = (now - h.at) / 1000, life = TIMBERFALL_VIEW.heartLife * h.scale;
      if (t < 0 || t > life) { h.live = h.beam.visible = h.glints.visible = false; continue; }
      const k = t / life;
      h.beam.material.uniforms.uFade.value = Math.min(1, t / .08) * (1 - k) ** 1.5;
      h.beam.material.uniforms.uHeight.value = (5 + 5 * Math.min(1, t / .3)) * h.scale;
      h.glints.material.uniforms.uAge.value = t;
    }
  }

  // ---------------------------------------------------------------- heartwood bursts
  const beamGeometry = new THREE.PlaneGeometry(1.7, 1, 1, 1).translate(0, .5, 0), hearts = [];
  for (let i = 0; i < HEART_POOL; i++) {
    const beam = new THREE.Mesh(beamGeometry, additive({uFade: {value: 0}, uHeight: {value: 5}, uColour: {value: new THREE.Color()}}, BEAM_VERTEX, BEAM_FRAGMENT));
    const spec = new Float32Array(GLINTS * 4);
    for (let g = 0; g < GLINTS; g++) { const a = seeded(g + i * 41, 5) * Math.PI * 2, s = .4 + seeded(g + i * 41, 6) * 1.3; spec.set([Math.cos(a) * s, 2.4 + seeded(g + i * 41, 7) * 3, Math.sin(a) * s, seeded(g + i * 41, 8)], g * 4); }
    const glintGeometry = new THREE.BufferGeometry();
    glintGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(GLINTS * 3), 3)); glintGeometry.setAttribute('aGlint', new THREE.BufferAttribute(spec, 4));
    const glints = new THREE.Points(glintGeometry, additive({uAge: {value: 0}, uScale: {value: 90}, uBase: {value: new THREE.Vector3()}, uColour: {value: new THREE.Color()}}, GLINT_VERTEX, GLINT_FRAGMENT));
    for (const m of [beam, glints]) { m.visible = false; m.frustumCulled = false; m.renderOrder = 6; m.userData.ignoreContact = true; m.raycast = () => {}; scene.add(m); }
    beam.name = 'heartwood-beam'; glints.name = 'heartwood-glints';
    hearts.push({beam, glints, at: -Infinity, live: false, scale: 1});
  }
  let nextHeart = 0;
  /** A felled tree's heart split open. Only rich hearts (with treasure) get a burst. */
  function heartwood(event, now) {
    if (!event || !HEART_COLOURS[event.heart] || !(event.amount > 0) || !Array.isArray(event.position)) return false;
    const h = hearts[nextHeart]; nextHeart = (nextHeart + 1) % HEART_POOL;
    const [x, y, z] = event.position, c = HEART_COLOURS[event.heart];
    h.at = now; h.live = true; h.scale = event.promised ? 1.35 : event.heart === 'amber' ? 1 : 1.15;
    h.beam.position.set(x, y, z); h.beam.material.uniforms.uColour.value.setRGB(c[0], c[1], c[2]);
    h.glints.material.uniforms.uBase.value.set(x, y, z); h.glints.material.uniforms.uColour.value.setRGB(c[0], c[1], c[2]);
    h.glints.geometry.setDrawRange(0, reducedMotion ? 8 : quality === 'low' ? GLINTS / 2 : GLINTS);
    h.beam.visible = h.glints.visible = true; update(now);
    return true;
  }

  // ---------------------------------------------------------------- hold-to-aim preview
  const laneGeometry = new THREE.BufferGeometry(), LANE_ACROSS = 5, lanePositions = new Float32Array(ALONG * LANE_ACROSS * 3), laneData = new Float32Array(ALONG * LANE_ACROSS * 2), laneIndex = [];
  for (let i = 0; i < ALONG - 1; i++) for (let j = 0; j < LANE_ACROSS - 1; j++) { const k = i * LANE_ACROSS + j; laneIndex.push(k, k + LANE_ACROSS, k + 1, k + 1, k + LANE_ACROSS, k + LANE_ACROSS + 1); }
  laneGeometry.setAttribute('position', new THREE.BufferAttribute(lanePositions, 3).setUsage(THREE.DynamicDrawUsage));
  laneGeometry.setAttribute('aLane', new THREE.BufferAttribute(laneData, 2).setUsage(THREE.DynamicDrawUsage)); laneGeometry.setIndex(laneIndex);
  const laneUniforms = {uTime: {value: 0}, uLength: {value: 0}, uBad: {value: 0}, uGlow: {value: AMBER.clone()}, uDim: {value: DIM.clone()}};
  const lane = new THREE.Mesh(laneGeometry, additive(laneUniforms, LANE_VERTEX, LANE_FRAGMENT));
  const marks = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), additive({uTime: laneUniforms.uTime, uBad: laneUniforms.uBad, uGlow: laneUniforms.uGlow, uDim: laneUniforms.uDim}, MARK_VERTEX, MARK_FRAGMENT), RING_MARKS);
  for (const m of [lane, marks]) { m.visible = false; m.frustumCulled = false; m.renderOrder = 4; m.userData.ignoreContact = true; m.raycast = () => {}; scene.add(m); }
  lane.name = 'timberfall-lane'; marks.name = 'timberfall-marks'; marks.count = 0;
  const _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Quaternion();
  let previewState = null;
  /** position/yaw: the locally predicted hero; point: the aimed ground point; trees: [{x,z,radius}] the plan fells. */
  function showPreview({position, yaw, point, ready = true, trees = [], time = 0}) {
    const plan = timberfallLane(position, yaw, point), [sx, sz] = plan.start, [fx, fz] = plan.direction, nx = -fz, nz = fx, span = plan.length + .6;
    for (let i = 0; i < ALONG; i++) for (let j = 0; j < LANE_ACROSS; j++) {
      const a = -.4 + span * i / (ALONG - 1), c = -1.08 + 2.16 * j / (LANE_ACROSS - 1), x = sx + fx * a + nx * c * TIMBERFALL.treeWidth, z = sz + fz * a + nz * c * TIMBERFALL.treeWidth, k = i * LANE_ACROSS + j;
      lanePositions[k * 3] = x; lanePositions[k * 3 + 1] = groundAt(x, z, position[1]) + .1; lanePositions[k * 3 + 2] = z; laneData[k * 2] = a; laneData[k * 2 + 1] = c;
    }
    laneGeometry.attributes.position.needsUpdate = laneGeometry.attributes.aLane.needsUpdate = true;
    laneUniforms.uLength.value = plan.length; laneUniforms.uBad.value = ready ? 0 : 1; laneUniforms.uTime.value = time;
    let n = 0;
    for (const t of trees) { if (n >= RING_MARKS) break; const r = (t.radius || .4) * 2 + .9;
      _p.set(t.x, groundAt(t.x, t.z, position[1]) + .12, t.z); _s.set(r, 1, r); marks.setMatrixAt(n++, _m.compose(_p, _q, _s)); }
    marks.count = n; marks.instanceMatrix.needsUpdate = true;
    lane.visible = true; marks.visible = n > 0;
    previewState = {plan, ready, trees: n};
    return previewState;
  }
  function hidePreview() { lane.visible = marks.visible = false; previewState = null; }

  function dispose() {
    for (const w of waves) for (const m of [w.blade, w.seam, w.sparks, w.ring]) { m.removeFromParent(); m.geometry.dispose(); m.material.dispose(); }
    for (const h of hearts) { h.beam.removeFromParent(); h.glints.removeFromParent(); h.beam.material.dispose(); h.glints.material.dispose(); h.glints.geometry.dispose(); }
    beamGeometry.dispose();
    for (const m of [lane, marks]) { m.removeFromParent(); m.geometry.dispose(); m.material.dispose(); }
  }
  return {play, heartwood, update, showPreview, hidePreview, dispose,
    get preview() { return previewState; },
    get active() { return waves.filter(w => w.live).length + hearts.filter(h => h.live).length; },
    objects: {waves, hearts, lane, marks}};
}

// ---------------------------------------------------------------- sound
// The hew: a deep bite into the ground, then a tearing rush that runs away from you down the lane and timber cracks
// along it. Oscillators and noise only, no assets. `gain` scales the whole cue (1 for your own cast).
export function playTimberfallSound(context, gain = 1, run = .7) {
  if (!context || !(gain > .01)) return;
  const now = context.currentTime, out = context.createGain(); out.gain.value = Math.min(1, gain); out.connect(context.destination);
  const bite = context.createOscillator(), biteGain = context.createGain();
  bite.type = 'sine'; bite.frequency.setValueAtTime(140, now); bite.frequency.exponentialRampToValueAtTime(34, now + .4);
  biteGain.gain.setValueAtTime(.0001, now); biteGain.gain.exponentialRampToValueAtTime(.22, now + .012); biteGain.gain.exponentialRampToValueAtTime(.0001, now + .55);
  bite.connect(biteGain).connect(out); bite.start(now); bite.stop(now + .56);
  const length = Math.round(context.sampleRate * (run + .5)), buffer = context.createBuffer(1, length, context.sampleRate), data = buffer.getChannelData(0);
  let crackle = 0;
  for (let i = 0; i < length; i++) { if (Math.random() < .0009) crackle = 1; crackle *= .985; data[i] = (Math.random() * 2 - 1) * (.55 + crackle * 1.6); }
  const rush = context.createBufferSource(), band = context.createBiquadFilter(), rushGain = context.createGain();
  rush.buffer = buffer; band.type = 'bandpass'; band.Q.value = .9;
  band.frequency.setValueAtTime(1600, now); band.frequency.exponentialRampToValueAtTime(420, now + run + .3);
  rushGain.gain.setValueAtTime(.0001, now); rushGain.gain.exponentialRampToValueAtTime(.16, now + .04); rushGain.gain.exponentialRampToValueAtTime(.02, now + run); rushGain.gain.exponentialRampToValueAtTime(.0001, now + run + .5);
  rush.connect(band).connect(rushGain).connect(out); rush.start(now); rush.stop(now + run + .5);
  // The heartstone lets go: a warm, falling bell.
  for (const [f, d, g] of [[392, 1.1, .03], [588, .8, .018]]) { const o = context.createOscillator(), og = context.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(f, now); o.frequency.exponentialRampToValueAtTime(f * .84, now + d);
    og.gain.setValueAtTime(.0001, now); og.gain.exponentialRampToValueAtTime(g, now + .015); og.gain.exponentialRampToValueAtTime(.0001, now + d);
    o.connect(og).connect(out); o.start(now); o.stop(now + d + .02); }
}
// A rich heart splits: a bright little chime, a fuller chord for gold and gems, a rising run for the promised amberheart.
export function playHeartwoodSound(context, event, gain = 1) {
  if (!context || !(gain > .01) || !(event?.amount > 0)) return;
  const now = context.currentTime, out = context.createGain(); out.gain.value = Math.min(1, gain); out.connect(context.destination);
  const base = event.heart === 'gold' ? 784 : event.heart === 'gems' ? 988 : 659;
  const notes = event.promised ? [1, 1.26, 1.5, 2] : event.heart === 'amber' ? [1, 1.5] : [1, 1.26, 1.5];
  notes.forEach((r, i) => { const o = context.createOscillator(), og = context.createGain(), at = now + i * (event.promised ? .085 : .06);
    o.type = 'sine'; o.frequency.value = base * r;
    og.gain.setValueAtTime(.0001, at); og.gain.exponentialRampToValueAtTime(.05, at + .01); og.gain.exponentialRampToValueAtTime(.0001, at + 1.2);
    o.connect(og).connect(out); o.start(at); o.stop(at + 1.25); });
}
