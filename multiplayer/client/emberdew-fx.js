import * as THREE from 'three';
// Emberdew impacts (presentation only; every effect starts from a host event and animates on the render clock).
//   fuel_spill  the bottle smashes: cut-glass shards skitter out, a crown of amber dew splashes up, and a lit
//               bottle goes off with a soft orange "whump" flash.
//   cinder_pop  Cinder Cluster's jug pops its cork high in the air: a bright flash and a spray of burning dew.
// Budget (Quest/phone safe): three draws in total, all pooled and preallocated: one InstancedMesh of shards,
// one Points cloud of droplets, one InstancedMesh of flash billboards. No lights, no shadows, no per-event allocation.

export const EMBERDEW_FX = Object.freeze({shards: 72, drops: 192, flashes: 6, shardsPerBreak: 12, dropsPerSplash: 28, dropsPerPop: 24});
const GRAVITY = 9.8;

const DROP_VS = /* glsl */`
attribute vec4 tint; // rgb, alpha
uniform float uScale;
varying vec4 vTint;
void main() {
  vTint = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(.05 * uScale / max(.1, -mv.z), 1., 14.);
}`;
const DROP_FS = /* glsl */`
varying vec4 vTint;
void main() {
  vec2 c = gl_PointCoord - .5; float d = length(c) * 2.;
  if (d > 1. || vTint.a < .01) discard;
  // A glossy bead: bright upper-left highlight on honey amber.
  float hi = smoothstep(.5, .0, length(c - vec2(-.16, -.16)) * 2.);
  gl_FragColor = vec4(vTint.rgb * (.75 + .25 * (1. - d)) + hi * .45, vTint.a * (1. - smoothstep(.75, 1., d)));
  #include <colorspace_fragment>
}`;
const FLASH_VS = /* glsl */`
attribute float fade;
varying vec2 vUv; varying float vFade;
void main() {
  vUv = uv * 2. - 1.; vFade = fade;
  // Camera-facing billboard: instance origin in view space plus the quad offset scaled by the instance scale.
  vec4 o = modelViewMatrix * instanceMatrix * vec4(0., 0., 0., 1.);
  float s = length(instanceMatrix[0].xyz);
  o.xy += position.xy * s;
  gl_Position = projectionMatrix * o;
}`;
const FLASH_FS = /* glsl */`
varying vec2 vUv; varying float vFade;
void main() {
  float r = length(vUv); if (r > 1. || vFade < .005) discard;
  vec3 core = vec3(1., .9, .55), mid = vec3(1., .45, .1);
  float a = pow(1. - r, 1.7) * vFade;
  gl_FragColor = vec4(mix(core, mid, smoothstep(.0, .7, r)) * a * 1.4, 1.);
}`;

const rand = s => { const x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export function createEmberdewFx({scene, height = () => 0, reducedMotion = false} = {}) {
  const L = EMBERDEW_FX;
  // ---- shards: a thin sliver of cut glass
  const shardGeo = new THREE.TetrahedronGeometry(.016, 0); shardGeo.scale(1, .35, .6);
  const shardMat = new THREE.MeshStandardMaterial({color: 0xfff1dc, roughness: .08, metalness: .1, transparent: true, opacity: .75, emissive: 0x5a2006, emissiveIntensity: .25, depthWrite: false});
  const shards = new THREE.InstancedMesh(shardGeo, shardMat, L.shards); shards.count = 0; shards.frustumCulled = false; shards.name = 'emberdew-shards';
  const shardState = Array.from({length: L.shards}, () => ({live: false, p: new THREE.Vector3(), v: new THREE.Vector3(), axis: new THREE.Vector3(1, 0, 0), spin: 0, angle: 0, age: 0, life: 1, s: 1, rest: false}));
  // ---- droplets
  const dropPos = new Float32Array(L.drops * 3), dropTint = new Float32Array(L.drops * 4);
  const dropGeo = new THREE.BufferGeometry();
  dropGeo.setAttribute('position', new THREE.BufferAttribute(dropPos, 3).setUsage(THREE.DynamicDrawUsage));
  dropGeo.setAttribute('tint', new THREE.BufferAttribute(dropTint, 4).setUsage(THREE.DynamicDrawUsage));
  dropGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4); dropGeo.setDrawRange(0, 0);
  const dropMat = new THREE.ShaderMaterial({uniforms: {uScale: {value: 420}}, vertexShader: DROP_VS, fragmentShader: DROP_FS, transparent: true, depthWrite: false});
  const drops = new THREE.Points(dropGeo, dropMat); drops.frustumCulled = false; drops.name = 'emberdew-drops';
  const dropState = Array.from({length: L.drops}, () => ({live: false, p: new THREE.Vector3(), v: new THREE.Vector3(), age: 0, life: 1, lit: 0}));
  // ---- flash billboards
  const flashGeo = new THREE.PlaneGeometry(2, 2), flashFade = new Float32Array(L.flashes);
  flashGeo.setAttribute('fade', new THREE.InstancedBufferAttribute(flashFade, 1).setUsage(THREE.DynamicDrawUsage));
  const flashMat = new THREE.ShaderMaterial({vertexShader: FLASH_VS, fragmentShader: FLASH_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false});
  const flashes = new THREE.InstancedMesh(flashGeo, flashMat, L.flashes); flashes.count = 0; flashes.frustumCulled = false; flashes.name = 'emberdew-flash';
  const flashState = Array.from({length: L.flashes}, () => ({live: false, p: new THREE.Vector3(), age: 0, life: .4, size: 1}));
  for (const o of [shards, drops, flashes]) { o.renderOrder = 3; o.userData.ignoreContact = true; o.visible = false; scene.add(o); }

  let seed = 1, shardNext = 0, dropNext = 0, flashNext = 0;
  const take = (list, next) => { for (let i = 0; i < list.length; i++) { const k = (next + i) % list.length; if (!list[k].live) return k; } return next % list.length; };
  const AMBER = new THREE.Color(0xc0560e), HOT = new THREE.Color(0xffb040);

  function splash(at, count, power, lit) {
    for (let i = 0; i < count; i++) {
      const k = take(dropState, dropNext); dropNext = k + 1; const d = dropState[k], s = seed++;
      const a = rand(s) * Math.PI * 2, out = (.6 + rand(s + .3) * 1.4) * power, up = (1.6 + rand(s + .7) * 2.4) * power;
      d.live = true; d.age = 0; d.life = .5 + rand(s + .9) * .45; d.lit = lit ? 1 : 0;
      d.p.set(at.x + Math.cos(a) * .05, at.y + .03, at.z + Math.sin(a) * .05); d.v.set(Math.cos(a) * out, up, Math.sin(a) * out);
    }
  }
  function shatter(at, lit) {
    for (let i = 0; i < L.shardsPerBreak; i++) {
      const k = take(shardState, shardNext); shardNext = k + 1; const sh = shardState[k], s = seed++;
      const a = rand(s) * Math.PI * 2, out = 1.2 + rand(s + .2) * 2.2, up = 1 + rand(s + .5) * 2.6;
      sh.live = true; sh.rest = false; sh.age = 0; sh.life = 1 + rand(s + .8) * .7; sh.s = .6 + rand(s + .4) * .8;
      sh.p.set(at.x, at.y + .05, at.z); sh.v.set(Math.cos(a) * out, up, Math.sin(a) * out);
      sh.axis.set(rand(s + 1.1) - .5, rand(s + 1.3) - .5, rand(s + 1.7) - .5).normalize(); sh.spin = 8 + rand(s + 2.1) * 18; sh.angle = rand(s + 2.9) * 6.28;
    }
    shardMat.emissiveIntensity = lit ? .9 : .25;
  }
  function flash(at, size, life) {
    const k = take(flashState, flashNext); flashNext = k + 1; const f = flashState[k];
    f.live = true; f.age = 0; f.life = life; f.size = size; f.p.set(at.x, at.y + size * .35, at.z);
  }

  const at = new THREE.Vector3();
  function handle(event) {
    const p = event?.position; if (!Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite)) return false;
    if (event.kind === 'fuel_spill') {
      at.fromArray(p); const ground = height(at.x, at.z); if (Number.isFinite(ground) && Math.abs(at.y - ground) < .5) at.y = Math.max(at.y, ground);
      const lit = !!event.lit;
      shatter(at, lit); splash(at, reducedMotion ? 12 : L.dropsPerSplash, 1, lit);
      if (lit) flash(at, event.tar ? 1.4 : 1.1, .42);
      return true;
    }
    if (event.kind === 'cinder_pop') {
      at.fromArray(p); splash(at, reducedMotion ? 10 : L.dropsPerPop, .9, true); flash(at, 1.3, .4);
      return true;
    }
    return false;
  }

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  function update(dt) {
    dt = Math.min(Math.max(0, dt || 0), .05);
    let n = 0;
    for (const sh of shardState) {
      if (!sh.live) continue;
      sh.age += dt; if (sh.age >= sh.life) { sh.live = false; continue; }
      if (!sh.rest) {
        sh.v.y -= GRAVITY * dt; sh.p.addScaledVector(sh.v, dt); sh.angle += sh.spin * dt;
        const g = height(sh.p.x, sh.p.z);
        if (Number.isFinite(g) && sh.p.y < g + .004) { sh.p.y = g + .004; if (sh.v.y < -1.2) { sh.v.y *= -.3; sh.v.x *= .5; sh.v.z *= .5; sh.spin *= .4; } else { sh.rest = true; } }
      }
      const fade = 1 - Math.max(0, (sh.age - sh.life * .6) / (sh.life * .4));
      q.setFromAxisAngle(sh.axis, sh.angle); sc.setScalar(sh.s * fade);
      shards.setMatrixAt(n++, m.compose(sh.p, q, sc));
    }
    shards.count = n; shards.visible = n > 0; if (n) shards.instanceMatrix.needsUpdate = true;
    n = 0;
    for (const d of dropState) {
      if (!d.live) continue;
      d.age += dt; d.v.y -= GRAVITY * dt; d.p.addScaledVector(d.v, dt);
      const g = height(d.p.x, d.p.z);
      if (d.age >= d.life || (Number.isFinite(g) && d.p.y < g)) { d.live = false; continue; }
      const t = d.age / d.life, c = d.lit ? HOT : AMBER;
      dropPos[n * 3] = d.p.x; dropPos[n * 3 + 1] = d.p.y; dropPos[n * 3 + 2] = d.p.z;
      dropTint[n * 4] = c.r; dropTint[n * 4 + 1] = c.g; dropTint[n * 4 + 2] = c.b; dropTint[n * 4 + 3] = 1 - t * t;
      n++;
    }
    dropGeo.setDrawRange(0, n); drops.visible = n > 0;
    if (n) for (const name of ['position', 'tint']) { const a = dropGeo.attributes[name]; a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); a.needsUpdate = true; }
    n = 0;
    for (const f of flashState) {
      if (!f.live) continue;
      f.age += dt; const t = f.age / f.life; if (t >= 1) { f.live = false; continue; }
      const size = f.size * (.45 + .75 * Math.sqrt(t)); sc.setScalar(size); q.identity();
      flashes.setMatrixAt(n, m.compose(f.p, q, sc)); flashFade[n] = (1 - t) * (1 - t) * Math.min(1, t * 12); n++;
    }
    flashes.count = n; flashes.visible = n > 0;
    if (n) { flashes.instanceMatrix.needsUpdate = true; flashGeo.attributes.fade.needsUpdate = true; }
  }
  function stats() { return {shards: shards.count, drops: dropGeo.drawRange.count, flashes: flashes.count, draws: (shards.visible ? 1 : 0) + (drops.visible ? 1 : 0) + (flashes.visible ? 1 : 0)}; }
  function dispose() { for (const o of [shards, drops, flashes]) o.removeFromParent(); shardGeo.dispose(); shardMat.dispose(); dropGeo.dispose(); dropMat.dispose(); flashGeo.dispose(); flashMat.dispose(); shards.dispose(); flashes.dispose(); }
  return {handle, update, stats, dispose, objects: [shards, drops, flashes]};
}

// Glass smash (bright crack, tinkles), a soft "whump" when lit, and a cork "pop" when Cinder Cluster's jug bursts.
export function playEmberdewSound(context, event, gain = 1) {
  if (!context || context.state === 'closed' || gain <= .01) return false;
  const kind = event?.kind; if (kind !== 'fuel_spill' && kind !== 'cinder_pop' && kind !== 'cinder_throw') return false;
  const now = context.currentTime, out = context.createGain(); out.gain.value = .5 * gain; out.connect(context.destination);
  const tone = (hz, at, dur, level, type = 'sine', to = null) => {
    const o = context.createOscillator(), g = context.createGain(); o.type = type; o.frequency.setValueAtTime(hz, now + at);
    if (to) o.frequency.exponentialRampToValueAtTime(to, now + at + dur);
    g.gain.setValueAtTime(.0001, now + at); g.gain.exponentialRampToValueAtTime(level, now + at + .006); g.gain.exponentialRampToValueAtTime(.0001, now + at + dur);
    o.connect(g).connect(out); o.start(now + at); o.stop(now + at + dur + .05); o.onended = () => { o.disconnect(); g.disconnect(); };
  };
  const noise = (at, dur, level, filter, hz) => {
    const len = Math.max(1, Math.floor(context.sampleRate * dur)), buf = context.createBuffer(1, len, context.sampleRate), d = buf.getChannelData(0);
    let h = 987654321; for (let i = 0; i < len; i++) { h = Math.imul(h, 48271) % 2147483647; d[i] = ((h / 2147483647) * 2 - 1) * Math.pow(1 - i / len, 3); }
    const src = context.createBufferSource(), f = context.createBiquadFilter(), g = context.createGain();
    src.buffer = buf; f.type = filter; f.frequency.value = hz; g.gain.value = level;
    src.connect(f).connect(g).connect(out); src.start(now + at); src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect(); };
  };
  if (kind === 'fuel_spill') {
    noise(0, .22, .55, 'highpass', 3200);                       // the crack
    [3520, 4186, 2960, 4699].forEach((hz, i) => tone(hz, .03 + i * .045, .18, .05));   // tinkles
    if (event.lit) { noise(.02, .6, .45, 'lowpass', 520); tone(90, .02, .4, .18, 'sine', 50); } // whump
  } else if (kind === 'cinder_pop') {
    tone(380, 0, .09, .3, 'square', 900); noise(0, .05, .4, 'highpass', 2400);   // the cork
    noise(.04, .5, .3, 'lowpass', 700); [1760, 2093, 2637].forEach((hz, i) => tone(hz, .06 + i * .05, .14, .04)); // fwoomp and a jingle of bottles
  } else {
    noise(0, .25, .18, 'bandpass', 1400); // the whoosh of the throw
  }
  setTimeout(() => out.disconnect(), 1500);
  return true;
}
