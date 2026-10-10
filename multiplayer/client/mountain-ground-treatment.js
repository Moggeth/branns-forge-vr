// Focused patch for the orchard ground material (orchard-presentation.js is NOT replaced).
// Chains the existing onBeforeCompile and edits the albedo just before `diffuseColor.rgb *= oAlbedo;`:
//   meadow (v3, s < 45): broad luminance-neutral hue drift (cool spring green <-> warm sun meadow), a straw fringe
//     where turf meets bare soil, soft drifting sun-flecks under orchard canopies, and distant wildflower drifts that
//     continue the instanced flowers past the meadow-cover radius as colour only,
//   inner foot (s ~ 45..48): grass thins into moss and soil scree,
//   impassable slope: grass is fully removed; strata rock keyed to exact world Y, so the hard edge reads as rock,
//   high up-facing ground (crest / skirt): broken snow line.
// Pure function of world position + mesh normal (+ an optional presentation-only light uniform) => deterministic,
// and follows whatever authoritative heights the root writes into the ground mesh. No textures, draws or lights added.
// Every new term only scales/mixes the existing albedo (linear space, before lighting, fog and tone mapping), with
// factors bounded to roughly 0.8..1.25, so exposure and the post chain see the same range as before.
import * as THREE from 'three';
import {MOUNTAIN_ROCK_GLSL} from './mountain-arena.js';

export const MOUNTAIN_GROUND_ANCHOR = 'diffuseColor.rgb *= oAlbedo;';

// Presentation-only canopy light: x = seconds (any monotonic clock), y = dapple strength 0..1 (daylight), zw unused.
// Shared by every patched program; the defaults give a gentle static dapple if nobody ever calls the setter.
export const MOUNTAIN_GROUND_LIGHT = {value: new THREE.Vector4(0, .45, 0, 0)};
export function setMountainGroundLight({time, strength} = {}) {
  const v = MOUNTAIN_GROUND_LIGHT.value;
  if (Number.isFinite(time)) v.x = time % 3600; // keep float precision in the shader
  if (Number.isFinite(strength)) v.y = Math.min(1, Math.max(0, strength));
  return v;
}

const GROUND_PARS = /* glsl */`
uniform vec4 mtnDapple;
`;
const GROUND_GLSL = /* glsl */`
{
  float mS = max(abs(vOrchardWorld.x), abs(vOrchardWorld.z));
  float mJit = (orchardNoise(oXZ * 0.37 + 5.0) - 0.5) * 1.6 + (orchardNoise(oXZ * 1.9) - 0.5) * 0.5;
  float mFoot = smoothstep(44.8, 47.2, mS + mJit);           // moss/soil band begins
  float mBare = smoothstep(46.6, 48.6, mS + mJit);           // no grass beyond: rock, scree, snow
  // ---- v3 meadow richness (only where turf still shows) ----
  float mTurf = clamp(1.0 - oBare, 0.0, 1.0) * (1.0 - mFoot);
  if (mTurf > 0.001) {
    // Hue drift at ~30-60 m, rotated off the texture axes so it never lines up with the grass tile. The two grades
    // are near luminance-neutral (Rec.709 weights ~0.98 / ~1.04) so the meadow shifts colour, not brightness.
    vec2 mQ = mat2(0.6, -0.8, 0.8, 0.6) * oXZ;
    float mHue = smoothstep(0.2, 0.8, orchardNoise(mQ * 0.024 + 11.0) * 0.7 + orchardNoise(mQ * 0.061 - 4.0) * 0.3);
    vec3 mGrade = mix(vec3(0.88, 1.0, 1.13), vec3(1.13, 1.04, 0.80), mHue);
    oAlbedo *= mix(vec3(1.0), mGrade, mTurf);
    // Straw fringe: turf yellows and shortens where it gives way to bare soil (both orchard paths and wear rings).
    float mEdge = oSoilW * (1.0 - oSoilW) * 4.0 * (1.0 - oStoneW) * (1.0 - clamp(oFaceW + oFloorW, 0.0, 1.0));
    oAlbedo = mix(oAlbedo, vec3(0.19, 0.15, 0.055) * (0.85 + 0.3 * oMacro), mEdge * 0.38);
    // Sun-flecks under the orchard canopies (mask alpha): soft round spots that wobble with the leaves instead of
    // sliding, brightening only the sunlit pools. Value noise => no tiling; thresholds keep the spots sparse.
    float mCanopy = oMask.a * mTurf;
    if (mCanopy > 0.01 && mtnDapple.y > 0.001) {
      vec2 mSway = vec2(sin(mtnDapple.x * 0.23), cos(mtnDapple.x * 0.17)) * 0.35 + vec2(sin(mtnDapple.x * 0.9 + oXZ.y * 0.4), cos(mtnDapple.x * 0.7 + oXZ.x * 0.4)) * 0.06;
      float mFleck = orchardNoise(mQ * 1.45 + mSway) * 0.62 + orchardNoise(oXZ * 3.3 - mSway * 1.6 + 7.0) * 0.38;
      float mSpot = smoothstep(0.56, 0.74, mFleck);
      oAlbedo *= 1.0 + mSpot * mCanopy * mtnDapple.y * vec3(0.5, 0.44, 0.26);   // warm-cream light, not gold bars
      oAlbedo *= 1.0 - (1.0 - mSpot) * mCanopy * mtnDapple.y * 0.08;            // the shade between flecks deepens a touch
    }
#ifdef ORCHARD_DETAIL
#if ORCHARD_DETAIL > 1
    // Distant wildflower drifts (same drift scale as meadow-cover's flower placement): a warm cream-and-butter
    // speckle that only fades in where the instanced flowers have already faded out.
    float mFar = smoothstep(14.0, 26.0, oDist) * (1.0 - smoothstep(70.0, 110.0, oDist));
    if (mFar > 0.001) {
      float mDrift = smoothstep(0.5, 0.74, orchardNoise(oXZ * 0.085 + vec2(40.0, -17.0)));
      float mBloom = smoothstep(0.45, 0.8, orchardNoise(oXZ * 0.9 + 23.0));
      oAlbedo = mix(oAlbedo, vec3(0.34, 0.29, 0.13), mFar * mDrift * mBloom * mTurf * (1.0 - oDry * 0.6) * 0.22);
    }
#endif
#endif
  }
  float mSteep = smoothstep(0.12, 0.32, oSlope + (oStoneN.b - 0.5) * 0.1);
  vec3 mMoss = mix(vec3(0.055, 0.085, 0.022), vec3(0.11, 0.12, 0.04), orchardNoise(oXZ * 0.8));
  vec3 mScree = mix(oSoil * vec3(0.62, 0.58, 0.55), oStone * 0.8, smoothstep(0.35, 0.7, oStoneN.b));
  vec3 mRock = mountainRock(vOrchardWorld, oN, vec3(1.0));
  vec3 mFootCol = mix(mMoss, mScree, smoothstep(0.3, 0.75, orchardNoise(oXZ * 1.2 + 3.0) + mSteep * 0.4));
  oAlbedo = mix(oAlbedo, mFootCol, mFoot * (1.0 - mBare) * 0.85);
  oAlbedo = mix(oAlbedo, mix(mScree, mRock, max(mSteep, smoothstep(6.0, 10.0, vOrchardWorld.y))), mBare);
}
`;

export function applyMountainGroundTreatment(material) {
  if (!material || material.userData.mountainTreatment) return material;
  const previous = material.onBeforeCompile, previousKey = material.customProgramCacheKey?.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    const f = shader.fragmentShader;
    // v3 reads orchard locals declared above the anchor (oBare, oSoilW, oStoneW, oFaceW, oFloorW, oMask, oMacro,
    // oDry, oDist); require the ones most likely to be renamed so a future orchard edit falls back to the stock look.
    material.userData.mountainTreatment.patched = f.includes(MOUNTAIN_GROUND_ANCHOR) && f.includes('vOrchardWorld') && f.includes('float oBare') && f.includes('oFaceW');
    if (!material.userData.mountainTreatment.patched) return; // orchard patch absent: leave the stock program intact
    shader.uniforms.mtnDapple = MOUNTAIN_GROUND_LIGHT;
    shader.fragmentShader = f.replace('#include <common>', '#include <common>\n' + GROUND_PARS + MOUNTAIN_ROCK_GLSL)
      .replace(MOUNTAIN_GROUND_ANCHOR, GROUND_GLSL + MOUNTAIN_GROUND_ANCHOR);
  };
  material.customProgramCacheKey = () => `${previousKey ? previousKey() : ''}|mountain-ground-v3`;
  material.userData.mountainTreatment = {patched: null};
  material.needsUpdate = true;
  return material;
}
