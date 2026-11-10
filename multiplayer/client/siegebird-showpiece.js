import * as THREE from 'three';
import {siegebirdMechanism, SIEGEBIRD_WINCH} from './siegebird-reload.js';
import {SIEGEBIRD_PLUMAGES} from './siegebird-flock.js';

// Siegebird showpiece layer ("Wren's Calling"). Presentation only; the shared simulation owns every shot.
//
// Story it plays out: two Calling Stones sit in gilt bezels on the crossbow's shoulders. A sounding wire runs from
// the winch's pawl bracket to them, so each ratchet click rings the stones a little brighter; the keep's songbirds
// answer that note and bring the next bolt. At the latch the stones ring out (a ripple of light). When you loose,
// their charge runs down the rail into the bolt: a flash at the beak, a burst of sparks, the wings shiver and shed a
// little down. In flight the bolt sheds resonance motes; where it lands it bursts in a puff of its bird's feathers.
// The golden bird's bolt does all of it in gold, bigger.
//
// Cost (phone and Quest safe): one pooled point light (slotted by light-budget.js, zero intensity when idle on
// phones), two instanced draws for every particle, glint and halo on screen (additive light + alpha feathers),
// and per-crossbow material clones that only change uniforms. No per-frame allocation, no textures, no shadows.
// Native frame (the crossbow's own): X right, Y forward along the bolt, Z up, metres.

export const SHOWPIECE = Object.freeze({
  stone: {color: 0x2f8cff, hot: 0xbfe6ff, golden: 0xffc24a, idle: 1.1, empty: .12, flare: 3.2, breathe: .1},
  light: {color: 0x7cc4ff, golden: 0xffbf5a, idle: {day: 0, night: 2.4}, distance: 2.2, fire: 26, fireDistance: 7, fireSeconds: .16,
    impact: 16, impactGolden: 42, impactDistance: 6, impactSeconds: .28},
  muzzle: [0, 1.13, .179],
  rail: [[0, .86, .18], [0, 1.0, .18]],
  particles: {light: 384, feathers: 96},
  trail: {every: .022, max: 24, featherEvery: .2},
});
const PHONE_SCALE = .55;   // particle counts on phones

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _n = new THREE.Vector3(), _c = new THREE.Color(), _c2 = new THREE.Color(), _c3 = new THREE.Vector3();
const rand = (a, b) => a + Math.random() * (b - a);

// --------------------------------------------------------------------------------------------- particle draw
// One camera-facing quad per particle, world space. Shapes: 0 soft mote, 1 ring ripple, 2 four-point star glint,
// 3 velocity-stretched spark, 4 feather (alpha pass). Instanced attributes are rewritten each frame for the live set.
const VERT = /* glsl */`
attribute vec4 aPos;      // xyz, size (m)
attribute vec4 aCol;      // rgb, alpha
attribute vec4 aShape;    // shape, rotation, stretch, spin
attribute vec3 aVel;
varying vec2 vUv; varying vec4 vCol; varying float vShape;
#include <fog_pars_vertex>
void main() {
  vUv = position.xy; vCol = aCol; vShape = aShape.x;
  vec4 mvPosition = modelViewMatrix * vec4(aPos.xyz, 1.0);
  vec2 corner = position.xy * aPos.w;
  float c = cos(aShape.y), s = sin(aShape.y);
  if (aShape.x > 2.5 && aShape.x < 3.5) {
    vec3 v = (modelViewMatrix * vec4(aVel, 0.0)).xyz; vec2 d = v.xy; float l = length(d);
    vec2 dir = l > 1e-5 ? d / l : vec2(1.0, 0.0);
    vec2 side = vec2(-dir.y, dir.x);
    corner = dir * position.x * aPos.w * (1.0 + aShape.z) + side * position.y * aPos.w * .35;
  } else {
    corner = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y);
    if (aShape.x > 3.5) corner.x *= mix(.25, 1.0, abs(cos(aShape.w)));
  }
  mvPosition.xy += corner;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FRAG = /* glsl */`
varying vec2 vUv; varying vec4 vCol; varying float vShape;
#include <fog_pars_fragment>
void main() {
  vec2 p = vUv * 2.0; float r = length(p), a = 0.0; vec3 col = vCol.rgb;
  if (vShape < .5) { a = exp(-r * r * 3.2) + .9 * exp(-r * r * 26.0); }
  else if (vShape < 1.5) { a = exp(-pow((r - .78) / .1, 2.0)) * smoothstep(1.0, .9, r); }
  else if (vShape < 2.5) { vec2 q = abs(p); a = exp(-q.x * 16.0) * exp(-q.y * 2.2) + exp(-q.y * 16.0) * exp(-q.x * 2.2) + .8 * exp(-r * r * 30.0); }
  else if (vShape < 3.5) { a = exp(-p.y * p.y * 9.0) * smoothstep(1.0, .2, abs(p.x)) + .6 * exp(-r * r * 20.0); }
  else {
    float x = p.x * .5 + .5, w = .34 * pow(max(0.0, sin(3.14159 * x)), .7) * (1.0 - .35 * x);
    float y = p.y * .5; float vane = smoothstep(w, w * .7, abs(y + .04 * x));
    float barb = .82 + .18 * sin(x * 60.0 - abs(y) * 40.0);
    float rachis = smoothstep(.03, .0, abs(y)) * step(.06, x);
    a = vane; col = mix(col * barb, col * 1.25 + .15, rachis * .7);
  }
  if (a < .01) discard;
  gl_FragColor = vec4(col, a * vCol.a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function particleDraw(capacity, additive) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const attr = (n, size) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(n, a); return a; };
  const pos = attr('aPos', 4), col = attr('aCol', 4), shape = attr('aShape', 4), vel = attr('aVel', 3);
  g.instanceCount = 0;
  const material = new THREE.ShaderMaterial({vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.clone(THREE.UniformsLib.fog), blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide});
  material.name = additive ? 'SiegebirdShowpieceLight' : 'SiegebirdShowpieceFeathers';
  const mesh = new THREE.Mesh(g, material); mesh.frustumCulled = false; mesh.userData.ignoreContact = true; mesh.renderOrder = additive ? 6 : 5;
  mesh.name = material.name;
  let n = 0;
  return {mesh, capacity,
    begin() { n = 0; },
    push(x, y, z, size, r, gg, b, alpha, shapeId, rot = 0, stretch = 0, spin = 0, vx = 0, vy = 0, vz = 0) {
      if (n >= capacity || !(alpha > .003)) return;
      pos.array.set([x, y, z, size], n * 4); col.array.set([r, gg, b, alpha], n * 4); shape.array.set([shapeId, rot, stretch, spin], n * 4); vel.array.set([vx, vy, vz], n * 3); n++;
    },
    end() { g.instanceCount = n; for (const a of [pos, col, shape, vel]) { a.needsUpdate = true; a.clearUpdateRanges?.(); a.addUpdateRange?.(0, n * a.itemSize); } return n; },
    dispose() { g.dispose(); material.dispose(); mesh.removeFromParent(); },
  };
}

// --------------------------------------------------------------------------------------------- materials
// Wing ruffle: the feathers shiver when the bow looses and stir in a faint breeze, more toward the tips.
function ruffle(material, uniforms) {
  material.onBeforeCompile = shader => {
    shader.uniforms.uSbRuffle = uniforms.ruffle; shader.uniforms.uSbTime = uniforms.time;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uSbRuffle; uniform float uSbTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      { float reach = smoothstep(.12, .55, abs(transformed.x));
        float wave = sin(uSbTime * 47.0 + transformed.x * 38.0 + transformed.y * 21.0) * uSbRuffle * .007
                   + sin(uSbTime * 2.3 + transformed.x * 7.0 + transformed.y * 5.0) * .0011;
        transformed.z += wave * reach; transformed.y += wave * .45 * reach; }`);
  };
  material.customProgramCacheKey = () => 'siegebird-ruffle';
}

function upgrade(material, quality) {
  // Desktop: lacquered enamel feathers with an oil-slick iridescence, coated gilt, oiled walnut, blued steel sheen.
  if (quality !== 'high' || !material?.isMeshStandardMaterial || material.isMeshPhysicalMaterial) return material;
  const n = material.name;
  const spec = /SB_Feather$/.test(n) ? {clearcoat: .55, clearcoatRoughness: .18, iridescence: .35, iridescenceIOR: 1.35, iridescenceThicknessRange: [180, 520], sheen: .12, sheenColor: new THREE.Color(0x9fe6ff), sheenRoughness: .4}
    : /SB_Gilt$/.test(n) ? {clearcoat: .6, clearcoatRoughness: .05}
    : /SB_(Walnut|Heartwood)$/.test(n) ? {clearcoat: .22, clearcoatRoughness: .3}
    : /SB_Steel$/.test(n) ? {clearcoat: .3, clearcoatRoughness: .12, iridescence: .25, iridescenceIOR: 1.6, iridescenceThicknessRange: [250, 420]}
    : /SB_Kingfisher$/.test(n) ? {clearcoat: .8, clearcoatRoughness: .06}
    : null;
  if (!spec) return material;
  const p = new THREE.MeshPhysicalMaterial(); THREE.MeshStandardMaterial.prototype.copy.call(p, material);
  p.name = n; Object.assign(p, spec); p.userData.siegebirdUpgraded = true;
  return p;
}

// --------------------------------------------------------------------------------------------- the layer
export function createSiegebirdShowpiece({scene, camera, quality = 'high', sunDirection = null, localId = () => null, ownerFletch = () => -1} = {}) {
  const phone = quality !== 'high';
  const lightDraw = particleDraw(Math.round(SHOWPIECE.particles.light * (phone ? PHONE_SCALE : 1)), true);
  const featherDraw = particleDraw(Math.round(SHOWPIECE.particles.feathers * (phone ? PHONE_SCALE : 1)), false);
  scene.add(lightDraw.mesh, featherDraw.mesh);
  const light = new THREE.PointLight(SHOWPIECE.light.color, 0, SHOWPIECE.light.distance, 2);
  light.name = 'SiegebirdCallingLight'; light.castShadow = false; light.userData.ignoreContact = true; scene.add(light);
  const upgraded = new Map();   // shared physical upgrades per source material
  const sun = new THREE.Vector3(-3, 5, 2).normalize();
  const particles = [];          // live simulated particles (pooled objects)
  const pool = [];
  const rigs = new Set();
  const flash = {at: new THREE.Vector3(), age: Infinity, life: 1, intensity: 0, distance: 1, color: new THREE.Color()};
  const stats = {particles: 0, glints: 0, light: 0, dressed: 0};
  let clock = 0;

  function spawn(kind, x, y, z, vx, vy, vz, life, size, color, alpha = 1, extra = {}) {
    const max = (phone ? PHONE_SCALE : 1) * (SHOWPIECE.particles.light + SHOWPIECE.particles.feathers);
    if (particles.length >= max) return null;
    const p = pool.pop() || {pos: new THREE.Vector3(), vel: new THREE.Vector3(), color: new THREE.Color()};
    p.kind = kind; p.pos.set(x, y, z); p.vel.set(vx, vy, vz); p.age = 0; p.life = life; p.size = size; p.color.set(color); p.alpha = alpha;
    p.drag = extra.drag ?? 1.5; p.gravity = extra.gravity ?? 0; p.grow = extra.grow ?? 0; p.rot = extra.rot ?? rand(0, 6.28); p.spinRate = extra.spinRate ?? rand(-3, 3);
    p.spin = rand(0, 6.28); p.sway = extra.sway ?? 0; p.stretch = extra.stretch ?? 0; p.shape = extra.shape ?? 0; p.hot = extra.hot ?? 0;
    particles.push(p); return p;
  }

  // ------------------------------------------------------------------------------------------- dressing
  function dress(visual) {
    if (!visual || visual.userData.siegebirdShowpiece) return visual.userData.siegebirdShowpiece;
    const body = visual.getObjectByName('Body'); if (!body) return null;
    const uniforms = {ruffle: {value: 0}, time: {value: 0}};
    const rig = {visual, uniforms, stones: [], stoneMats: [], glassMats: [], charge: 1, shown: 1, flare: 0, lastWound: null, lastClicks: 0, lastHeld: -9,
      fired: -Infinity, golden: false, glints: [], tips: [], native: body.parent, motesAt: 0, inspect: 0};
    const wings = visual.getObjectByName('Wings');
    visual.traverse(o => {
      if (!o.isMesh) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      const next = list.map(m => {
        if (!m) return m;
        if (m.name === 'SB_CallingStone') { const c = new THREE.MeshStandardMaterial({name: 'SB_CallingStone', color: 0x0d3a9a, roughness: .08, metalness: .2, emissive: new THREE.Color(SHOWPIECE.stone.color), flatShading: true}); rig.stoneMats.push(c); return c; }
        if (m.name === 'SB_StoneGlass') {
          const c = new THREE.MeshPhysicalMaterial({name: 'SB_StoneGlass', color: 0x6fb6ff, roughness: .0, metalness: 0, transparent: true, opacity: .2, depthWrite: false, flatShading: true,
            emissive: new THREE.Color(SHOWPIECE.stone.color), emissiveIntensity: .15, ...(phone ? {} : {clearcoat: 1, clearcoatRoughness: 0, iridescence: .8, iridescenceIOR: 1.8, specularIntensity: 1, ior: 2.1})});
          rig.glassMats.push(c); return c;
        }
        let u = upgraded.get(m); if (!u) { u = upgrade(m, quality); upgraded.set(m, u); }
        let inWings = false; for (let p = o; p; p = p.parent) if (p === wings) { inWings = true; break; }
        if (inWings && /SB_(Feather|Gilt|Iron)$/.test(m.name)) { const c = u.clone(); ruffle(c, uniforms); return c; }
        return u;
      });
      o.material = Array.isArray(o.material) ? next : next[0];
    });
    for (const nm of ['CallingStone_L', 'CallingStone_R', 'CallingStone_Heart']) { const n = visual.getObjectByName(nm); if (n) rig.stones.push(n); }
    // Glints: points on polished parts that catch the sun (native position, surface normal).
    rig.glints = [[0, 1.112, .142, 0, .5, -.2], [0, .9, .29, 0, 0, 1], [0, .425, .277, 0, -.3, 1], [.0, .272, -.192, 0, -.2, -1], [0, 1.03, .197, 0, .3, 1]]
      .map(a => ({p: new THREE.Vector3(a[0], a[1], a[2]), n: new THREE.Vector3(a[3], a[4], a[5]).normalize(), seed: Math.random() * 10}));
    for (const s of rig.stones) rig.glints.push({p: s.position.clone().add(new THREE.Vector3(0, -.004, .012)), n: new THREE.Vector3(s.position.x > 0 ? .4 : -.4, 0, 1).normalize(), seed: Math.random() * 10, stone: true});
    // Wing tips: the outermost vertex of each wing (shed down on the shot, catch glints along the gilt edge).
    if (wings) {
      let best = [null, null];
      wings.traverse(o => { if (!o.isMesh) return; const a = o.geometry.attributes.position; for (let i = 0; i < a.count; i += 3) { const x = a.getX(i); const k = x > 0 ? 1 : 0; if (!best[k] || Math.abs(x) > Math.abs(best[k].x)) best[k] = new THREE.Vector3(x, a.getY(i), a.getZ(i)); } });
      rig.tips = best.filter(Boolean);
      for (const t of rig.tips) rig.glints.push({p: t.clone().multiplyScalar(.93).setZ(t.z + .02), n: new THREE.Vector3(Math.sign(t.x) * .3, -.2, 1).normalize(), seed: Math.random() * 10});
    }
    visual.userData.siegebirdShowpiece = rig; rigs.add(rig); stats.dressed++;
    return rig;
  }

  const nativeToWorld = (rig, p, out) => out.copy(p).applyMatrix4(rig.native.matrixWorld);
  const nativeDir = (rig, d, out) => out.copy(d).transformDirection(rig.native.matrixWorld);

  // ------------------------------------------------------------------------------------------- events
  // The trigger broke: the stones' charge runs down the rail into the bolt, a flash at the beak, sparks, the
  // wings shiver and shed down. golden: the golden bird's bolt.
  let pendingFletch = null;   // the plumage that fletched the local bolt just loosed, until its projectile appears
  function fired(visual, {golden = false, fletch = -1} = {}) {
    pendingFletch = {plumage: fletch, golden, at: clock};
    const rig = dress(visual); if (!rig) return;
    rig.fired = clock; rig.golden = golden; rig.uniforms.ruffle.value = 1;
    rig.native.updateWorldMatrix(true, false);
    const col = golden ? SHOWPIECE.stone.golden : SHOWPIECE.stone.hot;
    const m = nativeToWorld(rig, _v.fromArray(SHOWPIECE.muzzle), new THREE.Vector3()), fwd = nativeDir(rig, _n.set(0, 1, 0), new THREE.Vector3());
    const right = nativeDir(rig, _n.set(1, 0, 0), new THREE.Vector3()), up = nativeDir(rig, _n.set(0, 0, 1), new THREE.Vector3());
    spawn('flash', m.x, m.y, m.z, fwd.x * 2, fwd.y * 2, fwd.z * 2, .11, golden ? .55 : .38, col, 1, {grow: 3, drag: 6});
    spawn('ring', m.x + fwd.x * .05, m.y + fwd.y * .05, m.z + fwd.z * .05, fwd.x * 3, fwd.y * 3, fwd.z * 3, .2, .1, golden ? 0xffd27a : 0x9fd8ff, .9, {grow: 9, drag: 5, shape: 1});
    const sparks = golden ? 26 : 14;
    for (let i = 0; i < sparks; i++) {
      const a = rand(0, 6.28), s = rand(.05, .45), sp = rand(4, 11);
      _w.copy(fwd).addScaledVector(right, Math.cos(a) * s).addScaledVector(up, Math.sin(a) * s).normalize().multiplyScalar(sp);
      spawn('spark', m.x, m.y, m.z, _w.x, _w.y, _w.z, rand(.12, .28), rand(.012, .022), i % 3 ? col : SHOWPIECE.stone.color, 1, {shape: 3, stretch: 5, drag: 5, gravity: golden ? 1 : 3});
    }
    // The charge runs from the stones down the rail to the beak.
    for (let i = 0; i < 8; i++) {
      const t = i / 7; _v.set(0, lerp(.86, 1.08, t), .19);
      nativeToWorld(rig, _v, _w);
      spawn('mote', _w.x, _w.y, _w.z, fwd.x * 6, fwd.y * 6, fwd.z * 6, .09 + .02 * i, .05, col, .9, {drag: 9});
    }
    // A little down shakes loose from each wing tip.
    for (const tip of rig.tips) for (let k = 0; k < (golden ? 3 : 2); k++) {
      nativeToWorld(rig, _v.copy(tip).multiplyScalar(rand(.7, .95)), _w);
      const pl = SIEGEBIRD_PLUMAGES[(k + (tip.x > 0 ? 0 : 3)) % 6].palette;
      spawn('feather', _w.x, _w.y, _w.z, up.x * rand(.2, .6) + right.x * Math.sign(tip.x) * rand(.2, .6), up.y * rand(.2, .6) + .3, up.z * rand(.2, .6), rand(1.6, 2.4),
        rand(.028, .04), golden ? 0xffd27a : '#' + (k ? pl[2] : 'eef6ff'), 1, {gravity: .55, drag: 2.4, sway: rand(1.5, 2.5), spinRate: rand(-5, 5)});
    }
    flashLight(m, golden ? SHOWPIECE.light.golden : SHOWPIECE.light.color, SHOWPIECE.light.fire * (golden ? 1.6 : 1), SHOWPIECE.light.fireDistance, SHOWPIECE.light.fireSeconds);
  }

  function flashLight(at, color, intensity, distance, seconds) {
    flash.at.copy(at); flash.age = 0; flash.life = seconds; flash.intensity = intensity; flash.distance = distance; flash.color.set(color);
  }

  // A Siegebird bolt landed. plumage: the bird whose feather fletched it (-1 plain); golden: the golden bolt.
  function impact(position, normal = [0, 1, 0], {plumage = -1, golden = false, material = 'stone'} = {}) {
    const p = _v.fromArray(position), n = _n.fromArray(normal).normalize();
    const pal = plumage >= 0 ? SIEGEBIRD_PLUMAGES[plumage % 6].palette : ['dfe8f0', 'c9d4dc', 'eef3f7'];
    const tone = golden ? 0xffcf5a : SHOWPIECE.stone.color;
    // Two staggered rings (the second rides out behind the first) and a hot flash at the point of contact.
    // Camera-facing rings would slice into the wall at a glancing view: lift them off the surface toward the eye.
    if (camera) { camera.getWorldPosition(_c3); _c3.sub(p); const d = _c3.length(); _c3.multiplyScalar(d > 1e-3 ? Math.min(.35, d * .25) / d : 0).addScaledVector(n, .03); }
    else _c3.copy(n).multiplyScalar(.03);
    const rx = p.x + _c3.x, ry = p.y + _c3.y, rz = p.z + _c3.z;
    spawn('ring', rx, ry, rz, 0, 0, 0, .34, .1, golden ? 0xffe0a0 : 0xa8dcff, .95, {grow: golden ? 14 : 10, drag: 0, shape: 1});
    spawn('ring', rx, ry, rz, 0, 0, 0, .5, .05, golden ? 0xffd27a : 0x7fc4ff, .6, {grow: golden ? 9 : 6, drag: 0, shape: 1});
    spawn('flash', rx, ry, rz, 0, 0, 0, .14, golden ? 1.1 : .7, golden ? 0xffe6b0 : 0xcfeaff, 1, {grow: 2.5});
    const feathers = phone ? (golden ? 9 : 6) : golden ? 16 : 10;
    for (let i = 0; i < feathers; i++) {
      _w.set(rand(-1, 1), rand(-.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(.6, 1.7)).addScaledVector(n, 1.1);
      spawn('feather', p.x + n.x * .04, p.y + n.y * .04, p.z + n.z * .04, _w.x, _w.y + .5, _w.z, rand(1.8, 2.8), rand(.05, .08),
        golden ? (i % 2 ? 0xffd36a : 0xfff0c0) : '#' + pal[[0, 1, 2, 0, 3, 1][i % 6]], 1, {gravity: .5, drag: 2.2, sway: rand(1.6, 2.8), spinRate: rand(-6, 6)});
    }
    const motes = golden ? 26 : 14;
    for (let i = 0; i < motes; i++) {
      _w.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(.6, golden ? 4.5 : 2.4)).addScaledVector(n, 1.2);
      spawn(golden && i % 2 ? 'glitter' : 'mote', p.x, p.y, p.z, _w.x, _w.y, _w.z, rand(.35, .8), golden ? rand(.035, .065) : rand(.03, .05), tone, .95,
        {drag: 2.6, gravity: golden ? 1.2 : -.2, shape: golden && i % 2 ? 2 : 0});
    }
    if (golden || material === 'stone' || material === 'metal') for (let i = 0; i < (golden ? 16 : 6); i++) {
      _w.set(rand(-1, 1), rand(-.3, 1), rand(-1, 1)).normalize().multiplyScalar(rand(3, 8)).addScaledVector(n, 2);
      spawn('spark', p.x, p.y, p.z, _w.x, _w.y, _w.z, rand(.14, .3), .014, golden ? 0xffe2a0 : 0xfff2dc, 1, {shape: 3, stretch: 4, drag: 4, gravity: 6});
    }
    flashLight(p, golden ? SHOWPIECE.light.golden : SHOWPIECE.light.color, golden ? SHOWPIECE.light.impactGolden : SHOWPIECE.light.impact, SHOWPIECE.light.impactDistance, SHOWPIECE.light.impactSeconds);
  }

  // ------------------------------------------------------------------------------------------- bolt flight
  // Each frame: the live Siegebird bolts (kind 'bolt', not heavy) and where they are drawn. Sheds motes along the
  // path (golden: gold glitter) and, now and then, a wisp of down in the fletching colour.
  const flights = new Map(); let flightFrame = 0;
  function trails(projectiles, positionOf, dt) {
    flightFrame++;
    let n = 0;
    for (const data of projectiles || []) {
      if (data.kind !== 'bolt' || data.heavy || n >= SHOWPIECE.trail.max) continue;
      n++;
      const f = record(data.id, data.ownerId, !!data.golden);
      f.frame = flightFrame;
      const at = positionOf(data); if (!at) continue;
      if (!f.has) { f.last.copy(at); f.has = true; }
      f.emit += dt; f.feather += dt;
      const every = SHOWPIECE.trail.every * (phone ? 2 : 1);
      let k = 0;
      while (f.emit >= every && k < 4) {
        f.emit -= every; k++;
        const u = Math.random(); _v.lerpVectors(f.last, at, u);
        spawn(f.golden && Math.random() < .5 ? 'glitter' : 'mote', _v.x + rand(-.02, .02), _v.y + rand(-.02, .02), _v.z + rand(-.02, .02), rand(-.15, .15), rand(-.05, .25), rand(-.15, .15),
          f.golden ? rand(.35, .7) : rand(.25, .45), f.golden ? rand(.035, .055) : rand(.03, .05), f.golden ? 0xffcf5a : 0x8ccfff, f.golden ? .95 : .8, {drag: 1, shape: f.golden && Math.random() < .5 ? 2 : 0});
      }
      if (f.feather > SHOWPIECE.trail.featherEvery * (phone ? 2 : 1)) {
        f.feather = 0;
        const pal = f.plumage >= 0 ? SIEGEBIRD_PLUMAGES[f.plumage % 6].palette : null;
        spawn('feather', at.x, at.y, at.z, rand(-.3, .3), rand(0, .4), rand(-.3, .3), rand(1.2, 1.8), rand(.03, .045), f.golden ? 0xffe4a0 : pal ? '#' + pal[0] : 0xe8eef4, .95,
          {gravity: .35, drag: 3, sway: rand(1.5, 2.5)});
      }
      f.last.copy(at);
    }
    for (const [id, f] of flights) if (flightFrame - f.frame > 240) flights.delete(id);   // landed a while ago
  }
  // A bolt seen for the first time: whose feather fletched it. The local player's comes from the bird that seated it;
  // another player's from their reload count (ownerFletch).
  function record(id, owner, golden = false) {
    let f = flights.get(id); if (f) return f;
    let plumage = -1;
    if (owner && owner === localId() && pendingFletch && clock - pendingFletch.at < 1.5) { plumage = pendingFletch.plumage; golden = golden || pendingFletch.golden; pendingFletch = null; }
    else if (owner) plumage = ownerFletch(owner);
    f = {emit: 0, feather: rand(0, .1), golden, owner, plumage, last: new THREE.Vector3(), has: false, frame: flightFrame, pierces: 0};
    flights.set(id, f); return f;
  }
  function fletchFor(id, owner = null) { const f = flights.get(id) || (owner ? record(id, owner) : null); return f ? f.plumage : -1; }
  function flight(id) { return flights.get(id) || null; }
  // embed / pierce events: a tracked Siegebird bolt landed (a pierce passes through: smaller puff, it flies on).
  function landed(event) {
    const f = flights.get(event.id); if (!f) return false;
    if (event.kind === 'pierce' && f.pierces++ > 2) return false;
    impact(event.position, event.normal || [0, 1, 0], {plumage: f.plumage, golden: !!event.golden || f.golden, material: event.material || 'stone'});
    return true;
  }

  // ------------------------------------------------------------------------------------------- per frame
  function updateRig(rig, dt, {reload = Infinity, golden = false, night = 0, aiming = false, inspecting = false} = {}) {
    rig.uniforms.time.value = clock; rig.uniforms.ruffle.value *= Math.exp(-dt * 5.5);
    const m = siegebirdMechanism(reload), wound = THREE.MathUtils.clamp(m.wound - SIEGEBIRD_WINCH.baseWraps, 0, 1);
    const since = clock - rig.fired;
    // Charge: drained by the shot, rings up click by click with the wind, flares at the latch.
    const clicks = Math.floor(wound * SIEGEBIRD_WINCH.ratchetTeeth);
    const winding = Number.isFinite(reload) && reload > 0 && wound < 1;
    let target = !Number.isFinite(reload) || wound >= 1 ? 1 : Math.max(0, wound * .85);
    if (since < .12) target = 0;
    rig.charge += (target - rig.charge) * Math.min(1, dt * (target < rig.charge ? 30 : 9));
    rig.native.updateWorldMatrix(true, false);
    if (rig.lastWound !== null && winding && clicks > rig.lastClicks) {
      // Each ratchet click rings the stones: a mote leaps off each one.
      rig.flare = Math.max(rig.flare, .5);
      for (const s of rig.stones) { nativeToWorld(rig, s.position, _w); nativeDir(rig, _n.set(Math.sign(s.position.x) * .3, .1, 1), _v);
        spawn('mote', _w.x, _w.y, _w.z, _v.x * .35, _v.y * .35 + .1, _v.z * .35, .45, .022, golden ? SHOWPIECE.stone.golden : SHOWPIECE.stone.color, .9, {drag: 1.8}); }
    }
    if (rig.lastWound !== null && rig.lastWound < 1 && wound >= 1 && Number.isFinite(reload)) {
      // The latch: the stones ring out.
      rig.flare = 1;
      for (const s of rig.stones) { nativeToWorld(rig, s.position, _w);
        spawn('ring', _w.x, _w.y, _w.z, 0, 0, 0, .35, .02, golden ? 0xffd27a : 0xbfe6ff, .9, {grow: .55, drag: 0, shape: 1}); }
    }
    rig.lastWound = wound; rig.lastClicks = winding ? clicks : 0;
    rig.flare *= Math.exp(-dt * 4);
    rig.inspect += ((inspecting ? 1 : 0) - rig.inspect) * Math.min(1, dt * 4);
    const S = SHOWPIECE.stone, breathe = 1 + S.breathe * Math.sin(clock * 2.4) + .04 * Math.sin(clock * 7.1);
    const level = (S.empty + (S.idle - S.empty) * rig.charge) * breathe + S.flare * rig.flare + .5 * rig.inspect + (aiming ? .25 : 0);
    rig.shown = level;
    _c.set(golden ? S.golden : S.color).lerp(_c2.set(golden ? 0xfff0c8 : S.hot), Math.min(1, rig.flare * .8));
    for (const mat of rig.stoneMats) { mat.emissive.copy(_c); mat.emissiveIntensity = .35 + level * .75; }
    for (const mat of rig.glassMats) { mat.emissive.copy(_c); mat.emissiveIntensity = .04 + .1 * level; }
    rig.golden = golden;
    // Idle wisps: now and then a mote drifts up off a stone (more while you admire it, or at night).
    rig.motesAt -= dt * (.6 + 2.5 * rig.inspect + 1.2 * night) * (phone ? .5 : 1);
    if (rig.motesAt <= 0 && rig.charge > .6 && rig.stones.length) {
      rig.motesAt = rand(.25, .7);
      const s = rig.stones[Math.random() < .5 ? 0 : rig.stones.length - 1]; nativeToWorld(rig, s.position, _w); nativeDir(rig, _n.set(0, 0, 1), _v);
      spawn('mote', _w.x, _w.y, _w.z, _v.x * .12 + rand(-.03, .03), _v.y * .12 + .05, _v.z * .12 + rand(-.03, .03), rand(.9, 1.5), rand(.009, .016), golden ? S.golden : S.color, .75, {drag: .6, gravity: -.04});
    }
    return level;
  }

  // Draw the per-crossbow halos and glints (rebuilt every frame from the current pose).
  function drawRig(rig, eye) {
    if (!shownInScene(rig.visual)) return;   // stashed, hidden or culled with its owner
    const S = SHOWPIECE.stone, col = _c.set(rig.golden ? S.golden : S.color);
    for (const s of rig.stones) {
      nativeToWorld(rig, s.position, _w); nativeDir(rig, _n.set(Math.sign(s.position.x) * .25, 0, 1), _v);
      _w.addScaledVector(_v, .006);
      const k = Math.min(2.2, rig.shown);
      lightDraw.push(_w.x, _w.y, _w.z, .05 + .03 * k, col.r, col.g, col.b, .28 * k, 0);
      lightDraw.push(_w.x, _w.y, _w.z, .016 + .006 * k, 1, 1, 1, .35 * Math.min(1, k), 0);
    }
    // Glints: a specular test against the sun per point; they twinkle as the bow sways in your hands.
    for (const g of rig.glints) {
      nativeToWorld(rig, g.p, _w); nativeDir(rig, g.n, _n);
      _v.copy(eye).sub(_w).normalize();                                   // to the eye
      const h = _v.add(sunDir()).normalize();
      let spec = Math.pow(Math.max(0, h.dot(_n)), 48) * 1.6 + .05 * Math.max(0, Math.sin(clock * 1.7 + g.seed)) ** 24;
      if (g.stone) spec += .25 * Math.min(1.5, rig.shown) * (.6 + .4 * Math.sin(clock * 3.1 + g.seed));
      spec += .6 * rig.inspect * Math.max(0, Math.sin(clock * 2.2 + g.seed * 3)) ** 16;
      if (spec < .02) continue;
      const tint = g.stone ? col : _c2.set(0xfff4dc);
      lightDraw.push(_w.x, _w.y, _w.z, .028 + .03 * Math.min(1, spec), tint.r, tint.g, tint.b, Math.min(1, spec), 2, clock * .2 + g.seed);
      stats.glints++;
    }
  }
  const sunDir = () => (sunDirection ? sunDirection(sun) || sun : sun);

  function stepParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.age += dt;
      if (p.age >= p.life) { particles[i] = particles[particles.length - 1]; particles.pop(); pool.push(p); continue; }
      const drag = Math.exp(-p.drag * dt);
      p.vel.multiplyScalar(drag); p.vel.y -= p.gravity * dt;
      if (p.kind === 'feather') {
        // Down falls with a side-to-side sway; it tumbles (spin) as it drifts.
        p.pos.x += Math.cos(p.age * p.sway * 2) * dt * .25; p.pos.z += Math.sin(p.age * p.sway * 2.3) * dt * .18;
        p.vel.y = Math.max(p.vel.y, -.45);
      }
      p.pos.addScaledVector(p.vel, dt); p.rot += p.spinRate * dt; p.spin += dt * (p.kind === 'feather' ? 4 : 0);
    }
  }
  function drawParticles() {
    for (const p of particles) {
      const u = p.age / p.life, fade = p.kind === 'feather' ? Math.min(1, (1 - u) * 3) * Math.min(1, p.age * 12) : (1 - u) * (1 - u) * Math.min(1, p.age * 40 + .4);
      const size = p.size * (1 + p.grow * u);
      if (p.kind === 'feather') featherDraw.push(p.pos.x, p.pos.y, p.pos.z, size, p.color.r, p.color.g, p.color.b, p.alpha * fade, 4, p.rot, 0, p.spin);
      else if (p.kind === 'spark') lightDraw.push(p.pos.x, p.pos.y, p.pos.z, size, p.color.r, p.color.g, p.color.b, p.alpha * fade, 3, 0, p.stretch, 0, p.vel.x, p.vel.y, p.vel.z);
      else lightDraw.push(p.pos.x, p.pos.y, p.pos.z, size, p.color.r, p.color.g, p.color.b, p.alpha * fade, p.kind === 'ring' ? 1 : p.kind === 'glitter' ? 2 : 0, p.rot);
    }
  }

  function shownInScene(object) { for (let o = object; o; o = o.parent) if (!o.visible) return false; return true; }
  function wake(rig, golden) {
    rig.flare = 1; rig.uniforms.ruffle.value = Math.max(rig.uniforms.ruffle.value, .7);
    rig.native.updateWorldMatrix(true, false);
    for (const s of rig.stones) {
      nativeToWorld(rig, s.position, _w);
      spawn('ring', _w.x, _w.y, _w.z, 0, 0, 0, .4, .02, golden ? 0xffd27a : 0xbfe6ff, .85, {grow: .8, drag: 0, shape: 1});
      for (let i = 0; i < (phone ? 2 : 4); i++) { nativeDir(rig, _n.set(rand(-.6, .6), rand(-.3, .3), 1), _v);
        spawn('mote', _w.x, _w.y, _w.z, _v.x * .3, _v.y * .3 + .08, _v.z * .3, rand(.5, .9), rand(.012, .02), golden ? SHOWPIECE.stone.golden : SHOWPIECE.stone.color, .9, {drag: 1.5}); }
    }
  }
  // visual: the local crossbow when held (or null); remote crossbows can be passed through updateRemote.
  const eye = new THREE.Vector3();
  let local = null, localState = null;
  function update(dt, now, state = {}) {
    dt = Math.min(.05, Math.max(0, dt)); clock += dt;
    stats.glints = 0;
    lightDraw.begin(); featherDraw.begin();
    stepParticles(dt);
    camera?.getWorldPosition(eye);
    local = state.visual ? dress(state.visual) : null; localState = state;
    if (local) {
      // Drawn from the stash (or first taken up): the stones wake and the wings settle their feathers.
      const held = shownInScene(local.visual);
      if (held && clock - local.lastHeld > .4) wake(local, !!state.golden);
      if (held) local.lastHeld = clock;
      updateRig(local, dt, state); drawRig(local, eye);
    }
    for (const rig of rigs) {
      if (rig === local) continue;
      if (!rig.visual.parent) { rigs.delete(rig); continue; }
      if (!(clock - (rig.remoteSeen ?? -1) <= .1)) continue;
      drawRig(rig, eye);
    }
    drawParticles();
    stats.particles = particles.length;
    lightDraw.end(); featherDraw.end();
    // Light: a flash wins; otherwise the local stones' glow (night only on phones).
    flash.age += dt;
    const night = state.night ?? 0;
    if (flash.age < flash.life) {
      const k = 1 - flash.age / flash.life;
      light.position.copy(flash.at); light.color.copy(flash.color); light.intensity = flash.intensity * k * k * (.6 + .4 * night + .4); light.distance = flash.distance;
    } else if (local && local.stones.length && !(phone && night < .3)) {
      nativeToWorld(local, _v.set(0, .86, .2), light.position);
      light.color.set(local.golden ? SHOWPIECE.light.golden : SHOWPIECE.light.color);
      light.intensity = (SHOWPIECE.light.idle.day + (SHOWPIECE.light.idle.night - SHOWPIECE.light.idle.day) * night) * Math.min(2, local.shown) * .6;
      light.distance = SHOWPIECE.light.distance;
    } else light.intensity = 0;
    stats.light = light.intensity;
  }
  // Remote crossbows: drive their stones from their reload clock; drawn halos only (no particles but their shot).
  function updateRemote(visual, dt, {reload = Infinity, golden = false} = {}) {
    const rig = dress(visual); if (!rig) return;
    rig.remoteSeen = clock; updateRig(rig, dt, {reload, golden});
  }

  function dispose() {
    lightDraw.dispose(); featherDraw.dispose(); light.removeFromParent(); light.dispose?.();
    for (const rig of rigs) { for (const m of [...rig.stoneMats, ...rig.glassMats]) m.dispose(); }
    rigs.clear(); particles.length = 0;
  }
  return {dress, update, updateRemote, fired, impact, landed, trails, fletchFor, flight, dispose, stats, light,
    objects: [lightDraw.mesh, featherDraw.mesh]};
}
const lerp = (a, b, t) => a + (b - a) * t;
