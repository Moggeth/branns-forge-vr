import * as THREE from 'three';

// Orchard's Edge cleave presentation (2026-10-03). The resonance light stored in the axe's edge is released as one
// blue crescent: a curved curtain of light, brightest along its top (blade) line, revealed across the arc in the
// direction of the swing and rolling outward to the cleave's reach, then fading. Presentation only: it draws from the
// shared `axe_cleave` event (position, direction, reach, arc) and never decides a hit.
// Budget: a pool of 4 sweeps, each one mesh/one draw while visible, no lights, no post. Reduced motion skips the roll.

const GLOW = new THREE.Color(.05, .3, 1.0), FLARE = new THREE.Color(.7, .9, 1.0);
const LIFE = .62, SWEEP = .16, SEGMENTS = 40, POOL = 4;

const VERTEX = /* glsl */`
attribute vec2 aCleave;          // x: -1 (left end) .. 1 (right end) across the arc, y: 0 bottom .. 1 top
uniform float uHalf, uRadius, uHeight, uLift;
varying vec2 vCleave;
void main() {
  vCleave = aCleave;
  float a = aCleave.x * uHalf;
  vec3 p = vec3(sin(a) * uRadius, uLift + aCleave.y * uHeight, -cos(a) * uRadius);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.);
}
`;
const FRAGMENT = /* glsl */`
uniform float uSweep, uFade;
uniform vec3 uGlow, uFlare;
varying vec2 vCleave;
void main() {
  // Revealed from the right end to the left as the swing crosses; the leading front burns brighter.
  float front = 1. - 2. * uSweep, ahead = vCleave.x - front;
  if (ahead < 0.) discard;
  float lead = exp(-ahead * 9.) * (1. - smoothstep(.9, 1., uSweep));
  float ends = smoothstep(1., .82, abs(vCleave.x));
  // A crescent: thickest mid-arc, tapering to the horns; a hard bright blade line on top with a soft glow beneath.
  float width = mix(.2, 1., 1. - vCleave.x * vCleave.x), depth = (1. - vCleave.y) / width;
  float line = exp(-depth * 14.), glow = exp(-depth * 3.5) * .28;
  float a = (line * .8 + glow + lead * (line * .7 + glow * 1.5)) * ends * uFade;
  vec3 color = mix(uGlow, uFlare, clamp(line * .5 + lead * .7, 0., 1.));
  gl_FragColor = vec4(color * a, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function sweepGeometry() {
  const n = SEGMENTS + 1, data = new Float32Array(n * 2 * 2), position = new Float32Array(n * 2 * 3), index = [];
  for (let i = 0; i < n; i++) {
    const u = -1 + 2 * i / SEGMENTS;
    data.set([u, 0, u, 1], i * 4);
    if (i < SEGMENTS) { const b = i * 2; index.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3)); // real positions come from aCleave
  geometry.setAttribute('aCleave', new THREE.BufferAttribute(data, 2));
  geometry.setIndex(index);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, -2), 6);
  return geometry;
}

export function createAxeCleaveView({scene, height = () => 0, reducedMotion = false} = {}) {
  const geometry = sweepGeometry(), sweeps = [];
  for (let i = 0; i < POOL; i++) {
    const uniforms = {uHalf: {value: 1.2}, uRadius: {value: 1}, uHeight: {value: 1}, uLift: {value: .2}, uSweep: {value: 0}, uFade: {value: 0},
      uGlow: {value: GLOW.clone()}, uFlare: {value: FLARE.clone()}};
    const material = new THREE.ShaderMaterial({uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: true});
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'axe-cleave'; mesh.visible = false; mesh.renderOrder = 3; mesh.userData.ignoreContact = true;
    scene.add(mesh);
    sweeps.push({mesh, uniforms, at: -Infinity, reach: 4.5});
  }
  let next = 0;

  /** event: the shared axe_cleave event. now: milliseconds (performance.now). */
  function play(event, now) {
    const position = event?.position, direction = event?.direction;
    if (!Array.isArray(position) || !Array.isArray(direction)) return false;
    const s = sweeps[next]; next = (next + 1) % POOL;
    const reach = Number.isFinite(event.reach) ? event.reach : 4.5, arc = Number.isFinite(event.arc) ? event.arc : 140;
    s.at = now; s.reach = reach; s.uniforms.uHalf.value = arc / 2 * Math.PI / 180;
    const ground = Number.isFinite(height(position[0], position[2])) ? height(position[0], position[2]) : position[1];
    s.mesh.position.set(position[0], ground, position[2]);
    s.mesh.rotation.set(0, Math.atan2(-direction[0], -direction[2]), 0);
    s.mesh.visible = true; update(now);
    return true;
  }
  function update(now) {
    for (const s of sweeps) {
      if (!s.mesh.visible) continue;
      const t = (now - s.at) / 1000;
      if (t >= LIFE || t < 0) { s.mesh.visible = false; continue; }
      const u = s.uniforms, k = t / LIFE;
      u.uSweep.value = Math.min(1, t / SWEEP);
      // Rolls out from the blade's reach to the cleave's far edge, rising a little and thinning as it goes.
      const roll = reducedMotion ? 1 : 1 - (1 - Math.min(1, t / (LIFE * .7))) ** 2;
      u.uRadius.value = 1.7 + (s.reach - 1.7) * roll;
      u.uHeight.value = .55 - .2 * roll; u.uLift.value = .55 + .1 * roll;
      u.uFade.value = (1 - k * k) * (t < .04 ? t / .04 : 1);
    }
  }
  function dispose() {
    for (const s of sweeps) { s.mesh.removeFromParent(); s.mesh.material.dispose(); }
    geometry.dispose();
  }
  return {play, update, dispose, get active() { return sweeps.filter(s => s.mesh.visible).length; }};
}

// A heavy whoosh rising through a band-pass over a low thump. Oscillators and one noise buffer, no assets.
// `gain` scales the whole cue (1 for your own cleave, less for a distant hero's).
export function playCleaveSound(context, gain = 1) {
  if (!context || !(gain > .01)) return;
  const now = context.currentTime, out = context.createGain();
  out.gain.value = Math.min(1, gain); out.connect(context.destination);
  const length = Math.round(context.sampleRate * .32), buffer = context.createBuffer(1, length, context.sampleRate), data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) { const k = i / length; data[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * Math.min(1, k * 1.6)) * (1 - k); }
  const noise = context.createBufferSource(), band = context.createBiquadFilter(), whoosh = context.createGain();
  noise.buffer = buffer; band.type = 'bandpass'; band.Q.value = 1.4;
  band.frequency.setValueAtTime(320, now); band.frequency.exponentialRampToValueAtTime(2400, now + .2); band.frequency.exponentialRampToValueAtTime(900, now + .32);
  whoosh.gain.value = .11;
  noise.connect(band).connect(whoosh).connect(out); noise.start(now); noise.stop(now + .33);
  const thump = context.createOscillator(), body = context.createGain();
  thump.type = 'sine'; thump.frequency.setValueAtTime(110, now + .05); thump.frequency.exponentialRampToValueAtTime(42, now + .3);
  body.gain.setValueAtTime(.0001, now + .05); body.gain.exponentialRampToValueAtTime(.09, now + .07); body.gain.exponentialRampToValueAtTime(.0001, now + .34);
  thump.connect(body).connect(out); thump.start(now + .05); thump.stop(now + .36);
  // The released resonance: a short bright ring as the light leaves the edge.
  const ring = context.createOscillator(), rg = context.createGain();
  ring.type = 'triangle'; ring.frequency.setValueAtTime(1180, now); ring.frequency.exponentialRampToValueAtTime(760, now + .4);
  rg.gain.setValueAtTime(.0001, now); rg.gain.exponentialRampToValueAtTime(.018, now + .02); rg.gain.exponentialRampToValueAtTime(.0001, now + .45);
  ring.connect(rg).connect(out); ring.start(now); ring.stop(now + .46);
}
