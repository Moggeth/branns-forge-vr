import * as THREE from 'three';

// Orchard's Edge axe luminance (2026-10-03): the honed edge is the axe's light source and its brass vine is the conduit
// that feeds it. Counterpart of pick-luminance.js.
//
// - enhanceAxeTemplate(scene): once per loaded axe.glb. Patches the shared OE_Steel_HonedEdge, OE_Steel_BladeCheek,
//   OE_Brass_Inlay and OE_Steel_ForgedDark materials in place (no node, socket or bounds change) so every axe — remote
//   heroes, workers, holsters — gets a ground bevel with a thin blue resonance line at the apex, a temper sheen and a
//   fake edge/inlay light on the cheek, lit brass vine inlays, and worn brass and forged steel. Static: renders "ready".
//   Writes one static per-vertex attribute (`axeChannel`, its ignition order) onto the template's brass geometries.
// - createAxeLuminance(owner, host, find): the HELD axe only (called from weapon-readiness.js). Gives that axe its own
//   material copies so the light discharges when the cleave is used, then refills over the 6 s recharge:
//   the blossom kindles, a spark runs down the vine, the edge line fills outward from where the vine meets it, and
//   the light jumps to the honed edge and sweeps out to both horns, flaring when ready. One additive ribbon draw along
//   the edge stands in for light; there are no real lights, post or extra passes. Original materials are restored on
//   dispose. The input is the simulation's readiness fraction.

const GLOW = new THREE.Color(.07, .42, 1.0), DORMANT = new THREE.Color(.03, .05, .22), FLARE = new THREE.Color(.62, .86, 1.0);
const SPILL_POINTS = 7; // inlay light groups on each cheek (mirrored): blossom, three vine, three edge-line samples
const clamp01 = x => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// Ignition schedule (charge fraction at which each part starts to light, and how long it takes). Tunable.
export const AXE_SCHEDULE = Object.freeze({
  blossom: [0, .2], leaf: [.08, .08], vine: [.2, .38, .05], line: [.6, .22, .05], edge: [.84, .14, .04],
});
const NO_CHANNEL = -1;

// ---------------------------------------------------------------- geometry
const meshesByMaterial = (root, name) => { const out = []; root.traverse(o => { if (o.isMesh && o.material?.name === name) out.push(o); }); return out; };

// The honed edge is a circular arc. Fit its centre from the three authored CuttingEdge markers (symmetric about the
// middle one), then measure the apex/bevel radii and angular span from the edge mesh itself. All in the space of the
// edge mesh's parent, which is also the authored local space of every head mesh.
export function axeEdgeFrame(scene) {
  const edge = meshesByMaterial(scene, 'OE_Steel_HonedEdge')[0];
  if (!edge) return null;
  const space = edge.parent, inv = new THREE.Matrix4().copy(space.matrixWorld).invert();
  const at = name => { const n = scene.getObjectByName(name); return n ? n.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv) : null; };
  const top = at('CuttingEdge_Top'), mid = at('CuttingEdge_Mid'), bottom = at('CuttingEdge_Bottom');
  if (!top || !mid || !bottom) return null;
  const cy = (top.y + bottom.y) / 2, h = (top.y - bottom.y) / 2;
  // |(top.x, h) - (cx, 0)| = mid.x - cx  →  cx = (top.x² + h² - mid.x²) / (2 (top.x - mid.x))
  const cx = (top.x * top.x + h * h - mid.x * mid.x) / (2 * (top.x - mid.x));
  const pos = edge.geometry.attributes.position, m = new THREE.Matrix4().multiplyMatrices(inv, edge.matrixWorld), v = new THREE.Vector3();
  let apex = 0, bevel = Infinity, span = 0;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m);
    const r = Math.hypot(v.x - cx, v.y - cy); apex = Math.max(apex, r); bevel = Math.min(bevel, r);
    span = Math.max(span, Math.abs(Math.atan2(v.y - cy, v.x - cx)));
  }
  return {space, center: new THREE.Vector2(cx, cy), apex, bevel, span};
}

// Ignition threshold/width of every brass vertex from its place on the cheek. Blossom and leaves kindle first, the
// vine fills from the blossom to its tip, the edge line fills outward from the vine's tip. Everything else: none.
function channelOf(name) {
  if (/Inlay_Brass_Blossom/i.test(name)) return 'blossom';
  if (/Inlay_Brass_Leaf/i.test(name)) return 'leaf';
  if (/Inlay_Brass_Vine/i.test(name)) return 'vine';
  if (/Inlay_Brass_EdgeLine/i.test(name)) return 'line';
  return null;
}
function brassBounds(meshes, frame, kind) {
  const inv = new THREE.Matrix4().copy(frame.space.matrixWorld).invert(), m = new THREE.Matrix4(), v = new THREE.Vector3();
  let lo = Infinity, hi = -Infinity;
  for (const mesh of meshes) if (channelOf(mesh.name) === kind) {
    const pos = mesh.geometry.attributes.position; m.multiplyMatrices(inv, mesh.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      const a = kind === 'vine' ? v.x : Math.abs(Math.atan2(v.y - frame.center.y, v.x - frame.center.x));
      lo = Math.min(lo, a); hi = Math.max(hi, a);
    }
  }
  return {lo, hi};
}
export function tagAxeChannels(scene, frame) {
  const brass = meshesByMaterial(scene, 'OE_Brass_Inlay');
  if (brass.every(o => o.geometry.attributes.axeChannel)) return brass;
  const S = AXE_SCHEDULE, vine = brassBounds(brass, frame, 'vine'), line = brassBounds(brass, frame, 'line');
  const inv = new THREE.Matrix4().copy(frame.space.matrixWorld).invert(), m = new THREE.Matrix4(), v = new THREE.Vector3();
  for (const mesh of brass) {
    const kind = channelOf(mesh.name), pos = mesh.geometry.attributes.position, data = new Float32Array(pos.count * 2);
    m.multiplyMatrices(inv, mesh.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      let t = NO_CHANNEL, w = 1;
      if (kind === 'blossom') [t, w] = S.blossom;
      else if (kind === 'leaf') [t, w] = S.leaf;
      else if (kind === 'vine') { t = S.vine[0] + S.vine[1] * clamp01((v.x - vine.lo) / (vine.hi - vine.lo)); w = S.vine[2]; }
      else if (kind === 'line') {
        const a = Math.abs(Math.atan2(v.y - frame.center.y, v.x - frame.center.x));
        t = S.line[0] + S.line[1] * clamp01((a - line.lo) / (line.hi - line.lo)); w = S.line[2];
      }
      data[i * 2] = t; data[i * 2 + 1] = w;
    }
    mesh.geometry.setAttribute('axeChannel', new THREE.BufferAttribute(data, 2));
  }
  return brass;
}

// Matches the GLSL `axeLit`: 0..1 brightness of a channel point with ignition threshold t and width w.
export function axeLit(t, w, charge) {
  if (t < 0) return 0;
  return .06 + .94 * smooth(t, t + w, clamp01(charge));
}
// Matches the GLSL `axeFlow`: the inlays are a conduit, not a store. Light runs through them while the edge charges,
// then pours into the edge, leaving the gold inlay with an ember of blue (the blossom keeps a little more).
export function axeFlow(t, w, charge) {
  if (t < 0) return 0;
  const settle = smooth(AXE_SCHEDULE.edge[0], 1, clamp01(charge));
  return axeLit(t, w, charge) * (1 - settle * (1 - (t < AXE_SCHEDULE.leaf[0] ? .22 : .1)));
}
// Ignition threshold of a point on the honed edge at angle fraction s (0 = middle, 1 = horn).
export const edgeThreshold = s => AXE_SCHEDULE.edge[0] + AXE_SCHEDULE.edge[1] * clamp01(s);

// Inlay light groups for the cheek spill, in edge-frame space with |z| (both cheeks share them).
function spillGroups(brass, frame) {
  const inv = new THREE.Matrix4().copy(frame.space.matrixWorld).invert(), m = new THREE.Matrix4(), v = new THREE.Vector3();
  const buckets = new Map();
  for (const mesh of brass) {
    const data = mesh.geometry.attributes.axeChannel, pos = mesh.geometry.attributes.position; if (!data) continue;
    m.multiplyMatrices(inv, mesh.matrixWorld);
    const kind = channelOf(mesh.name); if (!kind || kind === 'leaf') continue;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      const t = data.getX(i), slot = kind === 'blossom' ? 0 : kind === 'vine' ? 1 + Math.min(2, Math.floor((t - AXE_SCHEDULE.vine[0]) / AXE_SCHEDULE.vine[1] * 3))
        : 4 + Math.min(2, Math.floor((t - AXE_SCHEDULE.line[0]) / AXE_SCHEDULE.line[1] * 3));
      if (!buckets.has(slot)) buckets.set(slot, {sum: new THREE.Vector3(), t: 0, w: 0, n: 0});
      const b = buckets.get(slot); b.sum.add(v.set(v.x, v.y, Math.abs(v.z))); b.t += t; b.w += data.getY(i); b.n++;
    }
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).slice(0, SPILL_POINTS)
    .map(([slot, b]) => ({center: b.sum.divideScalar(b.n), t: b.t / b.n, w: b.w / b.n, strength: slot === 0 ? .32 : .2}));
}
function writeSpill(uniform, groups, charge, flare) {
  uniform.value.forEach((v, i) => {
    const g = groups[i];
    if (!g) { v.set(0, 0, 0, 0); return; }
    const lit = axeFlow(g.t, g.w, charge);
    v.set(g.center.x, g.center.y, g.center.z, g.strength * lit * lit * (1 + flare * .8));
  });
}

// ---------------------------------------------------------------- shaders
const COMMON = /* glsl */`
uniform float uAxeCharge, uAxeFlare, uAxeDrain, uAxeTime, uAxeMotion;
uniform vec4 uAxeEdge;      // centre xy, apex radius, bevel radius (edge-frame space)
uniform vec4 uAxeSchedule;  // edge start, edge length, edge width, edge angular span
uniform vec3 uAxeGlow, uAxeDormant, uAxeFlareColor;
varying vec3 vAxePos;
float axeLit(float t, float w, float charge) { return t < 0. ? 0. : .06 + .94 * smoothstep(t, t + w, charge); }
float axeFlow(float t, float w, float charge) {
  if (t < 0.) return 0.;
  float settle = smoothstep(uAxeSchedule.x, 1., charge);
  return axeLit(t, w, charge) * (1. - settle * (1. - (t < ${AXE_SCHEDULE.leaf[0].toFixed(3)} ? .22 : .1)));
}
// Brief over-bright as the charge front passes a point; zero once ready.
float axeIgnite(float t, float charge) {
  if (t < 0. || charge >= .999) return 0.;
  float since = charge - t;
  return since < 0. ? 0. : exp(-since * 28.);
}
vec2 axePolar() { vec2 d = vAxePos.xy - uAxeEdge.xy; return vec2(length(d), atan(d.y, d.x)); }
float axeEdgeT(float angle) { return uAxeSchedule.x + uAxeSchedule.y * clamp(abs(angle) / uAxeSchedule.w, 0., 1.); }
float axeHash(vec3 p) { p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float axeNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(axeHash(i), axeHash(i + vec3(1, 0, 0)), f.x), mix(axeHash(i + vec3(0, 1, 0)), axeHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(axeHash(i + vec3(0, 0, 1)), axeHash(i + vec3(1, 0, 1)), f.x), mix(axeHash(i + vec3(0, 1, 1)), axeHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;
const SPILL = /* glsl */`
uniform vec4 uAxeSpill[${SPILL_POINTS}];
vec3 axeSpill(vec3 n) {
  vec3 p = vec3(vAxePos.xy, abs(vAxePos.z)), nn = vec3(n.xy, n.z * sign(vAxePos.z + 1e-6));
  float s = 0.;
  for (int i = 0; i < ${SPILL_POINTS}; i++) {
    vec3 d = uAxeSpill[i].xyz - p; float r = length(d);
    float wrap = clamp(dot(nn, d / max(r, 1e-4)) * .5 + .5, 0., 1.);
    s += uAxeSpill[i].w * wrap / (1. + r * r * 4200.);
  }
  return uAxeGlow * min(s, 1.2);
}
`;

// Honed edge: a ground bevel whose grind lines run parallel to the edge, a mirror-polished apex, and the resonance
// line itself — brightest exactly at the apex, with a soft bloom back into the bevel. Charging, a glint sweeps from
// the middle out to both horns; ready, a faint shimmer drifts along it (frozen under reduced motion).
const EDGE_ROUGHNESS = /* glsl */`
{
  vec2 axePol = axePolar();
  float axeDepth = uAxeEdge.z - axePol.x;
  float grind = axeNoise(vec3(axePol.x * 2400., axePol.y * 6., 0.)) * .7 + axeNoise(vec3(axePol.x * 900., axePol.y * 30., 3.)) * .3;
  roughnessFactor = mix(clamp(.14 + grind * .26, .08, 1.), .06, smoothstep(.006, .001, axeDepth));
}
`;
const EDGE_FRAGMENT = /* glsl */`
{
  vec2 axePol = axePolar();
  float axeDepth = max(0., uAxeEdge.z - axePol.x), bevelSpan = max(1e-4, uAxeEdge.z - uAxeEdge.w);
  float t = axeEdgeT(axePol.y), lit = axeLit(t, uAxeSchedule.z, uAxeCharge), ignite = axeIgnite(t, uAxeCharge);
  vec3 axeV = normalize(vViewPosition);
  float shimmer = pow(max(0., sin(axePol.y * 18. - uAxeTime * uAxeMotion * 1.4 + dot(axeV, vec3(3., 5., 4.)) * 1.6)), 24.);
  float line = exp(-axeDepth / .0032), bloom = exp(-axeDepth / (bevelSpan * .4));
  vec3 core = mix(uAxeDormant, uAxeGlow, lit);
  diffuseColor.rgb *= .84 + .16 * axeNoise(vec3(axePol.x * 2400., axePol.y * 6., 0.));
  totalEmissiveRadiance += core * (line * (.2 + lit * 1.2) + bloom * lit * .26)
    + uAxeFlareColor * (line * (shimmer * .35 * lit + ignite * 1.4 + uAxeFlare * .8 + uAxeDrain * 1.2) + bloom * (ignite * .3 + uAxeFlare * .2 + uAxeDrain * .25));
}
`;

// Blade cheek: hammered steel keeps its authored maps; adds wear in the roughness, a temper rainbow toward the bevel
// at grazing angles, and the fake light of the edge and the lit inlays.
const CHEEK_ROUGHNESS = /* glsl */`
{ roughnessFactor = clamp(roughnessFactor * (.82 + axeNoise(vAxePos * 90.) * .36), .1, 1.); }
`;
const CHEEK_FRAGMENT = /* glsl */`
{
  vec2 axePol = axePolar();
  float fromBevel = max(0., uAxeEdge.w - axePol.x);
  vec3 axeV = normalize(vViewPosition);
  float graze = pow(1. - clamp(abs(dot(normal, axeV)), 0., 1.), 2.5);
  float band = fromBevel / .06 + (axeNoise(vAxePos * 40.) - .5) * .25;
  vec3 temper = band < .3 ? mix(vec3(.22, .17, .07), vec3(.20, .10, .05), band / .3)
    : band < .6 ? mix(vec3(.20, .10, .05), vec3(.13, .06, .16), (band - .3) / .3) : mix(vec3(.13, .06, .16), vec3(.05, .07, .14), clamp((band - .6) / .4, 0., 1.));
  totalEmissiveRadiance += temper * graze * (1. - smoothstep(.8, 1.1, band)) * .55;
  float t = axeEdgeT(axePol.y), lit = axeLit(t, uAxeSchedule.z, uAxeCharge);
  float edgeSpill = exp(-fromBevel / .008) * lit * lit * (.22 + uAxeFlare * .4) + exp(-fromBevel / .02) * uAxeDrain * .5;
  totalEmissiveRadiance += (uAxeGlow * edgeSpill + axeSpill(normalize(vAxeNormal))) * (diffuseColor.rgb * .6 + .25);
}
`;

// Brass: low-frequency tarnish and polish everywhere; the cheek inlays carry the resonance light as an inner core,
// strongest on the faces looking out of the cheek, with a spark as the charge front passes.
const BRASS_ROUGHNESS = /* glsl */`
{ roughnessFactor = clamp(roughnessFactor * (.72 + (axeNoise(vAxePos * 38.) * .65 + axeNoise(vAxePos * 140.) * .35) * .75), .12, 1.); }
`;
const BRASS_FRAGMENT = /* glsl */`
{
  float tarnish = axeNoise(vAxePos * 26. + 3.1);
  diffuseColor.rgb *= mix(.8, 1.06, smoothstep(.2, .8, tarnish));
  if (vAxeChannel.x >= 0.) {
    float lit = axeFlow(vAxeChannel.x, vAxeChannel.y, uAxeCharge), ignite = axeIgnite(vAxeChannel.x, uAxeCharge);
    vec3 axeV = normalize(vViewPosition);
    float facing = clamp(abs(dot(normal, axeV)), 0., 1.);
    vec3 core = mix(uAxeDormant, uAxeGlow, lit);
    diffuseColor.rgb *= mix(1., .5, lit);
    totalEmissiveRadiance += core * lit * (.2 + .35 * facing) + uAxeFlareColor * (ignite * 1.1 + uAxeFlare * .35 * lit + uAxeDrain * .6);
  }
}
`;
// Forged dark steel (socket, poll, langets): worn high points read slightly smoother.
const FORGED_ROUGHNESS = /* glsl */`
{ roughnessFactor = clamp(roughnessFactor * (.78 + axeNoise(vAxePos * 70.) * .4), .12, 1.); }
`;

const ROLES = {
  edge: {roughness: EDGE_ROUGHNESS, fragment: EDGE_FRAGMENT},
  cheek: {roughness: CHEEK_ROUGHNESS, fragment: CHEEK_FRAGMENT, spill: true},
  brass: {roughness: BRASS_ROUGHNESS, fragment: BRASS_FRAGMENT, channel: true},
  forged: {roughness: FORGED_ROUGHNESS, fragment: ''},
};
const MATERIAL_ROLES = {OE_Steel_HonedEdge: 'edge', OE_Steel_BladeCheek: 'cheek', OE_Brass_Inlay: 'brass', OE_Steel_ForgedDark: 'forged'};

// uniforms: plain {value} objects shared by reference so the owner can drive them without touching the program.
// The edge and cheek shaders work in mesh-local space: those meshes are authored untransformed in the edge frame.
function patchMaterial(material, role, uniforms) {
  const r = ROLES[role];
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vAxePos;\nvarying vec3 vAxeNormal;${r.channel ? '\nattribute vec2 axeChannel;\nvarying vec2 vAxeChannel;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvAxePos = position;\nvAxeNormal = objectNormal;${r.channel ? '\nvAxeChannel = axeChannel;' : ''}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON}\nvarying vec3 vAxeNormal;${r.spill ? SPILL : ''}${r.channel ? '\nvarying vec2 vAxeChannel;' : ''}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${r.roughness}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${r.fragment}`);
  };
  material.customProgramCacheKey = () => `brann-axe-${role}-v1`;
  material.needsUpdate = true;
  return material;
}

function axeUniforms(frame) {
  return {
    uAxeCharge: {value: 1}, uAxeFlare: {value: 0}, uAxeDrain: {value: 0}, uAxeTime: {value: 0}, uAxeMotion: {value: 0},
    uAxeEdge: {value: new THREE.Vector4(frame.center.x, frame.center.y, frame.apex, frame.bevel)},
    uAxeSchedule: {value: new THREE.Vector4(AXE_SCHEDULE.edge[0], AXE_SCHEDULE.edge[1], AXE_SCHEDULE.edge[2], frame.span)},
    uAxeGlow: {value: GLOW.clone()}, uAxeDormant: {value: DORMANT.clone()}, uAxeFlareColor: {value: FLARE.clone()},
    uAxeSpill: {value: Array.from({length: SPILL_POINTS}, () => new THREE.Vector4())},
  };
}

/** Patch the shared axe template materials once. Safe to call repeatedly. */
export function enhanceAxeTemplate(scene) {
  if (!scene || scene.userData.axeLuminance) return false;
  scene.updateWorldMatrix(true, true);
  const frame = axeEdgeFrame(scene); if (!frame) return false;
  const brass = tagAxeChannels(scene, frame), uniforms = axeUniforms(frame);
  writeSpill(uniforms.uAxeSpill, spillGroups(brass, frame), 1, 0);
  const done = new Set();
  scene.traverse(o => {
    const role = o.isMesh && MATERIAL_ROLES[o.material?.name];
    if (!role || done.has(o.material)) return;
    done.add(o.material); patchMaterial(o.material, role, uniforms);
  });
  scene.userData.axeLuminance = {materials: done.size, span: frame.span};
  return true;
}

// ---------------------------------------------------------------- held-axe edge ribbon
// A camera-facing strip along the honed edge's apex: each vertex knows its point on the arc and the arc's tangent, and
// is pushed sideways across the view so the ribbon reads from the cheek, along the edge and from behind alike.
const RIBBON_VERTEX = /* glsl */`
attribute vec3 axeTangent;
attribute vec2 axeRib;   // angle fraction 0 (middle) .. 1 (horn), side -1..1
uniform float uAxeCharge, uAxeFlare, uAxeDrain;
uniform vec4 uAxeSchedule;
varying float vSide;
varying float vGlow;
float axeLit(float t, float w, float charge) { return .06 + .94 * smoothstep(t, t + w, charge); }
void main() {
  float t = uAxeSchedule.x + uAxeSchedule.y * axeRib.x, lit = axeLit(t, uAxeSchedule.z, uAxeCharge);
  float since = uAxeCharge - t, ignite = since < 0. || uAxeCharge >= .999 ? 0. : exp(-since * 28.);
  vGlow = lit * lit * .55 + ignite * 1.2 + uAxeFlare * .9 + uAxeDrain * 1.1;
  vGlow *= smoothstep(1., .9, axeRib.x); // fade out at the horns
  vSide = axeRib.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.);
  vec3 tangent = mat3(modelViewMatrix) * axeTangent;
  float unit = length(tangent);
  vec3 across = normalize(cross(tangent / unit, normalize(-mv.xyz)));
  float width = unit * (.009 + uAxeFlare * .005 + uAxeDrain * .007);
  mv.xyz += across * axeRib.y * width + normalize(-mv.xyz) * unit * .004;
  gl_Position = projectionMatrix * mv;
}
`;
const RIBBON_FRAGMENT = /* glsl */`
uniform vec3 uAxeGlow, uAxeFlareColor;
uniform float uAxeFlare;
varying float vSide;
varying float vGlow;
void main() {
  float d = vSide * vSide, core = exp(-d * 18.), soft = (1. - d) * (1. - d);
  vec3 color = mix(uAxeGlow, uAxeFlareColor, clamp(core * .35 + uAxeFlare * .3, 0., 1.));
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
    const a = -frame.span + 2 * frame.span * i / RIBBON_SEGMENTS;
    p.set(frame.center.x + Math.cos(a) * frame.apex, frame.center.y + Math.sin(a) * frame.apex, 0).applyMatrix4(toHost);
    d.set(-Math.sin(a), Math.cos(a), 0).applyMatrix3(normalMatrix);
    for (const [k, side] of [[0, -1], [1, 1]]) {
      const j = i * 2 + k; p.toArray(position, j * 3); d.toArray(tangent, j * 3); rib[j * 2] = Math.abs(a) / frame.span; rib[j * 2 + 1] = side;
    }
    if (i < RIBBON_SEGMENTS) { const b = i * 2; index.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('axeTangent', new THREE.BufferAttribute(tangent, 3));
  geometry.setAttribute('axeRib', new THREE.BufferAttribute(rib, 2));
  geometry.setIndex(index); geometry.computeBoundingSphere(); geometry.name = 'readiness:axe-edge-light';
  return geometry;
}

/**
 * Held-axe luminance. `owner` is weapon-readiness's Owner (adds the ribbon to its group, tracks disposal), `host` the
 * readiness host node, `find` its authored-name lookup. Returns {update(charge, time, reducedMotion, flare), dispose()}.
 */
export function createAxeLuminance(owner, host, find) {
  const edgeMesh = find('Head_CuttingEdge');
  if (!edgeMesh?.isMesh) return null;
  const scene = host; scene.updateWorldMatrix(true, true);
  const frame = axeEdgeFrame(scene); if (!frame) return null;
  const brass = tagAxeChannels(scene, frame), uniforms = axeUniforms(frame), groups = spillGroups(brass, frame);
  const restore = [], copies = new Map();
  host.traverse(o => {
    if (!o.isMesh || o.userData.readinessOwned) return;
    const role = MATERIAL_ROLES[o.material?.name]; if (!role) return;
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

  let wasReady = null, drainAt = -Infinity, last = '';
  function update(charge, time, reducedMotion = false, flare = 0) {
    charge = clamp01(charge);
    const ready = charge >= .999;
    if (wasReady === true && !ready && !reducedMotion) drainAt = time;
    wasReady = ready;
    const drainT = (time - drainAt) / .35, drain = drainT >= 0 && drainT < 1 ? (1 - drainT) ** 2 : 0;
    uniforms.uAxeCharge.value = charge; uniforms.uAxeFlare.value = reducedMotion ? 0 : flare;
    uniforms.uAxeDrain.value = drain; uniforms.uAxeTime.value = time % 1000; uniforms.uAxeMotion.value = reducedMotion ? 0 : 1;
    const stamp = `${Math.round(charge * 480)}|${Math.round(flare * 60)}|${Math.round(drain * 60)}`;
    if (stamp !== last) { last = stamp; writeSpill(uniforms.uAxeSpill, groups, charge, flare + drain); }
  }
  function dispose() {
    for (const [mesh, original] of restore) mesh.material = original;
    copies.forEach(mat => mat.dispose());
  }
  return {update, dispose, frame};
}
