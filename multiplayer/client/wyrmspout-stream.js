// Wyrmspout presentation: a jet of sticky liquid fire that leaves the wyrm's mouth as one rope, breaks into
// globs, arcs under the same gravity as the authority (shared/wyrmspout.js), splats where it lands and clings
// burning to whatever it hits. Presentation only: damage, sticking and ground fire are the host's.
//
// Everything moves every frame:
//   - the local player's stream is predicted from the muzzle and aim each frame while the trigger is held;
//   - other players' streams follow their authoritative globs analytically at the presentation tick
//     (bornTick + launch velocity), each glob widened into a few drops so the stream stays continuous;
//   - stuck globs ride the enemy part they hit (event goo_stick), splats sit on the contact normal.
// Budgets are fixed (instances, not objects): five draws, no lights (fire-presentation owns the three lights).
import * as THREE from 'three';
import {WYRMSPOUT} from '../shared/wyrmspout.js';

export const STREAM_CAPS = Object.freeze({drops: 240, licks: 260, splats: 64, stuck: 48, ribbonPoints: 40, ribbons: 4});
const RIBBON_AGE = .26;       // seconds a drop stays part of the continuous rope before it breaks off into a glob
const LOCAL_RATE = 110;        // visual drops per second from the local nozzle (scaled by quality)
const REMOTE_DROPS = 5;       // visual drops per remote authoritative glob
const SPLAT_LIFE = 2.6, STUCK_FADE = .5;

const hash = n => { n |= 0; n = Math.imul(n ^ (n >>> 16), 0x7feb352d); n = Math.imul(n ^ (n >>> 15), 0x846ca68b); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
const idSeed = id => { let h = 2166136261; for (const c of String(id)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h | 0; };

const NOISE = `
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
vec3 liquidFire(float t){ // 0 white-hot core .. 1 dark cooling skin
  vec3 hot = vec3(1.0, 0.88, 0.48), mid = vec3(1.0, 0.46, 0.07), edge = vec3(0.46, 0.07, 0.015);
  return t < 0.5 ? mix(hot, mid, t * 2.0) : mix(mid, edge, (t - 0.5) * 2.0);
}`;

// Globs: stretched along their velocity, hot inside, a darker viscous skin at the rim.
const DROP_VERT = `
attribute float aHeat; varying vec3 vN; varying vec3 vV; varying float vHeat; varying vec3 vObj;
void main(){
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix * instanceMatrix) * normal); vV = cameraPosition - wp.xyz; vHeat = aHeat; vObj = position;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const DROP_FRAG = `
uniform float uTime; varying vec3 vN; varying vec3 vV; varying float vHeat; varying vec3 vObj;
${NOISE}
void main(){
  float fres = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float n = vn(vObj.xy * 7.0 + vec2(uTime * 2.3, -uTime * 3.1)) * 0.6 + vn(vObj.yz * 13.0 - uTime * 4.0) * 0.4;
  float t = clamp(fres * 1.15 + (1.0 - vHeat) * 0.55 + (n - 0.5) * 0.45, 0.0, 1.0);
  gl_FragColor = vec4(liquidFire(t) * (0.85 + 0.3 * vHeat), 1.0);
}`;

// The rope near the mouth: a camera-facing strip, hot down the middle, ragged at the edges.
const RIBBON_VERT = `
attribute float aAcross; attribute float aAlong; attribute float aHeat; varying float vAcross; varying float vAlong; varying float vHeat;
void main(){ vAcross = aAcross; vAlong = aAlong; vHeat = aHeat; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;
const RIBBON_FRAG = `
uniform float uTime; varying float vAcross; varying float vAlong; varying float vHeat;
${NOISE}
void main(){
  float a = abs(vAcross);
  float n = vn(vec2(vAlong * 9.0 - uTime * 14.0, vAcross * 2.0)) * 0.65 + vn(vec2(vAlong * 23.0 - uTime * 22.0, 3.0 + vAcross)) * 0.35;
  if (a > 0.78 + 0.3 * (n - 0.5)) discard;
  float t = clamp(a * 1.05 + (1.0 - vHeat) * 0.4 + (n - 0.5) * 0.35, 0.0, 1.0);
  gl_FragColor = vec4(liquidFire(t) * (0.9 + 0.25 * vHeat), 1.0);
}`;

// Splats: an irregular puddle on the contact surface that glows, crusts over and fades.
const SPLAT_VERT = `
attribute vec2 aSplat; varying vec2 vUv; varying vec2 vS;
void main(){ vUv = uv * 2.0 - 1.0; vS = aSplat; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }`;
const SPLAT_FRAG = `
uniform float uTime; varying vec2 vUv; varying vec2 vS;
${NOISE}
void main(){
  float r = length(vUv), ang = atan(vUv.y, vUv.x), seed = vS.y * 37.0;
  float edge = 0.62 + 0.22 * vn(vec2(ang * 1.6 + seed, seed)) + 0.14 * vn(vec2(ang * 4.0 - seed, 1.0 + seed));
  float age = vS.x;
  if (r > edge * (1.0 - 0.15 * age)) discard;
  float n = vn(vUv * 5.0 + seed + vec2(0.0, uTime * 0.6));
  float heat = clamp(1.0 - age * 1.25, 0.0, 1.0);
  float t = clamp(r / edge * 0.75 + (1.0 - heat) * 0.7 + (n - 0.5) * 0.4, 0.0, 1.0);
  vec3 c = liquidFire(t) * (0.35 + 0.75 * heat) + vec3(0.9, 0.35, 0.05) * pow(n, 6.0) * (1.0 - heat) * 1.5; // ember speckles as it crusts
  float alpha = clamp((1.0 - age) * 3.0, 0.0, 1.0);
  if (alpha < h21(gl_FragCoord.xy)) discard; // dithered fade, no sorting
  gl_FragColor = vec4(c, 1.0);
}`;

// Licks of flame riding the burning liquid: upright billboards, additive with occlusion like fire-presentation.
const LICK_VERT = `
attribute vec4 aLick; uniform float uTime; varying vec2 vUv; varying float vA; varying float vSeed;
void main(){
  vUv = uv; vA = aLick.z; vSeed = aLick.y;
  vec3 c = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 up = vec3(0.0, 1.0, 0.0), view = normalize(cameraPosition - c), right = normalize(cross(up, view));
  float s = aLick.x, sway = sin(uTime * 9.0 + aLick.y * 40.0) * 0.18 * uv.y * uv.y;
  vec3 wp = c + right * ((uv.x - 0.5) * s * 0.75 + sway * s) + up * (uv.y * s * 1.2 - s * 0.15);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const LICK_FRAG = `
uniform float uTime; varying vec2 vUv; varying float vA; varying float vSeed;
${NOISE}
void main(){
  float v = vUv.y, u = (vUv.x - 0.5) * 2.0;
  float w = 0.9 * pow(sin(3.14159 * pow(v, 0.6)), 0.8);
  float n = vn(vec2(u * 2.0 + vSeed * 9.0, v * 3.0 - uTime * 5.0 + vSeed * 7.0));
  float m = clamp((w - abs(u)) / max(w, 1e-3), 0.0, 1.0) * (0.65 + 0.7 * n) * smoothstep(1.0, 0.55, v);
  if (m <= 0.01) discard;
  vec3 c = mix(vec3(1.0, 0.36, 0.04), vec3(1.0, 0.86, 0.45), clamp(m * 1.4 - v * 0.6, 0.0, 1.0));
  float a = clamp(m * 1.2, 0.0, 1.0) * vA;
  gl_FragColor = vec4(c * a, a * 0.55);
}`;

export function createWyrmspoutStream({scene, height = () => 0, quality = 1, now = () => performance.now() / 1000} = {}) {
  const group = new THREE.Group(); group.name = 'WyrmspoutStream'; scene.add(group);
  const uTime = {value: 0};
  let q = quality;

  // ---------------------------------------------------------------- meshes
  const dropGeo = new THREE.IcosahedronGeometry(1, 1);
  const dropMat = new THREE.ShaderMaterial({vertexShader: DROP_VERT, fragmentShader: DROP_FRAG, uniforms: {uTime}});
  const dropHeat = new THREE.InstancedBufferAttribute(new Float32Array(STREAM_CAPS.drops + STREAM_CAPS.stuck + 8), 1);
  dropGeo.setAttribute('aHeat', dropHeat);
  const drops = new THREE.InstancedMesh(dropGeo, dropMat, STREAM_CAPS.drops + STREAM_CAPS.stuck + 8);
  drops.frustumCulled = false; drops.count = 0; drops.name = 'WyrmspoutGlobs'; group.add(drops);

  const ribbonVerts = STREAM_CAPS.ribbons * STREAM_CAPS.ribbonPoints * 2;
  const ribbonGeo = new THREE.BufferGeometry();
  const rPos = new Float32Array(ribbonVerts * 3), rAcross = new Float32Array(ribbonVerts), rAlong = new Float32Array(ribbonVerts), rHeat = new Float32Array(ribbonVerts);
  ribbonGeo.setAttribute('position', new THREE.BufferAttribute(rPos, 3).setUsage(THREE.DynamicDrawUsage));
  ribbonGeo.setAttribute('aAcross', new THREE.BufferAttribute(rAcross, 1).setUsage(THREE.DynamicDrawUsage));
  ribbonGeo.setAttribute('aAlong', new THREE.BufferAttribute(rAlong, 1).setUsage(THREE.DynamicDrawUsage));
  ribbonGeo.setAttribute('aHeat', new THREE.BufferAttribute(rHeat, 1).setUsage(THREE.DynamicDrawUsage));
  const rIndex = []; for (let s = 0; s < STREAM_CAPS.ribbons; s++) for (let i = 0; i < STREAM_CAPS.ribbonPoints - 1; i++) { const a = (s * STREAM_CAPS.ribbonPoints + i) * 2; rIndex.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  ribbonGeo.setIndex(rIndex);
  const ribbonMat = new THREE.ShaderMaterial({vertexShader: RIBBON_VERT, fragmentShader: RIBBON_FRAG, uniforms: {uTime}, side: THREE.DoubleSide});
  const ribbon = new THREE.Mesh(ribbonGeo, ribbonMat); ribbon.frustumCulled = false; ribbon.name = 'WyrmspoutRope'; group.add(ribbon);

  const splatGeo = new THREE.CircleGeometry(1, 18);
  const splatData = new THREE.InstancedBufferAttribute(new Float32Array(STREAM_CAPS.splats * 2), 2); splatGeo.setAttribute('aSplat', splatData);
  const splatMat = new THREE.ShaderMaterial({vertexShader: SPLAT_VERT, fragmentShader: SPLAT_FRAG, uniforms: {uTime}, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2});
  const splatMesh = new THREE.InstancedMesh(splatGeo, splatMat, STREAM_CAPS.splats); splatMesh.frustumCulled = false; splatMesh.count = 0; splatMesh.name = 'WyrmspoutSplats'; group.add(splatMesh);

  const lickGeo = new THREE.PlaneGeometry(1, 1, 1, 4); lickGeo.translate(.5, .5, 0);
  const lickData = new THREE.InstancedBufferAttribute(new Float32Array(STREAM_CAPS.licks * 4), 4); lickGeo.setAttribute('aLick', lickData);
  const lickMat = new THREE.ShaderMaterial({vertexShader: LICK_VERT, fragmentShader: LICK_FRAG, uniforms: {uTime}, transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, side: THREE.DoubleSide});
  const licks = new THREE.InstancedMesh(lickGeo, lickMat, STREAM_CAPS.licks); licks.frustumCulled = false; licks.count = 0; licks.name = 'WyrmspoutLicks'; group.add(licks);

  // ---------------------------------------------------------------- state pools
  const pool = Array.from({length: STREAM_CAPS.drops}, () => ({live: false, p: new THREE.Vector3(), v: new THREE.Vector3(), age: 0, life: 1, size: .03, seed: 0, stream: null, order: 0, delay: 0, gravity: WYRMSPOUT.gravity, heat: 1, splat: true, rope: true}));
  const splats = Array.from({length: STREAM_CAPS.splats}, () => ({live: false, p: new THREE.Vector3(), n: new THREE.Vector3(0, 1, 0), r: .1, age: 0, life: SPLAT_LIFE, seed: 0}));
  const stuck = Array.from({length: STREAM_CAPS.stuck}, () => ({live: false, target: null, key: '', local: new THREE.Vector3(), until: 0, size: .05, seed: 0, drip: 0}));
  const gouts = new Map();   // id -> {p, v, age, delay, owner, local}
  const remoteGlobs = new Set();
  const streams = new Map(); // key -> {muzzle: Vector3|null, firing, lastEmit, order}
  let dropCursor = 0, order = 0, emitCarry = 0;
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1), _y = new THREE.Vector3(0, 1, 0);

  function stream(key) { let s = streams.get(key); if (!s) streams.set(key, s = {muzzle: null, prevMuzzle: null, firing: false, quietFor: 0}); return s; }
  function spawnDrop(p, v, {life, size, key = null, delay = 0, gravity = WYRMSPOUT.gravity, heat = 1, splat = true, rope = true} = {}) {
    const limit = Math.round(STREAM_CAPS.drops * (q < .5 ? .5 : 1));
    let d = null;
    for (let i = 0; i < limit; i++) { const k = (dropCursor + i) % limit; if (!pool[k].live) { d = pool[k]; dropCursor = k + 1; break; } }
    if (!d) { d = pool[dropCursor % limit]; dropCursor++; } // steal the oldest slot rather than drop the newest drop
    d.live = true; d.p.copy(p); d.v.copy(v); d.age = 0; d.life = life; d.size = size; d.seed = hash(++order * 7919); d.stream = key; d.order = order;
    d.delay = delay; d.gravity = gravity; d.heat = heat; d.splat = splat; d.rope = rope && !!key;
    return d;
  }
  function addSplat(p, n, r, seed = Math.random()) {
    let best = null, oldest = -1;
    for (const s of splats) { if (!s.live) { best = s; break; } if (s.age > oldest) { oldest = s.age; best = s; } }
    best.live = true; best.p.copy(p); best.n.copy(n).normalize(); best.r = r; best.age = 0; best.life = SPLAT_LIFE * (.8 + .4 * seed); best.seed = seed;
  }
  // Merge into a nearby young splat instead of stacking dozens of discs in one puddle.
  function splatAt(p, n, r) {
    for (const s of splats) if (s.live && s.age < s.life * .6 && s.p.distanceToSquared(p) < (s.r * .7) ** 2) { s.r = Math.min(.55, Math.hypot(s.r, r * .55)); s.age = Math.max(0, s.age - .4); return; }
    addSplat(p, n, r);
  }
  function burst(at, normal, {count = 28, speed = 3.2, size = .05, key = null} = {}) {
    const n = _a.fromArray(normal || [0, 1, 0]).normalize(), up = n.y > .2 ? n : _y;
    const k = Math.round(count * (q < .5 ? .5 : 1));
    for (let i = 0; i < k; i++) {
      const s = hash(++order * 31), t = hash(order * 17) * Math.PI * 2;
      _b.set(Math.cos(t), 0, Math.sin(t)).multiplyScalar(.6 + s).addScaledVector(up, 1.2 + hash(order * 13) * 1.4).normalize().multiplyScalar(speed * (.5 + hash(order * 3)));
      spawnDrop(_c.fromArray(at).addScaledVector(up, .05), _b, {life: 1.1, size: size * (.5 + s), key, rope: false});
    }
  }

  // ---------------------------------------------------------------- local stream (predicted every frame)
  function emitLocal(key, muzzle, direction, tuning, dt) {
    const s = stream(key); s.firing = true; s.local = true; s.quietFor = 0;
    const from = s.prevMuzzle || muzzle;
    const rate = LOCAL_RATE * (q < .5 ? .55 : 1) * (tuning.flood ? 1.25 : 1);
    emitCarry += rate * dt; const n = Math.min(12, Math.floor(emitCarry)); emitCarry -= n;
    const dir = _a.fromArray(direction).normalize();
    for (let i = 0; i < n; i++) {
      const f = (i + 1) / n, at = _b.lerpVectors(from, muzzle, f);
      const r1 = hash(order * 97 + 1) - .5, r2 = hash(order * 97 + 2) - .5;
      const side = _c.set(-dir.z, 0, dir.x).normalize(), lift = side.clone().cross(dir).normalize();
      const v = dir.clone().multiplyScalar(tuning.speed * (.97 + .06 * hash(order * 97 + 3)))
        .addScaledVector(side, r1 * WYRMSPOUT.spread * tuning.speed * 2).addScaledVector(lift, r2 * WYRMSPOUT.spread * tuning.speed * 2);
      // Sub-frame emission: start each drop where it would be had it left the nozzle between frames.
      const back = (1 - f) * dt; at.addScaledVector(v, back);
      const d = spawnDrop(at, v, {life: tuning.lifeTicks / 60, size: .045 + .045 * hash(order * 97 + 4), key, gravity: tuning.gravity});
      d.age = back;
    }
    s.prevMuzzle = (s.prevMuzzle || new THREE.Vector3()).copy(muzzle); s.muzzle = (s.muzzle || new THREE.Vector3()).copy(muzzle);
  }
  function stopLocal(key) { const s = streams.get(key); if (s) { s.firing = false; s.prevMuzzle = null; } emitCarry = 0; }
  function launchLocalGout(id, origin, direction) {
    const G = WYRMSPOUT.gout, v = new THREE.Vector3().fromArray(direction).normalize().multiplyScalar(G.speed); v.y += G.loft;
    gouts.set(id, {p: new THREE.Vector3().fromArray(origin), v, age: 0, delay: 0, local: true});
  }

  // ---------------------------------------------------------------- remote streams (authoritative globs at the presentation tick)
  function sync(snapshot, {localId, renderTick}) {
    const seen = new Set();
    for (const g of snapshot?.projectiles || []) {
      if (g.kind !== 'flame') continue;
      seen.add(g.id);
      if (g.ownerId === localId || remoteGlobs.has(g.id)) continue;
      remoteGlobs.add(g.id);
      const origin = g.trail?.[0] || g.position, age = Math.max(0, (snapshot.tick - g.bornTick) / 60);
      // Launch velocity: undo gravity over the glob's age (drag is negligible at this range).
      const v0 = new THREE.Vector3().fromArray(g.velocity || [0, 0, 0]); v0.y += WYRMSPOUT.gravity * age;
      if (g.gout) { gouts.set(g.id, {p: new THREE.Vector3().fromArray(origin), v: v0, age: 0, delay: (g.bornTick - renderTick) / 60, local: false}); continue; }
      const key = `p:${g.ownerId}`, s = stream(key); s.firing = true; s.quietFor = 0;
      const speed = v0.length(), dir = v0.clone().normalize(), side = new THREE.Vector3(-dir.z, 0, dir.x).normalize(), lift = side.clone().cross(dir).normalize();
      for (let k = 0; k < REMOTE_DROPS; k++) {
        const r1 = hash(idSeed(g.id) + k * 11) - .5, r2 = hash(idSeed(g.id) + k * 13) - .5;
        const v = v0.clone().multiplyScalar(.97 + .06 * hash(idSeed(g.id) + k)).addScaledVector(side, r1 * WYRMSPOUT.spread * speed * 2).addScaledVector(lift, r2 * WYRMSPOUT.spread * speed * 2);
        // Spread the glob's drops over the gap to the next glob, each born at its own (sub-)tick.
        const born = g.bornTick + k * WYRMSPOUT.burstTicks / WYRMSPOUT.globs / REMOTE_DROPS;
        spawnDrop(new THREE.Vector3().fromArray(origin), v, {life: WYRMSPOUT.lifeTicks / 60 * 1.3, size: .045 + .04 * hash(idSeed(g.id) + k * 5), key, delay: (born - renderTick) / 60});
      }
      s.muzzle = (s.muzzle || new THREE.Vector3()).fromArray(origin);
    }
    for (const id of remoteGlobs) if (!seen.has(id)) remoteGlobs.delete(id);
    for (const [id, g] of gouts) if (!g.local && !seen.has(id) && g.age > .2) { gouts.delete(id); burst(g.p.toArray(), [0, 1, 0], {count: 22}); }
  }

  // ---------------------------------------------------------------- authoritative results
  function handleEvent(event, {resolveTarget, localId} = {}) {
    if (!event?.position) return;
    const at = _a.fromArray(event.position);
    if (event.kind === 'goo_splat') {
      const n = _b.fromArray(event.normal || [0, 1, 0]);
      splatAt(at.clone().addScaledVector(n, .012), n.clone(), .13 + .06 * Math.random());
      // The stream stops at walls and trunks: retire visual drops of that player's stream that already passed the contact.
      if (n.y < .7) for (const d of pool) if (d.live && d.stream === `p:${event.by}` && d.p.distanceToSquared(at) < .5) d.live = false;
    } else if (event.kind === 'goo_stick') {
      const target = resolveTarget?.(event.id, event.part);
      if (!target) return;
      target.updateWorldMatrix(true, false);
      const key = `${event.id}`;
      let count = 0, slot = null, oldest = null;
      for (const s of stuck) { if (s.live && s.key === key) { count++; if (!oldest || s.until < oldest.until) oldest = s; } else if (!s.live && !slot) slot = s; }
      if (count >= WYRMSPOUT.maxGoo) slot = oldest; // refresh the oldest instead of piling on
      if (!slot) slot = stuck.reduce((a, b) => a.until < b.until ? a : b);
      slot.live = true; slot.key = key; slot.target = target; slot.local.copy(at).applyMatrix4(_m.copy(target.matrixWorld).invert());
      slot.until = now() + (event.burn || WYRMSPOUT.burnTicks) / 60; slot.size = .045 + .03 * Math.random(); slot.seed = Math.random(); slot.drip = Math.random();
      for (const s of stuck) if (s.live && s.key === key) s.until = Math.max(s.until, slot.until); // every glob on the foe burns as long as the newest
    } else if (event.kind === 'gout_burst') {
      gouts.delete(event.id);
      // Our own Gout was drawn ahead of the host: the host's burst (maybe on a foe, mid-air) replaces the oldest one.
      if (event.by === localId) for (const [id, g] of gouts) if (g.local) { gouts.delete(id); break; }
      const ground = event.ground ? _b.fromArray(event.ground) : at;
      addSplat(ground.clone().add(_c.set(0, .015, 0)), _y.clone(), Math.min(1.1, event.radius * .45), Math.random());
      for (let i = 0; i < 4; i++) { const t = i / 4 * Math.PI * 2 + Math.random(); addSplat(ground.clone().add(_c.set(Math.cos(t) * event.radius * .45, .016, Math.sin(t) * event.radius * .45)), _y.clone(), .3 + .2 * Math.random()); }
      burst(event.position, [0, 1, 0], {count: 36, speed: 4.5, size: .06});
    } else if (event.kind === 'cling_splash') {
      burst(event.position, [0, 1, 0], {count: 24, speed: 3.6, size: .05});
    }
  }
  function clearTarget(id) { for (const s of stuck) if (s.live && s.key === `${id}`) s.live = false; }

  // ---------------------------------------------------------------- per frame
  let dropCount = 0, lickCount = 0;
  function pushDrop(p, dir, len, width, heat) {
    if (dropCount >= drops.count && dropCount >= drops.instanceMatrix.count) return;
    if (dir.lengthSq() > 1e-8) _q.setFromUnitVectors(_y, _c.copy(dir).normalize()); else _q.identity();
    _s.set(width, len, width); _m.compose(p, _q, _s); drops.setMatrixAt(dropCount, _m); dropHeat.array[dropCount] = heat; dropCount++;
  }
  function pushLick(p, size, seed, alpha) {
    if (lickCount >= STREAM_CAPS.licks || alpha < .02 || q < .2) return;
    _m.makeTranslation(p.x, p.y, p.z); licks.setMatrixAt(lickCount, _m);
    lickData.array[lickCount * 4] = size; lickData.array[lickCount * 4 + 1] = seed; lickData.array[lickCount * 4 + 2] = alpha; lickCount++;
  }

  function update(dt, camera) {
    dt = Math.min(.1, Math.max(0, dt || 0)); const time = now(); uTime.value = time % 1000;
    dropCount = 0; lickCount = 0; drops.count = drops.instanceMatrix.count;
    // drops: integrate, land, splat
    for (const d of pool) {
      if (!d.live) continue;
      if (d.delay > 0) { d.delay -= dt; if (d.delay > 0) continue; }
      d.age += dt; if (d.age > d.life) { d.live = false; continue; }
      d.v.y -= d.gravity * dt; d.p.addScaledVector(d.v, dt);
      const ground = height(d.p.x, d.p.z);
      if (d.p.y <= ground) {
        d.live = false;
        if (d.splat) { _a.set(d.p.x, ground + .012, d.p.z); splatAt(_a, _y, .1 + d.size * 3); if (q >= .5 && hash(d.order * 3) < .25) spawnDrop(_a, _b.set((hash(d.order) - .5) * 1.4, 1 + hash(d.order * 5), (hash(d.order * 7) - .5) * 1.4), {life: .35, size: d.size * .45, splat: false, rope: false}); }
        continue;
      }
      // Inside the rope near the mouth the drop is drawn by the ribbon; afterwards it swells into a glob.
      const broke = d.rope ? THREE.MathUtils.smoothstep(d.age, RIBBON_AGE * .55, RIBBON_AGE) : 1;
      if (broke > .02) {
        const speed = d.v.length(), stretch = 1 + Math.min(1.6, speed * .09);
        const wobble = 1 + .14 * Math.sin(time * 23 + d.seed * 40);
        pushDrop(d.p, d.v, d.size * stretch * wobble * broke, d.size / Math.sqrt(stretch) * (2 - wobble) * broke, d.heat * (1 - .45 * d.age / d.life));
        // Fire billows off the burning liquid and swells as it flies.
        if (d.seed < .62) pushLick(d.p, .18 + d.size * 3 + d.age * .9, d.seed, .85 * broke * (1 - d.age / d.life) ** .7);
      }
    }
    // gout balls
    for (const [id, g] of gouts) {
      if (g.delay > 0) { g.delay -= dt; if (g.delay > 0) continue; }
      g.age += dt; g.v.y -= WYRMSPOUT.gravity * dt; g.p.addScaledVector(g.v, dt);
      const ground = height(g.p.x, g.p.z);
      if (g.age > WYRMSPOUT.gout.lifeTicks / 60 + .3 || g.p.y <= ground) {
        gouts.delete(id); if (g.p.y <= ground + .2) addSplat(_a.set(g.p.x, ground + .015, g.p.z), _y, .7); burst(g.p.toArray(), [0, 1, 0], {count: 26, speed: 3.8, size: .055});
        continue;
      }
      const wob = 1 + .12 * Math.sin(time * 17 + id.length);
      pushDrop(g.p, g.v, .16 * wob, .13 / wob, 1);
      for (let k = 0; k < 3; k++) pushLick(_a.copy(g.p).addScaledVector(g.v, -.03 * k), .35 - .07 * k, hash(k + id.length), .9);
      if (q >= .5 && hash(Math.floor(time * 40) + id.length) < dt * 30) spawnDrop(g.p, _b.copy(g.v).multiplyScalar(.2), {life: .6, size: .03, rope: false});
    }
    // stuck globs follow the part they hit
    for (const s of stuck) {
      if (!s.live) continue;
      const left = s.until - time;
      if (left <= 0 || !s.target?.parent || !s.target.visible) { s.live = false; continue; }
      s.target.updateWorldMatrix(true, false);
      const p = _a.copy(s.local).applyMatrix4(s.target.matrixWorld), fade = Math.min(1, left / STUCK_FADE);
      const pulse = 1 + .1 * Math.sin(time * 6 + s.seed * 30);
      pushDrop(p, _y, s.size * pulse * fade, s.size * 1.15 * fade, .75 + .25 * Math.sin(time * 3 + s.seed * 9));
      pushLick(p, .22 + s.size * 2, s.seed, .95 * fade);
      if (q >= .5 && (s.drip += dt * (.8 + s.seed)) > 1) { s.drip = 0; spawnDrop(p, _b.set(0, -.2, 0), {life: 1.2, size: s.size * .35, rope: false}); }
    }
    drops.count = dropCount; drops.instanceMatrix.needsUpdate = true; dropHeat.needsUpdate = true; drops.visible = dropCount > 0;
    // splats
    let sc = 0;
    for (const s of splats) {
      if (!s.live) continue;
      s.age += dt; if (s.age > s.life) { s.live = false; continue; }
      _q.setFromUnitVectors(_z, s.n); const grow = Math.min(1, s.age / .12);
      _s.set(s.r * (.6 + .4 * grow), s.r * (.6 + .4 * grow), 1); _m.compose(s.p, _q, _s); splatMesh.setMatrixAt(sc, _m);
      splatData.array[sc * 2] = s.age / s.life; splatData.array[sc * 2 + 1] = s.seed; sc++;
      if (s.age < s.life * .55) pushLick(_a.copy(s.p).addScaledVector(s.n, .02), .14 + s.r * .9, s.seed, .8 * (1 - s.age / (s.life * .55)));
    }
    splatMesh.count = sc; splatMesh.instanceMatrix.needsUpdate = true; splatData.needsUpdate = true; splatMesh.visible = sc > 0;
    licks.count = lickCount; licks.instanceMatrix.needsUpdate = true; lickData.needsUpdate = true; licks.visible = lickCount > 0;
    updateRibbons(camera, time);
    for (const [key, s] of streams) {
      if (!s.local && (s.quietFor += dt) > .35) s.firing = false;   // remote: no new glob for a while means they let go
      if (s.firing) s.idle = 0; else if ((s.idle = (s.idle || 0) + dt) > 2) streams.delete(key);
    }
  }

  // The rope: from the nozzle through the stream's youngest drops, until the first one that has broken away.
  const chain = [], _sm = Array.from({length: 128}, () => new THREE.Vector3());
  function updateRibbons(camera, time) {
    const camPos = camera ? camera.getWorldPosition(_c) : _c.set(0, 2, 5);
    let r = 0, verts = 0;
    for (const [key, s] of streams) {
      if (r >= STREAM_CAPS.ribbons) break;
      chain.length = 0;
      if (s.firing && s.muzzle && s.local) chain.push({p: s.muzzle, age: 0});
      const list = pool.filter(d => d.live && d.stream === key && d.rope && d.delay <= 0 && d.age < RIBBON_AGE).sort((a, b) => b.order - a.order);
      for (const d of list) {
        const last = chain[chain.length - 1];
        if (last && last.p.distanceToSquared(d.p) > .55 * .55) break;
        chain.push({p: d.p, age: d.age});
        if (chain.length >= STREAM_CAPS.ribbonPoints) break;
      }
      if (chain.length < 2) continue;
      // Light smoothing so the spread of single drops reads as one rope, not a zigzag (the nozzle point stays put).
      for (let pass = 0; pass < 2; pass++) for (let i = 1; i < chain.length - 1; i++) chain[i] = {p: _sm[i + pass * 64].copy(chain[i - 1].p).add(chain[i + 1].p).multiplyScalar(.25).addScaledVector(chain[i].p, .5), age: chain[i].age};
      const base = r * STREAM_CAPS.ribbonPoints * 2; let along = 0;
      for (let i = 0; i < STREAM_CAPS.ribbonPoints; i++) {
        const c = chain[Math.min(i, chain.length - 1)], prev = chain[Math.max(0, Math.min(i, chain.length - 1) - 1)], next = chain[Math.min(chain.length - 1, i + 1)];
        const tangent = _a.copy(next.p).sub(prev.p); if (tangent.lengthSq() < 1e-10) tangent.set(0, 0, 1);
        const side = _b.copy(tangent).cross(_s.copy(camPos).sub(c.p)).normalize();
        const k = Math.min(1, c.age / RIBBON_AGE), width = i >= chain.length ? 0 : (.028 + .045 * Math.sqrt(k)) * (1 - THREE.MathUtils.smoothstep(k, .7, 1)) * (1 + .12 * Math.sin(time * 31 + i * 1.7));
        if (i > 0) along += chain[Math.min(i, chain.length - 1)].p.distanceTo(chain[Math.min(i, chain.length - 1) - 1].p);
        for (const [j, sign] of [[0, -1], [1, 1]]) {
          const v = base + i * 2 + j;
          rPos[v * 3] = c.p.x + side.x * width * sign; rPos[v * 3 + 1] = c.p.y + side.y * width * sign; rPos[v * 3 + 2] = c.p.z + side.z * width * sign;
          rAcross[v] = sign; rAlong[v] = along; rHeat[v] = 1 - .4 * k;
        }
      }
      r++; verts = (r) * STREAM_CAPS.ribbonPoints * 2;
    }
    for (let v = verts; v < ribbonVerts; v++) { rPos[v * 3] = rPos[v * 3 + 1] = rPos[v * 3 + 2] = 0; }
    ribbonGeo.setDrawRange(0, Math.max(0, (r * (STREAM_CAPS.ribbonPoints - 1)) * 6));
    for (const name of ['position', 'aAcross', 'aAlong', 'aHeat']) ribbonGeo.attributes[name].needsUpdate = true;
    ribbon.visible = r > 0;
  }

  function stats() {
    return {drops: pool.filter(d => d.live).length, dropCap: STREAM_CAPS.drops, globsDrawn: drops.count, licks: licks.count, lickCap: STREAM_CAPS.licks,
      splats: splats.filter(s => s.live).length, splatCap: STREAM_CAPS.splats, stuck: stuck.filter(s => s.live).length, stuckCap: STREAM_CAPS.stuck,
      gouts: gouts.size, ribbons: ribbon.visible ? 1 : 0, draws: [drops, ribbon, splatMesh, licks].filter(m => m.visible).length, maxDraws: 4};
  }
  async function prepareShaders(renderer, camera, targetScene = scene) {
    const preview = new THREE.Group();
    for (const mesh of [drops, ribbon, splatMesh, licks]) { const c = mesh.clone(false); c.visible = true; preview.add(c); }
    try { await renderer.compileAsync(preview, camera, targetScene); } finally { preview.clear(); }
  }
  function dispose() {
    scene.remove(group);
    for (const g of [dropGeo, ribbonGeo, splatGeo, lickGeo]) g.dispose();
    for (const m of [dropMat, ribbonMat, splatMat, lickMat]) m.dispose();
    drops.dispose(); splatMesh.dispose(); licks.dispose();
  }
  return {group, emitLocal, stopLocal, launchLocalGout, sync, handleEvent, clearTarget, update, stats, prepareShaders, dispose, burst,
    setQuality(v) { q = Math.max(0, Math.min(1, v)); }};
}
