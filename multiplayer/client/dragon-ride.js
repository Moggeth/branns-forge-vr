// Dragon streak presentation and the rider's controls. Every dragon in the room is drawn every frame from the shared
// closed-form flight (shared/dragon-streak.js dragonPose) sampled at the presentation tick, so the flight, the rider's
// camera, fireballs in the air and the dive are all smooth at any frame rate and never step with network ticks.
//
// The host owns every hit. The rider's client only aims (a ray from the camera to the ground), paces breath pulses and
// asks for fireballs and dives; what lands, and when, comes back in the snapshot (pending strikes carry their launch and
// impact ticks) and is drawn on the presentation clock. Fire is a pooled additive point system with a hard particle
// cap, plus a few pooled meshes, so a full barrage stays phone- and Quest-safe.
import * as THREE from 'three';
import {DRAGON,dragonPose} from '../shared/dragon-streak.js';
import {buildDragon,animateDragon,setRiderView,DRAGON_SCALE,DRAGON_SEAT,DRAGON_MOUTH} from './dragon-art.js';
import {createDragonAudio} from './dragon-audio.js';
import {createDragonHud} from './dragon-hud.js';

const HZ = 60, MAX_FIRE = 900, MAX_SMOKE = 260, BREATH_PULSE_MS = 104, RECOVER = 48;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n)), smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// --- Particles: one additive "fire" cloud and one soft "smoke" cloud, each a single draw call. --------------------------
function particleCloud(max, {additive, smoke}) {
  const geometry = new THREE.BufferGeometry(), pos = new Float32Array(max * 3), size = new Float32Array(max), age = new Float32Array(max);
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('size', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('age', new THREE.BufferAttribute(age, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const material = new THREE.ShaderMaterial({
    uniforms: {scale: {value: 600}},
    vertexShader: `attribute float size; attribute float age; varying float vAge; uniform float scale;
      void main(){ vAge=age; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*scale/max(.5,-mv.z); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: smoke
      ? `varying float vAge; void main(){ vec2 d=gl_PointCoord-.5; float r=dot(d,d)*4.; if(r>1.)discard; float a=(1.-r)*(1.-vAge)*min(1.,vAge*6.)*.32;
          gl_FragColor=vec4(mix(vec3(.32,.26,.24),vec3(.55,.52,.5),vAge),a); }`
      : `varying float vAge; void main(){ vec2 d=gl_PointCoord-.5; float r=dot(d,d)*4.; if(r>1.)discard; float soft=pow(1.-r,1.6);
          vec3 c=mix(vec3(1.,.97,.75),vec3(1.,.58,.14),smoothstep(0.,.3,vAge)); c=mix(c,vec3(.75,.16,.04),smoothstep(.3,1.,vAge));
          gl_FragColor=vec4(c*soft*(1.-vAge*vAge),1.); }`,
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const points = new THREE.Points(geometry, material); points.frustumCulled = false; points.renderOrder = additive ? 12 : 11;
  const vel = new Float32Array(max * 3), life = new Float32Array(max), t = new Float32Array(max), grow = new Float32Array(max), size0 = new Float32Array(max), drag = new Float32Array(max), lift = new Float32Array(max);
  let count = 0, dropped = 0;
  return {
    points,
    add(x, y, z, vx, vy, vz, seconds, s, {growth = 1.8, damping = 1.2, rise = 0} = {}) {
      if (count >= max) { dropped++; return; }
      const i = count++; pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z; vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
      life[i] = seconds; t[i] = 0; size0[i] = s; grow[i] = growth; drag[i] = damping; lift[i] = rise; size[i] = s; age[i] = 0;
    },
    update(dt) {
      for (let i = 0; i < count; i++) {
        t[i] += dt; const a = t[i] / life[i];
        if (a >= 1) { // swap-remove
          const j = --count; if (i !== j) { for (let k = 0; k < 3; k++) { pos[i * 3 + k] = pos[j * 3 + k]; vel[i * 3 + k] = vel[j * 3 + k]; } life[i] = life[j]; t[i] = t[j]; size0[i] = size0[j]; grow[i] = grow[j]; drag[i] = drag[j]; lift[i] = lift[j]; }
          i--; continue;
        }
        const k = Math.exp(-drag[i] * dt);
        vel[i * 3] *= k; vel[i * 3 + 1] = vel[i * 3 + 1] * k + lift[i] * dt; vel[i * 3 + 2] *= k;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        age[i] = a; size[i] = size0[i] * (1 + grow[i] * a);
      }
      geometry.setDrawRange(0, count);
      for (const n of ['position', 'size', 'age']) { const attr = geometry.attributes[n]; attr.needsUpdate = true; attr.clearUpdateRanges?.(); attr.addUpdateRange?.(0, count * (n === 'position' ? 3 : 1)); }
      points.visible = count > 0;
    },
    clear() { count = 0; geometry.setDrawRange(0, 0); points.visible = false; },
    stats: () => ({count, dropped}),
    dispose() { geometry.dispose(); material.dispose(); },
  };
}

export function createDragonRide({scene, ray, send, report = () => {}, audio, listener, touch = () => false, xr = () => false}) {
  const group = new THREE.Group(); group.name = 'dragonStreak'; scene.add(group);
  const fire = particleCloud(MAX_FIRE, {additive: true}), smoke = particleCloud(MAX_SMOKE, {smoke: true});
  group.add(smoke.points, fire.points);
  const sound = createDragonAudio(audio);
  // Pooled meshes: fireball cores, impact shock rings and the aim ring.
  const coreGeo = new THREE.IcosahedronGeometry(.62, 1), coreMat = new THREE.MeshBasicMaterial({color: 0xffd27a, transparent: true, opacity: .95, blending: THREE.AdditiveBlending, depthWrite: false});
  const ringGeo = new THREE.RingGeometry(.86, 1, 48).rotateX(-Math.PI / 2);
  const cores = [], rings = [];
  const aimRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({color: 0xffb347, transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false}));
  const diveRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({color: 0xff6a2a, transparent: true, opacity: .35, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false}));
  aimRing.renderOrder = diveRing.renderOrder = 20; aimRing.visible = diveRing.visible = false; group.add(aimRing, diveRing);
  const dragons = new Map(), strikes = new Map(), booms = [];
  const local = {id: null, ride: null, held: {breath: false}, pulseAt: 0, aim: new THREE.Vector3(), aimOk: false, wasRiding: false, shake: 0, breathShown: 0, startYaw: null};
  const v = new THREE.Vector3(), w = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), seat = new THREE.Vector3(), mouth = new THREE.Vector3(), camDir = new THREE.Vector3();
  let snapshot = {players: []}, tick = 0, time = 0, hudModel = null, updates = 0;
  const hud = createDragonHud({onCall: () => call(), onAttack: (kind, down) => press(kind, down)});

  // --- Flight with the presentation-only dive swoop layered on top. -------------------------------------------------------
  function diveFor(ownerId, at) {
    let best = null;
    for (const s of strikes.values()) if (s.owner === ownerId && s.kind === 'dive' && at >= s.launch && at <= s.at + RECOVER && (!best || s.launch > best.launch)) best = s;
    return best;
  }
  /** World pose of a dragon at a fractional tick: {position, quaternion, dive 0..1, nose}. */
  function pose(ownerId, ride, at, out = {position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), dive: 0}) {
    const p = dragonPose(ride, at); out.position.fromArray(p.position);
    let yaw = Math.atan2(p.heading[0], p.heading[2]), pitch = 0, roll = p.bank * (1 - p.outro) * p.intro, dive = 0;
    const s = diveFor(ownerId, at);
    if (s) {
      // Swoop down to just above the target, blast it, then climb back to the circle.
      const u = (at - s.launch) / (s.at - s.launch), k = u <= 1 ? .82 * smooth(u) ** 1.4 : .82 * (1 - smooth((at - s.at) / RECOVER));
      v.set(s.x, s.y + 9, s.z); out.position.lerp(v, k); dive = k / .82;
      // Nose follows the swoop: down on the way in, up on the way out.
      pitch = (u <= 1 ? .7 : -.45) * Math.sin(Math.PI * clamp(u <= 1 ? u : (at - s.at) / RECOVER, 0, 1));
      v.set(s.x - out.position.x, 0, s.z - out.position.z); if (u <= 1 && v.lengthSq() > 1) yaw = yaw + .6 * k * Math.atan2(Math.sin(Math.atan2(v.x, v.z) - yaw), Math.cos(Math.atan2(v.x, v.z) - yaw));
    }
    e.set(pitch, yaw, roll, 'YXZ'); out.quaternion.setFromEuler(e); out.dive = dive; out.intro = p.intro; out.outro = p.outro;
    return out;
  }
  const local3 = (arr, scale = DRAGON_SCALE) => v.set(arr[0] * scale, arr[1] * scale, arr[2] * scale);
  function mouthAt(ownerId, ride, at, out) { const p = pose(ownerId, ride, at); return out.copy(local3(DRAGON_MOUTH)).applyQuaternion(p.quaternion).add(p.position); }

  // --- Strikes in flight, remembered across their removal from the snapshot so they land on the presentation clock. -------
  const strikeKey = (owner, s) => `${owner}:${s.kind}:${s.launch}:${s.x.toFixed(2)}:${s.z.toFixed(2)}`;
  function remember(owner, s) { const k = strikeKey(owner, s); if (!strikes.has(k)) strikes.set(k, {owner, ...s, boomed: false, trailAt: 0}); }
  function boom(s, late = false) {
    s.boomed = true; if (late) return;
    const big = s.kind === 'dive', n = big ? 110 : 42, r = big ? DRAGON.dive.radius : DRAGON.fireball.radius;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = (big ? 9 : 6) * (.35 + Math.random()), up = (big ? 7 : 5) * Math.random();
      fire.add(s.x, s.y + .4, s.z, Math.cos(a) * sp, up + 1, Math.sin(a) * sp, .5 + Math.random() * (big ? .9 : .5), (big ? 2.2 : 1.5) * (.6 + Math.random() * .6), {growth: 1.4, damping: 2.4, rise: 2});
    }
    for (let i = 0; i < (big ? 26 : 10); i++) { const a = Math.random() * Math.PI * 2, sp = 2.5 * Math.random(); smoke.add(s.x + Math.cos(a), s.y + 1, s.z + Math.sin(a), Math.cos(a) * sp, 1.5 + Math.random() * 2, Math.sin(a) * sp, 1.6 + Math.random() * 1.2, big ? 4 : 2.6, {growth: 2.2, damping: 1, rise: .8}); }
    fire.add(s.x, s.y + 1.2, s.z, 0, 0, 0, big ? .32 : .22, big ? 16 : 9, {growth: .6, damping: 0}); // the flash
    const ring = rings.find(m => !m.visible) ?? (rings.length < 8 ? (() => { const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({color: 0xffa040, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false})); group.add(m); rings.push(m); return m; })() : null);
    if (ring) { ring.visible = true; ring.position.set(s.x, s.y + .25, s.z); ring.userData = {t: 0, r, life: big ? .7 : .45}; }
    sound.boom([s.x, s.y, s.z], listener?.(), big);
    if (s.owner === local.id) local.shake = Math.max(local.shake, big ? 1 : .45);
  }

  function call() {
    if (xr()) { report('The dragon only flies on screens for now. Take the headset off to ride it.'); return; }
    if (!local.ride) send({call: true});
  }
  const attackOpen = () => !!local.ride && snapshot.tick >= local.ride.start + DRAGON.arriveTicks && snapshot.tick < local.ride.end - DRAGON.leaveTicks;
  function charge(kind, ride = local.ride) {
    if (!ride) return 0;
    if (kind === 'breath') return ride.breath / DRAGON.breath.tank;
    const last = kind === 'fireball' ? ride.fireballTick : ride.diveTick, cd = kind === 'fireball' ? DRAGON.fireball.cooldown : DRAGON.dive.cooldown;
    return clamp((tick - last) / cd, 0, 1);
  }
  function press(kind, down) {
    if (!local.ride) return;
    if (kind === 'breath') { local.held.breath = down; if (down) local.pulseAt = 0; return; }
    if (!down) return;
    if (!attackOpen() || !local.aimOk || charge(kind) < 1) { hud.nudge(kind); return; }
    sound[kind === 'dive' ? 'roar' : 'whoosh'](null, null, kind === 'dive' ? {level: .7, pitch: 1.15} : undefined);
    send({attack: kind, point: local.aim.toArray()});
  }

  function ensureDragon(id) {
    let d = dragons.get(id);
    if (!d) { d = {root: buildDragon(), breath: 0, aim: new THREE.Vector3(), aimSet: false, seen: 0}; group.add(d.root); dragons.set(id, d); }
    return d;
  }
  function emitBreath(d, ownerId, ride, from, to, amount, dt) {
    // A cone of flame from the mouth to the aim point, thickening towards the ground, with flames licking up where it lands.
    w.subVectors(to, from); const len = w.length(); if (len < 1) return; w.divideScalar(len);
    const speed = Math.min(60, len / .42), n = Math.ceil(110 * dt * amount);
    for (let i = 0; i < n; i++) {
      const j = .14 * speed;
      // Starts small at the lips and swells on the way down, so the rider's own flame never blows out the view.
      fire.add(from.x + w.x * .8, from.y + w.y * .8, from.z + w.z * .8, w.x * speed + (Math.random() - .5) * j, w.y * speed + (Math.random() - .5) * j, w.z * speed + (Math.random() - .5) * j,
        len / speed * (.8 + Math.random() * .35), .3 + Math.random() * .25, {growth: 9, damping: .25});
    }
    for (let i = 0; i < Math.ceil(30 * dt * amount); i++) { const a = Math.random() * Math.PI * 2, r = Math.random() * DRAGON.breath.radius; fire.add(to.x + Math.cos(a) * r, to.y + .2, to.z + Math.sin(a) * r, 0, 2 + Math.random() * 2.5, 0, .4 + Math.random() * .4, 1.1, {growth: .8, damping: 1.5, rise: 2}); }
    if (Math.random() < 6 * dt * amount) smoke.add(to.x, to.y + 1.5, to.z, 0, 1.6, 0, 1.8, 2.4, {growth: 2, damping: .8, rise: .6});
  }

  function update(dt, {snapshot: snap, tick: at, localId, now}) {
    snapshot = snap; tick = at; time += dt; local.id = localId; updates++;
    const me = snap.players?.find(p => p.id === localId);
    local.ride = me?.role === 'hero' && me.dragon ? me.dragon : null;
    const listenerPose = listener?.();
    // Remember pending strikes from the snapshot.
    const live = new Set();
    for (const p of snap.players || []) if (p.dragon) { live.add(p.id); for (const s of p.dragon.strikes || []) remember(p.id, s); }
    // Dragons: arrive, fly, leave. A dragon whose ride ended keeps flying away out of view on the same curve for a moment.
    for (const [id, d] of dragons) {
      if (live.has(id)) continue;
      if (!d.ride || at > d.ride.end + 60 || !snap.players?.some(p => p.id === id)) { group.remove(d.root); dragons.delete(id); }
      // Sent home early (the rider switched to God): start the climb away from here instead of finishing the circle.
      else if (!d.leaving && at < d.ride.end - DRAGON.leaveTicks) d.ride = {...d.ride, end: Math.floor(at) + DRAGON.leaveTicks};
      d.leaving = true;
    }
    let breathLevel = 0;
    for (const p of snap.players || []) {
      if (!p.dragon) continue;
      const d = ensureDragon(p.id); d.ride = p.dragon; d.leaving = false;
    }
    for (const [id, d] of dragons) {
      const ride = d.ride, pz = pose(id, ride, Math.min(at, ride.end + 60), d.pz ??= {position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), dive: 0});
      d.root.position.copy(pz.position); d.root.quaternion.copy(pz.quaternion);
      if (at > ride.end) d.root.position.y += (at - ride.end) * .6; // gone home: climbing out of sight
      // Breathing: the rider's own from their held input (no wait), everyone else's from recent pulses in the snapshot.
      const isLocal = id === localId, snapTick = snap.tick ?? 0;
      const want = isLocal ? (local.held.breath && attackOpen() && local.aimOk && ride.breath >= DRAGON.breath.pulseTicks ? 1 : 0) : (live.has(id) && snapTick - ride.breathTick <= 9 ? 1 : 0);
      d.breath += (want - d.breath) * (1 - Math.exp(-dt * (want ? 14 : 8)));
      if (isLocal && local.aimOk) d.aim.copy(local.aim); else if (ride.aim) { v.fromArray(ride.aim); if (!d.aimSet) d.aim.copy(v); else d.aim.lerp(v, 1 - Math.exp(-dt * 10)); }
      d.aimSet = true;
      // The rider's own dragon glides with shallower strokes so its wings stay at the edges of the view.
      const riderView = isLocal && !xr(); if (d.riderView !== riderView) { d.riderView = riderView; setRiderView(d.root, riderView); }
      animateDragon(d.root, time + (id.length % 7), {breath: d.breath, dive: pz.dive, beat: 1 + .6 * (1 - (pz.intro ?? 1)), amp: riderView ? .5 : 1});
      if (d.breath > .05) {
        d.root.updateMatrixWorld(true); mouth.copy(local3(DRAGON_MOUTH)).applyMatrix4(d.root.matrixWorld);
        emitBreath(d, id, ride, mouth, d.aim, d.breath, dt);
        breathLevel = Math.max(breathLevel, isLocal ? d.breath : d.breath * .5);
      }
    }
    sound.breath(breathLevel, null, listenerPose);
    // Strikes: fireball cores and trails while in flight; impacts when the presentation clock reaches them.
    let coreUsed = 0;
    for (const [k, s] of strikes) {
      if (at > s.at + RECOVER + 30) { strikes.delete(k); continue; }
      if (s.boomed) continue;
      if (at >= s.at) { boom(s, at > s.at + 30); continue; }
      if (s.kind !== 'fireball' || at < s.launch) continue;
      const ride = dragons.get(s.owner)?.ride; if (!ride) continue;
      const u = (at - s.launch) / (s.at - s.launch);
      // From the mouth as it was at launch, in an arc that bulges a little upward, to the target.
      if (!s.from) s.from = mouthAt(s.owner, ride, s.launch, new THREE.Vector3()).clone();
      v.copy(s.from).lerp(w.set(s.x, s.y, s.z), u); v.y += Math.sin(Math.PI * u) * 2.2;
      const core = cores[coreUsed] ?? (cores[coreUsed] = (() => { const m = new THREE.Mesh(coreGeo, coreMat); group.add(m); return m; })()); coreUsed++;
      core.visible = true; core.position.copy(v); core.scale.setScalar(.85 + .25 * Math.sin(time * 30 + s.launch));
      for (let i = 0; i < 3; i++) fire.add(v.x + (Math.random() - .5) * .5, v.y + (Math.random() - .5) * .5, v.z + (Math.random() - .5) * .5, (Math.random() - .5) * 1.5, (Math.random() - .5) * 1.5, (Math.random() - .5) * 1.5, .35 + Math.random() * .25, 1.2, {growth: 1, damping: 2});
      if (Math.random() < .35) smoke.add(v.x, v.y, v.z, 0, .5, 0, 1, 1.2, {growth: 2.5, damping: 1});
    }
    for (let i = coreUsed; i < cores.length; i++) cores[i].visible = false;
    for (const ring of rings) if (ring.visible) { const u = (ring.userData.t += dt) / ring.userData.life; if (u >= 1) ring.visible = false; else { ring.scale.setScalar(ring.userData.r * (.25 + .95 * smooth(u))); ring.material.opacity = .9 * (1 - u); } }
    fire.update(dt); smoke.update(dt);
    local.shake = Math.max(0, local.shake - dt * 2.2);
    // The rider's seat (camera) and the turn of the circle, so the view keeps facing the same ground while flying round it.
    let seatOut = null, yawDrift = 0, enter = false;
    if (local.ride && !xr()) {
      const d = dragons.get(localId);
      if (d) {
        d.root.updateMatrixWorld(true); seat.copy(local3(DRAGON_SEAT)).applyMatrix4(d.root.matrixWorld); seatOut = seat;
        yawDrift = -local.ride.dir * 2 * Math.PI / DRAGON.lapSeconds * dt;
        if (!local.wasRiding) { enter = true; const p = dragonPose(local.ride, at); local.startYaw = Math.atan2(-(local.ride.cx - p.position[0]), -(local.ride.cz - p.position[2])); }
      }
    }
    if (local.wasRiding && !local.ride) { local.held.breath = false; aimRing.visible = diveRing.visible = false; }
    local.wasRiding = !!seatOut;
    // HUD.
    hudModel = {streak: me?.streak || 0, need: DRAGON.streak, ready: !!me?.dragonReady, touch: touch(), riding: local.ride ? {
      left: Math.max(0, (local.ride.end - at) / HZ), total: DRAGON.rideTicks / HZ, open: attackOpen(),
      breath: charge('breath'), fireball: charge('fireball'), dive: charge('dive'), held: local.held} : null};
    hud.render(me?.role === 'hero' ? hudModel : {streak: 0, need: DRAGON.streak, ready: false, touch: touch(), riding: null});
    return {seat: seatOut, yawDrift, enter, startYaw: local.startYaw, shake: local.shake};
  }

  /** After the camera is placed: aim from the screen centre, show the target, and pace breath pulses. */
  function aim(camera, nowMs) {
    if (!local.ride || xr()) { aimRing.visible = diveRing.visible = false; return; }
    camera.getWorldPosition(v); camera.getWorldDirection(camDir);
    const far = DRAGON.reach - 5, hit = ray.segment(v.toArray(), [v.x + camDir.x * far, v.y + camDir.y * far, v.z + camDir.z * far]);
    local.aimOk = !!hit?.point;
    if (local.aimOk) local.aim.fromArray(hit.point);
    const open = attackOpen();
    aimRing.visible = local.aimOk; diveRing.visible = local.aimOk && open && charge('dive') >= 1;
    if (local.aimOk) {
      const pulse = 1 + .06 * Math.sin(nowMs / 90);
      aimRing.position.copy(local.aim).y += .2; aimRing.scale.setScalar(DRAGON.breath.radius * pulse); aimRing.material.color.setHex(open ? 0xffb347 : 0x9fb7c9);
      diveRing.position.copy(aimRing.position); diveRing.scale.setScalar(DRAGON.dive.radius);
    }
    if (local.held.breath && open && local.aimOk && nowMs - local.pulseAt >= BREATH_PULSE_MS && local.ride.breath >= DRAGON.breath.pulseTicks) { local.pulseAt = nowMs; send({attack: 'breath', point: local.aim.toArray()}); }
  }

  function event(ev, localId) {
    const lp = listener?.();
    if (ev.kind === 'streak' && ev.id === localId) sound.chime(ev.count);
    if (ev.kind === 'dragon_ready' && ev.id === localId) { sound.fanfare(); report(touch() ? 'Five in a row! Tap Call the Dragon to take to the sky.' : 'Five in a row! Press H to call the dragon.'); }
    if (ev.kind === 'dragon_summon') { sound.roar(ev.id === localId ? null : ev.centre, lp, {level: ev.id === localId ? .85 : .7}); if (ev.id === localId) report(touch() ? 'Dragon away! Drag to aim. Hold Fire Breath, tap Fireballs and Comet Dive.' : 'Dragon away! Aim with the mouse. Hold click to breathe fire, right-click for fireballs, Space to dive.'); }
    if (ev.kind === 'dragon_fireball') { for (const s of ev.shots || []) remember(ev.id, s); if (ev.id !== localId) sound.whoosh(ev.from, lp); }
    if (ev.kind === 'dragon_dive') { remember(ev.id, ev.strike); if (ev.id !== localId) sound.roar(ev.from, lp, {level: .8, pitch: 1.15}); }
    if (ev.kind === 'dragon_impact') {
      // Normally already drawn from the remembered strike; a strike nobody saw launch (a late join) still lands.
      const s = [...strikes.values()].find(s => s.owner === ev.id && s.kind === ev.strike && Math.abs(s.x - ev.position[0]) < .05 && Math.abs(s.z - ev.position[2]) < .05);
      if (!s) boom({owner: ev.id, kind: ev.strike, x: ev.position[0], y: ev.position[1], z: ev.position[2], at: tick, launch: tick});
    }
    if (ev.kind === 'dragon_depart' && ev.id === localId) { sound.roar(null, null, {level: .5, pitch: 1.3}); report('The dragon sets you down. Five more and it will come back!'); }
  }

  /** Keyboard while riding: 1 (hold) or click = breath, 2 or right-click = fireballs, 3 or Space = dive. */
  function key(code, down) {
    if (code === 'Digit1') press('breath', down);
    else if (code === 'Digit2' || code === 'KeyF') press('fireball', down);
    else if (code === 'Digit3' || code === 'Space') press('dive', down);
  }
  return {
    update, aim, event, key, press, call,
    riding: () => !!local.ride && !xr(),
    ready: () => !!snapshot.players?.find(p => p.id === local.id)?.dragonReady,
    isRiding: p => !!p?.dragon,
    stats: () => ({updates, riders: (snapshot.players || []).filter(p => p.dragon).length, dragons: dragons.size, strikes: strikes.size, fire: fire.stats(), smoke: smoke.stats(), audio: sound.stats()}),
    setPointScale(height, fov) { const s = height / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2)); fire.points.material.uniforms.scale.value = s; smoke.points.material.uniforms.scale.value = s; },
    clearInput() { local.held.breath = false; },
    dispose() { sound.stop(); hud.dispose(); fire.dispose(); smoke.dispose(); coreGeo.dispose(); coreMat.dispose(); ringGeo.dispose(); for (const m of [...rings, aimRing, diveRing]) m.material.dispose(); group.removeFromParent(); },
  };
}
