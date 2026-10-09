// Sunthread, the Radiant staff: presentation for the held staff (assets-source/radiant-staff, public/assets/staff.glb).
// Everything here is local and per frame on the presentation clock; nothing touches the simulation yet.
//
//   * Look: the shared template's glows breathe, the enamel gets a pearl sheen (patched once; clones share it).
//   * Crown: a soft glow and a slowly turning star-flare on the sun crystal, orbiting sun-motes, the crystal spins.
//   * Light: ONE permanent warm point light (never added or removed, so no shader rebuilds) rides the crown and really
//     lights the ground, trees and foes around you. Stronger at night. Off (intensity 0) whenever the staff is away.
//   * Light pools: two ground decals that follow the terrain (around you, and where the beam lands). They are the
//     cheap light that also works on phones, and the visible "you lit this up" moment in daylight.
//   * Beam (hold attack): a sun-thread from the crown to whatever you point near. It latches onto a foe inside a
//     generous cone, otherwise lands on the ground, and the light slides out along it so the target is lit.
//   * Nova (special): a ring of sunlight bursts across the ground and the light flares.
// Budget: 1 light, 7 draws (glow, flare, motes, beam core, beam thread, 2 pools) + 1 for sparks, no textures loaded.
import * as THREE from 'three';

export const STAFF = Object.freeze({
  range: 22, latchCone: Math.cos(THREE.MathUtils.degToRad(11)), latchRange: 22,
  light: {color: 0xffdcaa, distance: 11, lead: 1.1, day: 2.2, night: 5.5, beam: 3.5, nova: 26},
  pool: {radius: 3.6, impactRadius: 2.4, day: .16, night: .48},
  nova: {seconds: .9, radius: 8.5, cooldown: 5},
  grow: .14,   // seconds for the thread to reach its target
});

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function canvasTexture(size, draw) {
  if (typeof document === 'undefined') return new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const glowTexture = () => canvasTexture(128, (g, s) => {
  const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.12, 'rgba(255,246,214,.9)'); r.addColorStop(.35, 'rgba(255,214,130,.35)');
  r.addColorStop(.7, 'rgba(255,180,80,.08)'); r.addColorStop(1, 'rgba(255,170,60,0)'); g.fillStyle = r; g.fillRect(0, 0, s, s);
});
const flareTexture = () => canvasTexture(256, (g, s) => {
  const c = s / 2; g.translate(c, c);
  for (let k = 0; k < 12; k++) {   // twelve sun rays, long and short, each a soft tapered wedge
    const long = k % 2 === 0, L = c * (long ? .98 : .62), W = long ? 7 : 4.5;
    const grad = g.createLinearGradient(0, 0, L, 0); grad.addColorStop(0, 'rgba(255,248,220,.95)'); grad.addColorStop(.4, 'rgba(255,214,120,.45)'); grad.addColorStop(1, 'rgba(255,190,90,0)');
    g.fillStyle = grad; g.beginPath(); g.moveTo(0, -W); g.lineTo(L, 0); g.lineTo(0, W); g.closePath(); g.fill(); g.rotate(Math.PI / 6);
  }
});

// ---------------------------------------------------------------- template look (once per template)
const shared = {time: {value: 0}, charge: {value: 0}};
export function enhanceStaffTemplate(root) {
  root.traverse(node => {
    for (const m of [node.material].flat()) {
      if (!m || m.userData.radiant) continue; m.userData.radiant = true;
      if (/^(Sunstone|HaloGlow|ThreadGlow|Skystone)/.test(m.name)) {
        m.toneMapped = false;   // stays brighter than the lit world, so bloom (desktop) and the eye both pick it out
        const base = m.emissiveIntensity || 1, rate = m.name.startsWith('Thread') ? 1.3 : m.name.startsWith('Sky') ? .7 : 1.9;
        m.onBeforeCompile = shader => {
          shader.uniforms.uRadTime = shared.time; shader.uniforms.uRadCharge = shared.charge;
          shader.fragmentShader = 'uniform float uRadTime; uniform float uRadCharge;\n' + shader.fragmentShader.replace('#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
            totalEmissiveRadiance *= ${base.toFixed(3)} * (0.82 + 0.18 * sin(uRadTime * ${rate.toFixed(2)}) + uRadCharge * 0.9);`);
        };
        m.customProgramCacheKey = () => 'radiant-glow-' + m.name;
      } else if (/^Enamel/.test(m.name)) {
        // Pearl enamel: a soft warm-to-sky sheen at grazing angles, so the white shaft never reads as flat plastic.
        m.onBeforeCompile = shader => {
          shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>',
            `float pearl = pow(1.0 - clamp(dot(normalize(vViewPosition) * -1.0, normal), 0.0, 1.0), 2.4);
            outgoingLight += mix(vec3(1.0, 0.86, 0.62), vec3(0.62, 0.82, 1.0), pearl) * pearl * 0.35;
            #include <opaque_fragment>`);
        };
        m.customProgramCacheKey = () => 'radiant-pearl';
      }
    }
  });
}

// ---------------------------------------------------------------- ground light pool (terrain-following decal)
const POOL_N = 14;
function createPool(color) {
  const n = POOL_N + 1, pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), idx = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = j * n + i; uv[k * 2] = i / POOL_N * 2 - 1; uv[k * 2 + 1] = j / POOL_N * 2 - 1; }
  for (let j = 0; j < POOL_N; j++) for (let i = 0; i < POOL_N; i++) { const a = j * n + i, b = a + 1, c = a + n, d = c + 1; idx.push(a, c, b, b, c, d); }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geometry.setIndex(idx);
  const material = new THREE.ShaderMaterial({
    uniforms: {uColor: {value: new THREE.Color(color)}, uI: {value: 0}, uRing: {value: -1}, uRingI: {value: 0}, uTime: {value: 0}},
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uColor; uniform float uI, uRing, uRingI, uTime; varying vec2 vUv;
      void main(){ float d = length(vUv); if (d > 1.0) discard;
        float fill = pow(1.0 - d * d, 2.2) * uI;
        float a = atan(vUv.y, vUv.x), flecks = 0.85 + 0.15 * sin(a * 9.0 + uTime * 0.6) * sin(d * 14.0 - uTime * 1.3);
        float ring = uRing < 0.0 ? 0.0 : exp(-pow((d - uRing) * 9.0, 2.0)) * uRingI * (1.0 - d * 0.6);
        vec3 c = uColor * (fill * flecks) + vec3(1.0, 0.95, 0.8) * ring;
        gl_FragColor = vec4(c, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(geometry, material); mesh.name = 'RadiantPool'; mesh.frustumCulled = false; mesh.raycast = () => {};
  mesh.userData.ignoreContact = true; mesh.renderOrder = 3; mesh.visible = false;
  return {mesh, place(x, z, radius, height) {
    const p = geometry.attributes.position.array; let k = 0;
    for (let j = 0; j <= POOL_N; j++) for (let i = 0; i <= POOL_N; i++) {
      const px = x + (i / POOL_N * 2 - 1) * radius, pz = z + (j / POOL_N * 2 - 1) * radius;
      p[k++] = px; p[k++] = height(px, pz) + .05; p[k++] = pz;
    }
    geometry.attributes.position.needsUpdate = true;
  }};
}

// ---------------------------------------------------------------- the sun-thread beam (camera-facing ribbon)
const BEAM_SEG = 40;
function createBeam(core) {
  const n = BEAM_SEG + 1, t = new Float32Array(n * 2), side = new Float32Array(n * 2), idx = [];
  for (let i = 0; i < n; i++) { t[i * 2] = t[i * 2 + 1] = i / BEAM_SEG; side[i * 2] = -1; side[i * 2 + 1] = 1; }
  for (let i = 0; i < BEAM_SEG; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
  geometry.setAttribute('aT', new THREE.BufferAttribute(t, 1)); geometry.setAttribute('aSide', new THREE.BufferAttribute(side, 1)); geometry.setIndex(idx);
  const uniforms = {uStart: {value: new THREE.Vector3()}, uEnd: {value: new THREE.Vector3()}, uCam: {value: new THREE.Vector3()}, uTime: {value: 0},
    uGrow: {value: 0}, uI: {value: 0}, uWidth: {value: core ? .13 : .03}, uTwist: {value: core ? 0 : 1}};
  const material = new THREE.ShaderMaterial({uniforms,
    vertexShader: `uniform vec3 uStart, uEnd, uCam; uniform float uTime, uGrow, uWidth, uTwist; attribute float aT, aSide; varying float vT, vSide;
      void main(){ float t = aT * uGrow; vec3 d = uEnd - uStart; float L = length(d); vec3 dir = d / max(L, 1e-4);
        vec3 p = uStart + d * t;
        vec3 up = abs(dir.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0); vec3 n = normalize(cross(dir, up)), b = cross(n, dir);
        float env = sin(3.14159 * t);
        // a gentle sag like a held rope: seen from behind the staff a straight beam folds into a short stub under the
        // crown's glow; the sag carries it out across the ground where it reads
        p -= vec3(0.0, 1.0, 0.0) * env * min(L * 0.05, 0.5);
        p += b * env * 0.025 * sin(uTime * 3.1 + t * 5.0);                          // the thread breathes, never a stiff rod
        float a = t * min(L, 14.0) * 2.2 - uTime * 7.0; p += (n * cos(a) + b * sin(a)) * uTwist * (0.05 + 0.04 * env);   // the gold thread winds round the light
        vec3 view = normalize(uCam - p); vec3 s = normalize(cross(dir, view));
        float w = uWidth * (0.55 + 0.45 * smoothstep(0.0, 0.08, t)) * (1.0 + 0.12 * sin(uTime * 11.0 + t * 14.0) * (1.0 - uTwist));
        p += s * aSide * w; vT = aT; vSide = aSide;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
    fragmentShader: `uniform float uTime, uI, uTwist, uGrow; varying float vT, vSide;
      float h(float x){ return fract(sin(x * 127.1) * 43758.5); }
      float n1(float x){ float i = floor(x), f = fract(x); return mix(h(i), h(i + 1.0), f * f * (3.0 - 2.0 * f)); }
      void main(){ float e = abs(vSide); float core = exp(-e * e * 16.0), glow = exp(-e * e * 3.0);
        float flow = 0.6 + 0.4 * n1(vT * 26.0 - uTime * 9.0) + 0.25 * n1(vT * 61.0 - uTime * 17.0);
        float ends = smoothstep(0.0, 0.04, vT) * (1.0 - smoothstep(0.92, 1.0, vT));
        vec3 gold = vec3(1.0, 0.72, 0.28), white = vec3(1.0, 0.97, 0.88);
        vec3 c = uTwist > 0.5 ? mix(gold, white, core) * (core * 1.6 + glow * 0.4) * flow : mix(gold * 0.9, white, core) * (core * 1.6 + glow * 0.7) * flow;
        gl_FragColor = vec4(c * uI * ends, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material); mesh.frustumCulled = false; mesh.raycast = () => {}; mesh.userData.ignoreContact = true;
  mesh.renderOrder = 12; mesh.visible = false; mesh.name = core ? 'SunthreadBeam' : 'SunthreadThread';
  return {mesh, uniforms};
}

// ---------------------------------------------------------------- sparks (CPU ring buffer, one draw)
const SPARKS = 72;
function createSparks(tex) {
  const pos = new Float32Array(SPARKS * 3), life = new Float32Array(SPARKS), vel = new Float32Array(SPARKS * 3), age = new Float32Array(SPARKS).fill(9);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aLife', new THREE.BufferAttribute(life, 1).setUsage(THREE.DynamicDrawUsage));
  const m = new THREE.ShaderMaterial({uniforms: {uMap: {value: tex}, uSize: {value: 34}},
    vertexShader: 'attribute float aLife; uniform float uSize; varying float vL; void main(){ vL = aLife; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(uSize * (0.25 + aLife) / -mv.z, 0.0, 14.0) * step(0.001, aLife); }',
    fragmentShader: 'uniform sampler2D uMap; varying float vL; void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(t.rgb * vec3(1.0, 0.86, 0.55) * t.a * vL * 1.6, 1.0); }',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false});
  const points = new THREE.Points(g, m); points.frustumCulled = false; points.raycast = () => {}; points.userData.ignoreContact = true; points.renderOrder = 13;
  let next = 0;
  return {points, emit(at, n, speed, up = 1.2) {
    for (let i = 0; i < n; i++) { const k = next; next = (next + 1) % SPARKS; age[k] = 0;
      pos[k * 3] = at.x; pos[k * 3 + 1] = at.y; pos[k * 3 + 2] = at.z;
      const a = Math.random() * Math.PI * 2, s = speed * (.4 + Math.random() * .6);
      vel[k * 3] = Math.cos(a) * s; vel[k * 3 + 1] = up * (.4 + Math.random()); vel[k * 3 + 2] = Math.sin(a) * s; }
  }, update(dt) {
    let live = 0;
    for (let k = 0; k < SPARKS; k++) {
      age[k] += dt; const L = Math.max(0, 1 - age[k] / .9); life[k] = L; if (!L) continue; live++;
      vel[k * 3 + 1] += 1.6 * dt;   // sun-motes float up, not fall
      for (let c = 0; c < 3; c++) { vel[k * 3 + c] *= Math.exp(-2.4 * dt); pos[k * 3 + c] += vel[k * 3 + c] * dt; }
    }
    points.visible = live > 0; g.attributes.position.needsUpdate = true; g.attributes.aLife.needsUpdate = true; return live;
  }};
}

// ---------------------------------------------------------------- crown dressing (on the held model only)
function dressCrown(model, tex) {
  const crown = model.getObjectByName('Crown'); if (!crown) return null;
  const add = (map, size, opacity) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({map, color: 0xffffff, transparent: true, opacity, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false, toneMapped: false})); s.scale.setScalar(size); s.raycast = () => {}; s.userData.ignoreContact = true; s.renderOrder = 11; crown.add(s); return s; };
  const glow = add(tex.glow, .2, .55), flare = add(tex.flare, .26, .4);
  // Orbiting sun-motes: one Points draw, animated in the vertex shader in the crown's own space.
  const count = 22, seeds = new Float32Array(count * 3); for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(seeds, 3));
  const motes = new THREE.Points(g, new THREE.ShaderMaterial({uniforms: {uTime: shared.time, uCharge: shared.charge, uMap: {value: tex.glow}},
    vertexShader: `uniform float uTime, uCharge; varying float vA; void main(){ vec3 s = position; float a = s.x * 6.283 + uTime * (0.6 + s.y * 0.9) * (1.0 + uCharge * 2.0);
      float r = 0.07 + s.z * 0.07 + uCharge * 0.05; vec3 p = vec3(cos(a) * r, sin(a * 0.7 + s.y * 6.0) * 0.09, sin(a) * r * 0.55);
      vA = 0.45 + 0.55 * sin(uTime * (2.0 + s.z * 3.0) + s.x * 40.0); vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
      gl_PointSize = clamp((6.0 + s.y * 7.0) / -mv.z, 1.0, 26.0); }`,
    fragmentShader: 'uniform sampler2D uMap; varying float vA; void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vec3(1.0, 0.88, 0.6) * t.a * max(vA, 0.0) * 1.5, 1.0); }',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false}));
  motes.frustumCulled = false; motes.raycast = () => {}; motes.userData.ignoreContact = true; motes.renderOrder = 11; crown.add(motes);
  return {crown, glow, flare, motes, core: model.getObjectByName('SunCore'), halo: model.getObjectByName('Halo'), origin: model.getObjectByName('BeamOrigin') || crown,
    coreY: model.getObjectByName('SunCore')?.position.y ?? 0};
}

// ---------------------------------------------------------------- audio (small WebAudio synth, nothing downloaded)
function createAudio(getContext) {
  let hum = null;
  const ctx = () => { const c = getContext?.(); return c && c.state !== 'closed' ? c : null; };
  function bell(freqs, gain = .06, decay = 1.2, at = 0) {
    const c = ctx(); if (!c) return; const t = c.currentTime + at, out = c.createGain(); out.gain.value = gain; out.connect(c.destination);
    freqs.forEach((f, i) => { const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(1 / (i + 1), t + .012); g.gain.exponentialRampToValueAtTime(.0001, t + decay * (1 - i * .15));
      o.connect(g).connect(out); o.start(t); o.stop(t + decay + .05); });
  }
  return {
    latch() { bell([1318.5, 1975.5, 2637], .045, .7); },
    start() { const c = ctx(); if (!c || hum) return; const g = c.createGain(); g.gain.value = .0001; g.connect(c.destination);
      const a = c.createOscillator(), b = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain();
      a.type = 'sine'; a.frequency.value = 392; b.type = 'triangle'; b.frequency.value = 588.5; lfo.frequency.value = 5.2; lg.gain.value = 4;
      lfo.connect(lg); lg.connect(a.frequency); lg.connect(b.frequency); a.connect(g); b.connect(g); a.start(); b.start(); lfo.start();
      g.gain.exponentialRampToValueAtTime(.022, c.currentTime + .12); hum = {g, nodes: [a, b, lfo], c}; bell([784, 1176], .05, .6); },
    stop() { if (!hum) return; const {g, nodes, c} = hum; hum = null; g.gain.cancelScheduledValues(c.currentTime); g.gain.setValueAtTime(g.gain.value, c.currentTime);
      g.gain.exponentialRampToValueAtTime(.0001, c.currentTime + .25); nodes.forEach(n => n.stop(c.currentTime + .3)); },
    nova() { const c = ctx(); if (!c) return; bell([523.25, 659.25, 783.99, 1046.5], .07, 1.8);
      const len = c.sampleRate * .9 | 0, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = buf; f.type = 'bandpass'; f.Q.value = 1.4;
      f.frequency.setValueAtTime(2400, c.currentTime); f.frequency.exponentialRampToValueAtTime(380, c.currentTime + .8); g.gain.value = .07;
      s.connect(f).connect(g).connect(c.destination); s.start(); },
    dispose() { this.stop(); },
  };
}

// ---------------------------------------------------------------- the controller
/**
 * ctx: scene, height(x, z), targets() -> iterable of {position: Vector3, id} (foes the thread may latch onto),
 *      ground(origin, direction, max) -> Vector3 | null (terrain hit), night() -> 0..1, audio() -> AudioContext | null,
 *      realLight: boolean (false on the cheapest tier: pools and glow only), reducedMotion: boolean
 */
export function createRadiantStaff(ctx) {
  const {scene} = ctx;
  const tex = {glow: glowTexture(), flare: flareTexture()};
  const light = new THREE.PointLight(STAFF.light.color, 0, STAFF.light.distance, 2); light.castShadow = false; light.name = 'RadiantStaffLight';
  if (ctx.realLight !== false) scene.add(light);
  const pool = createPool(0xffc978), impactPool = createPool(0xffe2a8), beam = createBeam(true), thread = createBeam(false), sparks = createSparks(tex.glow);
  scene.add(pool.mesh, impactPool.mesh, beam.mesh, thread.mesh, sparks.points);
  const audio = createAudio(ctx.audio);
  let dress = null, model = null, holding = false, beamK = 0, grow = 0, novaAt = -99, lastNova = -99, latched = null, sparkAcc = 0, charge = 0;
  const crownAt = new THREE.Vector3(), originAt = new THREE.Vector3(), end = new THREE.Vector3(), endShown = new THREE.Vector3(), tmp = new THREE.Vector3(), lightAt = new THREE.Vector3();
  let endInit = false, stats = {beam: false, latched: null, light: 0};

  function attach(next) {
    if (next === model) return;
    model = next; dress = null;
    if (!model) return;
    dress = model.userData.radiantDress ||= dressCrown(model, tex);
  }
  function pickEnd(aim) {
    const o = new THREE.Vector3().fromArray(aim.origin), d = new THREE.Vector3().fromArray(aim.direction).normalize();
    let best = null, bestScore = -Infinity;
    for (const t of ctx.targets?.() || []) {
      tmp.copy(t.position).sub(o); const dist = tmp.length(); if (dist > STAFF.latchRange || dist < .5) continue;
      const c = tmp.dot(d) / dist; if (c < STAFF.latchCone) continue;
      const score = c * 4 - dist / STAFF.latchRange; if (score > bestScore) { bestScore = score; best = t; }
    }
    if (best) { end.copy(best.position); end.addScaledVector(tmp.copy(o).sub(end).normalize(), .4); return best.id; }   // land on the near side, not inside the foe
    const hit = ctx.ground?.(o, d, STAFF.range); end.copy(hit || o.addScaledVector(d, STAFF.range)); return null;
  }

  return {
    attach,
    holding: () => holding,
    press() { if (!model) return; holding = true; grow = 0; endInit = false; audio.start(); },
    release() { if (!holding) return; holding = false; audio.stop(); },
    nova(now) { if (!model || now - lastNova < STAFF.nova.cooldown) return false; lastNova = novaAt = now; audio.nova(); if (dress) sparks.emit(crownAt, 26, 2.4, 1.6); return true; },
    novaReady: now => Math.min(1, (now - lastNova) / STAFF.nova.cooldown),
    /** state: {time, dt, shown (staff in hand and visible), aim: {origin, direction}, camera} */
    update({time, dt, shown, aim, camera}) {
      shared.time.value = time;
      if (!shown || !dress) {
        if (holding) this.release();
        light.intensity = 0; pool.mesh.visible = impactPool.mesh.visible = beam.mesh.visible = thread.mesh.visible = false; beamK = 0; charge = 0; shared.charge.value = 0;
        sparks.update(dt); stats = {beam: false, latched: null, light: 0}; return stats;
      }
      const night = ctx.night?.() ?? 0, rm = ctx.reducedMotion;
      dress.crown.getWorldPosition(crownAt); dress.origin.getWorldPosition(originAt);
      // crown life: the crystal spins and bobs, the flare turns, everything swells with charge
      beamK += ((holding ? 1 : 0) - beamK) * Math.min(1, dt * (holding ? 14 : 7));
      const novaT = (time - novaAt) / STAFF.nova.seconds, novaK = novaT >= 0 && novaT < 1 ? 1 - novaT : 0;
      charge = Math.max(beamK, novaK); shared.charge.value = charge;
      if (dress.core) { dress.core.rotation.y = rm ? 0 : time * 1.4; dress.core.position.y = dress.coreY + (rm ? 0 : Math.sin(time * 2.1) * .006); }
      const pulse = .92 + .08 * Math.sin(time * 2.6);
      dress.glow.scale.setScalar((.17 + .1 * charge + .35 * novaK * novaK) * pulse); dress.glow.material.opacity = .2 + .18 * night + .3 * charge;   // daylight needs less halo; bloom adds the rest
      dress.flare.scale.setScalar(.24 + .16 * charge + .6 * novaK); dress.flare.material.rotation = rm ? 0 : time * .35; dress.flare.material.opacity = .14 + .14 * night + .35 * charge + .35 * novaK;
      // the beam
      if (holding) {
        latched = pickEnd(aim);
        if (!endInit) { endShown.copy(end); endInit = true; } else endShown.lerp(end, Math.min(1, dt * 18));
        const before = grow; grow = Math.min(1, grow + dt / STAFF.grow); if (before < 1 && grow >= 1) { audio.latch(); sparks.emit(endShown, 14, 1.8); }
      }
      const beamOn = beamK > .01 && endInit;
      beam.mesh.visible = thread.mesh.visible = beamOn;
      if (beamOn) for (const b of [beam, thread]) {
        const u = b.uniforms; u.uStart.value.copy(originAt); u.uEnd.value.copy(endShown); camera.getWorldPosition(u.uCam.value);
        u.uTime.value = time; u.uGrow.value = holding ? grow * grow * (3 - 2 * grow) : 1; u.uI.value = beamK;
      }
      if (beamOn && grow >= 1) { sparkAcc += dt * 22 * beamK; const n = sparkAcc | 0; if (n) { sparkAcc -= n; sparks.emit(endShown, n, 1.2, 1.4); } }
      // the light: rides the crown, slides out along the beam to light what you touch, flares on a nova
      const base = STAFF.light.day + (STAFF.light.night - STAFF.light.day) * night;
      // The light floats a stride ahead of the crown, never on it: a point light inches from the staff (inverse square)
      // would blow the staff and the hand out to white long before it reached the ground around you.
      tmp.fromArray(aim.direction); tmp.y = 0; if (tmp.lengthSq() < 1e-6) tmp.set(0, 0, -1); tmp.normalize();
      lightAt.copy(crownAt).addScaledVector(tmp, STAFF.light.lead); lightAt.y += .2;
      if (beamOn) lightAt.lerp(endShown, .72 * beamK * (holding ? grow : 1));
      light.position.copy(lightAt).y += beamOn ? .6 * beamK : 0;
      light.intensity = base + STAFF.light.beam * beamK * (1 + night) + STAFF.light.nova * novaK * novaK;
      light.distance = STAFF.light.distance + 4 * beamK + 6 * novaK;
      // ground pools: around you always, under the beam's end while it is out
      const poolI = (STAFF.pool.day + (STAFF.pool.night - STAFF.pool.day) * night) * (1 + .6 * charge) * (ctx.realLight === false ? 1.5 : 1);   // phones: the pools stand in for the light
      pool.mesh.visible = true; const pu = pool.mesh.material.uniforms; pu.uTime.value = time;
      if (novaK > 0) {   // the nova: the pool opens out to the ring's full reach and a bright band races to its edge
        pool.place(crownAt.x, crownAt.z, STAFF.nova.radius, ctx.height);
        pu.uI.value = poolI * 1.4; pu.uRing.value = 1 - Math.pow(1 - novaT, 2.2); pu.uRingI.value = novaK * (.9 + .7 * night);
      } else {
        pool.place(crownAt.x, crownAt.z, STAFF.pool.radius * (1 + .25 * charge), ctx.height); pu.uI.value = poolI; pu.uRing.value = -1;
      }
      impactPool.mesh.visible = beamOn && !latched;
      if (impactPool.mesh.visible) { impactPool.place(endShown.x, endShown.z, STAFF.pool.impactRadius, ctx.height); const iu = impactPool.mesh.material.uniforms; iu.uI.value = (.35 + .55 * night) * beamK * grow; iu.uTime.value = time; iu.uRing.value = -1; }
      const live = sparks.update(dt);
      stats = {beam: beamOn, latched, from: originAt.toArray().map(v => +v.toFixed(2)), to: endShown.toArray().map(v => +v.toFixed(2)), grow: +grow.toFixed(2), light: +light.intensity.toFixed(2), sparks: live, night: +night.toFixed(2)};
      return stats;
    },
    stats: () => stats,
    dispose() {
      audio.dispose(); light.removeFromParent();
      for (const o of [pool.mesh, impactPool.mesh, beam.mesh, thread.mesh, sparks.points]) { o.removeFromParent(); o.geometry.dispose(); o.material.dispose(); }
      tex.glow.dispose(); tex.flare.dispose();
    },
  };
}
