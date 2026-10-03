// Focused patch for the orchard ground material (orchard-presentation.js is NOT replaced).
// Chains the existing onBeforeCompile and edits the albedo just before `diffuseColor.rgb *= oAlbedo;`:
//   inner foot (s ~ 45..48): grass thins into moss and soil scree,
//   impassable slope: grass is fully removed; strata rock keyed to exact world Y, so the hard edge reads as rock,
//   high up-facing ground (crest / skirt): broken snow line.
// Inside s < 45 the meadow is untouched. Pure function of world position + mesh normal => deterministic, and follows
// whatever authoritative heights the root writes into the ground mesh. No uniforms, textures, draws or lights added.
import {MOUNTAIN_ROCK_GLSL} from './mountain-arena.js';

export const MOUNTAIN_GROUND_ANCHOR = 'diffuseColor.rgb *= oAlbedo;';
const GROUND_GLSL = /* glsl */`
{
  float mS = max(abs(vOrchardWorld.x), abs(vOrchardWorld.z));
  float mJit = (orchardNoise(oXZ * 0.37 + 5.0) - 0.5) * 1.6 + (orchardNoise(oXZ * 1.9) - 0.5) * 0.5;
  float mFoot = smoothstep(44.8, 47.2, mS + mJit);           // moss/soil band begins
  float mBare = smoothstep(46.6, 48.6, mS + mJit);           // no grass beyond: rock, scree, snow
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
    material.userData.mountainTreatment.patched = f.includes(MOUNTAIN_GROUND_ANCHOR) && f.includes('vOrchardWorld');
    if (!material.userData.mountainTreatment.patched) return; // orchard patch absent: leave the stock program intact
    shader.fragmentShader = f.replace('#include <common>', '#include <common>\n' + MOUNTAIN_ROCK_GLSL)
      .replace(MOUNTAIN_GROUND_ANCHOR, GROUND_GLSL + MOUNTAIN_GROUND_ANCHOR);
  };
  material.customProgramCacheKey = () => `${previousKey ? previousKey() : ''}|mountain-ground-v2`;
  material.userData.mountainTreatment = {patched: null};
  material.needsUpdate = true;
  return material;
}
