// Stormreel presentation: the cable from each Stormspire terminal to whoever wears its reel pack (or, once the pack is
// dropped, to the bolt it fired), the pack on remote Heroes' backs, every shot's bolt, filament and lightning, the lodged
// probes with their polarity badges, the live arc between a positive and a negative probe, the foes it cooks, and the
// reel that winds a bolt back in along its tether.
// Reads snapshots and authority events; never writes gameplay state. Everything visible updates every frame from
// predicted or interpolated positions (the local Hero's predicted body, remote Heroes' smoothed actors, probes riding the
// drawn body part they stuck in), never from the snapshot tick.
//
// Red is the positive (+) pole and blue the negative (-): current is drawn leaving the red terminal and returning to the
// blue one, as bright pulses running along each cable and filament and as carriers through the foe the circuit cooks
// (stormreel-circuit.js). The cable itself (and its snug wraps round tree trunks) is stormreel-cable.js. A crossbow its
// carrier planted stands spiked butt-first in the ground with its pack beside it, still wired up.
import * as THREE from 'three';
import {STORMREEL,PACKS,terminalPoint,hookPoint as sharedHook,cableStrain,cableWraps} from '../shared/stormreel.js';
import {worldTrees} from '../shared/world-content.js';
import {trunkRadius} from '../shared/trees.js';
import {PACK_COLORS,tintPack} from './stormspire-art.js';
import {POLE,finishCrossbow,softTexture,coronaTexture,glyphTexture,ribbonTexture,createRibbon,createBeads,makeSprite,along,flicker} from './stormreel-look.js';
import {createStormreelAudio} from './stormreel-audio.js';
import {createCableKit,CABLE} from './stormreel-cable.js';
import {createCircuitFx,ARC} from './stormreel-circuit.js';
export {CABLE};
const BACK = new THREE.Vector3(0, 1.28, .17);   // pack anchor behind the shoulder blades, actor-local (+Z is behind)
const BOLT_LEN = .33, BOLT_BURY = .1;            // the authored bolt: tail to nose, and how far a lodged one sinks in
const REEL = Object.freeze({minSeconds: .22, maxSeconds: .65, speed: 38});
const GLOW = {red: new THREE.Color(POLE.red.glow), blue: new THREE.Color(POLE.blue.glow)}, HOT = {red: new THREE.Color(POLE.red.hot), blue: new THREE.Color(POLE.blue.hot)};

/**
 * ctx:
 *   scene, lightning (lightning-fx), height(x,z), localId(), actorPose(id) -> {position:Vector3, yaw} | null,
 *   localPose() -> {position:Vector3, yaw}, localMuzzle(out) -> Vector3 | null, remoteMuzzle(id, out) -> Vector3 | null,
 *   remoteCrossbow(id) -> Object3D | null, probeAnchor(enemyId, part, out), bodyPoints(enemyId, outVectors) -> count,
 *   spireEntry(id) -> invention entry, spireArt (stormspire-art), audio() -> AudioContext | null, listener() -> ear pose | null,
 *   enemyVisual(id) -> Object3D | null, shake(amount, at), flash(amount), trees(snapshot) -> tree list   (the last four optional)
 */
export function createStormreelView(ctx) {
  const {scene, lightning} = ctx;
  let packTemplate = null, boltTemplate = null, bowTemplate = null, bowButt = null, snapshot = null, clock = 0, treesFor = null, treeMap = new Map();
  const cables = new Map(), packs = new Map(), bolts = [], homes = new Map(), wires = new Map(), reels = [], arcLoops = new Map();
  const probeMeshes = new Map(), pending = new Map(), hidden = new Map(), dirs = new Map();
  const v = new THREE.Vector3(), v2 = new THREE.Vector3(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), c3 = new THREE.Color();
  const kit = createCableKit({scene, height: ctx.height});
  // Rubber-jacketed cable: a deep pole colour with a moulded rib and a lighter pinstripe (stormreel-cable.js jacketTexture).
  const cableMats = {red: new THREE.MeshStandardMaterial({color: 0xc23224, roughness: .5, metalness: 0, map: kit.jacket, emissive: POLE.red.glow, emissiveIntensity: 0}),
    blue: new THREE.MeshStandardMaterial({color: 0x2a62d0, roughness: .5, metalness: 0, map: kit.jacket, emissive: POLE.blue.glow, emissiveIntensity: 0})};
  const OP = {red: 'operator', blue: 'operator2'};
  // Shared pooled drawing: soft textures, one bead Points for every travelling carrier, and the sound.
  const tex = {soft: softTexture(), corona: coronaTexture(), ribbon: ribbonTexture(), red: glyphTexture('red'), blue: glyphTexture('blue')};
  const beads = createBeads(scene, tex.soft, {capacity: 200, size: .15});
  const sfx = createStormreelAudio({audio: ctx.audio, listener: ctx.listener});
  const sound = (name, ...args) => { try { sfx[name]?.(...args); } catch { /* audio is never worth a frame */ } };
  const circuit = createCircuitFx({scene, lightning, height: ctx.height, beads, tex, sound, bodyPoints: ctx.bodyPoints, enemyVisual: ctx.enemyVisual,
    enemyAt: (id, out) => { const e = snapshot?.enemies?.find(x => x.id === id); return e ? out.fromArray(e.position).setY(e.position[1] + 1.1) : null; }, shake: ctx.shake, flash: ctx.flash, darken: ctx.darken});
  let creakAt = 0;

  function installPack(gltf) { packTemplate = gltf; }
  function installCrossbow(gltf) {
    boltTemplate = gltf.scene.getObjectByName('Bolt') || null; bowTemplate = gltf.scene;
    // The butt: the back end of the crossbow along its length (-Z forward), where it bites into the ground when planted.
    const box = new THREE.Box3().setFromObject(gltf.scene); bowButt = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y + (box.max.y - box.min.y) * .35, box.max.z);
  }

  // ---- cable (stormreel-cable.js): wrapped trees resolve to their own trunk profiles for a snug fit
  function makeCable(colour) { const c = kit.make(cableMats[colour]); c.glow = createRibbon(scene, tex.ribbon, {capacity: 220}); c.colour = colour; return c; }
  function wrapsFor(tower, colour) {
    const list = cableWraps(tower, colour); if (!list.length) return null;
    if (treesFor !== snapshot) { treesFor = snapshot; treeMap = new Map((ctx.trees?.(snapshot) || worldTrees(snapshot)).map(t => [t.id, t])); }
    return list.map(w => ({x: w.x, z: w.z, tree: treeMap.get(w.id) || null}));
  }
  /** Trees near this cable that it is not wrapped round: its free spans slide round their bark (stormreel-cable.js). */
  const trunkList = new Map();
  function trunksNear(c, a, b, wraps) {
    if (treesFor !== snapshot) { treesFor = snapshot; treeMap = new Map((ctx.trees?.(snapshot) || worldTrees(snapshot)).map(t => [t.id, t])); }
    let x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
    if (c.seeded) for (const p of c.p) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.z < z0) z0 = p.z; if (p.z > z1) z1 = p.z; }
    const out = trunkList.get(c) || []; out.length = 0; trunkList.set(c, out);
    const wrapped = new Set((wraps || []).map(w => w.tree?.id));
    for (const t of treeMap.values()) {
      if (wrapped.has(t.id) || t.x < x0 - 1 || t.x > x1 + 1 || t.z < z0 - 1 || t.z > z1 + 1) continue;
      const floor = ctx.height(t.x, t.z); out.push({x: t.x, z: t.z, r: trunkRadius(t, .8) + .01, top: floor + Math.min(2.2, t.height * .4)});
    }
    return out.length ? out : null;
  }
  function dropCable(id) { const c = cables.get(id); if (!c) return; trunkList.delete(c); kit.drop(c); c.glow.dispose(); cables.delete(id); }

  /**
   * Current pulses along a polyline: red carries them out from the tower (u 0 -> 1), blue returns them (1 -> 0). The ribbon
   * glows faintly at idle and strongly while a circuit runs; a bead rides each pulse's crest.
   */
  const q0 = new THREE.Vector3(), spot = new THREE.Vector3(), spotC = new THREE.Color();
  function pulses(points, glow, colour, level, time, camPos, seedAt = 0, thin = false) {
    if (level <= 0) { glow?.hide(); return; }
    const dir = colour === 'red' ? 1 : -1, speed = .18 + .9 * level, count = 3, hot = HOT[colour], base = GLOW[colour];
    const crest = []; for (let k = 0; k < count; k++) { const f = (((time * speed * dir + k / count + seedAt) % 1) + 1) % 1; crest.push(f); }
    const bright = (u) => { let s = .1 + .1 * level; for (const f of crest) { const d = (u - f) / (.055 + .03 * level); s += Math.exp(-d * d) * (.7 + 1.3 * level); } return s; };
    const w0 = thin ? .006 : .02, w1 = thin ? .012 : .035;
    glow?.update(points, camPos, (i, u) => w0 + w1 * Math.min(1, bright(u)), (i, u, out) => out.copy(base).lerp(hot, Math.max(0, Math.min(.6, bright(u) - .6))).multiplyScalar(Math.min(1.5, bright(u)) * .55 * (.6 + .4 * flicker(time, i))));
    for (const f of crest) { along(points, f, spot); spotC.copy(base).lerp(hot, .5); beads.add(spot, spotC, .35 + .6 * level); }
  }

  // ---- the pack on a wearer's back (remote Heroes; the local Hero is first person and only needs its cable exit)
  function wearerPose(id) { return id === ctx.localId() ? ctx.localPose() : ctx.actorPose(id); }
  function packFor(id, colour) {
    let p = packs.get(id); if (p && p.userData.colour === colour) return p;
    if (p) { p.removeFromParent(); packs.delete(id); }
    if (!packTemplate) return null;
    p = tintPack(packTemplate.scene.clone(true), colour); p.name = `ReelPack:${id}`; p.userData.colour = colour;
    p.traverse(n => { if (n.isMesh) { n.castShadow = true; n.raycast = () => {}; n.userData.ignoreContact = true; } });
    p.userData.exit = p.getObjectByName('CableExit'); p.userData.reel = p.getObjectByName('Reel'); p.userData.lamp = p.getObjectByName('Lamp_Glow');
    scene.add(p); packs.set(id, p); return p;
  }
  function placePack(p, pose) {
    p.position.copy(BACK).applyAxisAngle(up, pose.yaw).add(pose.position); p.rotation.set(0, pose.yaw, 0); p.updateMatrixWorld(true);
  }
  /** World point the cable leaves the pack: from the pack model when present, else the same offset computed. */
  function exitPoint(pose, pack, out) {
    if (pack?.userData.exit) return pack.userData.exit.getWorldPosition(out);
    return out.set(0, -.51, .3).add(BACK).applyAxisAngle(up, pose.yaw).add(pose.position);
  }
  /** Where a wearer's bolts leave the crossbow (the live model's muzzle when there is one, else a point at the shoulder). */
  function muzzleOf(id, out) {
    if (id === ctx.localId()) { const m = ctx.localMuzzle?.(out); if (m) return m; }
    else { const m = ctx.remoteMuzzle?.(id, out); if (m) return m; }
    const pose = wearerPose(id); if (!pose) return null;
    return out.set(0, 1.35, -.65).applyAxisAngle(up, pose.yaw).add(pose.position);
  }

  function sync(s) { snapshot = s; }
  function towerTerminal(b, out, colour) {
    const e = ctx.spireEntry(b.id), t = e ? ctx.spireArt.terminal(e, out, colour) : null;
    return t || out.fromArray(terminalPoint(b, colour));
  }
  const away = (id, colour, on) => { const e = ctx.spireEntry(id); if (e) { e.packAway ||= {}; e.packAway[colour] = on; } };
  const towerOf = id => snapshot?.inventions?.structures?.find(b => b.id === id);
  const poleOfHero = (b, id) => !b || !id ? null : b.operator === id ? 'red' : b.operator2 === id ? 'blue' : null;
  const at3 = a => a ? [a.x, a.y, a.z] : null;

  // ---- probes: the lodged bolt, a corona, a spinning polarity badge, and crawling St Elmo's fire. A bolt whose foe died
  // drops out of the body, falls, clatters and lies on the ground (still wired up, still reelable).
  function makeProbe(colour, start = null) {
    const corona = makeSprite(scene, tex.corona, GLOW[colour], 15), halo = makeSprite(scene, tex.soft, GLOW[colour], 14), badge = makeSprite(scene, tex[colour], 0xffffff, 16);
    badge.material.depthTest = false; badge.material.blending = THREE.NormalBlending; badge.material.opacity = .95;
    let bolt = null;
    if (boltTemplate) {
      bolt = new THREE.Group(); const m = boltTemplate.clone(true); m.position.copy(boltTemplate.position).negate(); bolt.add(m); finishCrossbow(bolt, colour);
      bolt.traverse(n => { if (n.isMesh) { n.raycast = () => {}; n.userData.ignoreContact = true; n.castShadow = true; } }); scene.add(bolt);
    }
    return {colour, corona, halo, badge, bolt, crawl: 0, since: 0, planted: clock, pos: new THREE.Vector3(), started: !!start, start: start?.clone() || null, vel: new THREE.Vector3(), lying: 0, spin: 0, bounced: 0, quat: new THREE.Quaternion()};
  }
  function dropProbeMesh(key) { const m = probeMeshes.get(key); if (!m) return; for (const s of [m.corona, m.halo, m.badge]) { s.removeFromParent(); s.material.dispose(); } m.bolt?.removeFromParent(); probeMeshes.delete(key); }
  /** A probe's target position: riding the drawn body part (smooth, not snapshot-stepped) or where it lies. */
  function probePoint(probe, out) { return (probe.enemy && !probe.fell && ctx.probeAnchor?.(probe.enemy, probe.part, out)) || out.fromArray(probe.at); }
  function shownProbe(key, probe) {
    const h = hidden.get(key); if (probe && h !== undefined && probe.tick === h) return null;   // reeled in a moment ago: the snapshot has not caught up
    if (probe) { const p = pending.get(key); if (p?.start && !probeMeshes.has(key)) starts.set(key, p.start); pending.delete(key); return probe; }
    const p = pending.get(key); if (p && clock < p.until) return p.probe; if (p) pending.delete(key); return null;   // landed, snapshot still on its way
  }
  const starts = new Map(), tq = new THREE.Quaternion(), lieQ = new THREE.Quaternion(), fwd = new THREE.Vector3(0, 0, -1);
  function updateProbe(key, colour, probe, live, camPos, dt, time) {
    let m = probeMeshes.get(key); if (!m) { m = makeProbe(colour, starts.get(key)); starts.delete(key); probeMeshes.set(key, m); if (m.start) m.pos.copy(m.start); else probePoint(probe, m.pos); }
    const target = probePoint(probe, v), riding = !!probe.enemy && !probe.fell && !!ctx.probeAnchor?.(probe.enemy, probe.part, v2);
    if (riding) { m.pos.copy(target); m.vel.set(0, 0, 0); m.lying = 0; }
    else if (m.pos.y > target.y + .03 || m.vel.lengthSq() > .01) {
      // Falling out of a felled foe: gravity, a little tumble, one bounce and a clatter, then it lies still.
      m.vel.y -= 9.8 * dt; m.pos.addScaledVector(m.vel, dt); m.pos.x += (target.x - m.pos.x) * Math.min(1, dt * 3); m.pos.z += (target.z - m.pos.z) * Math.min(1, dt * 3); m.spin += dt * 9;
      if (m.pos.y <= target.y) {
        m.pos.y = target.y;
        if (m.vel.y < -1.2 && m.bounced < 2) { m.vel.y *= -.28; m.vel.x = (Math.random() - .5) * .6; m.vel.z = (Math.random() - .5) * .6; m.bounced++; if (m.bounced === 1) { sound('clatter', at3(m.pos)); lightning?.burst(m.pos, {count: 6, speed: 1.8, up: 1}); } }
        else m.vel.set(0, 0, 0);
      }
      m.lying = Math.min(1, m.lying + dt * 4);
    } else { m.pos.copy(target); if (probe.fell || !probe.enemy) m.lying = probe.fell ? 1 : m.lying; }
    const age = clock - m.planted, P = POLE[colour];
    const stamp = 1 + .9 * Math.exp(-age * 7) * Math.cos(age * 22), flick = .8 + .4 * flicker(time, colour === 'red' ? 0 : 3), dim = m.lying > .5 ? .7 : 1;
    m.corona.position.copy(m.pos); m.corona.material.rotation = time * (colour === 'red' ? 2.2 : -2.2) + (live ? Math.sin(time * 30) * .3 : 0);
    m.corona.scale.setScalar(.5 * flick * (live ? 1.5 : 1) * stamp * dim); m.corona.material.color.copy(GLOW[colour]).lerp(HOT[colour], live ? .35 : .1);
    m.halo.position.copy(m.pos); m.halo.scale.setScalar((1 + .3 * Math.sin(time * 6.5 + (colour === 'red' ? 0 : 2))) * (live ? 1.4 : 1)); m.halo.material.opacity = live ? .32 : .2;
    const far = camPos.distanceTo(m.pos); m.badge.position.set(m.pos.x, m.pos.y + .95 + .06 * Math.sin(time * 2.4 + (colour === 'red' ? 0 : 1.6)), m.pos.z);
    m.badge.scale.setScalar(.3 * stamp * (1 + .1 * Math.max(0, far - 8) / 10)); m.badge.material.opacity = Math.min(1, .95 - Math.max(0, far - 30) * .02);
    if (m.bolt) {
      const d = dirs.get(key) || v2.set(0, -1, 0); tq.setFromUnitVectors(fwd, d);
      if (m.lying > 0) {   // lying flat along its flight line, rolled by the tumble
        v.set(d.x, 0, d.z); if (v.lengthSq() < 1e-4) v.set(1, 0, 0); v.normalize(); lieQ.setFromUnitVectors(fwd, v).multiply(q.setFromAxisAngle(fwd, m.spin)); tq.slerp(lieQ, m.lying);
      }
      m.bolt.quaternion.copy(tq);
      const bury = m.lying > .5 ? 0 : BOLT_BURY; v.set(0, 0, -1).applyQuaternion(tq); m.bolt.position.copy(m.pos).addScaledVector(v, bury - BOLT_LEN * (m.lying > .5 ? .5 : 1)); if (m.lying > .5) m.bolt.position.y += .015;
      if (probe.enemy && !dirs.has(key)) dirs.set(key, new THREE.Vector3(0, 0, -1));
    }
    // St Elmo's fire: little arcs crawl from the head across whatever it is stuck in; busier and brighter while the circuit runs.
    m.since -= dt;
    if (lightning && m.since <= 0) {
      m.since = (live ? .05 : .16) + Math.random() * (live ? .08 : .22);
      const off = new THREE.Vector3(Math.random() - .5, Math.random() * .7 - .1, Math.random() - .5).normalize().multiplyScalar(.2 + Math.random() * (live ? .55 : .35)), tip = new THREE.Vector3(), pair = [m.pos, tip];
      lightning.strike(m.pos, tip.copy(m.pos).add(off), {life: .09, width: live ? .02 : .013, rough: .4, depth: 3, branches: 0, restrikes: 0, intensity: live ? 1 : .7, hue: P.hue, follow: () => { tip.copy(m.pos).add(off); return pair; }});
      if (Math.random() < (live ? .6 : .2)) lightning.burst(m.pos, {count: 2, speed: 1.6, life: .3});
    }
  }

  // ---- a planted crossbow: spiked butt-first into the ground, its pack lying beside it, a short coiled cord between them
  const planted = new Map();
  const dust = (at, n = 6) => { for (let i = 0; i < n; i++) circuit.puff(at.clone().add(v.set((Math.random() - .5) * .5, .05, (Math.random() - .5) * .5)), {size: .28 + Math.random() * .2, life: .7 + Math.random() * .4, rise: .35, color: 0x8a7a62, drift: .9}); };
  function plantedPose(at, yaw, out) {
    // Muzzle up, leaning a little forward the way its carrier faced; the top of the receiver faces back toward them.
    const f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), muzzle = new THREE.Vector3(0, 1, 0).addScaledVector(f, .28).normalize();
    const z = muzzle.clone().negate(), y = f.clone().negate().addScaledVector(z, -f.clone().negate().dot(z)).normalize(), x = new THREE.Vector3().crossVectors(y, z);
    out.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    const butt = (bowButt || new THREE.Vector3(0, 0, .3)).clone().applyQuaternion(out.quaternion);
    out.position.copy(at).sub(butt).addScaledVector(muzzle, -.07);   // a few centimetres of the butt bitten into the soil
    return muzzle;
  }
  function makePlanted(key, colour, pl, fresh) {
    const g = {colour, at: new THREE.Vector3(...pl.at), yaw: pl.yaw, t: fresh ? 0 : 1, bow: null, pack: null, cord: null, badge: makeSprite(scene, tex[colour], 0xffffff, 16), glow: makeSprite(scene, tex.soft, GLOW[colour], 13), landed: !fresh};
    g.badge.material.depthTest = false; g.badge.material.blending = THREE.NormalBlending;
    if (bowTemplate) {
      g.bow = bowTemplate.clone(true); g.bow.name = `PlantedStormreel:${colour}`; finishCrossbow(g.bow, colour);
      g.bow.traverse(n => { if (n.isMesh) { n.castShadow = true; n.raycast = () => {}; n.userData.ignoreContact = true; } });
      for (const name of ['Charge_L_Core', 'Charge_R_Core']) { const c = g.bow.getObjectByName(name); if (c) { c.visible = true; c.scale.z = .12; } }
      scene.add(g.bow); g.muzzleDir = plantedPose(g.at, g.yaw, g.bow); g.rest = g.bow.position.clone(); g.restQ = g.bow.quaternion.clone(); g.muzzle = g.bow.getObjectByName('Muzzle'); g.cordAt = g.bow.getObjectByName('CordAnchor');
    }
    if (packTemplate) {
      g.pack = tintPack(packTemplate.scene.clone(true), colour); g.pack.name = `PlantedPack:${colour}`;
      g.pack.traverse(n => { if (n.isMesh) { n.castShadow = true; n.raycast = () => {}; n.userData.ignoreContact = true; } });
      // Set down on its frame to the right of the crossbow, drum up.
      const right = new THREE.Vector3(Math.cos(g.yaw), 0, -Math.sin(g.yaw)), at = g.at.clone().addScaledVector(right, .55);
      g.pack.position.set(at.x, ctx.height(at.x, at.z) + .17, at.z); g.pack.rotation.set(-Math.PI / 2, 0, g.yaw + Math.PI, 'YXZ'); scene.add(g.pack); g.pack.updateMatrixWorld(true);
      g.exit = g.pack.getObjectByName('CableExit');
    }
    planted.set(key, g); return g;
  }
  function dropPlanted(key) {
    const g = planted.get(key); if (!g) return;
    g.bow?.removeFromParent(); g.pack?.removeFromParent(); g.cord?.geometry.dispose(); g.cord?.removeFromParent();
    for (const s of [g.badge, g.glow]) { s.removeFromParent(); s.material.dispose(); } planted.delete(key);
  }
  function updatePlanted(g, dt, time, camPos) {
    if (g.bow) {
      // Plant: it comes down hard from hip height along its own axis, bites, then shivers to a stop.
      g.t = Math.min(1, g.t + dt / .22); const fall = 1 - g.t * g.t;
      g.bow.position.copy(g.rest).addScaledVector(g.muzzleDir, .85 * fall);
      if (g.t >= 1 && !g.landed) { g.landed = true; g.wobble = 1; dust(g.at, 8); lightning?.burst(g.at, {count: 10, speed: 2.4, up: 1}); lightning?.glow(g.at.clone().setY(g.at.y + .3), {size: 1, life: .25, color: POLE[g.colour].glow}); }
      g.wobble = Math.max(0, (g.wobble || 0) - dt * 2.2);
      g.bow.quaternion.copy(g.restQ).multiply(q.setFromAxisAngle(v.set(1, 0, 0), Math.sin(clock * 34) * .06 * g.wobble * g.wobble));
      g.bow.updateMatrixWorld(true);
      // The cord from the pack to the crossbow's butt socket: a lazy loop over the grass.
      if (g.exit && g.cordAt && !g.cord && g.landed) {
        const a = g.cordAt.getWorldPosition(new THREE.Vector3()), b = g.pack.getObjectByName('CableExit').getWorldPosition(new THREE.Vector3()), mid = a.clone().lerp(b, .5); mid.y = ctx.height(mid.x, mid.z) + .03;
        const lift = a.clone().lerp(mid, .35); lift.y = Math.max(lift.y, mid.y + .05);
        g.cord = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a, lift, mid, b]), 20, .013, 6, false), cableMats[g.colour]); g.cord.castShadow = true; g.cord.raycast = () => {}; g.cord.userData.ignoreContact = true; scene.add(g.cord);
      }
    }
    // A marker so you can find it again across the field: the polarity badge over it and a soft glow at the grip.
    const far = camPos.distanceTo(g.at); g.badge.position.set(g.at.x, g.at.y + 1.25 + .05 * Math.sin(time * 2), g.at.z); g.badge.scale.setScalar(.28 * (1 + Math.max(0, far - 6) * .045)); g.badge.material.opacity = Math.min(.95, .35 + far * .04);
    g.glow.position.set(g.at.x, g.at.y + .55, g.at.z); g.glow.scale.setScalar(.9 + .2 * flicker(time, 2)); g.glow.material.opacity = .22;
  }
  /** Where a planted pack's cable leaves it, and where its filament leaves the crossbow. */
  const plantedExit = (g, out) => g?.exit ? g.exit.getWorldPosition(out) : out.copy(g?.at || out);
  const plantedMuzzle = (g, out) => g?.muzzle ? g.muzzle.getWorldPosition(out) : null;

  // ---- events
  function event(ev) {
    if (ev.kind === 'storm_pack_home') {
      const colour = ev.pack || 'red', key = `${ev.id}:${colour}`, c = cables.get(key), from = c && c.count ? c.render[c.count - 1].clone() : ev.from ? new THREE.Vector3(...ev.from) : null;
      sound('pack', 'hang', colour, ev.position, ev.by === ctx.localId());
      dropPlanted(key);
      if (ev.tethered) return;   // a lodged bolt still holds the cable: it pays out to the probe instead of winding home
      if (from) { homes.set(key, {t: 0, from, by: ev.by}); away(ev.id, colour, true); }
      return;
    }
    if (ev.kind === 'storm_pack_take') {
      sound('pack', 'take', ev.pack || 'red', ev.position, ev.by === ctx.localId());
      const e = ctx.spireEntry(ev.id), t = e ? ctx.spireArt.terminal(e, new THREE.Vector3(), ev.pack || 'red') : null;
      if (t && lightning) { lightning.glow(t, {size: 1.8, life: .35, color: POLE[ev.pack || 'red'].glow}); lightning.burst(t, {count: 14, speed: 3}); }
      return;
    }
    if (ev.kind === 'storm_plant') {
      const key = `${ev.id}:${ev.pack}`; dropPlanted(key); makePlanted(key, ev.pack, {at: ev.position, yaw: ev.yaw}, true);
      sound('spike', ev.pack, ev.position, ev.by === ctx.localId()); return;
    }
    if (ev.kind === 'storm_pickup') {
      const key = `${ev.id}:${ev.pack}`, g = planted.get(key); if (g) { dust(g.at, 5); lightning?.burst(g.at.clone().setY(g.at.y + .5), {count: 8, speed: 2}); }
      dropPlanted(key); sound('pack', 'take', ev.pack, ev.position, ev.by === ctx.localId()); return;
    }
    if (ev.kind === 'storm_arc') {
      const tower = towerOf(ev.id), local = ev.by === ctx.localId();
      const pa = new THREE.Vector3(...ev.red), pb = new THREE.Vector3(...ev.blue);
      for (const [k, m] of probeMeshes) { if (k === `${ev.id}:red`) pa.copy(m.pos); if (k === `${ev.id}:blue`) pb.copy(m.pos); }
      const splash = (ev.splash || []).map(id => snapshot?.enemies?.find(e => e.id === id)).filter(Boolean).map(e => new THREE.Vector3(...e.position));
      circuit.surge(ev, pa, pb, splash, local);
      for (const colour of PACKS) { const c = cables.get(`${ev.id}:${colour}`); if (c) c.surge = 1; }
      // The power comes from somewhere: the Stormspire dumps its charge (a flashover across its two terminals) and the
      // crossbows spit at the muzzle as the current goes through them, the same instant the arc lands in the foe.
      if (lightning && tower) {
        const tr = towerTerminal(tower, new THREE.Vector3(), 'red'), tb = towerTerminal(tower, new THREE.Vector3(), 'blue');
        lightning.strike(tr, tb, {life: .5, width: .22, rough: .1, depth: 4, branches: 0, restrikes: 1, intensity: 3.5, hue: ARC});
        for (const t of [tr, tb]) { lightning.glow(t, {size: 3.5, life: .5, color: 0xd8ccff}); lightning.burst(t, {count: 18, speed: 3.5, life: .9, molten: true}); }
        for (const id of [tower.operator, tower.operator2]) { const m = id && muzzleOf(id, new THREE.Vector3()); if (m) { lightning.glow(m, {size: 1.4, life: .35, color: 0xd8ccff}); lightning.burst(m, {count: 8, speed: 2.2, life: .6, molten: true}); } }
      }
      return;
    }
    if (ev.kind === 'storm_arc_end') {
      const tower = towerOf(ev.id);
      if (lightning) for (const [k, m] of probeMeshes) if (k.startsWith(`${ev.id}:`)) lightning.burst(m.pos, {count: 10, speed: 2.5});
      if (ev.enemy) circuit.end(ev.enemy, ev.why === 'cooked' && !snapshot?.enemies?.some(e => e.id === ev.enemy && e.hp > 0));
      sound('circuitEnd', ev.why, tower?.position);
      return;
    }
    if (ev.kind === 'storm_probe_lost') {
      const key = `${ev.id}:${ev.pack}`; if (ev.probeTick !== undefined) hidden.set(key, ev.probeTick);
      pending.delete(key);
      if (lightning && ev.position) { const p = new THREE.Vector3(...ev.position); lightning.burst(p, {count: 14, speed: 3.5}); lightning.glow(p, {size: 1.6, life: .25, color: POLE[ev.pack].glow}); }
      sound('snap', ev.position); return;
    }
    if (ev.kind === 'storm_reel') { startReel(ev); return; }
    if (ev.kind === 'storm_charge') { const e = ctx.spireEntry(ev.id); if (e) ctx.spireArt.charged(e, {lightning: !!ev.lightning}); sound('towerCharge', {at: ev.position, sky: !!ev.lightning, crystal: !ev.lightning}); return; }
    if (ev.kind !== 'storm_bolt') return;
    const local = ev.by === ctx.localId(), tower = towerOf(ev.structureId), pole = ev.pole || poleOfHero(tower, ev.by) || 'red', P = POLE[pole], key = `${ev.structureId}:${pole}`;
    const from = (local ? ctx.localMuzzle?.(new THREE.Vector3()) : null) || new THREE.Vector3(...ev.origin);
    const to = new THREE.Vector3(...ev.position), dist = from.distanceTo(to), dir = to.clone().sub(from).normalize();
    const bolt = {from, to, t: 0, flight: Math.max(.04, dist / 140), ev, pole, key, dir, mesh: null, landed: false, pos: from.clone()};
    if (boltTemplate) {
      const holder = new THREE.Group(), m = boltTemplate.clone(true); m.position.copy(boltTemplate.position).negate(); holder.add(m); finishCrossbow(holder, pole);
      scene.add(holder); bolt.holder = holder; holder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir); holder.position.copy(from);
    }
    bolts.push(bolt); sound('fire', {pole, charge: ev.charge, live: ev.live, at: ev.origin, local});
    if (lightning && ev.live) { lightning.glow(from, {size: .9, life: .14, color: P.glow}); lightning.burst(from, {count: 8, speed: 2.5, normal: dir}); }
    // The filament pays out behind the bolt: remember where it will land so the tether draws straight on into the lodged probe.
    wire(`${key}:wire`).t0 = clock;
  }
  function land(b) {
    const ev = b.ev, P = POLE[b.pole]; b.landed = true;
    if (b.holder) { b.holder.removeFromParent(); b.holder = null; }
    if (ev.probe) {   // the bolt stays: draw its probe from now, the snapshot's copy takes over a moment later
      const at = ev.fell || [b.to.x, b.to.y, b.to.z];
      pending.set(b.key, {until: clock + .8, start: ev.fell ? b.to.clone() : null, probe: {at, tick: -2, ...(ev.fell ? {fell: true} : ev.targetId ? {enemy: ev.targetId, part: ev.part} : {})}});
      dirs.set(b.key, b.dir.clone()); const old = probeMeshes.get(b.key); if (old) { old.planted = clock; if (ev.fell) { old.pos.copy(b.to); old.vel.set(0, 0, 0); old.bounced = 0; } } else if (ev.fell) starts.set(b.key, b.to.clone());
    }
    sound('plant', {pole: b.pole, charge: ev.charge ?? 1, at: [b.to.x, b.to.y, b.to.z], ground: !ev.targetId});
    if (!lightning) return;
    if (!ev.live) { lightning.burst(b.to, {count: 6, speed: 1.5}); return; }
    // A lone bolt carries the filament's static only: a crisp bite and a crackle, waiting for its opposite pole.
    const k = .6 + .4 * (ev.charge ?? 1);
    lightning.strike(b.from, b.to, {life: .2, width: .035 * k, rough: .05, branches: 1, restrikes: 1, intensity: .9, hue: P.hue});
    lightning.glow(b.to, {size: 1.4 * k, life: .25, color: P.glow});
    lightning.burst(b.to, {count: Math.round(16 * k), speed: 3.5, normal: b.dir.clone().negate()});
  }

  // ---- the filament tether: a hair-thin glowing line from the crossbow to its lodged bolt (or the bolt in flight)
  function wire(key) {
    let w = wires.get(key); if (!w) { w = {ribbon: createRibbon(scene, tex.ribbon, {capacity: 20}), pts: Array.from({length: 20}, () => new THREE.Vector3()), t0: -9}; wires.set(key, w); }
    return w;
  }
  function drawWire(key, colour, a, b, taut, time, camPos, level) {
    const w = wire(key), N = w.pts.length, dist = a.distanceTo(b), sag = taut ? 0 : Math.min(.55, dist * .012), shake = (taut ? .05 : .08 * Math.exp(-(clock - w.t0) * 4)) * Math.min(1, dist / 6);
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1), p = w.pts[i].lerpVectors(a, b, u), env = Math.sin(u * Math.PI);
      p.y -= sag * env; p.y += Math.sin(u * 17 - time * 52) * shake * env * .4; p.x += Math.sin(u * 13 + time * 47) * shake * env * .3;
      const g = ctx.height(p.x, p.z) + .02; if (p.y < g) p.y = g;   // a long filament lies on the grass, never under it
    }
    pulses(w.pts, w.ribbon, colour, level, time, camPos, key.length * .07, true);
    return w;
  }
  function dropWire(key) { const w = wires.get(key); if (!w) return; w.ribbon.dispose(); wires.delete(key); }

  // ---- reeling a bolt back in: it rips out of its target and rides the filament home to the crossbow
  function startReel(ev) {
    const colour = ev.pack, key = `${ev.id}:${colour}`; if (ev.probeTick !== undefined) hidden.set(key, ev.probeTick);
    pending.delete(key); const m = probeMeshes.get(key), from = m ? m.pos.clone() : new THREE.Vector3(...ev.position), by = ev.by, local = by === ctx.localId();
    const to = muzzleOf(by, new THREE.Vector3()) || from.clone().add(new THREE.Vector3(0, 1, 0)), seconds = Math.min(REEL.maxSeconds, Math.max(REEL.minSeconds, from.distanceTo(to) / REEL.speed));
    const r = {key, colour, by, from, t: 0, seconds, local, wearerKey: key, mesh: null, pos: from.clone()};
    if (boltTemplate) { const holder = new THREE.Group(), mm = boltTemplate.clone(true); mm.position.copy(boltTemplate.position).negate(); holder.add(mm); finishCrossbow(holder, colour); scene.add(holder); r.mesh = holder; }
    reels.push(r); dropProbeMesh(key); dirs.delete(key);
    if (lightning) { const P = POLE[colour]; lightning.glow(from, {size: 2, life: .3, color: P.glow}); lightning.burst(from, {count: 16, speed: 4}); lightning.ring(from, {radius: 1.4, life: .35, color: P.glow}); }
    sound('reel', {pole: colour, seconds, at: at3(to), local});
  }
  function updateReels(dt, time, camPos) {
    for (let i = reels.length - 1; i >= 0; i--) {
      const r = reels[i]; r.t += dt; const k = Math.min(1, r.t / r.seconds), ease = Math.pow(k, 2.3), tip = muzzleOf(r.by, v2.set(0, 0, 0)) || r.from;
      r.pos.lerpVectors(r.from, tip, ease);
      if (r.mesh) { const dir = v.subVectors(tip, r.from).normalize(); r.mesh.quaternion.setFromUnitVectors(q0.set(0, 0, -1), dir); r.mesh.position.copy(r.pos).addScaledVector(dir, -BOLT_LEN * .5 * (1 - k)); }   // tail first: it is being pulled home
      drawWire(r.key + ':reel', r.colour, tip, r.pos, true, time, camPos, 1);
      if (lightning) { lightning.burst(r.pos, {count: 2, speed: 1.4, life: .22}); if (Math.random() < dt * 24) lightning.strike(r.pos.clone(), v.copy(r.pos).add(v2.set(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(.8)), {life: .08, width: .015, rough: .35, depth: 3, branches: 0, restrikes: 0, hue: POLE[r.colour].hue}); }
      if (k >= 1) {
        const P = POLE[r.colour];
        if (lightning) { lightning.glow(tip, {size: 1.1, life: .2, color: P.glow}); lightning.burst(tip, {count: 14, speed: 3}); }
        r.mesh?.removeFromParent(); dropWire(r.key + ':reel'); reels.splice(i, 1);
      }
    }
  }

  // ---- the end of the cable: a brief, clear tug (the cable whips taut, the fairlead spits sparks, the brake clunks)
  function tug(id, k = 1) {
    for (const [key, c] of cables) {
      const tower = towerOf(key.split(':')[0]), colour = key.split(':')[1]; if (!tower || tower[OP[colour]] !== id) continue;
      kit.whip(c, 1.2 * k); c.tugGlow = 1;
      const end = c.count ? c.render[c.count - 1] : null;
      if (end && lightning) { lightning.burst(end, {count: 10, speed: 2.6}); lightning.glow(end, {size: .9, life: .18, color: POLE[colour].glow}); }
      sound('tug', k, id === ctx.localId() ? null : end ? at3(end) : null);
    }
  }

  const a = new THREE.Vector3(), b = new THREE.Vector3(), pa = new THREE.Vector3(), pb = new THREE.Vector3(), pm = new THREE.Vector3();
  function update(dt, time, camPos = new THREE.Vector3(0, 2, 0)) {
    clock += dt; beads.begin();
    const live = new Set(), wearers = new Set(), shownProbes = new Set(), liveWires = new Set(), liveArcs = new Set(), livePlanted = new Set(), towers = [];
    for (const tower of snapshot?.inventions?.structures || []) {
      if (tower.type !== 'stormspire' || tower.hp <= 0) continue;
      const probes = tower.probes, arcLive = !!(tower.arc && probes?.red && probes?.blue), level = tower.charge > 0 ? (arcLive ? 1 : .12) : 0;
      towers.push({at: tower.position, charge: Math.min(1, (tower.charge || 0) / STORMREEL.maxCharge), working: arcLive});
      for (const colour of PACKS) {
        const key = `${tower.id}:${colour}`, op = tower[OP[colour]], home = homes.get(key), probe = shownProbe(key, probes?.[colour]), pl = tower.planted?.[colour];
        if (probe) shownProbes.add(key);
        const pose = op ? wearerPose(op) : null; let pack = null, worn = false, strain = 0, g = null;
        towerTerminal(tower, a, colour);
        if (op && pose) {
          wearers.add(op); homes.delete(key); away(tower.id, colour, false); worn = true;
          if (op !== ctx.localId()) { pack = packFor(op, colour); if (pack) placePack(pack, pose); }
          exitPoint(pose, pack, b);
          if (pack?.userData.reel) pack.userData.reel.rotation.x = -(cables.get(key)?.length || 0) * 1.8;   // drum turns as cable pays out
          if (op === ctx.localId() || ctx.actorPose(op)) { const crossbow = op === ctx.localId() ? null : ctx.remoteCrossbow?.(op); if (crossbow) finishCrossbow(crossbow, colour); }
        } else if (pl) {
          g = planted.get(key) || makePlanted(key, colour, pl, false); livePlanted.add(key); homes.delete(key); away(tower.id, colour, false);
          updatePlanted(g, dt, time, camPos); plantedExit(g, b);
        } else if (home) {
          // Winding home: the end of the cable (and the pack on it) zips back along the ground to its hook.
          home.t += dt / CABLE.homeSeconds; const k = Math.min(1, home.t), ease = k * k * (3 - 2 * k);
          const e = ctx.spireEntry(tower.id), hook = (e && ctx.spireArt.hookPoint(e, v2, colour)) || v2.fromArray(sharedHook(tower, colour));
          b.lerpVectors(home.from, hook, ease); b.y += Math.sin(k * Math.PI) * .6;
          if (k >= 1) { homes.delete(key); away(tower.id, colour, false); continue; }
        } else if (probe) { probePoint(probe, b); away(tower.id, colour, false); }   // the pack hangs on its hook again: the cable runs on to the bolt it fired
        else { away(tower.id, colour, false); continue; }
        live.add(key);
        let c = cables.get(key); if (!c) { c = makeCable(colour); cables.set(key, c); }
        if (!c.seeded) kit.seed(c, a, b);
        // The far end pays out toward a lodged bolt instead of jumping to it.
        if (!worn && !home && !pl && probe) { v.subVectors(b, c.end); const l = v.length(), step = CABLE.payOut * dt; if (l > step) c.end.addScaledVector(v, step / l); else c.end.copy(b); } else c.end.copy(b);
        const target = worn || pl ? b : c.end; if (worn) strain = cableStrain(tower, [pose.position.x, 0, pose.position.z], colour);
        const wl = worn || pl ? wrapsFor(tower, colour) : null;
        kit.step(c, {a, b: target, wraps: wl, trunks: trunksNear(c, a, target, wl), strain, dt, maxLength: worn || home || pl ? STORMREEL.cable : STORMREEL.tether, home: !!home});
        kit.draw(c);
        // Current: faint idle pulses; a flood while the circuit runs; a white flash down the line at the surge and at a tug.
        c.surge = Math.max(0, (c.surge || 0) - dt * 1.5); c.tugGlow = Math.max(0, (c.tugGlow || 0) - dt * 4);
        pulses(kit.points(c), c.glow, colour, Math.min(1, level + c.surge + c.tugGlow * .5), time, camPos, colour === 'red' ? 0 : .5);
        cableMats[colour].emissiveIntensity = Math.max(cableMats[colour].emissiveIntensity * .9, (arcLive ? .45 : level > 0 ? .05 : 0) * (.6 + .4 * flicker(time, 5)) + c.surge * 1.2);
        // A taut cable fizzes at the fairlead as a warning, and groans.
        if (worn && strain > .85) { if (lightning && Math.random() < dt * 6) lightning.burst(b, {count: 2, speed: 1.2}); if (clock > creakAt && op === ctx.localId()) { creakAt = clock + 1.6; sound('creak', strain); } }
        // The filament: crossbow -> bolt, from the crossbow in someone's hands or the one standing planted.
        const tip = worn ? muzzleOf(op, v2) : g ? plantedMuzzle(g, v2) : null;
        if (tip) {
          const bolt = bolts.find(x => x.key === key && !x.landed);
          if (probe || bolt) {
            const m = probeMeshes.get(key), end = bolt ? bolt.pos : m ? m.pos : probePoint(probe, pm);
            drawWire(`${key}:wire`, colour, tip, end, false, time, camPos, arcLive ? 1 : .2); liveWires.add(`${key}:wire`);
          }
        }
      }
      for (const colour of PACKS) {
        const probe = shownProbe(`${tower.id}:${colour}`, probes?.[colour]); if (!probe) continue;
        updateProbe(`${tower.id}:${colour}`, colour, probe, arcLive, camPos, dt, time);
      }
      if (arcLive && tower.arc.enemy) {
        liveArcs.add(tower.id);
        const mr = probeMeshes.get(`${tower.id}:red`), mb = probeMeshes.get(`${tower.id}:blue`);
        if (mr) pa.copy(mr.pos); else probePoint(probes.red, pa); if (mb) pb.copy(mb.pos); else probePoint(probes.blue, pb);
        circuit.cook(tower.arc.enemy, pa, pb, dt, time, Math.min(1, (tower.charge || 0) / 60));
        let loop = arcLoops.get(tower.id); if (!loop) { loop = sfx.arcLoop(); if (loop) arcLoops.set(tower.id, loop); }
        if (loop) { pm.copy(pa).lerp(pb, .5); loop.update([pm.x, pm.y, pm.z], dt, Math.min(1, tower.charge / 80)); }
      }
    }
    // retire what is no longer shown
    for (const [key] of probeMeshes) if (!shownProbes.has(key)) dropProbeMesh(key);
    for (const key of [...planted.keys()]) if (!livePlanted.has(key)) dropPlanted(key);
    for (const key of [...wires.keys()]) if (!liveWires.has(key) && !key.endsWith(':reel')) dropWire(key);
    for (const [id, loop] of arcLoops) if (!liveArcs.has(id)) { loop.stop(); arcLoops.delete(id); }
    circuit.update(dt, camPos);
    for (const id of [...cables.keys()]) if (!live.has(id)) dropCable(id);
    for (const [id, p] of packs) if (!wearers.has(id)) { p.removeFromParent(); packs.delete(id); }
    for (let i = bolts.length - 1; i >= 0; i--) {
      const bo = bolts[i]; bo.t += dt;
      const k = Math.min(1, bo.t / bo.flight); bo.pos.lerpVectors(bo.from, bo.to, k);
      if (bo.holder) bo.holder.position.copy(bo.pos);
      if (lightning && !bo.landed && bo.ev.live) lightning.burst(bo.pos, {count: 1, speed: 1, life: .3});
      if (k >= 1 && !bo.landed) land(bo);
      if (bo.landed) bolts.splice(i, 1);
    }
    updateReels(dt, time, camPos);
    sfx.updateTowers(towers, dt);
    beads.end();
  }
  return {installPack, installCrossbow, sync, event, update, tug, sfx,
    stats: () => ({cables: cables.size, packs: packs.size, bolts: bolts.length, homes: homes.size, probes: probeMeshes.size, planted: planted.size, wires: wires.size, reels: reels.length, ...circuit.stats(), beads: beads.count(), audio: sfx.stats()}),
    dispose() {
      for (const id of [...cables.keys()]) dropCable(id); for (const p of packs.values()) p.removeFromParent(); packs.clear();
      for (const k of [...probeMeshes.keys()]) dropProbeMesh(k); for (const k of [...wires.keys()]) dropWire(k); for (const k of [...planted.keys()]) dropPlanted(k);
      for (const l of arcLoops.values()) l.stop(); arcLoops.clear(); circuit.dispose();
      for (const r of reels) r.mesh?.removeFromParent(); reels.length = 0;
      beads.dispose(); sfx.dispose(); for (const t of Object.values(tex)) t?.dispose?.(); for (const m of Object.values(cableMats)) m.dispose(); kit.jacket?.dispose();
    }};
}
