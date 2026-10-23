// Living meadow: instanced grass tufts, wildflower patches and drifting pollen motes over the orchard ground.
// Presentation only. Never changes heights, collision, raycast targets or gameplay; reads the caller's
// authoritative height(x, z) and the same orchard layout/dryness/disturbance functions the ground shader uses,
// so grass parts around paths, the forge yard, fresh craters, structures and landmarks.
// Budget: four draws (grass, flowers, lawn daisies, motes), fixed-capacity instance buffers refilled around the view
// focus only after it moves, cells rebuilt lazily after terrain/structure changes. One small texture (the daisy heads,
// cut from Mitch's walk photo: assets/trees-canopy-20261004/photo_textures.py); no lights or shadow casters.
import * as THREE from 'three';
import {armouryPiece} from '../shared/home-bases.js';
import {squareAt} from '../shared/town-square.js';
import {loadDeliveredTexture} from './texture-delivery.js';
import {ORCHARD_LAYOUT, valueNoise, hash2, dryness, disturbanceAt} from './orchard-presentation.js';
import {STARTING_SITES, STARTING_PATHS} from '../shared/starting-world.js';
import {STRUCTURES} from '../shared/inventions.js';
import {FOUNDATION_HALF} from '../shared/terrain.js';

export const MEADOW_VERSION = 1;
export const MEADOW_QUALITY = Object.freeze({
  high: {grass: 9000, flowers: 1600, daisies: 320, motes: 96, radius: 22, spacing: .42, blades: 12},
  low: {grass: 3200, flowers: 700, daisies: 140, motes: 40, radius: 14, spacing: .55, blades: 8},
  xr: {grass: 3500, flowers: 800, daisies: 140, radius: 14}, // per-eye cost while presenting in a headset
});
export const FILL_BUDGET_MS = 1.5; // cell baking per frame; nearest cells first, the rest fill in over following frames
const CELL = 8, EXTENT = 44, CELLS = Math.ceil(EXTENT * 2 / CELL), MARGIN = 3, REFILL_MOVE = 2;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const segDist = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz || 1, t = Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / l)); return Math.hypot(px - ax - dx * t, pz - az - dz * t); };

// Orchard wear (paths/clearings) exactly as surfaceSample() computes it, without the per-tree canopy scan.
export function meadowWear(x, z, layout = ORCHARD_LAYOUT) {
  const wx = x + (valueNoise(x * .23 + 5.1, z * .23) - .5) * 1.1, wz = z + (valueNoise(x * .23 - 7.7, z * .23 + 2.3) - .5) * 1.1;
  let wear = 0;
  for (const [cx, cz, r, w] of layout.clearings) wear = Math.max(wear, w * smooth(r * 1.45, r * .55, Math.hypot(wx - cx, wz - cz)));
  for (const [ax, az, bx, bz, hw, w] of layout.paths) wear = Math.max(wear, w * smooth(hw * 1.9, hw * .45, segDist(wx, wz, ax, az, bx, bz)));
  return Math.min(1, wear);
}
const landmarkBoxes = STARTING_SITES.flatMap(s => s.footprints.map(b => ({...b, c: Math.cos(b.rotY), s: Math.sin(b.rotY)})));
// Distance outside the nearest landmark path ribbon (negative inside) and whether a footprint covers the point.
function landmarkClearance(x, z) {
  let path = Infinity;
  for (const p of STARTING_PATHS) for (let i = 1; i < p.points.length; i++) { const [a, b] = [p.points[i - 1], p.points[i]]; path = Math.min(path, segDist(x, z, a[0], a[1], b[0], b[1]) - p.width / 2); }
  let inside = false;
  for (const b of landmarkBoxes) { const dx = x - b.x, dz = z - b.z; if (dx * dx + dz * dz > (b.w + b.d + 1) ** 2) continue; const u = dx * b.c - dz * b.s, v = dx * b.s + dz * b.c; if (Math.abs(u) < b.w / 2 + .25 && Math.abs(v) < b.d / 2 + .25) { inside = true; break; } }
  return {path, inside};
}

// The Armoury's floor (shared/home-bases.js): no meadow through its flagstones.
const ARMOURY_FLOOR = (() => { const a = armouryPiece(); return {x: a.x, z: a.z, c: Math.cos(a.yaw), s: Math.sin(a.yaw)}; })();
function insideArmoury(x, z) {
  const dx = x - ARMOURY_FLOOR.x, dz = z - ARMOURY_FLOOR.z, u = dx * ARMOURY_FLOOR.c - dz * ARMOURY_FLOOR.s, v = dx * ARMOURY_FLOOR.s + dz * ARMOURY_FLOOR.c;
  return Math.abs(u) < 3.75 && Math.abs(v) < 3.05;
}

// Linear-space tints matched to the ground shader's tile average and its lush/dry grades.
const LUSH = [.058, .148, .012], DRY = [.21, .158, .058];
const FLOWERS = [
  {petal: [1.0, .98, .9], centre: [1.0, .55, .02], size: .09, height: [.3, .46]}, // meadow daisy
  {petal: [1.0, .62, .0], centre: [.75, .35, .0], size: .075, height: [.26, .4]}, // buttercup
  {petal: [.28, .1, .78], centre: [1.0, .8, .2], size: .08, height: [.34, .52]}, // wild violet
  {petal: [.9, .1, .03], centre: [.08, .03, .02], size: .1, height: [.32, .5]}, // poppy
  {petal: [.35, .8, 1.0], centre: [.9, 1.0, 1.0], size: .085, height: [.36, .55], glow: 1}, // moonbell: faint magical glow
];

// Static candidates per cell: deterministic from position only (identical for every peer and reload).
export function bakeCellStatic(ci, cj, cfg, landmarks) {
  const x0 = -EXTENT + ci * CELL, z0 = -EXTENT + cj * CELL, grass = [], flowers = [], daisies = [];
  const n = Math.round(CELL / cfg.spacing), step = CELL / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const gi = ci * n + i, gj = cj * n + j, x = x0 + (i + hash2(gi, gj * 3 + 1)) * step, z = z0 + (j + hash2(gi * 5 + 2, gj)) * step;
    if (Math.max(Math.abs(x), Math.abs(z)) > EXTENT - (valueNoise(x * .37 + 5, z * .37) - .5) * 1.6 - .8) continue; // thin out into the mountain-foot moss band
    if (Math.hypot(x, z) < 4.4) continue; // forge plaza stays bare
    const wear = meadowWear(x, z); if (wear > .6) continue; // bare foot-worn earth
    const lm = landmarks ? landmarkClearance(x, z) : {path: Infinity, inside: false};
    if (lm.inside || lm.path < .15 || insideArmoury(x, z) || squareAt(x, z)) continue; // no meadow through the town squares' cobbles
    const trodden = Math.max(smooth(.12, .5, wear), lm.path < 1 ? 1 - lm.path : 0);
    const clump = valueNoise(x * .21 + 13, z * .21 - 9), dense = .55 + .45 * clump;
    if (hash2(gi * 7 + 3, gj * 11 + 5) > dense * (1 - trodden * .92)) continue;
    const dry = dryness(x, z), macro = valueNoise(x * .018 + 3, z * .018 + 3), jitter = hash2(gi + 91, gj + 37);
    const shade = (.84 + .3 * macro) * (.86 + .28 * jitter);
    const tint = [0, 1, 2].map(k => (LUSH[k] + (DRY[k] - LUSH[k]) * dry * .6) * shade);
    // Tall straw in dry drifts, lush mid-height turf elsewhere, short cropped grass at path fringes.
    const h = (.2 + .16 * clump + .16 * dry + .1 * hash2(gi, gj + 400)) * (1 - .6 * trodden);
    grass.push(x, z, h, tint[0], tint[1], tint[2], hash2(gi + 17, gj - 23) * Math.PI * 2);
    // Wildflowers gather in drifts of one or two kinds, never on trodden ground.
    const drift = valueNoise(x * .085 + 40, z * .085 - 17);
    if (trodden < .2 && hash2(gi * 13 + 7, gj * 3 + 9) < .035 + .55 * smooth(.46, .72, drift)) { // drifts plus the odd lone bloom
      const pick = valueNoise(x * .05 - 21, z * .05 + 33) * 4.6 + hash2(gi, gj + 900) * .9;
      const kind = hash2(gi + 300, gj + 300) < .06 ? 4 : Math.min(3, Math.floor(pick)); // moonbells are rare finds
      const f = FLOWERS[kind], fh = f.height[0] + (f.height[1] - f.height[0]) * hash2(gi + 61, gj + 7);
      const ox = (hash2(gi + 5, gj + 15) - .5) * step * .6, oz = (hash2(gi + 25, gj + 35) - .5) * step * .6;
      flowers.push(x + ox, z + oz, fh, kind, hash2(gi + 41, gj + 43) * Math.PI * 2);
    }
    // Lawn daisies like short, foot-worn turf: path fringes and the odd grazed patch, in low clumps of photo heads.
    const fringe = smooth(.1, .4, trodden) * (1 - smooth(.7, .98, trodden)), lawn = smooth(.6, .78, valueNoise(x * .11 - 60, z * .11 + 12));
    if (hash2(gi * 17 + 11, gj * 5 + 3) < .14 * fringe + .06 * lawn * (1 - dry)) {
      daisies.push(x + (hash2(gi + 71, gj + 3) - .5) * step * .5, z + (hash2(gi + 9, gj + 81) - .5) * step * .5, .8 + .45 * hash2(gi + 33, gj + 77), Math.floor(hash2(gi + 13, gj + 19) * 8), hash2(gi + 57, gj + 59) * Math.PI * 2);
    }
  }
  return {grass: new Float32Array(grass), flowers: new Float32Array(flowers), daisies: new Float32Array(daisies)};
}

// ---------- geometry ----------
// Blade: tapered, pre-curved strip. uv.y = height fraction (drives wind/trample/colour). Normals point up so the
// tuft shades like the ground it grows from instead of flickering with blade orientation.
function grassTuftGeometry(blades) {
  const pos = [], uv = [], idx = [], rows = [0, .5, 1];
  for (let b = 0; b < blades; b++) {
    const a = b / blades * Math.PI * 2 + hash2(b, 7) * 1.4, r = .03 + .13 * hash2(b, 11), lean = .06 + .2 * hash2(b, 13);
    const ca = Math.cos(a), sa = Math.sin(a), w = .018 + .016 * hash2(b, 17), hk = .55 + .45 * hash2(b, 19), base = pos.length / 3;
    for (const t of rows) {
      const bend = lean * t * t, cx = ca * (r + bend), cz = sa * (r + bend), y = t * hk * (1 - .12 * lean * t), half = w * (1 - t * .7);
      if (t === 1) { pos.push(cx, y, cz); uv.push(.5, t); continue; }
      pos.push(cx - sa * half, y, cz + ca * half, cx + sa * half, y, cz - ca * half); uv.push(0, t, 1, t);
    }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => i % 3 === 1 ? 1 : 0), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
// Flower: crossed stem, five cupped petals and a raised centre. uv.x = part (0 stem, 1 petal, 2 centre), uv.y = height fraction.
function flowerGeometry() {
  const pos = [], uv = [], nrm = [], idx = [];
  const v = (x, y, z, part, t, ny = 1) => { pos.push(x, y, z); uv.push(part, t); nrm.push(0, ny, 0); return pos.length / 3 - 1; };
  for (const [dx, dz] of [[1, 0], [0, 1]]) { // stem from ground (y=0) to head (y=1)
    const w = .008, a = v(-dx * w, 0, -dz * w, 0, 0), b = v(dx * w, 0, dz * w, 0, 0), c = v(-dx * w * .7, 1, -dz * w * .7, 0, 1), d = v(dx * w * .7, 1, dz * w * .7, 0, 1);
    idx.push(a, b, c, b, d, c);
    const la = v(0, .3, 0, 0, .3), lb = v(dx * .05 + dz * .02, .42, dz * .05 - dx * .02, 0, .42), lc = v(dx * .02, .5, dz * .02, 0, .5); // a leaf
    idx.push(la, lb, lc);
  }
  for (let p = 0; p < 5; p++) { // petals in head-local units (scaled by petal size in the shader)
    const a = p / 5 * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), px = -sa, pz = ca;
    const root = v(ca * .15, 1, sa * .15, 1, 1), l = v(ca * .55 + px * .42, 1.12, sa * .55 + pz * .42, 1, 1), r = v(ca * .55 - px * .42, 1.12, sa * .55 - pz * .42, 1, 1), tip = v(ca * 1.0, 1.28, sa * 1.0, 1, 1);
    idx.push(root, l, r, l, tip, r);
  }
  const ring = [];
  for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; ring.push(v(Math.cos(a) * .28, 1.08, Math.sin(a) * .28, 2, 1)); }
  const top = v(0, 1.2, 0, 2, 1);
  for (let k = 0; k < 6; k++) idx.push(ring[k], ring[(k + 1) % 6], top);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// Lawn daisy clump: seven photo daisy heads facing the sky on short stems. aDaisy = (part 0 stem / 1 head, sprite cell,
// height fraction); uv is the head's 0..1 square inside its sprite cell. Heads tilt a little so the clump catches light.
export const DAISY_SHEET = Object.freeze({cols: 4, rows: 2, url: 'daisies.png'});
function daisyClumpGeometry() {
  const pos = [], uv = [], nrm = [], dz = [], idx = [];
  const v = (x, y, z, u, w, part, cell, t, n = [0, 1, 0]) => { pos.push(x, y, z); uv.push(u, w); nrm.push(...n); dz.push(part, cell, t); return pos.length / 3 - 1; };
  for (let k = 0; k < 7; k++) {
    const a = k * 2.4 + hash2(k, 3) * .8, r = k ? .08 + .22 * hash2(k, 5) : 0, cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const h = .16 + .16 * hash2(k, 7), size = .05 + .028 * hash2(k, 11), cell = k % 8; // stand clear of the tufts, heads big enough to read from eye height
    for (const [dx, dzz] of [[1, 0], [0, 1]]) { // crossed stem quads, ground to head
      const w = .005, s0 = v(cx - dx * w, 0, cz - dzz * w, .5, .5, 0, cell, 0), s1 = v(cx + dx * w, 0, cz + dzz * w, .5, .5, 0, cell, 0);
      const s2 = v(cx - dx * w, h, cz - dzz * w, .5, .5, 0, cell, 1), s3 = v(cx + dx * w, h, cz + dzz * w, .5, .5, 0, cell, 1);
      idx.push(s0, s1, s2, s1, s3, s2);
    }
    const tilt = .2 + .45 * hash2(k, 13), ta = hash2(k, 17) * Math.PI * 2, tx = Math.cos(ta) * tilt, tz = Math.sin(ta) * tilt; // tilt toward a random side
    const n = [-tx, 1, -tz], nl = Math.hypot(...n), nn = n.map(c => c / nl), spin = hash2(k, 19) * Math.PI * 2, cs = Math.cos(spin), sn = Math.sin(spin), base = [];
    for (const [u, w] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      const lx = (u - .5) * 2 * size, lz = (w - .5) * 2 * size, x = lx * cs - lz * sn, z = lx * sn + lz * cs;
      base.push(v(cx + x, h + .003 + x * tx + z * tz, cz + z, u, w, 1, cell, 1, nn));
    }
    idx.push(base[0], base[1], base[2], base[0], base[2], base[3]);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aDaisy', new THREE.Float32BufferAttribute(dz, 3));
  g.setIndex(idx);
  return g;
}

// ---------- shaders (patched MeshStandardMaterial: same lights, fog and shadows as the ground) ----------
const COMMON_VERT = /* glsl */`
uniform float uMeadowTime, uMeadowRadius;
uniform vec3 uMeadowFocus;
uniform vec2 uMeadowWind;
uniform vec4 uMeadowPush[4];
attribute vec4 aMeadowPos; // xyz root, w height
attribute vec4 aMeadowTint; // rgb tint (or kind), w yaw
varying vec3 vMeadowTint;
varying vec2 vMeadowUv;
vec2 meadowSway(vec2 root, float h, float stiff) {
  float ph = dot(root, vec2(.31, .23)) + uMeadowTime * 1.6;
  float gust = .55 + .45 * sin(dot(root, vec2(.045, .03)) - uMeadowTime * .55); // slow travelling gust fronts
  vec2 sway = uMeadowWind * gust * (.7 + .3 * sin(ph)) + vec2(sin(ph * 1.7 + 1.3), cos(ph * 1.3)) * .035;
  return sway * h * h / stiff;
}
vec3 meadowTrample(vec3 p, vec2 root, float h) {
  vec2 off = vec2(0.0); float mFlat = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 q = uMeadowPush[i]; if (q.w <= 0.0) continue;
    vec2 d = root - q.xz; float l = length(d); float k = 1.0 - smoothstep(q.w * .35, q.w, l);
    off += (l > 1e-3 ? d / l : vec2(0.0)) * k * .32; mFlat = max(mFlat, k);
  }
  p.xz += off * h; p.y *= 1.0 - mFlat * .5;
  return p;
}
`;
function patchGrass(shader, U) {
  Object.assign(shader.uniforms, U);
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + COMMON_VERT)
    .replace('#include <begin_vertex>', /* glsl */`
    float mH = uv.y; vMeadowUv = uv;
    float mFade = smoothstep(uMeadowRadius, uMeadowRadius - 6.0, distance(aMeadowPos.xz, uMeadowFocus.xz));
    float mC = cos(aMeadowTint.w), mS = sin(aMeadowTint.w);
    vec3 transformed = vec3(mC * position.x - mS * position.z, position.y, mS * position.x + mC * position.z);
    transformed *= vec3(mix(.75, 1.15, fract(aMeadowTint.w * 3.7)), aMeadowPos.w, mix(.75, 1.15, fract(aMeadowTint.w * 3.7))) * mFade;
    transformed.xz += meadowSway(aMeadowPos.xz, mH, 1.0) * aMeadowPos.w;
    transformed = meadowTrample(transformed, aMeadowPos.xz, mH);
    transformed += aMeadowPos.xyz;
    vMeadowTint = aMeadowTint.rgb;`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vMeadowTint;\nvarying vec2 vMeadowUv;')
    .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal); // both faces shade like the ground they grow from')
    .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
    // Root occlusion into the soil, sunlit straw-gold tips, a faint mid-blade crease.
    float mT = vMeadowUv.y;
    vec3 mCol = vMeadowTint * mix(.62, 1.42, smoothstep(0.0, .9, mT));
    mCol = mix(mCol, mCol * vec3(1.18, 1.1, .7) + vec3(.02, .015, 0.0), smoothstep(.6, 1.0, mT) * .35);
    mCol *= .92 + .16 * abs(vMeadowUv.x - .5) * 2.0;
    diffuseColor.rgb = mCol;`);
}
function patchFlowers(shader, U) {
  Object.assign(shader.uniforms, U);
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + COMMON_VERT + 'uniform vec3 uFlowerPetal[5], uFlowerCentre[5];\nuniform float uFlowerSize[5];\nvarying float vFlowerGlow;')
    .replace('#include <begin_vertex>', /* glsl */`
    int mK = int(aMeadowTint.x + .5);
    float mH = uv.y; vMeadowUv = uv;
    float mFade = smoothstep(uMeadowRadius, uMeadowRadius - 6.0, distance(aMeadowPos.xz, uMeadowFocus.xz));
    float mC = cos(aMeadowTint.w), mS = sin(aMeadowTint.w);
    vec3 p = position;
    if (uv.x > .5) { p.xz *= uFlowerSize[mK]; p.y = 1.0 + (p.y - 1.0) * uFlowerSize[mK]; } // head parts scale with petal size
    p.y *= aMeadowPos.w;
    vec3 transformed = vec3(mC * p.x - mS * p.z, p.y, mS * p.x + mC * p.z) * mFade;
    transformed.xz += meadowSway(aMeadowPos.xz + 3.1, min(mH, 1.0), 1.3) * aMeadowPos.w;
    transformed = meadowTrample(transformed, aMeadowPos.xz, mH);
    transformed += aMeadowPos.xyz;
    vMeadowTint = uv.x < .5 ? vec3(.05, .13, .02) * (.6 + .5 * mH) : uv.x < 1.5 ? uFlowerPetal[mK] : uFlowerCentre[mK];
    vFlowerGlow = mK == 4 && uv.x > .5 ? .55 + .45 * sin(uMeadowTime * 1.3 + aMeadowTint.w * 4.0) : 0.0;`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vMeadowTint;\nvarying vec2 vMeadowUv;\nvarying float vFlowerGlow;')
    .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal); // both faces shade like the ground they grow from')
    .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vMeadowTint;')
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vMeadowTint * vFlowerGlow * .9;');
}

function patchDaisies(shader, U) {
  Object.assign(shader.uniforms, U);
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + COMMON_VERT + 'attribute vec3 aDaisy;\nvarying float vDaisyPart;')
    .replace('#include <uv_vertex>', /* glsl */`#include <uv_vertex>
    #ifdef USE_MAP
    { float cell = mod(aDaisy.y + aMeadowTint.x, ${DAISY_SHEET.cols * DAISY_SHEET.rows}.0); // per-clump shuffle of the photo heads
      vec2 c = vec2(mod(cell, ${DAISY_SHEET.cols}.0), floor(cell / ${DAISY_SHEET.cols}.0));
      vMapUv = vec2((c.x + uv.x) / ${DAISY_SHEET.cols}.0, 1.0 - (c.y + 1.0 - uv.y) / ${DAISY_SHEET.rows}.0); }
    #endif`)
    .replace('#include <begin_vertex>', /* glsl */`
    float mH = aDaisy.z; vMeadowUv = uv; vDaisyPart = aDaisy.x;
    float mFade = smoothstep(uMeadowRadius, uMeadowRadius - 6.0, distance(aMeadowPos.xz, uMeadowFocus.xz));
    float mC = cos(aMeadowTint.w), mS = sin(aMeadowTint.w);
    vec3 transformed = vec3(mC * position.x - mS * position.z, position.y, mS * position.x + mC * position.z) * aMeadowPos.w * mFade;
    transformed.xz += meadowSway(aMeadowPos.xz + 7.7, mH, 3.0) * .25;
    transformed = meadowTrample(transformed, aMeadowPos.xz, mH);
    transformed += aMeadowPos.xyz;
    vMeadowTint = vec3(0.0);`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vMeadowTint;\nvarying vec2 vMeadowUv;\nvarying float vDaisyPart;')
    .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
    .replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\nif (vDaisyPart < .5) diffuseColor.rgb = vec3(.06, .14, .03) * (.7 + .5 * vMeadowUv.y);'); // stems: plain green, never cut
}

// Pollen and drifting light motes: a wrapped box of points that follows the focus, so it never needs CPU updates.
function createMotes(count, U) {
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) seeds.set([hash2(i, 1), hash2(i, 2), hash2(i, 3), hash2(i, 4)], i * 4);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const m = new THREE.ShaderMaterial({
    uniforms: {uMeadowTime: U.uMeadowTime, uMeadowFocus: U.uMeadowFocus, uMeadowWind: U.uMeadowWind, uMotePixel: {value: 1}},
    vertexShader: /* glsl */`uniform float uMeadowTime, uMotePixel; uniform vec3 uMeadowFocus; uniform vec2 uMeadowWind; attribute vec4 seed; varying float vA; varying vec3 vC;
      void main(){
        const vec3 box = vec3(22.0, 2.6, 22.0);
        vec3 drift = vec3(uMeadowWind.x * .9 + (seed.w - .5) * .25, 0.0, uMeadowWind.y * .9 + (seed.x - .5) * .25) * uMeadowTime;
        vec3 q = fract(seed.xyz + drift / box - uMeadowFocus / box * vec3(1.0, 0.0, 1.0)) - .5;
        q.y = seed.y;
        vec3 w = uMeadowFocus + q * box * vec3(1.0, 1.0, 1.0); w.y = uMeadowFocus.y + .25 + seed.y * box.y;
        w += vec3(sin(uMeadowTime * .7 + seed.w * 20.0), sin(uMeadowTime * 1.1 + seed.z * 15.0) * .5, cos(uMeadowTime * .6 + seed.x * 17.0)) * .35;
        vec2 e = abs(q.xz) * 2.0; float edge = 1.0 - smoothstep(.7, 1.0, max(e.x, e.y));
        float tw = .5 + .5 * sin(uMeadowTime * (1.5 + seed.z * 2.5) + seed.w * 40.0);
        vA = edge * (.25 + .75 * tw * tw);
        vC = seed.w > .82 ? vec3(.55, .95, 1.0) : vec3(1.0, .86, .5); // most motes are pollen-gold, a few moonbell-blue sparks
        vec4 mv = modelViewMatrix * vec4(w, 1.0);
        gl_PointSize = uMotePixel * (seed.w > .82 ? 2.4 : 1.6) * 14.0 / max(.5, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`varying float vA; varying vec3 vC;
      void main(){ vec2 d = gl_PointCoord - .5; float r = dot(d, d) * 4.0; float a = vA * exp(-r * 3.5); if (a < .01) discard; gl_FragColor = vec4(vC * a, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(g, m); points.name = 'meadow-motes'; points.frustumCulled = false; points.raycast = () => {};
  return points;
}

export function createMeadowCover({scene, height, quality = 'high', renderer = null, landmarks = true, wind = [.55, .22], assetBase = '/assets/', daisyTexture = null} = {}) {
  if (!scene || typeof height !== 'function') throw new Error('createMeadowCover requires scene and height(x, z)');
  const q = MEADOW_QUALITY[quality] ? quality : 'high', cfg = MEADOW_QUALITY[q];
  const U = {uMeadowTime: {value: 0}, uMeadowRadius: {value: cfg.radius}, uMeadowFocus: {value: new THREE.Vector3(0, 0, 8)},
    uMeadowWind: {value: new THREE.Vector2(...wind)}, uMeadowPush: {value: [0, 1, 2, 3].map(() => new THREE.Vector4())}};
  const FU = {...U, uFlowerPetal: {value: FLOWERS.map(f => new THREE.Vector3(...f.petal))}, uFlowerCentre: {value: FLOWERS.map(f => new THREE.Vector3(...f.centre))}, uFlowerSize: {value: FLOWERS.map(f => f.size)}};

  const grassGeo = grassTuftGeometry(cfg.blades), flowerGeo = flowerGeometry(), daisyGeo = daisyClumpGeometry();
  const grassPos = new THREE.InstancedBufferAttribute(new Float32Array(cfg.grass * 4), 4), grassTint = new THREE.InstancedBufferAttribute(new Float32Array(cfg.grass * 4), 4);
  const flowerPos = new THREE.InstancedBufferAttribute(new Float32Array(cfg.flowers * 4), 4), flowerTint = new THREE.InstancedBufferAttribute(new Float32Array(cfg.flowers * 4), 4);
  const daisyPos = new THREE.InstancedBufferAttribute(new Float32Array(cfg.daisies * 4), 4), daisyTint = new THREE.InstancedBufferAttribute(new Float32Array(cfg.daisies * 4), 4);
  for (const a of [grassPos, grassTint, flowerPos, flowerTint, daisyPos, daisyTint]) a.setUsage(THREE.DynamicDrawUsage);
  daisyGeo.setAttribute('aMeadowPos', daisyPos); daisyGeo.setAttribute('aMeadowTint', daisyTint); daisyGeo.instanceCount = 0;
  grassGeo.setAttribute('aMeadowPos', grassPos); grassGeo.setAttribute('aMeadowTint', grassTint); grassGeo.instanceCount = 0;
  flowerGeo.setAttribute('aMeadowPos', flowerPos); flowerGeo.setAttribute('aMeadowTint', flowerTint); flowerGeo.instanceCount = 0;
  const grassMat = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: .82, metalness: 0, side: THREE.DoubleSide});
  grassMat.onBeforeCompile = s => patchGrass(s, U); grassMat.customProgramCacheKey = () => `meadow-grass-v${MEADOW_VERSION}`;
  const flowerMat = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: .6, metalness: 0, side: THREE.DoubleSide, emissive: 0x000000});
  flowerMat.onBeforeCompile = s => patchFlowers(s, FU); flowerMat.customProgramCacheKey = () => `meadow-flowers-v${MEADOW_VERSION}`;
  // Daisy heads are alpha-cut photo sprites; the clump stays hidden until the sheet arrives (never white squares).
  const daisyMat = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: .75, metalness: 0, side: THREE.DoubleSide, alphaTest: .5});
  daisyMat.onBeforeCompile = s => patchDaisies(s, U); daisyMat.customProgramCacheKey = () => `meadow-daisies-v${MEADOW_VERSION}`;
  const grass = new THREE.Mesh(grassGeo, grassMat), flowers = new THREE.Mesh(flowerGeo, flowerMat), daisies = new THREE.Mesh(daisyGeo, daisyMat);
  for (const [m, name] of [[grass, 'meadow-grass'], [flowers, 'meadow-flowers'], [daisies, 'meadow-daisies']]) { m.name = name; m.frustumCulled = false; m.receiveShadow = true; m.raycast = () => {}; scene.add(m); }
  daisies.visible = false; let daisyTex = daisyTexture || null, disposed = false;
  const useDaisyTex = tex => { tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = Math.min(4, renderer?.capabilities?.getMaxAnisotropy?.() || 1); daisyMat.map = tex; daisyMat.needsUpdate = true; daisies.visible = true; };
  if (daisyTex) useDaisyTex(daisyTex);
  else if (typeof document !== 'undefined') loadDeliveredTexture(new THREE.TextureLoader(), assetBase + DAISY_SHEET.url, tex => { if (disposed) { tex.dispose(); return; } daisyTex = tex; useDaisyTex(tex); }, undefined, () => {}); // decorative: the meadow reads fine without them
  const motes = cfg.motes ? createMotes(cfg.motes, U) : null; if (motes) scene.add(motes);

  // Lazy per-cell state: static candidates (deterministic) + dynamic visibility/heights (terrain, structures).
  const cells = Array.from({length: CELLS * CELLS}, () => null);
  let edits = [], terrainTick = Infinity, blockers = [], deposits = [], blockerKey = '', terrainVersion = 0, blockerVersion = 0;
  let xr = false;
  const limits = () => xr ? {grass: Math.min(cfg.grass, MEADOW_QUALITY.xr.grass), flowers: Math.min(cfg.flowers, MEADOW_QUALITY.xr.flowers), daisies: Math.min(cfg.daisies, MEADOW_QUALITY.xr.daisies), radius: Math.min(cfg.radius, MEADOW_QUALITY.xr.radius)} : cfg;
  let filledAt = null, forceFill = true, fills = 0, lastFillMs = 0, maxFillMs = 0, rebuiltCells = 0, time = 0;
  const focus = new THREE.Vector3(), camPos = new THREE.Vector3(), camDir = new THREE.Vector3();
  function cellAt(ci, cj, deadline = Infinity) {
    const k = cj * CELLS + ci; let c = cells[k];
    if ((!c || c.terrain !== terrainVersion || c.blockers !== blockerVersion) && performance.now() > deadline) return null; // finish next frame
    if (!c) c = cells[k] = {ci, cj, ...bakeCellStatic(ci, cj, cfg, landmarks), gy: null, fy: null, terrain: -1, blockers: -1, dirtyRects: null};
    if (c.terrain !== terrainVersion || c.blockers !== blockerVersion) refreshCell(c);
    return c;
  }
  const blocked = (x, z) => {
    for (const b of blockers) if (b.square ? Math.max(Math.abs(x - b.x), Math.abs(z - b.z)) < b.r : (x - b.x) ** 2 + (z - b.z) ** 2 < b.r * b.r) return true;
    for (const d of deposits) if ((x - d[0]) ** 2 + (z - d[1]) ** 2 < 1.1) return true;
    return false;
  };
  function refreshCell(c) {
    const x0 = -EXTENT + c.ci * CELL, z0 = -EXTENT + c.cj * CELL, nearEdit = edits.filter(e => e.x + e.radius * 1.25 > x0 && e.x - e.radius * 1.25 < x0 + CELL && e.z + e.radius * 1.25 > z0 && e.z - e.radius * 1.25 < z0 + CELL);
    const nearBlock = blockers.length || deposits.length;
    const fill = (src, stride, out) => {
      for (let i = 0, o = 0; i < src.length; i += stride, o++) {
        const x = src[i], z = src[i + 1];
        out[o] = (nearEdit.length && disturbanceAt(x, z, nearEdit, terrainTick) > .3) || (nearBlock && blocked(x, z)) ? NaN : height(x, z);
      }
    };
    c.gy ||= new Float32Array(c.grass.length / 7); c.fy ||= new Float32Array(c.flowers.length / 5); c.dy ||= new Float32Array(c.daisies.length / 5);
    fill(c.grass, 7, c.gy); fill(c.flowers, 5, c.fy); fill(c.daisies, 5, c.dy);
    c.terrain = terrainVersion; c.blockers = blockerVersion; rebuiltCells++;
  }
  function refill() {
    const t0 = performance.now(), lim = limits(), R = lim.radius + MARGIN, fx = focus.x, fz = focus.z;
    const i0 = Math.max(0, Math.floor((fx - R + EXTENT) / CELL)), i1 = Math.min(CELLS - 1, Math.floor((fx + R + EXTENT) / CELL));
    const j0 = Math.max(0, Math.floor((fz - R + EXTENT) / CELL)), j1 = Math.min(CELLS - 1, Math.floor((fz + R + EXTENT) / CELL));
    const order = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = Math.max(-EXTENT + i * CELL, Math.min(fx, -EXTENT + (i + 1) * CELL)), cz = Math.max(-EXTENT + j * CELL, Math.min(fz, -EXTENT + (j + 1) * CELL));
      const d = Math.hypot(cx - fx, cz - fz); if (d < R) order.push([d, i, j]);
    }
    order.sort((a, b) => a[0] - b[0]);
    let g = 0, f = 0, n = 0, reach = R;
    const gp = grassPos.array, gt = grassTint.array, fp = flowerPos.array, ft = flowerTint.array, dp = daisyPos.array, dt = daisyTint.array, R2 = R * R;
    let pending = false;
    for (const [d, i, j] of order) {
      if (g >= lim.grass) { reach = Math.min(reach, d); break; }
      const c = cellAt(i, j, t0 + FILL_BUDGET_MS);
      if (!c) { pending = true; continue; }
      for (let s = 0, k = 0; s < c.grass.length; s += 7, k++) {
        const y = c.gy[k], x = c.grass[s], z = c.grass[s + 1]; if (y !== y || (x - fx) ** 2 + (z - fz) ** 2 > R2) continue;
        if (g >= lim.grass) { reach = Math.min(reach, Math.hypot(x - fx, z - fz)); break; }
        const o = g * 4; gp[o] = x; gp[o + 1] = y - .02; gp[o + 2] = z; gp[o + 3] = c.grass[s + 2];
        gt[o] = c.grass[s + 3]; gt[o + 1] = c.grass[s + 4]; gt[o + 2] = c.grass[s + 5]; gt[o + 3] = c.grass[s + 6]; g++;
      }
      for (let s = 0, k = 0; s < c.flowers.length && f < lim.flowers; s += 5, k++) {
        const y = c.fy[k], x = c.flowers[s], z = c.flowers[s + 1]; if (y !== y || (x - fx) ** 2 + (z - fz) ** 2 > R2) continue;
        const o = f * 4; fp[o] = x; fp[o + 1] = y - .02; fp[o + 2] = z; fp[o + 3] = c.flowers[s + 2]; ft[o] = c.flowers[s + 3]; ft[o + 3] = c.flowers[s + 4]; f++;
      }
      for (let s = 0, k = 0; s < c.daisies.length && n < lim.daisies; s += 5, k++) {
        const y = c.dy[k], x = c.daisies[s], z = c.daisies[s + 1]; if (y !== y || (x - fx) ** 2 + (z - fz) ** 2 > R2) continue;
        const o = n * 4; dp[o] = x; dp[o + 1] = y - .01; dp[o + 2] = z; dp[o + 3] = c.daisies[s + 2]; dt[o] = c.daisies[s + 3]; dt[o + 3] = c.daisies[s + 4]; n++;
      }
    }
    U.uMeadowRadius.value = Math.min(lim.radius, reach - MARGIN);
    grassGeo.instanceCount = g; flowerGeo.instanceCount = f; daisyGeo.instanceCount = n;
    for (const a of [grassPos, grassTint]) { a.clearUpdateRanges(); a.addUpdateRange(0, g * 4); a.needsUpdate = true; }
    for (const a of [flowerPos, flowerTint]) { a.clearUpdateRanges(); a.addUpdateRange(0, f * 4); a.needsUpdate = true; }
    for (const a of [daisyPos, daisyTint]) { a.clearUpdateRanges(); a.addUpdateRange(0, n * 4); a.needsUpdate = true; }
    filledAt = focus.clone(); forceFill = pending; fills++; lastFillMs = performance.now() - t0; maxFillMs = Math.max(maxFillMs, lastFillMs);
  }

  // Terrain edits only invalidate the cells their kernels touch; untouched cells keep cached heights.
  function terrainChanged({edits: next = edits, terrainTick: tick = Infinity, dirty = null} = {}) {
    edits = next || []; terrainTick = tick;
    if (!dirty) { terrainVersion++; forceFill = true; return; }
    for (const e of dirty) {
      const r = (e.radius || 0) * 1.25 + 1;
      for (let j = Math.max(0, Math.floor((e.z - r + EXTENT) / CELL)); j <= Math.min(CELLS - 1, Math.floor((e.z + r + EXTENT) / CELL)); j++)
        for (let i = Math.max(0, Math.floor((e.x - r + EXTENT) / CELL)); i <= Math.min(CELLS - 1, Math.floor((e.x + r + EXTENT) / CELL)); i++) { const c = cells[j * CELLS + i]; if (c) c.terrain = -1; }
    }
    if (dirty.length) forceFill = true;
  }
  // Structures, foundations and live deposits push grass aside; one string key per sync, rebuild only on change.
  function sync(snapshot) {
    const structures = (snapshot?.inventions?.structures || []).filter(b => b.hp > 0);
    const live = (Array.isArray(snapshot?.deposits) ? snapshot.deposits : ORCHARD_LAYOUT.deposits.map(([x, z]) => ({x, z}))).filter(d => !d.depleted);
    const key = structures.map(b => `${b.type}:${b.position[0]},${b.position[2]}`).join(';') + '|' + live.map(d => `${d.x},${d.z}`).join(';');
    if (key === blockerKey) return false;
    blockerKey = key;
    blockers = structures.map(b => b.type === 'foundation' ? {x: b.position[0], z: b.position[2], r: FOUNDATION_HALF + .1, square: true} : {x: b.position[0], z: b.position[2], r: (STRUCTURES[b.type]?.radius || 1.5) + .2});
    deposits = live.map(d => [d.x, d.z]);
    blockerVersion++; forceFill = true; return true;
  }
  function update(dt, camera, {pushers = []} = {}) {
    time += Math.min(.1, Math.max(0, dt)); U.uMeadowTime.value = time;
    if (camera) {
      camera.getWorldPosition(camPos); camera.getWorldDirection(camDir);
      const above = camPos.y - height(camPos.x, camPos.z);
      if (above > 10 && camDir.y < -.05) focus.copy(camPos).addScaledVector(camDir, Math.min(above / -camDir.y, 80)); // RTS: grass around the view target
      else focus.copy(camPos);
      focus.x = Math.max(-EXTENT, Math.min(EXTENT, focus.x)); focus.z = Math.max(-EXTENT, Math.min(EXTENT, focus.z));
      focus.y = height(focus.x, focus.z);
      U.uMeadowFocus.value.copy(focus);
      if (renderer && motes) motes.material.uniforms.uMotePixel.value = renderer.getPixelRatio() * Math.max(1, renderer.domElement.height / 720) * 1.0;
    }
    const presenting = !!renderer?.xr?.isPresenting; if (presenting !== xr) { xr = presenting; forceFill = true; }
    const push = U.uMeadowPush.value;
    for (let i = 0; i < 4; i++) { const p = pushers[i]; if (p) push[i].set(p[0], p[1], p[2], p[3] ?? .75); else push[i].set(0, 0, 0, 0); }
    if (forceFill || !filledAt || (filledAt.x - focus.x) ** 2 + (filledAt.z - focus.z) ** 2 > REFILL_MOVE * REFILL_MOVE) refill();
  }
  function stats() {
    const tris = g => (g.index.count / 3) * g.instanceCount;
    return {version: MEADOW_VERSION, quality: q, xr, grass: grassGeo.instanceCount, flowers: flowerGeo.instanceCount, daisies: daisyGeo.instanceCount, motes: cfg.motes, radius: +U.uMeadowRadius.value.toFixed(2),
      triangles: tris(grassGeo) + tris(flowerGeo) + tris(daisyGeo), drawCalls: 3 + (motes ? 1 : 0), fills, lastFillMs: +lastFillMs.toFixed(3), maxFillMs: +maxFillMs.toFixed(3), pending: forceFill, rebuiltCells, cachedCells: cells.filter(Boolean).length};
  }
  function dispose() {
    disposed = true; if (daisyTex && !daisyTexture) daisyTex.dispose();
    for (const o of [grass, flowers, daisies, motes]) if (o) { scene.remove(o); o.geometry.dispose(); o.material.dispose(); }
  }
  return {update, terrainChanged, sync, stats, dispose, objects: {grass, flowers, daisies, motes}};
}
