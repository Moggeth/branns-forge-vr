// Skyfire, the streak dragon. A lean, majestic red dragon with a friendly face (big amber eyes that blink, cream horns,
// a golden belly) on huge realistic bat wings: a 31-unit span, 2.3 times its nose-to-tail length (23 m in the game).
// Built in Blender (assets-source/skyfire-dragon/build_skyfire_dragon.py -> /assets/skyfire-dragon.glb): one skinned
// mesh, three materials, 39 bones, a little leather saddle with stirrups and a pennant. Signature features: the golden
// belly plates and the crest spines smoulder and light up in a wave while it breathes fire, and the crest ends in a
// flickering flame-shaped tail tip.
//
// The GLB loads once per page; every dragon is a clone with its own skeleton. Until it arrives (or if it never does)
// buildDragon() returns a tiny procedural stand-in that is swapped for the model in place. Faces +Z, +Y up, origin at
// the centre of the body. animateDragon() poses the bones every frame from the presentation clock: the stroke phase and
// a few lag filters are integrated from the change in t (exact exponential decay, so smooth at any frame rate), and
// everything else is a closed-form function of t. It returns the downstroke power (0..1) of this frame for gusts.
// Presentation only: the host never sees any of this.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {cloneSkinnedAsset} from './clone-skinned-asset.js';

export const DRAGON_SCALE = .75; // wingspan 31 model units = 23 m, nose to tail 13.7 units = 10.3 m
// Where the rider's eyes are (above the saddle at the base of the neck, ahead of the wings) and where the fire leaves the
// mouth (the middle of the open jaw in the breathing pose), both in the dragon's unscaled local space. The seat is fixed
// to the dragon's body frame, not to the neck bone, so head and neck motion never shakes the camera.
export const DRAGON_SEAT = Object.freeze([0, 3.4, 1.65]);
export const DRAGON_MOUTH = Object.freeze([0, .58, 5.8]);

const MODEL_URL = '/assets/skyfire-dragon.glb', TAU = Math.PI * 2;
const clamp01 = x => Math.max(0, Math.min(1, x)), smooth = x => { x = clamp01(x); return x * x * (3 - 2 * x); };
const bump = (x, a, b) => { const u = (x - a) / (b - a); return u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u) ** 2; };

// --- Shading -----------------------------------------------------------------------------------------------------------
// hide: scale tile only where TEXCOORD_1.x says, plus a warm rim. ember: belly plates and crest glow in a wave as the breath
// builds (TEXCOORD_1.y is the position along the wave; -1 is the tail flame). wing: the skin billows along its normal by
// TEXCOORD_1.x (vertex shader, before skinning) and thin skin (TEXCOORD_1.y) glows warm when seen against the sky.
function patchMaterial(material, kind) {
  material.userData.skyfire = {
    uRim: {value: new THREE.Color(kind === 'wing' ? 0xffb070 : 0xff9a66).multiplyScalar(kind === 'wing' ? .3 : .45)},
    uBreath: {value: 0}, uTime: {value: 0}, uIdle: {value: .14}, uBillow: {value: 0}, uEmber: {value: new THREE.Color(0xff4a0a)},
  };
  material.onBeforeCompile = function (shader) {
    Object.assign(shader.uniforms, this.userData.skyfire);
    let vert = shader.vertexShader
      .replace('#include <common>', '#include <common>\n#ifndef USE_UV1\nattribute vec2 uv1;\n#endif\nvarying vec2 vSkyMask;\nuniform float uBillow, uTime;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvSkyMask = uv1;');
    if (kind === 'wing') vert = vert.replace('#include <begin_vertex>',
      '#include <begin_vertex>\ntransformed += objectNormal * uv1.x * (uBillow + 0.025 * sin(uTime * 11.0 + position.x * 0.9 + position.z * 1.3));');
    shader.vertexShader = vert;
    let frag = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vSkyMask;\nuniform vec3 uRim, uEmber; uniform float uBreath, uTime, uIdle;');
    if (kind === 'hide') frag = frag.replace('#include <map_fragment>',
      '#ifdef USE_MAP\n diffuseColor.rgb *= mix(vec3(1.0), texture2D(map, vMapUv).rgb, vSkyMask.x);\n#endif');
    const rim = 'float skyRim = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);';
    if (kind === 'ember') frag = frag.replace('#include <color_fragment>', `#include <color_fragment>
      float along = vSkyMask.y * 2.5 - 1.0, glow, lit = 0.0;
      if (along < -0.5) glow = 0.75 + 0.18 * sin(uTime * 7.0) + 0.12 * sin(uTime * 12.7 + 1.3) + 0.6 * uBreath; // the tail flame
      else {
        float fill = uBreath * 1.55;                                       // the glow climbs as the breath builds
        lit = (1.0 - smoothstep(fill - 0.3, fill, along)) * vSkyMask.x;
        glow = uIdle + 0.06 * sin(uTime * 2.1 - along * 5.0) + lit * (1.4 + 0.45 * sin(uTime * 15.0 - along * 10.0));
      }
      diffuseColor.rgb *= 1.0 - 0.6 * lit;                                 // lit plates read as hot orange, not washed-out gold`)
      .replace('#include <emissivemap_fragment>', `${rim}
      totalEmissiveRadiance = uEmber * glow * vSkyMask.x + uRim * skyRim * 0.6;`);
    else if (kind === 'wing') frag = frag.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      ${rim}
      float thin = clamp(vSkyMask.y * 2.5 - 1.0, 0.0, 1.0);
      totalEmissiveRadiance += uRim * skyRim * (1.0 - thin) + diffuseColor.rgb * vec3(1.0, 0.8, 0.6) * (0.1 + thin * (gl_FrontFacing ? 0.12 : 0.6));`);
    else frag = frag.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${rim}\ntotalEmissiveRadiance += uRim * skyRim;`);
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

// Eye hinge axes (model space), the same as eye_frame() in the builder: a positive turn about k raises a lid edge.
const EYE_K = {};
for (const [s, side] of [[1, 'L'], [-1, 'R']]) {
  const d = new THREE.Vector3(s * .5, .12, .86).normalize(), u = new THREE.Vector3(0, 1, 0).addScaledVector(d, -d.y).normalize();
  EYE_K[side] = new THREE.Vector3().crossVectors(d, u);
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
    rest[name] = {q: bone.quaternion.clone(), p: bone.position.clone(), parentInv, inv,
      x: new THREE.Vector3(1, 0, 0).applyQuaternion(inv), y: new THREE.Vector3(0, 1, 0).applyQuaternion(inv), z: new THREE.Vector3(0, 0, 1).applyQuaternion(inv)};
    if (name.startsWith('Lid')) rest[name].k = EYE_K[name.at(-1)].clone().applyQuaternion(inv);
  }
  // Each dragon owns its ember (breath glow) and wing (billow) materials; the hide material stays shared.
  const own = name => { const m = meshes.find(x => x.material.name === name); if (m) m.material = patchMaterial(m.material.clone(), kindOf(m.material)); return m?.material; };
  const ember = own('SkyfireEmber'), wing = own('SkyfireWing');
  root.userData.dragon = {model: true, bones, rest, meshes, ember, wing, wingMeshes: meshes.filter(m => m.material === wing),
    phase: (root.id % 7) * .9, lastT: null, lagBreath: 0, lagDive: 0, bank: null, bankLag1: 0, bankLag2: 0, seed: (root.id % 13) * 1.7, mode: false, riderWing: null};
  if (root.userData.riding) setRiderView(root, root.userData.riding);
}

// --- The stand-in: a few flat-shaded pieces, used only until the model loads (or offline). ---------------------------
let simple = null;
function buildStandIn(holder) {
  simple ??= {hide: new THREE.MeshStandardMaterial({color: 0xd8432c, flatShading: true}), belly: new THREE.MeshStandardMaterial({color: 0xffc24a, flatShading: true}),
    wing: new THREE.MeshStandardMaterial({color: 0xff7c2e, side: THREE.DoubleSide, flatShading: true}), ball: new THREE.IcosahedronGeometry(1, 1),
    membrane: new THREE.ShapeGeometry(new THREE.Shape([[0, 1], [6.5, .9], [15, -1.6], [11.8, -5], [7.6, -6.6], [0, -3.2]].map(([x, z]) => new THREE.Vector2(x, z)))).rotateX(Math.PI / 2)};
  const piece = (mat, pos, scale) => { const m = new THREE.Mesh(simple.ball, mat); m.position.fromArray(pos); m.scale.fromArray(scale); holder.add(m); return m; };
  piece(simple.hide, [0, 0, 0], [.85, .95, 1.9]); piece(simple.belly, [0, -.35, .2], [.7, .7, 1.6]);
  piece(simple.hide, [0, 1.1, 2.9], [.38, .4, 1.2]); piece(simple.hide, [0, 1.75, 4.8], [.6, .52, .85]); piece(simple.hide, [0, .1, -4.4], [.3, .3, 3.4]);
  const wings = [-1, 1].map(s => { const w = new THREE.Mesh(simple.membrane, simple.wing); w.position.set(s * .55, .8, 1); w.scale.x = s; holder.add(w); return w; });
  return {model: false, wings};
}

export function buildDragon() {
  const root = new THREE.Group(), body = new THREE.Group();
  root.name = 'streakDragon'; body.scale.setScalar(DRAGON_SCALE); root.add(body); root.userData.body = body;
  if (template) attachModel(root);
  else { root.userData.dragon = buildStandIn(body); waiting.add(root); load(); }
  return root;
}

/** How the local rider sees their own dragon. 'saddle' (or true): the camera sits at DRAGON_SEAT, so horns, head crest and
 * brows (right under it) shrink away and the wings go see-through. 'chase': seen from behind and above, everything stays
 * opaque and the crest and belly embers smoulder brighter so the back reads. false: an ordinary dragon. */
export function setRiderView(root, mode) {
  mode = mode === true ? 'saddle' : mode || false;
  root.userData.riding = mode;
  const d = root.userData.dragon; if (!d) return;
  const saddle = mode === 'saddle';
  if (!d.model) { for (const w of d.wings) { w.material = saddle ? (d.riderWing ??= Object.assign(simple.wing.clone(), {transparent: true, opacity: .42, depthWrite: false})) : simple.wing; } return; }
  d.mode = mode;
  for (const name of ['Horns', 'BrowL', 'BrowR']) d.bones[name]?.scale.setScalar(saddle ? 1e-3 : 1);
  if (saddle && !d.riderWing) { d.riderWing = Object.assign(d.wing.clone(), {transparent: true, opacity: .22, depthWrite: false}); d.riderWing.userData.skyfire = d.wing.userData.skyfire; }
  for (const mesh of d.wingMeshes) mesh.material = saddle ? d.riderWing : d.wing;
  if (d.ember) d.ember.userData.skyfire.uIdle.value = mode === 'chase' ? .32 : .14;
}

// Pose one bone: angles in radians about the dragon's own axes (x pitch nose-down, y yaw to its left, z roll left side up).
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion(), off = new THREE.Vector3(), xAxis = new THREE.Vector3();
function turn(d, name, x = 0, y = 0, z = 0) {
  const b = d.bones[name], r = d.rest[name]; if (!b) return;
  b.quaternion.copy(r.q).multiply(qa.setFromAxisAngle(r.y, y)).multiply(qb.setFromAxisAngle(r.z, z)).multiply(qc.setFromAxisAngle(r.x, x));
}
function lid(d, name, edge) { const b = d.bones[name], r = d.rest[name]; if (b) b.quaternion.copy(r.q).multiply(qa.setFromAxisAngle(r.k, edge)); }
// Irregular blinks from t alone: one blink in each 3.5 s cell at a hashed offset (2 to 5 s apart), sometimes a double.
const hash = n => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
const pulse = u => u > 0 && u < .2 ? Math.sin(Math.PI * u / .2) ** 2 : 0;
function blink(t) {
  let c = 0;
  for (const cell of [Math.floor(t / 3.5), Math.floor(t / 3.5) - 1]) { const u = t - cell * 3.5 - hash(cell) * 1.5; c = Math.max(c, pulse(u), hash(cell + .5) > .7 ? pulse(u - .3) : 0); }
  return c;
}

/** Wing beat, glide, sway, breath, dive, arrival, departure and roar. t in seconds; breath, dive, arrive (0 -> 1 over the
 * swoop in, 1 when settled), leave (0 -> 1 during the climb away) and roar are 0..1; beat scales the stroke rate; amp < 1 is
 * calmer (the rider's own dragon); turn is the yaw rate (rad/s, + = to its left) and bank its roll (rad, optional: read from
 * the root when left out). Returns the downstroke power of this frame, 0..1, for gusts. */
export function animateDragon(root, t, {breath = 0, dive = 0, beat = 1, amp = 1, arrive = 1, leave = 0, roar = 0, turn: yawRate = 0, bank} = {}) {
  const d = root.userData.dragon; if (!d) return 0;
  if (!d.model) { // stand-in: a plain sine flap
    const flap = amp * Math.sin(t * 5 * beat), fold = clamp01(dive * 1.3);
    for (const w of d.wings) { const s = w.scale.x; w.rotation.z = s * ((.15 + .55 * flap) * (1 - fold) - .25 * fold); w.rotation.y = s * .5 * fold; }
    return clamp01(Math.cos(t * 5 * beat)) * amp * (1 - fold);
  }
  let dt = d.lastT === null ? 0 : t - d.lastT; d.lastT = t;
  if (!(dt > 0)) dt = 0; else if (dt > .25) dt = .25;
  const climb = Math.max(1 - clamp01(arrive), clamp01(leave)), turnAmt = clamp01(Math.abs(yawRate) / .9);
  // Integrated stroke phase (a changing beat never makes the wings jump), about 0.85 Hz cruising, faster climbing.
  d.phase = (d.phase + dt * TAU * .85 * beat * (1 + .2 * climb + .1 * turnAmt)) % TAU;
  d.lagBreath += (breath - d.lagBreath) * (1 - Math.exp(-dt * 3.2));
  d.lagDive += (dive - d.lagDive) * (1 - Math.exp(-dt * 2.4));
  // Bank (from the option, or the root's own roll) through two lags: the head follows the body's lean late, like a spring.
  if (bank === undefined) { xAxis.set(1, 0, 0).applyQuaternion(root.quaternion); bank = Math.asin(Math.max(-1, Math.min(1, xAxis.y))); }
  if (d.bank === null) d.bankLag1 = d.bankLag2 = bank;
  d.bank = bank; d.bankLag1 += (bank - d.bankLag1) * (1 - Math.exp(-dt * 4)); d.bankLag2 += (d.bankLag1 - d.bankLag2) * (1 - Math.exp(-dt * 4));
  const ph = d.phase, fold = smooth(dive * 1.15), lag = d.lagDive;
  // Bursts of beats and long glides while cruising; climbing, turning and roaring keep it beating.
  const cruise = .6 * Math.sin(t * .37 + d.seed) + .4 * Math.sin(t * .23 + 2 * d.seed);
  const glide = smooth((cruise - .05) / .45) * (1 - climb) * (1 - turnAmt) * (1 - roar);
  d.glide = glide;
  const A = amp * (1 - .9 * glide) * (1 - fold) * (1 - .5 * breath) * (1 - .8 * roar) * (1 + .35 * climb);
  // Fast downstroke that cups the air, slower upstroke with the wing half folded: x runs 0..pi through the downstroke in
  // about 38% of the cycle. down/up are the stroke speeds (0..1) in each half.
  const x = ph + .45 * (1 - Math.cos(ph)), down = Math.max(0, Math.sin(x)), up = Math.max(0, -Math.sin(x));
  let power = 0;
  for (const [s, side] of [[1, 'L'], [-1, 'R']]) {
    const Ae = A * (1 + .45 * Math.max(-1, Math.min(1, -s * yawRate / .9))); // the outer wing beats harder in a turn
    const spread = .35 * roar, sweep = .5 * (1 - clamp01(arrive)) ** 2;     // roar spreads the wings; the swoop-in sweeps them back
    turn(d, 'WingArm' + side, 0, s * (.85 * fold + sweep - .16 * Ae * down), s * (.05 + .1 * glide * amp + Ae * (.62 * Math.cos(x) + .1) + .32 * fold + spread));
    turn(d, 'WingFore' + side, 0, s * (1.35 * fold + .32 * Ae * up + .3 * sweep), s * (Ae * (.2 * Math.cos(x - .5) - .2 * up) - .15 * fold + .04 * glide));
    for (const [k, close] of [[1, .5], [2, .35], [3, .2]]) {
      const feather = -Ae * .28 * up * (1.2 - k * .2), flex = .24 * Ae * down * (1.15 - .1 * k);
      turn(d, `WingF${k}${side}`, feather, s * (close * fold + (.3 - .07 * k) * Ae * up), s * (Ae * (.17 + .03 * k) * Math.cos(x - 1.0 - .1 * k) + flex - .12 * Ae * up + .03 * glide));
    }
    power += .5 * clamp01(Ae) * down ** 1.5;
  }
  if (d.wing) { const u = d.wing.userData.skyfire; u.uBillow.value = .1 * glide * amp + .4 * A * down - .2 * A * up + .08 * roar; u.uTime.value = t % 1000; }
  // Body: rises on the downstroke and pitches a little; the neck and head counter it so the face stays steady (weight).
  const steady = 1 - .85 * breath, bob = -.16 * A * Math.cos(x - .5), pitch = .05 * A * Math.sin(x - .8) * steady;
  const climbPitch = -.22 * clamp01(leave) + .08 * (1 - clamp01(arrive));
  const body = d.bones.Body, rb = d.rest.Body;
  if (body) { body.position.copy(rb.p).add(off.set(0, bob, 0).applyQuaternion(rb.parentInv)); turn(d, 'Body', pitch + .05 * lag + climbPitch); }
  turn(d, 'Chest', .5 * pitch);
  // Breath: a quick rear-back while the breath builds (anticipation), then the neck thrusts the open jaw forward and down;
  // when it stops the head wobbles and settles. Arrival ends in a happy head toss; a roar rears the head back, jaw wide.
  const rear = clamp01(breath - d.lagBreath) * 1.6, settle = clamp01(d.lagBreath - breath), quiet = (1 - breath) * (1 - roar);
  const toss = bump(arrive, .72, 1), carry = d.mode === 'saddle' ? .2 * quiet : 0; // the rider's own dragon carries its head lower
  const lookYaw = .13 * Math.sin(t * .53 + d.seed) * quiet + .25 * yawRate * (1 - breath), lookPitch = .06 * Math.sin(t * .71 + d.seed) * quiet;
  const lean = Math.max(-.5, Math.min(.5, d.bank - d.bankLag2));
  turn(d, 'Neck1', -.9 * pitch + .08 * breath - .22 * rear + .1 * fold + carry - .3 * roar - .6 * climbPitch, .35 * lookYaw, .3 * lean);
  turn(d, 'Neck2', .07 * A * Math.cos(x - 1.2) * steady + .06 * breath - .12 * rear + .07 * fold + .5 * carry - .2 * roar, .35 * lookYaw, .3 * lean);
  turn(d, 'Neck3', .05 * breath + .03 * Math.sin(t * .9) * quiet - .1 * roar, .3 * lookYaw);
  turn(d, 'Head', -.35 * pitch - .2 * rear - .17 * fold - .4 * carry + lookPitch + .12 * settle * Math.sin(t * 11) - .35 * roar - .4 * toss - .3 * climbPitch,
    lookYaw * .6, .05 * Math.sin(t * .37 + d.seed) * quiet + .25 * toss * Math.sin(t * 6) + .5 * lean);
  turn(d, 'Jaw', .45 * breath + .25 * rear + .75 * roar + .2 * toss + .05 * Math.max(0, Math.sin(t * .8 + d.seed)) ** 6);
  for (const [s, side] of [[1, 'L'], [-1, 'R']]) turn(d, 'Brow' + side, 0, 0, s * (.2 * Math.max(breath, rear) - .07 * quiet - .15 * Math.max(roar, fold, toss) + .03 * Math.sin(t * .6)));
  // Eyes: irregular blinks, a half-lidded squint while breathing fire, wide open in the dive and the roar.
  const shut = Math.max(blink(t + d.seed * 3), .5 * breath), wide = .3 * Math.max(fold, roar, toss), open = 1 - shut;
  for (const side of ['L', 'R']) { lid(d, 'LidU' + side, -.12 + 1.07 * open + wide); lid(d, 'LidL' + side, -.12 - .78 * open - .15 * wide); }
  // Tail: a slow swish travelling down the chain, the stroke's wave arriving later at each link, a flick as it leaves.
  const flick = bump(leave, 0, .45);
  for (let i = 1; i <= 6; i++) {
    const loose = 1 - .75 * lag;
    turn(d, 'Tail' + i, (.07 * A * Math.cos(x - 1.6 - i * .45) - .04 * lag + .03 * climbPitch) * loose,
      ((.05 + .02 * i) * Math.sin(t * 1.05 - i * .55 + d.seed) + .1 * i * flick * Math.sin(t * 9 - i * .7) - .08 * yawRate) * loose);
  }
  // Legs dangle as it arrives and tuck up as it settles; tucked back in the dive.
  const dangle = -.45 * (1 - clamp01(arrive)) ** 1.5;
  for (const side of ['L', 'R']) { turn(d, 'LegF' + side, .12 * A * Math.cos(x - 2) + .55 * lag + dangle); turn(d, 'LegH' + side, .1 * A * Math.cos(x - 2.3) + .45 * lag + dangle); }
  // Saddle: stirrups swing, the pennant flutters.
  for (const [s, side] of [[1, 'L'], [-1, 'R']]) turn(d, 'Stirrup' + side, .2 * A * Math.cos(x - 1.5) + .06 * Math.sin(t * 2.1 + s), 0, s * .08 * Math.sin(t * 1.7 + s));
  turn(d, 'Flag1', .05 * Math.sin(t * 5.1), .28 * Math.sin(t * 7.3 + d.seed) + .1 * Math.sin(t * 13.1));
  turn(d, 'Flag2', .08 * Math.sin(t * 6.2 - .7), .45 * Math.sin(t * 7.3 + d.seed - 1.1) + .15 * Math.sin(t * 15.7));
  if (d.ember) { const u = d.ember.userData.skyfire; u.uBreath.value = Math.max(breath, .6 * roar); u.uTime.value = t % 1000; }
  return clamp01(power);
}
