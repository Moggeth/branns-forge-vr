// Emberdew bottle presentation (Opus 2026-10-03). Add-on for a CLONE of fire-presentation.js createEmberdewModel().
// Does not touch the fire renderer or the template: only the clone's own Mesh objects get new material/geometry refs.
//  * Liquid: shared container geometry (inner glass, inset so it can never poke through Glass) + per-bottle lightweight
//    material (same program for every bottle) that discards fragments above a fill plane in bottle-local space.
//    Back faces visible through the cut are shaded as the flat liquid surface (volume illusion). The plane offset comes
//    from a volume-conserving table (tilt angle -> offset), so an upside-down bottle fills its neck, not empty air.
//  * Slosh: damped 2D spring of the world surface normal driven by measured acceleration (FPS/VR hand or thrown).
//    dt clamped and sub-stepped, acceleration clamped, teleports (huge jump / long dt) reset instead of kicking.
//  * Armed (lit): a small shared-material flame on the wick (world-upright, leans against motion, shader flicker,
//    no lights, no particles), wick and NeckCollar swap to shared glowing materials, liquid gains an ember core.
// update() allocates nothing. Named parts Liquid, Glass, Wick, NeckCollar, GripWrap and Muzzle are preserved;
// a ReadinessAnchor Object3D is added at the wick tip when the clone lacks one.
import * as THREE from 'three';

export const FILL = .9;            // fraction of the container volume that is liquid
const MAX_TILT = .55, MAX_ACC = 35, TELEPORT_SPEED = 25, MAX_DT = .1, SUB = 1 / 90;
const K = 70, DAMP = 5.5, ACC_GAIN = 1 / 9.81; // spring stiffness/damping, accel -> tilt
// Inner container profile = glass profile radius minus wall, capped below the stopper (stopper starts at y=.063).
const INNER = [[0, -.0855], [.018, -.0848], [.0315, -.0755], [.0385, -.056], [.0385, -.03], [.0345, -.006], [.0278, .0155], [.0188, .0345], [.0142, .049], [.0142, .0605], [0, .0605]];
const WICK_TIP = new THREE.Vector3(0, .103, 0);

let S = null, refs = 0;
function buildShared() {
  const time = { value: 0 };
  const container = new THREE.LatheGeometry(INNER.map(([r, y]) => new THREE.Vector2(r, y)), 20); container.name = 'EmberdewLiquidContainer';
  // volume-conserving plane offset table: angle between bottle +Y and surface normal (0..PI) -> offset d
  const pts = [], r = (a, b) => a + (b - a) * Math.random(); let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const radiusAt = y => { for (let i = 1; i < INNER.length; i++) { const [r0, y0] = INNER[i - 1], [r1, y1] = INNER[i]; if (y >= y0 && y <= y1 && y1 > y0) return r0 + (r1 - r0) * (y - y0) / (y1 - y0); } return 0; };
  while (pts.length < 6000 * 3) { const x = (rnd() * 2 - 1) * .04, y = -.0855 + rnd() * .146, z = (rnd() * 2 - 1) * .04; if (Math.hypot(x, z) < radiusAt(y)) pts.push(x, y, z); }
  const N = 64, table = new Float32Array(N + 1), proj = new Float32Array(pts.length / 3);
  for (let i = 0; i <= N; i++) { const a = Math.PI * i / N, nx = Math.sin(a), ny = Math.cos(a);
    for (let j = 0; j < proj.length; j++) proj[j] = pts[j * 3] * nx + pts[j * 3 + 1] * ny;
    proj.sort(); table[i] = proj[Math.min(proj.length - 1, Math.floor(FILL * proj.length))]; }
  // flame: teardrop lathe, base at origin, +Y up, ~2.6 cm tall
  const flameGeo = new THREE.LatheGeometry([[0, 0], [.0042, .003], [.0058, .009], [.0046, .016], [.0022, .022], [0, .027]].map(([a, b]) => new THREE.Vector2(a, b)), 10); flameGeo.name = 'EmberdewFlame';
  const flameMat = new THREE.ShaderMaterial({
    name: 'EmberdewFlameMat', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
    uniforms: { time },
    vertexShader: /* glsl */`
      uniform float time; varying float vH; varying float vF;
      void main(){
        float ph = modelMatrix[3].x*31.7+modelMatrix[3].z*17.3+modelMatrix[3].y*5.1;
        vec3 p = position; float h = p.y/.027;
        float flick = sin(time*23.+ph)*.5+sin(time*37.+ph*1.7)*.3+sin(time*11.+ph*.3)*.2;
        p.xz *= 1.+.12*flick*h; p.y *= 1.+.16*flick; p.x += .0016*h*h*sin(time*9.+ph);
        vec4 mv = modelViewMatrix*vec4(p,1.);
        vF = abs(dot(normalize(normalMatrix*normal), normalize(-mv.xyz))); vH = h;
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: /* glsl */`
      varying float vH; varying float vF;
      void main(){
        vec3 core = vec3(1.,.93,.62), mid = vec3(1.,.48,.08), tip = vec3(.75,.16,.02);
        vec3 c = mix(core, mid, smoothstep(.0,.55,vH)); c = mix(c, tip, smoothstep(.55,1.,vH));
        float a = smoothstep(.0,.6,vF)*(1.-smoothstep(.75,1.,vH))*(.55+.45*smoothstep(.0,.25,vH)) + (1.-vH)*.25*(1.-vF);
        gl_FragColor = vec4(c*a*1.6, 1.);
      }`,
  });
  // lit swaps (shared; the template's own wick/copper materials are never mutated)
  const wickLit = new THREE.MeshStandardMaterial({ name: 'EmberdewWickLit', color: 0x2a1a10, roughness: .9, emissive: 0xff6a14, emissiveIntensity: 2.2 });
  const collarLit = new THREE.MeshStandardMaterial({ name: 'EmberdewCollarLit', color: 0xb8602e, roughness: .32, metalness: .9, emissive: 0xff4a0a, emissiveIntensity: .55 });
  return { time, container, table, flameGeo, flameMat, wickLit, collarLit };
}
export function setEmberdewTime(t) { if (S) S.time.value = t; }

function makeLiquidMaterial() {
  const u = { uPlane: { value: new THREE.Vector4(0, 1, 0, 0) }, uLit: { value: 0 }, uRipple: { value: new THREE.Vector4(0, 0, 0, 0) }, uTime: S.time };
  const m = new THREE.MeshStandardMaterial({ name: 'EmberdewLiquid', color: 0x8c3f0a, roughness: .16, metalness: 0, emissive: 0x6a2004, emissiveIntensity: .18, side: THREE.DoubleSide });
  m.userData.u = u;
  m.customProgramCacheKey = () => 'emberdew-liquid-v1';
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLocal; varying vec3 vSurfN; uniform vec4 uPlane;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position; vSurfN = normalize((modelViewMatrix*vec4(uPlane.xyz,0.)).xyz);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vLocal; varying vec3 vSurfN; uniform vec4 uPlane; uniform float uLit; uniform vec4 uRipple; uniform float uTime;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      // ripple: tiny bounded height wave on the surface, amplitude from slosh energy (uRipple.w <= .002 m)
      float rip = uRipple.w*sin(dot(vLocal.xz, uRipple.xy)*260.+uTime*14.);
      float lvl = dot(vLocal, uPlane.xyz) - uPlane.w - rip;
      if (lvl > 0.) discard;`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      if (!gl_FrontFacing) normal = normalize(vSurfN);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      // depth below surface -> darker core when cold, ember heart when lit; surface (back faces) catches a meniscus
      float depthBelow = clamp(-lvl/.06, 0., 1.);
      float surf = gl_FrontFacing ? 0. : 1.;
      diffuseColor.rgb *= mix(1.15, .7, depthBelow) + surf*.25;
      float pulse = .85+.15*sin(uTime*3.1);
      totalEmissiveRadiance += uLit*pulse*mix(vec3(1.,.42,.06)*.9, vec3(1.,.22,.02)*.35, depthBelow) + surf*uLit*vec3(.6,.25,.04);`);
  };
  return m;
}

/**
 * attachEmberdew({root}) -> {update({dt,time,lit,worldPosition,worldQuaternion,velocity?}), reset(), dispose(), stats(), anchor}
 * root: a clone of createEmberdewModel() (template.clone(true)) — shares the template's geometry/materials.
 */
export function attachEmberdew({ root }) {
  if (!S) S = buildShared();
  refs++;
  const liquid = root.getObjectByName('Liquid'), wick = root.getObjectByName('Wick'), collar = root.getObjectByName('NeckCollar');
  if (!liquid || !wick) throw new Error('attachEmberdew: root must be a createEmberdewModel() clone (Liquid/Wick missing)');
  const orig = { liqGeo: liquid.geometry, liqMat: liquid.material, wickMat: wick.material, collarMat: collar?.material };
  const liqMat = makeLiquidMaterial(), u = liqMat.userData.u;
  liquid.geometry = S.container; liquid.material = liqMat; liquid.renderOrder = 1;

  let anchor = root.getObjectByName('ReadinessAnchor'), ownAnchor = false;
  if (!anchor) { anchor = new THREE.Object3D(); anchor.name = 'ReadinessAnchor'; anchor.position.copy(WICK_TIP); root.add(anchor); ownAnchor = true; }
  const flame = new THREE.Mesh(S.flameGeo, S.flameMat); flame.name = 'EmberdewFlame';
  flame.position.copy(WICK_TIP); flame.visible = false; flame.renderOrder = 4; flame.raycast = () => {}; flame.castShadow = false; flame.userData.ignoreContact = true;
  root.add(flame);

  // state (preallocated)
  const n = new THREE.Vector3(0, 1, 0), nv = new THREE.Vector3(), lastPos = new THREE.Vector3(), lastVel = new THREE.Vector3(), vel = new THREE.Vector3(), acc = new THREE.Vector3();
  const target = new THREE.Vector3(), tmp = new THREE.Vector3(), invQ = new THREE.Quaternion(), lean = new THREE.Vector3(0, 1, 0), leanV = new THREE.Vector3();
  const WORLD_UP = new THREE.Vector3(0, 1, 0), qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  let have = false, litAmt = 0, energy = 0, isLit = false, teleports = 0, disposed = false;

  function reset() { n.set(0, 1, 0); nv.set(0, 0, 0); lean.set(0, 1, 0); leanV.set(0, 0, 0); have = false; energy = 0; }

  function step(h) {
    // target surface normal: opposite of effective gravity (g - a), tilt clamped
    // normal ∝ -(g - a) = up*9.81 + a. Near free fall (thrown) the liquid floats: hold the current normal.
    target.copy(acc).multiplyScalar(ACC_GAIN); target.y += 1;
    if (target.lengthSq() < .04) target.copy(n); else target.normalize();
    limitTilt(target, MAX_TILT);
    // spring on the normal (tangent-ish 3D spring, renormalised)
    tmp.copy(target).sub(n).multiplyScalar(K).addScaledVector(nv, -DAMP);
    nv.addScaledVector(tmp, h); n.addScaledVector(nv, h); n.normalize(); limitTilt(n, MAX_TILT + .2);
    nv.addScaledVector(n, -nv.dot(n)); // keep velocity tangent
    // flame lean (faster, lighter spring) against motion
    tmp.copy(vel).multiplyScalar(-.25); tmp.y += 1; tmp.normalize(); limitTilt(tmp, .8);
    tmp.sub(lean).multiplyScalar(140).addScaledVector(leanV, -14); leanV.addScaledVector(tmp, h); lean.addScaledVector(leanV, h).normalize();
  }
  function limitTilt(v, max) { const c = Math.cos(max); if (!(v.y >= c)) { const xz = Math.hypot(v.x, v.z) || 1, s = Math.sin(max); if (Number.isFinite(xz) && Number.isFinite(v.y)) { v.x = v.x / xz * s; v.z = v.z / xz * s; v.y = c; } else v.set(0, 1, 0); } }

  function update({ dt = 0, time = 0, lit = false, worldPosition, worldQuaternion, velocity } = {}) {
    if (disposed) return;
    S.time.value = time;
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const wq = worldQuaternion ?? root.getWorldQuaternion(qa);
    const wpOk = worldPosition && Number.isFinite(worldPosition.x + worldPosition.y + worldPosition.z);
    if (wpOk && dt > 0) {
      if (!have || dt > MAX_DT * 2.5 || lastPos.distanceTo(worldPosition) > TELEPORT_SPEED * Math.max(dt, 1 / 30)) {
        if (have) teleports++;
        lastPos.copy(worldPosition); lastVel.set(0, 0, 0); vel.set(0, 0, 0); acc.set(0, 0, 0); have = true; nv.multiplyScalar(.2);
      } else {
        if (velocity && Number.isFinite(velocity.x + velocity.y + velocity.z)) vel.copy(velocity); else vel.copy(worldPosition).sub(lastPos).divideScalar(dt);
        acc.copy(vel).sub(lastVel).divideScalar(Math.max(dt, 1 / 240));
        // free fall (thrown): liquid floats relative to the bottle; acceleration ~ -g gives ~zero effective gravity.
        // Clamp keeps the surface plausible and the spring bounded.
        if (acc.length() > MAX_ACC) acc.setLength(MAX_ACC);
        lastPos.copy(worldPosition); lastVel.copy(vel);
      }
    }
    let rem = Math.min(dt, MAX_DT); while (rem > 1e-6) { const h = Math.min(SUB, rem); step(h); rem -= h; }
    // relax acceleration so a single spike settles (bounded)
    acc.multiplyScalar(Math.exp(-dt * 12));
    energy = Math.min(1, energy * Math.exp(-dt * 2.5) + nv.length() * dt * 2);

    // bottle-local plane
    invQ.copy(wq).invert();
    tmp.copy(n).applyQuaternion(invQ);
    if (!Number.isFinite(tmp.x + tmp.y + tmp.z)) { reset(); tmp.set(0, 1, 0).applyQuaternion(invQ); }
    const ang = Math.acos(Math.min(1, Math.max(-1, tmp.y))) / Math.PI * 64, i0 = Math.min(63, Math.floor(ang)), f = ang - i0;
    const d = S.table[i0] * (1 - f) + S.table[i0 + 1] * f;
    // table is for normal in the XY plane; lathe symmetry makes it valid for any azimuth
    u.uPlane.value.set(tmp.x, tmp.y, tmp.z, d);
    u.uRipple.value.set(Math.cos(time * .7) * .6, Math.sin(time * .9) * .6, 0, Math.min(.0018, energy * .004));

    // armed state
    isLit = !!lit;
    litAmt = Math.min(1, Math.max(0, litAmt + (isLit ? dt / .22 : -dt / .14)));
    u.uLit.value = litAmt;
    flame.visible = litAmt > .01;
    if (flame.visible) {
      flame.scale.setScalar(.25 + .75 * litAmt);
      // keep the flame upright in world space (+ lean), expressed in bottle-local space
      qb.setFromUnitVectors(WORLD_UP, lean); flame.quaternion.copy(invQ).multiply(qb);
    }
    wick.material = litAmt > .2 ? S.wickLit : orig.wickMat;
    if (collar) collar.material = litAmt > .2 ? S.collarLit : orig.collarMat;
  }

  function dispose() {
    if (disposed) return; disposed = true;
    liquid.geometry = orig.liqGeo; liquid.material = orig.liqMat; wick.material = orig.wickMat; if (collar) collar.material = orig.collarMat;
    flame.removeFromParent(); if (ownAnchor) anchor.removeFromParent();
    liqMat.dispose();
    if (--refs <= 0 && S) { S.container.dispose(); S.flameGeo.dispose(); S.flameMat.dispose(); S.wickLit.dispose(); S.collarLit.dispose(); S = null; refs = 0; }
  }
  function stats() { return { lit: isLit, litAmount: litAmt, surfaceTilt: Math.acos(Math.min(1, n.y)), energy, teleports, plane: u.uPlane.value.toArray(), sharedRefs: refs, extraDraws: flame.visible ? 1 : 0 }; }
  return { update, reset, dispose, stats, anchor, flame, liquidMaterial: liqMat, container: () => S?.container };
}
export const EMBERDEW_INNER_PROFILE = INNER;
