import * as THREE from 'three';

// Forge Expedition world cues: the physical forge and objective sites tell the run's story from eye level and above.
// Presentation only. Reads the adventure (raw shared/adventure.js state or adventureView()), the simulation shrine
// anchor and an injected terrain height. Never mutates inputs, never a raycast/contact target, owns every resource.

import {STAR_SITES} from '../shared/adventure.js';
export {STAR_SITES};
const HZ = 60, DEPOSIT_RANGE = 9, DRAIN_RANGE = 11, HEARTH_IN = 2.05, HEARTH_OUT = 2.6, MAX_TEL = 8;
const TEL_SECONDS = {gate: 6, star: 8, guard: 3}; // PACING.telegraph / starWarn / guardDelay
const TEL_KIND = {gate: 0, guard: 1, star: 2};
const STAGES = new Set(['idle', 'camp', 'star', 'rekindle', 'victory', 'defeat']);
const EXTRAPOLATE = 0.3; // seconds of countdown interpolation past the last snapshot (matches game.js tick estimate)
// shared/forge-layout.json: model front faces -Z and the forge is placed with a pi yaw, so model (x,z) -> world (-x,-z).
const CHIMNEY_TOP = [-0.45, 3.0, 0.435]; // ChimneyStack box centre, just under its 3.06 m top
const TIMBER_AT = [-3.35, 0.4], STONE_AT = [3.25, 0.45]; // beside the bellows/barrel, behind the -Z working face
const LOOK = {
  idle: {l9: 0, l11: 0, runes: 0, a: 0x3a3633, b: 0x6b6058, hot: 0x9a5040},
  camp: {l9: .85, l11: 0, runes: .4, a: 0x4a3420, b: 0xe0a64a, hot: 0xffe2a8},
  star: {l9: 0, l11: 0, runes: .9, a: 0x24324a, b: 0x8cc4ff, hot: 0xf2fbff},
  rekindle: {l9: 0, l11: .5, runes: .95, a: 0x3a1a10, b: 0xff7a2a, hot: 0xffd27a},
  victory: {l9: 0, l11: 0, runes: 1, a: 0x5a3c12, b: 0xffc95a, hot: 0xfff6d8},
  defeat: {l9: 0, l11: 0, runes: .55, a: 0x24211f, b: 0x5d5650, hot: 0x8a4232},
};

const GLYPH_VS = /* glsl */`attribute vec4 aG; varying vec4 vG;
void main(){ vG = aG; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
// Bands: 0 dashed line, 1 urgent line, 2 rune cells, 3 vertical column (beacon/plume), 4 ground disk (wave + glow).
const GLYPH_FS = /* glsl */`uniform vec3 uA, uB, uHot; uniform vec4 uAlpha;
uniform float uT, uFill, uSeg, uMirror, uUrg, uHead, uWave, uMode, uBoost; varying vec4 vG;
float hash(float n){ return fract(sin(n * 12.9898) * 43758.5453); }
void main(){
  float u = vG.x, v = vG.y; int band = int(vG.z + .5); vec3 col; float a;
  if (band <= 1) {
    float prof = smoothstep(0., .6, 1. - abs(v * 2. - 1.));
    float f = fract(u * (band == 0 ? 72. : 88.) - uT * (band == 0 ? .12 : -.3));
    float dash = smoothstep(0., .08, f) * (1. - smoothstep(.55, .63, f));
    float pulse = .55 + .45 * uUrg * (.5 + .5 * sin(uT * 7.));
    col = band == 0 ? uB : mix(uB, uHot, uUrg);
    a = prof * dash * (band == 0 ? uAlpha.x : uAlpha.y * pulse);
  } else if (band == 2) {
    float s = uMirror > .5 ? abs(u - .5) * 2. : u, c = floor(s * uSeg), f = fract(s * uSeg), h = hash(c + 7.);
    float gy = abs(v * 2. - 1.), lead = uFill * uSeg;
    float lit = clamp(lead - c, 0., 1.);
    float rails = smoothstep(.78, .86, gy) * (1. - smoothstep(.96, 1., gy));
    float bar = (1. - smoothstep(.05, .1, abs(f - .5))) * step(gy, .58);
    float diag = (1. - smoothstep(.05, .1, abs((f - .5) - (v - .5) * (h > .5 ? .9 : -.9)))) * step(gy, .58) * step(.3, h);
    float tick = (1. - smoothstep(.015, .04, min(f, 1. - f))) * step(gy, .8);
    float glyph = max(max(bar, diag), tick * .6);
    float flick = .82 + .18 * sin(uT * 5.3 + c * 2.1) * sin(uT * 3.1 + c);
    vec3 on = mix(uB, uHot, glyph * flick * .55);
    col = mix(uA, on, lit);
    a = uAlpha.z * max(rails * (.55 + .45 * lit), glyph * (.38 + .62 * lit));
    float edge = step(c, lead) * step(lead, c + 1.);
    a += uAlpha.z * glyph * edge * uUrg * .7 * (.5 + .5 * sin(uT * 9.));
    col = mix(col, uHot * vec3(1., .45, .3), edge * uUrg * .6);
  } else if (band == 3) {
    float x = u - .5;
    if (uMode < .5) { // beacon: slim shaft, pulses rise; uHead >= 0 draws the descending fragment and its trail
      float core = exp(-x * x * 180.) + .3 * exp(-x * x * 22.), fade = pow(1. - v, 1.6) * smoothstep(0., .02, v);
      float rise = .72 + .28 * sin(v * 42. - uT * 2.2);
      float pre = uHead >= 0. ? .18 : 1.;
      float blob = uHead >= 0. ? exp(-pow((v - uHead) * 34., 2.)) * exp(-x * x * 70.) * 2.2 : 0.;
      float trail = uHead >= 0. ? step(uHead, v) * exp(-(v - uHead) * 7.) * exp(-x * x * 120.) : 0.;
      col = mix(uB, uHot, clamp(core + blob, 0., 1.));
      a = (core * fade * rise * pre + blob + trail) * uAlpha.w;
    } else { // forge plume: height and steadiness follow the flame; urgency gutters it red
      float hgt = (.18 + .82 * uFill) * (1. + .22 * uBoost), yn = v / max(hgt, .001);
      float wob = sin(v * 9. - uT * (6. + 7. * uUrg)) * .06 * yn + sin(v * 23. - uT * 11.) * .025 * yn * (1. + 2. * uUrg);
      float w = .44 * pow(max(1. - yn, 0.), .8) * (.75 + .25 * sin(uT * 3. + v * 4.));
      float core = 1. - smoothstep(0., 1., abs(x - wob) / max(w, .001));
      col = mix(mix(uHot, uB, smoothstep(.0, .55, yn)), uA, smoothstep(.45, 1., yn));
      col = mix(col, vec3(1., .2, .08), uUrg * .45 * yn);
      a = core * (1. - smoothstep(.75, 1., yn)) * step(yn, 1.) * uAlpha.w;
    }
  } else {
    float ring = uWave >= 0. ? exp(-pow((v - uWave) * 22., 2.)) * (1. - uWave) : 0.;
    float glow = pow(1. - v, 2.5) * uHead * (.8 + .2 * sin(uT * 2.));
    col = mix(uB, uHot, clamp(ring, 0., 1.));
    a = (ring + glow) * uAlpha.w;
  }
  if (a < .004) discard;
  gl_FragColor = vec4(col, min(a, 1.));
}`;

const TEL_VS = /* glsl */`attribute vec4 aT; uniform vec4 uS[${MAX_TEL}]; uniform vec4 uD[${MAX_TEL}];
varying vec4 vT; varying vec4 vS; varying vec2 vDir;
void main(){ int i = int(aT.w + .5); vT = aT; vS = uS[i]; vDir = uD[i].xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
// Per slot uS = (kind 0 gate / 1 guard / 2 star, progress 0..1, alpha, radius); uD.xy = unit direction toward the forge.
const TEL_FS = /* glsl */`uniform float uT; varying vec4 vT; varying vec4 vS; varying vec2 vDir;
void main(){
  float kind = vS.x, prog = vS.y, alpha = vS.z, R = vS.w, u = vT.x, r = vT.y;
  vec3 col = kind < .5 ? vec3(1., .36, .14) : kind < 1.5 ? vec3(.74, .46, 1.) : vec3(.7, .88, 1.);
  float a;
  if (vT.z < .5) {
    float ang = u * 6.2831853; vec2 p = vec2(cos(ang), sin(ang)) * r * R;
    float rim = smoothstep(.86, .93, r) * (1. - smoothstep(.97, 1., r));
    float arc = step(u, 1. - prog);
    float soft = (.06 + .16 * prog) * (1. - smoothstep(.55, 1., r));
    float pat;
    if (kind < .5) { // patrol/wave gate: chevrons flow toward the forge
      float s = dot(p, vDir), t = abs(dot(p, vec2(-vDir.y, vDir.x)));
      float f = fract((s - t * .9) / 1.3 - uT * .9);
      pat = smoothstep(0., .1, f) * (1. - smoothstep(.28, .38, f)) * (1. - smoothstep(.7, .8, r));
    } else if (kind < 1.5) { // star guardians: inward teeth
      float ft = abs(fract(u * 12.) - .5);
      pat = (1. - smoothstep(.06, .1, ft)) * smoothstep(.6, .68, r) * (1. - smoothstep(.88, .92, r));
    } else { // falling star: rings contract to the centre as impact nears
      float cr = fract(r * 3. + uT * .8 + prog * 2.);
      pat = (1. - smoothstep(.04, .09, abs(cr - .5))) * (1. - smoothstep(.85, .9, r));
    }
    a = alpha * (rim * (.3 + .7 * arc) + soft + pat * .75) * (.8 + .2 * sin(uT * (6. + 10. * prog)));
  } else {
    float x = u - .5;
    a = alpha * exp(-x * x * 90.) * pow(1. - r, 1.5) * (.6 + .4 * sin(uT * 8. * (.5 + prog)));
    col *= 1.25;
  }
  if (a < .004) discard;
  gl_FragColor = vec4(col, min(a, 1.));
}`;

const SPARK_VS = /* glsl */`attribute vec4 aP; varying vec4 vP; uniform float uScale;
void main(){ vP = aP; vec4 mv = modelViewMatrix * vec4(position, 1.); gl_PointSize = aP.w * uScale / max(-mv.z, .1); gl_Position = projectionMatrix * mv; }`;
const SPARK_FS = /* glsl */`varying vec4 vP; void main(){ float d = length(gl_PointCoord - .5); float a = (1. - smoothstep(0., .5, d)) * fract(vP.x);
  if (a < .01) discard; gl_FragColor = vec4(floor(vP.x) / 255., vP.y, vP.z, a); }`;
// aP packs (floor(red*256)+alpha, green, blue, size) so one attribute carries colour+alpha without a second buffer.

function polar(parts) {
  let nv = 0, ni = 0;
  for (const p of parts) { nv += (p.segs + 1) * (p.rings + 1); ni += p.segs * p.rings * 6; }
  const pos = new Float32Array(nv * 3), g = new Float32Array(nv * 4), xz = new Float32Array(nv * 2), lift = new Float32Array(nv), idx = new Uint16Array(ni);
  let v = 0, k = 0;
  for (const p of parts) {
    const base = v;
    for (let r = 0; r <= p.rings; r++) for (let s = 0; s <= p.segs; s++, v++) {
      const u = s / p.segs, t = r / p.rings, rad = p.ri + (p.ro - p.ri) * t, ang = u * Math.PI * 2 + (p.phase || 0);
      xz[v * 2] = Math.cos(ang) * rad; xz[v * 2 + 1] = Math.sin(ang) * rad; lift[v] = p.lift ?? .05;
      g[v * 4] = u; g[v * 4 + 1] = t; g[v * 4 + 2] = p.band; g[v * 4 + 3] = 0;
    }
    for (let r = 0; r < p.rings; r++) for (let s = 0; s < p.segs; s++) {
      const a = base + r * (p.segs + 1) + s, b = a + p.segs + 1;
      idx[k++] = a; idx[k++] = b; idx[k++] = a + 1; idx[k++] = a + 1; idx[k++] = b; idx[k++] = b + 1;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aG', new THREE.BufferAttribute(g, 4));
  geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.userData = {xz, lift};
  return geo;
}
function column() { // two crossed unit quads, base at y=0
  const pos = [], g = [], idx = [];
  for (let q = 0; q < 2; q++) {
    const b = pos.length / 3;
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { pos.push(q ? 0 : u - .5, v, q ? u - .5 : 0); g.push(u, v, 3, 0); }
    idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('aG', new THREE.Float32BufferAttribute(g, 4)); geo.setIndex(idx);
  return geo;
}
const inert = object => { object.raycast = () => {}; object.userData.ignoreContact = true; object.userData.presentationOnly = true; return object; };
const finite = v => typeof v === 'number' && Number.isFinite(v);
const bounceOut = t => t < .6 ? (t / .6) ** 2 : 1 - .12 * Math.sin((t - .6) / .4 * Math.PI);

// Normalized, bounded view of the authoritative adventure. Accepts the raw state or adventureView(); null if unusable.
export function readExpedition(a) {
  if (!a || typeof a !== 'object' || !STAGES.has(a.stage)) return null;
  const view = Array.isArray(a.objectives), obj = id => view ? a.objectives.find(o => o && o.id === id) : null;
  const pair = (have, need) => [Math.max(0, Math.min(finite(have) ? have : 0, finite(need) ? need : 0)), Math.max(0, finite(need) ? need : 0)];
  const m = {stage: a.stage, run: Number.isSafeInteger(a.run) ? a.run : 0, retries: 0, wood: [0, 0], stone: [0, 0], gems: [0, 0],
    landed: false, site: null, flame: null, rekindled: false, telegraphs: []};
  if (view) {
    m.retries = finite(a.retriesLeft) ? Math.max(0, 3 - a.retriesLeft) : 0;
    const w = obj('wood'), s = obj('stone'), g = obj('star');
    if (w) m.wood = pair(w.have, w.need); if (s) m.stone = pair(s.have, s.need); if (g) m.gems = pair(g.have, g.need);
    if (a.star && finite(a.star.x) && finite(a.star.z)) { m.site = [a.star.x, a.star.z]; m.landed = !!a.star.landed; }
    if (finite(a.flame)) m.flame = a.flame;
  } else {
    m.retries = Number.isSafeInteger(a.retries) ? a.retries : 0;
    if (a.stage === 'camp') { m.wood = pair(a.stock?.wood, a.need?.wood); m.stone = pair(a.stock?.stone, a.need?.stone); }
    if (a.stage === 'star') {
      m.gems = pair(a.star?.charge, a.need?.star); m.landed = !!a.star?.landed;
      const site = STAR_SITES[a.star?.site]; if (site) m.site = [site[0], site[1]];
    }
    if (a.stage === 'rekindle' && finite(a.flame)) m.flame = a.flame;
    m.rekindled = !!a.rekindled;
  }
  if (m.stage === 'victory') m.flame = 100; else if (m.stage === 'defeat') m.flame = 0;
  if (m.flame !== null) m.flame = Math.max(0, Math.min(100, m.flame));
  const elapsed = finite(a.elapsed) ? a.elapsed : null;
  for (const t of Array.isArray(a.telegraphs) ? a.telegraphs : []) {
    if (m.telegraphs.length >= MAX_TEL) break;
    if (!t || !(t.kind in TEL_KIND) || !finite(t.x) || !finite(t.z) || typeof t.id !== 'string') continue;
    const remaining = finite(t.secondsLeft) && elapsed === null ? t.secondsLeft : finite(t.until) && elapsed !== null ? (t.until - elapsed) / HZ : TEL_SECONDS[t.kind];
    if (remaining <= 0) continue;
    m.telegraphs.push({id: t.id.slice(0, 64), kind: t.kind, x: t.x, z: t.z, radius: Math.max(.5, Math.min(10, finite(t.radius) ? t.radius : 3)), remaining});
  }
  return m;
}

// scene: THREE.Scene to attach to. height(x, z): the live authoritative terrain surface (must include edits).
export function createExpeditionPresentation({scene, height, quality = 'high', pointScale = 400} = {}) {
  if (!scene) throw Error('scene required');
  const H = (x, z) => { const h = height ? height(x, z) : 0; return finite(h) ? h : 0; };
  const low = quality === 'low', SPARKS = low ? 24 : 64;
  const root = inert(new THREE.Group()); root.name = 'ExpeditionPresentation'; root.visible = false; scene.add(root);
  const T = {value: 0};
  const owned = {geometries: [], materials: []};
  const own = (list, x) => { owned[list].push(x); return x; };
  const glyph = (additive, look = LOOK.camp) => own('materials', new THREE.ShaderMaterial({
    uniforms: {uA: {value: new THREE.Color(look.a)}, uB: {value: new THREE.Color(look.b)}, uHot: {value: new THREE.Color(look.hot)},
      uAlpha: {value: new THREE.Vector4()}, uT: T, uFill: {value: 0}, uSeg: {value: 8}, uMirror: {value: 1}, uUrg: {value: 0},
      uHead: {value: -1}, uWave: {value: -1}, uMode: {value: 0}, uBoost: {value: 0}},
    vertexShader: GLYPH_VS, fragmentShader: GLYPH_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2}));

  // ---- Forge ground: deposit-range line, drain-range line and the hearth rune ring, one conformed mesh ----
  const segs = low ? 96 : 160;
  const forgeGeo = own('geometries', polar([
    {ri: DEPOSIT_RANGE - .09, ro: DEPOSIT_RANGE + .09, segs, rings: 1, band: 0},
    {ri: DRAIN_RANGE - .08, ro: DRAIN_RANGE + .08, segs: segs + 24, rings: 1, band: 1},
    {ri: HEARTH_IN, ro: HEARTH_OUT, segs: low ? 72 : 120, rings: 1, band: 2, phase: Math.PI / 2, lift: .045}]));
  const forgeMat = glyph(false);
  const forgeGround = inert(new THREE.Mesh(forgeGeo, forgeMat)); forgeGround.name = 'ExpeditionForgeGround'; forgeGround.renderOrder = 2;

  // ---- Supplies: delivered timber and stone stacked on pallets sized to the goal ----
  const supplyMat = own('materials', new THREE.MeshStandardMaterial({color: 0xffffff, roughness: .9, metalness: 0, flatShading: true}));
  const logGeo = own('geometries', new THREE.CylinderGeometry(.085, .09, 1, 7).rotateX(Math.PI / 2));
  const boxGeo = own('geometries', new THREE.BoxGeometry(1, 1, 1));
  const timber = inert(new THREE.InstancedMesh(logGeo, supplyMat, 24)); timber.name = 'ExpeditionTimber';
  const stone = inert(new THREE.InstancedMesh(boxGeo, supplyMat, 22)); stone.name = 'ExpeditionStone'; // 6 pallet planks + 16 blocks
  const gemMat = own('materials', new THREE.MeshStandardMaterial({color: 0x9fd0ff, emissive: 0x4f9bff, emissiveIntensity: 1.4, roughness: .25, metalness: .1, flatShading: true}));
  const gemGeo = own('geometries', new THREE.OctahedronGeometry(.13, 0).scale(1, 1.7, 1));
  const gems = inert(new THREE.InstancedMesh(gemGeo, gemMat, 8)); gems.name = 'ExpeditionStarGems';
  for (const mesh of [timber, stone, gems]) { mesh.count = 0; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); }
  const tint = new THREE.Color();
  for (let i = 0; i < 24; i++) timber.setColorAt(i, tint.setHex(0x8b5a2b).offsetHSL(0, 0, ((i * 37) % 7 - 3) * .012));
  for (let i = 0; i < 22; i++) stone.setColorAt(i, i < 6 ? tint.setHex(0x5e4128) : tint.setHex(0xa59f92).offsetHSL(0, 0, ((i * 53) % 5 - 2) * .02));

  // ---- Columns: forge plume (flame level) and the star beacon (site) share one crossed-quad geometry ----
  const columnGeo = own('geometries', column());
  const plumeMat = glyph(true, LOOK.rekindle); plumeMat.uniforms.uMode.value = 1;
  const plume = inert(new THREE.Mesh(columnGeo, plumeMat)); plume.name = 'ExpeditionForgePlume'; plume.scale.set(1.05, 3.4, 1.05);
  const beaconMat = glyph(true, LOOK.star); beaconMat.uniforms.uMode.value = 0;
  const beacon = inert(new THREE.Mesh(columnGeo, beaconMat)); beacon.name = 'ExpeditionStarBeacon'; beacon.scale.set(.8, 20, .8);

  // ---- Star site ground: marking ring around the shard cluster plus a soft glow/impact disk ----
  const siteGeo = own('geometries', polar([{ri: 2.85, ro: 3.05, segs: 96, rings: 1, band: 0, lift: .06}, {ri: 0, ro: 3.6, segs: 48, rings: 6, band: 4, lift: .07}]));
  const siteMat = glyph(false, LOOK.star);
  const site = inert(new THREE.Mesh(siteGeo, siteMat)); site.name = 'ExpeditionStarSite'; site.renderOrder = 2;

  // ---- Burst disk: one pooled conformed shockwave for impact / rekindled / victory / defeat ----
  const burstGeo = own('geometries', polar([{ri: 0, ro: 1, segs: 64, rings: low ? 8 : 12, band: 4, lift: .1}]));
  const burstUnit = Float32Array.from(burstGeo.userData.xz);
  const burstMat = glyph(true, LOOK.victory);
  const burst = inert(new THREE.Mesh(burstGeo, burstMat)); burst.name = 'ExpeditionBurst'; burst.renderOrder = 3;

  // ---- Telegraphs: up to 8 ground-conforming warnings + short columns, merged into one draw call ----
  const ring = {segs: 40, rings: 5}, discVerts = (ring.segs + 1) * (ring.rings + 1), slotVerts = discVerts + 8;
  const slotIdx = ring.segs * ring.rings * 6 + 12;
  const telPos = new Float32Array(MAX_TEL * slotVerts * 3), telT = new Float32Array(MAX_TEL * slotVerts * 4), telIdx = new Uint16Array(MAX_TEL * slotIdx);
  for (let slot = 0, k = 0; slot < MAX_TEL; slot++) {
    const base = slot * slotVerts;
    for (let r = 0; r <= ring.rings; r++) for (let s = 0; s <= ring.segs; s++) {
      const v = base + r * (ring.segs + 1) + s; telT.set([s / ring.segs, r / ring.rings, 0, slot], v * 4);
    }
    for (let r = 0; r < ring.rings; r++) for (let s = 0; s < ring.segs; s++) {
      const a = base + r * (ring.segs + 1) + s, b = a + ring.segs + 1;
      telIdx.set([a, b, a + 1, a + 1, b, b + 1], k); k += 6;
    }
    for (let q = 0; q < 2; q++) {
      const b = base + discVerts + q * 4;
      [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(([u, v], j) => telT.set([u, v, 1, slot], (b + j) * 4));
      telIdx.set([b, b + 1, b + 2, b + 2, b + 1, b + 3], k); k += 6;
    }
  }
  const telGeo = own('geometries', new THREE.BufferGeometry());
  telGeo.setAttribute('position', new THREE.BufferAttribute(telPos, 3)); telGeo.setAttribute('aT', new THREE.BufferAttribute(telT, 4));
  telGeo.setIndex(new THREE.BufferAttribute(telIdx, 1)); telGeo.setDrawRange(0, 0);
  const telS = Array.from({length: MAX_TEL}, () => new THREE.Vector4()), telD = Array.from({length: MAX_TEL}, () => new THREE.Vector4());
  const telMat = own('materials', new THREE.ShaderMaterial({uniforms: {uT: T, uS: {value: telS}, uD: {value: telD}}, vertexShader: TEL_VS, fragmentShader: TEL_FS,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3}));
  const telMesh = inert(new THREE.Mesh(telGeo, telMat)); telMesh.name = 'ExpeditionTelegraphs'; telMesh.frustumCulled = false; telMesh.renderOrder = 3;
  const tel = Array.from({length: MAX_TEL}, () => ({id: '', kind: 'gate', x: 0, z: 0, radius: 3, remaining: 0, stamp: 0, total: 6, born: 0, live: false}));
  let telCount = 0;

  // ---- Sparks: bounded pooled points for delivery glints and the one-time flourishes ----
  const sparkPos = new Float32Array(SPARKS * 3), sparkP = new Float32Array(SPARKS * 4), sparkState = new Float32Array(SPARKS * 12);
  const sparkGeo = own('geometries', new THREE.BufferGeometry());
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
  sparkGeo.setAttribute('aP', new THREE.BufferAttribute(sparkP, 4).setUsage(THREE.DynamicDrawUsage));
  const sparkMat = own('materials', new THREE.ShaderMaterial({uniforms: {uScale: {value: pointScale}}, vertexShader: SPARK_VS, fragmentShader: SPARK_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false}));
  const sparks = inert(new THREE.Points(sparkGeo, sparkMat)); sparks.name = 'ExpeditionSparks'; sparks.frustumCulled = false;
  let sparkLive = 0, sparkCursor = 0;

  root.add(forgeGround, timber, stone, gems, plume, beacon, site, burst, telMesh, sparks);
  const renderables = [forgeGround, timber, stone, gems, plume, beacon, site, burst, telMesh, sparks];
  for (const r of renderables) r.visible = false;

  // ---- State ----
  let model = null, primed = false, disposed = false, paused = false, clock = 0, auth = 0; // clock: presentation; auth: authoritative extrapolation (frozen while paused)
  const forge = {x: 0, z: 0, y: 0, powered: true};
  let terrainKey = NaN, siteXZ = null, siteFade = 0, siteFadeDir = 0, landedAt = -1, starTelegraphHead = -1;
  let visFlame = 0, flameTarget = 0, lastFlame = null, lastFlameAt = 0, trend = 0, urgency = 0, boost = 0;
  const seen = new Map(); // one-shot flourish keys -> run, bounded
  const shown = {wood: 0, stone: 0, gems: 0, woodNeed: 0, stoneNeed: 0, gemsNeed: 0};
  const drops = new Float32Array(48).fill(-1); // per-instance drop start time (timber 0..23, stone blocks 24..39, gems 40..47)
  let consumeUntil = -1, burstStart = -1, burstLen = 1, burstRadius = 1, burstKind = '';
  const counters = {snapshots: 0, events: 0, ignoredEvents: 0, bursts: 0, rebuilds: 0, terrain: 0};
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const colA = new THREE.Color(), colB = new THREE.Color(), colH = new THREE.Color();
  const look = {l9: 0, l11: 0, runes: 0};

  const worldOf = (mx, mz) => [forge.x - mx, forge.z - mz];
  function conform(geo, ox, oz, baseY) {
    const pos = geo.attributes.position.array, {xz, lift} = geo.userData;
    for (let v = 0; v < lift.length; v++) {
      const x = xz[v * 2], z = xz[v * 2 + 1];
      pos[v * 3] = x; pos[v * 3 + 1] = H(ox + x, oz + z) - baseY + lift[v]; pos[v * 3 + 2] = z;
    }
    geo.attributes.position.needsUpdate = true; geo.computeBoundingSphere();
  }
  function placeForge() {
    forge.y = H(forge.x, forge.z);
    forgeGround.position.set(forge.x, forge.y, forge.z); conform(forgeGeo, forge.x, forge.z, forge.y);
    for (const mesh of [timber, stone, gems]) mesh.position.set(forge.x, forge.y, forge.z);
    plume.position.set(forge.x - CHIMNEY_TOP[0], forge.y + CHIMNEY_TOP[1], forge.z - CHIMNEY_TOP[2]);
    layoutSupplies(true);
  }
  function placeSite() {
    if (!siteXZ) return;
    const y = H(siteXZ[0], siteXZ[1]);
    site.position.set(siteXZ[0], y, siteXZ[1]); conform(siteGeo, siteXZ[0], siteXZ[1], y);
    beacon.position.set(siteXZ[0], y, siteXZ[1]);
  }
  function rebuildTelegraphs() {
    counters.rebuilds++;
    for (let i = 0; i < telCount; i++) {
      const t = tel[i], base = i * slotVerts, cy = H(t.x, t.z);
      for (let r = 0; r <= ring.rings; r++) for (let s = 0; s <= ring.segs; s++) {
        const v = base + r * (ring.segs + 1) + s, ang = s / ring.segs * Math.PI * 2, rad = r / ring.rings * t.radius;
        const x = t.x + Math.cos(ang) * rad, z = t.z + Math.sin(ang) * rad;
        telPos[v * 3] = x; telPos[v * 3 + 1] = H(x, z) + .08; telPos[v * 3 + 2] = z;
      }
      for (let q = 0; q < 2; q++) for (let j = 0; j < 4; j++) {
        const v = base + discVerts + q * 4 + j, u = (j & 1) - .5, h = j >> 1;
        telPos[v * 3] = t.x + (q ? 0 : u * .4); telPos[v * 3 + 1] = cy + h * 2.8; telPos[v * 3 + 2] = t.z + (q ? u * .4 : 0);
      }
      const dx = forge.x - t.x, dz = forge.z - t.z, d = Math.hypot(dx, dz) || 1;
      telD[i].set(dx / d, dz / d, 0, 0);
    }
    telGeo.attributes.position.needsUpdate = true; telGeo.setDrawRange(0, telCount * slotIdx);
  }
  function terrainChanged() { counters.terrain++; placeForge(); placeSite(); rebuildTelegraphs(); }

  function timberSlot(i, need, out) { // pyramid sized to the goal; logs lie along the model Z axis
    let b = 1; while (b * (b + 1) / 2 < need) b++;
    let row = 0, n = i; while (n >= b - row) { n -= b - row; row++; }
    const count = b - row;
    out.set(TIMBER_AT[0] + (n - (count - 1) / 2) * .185, .1 + .09 + row * .155, TIMBER_AT[1]);
    return b;
  }
  function stoneSlot(i, out) {
    const layer = Math.floor(i / 8), j = i % 8;
    out.set(STONE_AT[0] + ((j % 2) - .5) * .33, .1 + .095 + layer * .2, STONE_AT[1] + (Math.floor(j / 2) - 1.5) * .25);
  }
  const groundAt = (mx, mz) => { const [x, z] = worldOf(mx, mz); return H(x, z) - forge.y; };
  function setInstance(mesh, i, mx, my, mz, sx, sy, sz, yaw) {
    const [x, z] = worldOf(mx, mz);
    v3.set(x - forge.x, my, z - forge.z); q4.setFromAxisAngle(up, yaw); s3.set(sx, sy, sz);
    mesh.setMatrixAt(i, m4.compose(v3, q4, s3));
  }
  function layoutSupplies(all) {
    const woodNeed = shown.woodNeed, stoneNeed = shown.stoneNeed, now = clock;
    const tGround = groundAt(TIMBER_AT[0], TIMBER_AT[1]), sGround = groundAt(STONE_AT[0], STONE_AT[1]);
    let sink = consumeUntil > now ? 1 - (consumeUntil - now) / .9 : 0; sink = Math.max(0, sink);
    for (let i = 0; i < shown.wood; i++) {
      const t0 = drops[i]; if (!all && t0 < 0 && !sink) continue;
      const b = timberSlot(i, woodNeed, v3), x = v3.x, z = v3.z;
      const p = t0 >= 0 ? Math.min(1, (now - t0) / .55) : 1, lift = (1 - bounceOut(p)) * .7 - sink * .5;
      if (p >= 1) drops[i] = -1;
      setInstance(timber, i, x, tGround + v3.y + lift, z, 1, 1, Math.min(1.05, .55 + .08 * b), ((i * 13) % 5 - 2) * .02);
    }
    timber.count = shown.wood; timber.instanceMatrix.needsUpdate = true;
    if (all) { // pallets sized to the goals
      let b = 1; while (b * (b + 1) / 2 < woodNeed) b++;
      const tw = Math.max(.5, b * .185 + .12), sl = Math.max(.5, Math.ceil(Math.min(stoneNeed, 8) / 2) * .25 + .1);
      for (let k = 0; k < 3; k++) {
        setInstance(stone, k, TIMBER_AT[0], tGround + .05, TIMBER_AT[1] + (k - 1) * .36, tw, .08, .14, 0);
        setInstance(stone, 3 + k, STONE_AT[0] + (k - 1) * .26, sGround + .05, STONE_AT[1], .12, .08, sl, 0);
      }
    }
    for (let i = 0; i < shown.stone; i++) {
      const t0 = drops[24 + i]; if (!all && t0 < 0 && !sink) continue;
      stoneSlot(i, v3); const x = v3.x, y = v3.y, z = v3.z;
      const p = t0 >= 0 ? Math.min(1, (now - t0) / .55) : 1, lift = (1 - bounceOut(p)) * .7 - sink * .5;
      if (p >= 1) drops[24 + i] = -1;
      setInstance(stone, 6 + i, x, sGround + y + lift, z, .3, .18, .22, ((i * 29) % 7 - 3) * .03);
    }
    stone.count = (shown.woodNeed || shown.stoneNeed) ? 6 + shown.stone : 0; stone.instanceMatrix.needsUpdate = true;
  }
  function layoutGems() {
    const n = Math.max(1, shown.gemsNeed || 1), r = (HEARTH_IN + HEARTH_OUT) / 2;
    for (let i = 0; i < shown.gems; i++) {
      const ang = (i + .5) / n * Math.PI * 2 + Math.PI / 2, x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      const t0 = drops[40 + i], p = t0 >= 0 ? Math.min(1, (clock - t0) / .7) : 1;
      if (p >= 1) drops[40 + i] = -1;
      const y = H(forge.x + x, forge.z + z) - forge.y + .42 + .05 * Math.sin(T.value * 1.7 + i) + (1 - bounceOut(p)) * 1.2;
      v3.set(x, y, z); q4.setFromAxisAngle(up, T.value * .6 + i); s3.setScalar(1);
      gems.setMatrixAt(i, m4.compose(v3, q4, s3));
    }
    gems.count = shown.gems; gems.instanceMatrix.needsUpdate = true;
  }

  function spark(x, y, z, vx, vy, vz, life, size, hex, gravity) {
    const i = sparkCursor; sparkCursor = (sparkCursor + 1) % SPARKS;
    const s = sparkState, o = i * 12; tint.setHex(hex);
    if (s[o + 7] <= 0) sparkLive++;
    s[o] = x; s[o + 1] = y; s[o + 2] = z; s[o + 3] = vx; s[o + 4] = vy; s[o + 5] = vz; s[o + 6] = 0; s[o + 7] = life;
    s[o + 8] = size; s[o + 9] = tint.r; s[o + 10] = tint.g; s[o + 11] = tint.b;
    sparkGravity[i] = gravity;
  }
  const sparkGravity = new Float32Array(SPARKS);
  const hash = n => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };
  function fountain(x, y, z, n, hex, {speed = 2, up: lift = 3, life = 1.4, size = .22, gravity = 4, spread = .4, seed = 0} = {}) {
    for (let k = 0; k < n; k++) {
      const a = hash(seed + k * 1.7) * Math.PI * 2, r = hash(seed + k * 3.1 + 9) * spread, sp = speed * (.4 + .6 * hash(seed + k * 5.3));
      spark(x + Math.cos(a) * r, y, z + Math.sin(a) * r, Math.cos(a) * sp, lift * (.6 + .4 * hash(seed + k * 7.9)), Math.sin(a) * sp, life * (.7 + .3 * hash(seed + k)), size, hex, gravity);
    }
  }
  function startBurst(x, z, radius, len, kind, look) {
    burstStart = clock; burstLen = len; burstRadius = radius; burstKind = kind; counters.bursts++;
    const xz = burstGeo.userData.xz; for (let i = 0; i < xz.length; i++) xz[i] = burstUnit[i] * radius;
    const y = H(x, z); burst.position.set(x, y, z); conform(burstGeo, x, z, y);
    burstMat.uniforms.uB.value.setHex(look.b); burstMat.uniforms.uHot.value.setHex(look.hot);
  }
  function once(key, run) {
    if (seen.has(key)) return false;
    seen.set(key, run); if (seen.size > 32) seen.delete(seen.keys().next().value);
    return true;
  }
  const chimney = () => [plume.position.x, plume.position.y + .2, plume.position.z];

  // ---- One-shot flourishes (each keyed per run, never on first/late-join snapshots) ----
  function flourish(kind) {
    if (!model) return;
    const run = model.run, [cx, cy, cz] = chimney();
    if (kind === 'impact' && siteXZ && once(`i:${run}`, run)) {
      landedAt = clock; startBurst(siteXZ[0], siteXZ[1], 7, 1.3, 'impact', LOOK.star);
      const y = H(siteXZ[0], siteXZ[1]);
      fountain(siteXZ[0], y + .3, siteXZ[1], low ? 10 : 24, 0xcfe8ff, {speed: 3.2, up: 5.5, life: 1.3, size: .26, gravity: 9, spread: 1, seed: run});
    } else if (kind === 'rekindled' && once(`k:${run}:${model.retries}`, run)) {
      boost = 1; startBurst(forge.x, forge.z, 6, 1.1, 'rekindled', LOOK.rekindle);
      fountain(cx, cy, cz, low ? 8 : 18, 0xffb347, {speed: 1.3, up: 4.5, life: 1.6, size: .2, gravity: 2.5, spread: .3, seed: run + 3});
    } else if (kind === 'victory' && once(`v:${run}`, run)) {
      boost = 1.6; startBurst(forge.x, forge.z, 11, 1.8, 'victory', LOOK.victory);
      const n = low ? 12 : 36, r = (HEARTH_IN + HEARTH_OUT) / 2;
      for (let k = 0; k < n; k++) {
        const a = k / n * Math.PI * 2, x = forge.x + Math.cos(a) * r, z = forge.z + Math.sin(a) * r;
        spark(x, H(x, z) + .2, z, -Math.sin(a) * .9, 3 + 1.5 * hash(k + run), Math.cos(a) * .9, 1.9, .24, k % 3 ? 0xffd36b : 0xfff3c4, .8);
      }
    } else if (kind === 'defeat' && once(`d:${run}:${model.retries}`, run)) {
      startBurst(forge.x, forge.z, 4, 1.6, 'defeat', LOOK.defeat);
      fountain(cx, cy, cz, low ? 6 : 14, 0x6b6058, {speed: .4, up: .9, life: 2.4, size: .18, gravity: -.15, spread: .35, seed: run + 7});
    } else if (kind === 'recovered' && siteXZ && once(`r:${run}`, run)) {
      const y = H(siteXZ[0], siteXZ[1]);
      fountain(siteXZ[0], y + .4, siteXZ[1], low ? 6 : 12, 0x9fd0ff, {speed: .5, up: 3.5, life: 1.6, size: .2, gravity: -.4, spread: 1.4, seed: run + 11});
    } else if (kind === 'consumed' && once(`c:${run}`, run)) {
      consumeUntil = clock + .9;
      for (const at of [TIMBER_AT, STONE_AT]) {
        const [x, z] = worldOf(at[0], at[1]);
        fountain(x, H(x, z) + .5, z, low ? 3 : 8, 0xffc070, {speed: .5, up: 2.2, life: 1.1, size: .16, gravity: 1, spread: .4, seed: run + at[0]});
      }
    }
  }

  function readWorld(world) {
    if (!world || typeof world !== 'object') return false;
    let moved = false;
    const anchor = world.shrine;
    if (anchor && Array.isArray(anchor.position) && finite(anchor.position[0]) && finite(anchor.position[2])) {
      if (anchor.position[0] !== forge.x || anchor.position[2] !== forge.z) { forge.x = anchor.position[0]; forge.z = anchor.position[2]; moved = true; }
      forge.powered = !(finite(anchor.hp) && anchor.hp <= 0);
    }
    if (Array.isArray(world.edits)) {
      let key = world.edits.length;
      for (let i = 0; i < world.edits.length; i++) {
        const e = world.edits[i]; if (!e) continue;
        key = (key * 31 + (+e.x || 0) * 7.13 + (+e.z || 0) * 3.71 + (+e.radius || 0) * 11.3 + (+e.height || 0) * 17.9) % 1e9;
      }
      if (key !== terrainKey) { terrainKey = key; moved = true; }
    }
    return moved;
  }
  function syncTelegraphs(list) {
    const stamp = auth;
    let changed = list.length !== telCount;
    for (let i = 0; i < list.length && !changed; i++) {
      const a = list[i], b = tel[i];
      if (a.id !== b.id || a.x !== b.x || a.z !== b.z || a.radius !== b.radius || a.kind !== b.kind) changed = true;
    }
    const prior = changed ? tel.slice(0, telCount).map(t => [t.id, t.born]) : null;
    for (let i = 0; i < list.length; i++) {
      const a = list[i], b = tel[i];
      const born = prior ? (prior.find(p => p[0] === a.id)?.[1] ?? clock) : b.born;
      Object.assign(b, {id: a.id, kind: a.kind, x: a.x, z: a.z, radius: a.radius, remaining: a.remaining, stamp, total: TEL_SECONDS[a.kind], born, live: true});
    }
    for (let i = list.length; i < MAX_TEL; i++) tel[i].live = false;
    telCount = list.length;
    if (changed) rebuildTelegraphs();
  }

  function resetRun() {
    drops.fill(-1); consumeUntil = -1; burstStart = -1; boost = 0; trend = 0; urgency = 0; lastFlame = null;
    sparkLive = 0; sparkState.fill(0); sparkP.fill(0); siteFade = 0; siteFadeDir = 0; landedAt = -1;
    for (const [k, r] of seen) if (model && r < model.run) seen.delete(k);
  }

  function applySnapshot(adventure, world) {
    if (disposed) return false;
    const next = readExpedition(adventure); if (!next) return false;
    counters.snapshots++;
    const moved = readWorld(world);
    const prev = model, live = primed && prev;
    if (live && next.run !== prev.run) { model = next; resetRun(); }
    model = next;
    if (!primed || (prev && next.run !== prev.run)) {
      // Persistent state only: mark what already happened so replayed events cannot burst.
      if (next.landed) seen.set(`i:${next.run}`, next.run);
      if (next.rekindled || next.stage === 'victory') seen.set(`k:${next.run}:${next.retries}`, next.run);
      if (next.stage === 'victory') seen.set(`v:${next.run}`, next.run);
      if (next.stage === 'defeat') seen.set(`d:${next.run}:${next.retries}`, next.run);
    }
    if (next.site) { if (!siteXZ || siteXZ[0] !== next.site[0] || siteXZ[1] !== next.site[1]) { siteXZ = [next.site[0], next.site[1]]; placeSite(); } }
    if (moved || !primed) terrainChanged();
    // Supplies and gems: newly delivered items settle in; first/late-join snapshots appear settled.
    const wood = next.stage === 'camp' ? next.wood : [0, 0], stoneNow = next.stage === 'camp' ? next.stone : [0, 0];
    if (live && prev.stage === 'camp' && next.stage !== 'camp' && next.run === prev.run) flourish('consumed');
    const keepConsumed = consumeUntil > clock;
    if (!keepConsumed) {
      if (live) { for (let i = shown.wood; i < wood[0]; i++) drops[i] = clock; for (let i = shown.stone; i < stoneNow[0]; i++) drops[24 + i] = clock; }
      shown.wood = Math.min(24, wood[0]); shown.stone = Math.min(16, stoneNow[0]);
      shown.woodNeed = Math.min(24, wood[1]); shown.stoneNeed = Math.min(16, stoneNow[1]);
      layoutSupplies(true);
    }
    const g = next.stage === 'star' ? next.gems : [0, 0];
    if (live) for (let i = shown.gems; i < g[0]; i++) drops[40 + i] = clock;
    shown.gems = Math.min(8, g[0]); shown.gemsNeed = Math.min(8, g[1]);
    // Star site lifecycle.
    if (next.stage === 'star') siteFadeDir = 1;
    else if (siteFade > 0) siteFadeDir = -1;
    if (live && prev.stage === 'star' && next.stage === 'rekindle' && next.run === prev.run) flourish('recovered');
    if (live && next.stage === 'star' && next.landed && !prev.landed && next.run === prev.run) flourish('impact');
    if (!primed && next.stage === 'star') siteFade = 1;
    // Flame and urgency (trend measured between snapshots on the presentation clock; pause freezes it).
    if (next.flame !== null) {
      flameTarget = next.flame / 100;
      if (next.stage === 'rekindle' && lastFlame !== null && auth - lastFlameAt > .02) {
        const rate = (next.flame - lastFlame) / (auth - lastFlameAt); trend += (rate - trend) * .35;
      }
      lastFlame = next.flame; lastFlameAt = auth;
      if (!live || (prev.stage === 'defeat' && next.stage === 'rekindle')) visFlame = live ? 0 : flameTarget; // retry relights from dark
    } else { flameTarget = 0; lastFlame = null; trend = 0; }
    if (next.stage !== 'rekindle') trend = 0;
    if (live && next.run === prev.run && next.stage !== prev.stage) {
      if (next.stage === 'victory') flourish('victory');
      if (next.stage === 'defeat') flourish('defeat');
    }
    if (live && next.rekindled && !prev.rekindled && next.run === prev.run) flourish('rekindled');
    syncTelegraphs(next.telegraphs);
    primed = true;
    return true;
  }

  function handleEvent(event) {
    if (disposed || !event || typeof event !== 'object' || typeof event.kind !== 'string' || !event.kind.startsWith('adventure_')) return false;
    if (!primed || !model) { counters.ignoredEvents++; return false; } // late joiners: snapshots restore, events never replay
    counters.events++;
    const k = event.kind;
    if (k === 'adventure_stage') {
      if (event.run !== model.run || !STAGES.has(event.stage)) return false; // a new run arrives with its snapshot
      if (event.stage === 'victory' || event.stage === 'defeat') { flourish(event.stage); return true; }
      return false;
    }
    if (k === 'adventure_star_impact') {
      const p = event.position;
      if (model.stage !== 'star' || !Array.isArray(p) || !finite(p[0]) || !finite(p[2])) return false;
      if (!siteXZ || Math.hypot(siteXZ[0] - p[0], siteXZ[1] - p[2]) > .5) { siteXZ = [p[0], p[2]]; placeSite(); siteFadeDir = 1; }
      flourish('impact'); return true;
    }
    if (k === 'adventure_rekindled') { if (model.stage !== 'rekindle') return false; flourish('rekindled'); return true; }
    if (k === 'adventure_telegraph') {
      const kind = event.telegraph;
      if (!(kind in TEL_KIND) || !finite(event.x) || !finite(event.z) || typeof event.id !== 'string') return false;
      if (tel.slice(0, telCount).some(t => t.id === event.id)) return false;
      const list = tel.slice(0, telCount).map(t => ({...t, remaining: Math.max(.01, t.remaining - Math.min(EXTRAPOLATE, Math.max(0, auth - t.stamp)))}));
      if (list.length >= MAX_TEL) list.shift();
      list.push({id: event.id.slice(0, 64), kind, x: event.x, z: event.z, radius: Math.max(.5, Math.min(10, finite(event.radius) ? event.radius : 3)), remaining: TEL_SECONDS[kind]});
      syncTelegraphs(list); return true;
    }
    if (k === 'adventure_deposit' || k === 'adventure_support') {
      // Tiny glint at the forge where the delivery lands; no donor position is invented.
      const res = k === 'adventure_deposit' ? event.resource : model.stage === 'star' ? 'gems' : model.stage === 'rekindle' ? 'flame' : event.action === 'tithe' ? 'wood' : 'gems';
      let x = forge.x, y, z = forge.z, hex = 0xffc070;
      if (model.stage === 'camp' && (res === 'wood' || res === 'stone')) { [x, z] = worldOf(...(res === 'wood' ? TIMBER_AT : STONE_AT)); y = H(x, z) + .7; }
      else if (model.stage === 'star') { y = H(x, z) + .6; hex = 0xbfe2ff; }
      else { [x, y, z] = chimney(); hex = 0xffb347; }
      fountain(x, y, z, low ? 3 : 6, hex, {speed: .5, up: 1.6, life: .8, size: .14, gravity: 2, spread: .25, seed: counters.events});
      return true;
    }
    return false;
  }

  function update(now, dt, camera) {
    if (disposed) return;
    dt = finite(dt) && dt > 0 ? Math.min(dt, .1) : 0;
    T.value = (T.value + dt) % 3600;
    clock += dt; if (!paused) auth += dt;
    const stage = model?.stage || 'idle';
    const bursting = burstStart >= 0 || sparkLive > 0 || siteFade > 0;
    if (stage === 'idle' && !bursting) { root.visible = false; return; }
    root.visible = true;
    const k = 1 - Math.exp(-dt * 3), L = LOOK[stage];
    look.l9 += (L.l9 - look.l9) * k; look.l11 += (L.l11 * (1 + urgency * 1.4) - look.l11) * k; look.runes += (L.runes * (forge.powered ? 1 : .55) - look.runes) * k;
    const fu = forgeMat.uniforms;
    colA.setHex(L.a); colB.setHex(L.b); colH.setHex(L.hot);
    fu.uA.value.lerp(colA, k); fu.uB.value.lerp(colB, k); fu.uHot.value.lerp(colH, k);
    // Fill: camp delivery share, star charge, rekindle flame (eased; a retry relights from dark).
    const fill = stage === 'camp' ? (shown.wood + shown.stone) / Math.max(1, shown.woodNeed + shown.stoneNeed)
      : stage === 'star' ? shown.gems / Math.max(1, shown.gemsNeed) : stage === 'idle' ? 0 : flameTarget;
    visFlame += (fill - visFlame) * (1 - Math.exp(-dt * (stage === 'defeat' ? .9 : 2.2)));
    const urgTarget = stage !== 'rekindle' ? 0 : Math.max(trend < -.05 ? Math.min(1, .35 + -trend / .8) : 0, flameTarget < .2 ? (.2 - flameTarget) * 5 : 0);
    urgency += (urgTarget - urgency) * (1 - Math.exp(-dt * 2.5));
    fu.uFill.value = visFlame; fu.uUrg.value = urgency;
    fu.uSeg.value = stage === 'star' ? Math.max(1, shown.gemsNeed) : stage === 'camp' ? 8 : 10;
    fu.uMirror.value = stage === 'star' ? 0 : 1;
    fu.uAlpha.value.set(look.l9, look.l11, look.runes, 0);
    forgeGround.visible = stage !== 'idle' && look.runes + look.l9 > .01;
    // Distance simplification for small props (rings, plume and beacon stay readable from RTS height).
    const far = camera ? camera.getWorldPosition(v3).distanceTo(s3.set(forge.x, forge.y, forge.z)) > (low ? 55 : 85) : false;
    const supplies = (stage === 'camp' || consumeUntil > clock) && !far;
    timber.visible = supplies && timber.count > 0; stone.visible = supplies && stone.count > 0;
    if (supplies) {
      let anim = consumeUntil > clock; for (let i = 0; i < 40 && !anim; i++) anim = drops[i] >= 0;
      if (anim) layoutSupplies(false);
      else if (consumeUntil >= 0 && consumeUntil <= clock) { consumeUntil = -1; shown.wood = shown.stone = shown.woodNeed = shown.stoneNeed = 0; layoutSupplies(true); }
    } else if (consumeUntil >= 0 && consumeUntil <= clock) { consumeUntil = -1; shown.wood = shown.stone = shown.woodNeed = shown.stoneNeed = 0; layoutSupplies(true); }
    gems.visible = stage === 'star' && shown.gems > 0 && !far;
    if (gems.visible) layoutGems();
    // Plume: present through rekindle/victory, settles out on defeat.
    const pu = plumeMat.uniforms;
    boost = Math.max(0, boost - dt * .8);
    const plumeOn = stage === 'rekindle' || stage === 'victory' || (stage === 'defeat' && visFlame > .02);
    pu.uFill.value = visFlame; pu.uUrg.value = urgency; pu.uBoost.value = boost;
    pu.uAlpha.value.w += ((plumeOn ? (forge.powered ? .95 : .5) : 0) - pu.uAlpha.value.w) * k;
    const pl = LOOK[stage === 'victory' ? 'victory' : 'rekindle'];
    colA.setHex(stage === 'victory' ? 0xc0601a : 0xa0300c); colB.setHex(pl.b); colH.setHex(pl.hot);
    pu.uA.value.lerp(colA, k); pu.uB.value.lerp(colB, k); pu.uHot.value.lerp(colH, k);
    plume.visible = pu.uAlpha.value.w > .01;
    // Star site + beacon: fade in on the star stage, out once recovered.
    siteFade = Math.max(0, Math.min(1, siteFade + siteFadeDir * dt / (siteFadeDir > 0 ? .8 : 1.5)));
    if (siteFade <= 0) siteFadeDir = 0;
    const landed = !!model?.landed || landedAt >= 0;
    let head = -1;
    if (stage === 'star' && !landed) {
      for (let i = 0; i < telCount; i++) if (tel[i].kind === 'star') { const t = tel[i], rem = Math.max(0, t.remaining - Math.min(EXTRAPOLATE, auth - t.stamp)); head = Math.max(0, Math.min(1, rem / t.total)); }
    }
    starTelegraphHead = head;
    const flash = landedAt >= 0 ? Math.max(0, 1 - (clock - landedAt) / 1.2) : 0;
    const bu = beaconMat.uniforms, su = siteMat.uniforms;
    bu.uHead.value = head; bu.uAlpha.value.w = siteFade * (landed ? .85 + flash * .8 : head >= 0 ? .9 : .35);
    su.uAlpha.value.set(siteFade * (landed ? .75 : .25), 0, 0, siteFade * (landed ? .35 + flash : .1)); su.uHead.value = 1;
    beacon.visible = !!siteXZ && bu.uAlpha.value.w > .01; site.visible = !!siteXZ && siteFade > .01;
    if (landedAt >= 0 && clock - landedAt > 1.2) landedAt = -1;
    // Burst.
    if (burstStart >= 0) {
      const p = (clock - burstStart) / burstLen;
      if (p >= 1 || p < 0) { burstStart = -1; burst.visible = false; }
      else {
        const bm = burstMat.uniforms; bm.uWave.value = 1 - (1 - p) ** 2.2; bm.uHead.value = Math.max(0, 1 - p * 2.5) * (burstKind === 'defeat' ? .1 : .22);
        bm.uAlpha.value.w = burstKind === 'defeat' ? .35 : burstKind === 'impact' ? .8 : .5; burst.visible = true;
      }
    } else burst.visible = false;
    // Telegraphs: countdown from the authoritative remaining time, extrapolated at most EXTRAPOLATE seconds.
    let liveTel = 0;
    for (let i = 0; i < MAX_TEL; i++) {
      const t = tel[i];
      if (i >= telCount || !t.live) { telS[i].set(0, 0, 0, 0); continue; }
      const rem = t.remaining - Math.min(EXTRAPOLATE, Math.max(0, auth - t.stamp));
      const alpha = rem <= 0 ? 0 : Math.min(1, (clock - t.born) / .25 + .001) * Math.min(1, rem / .2);
      telS[i].set(TEL_KIND[t.kind], Math.max(0, Math.min(1, 1 - rem / t.total)), alpha * .9, t.radius);
      if (alpha > 0) liveTel++;
    }
    telMesh.visible = liveTel > 0;
    // Sparks.
    if (sparkLive > 0) {
      let alive = 0;
      for (let i = 0; i < SPARKS; i++) {
        const o = i * 12, s = sparkState;
        if (s[o + 7] <= 0) { sparkP[i * 4] = 0; continue; }
        s[o + 6] += dt;
        if (s[o + 6] >= s[o + 7]) { s[o + 7] = 0; sparkP[i * 4] = 0; continue; }
        alive++;
        s[o + 4] -= sparkGravity[i] * dt; s[o] += s[o + 3] * dt; s[o + 1] += s[o + 4] * dt; s[o + 2] += s[o + 5] * dt;
        s[o + 3] *= 1 - dt * .8; s[o + 5] *= 1 - dt * .8;
        const life = s[o + 6] / s[o + 7], a = Math.min(1, life * 8) * (1 - life) ** 1.3;
        sparkPos[i * 3] = s[o]; sparkPos[i * 3 + 1] = s[o + 1]; sparkPos[i * 3 + 2] = s[o + 2];
        sparkP[i * 4] = Math.floor(s[o + 9] * 255) + Math.min(.999, a); sparkP[i * 4 + 1] = s[o + 10]; sparkP[i * 4 + 2] = s[o + 11]; sparkP[i * 4 + 3] = s[o + 8];
      }
      sparkLive = alive;
      sparkGeo.attributes.position.needsUpdate = true; sparkGeo.attributes.aP.needsUpdate = true;
    }
    sparks.visible = sparkLive > 0;
  }

  // Detached representatives share the real materials; nothing is added to the world and no event is synthesized.
  async function prepare(renderer, camera, targetScene = scene) {
    if (disposed || !renderer?.compileAsync) return;
    const preview = new THREE.Group(), temp = [];
    const inst = (geo, mat) => { const m = new THREE.InstancedMesh(geo, mat, 1); m.setColorAt(0, tint.setHex(0xffffff)); temp.push(m); return m; };
    preview.add(new THREE.Mesh(forgeGeo, forgeMat), new THREE.Mesh(columnGeo, plumeMat), new THREE.Mesh(telGeo, telMat), new THREE.Points(sparkGeo, sparkMat),
      inst(logGeo, supplyMat), inst(gemGeo, gemMat));
    try { await renderer.compileAsync(preview, camera, targetScene); }
    finally { preview.clear(); for (const m of temp) m.dispose(); }
  }

  function stats() {
    let draws = 0;
    if (root.visible) for (const r of renderables) if (r.visible) draws++;
    return {stage: model?.stage || 'idle', run: model?.run ?? null, visible: root.visible, drawCalls: draws,
      instances: (timber.visible ? timber.count : 0) + (stone.visible ? stone.count : 0) + (gems.visible ? gems.count : 0),
      particles: sparkLive, telegraphs: telCount, flame: Math.round(visFlame * 1000) / 10, urgency: Math.round(urgency * 100) / 100,
      starHead: starTelegraphHead, burst: burstStart >= 0 ? burstKind : null, oneShots: seen.size, quality: low ? 'low' : 'high', paused, ...counters};
  }

  function dispose() {
    if (disposed) return;
    disposed = true; scene.remove(root);
    for (const mesh of [timber, stone, gems]) mesh.dispose();
    for (const g of owned.geometries) g.dispose();
    for (const m of owned.materials) m.dispose();
    root.clear(); seen.clear();
  }

  return {root, applySnapshot, handleEvent, update, prepare, stats, dispose,
    setPaused(value) { paused = !!value; }, refreshTerrain() { if (!disposed) terrainChanged(); }};
}
