// Keep ballista presentation: Dawnhold's gate Timberlines and Grumblekeep's Gnashjaw rigs (and the retired Sunlance), their shots, chains, stuck lances, impact
// flashes and the operator's sighting arc. Everything moves on the frame clock: shots follow the shared ballistic curve
// from their launch event (shared/home-ballista.js keepShotAt) at the presentation tick, aims ease toward the replicated
// aim (or follow the operator's own aim at once), and pose changes spring rather than snap. A keep Timberline is the
// built Timberline's own model and clips (its pair, stuck bolts and tracers draw with every other Timberline shot in
// invention-view.js), standing on a Dawnhold dais.
import * as THREE from 'three';
import {HOME_MANNED, KEEP_BALLISTA, homeBallistaYaw, keepMuzzle, keepShotAt, keepSpeed, keepStyle, sunDraw} from '../shared/home-ballista.js';
import {machineCycleAge} from '../shared/inventions.js';
import {buildKeepRig, poseKeepRig, prepareKeepKit, rigMuzzle} from './keep-ballista-art.js';
import {createTimberlineBallista} from '../assets-source/timberline-twinbolt-20261003/runtime/timberline-ballista.js';
import {addLadderPlates} from './timberline-ladder-plates.js';

const TIP = {sunlance: 1.8, gnashjaw: 2.56}; // bolt length from its nock (the mesh origin) to its tip
const STUCK_CAP = 20, STUCK_LIFE = 22, LINK = .13, LINKS = 300;
const COLOR = {sunlance: new THREE.Color(0x7cc4ff), dawn: new THREE.Color(0xffc65a), gnashjaw: new THREE.Color(0x8cff4a), dust: new THREE.Color(0xb59a74)};
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const v3 = a => new THREE.Vector3(a[0], a[1], a[2]);

// The dais under a gate Timberline: Dawnhold sandstone, a brass rim and a blue enamel inlay that wakes while it is loaded.
const DAIS = Object.freeze({radius: 1.32, top: .04, depth: .45, stone: 0xb9ad97, brass: 0xc49a52, glow: 0x5fb4ff});
function buildDais() {
  const g = new THREE.Group(); g.name = 'keep-timberline-dais';
  const stone = new THREE.MeshStandardMaterial({color: DAIS.stone, roughness: .86, flatShading: true});
  const brass = new THREE.MeshStandardMaterial({color: DAIS.brass, metalness: .8, roughness: .35, flatShading: true});
  const inlay = new THREE.MeshStandardMaterial({color: DAIS.glow, emissive: DAIS.glow, emissiveIntensity: .9, roughness: .3});
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(DAIS.radius, DAIS.radius + .08, DAIS.depth, 8), stone); pad.position.y = DAIS.top - DAIS.depth / 2; pad.rotation.y = Math.PI / 8;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(DAIS.radius + .01, .035, 4, 8).rotateX(Math.PI / 2), brass); rim.position.y = DAIS.top; rim.rotation.y = Math.PI / 8;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(DAIS.radius * .7, .022, 3, 32).rotateX(Math.PI / 2), inlay); ring.position.y = DAIS.top + .004;
  g.add(pad, rim, ring);
  return {group: g, inlay, dispose() { for (const m of [pad, rim, ring]) m.geometry.dispose(); stone.dispose(); brass.dispose(); inlay.dispose(); }};
}

export function createKeepBallistaView({root, height = () => 0, timberline = () => null}) {
  const group = new THREE.Group(); group.name = 'keep-ballistas'; root.add(group);
  let kit = null, snapshot = null, tick = 0;
  const parts = new Map(), flights = new Map(), stuck = [], fx = [], fxPool = [], localAim = new Map(), localDraw = new Map(), retracts = new Map();
  const boltPools = {sunlance: [], gnashjaw: []};
  // Chains: one instanced draw for every link in the world.
  const linkGeo = new THREE.TorusGeometry(.045, .012, 4, 8).scale(1, 1.6, 1);
  const linkMat = new THREE.MeshStandardMaterial({color: 0x3a3540, metalness: .8, roughness: .45});
  const links = new THREE.InstancedMesh(linkGeo, linkMat, LINKS * 2); links.count = 0; links.frustumCulled = false; group.add(links);
  // Trails: camera-facing ribbons, additive, one shared material per colour.
  const trailMats = {sunlance: new THREE.MeshBasicMaterial({color: COLOR.sunlance, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, vertexColors: true}),
    dawn: new THREE.MeshBasicMaterial({color: COLOR.dawn, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, vertexColors: true})};
  const flashGeo = new THREE.PlaneGeometry(2, 2), glowTex = softGlow(), ringGeo = new THREE.TorusGeometry(1, .06, 4, 32).rotateX(Math.PI / 2);
  // Sighting arc: a thin line along the predicted flight and a small ring where it lands.
  const arcMax = 160, arcGeo = new THREE.BufferGeometry(); arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arcMax * 3), 3));
  const arcMat = new THREE.LineBasicMaterial({color: 0xffe2a0, transparent: true, opacity: .75, depthWrite: false});
  const arc = new THREE.Line(arcGeo, arcMat); arc.frustumCulled = false; arc.visible = false; arc.renderOrder = 6; group.add(arc);
  const landing = new THREE.Mesh(new THREE.TorusGeometry(.6, .035, 4, 28).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({color: 0xffe2a0, transparent: true, opacity: .8, depthWrite: false}));
  landing.visible = false; landing.renderOrder = 6; group.add(landing);
  const sightState = {distance: null, time: null, visible: false};

  function install(gltf) { kit = prepareKeepKit(gltf); return !!kit; }

  /** Take over a home-base ballista part (built by home-base-view) with a keep rig. */
  function adopt(built) {
    if (built.keep) return true;
    const style = keepStyle(built.data.side);
    if (style === 'timberline') return adoptTimberline(built);
    if (!kit) return false;
    const rig = buildKeepRig(kit, style);
    for (const c of [...built.group.children]) built.group.remove(c);
    rig.group.rotation.y = -built.group.rotation.y; // world-aligned inside the placed part
    rig.group.traverse(n => { if (n.isMesh) n.userData.targetId = built.data.id; });
    built.group.add(rig.group); built.head = null; built.bow = null; built.bolt = null;
    built.keep = {rig, style, yaw: homeBallistaYaw(built.data.side) + (built.data.aimYaw || 0), pitch: built.data.aimPitch || 0, flex: .4, string: 1, loaded: 1, spin: 0,
      jaw: 0, jawKick: 0, chomp: 0, recoil: 0, recoilV: 0, flash: 0, wasReady: true, flexV: 0};
    parts.set(built.data.id, built);
    return true;
  }
  // Dawnhold's gate Timberline: the built Timberline's model, facing out of the gate on its dais.
  function adoptTimberline(built) {
    const gltf = timberline(); if (!gltf) return false;
    const machine = createTimberlineBallista(gltf, {castShadow: false}), dais = buildDais();
    addLadderPlates(machine.nodes);
    for (const c of [...built.group.children]) built.group.remove(c);
    const holder = new THREE.Group(); holder.name = 'keep-timberline';
    holder.rotation.y = homeBallistaYaw(built.data.side) - built.group.rotation.y; // the machine's rest heading, world-aligned
    holder.add(dais.group, machine.object); built.group.add(holder);
    holder.traverse(n => { if (n.isMesh) n.userData.targetId = built.data.id; });
    built.head = null; built.bow = null; built.bolt = null;
    built.keep = {style: 'timberline', machine, dais, holder, yaw: built.data.aimYaw || 0, pitch: built.data.aimPitch || 0};
    parts.set(built.data.id, built);
    return true;
  }
  const release = built => { if (built?.keep) { if (built.keep.machine) { built.keep.machine.dispose(); built.keep.dais.dispose(); } parts.delete(built.data.id); built.keep = null; } };

  function sync(s) { snapshot = s; }

  // --- Shots -------------------------------------------------------------------------------------------------
  function takeBolt(style) {
    const pool = boltPools[style]; if (pool.length) { const b = pool.pop(); b.visible = true; return b; }
    const b = kit.nodes.get(style === 'sunlance' ? 'S_Bolt' : 'G_Harpoon').clone(true); b.position.set(0, 0, 0); group.add(b); return b;
  }
  const dropBolt = (style, b) => { b.visible = false; b.scale.setScalar(1); boltPools[style].push(b); };
  function makeTrail(perfect) {
    const n = 22, geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
    const idx = []; for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, perfect ? trailMats.dawn : trailMats.sunlance); mesh.frustumCulled = false; group.add(mesh);
    return {mesh, points: [], n, width: perfect ? .22 : .07, life: perfect ? 1.4 : .35};
  }

  function event(ev) {
    if (!kit) return;
    if (ev.kind === 'keep_ballista_fire') {
      const b = parts.get(ev.part), bolt = takeBolt(ev.style);
      flights.set(ev.id, {id: ev.id, part: ev.part, style: ev.style, o: ev.o, v: ev.v, tick: ev.tick, perfect: ev.perfect, bolt, trail: ev.style === 'sunlance' ? makeTrail(ev.perfect) : null, stop: null});
      if (b?.keep) { b.keep.recoilV = 7; b.keep.flash = 1; b.keep.string = 0; b.keep.loaded = 0; b.keep.flexV -= 6; if (ev.style === 'gnashjaw') b.keep.jawKick = 1; }
      spawnFx('flash', ev.o, ev.perfect ? COLOR.dawn : COLOR[ev.style], ev.perfect ? .7 : .35, .25);
    }
    if (ev.kind === 'keep_ballista_stop') {
      const f = flights.get(ev.id);
      if (f) f.stop = {t: ev.t, at: ev.position, host: ev.host, hostId: ev.hostId, material: ev.material};
      if (ev.style === 'gnashjaw') retracts.set(ev.part, {from: ev.position, start: null, t: ev.t, id: ev.id});
    }
    if (ev.kind === 'keep_ballista_hit') spawnFx('flash', ev.position, ev.perfect ? COLOR.dawn : ev.style === 'gnashjaw' ? COLOR.gnashjaw : COLOR.sunlance, .45, .3);
    if (ev.kind === 'keep_ballista_hook') { const f = flights.get(ev.id); if (f) f.stop = {t: (tickNow() - f.tick) / 60, at: ev.position, host: 'hook'}; const b = parts.get(ev.part); if (b?.keep) b.keep.jawKick = .6; }
    if (ev.kind === 'keep_ballista_burst') { spawnFx('ring', ev.position, COLOR.dawn, KEEP_BALLISTA.sunlance.burst, .55); spawnFx('flash', ev.position, COLOR.dawn, 1.1, .4); }
    if (ev.kind === 'keep_ballista_chomp') { const b = parts.get(ev.part); if (b?.keep) b.keep.chomp = 1; spawnFx('flash', ev.position, COLOR.gnashjaw, .6, .3); }
    if (ev.kind === 'keep_ballista_yank') { const b = parts.get(ev.part); if (b?.keep) b.keep.jawKick = Math.max(b.keep.jawKick, .4); }
    if (ev.kind === 'keep_ballista_release') retracts.set(ev.part, {from: ev.position, start: null, t: 0, id: null, now: true});
    if (ev.kind === 'keep_ballista_draw') { const b = parts.get(ev.part); if (b?.keep) b.keep.flexV += 1.5; }
  }

  function spawnFx(kind, at, color, size, life) {
    let f = fxPool.pop();
    if (!f) { f = {mesh: new THREE.Mesh(flashGeo, new THREE.MeshBasicMaterial({transparent: true, blending: THREE.AdditiveBlending, depthWrite: false}))}; group.add(f.mesh); }
    f.mesh.geometry = kind === 'ring' ? ringGeo : flashGeo; f.mesh.material.map = kind === 'ring' ? null : glowTex; f.mesh.material.needsUpdate = true; f.mesh.material.color.copy(color); f.mesh.quaternion.identity(); f.mesh.position.set(at[0], at[1], at[2]);
    f.kind = kind; f.size = size; f.life = life; f.age = 0; f.mesh.visible = true; fx.push(f);
  }

  function stick(f, at, dir) {
    if (f.style !== 'sunlance') { dropBolt(f.style, f.bolt); return; }
    let host = null, off = null;
    if (f.stop?.host === 'enemy' || f.stop?.host === 'hero') {
      const list = f.stop.host === 'enemy' ? snapshot?.enemies : snapshot?.players, h = list?.find(e => e.id === f.stop.hostId);
      if (h) { host = {kind: f.stop.host, id: h.id}; off = new THREE.Vector3(at[0] - h.position[0], at[1] - h.position[1], at[2] - h.position[2]); }
    }
    // Bury the tip a little in whatever stopped it.
    const p = v3(at).addScaledVector(dir, (f.stop?.host === 'air' ? 0 : .25) - TIP.sunlance);
    f.bolt.position.copy(p); f.bolt.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    stuck.push({bolt: f.bolt, host, off: off && off.addScaledVector(dir, .25 - TIP.sunlance), age: 0, fall: 0, dir: dir.clone()});
    while (stuck.length > STUCK_CAP) { const s = stuck.shift(); dropBolt('sunlance', s.bolt); }
  }

  const tickNow = () => tick;
  const dirAt = (f, t) => { const g = KEEP_BALLISTA.gravity; return new THREE.Vector3(f.v[0], f.v[1] - g * t, f.v[2]).normalize(); };

  function stepFlights(dt, camera) {
    for (const [id, f] of flights) {
      let t = Math.max(0, (tick - f.tick) / 60);
      const ended = f.stop && t >= f.stop.t;
      if (ended) t = f.stop.t;
      const at = ended && f.stop.at ? f.stop.at : keepShotAt(f, t), dir = dirAt(f, t);
      // The bolt mesh's origin is its nock: place it so the tip leads along the curve.
      const nock = v3(at).addScaledVector(dir, -TIP[f.style]);
      f.bolt.position.copy(nock); f.bolt.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
      if (f.trail) pushTrail(f.trail, at, camera, !ended);
      if (ended) {
        flights.delete(id);
        if (f.trail) fading.push(f.trail);
        if (f.style === 'sunlance') { stick(f, at, dir); if (f.stop.host !== 'enemy' && f.stop.host !== 'hero') spawnFx('flash', at, f.stop.host === 'dome' ? COLOR.sunlance : COLOR.dust, .4, .35); }
        else if (f.stop.host === 'hook') hooked.set(f.part, f.bolt);
        else dropBolt('gnashjaw', f.bolt);
      }
    }
  }
  const fading = [], hooked = new Map();
  function pushTrail(tr, at, camera, live) {
    if (live) { tr.points.unshift({p: v3(at), age: 0}); if (tr.points.length > tr.n) tr.points.pop(); }
    writeTrail(tr, camera);
  }
  function writeTrail(tr, camera) {
    const pos = tr.mesh.geometry.attributes.position, col = tr.mesh.geometry.attributes.color, eye = camera?.position || new THREE.Vector3();
    for (let i = 0; i < tr.n; i++) {
      const p = tr.points[Math.min(i, tr.points.length - 1)]?.p;
      if (!p) { pos.setXYZ(i * 2, 0, -999, 0); pos.setXYZ(i * 2 + 1, 0, -999, 0); continue; }
      const q = tr.points[Math.min(i + 1, tr.points.length - 1)]?.p || p, d = p.clone().sub(q), side = d.cross(eye.clone().sub(p)).normalize();
      const fade = (1 - i / tr.n) * Math.max(0, 1 - (tr.points[i]?.age || 0) / tr.life), w = tr.width * (.4 + .6 * (1 - i / tr.n));
      pos.setXYZ(i * 2, p.x + side.x * w, p.y + side.y * w, p.z + side.z * w); pos.setXYZ(i * 2 + 1, p.x - side.x * w, p.y - side.y * w, p.z - side.z * w);
      col.setXYZ(i * 2, fade, fade, fade); col.setXYZ(i * 2 + 1, fade, fade, fade);
    }
    pos.needsUpdate = true; col.needsUpdate = true;
  }

  // --- Chains (Gnashjaw) ----------------------------------------------------------------------------------
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), scl = new THREE.Vector3(1, 1, 1);
  let linkCount = 0;
  function chain(from, to, slack) {
    const d = to.clone().sub(from), len = d.length(); if (len < .2) return;
    const n = Math.min(LINKS, Math.floor(len / LINK)), sag = slack * Math.min(2.5, len * .08);
    let prev = from.clone();
    for (let i = 1; i <= n && linkCount < LINKS * 2; i++) {
      const u = i / n, p = from.clone().lerp(to, u); p.y -= Math.sin(u * Math.PI) * sag;
      const dir = p.clone().sub(prev).normalize(); q.setFromUnitVectors(up, dir);
      if (i % 2) q.multiply(new THREE.Quaternion().setFromAxisAngle(up, Math.PI / 2));
      m4.compose(prev.clone().lerp(p, .5), q, scl); links.setMatrixAt(linkCount++, m4); prev = p;
    }
  }
  function hookTarget(h) {
    const list = h.hero ? snapshot?.players : snapshot?.enemies, t = list?.find(e => e.id === h.target);
    return t ? v3(t.position).add(new THREE.Vector3(h.off?.[0] || 0, h.off?.[1] ?? 1, h.off?.[2] || 0)) : null;
  }

  // --- Sight ------------------------------------------------------------------------------------------------
  /** Draw the predicted flight for the operator while sighting. aim: {yaw, pitch}; charge/perfect for the Sunlance. */
  function sight(partData, aim, {charge = 0, perfect = false, visible = true} = {}) {
    if (!visible || !partData) { arc.visible = landing.visible = false; sightState.visible = false; return sightState; }
    const {at, forward} = keepMuzzle(partData, aim.yaw, aim.pitch), v = keepSpeed(partData, charge, perfect), shot = {o: at, v: forward.map(k => k * v)};
    const pos = arcGeo.attributes.position; let n = 0, hit = null;
    for (let i = 0; i < arcMax; i++) {
      const t = i * .025, p = keepShotAt(shot, t);
      if (i > 0 && height(p[0], p[2]) >= p[1]) {
        // Refine the landing between the last two samples.
        let lo = (i - 1) * .025, hi = t; for (let k = 0; k < 6; k++) { const mid = (lo + hi) / 2, m = keepShotAt(shot, mid); if (height(m[0], m[2]) >= m[1]) hi = mid; else lo = mid; }
        hit = {t: hi, at: keepShotAt(shot, hi)}; pos.setXYZ(n++, ...hit.at); break;
      }
      pos.setXYZ(n++, p[0], p[1], p[2]);
    }
    arcGeo.setDrawRange(0, n); pos.needsUpdate = true; arc.visible = true;
    arcMat.color.set(perfect ? 0xffd36a : partData.side === 'rivals' ? 0xb6ff8a : 0xbfe2ff);
    landing.visible = !!hit; if (hit) { landing.position.set(hit.at[0], hit.at[1] + .05, hit.at[2]); const d = Math.hypot(hit.at[0] - at[0], hit.at[2] - at[2]); landing.scale.setScalar(.6 + d * .02); landing.material.color.copy(arcMat.color); }
    Object.assign(sightState, {visible: true, distance: hit ? Math.hypot(hit.at[0] - at[0], hit.at[2] - at[2]) : null, time: hit?.t ?? null});
    return sightState;
  }

  // --- Per frame ------------------------------------------------------------------------------------------
  function poseTimberline(built, dt, camera) {
    const k = built.keep, data = built.data, alive = data.hp > 0;
    // The operator's own predicted aim drives it at once; everyone else eases toward the replicated aim every frame.
    const mine = localAim.get(data.id), want = mine || {yaw: data.aimYaw || 0, pitch: data.aimPitch || 0}, ease = mine ? 1 : 1 - Math.exp(-dt * 7);
    k.yaw += wrap(want.yaw - k.yaw) * ease; k.pitch += (want.pitch - k.pitch) * ease;
    k.machine.aimImmediate(k.yaw, k.pitch);
    const age = machineCycleAge({fireTick: data.fireTick ?? -1e4, readyTick: data.readyTick ?? 0}, tick);
    k.machine.seekCycle(alive ? age : 99, camera, viewport, {ammo: alive});
    // The inlay glows while a pair sits on the rails and dims through the wind.
    const ready = tick >= (data.readyTick ?? 0);
    k.dais.inlay.emissiveIntensity += ((alive ? (ready ? 1.1 : .35) : 0) - k.dais.inlay.emissiveIntensity) * (1 - Math.exp(-dt * 6));
    k.holder.visible = built.alive > .2 || alive;
    return k;
  }

  function poseFor(built, dt, now) {
    const k = built.keep, data = built.data, alive = data.hp > 0;
    const mine = localAim.get(data.id), aim = mine || (data.operator || data.aimYaw !== undefined ? {yaw: data.aimYaw || 0, pitch: data.aimPitch || 0} : null);
    const wantYaw = homeBallistaYaw(data.side) + (aim?.yaw || 0), wantPitch = aim?.pitch || 0, ease = mine ? 1 : 1 - Math.exp(-dt * 7);
    k.yaw += wrap(wantYaw - k.yaw) * ease; k.pitch += (wantPitch - k.pitch) * ease;
    const ready = tick >= (data.readyTick ?? 0), left = Math.max(0, (data.readyTick ?? 0) - tick), wound = 1 - Math.min(1, left / HOME_MANNED.reloadTicks);
    const winding = !ready && tick - (data.fireTick ?? -1e9) >= HOME_MANNED.fireTicks && !data.hook;
    const boost = (data.helpUntil || 0) > tick ? HOME_MANNED.helperBoost : (data.crankUntil || 0) > tick ? HOME_MANNED.operatorBoost : 1;
    // Draw: the operator's own press is instant; everyone else sees the replicated draw.
    const ld = localDraw.get(data.id), draw = k.style === 'sunlance' ? (ld !== undefined ? sunDraw(0, (now - ld) / 1000 * 60) : sunDraw(data.drawTick, tick)) : {charge: 0, perfect: false};
    const drawing = k.style === 'sunlance' && (ld !== undefined || (data.drawTick !== undefined && data.drawTick !== null));
    const wantFlex = !alive ? 0 : ready ? .45 + (drawing ? .55 * draw.charge : 0) : winding ? .45 * wound : 0;
    // Limbs spring toward their bend, so a release snaps and quivers instead of jumping.
    k.flexV += ((wantFlex - k.flex) * 160 - k.flexV * 14) * dt; k.flex += k.flexV * dt;
    k.string += ((ready || winding ? Math.max(ready ? 1 : wound, 0) : 0) - k.string) * (1 - Math.exp(-dt * (ready ? 12 : 30)));
    const wantLoaded = data.hook || retracts.has(data.id) ? 0 : ready ? 1 : left < 40 ? 1 - left / 40 : 0; k.loaded += (wantLoaded - k.loaded) * (1 - Math.exp(-dt * 10));
    if (winding) k.spin += dt * 5 * boost; if (data.hook && (data.crankUntil > tick || data.helpUntil > tick || !data.operator)) k.spin -= dt * 9;
    k.recoilV += (-k.recoil * 220 - k.recoilV * 18) * dt; k.recoil += k.recoilV * dt;
    // Jaw: kicks open on a shot, chatters while something is on the hook, slams shut on a chomp.
    k.jawKick = Math.max(0, k.jawKick - dt * 2.2); k.chomp = Math.max(0, k.chomp - dt * 2.4);
    const chatter = data.hook ? .12 + Math.abs(Math.sin(now / 1000 * 9)) * .12 : 0;
    const chompOpen = k.chomp > .6 ? (1 - k.chomp) / .4 * .75 : k.chomp * 1.25 * .75;
    k.jaw += (Math.max(k.jawKick * .55, chatter, chompOpen, .04 + Math.sin(now / 1000 * 1.3) * .02) - k.jaw) * (1 - Math.exp(-dt * 22));
    k.flash = Math.max(0, k.flash - dt * 3);
    const perfectPulse = draw.perfect ? 2.5 + Math.sin(now / 1000 * 40) * .8 : 0;
    const glow = k.style === 'sunlance' ? .35 + (drawing ? draw.charge * 2.2 : 0) + perfectPulse + k.flash * 2 : 1.2 + (data.hook ? 1.4 + Math.sin(now / 1000 * 8) * .5 : 0) + k.flash * 1.5;
    poseKeepRig(k.rig, {yaw: k.yaw, pitch: k.pitch, flex: Math.max(-.2, k.flex), string: k.string, back: drawing && ready ? draw.charge * .22 : 0, loaded: alive ? k.loaded : 0,
      spin: k.spin, jaw: k.jaw, recoil: k.recoil, glow, gem: 1.6 + (data.hook ? 1.2 : 0)});
    k.rig.group.visible = built.alive > .2 || alive;
    return k;
  }

  let viewport = 1080;
  function update(dt, renderTick, camera, viewportHeight = viewport) {
    tick = renderTick ?? tick; viewport = viewportHeight;
    if (!kit) { for (const built of parts.values()) if (built.keep.style === 'timberline') poseTimberline(built, dt, camera); return; }
    const now = performance.now();
    for (const built of parts.values()) if (built.keep.style === 'timberline') poseTimberline(built, dt, camera); else poseFor(built, dt, now);
    stepFlights(dt, camera);
    // Chains: from each Gnashjaw's mouth to its harpoon in flight, its hooked catch, or the harpoon winding home.
    linkCount = 0;
    for (const built of parts.values()) {
      if (built.keep.style !== 'gnashjaw') continue;
      const from = rigMuzzle(built.keep.rig), data = built.data;
      const flying = [...flights.values()].find(f => f.part === data.id);
      if (flying) { chain(from, flying.bolt.position.clone(), .6); continue; }
      if (data.hook) {
        const at = hookTarget(data.hook), bolt = hooked.get(data.id) || (hooked.set(data.id, takeBolt('gnashjaw')), hooked.get(data.id));
        if (at) {
          const dir = at.clone().sub(from).normalize(); bolt.visible = true;
          bolt.position.copy(at).addScaledVector(dir, .3 - TIP.gnashjaw); bolt.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
          const reeling = (data.crankUntil || 0) > tick || (data.helpUntil || 0) > tick || !data.operator;
          chain(from, bolt.position.clone(), reeling ? .05 : .3);
        }
        retracts.delete(data.id); continue;
      }
      const hb = hooked.get(data.id); if (hb) { hooked.delete(data.id); retracts.set(data.id, {from: hb.position.toArray(), start: now, t: 0, bolt: hb}); }
      const r = retracts.get(data.id);
      if (r) {
        if (r.start === null) { const f = [...flights.values()].find(f => f.id === r.id); if (f) continue; r.start = now; }
        const u = Math.min(1, (now - r.start) / (KEEP_BALLISTA.gnashjaw.retractTicks / 60 * 1000)), at = v3(r.from).lerp(from, u * u);
        if (!r.bolt) r.bolt = takeBolt('gnashjaw');
        const dir = from.clone().sub(at).normalize().negate(); r.bolt.position.copy(at); r.bolt.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
        chain(from, at, .5 * (1 - u));
        if (u >= 1) { dropBolt('gnashjaw', r.bolt); retracts.delete(data.id); }
      }
    }
    links.count = linkCount; links.instanceMatrix.needsUpdate = true;
    // Stuck lances ride their host, then sink away.
    for (let i = stuck.length - 1; i >= 0; i--) {
      const s = stuck[i]; s.age += dt;
      if (s.host) {
        const list = s.host.kind === 'enemy' ? snapshot?.enemies : snapshot?.players, h = list?.find(e => e.id === s.host.id && e.hp > 0);
        if (h) s.bolt.position.set(h.position[0] + s.off.x, h.position[1] + s.off.y, h.position[2] + s.off.z);
        else { s.host = null; s.fall = .01; }
      }
      if (s.fall) { s.fall += dt; s.bolt.position.y = Math.max(height(s.bolt.position.x, s.bolt.position.z) - .2, s.bolt.position.y - s.fall * s.fall * 4); }
      const fade = Math.max(0, s.age - (STUCK_LIFE - 1.5)) / 1.5;
      if (fade > 0) s.bolt.position.addScaledVector(s.dir, dt * .6);
      if (fade >= 1 || (s.fall && s.fall > 3)) { dropBolt('sunlance', s.bolt); stuck.splice(i, 1); }
    }
    for (let i = fading.length - 1; i >= 0; i--) {
      const tr = fading[i]; for (const p of tr.points) p.age += dt; writeTrail(tr, camera);
      if (tr.points.every(p => p.age >= tr.life)) { tr.mesh.removeFromParent(); tr.mesh.geometry.dispose(); fading.splice(i, 1); }
    }
    for (const f of flights.values()) if (f.trail) for (const p of f.trail.points) p.age += dt;
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i]; f.age += dt; const u = f.age / f.life;
      if (u >= 1) { f.mesh.visible = false; fx.splice(i, 1); fxPool.push(f); continue; }
      f.mesh.scale.setScalar(f.size * (f.kind === 'ring' ? .2 + u * .9 : .4 + u * .8)); if (f.kind !== 'ring' && camera) f.mesh.quaternion.copy(camera.quaternion); f.mesh.material.opacity = (1 - u) * (f.kind === 'ring' ? .8 : .9);
    }
  }

  /** World position of a gate Timberline's sighting eye (the brass ladder's peep), or null. */
  function scopeEye(id, out = new THREE.Vector3()) {
    const built = parts.get(id); if (built?.keep?.style !== 'timberline') return null;
    built.group.updateWorldMatrix(true, true); return built.keep.machine.nodes.Socket_ScopeEye?.getWorldPosition(out) || null;
  }

  return {install, adopt, release, sync, event, update, sight, scopeEye, ready: () => !!kit, sightState,
    setLocalAim(id, aim) { if (aim) localAim.set(id, aim); else localAim.delete(id); },
    /** The operator's own Sunlance draw: a frame time it started at, or null when released or cancelled. */
    setLocalDraw(id, startMs) { if (startMs === null || startMs === undefined) localDraw.delete(id); else localDraw.set(id, startMs); },
    localDraw: (id, now = performance.now()) => { const s = localDraw.get(id); return s === undefined ? null : sunDraw(0, (now - s) / 1000 * 60); },
    stats: () => ({rigs: parts.size, timberlines: [...parts.values()].filter(b => b.keep.style === 'timberline').map(b => ({id: b.data.id, phase: b.keep.machine.state, aim: b.keep.machine.aim, lod: b.keep.machine.lod})), flights: flights.size, stuck: stuck.length, links: links.count, fx: fx.length}),
    dispose() { for (const built of [...parts.values()]) release(built); group.removeFromParent(); linkGeo.dispose(); linkMat.dispose(); flashGeo.dispose(); glowTex.dispose(); ringGeo.dispose(); arcGeo.dispose(); arcMat.dispose(); for (const m of Object.values(trailMats)) m.dispose(); }};
}

/** A soft round glow (white, alpha falls off smoothly) so flashes read as light, not a solid ball. */
function softGlow(n = 64) {
  const px = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const r = Math.hypot(x + .5 - n / 2, y + .5 - n / 2) / (n / 2), a = Math.max(0, 1 - r) ** 2.2, i = (y * n + x) * 4;
    px[i] = px[i + 1] = px[i + 2] = 255; px[i + 3] = Math.round(a * 255);
  }
  const t = new THREE.DataTexture(px, n, n); t.needsUpdate = true; return t;
}
