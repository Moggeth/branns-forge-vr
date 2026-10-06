// Wyrmspout III look: once per loaded wyrmspout.glb, patch the shared template materials in place so every copy
// (held, remote heroes, holsters) shares them. No material is cloned; per-weapon state lives on nodes and in the
// liquid's per-draw uniforms (wyrmspout-liquid.js).
//   WyrmHide    — fine overlapping scales (tri-planar in mesh space), dark in the creases, with a jade-to-teal shimmer.
//   ScaleSteel  — the same scales, larger and crisper (brows, crest, lids).
//   Brass       — hammered: a soft roughness/brightness break-up so it reads as forged, not plastic.
//   TankGlass   — mostly clear face-on, catching light at the edges (fresnel), so the liquid shows through.
//   glows       — embers breathe: a slow wave of brightness runs through eyes, iris, veins and flames.
//   LiquidFire  — replaced by the sloshing liquid shader.
import * as THREE from 'three';
import {createLiquidMaterial} from './wyrmspout-liquid.js';

export const wyrmTime = {value: 0};   // shared by every patched program; advanced by animateWyrmspout

const SCALES = /* glsl */`
varying vec3 vWyrmPos;
varying vec3 vWyrmNormal;
uniform float uWyrmTime;
float wyrmHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// One plane of overlapping scales: x = shade toward the scale's root, y = crease, z = per-scale random.
vec3 wyrmScalePlane(vec2 p) {
  float row = floor(p.y); p.x += mod(row, 2.) * .5;
  vec2 c = floor(p), f = fract(p);
  float d = length((f - vec2(.5, 1.05)) * vec2(1., 1.25));
  return vec3(1. - smoothstep(.15, .95, d), smoothstep(.72, .86, d), wyrmHash(c));
}
vec3 wyrmScales(float density) {
  vec3 w = pow(abs(normalize(vWyrmNormal)), vec3(4.)); w /= w.x + w.y + w.z;
  vec3 p = vWyrmPos * density;
  // scales open toward the tail (+Z in the exported frame)
  return wyrmScalePlane(p.yz) * w.x + wyrmScalePlane(p.xz) * w.y + wyrmScalePlane(vec2(p.x, p.y)) * w.z;
}`;

const ROLE = {
  hide: {density: 260, fragment: /* glsl */`
    vec3 sc = wyrmScales(260.);
    diffuseColor.rgb *= mix(.55, 1.12, sc.x) * (1. - .45 * sc.y) * (.9 + .2 * sc.z);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(.75, 1.05, 1.2), sc.z * .5);`,
    roughness: `roughnessFactor = clamp(roughnessFactor + .25 * sc.y - .08 * sc.x, .05, 1.);`},
  scale: {density: 150, fragment: /* glsl */`
    vec3 sc = wyrmScales(150.);
    diffuseColor.rgb *= mix(.7, 1.15, sc.x) * (1. - .5 * sc.y);`,
    roughness: `roughnessFactor = clamp(roughnessFactor + .3 * sc.y, .05, 1.);`},
  brass: {fragment: /* glsl */`
    vec2 hq = vWyrmPos.xz * 900. + vWyrmPos.y * 600.;
    float ham = wyrmHash(floor(hq)) * .6 + wyrmHash(floor(hq * .37)) * .4;
    diffuseColor.rgb *= .88 + .2 * ham;
    vec3 sc = vec3(ham);`,
    roughness: `roughnessFactor = clamp(roughnessFactor + .16 * (sc.x - .5), .05, 1.);`},
  glow: {fragment: '', emissive: /* glsl */`
    totalEmissiveRadiance *= .8 + .28 * sin(uWyrmTime * 2.6 - (vWyrmPos.z + vWyrmPos.y) * 140.) + .08 * sin(uWyrmTime * 11.3 + vWyrmPos.x * 300.);`},
  glass: {fragment: '', opaque: /* glsl */`
    float wyrmFres = pow(1. - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0., 1.), 3.);
    outgoingLight += vec3(1., .86, .62) * wyrmFres * .45;
    diffuseColor.a = mix(diffuseColor.a * .6, .7, wyrmFres);`},
};
const MATERIAL_ROLE = {WyrmHide: 'hide', ScaleSteel: 'scale', Brass: 'brass', DarkBrass: 'brass',
  EmberGlass: 'glow', IrisGlow: 'glow', VeinGlow: 'glow', FlameGlow: 'glow', Hearth: 'glow', TankGlass: 'glass'};

function patch(material, role) {
  const r = ROLE[role];
  material.onBeforeCompile = shader => {
    shader.uniforms.uWyrmTime = wyrmTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWyrmPos;\nvarying vec3 vWyrmNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWyrmPos = position;\nvWyrmNormal = objectNormal;');
    let f = shader.fragmentShader.replace('#include <common>', `#include <common>\n${SCALES}`);
    if (r.fragment) f = f.replace('#include <color_fragment>', `#include <color_fragment>\n${r.fragment}`);
    if (r.roughness) f = f.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${r.roughness}`);
    if (r.emissive) f = f.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${r.emissive}`);
    if (r.opaque) f = f.replace('#include <opaque_fragment>', `${r.opaque}\n#include <opaque_fragment>`);
    shader.fragmentShader = f;
  };
  material.customProgramCacheKey = () => `brann-wyrmspout-${role}-v3`;
  material.userData.wyrmRole = role;
  material.needsUpdate = true;
}

/** Patch the shared wyrmspout template once (safe to call again). Older models simply match fewer names. */
export function enhanceWyrmspoutTemplate(scene) {
  if (scene.userData.wyrmEnhanced) return scene;
  let liquid = null;
  scene.traverse(o => {
    if (!o.isMesh) return;
    if (o.name === 'FuelLiquid' && o.material?.name === 'LiquidFire') {
      liquid ||= createLiquidMaterial(); o.material.dispose(); o.material = liquid; return;
    }
    for (const m of [o.material].flat()) { const role = MATERIAL_ROLE[m?.name]; if (role && !m.userData.wyrmRole) patch(m, role); }
  });
  scene.userData.wyrmEnhanced = true;
  return scene;
}
