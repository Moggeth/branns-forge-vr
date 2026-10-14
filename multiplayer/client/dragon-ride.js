// Dragon streak presentation and the rider's controls. Every dragon in the room is drawn every frame from the shared
// closed-form flight (shared/dragon-streak.js dragonPose) sampled at the presentation tick, so the flight, the rider's
// camera, fireballs in the air and the dive are all smooth at any frame rate and never step with network ticks.
//
// The host owns every hit. The rider's client only aims (a ray from the camera to the ground), paces breath pulses and
// asks for fireballs and dives; what lands, and when, comes back in the snapshot (pending strikes carry their launch and
// impact ticks) and is drawn on the presentation clock. Fire lives in client/dragon-fire.js: pooled, capped and a
// handful of draws, so a full barrage stays phone- and Quest-safe.
import * as THREE from 'three';
import {DRAGON,dragonPose,breathGlob,globPosition} from '../shared/dragon-streak.js';
import {buildDragon,animateDragon,setRiderView,DRAGON_SCALE,DRAGON_SEAT,DRAGON_MOUTH} from './dragon-art.js';
import {createDragonAudio} from './dragon-audio.js';
import {createDragonHud} from './dragon-hud.js';
import {createDragonFire} from './dragon-fire.js';

// The chase camera sits this far behind (along the view) and above the dragon, so it rides low in the frame and the
// crosshair looks past it to the ground.
const CHASE = Object.freeze({back: 16, up: 5.2, enterPitch: -.4}), SADDLE_PITCH = -.35, STEER = Object.freeze({dead: .22, full: .85, every: 150});
const HZ = 60, BREATH_PULSE_MS = 104, RECOVER = 48;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n)), smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

export function createDragonRide({scene, ray, height = () => undefined, send, report = () => {}, audio, listener, touch = () => false, xr = () => false}) {
  const group = new THREE.Group(); group.name = 'dragonStreak'; scene.add(group);
  const fx = createDragonFire(group, {lowQuality: touch});
  const sound = createDragonAudio(audio);
  // The aim ring, and the dive's reach around it.
  const ringGeo = new THREE.RingGeometry(.86, 1, 48).rotateX(-Math.PI / 2);
  const aimRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({color: 0xffb347, transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false}));
  const diveRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({color: 0xff6a2a, transparent: true, opacity: .35, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false}));
  aimRing.renderOrder = diveRing.renderOrder = 20; aimRing.visible = diveRing.visible = false; group.add(aimRing, diveRing);
  const dragons = new Map(), strikes = new Map(), pulses = new Map(), booms = [], gp = [0, 0, 0], gv = new THREE.Vector3();
  const local = {id: null, ride: null, held: {breath: false}, pulseAt: 0, aim: new THREE.Vector3(), aimOk: false, wasRiding: false, shake: 0, breathShown: 0, startYaw: null, camera: 'chase', steer: 0, steerAt: 0};
  const v = new THREE.Vector3(), w = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), seat = new THREE.Vector3(), mouth = new THREE.Vector3(), camDir = new THREE.Vector3();
  let snapshot = {players: []}, tick = 0, time = 0, hudModel = null, updates = 0;
  const hud = createDragonHud({onCall: () => call(), onAttack: (kind, down) => press(kind, down), onView: () => toggleCamera()});

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
    const big = s.kind === 'dive';
    if (big) { const d = dragons.get(s.owner); if (d) d.roar = time; }
    fx.impact(s.x, s.y, s.z, big, big ? DRAGON.dive.radius : DRAGON.fireball.radius);
    sound.boom([s.x, s.y, s.z], listener?.(), big);
    if (s.owner === local.id) local.shake = Math.max(local.shake, big ? 1 : .45);
  }

  function call() {
    if (xr()) { report('The Sun Birdy only flies on screens for now. Take the headset off to ride the dragon.'); return; }
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
    if (!d) { d = {root: buildDragon(), breath: 0, aim: new THREE.Vector3(), aimSet: false, seen: 0, roar: time + .9}; group.add(d.root); dragons.set(id, d); }
    return d;
  }
  function update(dt, {snapshot: snap, tick: at, localId, now, view = {yaw: 0, pitch: 0}}) {
    snapshot = snap; tick = at; time += dt; local.id = localId; updates++;
    const me = snap.players?.find(p => p.id === localId);
    local.ride = me?.role === 'hero' && me.dragon ? me.dragon : null;
    const listenerPose = listener?.();
    // Remember pending strikes from the snapshot.
    const live = new Set();
    for (const p of snap.players || []) if (p.dragon) {
      live.add(p.id); for (const s of p.dragon.strikes || []) remember(p.id, s);
      for (const f of p.dragon.flames || []) { const k = `${p.id}:${f.launch}`; if (!pulses.has(k)) pulses.set(k, {...f, globs: f.at.map((_, i) => breathGlob(f, i)), shown: 0}); }
    }
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
      // The rider's own dragon: from the saddle its horns hide and its wings go see-through and glide with shallower
      // strokes, so they stay at the edges of the view; from the chase camera it is shown off whole.
      const riderView = isLocal && !xr() ? local.camera : false; if (d.riderView !== riderView) { d.riderView = riderView; setRiderView(d.root, riderView); }
      const raw = dragonPose(ride, Math.min(at, ride.end + 60));
      const stroke = animateDragon(d.root, time + (id.length % 7), {breath: d.breath, dive: pz.dive, beat: 1 + .6 * (1 - (pz.intro ?? 1)), amp: riderView === 'saddle' ? .5 : 1, arrive: pz.intro ?? 1, leave: pz.outro ?? 0,
        turn: raw.turn ?? 0, bank: raw.bank ?? 0, roar: d.roar ? Math.max(0, Math.sin(Math.PI * Math.min(1, (time - d.roar) / 1.3))) : 0});
      // Each big downstroke pushes air: wisps stream off the wingtips, the rider's view buffets, and low over the ground
      // (the swoop in, a dive) it kicks up a ring of dust and torn grass.
      const power = typeof stroke === 'number' ? stroke : 0;
      if (power > .55 && !d.stroking) {
        d.stroking = true; d.root.updateMatrixWorld(true);
        fx.gust(d.root.position, pz.quaternion, power, height(d.root.position.x, d.root.position.z));
        if (isLocal) local.shake = Math.max(local.shake, .18 * power);
      } else if (power < .3) d.stroking = false;
      if (d.breath > .05) {
        d.root.updateMatrixWorld(true); mouth.copy(local3(DRAGON_MOUTH)).applyMatrix4(d.root.matrixWorld);
        fx.breath(id, mouth, d.aim, d.breath, dt);
        breathLevel = Math.max(breathLevel, isLocal ? d.breath : d.breath * .5);
      } else fx.breathEnd(id);
    }
    sound.breath(breathLevel, null, listenerPose);
    // Strikes: fireballs while in flight; impacts when the presentation clock reaches them.
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
      fx.fireball(v, s.launch * .618 + s.x, dt);
    }
    // Breath globs on their arcs, sampled at the presentation tick, splashing where the host said they land.
    for (const [k, f] of pulses) {
      if (at > f.launch + DRAGON.breath.maxFlight + 30) { pulses.delete(k); continue; }
      f.globs.forEach((g, i) => {
        if (f.shown & (1 << i) || at < f.launch) return;
        globPosition(f, g, Math.min(at, g.at), gp); v.fromArray(gp);
        if (at >= g.at) { f.shown |= 1 << i; if (at < g.at + 20) fx.splash(v.x, v.y, v.z, i === 0 && f.launch % (DRAGON.breath.pulseTicks * 2) < DRAGON.breath.pulseTicks); return; }
        const t = (at - f.launch) / HZ; gv.set(g.v[0], g.v[1] - DRAGON.breath.gravity * t, g.v[2]);
        fx.glob(v, gv, f.launch * .37 + i, dt);
      });
      if (f.shown === (1 << f.globs.length) - 1) pulses.delete(k);
    }
    fx.update(dt);
    local.shake = Math.max(0, local.shake - dt * 2.2);
    // The rider's eye: in the saddle, or the chase camera behind and above along the view. On mounting it faces the way
    // the dragon flies; after that the dragon steers towards wherever the rider looks (see aim), so the view never drifts.
    let seatOut = null, enter = false;
    if (local.ride && !xr()) {
      const d = dragons.get(localId);
      if (d) {
        if (local.camera === 'chase') {
          const cp = Math.cos(view.pitch);
          seat.copy(d.root.position).add(v.set(Math.sin(view.yaw) * cp * CHASE.back, CHASE.up - Math.sin(view.pitch) * CHASE.back, Math.cos(view.yaw) * cp * CHASE.back));
        } else { d.root.updateMatrixWorld(true); seat.copy(local3(DRAGON_SEAT)).applyMatrix4(d.root.matrixWorld); }
        seatOut = seat;
        if (!local.wasRiding) { enter = true; const p = dragonPose(local.ride, at); local.startYaw = Math.atan2(-p.heading[0], -p.heading[2]); }
      }
    }
    if (local.wasRiding && !local.ride) { local.held.breath = false; aimRing.visible = diveRing.visible = false; }
    local.wasRiding = !!seatOut;
    // HUD.
    hudModel = {streak: me?.streak || 0, need: DRAGON.streak, ready: !!me?.dragonReady, touch: touch(), riding: local.ride ? {
      left: Math.max(0, (local.ride.end - at) / HZ), total: DRAGON.rideTicks / HZ, open: attackOpen(),
      breath: charge('breath'), fireball: charge('fireball'), dive: charge('dive'), held: local.held} : null};
    hud.render(me?.role === 'hero' ? hudModel : {streak: 0, need: DRAGON.streak, ready: false, touch: touch(), riding: null});
    return {seat: seatOut, yawDrift: 0, enter, startYaw: local.startYaw, startPitch: local.camera === 'chase' ? CHASE.enterPitch : SADDLE_PITCH, mode: local.camera, shake: local.shake};
  }

  /** After the camera is placed: aim from the screen centre, show the target, and pace breath pulses. */
  function aim(camera, nowMs) {
    if (!local.ride || xr()) { aimRing.visible = diveRing.visible = false; return; }
    camera.getWorldPosition(v); camera.getWorldDirection(camDir);
    const far = DRAGON.reach - 5 + (local.camera === 'chase' ? CHASE.back : 0), hit = ray.segment(v.toArray(), [v.x + camDir.x * far, v.y + camDir.y * far, v.z + camDir.z * far]);
    local.aimOk = !!hit?.point;
    if (local.aimOk) local.aim.fromArray(hit.point);
    const open = attackOpen();
    aimRing.visible = local.aimOk; diveRing.visible = local.aimOk && open && charge('dive') >= 1;
    if (local.aimOk) {
      const pulse = 1 + .06 * Math.sin(nowMs / 90);
      aimRing.position.copy(local.aim).y += .2; aimRing.scale.setScalar(DRAGON.breath.radius * pulse); aimRing.material.color.setHex(open ? 0xffb347 : 0x9fb7c9);
      diveRing.position.copy(aimRing.position); diveRing.scale.setScalar(DRAGON.dive.radius);
    }
    // Steering: the dragon banks towards where the rider looks, in quarter steps, with a dead zone around its nose so
    // small aiming moves don't turn it. Re-sent while the host's current leg disagrees (a steer inside the host's
    // 6-tick window is dropped there).
    if (open) {
      const p = dragonPose(local.ride, tick), want = Math.atan2(camDir.x, camDir.z), diff = Math.atan2(Math.sin(want - p.yaw), Math.cos(want - p.yaw));
      const mag = Math.max(0, Math.abs(diff) - STEER.dead) / STEER.full, q = Math.round(Math.sign(diff) * Math.min(1, mag) * 4) / 4;
      const legs = local.ride.legs, have = legs?.length ? legs[legs.length - 1] : null;
      const agreed = have && !have.forced && Math.abs(have.turn - q * DRAGON.maxTurn) < 1e-6;
      if ((q !== local.steer || !agreed) && !have?.forced && nowMs - local.steerAt >= STEER.every) { local.steer = q; local.steerAt = nowMs; send({steer: q}); }
    }
    if (local.held.breath && open && local.aimOk && nowMs - local.pulseAt >= BREATH_PULSE_MS && local.ride.breath >= DRAGON.breath.pulseTicks) { local.pulseAt = nowMs; send({attack: 'breath', point: local.aim.toArray()}); }
  }

  function event(ev, localId) {
    const lp = listener?.();
    if (ev.kind === 'streak' && ev.id === localId) sound.chime(ev.count);
    if (ev.kind === 'dragon_ready' && ev.id === localId) { sound.fanfare(); report(touch() ? 'Five in a row! Slay Thee, Sun Birdy Above is ready. Tap it to take to the sky.' : 'Five in a row! Slay Thee, Sun Birdy Above is ready. Press H to call the dragon.'); }
    if (ev.kind === 'dragon_summon') { sound.roar(ev.id === localId ? null : ev.centre, lp, {level: ev.id === localId ? .85 : .7}); if (ev.id === localId) report(touch() ? 'Slay Thee, Sun Birdy Above! Look where you want to fly. Hold Fire Breath, tap Fireballs and Comet Dive.' : 'Slay Thee, Sun Birdy Above! The dragon flies where you look. Hold click to breathe fire, right-click for fireballs, Space to dive, C to change view.'); }
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
    else if (code === 'KeyC' && down) toggleCamera();
  }
  /** Chase camera (behind and above) or the saddle; the eye glides between them through the game's camera blend. */
  function toggleCamera() { local.camera = local.camera === 'chase' ? 'saddle' : 'chase'; const k = touch() ? 'Tap the camera' : 'Press C'; report(local.camera === 'chase' ? `Chase view. ${k} for the saddle.` : `Saddle view. ${k} to watch from behind.`); }
  return {
    update, aim, event, key, press, call, toggleCamera, camera: () => local.camera,
    riding: () => !!local.ride && !xr(),
    ready: () => !!snapshot.players?.find(p => p.id === local.id)?.dragonReady,
    isRiding: p => !!p?.dragon,
    stats: () => ({updates, riders: (snapshot.players || []).filter(p => p.dragon).length, dragons: dragons.size, strikes: strikes.size, ...fx.stats(), audio: sound.stats()}),
    setPointScale(height, fov) { const s = height / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2)); fx.setPointScale(s); },
    clearInput() { local.held.breath = false; },
    dispose() { sound.stop(); hud.dispose(); fx.dispose(); ringGeo.dispose(); for (const m of [aimRing, diveRing]) m.material.dispose(); group.removeFromParent(); },
  };
}
