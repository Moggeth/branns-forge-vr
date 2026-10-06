// Stormreel presentation: the orange cable from each Stormspire to whoever wears its reel pack, the pack on remote
// Heroes' backs, the pack winding itself home, and every shot's bolt, filament and lightning.
// Reads snapshots and authority events; never writes gameplay state. Everything visible updates every frame from
// predicted or interpolated positions (the local Hero's predicted body, remote Heroes' smoothed actors).
import * as THREE from 'three';
import {STORMREEL,terminalPoint,hookPoint as sharedHook,cableStrain} from '../shared/stormreel.js';

export const CABLE = Object.freeze({points: 26, sides: 5, radius: .022, iterations: 10, gravity: 9.8, homeSeconds: .8});
const BACK = new THREE.Vector3(0, 1.28, .17);   // pack anchor behind the shoulder blades, actor-local (+Z is behind)

/**
 * ctx:
 *   scene, lightning (lightning-fx), height(x,z), localId(), actorPose(id) -> {position:Vector3, yaw} | null,
 *   localPose() -> {position:Vector3, yaw}, localMuzzle(out) -> Vector3 | null, spireEntry(id) -> invention entry,
 *   spireArt (stormspire-art), audio() -> AudioContext | null
 */
export function createStormreelView(ctx) {
  const {scene, lightning} = ctx;
  let packTemplate = null, boltTemplate = null, snapshot = null;
  const cables = new Map(), packs = new Map(), bolts = [], homes = new Map();
  const v = new THREE.Vector3(), v2 = new THREE.Vector3(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const cableMat = new THREE.MeshStandardMaterial({color: 0xe8622a, roughness: .55, metalness: 0});

  function installPack(gltf) { packTemplate = gltf; }
  function installCrossbow(gltf) { boltTemplate = gltf.scene.getObjectByName('Bolt') || null; }

  // ---- cable: a verlet rope with ground contact, drawn as a small tube rebuilt in place every frame
  function makeCable() {
    const N = CABLE.points, S = CABLE.sides, pos = new Float32Array(N * S * 3), idx = [];
    for (let i = 0; i < N - 1; i++) for (let k = 0; k < S; k++) { const a = i * S + k, b = i * S + (k + 1) % S, c = a + S, d = b + S; idx.push(a, c, b, b, c, d); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage)); geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, cableMat); mesh.frustumCulled = false; mesh.castShadow = false; mesh.raycast = () => {}; mesh.userData.ignoreContact = true; mesh.name = 'StormreelCable';
    scene.add(mesh);
    return {mesh, geo, p: Array.from({length: N}, () => new THREE.Vector3()), o: Array.from({length: N}, () => new THREE.Vector3()), seeded: false, length: 0};
  }
  function seed(c, a, b) {
    for (let i = 0; i < c.p.length; i++) { const t = i / (c.p.length - 1); c.p[i].lerpVectors(a, b, t); c.p[i].y -= Math.sin(t * Math.PI) * .4; c.o[i].copy(c.p[i]); }
    c.seeded = true; c.length = a.distanceTo(b) + .6;
  }
  function simulate(c, a, b, strain, dt) {
    const N = c.p.length, h = Math.min(dt, 1 / 30), g = CABLE.gravity * h * h;
    // Paid-out length: generous slack near the tower, drawing taut as the wearer reaches the end of the drum.
    const d = a.distanceTo(b), want = Math.min(STORMREEL.cable + .5, d * (1.04 - .035 * strain) + .7 * (1 - strain));
    c.length += (want - c.length) * Math.min(1, dt * 3);
    const rest = c.length / (N - 1);
    for (let i = 1; i < N - 1; i++) {
      const p = c.p[i], o = c.o[i], ground = ctx.height(p.x, p.z) + CABLE.radius;
      const onGround = p.y <= ground + .01, damp = onGround ? .55 : .985;   // lying cable drags; hanging cable swings
      const vx = (p.x - o.x) * damp, vy = (p.y - o.y) * .985, vz = (p.z - o.z) * damp;
      o.copy(p); p.x += vx; p.y += vy - g; p.z += vz;
    }
    c.p[0].copy(a); c.p[N - 1].copy(b);
    for (let it = 0; it < CABLE.iterations; it++) {
      for (let i = 0; i < N - 1; i++) {
        const p = c.p[i], n = c.p[i + 1]; v.subVectors(n, p); const l = v.length() || 1e-6, diff = (l - rest) / l;
        const wa = i === 0 ? 0 : .5, wb = i + 1 === N - 1 ? 0 : .5, k = wa + wb; if (!k) continue;
        p.addScaledVector(v, diff * wa / k * (wa && wb ? 1 : 1)); n.addScaledVector(v, -diff * wb / k);
      }
      for (let i = 1; i < N - 1; i++) { const p = c.p[i], ground = ctx.height(p.x, p.z) + CABLE.radius; if (p.y < ground) p.y = ground; }
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
  function dropCable(id) { const c = cables.get(id); if (!c) return; c.mesh.removeFromParent(); c.geo.dispose(); cables.delete(id); }

  // ---- the pack on a wearer's back (remote Heroes; the local Hero is first person and only needs its cable exit)
  function wearerPose(id) { return id === ctx.localId() ? ctx.localPose() : ctx.actorPose(id); }
  function packFor(id) {
    let p = packs.get(id); if (p || !packTemplate) return p || null;
    p = packTemplate.scene.clone(true); p.name = `ReelPack:${id}`;
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

  function sync(s) { snapshot = s; }
  function towerTerminal(b, out) {
    const e = ctx.spireEntry(b.id), t = e ? ctx.spireArt.terminal(e, out) : null;
    return t || out.fromArray(terminalPoint(b));
  }

  // ---- shots
  function event(ev) {
    if (ev.kind === 'storm_pack_home') {
      const c = cables.get(ev.id), from = c ? c.p[c.p.length - 1].clone() : null;
      if (from) homes.set(ev.id, {t: 0, from, by: ev.by});
      const e = ctx.spireEntry(ev.id); if (e && from) e.packAway = true;
      return;
    }
    if (ev.kind === 'storm_charge') { const e = ctx.spireEntry(ev.id); if (e) ctx.spireArt.charged(e, {lightning: !!ev.lightning}); sound(ev.lightning ? 'thunder' : 'charge', ev.position); return; }
    if (ev.kind !== 'storm_bolt') return;
    const local = ev.by === ctx.localId();
    const from = local ? (ctx.localMuzzle(new THREE.Vector3()) || new THREE.Vector3(...ev.origin)) : new THREE.Vector3(...ev.origin);
    const to = new THREE.Vector3(...ev.position), dist = from.distanceTo(to);
    const bolt = {from, to, t: 0, flight: Math.max(.04, dist / 140), ev, mesh: null, landed: false, splash: (ev.splash || []).map(id => snapshot?.enemies?.find(e => e.id === id)).filter(Boolean).map(e => new THREE.Vector3(...e.position))};
    if (boltTemplate) {
      bolt.mesh = boltTemplate.clone(true); bolt.mesh.position.set(0, 0, 0);
      const holder = new THREE.Group(); holder.add(bolt.mesh); scene.add(holder);
      // The authored bolt points along -Z in the crossbow frame; centre it on its own origin.
      bolt.mesh.position.copy(boltTemplate.position).negate(); bolt.holder = holder;
      holder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), to.clone().sub(from).normalize()); holder.position.copy(from);
    }
    bolts.push(bolt); sound(ev.live ? 'zap' : 'twang', ev.origin, local);
  }
  function land(b) {
    const ev = b.ev; b.landed = true;
    if (b.holder) { b.holder.removeFromParent(); b.holder = null; }
    if (!lightning) return;
    // The filament: a hot copper thread from crossbow to bolt; when live the arc rides it, then runs down into the earth.
    lightning.strike(b.from, b.to, {life: ev.live ? .5 : .35, width: .008, rough: .004, depth: 3, branches: 0, restrikes: 0, intensity: ev.live ? .9 : .5, hue: new THREE.Color(1, .55, .3)});
    if (!ev.live) { lightning.burst(b.to, {count: 6, speed: 1.5}); return; }
    const k = .6 + .4 * (ev.charge ?? 1);
    lightning.strike(b.from, b.to, {life: .32, width: .09 * k, rough: .07, branches: 2, restrikes: 2, intensity: 1.1});
    lightning.glow(b.to, {size: 2.2 * k, life: .3});
    lightning.burst(b.to, {count: Math.round(26 * k), speed: 4.5});
    if (ev.earth && ev.grounded) {
      const earth = new THREE.Vector3(...ev.earth);
      if (earth.distanceTo(b.to) > .25) lightning.strike(b.to, earth, {life: .34, width: .08 * k, rough: .14, branches: 1, restrikes: 2});
      lightning.ring(earth, {radius: STORMREEL.stepRadius, life: .55});
      lightning.glow(earth.clone().setY(earth.y + .15), {size: 2.6 * k, life: .4});
      lightning.burst(earth, {count: 18, speed: 3, up: 1});
      for (const s of b.splash) lightning.strike(earth, s.clone().setY(s.y + .9), {life: .28, width: .045, rough: .2, branches: 1, restrikes: 1, intensity: .8});
    } else lightning.burst(b.to, {count: 10, speed: 2, up: 0});
  }

  // ---- audio: synthesised, short and quiet; positional by distance only
  let noise = null;
  function sound(kind, at, local = false) {
    const ac = ctx.audio?.(); if (!ac || ac.state !== 'running') return;
    const pose = ctx.localPose(); const d = at ? Math.hypot(at[0] - pose.position.x, at[2] - pose.position.z) : 0;
    const vol = (local ? 1 : 1 / (1 + d / 6)) * .5; if (vol < .02) return;
    if (!noise) { const len = ac.sampleRate * .6; noise = ac.createBuffer(1, len, ac.sampleRate); const ch = noise.getChannelData(0); for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1; }
    const t = ac.currentTime, out = ac.createGain(); out.gain.value = vol; out.connect(ac.destination);
    const src = ac.createBufferSource(); src.buffer = noise;
    const bp = ac.createBiquadFilter(); bp.type = kind === 'thunder' ? 'lowpass' : 'bandpass';
    const g = ac.createGain(); src.connect(bp).connect(g).connect(out);
    if (kind === 'zap') { bp.frequency.setValueAtTime(3200, t); bp.frequency.exponentialRampToValueAtTime(700, t + .25); bp.Q.value = .7; g.gain.setValueAtTime(.9, t); g.gain.exponentialRampToValueAtTime(.001, t + .35);
      const o = ac.createOscillator(), og = ac.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(48, t + .3); og.gain.setValueAtTime(.25, t); og.gain.exponentialRampToValueAtTime(.001, t + .32); o.connect(og).connect(out); o.start(t); o.stop(t + .33); }
    else if (kind === 'thunder') { bp.frequency.value = 420; g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(.001, t + .6); }
    else if (kind === 'charge') { bp.frequency.setValueAtTime(600, t); bp.frequency.exponentialRampToValueAtTime(2600, t + .4); bp.Q.value = 3; g.gain.setValueAtTime(.4, t); g.gain.exponentialRampToValueAtTime(.001, t + .45); }
    else { bp.frequency.value = 1800; bp.Q.value = 2; g.gain.setValueAtTime(.35, t); g.gain.exponentialRampToValueAtTime(.001, t + .12); }
    src.start(t); src.stop(t + .6);
  }

  const a = new THREE.Vector3(), b = new THREE.Vector3();
  function update(dt, time) {
    const live = new Set(), wearers = new Set();
    for (const tower of snapshot?.inventions?.structures || []) {
      if (tower.type !== 'stormspire' || tower.hp <= 0) continue;
      const home = homes.get(tower.id);
      if (!tower.operator && !home) continue;
      let pose = tower.operator ? wearerPose(tower.operator) : null, pack = null;
      towerTerminal(tower, a);
      if (tower.operator && pose) {
        wearers.add(tower.operator); homes.delete(tower.id);
        const e = ctx.spireEntry(tower.id); if (e) e.packAway = false;
        if (tower.operator !== ctx.localId()) { pack = packFor(tower.operator); if (pack) placePack(pack, pose); }
        exitPoint(pose, pack, b);
        if (pack?.userData.reel) pack.userData.reel.rotation.x = -(cables.get(tower.id)?.length || 0) * 1.8;   // drum turns as cable pays out
      } else if (home) {
        // Winding home: the end of the cable (and the pack on it) zips back along the ground to the hook.
        home.t += dt / CABLE.homeSeconds; const k = Math.min(1, home.t), ease = k * k * (3 - 2 * k);
        const hook = ctx.spireEntry(tower.id) ? ctx.spireArt.hookPoint(ctx.spireEntry(tower.id), v2) : v2.fromArray(sharedHook(tower));
        b.lerpVectors(home.from, hook, ease); b.y += Math.sin(k * Math.PI) * .6;
        if (k >= 1) { homes.delete(tower.id); const e = ctx.spireEntry(tower.id); if (e) e.packAway = false; continue; }
      } else continue;
      live.add(tower.id);
      let c = cables.get(tower.id); if (!c) { c = makeCable(); cables.set(tower.id, c); }
      if (!c.seeded) seed(c, a, b);
      const strain = tower.operator && pose ? cableStrain(tower, [pose.position.x, 0, pose.position.z]) : 0;
      simulate(c, a, b, home ? 1 : strain, dt); draw(c);
      // A taut cable fizzes at the fairlead as a warning.
      if (lightning && strain > .85 && Math.random() < dt * 6) lightning.burst(b, {count: 2, speed: 1.2});
    }
    for (const id of [...cables.keys()]) if (!live.has(id)) dropCable(id);
    for (const [id, p] of packs) if (!wearers.has(id)) { p.removeFromParent(); packs.delete(id); }
    for (let i = bolts.length - 1; i >= 0; i--) {
      const bo = bolts[i]; bo.t += dt;
      const k = Math.min(1, bo.t / bo.flight);
      if (bo.holder) bo.holder.position.lerpVectors(bo.from, bo.to, k);
      if (k >= 1 && !bo.landed) land(bo);
      if (bo.landed) bolts.splice(i, 1);
    }
  }
  return {installPack, installCrossbow, sync, event, update,
    stats: () => ({cables: cables.size, packs: packs.size, bolts: bolts.length, homes: homes.size}),
    dispose() { for (const id of [...cables.keys()]) dropCable(id); for (const p of packs.values()) p.removeFromParent(); packs.clear(); cableMat.dispose(); }};
}
