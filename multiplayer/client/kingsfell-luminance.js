import * as THREE from 'three';

// Kingsfell luminance (2026-10-16): the amber heartstone is the axe's light source, its gold sap-veins are the conduits
// that carry the light out to the honed edge, and the whole run shows the Timberfall recharge. Replaces the Orchard's
// Edge axe-luminance.js (that model is retired with it). Presentation only: the input is the simulation's readiness.
//
// - enhanceKingsfellTemplate(scene): once per loaded axe.glb. Patches the shared KF_Amber, KF_Vein, KF_Steel_Edge and
//   KF_Steel_Ring materials in place so every axe (remote heroes, holsters, workers) shows a lit heart, warm veins and a
//   thin amber line along the edge. Static: renders "ready". No node, socket or bounds change.
// - createKingsfellLuminance(owner, host, find): the HELD axe only (from weapon-readiness.js). Private material copies:
//   when Timberfall goes out the heart flares and everything goes dark; over the recharge the heart kindles, sap runs
//   down each vein from the heart toward the edge (the veins carry their path in uv.x, authored by the builder), and
//   where they reach the edge it lights and sweeps out to both horns. Ready, the heart beats slowly and pulses of light
//   flow along the veins into the edge. One additive ribbon draw along the edge stands in for light: no real lights,
//   post or extra passes. Original materials are restored on dispose.

const AMBER = new THREE.Color(1.0, .40, .045), DORMANT = new THREE.Color(.16, .045, .008), HOT = new THREE.Color(1.0, .80, .46);
const clamp01 = x => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// Charge fraction at which each part lights: [start, length]. The veins fill along their path over `vein`.
export const KINGSFELL_SCHEDULE = Object.freeze({heart: [0, .22], vein: [.14, .66], edge: [.8, .18]});
export const KINGSFELL_MATERIALS = Object.freeze({KF_Steel_Edge: 'edge', KF_Steel_Ring: 'cheek', KF_Vein: 'vein', KF_Amber: 'heart'});

/** 0..1 brightness of a vein point at path fraction u (0 heart .. 1 edge) for a recharge fraction. Matches the GLSL. */
export function veinLit(u, charge) {
  const [a, b] = KINGSFELL_SCHEDULE.vein, t = a + b * clamp01(u);
  return .05 + .95 * smooth(t, t + .05, clamp01(charge));
}
export const heartLit = charge => .12 + .88 * smooth(KINGSFELL_SCHEDULE.heart[0], KINGSFELL_SCHEDULE.heart[0] + KINGSFELL_SCHEDULE.heart[1], clamp01(charge));
/** Ignition threshold of the edge at angle fraction s (0 = middle, 1 = horn). */
export const edgeThreshold = s => KINGSFELL_SCHEDULE.edge[0] + KINGSFELL_SCHEDULE.edge[1] * clamp01(s);
/** The heart's slow beat when ready: a quick double thump, then rest (period 1.6 s). 0..1. */
export function heartbeat(time) {
  const p = ((time % 1.6) + 1.6) % 1.6;
  return Math.exp(-(((p - .10) / .07) ** 2)) + .6 * Math.exp(-(((p - .36) / .08) ** 2));
}

// ---------------------------------------------------------------- geometry
const meshesByMaterial = (root, name) => { const out = []; root.traverse(o => { if (o.isMesh && o.material?.name === name) out.push(o); }); return out; };
// The honed edge is a circular arc. Fit its centre from the three CuttingEdge markers (symmetric about the middle one),
// then measure the apex radius, bevel radius and angular span from the edge mesh. All in the edge mesh's parent space,
// which is also the authored local space of every head mesh. The heartstone centre comes from its empty.
export function kingsfellFrame(scene) {
  const edge = meshesByMaterial(scene, 'KF_Steel_Edge')[0];
  if (!edge) return null;
  const space = edge.parent, inv = new THREE.Matrix4().copy(space.matrixWorld).invert();
  const at = name => { const n = scene.getObjectByName(name); return n ? n.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv) : null; };
  const top = at('CuttingEdge_Top'), mid = at('CuttingEdge_Mid'), bottom = at('CuttingEdge_Bottom'), heart = at('Heartstone');
  if (!top || !mid || !bottom || !heart) return null;
  const cy = (top.y + bottom.y) / 2, h = (top.y - bottom.y) / 2;
  const cx = (top.x * top.x + h * h - mid.x * mid.x) / (2 * (top.x - mid.x));
  const pos = edge.geometry.attributes.position, m = new THREE.Matrix4().multiplyMatrices(inv, edge.matrixWorld), v = new THREE.Vector3();
  let apex = 0, bevel = Infinity, spanLo = 0, spanHi = 0;   // the arc may run further below the middle than above (a beard)
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m);
    const r = Math.hypot(v.x - cx, v.y - cy); apex = Math.max(apex, r); bevel = Math.min(bevel, r);
    const a = Math.atan2(v.y - cy, v.x - cx); if (a < 0) spanLo = Math.max(spanLo, -a); else spanHi = Math.max(spanHi, a);
  }
  // the heartstone gem: how deep the cheek surface sits under it (|z| of its rim) and its radius
  const gem = new THREE.Vector2(.008, .03), amber = meshesByMaterial(scene, 'KF_Amber');
  let rim = Infinity, radius = 0;
  for (const mesh of amber) {
    const gp = mesh.geometry.attributes.position, gm = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
    for (let i = 0; i < gp.count; i++) {
      v.fromBufferAttribute(gp, i).applyMatrix4(gm);
      const d = Math.hypot(v.x - heart.x, v.y - heart.y);
      if (d < .06) { rim = Math.min(rim, Math.abs(v.z)); radius = Math.max(radius, d); }
    }
  }
  if (Number.isFinite(rim) && radius > 0) gem.set(rim, radius);
  return {space, center: new THREE.Vector2(cx, cy), apex, bevel, span: Math.max(spanLo, spanHi), spanLo, spanHi, heart: new THREE.Vector2(heart.x, heart.y), gem};
}

// ---------------------------------------------------------------- shaders
const COMMON = /* glsl */`
uniform float uKfCharge, uKfFlare, uKfDrain, uKfTime, uKfMotion, uKfBeat;
uniform vec4 uKfEdge;       // arc centre xy, apex radius, bevel radius (edge-frame space)
uniform vec4 uKfSchedule;   // edge start, edge length, angular span, heart radius of glow
uniform vec4 uKfVein;       // vein start, vein length, heart start, heart length
uniform vec2 uKfHeart;      // heartstone centre xy
uniform vec2 uKfGem;        // heartstone: cheek surface depth under the gem, gem radius
uniform vec3 uKfAmber, uKfDormant, uKfHot;
varying vec3 vKfPos;
float kfSmooth(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
float kfHeart() { return .12 + .88 * kfSmooth(uKfVein.z, uKfVein.z + uKfVein.w, uKfCharge); }
float kfVeinLit(float u) { float t = uKfVein.x + uKfVein.y * clamp(u, 0., 1.); return .05 + .95 * kfSmooth(t, t + .05, uKfCharge); }
float kfIgnite(float t) { if (uKfCharge >= .999) return 0.; float since = uKfCharge - t; return since < 0. ? 0. : exp(-since * 26.); }
vec2 kfPolar() { vec2 d = vKfPos.xy - uKfEdge.xy; return vec2(length(d), atan(d.y, d.x)); }
float kfEdgeT(float angle) { return uKfSchedule.x + uKfSchedule.y * clamp(abs(angle) / uKfSchedule.z, 0., 1.); }
float kfHash(vec3 p) { p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float kfNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(kfHash(i), kfHash(i + vec3(1, 0, 0)), f.x), mix(kfHash(i + vec3(0, 1, 0)), kfHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(kfHash(i + vec3(0, 0, 1)), kfHash(i + vec3(1, 0, 1)), f.x), mix(kfHash(i + vec3(0, 1, 1)), kfHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

// Honed edge: mirror-polished apex carrying a thin amber line, brightest exactly at the apex with a soft bloom back into
// the bevel. Charging, the light enters at the middle and sweeps out to both horns; ready, sparks drift along it.
const EDGE_FRAGMENT = /* glsl */`
{
  vec2 pol = kfPolar();
  float depth = max(0., uKfEdge.z - pol.x), span = max(1e-4, uKfEdge.z - uKfEdge.w);
  float t = kfEdgeT(pol.y), lit = .04 + .96 * kfSmooth(t, t + .04, uKfCharge), ignite = kfIgnite(t);
  vec3 V = normalize(vViewPosition);
  float shimmer = pow(max(0., sin(pol.y * 22. - uKfTime * uKfMotion * 1.8 + dot(V, vec3(3., 5., 4.)) * 1.6)), 20.);
  float line = exp(-depth / .0028), bloom = exp(-depth / (span * .45));
  vec3 core = mix(uKfDormant, uKfAmber, lit);
  totalEmissiveRadiance += core * (line * (.25 + lit * 1.35) + bloom * lit * .22)
    + uKfHot * (line * (shimmer * .4 * lit + ignite * 1.5 + uKfFlare * .9 + uKfDrain * 1.3) + bloom * (ignite * .3 + uKfFlare * .2 + uKfDrain * .3));
}
`;
// Ringsteel cheek: a warm glow round the heartstone (it lights its own growth rings) and a thin spill from the edge.
const CHEEK_FRAGMENT = /* glsl */`
{
  vec2 pol = kfPolar();
  float fromBevel = max(0., uKfEdge.w - pol.x);
  float heart = kfHeart() * (1. + uKfBeat * .55) + uKfFlare * .6 + uKfDrain * 1.2;
  float d = length(vKfPos.xy - uKfHeart), halo = exp(-d * d / (uKfSchedule.w * uKfSchedule.w));
  float t = kfEdgeT(pol.y), lit = kfSmooth(t, t + .04, uKfCharge);
  float edgeSpill = exp(-fromBevel / .007) * lit * (.18 + uKfFlare * .35) + exp(-fromBevel / .02) * uKfDrain * .45;
  totalEmissiveRadiance += uKfAmber * (halo * heart * .3 + edgeSpill) * (diffuseColor.rgb * .9 + .18);
}
`;
// Sap veins: gold inlay whose centre line carries the light. A spark marks the charge front; ready, slow pulses flow
// from the heart to the edge (frozen under reduced motion).
const VEIN_FRAGMENT = /* glsl */`
{
  float u = vKfUv.x, across = abs(vKfUv.y - .5) * 2.;
  float lit = kfVeinLit(u), ignite = kfIgnite(uKfVein.x + uKfVein.y * u);
  float flow = uKfCharge >= .999 ? pow(max(0., sin((u * 7. - uKfTime * uKfMotion * .9) * 6.2831)), 6.) * (1. - u * .4) : 0.;
  float core = exp(-across * across * 3.5);
  diffuseColor.rgb *= mix(1., .6, lit);
  vec3 glow = mix(uKfDormant, uKfAmber, lit) * lit * (.12 + .55 * core * core) * (1. + uKfBeat * .25 * (1. - u));
  totalEmissiveRadiance += glow + uKfHot * core * core * (ignite * 1.3 + flow * .45 + uKfFlare * .45 + uKfDrain * .8);
}
`;
// Heartstone: amber lit from within, with depth. The gem is a shallow dome, so its inside is faked by parallax: each
// pixel follows the view ray (object space) down into a virtual interior. Deepest, at the blade's midplane, sits the
// ember the light comes from; above it, sealed in the amber, a single oak leaf from the tree it was cut from, a dark
// silhouette backlit through its veins; between them, specks of trapped sap catch the ember and twinkle. Facets facing
// you glow hottest, the rim stays deep orange. The pommel pip and the charm's acorn get the plain glow.
const HEART_FRAGMENT = /* glsl */`
{
  vec3 V = normalize(vViewPosition);
  float facing = clamp(abs(dot(normal, V)), 0., 1.);
  float heart = kfHeart() * (1. + uKfBeat * .7) + uKfFlare * 1.2 + uKfDrain * 2.;
  float grain = .82 + .18 * kfNoise(vKfPos * 420.);
  vec3 amber = mix(uKfDormant * 1.6, uKfAmber, clamp(heart, 0., 1.));
  diffuseColor.rgb *= vec3(.5, .32, .12);
  vec3 glow = amber * heart * (.16 + .26 * facing * facing) * grain + uKfHot * pow(facing, 6.) * heart * .1;
  vec2 rel = vKfPos.xy - uKfHeart;
  float inGem = 1. - smoothstep(uKfGem.y * .82, uKfGem.y * 1.02, length(rel));
  if (inGem > 0.) {
    vec3 rd = normalize(vKfPos - vKfEye);
    float side = vKfPos.z < 0. ? -1. : 1., top = abs(vKfPos.z), down = max(-rd.z * side, .3) / .7; // .7: amber bends the ray in
    // the ember, at the midplane under the gem
    float toEmber = top / down; vec2 emberAt = rel + rd.xy * toEmber;
    float de = length(emberAt), ember = exp(-de * de / (uKfGem.y * uKfGem.y * .03)) * 1.1 + exp(-de * de / (uKfGem.y * uKfGem.y * .22)) * .3;
    // the leaf, just under the cheek's surface: an oak leaf, a little askew, stalk toward the haft
    vec2 q = rel + rd.xy * max(top - uKfGem.x * .62, 0.) / down;
    q = mat2(.80, -.60, .60, .80) * q / uKfGem.y;
    float t = (q.x + .72) / 1.3, w = .30 * pow(max(sin(3.14159 * clamp(t, 0., 1.)), 0.), .7) * (.72 + .28 * abs(sin(t * 3.14159 * 4.5)));
    float leaf = (1. - smoothstep(w - .035, w, abs(q.y))) * step(0., t) * step(t, 1.);
    leaf = max(leaf, (1. - smoothstep(.012, .03, abs(q.y))) * step(-.95, q.x) * step(q.x, -.7));
    float rib = exp(-q.y * q.y / .0006), ribs = pow(abs(sin((q.x - abs(q.y) * 1.1) * 26.)), 14.) * smoothstep(.02, .06, abs(q.y));
    float veins = leaf * clamp(rib + ribs * .7, 0., 1.);
    // specks of sap between leaf and ember
    vec2 sp = (rel + rd.xy * max(top - uKfGem.x * .35, 0.) / down) * 640.;
    vec2 cell = floor(sp), f = fract(sp) - .5; float h = kfHash(vec3(cell, side * 7.));
    float speck = step(.9, h) * exp(-dot(f, f) * 30.) * (.6 + .4 * sin(uKfTime * uKfMotion * 2.4 + h * 60.));
    vec3 inside = uKfHot * ember * heart * (1. - leaf * .82) + amber * speck * heart * .9;
    glow = mix(glow, glow * (1. - leaf * .75) + vec3(.5, .13, .015) * veins * heart * .4, inGem) + inside * inGem * (.4 + .6 * facing);
  }
  totalEmissiveRadiance = glow;
}
`;
const ROLES = {
  edge: {fragment: EDGE_FRAGMENT, reflect: 1.4}, cheek: {fragment: CHEEK_FRAGMENT, reflect: 1.8}, vein: {fragment: VEIN_FRAGMENT, uv: true}, heart: {fragment: HEART_FRAGMENT, eye: true},
};

function patchMaterial(material, role, uniforms) {
  const r = ROLES[role];
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vKfPos;${r.uv ? '\nvarying vec2 vKfUv;' : ''}${r.eye ? '\nvarying vec3 vKfEye;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvKfPos = position;${r.uv ? '\nvKfUv = uv;' : ''}${r.eye ? '\nvKfEye = (inverse(modelViewMatrix) * vec4(0., 0., 0., 1.)).xyz;' : ''}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON}${r.uv ? '\nvarying vec2 vKfUv;' : ''}${r.eye ? '\nvarying vec3 vKfEye;' : ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${r.fragment}`);
    // Polished steel is mostly reflection: lift the environment's specular on the cheek and edge so the shaded side
    // (the face a first-person player sees most) still reads as metal, not a black cut-out.
    if (r.reflect) shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\nradiance *= ${r.reflect.toFixed(2)};`);
  };
  material.customProgramCacheKey = () => `brann-kingsfell-${role}-v2`;
  material.needsUpdate = true;
  return material;
}

function kingsfellUniforms(frame) {
  const S = KINGSFELL_SCHEDULE;
  return {
    uKfCharge: {value: 1}, uKfFlare: {value: 0}, uKfDrain: {value: 0}, uKfTime: {value: 0}, uKfMotion: {value: 0}, uKfBeat: {value: 0},
    uKfEdge: {value: new THREE.Vector4(frame.center.x, frame.center.y, frame.apex, frame.bevel)},
    uKfSchedule: {value: new THREE.Vector4(S.edge[0], S.edge[1], frame.span, .055)},
    uKfVein: {value: new THREE.Vector4(S.vein[0], S.vein[1], S.heart[0], S.heart[1])},
    uKfHeart: {value: frame.heart.clone()}, uKfGem: {value: frame.gem.clone()},
    uKfAmber: {value: AMBER.clone()}, uKfDormant: {value: DORMANT.clone()}, uKfHot: {value: HOT.clone()},
  };
}

/** Patch the shared axe template materials once. Safe to call repeatedly. */
export function enhanceKingsfellTemplate(scene) {
  if (!scene || scene.userData.kingsfellLuminance) return false;
  scene.updateWorldMatrix(true, true);
  const frame = kingsfellFrame(scene); if (!frame) return false;
  const uniforms = kingsfellUniforms(frame), done = new Set();
  scene.traverse(o => {
    const role = o.isMesh && KINGSFELL_MATERIALS[o.material?.name];
    if (!role || done.has(o.material)) return;
    done.add(o.material); patchMaterial(o.material, role, uniforms);
  });
  scene.userData.kingsfellLuminance = {materials: done.size, span: frame.span};
  return true;
}

// ---------------------------------------------------------------- held-axe edge ribbon
const RIBBON_VERTEX = /* glsl */`
attribute vec3 kfTangent;
attribute vec2 kfRib;   // angle fraction 0 (middle) .. 1 (horn), side -1..1
uniform float uKfCharge, uKfFlare, uKfDrain;
uniform vec4 uKfSchedule;
varying float vSide;
varying float vGlow;
void main() {
  float t = uKfSchedule.x + uKfSchedule.y * kfRib.x, x = clamp((uKfCharge - t) / .04, 0., 1.), lit = .04 + .96 * x * x * (3. - 2. * x);
  float since = uKfCharge - t, ignite = since < 0. || uKfCharge >= .999 ? 0. : exp(-since * 26.);
  vGlow = (lit * lit * .6 + ignite * 1.3 + uKfFlare * 1.0 + uKfDrain * 1.2) * smoothstep(1., .9, kfRib.x);
  vSide = kfRib.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.);
  vec3 tangent = mat3(modelViewMatrix) * kfTangent;
  float unit = length(tangent);
  vec3 across = normalize(cross(tangent / unit, normalize(-mv.xyz)));
  float width = unit * (.010 + uKfFlare * .006 + uKfDrain * .008);
  mv.xyz += across * kfRib.y * width + normalize(-mv.xyz) * unit * .004;
  gl_Position = projectionMatrix * mv;
}
`;
const RIBBON_FRAGMENT = /* glsl */`
uniform vec3 uKfAmber, uKfHot;
uniform float uKfFlare;
varying float vSide;
varying float vGlow;
void main() {
  float d = vSide * vSide, core = exp(-d * 18.), soft = (1. - d) * (1. - d);
  vec3 color = mix(uKfAmber, uKfHot, clamp(core * .45 + uKfFlare * .3, 0., 1.));
  gl_FragColor = vec4(color * (core * .55 + soft * .14) * vGlow, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
const RIBBON_SEGMENTS = 40;
function ribbonGeometry(frame, toHost) {
  const n = RIBBON_SEGMENTS + 1, position = new Float32Array(n * 2 * 3), tangent = new Float32Array(n * 2 * 3), rib = new Float32Array(n * 2 * 2);
  const p = new THREE.Vector3(), d = new THREE.Vector3(), normalMatrix = new THREE.Matrix3().setFromMatrix4(toHost), index = [];
  for (let i = 0; i < n; i++) {
    const a = -frame.spanLo + (frame.spanLo + frame.spanHi) * i / RIBBON_SEGMENTS;
    p.set(frame.center.x + Math.cos(a) * frame.apex, frame.center.y + Math.sin(a) * frame.apex, 0).applyMatrix4(toHost);
    d.set(-Math.sin(a), Math.cos(a), 0).applyMatrix3(normalMatrix);
    for (const [k, side] of [[0, -1], [1, 1]]) {
      const j = i * 2 + k; p.toArray(position, j * 3); d.toArray(tangent, j * 3); rib[j * 2] = Math.abs(a) / frame.span; rib[j * 2 + 1] = side;
    }
    if (i < RIBBON_SEGMENTS) { const b = i * 2; index.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('kfTangent', new THREE.BufferAttribute(tangent, 3));
  geometry.setAttribute('kfRib', new THREE.BufferAttribute(rib, 2));
  geometry.setIndex(index); geometry.computeBoundingSphere(); geometry.name = 'readiness:axe-edge-light';
  return geometry;
}

/**
 * Held-axe luminance. `owner` is weapon-readiness's Owner (adds the ribbon to its group, tracks disposal), `host` the
 * readiness host node, `find` its authored-name lookup. Returns {update(charge, time, reducedMotion, flare), dispose()}.
 */
export function createKingsfellLuminance(owner, host, find) {
  if (!find('Head_CuttingEdge')?.isMesh) return null;
  host.updateWorldMatrix(true, true);
  const frame = kingsfellFrame(host); if (!frame) return null;
  const uniforms = kingsfellUniforms(frame), restore = [], copies = new Map();
  host.traverse(o => {
    if (!o.isMesh || o.userData.readinessOwned) return;
    const role = KINGSFELL_MATERIALS[o.material?.name]; if (!role) return;
    if (!copies.has(o.material)) copies.set(o.material, patchMaterial(o.material.clone(), role, uniforms));
    restore.push([o, o.material]); o.material = copies.get(o.material);
  });
  const toHost = new THREE.Matrix4().copy(host.matrixWorld).invert().multiply(frame.space.matrixWorld);
  const geometry = ribbonGeometry(frame, toHost);
  const material = new THREE.ShaderMaterial({uniforms, vertexShader: RIBBON_VERTEX, fragmentShader: RIBBON_FRAGMENT,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: true});
  material.name = 'readiness:axe-edge-light';
  const ribbon = new THREE.Mesh(geometry, material); ribbon.frustumCulled = false; ribbon.renderOrder = 2;
  owner.add(ribbon, geometry, material);

  let wasReady = null, drainAt = -Infinity;
  function update(charge, time, reducedMotion = false, flare = 0) {
    charge = clamp01(charge);
    const ready = charge >= .999;
    if (wasReady === true && !ready && !reducedMotion) drainAt = time;
    wasReady = ready;
    const drainT = (time - drainAt) / .4, drain = drainT >= 0 && drainT < 1 ? (1 - drainT) ** 2 : 0;
    uniforms.uKfCharge.value = charge; uniforms.uKfFlare.value = reducedMotion ? 0 : flare;
    uniforms.uKfDrain.value = drain; uniforms.uKfTime.value = time % 1000; uniforms.uKfMotion.value = reducedMotion ? 0 : 1;
    uniforms.uKfBeat.value = ready && !reducedMotion ? heartbeat(time) : 0;
  }
  function dispose() {
    for (const [mesh, original] of restore) mesh.material = original;
    copies.forEach(mat => mat.dispose());
  }
  return {update, dispose, frame};
}
