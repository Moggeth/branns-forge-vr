import * as THREE from 'three';
// Emberwing curved-draw forecast. The integrator mirrors shared/combat.js
// stepCombat() term for term (dt, curl fraction, drag, gravity, trapezoid
// position, lifetime and +/-55 bounds). No aim assist: it only draws the path.

export const RANGED_DT = 1 / 60;
const GRAVITY = Object.freeze({arrow: 5.8, flame: 5.2, fuel: 15, bolt: 3});
const LIFE = Object.freeze({flame: 48, fuel: 180, arrow: 480, bolt: 480});

// Same shot the weapon controller's end() would send for the current aim.
// curveBase is the controller's latched direction (null when not curving).
export function bowShotFromAim(aimDirection, curveBase, draw, out = {direction: [0, 0, 0], curve: [0, 0, 0], speed: 0}) {
  const d = new THREE.Vector3().fromArray(aimDirection).normalize();
  if (curveBase) {
    const base = new THREE.Vector3().fromArray(curveBase).normalize();
    const angle = Math.min(1.1, Math.acos(THREE.MathUtils.clamp(base.dot(d), -1, 1)));
    const c = new THREE.Vector3().crossVectors(base, d);
    if (c.lengthSq() > 1e-8) c.normalize().multiplyScalar(angle); else c.set(0, 0, 0);
    base.toArray(out.direction); c.toArray(out.curve);
  } else { d.toArray(out.direction); out.curve[0] = out.curve[1] = out.curve[2] = 0; }
  out.speed = 18 + 18 * Math.max(.2, draw ?? .67);
  return out;
}

// Integrates one projectile. Writes xyz samples into `out` (Float32Array) every
// `sampleEvery` ticks plus the final point. `hit(from, to)` is the root's world
// query (terrain/enemy/prop) returning {point:[x,y,z], normal?:[x,y,z]} or null.
// `terrainHeight(x,z)` optionally mirrors the authoritative under-terrain cull.
// Returns {count, ticks, hit, reason}; reason: 'hit'|'terrain'|'bounds'|'life'|'capacity'.
const _from = [0, 0, 0], _to = [0, 0, 0];
export function forecastTrajectory({origin, velocity, curve = [0, 0, 0], kind = 'arrow', out, sampleEvery = 3, hit = null, terrainHeight = null, maxTicks = LIFE[kind] ?? 480}) {
  const cap = Math.floor(out.length / 3), g = GRAVITY[kind] ?? 3, dt = RANGED_DT, drag = Math.exp(-.045 * dt);
  let px = origin[0], py = origin[1], pz = origin[2], vx = velocity[0], vy = velocity[1], vz = velocity[2];
  const len = Math.hypot(curve[0], curve[1], curve[2]);
  const ax = len > 1e-6 ? curve[0] / len : 0, ay = len > 1e-6 ? curve[1] / len : 0, az = len > 1e-6 ? curve[2] / len : 0;
  const fraction = t => 1 - Math.pow(1 - Math.min(1, Math.max(0, t / .85)), 3);
  let count = 0; out[0] = px; out[1] = py; out[2] = pz; count = 1;
  for (let k = 0; k < maxTicks; k++) {
    const age = k * dt; // server: (tick - bornTick - 1) * dt on the k+1th step
    let wx = vx, wy = vy, wz = vz;
    if (len > 1e-6) {
      const angle = len * (fraction(age + dt) - fraction(age)), c = Math.cos(angle), s = Math.sin(angle);
      const dot = ax * vx + ay * vy + az * vz, cx = ay * vz - az * vy, cy = az * vx - ax * vz, cz = ax * vy - ay * vx;
      wx = vx * c + cx * s + ax * dot * (1 - c); wy = vy * c + cy * s + ay * dot * (1 - c); wz = vz * c + cz * s + az * dot * (1 - c);
    }
    const nx = wx * drag, ny = wy * drag - g * dt, nz = wz * drag;
    // Server averages the *pre-curl* stored velocity with the new one.
    const qx = px + (vx + nx) * .5 * dt, qy = py + (vy + ny) * .5 * dt, qz = pz + (vz + nz) * .5 * dt;
    vx = nx; vy = ny; vz = nz;
    let reason = null, contact = null;
    if (hit) { _from[0] = px; _from[1] = py; _from[2] = pz; _to[0] = qx; _to[1] = qy; _to[2] = qz; contact = hit(_from, _to); if (contact) reason = 'hit'; }
    px = qx; py = qy; pz = qz;
    if (!reason && (Math.abs(px) > 55 || Math.abs(pz) > 55)) reason = 'bounds';
    if (!reason && terrainHeight && py < terrainHeight(px, pz) - .5) reason = 'terrain';
    const last = reason || k === maxTicks - 1;
    if (last || (k + 1) % sampleEvery === 0) {
      if (count >= cap) return {count, ticks: k + 1, hit: null, reason: 'capacity'};
      const p = contact?.point;
      out[count * 3] = p ? p[0] : px; out[count * 3 + 1] = p ? p[1] : py; out[count * 3 + 2] = p ? p[2] : pz; count++;
    }
    if (reason) return {count, ticks: k + 1, hit: contact, reason};
  }
  return {count, ticks: maxTicks, hit: null, reason: 'life'};
}

// ------------------------------------------------------------------ visual guide
// Three draws, all depth-tested (never X-ray through terrain), no depth writes:
//  1. ribbon - screen-space expanded strip: gold-white core, ember halo and
//              travelling chevrons; constant apparent width in CSS pixels.
//  2. ring   - flush contact disc (ring + ticks + centre) on the hit surface,
//              scaled with camera distance so it stays legible far away.
//  3. spark  - small upright screen-sized star lifted off the contact point,
//              readable at grazing angles where the flush disc collapses.
// Buffers are preallocated for maxPoints; setPoints() only rewrites them.

const RIBBON_VS = /* glsl */`
attribute vec3 prev;
attribute vec3 next;
attribute vec4 along; // x: side (-1/+1), y: arc length m, z: t 0..1, w: alpha
uniform vec2 resolution;
uniform float widthPx;
varying float vSide;
varying float vS;
varying float vT;
varying float vAlpha;
vec2 toScreen(vec4 c) { return c.xy / c.w * 0.5 * resolution; }
void main() {
  mat4 mvp = projectionMatrix * modelViewMatrix;
  vec4 c = mvp * vec4(position, 1.0);
  vec4 p = mvp * vec4(prev, 1.0);
  vec4 n = mvp * vec4(next, 1.0);
  vSide = along.x; vS = along.y; vT = along.z; vAlpha = along.w;
  if (c.w <= 1e-4) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 sc = toScreen(c);
  vec2 d1 = p.w > 1e-4 ? sc - toScreen(p) : vec2(0.0);
  vec2 d2 = n.w > 1e-4 ? toScreen(n) - sc : vec2(0.0);
  float l1 = length(d1), l2 = length(d2);
  vec2 dir = vec2(1.0, 0.0);
  if (l1 > 1e-3 && l2 > 1e-3) {
    vec2 m = d1 / l1 + d2 / l2;
    dir = dot(m, m) > 1e-6 ? normalize(m) : d2 / l2;
  } else if (l2 > 1e-3) dir = d2 / l2;
  else if (l1 > 1e-3) dir = d1 / l1;
  vec2 nrm = vec2(-dir.y, dir.x);
  float miter = 1.0;
  if (l1 > 1e-3 && l2 > 1e-3) miter = 1.0 / max(0.5, dot(nrm, vec2(-d2.y, d2.x) / l2));
  c.xy += nrm * along.x * widthPx * miter / resolution * c.w;
  gl_Position = c;
}`;

const RIBBON_FS = /* glsl */`
uniform float time;
uniform float coreFrac;
uniform float opacity;
uniform vec3 coreA; uniform vec3 coreB; uniform vec3 haloA; uniform vec3 haloB;
varying float vSide;
varying float vS;
varying float vT;
varying float vAlpha;
void main() {
  float x = abs(vSide);
  float aa = max(fwidth(vSide), 1e-3);
  float core = 1.0 - smoothstep(coreFrac - aa, coreFrac + aa, x);
  float halo = pow(max(0.0, 1.0 - x), 1.6);
  // Travelling chevrons pointing along flight; fade out where they would alias.
  float spacing = 1.1;
  float arm = fract(vS / spacing - time * 0.9) + x * 0.22;
  float band = 1.0 - smoothstep(0.06, 0.06 + max(fwidth(arm) * 1.2, 0.02), abs(arm - 0.5));
  float legible = 1.0 - smoothstep(0.08, 0.3, fwidth(vS) / spacing);
  float chev = band * legible * (1.0 - smoothstep(0.55, 0.95, x));
  vec3 col = mix(mix(haloA, haloB, vT), mix(coreA, coreB, vT), max(core, chev * 0.85));
  float alpha = max(max(core * 0.95, halo * 0.42), chev * 0.8) * vAlpha * opacity;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(col, alpha);
}`;

const MARKER_VS = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const MARKER_FS = /* glsl */`
uniform float time;
uniform vec3 coreColor; uniform vec3 haloColor; uniform float opacity;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float aa = fwidth(r) * 1.5 + 1e-3;
  float ring = 1.0 - smoothstep(0.07 - aa, 0.07 + aa, abs(r - 0.72));
  float centre = 1.0 - smoothstep(0.13 - aa, 0.13 + aa, r);
  // Four slowly turning inward ticks between centre and ring.
  float ang = atan(vUv.y, vUv.x) + time * 0.6;
  float across = abs(fract(ang / 1.5707963 + 0.5) - 0.5) * 1.5707963 * r; // arc distance to nearest tick axis
  float tick = (1.0 - smoothstep(0.035, 0.035 + aa, across)) * step(0.34, r) * step(r, 0.56);
  float pulse = 0.85 + 0.15 * sin(time * 4.0);
  float glow = exp(-pow((r - 0.72) / 0.16, 2.0)) * 0.45 + exp(-r * r * 9.0) * 0.35;
  float core = max(max(ring, centre), tick * 0.9);
  vec3 col = mix(haloColor, coreColor, core);
  float alpha = max(core * pulse, glow) * (1.0 - smoothstep(0.92, 1.0, r)) * opacity;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(col, alpha);
}`;

const SPARK_VS = /* glsl */`
uniform vec2 resolution;
uniform float sizePx;
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  vec4 c = projectionMatrix * modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  c.xy += vUv * sizePx / resolution * c.w;
  gl_Position = c;
}`;

const SPARK_FS = /* glsl */`
uniform vec3 coreColor; uniform vec3 haloColor; uniform float opacity; uniform float time;
varying vec2 vUv;
void main() {
  vec2 q = abs(vUv);
  float diamond = q.x + q.y;
  // Four-point star: concave diamond with long thin rays along the axes.
  float star = min(diamond * 1.6, max(q.x, q.y) * 0.45 + min(q.x, q.y) * 4.0);
  float aa = fwidth(star) + 1e-3;
  float core = 1.0 - smoothstep(0.42 - aa, 0.42 + aa, star);
  float halo = exp(-diamond * diamond * 5.0) * 0.5;
  float pulse = 0.9 + 0.1 * sin(time * 5.0);
  vec3 col = mix(haloColor, coreColor, core);
  float alpha = max(core, halo) * pulse * opacity;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(col, alpha);
}`;

// Same interface as before: {object, update, setPoints, hide, dispose, buffer, maxPoints}
// plus optional setViewport(). `width` is the ribbon's full apparent width in CSS
// pixels (halo included; mobile callers may pass ~12). `color`/`tail` tint the
// core near/far, `halo`/`haloTail` the ember glow. Legacy `dotSize` is ignored.
export function createTrajectoryGuide({maxPoints = 192, color = 0xfff1cf, tail = 0xffc35a, halo = 0xff7a26, haloTail = 0xc9361a, width = 9, coreWidth = 2.4, markerRadius = .32, sparkPx = 22, opacity = 1} = {}) {
  const positions = new Float32Array(maxPoints * 3);
  const verts = maxPoints * 2;
  const vPos = new Float32Array(verts * 3), vPrev = new Float32Array(verts * 3), vNext = new Float32Array(verts * 3), vAlong = new Float32Array(verts * 4);
  const index = new (verts > 65535 ? Uint32Array : Uint16Array)(Math.max(0, maxPoints - 1) * 6);
  for (let i = 0; i < maxPoints - 1; i++) {
    const a = i * 2, o = i * 6;
    index[o] = a; index[o + 1] = a + 1; index[o + 2] = a + 2; index[o + 3] = a + 2; index[o + 4] = a + 1; index[o + 5] = a + 3;
  }
  const geometry = new THREE.BufferGeometry();
  const dyn = (arr, n) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', dyn(vPos, 3));
  geometry.setAttribute('prev', dyn(vPrev, 3));
  geometry.setAttribute('next', dyn(vNext, 3));
  geometry.setAttribute('along', dyn(vAlong, 4));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.setDrawRange(0, 0);

  const resolution = new THREE.Vector2(1280, 720), time = {value: 0};
  let manualViewport = false, pixelRatio = 1;
  const ribbonUniforms = {
    resolution: {value: resolution}, widthPx: {value: width}, time, coreFrac: {value: coreWidth / width}, opacity: {value: opacity},
    coreA: {value: new THREE.Color(color)}, coreB: {value: new THREE.Color(tail)}, haloA: {value: new THREE.Color(halo)}, haloB: {value: new THREE.Color(haloTail)},
  };
  const common = {transparent: true, depthTest: true, depthWrite: false, toneMapped: false};
  const material = new THREE.ShaderMaterial({...common, uniforms: ribbonUniforms, vertexShader: RIBBON_VS, fragmentShader: RIBBON_FS, side: THREE.DoubleSide});
  const ribbon = new THREE.Mesh(geometry, material);
  ribbon.name = 'emberwing-trajectory-ribbon'; ribbon.frustumCulled = false; ribbon.renderOrder = 2;

  const markerGeometry = new THREE.PlaneGeometry(2, 2);
  const markerMaterial = new THREE.ShaderMaterial({...common, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: {time, coreColor: {value: new THREE.Color(color)}, haloColor: {value: new THREE.Color(halo)}, opacity: {value: opacity}},
    vertexShader: MARKER_VS, fragmentShader: MARKER_FS});
  const ring = new THREE.Mesh(markerGeometry, markerMaterial);
  ring.name = 'emberwing-trajectory-contact'; ring.visible = false; ring.renderOrder = 2; ring.frustumCulled = false;

  const sparkGeometry = new THREE.PlaneGeometry(2, 2);
  const sparkUniforms = {resolution: {value: resolution}, sizePx: {value: sparkPx}, time, coreColor: {value: new THREE.Color(color)}, haloColor: {value: new THREE.Color(halo)}, opacity: {value: opacity}};
  const sparkMaterial = new THREE.ShaderMaterial({...common, uniforms: sparkUniforms, vertexShader: SPARK_VS, fragmentShader: SPARK_FS});
  const spark = new THREE.Mesh(sparkGeometry, sparkMaterial);
  spark.name = 'emberwing-trajectory-spark'; spark.visible = false; spark.renderOrder = 3; spark.frustumCulled = false;

  for (const o of [ribbon, ring, spark]) o.userData.ignoreContact = true;
  const group = new THREE.Group(); group.name = 'emberwing-trajectory'; group.add(ribbon, ring, spark); group.visible = false;
  group.userData.ignoreContact = true;

  // Per draw: read the actual viewport (resize, DPR and per-eye XR viewports),
  // advance the shared shader clock, and distance-scale the contact disc.
  const viewport = new THREE.Vector4(), camPos = new THREE.Vector3(), worldPos = new THREE.Vector3();
  const contactNormal = new THREE.Vector3(0, 1, 0);
  function syncView(renderer, mat) {
    if (!manualViewport && renderer?.getCurrentViewport) {
      renderer.getCurrentViewport(viewport);
      if (viewport.z > 0 && viewport.w > 0) resolution.set(viewport.z, viewport.w);
      pixelRatio = renderer.getPixelRatio?.() ?? 1;
    }
    ribbonUniforms.widthPx.value = width * pixelRatio;
    sparkUniforms.sizePx.value = sparkPx * pixelRatio;
    time.value = (globalThis.performance?.now?.() ?? 0) / 1000;
    mat.uniformsNeedUpdate = true;
  }
  ribbon.onBeforeRender = (renderer) => syncView(renderer, material);
  spark.onBeforeRender = (renderer) => syncView(renderer, sparkMaterial);
  ring.onBeforeRender = (renderer, scene, camera) => {
    syncView(renderer, markerMaterial);
    camera.getWorldPosition(camPos); ring.getWorldPosition(worldPos);
    const s = THREE.MathUtils.clamp(camPos.distanceTo(worldPos) * .028, 1, 6) * markerRadius;
    if (Math.abs(ring.scale.x - s) > 1e-4) {
      // Matrices were already computed for this draw; refresh them in place.
      ring.scale.setScalar(s); ring.updateMatrixWorld();
      ring.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, ring.matrixWorld);
      ring.normalMatrix.getNormalMatrix(ring.modelViewMatrix);
    }
  };

  const z = new THREE.Vector3(0, 0, 1);
  const shot = {direction: [0, 0, 0], curve: [0, 0, 0], speed: 0}, velocity = [0, 0, 0];

  // Optional manual viewport (CSS width/height + pixel ratio). Normally not needed:
  // the guide reads renderer.getCurrentViewport() on each draw. Pass null to revert.
  function setViewport(w, h, ratio = 1) {
    if (w == null) { manualViewport = false; return; }
    manualViewport = true; resolution.set(Math.max(1, w * ratio), Math.max(1, h * ratio)); pixelRatio = ratio;
  }

  const seg = (i) => Math.hypot(positions[i * 3] - positions[i * 3 - 3], positions[i * 3 + 1] - positions[i * 3 - 2], positions[i * 3 + 2] - positions[i * 3 - 1]);
  function setPoints(points, count, contact = null) {
    count = Math.min(count, maxPoints);
    if (points !== positions) positions.set(points.subarray ? points.subarray(0, count * 3) : points.slice(0, count * 3));
    let total = 0;
    for (let i = 1; i < count; i++) total += seg(i);
    let s = 0;
    for (let i = 0; i < count; i++) {
      if (i > 0) s += seg(i);
      const t = count > 1 ? i / (count - 1) : 0;
      // Fade in over the first ~0.4-1.4 m so the guide never sits on the bow/reticle;
      // without a contact, fade the final ~1.2 m so it does not stop abruptly mid-air.
      let alpha = Math.min(1, Math.max(0, s - .4)) * (1 - t * .3);
      if (!contact) alpha *= Math.min(1, Math.max(0, (total - s) / 1.2));
      const ip = Math.max(0, i - 1) * 3, ic = i * 3, inx = Math.min(count - 1, i + 1) * 3;
      for (let side = 0; side < 2; side++) {
        const v = (i * 2 + side) * 3, w = (i * 2 + side) * 4;
        vPos[v] = positions[ic]; vPos[v + 1] = positions[ic + 1]; vPos[v + 2] = positions[ic + 2];
        vPrev[v] = positions[ip]; vPrev[v + 1] = positions[ip + 1]; vPrev[v + 2] = positions[ip + 2];
        vNext[v] = positions[inx]; vNext[v + 1] = positions[inx + 1]; vNext[v + 2] = positions[inx + 2];
        vAlong[w] = side ? 1 : -1; vAlong[w + 1] = s; vAlong[w + 2] = t; vAlong[w + 3] = alpha;
      }
    }
    geometry.setDrawRange(0, Math.max(0, count - 1) * 6);
    for (const name of ['position', 'prev', 'next', 'along']) {
      const at = geometry.attributes[name];
      at.clearUpdateRanges(); at.addUpdateRange(0, count * 2 * at.itemSize); at.needsUpdate = true;
    }
    const hit = !!contact && count > 0;
    ring.visible = spark.visible = hit;
    if (hit) {
      contactNormal.fromArray(contact.normal || [0, 1, 0]); if (contactNormal.lengthSq() < 1e-8) contactNormal.set(0, 1, 0);
      contactNormal.normalize();
      ring.quaternion.setFromUnitVectors(z, contactNormal);
      ring.position.fromArray(contact.point).addScaledVector(contactNormal, .006);
      spark.position.fromArray(contact.point).addScaledVector(contactNormal, .14);
    }
    group.visible = count > 1;
  }
  // Convenience: local forecast from the live aim (same equation as server).
  function update({origin, aimDirection, curveBase, draw, hit = null, terrainHeight = null, sampleEvery = 1}) {
    bowShotFromAim(aimDirection, curveBase, draw, shot);
    for (let i = 0; i < 3; i++) velocity[i] = shot.direction[i] * shot.speed;
    const r = forecastTrajectory({origin, velocity, curve: shot.curve, kind: 'arrow', out: positions, sampleEvery, hit, terrainHeight});
    setPoints(positions, r.count, r.hit); return r;
  }
  function hide() { group.visible = false; ring.visible = false; spark.visible = false; geometry.setDrawRange(0, 0); }
  function dispose() {
    group.removeFromParent();
    geometry.dispose(); material.dispose(); markerGeometry.dispose(); markerMaterial.dispose(); sparkGeometry.dispose(); sparkMaterial.dispose();
  }
  return {object: group, update, setPoints, hide, dispose, setViewport, buffer: positions, maxPoints, drawCalls: 3};
}

// Guide only appears during a curved Emberwing draw, never in God/menus/XR-off-hand states.
export const shouldShowTrajectory = ({tool, role = 'hero', menuOpen = false, drawing, curved}) => role === 'hero' && !menuOpen && tool === 'bow' && !!drawing && !!curved;
