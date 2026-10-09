import {terrainEditScale,terrainFrameKey,terrainDirtyEdits} from '../shared/terrain.js';
// Orchard environment presentation: warm golden meadow ground, worn paths, slope soil/stone,
// hazy sky, far-only silhouette backdrop and a fixed-budget follow shadow.
// Presentation only: never changes terrain height, collision, raycast targets or gameplay.
// World height is always the caller's authoritative height(x, z) function.
// v2: strata/wet-floor/ejecta on freshly deformed ground from a bounded, presentation-only deformation field,
// plus authored bank/edge breakup and planar bedrock for exposed stone. No extra draws, lights or geometry.
import * as THREE from 'three';
import {createDeformationField} from './terrain-deformation-field.js';
import {keepCarve} from '../shared/keep-sites.js';

export const ORCHARD_PRESENTATION_VERSION = 2;
export const WALK_BOUND = 55;
export const GROUND_HALF = 60;

// Layout mirrors shared/world-content.js (baseTrees, initialDeposits) and the forge at the origin.
// Paths are [ax, az, bx, bz, halfWidth, wear]; they are pure presentation and can be swapped.
export const ORCHARD_LAYOUT = Object.freeze({
  clearings: [[0, 0, 3.4, 1], [0, 8, 2.1, .55]], // [x, z, radius, wear] forge yard, hero spawn
  paths: [
    [0, 1.6, .7, 4.2, 1.0, .95], [.7, 4.2, 0, 8, .95, .9], [0, 8, -.6, 11.6, .7, .8], [-.6, 11.6, 0, 14, .65, .75],
    [.7, 4.2, -2.6, 4.9, .55, .7], [-2.6, 4.9, -5, 5, .55, .7], [.7, 4.2, 2.9, 4.6, .55, .7], [2.9, 4.6, 5, 5, .55, .7],
    [0, 8, -3.6, 9.4, .5, .6], [-3.6, 9.4, -7, 10, .5, .6], [0, 8, 3.7, 9.1, .5, .6], [3.7, 9.1, 7, 10, .5, .6],
    [.2, -1.6, .5, -5.5, .7, .8], [.5, -5.5, -2.2, -10, .5, .5], [-2.2, -10, -6, -12.5, .4, .32],
    [5, 5, 13, 3.4, .45, .42], [13, 3.4, 24, 2.2, .38, .3], [-5, 5, -13.5, 5.6, .45, .42], [-13.5, 5.6, -23, 4.2, .38, .3],
  ],
  deposits: [[-5, 5], [5, 5], [-7, 10], [7, 10], [0, 14]],
  trees: [[-2, 6, 5.8], [1.8, 6.5, 6.4], [-3.5, 9, 5.2], [3.7, 9.4, 6.1], [0, 11.5, 6.8], [-12, -9, 7], [14, -12, 6.5], [-17, 17, 7.2], [19, 18, 5.6], [-24, 4, 6.4], [25, 2, 6.8]],
});

// Art direction presets. Colours are sRGB hex; intensities are physically-plausible-ish Three units.
export const DAYLIGHT = Object.freeze({
  golden: {sun: 0xffcf8f, sunI: 2.7, elev: 24, azim: -125, hemiSky: 0xc7d6dc, hemiGround: 0x6d5a35, hemiI: .95, zenith: 0x5f8fc0, horizon: 0xf3d39c, haze: 0xe2cb9b, hill: 0x56684f, exposure: 1.02, env: .42},
  noon: {sun: 0xfff1d6, sunI: 3.0, elev: 58, azim: -140, hemiSky: 0xcfe2ee, hemiGround: 0x625a3e, hemiI: 1.1, zenith: 0x6f9fd0, horizon: 0xd8e2df, haze: 0xd2dcd6, hill: 0x6e8170, exposure: 1.0, env: .5},
  dusk: {sun: 0xff9a5c, sunI: 2.1, elev: 9, azim: -105, hemiSky: 0x9aa3c0, hemiGround: 0x4f3d2c, hemiI: .75, zenith: 0x4f6390, horizon: 0xf2a877, haze: 0xd99b78, hill: 0x4e4f5e, exposure: 1.08, env: .3},
});
// strata: 0 off, 1 single-axis strata + soil floors, 2 triplanar strata + planar bedrock. deform = field texels per side.
const QUALITY = {high: {mask: 192, shadow: 1024, detail: 2, strata: 2, deform: 384}, medium: {mask: 160, shadow: 1024, detail: 2, strata: 2, deform: 256}, low: {mask: 128, shadow: 0, detail: 1, strata: 1, deform: 192}};
export const TERRAIN_FEATURES = Object.freeze({strata: 1, wet: 1, ejecta: 1, edges: 1});
export const DEFORM_JOB_BUDGET_MS = 1.5; // shared by mask + deformation jobs per frame

// ---------- deterministic noise (identical integer hash in JS and GLSL) ----------
export function hash2(ix, iz) {
  let h = (Math.imul((ix + 4096) >>> 0, 0x8da6b343) ^ Math.imul((iz + 4096) >>> 0, 0xd8163841)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0; h = (h ^ (h >>> 15)) >>> 0;
  return (h & 0xffffff) / 16777215;
}
export function valueNoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z); let fx = x - ix, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const segDist = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz || 1, t = Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / l)); return Math.hypot(px - ax - dx * t, pz - az - dz * t); };
// Macro dryness: 0 lush green .. 1 golden straw. Same formula as orchardDry() in GLSL.
export const dryness = (x, z) => smooth(.2, .66, .62 * valueNoise(x * .031 + 11.3, z * .031 - 4.7) + .38 * valueNoise(x * .11 - 3.1, z * .11 + 8.9));

export function disturbanceAt(x,z,edits=[],tick=Infinity) {
  let disturbed = 0;
  for (const e of edits) {
    const r = Math.max(.01, e.radius || 0), d = Math.hypot(x - e.x, z - e.z); if (d >= r * 1.25) continue;
    const t = 1 - d / r, mag = Math.min(1, Math.abs(e.height || 0) / 1.2 * terrainEditScale(e,tick,x,z));
    // Raised mounds expose earth on their flanks; lowered craters show a churned rim and floor.
    const band = (e.height || 0) < 0 ? Math.max(smooth(-.25, .2, t) * smooth(1, .55, t), .55 * smooth(.3, .8, t)) : smooth(-.2, .25, t) * smooth(1.05, .45, t);
    disturbed = Math.max(disturbed, mag * band);
  }
  return Math.min(1,disturbed);
}

// Pure surface sample: wear (paths/clearings), disturbed (fresh earth from edits), stone, shade (under canopies).
export function surfaceSample(x, z, ctx = {}) {
  const layout = ctx.layout || ORCHARD_LAYOUT, edits = ctx.edits || [], deposits = ctx.deposits || layout.deposits, trees = ctx.trees || layout.trees;
  // Meander: warp the query so straight authored segments read as foot-worn lines.
  const wx = x + (valueNoise(x * .23 + 5.1, z * .23) - .5) * 1.1, wz = z + (valueNoise(x * .23 - 7.7, z * .23 + 2.3) - .5) * 1.1;
  let wear = 0;
  for (const [cx, cz, r, w] of layout.clearings) wear = Math.max(wear, w * smooth(r * 1.45, r * .55, Math.hypot(wx - cx, wz - cz)));
  for (const [ax, az, bx, bz, hw, w] of layout.paths) wear = Math.max(wear, w * smooth(hw * 1.9, hw * .45, segDist(wx, wz, ax, az, bx, bz)));
  const disturbed=disturbanceAt(x,z,edits,ctx.terrainTick??Infinity);
  let stone = 0;
  for (const p of deposits) { const px = p.x ?? p[0], pz = p.z ?? p[1]; if (p.depleted) continue; const d = Math.hypot(wx - px, wz - pz); if (d < 2.6) stone = Math.max(stone, smooth(2.4, .9, d) * (.55 + .45 * valueNoise(x * 1.7, z * 1.7))); }
  let shade = 0;
  for (const t of trees) { const tx = t.x ?? t[0], tz = t.z ?? t[1], h = t.height ?? t[2] ?? 6; const d = Math.hypot(x - tx, z - tz), r = 1.1 + h * .32; if (d < r * 1.4) shade = Math.max(shade, smooth(r * 1.35, r * .3, d)); }
  return {wear: Math.min(1, wear), disturbed: Math.min(1, disturbed), stone: Math.min(1, stone), shade: Math.min(1, shade)};
}

// Bake the presentation mask (RGBA8: wear, disturbed, stone, shade) covering the walkable ground.
export function bakeSurfaceMask(ctx = {}, size = 160, half = GROUND_HALF, out = new Uint8Array(size * size * 4)) {
  const step = half * 2 / size;
  for (let j = 0; j < size; j++) {
    const z = -half + (j + .5) * step;
    for (let i = 0; i < size; i++) {
      const s = surfaceSample(-half + (i + .5) * step, z, ctx), o = (j * size + i) * 4;
      out[o] = s.wear * 255 + .5; out[o + 1] = s.disturbed * 255 + .5; out[o + 2] = s.stone * 255 + .5; out[o + 3] = s.shade * 255 + .5;
    }
  }
  return out;
}

// Keep the previous complete texture visible while ecosystem changes rebuild in bounded slices.
export function createSurfaceMaskJob(ctx, size, half = GROUND_HALF) {
  const data = new Uint8Array(size * size * 4), step = half * 2 / size;
  let cursor = 0, cpuMs = 0;
  return {data, get done() { return cursor === size * size; }, get cpuMs() { return cpuMs; },
    step(budgetMs = 1.5, maxSamples = 512) {
      const start = performance.now(), end = Math.min(size * size, cursor + maxSamples);
      while (cursor < end) {
        const i = cursor % size, j = Math.floor(cursor / size);
        const s = surfaceSample(-half + (i + .5) * step, -half + (j + .5) * step, ctx), o = cursor * 4;
        data[o] = s.wear * 255 + .5; data[o+1] = s.disturbed * 255 + .5;
        data[o+2] = s.stone * 255 + .5; data[o+3] = s.shade * 255 + .5;
        cursor++;
        if (cursor % 16 === 0 && performance.now() - start >= budgetMs) break;
      }
      cpuMs += performance.now() - start;
      return cursor === size * size;
    },
  };
}

// Edit-only rebake: rewrites just the disturbed (G) channel; static wear/stone/shade stay cached.
export function bakeDisturbedChannel(edits = [], size = 160, half = GROUND_HALF, out,tick=Infinity) {
  const step = half * 2 / size;
  for (let o = 1; o < out.length; o += 4) out[o] = 0;
  for (const e of edits) {
    const r = Math.max(.01, e.radius || 0) * 1.25, i0 = Math.max(0, Math.floor((e.x - r + half) / step)), i1 = Math.min(size - 1, Math.ceil((e.x + r + half) / step));
    const j0 = Math.max(0, Math.floor((e.z - r + half) / step)), j1 = Math.min(size - 1, Math.ceil((e.z + r + half) / step));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const v = disturbanceAt(-half + (i + .5) * step, -half + (j + .5) * step, [e],tick) * 255 + .5, o = (j * size + i) * 4 + 1;
      if (v > out[o]) out[o] = v;
    }
  }
  return out;
}
const EMPTY_LAYOUT = {clearings: [], paths: [], deposits: [], trees: []};

// Material classification shared by footsteps/contact effects. Slope uses the authoritative height.
export function classifySurface(x, z, height, ctx = {}) {
  const s = surfaceSample(x, z, ctx), e = .35;
  const gx = (height(x + e, z) - height(x - e, z)) / (2 * e), gz = (height(x, z + e) - height(x, z - e)) / (2 * e);
  const slope = 1 - 1 / Math.sqrt(1 + gx * gx + gz * gz); // matches 1 - normal.y in the shader
  const stone = Math.max(s.stone, smooth(.16, .26, slope)), soil = Math.max(smooth(.4, .75, s.wear), s.disturbed, smooth(.06, .14, slope));
  const dry = dryness(x, z);
  const material = stone > .55 ? 'stone' : soil > .55 ? (s.disturbed > .5 ? 'soil' : 'path') : 'grass';
  const tint = {stone: [.55, .53, .5], soil: [.36, .26, .17], path: [.6, .48, .34], grass: [.42 + .28 * dry, .5 + .08 * dry, .2]}[material];
  return {material, slope, dry, ...s, tint};
}

// ---------- shader patch (verified against three 0.186.1 ShaderChunk anchors) ----------
export const SHADER_ANCHORS = Object.freeze({vertex: ['#include <common>', '#include <worldpos_vertex>'], fragment: ['#include <common>', '#include <map_fragment>', '#include <roughnessmap_fragment>', '#include <normal_fragment_maps>']});
const GLSL_NOISE = /* glsl */`
float orchardHash(vec2 c){ uvec2 q = uvec2(ivec2(c) + 4096); uint h = (q.x * 0x8da6b343u) ^ (q.y * 0xd8163841u); h = (h ^ (h >> 13u)) * 0x5bd1e995u; h ^= h >> 15u; return float(h & 0xffffffu) / 16777215.0; }
float orchardNoise(vec2 p){ vec2 i = floor(p), f = p - i; f = f * f * (3.0 - 2.0 * f); float a = orchardHash(i), b = orchardHash(i + vec2(1, 0)), c = orchardHash(i + vec2(0, 1)), d = orchardHash(i + vec2(1, 1)); return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
float orchardDry(vec2 p){ return smoothstep(0.2, 0.66, 0.62 * orchardNoise(p * 0.031 + vec2(11.3, -4.7)) + 0.38 * orchardNoise(p * 0.11 + vec2(-3.1, 8.9))); }
`;
const FRAG_PARS = /* glsl */`
uniform sampler2D orchardGrassMap, orchardGrassNormal, orchardGrassOrm, orchardSoilMap, orchardSoilNormal, orchardMask;
uniform vec4 orchardMaskRect;
uniform vec3 orchardDryTint, orchardLushTint, orchardWornTint, orchardStoneTint;
uniform float orchardGrassTile, orchardSoilTile, orchardNormalStrength;
uniform sampler2D orchardStrataMap, orchardStrataNormal, orchardDeform;
uniform vec4 orchardFeatures; // strata, wet, ejecta, edges (0..1)
varying vec3 vOrchardWorld;
varying vec3 vOrchardNormal;
${GLSL_NOISE}
`;
const FRAG_ALBEDO = /* glsl */`
vec2 oXZ = vOrchardWorld.xz;
vec3 oN = normalize(vOrchardNormal);
float oSlope = 1.0 - oN.y;
float oDist = length(vOrchardWorld - cameraPosition);
vec2 oMaskUv = (oXZ - orchardMaskRect.xy) * orchardMaskRect.zw;
vec2 oWarp = vec2(orchardNoise(oXZ * 1.3), orchardNoise(oXZ * 1.3 + 19.7)) - 0.5;
float oInside = step(0.0, oMaskUv.x) * step(oMaskUv.x, 1.0) * step(0.0, oMaskUv.y) * step(oMaskUv.y, 1.0);
vec4 oMask = texture2D(orchardMask, clamp(oMaskUv + oWarp * 0.35 * orchardMaskRect.zw, 0.0, 1.0)) * oInside;
// Grass: two world-space scales, rotated, blended by height-aware macro noise to kill tiling.
const mat2 oRot = mat2(0.8, -0.6, 0.6, 0.8);
vec2 oUvA = oXZ * vec2(1.0, -1.0) / orchardGrassTile;
vec2 oUvB = oRot * (oXZ * vec2(1.0, -1.0)) / (orchardGrassTile * 2.63) + 0.37;
vec4 oGA = texture2D(orchardGrassMap, oUvA, 0.7); // v3: slight mip bias softens per-blade speckle
#if ORCHARD_DETAIL > 1
vec4 oGB = texture2D(orchardGrassMap, oUvB, 0.7);
float oAB = clamp((orchardNoise(oXZ * 0.085) - 0.5) * 3.0 + (dot(oGB.rgb, vec3(0.33)) - dot(oGA.rgb, vec3(0.33))) * 4.0 + 0.5, 0.0, 1.0);
#else
vec4 oGB = oGA; float oAB = 0.0;
#endif
vec3 oGrass = mix(oGA.rgb, oGB.rgb, oAB);
// Tile-average (linear) of meadow_albedo; compress its baked blotches more with distance so RTS views show
// macro drifts instead of a repeating 3 m pattern. Near the feet the texture keeps most of its detail.
const vec3 oGrassAvg = vec3(0.069, 0.150, 0.015);
oGrass = oGrassAvg + (oGrass - oGrassAvg) * mix(0.5, 0.26, smoothstep(6.0, 45.0, oDist)); // v3: tamer fine stipple
float oL = dot(oGrass, vec3(0.2126, 0.7152, 0.0722));
float oDry = orchardDry(oXZ);
float oMacro = orchardNoise(oXZ * 0.018 + 3.0);
// Warm grade: lush pockets under canopies, straw-gold in dry drifts; luminance-preserving tints.
oGrass = mix(oGrass * orchardLushTint, oL * orchardDryTint, oDry * 0.62);
oGrass *= mix(vec3(1.0), vec3(0.72, 0.85, 0.6), oMask.a * 0.6);
oGrass *= 0.84 + 0.3 * oMacro + 0.14 * (orchardNoise(oXZ * 0.055 - 7.0) - 0.5); // v3: broad colour drift carries variation
// Trampled fringe: shorter, paler grass around wear before bare earth appears.
oGrass = mix(oGrass, oL * orchardWornTint * 1.25, smoothstep(0.08, 0.45, oMask.r) * 0.55);
vec2 oUvS = oXZ * vec2(1.0, -1.0) / orchardSoilTile;
vec3 oSoil = texture2D(orchardSoilMap, oUvS).rgb;
vec4 oSoilN = texture2D(orchardSoilNormal, oUvS);
vec4 oStoneN = texture2D(orchardSoilNormal, oUvS * 0.43 + 0.21);
vec3 oStone = texture2D(orchardSoilMap, oUvS * 0.43 + 0.21).rgb;
oStone = mix(vec3(dot(oStone, vec3(0.33))), oStone, 0.45) * orchardStoneTint * (0.72 + 0.3 * oStoneN.b); // v3: less pale, less speckled
vec3 oDisturbedSoil = oSoil * vec3(0.72, 0.62, 0.52);
// Height-aware layer weights: grass clumps (bright texels) poke through path edges; pebbles poke through grass.
float oGrassH = oL * 3.0;
// Edge breakup (v2): a mid-frequency fray so path/bank borders bite into the turf in lobes, not a soft noise halo.
float oFray = (orchardNoise(oXZ * 3.1 + 7.1) - 0.5) * 0.7 + (orchardNoise(oXZ * 9.7 - 2.3) - 0.5) * 0.3;
float oSoilW = smoothstep(0.35, 0.8, oMask.r + (oSoilN.b - oGrassH) * 0.35 + (oWarp.x * 0.25) + oFray * 0.3 * orchardFeatures.w);
oSoilW = max(oSoilW, smoothstep(0.06, 0.14, oSlope + (oSoilN.b - 0.5) * 0.06));
float oDistW = smoothstep(0.25, 0.65, oMask.g + (oSoilN.b - 0.5) * 0.4 + oFray * 0.25 * orchardFeatures.w);
float oStoneW = max(smoothstep(0.35, 0.7, oMask.b + (oStoneN.b - 0.5) * 0.7), smoothstep(0.16, 0.26, oSlope + (oStoneN.b - 0.5) * 0.08));
vec3 oAlbedo = mix(oGrass, oSoil, oSoilW);
oAlbedo = mix(oAlbedo, oDisturbedSoil, oDistW);
// Turf lip: soil darkens where it meets grass (root shadow/overhang), selling a shallow bank rather than a decal.
oAlbedo *= 1.0 - 0.22 * orchardFeatures.w * oSoilW * (1.0 - oSoilW) * 4.0 * (1.0 - oStoneW);
vec3 oStrataPert = vec3(0.0);
float oDef = 0.0, oFaceW = 0.0, oFloorW = 0.0, oWet = 0.0, oPuddle = 0.0, oEject = 0.0, oRockW = 0.0, oStrataRough = 0.9;
#if ORCHARD_STRATA > 0
// ---- freshly deformed ground: strata faces, churned floors, wet hollows, thrown soil ----
vec4 oDf = texture2D(orchardDeform, clamp(oMaskUv, 0.0, 1.0)) * oInside; // R base, G displacement, B raise peak, A ejecta
oDef = smoothstep(0.025, 0.16, abs(oDf.g));
// Depth below the undeformed surface, exact on the rendered mesh (base is smooth, world Y is per-fragment).
float oCutDepth = oDf.r - vOrchardWorld.y;
// Raised ground: flanks expose the core by distance below the crest, compressed so mounds read loam/subsoil with rock only low on steep walls.
float oDepth = oDf.g < 0.0 ? oCutDepth : (oDf.b - (vOrchardWorld.y - oDf.r)) * 0.7;
float oSD = max(0.015, oDepth + (orchardNoise(oXZ * 0.9 + 3.3) - 0.5) * 0.16 + (orchardNoise(oXZ * 3.7) - 0.5) * 0.05);
float oV = oSD < 1.6 ? oSD / 3.2 : 0.5 + fract((oSD - 1.6) / 1.6) * 0.5;
vec2 oSDd = vec2(dFdx(oSD), dFdy(oSD)) / 3.2;
vec2 oXd = dFdx(oXZ) * 0.25, oYd = dFdy(oXZ) * 0.25;
// Planar bedrock (periodic lower half of the kit), rotated + warped so floors/outcrops never show the 4 x 1.6 m grid.
vec2 oRP = oRot * oXZ + oWarp * 0.9;
vec2 oUvR = vec2(oRP.x * 0.25, 0.5 - fract(oRP.y / 1.6) * 0.5);
vec2 oRx = vec2(dFdx(oRP.x) * 0.25, -dFdx(oRP.y) / 3.2), oRy = vec2(dFdy(oRP.x) * 0.25, -dFdy(oRP.y) / 3.2);
if (oDef > 0.001) {
  vec2 oW2 = pow(abs(oN.xz) + 1e-4, vec2(4.0)); oW2 /= oW2.x + oW2.y;
#if ORCHARD_STRATA > 1
  vec2 oUvX = vec2(oXZ.y * 0.25, 1.0 - oV), oUvZ = vec2(oXZ.x * 0.25 + 0.31, 1.0 - oV);
  vec3 oCx = textureGrad(orchardStrataMap, oUvX, vec2(oXd.y, -oSDd.x), vec2(oYd.y, -oSDd.y)).rgb;
  vec3 oCz = textureGrad(orchardStrataMap, oUvZ, vec2(oXd.x, -oSDd.x), vec2(oYd.x, -oSDd.y)).rgb;
  vec3 oNx = textureGrad(orchardStrataNormal, oUvX, vec2(oXd.y, -oSDd.x), vec2(oYd.y, -oSDd.y)).rgb;
  vec3 oNz = textureGrad(orchardStrataNormal, oUvZ, vec2(oXd.x, -oSDd.x), vec2(oYd.x, -oSDd.y)).rgb;
  vec3 oFaceCol = oCx * oW2.x + oCz * oW2.y; float oFaceH = oNx.b * oW2.x + oNz.b * oW2.y;
  vec3 oFacePert = oW2.x * vec3(0.0, oNx.g * 2.0 - 1.0, oNx.r * 2.0 - 1.0) + oW2.y * vec3(oNz.r * 2.0 - 1.0, oNz.g * 2.0 - 1.0, 0.0);
#else
  bool oAxisX = abs(oN.x) > abs(oN.z);
  vec2 oUv1 = vec2((oAxisX ? oXZ.y : oXZ.x) * 0.25, 1.0 - oV), oG1 = vec2(oAxisX ? oXd.y : oXd.x, -oSDd.x), oG2 = vec2(oAxisX ? oYd.y : oYd.x, -oSDd.y);
  vec3 oFaceCol = textureGrad(orchardStrataMap, oUv1, oG1, oG2).rgb; vec3 oN1 = textureGrad(orchardStrataNormal, oUv1, oG1, oG2).rgb; float oFaceH = oN1.b;
  vec3 oFacePert = oAxisX ? vec3(0.0, oN1.g * 2.0 - 1.0, oN1.r * 2.0 - 1.0) : vec3(oN1.r * 2.0 - 1.0, oN1.g * 2.0 - 1.0, 0.0);
#endif
  // Faces: strata appear where the cut/raise is steep; hard horizons (high texel height) hold steeper than loam.
  float oSod = oDf.g > 0.0 ? smoothstep(0.5, 0.68, orchardNoise(oXZ * 1.6 + 4.0) + 0.45 * (1.0 - smoothstep(0.04, 0.16, oSlope)) - oDepth * 0.15) : 0.0;
  oFaceW = orchardFeatures.x * oDef * smoothstep(0.035, 0.12, oSlope + (oFaceH - 0.5) * 0.06 + oFray * 0.05) * (1.0 - oSod);
  // Floors of cuts: horizon colour (blurred strata row) carried by the soil micro-texture; bedrock when deep.
  vec3 oLayer = textureLod(orchardStrataMap, vec2(0.37, 1.0 - oV), 5.0).rgb;
  vec3 oFloorCol = oLayer * oSoil * vec3(4.2, 7.4, 15.0) * 0.62; // v3: floor horizons sit with the walls, no pale clay ring
#if ORCHARD_STRATA > 1
  vec3 oRockC = textureGrad(orchardStrataMap, oUvR, oRx, oRy).rgb; vec3 oRockN = textureGrad(orchardStrataNormal, oUvR, oRx, oRy).rgb;
#else
  vec3 oRockC = oStone; vec3 oRockN = vec3(oStoneN.rg, oStoneN.b);
#endif
  oRockW = smoothstep(1.35, 1.75, oCutDepth + (oRockN.b - 0.5) * 0.5) * step(oDf.g, 0.0);
  oFloorCol = mix(oFloorCol, oRockC * vec3(0.76, 0.74, 0.72), oRockW); // v3: bedrock floor no longer a pale glowing disc
  oFloorW = orchardFeatures.x * oDef * step(oDf.g, 0.0) * smoothstep(0.08, 0.3, oCutDepth + oFray * 0.1) * (1.0 - oFaceW);
  vec3 oStrataCol = mix(oFaceCol, oFloorCol, oFloorW / max(1e-3, oFaceW + oFloorW));
  oAlbedo = mix(oAlbedo, oStrataCol, clamp(oFaceW + oFloorW, 0.0, 1.0));
  oStrataPert = oFaceW * oFacePert * 0.85 +oFloorW * oRockW * vec3(oRockN.r * 2.0 - 1.0, 0.0, oRockN.g * 2.0 - 1.0);
  oStrataRough = mix(mix(0.94, 0.88, smoothstep(0.45, 0.65, oSD)), mix(0.78, 0.66, smoothstep(1.3, 1.7, oSD)), smoothstep(0.95, 1.15, oSD));
  // Water gathers on flat cut floors; deepest flats pond into small glossy puddles (no extra lights or draws).
  oWet = orchardFeatures.y * oDef * step(oDf.g, 0.0) * smoothstep(0.18, 0.8, oCutDepth) * smoothstep(0.9, 0.99, oN.y);
  oPuddle = oWet * smoothstep(0.6, 0.78, orchardNoise(oXZ * 0.7 + 9.0) * 0.6 + oSoilN.b * 0.25 + (oCutDepth - 1.0) * 0.35) * smoothstep(0.975, 0.997, oN.y);
  oAlbedo *= mix(1.0, 0.52, oWet) * mix(1.0, 0.55, oPuddle);
}
// Thrown soil outside cuts: clods biased by soil height so they read as lumps, plus a darkened, flattened grass ring.
oEject = orchardFeatures.z * oDf.a * smoothstep(0.42, 0.62, orchardNoise(oXZ * 2.6 + 1.0) * 0.55 + oSoilN.b * 0.55 - (1.0 - oDf.a) * 0.3);
oAlbedo = mix(oAlbedo * mix(1.0, 0.78, orchardFeatures.z * oDf.a), oDisturbedSoil * (0.55 + 0.6 * oSoilN.b), oEject);
#endif
// Exposed stone: planar bedrock from the strata kit breaks the soil-texture-as-stone look on outcrops/steep slopes.
#if ORCHARD_STRATA > 1
if (oStoneW > 0.001) { vec3 oBed = textureGrad(orchardStrataMap, oUvR, oRx, oRy).rgb; oStone = mix(oStone, oBed * vec3(1.02, 1.0, 0.97), 0.55); }
#endif
oAlbedo = mix(oAlbedo, oStone, oStoneW * (1.0 - oFaceW - oFloorW * 0.8));
vec4 oOrm = texture2D(orchardGrassOrm, oUvA);
float oBare = max(max(max(oSoilW, oDistW), oStoneW), oFaceW + oFloorW);
oAlbedo *= mix(mix(1.0, oOrm.r, 0.28), 0.88 + 0.24 * oSoilN.b, max(max(oSoilW, oDistW), oStoneW) * (1.0 - oFaceW - oFloorW));
diffuseColor.rgb *= oAlbedo;
`;
const FRAG_ROUGH = /* glsl */`
float roughnessFactor = roughness * mix(oOrm.g, mix(0.96, 0.84, oDistW), oSoilW) ;
roughnessFactor = mix(roughnessFactor, 0.82, oStoneW);
roughnessFactor = max(roughnessFactor, 0.86); // v3: matte dry ground kills grazing-sun glitter
roughnessFactor = mix(roughnessFactor, oStrataRough, clamp(oFaceW + oFloorW, 0.0, 1.0));
roughnessFactor = mix(roughnessFactor, 0.55, oWet); // v3: damp sheen, not a grazing glare strip
roughnessFactor = mix(roughnessFactor, 0.07, oPuddle);
`;
const FRAG_NORMAL = /* glsl */`
{
  vec3 oNA = texture2D(orchardGrassNormal, oUvA, 1.0).xyz * 2.0 - 1.0; // v3: +1 mip bias = softer blade relief
#if ORCHARD_DETAIL > 1
  vec3 oNB = texture2D(orchardGrassNormal, oUvB, 1.0).xyz * 2.0 - 1.0;
  oNB.xy = oNB.xy * oRot; // undo the UV rotation so the perturbation stays world-aligned
  vec3 oNG = normalize(mix(oNA, oNB, oAB));
#else
  vec3 oNG = oNA;
#endif
  vec3 oNS = vec3((oSoilN.xy * 2.0 - 1.0) * 0.5, 0.0); oNS.z = sqrt(max(0.0, 1.0 - dot(oNS.xy, oNS.xy)));
  vec3 oNT = vec3((oStoneN.xy * 2.0 - 1.0) * 0.6, 0.0); oNT.z = sqrt(max(0.0, 1.0 - dot(oNT.xy, oNT.xy)));
  vec3 oTn = normalize(mix(mix(oNG * vec3(0.3, 0.3, 1.0), oNS, oSoilW), oNT, oStoneW));
  // Fade micro relief with distance (anti-shimmer for RTS/VR) without moving with the camera.
  oTn.xy *= orchardNormalStrength * mix(1.0, 0.25, smoothstep(6.0, 40.0, oDist));
  vec3 oT = normalize(vec3(1.0, 0.0, 0.0) - oN * oN.x);
  vec3 oB = cross(oN, oT);
  vec3 oPW = normalize(oT * oTn.x + oB * oTn.y + oN * oTn.z);
  // Strata relief (world-space, already tangent to the projected face); puddles flatten to the mesh normal.
  float oFade = mix(0.75, 0.3, smoothstep(8.0, 45.0, oDist));
  oPW = normalize(mix(oPW, oN, clamp(oFaceW + oFloorW * oRockW, 0.0, 1.0) * 0.85) + oStrataPert * orchardNormalStrength * oFade);
  oPW = normalize(mix(oPW, oN, oPuddle));
  normal = normalize((viewMatrix * vec4(oPW, 0.0)).xyz);
}
`;

function patchShader(shader, detail, report, strata = 0) {
  const v = shader.vertexShader, f = shader.fragmentShader;
  report.missing = [...SHADER_ANCHORS.vertex.filter(a => !v.includes(a)), ...SHADER_ANCHORS.fragment.filter(a => !f.includes(a))];
  if (report.missing.length) { report.patched = false; return shader; } // leave stock material rather than produce a broken program
  shader.vertexShader = v.replace('#include <common>', '#include <common>\nvarying vec3 vOrchardWorld;\nvarying vec3 vOrchardNormal;')
    .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvOrchardWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvOrchardNormal = normalize(mat3(modelMatrix) * objectNormal);');
  shader.fragmentShader = `#define ORCHARD_DETAIL ${detail}\n#define ORCHARD_STRATA ${strata}\n` + f.replace('#include <common>', '#include <common>\n' + FRAG_PARS)
    .replace('#include <map_fragment>', FRAG_ALBEDO).replace('#include <roughnessmap_fragment>', FRAG_ROUGH).replace('#include <normal_fragment_maps>', FRAG_NORMAL);
  report.patched = true;
  return shader;
}

const srgbHex = hex => new THREE.Color(hex); // Color.setHex converts sRGB -> linear working space
function flatTexture(rgb, colorSpace = THREE.NoColorSpace) {
  const t = new THREE.DataTexture(new Uint8Array([...rgb, 255]), 1, 1); t.colorSpace = colorSpace; t.needsUpdate = true; return t;
}

// Ground material. Uses custom uniforms (not .map) so stock UV-repeat textures cannot double-apply.
export function createOrchardGroundMaterial({quality = 'high', report = {}, strata} = {}) {
  const detail = (QUALITY[quality] || QUALITY.high).detail, strataLevel = strata ?? (QUALITY[quality] || QUALITY.high).strata;
  const deformBlank = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType); deformBlank.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 1, metalness: 0});
  const uniforms = {
    orchardGrassMap: {value: flatTexture([74, 108, 32], THREE.SRGBColorSpace)},
    orchardGrassNormal: {value: flatTexture([128, 128, 255])},
    orchardGrassOrm: {value: flatTexture([223, 226, 0])},
    orchardSoilMap: {value: flatTexture([122, 94, 66], THREE.SRGBColorSpace)},
    orchardSoilNormal: {value: flatTexture([128, 128, 128])},
    orchardMask: {value: null},
    orchardMaskRect: {value: new THREE.Vector4(-GROUND_HALF, -GROUND_HALF, 1 / (2 * GROUND_HALF), 1 / (2 * GROUND_HALF))},
    orchardDryTint: {value: new THREE.Vector3(1.62, 1.24, .5)},
    orchardLushTint: {value: new THREE.Vector3(.92, 1.0, .74)},
    orchardWornTint: {value: new THREE.Vector3(1.25, 1.05, .62)},
    orchardStoneTint: {value: new THREE.Vector3(.95, .93, .9)},
    orchardGrassTile: {value: 3.0}, orchardSoilTile: {value: 2.2}, orchardNormalStrength: {value: 1.0},
    orchardStrataMap: {value: flatTexture([96, 70, 46], THREE.SRGBColorSpace)},
    orchardStrataNormal: {value: flatTexture([128, 128, 128])},
    orchardDeform: {value: deformBlank},
    orchardFeatures: {value: new THREE.Vector4(TERRAIN_FEATURES.strata, TERRAIN_FEATURES.wet, TERRAIN_FEATURES.ejecta, TERRAIN_FEATURES.edges)},
  };
  material.onBeforeCompile = shader => { Object.assign(shader.uniforms, uniforms); patchShader(shader, detail, report, strataLevel); };
  material.customProgramCacheKey = () => `orchard-ground-v${ORCHARD_PRESENTATION_VERSION}-d${detail}-s${strataLevel}`;
  material.userData.orchardStrata = strataLevel;
  material.userData.orchardUniforms = uniforms;
  return material;
}

// ---------- sky dome, skirt and backdrop ----------
// Sky dome: gradient + sun, plus a night layer (stars, moon, faint resonance aurora), drifting clouds,
// overcast grey-out and storm flashes. All analytic in one draw; `cloudOctaves` drops to 2 on low quality.
function createSky(cloudOctaves = 3) {
  const material = new THREE.ShaderMaterial({
    uniforms: {zenith: {value: new THREE.Color()}, horizon: {value: new THREE.Color()}, sunColor: {value: new THREE.Color()}, sunDir: {value: new THREE.Vector3(0, 1, 0)},
      moonDir: {value: new THREE.Vector3(0, -1, 0)}, night: {value: 0}, overcast: {value: 0}, clouds: {value: .22}, cloudTint: {value: new THREE.Color(1, 1, 1)}, flash: {value: 0}, time: {value: 0}},
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
    fragmentShader: `uniform vec3 zenith, horizon, sunColor, sunDir, moonDir, cloudTint; uniform float night, overcast, clouds, flash, time; varying vec3 vDir;
      float h3(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
      float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
      void main(){ vec3 d = normalize(vDir); float h = max(d.y, 0.0); vec3 sd = normalize(sunDir); float s = max(dot(d, sd), 0.0);
        vec3 c = mix(horizon, zenith, pow(h, 0.55)); c = mix(c, horizon * 0.92, smoothstep(0.0, -0.08, d.y));
        float clear = 1.0 - overcast;
        c += sunColor * (pow(s, 7.0) * 0.28 + (pow(s, 90.0) * 0.6 + smoothstep(0.9993, 0.9997, s) * 6.0) * clear);
        if (night > 0.01) {
          float n = night * clear * smoothstep(-0.02, 0.18, d.y);
          vec3 g = d * 260.0, cell = floor(g); float r = h3(cell);
          float star = step(0.9975, r) * smoothstep(0.5, 0.05, length(fract(g) - 0.5)) * (0.55 + 0.45 * sin(time * (1.5 + r * 3.0) + r * 60.0));
          c += vec3(0.75, 0.85, 1.0) * star * 1.6 * n;
          vec3 md = normalize(moonDir); float m = max(dot(d, md), 0.0);
          c += vec3(0.75, 0.85, 1.0) * (smoothstep(0.99955, 0.9998, m) * 2.6 + pow(m, 60.0) * 0.18 + pow(m, 6.0) * 0.05) * night * (0.35 + 0.65 * clear);
          float az = atan(d.z, d.x), band = smoothstep(0.12, 0.32, d.y) * smoothstep(0.75, 0.38, d.y);
          float ribbon = pow(0.5 + 0.5 * sin(az * 5.0 + sin(az * 2.0 + time * 0.07) * 2.2 + time * 0.03), 6.0);
          c += mix(vec3(0.18, 0.75, 1.0), vec3(0.45, 0.4, 1.0), 0.5 + 0.5 * sin(az * 3.0 - time * 0.05)) * ribbon * band * 0.22 * n;
        }
        if (d.y > -0.05) {
          vec2 uv = d.xz / (d.y + 0.18) * 1.4 + vec2(time * 0.006, time * 0.002);
          float f = n2(uv) * 0.55 + n2(uv * 2.3 + 7.1) * 0.3;
          ${cloudOctaves > 2 ? 'f += n2(uv * 5.1 - 3.3) * 0.15;' : 'f += 0.07;'}
          float cov = smoothstep(1.0 - clouds, 1.0 - clouds + 0.28, f) * smoothstep(-0.05, 0.12, d.y);
          vec3 lit = cloudTint * (0.65 + 0.35 * pow(s, 3.0)) + sunColor * pow(s, 12.0) * 0.4 * clear;
          c = mix(c, lit, cov * (0.85 - 0.25 * night));
        }
        vec3 grey = vec3(dot(c, vec3(0.3, 0.55, 0.15))) * cloudTint;
        c = mix(c, grey, overcast * 0.75);
        c += vec3(0.8, 0.85, 1.0) * flash * 1.4 * smoothstep(-0.1, 0.4, d.y);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false, toneMapped: true,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(150, 32, 16), material);
  mesh.name = 'orchard-sky'; mesh.frustumCulled = false; mesh.renderOrder = -1000; mesh.raycast = () => {};
  return mesh;
}

// Ring skirt from the ground edge to the backdrop; inner ring follows height() so there is no crack.
function createSkirt(material, height, segments = 96, rings = 7, outer = 104) {
  const geometry = new THREE.BufferGeometry(), positions = new Float32Array(segments * rings * 3), index = [];
  for (let s = 0; s < segments; s++) for (let r = 0; r < rings - 1; r++) {
    const a = s * rings + r, b = ((s + 1) % segments) * rings + r;
    index.push(a, b, a + 1, b, b + 1, a + 1); // counter-clockwise from above => normals up
  }
  geometry.setIndex(index); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mesh = new THREE.Mesh(geometry, material); mesh.name = 'orchard-skirt'; mesh.raycast = () => {}; mesh.receiveShadow = true;
  const rebuild = () => {
    for (let s = 0; s < segments; s++) {
      const a = s / segments * Math.PI * 2, cx = Math.cos(a), cz = Math.sin(a), k = (GROUND_HALF - .25) / Math.max(Math.abs(cx), Math.abs(cz));
      const edge = height(cx * k, cz * k) - .03;
      for (let r = 0; r < rings; r++) {
        const t = r / (rings - 1), dist = k + (outer - k) * t * t;
        const lift = t * t * (2.2 + 3 * valueNoise(cx * 3 + 7, cz * 3 - 2));
        const x = cx * dist, z = cz * dist, carve = keepCarve(x, z); // tucked under the keeps' carved back towns
        positions.set([x, carve ? (edge * (1 - t) + lift) * (1 - carve) + (height(x, z) - 2) * carve : edge * (1 - t) + lift, z], (s * rings + r) * 3);
      }
    }
    geometry.attributes.position.needsUpdate = true; geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  };
  rebuild();
  return {mesh, rebuild};
}

// Layered hill ridges + a few landmark silhouettes, one unlit draw call, own aerial haze (fog:false).
function createBackdrop() {
  const pos = [], col = [], c = new THREE.Color(), tri = (a, b, d, ca, cb, cd) => { pos.push(...a, ...b, ...d); col.push(...ca, ...cb, ...cd); };
  const layers = [{r: 84, h: 7, f: .3, seed: 1}, {r: 100, h: 12, f: .55, seed: 2}, {r: 116, h: 21, f: .78, seed: 3}];
  const N = 120;
  for (const L of layers.slice().reverse()) {
    for (let i = 0; i < N; i++) {
      const p = j => { const a = j / N * Math.PI * 2, n = valueNoise(Math.cos(a) * 2.2 + L.seed * 9, Math.sin(a) * 2.2) * .7 + valueNoise(Math.cos(a) * 7 + L.seed, Math.sin(a) * 7) * .3;
        const r = L.r + (n - .5) * 10, top = L.h * (.35 + .9 * n * n); return {x: Math.cos(a) * r, z: Math.sin(a) * r, top, haze: L.f}; };
      const a = p(i), b = p(i + 1);
      // haze value per vertex: base melts fully into the horizon, crest keeps silhouette (encoded later)
      tri([a.x, -4, a.z], [a.x, a.top, a.z], [b.x, -4, b.z], [1, L.f, 0], [0, L.f, 1], [1, L.f, 0]);
      tri([b.x, -4, b.z], [a.x, a.top, a.z], [b.x, b.top, b.z], [1, L.f, 0], [0, L.f, 1], [0, L.f, 1]);
    }
  }
  // Landmarks on the nearest/mid ridges: ruined watchtower (N), standing stones (E), great lone oak (W), tree line clumps.
  const box = (x, z, w, h, d, y0, haze) => { const v = [[-w, y0, -d], [w, y0, -d], [w, y0, d], [-w, y0, d], [-w, y0 + h, -d], [w, y0 + h, -d], [w, y0 + h, d], [-w, y0 + h, d]].map(([px, py, pz]) => [px + x, py, pz + z]);
    for (const [i, j, k, l] of [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7]]) { const ci = q => [q < 4 ? 1 : 0, haze, 1]; tri(v[i], v[j], v[k], ci(i), ci(j), ci(k)); tri(v[i], v[k], v[l], ci(i), ci(k), ci(l)); } };
  const blob = (x, y, z, r, haze, seg = 7) => { for (let i = 0; i < seg; i++) { const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
    for (const [y0, r0, y1, r1] of [[y - r * .4, r * .75, y + r * .35, r], [y + r * .35, r, y + r, r * .35], [y + r, r * .35, y + r * 1.2, 0]]) {
      const P = (aa, yy, rr) => [x + Math.cos(aa) * rr, yy, z + Math.sin(aa) * rr];
      tri(P(a0, y0, r0), P(a0, y1, r1), P(a1, y0, r0), [.3, haze, 1], [0, haze, 1], [.3, haze, 1]); tri(P(a1, y0, r0), P(a0, y1, r1), P(a1, y1, r1), [.3, haze, 1], [0, haze, 1], [0, haze, 1]); } } };
  box(4, -101, 2.2, 15, 2.2, 4, .7); box(4, -101, 2.8, 1.2, 2.8, 19, .7); box(6.6, -101, .7, 4, .7, 20, .7);
  for (let i = 0; i < 6; i++) { const a = -.15 + i * .055; box(Math.cos(a) * 88, Math.sin(a) * 88, .55, 2.8 + (i % 3) * .9, .4, 4.2, .58); }
  box(-93, 12, .8, 7, .8, 3.5, .45); blob(-93, 12.5, 12, 5.5, .45, 9); blob(-89, 11.5, 15, 4.2, .45); blob(-96, 11.8, 8.5, 4.4, .45);
  for (let i = 0; i < 46; i++) { const a = hash2(i, 77) * Math.PI * 2, r = 80 + hash2(i, 91) * 6; blob(Math.cos(a) * r, 2.5 + hash2(i, 3) * 2, Math.sin(a) * r, 2.2 + hash2(i, 5) * 2.2, .28); }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('haze', new THREE.Float32BufferAttribute(col, 3)); // x: base-melt, y: layer distance, z: crest flag
  const material = new THREE.ShaderMaterial({
    uniforms: {hill: {value: new THREE.Color()}, haze: {value: new THREE.Color()}, sunColor: {value: new THREE.Color()}},
    vertexShader: 'attribute vec3 haze; varying vec3 vHaze; void main(){ vHaze = haze; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 hill, haze, sunColor; varying vec3 vHaze;
      void main(){ float k = clamp(vHaze.y * 0.85 + vHaze.x * 0.5, 0.0, 1.0); vec3 c = mix(hill, haze, k); c += sunColor * 0.05 * (1.0 - vHaze.x) * (1.0 - vHaze.y);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    fog: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material); mesh.name = 'orchard-backdrop'; mesh.raycast = () => {}; mesh.renderOrder = -900;
  return mesh;
}

// ---------- ground contact puffs (cheap, pooled, presentation only) ----------
function createContactPuffs(scene, max = 48) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({vertexColors: false, transparent: true, depthWrite: false, opacity: 1, fog: true});
  material.onBeforeCompile = shader => { // soft round dust without a texture; instance colour carries tint and alpha via life
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vPuffUv;').replace('#include <alphatest_fragment>', 'diffuseColor.a *= smoothstep(0.5, 0.15, length(vPuffUv - 0.5));\n#include <alphatest_fragment>');
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vPuffUv;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvPuffUv = uv;');
  };
  material.customProgramCacheKey = () => 'orchard-puff-v1';
  const mesh = new THREE.InstancedMesh(geometry, material, max); mesh.name = 'orchard-contact-puffs'; mesh.frustumCulled = false; mesh.raycast = () => {};
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const live = [], m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), color = new THREE.Color();
  mesh.setColorAt(0, color); mesh.count = 0; scene.add(mesh); // allocate instanceColor now: no program switch on first footstep
  return {
    mesh,
    emit(x, y, z, tint, strength = 1) { for (let i = 0; i < 3; i++) { if (live.length >= max) live.shift(); const a = Math.random() * 6.283; live.push({x: x + Math.cos(a) * .12, y: y + .04, z: z + Math.sin(a) * .12, vx: Math.cos(a) * .35 * strength, vz: Math.sin(a) * .35 * strength, age: 0, life: .55 + .25 * Math.random(), size: .18 * strength + .1, tint}); } },
    update(dt, camera) {
      for (let i = live.length - 1; i >= 0; i--) if ((live[i].age += dt) >= live[i].life) live.splice(i, 1);
      if (camera) camera.getWorldQuaternion(q); // billboard toward the viewer (works for rig/XR children)
      for (let i = 0; i < live.length; i++) {
        const P = live[i], t = P.age / P.life; p.set(P.x + P.vx * P.age, P.y + .25 * t, P.z + P.vz * P.age); s.setScalar(P.size * (1 + 1.6 * t));
        mesh.setMatrixAt(i, m.compose(p, q, s)); color.setRGB(P.tint[0] * (1 - t * .7), P.tint[1] * (1 - t * .7), P.tint[2] * (1 - t * .7)); mesh.setColorAt(i, color);
      }
      mesh.count = live.length; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      material.opacity = .55;
    },
    live: () => live.length,
    dispose() { scene.remove(mesh); geometry.dispose(); material.dispose(); mesh.dispose?.(); },
  };
}

// ---------- public entry ----------
export function createOrchardPresentation({scene, renderer, ground, sun, hemisphere = null, height, camera = null, quality = 'high', daylight = 'golden', assetBase = '/assets/', textures = null, loadTextures = true, edits = [], deposits = null, trees = null, shadows = undefined, baseHeight = null, deformation = true, features = null}) {
  if (!scene || !ground || !sun || typeof height !== 'function') throw new Error('createOrchardPresentation requires scene, ground, sun and height(x, z)');
  const q = QUALITY[quality] ? quality : 'high', cfg = QUALITY[q];
  // Deformation strata need the caller's authoritative undeformed surface; without it the v1 look is kept exactly.
  const deformOn = deformation !== false && typeof baseHeight === 'function' && cfg.strata > 0;
  hemisphere = hemisphere || scene.children.find(o => o.isHemisphereLight) || null;
  const report = {patched: false, missing: []};
  const saved = {background: scene.background, fog: scene.fog, envI: scene.environmentIntensity, material: ground.material, receive: ground.receiveShadow,
    sunColor: sun.color.clone(), sunI: sun.intensity, sunPos: sun.position.clone(), cast: sun.castShadow, exposure: renderer?.toneMappingExposure, shadowEnabled: renderer?.shadowMap?.enabled, shadowType: renderer?.shadowMap?.type,
    hemi: hemisphere && {sky: hemisphere.color.clone(), ground: hemisphere.groundColor.clone(), i: hemisphere.intensity}};
  const material = createOrchardGroundMaterial({quality: q, report, strata: deformOn ? cfg.strata : 0}), U = material.userData.orchardUniforms;
  ground.material = material;
  const owned = []; // textures we created
  let field = null, deformTex = null, deformUploads = 0, deformReason = deformOn ? '' : deformation === false ? 'disabled' : typeof baseHeight !== 'function' ? 'no baseHeight' : 'quality';
  if (deformOn) {
    field = createDeformationField({size: cfg.deform, half: GROUND_HALF, height, baseHeight});
    deformTex = new THREE.DataTexture(field.data, cfg.deform, cfg.deform, THREE.RGBAFormat, THREE.HalfFloatType);
    deformTex.magFilter = deformTex.minFilter = THREE.LinearFilter; deformTex.wrapS = deformTex.wrapT = THREE.ClampToEdgeWrapping; deformTex.colorSpace = THREE.NoColorSpace; deformTex.needsUpdate = true;
    U.orchardDeform.value.dispose(); U.orchardDeform.value = deformTex; owned.push(deformTex);
  }
  function setFeatures(next = {}) {
    const f = {...TERRAIN_FEATURES, ...(features || {}), ...next}; features = f;
    U.orchardFeatures.value.set(+f.strata, +f.wet, +f.ejecta, +f.edges); return {...f};
  }
  setFeatures();
  // Mask texture (CPU-baked, rebuilt only on groundChanged).
  const maskData = new Uint8Array(cfg.mask * cfg.mask * 4);
  const mask = new THREE.DataTexture(maskData, cfg.mask, cfg.mask, THREE.RGBAFormat); mask.magFilter = THREE.LinearFilter; mask.minFilter = THREE.LinearFilter; mask.colorSpace = THREE.NoColorSpace; mask.wrapS = mask.wrapT = THREE.ClampToEdgeWrapping;
  U.orchardMask.value = mask; owned.push(mask);
  const ctx = {edits, terrainTick:Infinity, deposits: deposits || ORCHARD_LAYOUT.deposits, trees: trees || ORCHARD_LAYOUT.trees};
  let lastBakeMs = 0, bakes = 0, signature = '', staticSignature = '', lastBakeKind = '';
  let maskJob = null;

  const anisotropy = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 1);
  const setTex = (slot, tex, srgb) => { if (!tex) return; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1, 1); tex.offset.set(0, 0); tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; tex.anisotropy = anisotropy; tex.needsUpdate = true; const old = U[slot].value; U[slot].value = tex; if (old && old.isDataTexture && old.image?.width === 1) old.dispose(); };
  const textureSlots = {meadow_albedo: ['orchardGrassMap', true], meadow_normal: ['orchardGrassNormal', false], meadow_orm: ['orchardGrassOrm', false], orchard_soil_albedo: ['orchardSoilMap', true], orchard_soil_normal: ['orchardSoilNormal', false]};
  if (material.userData.orchardStrata > 0) Object.assign(textureSlots, {terrain_strata_albedo: ['orchardStrataMap', true], terrain_strata_normal: ['orchardStrataNormal', false]});
  let disposed = false, pending = 0;
  if (textures) for (const [name, tex] of Object.entries(textures)) if (textureSlots[name]) setTex(textureSlots[name][0], tex, textureSlots[name][1]);
  if (loadTextures && !textures && typeof document !== 'undefined') {
    const loader = new THREE.TextureLoader();
    for (const [name, [slot, srgb]] of Object.entries(textureSlots)) { pending++; loader.load(`${assetBase}${name}.png`, tex => { pending--; if (disposed) { tex.dispose(); return; } owned.push(tex); setTex(slot, tex, srgb); }, undefined, () => { pending--; console.warn(`[orchard] missing ${name}.png; flat fallback kept`); }); }
  }

  const sky = createSky(q === 'low' ? 2 : 3); scene.add(sky);
  const skirt = createSkirt(material, height); scene.add(skirt.mesh);
  const backdrop = createBackdrop(); scene.add(backdrop);
  const puffs = createContactPuffs(scene);

  // Shadows: one directional, <= 1024, follow + texel-snapped. Off in 'low' unless explicitly requested.
  const shadowSize = shadows === false ? 0 : shadows === true ? 1024 : cfg.shadow;
  if (shadowSize && renderer?.shadowMap) {
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    sun.castShadow = true; sun.shadow.mapSize.set(shadowSize, shadowSize); sun.shadow.bias = -.0004; sun.shadow.normalBias = .035;
    ground.receiveShadow = true;
  }
  let addedTarget = false; if (!sun.target.parent) { scene.add(sun.target); addedTarget = true; }
  const fog = new THREE.Fog(0xffffff, 55, 135); scene.fog = fog;
  const sunDir = new THREE.Vector3(), focus = new THREE.Vector3(), tmp = new THREE.Vector3(), camPos = new THREE.Vector3(), camDir = new THREE.Vector3();
  const lightRight = new THREE.Vector3(), lightUp = new THREE.Vector3();
  let preset = DAYLIGHT.golden, shadowExtent = 0;

  function setDaylight(name) {
    preset = typeof name === 'object' ? {...DAYLIGHT.golden, ...name} : DAYLIGHT[name] || DAYLIGHT.golden;
    const el = THREE.MathUtils.degToRad(preset.elev), az = THREE.MathUtils.degToRad(preset.azim);
    const env = {sunDir: new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)), sunI: preset.sunI, hemiI: preset.hemiI, exposure: preset.exposure, envI: preset.env};
    for (const k of ['sun', 'hemiSky', 'hemiGround', 'zenith', 'horizon', 'haze', 'hill']) env[k] = srgbHex(preset[k]);
    applyEnvironment(env);
  }
  // Live environment from the day/night + weather layer (colours are linear THREE.Color, sunDir points at the light).
  // Optional sky extras: moonDir, night, overcast, clouds, cloudTint, flash, time, fogScale.
  let fogScale = 1;
  function applyEnvironment(env) {
    sunDir.copy(env.sunDir).normalize();
    sun.color.copy(env.sun); sun.intensity = env.sunI;
    if (hemisphere) { hemisphere.color.copy(env.hemiSky); hemisphere.groundColor.copy(env.hemiGround); hemisphere.intensity = env.hemiI; }
    const u = sky.material.uniforms;
    u.zenith.value.copy(env.zenith); u.horizon.value.copy(env.horizon); u.sunColor.value.copy(env.skySun || env.sun); u.sunDir.value.copy(env.skySunDir || sunDir);
    if (env.moonDir) u.moonDir.value.copy(env.moonDir);
    u.night.value = env.night ?? 0; u.overcast.value = env.overcast ?? 0; u.clouds.value = env.clouds ?? .22; u.flash.value = env.flash ?? 0; u.time.value = env.time ?? 0;
    if (env.cloudTint) u.cloudTint.value.copy(env.cloudTint); else u.cloudTint.value.setRGB(1, 1, 1);
    backdrop.material.uniforms.hill.value.copy(env.hill); backdrop.material.uniforms.haze.value.copy(env.haze); backdrop.material.uniforms.sunColor.value.copy(env.skySun || env.sun);
    fog.color.copy(env.haze); scene.background = fog.color;
    fogScale = env.fogScale ?? 1;
    if (renderer) renderer.toneMappingExposure = env.exposure;
    scene.environmentIntensity = env.envI;
    lightUp.set(0, 1, 0); if (Math.abs(sunDir.y) > .999) lightUp.set(0, 0, 1);
    lightRight.crossVectors(lightUp, sunDir).normalize(); lightUp.crossVectors(sunDir, lightRight).normalize();
    placeSun(focus);
  }
  function placeSun(target) {
    if (sun.castShadow && shadowExtent) { // snap focus to whole shadow texels in light space => no shimmer while walking
      const texel = 2 * shadowExtent / sun.shadow.mapSize.x, r = Math.round(target.dot(lightRight) / texel) * texel, u = Math.round(target.dot(lightUp) / texel) * texel, d = target.dot(sunDir);
      tmp.copy(lightRight).multiplyScalar(r).addScaledVector(lightUp, u).addScaledVector(sunDir, d);
    } else tmp.copy(target);
    sun.target.position.copy(tmp); sun.position.copy(tmp).addScaledVector(sunDir, 70); sun.target.updateMatrixWorld();
  }
  function setShadowExtent(extent) {
    if (!sun.castShadow || extent === shadowExtent) return; shadowExtent = extent;
    const c = sun.shadow.camera; c.left = c.bottom = -extent; c.right = c.top = extent; c.near = 1; c.far = 160; c.updateProjectionMatrix();
  }
  const temporalMask=new Set();let phaseEdits=[],phaseTick=Infinity,phaseKey='';
  function queueTemporalMask(dirty){const step=GROUND_HALF*2/cfg.mask;
    for(const e of dirty){const r=e.radius*1.25+step,i0=Math.max(0,Math.floor((e.x-r+GROUND_HALF)/step)),i1=Math.min(cfg.mask-1,Math.ceil((e.x+r+GROUND_HALF)/step)),j0=Math.max(0,Math.floor((e.z-r+GROUND_HALF)/step)),j1=Math.min(cfg.mask-1,Math.ceil((e.z+r+GROUND_HALF)/step));
      for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++)temporalMask.add(j*cfg.mask+i);}
  }
  function drainTemporalMask(budgetMs){const start=performance.now(),step=GROUND_HALF*2/cfg.mask;let done=0;
    for(const key of temporalMask){const i=key%cfg.mask,j=Math.floor(key/cfg.mask);maskData[key*4+1]=disturbanceAt(-GROUND_HALF+(i+.5)*step,-GROUND_HALF+(j+.5)*step,ctx.edits,ctx.terrainTick)*255+.5;temporalMask.delete(key);done++;if((done&15)===0&&performance.now()-start>=budgetMs)break;}
    if(done)mask.needsUpdate=true;return done;
  }
  // Presentation-clock terrain frames: the edit list is unchanged, only time moved. Queue just the kernels whose
  // animation advanced (budgeted drains below), skipping groundChanged's static signatures.
  function terrainTickChanged(tick) {
    const frame=terrainFrameKey(ctx.edits,tick);if(frame===phaseKey)return false;
    const dirty=terrainDirtyEdits(phaseEdits,ctx.edits,phaseTick,tick);ctx.terrainTick=tick;phaseTick=tick;phaseKey=frame;
    field?.setEdits(ctx.edits,tick);queueTemporalMask(dirty);return true;
  }
  function groundChanged(next = {}) {
    if(next.terrainTick!==undefined)ctx.terrainTick=next.terrainTick;
    if (next.edits) ctx.edits = next.edits; if (next.deposits) ctx.deposits = next.deposits; if (next.trees) ctx.trees = next.trees;
    const staticSig = JSON.stringify([ctx.deposits, ctx.trees]), sig = staticSig + JSON.stringify(ctx.edits);
    const frame=terrainFrameKey(ctx.edits,ctx.terrainTick),phaseChanged=frame!==phaseKey;
    const dirty=phaseChanged?terrainDirtyEdits(phaseEdits,ctx.edits,phaseTick,ctx.terrainTick):[];
    phaseEdits=ctx.edits;phaseTick=ctx.terrainTick;phaseKey=frame;
    if(next.foundationChanged)field?.invalidate();
    field?.setEdits(ctx.edits,ctx.terrainTick);
    if (sig === signature && !next.force) {if(phaseChanged)queueTemporalMask(dirty);return phaseChanged;} signature = sig;
    temporalMask.clear(); // queues dirty rects only; drained under the frame budget in update()
    const t0 = performance.now();
    if (staticSig === staticSignature && !next.force) { bakeDisturbedChannel(ctx.edits, cfg.mask, GROUND_HALF, maskData,ctx.terrainTick); lastBakeKind = 'edits'; }
    else if (bakes) {
      maskJob = createSurfaceMaskJob({...ctx}, cfg.mask);
      staticSignature = staticSig; lastBakeKind = 'queued';
      // Newer ecosystem requests replace unfinished work; edit shading remains immediately responsive.
      bakeDisturbedChannel(ctx.edits, cfg.mask, GROUND_HALF, maskData,ctx.terrainTick);
      mask.needsUpdate = true; skirt.rebuild();
      return true;
    }
    else { bakeSurfaceMask(ctx, cfg.mask, GROUND_HALF, maskData); staticSignature = staticSig; lastBakeKind = 'full'; }
    mask.needsUpdate = true; skirt.rebuild();
    lastBakeMs = performance.now() - t0; bakes++; return true;
  }
  // Optional: adopt textures that legacy code assigns to ground.material.map etc. (game.js line 81) instead of double-applying them.
  function adoptLegacyMaps() {
    for (const [slot, uni, srgb] of [['map', 'orchardGrassMap', true], ['normalMap', 'orchardGrassNormal', false], ['roughnessMap', 'orchardGrassOrm', false]]) {
      if (material[slot]) { setTex(uni, material[slot], srgb); material[slot] = null; material.needsUpdate = true; }
    }
    if (material.color.getHex() !== 0xffffff) material.color.setHex(0xffffff);
  }
  function update(dt = 0, viewCamera = camera) {
    const jobStart = performance.now();
    if (maskJob && maskJob.step()) {
      maskData.set(maskJob.data);
      bakeDisturbedChannel(ctx.edits, cfg.mask, GROUND_HALF, maskData,ctx.terrainTick);
      lastBakeMs = maskJob.cpuMs; lastBakeKind = 'full'; bakes++;
      mask.needsUpdate = true; maskJob = null;
    }
    if(temporalMask.size)drainTemporalMask(Math.max(.25,Math.min(.6,DEFORM_JOB_BUDGET_MS-(performance.now()-jobStart))));
    // Deformation texels share what is left of the per-frame job budget (always some progress: >= .25 ms).
    if (field?.pending && field.step(Math.max(.25, DEFORM_JOB_BUDGET_MS - (performance.now() - jobStart)))) { deformTex.needsUpdate = true; deformUploads++; }
    adoptLegacyMaps();
    if (viewCamera) {
      viewCamera.getWorldPosition(camPos); viewCamera.getWorldDirection(camDir);
      sky.position.copy(camPos);
      const above = Math.max(0, camPos.y - height(camPos.x, camPos.z)), rts = above > 10;
      // Higher views see further: push haze back so the RTS board stays legible; FPS keeps depth haze.
      fog.near = (rts ? 75 : 50) * fogScale; fog.far = (rts ? 175 : 135) * Math.max(fogScale, .28);
      if (sun.castShadow) {
        setShadowExtent(rts ? 34 : 20);
        if (rts && camDir.y < -.05) { const t = above / -camDir.y; focus.copy(camPos).addScaledVector(camDir, Math.min(t, 80)); }
        else { tmp.set(camDir.x, 0, camDir.z); if (tmp.lengthSq() < 1e-6) tmp.set(0, 0, -1); tmp.normalize(); focus.copy(camPos).addScaledVector(tmp, 9); }
        focus.y = height(focus.x, focus.z); placeSun(focus);
      }
    }
    puffs.update(dt, viewCamera);
  }
  // Footstep / landing / slide hook: returns surface metadata and spawns a cheap tinted puff.
  function contact(x, z, {strength = 1, visual = true} = {}) {
    const surf = classifySurface(x, z, height, ctx);
    if (visual && strength > 0 && surf.material !== 'grass') puffs.emit(x, height(x, z), z, surf.tint, Math.min(2, strength));
    else if (visual && strength > .8) puffs.emit(x, height(x, z), z, surf.tint, strength * .6); // only heavy landings stir grass
    return surf;
  }
  function stats() {
    const tris = m => (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    return {version: ORCHARD_PRESENTATION_VERSION, quality: q, shaderPatched: report.patched, shaderMissing: report.missing.slice(), maskSize: cfg.mask, maskBakeMs: +lastBakeMs.toFixed(3), maskBakeKind: lastBakeKind, maskBakes: bakes,
      maskPending: !!maskJob, addedDrawCalls: 3 + (puffs.live() ? 1 : 0), addedTriangles: {sky: tris(sky), skirt: tris(skirt.mesh), backdrop: tris(backdrop)}, shadowMapSize: sun.castShadow ? sun.shadow.mapSize.x : 0, shadowExtent, pendingTextures: pending, puffs: puffs.live(),
      deformation: {enabled: !!field, reason: deformReason, strata: material.userData.orchardStrata, size: field ? field.size : 0, pending: !!field?.pending||temporalMask.size>0, temporalTexels:temporalMask.size, queuedRects: field?.queuedRects || 0,
        lastStepMs: field ? +field.lastStepMs.toFixed(3) : 0, maxStepMs: field ? +field.maxStepMs.toFixed(3) : 0, cpuMs: field ? +field.cpuMs.toFixed(3) : 0, texels: field?.texelsDone || 0, uploads: deformUploads, features: {...features}}};
  }
  function dispose() {
    if (disposed) return; disposed = true; maskJob = null; field = null;
    for (const o of [sky, skirt.mesh, backdrop]) { scene.remove(o); o.geometry.dispose(); if (o.material !== material) o.material.dispose(); }
    puffs.dispose(); if (addedTarget) scene.remove(sun.target);
    for (const u of Object.values(U)) if (u.value?.isTexture && u.value.image?.width === 1) u.value.dispose();
    for (const t of owned) t.dispose();
    ground.material = saved.material; ground.receiveShadow = saved.receive; material.dispose();
    scene.background = saved.background; scene.fog = saved.fog; scene.environmentIntensity = saved.envI;
    sun.color.copy(saved.sunColor); sun.intensity = saved.sunI; sun.position.copy(saved.sunPos); sun.castShadow = saved.cast;
    if (saved.hemi) { hemisphere.color.copy(saved.hemi.sky); hemisphere.groundColor.copy(saved.hemi.ground); hemisphere.intensity = saved.hemi.i; }
    if (renderer) { renderer.toneMappingExposure = saved.exposure; if (renderer.shadowMap) { renderer.shadowMap.enabled = saved.shadowEnabled; renderer.shadowMap.type = saved.shadowType; } }
  }
  // Shadow casters are opt-in so the game controls cost (trees/forge/actors only, never grass props).
  function enableShadowCasting(root, cast = true) { if (!sun.castShadow) return 0; let n = 0; root.traverse(o => { if (o.isMesh && !o.material?.transparent) { o.castShadow = cast; n++; } }); return n; }

  if (sun.castShadow) setShadowExtent(20);
  setDaylight(daylight); groundChanged({force: true});
  return {update, groundChanged, terrainTick: terrainTickChanged, contact, surfaceAt: (x, z) => classifySurface(x, z, height, ctx), setDaylight, applyEnvironment, setFeatures, enableShadowCasting, stats, dispose, material, objects: {sky, skirt: skirt.mesh, backdrop, puffs: puffs.mesh},
    flushDeformation() { if(temporalMask.size)drainTemporalMask(Infinity);if (field?.pending) { field.flush(); deformTex.needsUpdate = true; deformUploads++; } }}; // loading screens/tests only
}
