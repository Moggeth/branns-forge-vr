// Wyrmspout III tank: liquid fire that sloshes. Presentation only.
//
// The model's FuelLiquid is a closed volume filling the glass. One shared shader clips it against a moving surface
// plane (per draw, from that weapon's own state), shades the cut as the liquid's top seen through the glass, and
// lights the body from within: deep red at the bottom, gold at the surface, a bright meniscus and rising bubbles.
//
// The surface is a damped pendulum driven by what the tank actually does in the world, read from its world matrix
// every frame: walking, jumping, turning, the jaw's recoil, the Weapon Inspect turn and a VR hand all slosh it.
//   * effective gravity: the surface wants to face (g + a), so a shove piles the liquid against the far wall;
//   * wall drag: a turning tank drags the surface a little with it; when the turn stops the surface swings back;
//   * waves: sloshing, spraying and Gout stir travelling ripples that decay.
// The level is solved per frame so the volume stays the fuel left, however the tank is tilted (exact for a
// cylinder; the closed form integrates circular segments along the axis).
import * as THREE from 'three';

export const SLOSH = Object.freeze({
  hz: 2.1,           // the tank's slosh frequency (a satisfying lazy swing, slower than a real 5 cm tank)
  damping: .1,       // fraction of critical: low, so it rocks a few times before settling
  maxTilt: 1.15,     // tan of the steepest surface tilt
  drag: .085,        // seconds of turn the surface is dragged along by the walls
  maxAccel: 70,      // m/s², clamps teleports and frame hitches
  headroom: .06,     // a full tank keeps this much air, so the surface always shows
  waveDecay: 1.6,    // 1/s
});
const G = 9.81;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// ------------------------------------------------------------------ volume
// Fraction of a disc (radius 1) below the chord u <= x, and its integral.
const segment = x => x <= -1 ? 0 : x >= 1 ? 1 : (Math.acos(-x) + x * Math.sqrt(1 - x * x)) / Math.PI;
const segmentInt = x => x <= -1 ? 0 : x >= 1 ? x : (x * Math.acos(-x) + Math.sqrt(1 - x * x) - (1 - x * x) ** 1.5 / 3) / Math.PI;
/** Fraction of a capped cylinder (radius r, half-length h, unit axis along local Z) below the plane n·p = d. */
export function volumeBelow(n, d, r, h) {
  const c = n.z, s = Math.max(1e-5, Math.hypot(n.x, n.y));
  if (Math.abs(c) < 1e-4) return segment(d / (s * r));
  const x0 = (d + h * c) / (s * r), x1 = (d - h * c) / (s * r);   // t = -h, t = +h
  return clamp(s * r / (2 * h * c) * (segmentInt(x0) - segmentInt(x1)), 0, 1);
}
/** The plane offset d that leaves `fraction` of the cylinder below n·p = d. */
export function levelFor(n, fraction, r, h) {
  const reach = h * Math.abs(n.z) + r * Math.hypot(n.x, n.y);
  let lo = -reach, hi = reach;
  for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (volumeBelow(n, mid, r, h) < fraction) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

// ------------------------------------------------------------------ physics (one per visual)
export function createSlosh() {
  const s = {
    ready: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), acc: new THREE.Vector3(), quat: new THREE.Quaternion(),
    tilt: new THREE.Vector2(), tiltVel: new THREE.Vector2(), wave: 0, phase: 0, swirl: 0,
    normal: new THREE.Vector3(0, 1, 0),   // world surface normal
  };
  const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _sc = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _dq = new THREE.Quaternion();
  return {
    state: s,
    /** Reset (equip, teleport): the liquid settles level without a kick. */
    reset() { s.ready = false; s.tilt.set(0, 0); s.tiltVel.set(0, 0); s.wave = 0; },
    /** Advance by dt from the tank's world matrix. stir: extra wave energy (spray, Gout) this frame. */
    update(dt, matrixWorld, {stir = 0} = {}) {
      matrixWorld.decompose(_p, _q, _sc);
      if (!(dt > 0)) return s;
      dt = Math.min(dt, .05);
      if (!s.ready || _p.distanceToSquared(s.pos) > .75 * .75) { s.pos.copy(_p); s.vel.set(0, 0, 0); s.acc.set(0, 0, 0); s.quat.copy(_q); s.tilt.set(0, 0); s.tiltVel.set(0, 0); s.normal.set(0, 1, 0); s.ready = true; return s; }
      // Acceleration from the tank's motion, lightly smoothed (finite differences are noisy at uneven frame times).
      _v.copy(_p).sub(s.pos).divideScalar(dt);
      _w.copy(_v).sub(s.vel).divideScalar(dt);
      if (_w.length() > SLOSH.maxAccel) _w.setLength(SLOSH.maxAccel);
      s.acc.lerp(_w, 1 - Math.exp(-dt * 30)); s.vel.copy(_v); s.pos.copy(_p);
      // Angular velocity: ω ≈ axis·angle of (q · q_prev⁻¹) / dt.
      _dq.copy(s.quat).invert().premultiply(_q); if (_dq.w < 0) { _dq.x = -_dq.x; _dq.y = -_dq.y; _dq.z = -_dq.z; _dq.w = -_dq.w; }
      const half = Math.acos(clamp(_dq.w, -1, 1)), sinHalf = Math.sin(half);
      const omega = sinHalf > 1e-6 ? _w.set(_dq.x, _dq.y, _dq.z).multiplyScalar(2 * half / sinHalf / dt) : _w.set(0, 0, 0);
      if (omega.length() > 40) omega.setLength(40);
      s.quat.copy(_q);
      // Target tilt: effective gravity (horizontal part of the acceleration over g) plus the walls dragging the
      // surface around with a turn (ω × up keeps the horizontal component: ω.z, -ω.x).
      const lift = Math.max(2, G + s.acc.y);
      // ω × ŷ = (-ωz, 0, ωx): the direction the walls carry "up".
      const tx = s.acc.x / lift - SLOSH.drag * omega.z, tz = s.acc.z / lift + SLOSH.drag * omega.x;
      const w0 = 2 * Math.PI * SLOSH.hz, k = w0 * w0, c = 2 * SLOSH.damping * w0;
      // Semi-implicit Euler in two substeps keeps it stable at 20 fps.
      for (let i = 0; i < 2; i++) {
        const h = dt / 2;
        s.tiltVel.x += ((tx - s.tilt.x) * k - s.tiltVel.x * c) * h; s.tiltVel.y += ((tz - s.tilt.y) * k - s.tiltVel.y * c) * h;
        s.tilt.x += s.tiltVel.x * h; s.tilt.y += s.tiltVel.y * h;
      }
      const len = s.tilt.length(); if (len > SLOSH.maxTilt) { s.tilt.multiplyScalar(SLOSH.maxTilt / len); s.tiltVel.multiplyScalar(.5); }
      s.normal.set(s.tilt.x, 1, s.tilt.y).normalize();
      // Waves: fed by the swing's speed, vertical jolts and stirring; travel at a steady phase.
      const energy = s.tiltVel.length() * .02 + Math.abs(s.acc.y) * .0004 + stir;
      s.wave = Math.min(1, s.wave * Math.exp(-dt * SLOSH.waveDecay) + energy * dt * 6);
      s.phase += dt * (5 + 6 * s.wave);
      s.swirl += dt * clamp(omega.y, -12, 12) * .5;
      return s;
    },
  };
}

// ------------------------------------------------------------------ shader (one shared material)
const VERT = /* glsl */`
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
varying vec3 vLocal;
varying vec3 vNormalLocal;
void main() {
  vLocal = position; vNormalLocal = normal;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`;
const FRAG = /* glsl */`
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
uniform vec4 uPlane;        // xyz: surface normal (local), w: offset
uniform vec3 uCam;          // camera position (local)
uniform vec4 uMotion;       // x: wave 0..1, y: phase, z: swirl, w: glow (spray/Gout)
uniform vec3 uAxis;         // x: radius, y: half-length, z: time
uniform vec3 uDeep, uMid, uTop, uFoam;
varying vec3 vLocal;
varying vec3 vNormalLocal;
float hash3(vec3 p) { p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
// Surface height offset at a local point: two travelling ripples across the plane, stronger where the swing is.
float wave(vec3 p, vec3 e1, vec3 e2) {
  float u = dot(p, e1), v = dot(p, e2), a = uMotion.x * .0032;
  return a * (sin(u * 230. - uMotion.y) + .6 * sin(v * 310. + uMotion.y * 1.3 + 1.7) + .35 * sin((u + v) * 520. - uMotion.y * 2.1));
}
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = uPlane.xyz;
  vec3 e1 = normalize(abs(n.z) < .9 ? cross(n, vec3(0., 0., 1.)) : cross(n, vec3(1., 0., 0.))), e2 = cross(n, e1);
  float above = dot(vLocal, n) - uPlane.w - wave(vLocal, e1, e2);
  if (above > 0.) discard;
  vec3 col;
  if (gl_FrontFacing) {
    // The body, seen through the glass: deep red at the bottom, gold toward the top, a bright meniscus line.
    float depth = -above, r = uAxis.x;
    col = mix(uTop, uMid, smoothstep(0., r * .55, depth));
    col = mix(col, uDeep, smoothstep(r * .5, r * 1.9, depth));
    col += uFoam * smoothstep(.0022, 0., depth) * .9;
    // Rising bubbles: one jittered cell per lookup, drifting up the surface normal (faster when spraying).
    vec3 q = vec3(dot(vLocal, e1), dot(vLocal, e2), depth + uAxis.z * (.010 + .02 * uMotion.w)) * vec3(380., 380., 260.);
    vec3 cell = floor(q), f = fract(q) - .5;
    vec3 jitter = vec3(hash3(cell), hash3(cell + 17.1), hash3(cell + 41.7)) - .5;
    float b = length(f - jitter * .5), keep = step(.62 - .25 * uMotion.w, hash3(cell + 7.3));
    col += uFoam * keep * smoothstep(.2, .12, b) * smoothstep(.04, .12, b) * .55;
    // Lit from within: the rim of the volume (toward the glass) glows a little brighter.
    float rim = pow(1. - abs(dot(normalize(vNormalLocal), normalize(uCam - vLocal))), 2.);
    col *= .85 + .35 * rim;
  } else {
    // The cut, seen from above: march the eye ray to the surface and shade that point (ripples, foam at the walls,
    // a slow swirl and a glint).
    vec3 dir = normalize(vLocal - uCam);
    float t = (uPlane.w - dot(uCam, n)) / min(-1e-4, dot(dir, n));
    vec3 s = uCam + dir * clamp(t, 0., 10.);
    float axial = length(s.xy), ends = uAxis.y - abs(s.z);
    float wall = min(uAxis.x - axial, ends);
    float u = dot(s, e1), v = dot(s, e2), ang = atan(s.y, s.x) + uMotion.z;
    float ripple = sin(u * 230. - uMotion.y) * .5 + sin(v * 310. + uMotion.y * 1.3 + 1.7) * .3 + sin(ang * 6. + uAxis.z * 2.) * .2;
    col = mix(uMid, uTop, .6 + .3 * ripple * (.35 + uMotion.x));
    col += uFoam * smoothstep(.0035, .0, wall) * (.55 + .4 * uMotion.x);
    vec3 cell = floor(vec3(u, v, uAxis.z * .7) * vec3(420., 420., 1.));
    col += uFoam * step(.93 - .1 * uMotion.w, hash3(cell)) * .35;
    col += vec3(1., .9, .7) * pow(max(0., dot(reflect(dir, n), normalize(vec3(.3, 1., .2)))), 24.) * .5;
  }
  col *= 1. + .55 * uMotion.w;
  gl_FragColor = vec4(col, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const _inv = new THREE.Matrix4(), _cam = new THREE.Vector3();
function beforeRender(renderer, scene, camera, geometry, material) {
  const data = this.userData.wyrmLiquid; if (!data || !material.uniforms?.uPlane) return;
  const u = material.uniforms;
  u.uPlane.value.copy(data.plane); u.uMotion.value.copy(data.motion); u.uAxis.value.copy(data.axis);
  _inv.copy(this.matrixWorld).invert();
  u.uCam.value.copy(_cam.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(_inv));
  material.uniformsNeedUpdate = true;
}

export function createLiquidMaterial() {
  const m = new THREE.ShaderMaterial({
    name: 'WyrmspoutLiquid', vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uPlane: {value: new THREE.Vector4(0, 1, 0, 0)}, uCam: {value: new THREE.Vector3()}, uMotion: {value: new THREE.Vector4()},
      uAxis: {value: new THREE.Vector3(.0236, .056, 0)},
      uDeep: {value: new THREE.Color(.42, .03, .005)}, uMid: {value: new THREE.Color(1., .26, .02)},
      uTop: {value: new THREE.Color(1., .6, .1)}, uFoam: {value: new THREE.Color(1., .9, .55)},
    }]),
  });
  m.userData.wyrmLiquid = true;
  return m;
}

/** Tank dimensions in the liquid mesh's own frame: the longest extent is the axis (local Z after glTF export). */
export function measureTank(mesh) {
  const g = mesh.geometry; if (!g.boundingBox) g.computeBoundingBox();
  const size = g.boundingBox.getSize(new THREE.Vector3());
  return {radius: Math.max(size.x, size.y) / 2, half: size.z / 2};
}

/**
 * Per-frame driver for one visual's liquid. Call after the weapon's pose for this frame is set.
 * fill 0..1 (fuel shown), spray 0..1, gout 1..0 (just hocked), time seconds.
 */
export function driveLiquid(mesh, {dt, fill = 1, spray = 0, gout = 0, time = 0}) {
  const data = mesh.userData.wyrmLiquid ||= {slosh: createSlosh(), tank: measureTank(mesh), plane: new THREE.Vector4(), motion: new THREE.Vector4(), axis: new THREE.Vector3(), normal: new THREE.Vector3()};
  if (mesh.onBeforeRender !== beforeRender) mesh.onBeforeRender = beforeRender;
  mesh.updateWorldMatrix(true, false);
  const s = data.slosh.update(dt, mesh.matrixWorld, {stir: spray * .35 + gout * 2.5});
  // World normal into the mesh's frame (rotation only; the weapon is uniformly scaled).
  _inv.copy(mesh.matrixWorld).invert();
  const n = data.normal.copy(s.normal).transformDirection(_inv);
  const fraction = SLOSH.headroom * .5 + (1 - SLOSH.headroom) * clamp(fill, 0, 1);
  const {radius, half} = data.tank;
  data.plane.set(n.x, n.y, n.z, levelFor(n, fraction, radius, half));
  data.motion.set(s.wave, s.phase, s.swirl, clamp(spray * .8 + gout, 0, 1.4));
  data.axis.set(radius, half, time % 1800);
  mesh.visible = fill > .004;
  return data;
}
