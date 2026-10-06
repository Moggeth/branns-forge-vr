// Stormreel presentation: the cable from each Stormspire terminal to whoever wears its reel pack (or, once the pack is
// dropped, to the bolt it fired), the pack on remote Heroes' backs, every shot's bolt, filament and lightning, the lodged
// probes with their polarity badges, the live arc between a positive and a negative probe, the foes it cooks, and the
// reel that winds a bolt back in along its tether.
// Reads snapshots and authority events; never writes gameplay state. Everything visible updates every frame from
// predicted or interpolated positions (the local Hero's predicted body, remote Heroes' smoothed actors, probes riding the
// drawn body part they stuck in), never from the snapshot tick.
//
// Red is the positive (+) pole and blue the negative (-): current is drawn leaving the red terminal and returning to the
// blue one, as bright pulses running along each cable and filament and as carriers along the live arc.
import * as THREE from 'three';
import {STORMREEL,PACKS,terminalPoint,hookPoint as sharedHook,cableStrain,cableWraps} from '../shared/stormreel.js';
import {PACK_COLORS,tintPack} from './stormspire-art.js';
import {POLE,MIXED_HUE,finishCrossbow,softTexture,coronaTexture,glyphTexture,ribbonTexture,createRibbon,createBeads,makeSprite,along,flicker} from './stormreel-look.js';
import {createStormreelAudio} from './stormreel-audio.js';

export const CABLE = Object.freeze({points: 26, sides: 5, radius: .022, iterations: 10, gravity: 9.8, homeSeconds: .8, payOut: 40});
const BACK = new THREE.Vector3(0, 1.28, .17);   // pack anchor behind the shoulder blades, actor-local (+Z is behind)
const BOLT_LEN = .33, BOLT_BURY = .1;            // the authored bolt: tail to nose, and how far a lodged one sinks in
const REEL = Object.freeze({minSeconds: .22, maxSeconds: .65, speed: 38});
const GLOW = {red: new THREE.Color(POLE.red.glow), blue: new THREE.Color(POLE.blue.glow)}, HOT = {red: new THREE.Color(POLE.red.hot), blue: new THREE.Color(POLE.blue.hot)};

/**
 * ctx:
 *   scene, lightning (lightning-fx), height(x,z), localId(), actorPose(id) -> {position:Vector3, yaw} | null,
 *   localPose() -> {position:Vector3, yaw}, localMuzzle(out) -> Vector3 | null, remoteMuzzle(id, out) -> Vector3 | null,
 *   remoteCrossbow(id) -> Object3D | null, probeAnchor(enemyId, part, out), bodyPoints(enemyId, outVectors) -> count,
 *   spireEntry(id) -> invention entry, spireArt (stormspire-art), audio() -> AudioContext | null, listener() -> ear pose | null
 */
export function createStormreelView(ctx) {
  const {scene, lightning} = ctx;
  let packTemplate = null, boltTemplate = null, snapshot = null, clock = 0;
  const cables = new Map(), packs = new Map(), bolts = [], homes = new Map(), wires = new Map(), reels = [], victims = new Map(), arcLoops = new Map(), arcFx = new Map();
  const probeMeshes = new Map(), pending = new Map(), hidden = new Map(), dirs = new Map();
  const v = new THREE.Vector3(), v2 = new THREE.Vector3(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), c3 = new THREE.Color();
  const cableMats = {red: new THREE.MeshStandardMaterial({color: PACK_COLORS.red, roughness: .55, metalness: 0, emissive: POLE.red.glow, emissiveIntensity: 0}),
    blue: new THREE.MeshStandardMaterial({color: PACK_COLORS.blue, roughness: .55, metalness: 0, emissive: POLE.blue.glow, emissiveIntensity: 0})};
  const OP = {red: 'operator', blue: 'operator2'};
  // Shared pooled drawing: soft textures, one bead Points for every travelling carrier, and the sound.
  const tex = {soft: softTexture(), corona: coronaTexture(), ribbon: ribbonTexture(), red: glyphTexture('red'), blue: glyphTexture('blue')};
  const beads = createBeads(scene, tex.soft, {capacity: 200, size: .15});
  const sfx = createStormreelAudio({audio: ctx.audio, listener: ctx.listener});
  let creakAt = 0;

  function installPack(gltf) { packTemplate = gltf; }
  function installCrossbow(gltf) { boltTemplate = gltf.scene.getObjectByName('Bolt') || null; }
  const sound = (name, ...args) => { try { sfx[name]?.(...args); } catch { /* audio is never worth a frame */ } };

  // ---- cable: a verlet rope with ground contact, drawn as a small tube rebuilt in place every frame, with a glowing
  // ribbon over it that carries the current pulses
  function makeCable(colour = 'red') {
    const N = CABLE.points, S = CABLE.sides, pos = new Float32Array(N * S * 3), idx = [];
    for (let i = 0; i < N - 1; i++) for (let k = 0; k < S; k++) { const a = i * S + k, b = i * S + (k + 1) % S, c = a + S, d = b + S; idx.push(a, c, b, b, c, d); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage)); geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, cableMats[colour]); mesh.frustumCulled = false; mesh.castShadow = false; mesh.raycast = () => {}; mesh.userData.ignoreContact = true; mesh.name = 'StormreelCable';
    scene.add(mesh);
    return {mesh, geo, glow: createRibbon(scene, tex.ribbon, {capacity: N}), p: Array.from({length: N}, () => new THREE.Vector3()), o: Array.from({length: N}, () => new THREE.Vector3()), seeded: false, length: 0, pins: [], end: new THREE.Vector3(), colour};
  }
  function seed(c, a, b) {
    for (let i = 0; i < c.p.length; i++) { const t = i / (c.p.length - 1); c.p[i].lerpVectors(a, b, t); c.p[i].y -= Math.sin(t * Math.PI) * .4; c.o[i].copy(c.p[i]); }
    c.seeded = true; c.length = a.distanceTo(b) + .6; c.end.copy(b);
  }
  // Trees the cable is wrapped round (shared/stormreel.js b.wraps) pin the rope to their trunks, spaced by path length.
  function pinsFor(c, a, b, wraps) {
    c.pins.length = 0; if (!wraps?.length) return a.distanceTo(b);
    const pts = [a]; for (const w of wraps) { const y = ctx.height(w.x, w.z) + .35; pts.push(new THREE.Vector3(w.x, y, w.z)); } pts.push(b);
    let total = 0; const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(total += pts[i].distanceTo(pts[i - 1]));
    const N = c.p.length;
    for (let k = 1; k < pts.length - 1; k++) {
      // Sit the cable on the outside of the turn, against the bark rather than through the trunk.
      const pin = pts[k].clone(), out = v.subVectors(pts[k - 1], pin).setY(0).normalize().add(v2.subVectors(pts[k + 1], pin).setY(0).normalize()).normalize();
      if (out.lengthSq() > .5) pin.addScaledVector(out, -.32);
      c.pins.push({i: Math.min(N - 2, Math.max(1, Math.round(cum[k] / total * (N - 1)))), at: pin});
    }
    return total;
  }
  function simulate(c, a, b, strain, dt, path, maxLength) {
    const N = c.p.length, h = Math.min(dt, 1 / 30), g = CABLE.gravity * h * h;
    // Paid-out length: generous slack near the tower, drawing taut as the wearer reaches the end of the drum.
    const d = path ?? a.distanceTo(b), want = Math.min(maxLength + .5, d * (1.04 - .035 * strain) + .7 * (1 - strain));
    c.length += (want - c.length) * Math.min(1, dt * 3);
    const rest = c.length / (N - 1);
    for (let i = 1; i < N - 1; i++) {
      const p = c.p[i], o = c.o[i], ground = ctx.height(p.x, p.z) + CABLE.radius;
      const onGround = p.y <= ground + .01, damp = onGround ? .55 : .985;   // lying cable drags; hanging cable swings
      const vx = (p.x - o.x) * damp, vy = (p.y - o.y) * .985, vz = (p.z - o.z) * damp;
      o.copy(p); p.x += vx; p.y += vy - g; p.z += vz;
    }
    c.p[0].copy(a); c.p[N - 1].copy(b);
    for (const pin of c.pins) { c.p[pin.i].copy(pin.at); c.o[pin.i].copy(pin.at); }
    for (let it = 0; it < CABLE.iterations; it++) {
      for (let i = 0; i < N - 1; i++) {
        const p = c.p[i], n = c.p[i + 1]; v.subVectors(n, p); const l = v.length() || 1e-6, diff = (l - rest) / l;
        const wa = i === 0 ? 0 : .5, wb = i + 1 === N - 1 ? 0 : .5, k = wa + wb; if (!k) continue;
        p.addScaledVector(v, diff * wa / k); n.addScaledVector(v, -diff * wb / k);
      }
      for (let i = 1; i < N - 1; i++) { const p = c.p[i], ground = ctx.height(p.x, p.z) + CABLE.radius; if (p.y < ground) p.y = ground; }
      for (const pin of c.pins) c.p[pin.i].copy(pin.at);
    }
  }
  function draw(c) {
    const N = c.p.length, S = CABLE.sides, pos = c.geo.attributes.position.array, t = new THREE.Vector3(), n = new THREE.Vector3(), bn = new THREE.Vector3();
    let prevN = null;
    for (let i = 0; i < N; i++) {
      t.subVectors(c.p[Math.min(i + 1, N - 1)], c.p[Math.max(i - 1, 0)]).normalize();
      if (!prevN) { n.crossVectors(t, Math.abs(t.y) < .9 ? up : v2.set(1, 0, 0)).normalize(); }
      else { n.copy(prevN).addScaledVector(t, -t.dot(prevN)).normalize(); }
      prevN = (prevN || new THREE.Vector3()).copy(n); bn.crossVectors(t, n);
      for (let k = 0; k < S; k++) {
        const a = k / S * Math.PI * 2, x = Math.cos(a) * CABLE.radius, y = Math.sin(a) * CABLE.radius, j = (i * S + k) * 3;
        pos[j] = c.p[i].x + n.x * x + bn.x * y; pos[j + 1] = c.p[i].y + n.y * x + bn.y * y; pos[j + 2] = c.p[i].z + n.z * x + bn.z * y;
      }
    }
    c.geo.attributes.position.needsUpdate = true; c.geo.computeVertexNormals();
  }
  function dropCable(id) { const c = cables.get(id); if (!c) return; c.mesh.removeFromParent(); c.geo.dispose(); c.glow.dispose(); cables.delete(id); }

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

  // ---- probes: the lodged bolt, a corona, a spinning polarity badge, and crawling St Elmo's fire
  function makeProbe(colour) {
    const g = new THREE.Group(); g.name = `StormProbe:${colour}`;
    const corona = makeSprite(scene, tex.corona, GLOW[colour], 15), halo = makeSprite(scene, tex.soft, GLOW[colour], 14), badge = makeSprite(scene, tex[colour], 0xffffff, 16);
    badge.material.depthTest = false; badge.material.blending = THREE.NormalBlending; badge.material.opacity = .95;
    let bolt = null;
    if (boltTemplate) {
      bolt = new THREE.Group(); const m = boltTemplate.clone(true); m.position.copy(boltTemplate.position).negate(); bolt.add(m); finishCrossbow(bolt, colour);
      bolt.traverse(n => { if (n.isMesh) { n.raycast = () => {}; n.userData.ignoreContact = true; } }); scene.add(bolt);
    }
    return {colour, corona, halo, badge, bolt, crawl: 0, since: 0, planted: clock, pos: new THREE.Vector3()};
  }
  function dropProbeMesh(key) { const m = probeMeshes.get(key); if (!m) return; for (const s of [m.corona, m.halo, m.badge]) { s.removeFromParent(); s.material.dispose(); } m.bolt?.removeFromParent(); probeMeshes.delete(key); }
  /** A probe's drawn position: riding the drawn body part (smooth, not snapshot-stepped) or where it landed. */
  function probePoint(probe, out) { return (probe.enemy && ctx.probeAnchor?.(probe.enemy, probe.part, out)) || out.fromArray(probe.at); }
  function shownProbe(key, probe) {
    const h = hidden.get(key); if (probe && h !== undefined && probe.tick === h) return null;   // reeled in a moment ago: the snapshot has not caught up
    if (probe) { pending.delete(key); return probe; }
    const p = pending.get(key); if (p && clock < p.until) return p.probe; if (p) pending.delete(key); return null;   // landed, snapshot still on its way
  }
  function updateProbe(key, colour, probe, live, camPos, dt, time) {
    let m = probeMeshes.get(key); if (!m) { m = makeProbe(colour); probeMeshes.set(key, m); }
    probePoint(probe, m.pos); const age = clock - m.planted, P = POLE[colour];
    const stamp = 1 + .9 * Math.exp(-age * 7) * Math.cos(age * 22), flick = .8 + .4 * flicker(time, colour === 'red' ? 0 : 3);
    m.corona.position.copy(m.pos); m.corona.material.rotation = time * (colour === 'red' ? 2.2 : -2.2) + (live ? Math.sin(time * 30) * .3 : 0);
    m.corona.scale.setScalar(.5 * flick * (live ? 1.5 : 1) * stamp); m.corona.material.color.copy(GLOW[colour]).lerp(HOT[colour], live ? .35 : .1);
    m.halo.position.copy(m.pos); m.halo.scale.setScalar((1 + .3 * Math.sin(time * 6.5 + (colour === 'red' ? 0 : 2))) * (live ? 1.4 : 1)); m.halo.material.opacity = live ? .32 : .2;
    const far = camPos.distanceTo(m.pos); m.badge.position.set(m.pos.x, m.pos.y + .95 + .06 * Math.sin(time * 2.4 + (colour === 'red' ? 0 : 1.6)), m.pos.z);
    m.badge.scale.setScalar(.3 * stamp * (1 + .1 * Math.max(0, far - 8) / 10)); m.badge.material.opacity = Math.min(1, .95 - Math.max(0, far - 30) * .02);
    if (m.bolt) {
      const d = dirs.get(key) || up; m.bolt.quaternion.setFromUnitVectors(v.set(0, 0, -1), d); m.bolt.position.copy(m.pos).addScaledVector(d, BOLT_BURY - BOLT_LEN);
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

  // ---- events
  function event(ev) {
    if (ev.kind === 'storm_pack_home') {
      const colour = ev.pack || 'red', key = `${ev.id}:${colour}`, c = cables.get(key), from = c ? c.p[c.p.length - 1].clone() : null;
      sound('pack', 'hang', colour, ev.position, ev.by === ctx.localId());
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
    if (ev.kind === 'storm_arc') {
      sound('circuitClose', ev.red);
      if (lightning) for (const [at, pole] of [[ev.red, 'red'], [ev.blue, 'blue']]) {
        const p = new THREE.Vector3(...at); lightning.glow(p, {size: 3, life: .45, color: POLE[pole].glow}); lightning.burst(p, {count: 22, speed: 4.5}); lightning.ring(p, {radius: 2.2, life: .5, color: POLE[pole].glow});
      }
      return;
    }
    if (ev.kind === 'storm_arc_end') {
      const tower = towerOf(ev.id);
      if (lightning && tower?.probes) for (const [k, m] of probeMeshes) if (k.startsWith(`${ev.id}:`)) lightning.burst(m.pos, {count: 10, speed: 2.5});
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
    const bolt = {from, to, t: 0, flight: Math.max(.04, dist / 140), ev, pole, key, dir, mesh: null, landed: false, pos: from.clone(), splash: (ev.splash || []).map(id => snapshot?.enemies?.find(e => e.id === id)).filter(Boolean).map(e => new THREE.Vector3(...e.position))};
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
      pending.set(b.key, {until: clock + .8, probe: {at: [b.to.x, b.to.y, b.to.z], tick: -2, ...(ev.targetId ? {enemy: ev.targetId, part: ev.part} : {})}});
      dirs.set(b.key, b.dir.clone()); const old = probeMeshes.get(b.key); if (old) old.planted = clock;
    }
    sound('plant', {pole: b.pole, charge: ev.charge ?? 1, at: [b.to.x, b.to.y, b.to.z], ground: !ev.targetId});
    if (!lightning) return;
    if (!ev.live) { lightning.burst(b.to, {count: 6, speed: 1.5}); return; }
    const k = .6 + .4 * (ev.charge ?? 1);
    lightning.strike(b.from, b.to, {life: .3, width: .08 * k, rough: .06, branches: 2, restrikes: 2, intensity: 1.1, hue: P.hue});
    lightning.glow(b.to, {size: 2.4 * k, life: .32, color: P.glow});
    lightning.ring(b.to, {radius: 1.3 * k, life: .4, color: P.glow});
    lightning.burst(b.to, {count: Math.round(26 * k), speed: 4.5, normal: b.dir.clone().negate()});
    if (ev.earth && ev.grounded) {
      const earth = new THREE.Vector3(...ev.earth);
      if (earth.distanceTo(b.to) > .25) lightning.strike(b.to, earth, {life: .34, width: .08 * k, rough: .14, branches: 1, restrikes: 2, hue: P.hue});
      lightning.ring(earth, {radius: STORMREEL.stepRadius, life: .55, color: P.glow});
      lightning.glow(earth.clone().setY(earth.y + .15), {size: 2.6 * k, life: .4, color: P.glow});
      lightning.burst(earth, {count: 18, speed: 3, up: 1});
      for (const s of b.splash) lightning.strike(earth, s.clone().setY(s.y + .9), {life: .28, width: .045, rough: .2, branches: 1, restrikes: 1, intensity: .8, hue: P.hue});
    } else lightning.burst(b.to, {count: 10, speed: 2, up: 0});
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
    }
    pulses(w.pts, w.ribbon, colour, level, time, camPos, key.length * .07, true);
    // the filament itself is much thinner than the cable overlay
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
      const w = drawWire(r.key + ':reel', r.colour, tip, r.pos, true, time, camPos, 1);
      void w;
      if (lightning) { lightning.burst(r.pos, {count: 2, speed: 1.4, life: .22}); if (Math.random() < dt * 24) lightning.strike(r.pos.clone(), v.copy(r.pos).add(v2.set(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(.8)), {life: .08, width: .015, rough: .35, depth: 3, branches: 0, restrikes: 0, hue: POLE[r.colour].hue}); }
      if (k >= 1) {
        const P = POLE[r.colour];
        if (lightning) { lightning.glow(tip, {size: 1.1, life: .2, color: P.glow}); lightning.burst(tip, {count: 14, speed: 3}); }
        r.mesh?.removeFromParent(); dropWire(r.key + ':reel'); reels.splice(i, 1);
      }
    }
  }

  // ---- the live circuit: sheathed plasma between the poles, red fading to blue, with carriers flowing + to -
  const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pm = new THREE.Vector3();
  function arcFor(id) { let f = arcFx.get(id); if (!f) { f = {at: 0, side: 0, sheath: createRibbon(scene, tex.ribbon, {capacity: 18, order: 11}), pts: Array.from({length: 18}, () => new THREE.Vector3())}; arcFx.set(id, f); } return f; }
  function updateArc(tower, probes, dt, time, camPos) {
    const f = arcFor(tower.id); probePoint(probes.red, pa); probePoint(probes.blue, pb); const length = pa.distanceTo(pb), power = Math.min(1, (tower.charge || 0) / 60);
    // sheath: a wavering glow tube, red at the positive end fading through white to blue
    for (let i = 0; i < f.pts.length; i++) { const u = i / (f.pts.length - 1), env = Math.sin(u * Math.PI); f.pts[i].lerpVectors(pa, pb, u); f.pts[i].y += Math.sin(u * 9 - time * 31) * .14 * env + .06; f.pts[i].x += Math.sin(u * 7 + time * 27) * .1 * env; }
    f.sheath.update(f.pts, camPos, (i, u) => .22 + .12 * Math.sin(u * Math.PI) + .08 * flicker(time, i), (i, u, out) => { out.copy(GLOW.red).lerp(HOT.red, .3); out.lerp(c3.copy(GLOW.blue), Math.min(1, Math.max(0, (u - .3) / .4))); out.multiplyScalar((.25 + .22 * flicker(time, i * .7)) * (.5 + .5 * power)); });
    // carriers: beads drifting from the red probe to the blue one
    const n = Math.min(18, Math.max(6, Math.round(length * .8)));
    for (let k = 0; k < n; k++) { const u = (((time * .9 + k / n) % 1) + 1) % 1; along(f.pts, u, v); c3.copy(HOT.red).lerp(HOT.blue, u); beads.add(v, c3, .9); }
    // restriking channels in three segments, so the hue runs red -> white -> blue along the line
    f.at -= dt;
    if (lightning && f.at <= 0) {
      f.at = .05 + Math.random() * .05;
      const segs = [[0, .4, POLE.red.hue], [.4, .6, MIXED_HUE], [.6, 1, POLE.blue.hue]];
      for (const [u0, u1, hue] of segs) lightning.strike(v.copy(pa).lerp(pb, u0).clone(), v2.copy(pa).lerp(pb, u1).clone(), {life: .13 + Math.random() * .08, width: .13, rough: .1, depth: 4, branches: 1, restrikes: 1, intensity: 1.5, hue, follow: segFollow(probes, u0, u1)});
      if (Math.random() < .6) lightning.strike(pa.clone(), pb.clone(), {life: .1, width: .045, rough: .24, depth: 4, branches: 0, restrikes: 0, intensity: 1.2, follow: segFollow(probes, 0, 1)});
      if (Math.random() < .55) {   // a side-arc leaps from the line to the ground
        const u = .1 + Math.random() * .8; pm.copy(pa).lerp(pb, u); v.copy(pm); v.x += (Math.random() - .5) * 3; v.z += (Math.random() - .5) * 3; v.y = ctx.height(v.x, v.z) + .05;
        lightning.strike(pm.clone(), v.clone(), {life: .11, width: .03, rough: .3, depth: 3, branches: 0, restrikes: 0, intensity: .9, hue: MIXED_HUE}); lightning.burst(v, {count: 4, speed: 2.5, up: 1});
      }
    }
  }
  const segFollow = (probes, u0, u1) => { const a = new THREE.Vector3(), b = new THREE.Vector3(), o = [new THREE.Vector3(), new THREE.Vector3()]; return () => { probePoint(probes.red, a); probePoint(probes.blue, b); o[0].lerpVectors(a, b, u0); o[1].lerpVectors(a, b, u1); return o; }; };

  // ---- the foes on the line: current crawls over them and they flare
  const bodyBuf = Array.from({length: 8}, () => new THREE.Vector3());
  function distSeg(a, b, p) { v.subVectors(b, a); const L = v.lengthSq() || 1, u = Math.max(0, Math.min(1, v2.subVectors(p, a).dot(v) / L)); return v2.copy(a).addScaledVector(v, u).distanceTo(p); }
  function updateVictims(tower, probes, dt, time) {
    probePoint(probes.red, pa); probePoint(probes.blue, pb); const seen = new Set();
    for (const e of snapshot?.enemies || []) {
      if (e.hp <= 0 || seen.size >= 6) continue;
      v.fromArray(e.position); v.y += .9; if (distSeg(pa, pb, v) > 3.5) continue;   // cheap reject before touching the body rig
      const n = ctx.bodyPoints?.(e.id, bodyBuf) || 0; let near = Infinity;
      if (n) { for (let i = 0; i < n; i++) { const d = distSeg(pa, pb, bodyBuf[i]); if (d < near) near = d; } }
      else { v.fromArray(e.position); v.y += .9; near = distSeg(pa, pb, v); }
      if (near > STORMREEL.arcReach + (e.kind === 'golem' ? 1 : .35)) continue;
      seen.add(e.id); let x = victims.get(e.id);
      if (!x) { x = {since: 0, shock: 0, flare: makeSprite(scene, tex.soft, 0x7fb8ff, 14)}; victims.set(e.id, x); }
      const centre = n ? bodyBuf[0] : v; x.flare.position.copy(centre); x.flare.position.y += .1; x.flare.scale.setScalar((.9 + .7 * flicker(time, e.id.length * 3.1)) * (e.kind === 'golem' ? 2 : 1)); x.flare.material.opacity = .22 + .22 * flicker(time * 1.7, 2);
      x.since -= dt; x.shock -= dt;
      if (lightning && n >= 2 && x.since <= 0) {
        x.since = .04 + Math.random() * .07; const i = Math.floor(Math.random() * n); let j = Math.floor(Math.random() * n); if (j === i) j = (j + 1) % n;
        lightning.strike(bodyBuf[i].clone(), bodyBuf[j].clone(), {life: .08, width: .022, rough: .32, depth: 3, branches: 0, restrikes: 0, intensity: 1.1, hue: Math.random() < .5 ? POLE.red.hue : POLE.blue.hue});
        if (Math.random() < .5) lightning.burst(bodyBuf[j], {count: 2, speed: 2, life: .3});
      }
      if (x.shock <= 0) {
        x.shock = .22 + Math.random() * .2; sound('shock', at3(centre));
        if (lightning && seen.size <= 2) { v.fromArray(e.position); lightning.ring(v.clone().setY(ctx.height(v.x, v.z) + .05), {radius: e.kind === 'golem' ? 2.2 : 1.1, life: .35, color: 0x9fc8ff}); }
      }
    }
    for (const [id, x] of victims) if (!seen.has(id)) { x.flare.removeFromParent(); x.flare.material.dispose(); victims.delete(id); }
  }

  const a = new THREE.Vector3(), b = new THREE.Vector3();
  function update(dt, time, camPos = new THREE.Vector3(0, 2, 0)) {
    clock += dt; beads.begin();
    const live = new Set(), wearers = new Set(), shownProbes = new Set(), liveWires = new Set(), liveArcs = new Set(), towers = [];
    for (const tower of snapshot?.inventions?.structures || []) {
      if (tower.type !== 'stormspire' || tower.hp <= 0) continue;
      const probes = tower.probes, arcLive = !!(tower.arc && probes?.red && probes?.blue), level = tower.charge > 0 ? (arcLive ? 1 : .12) : 0;
      towers.push({at: tower.position, charge: Math.min(1, (tower.charge || 0) / STORMREEL.maxCharge), working: arcLive});
      for (const colour of PACKS) {
        const key = `${tower.id}:${colour}`, op = tower[OP[colour]], home = homes.get(key), probe = shownProbe(key, probes?.[colour]);
        if (probe) shownProbes.add(key);
        const pose = op ? wearerPose(op) : null; let pack = null, worn = false, strain = 0;
        towerTerminal(tower, a, colour);
        if (op && pose) {
          wearers.add(op); homes.delete(key); away(tower.id, colour, false); worn = true;
          if (op !== ctx.localId()) { pack = packFor(op, colour); if (pack) placePack(pack, pose); }
          exitPoint(pose, pack, b);
          if (pack?.userData.reel) pack.userData.reel.rotation.x = -(cables.get(key)?.length || 0) * 1.8;   // drum turns as cable pays out
          if (op === ctx.localId() || ctx.actorPose(op)) { const crossbow = op === ctx.localId() ? null : ctx.remoteCrossbow?.(op); if (crossbow) finishCrossbow(crossbow, colour); }
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
        if (!c.seeded) seed(c, a, b);
        // The far end pays out toward a lodged bolt instead of jumping to it.
        if (!worn && !home && probe) { v.subVectors(b, c.end); const l = v.length(), step = CABLE.payOut * dt; if (l > step) c.end.addScaledVector(v, step / l); else c.end.copy(b); } else c.end.copy(b);
        const target = worn ? b : c.end; if (worn) strain = cableStrain(tower, [pose.position.x, 0, pose.position.z], colour);
        const path = pinsFor(c, a, target, worn ? cableWraps(tower, colour) : null);
        simulate(c, a, target, home ? 1 : strain, dt, path, worn || home ? STORMREEL.cable : STORMREEL.tether);
        draw(c);
        pulses(c.p, c.glow, colour, level, time, camPos, colour === 'red' ? 0 : .5);
        cableMats[colour].emissiveIntensity = (arcLive ? .5 : level > 0 ? .08 : 0) * (.6 + .4 * flicker(time, 5));
        // A taut cable fizzes at the fairlead as a warning, and groans.
        if (worn && strain > .85) { if (lightning && Math.random() < dt * 6) lightning.burst(b, {count: 2, speed: 1.2}); if (clock > creakAt && op === ctx.localId()) { creakAt = clock + 1.6; sound('creak', strain); } }
        // The filament: crossbow -> bolt, while the wearer still carries the pack and a bolt is out.
        if (worn) {
          const bolt = bolts.find(x => x.key === key && !x.landed), tipOk = muzzleOf(op, v2);
          if (tipOk && (probe || bolt)) {
            const end = bolt ? bolt.pos : probePoint(probe, v);
            drawWire(`${key}:wire`, colour, v2, end, false, time, camPos, arcLive ? 1 : .2); liveWires.add(`${key}:wire`);
          }
        }
      }
      for (const colour of PACKS) {
        const probe = shownProbe(`${tower.id}:${colour}`, probes?.[colour]); if (!probe) continue;
        updateProbe(`${tower.id}:${colour}`, colour, probe, arcLive, camPos, dt, time);
      }
      if (arcLive) {
        liveArcs.add(tower.id); updateArc(tower, probes, dt, time, camPos); updateVictims(tower, probes, dt, time);
        let loop = arcLoops.get(tower.id); if (!loop) { loop = sfx.arcLoop(); if (loop) arcLoops.set(tower.id, loop); }
        if (loop) { pm.copy(pa).lerp(pb, .5); loop.update([pm.x, pm.y, pm.z], dt, Math.min(1, tower.charge / 80)); }
      }
    }
    // retire what is no longer shown
    for (const [key, m] of probeMeshes) if (!shownProbes.has(key)) dropProbeMesh(key);
    for (const key of [...wires.keys()]) if (!liveWires.has(key) && !key.endsWith(':reel')) dropWire(key);
    for (const [id, f] of arcFx) if (!liveArcs.has(id)) { f.sheath.dispose(); arcFx.delete(id); }
    for (const [id, loop] of arcLoops) if (!liveArcs.has(id)) { loop.stop(); arcLoops.delete(id); }
    if (!liveArcs.size && victims.size) { for (const x of victims.values()) { x.flare.removeFromParent(); x.flare.material.dispose(); } victims.clear(); }
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
  return {installPack, installCrossbow, sync, event, update, sfx,
    stats: () => ({cables: cables.size, packs: packs.size, bolts: bolts.length, homes: homes.size, probes: probeMeshes.size, wires: wires.size, reels: reels.length, victims: victims.size, beads: beads.count(), arcs: arcFx.size, audio: sfx.stats()}),
    dispose() {
      for (const id of [...cables.keys()]) dropCable(id); for (const p of packs.values()) p.removeFromParent(); packs.clear();
      for (const k of [...probeMeshes.keys()]) dropProbeMesh(k); for (const k of [...wires.keys()]) dropWire(k);
      for (const f of arcFx.values()) f.sheath.dispose(); arcFx.clear(); for (const l of arcLoops.values()) l.stop(); arcLoops.clear();
      for (const x of victims.values()) { x.flare.removeFromParent(); x.flare.material.dispose(); } victims.clear(); for (const r of reels) r.mesh?.removeFromParent(); reels.length = 0;
      beads.dispose(); sfx.dispose(); for (const t of Object.values(tex)) t?.dispose?.(); for (const m of Object.values(cableMats)) m.dispose();
    }};
}
