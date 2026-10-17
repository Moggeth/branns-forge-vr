// Core kit ground: one material for every generated landscape. Seven painted layers (lush grass, meadow, forest floor,
// soil, sand, rock, snow; scripts/kit/ground_textures.py) blended per pixel by their own relief, so grass gives way to
// soil between the clumps and snow settles in the hollows first instead of fading like a crossfade.
// - Layer weights come from the mesh (biome, forest, shore, roads: attributes kitA/kitB); rock and snow are decided per
//   pixel from the surface normal and height, so cliffs and snowlines stay crisp on every level of detail.
// - Rock is projected three ways (no stretched smears on cliffs); every other layer is sampled twice, at two scales and
//   angles mixed by a slow noise, so no tile repeats in a visible grid.
// - Geomorph: a level's vertices slide onto the next coarser level's surface as they near its edge (attribute `morph`
//   = coarse height and normal). Detail changes continuously with distance; nothing pops when the levels rebuild.
// Before the textures arrive (and on the cheapest path) each layer draws as its mean colour, so the land looks the same
// at a distance whether or not the detail has loaded.
import * as THREE from 'three';
import {loadDeliveredTexture} from '../texture-delivery.js';

export const KIT_LAYERS = Object.freeze(['lush', 'meadow', 'forest', 'soil', 'sand', 'rock', 'snow']);
const SIZE = 512, NSIZE = 256;
// Linear mean colour of each painted layer (kept in step with the texture script) and a gain that sets the final look.
const MEAN = [[.083, .218, .029], [.277, .305, .075], [.188, .137, .031], [.252, .122, .045], [.618, .485, .245], [.21, .197, .171], [.751, .811, .881]];
const GAIN = [[2.1, 1.85, 2.0], [1, 1.12, .95], [1.1, 1.1, 1.1], [1, 1, 1], [.92, .92, .92], [1.12, 1.12, 1.12], [.88, .9, .93]];
const ROUGH = [.92, .93, .9, .95, .97, .85, .6];
// Metres per texture repeat.
const SCALE = [3.2, 3.6, 4.2, 3, 5.5, 7, 6];

let shared = null;
/** The two texture arrays, loaded once and shared by every ground material. */
function kitTextures(assetBase) {
  if (shared) return shared;
  const make = (size, srgb) => {
    const t = new THREE.DataArrayTexture(new Uint8Array(4 * 4), 1, 1, 1);
    t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true; t.anisotropy = 8; t.userData.size = size; return t;
  };
  shared = {albedo: make(SIZE, true), normal: make(NSIZE, false), ready: {value: 0}, loaded: 0};
  if (typeof document === 'undefined') return shared;
  const loader = new THREE.ImageLoader();
  for (const [name, tex] of [['kit_ground_albedo', shared.albedo], ['kit_ground_normal', shared.normal]]) {
    loadDeliveredTexture(loader, `${assetBase}${name}.png`, image => {
      try {
        const w = image.width, h = image.height, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d', {willReadFrequently: true}); ctx.drawImage(image, 0, 0);
        const data = new Uint8Array(ctx.getImageData(0, 0, w, h).data.buffer);
        // The strip stacks the layers top to bottom: exactly the array's layer-major layout.
        tex.image = {data, width: w, height: w, depth: Math.round(h / w)}; tex.needsUpdate = true;
        if (++shared.loaded === 2) shared.ready.value = 1;
      } catch {}
    }, undefined, () => {});
  }
  return shared;
}

/**
 * A ground material. Each terrain level gets its own (they share one shader program) so its morph band can differ.
 * focus: shared {value: Vector2} — the point the levels are centred on (morph distance is measured from it).
 * morph: [start, end] metres (Chebyshev) over which this level slides onto its coarser neighbour; null for none.
 * ring: {value: Vector3(cx, cz, half)} — this level's built extent, so its rim always meets the coarser level exactly.
 */
export function createGroundMaterial({assetBase = '/assets/', focus, morph = null, ring, snow, quality = 'high'}) {
  const tex = kitTextures(assetBase);
  const uniforms = {
    kitAlbedo: {value: tex.albedo}, kitNormal: {value: tex.normal}, kitReady: tex.ready,
    kitMean: {value: MEAN.map((m, k) => new THREE.Vector3(m[0] * GAIN[k][0], m[1] * GAIN[k][1], m[2] * GAIN[k][2]))},
    kitGain: {value: GAIN.map(g => new THREE.Vector3(...g))},
    kitFocus: focus, kitRing: ring, kitMorph: {value: new THREE.Vector2(...(morph || [1e9, 2e9]))},
    kitSnow: snow,
  };
  const material = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .92, metalness: 0});
  const low = quality === 'low';
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 kitA; attribute vec4 kitB; attribute vec3 morph;
        uniform vec2 kitFocus; uniform vec3 kitRing; uniform vec2 kitMorph;
        varying vec4 vKitA; varying vec4 vKitB; varying vec3 vKitPos; varying vec3 vKitN;`)
      .replace('#include <beginnormal_vertex>', `
        vec2 kitD = abs(position.xz - kitFocus), kitE = abs(position.xz - kitRing.xy);
        float kitK = max(smoothstep(kitMorph.x, kitMorph.y, max(kitD.x, kitD.y)), smoothstep(kitRing.z - 2.5, kitRing.z - .25, max(kitE.x, kitE.y)));
        kitK *= step(kitMorph.x, 1e8);
        vec3 objectNormal = normalize(mix(normal, normalize(vec3(morph.y, 1.0, morph.z)), kitK));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.y = mix(position.y, morph.x, kitK);
        vKitA = kitA; vKitB = kitB; vKitN = objectNormal; vKitPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        precision highp sampler2DArray;
        uniform sampler2DArray kitAlbedo, kitNormal; uniform float kitReady; uniform vec3 kitMean[7]; uniform vec3 kitGain[7];
        uniform vec2 kitSnow;
        varying vec4 vKitA; varying vec4 vKitB; varying vec3 vKitPos; varying vec3 vKitN;
        const float KIT_SCALE[7] = float[7](${SCALE.map(s => (1 / s).toFixed(5)).join(', ')});
        const float KIT_ROUGH[7] = float[7](${ROUGH.map(r => r.toFixed(3)).join(', ')});
        float kitHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float kitNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(kitHash(i), kitHash(i + vec2(1, 0)), f.x), mix(kitHash(i + vec2(0, 1)), kitHash(i + vec2(1, 1)), f.x), f.y); }
        // Two samples per layer, at two scales and angles, mixed by a slow noise: the repeat never lines up.
        vec4 kitPair(sampler2DArray t, vec2 uv, float layer, float mixT, float both) {
          vec4 a = texture(t, vec3(uv, layer));
          if (both < .5) return a;
          vec2 r = mat2(.788, -.616, .616, .788) * uv * .43 + .31;
          return mix(a, texture(t, vec3(r, layer)), mixT);
        }`)
      .replace('#include <color_fragment>', `
        vec3 kitN = normalize(vKitN);
        float kitDist = length(vKitPos - cameraPosition);
        float kitNear = 1.0 - smoothstep(90.0, 160.0, kitDist);      // relief normals and the second sample fade out here
        float kitMacro = kitNoise(vKitPos.xz * .021) * .65 + kitNoise(vKitPos.xz * .093) * .35;
        float w[7];
        w[0] = vKitA.x; w[1] = vKitA.y; w[2] = vKitA.z; w[3] = vKitA.w; w[4] = vKitB.x;
        // Rock where the land is steep (wobbled so the edge is not a contour line); snow above the line, on the level.
        // A breakup noise at gully scale shifts both edges, so rock and snow interleave in streaks, not round patches.
        float kitBrk = (kitNoise(vKitPos.xz * .055) * .6 + kitNoise(vKitPos.xz * .19) * .4 - .5) * .26;
        float kitRock = smoothstep(.76 + kitBrk, .57 + kitBrk, kitN.y) * (1.0 - vKitB.x * .8);
        float kitSnowW = max(vKitB.z, smoothstep(kitSnow.x, kitSnow.y, vKitPos.y + (kitMacro - .5) * 40.0)) * smoothstep(.47 + kitBrk, .66 + kitBrk, kitN.y);
        w[5] = max(kitRock, vKitB.w); w[6] = kitSnowW;
        for (int k = 0; k < 5; k++) w[k] *= (1.0 - w[5]) * (1.0 - w[6]);
        w[5] *= 1.0 - w[6];
        vec3 kitAlb = vec3(0.0), kitNrm = vec3(0.0); float kitR = 0.0;
        if (kitReady < .5) {
          float sum = 0.0; for (int k = 0; k < 7; k++) { kitAlb += kitMean[k] * w[k]; kitR += KIT_ROUGH[k] * w[k]; sum += w[k]; }
          kitAlb /= max(sum, 1e-3); kitR /= max(sum, 1e-3);
        } else {
          // Height blend: each layer's relief competes, so the transitions follow grass clumps, stones and drifts.
          vec4 nrm[7]; float h[7], hMax = -1.0;
          vec3 tri = pow(abs(kitN), vec3(4.0)); tri /= tri.x + tri.y + tri.z;
          float both = ${low ? '0.0' : 'step(.001, kitNear)'}, mixT = smoothstep(.25, .75, kitMacro);
          for (int k = 0; k < 7; k++) {
            h[k] = -1.0; nrm[k] = vec4(.5, .5, .5, 0.0);
            if (w[k] < .004) continue;
            if (k == 5) {
              vec4 top = texture(kitNormal, vec3(vKitPos.xz * KIT_SCALE[5], 5.0));
              vec4 sx = texture(kitNormal, vec3(vec2(vKitPos.z, vKitPos.y * .35) * KIT_SCALE[5], 5.0));
              vec4 sz = texture(kitNormal, vec3(vec2(vKitPos.x, vKitPos.y * .35) * KIT_SCALE[5], 5.0));
              nrm[k] = top * tri.y + sx * tri.x + sz * tri.z;
            } else nrm[k] = kitPair(kitNormal, vKitPos.xz * KIT_SCALE[k], float(k), mixT, both);
            h[k] = nrm[k].b * .55 + w[k]; hMax = max(hMax, h[k]);
          }
          float sum = 0.0;
          for (int k = 0; k < 7; k++) {
            float b = max(h[k] - hMax + .22, 0.0); if (b <= 0.0) continue;
            vec3 a;
            if (k == 5) {
              a = texture(kitAlbedo, vec3(vKitPos.xz * KIT_SCALE[5], 5.0)).rgb * tri.y
                + texture(kitAlbedo, vec3(vec2(vKitPos.z, vKitPos.y * .35) * KIT_SCALE[5], 5.0)).rgb * tri.x
                + texture(kitAlbedo, vec3(vec2(vKitPos.x, vKitPos.y * .35) * KIT_SCALE[5], 5.0)).rgb * tri.z;
            } else a = kitPair(kitAlbedo, vKitPos.xz * KIT_SCALE[k], float(k), mixT, both).rgb;
            kitAlb += a * kitGain[k] * b; kitR += KIT_ROUGH[k] * b;
            vec2 t = (nrm[k].rg * 2.0 - 1.0);
            kitNrm += (k == 5 ? vec3(t.x * (tri.y + tri.z), 0.0, -t.y * (tri.y + tri.x)) : vec3(t.x, 0.0, -t.y)) * b;
            sum += b;
          }
          kitAlb /= max(sum, 1e-4); kitR /= max(sum, 1e-4); kitNrm /= max(sum, 1e-4);
          kitN = normalize(kitN + kitNrm * kitNear * ${low ? '.0' : '1.0'});
        }
        // Slow variation across the land, then the biome tint and wet ground (darker, glossier).
        kitAlb *= .9 + kitMacro * .2;
        kitAlb *= vColor.rgb;
        kitAlb *= 1.0 - vKitB.y * .38; kitR = mix(kitR, .45, vKitB.y * .7);
        diffuseColor.rgb *= kitAlb;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = kitR;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(kitN, 0.0)).xyz);');
  };
  material.customProgramCacheKey = () => 'kit-ground-v1-' + quality;
  return material;
}
