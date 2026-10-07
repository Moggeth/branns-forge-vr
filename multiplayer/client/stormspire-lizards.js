// The Stormspire's lizard crew (Mitch, 2026-10-06: "populated by lizards"; 2026-10-07: "make sure the lizards get a
// graphical and animation uplift - they're so cute and I love them", then a production pass). After Mitch's concept
// sheet "03 · VOLTNEWT": a chunky teal newt with a toothy grin, orange back spikes, a yellow hard hat, a medic chest
// harness, black boots, glowing blue veins and a red power cable plugged into a socket on its back
// (assets-source/stormspire-lizards -> /assets/stormspire-lizard.glb). Three of them look after every tower:
//   Sparky   (teal)    trots along the stone between the copper windings, plugged into the coil, stopping to tap or zap
//                      it; at the charge column it turns back or hops over a winding to the next turn
//   Sprocket (jade)    straddles the crystal hopper's rim, minding it with a wrench and the odd zapping bite
//   Snooze   (lagoon)  naps draped over the copper torus brim, hard hat tipped over his eyes, snoring z's
// All three cheer whenever the tower is charged: they charge up (eyes squeezed into happy closed-eye lines, cheeks
// puffed, veins crackling, sparks), then hop with their arms up and a big toothy grin.
//
// One shared skinned geometry and one 512 px texture set (base colour, normal, metallic-roughness with a vein mask in
// R); one material per lizard (its own hue and vein-glow uniforms, one shared shader program). Every lizard is a
// SkeletonUtils clone with its own AnimationMixer (clips idle, climb, cheer, nap, tinker, bite) driven by the frame dt
// passed to update(), with crossfades and procedural layers on top: random blinks, a head and eye look-at (at the
// viewer when close, otherwise at crewmates), secondary motion (springy tail follow-through, hat wobble, belly and
// cheek jiggle, a swaying cable), two-bone foot IK that plants every boot on the stone, the hopper rim or the brim,
// flickering veins that flare while charging or biting, spark bursts, z's that face the camera, and a cable from the
// socket stub to wherever the newt is plugged in. Until the GLB arrives (or if it never does) each lizard is a small
// primitive stand-in that is swapped for the model in place. Presentation only; writes nothing back.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {cloneSkinnedAsset} from './clone-skinned-asset.js';

const MODEL_URL = '/assets/stormspire-lizard.glb';
// Tower geometry in the glTF frame (assets-source/stormspire-tower build_tower.py keeps these numbers): an octagonal shaft (circumradius .95 ->
// .68 from y .85 to 5.0, faces centred every 45 degrees from +X) with proud block courses every eighth of its height;
// the circular coil winds 9 turns from y 1.2 to 4.65, .09 outside the circumradius, wire radius .032. The glass charge
// column stands on the front face (-Z). The hopper bowl (a lathe, profile HOPPER) sits on a post at (0, .78, -1.62);
// the copper torus brim (radius 1.12, tube .14) is centred at y 5.35.
const TW = Object.freeze({r0: .95, r1: .68, y0: .85, y1: 5, coil0: 1.2, coil1: 4.65, turns: 9, phase: Math.PI / 2 + .25, wire: .032});
const HOPPER = Object.freeze({x: 0, y: .78, z: -1.62, profile: [[.12, 0], [.30, .20], [.36, .26], [.395, .29], [.40, .30], [.385, .318], [.37, .32], [.345, .305], [.26, .21], [.14, .06]]});
const BRIM = Object.freeze({y: 5.35, R: 1.12, r: .14});
const shaftR = y => TW.r0 + (TW.r1 - TW.r0) * (y - TW.y0) / (TW.y1 - TW.y0);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const bump = (x, a, b, c, d) => x < a || x > d ? 0 : x < b ? (x - a) / (b - a) : x < c ? 1 : 1 - (x - c) / (d - c);
const TAU = Math.PI * 2;

export const LIZARD_LOOKS = Object.freeze([
  {name: 'Sparky', hue: 0}, {name: 'Sprocket', hue: .32}, {name: 'Snooze', hue: -.26},
]);

// --- Shading: the glTF texture set, plus what the vertex colours carry (R ambient occlusion, G self-glow, B skin
// mask): a per-lizard hue shift and a wet sheen on the skin, a soft warm rim so they separate from stone and sky, and
// flickering blue electricity from the vein mask in the metallic-roughness map's red channel. -----------------------
function patchMaterial(material) {
  const lz = material.userData.lz = {uLzVein: {value: .6}, uLzTime: {value: 0}, uLzHue: {value: 0}};
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, lz);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
      uniform float uLzVein, uLzTime, uLzHue;
      vec3 lzHueShift(vec3 c, float a) {
        vec3 yiq = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312) * c;
        float h = atan(yiq.z, yiq.y) + a, ch = length(yiq.yz);
        return max(mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703) * vec3(yiq.x, ch * cos(h), ch * sin(h)), 0.0);
      }`)
      .replace('#include <color_fragment>', `
      float lzAO = 1.0, lzGlowK = 0.0, lzSkin = 0.0;
      #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
        lzAO = vColor.r; lzGlowK = vColor.g; lzSkin = vColor.b;
      #endif
      diffuseColor.rgb = mix(diffuseColor.rgb, lzHueShift(diffuseColor.rgb, uLzHue), step(0.5, lzSkin)) * lzAO;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float lzRim = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
      totalEmissiveRadiance += diffuseColor.rgb * lzGlowK + vec3(1.0, 0.86, 0.62) * lzRim * (0.1 + 0.14 * lzSkin);
      #ifdef USE_ROUGHNESSMAP
      if (lzSkin > 0.5) {
        float lzV = texture2D(roughnessMap, vRoughnessMapUv).r;
        // far away the fine veins would only sparkle: fade them into an even blue fizz instead
        float lzFar = clamp((length(fwidth(vRoughnessMapUv)) * 512.0 - 1.4) * 0.6, 0.0, 1.0);
        lzV = mix(lzV, 0.06, lzFar);
        float lzFlick = 0.62 + 0.38 * sin(uLzTime * 6.0 + vRoughnessMapUv.x * 70.0) * sin(uLzTime * 2.3 - vRoughnessMapUv.y * 50.0 + 1.3);
        totalEmissiveRadiance += vec3(0.12, 0.55, 1.0) * lzV * uLzVein * lzFlick;
      }
      #endif`);
  };
  material.customProgramCacheKey = () => 'stormspire-voltnewt-2';
  return material;
}

// --- Loading: once per page, then every waiting crew swaps its stand-ins for clones. --------------------------------
let template = null, loading = null;
const waiting = new Set();
// rest-pose points (model space) the runtime tracks on bones: boot soles, the mouth, the wrench head, the head centre
const POINTS = {
  soleArmL: ['HandL', [-.112, 0, -.102]], soleArmR: ['HandR', [.112, 0, -.102]], soleLegL: ['FootL', [-.118, 0, .07]], soleLegR: ['FootR', [.118, 0, .07]],
  mouth: ['Head', [0, .132, -.3]], wrench: ['Wrench', [.112, .1, -.13]], head: ['Head', [0, .17, -.2]], back: ['Spine', [0, .17, -.02]],
};
function load() {
  if (loading || typeof window === 'undefined') return loading;
  loading = new GLTFLoader().loadAsync(MODEL_URL).then(gltf => {
    let mesh = null; gltf.scene.traverse(o => { if (o.isSkinnedMesh) mesh = o; });
    if (!mesh || !gltf.animations.length) throw new Error('lizard GLB has no skinned mesh or clips');
    for (const t of [mesh.material.map, mesh.material.normalMap]) if (t) t.anisotropy = 4;
    // Rest orientation of every bone relative to the model root, so procedural turns are about the newt's own axes,
    // and the tracked points in their bones' frames.
    const rest = {}, points = {};
    gltf.scene.updateMatrixWorld(true);
    const rootInv = gltf.scene.matrixWorld.clone().invert(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    gltf.scene.traverse(o => {
      if (!o.isBone) return;
      m4.multiplyMatrices(rootInv, o.matrixWorld).decompose(p, q, s);
      const inv = q.clone().invert();
      rest[o.name] = {q: o.quaternion.clone(), x: new THREE.Vector3(1, 0, 0).applyQuaternion(inv), y: new THREE.Vector3(0, 1, 0).applyQuaternion(inv), z: new THREE.Vector3(0, 0, 1).applyQuaternion(inv)};
    });
    for (const [key, [bone, at]] of Object.entries(POINTS)) {
      const b = gltf.scene.getObjectByName(bone); if (!b) continue;
      m4.multiplyMatrices(rootInv, b.matrixWorld).invert(); points[key] = {bone, local: new THREE.Vector3().fromArray(at).applyMatrix4(m4)};
    }
    template = {scene: gltf.scene, clips: Object.fromEntries(gltf.animations.map(c => [c.name, c])), base: mesh.material, rest, points};
    for (const crew of waiting) crew.upgrade();
  }).catch(error => console.warn('Lizard crew model unavailable; keeping the simple lizards.', error)).finally(() => waiting.clear());
  return loading;
}
function lizardMaterial(look) {
  const m = patchMaterial(template.base.clone()); m.name = `Voltnewt_${LIZARD_LOOKS[look].name}`;
  m.userData.lz.uLzHue.value = LIZARD_LOOKS[look].hue;
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

// --- Sparks: one small additive point cloud per crew; bursts at the bite, the charge-up and the wrench taps. -------
const SPARK_N = 64;
let sparkTex = null;
function sparkTexture() {
  if (sparkTex) return sparkTex;
  const n = 32, data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = Math.hypot(x + .5 - n / 2, y + .5 - n / 2) / (n / 2), core = Math.max(0, 1 - d * 2.2) ** 2, halo = Math.max(0, 1 - d) ** 2.2, i = (y * n + x) * 4;
    data[i] = 255 * Math.min(1, core + halo * .35); data[i + 1] = 255 * Math.min(1, core + halo * .7); data[i + 2] = 255 * Math.min(1, core + halo); data[i + 3] = 255 * Math.min(1, core + halo);
  }
  sparkTex = new THREE.DataTexture(data, n, n); sparkTex.needsUpdate = true; sparkTex.colorSpace = THREE.SRGBColorSpace;
  return sparkTex;
}
function makeSparks() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARK_N * 3).fill(-9999), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SPARK_N * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.PointsMaterial({size: .06, map: sparkTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false});
  const points = new THREE.Points(g, mat); points.name = 'VoltnewtSparks'; points.frustumCulled = false; points.raycast = () => {}; points.userData.ignoreContact = true; points.renderOrder = 5;
  return {points, life: new Float32Array(SPARK_N), max: new Float32Array(SPARK_N), vel: new Float32Array(SPARK_N * 3), next: 0, live: 0};
}
/** n sparks at a world point, flung outward at about `speed` m/s (local to the cloud's parent). */
function emitSparks(sp, world, n, speed = 1.2, spread = .02) {
  if (!sp) return;
  const parent = sp.points.parent; if (!parent) return;
  _v.copy(world); parent.worldToLocal(_v);
  const pos = sp.points.geometry.attributes.position.array;
  for (let k = 0; k < n; k++) {
    const i = sp.next; sp.next = (sp.next + 1) % SPARK_N;
    const u = Math.random() * 2 - 1, a = Math.random() * TAU, r = Math.sqrt(1 - u * u), s = speed * (.4 + Math.random() * .8);
    pos[i * 3] = _v.x + (Math.random() - .5) * spread; pos[i * 3 + 1] = _v.y + (Math.random() - .5) * spread; pos[i * 3 + 2] = _v.z + (Math.random() - .5) * spread;
    sp.vel[i * 3] = r * Math.cos(a) * s; sp.vel[i * 3 + 1] = Math.abs(u) * s * .8 + .3; sp.vel[i * 3 + 2] = r * Math.sin(a) * s;
    sp.life[i] = sp.max[i] = .18 + Math.random() * .3;
  }
  sp.live = .6;
}
function updateSparks(sp, dt) {
  if (!sp || sp.live <= 0) return;
  sp.live -= dt;
  const pos = sp.points.geometry.attributes.position, col = sp.points.geometry.attributes.color, p = pos.array, c = col.array;
  for (let i = 0; i < SPARK_N; i++) {
    if (sp.life[i] <= 0) { if (c[i * 3 + 2] !== 0) { c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = 0; p[i * 3 + 1] = -9999; } continue; }
    sp.life[i] -= dt; const k = Math.max(0, sp.life[i] / sp.max[i]);
    sp.vel[i * 3 + 1] -= 4 * dt; for (let j = 0; j < 3; j++) { sp.vel[i * 3 + j] *= 1 - 2.5 * dt; p[i * 3 + j] += sp.vel[i * 3 + j] * dt; }
    c[i * 3] = .55 * k + .45 * k * k; c[i * 3 + 1] = .8 * k; c[i * 3 + 2] = 1.0 * Math.sqrt(k);
  }
  pos.needsUpdate = col.needsUpdate = true;
}

// --- The power cable: a short tube from the socket stub's tip to the plug-in point, rebuilt in place each frame. ----
const CABLE_SEG = 12, CABLE_SIDES = 6, CABLE_R = .0095;
let cableMat = null, cableIndex = null;
function makeCable() {
  cableMat ??= new THREE.MeshStandardMaterial({color: 0xd8402e, roughness: .42, metalness: 0});
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
  const mesh = new THREE.Mesh(g, cableMat); mesh.name = 'VoltnewtCable'; mesh.frustumCulled = false; mesh.raycast = () => {}; mesh.userData.ignoreContact = true; mesh.castShadow = true;
  return mesh;
}
const CABLE_PTS = Array.from({length: CABLE_SEG + 1}, () => new THREE.Vector3()), _tip = new THREE.Vector3(), _dir = new THREE.Vector3();
const _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3(), _p3 = new THREE.Vector3(), _pt = new THREE.Vector3(), _tg = new THREE.Vector3(),
  _nr = new THREE.Vector3(), _bn = new THREE.Vector3(), _prev = new THREE.Vector3();
/** Lay the cable from the stub tip (world, with its direction) to the anchor (world), sagging between and swayed by
 *  `sway` (a world offset at its middle); local to `space`. */
function layCable(mesh, tip, dir, anchor, space, sway) {
  const len = tip.distanceTo(anchor);
  _p0.copy(tip); _p1.copy(tip).addScaledVector(dir, Math.min(.25, len * .35));
  _p3.copy(anchor); _p2.copy(anchor).add(_v.set(0, Math.min(.15, len * .25), 0));
  space.updateWorldMatrix(true, false); _m.copy(space.matrixWorld).invert();
  const pos = mesh.geometry.attributes.position, nor = mesh.geometry.attributes.normal, sag = Math.min(.18, len * .22);
  for (let i = 0; i <= CABLE_SEG; i++) {
    const t = i / CABLE_SEG, u = 1 - t, mid = 4 * t * u;
    CABLE_PTS[i].set(0, 0, 0).addScaledVector(_p0, u * u * u).addScaledVector(_p1, 3 * u * u * t).addScaledVector(_p2, 3 * u * t * t).addScaledVector(_p3, t * t * t);
    CABLE_PTS[i].y -= sag * mid;
    if (sway) CABLE_PTS[i].addScaledVector(sway, mid * Math.min(1, len * 1.5));
  }
  _nr.set(0, 1, 0);
  for (let i = 0; i <= CABLE_SEG; i++) {
    const c = CABLE_PTS[i];
    _tg.subVectors(CABLE_PTS[Math.min(CABLE_SEG, i + 1)], CABLE_PTS[Math.max(0, i - 1)]).normalize();
    _nr.addScaledVector(_tg, -_nr.dot(_tg)); if (_nr.lengthSq() < 1e-6) _nr.set(1, 0, 0).addScaledVector(_tg, -_tg.x); _nr.normalize();
    _bn.crossVectors(_tg, _nr);
    for (let k = 0; k < CABLE_SIDES; k++) {
      const a = TAU * k / CABLE_SIDES, j = i * CABLE_SIDES + k;
      _prev.copy(_nr).multiplyScalar(Math.cos(a)).addScaledVector(_bn, Math.sin(a));
      _pt.copy(c).addScaledVector(_prev, CABLE_R).applyMatrix4(_m); pos.setXYZ(j, _pt.x, _pt.y, _pt.z);
      _prev.transformDirection(_m); nor.setXYZ(j, _prev.x, _prev.y, _prev.z);
    }
  }
  pos.needsUpdate = nor.needsUpdate = true;
}

// --- What the boots stand on (crew-local, the tower's frame): closest surface point and its outward normal. --------
// Each returns the signed distance from p to the surface (negative inside).
const COS8 = Math.cos(Math.PI / 8), OCT = Math.PI / 4, PITCH = (TW.coil1 - TW.coil0) / TW.turns;
const COURSES = Array.from({length: 7}, (_, i) => TW.y0 + (TW.y1 - TW.y0) * (i + 1) / 8);
function courseBump(y) { let b = 0; for (const c of COURSES) b = Math.max(b, sstep(.064, .046, Math.abs(y - c))); return b * .035 * COS8; }
const stoneApothem = y => shaftR(y) * COS8 + courseBump(y);
function supportShaft(p, out, nrm) {
  const a = Math.atan2(-p.z, p.x), fc = Math.round(a / OCT) * OCT, nx = Math.cos(fc), nz = -Math.sin(fc);
  let d = p.x * nx + p.z * nz - stoneApothem(p.y);
  out.set(p.x - nx * d, p.y, p.z - nz * d); nrm.set(nx, 0, nz);
  // the copper winding nearest in height, if a boot is closer to it than to the stone
  const base = (a - TW.phase) / TAU, k = Math.round((p.y - TW.coil0) / (TW.coil1 - TW.coil0) * TW.turns - base), u = (base + k) / TW.turns;
  if (u >= 0 && u <= 1) {
    const yw = TW.coil0 + (TW.coil1 - TW.coil0) * u, rw = shaftR(yw) + .09, rho = Math.hypot(p.x, p.z) || 1, dr = rho - rw, dy = p.y - yw, dl = Math.hypot(dr, dy) || 1, dw = dl - TW.wire;
    if (dw < d) {
      const ex = p.x / rho, ez = p.z / rho, s = TW.wire / dl;
      out.set(ex * (rw + dr * s), yw + dy * s, ez * (rw + dr * s)); nrm.set(ex * dr / dl, dy / dl, ez * dr / dl); d = dw;
    }
  }
  return d;
}
function supportHopper(p, out, nrm) {
  const dx = p.x - HOPPER.x, dz = p.z - HOPPER.z, rho = Math.hypot(dx, dz) || 1e-6, py = p.y - HOPPER.y, prof = HOPPER.profile;
  let best = Infinity, br = 0, by = 0;
  for (let i = 0; i < prof.length - 1; i++) {
    const [r0, y0] = prof[i], [r1, y1] = prof[i + 1], ex = r1 - r0, ey = y1 - y0, t = clamp(((rho - r0) * ex + (py - y0) * ey) / (ex * ex + ey * ey), 0, 1);
    const cr = r0 + ex * t, cy = y0 + ey * t, d = Math.hypot(rho - cr, py - cy);
    if (d < best) { best = d; br = cr; by = cy; }
  }
  const ux = dx / rho, uz = dz / rho, nr = (rho - br) / (best || 1), ny = (py - by) / (best || 1);
  out.set(HOPPER.x + ux * br, HOPPER.y + by, HOPPER.z + uz * br); nrm.set(ux * nr, ny, uz * nr);
  return best;
}
function supportBrim(p, out, nrm) {
  const rho = Math.hypot(p.x, p.z) || 1e-6, cx = p.x / rho * BRIM.R, cz = p.z / rho * BRIM.R;
  nrm.set(p.x - cx, p.y - BRIM.y, p.z - cz); const l = nrm.length() || 1; nrm.divideScalar(l);
  out.set(cx, BRIM.y, cz).addScaledVector(nrm, BRIM.r);
  return l - BRIM.r;
}

// --- One rigged lizard ---------------------------------------------------------------------------------------------
export const LIZARD_SCALE = 1.2;   // a touch bigger than life so the crew reads from the ground
const LOOK_WEIGHT = {idle: 1, tinker: .35, climb: .3, cheer: .2, nap: 0, bite: .1};
const LIMBS = [['ArmUL', 'ArmLL', 'HandL', 'soleArmL'], ['ArmUR', 'ArmLR', 'HandR', 'soleArmR'], ['LegUL', 'LegLL', 'FootL', 'soleLegL'], ['LegUR', 'LegLR', 'FootR', 'soleLegR']];
const TAILS = ['Tail1', 'Tail2', 'Tail3', 'Tail4', 'Tail5', 'Tail6'];
const LAYERED = ['Head', 'EyeL', 'EyeR', 'LidL', 'LidR', 'Z1', 'Z2', 'HatHard', 'Belly', 'CheekL', 'CheekR', ...TAILS, ...LIMBS.flatMap(l => l.slice(0, 3))];
const spring = () => ({x: 0, v: 0});
function stepSpring(s, target, k, zeta, dt, lim = 1) {
  const c = 2 * zeta * Math.sqrt(k);
  s.v += (-(s.x - target) * k - s.v * c) * dt; s.x = clamp(s.x + s.v * dt, -lim, lim);
}
/** Velocity and smoothed acceleration of a tracked world point. */
const tracker = () => ({p: new THREE.Vector3(), v: new THREE.Vector3(), a: new THREE.Vector3(), init: false});
function track(tr, world, dt) {
  if (!tr.init || dt <= 1e-4) { tr.p.copy(world); tr.v.set(0, 0, 0); tr.a.set(0, 0, 0); tr.init = true; return; }
  _v.subVectors(world, tr.p).divideScalar(dt);                  // new velocity
  _w.subVectors(_v, tr.v).divideScalar(dt);                     // raw acceleration
  if (_w.lengthSq() > 900) _w.setLength(30);                    // teleports and hitches
  tr.a.lerp(_w, damp(18, dt)); tr.v.copy(_v); tr.p.copy(world);
}
function makeModel(lizard) {
  const {scene, clips, rest} = template, material = lizardMaterial(lizard.look);
  const model = cloneSkinnedAsset(scene), bones = {};
  model.scale.setScalar(LIZARD_SCALE);
  model.traverse(o => {
    if (o.isBone) bones[o.name] = o;
    if (o.isMesh) {
      o.material = material; o.castShadow = true; o.receiveShadow = false;
      o.raycast = () => {}; o.userData.ignoreContact = true; o.onBeforeRender = captureViewer;
      o.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, .15, 0), .55);   // generous: hops, z's and the tail hook
    }
  });
  const mixer = new THREE.AnimationMixer(model), actions = {};
  for (const [name, clip] of Object.entries(clips)) {
    const a = mixer.clipAction(clip); actions[name] = a;
    if (name === 'cheer') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
  }
  const base = [];   // the clip pose of every bone a procedural layer touches
  for (const name of LAYERED) if (bones[name]) base.push({bone: bones[name], q: bones[name].quaternion.clone(), s: bones[name].scale.clone()});
  return {model, bones, rest, base, mixer, actions, material, clip: null, wrench: 0, vein: .6, prevTime: 0,
    blink: 0, blinkAt: 1 + Math.random() * 3, blinkDouble: false, yaw: 0, pitch: 0, ik: 0,
    hat: {p: spring(), r: spring()}, tailY: [spring(), spring(), spring()], tailP: [spring(), spring(), spring()], belly: spring(), cheek: spring(),
    trHead: tracker(), trHips: tracker(), trTip: tracker(), yawRate: 0, lastQ: new THREE.Quaternion(), sway: new THREE.Vector3(), swayV: new THREE.Vector3()};
}
function play(m, name, fade = .3, randomStart = true, restart = false) {
  if (m.clip === name && !restart) return;
  const next = m.actions[name], prev = m.clip && m.actions[m.clip];
  if (!next) return;
  next.reset(); next.enabled = true; next.setEffectiveTimeScale(1); next.setEffectiveWeight(1);
  if (randomStart && name !== 'cheer') next.time = Math.random() * next.getClip().duration;
  next.fadeIn(fade).play();
  if (prev && prev !== next) prev.fadeOut(fade);
  m.clip = name; m.prevTime = next.time;
}
function turn(m, bone, axis, angle) {
  const b = m.bones[bone], r = m.rest[bone]; if (!b || !r || !angle) return;
  b.quaternion.multiply(_q.setFromAxisAngle(r[axis], angle));
}
// world matrices are brought up to date once per lizard per frame (holder.updateMatrixWorld) and read directly after
const _dp = new THREE.Vector3(), _ds = new THREE.Vector3(), _spaceInv = new THREE.Matrix4();
const wpos = (o, out) => out.setFromMatrixPosition(o.matrixWorld);
const wquat = (o, out) => { o.matrixWorld.decompose(_dp, out, _ds); return out; };
function pointOf(m, key, out) {
  const p = template.points[key]; if (!p || !m.bones[p.bone]) return null;
  return out.copy(p.local).applyMatrix4(m.bones[p.bone].matrixWorld);
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

// two-bone foot IK scratch
const _A = new THREE.Vector3(), _B = new THREE.Vector3(), _C = new THREE.Vector3(), _F = new THREE.Vector3(), _S = new THREE.Vector3(), _N = new THREE.Vector3(),
  _T = new THREE.Vector3(), _Bn = new THREE.Vector3(), _up = new THREE.Vector3(), _org = new THREE.Vector3(), _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3(),
  _qa = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qf = new THREE.Quaternion(), _qn = new THREE.Quaternion(), _pole = new THREE.Vector3();
function rotateBoneWorld(bone, qWorld) {   // bone.world = qWorld * bone.world
  wquat(bone.parent, _qp); wquat(bone, _qa);
  bone.quaternion.copy(_qp.invert().multiply(qWorld).multiply(_qa)); bone.updateMatrixWorld(true);
}
/** Plant one boot: keep the clip's lift above the holder's ground plane, but measured from the real surface below. */
function plantLeg(m, lizard, [uName, lName, hName, key], weight) {
  const U = m.bones[uName], L = m.bones[lName], H = m.bones[hName], space = lizard.supportSpace; if (!U || !L || !H) return;
  wpos(U, _A); wpos(L, _B); wpos(H, _C); if (!pointOf(m, key, _F)) return;
  const lift = _d1.subVectors(_F, _org).dot(_up);                          // the clip's foot height above the ground plane
  _S.copy(_F).applyMatrix4(_spaceInv);
  const dist = lizard.support(_S, _T, _N); _S.copy(_T).applyMatrix4(space.matrixWorld); _N.transformDirection(space.matrixWorld);
  const stance = 1 - sstep(.012, .04, lift), reach = 1 - sstep(.1, .17, Math.abs(dist - Math.max(0, lift)));
  const w = weight * reach * (.35 + .65 * stance); if (w < .01) return;
  _T.copy(_S).addScaledVector(_N, Math.max(0, lift) + .002).sub(_F).multiplyScalar(w);   // how far the sole moves
  const footQ = wquat(H, _qf);
  _T.add(_C);                                                              // the ankle target
  const a = _A.distanceTo(_B), b = _B.distanceTo(_C);
  _d1.subVectors(_T, _A); const dl = clamp(_d1.length(), Math.abs(a - b) + 1e-4, (a + b) * .995); _d1.normalize();
  _pole.subVectors(_B, _A).addScaledVector(_d1, -_d2.subVectors(_B, _A).dot(_d1));
  if (_pole.lengthSq() < 1e-10) _pole.copy(_up); _pole.normalize();
  const ca = clamp((a * a + dl * dl - b * b) / (2 * a * dl), -1, 1);
  _Bn.copy(_A).addScaledVector(_d1, a * ca).addScaledVector(_pole, a * Math.sqrt(1 - ca * ca));
  rotateBoneWorld(U, _qn.setFromUnitVectors(_d2.subVectors(_B, _A).normalize(), _pole.subVectors(_Bn, _A).normalize()));
  wpos(H, _C); _T.copy(_A).addScaledVector(_d1, dl);
  rotateBoneWorld(L, _qn.setFromUnitVectors(_d2.subVectors(_C, _Bn).normalize(), _pole.subVectors(_T, _Bn).normalize()));
  // the boot keeps its clip orientation, tipped part way onto the surface
  _qn.setFromUnitVectors(_up, _N); _qa.identity().slerp(_qn, .6 * w * stance); footQ.premultiply(_qa);
  wquat(L, _qp); H.quaternion.copy(_qp.invert().multiply(footQ)); H.updateMatrixWorld(true);
}

/** Advance the mixer, then layer blinks, look-at, secondary motion, foot IK, the wrench, veins, sparks, z's, cable. */
function animateModel(lizard, t, dt, target) {
  const m = lizard.m, B = m.bones;
  // The mixer only writes a bone when its sampled value changes, so last frame's procedural layer is undone by
  // restoring what the mixer left there (not the rest pose), then the clips and the layers are applied afresh.
  for (const b of m.base) { b.bone.quaternion.copy(b.q); b.bone.scale.copy(b.s); }
  m.mixer.update(dt);
  for (const b of m.base) { b.q.copy(b.bone.quaternion); b.s.copy(b.bone.scale); }
  const act = m.actions[m.clip], ct = act ? act.time : 0;
  // blinks: quick close, short hold, slower open; now and then a double blink
  m.blinkAt -= dt;
  if (m.blinkAt <= 0 && m.blink <= 0) { m.blink = .001; m.blinkDouble = Math.random() < .25; }
  if (m.blink > 0) {
    m.blink += dt; const b = m.blink;
    const k = b < .06 ? b / .06 : b < .1 ? 1 : b < .2 ? 1 - (b - .1) / .1 : 0;
    for (const l of LIDS) turn(m, l, 'x', -1.75 * k);
    if (b >= .2) { if (m.blinkDouble) { m.blink = .001; m.blinkDouble = false; } else { m.blink = 0; m.blinkAt = 1.8 + Math.random() * 4.5; } }
  }
  // squash: a shut eye settles a little into its socket (blinks and the squint alike)
  for (const [lid, eye] of [['LidL', 'EyeL'], ['LidR', 'EyeR']]) {
    if (!B[lid] || !B[eye]) continue;
    const shut = clamp(2 * Math.acos(clamp(Math.abs(B[lid].quaternion.dot(m.rest[lid].q)), 0, 1)) / 1.75, 0, 1), k = 1 - .13 * shut * shut;
    B[lid].scale.multiplyScalar(k); B[eye].scale.multiplyScalar(k);
  }
  // look-at: head and eyes turn toward the target, smoothly, as much as the current clip allows
  let yaw = 0, pitch = 0;
  const lw = m.clip ? LOOK_WEIGHT[m.clip] ?? 0 : 0;
  if (target && lw > 0) {
    _m.copy(lizard.holder.matrixWorld).invert(); _v.copy(target).applyMatrix4(_m).sub(_w.set(0, .2, -.18));
    yaw = clamp(Math.atan2(-_v.x, -_v.z), -1.1, 1.1) * lw; pitch = clamp(Math.atan2(_v.y, Math.hypot(_v.x, _v.z)), -.5, .6) * lw;
  }
  m.yaw += (yaw - m.yaw) * damp(4, dt); m.pitch += (pitch - m.pitch) * damp(4, dt);
  turn(m, 'Head', 'y', m.yaw * .7); turn(m, 'Head', 'x', m.pitch * .6);
  for (const e of EYES) { turn(m, e, 'y', clamp(m.yaw * .5, -.35, .35)); turn(m, e, 'x', clamp(m.pitch * .5, -.25, .25)); }

  // secondary motion, from how the head, hips and holder actually move (clip and placement together)
  lizard.holder.updateMatrixWorld(true);
  wquat(lizard.holder, _q);
  _q2.copy(m.lastQ).invert().premultiply(_q);                          // this frame's holder rotation
  const ang = 2 * Math.acos(clamp(Math.abs(_q2.w), 0, 1)), ay = _v.set(_q2.x, _q2.y, _q2.z).applyQuaternion(_q.clone().invert()).y;
  m.yawRate += ((dt > 1e-4 ? Math.sign(ay) * ang / dt : 0) - m.yawRate) * damp(10, dt); m.lastQ.copy(_q);
  track(m.trHead, pointOf(m, 'head', _p0) || _p0.set(0, 0, 0), dt); track(m.trHips, wpos(B.Hips, _p1), dt);
  _q2.copy(_q).invert();
  const aH = _p2.copy(m.trHead.a).applyQuaternion(_q2), aP = _p3.copy(m.trHips.a).applyQuaternion(_q2);   // holder frame
  const steps = Math.max(1, Math.ceil(dt / (1 / 90))), h = Math.min(dt, .1) / steps;
  for (let i = 0; i < steps; i++) {
    stepSpring(m.hat.p, clamp(-aH.z * .018 - aH.y * .006, -.3, .3), 170, .16, h, .35);
    stepSpring(m.hat.r, clamp(aH.x * .018, -.3, .3), 150, .16, h, .35);
    stepSpring(m.tailY[0], clamp(-aP.x * .03 - m.yawRate * .12, -.6, .6), 70, .32, h);
    stepSpring(m.tailY[1], m.tailY[0].x, 55, .32, h); stepSpring(m.tailY[2], m.tailY[1].x, 42, .3, h);
    stepSpring(m.tailP[0], clamp(aP.y * .02, -.4, .4), 80, .3, h);
    stepSpring(m.tailP[1], m.tailP[0].x, 60, .3, h); stepSpring(m.tailP[2], m.tailP[1].x, 45, .28, h);
    stepSpring(m.belly, clamp(-aP.y * .012, -.12, .12), 240, .14, h, .15);
    stepSpring(m.cheek, clamp(-aH.y * .016, -.15, .15), 300, .14, h, .18);
  }
  turn(m, 'HatHard', 'x', m.hat.p.x); turn(m, 'HatHard', 'z', m.hat.r.x);
  TAILS.forEach((name, i) => { const s = i >> 1; turn(m, name, 'y', m.tailY[s].x * (.3 + .05 * i)); turn(m, name, 'x', m.tailP[s].x * (.3 + .05 * i)); });
  if (B.Belly) B.Belly.scale.multiply(_v.set(1 - m.belly.x * .5, 1 + m.belly.x, 1 - m.belly.x * .5));
  for (const c of ['CheekL', 'CheekR']) if (B[c]) B[c].scale.multiplyScalar(1 + m.cheek.x);

  // foot IK: every boot finds the surface under it (the stone, the rim, the brim) and keeps the clip's lift from there
  const ikTarget = lizard.support ? 1 : 0;
  m.ik += (ikTarget - m.ik) * damp(6, dt);
  if (m.ik > .01) {
    wpos(lizard.holder, _org); _up.set(0, 1, 0).applyQuaternion(wquat(lizard.holder, _qa)); _spaceInv.copy(lizard.supportSpace.matrixWorld).invert();
    for (const leg of LIMBS) plantLeg(m, lizard, leg, m.ik);
  }
  // the wrench comes out for tinkering (the keeper keeps hers in hand)
  const wantWrench = m.clip === 'tinker' || (lizard.role === 'keeper' && m.clip !== 'bite' && m.clip !== 'cheer') ? 1 : 0;
  m.wrench += (wantWrench - m.wrench) * damp(10, dt);
  if (B.Wrench) B.Wrench.scale.setScalar(m.wrench < .02 ? 0 : m.wrench);
  // veins: a steady fizz that flares while charging up and zapping
  m.vein += (veinTarget(m) - m.vein) * damp(12, dt);
  m.material.userData.lz.uLzVein.value = m.vein; m.material.userData.lz.uLzTime.value = t;
  // sparks: crackling round the head while charging, fizzing from the jaws on a bite, a spit at each wrench tap
  const sp = lizard.sparks, pt = m.prevTime; m.prevTime = ct;
  if (sp && dt > 0) {
    const rate = (r, key, n = 1, speed = 1, spread = .02) => { if (Math.random() < r * dt && pointOf(m, key, _pt)) emitSparks(sp, _pt, n, speed, spread); };
    if (m.clip === 'cheer' && ct > .05 && ct < .52) { rate(26, 'head', 2, 1.1, .2); rate(10, 'back', 2, .9, .16); }
    if (m.clip === 'bite' && ct > .45 && ct < 1.2) rate(30, 'mouth', 2, 1.6, .03);
    if (m.clip === 'tinker' && m.wrench > .5) for (const hit of [.55, 1.0]) if (pt < hit && ct >= hit && pointOf(m, 'wrench', _pt)) emitSparks(sp, _pt, 7, 1.3, .01);
  }
  // z's face whoever is watching
  if (m.clip === 'nap' && viewer.seen) {
    for (const z of ['Z1', 'Z2']) {
      const b = B[z]; if (!b || b.scale.x < .01) continue;
      b.parent.getWorldQuaternion(_q2); b.quaternion.copy(_q2.invert().multiply(viewer.quat));
    }
  }
  // cable: from the stub's tip to the plug-in point, swinging a little as the newt moves
  if (lizard.cable && lizard.plug && B.CableTip && B.Cable2) {
    wpos(B.CableTip, _tip); _dir.copy(_tip).sub(wpos(B.Cable2, _p2)).normalize();
    track(m.trTip, _tip, dt);
    const sub = Math.max(1, Math.ceil(dt / (1 / 60))), hh = Math.min(dt, .1) / sub;
    for (let i = 0; i < sub; i++) {
      _w.copy(m.trTip.a).multiplyScalar(-.012).clampLength(0, .08).add(_p3.set(Math.sin(t * 1.3 + lizard.look) * .006, 0, Math.cos(t * .9 + lizard.look * 2) * .006));
      m.swayV.addScaledVector(_p3.subVectors(_w, m.sway), 28 * hh).multiplyScalar(1 - 3 * hh); m.sway.addScaledVector(m.swayV, hh);
    }
    layCable(lizard.cable, _tip, _dir, lizard.plug(_v), lizard.cableSpace, m.sway);
  }
}

// --- Climbing frame on the tower ------------------------------------------------------------------------------------
const m4 = new THREE.Matrix4(), fwd = new THREE.Vector3(), upv = new THREE.Vector3(), side = new THREE.Vector3();
/** Point on the copper coil at u (0 bottom .. 1 top), `lift` beyond the wire centre. */
function onCoil(u, pos, lift = 0) {
  const y = TW.coil0 + (TW.coil1 - TW.coil0) * u, r = shaftR(y) + .09 + lift, a = TW.phase + TAU * TW.turns * u;
  return pos.set(Math.cos(a) * r, y, -Math.sin(a) * r);
}
/** Point and frame on the stone between the windings at u (the winding below it): belly to the wall, nose along the
 *  winding (dir +-1) or, with `vertical` +-1, straight up or down the wall; `rise` lifts it by that many pitches. */
function onStone(u, dir, pos, quat, {rise = 0, out = 0, vertical = 0} = {}) {
  const a = TW.phase + TAU * TW.turns * u, y = TW.coil0 + (TW.coil1 - TW.coil0) * u + PITCH * (.5 + rise);
  const f = a - Math.round(a / OCT) * OCT, r = stoneApothem(y) / Math.cos(f) + out;
  pos.set(Math.cos(a) * r, y, -Math.sin(a) * r);
  if (!quat) return pos;
  const fn = a - f + Math.sign(f) * OCT * .5 * sstep(.25, .5, Math.abs(f) / OCT);   // the face normal, eased round corners
  upv.set(Math.cos(fn), 0, -Math.sin(fn));
  if (vertical) fwd.set(0, vertical, 0);
  else { const da = TAU * TW.turns * r; fwd.set(-Math.sin(a) * da, TW.coil1 - TW.coil0, -Math.cos(a) * da).normalize().multiplyScalar(dir); }
  side.crossVectors(fwd, upv).normalize(); fwd.crossVectors(upv, side).normalize();
  m4.makeBasis(side, upv, fwd.negate());   // right-handed: x = y × z with z = -forward
  quat.setFromRotationMatrix(m4);
  return pos;
}
let stoneLength = 0;
{ const a = new THREE.Vector3(), b = new THREE.Vector3();
  onStone(0, 1, a); for (let i = 1; i <= 600; i++) { onStone(i / 600, 1, b); stoneLength += a.distanceTo(b); a.copy(b); } }
// The charge column stands on the front face (-Z, angle pi/2): the climber patrols one turn of the winding round the
// back, turning (or hopping a winding) a body length short of it on either side.
// The red and blue cable terminals (east and west, y 1.85) and the pack hooks under them (y 1.40, packs hanging below)
// also stand off the wall: on the turns that pass them the patrol stops short of them too.
const COLUMN_A = Math.PI / 2, COLUMN_GAP = .56;
const OBSTACLES = [[0, 1.85, .52, .3], [Math.PI, 1.85, .52, .3], [0, 1.2, .5, .42], [Math.PI, 1.2, .5, .42]];   // angle, y, half angle, half height
const U_TURN = 1 / TW.turns, U_RAD = 1 / (TAU * TW.turns);
const segStart = n => (COLUMN_A + COLUMN_GAP - TW.phase + TAU * n) * U_RAD;
const segEnd = n => segStart(n) + (TAU - 2 * COLUMN_GAP) * U_RAD;
const validTurn = n => n >= 0 && segStart(n) >= 0 && segEnd(n) <= 1;
const midY = u => TW.coil0 + (TW.coil1 - TW.coil0) * u + PITCH * .5;
/** The free stretch of turn n around u: [lo, hi] in u, or null if u itself is blocked. */
function freeRange(n, u) {
  if (!validTurn(n)) return null;
  let lo = segStart(n), hi = segEnd(n);
  if (u < lo || u > hi) return null;
  for (const [a, y, ha, hh] of OBSTACLES) {
    for (let k = n - 1; k <= n + 1; k++) {
      const uo = (a - TW.phase + TAU * k) * U_RAD; if (uo < lo - .05 || uo > hi + .05 || Math.abs(midY(uo) - y) > hh) continue;
      const b0 = uo - ha * U_RAD, b1 = uo + ha * U_RAD;
      if (u >= b0 && u <= b1) return null;
      if (b1 < u) lo = Math.max(lo, b1); else hi = Math.min(hi, b0);
    }
  }
  return hi - lo > .2 * U_TURN ? [lo, hi] : null;
}
const CLIMB_SPEED = .38, CLIMB_STRIDE = .1;   // m/s along the stone; body travel per climb loop (0.6 s) at timeScale 1

/** Review helper (tests/lizard-lab.html): one lizard of a look playing a chosen clip. Resolves once the model loads. */
export async function createLizardModel(look = 0, {role = 'show'} = {}) {
  await load();
  if (!template) return null;
  const lizard = {look, role, holder: new THREE.Group()}; lizard.m = makeModel(lizard); lizard.holder.add(lizard.m.model);
  lizard.cable = makeCable(); lizard.cableSpace = lizard.holder; lizard.holder.add(lizard.cable);
  const sp = makeSparks(); lizard.sparks = sp; lizard.holder.add(sp.points);
  lizard.plug = out => lizard.holder.localToWorld(out.set(.05, 0, .55));
  return {group: lizard.holder, play: (name, fade = 0) => play(lizard.m, name, fade, false, true),
    update: (t, dt, target = null) => { frameNo++; animateModel(lizard, t, dt, target); updateSparks(sp, dt); }, model: lizard.m};
}

// --- The crew -------------------------------------------------------------------------------------------------------
export function createLizardCrew() {
  const group = new THREE.Group(); group.name = 'LizardCrew';
  const sparks = makeSparks(); group.add(sparks.points);
  const mk = (role, look) => { const holder = new THREE.Group(); holder.name = `Lizard_${LIZARD_LOOKS[look].name}`; group.add(holder); return {role, look, holder, stand: null, m: null, cable: null, cableSpace: group, supportSpace: group, sparks, cheerIn: -1, cheerLeft: 0}; };
  const climber = mk('climber', 0), keeper = mk('keeper', 1), lounger = mk('lounger', 2), crew = [climber, keeper, lounger];
  climber.support = supportShaft; keeper.support = supportHopper; lounger.support = supportBrim;
  // The keeper straddles the right side of the hopper rim like a cat on a fence, belly on the lip, facing the front
  // of the tower (her inner boots brace on the inside of the bowl, her outer ones hook the lip; the tail curls up
  // clear of the charge column); the lounger drapes along the copper torus brim over the charge column.
  keeper.holder.position.set(HOPPER.x + .382, HOPPER.y + .32 - .046, HOPPER.z + .02); keeper.holder.rotation.y = -.12;
  lounger.holder.position.set(0, BRIM.y + BRIM.r - .02, -BRIM.R); lounger.holder.rotation.y = Math.PI / 2;
  const seed = Math.random() * 100;
  let n0 = 0, u0 = 0, range = null;
  for (let tries = 0; tries < 40 && !range; tries++) { n0 = Math.floor(Math.random() * TW.turns); if (validTurn(n0)) { u0 = lerp(segStart(n0), segEnd(n0), Math.random()); range = freeRange(n0, u0); } }
  if (!range) { n0 = 5; u0 = lerp(segStart(5), segEnd(5), .5); }
  const climb = {n: n0, u: u0, dir: Math.random() < .5 ? 1 : -1, mode: 'move', left: 0,
    nextStop: 3 + Math.random() * 5, quat: new THREE.Quaternion(), pos: new THREE.Vector3(), init: false, hop: null};
  const keep = {mode: 'tinker', left: 4 + Math.random() * 4, next: 0};
  const nap = {awake: 0};
  // where each one is plugged in (world space): the winding below the climber a little behind it, the face of the
  // plinth step behind the hopper, the torus brim behind the napper
  const local = (x, y, z, out) => group.localToWorld(out.set(x, y, z));
  climber.plug = out => { onCoil(clamp(climb.u - climb.dir * .4 / stoneLength, 0, 1), out, .02); return group.localToWorld(out); };
  keeper.plug = out => local(.42, .64, -1.078, out);
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
  function climberStep(dt) {
    if (climb.mode === 'move') {
      climb.u += climb.dir * CLIMB_SPEED * dt / stoneLength; climb.nextStop -= CLIMB_SPEED * dt;
      const r = freeRange(climb.n, climb.u - climb.dir * 1e-4) || [climb.u, climb.u], lo = r[0], hi = r[1];
      if (climb.u >= hi || climb.u <= lo) { climb.u = clamp(climb.u, lo, hi); climb.mode = 'idle'; climb.left = 2 + Math.random() * 2; climb.end = true; }
      else if (climb.nextStop <= 0) { const r = Math.random(); climb.mode = r < .4 ? 'tinker' : r < .75 ? 'bite' : 'idle'; climb.left = climb.mode === 'bite' ? 1.8 * (1 + (Math.random() < .4)) : 2.5 + Math.random() * 2.5; }
    } else if (climb.mode === 'hop') {
      climb.hop.t += dt;
      if (climb.hop.t >= 1.5) { climb.n = climb.hop.to; climb.u += (climb.hop.to - climb.hop.from) * U_TURN; climb.dir = -climb.dir; climb.hop = null; climb.mode = 'move'; climb.nextStop = 3 + Math.random() * 6; }
    } else {
      climb.left -= dt;
      if (climb.left <= 0) {
        if (climb.end) {
          climb.end = false;
          const to = climb.n + (Math.random() < .5 ? 1 : -1), alt = 2 * climb.n - to;
          const ok = n => !!freeRange(n, climb.u + (n - climb.n) * U_TURN - climb.dir * .02 * U_TURN);   // room to walk back from there
          const hopTo = Math.random() < .6 ? (ok(to) ? to : ok(alt) ? alt : null) : null;
          if (hopTo !== null) { climb.mode = 'hop'; climb.hop = {t: 0, from: climb.n, to: hopTo}; return; }
          climb.dir = -climb.dir;
        }
        climb.mode = 'move'; climb.nextStop = 3 + Math.random() * 6;
      }
    }
  }
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
      // the climber trots along the winding, stops now and then to tap or zap it, and at the charge column turns back
      // or hops over a winding to the next turn
      if (!cheering(climber) || climb.mode === 'hop') climberStep(dt);
      if (climb.mode === 'hop') {
        const hp = climb.hop, k = sstep(.35, 1.2, hp.t), rise = (hp.to - hp.from) * k, vert = Math.sign(hp.to - hp.from);
        onStone(climb.u, climb.dir, climb.pos, climb.quat, {rise, out: .16 * Math.sin(Math.PI * k), vertical: hp.t < 1.25 ? vert : 0});
        if (hp.t >= 1.25) onStone(climb.u + (hp.to - hp.from) / TW.turns, -climb.dir, climb.pos, climb.quat);
      } else onStone(clamp(climb.u, 0, 1), climb.dir, climb.pos, climb.quat);
      if (!climb.init) { climber.holder.position.copy(climb.pos); climber.holder.quaternion.copy(climb.quat); climb.init = true; }
      else { climber.holder.position.lerp(climb.pos, damp(climb.mode === 'hop' ? 10 : 30, dt)); climber.holder.quaternion.slerp(climb.quat, damp(climb.mode === 'hop' ? 7 : 5, dt)); }
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
          play(m, climb.mode === 'move' || climb.mode === 'hop' ? 'climb' : climb.mode);
          if (m.clip === 'climb') m.actions.climb.setEffectiveTimeScale(climb.mode === 'hop' ? 2.2 : CLIMB_SPEED * .6 / CLIMB_STRIDE);
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
      updateSparks(sparks, dt);
      // stand-in hop when cheering
      for (const l of crew) if (l.stand) { const k = l.cheerLeft > 0 ? Math.abs(Math.sin((1.6 - l.cheerLeft) * Math.PI * 2)) * .15 * l.cheerLeft / 1.6 : 0; l.stand.group.position.y = k; }
    },
  };
}
