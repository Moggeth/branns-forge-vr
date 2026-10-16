// Material impact artist: directional chips, metallic sparks, restrained dust and a contact glint.
// Four instanced draws (chips, sparks, dust, flash), shared geometry/materials, no lights,
// no textures, no DOM/canvas, no per-frame allocation. See HANDOFF.md.
// Optional event hints (2026-10-16 weapon feel): direction (unit travel of the striking edge; chips leave the cut that
// way), steel (true: steel met it, so stone/metal/crystal throw a proper spray of sparks and a glint; false: bone or
// wood did, so no sparks at all), kind ('bite' | 'rebound' | 'cleave' | 'thud' from strike-feel.js).
import * as THREE from 'three';

export const IMPACT_CAPS = Object.freeze({ chips: 160, sparks: 96, dust: 96, flashes: 24 });

const MATERIALS = ['stone', 'metal', 'bone', 'wood', 'earth', 'crystal'];
const hex = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };

// count = base particles at energy 1 / full detail. shape = flake scale ratios (x,y,z).
// cone = max ejection angle from the normal (radians). Speeds in m/s, sizes in metres.
const PROFILES = {
  stone: {
    chips: 7, sparks: 2, dust: 3, cone: 1.2, speed: [1.4, 3.6], size: [0.010, 0.026],
    shape: [1.0, 0.6, 0.85], palette: ['#2f2d2b', '#4a443d', '#6b5e4b', '#9a7a45'],
    spark: ['#fff1d0', '#e9b46a'], dust: ['#6f6659', '#8f7b57'], dustSize: [0.025, 0.06], dustAlpha: 0.2,
  },
  metal: {
    chips: 2, sparks: 14, dust: 1, cone: 1.05, speed: [3.0, 7.0], size: [0.006, 0.012],
    shape: [0.9, 0.25, 0.7], palette: ['#565c63', '#7b838b', '#3b4046'],
    spark: ['#fff6df', '#ffc572'], dust: ['#77746f'], dustSize: [0.02, 0.04], dustAlpha: 0.12,
  },
  bone: {
    chips: 6, sparks: 0, dust: 3, cone: 1.25, speed: [1.2, 3.2], size: [0.008, 0.02],
    shape: [1.6, 0.35, 0.6], palette: ['#f2e9d2', '#e0d3b4', '#c9ba98', '#f8f1e0'],
    spark: ['#ffffff', '#ffffff'], dust: ['#e6dcc6', '#d6c9aa'], dustSize: [0.02, 0.05], dustAlpha: 0.17,
  },
  wood: {
    // Long fresh splinters (pale heartwood) mixed with darker bark flakes.
    chips: 9, sparks: 0, dust: 3, cone: 1.35, speed: [1.5, 3.8], size: [0.010, 0.026],
    shape: [2.6, 0.26, 0.42], palette: ['#b07a3e', '#8b5a2b', '#e6c48c', '#d2a56a', '#f0d8a8', '#5d3a20'],
    spark: ['#ffffff', '#ffffff'], dust: ['#d8b67c', '#a8834f'], dustSize: [0.02, 0.055], dustAlpha: 0.17,
  },
  earth: {
    // Clods and grit: chunky, low and heavy, with a brown puff that hangs a moment.
    chips: 6, sparks: 0, dust: 5, cone: 1.0, speed: [0.9, 2.6], size: [0.012, 0.03],
    shape: [1.0, 0.75, 0.9], palette: ['#5a4630', '#6e5638', '#47382a', '#5f6b34'],
    spark: ['#ffffff', '#ffffff'], dust: ['#8a7356', '#7a6a4e'], dustSize: [0.04, 0.11], dustAlpha: 0.24,
  },
  crystal: {
    // Glassy shards that catch the light, a few cold sparkles.
    chips: 7, sparks: 4, dust: 2, cone: 1.15, speed: [1.8, 4.2], size: [0.008, 0.02],
    shape: [0.55, 1.8, 0.55], palette: ['#9fe6ff', '#5fb8ff', '#d8f6ff', '#7fd8e8'],
    spark: ['#f2fdff', '#7fd0ff'], dust: ['#bfe9ff'], dustSize: [0.02, 0.05], dustAlpha: 0.12,
  },
};
// Contact glint colour per material (hot core of the moment of contact). Missing = no glint.
const FLASH = { stone: '#fff0c8', metal: '#fff6e0', crystal: '#d8f8ff', bone: '#fffaf0' };
for (const k of MATERIALS) {
  const p = PROFILES[k];
  p.paletteRgb = p.palette.map(hex);
  p.sparkRgb = p.spark.map(hex);
  p.dustRgb = p.dust.map(hex);
}
const FLASH_RGB = Object.fromEntries(Object.entries(FLASH).map(([k, v]) => [k, hex(v)]));

const GRAVITY = { chip: 9.81, spark: 6.5 };
const CHIP_FADE = 0.25;

function mulberry32(a) {
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fin = (n) => typeof n === 'number' && Number.isFinite(n);
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

function makeChipGeometry() {
  // Sharp irregular shard: a tetrahedron, flat shaded, stretched per instance.
  const g = new THREE.TetrahedronGeometry(1, 0);
  g.computeVertexNormals();
  return g;
}
function makeSparkGeometry() {
  // Needle: stretched octahedron along +Y, unit length 1 (tip to tip), thin.
  const g = new THREE.OctahedronGeometry(0.5, 0);
  return g;
}
function makeDustGeometry() {
  const g = new THREE.PlaneGeometry(1, 1);
  return g;
}

const DUST_VERT = /* glsl */`
attribute vec4 aTint;
varying vec2 vUv;
varying vec4 vTint;
void main() {
  vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = length(instanceMatrix[0].xyz);
  c.xy += position.xy * s;
  vUv = position.xy * 2.0;
  vTint = aTint;
  gl_Position = projectionMatrix * c;
}`;
const DUST_FRAG = /* glsl */`
varying vec2 vUv;
varying vec4 vTint;
void main() {
  float d = dot(vUv, vUv);
  float a = clamp(1.0 - d, 0.0, 1.0);
  a = a * a * a * vTint.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vTint.rgb, a);
}`;

// Contact glint: a hot core with a four-point star, additive, a few frames long.
const FLASH_FRAG = /* glsl */`
varying vec2 vUv;
varying vec4 vTint;
void main() {
  vec2 a = abs(vUv);
  float core = exp(-dot(vUv, vUv) * 9.0);
  float rays = max(0.0, 1.0 - a.x * 9.0) * max(0.0, 1.0 - a.y) + max(0.0, 1.0 - a.y * 9.0) * max(0.0, 1.0 - a.x);
  float v = (core * 2.2 + rays * 0.9) * vTint.a;
  if (v < 0.004) discard;
  gl_FragColor = vec4(vTint.rgb * v, v);
}`;

export function createImpactPresentation({ scene, height = 0, camera = null } = {}) {
  const chipCap = IMPACT_CAPS.chips, sparkCap = IMPACT_CAPS.sparks, dustCap = IMPACT_CAPS.dust, flashCap = IMPACT_CAPS.flashes;
  let disposed = false;
  let emitted = 0, rejected = 0;

  const groundAt = (x, z) => {
    if (typeof height === 'function') {
      try { const y = height(x, z); return fin(y) ? y : 0; } catch { return 0; }
    }
    return fin(height) ? height : 0;
  };

  // ---- shared GPU resources ----
  const chipGeo = makeChipGeometry();
  const sparkGeo = makeSparkGeometry();
  const dustGeo = makeDustGeometry();
  const flashGeo = makeDustGeometry();
  const chipMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.05, flatShading: true });
  const sparkMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false,
  });
  const dustMat = new THREE.ShaderMaterial({
    vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, transparent: true, depthWrite: false,
  });

  const flashMat = new THREE.ShaderMaterial({
    vertexShader: DUST_VERT, fragmentShader: FLASH_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const chipMesh = new THREE.InstancedMesh(chipGeo, chipMat, chipCap);
  const sparkMesh = new THREE.InstancedMesh(sparkGeo, sparkMat, sparkCap);
  const dustMesh = new THREE.InstancedMesh(dustGeo, dustMat, dustCap);
  const flashMesh = new THREE.InstancedMesh(flashGeo, flashMat, flashCap);
  chipMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(chipCap * 3), 3);
  sparkMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(sparkCap * 3), 3);
  const dustTint = new THREE.InstancedBufferAttribute(new Float32Array(dustCap * 4), 4);
  dustGeo.setAttribute('aTint', dustTint);
  const flashTint = new THREE.InstancedBufferAttribute(new Float32Array(flashCap * 4), 4);
  flashGeo.setAttribute('aTint', flashTint);
  for (const m of [chipMesh, sparkMesh, dustMesh, flashMesh]) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false; // bounds of moving instances are unknown
    m.count = 0;
    m.matrixAutoUpdate = false;
    m.name = 'impact-presentation';
  }
  chipMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  sparkMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  dustTint.setUsage(THREE.DynamicDrawUsage);
  flashTint.setUsage(THREE.DynamicDrawUsage);
  flashMesh.renderOrder = 12;
  sparkMesh.renderOrder = 11;
  dustMesh.renderOrder = 10;
  if (scene && typeof scene.add === 'function') {
    scene.add(chipMesh); scene.add(sparkMesh); scene.add(dustMesh); scene.add(flashMesh);
  }

  // ---- particle state (typed arrays, allocated once) ----
  const mk = (cap) => ({
    cap, next: 0, hi: 0, alive: new Uint8Array(cap),
    p: new Float32Array(cap * 3), v: new Float32Array(cap * 3),
    age: new Float32Array(cap), life: new Float32Array(cap), size: new Float32Array(cap),
  });
  const chips = mk(chipCap);
  chips.q = new Float32Array(chipCap * 4); chips.w = new Float32Array(chipCap * 3);
  chips.s = new Float32Array(chipCap * 3); chips.rest = new Uint8Array(chipCap);
  chips.bounce = new Uint8Array(chipCap);
  const sparks = mk(sparkCap);
  sparks.hot = new Float32Array(sparkCap * 3); sparks.base = new Float32Array(sparkCap * 3);
  sparks.w = new Float32Array(sparkCap); sparks.bounce = new Uint8Array(sparkCap);
  const dust = mk(dustCap);
  dust.size1 = new Float32Array(dustCap); dust.amax = new Float32Array(dustCap);
  const flashes = mk(flashCap);

  const mat4 = new THREE.Matrix4();
  const vP = new THREE.Vector3(), vS = new THREE.Vector3(), vA = new THREE.Vector3();
  const qA = new THREE.Quaternion(), qB = new THREE.Quaternion();
  const qId = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);
  const ZERO16 = new Float32Array(16);

  const slot = (pool) => {
    const i = pool.next; pool.next = (i + 1) % pool.cap;
    pool.alive[i] = 1; pool.age[i] = 0;
    if (i >= pool.hi) pool.hi = i + 1;
    return i;
  };

  // distance budget: 1 near, down to 0.15 far
  const detail = (x, y, z) => {
    if (!camera || !camera.matrixWorld) return 1;
    const e = camera.matrixWorld.elements;
    const dx = x - e[12], dy = y - e[13], dz = z - e[14];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!fin(d)) return 1;
    if (d < 4) return 1;
    if (d < 12) return 1 - (d - 4) / 8 * 0.4;
    if (d < 30) return 0.6 - (d - 12) / 18 * 0.35;
    return 0.15 + 0.1 * Math.max(0, 1 - (d - 30) / 30);
  };

  function emit(ev) {
    if (disposed || !ev || typeof ev !== 'object') { rejected++; return null; }
    const prof = PROFILES[ev.material];
    const pos = ev.position;
    if (!prof || !Array.isArray(pos) || pos.length < 3 || !fin(pos[0]) || !fin(pos[1]) || !fin(pos[2])) { rejected++; return null; }
    const px = pos[0], py = pos[1], pz = pos[2];
    let nx = 0, ny = 1, nz = 0;
    const n = ev.normal;
    if (Array.isArray(n) && n.length >= 3 && fin(n[0]) && fin(n[1]) && fin(n[2])) {
      const l = Math.hypot(n[0], n[1], n[2]);
      if (l > 1e-6) { nx = n[0] / l; ny = n[1] / l; nz = n[2] / l; }
    }
    const n0x = nx, n0y = ny, n0z = nz;
    // The striking edge's travel tips the spray: chips leave the cut the way the blade was going.
    const d = ev.direction;
    if (Array.isArray(d) && d.length >= 3 && fin(d[0]) && fin(d[1]) && fin(d[2])) {
      const into = d[0] * nx + d[1] * ny + d[2] * nz; // only the part of the travel along the surface
      let ax = nx + (d[0] - into * nx) * 0.75, ay = ny + (d[1] - into * ny) * 0.75, az = nz + (d[2] - into * nz) * 0.75;
      const al = Math.hypot(ax, ay, az);
      if (al > 1e-6) { nx = ax / al; ny = ay / al; nz = az / al; }
    }
    const e = fin(ev.energy) ? clamp(ev.energy, 0.2, 2) : 1;
    const seed = fin(ev.seed) ? Math.trunc(ev.seed) | 0 : 0;
    const rnd = mulberry32((seed ^ Math.imul(MATERIALS.indexOf(ev.material) + 1, 0x9E3779B1)) | 0);
    const lod = detail(px, py, pz);
    const farBoost = 1 + (1 - lod) * 0.6; // keep distant chips legible
    const eCount = (0.4 + 0.6 * e) * lod;
    const eSpeed = 0.75 + 0.25 * e;
    const eSize = (0.8 + 0.2 * e) * farBoost * 1.5; // read at arm's length in first person (2026-10-16)

    // tangent basis (allocation-free)
    let hx = 0, hy = 0, hz = 0;
    if (Math.abs(ny) < 0.9) hy = 1; else hx = 1;
    let t1x = ny * hz - nz * hy, t1y = nz * hx - nx * hz, t1z = nx * hy - ny * hx;
    const tl = Math.hypot(t1x, t1y, t1z) || 1;
    t1x /= tl; t1y /= tl; t1z /= tl;
    const t2x = ny * t1z - nz * t1y, t2y = nz * t1x - nx * t1z, t2z = nx * t1y - ny * t1x;

    const count = (base) => {
      const f = base * eCount;
      let c = Math.floor(f);
      if (rnd() < f - c) c++;
      return base > 0 ? Math.min(c, 40) : 0;
    };
    // sets vA to a unit direction inside the ejection cone
    const cone = (maxAng) => {
      const el = Math.pow(rnd(), 0.8) * maxAng, az = rnd() * 6.2831853;
      const ce = Math.cos(el), se = Math.sin(el), ca = Math.cos(az) * se, sa = Math.sin(az) * se;
      vA.set(nx * ce + t1x * ca + t2x * sa, ny * ce + t1y * ca + t2y * sa, nz * ce + t1z * ca + t2z * sa);
    };
    const origin = (out, i, r, lift) => {
      const a = rnd() * 6.2831853, d = r * Math.sqrt(rnd()), ca = Math.cos(a) * d, sa = Math.sin(a) * d;
      out[i * 3] = px + t1x * ca + t2x * sa + nx * lift;
      out[i * 3 + 1] = py + t1y * ca + t2y * sa + ny * lift;
      out[i * 3 + 2] = pz + t1z * ca + t2z * sa + nz * lift;
    };

    const hard = ev.material === 'stone' || ev.material === 'metal' || ev.material === 'crystal';
    const sparkBase = ev.steel === false ? 0 : ev.steel === true && hard ? Math.max(8, prof.sparks * 2.5) : prof.sparks;
    const chipBase = prof.chips * (ev.kind === 'bite' ? 1.3 : ev.kind === 'rebound' ? 0.7 : 1);
    const nChips = count(chipBase), nSparks = count(sparkBase), nDust = lod < 0.3 ? 0 : count(prof.dust);
    const glint = FLASH_RGB[ev.material] && (ev.material === 'bone' || ev.steel !== false) ? FLASH_RGB[ev.material] : null;
    if (glint && lod > 0.25) {
      const i = slot(flashes);
      flashes.p[i * 3] = px + n0x * 0.02; flashes.p[i * 3 + 1] = py + n0y * 0.02; flashes.p[i * 3 + 2] = pz + n0z * 0.02;
      flashes.life[i] = 0.1 + 0.04 * e;
      flashes.size[i] = (ev.material === 'bone' ? 0.16 : 0.32) * (0.75 + 0.25 * e) * (ev.steel === true ? 1.15 : 1);
      flashTint.array[i * 4] = glint[0]; flashTint.array[i * 4 + 1] = glint[1]; flashTint.array[i * 4 + 2] = glint[2];
      flashTint.array[i * 4 + 3] = 0;
    }

    for (let k = 0; k < nChips; k++) {
      const i = slot(chips);
      origin(chips.p, i, 0.006, 0.003);
      cone(prof.cone);
      const sp = (prof.speed[0] + rnd() * (prof.speed[1] - prof.speed[0])) * eSpeed;
      chips.v[i * 3] = vA.x * sp; chips.v[i * 3 + 1] = vA.y * sp; chips.v[i * 3 + 2] = vA.z * sp;
      const sz = (prof.size[0] + rnd() * (prof.size[1] - prof.size[0])) * eSize;
      chips.size[i] = sz;
      chips.s[i * 3] = sz * prof.shape[0] * (0.75 + rnd() * 0.5);
      chips.s[i * 3 + 1] = sz * prof.shape[1] * (0.7 + rnd() * 0.6);
      chips.s[i * 3 + 2] = sz * prof.shape[2] * (0.75 + rnd() * 0.5);
      qA.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5, rnd() - 0.5 + 0.01).normalize();
      chips.q[i * 4] = qA.x; chips.q[i * 4 + 1] = qA.y; chips.q[i * 4 + 2] = qA.z; chips.q[i * 4 + 3] = qA.w;
      const spin = 8 + rnd() * 18;
      vA.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
      chips.w[i * 3] = vA.x * spin; chips.w[i * 3 + 1] = vA.y * spin; chips.w[i * 3 + 2] = vA.z * spin;
      chips.life[i] = 0.85 + rnd() * 0.5;
      chips.rest[i] = 0; chips.bounce[i] = 0;
      const c = prof.paletteRgb[(rnd() * prof.paletteRgb.length) | 0], j = 0.88 + rnd() * 0.24;
      const ca = chipMesh.instanceColor.array;
      ca[i * 3] = c[0] * j; ca[i * 3 + 1] = c[1] * j; ca[i * 3 + 2] = c[2] * j;
    }

    for (let k = 0; k < nSparks; k++) {
      const i = slot(sparks);
      origin(sparks.p, i, 0.003, 0.002);
      cone(prof.cone);
      const sp = (prof.speed[0] + rnd() * (prof.speed[1] - prof.speed[0])) * eSpeed;
      sparks.v[i * 3] = vA.x * sp; sparks.v[i * 3 + 1] = vA.y * sp; sparks.v[i * 3 + 2] = vA.z * sp;
      sparks.life[i] = (0.16 + rnd() * 0.22) * (0.8 + 0.2 * e);
      sparks.size[i] = (0.0042 + rnd() * 0.0036) * (0.8 + 0.2 * e) * farBoost; // half-width: a few pixels at arm's length
      sparks.bounce[i] = 0;
      const hot = prof.sparkRgb[0], base = prof.sparkRgb[1], inten = (0.55 + rnd() * 0.3) * (ev.steel === true ? 1.8 : 1); // steel sparks read against a bright day
      for (let a = 0; a < 3; a++) { sparks.hot[i * 3 + a] = hot[a] * inten; sparks.base[i * 3 + a] = base[a] * inten; }
    }

    for (let k = 0; k < nDust; k++) {
      const i = slot(dust);
      origin(dust.p, i, 0.01, 0.006);
      cone(prof.cone * 0.7);
      const sp = (0.25 + rnd() * 0.6) * eSpeed;
      dust.v[i * 3] = vA.x * sp; dust.v[i * 3 + 1] = vA.y * sp + 0.1; dust.v[i * 3 + 2] = vA.z * sp;
      dust.life[i] = 0.35 + rnd() * 0.3;
      const s0 = (prof.dustSize[0] + rnd() * 0.3 * (prof.dustSize[1] - prof.dustSize[0])) * (0.8 + 0.2 * e);
      dust.size[i] = s0;
      dust.size1[i] = (s0 + (prof.dustSize[1] - prof.dustSize[0]) * (0.5 + rnd() * 0.5) * (0.8 + 0.2 * e)) * farBoost;
      dust.amax[i] = prof.dustAlpha * (0.7 + 0.3 * rnd()) * (0.6 + 0.4 * Math.min(e, 1.5));
      const c = prof.dustRgb[(rnd() * prof.dustRgb.length) | 0];
      dustTint.array[i * 4] = c[0]; dustTint.array[i * 4 + 1] = c[1]; dustTint.array[i * 4 + 2] = c[2];
      dustTint.array[i * 4 + 3] = 0;
    }

    // New chip colours must reach the GPU (they were written above but never uploaded, so every chip drew black).
    if (nChips) chipMesh.instanceColor.needsUpdate = true;
    emitted++;
    return { chips: nChips, sparks: nSparks, dust: nDust, flash: !!glint };
  }

  const kill = (mesh, i) => { mesh.instanceMatrix.array.set(ZERO16, i * 16); };

  function updateChips(dt) {
    const P = chips, arr = chipMesh.instanceMatrix.array;
    let hi = 0;
    for (let i = 0; i < P.hi; i++) {
      if (!P.alive[i]) continue;
      P.age[i] += dt;
      if (P.age[i] >= P.life[i]) { P.alive[i] = 0; kill(chipMesh, i); continue; }
      const i3 = i * 3;
      let x = P.p[i3], y = P.p[i3 + 1], z = P.p[i3 + 2];
      let vx = P.v[i3], vy = P.v[i3 + 1], vz = P.v[i3 + 2];
      const r = Math.max(P.s[i3], P.s[i3 + 2]) * 0.3;
      if (!P.rest[i]) {
        vy -= GRAVITY.chip * dt;
        const drag = 1 - 0.8 * dt; vx *= drag; vy *= drag; vz *= drag;
        x += vx * dt; y += vy * dt; z += vz * dt;
        const gy = groundAt(x, z) + r;
        if (y < gy) {
          y = gy;
          if (vy < 0) {
            vy = -vy * 0.32; vx *= 0.65; vz *= 0.65;
            P.w[i3] *= 0.5; P.w[i3 + 1] *= 0.5; P.w[i3 + 2] *= 0.5;
            if (++P.bounce[i] >= 2 || vy < 0.45) {
              P.rest[i] = 1; vy = 0;
              P.life[i] = Math.min(P.life[i], P.age[i] + 0.3 + CHIP_FADE);
            }
          }
        }
      } else {
        const f = Math.exp(-14 * dt); vx *= f; vz *= f; vy = 0;
        x += vx * dt; z += vz * dt; y = groundAt(x, z) + r;
        const g = Math.exp(-10 * dt); P.w[i3] *= g; P.w[i3 + 1] *= g; P.w[i3 + 2] *= g;
      }
      P.p[i3] = x; P.p[i3 + 1] = y; P.p[i3 + 2] = z;
      P.v[i3] = vx; P.v[i3 + 1] = vy; P.v[i3 + 2] = vz;
      // roll: integrate angular velocity
      const wx = P.w[i3], wy = P.w[i3 + 1], wz = P.w[i3 + 2], wl = Math.hypot(wx, wy, wz);
      qA.set(P.q[i * 4], P.q[i * 4 + 1], P.q[i * 4 + 2], P.q[i * 4 + 3]);
      if (wl > 1e-3) {
        vA.set(wx / wl, wy / wl, wz / wl);
        qB.setFromAxisAngle(vA, wl * dt);
        qA.premultiply(qB).normalize();
        P.q[i * 4] = qA.x; P.q[i * 4 + 1] = qA.y; P.q[i * 4 + 2] = qA.z; P.q[i * 4 + 3] = qA.w;
      }
      const f = smooth((P.life[i] - P.age[i]) / CHIP_FADE);
      vP.set(x, y, z); vS.set(P.s[i3] * f, P.s[i3 + 1] * f, P.s[i3 + 2] * f);
      mat4.compose(vP, qA, vS).toArray(arr, i * 16);
      hi = i + 1;
    }
    P.hi = hi; chipMesh.count = hi;
    chipMesh.instanceMatrix.needsUpdate = true;
  }

  function updateSparks(dt) {
    const P = sparks, arr = sparkMesh.instanceMatrix.array, col = sparkMesh.instanceColor.array;
    let hi = 0;
    for (let i = 0; i < P.hi; i++) {
      if (!P.alive[i]) continue;
      P.age[i] += dt;
      const t = P.age[i] / P.life[i];
      if (t >= 1) { P.alive[i] = 0; kill(sparkMesh, i); continue; }
      const i3 = i * 3;
      let vx = P.v[i3], vy = P.v[i3 + 1], vz = P.v[i3 + 2];
      vy -= GRAVITY.spark * dt;
      const drag = 1 - 2.2 * dt; vx *= drag; vy *= drag; vz *= drag;
      let x = P.p[i3] + vx * dt, y = P.p[i3 + 1] + vy * dt, z = P.p[i3 + 2] + vz * dt;
      const gy = groundAt(x, z) + 0.002;
      if (y < gy) {
        y = gy;
        if (vy < 0) {
          if (P.bounce[i]++ === 0) { vy = -vy * 0.35; vx *= 0.6; vz *= 0.6; } else { P.age[i] = P.life[i]; }
        }
      }
      P.p[i3] = x; P.p[i3 + 1] = y; P.p[i3 + 2] = z;
      P.v[i3] = vx; P.v[i3 + 1] = vy; P.v[i3 + 2] = vz;
      const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const len = clamp(sp * 0.02, 0.014, 0.09) * (1 - t * 0.6);
      const wd = P.size[i] * (1 - t * 0.5);
      if (sp > 1e-4) { vA.set(vx / sp, vy / sp, vz / sp); qA.setFromUnitVectors(UP, vA); } else qA.identity();
      vP.set(x, y, z); vS.set(wd * 2, len, wd * 2);
      mat4.compose(vP, qA, vS).toArray(arr, i * 16);
      const fade = Math.pow(1 - t, 1.3);
      for (let a = 0; a < 3; a++) col[i3 + a] = (P.hot[i3 + a] * (1 - t) + P.base[i3 + a] * t) * fade;
      hi = i + 1;
    }
    P.hi = hi; sparkMesh.count = hi;
    sparkMesh.instanceMatrix.needsUpdate = true;
    sparkMesh.instanceColor.needsUpdate = true;
  }

  function updateDust(dt) {
    const P = dust, arr = dustMesh.instanceMatrix.array, tint = dustTint.array;
    let hi = 0;
    for (let i = 0; i < P.hi; i++) {
      if (!P.alive[i]) continue;
      P.age[i] += dt;
      const t = P.age[i] / P.life[i];
      if (t >= 1) { P.alive[i] = 0; kill(dustMesh, i); tint[i * 4 + 3] = 0; continue; }
      const i3 = i * 3, drag = Math.exp(-3.2 * dt);
      P.v[i3] *= drag; P.v[i3 + 1] = P.v[i3 + 1] * drag + 0.15 * dt; P.v[i3 + 2] *= drag;
      P.p[i3] += P.v[i3] * dt; P.p[i3 + 1] += P.v[i3 + 1] * dt; P.p[i3 + 2] += P.v[i3 + 2] * dt;
      const s = P.size[i] + (P.size1[i] - P.size[i]) * Math.sqrt(t);
      vP.set(P.p[i3], P.p[i3 + 1], P.p[i3 + 2]); vS.set(s, s, s);
      mat4.compose(vP, qId, vS).toArray(arr, i * 16);
      tint[i * 4 + 3] = P.amax[i] * smooth(t / 0.12) * (1 - t) * (1 - t);
      hi = i + 1;
    }
    P.hi = hi; dustMesh.count = hi;
    dustMesh.instanceMatrix.needsUpdate = true;
    dustTint.needsUpdate = true;
  }

  function updateFlashes(dt) {
    const P = flashes, arr = flashMesh.instanceMatrix.array, tint = flashTint.array;
    let hi = 0;
    for (let i = 0; i < P.hi; i++) {
      if (!P.alive[i]) continue;
      P.age[i] += dt;
      const t = P.age[i] / P.life[i];
      if (t >= 1) { P.alive[i] = 0; kill(flashMesh, i); tint[i * 4 + 3] = 0; continue; }
      const s = P.size[i] * (0.55 + 0.45 * Math.sqrt(t));
      vP.set(P.p[i * 3], P.p[i * 3 + 1], P.p[i * 3 + 2]); vS.set(s, s, s);
      mat4.compose(vP, qId, vS).toArray(arr, i * 16);
      tint[i * 4 + 3] = (1 - t) * (1 - t) * 1.4;
      hi = i + 1;
    }
    P.hi = hi; flashMesh.count = hi;
    flashMesh.instanceMatrix.needsUpdate = true;
    flashTint.needsUpdate = true;
  }

  function update(dt) {
    if (disposed || !fin(dt) || dt <= 0) return;
    dt = Math.min(dt, 0.05);
    if (chips.hi) updateChips(dt);
    if (sparks.hi) updateSparks(dt);
    if (dust.hi) updateDust(dt);
    if (flashes.hi) updateFlashes(dt);
  }

  function stats() {
    const live = (P) => { let c = 0; for (let i = 0; i < P.hi; i++) c += P.alive[i]; return c; };
    return {
      chips: live(chips), sparks: live(sparks), dust: live(dust), flashes: live(flashes),
      caps: { ...IMPACT_CAPS }, emitted, rejected, drawCalls: 4, disposed,
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const m of [chipMesh, sparkMesh, dustMesh, flashMesh]) {
      if (m.parent) m.parent.remove(m);
      m.dispose();
    }
    chipGeo.dispose(); sparkGeo.dispose(); dustGeo.dispose(); flashGeo.dispose();
    chipMat.dispose(); sparkMat.dispose(); dustMat.dispose(); flashMat.dispose();
  }

  return { emit, update, stats, dispose };
}

export default createImpactPresentation;
