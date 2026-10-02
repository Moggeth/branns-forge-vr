// Orchard environment presentation: warm golden meadow ground, worn paths, slope soil/stone,
// hazy sky, far-only silhouette backdrop and a fixed-budget follow shadow.
// Presentation only: never changes terrain height, collision, raycast targets or gameplay.
// World height is always the caller's authoritative height(x, z) function.
import * as THREE from 'three';

export const ORCHARD_PRESENTATION_VERSION = 1;
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
const QUALITY = {high: {mask: 192, shadow: 1024, detail: 2}, medium: {mask: 160, shadow: 1024, detail: 2}, low: {mask: 128, shadow: 0, detail: 1}};

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

// Pure surface sample: wear (paths/clearings), disturbed (fresh earth from edits), stone, shade (under canopies).
export function surfaceSample(x, z, ctx = {}) {
  const layout = ctx.layout || ORCHARD_LAYOUT, edits = ctx.edits || [], deposits = ctx.deposits || layout.deposits, trees = ctx.trees || layout.trees;
  // Meander: warp the query so straight authored segments read as foot-worn lines.
  const wx = x + (valueNoise(x * .23 + 5.1, z * .23) - .5) * 1.1, wz = z + (valueNoise(x * .23 - 7.7, z * .23 + 2.3) - .5) * 1.1;
  let wear = 0;
  for (const [cx, cz, r, w] of layout.clearings) wear = Math.max(wear, w * smooth(r * 1.45, r * .55, Math.hypot(wx - cx, wz - cz)));
  for (const [ax, az, bx, bz, hw, w] of layout.paths) wear = Math.max(wear, w * smooth(hw * 1.9, hw * .45, segDist(wx, wz, ax, az, bx, bz)));
  let disturbed = 0;
  for (const e of edits) {
    const r = Math.max(.01, e.radius || 0), d = Math.hypot(x - e.x, z - e.z); if (d >= r * 1.25) continue;
    const t = 1 - d / r, mag = Math.min(1, Math.abs(e.height || 0) / 1.2);
    // Raised mounds expose earth on their flanks; lowered craters show a churned rim and floor.
    const band = (e.height || 0) < 0 ? Math.max(smooth(-.25, .2, t) * smooth(1, .55, t), .55 * smooth(.3, .8, t)) : smooth(-.2, .25, t) * smooth(1.05, .45, t);
    disturbed = Math.max(disturbed, mag * band);
  }
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

// Edit-only rebake: rewrites just the disturbed (G) channel; static wear/stone/shade stay cached.
export function bakeDisturbedChannel(edits = [], size = 160, half = GROUND_HALF, out) {
  const step = half * 2 / size;
  for (let o = 1; o < out.length; o += 4) out[o] = 0;
  for (const e of edits) {
    const r = Math.max(.01, e.radius || 0) * 1.25, i0 = Math.max(0, Math.floor((e.x - r + half) / step)), i1 = Math.min(size - 1, Math.ceil((e.x + r + half) / step));
    const j0 = Math.max(0, Math.floor((e.z - r + half) / step)), j1 = Math.min(size - 1, Math.ceil((e.z + r + half) / step));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const v = surfaceSample(-half + (i + .5) * step, -half + (j + .5) * step, {edits: [e], layout: EMPTY_LAYOUT, deposits: [], trees: []}).disturbed * 255 + .5, o = (j * size + i) * 4 + 1;
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
vec4 oGA = texture2D(orchardGrassMap, oUvA);
#if ORCHARD_DETAIL > 1
vec4 oGB = texture2D(orchardGrassMap, oUvB);
float oAB = clamp((orchardNoise(oXZ * 0.085) - 0.5) * 3.0 + (dot(oGB.rgb, vec3(0.33)) - dot(oGA.rgb, vec3(0.33))) * 4.0 + 0.5, 0.0, 1.0);
#else
vec4 oGB = oGA; float oAB = 0.0;
#endif
vec3 oGrass = mix(oGA.rgb, oGB.rgb, oAB);
// Tile-average (linear) of meadow_albedo; compress its baked blotches more with distance so RTS views show
// macro drifts instead of a repeating 3 m pattern. Near the feet the texture keeps most of its detail.
const vec3 oGrassAvg = vec3(0.069, 0.150, 0.015);
oGrass = oGrassAvg + (oGrass - oGrassAvg) * mix(0.7, 0.32, smoothstep(10.0, 55.0, oDist));
float oL = dot(oGrass, vec3(0.2126, 0.7152, 0.0722));
float oDry = orchardDry(oXZ);
float oMacro = orchardNoise(oXZ * 0.018 + 3.0);
// Warm grade: lush pockets under canopies, straw-gold in dry drifts; luminance-preserving tints.
oGrass = mix(oGrass * orchardLushTint, oL * orchardDryTint, oDry * 0.62);
oGrass *= mix(vec3(1.0), vec3(0.72, 0.85, 0.6), oMask.a * 0.6);
oGrass *= 0.9 + 0.2 * oMacro;
// Trampled fringe: shorter, paler grass around wear before bare earth appears.
oGrass = mix(oGrass, oL * orchardWornTint * 1.25, smoothstep(0.08, 0.45, oMask.r) * 0.55);
vec2 oUvS = oXZ * vec2(1.0, -1.0) / orchardSoilTile;
vec3 oSoil = texture2D(orchardSoilMap, oUvS).rgb;
vec4 oSoilN = texture2D(orchardSoilNormal, oUvS);
vec4 oStoneN = texture2D(orchardSoilNormal, oUvS * 0.43 + 0.21);
vec3 oStone = texture2D(orchardSoilMap, oUvS * 0.43 + 0.21).rgb;
oStone = mix(vec3(dot(oStone, vec3(0.33))), oStone, 0.35) * orchardStoneTint * (0.75 + 0.5 * oStoneN.b);
vec3 oDisturbedSoil = oSoil * vec3(0.72, 0.62, 0.52);
// Height-aware layer weights: grass clumps (bright texels) poke through path edges; pebbles poke through grass.
float oGrassH = oL * 3.0;
float oSoilW = smoothstep(0.35, 0.8, oMask.r + (oSoilN.b - oGrassH) * 0.35 + (oWarp.x * 0.25));
oSoilW = max(oSoilW, smoothstep(0.06, 0.14, oSlope + (oSoilN.b - 0.5) * 0.06));
float oDistW = smoothstep(0.25, 0.65, oMask.g + (oSoilN.b - 0.5) * 0.4);
float oStoneW = max(smoothstep(0.35, 0.7, oMask.b + (oStoneN.b - 0.5) * 0.7), smoothstep(0.16, 0.26, oSlope + (oStoneN.b - 0.5) * 0.08));
vec3 oAlbedo = mix(oGrass, oSoil, oSoilW);
oAlbedo = mix(oAlbedo, oDisturbedSoil, oDistW);
oAlbedo = mix(oAlbedo, oStone, oStoneW);
vec4 oOrm = texture2D(orchardGrassOrm, oUvA);
float oBare = max(max(oSoilW, oDistW), oStoneW);
oAlbedo *= mix(mix(1.0, oOrm.r, 0.55), 0.8 + 0.4 * oSoilN.b, oBare);
diffuseColor.rgb *= oAlbedo;
`;
const FRAG_ROUGH = /* glsl */`
float roughnessFactor = roughness * mix(oOrm.g, mix(0.96, 0.84, oDistW), oSoilW) ;
roughnessFactor = mix(roughnessFactor, 0.72, oStoneW);
`;
const FRAG_NORMAL = /* glsl */`
{
  vec3 oNA = texture2D(orchardGrassNormal, oUvA).xyz * 2.0 - 1.0;
#if ORCHARD_DETAIL > 1
  vec3 oNB = texture2D(orchardGrassNormal, oUvB).xyz * 2.0 - 1.0;
  oNB.xy = oNB.xy * oRot; // undo the UV rotation so the perturbation stays world-aligned
  vec3 oNG = normalize(mix(oNA, oNB, oAB));
#else
  vec3 oNG = oNA;
#endif
  vec3 oNS = vec3(oSoilN.xy * 2.0 - 1.0, 0.0); oNS.z = sqrt(max(0.0, 1.0 - dot(oNS.xy, oNS.xy)));
  vec3 oNT = vec3(oStoneN.xy * 2.0 - 1.0, 0.0); oNT.z = sqrt(max(0.0, 1.0 - dot(oNT.xy, oNT.xy)));
  vec3 oTn = normalize(mix(mix(oNG * vec3(0.6, 0.6, 1.0), oNS, oSoilW), oNT * vec3(1.4, 1.4, 1.0), oStoneW));
  // Fade micro relief with distance (anti-shimmer for RTS/VR) without moving with the camera.
  oTn.xy *= orchardNormalStrength * mix(1.0, 0.35, smoothstep(18.0, 70.0, oDist));
  vec3 oT = normalize(vec3(1.0, 0.0, 0.0) - oN * oN.x);
  vec3 oB = cross(oN, oT);
  vec3 oPW = normalize(oT * oTn.x + oB * oTn.y + oN * oTn.z);
  normal = normalize((viewMatrix * vec4(oPW, 0.0)).xyz);
}
`;

function patchShader(shader, detail, report) {
  const v = shader.vertexShader, f = shader.fragmentShader;
  report.missing = [...SHADER_ANCHORS.vertex.filter(a => !v.includes(a)), ...SHADER_ANCHORS.fragment.filter(a => !f.includes(a))];
  if (report.missing.length) { report.patched = false; return shader; } // leave stock material rather than produce a broken program
  shader.vertexShader = v.replace('#include <common>', '#include <common>\nvarying vec3 vOrchardWorld;\nvarying vec3 vOrchardNormal;')
    .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvOrchardWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvOrchardNormal = normalize(mat3(modelMatrix) * objectNormal);');
  shader.fragmentShader = `#define ORCHARD_DETAIL ${detail}\n` + f.replace('#include <common>', '#include <common>\n' + FRAG_PARS)
    .replace('#include <map_fragment>', FRAG_ALBEDO).replace('#include <roughnessmap_fragment>', FRAG_ROUGH).replace('#include <normal_fragment_maps>', FRAG_NORMAL);
  report.patched = true;
  return shader;
}

const srgbHex = hex => new THREE.Color(hex); // Color.setHex converts sRGB -> linear working space
function flatTexture(rgb, colorSpace = THREE.NoColorSpace) {
  const t = new THREE.DataTexture(new Uint8Array([...rgb, 255]), 1, 1); t.colorSpace = colorSpace; t.needsUpdate = true; return t;
}

// Ground material. Uses custom uniforms (not .map) so stock UV-repeat textures cannot double-apply.
export function createOrchardGroundMaterial({quality = 'high', report = {}} = {}) {
  const detail = (QUALITY[quality] || QUALITY.high).detail;
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
  };
  material.onBeforeCompile = shader => { Object.assign(shader.uniforms, uniforms); patchShader(shader, detail, report); };
  material.customProgramCacheKey = () => `orchard-ground-v${ORCHARD_PRESENTATION_VERSION}-d${detail}`;
  material.userData.orchardUniforms = uniforms;
  return material;
}

// ---------- sky dome, skirt and backdrop ----------
function createSky() {
  const material = new THREE.ShaderMaterial({
    uniforms: {zenith: {value: new THREE.Color()}, horizon: {value: new THREE.Color()}, sunColor: {value: new THREE.Color()}, sunDir: {value: new THREE.Vector3(0, 1, 0)}},
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
    fragmentShader: `uniform vec3 zenith, horizon, sunColor, sunDir; varying vec3 vDir;
      void main(){ vec3 d = normalize(vDir); float h = max(d.y, 0.0); float s = max(dot(d, normalize(sunDir)), 0.0);
        vec3 c = mix(horizon, zenith, pow(h, 0.55)); c = mix(c, horizon * 0.92, smoothstep(0.0, -0.08, d.y));
        c += sunColor * (pow(s, 7.0) * 0.28 + pow(s, 90.0) * 0.6 + smoothstep(0.9993, 0.9997, s) * 6.0);
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
        positions.set([cx * dist, edge * (1 - t) + lift, cz * dist], (s * rings + r) * 3);
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
export function createOrchardPresentation({scene, renderer, ground, sun, hemisphere = null, height, camera = null, quality = 'high', daylight = 'golden', assetBase = '/assets/', textures = null, loadTextures = true, edits = [], deposits = null, trees = null, shadows = undefined}) {
  if (!scene || !ground || !sun || typeof height !== 'function') throw new Error('createOrchardPresentation requires scene, ground, sun and height(x, z)');
  const q = QUALITY[quality] ? quality : 'high', cfg = QUALITY[q];
  hemisphere = hemisphere || scene.children.find(o => o.isHemisphereLight) || null;
  const report = {patched: false, missing: []};
  const saved = {background: scene.background, fog: scene.fog, envI: scene.environmentIntensity, material: ground.material, receive: ground.receiveShadow,
    sunColor: sun.color.clone(), sunI: sun.intensity, sunPos: sun.position.clone(), cast: sun.castShadow, exposure: renderer?.toneMappingExposure, shadowEnabled: renderer?.shadowMap?.enabled, shadowType: renderer?.shadowMap?.type,
    hemi: hemisphere && {sky: hemisphere.color.clone(), ground: hemisphere.groundColor.clone(), i: hemisphere.intensity}};
  const material = createOrchardGroundMaterial({quality: q, report}), U = material.userData.orchardUniforms;
  ground.material = material;
  const owned = []; // textures we created
  // Mask texture (CPU-baked, rebuilt only on groundChanged).
  const maskData = new Uint8Array(cfg.mask * cfg.mask * 4);
  const mask = new THREE.DataTexture(maskData, cfg.mask, cfg.mask, THREE.RGBAFormat); mask.magFilter = THREE.LinearFilter; mask.minFilter = THREE.LinearFilter; mask.colorSpace = THREE.NoColorSpace; mask.wrapS = mask.wrapT = THREE.ClampToEdgeWrapping;
  U.orchardMask.value = mask; owned.push(mask);
  const ctx = {edits, deposits: deposits || ORCHARD_LAYOUT.deposits, trees: trees || ORCHARD_LAYOUT.trees};
  let lastBakeMs = 0, bakes = 0, signature = '', staticSignature = '', lastBakeKind = '';

  const anisotropy = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 1);
  const setTex = (slot, tex, srgb) => { if (!tex) return; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1, 1); tex.offset.set(0, 0); tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; tex.anisotropy = anisotropy; tex.needsUpdate = true; const old = U[slot].value; U[slot].value = tex; if (old && old.isDataTexture && old.image?.width === 1) old.dispose(); };
  const textureSlots = {meadow_albedo: ['orchardGrassMap', true], meadow_normal: ['orchardGrassNormal', false], meadow_orm: ['orchardGrassOrm', false], orchard_soil_albedo: ['orchardSoilMap', true], orchard_soil_normal: ['orchardSoilNormal', false]};
  let disposed = false, pending = 0;
  if (textures) for (const [name, tex] of Object.entries(textures)) if (textureSlots[name]) setTex(textureSlots[name][0], tex, textureSlots[name][1]);
  if (loadTextures && !textures && typeof document !== 'undefined') {
    const loader = new THREE.TextureLoader();
    for (const [name, [slot, srgb]] of Object.entries(textureSlots)) { pending++; loader.load(`${assetBase}${name}.png`, tex => { pending--; if (disposed) { tex.dispose(); return; } owned.push(tex); setTex(slot, tex, srgb); }, undefined, () => { pending--; console.warn(`[orchard] missing ${name}.png; flat fallback kept`); }); }
  }

  const sky = createSky(); scene.add(sky);
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
    sunDir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
    sun.color.copy(srgbHex(preset.sun)); sun.intensity = preset.sunI;
    if (hemisphere) { hemisphere.color.copy(srgbHex(preset.hemiSky)); hemisphere.groundColor.copy(srgbHex(preset.hemiGround)); hemisphere.intensity = preset.hemiI; }
    sky.material.uniforms.zenith.value.copy(srgbHex(preset.zenith)); sky.material.uniforms.horizon.value.copy(srgbHex(preset.horizon));
    sky.material.uniforms.sunColor.value.copy(srgbHex(preset.sun)); sky.material.uniforms.sunDir.value.copy(sunDir);
    backdrop.material.uniforms.hill.value.copy(srgbHex(preset.hill)); backdrop.material.uniforms.haze.value.copy(srgbHex(preset.haze)); backdrop.material.uniforms.sunColor.value.copy(srgbHex(preset.sun));
    fog.color.copy(srgbHex(preset.haze)); scene.background = fog.color;
    if (renderer) renderer.toneMappingExposure = preset.exposure;
    scene.environmentIntensity = preset.env;
    lightUp.set(0, 1, 0); lightRight.crossVectors(lightUp, sunDir).normalize(); lightUp.crossVectors(sunDir, lightRight).normalize();
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
  function groundChanged(next = {}) {
    if (next.edits) ctx.edits = next.edits; if (next.deposits) ctx.deposits = next.deposits; if (next.trees) ctx.trees = next.trees;
    const staticSig = JSON.stringify([ctx.deposits, ctx.trees]), sig = staticSig + JSON.stringify(ctx.edits);
    if (sig === signature && !next.force) return false; signature = sig;
    const t0 = performance.now();
    if (staticSig === staticSignature && !next.force) { bakeDisturbedChannel(ctx.edits, cfg.mask, GROUND_HALF, maskData); lastBakeKind = 'edits'; }
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
    adoptLegacyMaps();
    if (viewCamera) {
      viewCamera.getWorldPosition(camPos); viewCamera.getWorldDirection(camDir);
      sky.position.copy(camPos);
      const above = Math.max(0, camPos.y - height(camPos.x, camPos.z)), rts = above > 10;
      // Higher views see further: push haze back so the RTS board stays legible; FPS keeps depth haze.
      fog.near = rts ? 75 : 50; fog.far = rts ? 175 : 135;
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
      addedDrawCalls: 3 + (puffs.live() ? 1 : 0), addedTriangles: {sky: tris(sky), skirt: tris(skirt.mesh), backdrop: tris(backdrop)}, shadowMapSize: sun.castShadow ? sun.shadow.mapSize.x : 0, shadowExtent, pendingTextures: pending, puffs: puffs.live()};
  }
  function dispose() {
    if (disposed) return; disposed = true;
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
  return {update, groundChanged, contact, surfaceAt: (x, z) => classifySurface(x, z, height, ctx), setDaylight, enableShadowCasting, stats, dispose, material, objects: {sky, skirt: skirt.mesh, backdrop, puffs: puffs.mesh}};
}
