// Skyfire, the streak dragon (level 2). A chubby-but-powerful red dragon with a golden belly, big amber eyes, cream
// horns, a golden crest and orange bat wings, built in Blender (assets-source/skyfire-dragon/build_skyfire_dragon.py ->
// /assets/skyfire-dragon.glb): one skinned mesh, three materials, 31 bones. Signature features: the golden belly plates
// smoulder and light up in a wave that runs up the throat into the open jaw while it breathes fire, and the crest ends
// in a glowing flame-shaped tail tip.
//
// The GLB loads once per page; every dragon is a clone with its own skeleton. Until it arrives (or if it never does)
// buildDragon() returns a tiny procedural stand-in that is swapped for the model in place. Faces +Z, +Y up, origin at
// the centre of the body. animateDragon() poses the bones every frame from the presentation clock: the stroke phase and
// a few lag filters are integrated from the change in t (exact exponential decay, so smooth at any frame rate).
// Presentation only: the host never sees any of this.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {cloneSkinnedAsset} from './clone-skinned-asset.js';

export const DRAGON_SCALE = 1.15; // wingspan 12.8 model units = 14.7 m
// Where the rider sits (above the base of the neck, ahead of the wings, so the view forward and down is clear) and
// where the fire leaves the mouth (the jaw tip in the breathing pose), both in the dragon's unscaled local space.
// The seat is fixed to the dragon's body frame, not to the neck bone, so head and neck motion never shakes the camera.
export const DRAGON_SEAT = Object.freeze([0, 3.35, 2.15]);
export const DRAGON_MOUTH = Object.freeze([0, .45, 4.85]);

const MODEL_URL = '/assets/skyfire-dragon.glb', TAU = Math.PI * 2;
const clamp01 = x => Math.max(0, Math.min(1, x)), smooth = x => { x = clamp01(x); return x * x * (3 - 2 * x); };

// --- Shading: scale tile only where the mask says, a warm rim so it separates from the sky, and the ember glow. -----
function patchMaterial(material, kind) {
  material.userData.skyfire = {
    uRim: {value: new THREE.Color(kind === 'wing' ? 0xffb070 : 0xff9a66).multiplyScalar(kind === 'wing' ? .35 : .45)},
    uBreath: {value: 0}, uTime: {value: 0}, uEmber: {value: new THREE.Color(0xff4a0a)},
  };
  material.onBeforeCompile = function (shader) {
    Object.assign(shader.uniforms, this.userData.skyfire);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n#ifndef USE_UV1\nattribute vec2 uv1;\n#endif\nvarying vec2 vSkyMask;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvSkyMask = uv1;');
    let frag = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vSkyMask;\nuniform vec3 uRim, uEmber; uniform float uBreath, uTime;');
    if (kind === 'hide') frag = frag.replace('#include <map_fragment>',
      '#ifdef USE_MAP\n diffuseColor.rgb *= mix(vec3(1.0), texture2D(map, vMapUv).rgb, vSkyMask.x);\n#endif');
    const rim = 'float skyRim = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);';
    if (kind === 'ember') frag = frag.replace('#include <color_fragment>', `#include <color_fragment>
      float along = vSkyMask.y * 2.5 - 1.0, glow, lit = 0.0;
      if (along < -0.5) glow = 0.75 + 0.18 * sin(uTime * 7.0) + 0.12 * sin(uTime * 12.7 + 1.3) + 0.6 * uBreath; // the tail flame
      else {
        float fill = uBreath * 1.55;                                       // the glow climbs from chest to jaw as the breath builds
        lit = (1.0 - smoothstep(fill - 0.3, fill, along)) * vSkyMask.x;
        glow = 0.14 + 0.06 * sin(uTime * 2.1 - along * 5.0) + lit * (1.4 + 0.45 * sin(uTime * 15.0 - along * 10.0));
      }
      diffuseColor.rgb *= 1.0 - 0.6 * lit;                                 // lit plates read as hot orange, not washed-out gold`)
      .replace('#include <emissivemap_fragment>', `${rim}
      totalEmissiveRadiance = uEmber * glow * vSkyMask.x + uRim * skyRim * 0.6;`);
    else frag = frag.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${rim}\ntotalEmissiveRadiance += uRim * skyRim${kind === 'wing' ? ' + diffuseColor.rgb * 0.16' : ''};`);
    shader.fragmentShader = frag;
  };
  material.customProgramCacheKey = () => 'skyfire-' + kind;
  return material;
}
const kindOf = material => material.name === 'SkyfireEmber' ? 'ember' : material.name === 'SkyfireWing' ? 'wing' : 'hide';

// --- Loading: once per page, then every waiting dragon swaps its stand-in for a clone. -------------------------------
let template = null, loading = null;
const waiting = new Set();
function load() {
  if (loading || typeof window === 'undefined') return;
  loading = new GLTFLoader().loadAsync(MODEL_URL).then(gltf => {
    const scene = gltf.scene;
    scene.traverse(o => { if (o.isMesh) { patchMaterial(o.material, kindOf(o.material)); o.castShadow = o.receiveShadow = false; } });
    template = scene;
    for (const root of waiting) attachModel(root);
  }).catch(error => console.warn('Skyfire model unavailable; flying the simple dragon.', error)).finally(() => waiting.clear());
}

function attachModel(root) {
  const holder = root.userData.body;
  holder.clear();
  const model = cloneSkinnedAsset(template); holder.add(model);
  const bones = {}, rest = {}, meshes = [];
  model.traverse(o => { if (o.isBone) bones[o.name] = o; if (o.isMesh) { meshes.push(o); o.frustumCulled = false; } });
  for (const [name, bone] of Object.entries(bones)) {
    // Rest orientation in the model frame, so each pose angle is about the dragon's own X (pitch), Y (yaw), Z (roll).
    const world = bone.quaternion.clone(); let p = bone.parent;
    while (p && p !== model) { world.premultiply(p.quaternion); p = p.parent; }
    const inv = world.clone().invert(), parentInv = world.clone().multiply(bone.quaternion.clone().invert()).invert();
    rest[name] = {q: bone.quaternion.clone(), p: bone.position.clone(), parentInv,
      x: new THREE.Vector3(1, 0, 0).applyQuaternion(inv), y: new THREE.Vector3(0, 1, 0).applyQuaternion(inv), z: new THREE.Vector3(0, 0, 1).applyQuaternion(inv)};
  }
  // Breath drives this dragon's own ember material; the wing material is shared until the rider needs a see-through copy.
  const ember = meshes.find(m => m.material.name === 'SkyfireEmber');
  if (ember) ember.material = patchMaterial(ember.material.clone(), 'ember');
  root.userData.dragon = {model: true, bones, rest, meshes, ember: ember?.material, wings: meshes.filter(m => m.material.name === 'SkyfireWing'),
    phase: (root.id % 7) * .9, lastT: null, lagBreath: 0, lagDive: 0, seed: (root.id % 13) * 1.7, riding: false, riderWing: null, sharedWing: null};
  if (root.userData.riding) setRiderView(root, true);
}

// --- The stand-in: a few flat-shaded pieces, used only until the model loads (or offline). ---------------------------
let simple = null;
function buildStandIn(holder) {
  simple ??= {hide: new THREE.MeshStandardMaterial({color: 0xd8432c, flatShading: true}), belly: new THREE.MeshStandardMaterial({color: 0xffc24a, flatShading: true}),
    wing: new THREE.MeshStandardMaterial({color: 0xff7c2e, side: THREE.DoubleSide, flatShading: true}), ball: new THREE.IcosahedronGeometry(1, 1),
    membrane: new THREE.ShapeGeometry(new THREE.Shape([[0, .6], [3.8, 1.0], [6.4, -.3], [5.3, -1.8], [3.4, -2.6], [0, -1.6]].map(([x, z]) => new THREE.Vector2(x, z)))).rotateX(Math.PI / 2)};
  const piece = (mat, pos, scale) => { const m = new THREE.Mesh(simple.ball, mat); m.position.fromArray(pos); m.scale.fromArray(scale); holder.add(m); return m; };
  piece(simple.hide, [0, 0, 0], [1.1, 1.05, 1.9]); piece(simple.belly, [0, -.35, .2], [.9, .75, 1.6]);
  piece(simple.hide, [0, 1.0, 2.5], [.45, .45, .9]); piece(simple.hide, [0, 1.55, 3.9], [.6, .52, .85]); piece(simple.hide, [0, .1, -3.6], [.4, .35, 2.6]);
  const wings = [-1, 1].map(s => { const w = new THREE.Mesh(simple.membrane, simple.wing); w.position.set(s * .7, .75, .9); w.scale.x = s; holder.add(w); return w; });
  return {model: false, wings};
}

export function buildDragon() {
  const root = new THREE.Group(), body = new THREE.Group();
  root.name = 'streakDragon'; body.scale.setScalar(DRAGON_SCALE); root.add(body); root.userData.body = body;
  if (template) attachModel(root);
  else { root.userData.dragon = buildStandIn(body); waiting.add(root); load(); }
  return root;
}

/** The rider's own dragon: horns, head crest and brows (right under the camera) shrink away and the wings go see-through. */
export function setRiderView(root, riding) {
  root.userData.riding = riding;
  const d = root.userData.dragon; if (!d) return;
  if (!d.model) { for (const w of d.wings) { w.material = riding ? (d.riderWing ??= Object.assign(simple.wing.clone(), {transparent: true, opacity: .42, depthWrite: false})) : simple.wing; } return; }
  d.riding = riding;
  for (const name of ['Horns', 'BrowL', 'BrowR']) d.bones[name]?.scale.setScalar(riding ? 1e-3 : 1);
  for (const mesh of d.wings) {
    d.sharedWing ??= mesh.material;
    if (riding && !d.riderWing) d.riderWing = Object.assign(patchMaterial(d.sharedWing.clone(), 'wing'), {transparent: true, opacity: .4, depthWrite: false});
    mesh.material = riding ? d.riderWing : d.sharedWing;
  }
}

// Pose one bone: angles in radians about the dragon's own axes (x pitch nose-down, y yaw to its left, z roll left side up).
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion(), off = new THREE.Vector3();
function turn(d, name, x = 0, y = 0, z = 0) {
  const b = d.bones[name], r = d.rest[name]; if (!b) return;
  b.quaternion.copy(r.q).multiply(qa.setFromAxisAngle(r.y, y)).multiply(qb.setFromAxisAngle(r.z, z)).multiply(qc.setFromAxisAngle(r.x, x));
}

/** Wing beat, glide, sway, breath and dive. t in seconds; breath 0..1; dive 0..1 folds the wings into a stoop; beat scales the
 * stroke rate; amp < 1 is calmer and shallower (the rider's own dragon). */
export function animateDragon(root, t, {breath = 0, dive = 0, beat = 1, amp = 1} = {}) {
  const d = root.userData.dragon; if (!d) return;
  if (!d.model) { // stand-in: a plain sine flap
    const flap = amp * Math.sin(t * 2.6 * beat), fold = clamp01(dive * 1.3);
    for (const w of d.wings) { const s = w.scale.x; w.rotation.z = s * ((.15 + .55 * flap) * (1 - fold) - .25 * fold); w.rotation.y = s * .5 * fold; }
    return;
  }
  let dt = d.lastT === null ? 0 : t - d.lastT; d.lastT = t;
  if (!(dt > 0)) dt = 0; else if (dt > .25) dt = .25;
  // Integrated stroke phase (a changing beat never makes the wings jump) and lagging copies of breath and dive.
  d.phase = (d.phase + dt * TAU * .44 * beat) % TAU;
  d.lagBreath += (breath - d.lagBreath) * (1 - Math.exp(-dt * 3.2));
  d.lagDive += (dive - d.lagDive) * (1 - Math.exp(-dt * 2.4));
  const ph = d.phase, fold = smooth(dive * 1.15), lag = d.lagDive;
  // Mostly flapping, with a lazy glide now and then; diving folds the stroke away.
  const glide = smooth((Math.sin(t * .29 + d.seed) - .35) / .5);
  const A = amp * (1 - .82 * glide) * (1 - fold) * (1 - .55 * breath); // breathing fire, it hangs on spread wings
  // Fast down-stroke, slower up-stroke: x runs 0..pi through the down-stroke in about 40% of the cycle.
  const x = ph + .35 * (1 - Math.cos(ph)), stroke = k => Math.cos(x - k);
  // Wings: the arm leads, the forearm and fingers follow later and further (follow-through), feathering on the up-stroke.
  for (const [s, side] of [[1, 'L'], [-1, 'R']]) {
    turn(d, 'WingArm' + side, 0, s * (.85 * fold - .12 * A * Math.sin(x)), s * (.1 + .14 * glide * amp + A * (.56 * stroke(0) + .08) + .32 * fold));
    turn(d, 'WingFore' + side, 0, s * 1.35 * fold, s * (A * .3 * stroke(.55) - .15 * fold + .04 * glide));
    const feather = -A * .2 * Math.max(0, -Math.sin(x - .7));
    for (const [k, spread] of [[1, .5], [2, .35], [3, .2]]) turn(d, `WingF${k}${side}`, feather * (1.2 - k * .2), s * spread * fold, s * (A * (.34 + .04 * k) * stroke(1.0 + .1 * k) + .03 * glide));
  }
  // Body: rises on the down-stroke and pitches a little; the neck and head counter it so the face stays steady (weight).
  const steady = 1 - .85 * breath, bob = -.1 * A * Math.cos(x - .45), pitch = .045 * A * Math.sin(x - .8) * steady;
  const body = d.bones.Body, rb = d.rest.Body;
  if (body) { body.position.copy(rb.p).add(off.set(0, bob, 0).applyQuaternion(rb.parentInv)); turn(d, 'Body', pitch + .05 * lag); }
  turn(d, 'Chest', .5 * pitch);
  // Breath: a quick rear-back while the breath builds (anticipation), then the neck thrusts the open jaw forward and down;
  // when it stops the head wobbles and settles as the lagging copy catches up.
  const rear = clamp01(breath - d.lagBreath) * 1.6, settle = clamp01(d.lagBreath - breath), quiet = 1 - breath;
  const carry = d.riding ? .2 * quiet : 0; // the rider's own dragon carries its head a little lower, below the aim point
  const lookYaw = .13 * Math.sin(t * .53 + d.seed) * quiet, lookPitch = .06 * Math.sin(t * .71 + d.seed) * quiet;
  turn(d, 'Neck1', -.9 * pitch + .08 * breath - .22 * rear + .1 * fold + carry, .35 * lookYaw);
  turn(d, 'Neck2', .06 * A * Math.cos(x - 1.2) * steady + .06 * breath - .12 * rear + .07 * fold + .5 * carry, .35 * lookYaw);
  turn(d, 'Neck3', .05 * breath + .03 * Math.sin(t * .9) * quiet, .3 * lookYaw);
  turn(d, 'Head', -.35 * pitch - .2 * rear - .17 * fold - .4 * carry + lookPitch + .12 * settle * Math.sin(t * 11), lookYaw * .6, .05 * Math.sin(t * .37 + d.seed) * quiet);
  turn(d, 'Jaw', .45 * breath + .25 * rear + .05 * Math.max(0, Math.sin(t * .8 + d.seed)) ** 6);
  for (const [s, side] of [[1, 'L'], [-1, 'R']]) turn(d, 'Brow' + side, 0, 0, s * (.2 * Math.max(breath, rear) - .07 * quiet + .03 * Math.sin(t * .6)));
  // Tail: a slow swish that travels down the chain, plus the stroke's wave arriving later at each link; straight in a dive.
  for (let i = 1; i <= 6; i++) {
    const loose = 1 - .75 * lag;
    turn(d, 'Tail' + i, (.06 * A * Math.cos(x - 1.6 - i * .45) - .04 * lag + .02 * i * glide * .5) * loose, (.06 + .02 * i) * Math.sin(t * 1.05 - i * .55 + d.seed) * loose);
  }
  // Legs tuck back in the dive and dangle a little behind the stroke.
  for (const side of ['L', 'R']) { turn(d, 'LegF' + side, .12 * A * Math.cos(x - 2) + .55 * lag); turn(d, 'LegH' + side, .1 * A * Math.cos(x - 2.3) + .45 * lag); }
  if (d.ember) { const u = d.ember.userData.skyfire; u.uBreath.value = breath; u.uTime.value = t % 1000; }
}
