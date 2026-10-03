// Shared tree materials: one patched clone per (authored material, role), shared by every instanced batch and every
// promoted (wounded/felled) entity. Bark grooves, root-collar transition, leaf-cluster colour variation and world-anchored
// wind are all evaluated on the GPU; update() writes one uniform per frame. Authored GLB materials are never mutated,
// so nothing leaks into other assets. Wind is bounded (maxSway metres at the crown) and mirrored into depth/distance
// materials so shadows follow the swaying canopy; decorate(mesh) attaches them.
import * as T from 'three';

export const TREE_ROLE_OF_PART = {Trunk: 'bark', Roots: 'roots', Branches: 'branch', Leaves: 'leaf', Fruit: 'fruit'};
// sway: 0 static (trunk/roots stay exact for axe raycasts and notch carving), 1 crown sway, 2 sway + leaf flutter
const ROLES = {bark: {sway: 0, bark: 1}, roots: {sway: 0, bark: 1}, branch: {sway: 1, bark: 1}, leaf: {sway: 2, leaf: 1}, fruit: {sway: 1}};
const VERSION = 'tree-mat-v3';

const COMMON = /* glsl */`
uniform float uTreeTime; uniform vec3 uTreeWind; uniform float uTreeWindStrength;
float treeH3(vec3 p) { p = fract(p*.3183099 + .1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x + p.y + p.z)); }
float treeNoise(vec3 x) { vec3 i = floor(x), f = fract(x); f = f*f*(3.0 - 2.0*f);
 return mix(mix(mix(treeH3(i), treeH3(i + vec3(1,0,0)), f.x), mix(treeH3(i + vec3(0,1,0)), treeH3(i + vec3(1,1,0)), f.x), f.y),
            mix(mix(treeH3(i + vec3(0,0,1)), treeH3(i + vec3(1,0,1)), f.x), mix(treeH3(i + vec3(0,1,1)), treeH3(i + vec3(1,1,1)), f.x), f.y), f.z); }
`;
// Authored parts sit at the Tree origin. Growth includes nonuniform scaling of roots/trunks;
// use each column's scale for normals and world-to-local offsets, rather than assuming uniform scale.
const VERT_FRAME = /* glsl */`
#ifdef USE_INSTANCING
 mat4 treeM = modelMatrix * instanceMatrix;
#else
 mat4 treeM = modelMatrix;
#endif
 vec3 treeO = treeM[3].xyz;
 vec3 treeS2 = max(vec3(dot(treeM[0].xyz, treeM[0].xyz), dot(treeM[1].xyz, treeM[1].xyz), dot(treeM[2].xyz, treeM[2].xyz)), vec3(1e-8));
 vec3 treeW = (treeM * vec4(transformed, 1.0)).xyz; float treeH = (treeW.y - treeO.y) * inversesqrt(treeS2.y);
`;
// World-anchored sway: phase from the instance's world origin, gust envelope, height-weighted so the trunk below ~1.2 m is
// motionless. The world offset is converted back with each orthogonal column's squared length;
// this supports rotation with nonuniform scale, including growth. Felled crowns have small treeH so they barely move.
const VERT_SWAY = /* glsl */`
#if TREE_SWAY > 0
 { float k = smoothstep(1.2, 5.5, treeH); k *= k;
   float ph = dot(treeO.xz, vec2(.37, .23));
   float gust = .6 + .4*sin(uTreeTime*.37 + ph*.5);
   vec3 off = uTreeWind * (sin(uTreeTime*1.2 + ph + treeH*.15) * gust * k * TREE_MAX_SWAY);
 #if TREE_SWAY > 1
   float fl = sin(uTreeTime*4.3 + dot(treeW, vec3(1.7, 2.3, 1.3))) * k;
   off += vec3(.35, .22, .3) * fl * TREE_MAX_SWAY * .3;
 #endif
   transformed += (transpose(mat3(treeM)) * (off * uTreeWindStrength)) / treeS2; }
#endif
`;

const FRAG_COLOR = /* glsl */`
 float treeSeed = treeH3(floor(vTreeSeed.xzx * vec3(3.1, 2.7, 1.3)) + .5);
 float treeGroove = 0.0, treeHt = 0.0, treeRough = 1.0;
#ifdef TREE_BARK
 { vec3 p = vTreeObj; float warp = treeNoise(p*vec3(2.3, .7, 2.3) + treeSeed*7.0);
   float n = treeNoise(p*vec3(7.5, 1.1, 7.5) + warp*1.7);                  // long vertical fissures
   float plates = treeNoise(p*vec3(3.2, .9, 3.2) + 11.0);
   // Interrupted, narrower fissures (broken by a second noise) instead of continuous parallel black lines.
   float broken = smoothstep(.28, .62, treeNoise(p*vec3(3.6, 1.4, 3.6) + 5.0));
   treeGroove = (1.0 - smoothstep(.02, .095, abs(n - .5))) * broken;
   treeHt = (1.0 - treeGroove)*.75 + plates*.25;
   float fine = treeNoise(p*vec3(23.0, 6.0, 23.0));
   vec3 tone = mix(vec3(.94, .91, .87), vec3(1.08, 1.04, .98), plates) * mix(.94, 1.06, treeSeed);
   float ridge = smoothstep(.55, .9, plates) * (1.0 - treeGroove);                        // sunlit plate tops
   diffuseColor.rgb *= tone * mix(1.0, .7, treeGroove) * (.95 + .1*fine) * (1.0 + .08*ridge);
   // sparse grey-green lichen flecks on plates (multiplicative tint, never a flat overlay)
   float lichen = smoothstep(.68, .82, treeNoise(p*vec3(5.0, 3.0, 5.0) + 17.0)) * (1.0 - treeGroove) * smoothstep(.4, 2.0, vTreeH);
   diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(1.12, 1.18, 1.02), lichen*.6);
   // root collar: darker, damp, faintly mossy where the trunk meets the soil and on upward faces of the roots
   float collar = 1.0 - smoothstep(.0, .65, vTreeH);
   float moss = collar * smoothstep(.2, .8, vTreeUp) * smoothstep(.35, .7, treeNoise(p*4.0 + 3.0));
   diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(.66, .62, .57), collar*.7);
   diffuseColor.rgb *= mix(vec3(1.0), vec3(.72, .9, .5), moss*.7);            // multiplicative: never brighter than the bark
   treeRough = mix(1.0, 1.1, treeGroove) * mix(1.0, 1.06, collar) * mix(1.0, .92, ridge); }
#endif
#ifdef TREE_LEAF
 { vec3 p = vTreeObj; float c = treeNoise(p*1.7 + treeSeed*13.0), d = treeNoise(p*5.3 + 2.0);
   vec3 warm = vec3(1.12, 1.08, .78), cool = vec3(.78, .94, .9);
   vec3 tint = mix(cool, warm, smoothstep(.3, .75, c));
   tint *= mix(vec3(.94, 1.0, .96), vec3(1.06, 1.0, .9), treeSeed);              // per-tree hue drift
   float outer = smoothstep(.4, 2.2, length(p.xz - vec2(.17, .14)));             // crown shell brighter than the interior
   float lift = smoothstep(2.4, 6.0, vTreeH);
   diffuseColor.rgb *= tint * (.7 + .2*outer + .16*lift) * (.92 + .16*d);              // less interior crush
   treeHt = c*.6 + d*.4; treeRough = .92 + .14*d; }
#endif
#ifdef TREE_FRUIT
 diffuseColor.rgb *= mix(.88, 1.1, treeSeed);
#endif
`;
// Foliage light (v3): sunlight glowing through the crown when looking toward the sun, plus a soft wrap so shaded undersides
// read as leafy green rather than muddy. Uses the scene's first directional light (the orchard sun); no extra uniforms.
const FRAG_FOLIAGE_LIGHT = /* glsl */`
#if defined(TREE_LEAF) && NUM_DIR_LIGHTS > 0
 { vec3 L = directionalLights[0].direction, V = normalize(vViewPosition);
   float through = pow(clamp(dot(-V, L), 0.0, 1.0), 5.0);
   float wrap = clamp((dot(normal, L) + .6) / 1.6, 0.0, 1.0) * (1.0 - clamp(dot(normal, L), 0.0, 1.0));
   reflectedLight.directDiffuse += diffuseColor.rgb * directionalLights[0].color * (through * TREE_TRANSLUCENCY * vec3(1.05, 1.0, .55) + wrap * .22); }
#endif
`;
const FRAG_NORMAL = /* glsl */`
#if defined(TREE_BARK) || defined(TREE_LEAF)
 { float fade = 1.0 - smoothstep(14.0, 32.0, length(vViewPosition));   // fade derivative bump before it aliases
   vec3 pos = -vViewPosition, dpx = dFdx(pos), dpy = dFdy(pos);
   float h = treeHt * TREE_BUMP * fade, hx = dFdx(h), hy = dFdy(h);
   vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx); float det = dot(dpx, r1);
   vec3 g = sign(det) * (hx*r1 + hy*r2); vec3 nn = abs(det)*normal - g;
   if (dot(nn, nn) > 1e-12 && fade > 0.0) normal = normalize(nn); }
#endif
`;

function patchSurface(m, role, cfg) {
 m.onBeforeCompile = shader => {
  Object.assign(shader.uniforms, cfg.uniforms);
  shader.vertexShader = shader.vertexShader
   .replace('#include <common>', `#include <common>\n${COMMON}\nvarying vec3 vTreeObj; varying vec3 vTreeSeed; varying float vTreeH; varying float vTreeUp;`)
   .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_FRAME}\n vTreeObj = position; vTreeSeed = treeO; vTreeH = treeH; vTreeUp = normalize(mat3(treeM)*(objectNormal/treeS2)).y;\n${VERT_SWAY}`);
  shader.fragmentShader = shader.fragmentShader
   .replace('#include <common>', `#include <common>\n${COMMON}\nvarying vec3 vTreeObj; varying vec3 vTreeSeed; varying float vTreeH; varying float vTreeUp;`)
   .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_COLOR}`)
   .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = clamp(roughnessFactor * treeRough, .35, 1.0);')
   .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAG_NORMAL}`)
   .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${FRAG_FOLIAGE_LIGHT}`);
 };
 m.customProgramCacheKey = () => `${VERSION}:${role}`;
}
function patchDepth(m, role, cfg) {
 m.onBeforeCompile = shader => { Object.assign(shader.uniforms, cfg.uniforms);
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${COMMON}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_FRAME}\n${VERT_SWAY}`); };
 m.customProgramCacheKey = () => `${VERSION}:depth:${role}`;
}

/** createTreeMaterials({windStrength, maxSway, leafSway, bump, windDirection}) ->
 *  {material(base, role), attach(kit), decorate(mesh), update(seconds), setWind(strength, dir), stats(), dispose()}.
 *  attach() rewrites the kit's part materials (and kit.lod / kit.trunkMaterial) in place to shared patched clones. */
export function createTreeMaterials({windStrength = 1, maxSway = .05, leafSway = .07, bump = .9, windDirection = [1, 0, .35]} = {}) {
 const uniforms = {uTreeTime: {value: 0}, uTreeWind: {value: new T.Vector3(...windDirection).normalize()}, uTreeWindStrength: {value: windStrength}};
 const cfg = {uniforms}, cache = new Map(), owned = new Set(); let unpatched = 0;
 function defines(role) { const r = ROLES[role] || ROLES.bark, d = {TREE_SWAY: r.sway, TREE_MAX_SWAY: (r.sway > 1 ? leafSway : maxSway).toFixed(4), TREE_BUMP: (role === 'leaf' ? bump*.35 : role === 'roots' ? bump*.02 : bump*.05).toFixed(4), TREE_TRANSLUCENCY: '.85'}; // curved roots alias with full bump
  if (r.bark) d.TREE_BARK = ''; if (r.leaf) d.TREE_LEAF = ''; if (role === 'fruit') d.TREE_FRUIT = ''; return d; }
 /** Shared patched clone for an authored material. Idempotent; non-standard materials are returned unchanged. */
 function material(base, role) {
  if (!base || base.userData?.treeMaterial) return base;
  if (!base.isMeshStandardMaterial) { unpatched++; return base; }
  const key = base.uuid + '|' + role; let m = cache.get(key); if (m) return m;
  m = base.clone(); m.name = `${base.name || 'Tree'}:${role}`; m.defines = {...(m.defines || {}), ...defines(role)};
  m.transparent = false; m.depthWrite = true; m.alphaHash = false;              // opaque only: no sorted overdraw in a forest
  m.userData = {...m.userData, treeMaterial: role, treeWind: ROLES[role]?.sway > 0};
  patchSurface(m, role, cfg); owned.add(m);
  if (ROLES[role]?.sway > 0) { // matching shadow casters so swaying canopies cast swaying shadows (directional + point)
   const cutout = {map: m.alphaTest > 0 ? m.map : null, alphaMap: m.alphaMap, alphaTest: m.alphaTest, side: m.side};
   const depth = new T.MeshDepthMaterial({depthPacking: T.RGBADepthPacking, ...cutout});
   const distance = new T.MeshDistanceMaterial(cutout);
   for (const d of [depth, distance]) { d.defines = {TREE_SWAY: defines(role).TREE_SWAY, TREE_MAX_SWAY: defines(role).TREE_MAX_SWAY}; patchDepth(d, role, cfg); owned.add(d); }
   m.userData.treeDepth = depth; m.userData.treeDistance = distance;
  }
  cache.set(key, m); return m;
 }
 function attachParts(kit) { for (const [part, list] of Object.entries(kit?.parts || {})) for (const p of list) p.material = material(p.material, TREE_ROLE_OF_PART[part] || 'bark'); }
 /** Rewrite a tree-view kit ({parts, trunkMaterial, lod}) to shared tree materials. */
 function attach(kit) { if (!kit) return kit; attachParts(kit); if (kit.trunkMaterial) kit.trunkMaterial = material(kit.trunkMaterial, 'bark'); if (kit.lod) attach(kit.lod); return kit; }
 /** Give a mesh/InstancedMesh the wind-matched shadow materials of its tree material (no-op otherwise). */
 function decorate(mesh) { const u = mesh?.material?.userData; if (u?.treeDepth) { mesh.customDepthMaterial = u.treeDepth; mesh.customDistanceMaterial = u.treeDistance; } return mesh; }
 return {material, attach, decorate, uniforms,
  update(seconds) { if (Number.isFinite(seconds)) uniforms.uTreeTime.value = seconds; }, // no hourly phase jump
  setWind(strength = windStrength, dir = null) { uniforms.uTreeWindStrength.value = strength; if (dir) uniforms.uTreeWind.value.set(...dir).normalize(); },
  stats: () => ({materials: cache.size, depthMaterials: owned.size - cache.size, programs: new Set([...cache.keys()].map(k => k.split('|')[1])).size, unpatched}),
  dispose() { for (const m of owned) m.dispose(); owned.clear(); cache.clear(); }};
}
