// Shellbright, the larimar turtle (level 3 target): a sea turtle brought to life from a sterling-silver pendant with a
// larimar cabochon shell. Built in Blender (assets-source/larimar-turtle/build_larimar_turtle.py ->
// /assets/larimar-turtle.glb): one skinned mesh, three materials, 19 bones.
//
// Shading, patched into the GLB's standard materials once at load:
// - TurtleShell: the larimar stone. A second, deeper sample of the larimar map is offset along the view direction so
//   the clouds and veins seem to sit inside a glassy dome (cheap parallax), a cool rim, and at night the veins glow
//   from within (emissive only; no lights, so it is phone and headset safe).
// - TurtleSkin: hammered-silver scales only where TEXCOORD_1.x asks (flippers, head, neck), the normal map scaled the
//   same way, polish (TEXCOORD_1.y) turning the bezel and beak into bright mirror silver, and a faint pearly sheen.
// - TurtleEye: glossy and dark; the environment gives it a catch-light.
// Until the GLB arrives a small stand-in (a domed blue shell on a silver body) holds its place.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {cloneSkinnedAsset} from './clone-skinned-asset.js';

const MODEL_URL = '/assets/larimar-turtle.glb';
// Eye look directions in the model (from the builder), for the lids' blink axis.
const EYE_DIR = {L: new THREE.Vector3(.78, .14, .62).normalize(), R: new THREE.Vector3(-.78, .14, .62).normalize()};
const LID_CLOSED = .95; // radians the upper lid rolls down over the eye to close it

const shellUniforms = {uNight: {value: 0}, uTime: {value: 0}, uRim: {value: new THREE.Color(0x9fe8ff)}};
function patchShell(material) {
  material.roughness = .18; material.metalness = 0; material.envMapIntensity = .45;
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, shellUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjView; varying vec3 vObjPos;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec3 camObj = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
        vObjView = normalize(camObj - transformed); vObjPos = transformed;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjView; varying vec3 vObjPos; uniform float uNight, uTime; uniform vec3 uRim;')
      .replace('#include <map_fragment>', `#ifdef USE_MAP
        vec4 nearStone = texture2D(map, vMapUv);
        // the stone's depth: the same clouds seen a little further in, along the view ray, darker and bluer
        vec2 drift = -vObjView.xz / max(vObjView.y, .25) * vec2(1.0 / 1.0, 1.0 / 1.26) * .05;
        vec4 deepStone = texture2D(map, vMapUv + drift);
        vec3 stone = mix(nearStone.rgb, deepStone.rgb * vec3(.62, .82, .96), .38);
        diffuseColor.rgb *= stone * .64;
      #endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float facing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
        float rim = pow(1.0 - facing, 3.0);
        #ifdef USE_MAP
          vec3 st = texture2D(map, vMapUv).rgb;
          float veins = smoothstep(.72, .95, dot(st, vec3(.3, .4, .3)));
          float shimmer = .75 + .25 * sin(uTime * .9 + vObjPos.x * 9.0 + vObjPos.z * 7.0);
          totalEmissiveRadiance += st * (.04 + uNight * (.28 + .9 * veins * shimmer)) * vec3(.7, .95, 1.1);
        #endif
        totalEmissiveRadiance += uRim * rim * (.05 + .35 * uNight);`);
  };
  material.customProgramCacheKey = () => 'larimar-shell';
  return material;
}
function patchSkin(material) {
  material.metalness = .62; material.roughness = .4; material.envMapIntensity = .45;
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, {uNight: shellUniforms.uNight});
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n#ifndef USE_UV1\nattribute vec2 uv1;\n#endif\nvarying vec2 vTMask;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvTMask = uv1;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vTMask; uniform float uNight;')
      .replace('#include <map_fragment>', '#ifdef USE_MAP\n diffuseColor.rgb *= mix(vec3(1.0), texture2D(map, vMapUv).rgb, vTMask.x);\n#endif')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness, .24, vTMask.y);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = mix(metalness, .9, vTMask.y);')
      .replace('#include <normal_fragment_maps>', `#ifdef USE_NORMALMAP_TANGENTSPACE
        vec3 mapN = texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0;
        mapN.xy *= normalScale * vTMask.x;
        normal = normalize(tbn * mapN);
      #endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float facing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
        // a faint pearly sheen at grazing angles, a touch of the stone's blue at night
        totalEmissiveRadiance += mix(vec3(.55, .62, .75), vec3(.75, .62, .7), facing) * pow(1.0 - facing, 4.0) * .08
          + vec3(.25, .55, .7) * uNight * .05;`);
  };
  material.customProgramCacheKey = () => 'larimar-skin';
  return material;
}
function patchEye(material) { material.roughness = .05; material.metalness = 0; material.envMapIntensity = 1.6; return material; }

let template = null, loading = null, failed = false;
const waiting = new Set();
function load(url = MODEL_URL) {
  if (loading || typeof window === 'undefined') return;
  loading = new GLTFLoader().loadAsync(url).then(gltf => {
    gltf.scene.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = false; o.receiveShadow = false;
      const m = o.material, name = m.name;
      if (name === 'TurtleShell') patchShell(m); else if (name === 'TurtleSkin') patchSkin(m); else if (name === 'TurtleEye') patchEye(m);
      m.vertexColors = !!o.geometry.attributes.color;
    });
    template = gltf.scene;
    for (const root of waiting) attachModel(root);
  }).catch(error => { failed = true; console.warn('Larimar turtle model unavailable; showing the simple turtle.', error); }).finally(() => waiting.clear());
}

function attachModel(root) {
  const holder = root.userData.body; holder.clear();
  const model = cloneSkinnedAsset(template); holder.add(model);
  const bones = {}, rest = {}, meshes = [];
  model.traverse(o => { if (o.isBone) bones[o.name] = o; if (o.isMesh) { meshes.push(o); o.frustumCulled = false; } });
  for (const [name, bone] of Object.entries(bones)) {
    const world = bone.quaternion.clone(); let p = bone.parent;
    while (p && p !== model) { world.premultiply(p.quaternion); p = p.parent; }
    const inv = world.clone().invert();
    rest[name] = {q: bone.quaternion.clone(), p: bone.position.clone(),
      x: new THREE.Vector3(1, 0, 0).applyQuaternion(inv), y: new THREE.Vector3(0, 1, 0).applyQuaternion(inv), z: new THREE.Vector3(0, 0, 1).applyQuaternion(inv)};
    if (name.startsWith('Lid')) {
      const d = EYE_DIR[name.slice(3)], axis = d.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
      rest[name].lid = axis.applyQuaternion(inv);
    }
  }
  root.userData.turtle = {model: true, bones, rest, meshes};
}

// The stand-in: a blue dome on a silver body with four paddles, until the model loads (or if it cannot).
let simple = null;
function buildStandIn(holder) {
  simple ??= {shell: new THREE.MeshStandardMaterial({color: 0x8fd0e6, roughness: .15}), skin: new THREE.MeshStandardMaterial({color: 0xc4cad0, metalness: .5, roughness: .4}),
    ball: new THREE.SphereGeometry(1, 14, 10)};
  const piece = (mat, p, s) => { const m = new THREE.Mesh(simple.ball, mat); m.position.fromArray(p); m.scale.fromArray(s); holder.add(m); return m; };
  piece(simple.shell, [0, .06, 0], [.46, .22, .6]); piece(simple.skin, [0, -.02, 0], [.44, .1, .58]); piece(simple.skin, [0, .07, .78], [.13, .1, .17]);
  for (const s of [-1, 1]) { piece(simple.skin, [s * .62, -.02, .18], [.34, .03, .1]).rotation.y = s * .35; piece(simple.skin, [s * .36, -.03, -.5], [.15, .03, .09]).rotation.y = -s * .6; }
  return {model: false};
}

/** A new turtle: root Group (+Z forward, origin at the body's centre); pose it with poseTurtle every frame. */
export function buildTurtle({url} = {}) {
  const root = new THREE.Group(), body = new THREE.Group();
  root.name = 'larimarTurtle'; root.add(body); root.userData.body = body;
  if (template) attachModel(root);
  else { root.userData.turtle = buildStandIn(body); if (!failed) { waiting.add(root); load(url); } }
  return root;
}
export const turtleReady = () => !!template;

const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion();
function turn(d, name, x = 0, y = 0, z = 0) {
  const b = d.bones[name], r = d.rest[name]; if (!b) return;
  b.quaternion.copy(r.q).multiply(qa.setFromAxisAngle(r.y, y)).multiply(qb.setFromAxisAngle(r.z, z)).multiply(qc.setFromAxisAngle(r.x, x));
}
/** Apply a pose from turtlePose(): bone angles, lids (0 open .. 1 closed) and jaw. */
export function poseTurtle(root, pose) {
  const d = root.userData.turtle; if (!d?.model) return;
  for (const [name, [x, y, z]] of Object.entries(pose.bones)) turn(d, name, x, y, z);
  for (const side of ['L', 'R']) {
    const b = d.bones['Lid' + side], r = d.rest['Lid' + side]; if (!b || !r.lid) continue;
    b.quaternion.copy(r.q).multiply(qa.setFromAxisAngle(r.lid, -LID_CLOSED * pose.lids));
  }
}
/** Shared shading inputs: night 0..1 makes the shell glow; time drives its shimmer. */
export function setTurtleShading({night = 0, time = 0} = {}) { shellUniforms.uNight.value = night; shellUniforms.uTime.value = time % 1000; }
