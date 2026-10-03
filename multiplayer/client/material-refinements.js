// Material-only refinements (Opus 2026-10-03). No geometry, positions, instancing, damage or budget changes.
// - applyCrystalMaterial(material, kind): kind 'core' | 'pale' | 'rock' for crystal-wall.js `mats`. Call once at creation,
//   before first render. Chains any existing onBeforeCompile and extends customProgramCacheKey (never replaces it).
//   Opaque, no extra lights/textures/uniforms. Pattern space = the crystal's own mesh position multiplied by its
//   model*instance scale, so facets/veins stay locked to each crystal (InstancedMesh batches and the loose debris
//   Meshes produce identical patterns); depth/shadow programs are untouched.
// - MOUNTAIN_ROCK_GLSL: drop-in replacement for mountain-arena.js (same mountainRock(vec3 w, vec3 n, vec3 tint) signature,
//   all helpers prefixed `mtn`, so it remains collision-free when mountain-ground-treatment.js injects it beside orchard*).
export const MATERIAL_REFINEMENTS_VERSION = 2;

// Per-kind constants (linear-space).
const CRYSTAL_KINDS = {
  // deep sapphire heart crystals: 5-sided shape (crystal-wall shape 1)
  core: {sides: 5, color: 0x123a8c, emissive: 0x1a6cff, emissiveIntensity: .55, roughness: .22, metalness: 0,
    deep: [.020, .045, .16], body: [.07, .20, .52], glow: [.10, .55, 1.0]},
  // teal-blue outer shards: 6-sided shapes (crystal-wall shapes 0 and 2)
  pale: {sides: 6, color: 0x1f6f9a, emissive: 0x0f8fb8, emissiveIntensity: .38, roughness: .28, metalness: 0,
    deep: [.015, .07, .12], body: [.08, .34, .46], glow: [.12, .80, .95]},
};

const CRYSTAL_COMMON = /* glsl */`
varying vec3 vCrysLocal;
varying vec3 vCrysMetric;
float crysHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float crysNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(crysHash(i), crysHash(i + vec3(1, 0, 0)), f.x), mix(crysHash(i + vec3(0, 1, 0)), crysHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(crysHash(i + vec3(0, 0, 1)), crysHash(i + vec3(1, 0, 1)), f.x), mix(crysHash(i + vec3(0, 1, 1)), crysHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

const CRYSTAL_VERTEX = /* glsl */`
{
  vec3 crysScale = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
#ifdef USE_INSTANCING
  crysScale *= vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
#endif
  vCrysLocal = position;
  vCrysMetric = position * crysScale;
}
`;

function crystalFragment(k) {
  const v = a => `vec3(${a.map(x => x.toFixed(3)).join(', ')})`;
  return /* glsl */`
{
  // Facet edges: unit crystal vertices sit at angle k/sides*2pi; d = 0 on a vertical prism edge.
  float cA = atan(vCrysLocal.z, vCrysLocal.x) * ${(k.sides / (2 * Math.PI)).toFixed(6)};
  float cD = abs(fract(cA + 0.5) - 0.5);
  float cR = length(vCrysLocal.xz);
  float cEdge = (1.0 - smoothstep(0.015, 0.09, cD)) * smoothstep(0.35, 0.7, cR);
  float cY = clamp(vCrysLocal.y, 0.0, 1.0);
  // Internal veins / inclusions: thin iso-lines of 3D noise in metric space (stable per crystal, ~10-25 cm features).
  vec3 cP = vCrysMetric * vec3(5.0, 1.7, 5.0);
  float cN1 = crysNoise(cP), cN2 = crysNoise(cP * 2.3 + 11.7);
  float cVein = 1.0 - smoothstep(0.0, 0.045, abs(cN1 - 0.5));
  float cHair = (1.0 - smoothstep(0.0, 0.03, abs(cN2 - 0.5))) * 0.6;
  // Growth striations across the c-axis (quartz-like), faint.
  float cStri = 0.5 + 0.5 * sin(vCrysMetric.y * 38.0 + cN1 * 4.0);
  // View-dependent depth: facing view = looking into the luminous core; grazing = dark refracted rim.
  vec3 cV = normalize(vViewPosition);
  float cFace = clamp(dot(normal, cV), 0.0, 1.0);
  float cRim = pow(1.0 - cFace, 2.0);
  float cCloud = smoothstep(0.25, 0.85, crysNoise(cP * 0.45 + 3.1));
  vec3 cAlb = mix(${v(k.deep)}, ${v(k.body)}, 0.35 + 0.45 * cCloud * cFace);
  cAlb *= 0.92 + 0.08 * cStri;
  cAlb = mix(cAlb, ${v(k.deep)} * 0.45, max(cEdge * 0.85, cVein * 0.7));
  cAlb = mix(cAlb, ${v(k.deep)} * 0.7, smoothstep(0.25, 0.0, cY) * 0.6);   // rooted base darkens into the rock
  cAlb = mix(cAlb, ${v(k.deep)} * 0.6, cRim * 0.55);
  diffuseColor.rgb = cAlb;
  // Polished facets, slightly duller on veins/edges (chipped) and at the root.
  roughnessFactor = clamp(roughnessFactor + 0.18 * cVein + 0.14 * cEdge + 0.2 * smoothstep(0.2, 0.0, cY) - 0.05 * cStri, 0.06, 0.6);
  // Subtle luminous core: strongest seen face-on in the upper body, killed on edges/veins, faint hairline sparks.
  float cCore = cFace * cFace * (0.35 + 0.65 * cCloud) * smoothstep(0.05, 0.45, cY) * (1.0 - 0.55 * smoothstep(0.75, 1.0, cY));
  float cLum = cCore * (1.0 - 0.8 * max(cEdge, cVein)) + cHair * 0.35 * cFace;
  totalEmissiveRadiance = totalEmissiveRadiance * cLum + ${v(k.glow)} * cHair * 0.06;
}
`;
}

const ROCK_FRAGMENT = /* glsl */`
{
  // Host rock: dark slate with sparse resonant flecks, no glow.
  float rN = crysNoise(vCrysMetric * 9.0);
  diffuseColor.rgb *= 0.8 + 0.35 * crysNoise(vCrysMetric * 2.2);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.22, 0.32), smoothstep(0.86, 0.93, rN) * 0.8);
  roughnessFactor = mix(roughnessFactor, 0.35, smoothstep(0.86, 0.93, rN));
}
`;

export function applyCrystalMaterial(material, kind = 'pale') {
  if (!material || material.userData.crystalRefinement) return material;
  const k = CRYSTAL_KINDS[kind];
  if (k) {
    material.color.setHex(k.color); material.emissive.setHex(k.emissive);
    material.emissiveIntensity = k.emissiveIntensity; material.roughness = k.roughness; material.metalness = k.metalness;
  } else if (kind === 'rock') {
    material.color.setHex(0x34333b); material.roughness = .9; material.metalness = 0;
  } else return material;
  material.transparent = false; material.envMapIntensity = .8; // opaque, restrained reflections
  const fragment = k ? crystalFragment(k) : ROCK_FRAGMENT;
  // Chain only an own (custom) key: three's prototype default returns onBeforeCompile.toString().
  const previous = material.onBeforeCompile,
    previousKey = Object.hasOwn(material, 'customProgramCacheKey') ? material.customProgramCacheKey.bind(material) : null;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    const vs = shader.vertexShader, fs = shader.fragmentShader;
    const ok = vs.includes('#include <begin_vertex>') && fs.includes('#include <emissivemap_fragment>');
    material.userData.crystalRefinement.patched = ok;
    if (!ok) return;
    shader.vertexShader = vs.replace('#include <common>', '#include <common>\nvarying vec3 vCrysLocal;\nvarying vec3 vCrysMetric;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + CRYSTAL_VERTEX);
    // Inject after emissivemap: normal (normal_fragment_*), roughnessFactor and totalEmissiveRadiance all exist,
    // and diffuseColor/roughnessFactor are only consumed afterwards by lights_physical_fragment.
    shader.fragmentShader = fs.replace('#include <common>', '#include <common>\n' + CRYSTAL_COMMON)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + fragment);
  };
  material.customProgramCacheKey = () => `${previousKey ? previousKey() : ''}|crystal-${kind}-v${MATERIAL_REFINEMENTS_VERSION}`;
  material.userData.crystalRefinement = {kind, patched: null};
  material.needsUpdate = true;
  return material;
}

// Replacement for mountain-arena.js MOUNTAIN_ROCK_GLSL. Same entry point; linear-space colours.
// Low-contrast dipping beds (+-7 %), large-scale rock bodies (cool granite grey vs warm weathered sandstone), jointed
// blocks, vertical clefts and dark seep streaks on steep faces, pale dust on ledges, moss/lichen at the foot and in low
// clefts, and a high, slope-limited broken snow line (only summit ledges). Cost: ~11 value-noise taps.
export const MOUNTAIN_ROCK_GLSL = /* glsl */`
float mtnHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float mtnNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mtnHash(i), mtnHash(i + vec2(1, 0)), f.x), mix(mtnHash(i + vec2(0, 1)), mtnHash(i + vec2(1, 1)), f.x), f.y); }
vec3 mountainRock(vec3 w, vec3 n, vec3 tint) {
  float mSteepR = 1.0 - smoothstep(0.45, 0.85, n.y);           // 1 on cliff faces, 0 on ledges
  float mAlong = w.x - w.z;                                     // runs along every face of the square ring
  float mBody = 0.6 * mtnNoise(w.xz * 0.035 + w.y * 0.015) + 0.4 * mtnNoise(w.xz * 0.11 + 4.3);
  float mWarp = 0.8 * mtnNoise(w.xz * 0.07) + 0.45 * mtnNoise(vec2(mAlong, w.y) * 0.3);
  float mBed = fract((w.y + 0.14 * w.x - 0.09 * w.z) / 4.6 + mWarp);
  float mBeds = smoothstep(0.0, 0.3, mBed) * smoothstep(1.0, 0.7, mBed);
  vec3 rock = mix(vec3(0.105, 0.11, 0.118), vec3(0.2, 0.185, 0.165), smoothstep(0.38, 0.72, mBody)); // alpine: cool granite vs weathered gneiss
  rock = mix(rock, vec3(0.24, 0.16, 0.11), smoothstep(0.7, 0.85, mtnNoise(w.xz * 0.06 + 9.1)) * 0.5); // iron-stained bodies
  rock *= 0.93 + 0.14 * mBeds;                                                  // beds now a hint, not a stripe
  float mBlock = mtnNoise(vec2(mAlong * 0.45, w.y * 0.8) + mWarp);              // jointed blocks
  rock *= 0.82 + 0.3 * mBlock;
  float mCl = abs(mtnNoise(vec2(mAlong * 0.42, w.y * 0.09) + mWarp * 0.6) - 0.5);
  float mCleft = (1.0 - smoothstep(0.0, 0.03, mCl)) * mSteepR;                 // vertical clefts
  float mSeep = smoothstep(0.58, 0.86, mtnNoise(vec2(mAlong * 0.9, w.y * 0.04 + 2.0))) * mSteepR; // dark seep streaks
  rock *= 1.0 - 0.25 * mSeep;
  rock = mix(rock, vec3(0.045, 0.045, 0.048), mCleft * 0.4);
  rock *= 0.9 + 0.2 * mtnNoise(w.xz * 3.1 + w.y * 1.7);                          // grain
  float mLedge = smoothstep(0.62, 0.9, n.y);
  rock = mix(rock, vec3(0.29, 0.27, 0.24), mLedge * 0.3 * (1.0 - mCleft));       // dust/scree on ledges
  // Moss at the foot (low, not too steep) and creeping up low clefts; grey-green lichen patches mid-face.
  float mFootN = mtnNoise(w.xz * 0.5);
  float moss = smoothstep(6.5, 2.0, w.y + mFootN * 3.0) * smoothstep(0.2, 0.6, n.y + 0.35 * mtnNoise(w.xz * 1.3));
  moss = max(moss, mCleft * smoothstep(9.0, 4.0, w.y) * 0.8);
  moss = max(moss, mLedge * smoothstep(16.0, 10.0, w.y) * smoothstep(0.5, 0.75, mtnNoise(w.xz * 0.4)) * 0.6);
  vec3 mossCol = mix(vec3(0.05, 0.08, 0.022), vec3(0.11, 0.13, 0.045), mtnNoise(w.xz * 2.3));
  rock = mix(rock, mossCol, clamp(moss, 0.0, 1.0) * 0.88);
  float mLichen = smoothstep(0.72, 0.9, mtnNoise(w.xz * 0.9 + w.y * 0.3)) * smoothstep(20.0, 8.0, w.y) * (1.0 - moss);
  rock = mix(rock, vec3(0.26, 0.27, 0.21), mLichen * 0.35);
  // Snow: high line, only on up-facing ledges, broken by noise; summits keep thin caps instead of a white blanket.
  // Alpine conifer belt: dark stippled forest on gentler low slopes, thinning with altitude into krummholz.
  float mForestN = mtnNoise(w.xz * 1.9 + w.y * 0.6), mForestM = mtnNoise(w.xz * 0.21 + 3.7);
  float mForest = smoothstep(27.0, 20.0, w.y + 4.0 * mForestM) * smoothstep(4.0, 7.0, w.y) * smoothstep(0.3, 0.55, n.y + 0.25 * mForestM);
  vec3 mPine = mix(vec3(0.02, 0.04, 0.024), vec3(0.04, 0.07, 0.035), smoothstep(0.35, 0.8, mForestN)) * (0.75 + 0.5 * n.y);
  rock = mix(rock, mPine, mForest * (0.75 + 0.25 * smoothstep(0.2, 0.45, mForestN)));
  float mLine = 28.0 + 2.4 * sin(w.x * 0.071) * cos(w.z * 0.053) + 3.0 * (mtnNoise(w.xz * 0.25) - 0.5);
  float mSnowN = mtnNoise(w.xz * 1.4 + w.y * 0.2);
  float snow = smoothstep(mLine - 0.6, mLine + 1.4, w.y) * smoothstep(0.5, 0.72, n.y + 0.25 * (mSnowN - 0.5));
  snow = max(snow, smoothstep(mLine + 4.0, mLine + 7.0, w.y) * smoothstep(0.22, 0.45, n.y) * 0.92);
  snow *= smoothstep(0.25, 0.45, mSnowN + 0.2);
  vec3 snowCol = mix(vec3(0.6, 0.66, 0.76), vec3(0.88, 0.9, 0.93), smoothstep(0.4, 0.95, n.y));
  return mix(rock * tint, snowCol * (0.85 + 0.15 * tint), clamp(snow, 0.0, 1.0));
}`;
