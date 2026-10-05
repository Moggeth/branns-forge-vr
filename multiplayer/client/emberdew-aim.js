import * as THREE from 'three';
import {EMBERDEW, cinderVelocities} from '../shared/emberdew.js';
import {RANGED_DT} from './ranged-trajectory.js';
// Emberdew landing forecast. Re-integrates the host's flight (shared/combat.js stepCombat for kind 'fuel': drag,
// gravity, trapezoid position) from the live bottle and aim every rendered frame, so the arc never steps with
// network ticks. Cinder Cluster also replays the pop (shared/emberdew.js cinderVelocities) and each little bottle's fall.
// Presentation only: the host still decides where the bottle lands.

const DRAG = Math.exp(-.045 * RANGED_DT), _from = [0, 0, 0], _to = [0, 0, 0], _pos = [0, 0, 0], _vel = [0, 0, 0];

// mode: 'toss' (hip), 'hurl' (aimed), 'cinder' (Cinder Cluster). inherited: the thrower's own velocity [x,y,z] (m/s).
export function flaskLaunch(mode, direction, inherited = [0, 0, 0], out = [0, 0, 0]) {
  const t = mode === 'cinder' ? EMBERDEW.cinder : mode === 'hurl' ? EMBERDEW.hurl : EMBERDEW.toss;
  for (let i = 0; i < 3; i++) out[i] = direction[i] * t.speed + (i === 1 ? t.loft : 0) + (inherited[i] || 0);
  return out;
}

/**
 * forecastFlask({origin, velocity, out, hit, hitWindow, terrainHeight}) -> {count, contact, ticks, hitTick}
 * out: Float32Array of xyz samples (every `sampleEvery` ticks plus the end). terrainHeight(x,z): the shared ground
 * height, checked analytically every tick (cheap). hit(from,to): optional prop/creature query returning
 * {point, normal, earth?} or null; 'earth' answers are ignored (the ground is handled above). hitWindow [first,last]
 * limits those queries to a band of ticks, so the per-frame forecast only re-queries around the last full scan's contact.
 */
export function forecastFlask({origin, velocity, out, hit = null, hitWindow = null, terrainHeight, sampleEvery = 3, maxTicks = 180, untilApex = false}) {
  const cap = Math.floor(out.length / 3), g = EMBERDEW.gravity, dt = RANGED_DT;
  _pos[0] = origin[0]; _pos[1] = origin[1]; _pos[2] = origin[2]; _vel[0] = velocity[0]; _vel[1] = velocity[1]; _vel[2] = velocity[2];
  out[0] = _pos[0]; out[1] = _pos[1]; out[2] = _pos[2];
  let count = 1;
  const push = (x, y, z) => { if (count < cap) { out[count * 3] = x; out[count * 3 + 1] = y; out[count * 3 + 2] = z; count++; } };
  for (let k = 0; k < maxTicks; k++) {
    const nx = _vel[0] * DRAG, ny = _vel[1] * DRAG - g * dt, nz = _vel[2] * DRAG;
    _from[0] = _pos[0]; _from[1] = _pos[1]; _from[2] = _pos[2];
    _pos[0] += (_vel[0] + nx) * .5 * dt; _pos[1] += (_vel[1] + ny) * .5 * dt; _pos[2] += (_vel[2] + nz) * .5 * dt;
    _vel[0] = nx; _vel[1] = ny; _vel[2] = nz;
    // The jug pops on the host step whose new velocity no longer climbs (shared/combat.js stepCombat).
    if (untilApex && _vel[1] <= 0) { push(_pos[0], _pos[1], _pos[2]); return {count, contact: null, ticks: k + 1, hitTick: null, apex: [_pos[0], _pos[1], _pos[2]], apexVelocity: [_vel[0], _vel[1], _vel[2]]}; }
    if (hit && (!hitWindow || (k >= hitWindow[0] && k <= hitWindow[1]))) {
      _to[0] = _pos[0]; _to[1] = _pos[1]; _to[2] = _pos[2];
      const c = hit(_from, _to);
      if (c && !c.earth) { push(c.point[0], c.point[1], c.point[2]); return {count, contact: c, ticks: k + 1, hitTick: k}; }
    }
    if (_vel[1] < 0) {
      const ground = terrainHeight(_pos[0], _pos[2]);
      if (_pos[1] <= ground) {
        // Where the falling path crosses the ground, not the overshoot below it.
        const above = _from[1] - terrainHeight(_from[0], _from[2]), f = above > 0 ? above / (above + ground - _pos[1]) : 1;
        const x = _from[0] + (_pos[0] - _from[0]) * f, z = _from[2] + (_pos[2] - _from[2]) * f;
        push(x, terrainHeight(x, z), z);
        return {count, contact: {point: [x, terrainHeight(x, z), z], normal: [0, 1, 0]}, ticks: k + 1, hitTick: null};
      }
    }
    if (Math.abs(_pos[0]) > 55 || Math.abs(_pos[2]) > 55) break;
    if ((k + 1) % sampleEvery === 0) push(_pos[0], _pos[1], _pos[2]);
  }
  push(_pos[0], _pos[1], _pos[2]);
  return {count, contact: null, ticks: maxTicks, hitTick: null};
}

// Cinder Cluster: the jug's arc up to the pop (into `out`), then where each little bottle lands (into `landings`, xyz).
const _scratch = new Float32Array(3 * 64), _kids = [];
export function forecastCinder({origin, velocity, out, hit = null, hitWindow = null, terrainHeight, landings}) {
  const jug = forecastFlask({origin, velocity, out, hit, hitWindow, terrainHeight, untilApex: true});
  if (!jug.apex) return {...jug, landed: 0};
  let landed = 0;
  for (const v of cinderVelocities(jug.apexVelocity, _kids)) {
    const r = forecastFlask({origin: jug.apex, velocity: v, out: _scratch, terrainHeight, sampleEvery: 60});
    if (r.contact && landings && landed * 3 + 2 < landings.length) { landings[landed * 3] = r.contact.point[0]; landings[landed * 3 + 1] = r.contact.point[1]; landings[landed * 3 + 2] = r.contact.point[2]; landed++; }
  }
  return {...jug, landed};
}

// Small flush rings marking where each Cinder Cluster bottle lands (one InstancedMesh, one draw, additive, depth-tested).
const RING_VS = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`;
const RING_FS = /* glsl */`
uniform float time; uniform vec3 color;
varying vec2 vUv;
void main() {
  float r = length(vUv); if (r > 1.0) discard;
  float aa = fwidth(r) * 1.5 + 1e-3;
  float ring = 1.0 - smoothstep(0.08 - aa, 0.08 + aa, abs(r - 0.78));
  float dot = 1.0 - smoothstep(0.16 - aa, 0.16 + aa, r);
  float pulse = 0.8 + 0.2 * sin(time * 6.0);
  float a = max(ring, dot) * pulse + exp(-pow((r - 0.78) / 0.18, 2.0)) * 0.3;
  if (a < 0.01) discard;
  gl_FragColor = vec4(color * a, 1.0);
}`;
export function createLandingMarkers({max = 6, radius = .42, color = 0xffa040} = {}) {
  const uniforms = {time: {value: 0}, color: {value: new THREE.Color(color)}};
  const geometry = new THREE.PlaneGeometry(2, 2); geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({uniforms, vertexShader: RING_VS, fragmentShader: RING_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2});
  const mesh = new THREE.InstancedMesh(geometry, material, max); mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = 2;
  mesh.name = 'emberdew-landing-markers'; mesh.userData.ignoreContact = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  function set(points, n, time = 0) {
    uniforms.time.value = time; mesh.count = Math.min(n, max);
    for (let i = 0; i < mesh.count; i++) { p.set(points[i * 3], points[i * 3 + 1] + .02, points[i * 3 + 2]); s.setScalar(radius); mesh.setMatrixAt(i, m.compose(p, q, s)); }
    mesh.instanceMatrix.needsUpdate = true; mesh.visible = mesh.count > 0;
  }
  function hide() { mesh.count = 0; mesh.visible = false; }
  function dispose() { mesh.removeFromParent(); geometry.dispose(); material.dispose(); mesh.dispose(); }
  return {object: mesh, set, hide, dispose};
}
