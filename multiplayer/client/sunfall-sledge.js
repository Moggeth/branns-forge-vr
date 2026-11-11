// The Sunfall Sledge: presentation for the held sledge and for every slam (assets-source/sunfall-sledge, hammer.glb).
// Everything here is local and per frame on the presentation clock; the shared simulation owns the slam (5 m) and
// its cooldown.
//
// The sledge's head is cast hollow round a sunstone heart: heat that goes in comes out as light (mechanical coherence).
//   * Held: the four crown vents and the two cheek stones glow with the heart's heat. Right after a slam they are
//     nearly dark; they fill back up as the special recharges, breathe while full, and flare with a burst of sparks
//     from the vents the moment the slam is ready again. Embers drift up out of the vents while it is hot.
//   * Slam (desktop/phone): the hero heaves the sledge up over the shoulder and drives it into the ground; the
//     special is sent on contact, not on the key press, so the ground answers the head.
//   * Every slam, anyone's: a white-gold flash, a sunburst shockwave that runs out across the ground exactly as far as
//     the slam reaches (5 m), a star of glowing cracks that cool from gold to red to soot, thrown clods and stones that
//     bounce and settle, sparks, and a ring of dust.
//   * Light: ONE point light (desktop only; the light budget slots it). It rides the heart while held, jumps to the
//     slam for its flash, then comes home. Phones rely on the emissive vents and the additive ground light.
// Budget: 1 light, at most 4 draws while a slam plays (sparks/embers, dust, debris, ground), 1 when idle; no textures.
import * as THREE from 'three';

export const SUNFALL = Object.freeze({
  slam: {raise: .26, drive: .085, hold: .2, back: .34},   // s; the special is sent at the end of `drive`
  reach: 5,                                              // m, the shared slam radius (shared/combat.js)
  ring: {time: .46},
  crack: {radius: 2.7, life: 3.2},
  debris: 26, pool: 120,
  light: {color: 0xffa046, distance: 3.2, held: .35, night: 1.1, flash: 14, flashDistance: 9, flashTime: .55},
  vents: {cold: .12, breathe: .07},
});
const GLOW_MATERIALS = /^(Sunstone|Vent_Glow)$/;
const clamp01 = x => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));
const smooth = x => { x = clamp01(x); return x * x * (3 - 2 * x); };
const easeOut = x => 1 - (1 - clamp01(x)) ** 3;

// ---------------------------------------------------------------- particles: embers + sparks (additive), dust (alpha)
const PARTICLE_VERTEX = /* glsl */`
attribute vec4 aTint;
attribute vec3 aVel;
varying vec4 vTint;
varying vec2 vUv;
void main() {
  vTint = aTint; vUv = position.xy * 2.;
  vec4 mv = viewMatrix * vec4(instanceMatrix[3].xyz, 1.);
  float size = length(instanceMatrix[0].xyz);
  vec3 vv = (viewMatrix * vec4(aVel, 0.)).xyz;
  float speed = length(vv.xy);
  vec2 along = speed > 1e-4 ? vv.xy / speed : vec2(0., 1.);
  float stretch = 1. + min(speed * .03 / max(size, 1e-4), 6.);
  vec2 across = vec2(-along.y, along.x);
  mv.xy += (across * position.x + along * position.y * stretch) * size;
  gl_Position = projectionMatrix * mv;
}`;
const GLOW_FRAGMENT = /* glsl */`
varying vec4 vTint;
varying vec2 vUv;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1. || vTint.a <= .001) discard;
  float core = exp(-r2 * 8.), soft = (1. - r2) * (1. - r2);
  gl_FragColor = vec4(vTint.rgb * (core * 1.2 + soft * .25) * vTint.a, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const DUST_FRAGMENT = /* glsl */`
varying vec4 vTint;
varying vec2 vUv;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1. || vTint.a <= .001) discard;
  float a = (1. - r2) * (1. - r2) * vTint.a;
  gl_FragColor = vec4(vTint.rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---------------------------------------------------------------- the ground: shockwave ring + star of cracks
// A disc draped over the terrain at the moment of the slam. uAge in s. Polar cracks: nine jagged radial lines with
// forks, one broken ring; heat runs gold -> red -> soot, then the whole thing fades.
const GROUND_VERTEX = /* glsl */`
varying vec2 vXZ;
void main() { vXZ = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
const GROUND_FRAGMENT = /* glsl */`
uniform float uAge, uSeed, uReach, uCrack, uLife, uRing;
varying vec2 vXZ;
float h1(float x) { return fract(sin(x * 91.17 + uSeed * 13.7) * 43758.5453); }
float n1(float x) { float i = floor(x), f = fract(x); f = f * f * (3. - 2. * f); return mix(h1(i), h1(i + 1.), f); }
void main() {
  float r = length(vXZ), a = atan(vXZ.y, vXZ.x);
  vec3 col = vec3(0.); float alpha = 0.;
  // shockwave: a bright front with sun rays, running out to the slam's reach
  float k = clamp(uAge / uRing, 0., 1.), front = uReach * (1. - pow(1. - k, 2.2));
  float band = exp(-pow((r - front) / (.24 + .38 * k), 2.)) * (1. - k * k);
  float rays = .55 + .45 * pow(abs(cos(a * 6.)), 6.);
  float wake = smoothstep(front, 0., r) * (1. - k) * .35;
  vec3 ring = vec3(1., .66, .28) * (band * rays * 2.8 + wake * 1.6);
  // cracks
  float life = clamp(uAge / uLife, 0., 1.);
  float crack = 0.;
  if (r < uCrack) {
    float lines = 9.;
    float sector = a / 6.2831853 * lines + .5 + uSeed;
    float id = floor(sector), f = fract(sector) - .5;
    float wob = (n1(r * 4.3 + id * 7.1) - .5) * .55 + (n1(r * 13. + id * 3.3) - .5) * .18;
    float len = uCrack * (.55 + .45 * h1(id));
    float w = .09 * (1. - r / len) + .012;
    float d = abs(f + wob / max(r, .25)) * r * 6.2831853 / lines;
    float main = smoothstep(w, w * .35, d) * step(r, len) * smoothstep(.12, .3, r);
    // a fork off each main line, and a broken ring crack round the bowl
    float fork = 0.;
    { float fr = r - len * .45; float fd = abs(f + wob / max(r, .25) - fr * .35 * (h1(id + 5.) - .5) * 3.) * r * 6.2831853 / lines;
      fork = smoothstep(w * .7, w * .2, fd) * step(0., fr) * step(fr, len * .35); }
    float ringR = uCrack * .42 + (n1(a * 3. + 9.) - .5) * .12;
    float rc = smoothstep(.035, .01, abs(r - ringR)) * step(.35, n1(a * 2.2 + uSeed * 4.));
    crack = clamp(main + fork * .8 + rc * .8, 0., 1.);
    // the bowl the face punched: a darker, glowing pan in the middle
    crack = max(crack, smoothstep(.42, .1, r) * .55);
  }
  float heat = clamp(1. - life * 1.6, 0., 1.);
  vec3 hot = mix(vec3(.5, .06, .015), mix(vec3(1., .32, .04), vec3(1., .62, .2), heat * heat), heat);
  float fade = 1. - smoothstep(.6, 1., life);
  vec3 soot = vec3(.06, .045, .035);
  col = mix(soot, hot * (1.6 + 2.2 * heat), heat) * crack * fade + ring;
  alpha = clamp(crack * fade * (.6 + .4 * heat) + min(1., band * rays + wake), 0., 1.);
  if (alpha < .003) discard;
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const EMBER = new THREE.Color(1.0, .55, .16), GOLD = new THREE.Color(1.0, .82, .45), WHITE = new THREE.Color(1.0, .95, .8);
const DUST = new THREE.Color(.62, .55, .45);

/**
 * createSunfallSledge({scene, realLight, reducedMotion, height(x, z)}) ->
 *   {attach(model|null), update(frame), beginSlam(now) -> bool, pose(now) -> {offset, quaternion} | null,
 *    slamming(now), takeImpact(now) -> bool, cancelSlam(), impact(position), stats(), dispose()}
 * frame: {time, dt, charge: 0..1 (special readiness), shown, swinging, night: 0..1}
 */
export function createSunfallSledge({scene, realLight = true, reducedMotion = false, height = () => 0} = {}) {
  const quad = new THREE.PlaneGeometry(1, 1);
  function particleDraw(name, fragment, blending, count, order) {
    const tint = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const vel = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const geometry = quad.clone(); geometry.setAttribute('aTint', tint); geometry.setAttribute('aVel', vel);
    const material = new THREE.ShaderMaterial({vertexShader: PARTICLE_VERTEX, fragmentShader: fragment, transparent: true, depthWrite: false, blending});
    material.name = name;
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = name; mesh.frustumCulled = false; mesh.renderOrder = order; mesh.count = 0; mesh.userData.ignoreContact = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(mesh);
    const P = Array.from({length: count}, () => ({alive: false, age: 0, life: 1, size: .01, drag: 0, grav: 0, grow: 0,
      p: new THREE.Vector3(), v: new THREE.Vector3(), color: new THREE.Color(), alpha: 1}));
    let next = 0;
    return {mesh, tint, vel, P, spawn(o) {
      let s = null;
      for (let i = 0; i < count; i++) { const c = P[(next + i) % count]; if (!c.alive) { s = c; next = (next + i + 1) % count; break; } }
      if (!s) { s = P[next]; next = (next + 1) % count; }
      Object.assign(s, {alive: true, age: 0, life: o.life, size: o.size, drag: o.drag ?? 0, grav: o.grav ?? 0, grow: o.grow ?? 0, alpha: o.alpha ?? 1});
      s.p.copy(o.p); s.v.copy(o.v); s.color.copy(o.color); return s;
    }};
  }
  const glow = particleDraw('sunfall:glow', GLOW_FRAGMENT, THREE.AdditiveBlending, SUNFALL.pool, 4);
  const dust = particleDraw('sunfall:dust', DUST_FRAGMENT, THREE.NormalBlending, 40, 3);

  // ---- thrown clods and stones: one instanced draw, flat-shaded chips
  const rockGeometry = new THREE.IcosahedronGeometry(1, 0);
  const rockMaterial = new THREE.MeshStandardMaterial({color: 0x6b5a48, roughness: .95, flatShading: true});
  rockMaterial.name = 'sunfall:debris';
  const rocks = new THREE.InstancedMesh(rockGeometry, rockMaterial, SUNFALL.debris);
  rocks.name = 'sunfall:debris'; rocks.frustumCulled = false; rocks.count = 0; rocks.userData.ignoreContact = true;
  rocks.instanceMatrix.setUsage(THREE.DynamicDrawUsage); rocks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SUNFALL.debris * 3), 3);
  scene.add(rocks);
  const R = Array.from({length: SUNFALL.debris}, () => ({alive: false, age: 0, life: 2, size: .05, bounced: 0, rest: false,
    p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), color: new THREE.Color()}));
  const _e = new THREE.Euler();

  // ---- the ground decal: two draped discs, recycled
  const GRID = 26;
  function groundDisc() {
    const geometry = new THREE.PlaneGeometry(2 * SUNFALL.reach + .4, 2 * SUNFALL.reach + .4, GRID, GRID).rotateX(-Math.PI / 2);
    const material = new THREE.ShaderMaterial({vertexShader: GROUND_VERTEX, fragmentShader: GROUND_FRAGMENT, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      uniforms: {uAge: {value: 0}, uSeed: {value: 0}, uReach: {value: SUNFALL.reach}, uCrack: {value: SUNFALL.crack.radius}, uLife: {value: SUNFALL.crack.life}, uRing: {value: SUNFALL.ring.time}}});
    material.name = 'sunfall:ground';
    const mesh = new THREE.Mesh(geometry, material); mesh.name = 'sunfall:ground'; mesh.visible = false; mesh.renderOrder = 2;
    mesh.frustumCulled = false; mesh.userData.ignoreContact = true; scene.add(mesh);
    return {mesh, material, age: Infinity, flat: geometry.attributes.position.array.slice()};
  }
  const grounds = [groundDisc(), groundDisc()];

  // ---- the one light
  const light = realLight ? new THREE.PointLight(SUNFALL.light.color, 0, SUNFALL.light.distance, 2) : null;
  if (light) { light.name = 'sunfall:light'; light.userData.ignoreContact = true; scene.add(light); }
  let flashAt = -Infinity, flashPending = false; const flashPos = new THREE.Vector3();

  // ---- held state
  let model = null, glowMats = [], heart = null, vents = [], suns = [];
  let lastCharge = 1, readyAt = -Infinity, slamAt = -Infinity, slamSent = true, emberClock = 0, clock = 0;
  const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _q = new THREE.Quaternion();
  const layer = {offset: new THREE.Vector3(), quaternion: new THREE.Quaternion()};
  const X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);

  function attach(next) {
    if (next === model) return;
    model = next; glowMats = []; vents = []; suns = []; heart = null;
    if (!model) return;
    // Own copies of the glow materials so this sledge's heat never lights another player's.
    const copies = model.userData.sunfallGlow || (model.userData.sunfallGlow = new Map());
    model.traverse(n => {
      if (!n.isMesh) return;
      const swap = m => {
        if (!GLOW_MATERIALS.test(m?.name || '') || m.userData.sunfallOwned) return m;   // already this sledge's own copy
        let c = copies.get(m); if (!c) { c = m.clone(); c.userData.sunfallOwned = true; c.userData.baseEmissive = Math.min(1, m.emissiveIntensity ?? 1) * (m.name === 'Vent_Glow' ? 1.25 : .9); c.userData.vent = m.name === 'Vent_Glow'; copies.set(m, c); }
        return c;
      };
      n.material = Array.isArray(n.material) ? n.material.map(swap) : swap(n.material);
    });
    glowMats = [...copies.values()];
    heart = model.getObjectByName('Heart');
    for (let i = 0; i < 4; i++) { const v = model.getObjectByName(`Vent${i}`); if (v) vents.push(v); }
    for (const n of ['SunLeft', 'SunRight']) { const s = model.getObjectByName(n); if (s) suns.push(s); }
  }

  // ---- the slam swing: up over the shoulder, then down into the ground; the special goes on contact
  const S = SUNFALL.slam, total = S.raise + S.drive + S.hold + S.back;
  function beginSlam(now) { if (now - slamAt < total) return false; slamAt = now; slamSent = false; return true; }
  function slamming(now) { return now - slamAt < total; }
  function takeImpact(now) { if (slamSent || now - slamAt < S.raise + S.drive) return false; slamSent = true; return now - slamAt < total; }
  /** Drop a slam in progress (weapon swap, menus, death): it must never land later on its own. */
  function cancelSlam() { slamAt = -Infinity; slamSent = true; }
  function pose(now) {
    const t = now - slamAt; if (!(t >= 0 && t < total)) return null;
    const k = reducedMotion ? .55 : 1;
    let lift, pitch, push;
    if (t < S.raise) { const u = easeOut(t / S.raise); lift = .2 * u; pitch = 62 * u; push = .1 * u; }
    else if (t < S.raise + S.drive) { const u = ((t - S.raise) / S.drive) ** 2; lift = .2 + (-.3 - .2) * u; pitch = 62 + (-58 - 62) * u; push = .1 + (-.16 - .1) * u; }
    else if (t < S.raise + S.drive + S.hold) { const u = (t - S.raise - S.drive) / S.hold; const jolt = Math.sin(u * Math.PI * 3) * (1 - u) * .012; lift = -.3 + jolt; pitch = -58 + jolt * 120; push = -.16; }
    else { const u = smooth((t - S.raise - S.drive - S.hold) / S.back); lift = -.3 * (1 - u); pitch = -58 * (1 - u); push = -.16 * (1 - u); }
    layer.offset.set(.03 * Math.sign(lift) * k, lift * k, push * k);
    layer.quaternion.setFromAxisAngle(X, THREE.MathUtils.degToRad(pitch * k)).premultiply(_q.setFromAxisAngle(Z, THREE.MathUtils.degToRad(-6 * Math.min(1, t / S.raise) * k)));
    return layer;
  }

  // ---- a slam lands somewhere in the world
  const _p = new THREE.Vector3();
  function impact(position) {
    const [x, y0, z] = position; const y = height(x, z) ?? y0;
    const centre = new THREE.Vector3(x, y, z);
    // ground: drape the older disc over the terrain here
    const g = grounds[0].age > grounds[1].age ? grounds[0] : grounds[1];
    const pos = g.mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) { const lx = g.flat[i * 3], lz = g.flat[i * 3 + 2]; pos.setY(i, (height(x + lx, z + lz) ?? y) - y + .04); }
    pos.needsUpdate = true; g.mesh.geometry.computeBoundingSphere();
    g.mesh.position.copy(centre); g.material.uniforms.uSeed.value = Math.random() * 10; g.age = 0; g.mesh.visible = true;
    // flash
    flashPending = true; flashPos.copy(centre).y += .7;
    // the flash itself: a white-hot bloom where the face met the ground
    glow.spawn({p: _p.set(x, y + .35, z), v: _v.set(0, 0, 0), life: .22, size: 1.3, color: WHITE});
    glow.spawn({p: _p.set(x, y + .25, z), v: _v.set(0, .4, 0), life: .45, size: 2.4, color: EMBER});
    // sparks: a hot spray from the bowl, low and fast
    for (let i = 0; i < 34; i++) {
      const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 6, up = 1.5 + Math.random() * 4;
      glow.spawn({p: _p.set(x + Math.cos(a) * .2, y + .08, z + Math.sin(a) * .2), v: _v.set(Math.cos(a) * s, up, Math.sin(a) * s),
        life: .35 + Math.random() * .45, size: .022 + Math.random() * .02, drag: 1.4, grav: 9, color: Math.random() < .3 ? WHITE : GOLD});
    }
    // dust: a ring of soft puffs riding the shockwave out, and a column from the bowl
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + Math.random() * .3, s = 3.5 + Math.random() * 3;
      dust.spawn({p: _p.set(x + Math.cos(a) * .5, y + .15, z + Math.sin(a) * .5), v: _v.set(Math.cos(a) * s, .4 + Math.random() * .6, Math.sin(a) * s),
        life: 1.1 + Math.random() * .7, size: .5 + Math.random() * .35, drag: 2.6, grav: -.15, grow: 1.1, alpha: .3, color: DUST});
    }
    for (let i = 0; i < 6; i++) dust.spawn({p: _p.set(x + (Math.random() - .5) * .5, y + .2, z + (Math.random() - .5) * .5), v: _v.set((Math.random() - .5) * .6, 1.2 + Math.random(), (Math.random() - .5) * .6),
      life: 1.4 + Math.random() * .6, size: .4, drag: 1.5, grav: -.2, grow: 1.1, alpha: .35, color: DUST});
    // clods and stones
    let n = 0;
    for (const r of R) {
      if (n >= SUNFALL.debris) break; n++;
      const a = Math.random() * Math.PI * 2, d = .25 + Math.random() * 1.1, s = 1.6 + Math.random() * 3.2;
      Object.assign(r, {alive: true, age: 0, life: 1.6 + Math.random() * .8, size: .035 + Math.random() * .07, bounced: 0, rest: false});
      r.p.set(x + Math.cos(a) * d, y + .05, z + Math.sin(a) * d); r.v.set(Math.cos(a) * s, 3 + Math.random() * 4, Math.sin(a) * s);
      r.q.setFromAxisAngle(_v.set(Math.random(), Math.random(), Math.random()).normalize(), Math.random() * 6);
      r.w.set(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(18);
      const c = Math.random(); r.color.setRGB(.38 + c * .25, .31 + c * .2, .24 + c * .15);
    }
  }

  function writeParticles(d, dt, glowing) {
    let n = 0;
    for (const s of d.P) {
      if (!s.alive) continue;
      s.age += dt; if (s.age >= s.life) { s.alive = false; continue; }
      s.v.multiplyScalar(Math.exp(-s.drag * dt)); s.v.y -= s.grav * dt; s.p.addScaledVector(s.v, dt);
      const u = s.age / s.life, size = s.size * (1 + s.grow * u);
      _m.compose(s.p, _q.identity(), _s.setScalar(size)); d.mesh.setMatrixAt(n, _m);
      const fade = glowing ? (1 - u) ** 1.4 : s.alpha * Math.min(1, u * 6) * (1 - u) ** 1.2;
      const heat = glowing ? 1 - u * .6 : 1;
      d.tint.setXYZW(n, s.color.r * heat, s.color.g * heat * (glowing ? 1 - u * .45 : 1), s.color.b * heat * (glowing ? 1 - u * .8 : 1), fade);
      d.vel.setXYZ(n, s.v.x, s.v.y, s.v.z); n++;
    }
    d.mesh.count = n; d.mesh.visible = n > 0;
    if (n) { d.mesh.instanceMatrix.needsUpdate = true; d.tint.needsUpdate = true; d.vel.needsUpdate = true; }
  }

  function update({time = 0, dt = 1 / 60, charge = 1, shown = false, swinging = false, night = 0} = {}) {
    clock = time; dt = Math.min(.05, Math.max(0, dt));
    if (flashPending) { flashPending = false; flashAt = time; }
    charge = clamp01(charge);
    if (charge >= 1 && lastCharge < 1) readyAt = time;
    if (charge < lastCharge - .2) flashAt = Math.max(flashAt, time - .02);   // spent: the heat just left
    lastCharge = charge;
    const ready = Math.max(0, 1 - (time - readyAt) / .7), flash = Math.max(0, 1 - (time - flashAt) / SUNFALL.light.flashTime);
    const heat = SUNFALL.vents.cold + (1 - SUNFALL.vents.cold) * charge ** 1.6;
    const breathe = 1 + SUNFALL.vents.breathe * Math.sin(time * 2.2) * charge + (swinging ? .25 : 0);
    if (shown && model) {
      for (const m of glowMats) m.emissiveIntensity = m.userData.baseEmissive * (heat * breathe + ready * 1.6 + flash * (m.userData.vent ? 3 : 2));
      model.updateWorldMatrix(true, false);
      // embers out of the vents while hot; a burst of sparks when the heart is full again
      emberClock += dt * (charge > .95 ? 5 : charge * 2.2);
      while (emberClock > 1 && vents.length && !reducedMotion) {
        emberClock -= 1; const v = vents[(Math.random() * vents.length) | 0]; v.getWorldPosition(_p);
        glow.spawn({p: _p, v: _v.set((Math.random() - .5) * .08, .18 + Math.random() * .2, (Math.random() - .5) * .08), life: .9 + Math.random() * .8, size: .007 + Math.random() * .006, drag: .6, grav: -.05, color: EMBER});
      }
      if (ready > .97 && vents.length) for (const v of vents) for (let i = 0; i < 4; i++) {
        v.getWorldPosition(_p); glow.spawn({p: _p, v: _v.set((Math.random() - .5) * .5, .9 + Math.random() * .9, (Math.random() - .5) * .5), life: .4 + Math.random() * .3, size: .008, drag: 1.2, grav: 3, color: GOLD});
      }
    } else emberClock = 0;
    writeParticles(glow, dt, true); writeParticles(dust, dt, false);
    // debris
    let n = 0;
    for (const r of R) {
      if (!r.alive) continue;
      r.age += dt; if (r.age >= r.life) { r.alive = false; continue; }
      if (!r.rest) {
        r.v.y -= 9.8 * dt; r.p.addScaledVector(r.v, dt); r.q.multiply(_q.setFromEuler(_e.set(r.w.x * dt, r.w.y * dt, r.w.z * dt)));
        const g = height(r.p.x, r.p.z) + r.size * .6;
        if (r.p.y < g) { r.p.y = g; if (r.bounced++ < 1 && r.v.y < -1.5) { r.v.y *= -.32; r.v.x *= .5; r.v.z *= .5; r.w.multiplyScalar(.4); } else { r.rest = true; } }
      }
      const shrink = 1 - smooth((r.age - (r.life - .5)) / .5);
      _m.compose(r.p, r.q, _s.set(r.size, r.size * .7, r.size * .85).multiplyScalar(shrink)); rocks.setMatrixAt(n, _m);
      rocks.setColorAt(n, r.color);
      n++;
    }
    rocks.count = n; rocks.visible = n > 0; if (n) { rocks.instanceMatrix.needsUpdate = true; rocks.instanceColor.needsUpdate = true; }
    for (const g of grounds) {
      if (!g.mesh.visible) continue;
      g.age += dt; g.material.uniforms.uAge.value = g.age;
      if (g.age > SUNFALL.crack.life) g.mesh.visible = false;
    }
    // the light: the heart while held, the slam while it flashes
    if (light) {
      const flashing = time - flashAt < SUNFALL.light.flashTime && time >= flashAt;
      if (flashing) {
        const f = 1 - (time - flashAt) / SUNFALL.light.flashTime;
        light.position.copy(flashPos); light.distance = SUNFALL.light.flashDistance; light.intensity = SUNFALL.light.flash * f * f;
      } else if (shown && heart) {
        heart.getWorldPosition(light.position); light.position.y += .12; light.distance = SUNFALL.light.distance;
        light.intensity = (SUNFALL.light.held + SUNFALL.light.night * night) * heat * breathe + ready * 1.5;
      } else light.intensity = 0;
    }
  }

  function stats() {
    return {shown: !!model, glowMaterials: glowMats.length, vents: vents.length, particles: glow.mesh.count + dust.mesh.count, debris: rocks.count,
      grounds: grounds.filter(g => g.mesh.visible).length, light: light ? +light.intensity.toFixed(3) : null};
  }
  function dispose() {
    for (const d of [glow, dust]) { scene.remove(d.mesh); d.mesh.geometry.dispose(); d.mesh.material.dispose(); }
    scene.remove(rocks); rockGeometry.dispose(); rockMaterial.dispose(); rocks.dispose?.();
    for (const g of grounds) { scene.remove(g.mesh); g.mesh.geometry.dispose(); g.material.dispose(); }
    if (light) scene.remove(light);
    quad.dispose(); model = null;
  }
  return {attach, update, beginSlam, pose, slamming, takeImpact, cancelSlam, impact, stats, dispose};
}
