// Timberline projectile presentation: two mirrored bolts plus a live filament.
//
// Two ways to drive it:
//  1. Gameplay-authoritative: call pair.setState({...}) every frame with eye
//     positions, forward/up, tension and optional bow (see setState below).
//  2. Self-running: pair.launch(frame) with the ballista's release payload,
//     then pair.update(dt, camera). Uses timberline-flight.js kinematics.
//     Call pair.impact({time?, point, resistance}) when gameplay reports a hit.
//
// Add pair.group to a world-space parent (the scene): positions are world.
import * as THREE from 'three';
import {TimberlineFilament} from './timberline-filament.js';
import {TIMBERLINE_FLIGHT, timberlinePairState} from './timberline-flight.js';
import {lodOf} from './timberline-ballista.js';

const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _b = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qy = new THREE.Quaternion(), _qp = new THREE.Quaternion();
const _e = new THREE.Vector3(), _v = new THREE.Vector3();

// Readability: beyond `near` metres the bolts scale up smoothly (to
// `maxScale` at `far`) and the filament keeps a minimum on-screen width, so
// both bolts and the crosswise wire still read from the RTS camera.
export const TIMBERLINE_READABILITY = Object.freeze({near: 14, far: 42, maxScale: 2.4, filamentPx: 1.1});

export function createTimberlineBoltPair(gltf, {flight = TIMBERLINE_FLIGHT, sharedMaterials = null, castShadow = true,
  readability = TIMBERLINE_READABILITY} = {}) {
  const src = gltf.scene.clone(true);
  const nodes = {};
  src.traverse((o) => {
    nodes[o.name] = o;
    if (o.isMesh) {
      o.castShadow = castShadow;
      if (sharedMaterials && sharedMaterials[o.material.name]) o.material = sharedMaterials[o.material.name];
    }
  });
  for (const n of ['Bolt_L', 'Bolt_R', 'Bolt_L_FilamentEye', 'Bolt_R_FilamentEye']) {
    if (!nodes[n]) throw new Error(`Timberline bolts GLB missing ${n}`);
  }
  const group = new THREE.Group();
  group.name = 'TimberlineVolley';
  const bolts = {L: nodes.Bolt_L, R: nodes.Bolt_R};
  const eyeLocal = {L: nodes.Bolt_L_FilamentEye.position.clone(), R: nodes.Bolt_R_FilamentEye.position.clone()};
  group.add(bolts.L, bolts.R);
  const mixer = new THREE.AnimationMixer(group);
  const clip = (name) => THREE.AnimationClip.findByName(gltf.animations, name);
  const deploy = mixer.clipAction(clip('Deploy'));
  deploy.setLoop(THREE.LoopOnce, 1); deploy.clampWhenFinished = true;
  const hitClip = mixer.clipAction(clip('Impact'));
  hitClip.setLoop(THREE.LoopOnce, 1); hitClip.clampWhenFinished = true;
  const folded = mixer.clipAction(clip('Folded'));
  folded.play();

  const filament = new TimberlineFilament({length: flight.tautHalf * 2, minPixelRadius: readability ? readability.filamentPx : 0.75});
  group.add(filament.object);

  const lod0 = [], lod1 = [];
  group.traverse((o) => { if (o.isMesh && o !== filament.object) (lodOf(o) === 1 ? lod1 : lod0).push(o); });
  let lodNow = -1;
  const setLod = (l) => { if (l === lodNow) return; lodNow = l; lod0.forEach((m) => { m.visible = l === 0; }); lod1.forEach((m) => { m.visible = l === 1; }); };
  setLod(0);

  let vanesOpen = false;
  let flightT = 0, launchFrame = null, impactInfo = null, alive = false;
  const listeners = new Map();
  const emit = (name, data = {}) => { for (const fn of listeners.get(name) || []) fn({name, ...data}); };

  function placeBolt(tag, eye, forward, up, yawRad, pitchRad = 0) {
    _f.copy(forward).normalize();
    _r.crossVectors(_f, up).normalize();
    _u.crossVectors(_r, _f);
    _b.copy(_f).negate();
    _m.makeBasis(_r, _u, _b);
    _q.setFromRotationMatrix(_m);
    _qy.setFromAxisAngle(_u, tag === 'L' ? yawRad : -yawRad);
    _qp.setFromAxisAngle(_r, pitchRad);
    const bolt = bolts[tag];
    bolt.quaternion.copy(_qy).multiply(_qp).multiply(_q);
    _e.copy(eyeLocal[tag]).multiplyScalar(bolt.scale.x).applyQuaternion(bolt.quaternion);
    bolt.position.copy(eye).sub(_e);
  }

  // Gameplay-driven state. eyeL/eyeR: Vector3 world; forward/up: Vector3;
  // yawOutDeg: outward yaw per bolt; tension: 0..1.3; vaneOpen: bool;
  // bow: {point: Vector3, depth: m, dir: Vector3} | null
  function setState({eyeL, eyeR, forward, up, yawOutDeg = 0, pitchDeg = 0, tension = 1, vaneOpen = true, bow = null}) {
    placeBolt('L', eyeL, forward, up, yawOutDeg * Math.PI / 180, pitchDeg * Math.PI / 180);
    placeBolt('R', eyeR, forward, up, yawOutDeg * Math.PI / 180, pitchDeg * Math.PI / 180);
    if (vaneOpen && !vanesOpen) openVanes();
    filament.setEndpoints(eyeL, eyeR).setTension(tension);
    _v.copy(forward).multiplyScalar(0.45).add(up).negate().normalize();   // slack trails down and back
    filament.setSagDirection(_v);
    if (bow) filament.setBow(bow.point, bow.depth, bow.dir); else filament.setBow(null);
  }

  function openVanes() {
    vanesOpen = true;
    folded.stop();
    deploy.reset().play();
    emit('fins_deploy');
  }

  let wasTaut = false;
  let cfg = flight;
  function launch(frame) {
    // Start the spread from the machine's actual loaded eye spacing.
    if (frame.eyes) cfg = {...flight, loadedHalf: frame.eyes[0].distanceTo(frame.eyes[1]) / 2};
    launchFrame = {
      origin: frame.launch.origin.clone(), forward: frame.launch.forward.clone(),
      right: frame.launch.right.clone(), up: frame.launch.up.clone(),
    };
    flightT = 0; impactInfo = null; alive = true; vanesOpen = false; wasTaut = false;
    deploy.stop(); hitClip.stop(); folded.reset().play();
    group.visible = true;
    bolts.L.scale.setScalar(1); bolts.R.scale.setScalar(1);
    stepFlight(0);
  }

  const A = (v) => [v.x, v.y, v.z];
  const V = (a, out) => out.set(a[0], a[1], a[2]);
  const eyeL = new THREE.Vector3(), eyeR = new THREE.Vector3(), centre = new THREE.Vector3();
  let lastState = null;

  function stepFlight() {
    const lf = launchFrame;
    const s = timberlinePairState(flightT, {origin: A(lf.origin), forward: A(lf.forward), right: A(lf.right), up: A(lf.up)}, cfg, impactInfo);
    lastState = s;
    V(s.left, eyeL); V(s.right, eyeR); V(s.centre, centre);
    let bow = null;
    if (impactInfo && s.bow > 0) {
      bow = {point: impactInfo.point.clone().setY(centre.y), depth: s.bow, dir: lf.forward.clone().negate()};
      // Keep the bow apex on the obstruction side of the chord.
      bow.point.copy(centre).addScaledVector(lf.right, impactInfo.lateral ?? 0);
    }
    _v.copy(lf.forward).applyAxisAngle(lf.right, s.pitchDeg * Math.PI / 180);
    setState({eyeL, eyeR, forward: lf.forward, up: lf.up, yawOutDeg: s.yawOutDeg, pitchDeg: s.pitchDeg,
      tension: s.tension, vaneOpen: s.vaneOpen > 0, bow});
    if (!wasTaut && s.phase === 'taut') { wasTaut = true; filament.pluck(1); emit('filament_taut', {centre: centre.clone()}); }
  }

  // Self-running impact: point = world contact on the filament line,
  // resistance 0 (slices through) .. 1 (stops the pair).
  function impact({point, resistance = 0.6, time = null}) {
    if (!launchFrame) return;
    const lf = launchFrame;
    const lateral = _v.subVectors(point, lf.origin).dot(lf.right);
    impactInfo = {time: time ?? flightT, resistance, point: point.clone(), lateral};
    hitClip.reset().play();
    emit('impact', {point: point.clone(), resistance});
  }

  function update(dt, camera = null, viewportHeight = 1080, lodDistance = 25) {
    if (alive && launchFrame) {
      flightT += dt;
      stepFlight();
      const travelled = centre.distanceTo(lf0());
      if (travelled > cfg.range || (impactInfo && lastState.speedScale < 0.02 && flightT - impactInfo.time > 0.6)) {
        alive = false;
        emit('expired');
      }
    }
    mixer.update(dt);
    filament.update(dt, camera, viewportHeight);
    if (camera) {
      camera.getWorldPosition(_v);
      const d = _v.distanceTo(bolts.L.position);
      setLod(d > lodDistance ? 1 : 0);
      if (readability) {
        const u = THREE.MathUtils.smoothstep(d, readability.near, readability.far);
        const k = 1 + (readability.maxScale - 1) * u;
        bolts.L.scale.setScalar(k);
        bolts.R.scale.setScalar(k);
      }
    }
  }
  const lf0 = () => launchFrame.origin;

  return {
    group, bolts, filament, mixer, nodes,
    get flightTime() { return flightT; },
    get state() { return lastState; },
    get alive() { return alive; },
    setState, launch, impact, update, openVanes,
    kill() { alive = false; group.visible = false; },
    on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); return () => listeners.get(name).delete(fn); },
    forceLod: setLod,
    dispose() { mixer.stopAllAction(); filament.dispose(); group.removeFromParent(); },
  };
}

// Share one material instance per name between the ballista and bolts so
// the textures upload once. Returns {name: material}.
export function collectMaterials(root) {
  const out = {};
  root.traverse((o) => { if (o.isMesh && !out[o.material.name]) out[o.material.name] = o.material; });
  return out;
}
