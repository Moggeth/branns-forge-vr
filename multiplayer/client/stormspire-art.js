// Stormspire presentation: the authored tower and reel pack (assets-source/stormspire-tower), lit by the tower's charge,
// and every reel pack's motion (worn, hanging on its hook or lying by a planted crossbow).
// Reads authoritative structure data only (charge 0..240, operator, arc); writes nothing back.
//
// Charge drives light, all from the presentation clock (never the snapshot tick): the glass column fills, a glow climbs
// the Tesla coil turn by turn with pulses running up it, the gold stars on the felt hat twinkle brighter, the windows
// glow warmer, and once it is full the copper torus brim crackles and arcs leap to the hat-tip crystal. While a circuit
// runs the whole tower works harder. Small shader patches (fresnel glass and crystals, coil glow, star twinkle) share
// one program per material across towers; each tower keeps its own uniforms. No lights, no transmission: Quest-safe.
//
// Reel packs: every pack instance passes through tintPack, which registers it here. Each frame its `Sway` node swings
// with inertia (a damped pendulum driven by the wearer's acceleration, turning and footfalls; a hanging pack swings on
// its hook and settles), its `Crank` turns with the drum, its ratchet `Pawl` clicks over the teeth, the wound cable on
// the drum shrinks as cable pays out (stormreel-view sets Reel.rotation.x from the paid-out length) and its lamp pulses.
import * as THREE from 'three';
import {STORMREEL} from '../shared/stormreel.js';
import {createLizardCrew} from './stormspire-lizards.js';
import {POLE,MIXED_HUE,glyphTexture,coronaTexture,makeSprite,flicker} from './stormreel-look.js';

const GLOW_NAMES = ['Charge', 'CrystalCore', 'Crystal', 'Window'];
const OWN_NAMES = [...GLOW_NAMES, 'Coil', 'Hat', 'Glass'];   // cloned per tower (their uniforms follow that tower's charge)
const CALM = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;   // reduced motion and flash
const damp = (k, dt) => 1 - Math.exp(-k * dt);

// ---- shader patches -------------------------------------------------------------------------------------------------
const HASH = 'float ssHash(float n){return fract(sin(n)*43758.5453);}';
const PATCH = {
  // UV1.x runs 0 (bottom) .. ~.96 (top) along the coil and its leads, 1 on the torus brim (UV1.y = angle round it).
  Coil: {vert: true, frag: `
    float ssU = vSsP.x, ssBrim = step(.995, ssU);
    float ssLit = smoothstep(uSsFill + .015, uSsFill - .015, ssU) * step(.01, uSsFill);
    float ssFlow = pow(.5 + .5 * sin(ssU * 34.0 - uSsTime * (1.6 + 5.0 * uSsWork)), 14.0);
    float ssFront = exp(-abs(ssU - uSsFill) * 30.0) * step(.01, uSsFill) * (1.0 - ssBrim);
    vec3 ssCyan = vec3(.06, .5, 1.0);
    totalEmissiveRadiance += ssCyan * (1.0 - ssBrim) * (ssLit * (.03 + .55 * ssFlow * (.3 + .7 * uSsWork) + .5 * uSsFlash) + ssFront * .6);
    float ssCell = floor(vSsP.y * 40.0), ssT = floor(uSsTime * (8.0 + 12.0 * uSsWork));
    float ssSpark = step(.9 - .25 * uSsWork - .15 * uSsFlash, ssHash(ssCell * 12.9898 + ssT * 78.233));
    float ssFull = smoothstep(.6, 1.0, uSsFill);
    totalEmissiveRadiance += ssCyan * ssBrim * (ssFull * (.06 + .9 * ssSpark * uSsCrackle) + .6 * uSsFlash + uSsWork * (.25 + .9 * ssSpark * uSsCrackle));`},
  // Gold stars and moons on the felt (bright, warm, low blue in the atlas) twinkle with the charge.
  Hat: {frag: `
    vec3 ssC = diffuseColor.rgb;
    float ssStar = smoothstep(.10, .28, (ssC.r + ssC.g) * .5 - ssC.b);
    vec2 ssCellP = floor(vMapUv * vec2(48.0, 220.0));
    float ssTw = .55 + .45 * sin(uSsTime * (1.2 + 2.2 * ssHash(dot(ssCellP, vec2(12.9898, 78.233)))) + ssCellP.x * 1.7);
    totalEmissiveRadiance += ssC * ssStar * (.06 + (.45 * uSsFill + .6 * uSsFlash + .3 * uSsWork) * mix(1.0, ssTw, uSsCrackle));`},
  Glass: {frag: `
    float ssFr = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.4);
    totalEmissiveRadiance += vec3(.42, .85, 1.0) * ssFr * (.18 + .7 * uSsFill + .9 * uSsFlash + .4 * uSsWork);
    diffuseColor.a = clamp(diffuseColor.a + ssFr * .45, 0.0, 1.0);`},
  Crystal: {frag: `
    float ssFr = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.0);
    totalEmissiveRadiance = totalEmissiveRadiance * (.6 + 1.3 * ssFr) + emissive * ssFr * .5;`},
  // The charge core: bands of light flow up it, faster while a circuit runs; its top (the fill line) burns brighter.
  Charge: {vert: 'pos', frag: `
    float ssB = .72 + .28 * sin(vSsY * 10.0 - uSsTime * (2.5 + 6.0 * uSsWork));
    float ssTop = smoothstep(uSsLen - .35, uSsLen - .05, vSsY);
    totalEmissiveRadiance = totalEmissiveRadiance * ssB + emissive * ssTop * 1.2;`},
};
PATCH.CrystalCore = PATCH.Crystal;
function patch(material, u) {
  const p = PATCH[material.name]; if (!p) return material;
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);
    if (p.vert === true) shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n#ifndef USE_UV1\nattribute vec2 uv1;\n#endif\nvarying vec2 vSsP;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvSsP = uv1;');
    if (p.vert === 'pos') shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vSsY;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvSsY = position.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${p.vert === true ? 'varying vec2 vSsP;' : p.vert === 'pos' ? 'varying float vSsY;' : ''}
uniform float uSsFill, uSsTime, uSsFlash, uSsWork, uSsCrackle, uSsLen;\n${HASH}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${p.frag}`);
  };
  material.customProgramCacheKey = () => `stormspire-${material.name}`;
  return material;
}
function sharpen(root) {   // grazing views of the shaft stay crisp
  root.traverse(n => { if (!n.isMesh) return; for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) if (n.material?.[k]) n.material[k].anisotropy = 4; });
}

// ---- reel packs -------------------------------------------------------------------------------------------------------
// The two packs: red (+) and blue (-). Their cable, windings, pole accents and lamp take the pack's colour.
export const PACK_COLORS = Object.freeze({red: 0xd8402e, blue: 0x2f74e0});
const tinted = new Map();
const packs = new Map();   // root -> motion state
let packClock = -1;
export function tintPack(root, pack) {
  root.traverse(n => {
    if (!n.isMesh) return;
    const m = n.material, lamp = n.name === 'Lamp_Glow' || n.parent?.name === 'Lamp_Glow';
    if (!m || !lamp && !['Cable', 'CeramicBlue'].includes(m.name)) return;
    const key = `${m.uuid}:${pack}:${lamp}`;
    if (!tinted.has(key)) {
      const c = m.clone(), hex = PACK_COLORS[pack];
      if (lamp) { c.emissive?.setHex(hex); c.color?.setHex(hex); c.userData.base = m.emissiveIntensity ?? 1; } else c.color?.setHex(m.name === 'Cable' ? hex : pack === 'red' ? 0xd8463a : 0x5d86c8);
      tinted.set(key, c);
    }
    n.material = lamp ? tinted.get(key).clone() : tinted.get(key);   // each lamp pulses on its own
  });
  registerPack(root);
  return root;
}
function registerPack(root) {
  const find = n => root.getObjectByName(n);
  const sway = find('Sway'), reel = find('Reel'), lampMesh = find('Lamp_Glow');
  const lamp = lampMesh?.isMesh ? lampMesh.material : lampMesh?.children.find(c => c.isMesh)?.material;
  packs.set(root, {sway, reel, wind: find('Reel_Windings'), crank: find('Crank'), pawl: find('Pawl'), lamp, rest: sway?.quaternion.clone(), restY: sway?.position.y ?? 0,
    p: new THREE.Vector3(), v: new THREE.Vector3(), yaw: 0, yawV: 0, init: false, ang: new THREE.Vector3(), angV: new THREE.Vector3(),
    phase: 0, spin: 0, reelPrev: 0, shown: false, idle: 0, seed: Math.random() * 100});
}
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _qe = new THREE.Quaternion(), _a = new THREE.Vector3();
function stepPack(root, st, time, dt) {
  const kind = root.name.startsWith('HangingReelPack') ? 'hang' : root.name.startsWith('PlantedPack') ? 'planted' : 'worn';
  const shown = root.visible && !!root.parent;
  // ---- the drum: crank geared 1:1, the ratchet pawl clicks over 12 teeth, windings shrink as cable pays out
  const rot = st.reel ? st.reel.rotation.x : 0;
  const spinRaw = (rot - st.reelPrev) / dt; st.reelPrev = rot;
  st.spin += ((Math.abs(spinRaw) < 200 ? spinRaw : st.spin) - st.spin) * damp(10, dt);
  if (st.crank) st.crank.rotation.x = rot;
  if (st.pawl) { const ph = ((rot * 12 / (Math.PI * 2)) % 1 + 1) % 1; st.pawl.rotation.x = -.32 * (rot <= 0 ? ph : 1 - ph); }
  if (st.wind) { const out = kind === 'worn' ? Math.min(1, Math.max(0, -rot / 1.8) / STORMREEL.cable) : 0, k = 1 - .4 * out; st.wind.scale.set(1, k, k); }
  if (st.lamp) st.lamp.emissiveIntensity = (st.lamp.userData.base ?? 1.6) * (.75 + .25 * Math.sin(time * 3.4 + st.seed) + Math.min(.9, Math.abs(st.spin) * .04));
  if (!st.sway || kind === 'planted') return;
  // ---- inertia: a damped pendulum about the carry handle
  root.matrixWorld.decompose(_p, _q, _s);
  _e.setFromQuaternion(_q, 'YXZ'); const yaw = _e.y;
  if (!st.init || st.p.distanceToSquared(_p) > 9 || (shown && !st.shown && kind === 'hang')) {
    if (st.init && kind === 'hang') st.angV.z += (Math.random() < .5 ? -1 : 1) * 1.8;   // just hung back up: it swings, then settles
    st.p.copy(_p); st.v.set(0, 0, 0); st.yaw = yaw; st.yawV = 0; st.init = true;
  }
  st.shown = shown;
  const vNew = _a.copy(_p).sub(st.p).divideScalar(dt); st.p.copy(_p);
  const acc = vNew.clone().sub(st.v).divideScalar(dt); st.v.lerp(vNew, damp(14, dt));
  if (acc.length() > 30) acc.setLength(30);
  let dy = yaw - st.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); st.yaw = yaw;
  const yawV = dy / dt, yawA = (yawV - st.yawV) / dt; st.yawV += (yawV - st.yawV) * damp(14, dt);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const ax = acc.x * c - acc.z * s, az = acc.x * s + acc.z * c;   // into the pack's frame (+Z behind the wearer)
  const amp = CALM ? .4 : 1;
  let w, z, fx, fz, fy;
  if (kind === 'worn') {
    w = 11; z = .32;
    const speed = Math.hypot(st.v.x, st.v.z), rate = Math.min(2.6, speed * .38);
    st.phase += Math.PI * 2 * rate * dt;
    const step = Math.min(1, speed / 5);
    fx = az * .45 + Math.sin(st.phase * 2) * 6 * step;   // pitch: forward acceleration leaves the bottom behind; footfalls jolt it
    fz = -ax * .45 + Math.sin(st.phase) * 4 * step - st.yawV * speed * .2;   // roll: sideways and turning loads
    fy = -yawA * .06;
    st.sway.position.y = st.restY - .008 * step * Math.abs(Math.sin(st.phase)) * amp;
  } else {   // hanging on its hook: a slow pendulum, a breath of wind
    w = 5.5; z = .07;
    fx = 0; fz = (Math.sin(time * .7 + st.seed) * Math.sin(time * 1.31 + st.seed * 2)) * .35; fy = 0;
  }
  for (let i = 0, n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n; i < n; i++) {
    st.angV.x += (-w * w * st.ang.x - 2 * z * w * st.angV.x + fx * amp) * h;
    st.angV.z += (-w * w * st.ang.z - 2 * z * w * st.angV.z + fz * amp) * h;
    st.angV.y += (-w * w * st.ang.y - 2 * .5 * w * st.angV.y + fy * amp) * h;
    st.ang.addScaledVector(st.angV, h);
  }
  if (kind === 'hang' && st.ang.x > 0) { st.ang.x = 0; st.angV.x = Math.min(0, st.angV.x); }   // a hanging pack cannot swing into the wall
  const soft = (x, l) => l * Math.tanh(x / l);   // straps and hooks stiffen smoothly, never a hard stop
  _e.set(soft(st.ang.x, .2), soft(st.ang.y, .12), soft(st.ang.z, .25), 'XYZ');
  st.sway.quaternion.copy(st.rest).multiply(_qe.setFromEuler(_e));
}
/** Steps every registered reel pack once per presentation frame (called from animate; safe to call more often). */
export function animatePacks(time, dt) {
  if (time === packClock) return; packClock = time;
  dt = Math.min(.05, Math.max(1e-4, dt));
  for (const [root, st] of packs) {
    if (!root.parent) { if ((st.idle += dt) > 5) packs.delete(root); continue; }
    st.idle = 0; stepPack(root, st, time, dt);
  }
}

export function createStormspireArt({lightning = null} = {}) {
  let tower = null, pack = null;
  const live = new Set(), v = new THREE.Vector3(), w = new THREE.Vector3();
  const glyphs = {red: glyphTexture('red'), blue: glyphTexture('blue')}, corona = coronaTexture(3);
  function install(gltf) { tower = gltf; sharpen(gltf.scene); for (const e of live) attach(e); }
  function installPack(gltf) { pack = gltf; sharpen(gltf.scene); for (const e of live) attachPack(e); }
  /** Per-tower glow and shader materials, so one tower's charge never lights another (two or three towers at most). */
  function ownMaterials(root, u) {
    const own = new Map(), glow = [];
    root.traverse(n => {
      if (!n.isMesh) return;
      const m = n.material; if (!m || !OWN_NAMES.includes(m.name)) return;
      if (!own.has(m)) { const c = patch(m.clone(), u); c.userData.base = m.emissiveIntensity ?? 1; own.set(m, c); glow.push(c); }
      n.material = own.get(m);
    });
    return glow;
  }
  function attach(e) {
    live.add(e);
    if (!tower || e.spire) return;
    const root = tower.scene.clone(true); root.name = 'Stormspire';
    root.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; n.userData.targetId = e.data.id; } });
    const nodes = {}; root.traverse(n => { if (n.name) nodes[n.name] = n; });
    const u = {uSsFill: {value: 0}, uSsTime: {value: 0}, uSsFlash: {value: 0}, uSsWork: {value: 0}, uSsCrackle: {value: CALM ? .3 : 1}, uSsLen: {value: 3}};
    const core = nodes.ChargeColumn_Core; if (core?.geometry) { core.geometry.computeBoundingBox(); u.uSsLen.value = core.geometry.boundingBox.max.y; }
    const glow = ownMaterials(root, u);
    for (const c of e.root.children) c.visible = false;   // the code-built stand-in
    e.root.add(root);
    e.spire = {root, nodes, glow, u, work: 0, shown: e.data.charge || 0, arcAt: 0, flash: 0, hang: {red: null, blue: null}, badges: {}, topAt: 0};
    // Polarity badges on the two cable terminals: red (+) on the east face, blue (-) on the west, so the poles read at a glance.
    for (const colour of ['red', 'blue']) {
      const node = nodes[colour === 'blue' ? 'CableTerminal_B' : 'CableTerminal']; if (!node) continue;
      const badge = new THREE.Sprite(new THREE.SpriteMaterial({map: glyphs[colour], transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false}));
      badge.position.set(0, .34, 0); badge.scale.setScalar(.3); badge.renderOrder = 15; badge.raycast = () => {}; node.add(badge);
      const flare = new THREE.Sprite(new THREE.SpriteMaterial({map: corona, color: POLE[colour].glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false}));
      flare.scale.setScalar(.6); flare.renderOrder = 14; flare.raycast = () => {}; node.add(flare); e.spire.badges[colour] = {badge, flare};
    }
    e.spire.crew = createLizardCrew(); root.add(e.spire.crew.group);
    attachPack(e);
  }
  function attachPack(e) {
    if (!pack || !e.spire) return;
    for (const colour of ['red', 'blue']) {
      const hook = e.spire.nodes[colour === 'blue' ? 'PackHook_B' : 'PackHook'];
      if (e.spire.hang[colour] || !hook) continue;
      const hang = pack.scene.clone(true); hang.name = `HangingReelPack_${colour}`; tintPack(hang, colour);
      hang.traverse(n => { if (n.isMesh) { n.castShadow = true; n.userData.targetId = e.data.id; } });
      // The pack's back faces the tower wall; its carry handle sits on the hook (east hook for red, west for blue).
      const hp = hang.getObjectByName('HangPoint');
      hang.rotation.y = colour === 'blue' ? -Math.PI / 2 : Math.PI / 2; hang.updateMatrixWorld(true);
      const off = hp ? hp.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
      hang.position.copy(hook.position).sub(off);
      e.spire.root.add(hang); e.spire.hang[colour] = hang;
    }
  }
  function detach(e) {
    live.delete(e); e.spire?.root.removeFromParent(); for (const m of e.spire?.glow || []) m.dispose();
    for (const {badge, flare} of Object.values(e.spire?.badges || {})) { badge.material.dispose(); flare.material.dispose(); }
    e.spire = null;
  }
  /** Where a cable leaves the tower, world space (falls back to the shared constant before the model loads). */
  function terminal(e, out = new THREE.Vector3(), colour = 'red') {
    const n = e.spire?.nodes[colour === 'blue' ? 'CableTerminal_B' : 'CableTerminal']; if (!n) return null;
    return n.getWorldPosition(out);
  }
  function hookPoint(e, out = new THREE.Vector3(), colour = 'red') { return e.spire?.nodes[colour === 'blue' ? 'PackHook_B' : 'PackHook']?.getWorldPosition(out) || null; }
  /** Presentation pulse when Crystal or a God's bolt charges it. */
  function charged(e, {lightning: fromSky = false} = {}) {
    if (!e.spire) return; e.spire.flash = 1; e.spire.crew?.cheer();
    const top = e.spire.nodes.Capacitor?.getWorldPosition(new THREE.Vector3()), hop = e.spire.nodes.Hopper?.getWorldPosition(new THREE.Vector3());
    if (!lightning || !top) return;
    if (fromSky) { lightning.glow(top, {size: 5, life: .6}); lightning.burst(top, {count: 40, speed: 6}); }
    else if (hop) {   // a little arc climbs from the hopper up the charge column
      const col = e.spire.nodes.ChargeColumn?.getWorldPosition(new THREE.Vector3());
      lightning.strike(hop, col || top, {life: .35, width: .05, branches: 1});
      lightning.burst(hop, {count: 14, speed: 2});
    }
  }
  function animate(e, time, dt) {
    const s = e.spire; if (!s) return;
    animatePacks(time, dt);
    const b = e.data, working = !!b.arc, target = Math.max(0, Math.min(1, (b.charge || 0) / STORMREEL.maxCharge));
    s.shown += (target * STORMREEL.maxCharge - s.shown) * Math.min(1, dt * 4);   // drains and fills smoothly between snapshots
    const fill = s.shown / STORMREEL.maxCharge;
    s.work += ((working ? 1 : 0) - s.work) * damp(working ? 6 : 2, dt);
    const core = s.nodes.ChargeColumn_Core; if (core) { core.scale.y = Math.max(.02, fill); core.visible = fill > .01; }
    s.flash = Math.max(0, s.flash - dt * 1.5);
    const u = s.u; u.uSsFill.value = fill; u.uSsTime.value = time % 1000; u.uSsFlash.value = s.flash * (CALM ? .4 : 1); u.uSsWork.value = s.work;
    const hum = .55 + .45 * Math.sin(time * 3.1) * Math.sin(time * 1.7 + 1);
    for (const m of s.glow) {
      const base = m.userData.base;
      if (m.name === 'CrystalCore') m.emissiveIntensity = base * (.25 + 1.4 * fill * (.8 + .2 * hum) + 2 * s.flash);
      else if (m.name === 'Crystal') m.emissiveIntensity = base * (.55 + .35 * hum + .8 * s.flash);
      else if (m.name === 'Charge') m.emissiveIntensity = base * (.55 + .3 * hum + 1.2 * s.flash + .9 * s.work);
      else if (m.name === 'Window') m.emissiveIntensity = base * (.35 + .75 * fill) * (CALM ? 1 : .93 + .07 * flicker(time * .6, 3));
    }
    if (s.nodes.Capacitor_Crystal) s.nodes.Capacitor_Crystal.rotation.y = time * (.4 + .8 * s.work);
    s.crew?.update(time, dt);
    // Terminal badges glow with the flow: faint at idle, hot while a pack is worn or the circuit runs.
    for (const [colour, {badge, flare}] of Object.entries(s.badges)) {
      const worn = !!b[colour === 'red' ? 'operator' : 'operator2'], k = (fill > .02 ? .35 : .12) + (worn ? .3 : 0) + (working ? .45 : 0) + .2 * s.flash;
      badge.material.opacity = Math.min(1, k + .12 * flicker(time, colour === 'red' ? 0 : 2)); flare.material.opacity = Math.min(1, (worn ? .35 : .12) + (working ? .6 : 0) + s.flash * .5);
      flare.scale.setScalar(.5 + .5 * flicker(time * 1.3, colour === 'red' ? 1 : 4) + (working ? .5 : 0)); flare.material.rotation = time * (colour === 'red' ? 1.5 : -1.5);
    }
    // While the circuit runs the whole tower works: streamers leap from the hat into the air and the capacitor roars.
    if (lightning && working && b.hp > 0) {
      s.topAt -= dt;
      if (s.topAt <= 0 && s.nodes.TopLoad) {
        s.topAt = (.09 + Math.random() * .16) * (CALM ? 3 : 1); s.nodes.TopLoad.getWorldPosition(v);
        const a = Math.random() * Math.PI * 2, r = 1.2 + Math.random() * 1.6;
        w.set(v.x + Math.cos(a) * r, v.y + .6 + Math.random() * 2.2, v.z + Math.sin(a) * r);
        lightning.strike(v.clone(), w.clone(), {life: .12, width: .05, rough: .2, depth: 4, branches: 1, restrikes: 1, intensity: 1.1, hue: MIXED_HUE});
      }
    }
    if (s.hang.red) s.hang.red.visible = !b.operator && !e.packAway?.red;
    if (s.hang.blue) s.hang.blue.visible = !b.operator2 && !e.packAway?.blue;
    // Full and idle: little arcs leap between the torus brim and the hat tip.
    if (lightning && fill > .66 && b.hp > 0) {
      s.arcAt -= dt;
      if (s.arcAt <= 0) {
        s.arcAt = (.5 + Math.random() * (2.4 - 1.6 * fill)) * (CALM ? 2.5 : 1);
        const top = s.nodes.TopLoad, cap = s.nodes.Capacitor;
        if (top && cap) {
          top.getWorldPosition(v); const a = Math.random() * Math.PI * 2;
          const yaw = e.root.rotation.y, r = 1.12;
          v.x += Math.cos(a + yaw) * r; v.z -= Math.sin(a + yaw) * r;
          cap.getWorldPosition(w);
          lightning.strike(v, w, {life: .18 + Math.random() * .12, width: .06, branches: 1, restrikes: 1, intensity: .8});
        }
      }
    }
  }
  return {install, installPack, ready: () => !!tower, attach, detach, animate, charged, terminal, hookPoint,
    packTemplate: () => pack, stats: () => ({towers: live.size, model: !!tower, pack: !!pack, packs: packs.size})};
}
