import * as THREE from 'three';

// Stonewhisper pick luminance (2026-10-03): the authored Resonance gems are the light source of the pick.
//
// - enhancePickTemplate(scene): once per loaded pick.glb. Patches the shared Resonance_Crystal, Brass_Trim and
//   Steel_Blued materials in place (no geometry, node, socket or bounds change) so every pick — remote heroes,
//   workers, holsters — gets faceted inner-glow gems, a cheap fake gem light on the nearby metal, worn brass and a
//   faint temper sheen on the blued head. Static: no per-frame uniforms, renders as the "ready" state.
// - createPickLuminance(owner, host, find): the HELD pick only (called from weapon-readiness.js). Gives that one
//   pick its own material copies and per-gem attributes so the gems drain when the special fires and re-ignite from
//   the heart crystals outward along both arms as the 4 s special recharges; the crown ignites last with a
//   flare. One additive billboard halo draw stands in for light; there are no real lights, post or extra passes.
//   Original materials/geometries are restored on dispose. Inputs are the simulation's readiness fractions.

export const PICK_GEM_KINDS = Object.freeze({heart: 0, arm: 1, crown: 2});

const GLOW = new THREE.Color(.07, .42, 1.0), DORMANT = new THREE.Color(.03, .05, .22), FLARE = new THREE.Color(.62, .86, 1.0);
const SPILL_POINTS = 7; // light sources in the metal spill: 2 hearts, crown, 2×2 arm groups
const clamp01 = x => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));

// ---------------------------------------------------------------- gem discovery
// Welded connected components of the authored gem meshes, in `space` coordinates. Each component is one crystal.
export function pickGemClusters(meshes, space) {
  const clusters = [], inv = new THREE.Matrix4().copy(space.matrixWorld).invert(), m = new THREE.Matrix4(), v = new THREE.Vector3();
  for (const mesh of meshes) {
    const geometry = mesh.geometry, pos = geometry.attributes.position, n = pos.count, index = geometry.index;
    m.multiplyMatrices(inv, mesh.matrixWorld);
    const parent = Int32Array.from({length: n}, (_, i) => i);
    const root = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
    const join = (a, b) => { a = root(a); b = root(b); if (a !== b) parent[a] = b; };
    const weld = new Map();
    for (let i = 0; i < n; i++) {
      const k = `${Math.round(pos.getX(i) * 4000)},${Math.round(pos.getY(i) * 4000)},${Math.round(pos.getZ(i) * 4000)}`;
      if (weld.has(k)) join(i, weld.get(k)); else weld.set(k, i);
    }
    if (index) for (let t = 0; t < index.count; t += 3) { join(index.getX(t), index.getX(t + 1)); join(index.getX(t), index.getX(t + 2)); }
    else for (let t = 0; t < n; t += 3) { join(t, t + 1); join(t, t + 2); }
    const groups = new Map();
    for (let i = 0; i < n; i++) { const r = root(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
    for (const vertices of groups.values()) {
      const box = new THREE.Box3();
      for (const i of vertices) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m));
      clusters.push({mesh, vertices, center: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3())});
    }
  }
  return clusters;
}

// Role and ignition threshold of each crystal from its place on the head. Hearts glow with the whole charge; arm
// shards light in order from the eye outward; the crown completes the charge. Works for any symmetric layout.
export function classifyPickGems(clusters) {
  if (!clusters.length) return [];
  const reach = Math.max(...clusters.map(c => Math.abs(c.center.x)), 1e-4);
  const top = Math.max(...clusters.map(c => c.center.y));
  return clusters.map((c, i) => {
    const across = Math.abs(c.center.x) / reach, volume = c.size.x * c.size.y * c.size.z;
    const kind = across < .2 && c.center.y > top - .03 ? PICK_GEM_KINDS.crown
      : across < .2 ? PICK_GEM_KINDS.heart : PICK_GEM_KINDS.arm;
    const threshold = kind === PICK_GEM_KINDS.heart ? 0 : kind === PICK_GEM_KINDS.crown ? 1 : .1 + .78 * Math.min(1, Math.max(0, (across - .3) / .7));
    // Deterministic per-crystal seed for facet twinkle phase.
    const seed = ((Math.sin(c.center.x * 127.1 + c.center.y * 311.7 + c.center.z * 74.7) * 43758.5453) % 1 + 1) % 1;
    return {...c, index: i, kind, threshold, seed, radius: Math.cbrt(Math.max(volume, 1e-9))};
  });
}

// Matches the GLSL `pickGemLit`: 0..1 brightness of one crystal for a charge fraction.
export function gemLit(kind, threshold, charge) {
  charge = clamp01(charge);
  const s = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  if (kind === PICK_GEM_KINDS.heart) return .14 + .86 * s(0, 1, charge);
  if (kind === PICK_GEM_KINDS.crown) return .05 + .95 * s(.985, 1, charge);
  return .06 + .94 * s(threshold, threshold + .06, charge);
}

// ---------------------------------------------------------------- shaders
const GEM_FUNCTIONS = /* glsl */`
float pickGemLit(vec3 gem, float charge) {
  if (gem.z < .5) return .14 + .86 * smoothstep(0., 1., charge);
  if (gem.z > 1.5) return .05 + .95 * smoothstep(.985, 1., charge);
  return .06 + .94 * smoothstep(gem.x, gem.x + .06, charge);
}
// Brief over-bright as the charge front passes a shard; zero once ready.
float pickGemIgnite(vec3 gem, float charge) {
  if (gem.z < .5 || gem.z > 1.5 || charge >= .999) return 0.;
  float since = charge - gem.x;
  return since < 0. ? 0. : exp(-since * 30.);
}
`;
const GEM_COMMON = /* glsl */`
uniform float uPickCharge, uPickFlare, uPickDrain, uPickTime, uPickMotion;
uniform vec3 uPickGlow, uPickDormant, uPickFlareColor;
varying vec3 vPickGem;
varying vec3 vPickPos;
varying vec3 vPickNormal;
${GEM_FUNCTIONS}`;

// Faceted crystal light: dark sapphire body, emissive core brighter where you look into the crystal, a cold rim, and
// per-facet glints that change with view direction (twinkle when swung) and, unless reduced, drift slowly in time.
const GEM_FRAGMENT = /* glsl */`
{
  vec3 pickV = normalize(vViewPosition);
  float pickNdv = clamp(abs(dot(normal, pickV)), 0., 1.);
  float pickRim = pow(1. - pickNdv, 2.5);
  float lit = pickGemLit(vPickGem, uPickCharge);
  float ignite = pickGemIgnite(vPickGem, uPickCharge);
  // Object-space face normal from derivatives: exactly one value per authored facet, stable as the pick moves.
  vec3 facet = normalize(cross(dFdx(vPickPos), dFdy(vPickPos)));
  float h = fract(abs(dot(facet, vec3(3.1, 7.7, 5.3))) * 2.3 + vPickGem.y * 7.1);
  float twinkle = pow(max(0., sin(h * 6.2832 + dot(pickV, vec3(7., 5., 9.)) * 2.4 + uPickTime * uPickMotion * (.6 + h))), 16.);
  vec3 core = mix(uPickDormant, uPickGlow, lit);
  float facetTone = .55 + .45 * fract(h * 7.31);   // neighbouring facets differ, so the cut reads
  // Slow light rising through the crystal (frozen when motion is reduced or on remote picks).
  float rise = pow(.5 + .5 * sin(vPickPos.y * 140. + dot(vPickPos.xz, vec2(60., 45.)) - uPickTime * uPickMotion * 1.4 + vPickGem.y * 6.3), 3.);
  totalEmissiveRadiance = core * (.2 + lit * (.36 * facetTone + .28 * pickNdv + .36 * pickRim + .2 * rise))
    + uPickFlareColor * (twinkle * .4 * lit * lit + ignite * .9 + uPickFlare * (.35 + .2 * lit) + uPickDrain * .6);
  diffuseColor.rgb *= mix(.55, 1., lit);
}
`;

// Fake gem light on the pick's own metal: inverse-square-ish falloff from SPILL_POINTS crystal groups, wrapped
// lambert around the object-space normal. Plus authored-feeling wear: brass gets low-frequency tarnish/polish
// variation; the blued head gets a faint violet-gold temper sheen at grazing angles.
const METAL_COMMON = /* glsl */`
uniform vec4 uPickSpill[${SPILL_POINTS}];
uniform vec3 uPickSpillColor;
uniform float uPickMetalKind;
varying vec3 vPickPos;
varying vec3 vPickNormal;
float pickHash(vec3 p) { p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float pickNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(pickHash(i), pickHash(i + vec3(1, 0, 0)), f.x), mix(pickHash(i + vec3(0, 1, 0)), pickHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(pickHash(i + vec3(0, 0, 1)), pickHash(i + vec3(1, 0, 1)), f.x), mix(pickHash(i + vec3(0, 1, 1)), pickHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;
const METAL_ROUGHNESS = /* glsl */`
{
  float wear = pickNoise(vPickPos * 38.) * .65 + pickNoise(vPickPos * 140.) * .35;
  if (uPickMetalKind < .5) roughnessFactor = clamp(roughnessFactor * (.72 + wear * .75), .12, 1.);
  else roughnessFactor = clamp(roughnessFactor * (.85 + wear * .3), .12, 1.);
}
`;
const METAL_FRAGMENT = /* glsl */`
{
  vec3 pickV = normalize(vViewPosition);
  float pickNdv = clamp(abs(dot(normal, pickV)), 0., 1.);
  vec3 n = normalize(vPickNormal);
  vec3 spill = vec3(0.);
  for (int i = 0; i < ${SPILL_POINTS}; i++) {
    vec3 d = uPickSpill[i].xyz - vPickPos; float r = length(d);
    float wrap = clamp(dot(n, d / max(r, 1e-4)) * .6 + .4, 0., 1.);
    float fall = 1. / (1. + r * r * 5200.);
    spill += uPickSpill[i].w * wrap * fall;
  }
  // Metal tints what it reflects: gold turns the blue spill teal instead of bleaching to silver.
  vec3 tint = uPickMetalKind < .5 ? diffuseColor.rgb * diffuseColor.rgb * .35 : vec3(.8);
  totalEmissiveRadiance += uPickSpillColor * min(spill, 1.2) * tint;
  if (uPickMetalKind > .5) {
    float graze = pow(1. - pickNdv, 3.);
    float band = pickNoise(vPickPos * 22.);
    totalEmissiveRadiance += mix(vec3(.10, .05, .16), vec3(.16, .11, .04), band) * graze * .5;
  } else {
    float tarnish = pickNoise(vPickPos * 26. + 3.1);
    diffuseColor.rgb *= mix(.82, 1.06, smoothstep(.2, .8, tarnish));
  }
}
`;

function patchVertex(vs, gemAttribute) {
  return vs.replace('#include <common>', `#include <common>\nvarying vec3 vPickPos;\nvarying vec3 vPickNormal;\nvarying vec3 vPickGem;\n${gemAttribute ? 'attribute vec3 pickGem;' : ''}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\nvPickPos = position;\nvPickNormal = objectNormal;\nvPickGem = ${gemAttribute ? 'pickGem' : 'vec3(0., .5, 0.)'};`);
}

// uniforms: plain {value} objects shared by reference so the owner can drive them without touching the program.
function gemMaterial(material, uniforms, gemAttribute) {
  material.emissive.setRGB(0, 0, 0); material.emissiveIntensity = 1;
  material.roughness = .16; material.envMapIntensity = 1.15;
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = patchVertex(shader.vertexShader, gemAttribute);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${GEM_COMMON}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${GEM_FRAGMENT}`);
  };
  material.customProgramCacheKey = () => `brann-pick-gem-v1-${gemAttribute ? 'live' : 'static'}`;
  material.needsUpdate = true;
  return material;
}
function metalMaterial(material, uniforms, kind) {
  const own = {...uniforms, uPickMetalKind: {value: kind}};
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, own);
    shader.vertexShader = patchVertex(shader.vertexShader, false);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${METAL_COMMON}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${METAL_ROUGHNESS}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${METAL_FRAGMENT}`);
  };
  material.customProgramCacheKey = () => `brann-pick-metal-v1-${kind}`;
  material.needsUpdate = true;
  return material;
}

function gemUniforms() {
  return {uPickCharge: {value: 1}, uPickFlare: {value: 0}, uPickDrain: {value: 0}, uPickTime: {value: 0}, uPickMotion: {value: 0},
    uPickGlow: {value: GLOW.clone()}, uPickDormant: {value: DORMANT.clone()}, uPickFlareColor: {value: FLARE.clone()}};
}
function spillUniforms() {
  return {uPickSpill: {value: Array.from({length: SPILL_POINTS}, () => new THREE.Vector4())}, uPickSpillColor: {value: GLOW.clone()}};
}

// Up to SPILL_POINTS light groups: each heart, the crown, and inner/outer halves of each arm.
function spillGroups(gems) {
  const groups = new Map();
  for (const g of gems) {
    const key = g.kind === PICK_GEM_KINDS.arm ? `arm${Math.sign(g.center.x)}${g.threshold < .5 ? 'in' : 'out'}`
      : g.kind === PICK_GEM_KINDS.heart ? `heart${Math.sign(g.center.z)}` : 'crown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(g);
  }
  return [...groups.values()].slice(0, SPILL_POINTS).map(list => {
    const center = new THREE.Vector3(); let weight = 0;
    for (const g of list) { center.addScaledVector(g.center, g.radius); weight += g.radius; }
    return {center: center.divideScalar(weight), gems: list, strength: Math.min(.5, weight * 9)};
  });
}
function writeSpill(uniform, groups, charge, flare) {
  uniform.value.forEach((v, i) => {
    const g = groups[i];
    if (!g) { v.set(0, 0, 0, 0); return; }
    const lit = g.gems.reduce((s, gem) => s + gemLit(gem.kind, gem.threshold, charge), 0) / g.gems.length;
    v.set(g.center.x, g.center.y, g.center.z, g.strength * lit * lit * (1 + flare * .8));
  });
}

const GEM_NAMES = ['ResonanceCrystal', 'Embellish_Crystal_Crown'];
const meshesByMaterial = (root, name) => { const out = []; root.traverse(o => { if (o.isMesh && o.material?.name === name) out.push(o); }); return out; };

/** Patch the shared pick template materials once. Safe to call repeatedly. */
export function enhancePickTemplate(scene) {
  if (!scene || scene.userData.pickLuminance) return false;
  scene.updateWorldMatrix(true, true);
  const gemMeshes = GEM_NAMES.map(n => scene.getObjectByName(n)).filter(o => o?.isMesh);
  const crystal = meshesByMaterial(scene, 'Resonance_Crystal')[0]?.material;
  if (!crystal || !gemMeshes.length) return false;
  const space = gemMeshes[0].parent || scene;
  const gems = classifyPickGems(pickGemClusters(gemMeshes, space));
  const spill = spillUniforms(); writeSpill(spill.uPickSpill, spillGroups(gems), 1, 0);
  gemMaterial(crystal, gemUniforms(), false);
  const brass = meshesByMaterial(scene, 'Brass_Trim')[0]?.material, steel = meshesByMaterial(scene, 'Steel_Blued')[0]?.material;
  if (brass) metalMaterial(brass, spill, 0);
  if (steel) metalMaterial(steel, spill, 1);
  scene.userData.pickLuminance = {gems: gems.length};
  return true;
}

// ---------------------------------------------------------------- held-pick halo
const HALO_VERTEX = /* glsl */`
attribute vec3 pickGem;
uniform float uPickCharge, uPickFlare, uPickDrain;
varying vec2 vUv;
varying float vGlow;
${GEM_FUNCTIONS}
void main() {
  vUv = uv * 2. - 1.;
  float lit = pickGemLit(pickGem, uPickCharge);
  float flash = pickGemIgnite(pickGem, uPickCharge) * 1.1 + uPickFlare * .75 + uPickDrain * .6;
  vGlow = lit * lit * .55 + flash;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(0., 0., 0., 1.);
  float scale = length((modelViewMatrix * instanceMatrix * vec4(1., 0., 0., 0.)).xyz);
  float size = scale * (1. + uPickFlare * .3 + uPickDrain * .2);
  mv.xyz += normalize(-mv.xyz) * size * .35; // sit just in front of the crystal so it never clips into the head
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;
}
`;
const HALO_FRAGMENT = /* glsl */`
uniform vec3 uPickGlow, uPickFlareColor;
uniform float uPickFlare;
varying vec2 vUv;
varying float vGlow;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.) discard;
  float core = exp(-r2 * 12.), soft = (1. - r2) * (1. - r2) * (1. - r2);
  vec3 color = mix(uPickGlow, uPickFlareColor, clamp(core * .2 + uPickFlare * .25, 0., 1.));
  gl_FragColor = vec4(color * (core * .4 + soft * .08) * vGlow, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Held-pick luminance. `owner` is weapon-readiness's Owner (adds the halo to its group, tracks disposal), `host` the
 * readiness host node, `find` its authored-name lookup. Returns {update(charge, time, reducedMotion), dispose()}.
 */
export function createPickLuminance(owner, host, find) {
  const gemMeshes = GEM_NAMES.map(find).filter(o => o?.isMesh);
  if (!gemMeshes.length) return null;
  const root = gemMeshes[0].parent || host;
  const gems = classifyPickGems(pickGemClusters(gemMeshes, root));
  const uniforms = gemUniforms(), spill = spillUniforms(), groups = spillGroups(gems);
  const restore = [];

  // Per-instance gem attribute on private geometry copies; shared template geometry is never written.
  const crystal = gemMaterial(gemMeshes[0].material.clone(), uniforms, true);
  for (const mesh of gemMeshes) {
    const geometry = mesh.geometry.clone(), data = new Float32Array(geometry.attributes.position.count * 3);
    for (const g of gems) if (g.mesh === mesh) for (const i of g.vertices) data.set([g.threshold, g.seed, g.kind], i * 3);
    geometry.setAttribute('pickGem', new THREE.BufferAttribute(data, 3));
    restore.push([mesh, mesh.geometry, mesh.material]);
    mesh.geometry = geometry; mesh.material = crystal;
  }
  const metals = new Map();
  host.traverse(o => {
    if (!o.isMesh || o.userData.readinessOwned) return;
    const kind = o.material?.name === 'Brass_Trim' ? 0 : o.material?.name === 'Steel_Blued' ? 1 : -1;
    if (kind < 0) return;
    if (!metals.has(o.material)) metals.set(o.material, metalMaterial(o.material.clone(), spill, kind));
    restore.push([o, o.geometry, o.material]); o.material = metals.get(o.material);
  });

  // One additive billboard per crystal, positioned in the readiness host's space.
  const toHost = new THREE.Matrix4().copy(host.matrixWorld).invert().multiply(root.matrixWorld);
  const quad = new THREE.PlaneGeometry(1, 1); quad.name = 'readiness:pick-halo';
  // The crown's tight crystal bouquet shares one halo; every other crystal gets its own.
  const crown = gems.filter(g => g.kind === PICK_GEM_KINDS.crown), halos = gems.filter(g => g.kind !== PICK_GEM_KINDS.crown);
  if (crown.length) {
    const box = new THREE.Box3(); crown.forEach(g => box.expandByPoint(g.center));
    halos.push({...crown[0], center: box.getCenter(new THREE.Vector3()), radius: Math.max(...crown.map(g => g.radius)) * 1.6});
  }
  const haloGem = new Float32Array(halos.length * 3);
  halos.forEach((g, i) => haloGem.set([g.threshold, g.seed, g.kind], i * 3));
  quad.setAttribute('pickGem', new THREE.InstancedBufferAttribute(haloGem, 3));
  // Instance scale is the halo diameter, so bounds stay honest for anything measuring the held weapon.
  const haloSize = g => g.radius * (g.kind === PICK_GEM_KINDS.heart ? 2.4 : g.kind === PICK_GEM_KINDS.crown ? 2.1 : 2.);
  const haloMaterial = new THREE.ShaderMaterial({uniforms, vertexShader: HALO_VERTEX, fragmentShader: HALO_FRAGMENT,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: true});
  haloMaterial.name = 'readiness:pick-halo';
  const halo = new THREE.InstancedMesh(quad, haloMaterial, halos.length);
  const m = new THREE.Matrix4();
  const scale = new THREE.Matrix4();
  halos.forEach((g, i) => halo.setMatrixAt(i, m.makeTranslation(g.center.x, g.center.y, g.center.z).multiply(scale.makeScale(haloSize(g), haloSize(g), haloSize(g))).premultiply(toHost)));
  halo.instanceMatrix.needsUpdate = true; halo.frustumCulled = false; halo.renderOrder = 2;
  owner.add(halo, quad, haloMaterial);

  let wasReady = null, drainAt = -Infinity, last = '';
  function update(charge, time, reducedMotion = false, flare = 0) {
    charge = clamp01(charge);
    const ready = charge >= .999;
    if (wasReady === true && !ready && !reducedMotion) drainAt = time;
    wasReady = ready;
    const drainT = (time - drainAt) / .3, drain = drainT >= 0 && drainT < 1 ? (1 - drainT) ** 2 : 0;
    uniforms.uPickCharge.value = charge; uniforms.uPickFlare.value = reducedMotion ? 0 : flare;
    uniforms.uPickDrain.value = drain; uniforms.uPickTime.value = time % 1000; uniforms.uPickMotion.value = reducedMotion ? 0 : 1;
    const stamp = `${Math.round(charge * 480)}|${Math.round(flare * 60)}|${Math.round(drain * 60)}`;
    if (stamp !== last) { last = stamp; writeSpill(spill.uPickSpill, groups, charge, flare + drain); }
  }
  function dispose() {
    for (const [mesh, geometry, material] of restore) {
      if (mesh.geometry !== geometry) mesh.geometry.dispose();
      mesh.geometry = geometry; mesh.material = material;
    }
    crystal.dispose(); metals.forEach(mat => mat.dispose());
  }
  return {update, dispose, gems};
}
