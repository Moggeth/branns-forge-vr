// The Stormspire's lizard crew (Mitch, 2026-10-06: "populated by lizards"; 2026-10-07: "make sure the lizards get a
// graphical and animation uplift - they're so cute and I love them"). Level 2, after Mitch's concept sheet
// "03 · VOLTNEWT": a chunky teal newt with a toothy grin, orange back spikes, a yellow hard hat, a medic chest harness,
// black boots, glowing blue veins and a red power cable plugged into a socket on its back
// (assets-source/stormspire-lizards -> /assets/stormspire-lizard.glb). Three of them look after every tower:
//   Sparky   (teal)    scurries up and down the copper coil, plugged into it, stopping to tap or zap the windings
//   Sprocket (jade)    minds the crystal hopper with a little wrench and the odd zapping bite, plugged into the plinth
//   Snooze   (lagoon)  naps on the copper torus brim, hard hat tipped over his eyes, snoring z's
// All three cheer whenever the tower is charged: they charge up (eyes squeezed shut, cheeks puffed, veins crackling),
// then hop with their arms up and a big toothy grin.
//
// One shared skinned geometry and one 256 x 144 atlas (palette rows + a vein tile); one material per lizard (its own
// vein-glow uniform, one shared shader program). Every lizard is a SkeletonUtils clone with its own AnimationMixer
// (clips idle, climb, cheer, nap, tinker, bite) driven by the frame dt passed to update(), with crossfades and
// procedural layers on top: random blinks, a head and eye look-at (at the viewer when they are close, otherwise at
// crewmates), flickering veins that flare while charging or biting, z's that face the camera, and a cable that runs
// from the socket stub to wherever the newt is plugged in. Until the GLB arrives (or if it never does) each lizard is a
// small primitive stand-in that is swapped for the model in place. Presentation only; writes nothing back.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {cloneSkinnedAsset} from './clone-skinned-asset.js';

const MODEL_URL = '/assets/stormspire-lizard.glb';
// Tower geometry in the glTF frame (assets-source/stormreel build_tower TW): shaft radius .95 -> .68 from y .85 to 5.0;
// the coil winds 9 turns from y 1.2 to 4.65, .09 proud of the stone. Hopper bowl at (0, .78..1.1, -1.62); the plinth
// step top is at y .78, radius 1.12..1.18; the copper torus brim (radius 1.12, tube .14) is centred at y 5.35.
const TW = Object.freeze({r0: .95, r1: .68, y0: .85, y1: 5, coil0: 1.2, coil1: 4.65, turns: 9, phase: Math.PI / 2 + .25});
const shaftR = y => TW.r0 + (TW.r1 - TW.r0) * (y - TW.y0) / (TW.y1 - TW.y0);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const bump = (x, a, b, c, d) => x < a || x > d ? 0 : x < b ? (x - a) / (b - a) : x < c ? 1 : 1 - (x - c) / (d - c);

// Atlas layout (must match the builder): rows of 4 px per look at the bottom (Blender) of a 144 px tall image.
const TEX_H = 144, ROW = 4 / TEX_H;
export const LIZARD_LOOKS = Object.freeze([
  {name: 'Sparky', row: 0}, {name: 'Sprocket', row: 1}, {name: 'Snooze', row: 2},
]);

// --- Shading: palette row per look, glowing veins from the atlas tile (TEXCOORD_1), a soft warm rim so they separate
// from stone and sky, and a little self-light on the eye whites and catch-lights so the eyes sparkle in shadow. ------
const SLOT0 = 96 / 256, SLOT_W = 6 / 256, SLOTS = ['eye', 'iris', 'pupil', 'mouth', 'tongue', 'tooth', 'hat', 'hat_dark', 'bolt', 'spike', 'spike_tip', 'harness',
  'strap', 'buckle', 'badge', 'cross', 'brass', 'steel', 'cable', 'boot', 'claw', 'zzz', 'line', 'highlight', 'nostril', 'blush'];
const band = (name, k) => { const a = SLOT0 + SLOT_W * SLOTS.indexOf(name); return `${k} * step(${a.toFixed(5)}, vMapUv.x) * step(vMapUv.x, ${(a + SLOT_W).toFixed(5)})`; };
function patchMaterial(material) {
  const lz = material.userData.lz = {uLzVein: {value: .6}, uLzTime: {value: 0}};
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, lz);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n#ifndef USE_UV1\nattribute vec2 uv1;\n#endif\nvarying vec2 vLzVein;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvLzVein = uv1;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vLzVein;\nuniform float uLzVein, uLzTime;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float lzRim = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
      float lzGlow = ${band('eye', '0.2')} + ${band('highlight', '0.9')} + ${band('zzz', '0.7')} + ${band('badge', '0.12')};
      totalEmissiveRadiance += diffuseColor.rgb * lzGlow + vec3(1.0, 0.86, 0.62) * lzRim * 0.2;
      if (vLzVein.x > -100.0) {
        vec2 lzF = clamp(fract(vLzVein), 0.004, 0.996);
        float lzV = texture2D(map, vec2(lzF.x * 0.5, lzF.y * (128.0 / 144.0))).r;
        // far away the fine veins would only sparkle: fade them into an even blue fizz instead
        float lzFar = clamp((length(fwidth(vLzVein)) - 0.06) * 6.0, 0.0, 1.0);
        lzV = mix(lzV * lzV, 0.07, lzFar);
        float lzFlick = 0.62 + 0.38 * sin(uLzTime * 6.0 + vLzVein.x * 11.0) * sin(uLzTime * 2.3 - vLzVein.y * 7.0 + 1.3);
        totalEmissiveRadiance += vec3(0.12, 0.55, 1.0) * lzV * uLzVein * lzFlick;
      }`);
  };
  material.customProgramCacheKey = () => 'stormspire-voltnewt';
  return material;
}

// --- Loading: once per page, then every waiting crew swaps its stand-ins for clones. --------------------------------
let template = null, loading = null;
const waiting = new Set();
function load() {
  if (loading || typeof window === 'undefined') return loading;
  loading = new GLTFLoader().loadAsync(MODEL_URL).then(gltf => {
    let mesh = null; gltf.scene.traverse(o => { if (o.isSkinnedMesh) mesh = o; });
    if (!mesh || !gltf.animations.length) throw new Error('lizard GLB has no skinned mesh or clips');
    const map = mesh.material.map;
    if (map) { map.minFilter = map.magFilter = THREE.LinearFilter; map.generateMipmaps = false; map.needsUpdate = true; }
    const maps = LIZARD_LOOKS.map(look => { if (!map) return null; const m = map.clone(); m.offset.set(0, -look.row * ROW); m.needsUpdate = true; return m; });
    // Rest orientation of every bone relative to the model root, so procedural turns are about the newt's own axes.
    const rest = {};
    gltf.scene.updateMatrixWorld(true);
    const rootInv = gltf.scene.matrixWorld.clone().invert(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    gltf.scene.traverse(o => {
      if (!o.isBone) return;
      m4.multiplyMatrices(rootInv, o.matrixWorld).decompose(p, q, s);
      const inv = q.clone().invert();
      rest[o.name] = {q: o.quaternion.clone(), x: new THREE.Vector3(1, 0, 0).applyQuaternion(inv), y: new THREE.Vector3(0, 1, 0).applyQuaternion(inv)};
    });
    template = {scene: gltf.scene, clips: Object.fromEntries(gltf.animations.map(c => [c.name, c])), base: mesh.material, maps, rest};
    for (const crew of waiting) crew.upgrade();
  }).catch(error => console.warn('Lizard crew model unavailable; keeping the simple lizards.', error)).finally(() => waiting.clear());
  return loading;
}
function lizardMaterial(look) {
  const m = patchMaterial(template.base.clone()); m.name = `Voltnewt_${LIZARD_LOOKS[look].name}`; m.roughness = .5; m.metalness = 0;
  if (template.maps[look]) m.map = template.maps[look];
  return m;
}

// --- The stand-in: chunky primitive lizards, used only until the model loads (or offline). -------------------------
let kit = null;
function lizardKit() {
  if (kit) return kit;
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({color, roughness: .6, metalness: 0, ...extra});
  kit = {
    skin: mat(0x1f9f9c), belly: mat(0xe6e1b8), eye: mat(0xffffff, {roughness: .3}), pupil: mat(0x1a1a1a, {roughness: .3}), hat: mat(0xffc61f, {roughness: .45}),
    body: new THREE.SphereGeometry(1, 10, 8), tail: new THREE.ConeGeometry(.055, .32, 7).rotateX(Math.PI / 2).translate(0, 0, .16),
    leg: new THREE.CylinderGeometry(.018, .022, .1, 5).translate(0, -.05, 0), eyeBall: new THREE.SphereGeometry(.034, 8, 6), dome: new THREE.SphereGeometry(.07, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
  };
  return kit;
}
/** One stand-in lizard, about 0.5 m nose to tail. Local frame: -Z forward, +Y up, origin at the belly. */
function makeStandIn() {
  const k = lizardKit(), g = new THREE.Group(), part = (geo, m, pos, scale, parent = g) => { const n = new THREE.Mesh(geo, m); n.position.fromArray(pos); if (scale) n.scale.fromArray(scale); n.castShadow = true; n.raycast = () => {}; n.userData.ignoreContact = true; parent.add(n); return n; };
  part(k.body, k.skin, [0, .055, 0], [.075, .055, .13]);
  part(k.body, k.belly, [0, .035, 0], [.065, .035, .11]);
  const head = new THREE.Group(); head.position.set(0, .085, -.13); g.add(head);
  part(k.body, k.skin, [0, 0, 0], [.068, .05, .075], head);
  for (const x of [-.04, .04]) { part(k.eyeBall, k.eye, [x, .04, -.02], null, head); part(k.eyeBall, k.pupil, [x * 1.05, .048, -.048], [.45, .45, .45], head); }
  part(k.dome, k.hat, [0, .06, .01], [1, .8, 1.05], head); part(k.body, k.hat, [0, .062, -.005], [.085, .008, .09], head);
  const tail = part(k.tail, k.skin, [0, .05, .11]);
  const legs = [[-.07, -.07], [.07, -.07], [-.07, .07], [.07, .07]].map(([x, z]) => { const l = part(k.leg, k.skin, [x, .06, z]); l.rotation.z = x < 0 ? .9 : -.9; return l; });
  return {group: g, head, tail, legs};
}
function wiggle(s, t, speed, amount) {
  s.tail.rotation.y = Math.sin(t * speed * .5) * .5 * amount + Math.sin(t * 1.3) * .15;
  s.head.rotation.y = Math.sin(t * speed * .5 + 1) * .12 * amount;
  s.legs.forEach((leg, i) => { leg.rotation.x = Math.sin(t * speed + (i === 0 || i === 3 ? 0 : Math.PI)) * .7 * amount; });
}

// --- Where the viewer is: captured for free as the lizards draw (their mesh sees the camera that renders it). ------
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const viewer = {pos: new THREE.Vector3(), quat: new THREE.Quaternion(), frame: -1, seen: 0};
let frameNo = 0;
function captureViewer(renderer, scene, camera) {
  if (viewer.frame === frameNo) return;
  viewer.frame = frameNo; viewer.seen = frameNo;
  camera.matrixWorld.decompose(viewer.pos, viewer.quat, _s);
}

// --- The power cable: a short tube from the socket stub's tip to the plug-in point, rebuilt in place each frame. ----
const CABLE_SEG = 12, CABLE_SIDES = 6, CABLE_R = .0095;
let cableMat = null, cableIndex = null;
function makeCable() {
  cableMat ??= new THREE.MeshStandardMaterial({color: 0xd8402e, roughness: .45, metalness: 0});
  if (!cableIndex) {
    const idx = [];
    for (let i = 0; i < CABLE_SEG; i++) for (let k = 0; k < CABLE_SIDES; k++) {
      const a = i * CABLE_SIDES + k, b = i * CABLE_SIDES + (k + 1) % CABLE_SIDES, c = a + CABLE_SIDES, d = b + CABLE_SIDES;
      idx.push(a, c, b, b, c, d);
    }
    cableIndex = idx;
  }
  const g = new THREE.BufferGeometry(), n = (CABLE_SEG + 1) * CABLE_SIDES;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setIndex(cableIndex);
  const mesh = new THREE.Mesh(g, cableMat); mesh.name = 'VoltnewtCable'; mesh.frustumCulled = false; mesh.raycast = () => {}; mesh.userData.ignoreContact = true;
  return mesh;
}
const CABLE_PTS = Array.from({length: CABLE_SEG + 1}, () => new THREE.Vector3()), _tip = new THREE.Vector3(), _dir = new THREE.Vector3();
const _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3(), _p3 = new THREE.Vector3(), _pt = new THREE.Vector3(), _tg = new THREE.Vector3(),
  _nr = new THREE.Vector3(), _bn = new THREE.Vector3(), _prev = new THREE.Vector3();
/** Lay the cable from the stub tip (world, with its direction) to the anchor (world), sagging between; local to `space`. */
function layCable(mesh, tip, dir, anchor, space) {
  const len = tip.distanceTo(anchor);
  _p0.copy(tip); _p1.copy(tip).addScaledVector(dir, Math.min(.25, len * .35));
  _p3.copy(anchor); _p2.copy(anchor).add(_v.set(0, Math.min(.15, len * .25), 0));
  space.updateWorldMatrix(true, false); _m.copy(space.matrixWorld).invert();
  const pos = mesh.geometry.attributes.position, nor = mesh.geometry.attributes.normal, sag = Math.min(.18, len * .22);
  for (let i = 0; i <= CABLE_SEG; i++) {
    const t = i / CABLE_SEG, u = 1 - t;
    CABLE_PTS[i].set(0, 0, 0).addScaledVector(_p0, u * u * u).addScaledVector(_p1, 3 * u * u * t).addScaledVector(_p2, 3 * u * t * t).addScaledVector(_p3, t * t * t);
    CABLE_PTS[i].y -= sag * 4 * t * u;
  }
  _nr.set(0, 1, 0);
  for (let i = 0; i <= CABLE_SEG; i++) {
    const c = CABLE_PTS[i];
    _tg.subVectors(CABLE_PTS[Math.min(CABLE_SEG, i + 1)], CABLE_PTS[Math.max(0, i - 1)]).normalize();
    _nr.addScaledVector(_tg, -_nr.dot(_tg)); if (_nr.lengthSq() < 1e-6) _nr.set(1, 0, 0).addScaledVector(_tg, -_tg.x); _nr.normalize();
    _bn.crossVectors(_tg, _nr);
    for (let k = 0; k < CABLE_SIDES; k++) {
      const a = Math.PI * 2 * k / CABLE_SIDES, j = i * CABLE_SIDES + k;
      _prev.copy(_nr).multiplyScalar(Math.cos(a)).addScaledVector(_bn, Math.sin(a));
      _pt.copy(c).addScaledVector(_prev, CABLE_R).applyMatrix4(_m); pos.setXYZ(j, _pt.x, _pt.y, _pt.z);
      _prev.transformDirection(_m); nor.setXYZ(j, _prev.x, _prev.y, _prev.z);
    }
  }
  pos.needsUpdate = nor.needsUpdate = true;
}

// --- One rigged lizard ---------------------------------------------------------------------------------------------
export const LIZARD_SCALE = 1.2;   // a touch bigger than life so the crew reads from the ground
const LOOK_WEIGHT = {idle: 1, tinker: .35, climb: .3, cheer: .2, nap: 0, bite: .1};
function makeModel(lizard) {
  const {scene, clips, rest} = template, material = lizardMaterial(lizard.look);
  const model = cloneSkinnedAsset(scene), bones = {};
  model.scale.setScalar(LIZARD_SCALE);
  model.traverse(o => {
    if (o.isBone) bones[o.name] = o;
    if (o.isMesh) {
      o.material = material; o.castShadow = true; o.receiveShadow = false;
      o.raycast = () => {}; o.userData.ignoreContact = true; o.onBeforeRender = captureViewer;
      o.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, .15, 0), .5);   // generous: hops, z's and the tail curl
    }
  });
  const mixer = new THREE.AnimationMixer(model), actions = {};
  for (const [name, clip] of Object.entries(clips)) {
    const a = mixer.clipAction(clip); actions[name] = a;
    if (name === 'cheer') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
  }
  const base = {};   // the clip pose of every bone a procedural layer touches
  for (const name of ['Head', 'EyeL', 'EyeR', 'LidL', 'LidR', 'Z1', 'Z2']) if (bones[name]) base[name] = bones[name].quaternion.clone();
  return {model, bones, rest, base, mixer, actions, material, clip: null, wrench: 0, vein: .6,
    blink: 0, blinkAt: 1 + Math.random() * 3, blinkDouble: false, yaw: 0, pitch: 0};
}
function play(m, name, fade = .3, randomStart = true, restart = false) {
  if (m.clip === name && !restart) return;
  const next = m.actions[name], prev = m.clip && m.actions[m.clip];
  if (!next) return;
  next.reset(); next.enabled = true; next.setEffectiveTimeScale(1); next.setEffectiveWeight(1);
  if (randomStart && name !== 'cheer') next.time = Math.random() * next.getClip().duration;
  next.fadeIn(fade).play();
  if (prev && prev !== next) prev.fadeOut(fade);
  m.clip = name;
}
function turn(m, bone, axis, angle) {
  const b = m.bones[bone], r = m.rest[bone]; if (!b || !r || !angle) return;
  b.quaternion.multiply(_q.setFromAxisAngle(r[axis], angle));
}
const LIDS = ['LidL', 'LidR'], EYES = ['EyeL', 'EyeR'];
/** How hard the veins glow for the current clip: a steady fizz, flaring while charging up or zapping. */
function veinTarget(m) {
  const a = m.actions[m.clip], t = a ? a.time : 0;
  if (m.clip === 'cheer') return .7 + 3.2 * bump(t, .05, .3, .5, .75);
  if (m.clip === 'bite') return .7 + 3.6 * bump(t, .45, .55, 1.1, 1.3);
  if (m.clip === 'nap') return .35;
  return .65;
}
/** Advance the mixer, then layer blinks, the look-at, the wrench, the vein glow and the z's. target: world point or null. */
function animateModel(lizard, t, dt, target) {
  const m = lizard.m;
  // The mixer only writes a bone when its sampled value changes, so last frame's procedural layer is undone by
  // restoring what the mixer left there (not the rest pose), then the clips and the layers are applied afresh.
  for (const [name, q] of Object.entries(m.base)) m.bones[name].quaternion.copy(q);
  m.mixer.update(dt);
  for (const [name, q] of Object.entries(m.base)) q.copy(m.bones[name].quaternion);
  // blinks: quick close, short hold, slower open; now and then a double blink
  m.blinkAt -= dt;
  if (m.blinkAt <= 0 && m.blink <= 0) { m.blink = .001; m.blinkDouble = Math.random() < .25; }
  if (m.blink > 0) {
    m.blink += dt; const b = m.blink;
    const k = b < .06 ? b / .06 : b < .1 ? 1 : b < .2 ? 1 - (b - .1) / .1 : 0;
    for (const l of LIDS) turn(m, l, 'x', -1.75 * k);
    if (b >= .2) { if (m.blinkDouble) { m.blink = .001; m.blinkDouble = false; } else { m.blink = 0; m.blinkAt = 1.8 + Math.random() * 4.5; } }
  }
  // look-at: head and eyes turn toward the target, smoothly, as much as the current clip allows
  let yaw = 0, pitch = 0;
  const w = m.clip ? LOOK_WEIGHT[m.clip] ?? 0 : 0;
  if (target && w > 0) {
    _m.copy(lizard.holder.matrixWorld).invert(); _v.copy(target).applyMatrix4(_m).sub(_w.set(0, .2, -.18));
    yaw = clamp(Math.atan2(-_v.x, -_v.z), -1.1, 1.1) * w; pitch = clamp(Math.atan2(_v.y, Math.hypot(_v.x, _v.z)), -.5, .6) * w;
  }
  m.yaw += (yaw - m.yaw) * damp(4, dt); m.pitch += (pitch - m.pitch) * damp(4, dt);
  turn(m, 'Head', 'y', m.yaw * .7); turn(m, 'Head', 'x', m.pitch * .6);
  for (const e of EYES) { turn(m, e, 'y', clamp(m.yaw * .5, -.35, .35)); turn(m, e, 'x', clamp(m.pitch * .5, -.25, .25)); }
  // the wrench comes out for tinkering (the keeper keeps hers in hand)
  const wantWrench = m.clip === 'tinker' || (lizard.role === 'keeper' && m.clip !== 'bite' && m.clip !== 'cheer') ? 1 : 0;
  m.wrench += (wantWrench - m.wrench) * damp(10, dt);
  if (m.bones.Wrench) m.bones.Wrench.scale.setScalar(m.wrench < .02 ? 0 : m.wrench);
  // veins: a steady fizz that flares while charging up and zapping
  m.vein += (veinTarget(m) - m.vein) * damp(12, dt);
  m.material.userData.lz.uLzVein.value = m.vein; m.material.userData.lz.uLzTime.value = t;
  // z's face whoever is watching
  if (m.clip === 'nap' && viewer.seen) {
    for (const z of ['Z1', 'Z2']) {
      const b = m.bones[z]; if (!b || b.scale.x < .01) continue;
      b.parent.getWorldQuaternion(_q2); b.quaternion.copy(_q2.invert().multiply(viewer.quat));
    }
  }
  // cable: from the stub's tip to the plug-in point
  if (lizard.cable && lizard.plug && m.bones.CableTip && m.bones.Cable2) {
    m.bones.CableTip.getWorldPosition(_tip); _dir.copy(_tip).sub(m.bones.Cable2.getWorldPosition(_p2)).normalize();
    layCable(lizard.cable, _tip, _dir, lizard.plug(_v), lizard.cableSpace);
  }
}

// --- Climbing frame on the coil -------------------------------------------------------------------------------------
const m4 = new THREE.Matrix4(), fwd = new THREE.Vector3(), upv = new THREE.Vector3(), side = new THREE.Vector3();
/** Point and frame on the coil at u (0 bottom .. 1 top): belly against the tower, nose along the winding. */
function onCoil(u, dir, pos, quat, lift = .04) {
  const y = TW.coil0 + (TW.coil1 - TW.coil0) * u, r = shaftR(y) + .09 + lift, a = TW.phase + Math.PI * 2 * TW.turns * u;
  pos.set(Math.cos(a) * r, y, -Math.sin(a) * r);
  if (!quat) return;
  upv.set(Math.cos(a), 0, -Math.sin(a));                                         // outward from the axis
  const dy = (TW.coil1 - TW.coil0), da = Math.PI * 2 * TW.turns * r;
  fwd.set(-Math.sin(a) * da, dy, -Math.cos(a) * da).normalize().multiplyScalar(dir);   // along the winding
  side.crossVectors(fwd, upv).normalize(); fwd.crossVectors(upv, side).normalize();
  m4.makeBasis(side, upv, fwd.negate());   // right-handed: x = y × z with z = -forward
  quat.setFromRotationMatrix(m4);
}
let coilLength = 0;
{ const a = new THREE.Vector3(), b = new THREE.Vector3();
  onCoil(0, 1, a); for (let i = 1; i <= 400; i++) { onCoil(i / 400, 1, b); coilLength += a.distanceTo(b); a.copy(b); } }
const CLIMB_SPEED = .4, CLIMB_STRIDE = .1;   // m/s along the coil; body travel per climb loop (0.6 s) at timeScale 1

/** Review helper (tests/lizard-lab.html): one lizard of a look playing a chosen clip. Resolves once the model loads. */
export async function createLizardModel(look = 0, {role = 'show'} = {}) {
  await load();
  if (!template) return null;
  const lizard = {look, role, holder: new THREE.Group()}; lizard.m = makeModel(lizard); lizard.holder.add(lizard.m.model);
  lizard.cable = makeCable(); lizard.cableSpace = lizard.holder; lizard.holder.add(lizard.cable);
  lizard.plug = out => lizard.holder.localToWorld(out.set(.05, 0, .55));
  return {group: lizard.holder, play: (name, fade = 0) => play(lizard.m, name, fade, false, true),
    update: (t, dt, target = null) => { frameNo++; animateModel(lizard, t, dt, target); }, model: lizard.m};
}

// --- The crew -------------------------------------------------------------------------------------------------------
export function createLizardCrew() {
  const group = new THREE.Group(); group.name = 'LizardCrew';
  const mk = (role, look) => { const holder = new THREE.Group(); holder.name = `Lizard_${LIZARD_LOOKS[look].name}`; group.add(holder); return {role, look, holder, stand: null, m: null, cable: null, cableSpace: group, cheerIn: -1, cheerLeft: 0}; };
  const climber = mk('climber', 0), keeper = mk('keeper', 1), lounger = mk('lounger', 2), crew = [climber, keeper, lounger];
  // The keeper perches on the back rim of the hopper, over the feed pipe, facing out across the crystals (and so
  // toward the front of the tower); the lounger sprawls along the copper torus brim over the charge column.
  keeper.holder.position.set(.04, 1.07, -1.27); keeper.holder.rotation.y = .3;
  lounger.holder.position.set(0, 5.47, -1.12); lounger.holder.rotation.y = Math.PI / 2;
  const seed = Math.random() * 100;
  const climb = {u: Math.random() * .8, dir: 1, mode: 'move', left: 0, nextStop: 4 + Math.random() * 6, quat: new THREE.Quaternion(), pos: new THREE.Vector3(), init: false};
  const keep = {mode: 'tinker', left: 4 + Math.random() * 4, next: 0};
  const nap = {awake: 0};
  // where each one is plugged in (world space): the coil a little behind the climber, the plinth step under the
  // hopper, the torus brim behind the napper
  const local = (x, y, z, out) => group.localToWorld(out.set(x, y, z));
  climber.plug = out => { onCoil(clamp(climb.u - climb.dir * .45 / coilLength, 0, 1), 1, out, null, .03); return group.localToWorld(out); };
  keeper.plug = out => local(.5, .79, -1.02, out);
  lounger.plug = out => local(.42, 5.47, -1.04, out);
  function build() {
    for (const l of crew) {
      l.holder.clear(); l.stand = null; l.m = null;
      if (l.cable) { l.cable.removeFromParent(); l.cable.geometry.dispose(); l.cable = null; }
      if (template) { l.m = makeModel(l); l.holder.add(l.m.model); l.cable = makeCable(); group.add(l.cable); }
      else { l.stand = makeStandIn(); l.holder.add(l.stand.group); }
    }
    if (lounger.stand) lounger.stand.group.scale.setScalar(1.1);
    if (climber.m) play(climber.m, 'climb'); if (keeper.m) play(keeper.m, 'tinker'); if (lounger.m) play(lounger.m, 'nap');
  }
  const api = {upgrade: build};
  build(); if (!template) { waiting.add(api); load(); }
  const watching = l => viewer.seen > frameNo - 3 && l.holder.getWorldPosition(_w).distanceTo(viewer.pos) < 7 ? viewer.pos : null;
  return {
    group,
    cheer() { for (const l of crew) l.cheerIn = Math.random() * .3; },
    update(t, dt) {
      dt = clamp(dt || 0, 0, .1); frameNo++; t += seed;
      // cheering: staggered, then back to whatever each was doing
      for (const l of crew) {
        if (l.cheerIn >= 0) { l.cheerIn -= dt; if (l.cheerIn < 0) { l.cheerLeft = 1.6; if (l.m) play(l.m, 'cheer', .15, false, true); } }
        else if (l.cheerLeft > 0) l.cheerLeft -= dt;
      }
      const cheering = l => l.cheerLeft > 0 || l.cheerIn >= 0;
      // the climber scurries along the winding, stops now and then to tap or zap it, waits at the ends, turns round
      if (!cheering(climber)) {
        if (climb.mode === 'move') {
          climb.u += climb.dir * CLIMB_SPEED * dt / coilLength; climb.nextStop -= CLIMB_SPEED * dt;
          if (climb.u >= 1 || climb.u <= 0) { climb.u = clamp(climb.u, 0, 1); climb.mode = 'idle'; climb.left = 3.5 + Math.random() * 2; climb.end = true; }
          else if (climb.nextStop <= 0) { const r = Math.random(); climb.mode = r < .4 ? 'tinker' : r < .75 ? 'bite' : 'idle'; climb.left = climb.mode === 'bite' ? 1.8 * (1 + (Math.random() < .4)) : 2.5 + Math.random() * 2.5; }
        } else {
          climb.left -= dt;
          if (climb.left <= 0) {
            if (climb.end) { climb.dir = climb.u >= 1 ? -1 : 1; climb.end = false; }
            climb.mode = 'move'; climb.nextStop = 4 + Math.random() * 7;
          }
        }
      }
      onCoil(clamp(climb.u, 0, 1), climb.dir, climb.pos, climb.quat);
      climber.holder.position.copy(climb.pos);
      if (!climb.init) { climber.holder.quaternion.copy(climb.quat); climb.init = true; }
      else climber.holder.quaternion.slerp(climb.quat, damp(5, dt));   // turns round smoothly at the ends
      // the keeper cycles: tinker with the wrench, look round, now and then a zapping bite at the crystals
      if (!cheering(keeper)) {
        keep.left -= dt;
        if (keep.left <= 0) {
          keep.mode = keep.mode !== 'idle' ? 'idle' : (++keep.next % 3 === 0 ? 'bite' : 'tinker');
          keep.left = keep.mode === 'tinker' ? 5 + Math.random() * 5 : keep.mode === 'bite' ? 3.6 : 3 + Math.random() * 3;
        }
      }
      // the lounger naps; a cheer wakes him for a moment before he nods off again
      if (cheering(lounger)) nap.awake = 3.5; else nap.awake = Math.max(0, nap.awake - dt);

      if (climber.m) {
        const m = climber.m;
        if (!cheering(climber)) {
          play(m, climb.mode === 'move' ? 'climb' : climb.mode);
          if (m.clip === 'climb') m.actions.climb.setEffectiveTimeScale(CLIMB_SPEED * .6 / CLIMB_STRIDE);
        }
        animateModel(climber, t, dt, watching(climber));
      } else wiggle(climber.stand, t, climb.mode === 'move' ? 11 : 0, 1);
      if (keeper.m) {
        if (!cheering(keeper)) play(keeper.m, keep.mode);
        animateModel(keeper, t, dt, watching(keeper) || (keep.mode === 'idle' ? climber.holder.getWorldPosition(_p1) : null));
      } else wiggle(keeper.stand, t, 2, .3);
      if (lounger.m) {
        if (!cheering(lounger)) play(lounger.m, nap.awake > 0 ? 'idle' : 'nap', .6);
        animateModel(lounger, t, dt, watching(lounger));
      } else { wiggle(lounger.stand, t, 1, .25); lounger.stand.tail.rotation.y += Math.sin(t * .6) * .4; }
      // stand-in hop when cheering
      for (const l of crew) if (l.stand) { const k = l.cheerLeft > 0 ? Math.abs(Math.sin((1.6 - l.cheerLeft) * Math.PI * 2)) * .15 * l.cheerLeft / 1.6 : 0; l.stand.group.position.y = k; }
    },
  };
}
