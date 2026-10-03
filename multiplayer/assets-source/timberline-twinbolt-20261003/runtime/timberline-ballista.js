// Timberline ballista presentation controller (Three.js).
// Presentation only: it never decides whether a shot happens. Gameplay calls
// fire() when its authority says so and listens for events.
//
//   const tb = createTimberlineBallista(ballistaGltf);
//   scene.add(tb.object);
//   tb.setAim(yawRad, pitchRad);     // smoothed toward target
//   tb.on('release', ({muzzles, eyes, launch}) => spawnProjectile(...));
//   tb.fire();                        // false if not loaded
//   tb.update(dt, camera);            // every frame
import * as THREE from 'three';
import {TimberlineFilament} from './timberline-filament.js';

const DEG = Math.PI / 180;
const DEFAULT_EVENTS = {
  Fire: [['trigger_pull', 0], ['release', 0.05], ['recoil_peak', 0.085], ['settled', 0.7]],
  Reload: [['reload_start', 0], ['pawl_release', 0.12], ['strings_caught', 0.62], ['winding_start', 0.75],
    ['strings_latched', 2.2], ['bolts_seat', 2.62], ['filament_reset', 2.8], ['reload_complete', 3.15]],
  Idle_Loaded: [['pawl_tick', 1.2]],
};

export const TIMBERLINE_AIM = Object.freeze({
  pitchMin: -8 * DEG, pitchMax: 25 * DEG,
  yawRate: 110 * DEG, pitchRate: 45 * DEG,   // max slew, rad/s
  stiffness: 70,                              // critically damped spring (1/s^2)
});

function readContract(root) {
  let raw = null;
  root.traverse((o) => { if (!raw && o.userData?.timberline) raw = o.userData.timberline; });
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
}

// GLTFLoader splits multi-material meshes into children (Name__LOD1_1 ...),
// so the LOD is read from the nearest ancestor carrying the suffix.
export function lodOf(o) {
  for (let p = o; p; p = p.parent) { const m = /__LOD(\d)/.exec(p.name); if (m) return +m[1]; }
  return -1;
}

function wrapPi(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }

export function createTimberlineBallista(gltf, {lodDistance = 18, autoReload = true, filament = true, castShadow = true} = {}) {
  const object = gltf.scene.clone(true);
  object.name = 'Timberline';
  const nodes = {};
  object.traverse((o) => {
    nodes[o.name] = o;
    if (o.isMesh) { o.castShadow = castShadow; o.receiveShadow = true; }
  });
  const need = ['TimberlineBallista', 'Traverse', 'Elevation', 'Recoil', 'Socket_FilamentHorn',
    'Socket_LoadedEye_L', 'Socket_LoadedEye_R', 'Socket_Muzzle_L', 'Socket_Muzzle_R', 'LoadedBolt_L', 'LoadedBolt_R'];
  for (const n of need) if (!nodes[n]) throw new Error(`Timberline GLB missing node ${n}`);
  const contract = readContract(gltf.scene) || {};
  const events = contract.events || DEFAULT_EVENTS;
  const filamentLength = contract.filament_taut_length || 1.12;

  const lod0 = [], lod1 = [];
  object.traverse((o) => { if (o.isMesh) (lodOf(o) === 1 ? lod1 : lod0).push(o); });

  const mixer = new THREE.AnimationMixer(object);
  const clips = Object.fromEntries(gltf.animations.map((c) => [c.name, c]));
  const action = (name, loop) => {
    const a = mixer.clipAction(clips[name]);
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    a.clampWhenFinished = !loop;
    return a;
  };
  const actions = {
    idle: action('Idle_Loaded', true), fire: action('Fire', false),
    reload: action('Reload', false), unloaded: action('Unloaded', false),
  };

  const listeners = new Map();
  const emit = (name, data = {}) => { for (const fn of listeners.get(name) || []) fn({name, ...data}); for (const fn of listeners.get('*') || []) fn({name, ...data}); };

  // Loaded filament: draped from eye to eye over the horn rest.
  const loadedFilament = filament ? new TimberlineFilament({length: filamentLength}) : null;
  if (loadedFilament) { loadedFilament.object.name = 'TimberlineLoadedFilament'; nodes.Recoil.add(loadedFilament.object); }

  const aim = {yaw: 0, pitch: 0, vy: 0, vp: 0, ty: 0, tp: 0};
  let state = 'loaded';
  let current = actions.idle;
  let clipName = 'Idle_Loaded';
  let lastTime = 0;
  let forcedLod = null;
  let filamentShown = true;
  let boltsOnRails = true;
  current.play();

  const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Vector3();

  function play(next, name, fade = 0.08) {
    next.reset();
    next.play();
    if (current && current !== next) current.crossFadeTo(next, fade, false);
    current = next;
    clipName = name;
    lastTime = 0;
  }

  function socketWorld(name, outPos = new THREE.Vector3(), outQuat = null) {
    const n = nodes[name];
    if (!n) throw new Error(`no socket ${name}`);
    n.updateWorldMatrix(true, false);
    n.getWorldPosition(outPos);
    if (outQuat) n.getWorldQuaternion(outQuat);
    return outPos;
  }

  function launchFrame() {
    object.updateMatrixWorld(true);
    const eyes = [socketWorld('Socket_LoadedEye_L'), socketWorld('Socket_LoadedEye_R')];
    const muzzles = ['L', 'R'].map((t) => {
      const position = socketWorld(`Socket_Muzzle_${t}`, new THREE.Vector3(), new THREE.Quaternion());
      const quaternion = new THREE.Quaternion();
      nodes.Recoil.getWorldQuaternion(quaternion);
      return {position, quaternion};
    });
    nodes.Recoil.getWorldQuaternion(_q);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(_q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(_q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(_q);
    const origin = eyes[0].clone().add(eyes[1]).multiplyScalar(0.5);
    return {muzzles, eyes, launch: {origin, forward, right, up}};
  }

  function fire() {
    if (state !== 'loaded') return false;
    state = 'firing';
    play(actions.fire, 'Fire', 0.03);
    emit('fire_start');
    return true;
  }

  function reload() {
    if (state !== 'empty') return false;
    state = 'reloading';
    boltsOnRails = true;   // the Reload clip keeps them scaled to zero until they are lowered in
    play(actions.reload, 'Reload', 0.05);
    return true;
  }

  function setAim(yaw, pitch) {
    aim.ty = yaw;
    aim.tp = THREE.MathUtils.clamp(pitch, TIMBERLINE_AIM.pitchMin, TIMBERLINE_AIM.pitchMax);
  }

  function aimImmediate(yaw, pitch) {
    setAim(yaw, pitch);
    aim.yaw = aim.ty; aim.pitch = aim.tp; aim.vy = aim.vp = 0;
    applyAim();
  }

  function applyAim() {
    nodes.Traverse.rotation.set(0, aim.yaw, 0);
    nodes.Elevation.rotation.set(aim.pitch, 0, 0);
  }

  function stepAim(dt) {
    const k = TIMBERLINE_AIM.stiffness, c = 2 * Math.sqrt(k);
    const ey = wrapPi(aim.ty - aim.yaw);
    aim.vy += (k * ey - c * aim.vy) * dt;
    aim.vy = THREE.MathUtils.clamp(aim.vy, -TIMBERLINE_AIM.yawRate, TIMBERLINE_AIM.yawRate);
    aim.yaw = wrapPi(aim.yaw + aim.vy * dt);
    const ep = aim.tp - aim.pitch;
    aim.vp += (k * ep - c * aim.vp) * dt;
    aim.vp = THREE.MathUtils.clamp(aim.vp, -TIMBERLINE_AIM.pitchRate, TIMBERLINE_AIM.pitchRate);
    aim.pitch = THREE.MathUtils.clamp(aim.pitch + aim.vp * dt, TIMBERLINE_AIM.pitchMin, TIMBERLINE_AIM.pitchMax);
    applyAim();
  }

  function crossEvents(name, t0, t1) {
    for (const [ev, at] of events[name] || []) {
      if (at > t0 && at <= t1 || (t0 === 0 && at === 0 && t1 > 0)) handleEvent(ev, at);
    }
  }

  function handleEvent(ev, at) {
    if (ev === 'release') {
      const frame = launchFrame();
      filamentShown = false;
      boltsOnRails = false;   // hide on this exact frame: the projectile asset takes over
      emit('release', frame);
      return;
    }
    if (ev === 'filament_reset') filamentShown = true;
    if (ev === 'reload_complete') {
      state = 'loaded';
      emit('reload_complete');
      play(actions.idle, 'Idle_Loaded', 0.15);
      return;
    }
    emit(ev, {clip: clipName, at});
  }

  function update(dt, camera = null, viewportHeight = 1080) {
    stepAim(dt);
    mixer.update(dt);
    const t = current.time;
    if (t < lastTime && clipName === 'Idle_Loaded') { crossEvents(clipName, lastTime, current.getClip().duration); lastTime = 0; }
    crossEvents(clipName, lastTime, t);
    lastTime = t;
    if (clipName === 'Fire' && !current.isRunning() && state === 'firing') {
      state = 'empty';
      if (autoReload) { emit('empty'); reload(); } else { play(actions.unloaded, 'Unloaded', 0.0); emit('empty'); }
    }
    nodes.LoadedBolt_L.visible = nodes.LoadedBolt_R.visible = boltsOnRails;
    object.updateMatrixWorld(true);
    if (loadedFilament) {
      const show = filamentShown && boltsOnRails && nodes.LoadedBolt_L.scale.x > 0.5;
      loadedFilament.object.visible = show;
      if (show) {
        const r = nodes.Recoil;
        nodes.Socket_LoadedEye_L.getWorldPosition(_v); r.worldToLocal(_v);
        nodes.Socket_LoadedEye_R.getWorldPosition(_m); r.worldToLocal(_m);
        loadedFilament.setEndpoints(_v, _m);
        nodes.Socket_FilamentHorn.getWorldPosition(_v); r.worldToLocal(_v);
        loadedFilament.setVia(_v).setTension(0.6).update(dt, camera, viewportHeight);
      }
    }
    if (camera) {
      camera.getWorldPosition(_v);
      object.getWorldPosition(_m);
      setLod(forcedLod ?? (_v.distanceTo(_m) > lodDistance ? 1 : 0));
    }
  }

  let lodNow = -1;
  function setLod(l) {
    if (l === lodNow) return;
    lodNow = l;
    for (const m of lod0) m.visible = l === 0;
    for (const m of lod1) m.visible = l === 1;
  }
  setLod(0);

  return {
    object, nodes, mixer, contract, events,
    get state() { return state; },
    get aim() { return {yaw: aim.yaw, pitch: aim.pitch}; },
    get lod() { return lodNow; },
    loadedFilament,
    setAim, aimImmediate, fire, reload, update, launchFrame,
    socketWorld,
    forceLod(l) { forcedLod = l; if (l != null) setLod(l); },
    setLoadedImmediate() { state = 'loaded'; filamentShown = boltsOnRails = true; play(actions.idle, 'Idle_Loaded', 0); },
    setEmptyImmediate() { state = 'empty'; filamentShown = boltsOnRails = false; play(actions.unloaded, 'Unloaded', 0); },
    on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); return () => listeners.get(name).delete(fn); },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(object);
      loadedFilament?.dispose();
      object.removeFromParent();
    },
  };
}
