// StarShard geode light leaks (Opus 2026-10-03). Starlight escapes ONLY through the real openings that
// mining-fracture.js cuts: every removed shell cell becomes a hole; a soft glow card sits on the recessed crater
// floor (inside the hole, depth-tested, so remaining shell hides it) and a short tapered lightshaft rises out of the
// opening along the cell normal. More damage = more holes + brighter interior; no bloom, no dynamic lights.
//
// Cost model: an undamaged geode adds nothing. A damaged geode adds 2 InstancedMesh draws (shafts + leaks), capped at
// `maxHoles` instances each. Geometry and both ShaderMaterials are module-level, shared by every geode and ref-counted.
// A global budget (`setGeodeLightBudget`) caps simultaneously lit geodes; over-budget geodes stay dark (stats shows it).
// update() allocates nothing. Works with the unmodified mining-fracture: holes are discovered from the shell meshes it
// detaches, or passed explicitly via damage(level, holes) if the root exposes cell centroids.
import * as THREE from 'three';

const SHAFT_SEG = 10;
export const GEODE_LIGHT_BUDGET = 12;
export const GEODE_LIGHT_DISTANCE = 35;
let shared = null, users = 0, budget = GEODE_LIGHT_BUDGET, lit = 0, frameTime = 0;
const shellInfo = new WeakMap(); // shell geometry -> {c:Vector3, r} (fracture caches/shared geometries -> computed once)

export function setGeodeLightBudget(n) { budget = Math.max(0, n | 0); }
export function geodeLightGlobalStats() { return { users, lit, budget, programs: shared ? 2 : 0 }; }
/** Optional: call once per frame with the clock so all geodes shimmer in sync without per-geode uniform writes. */
export function setGeodeLightTime(t) { frameTime = t; if (shared) shared.time.value = t; }

function buildShared() {
  const time = { value: 0 };
  // Shaft: open frustum, +Y from hole (r=1 at y=0) to flared tip (r=1.55 at y=1). Instance matrix scales it.
  const shaftGeo = new THREE.CylinderGeometry(1.55, 1, 1, SHAFT_SEG, 1, true);
  shaftGeo.translate(0, .5, 0); shaftGeo.name = 'GeodeShaft';
  const leakGeo = new THREE.CircleGeometry(1, 14); leakGeo.rotateX(-Math.PI / 2); leakGeo.name = 'GeodeLeak'; // faces +Y
  const common = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false };
  const shaftMat = new THREE.ShaderMaterial({
    ...common, name: 'GeodeShaftMat', side: THREE.DoubleSide,
    uniforms: { time },
    vertexShader: /* glsl */`
      varying float vY; varying float vFacing; varying float vAng; varying vec3 vCol; varying float vSeed;
      void main(){
        vec4 lp = vec4(position,1.); vec3 n = normal;
        #ifdef USE_INSTANCING
          lp = instanceMatrix*lp; n = mat3(instanceMatrix)*n;
          vSeed = instanceMatrix[3].x*13.1+instanceMatrix[3].z*7.7;
        #else
          vSeed = 0.;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
        #else
          vCol = vec3(1.);
        #endif
        vec4 mv = modelViewMatrix*lp;
        vec3 vn = normalize(normalMatrix*n);
        vFacing = abs(dot(vn, normalize(-mv.xyz)));
        vY = uv.y; vAng = uv.x;
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float time; varying float vY; varying float vFacing; varying float vAng; varying vec3 vCol; varying float vSeed;
      void main(){
        // soft edges (silhouette), fade with length, slow drifting streaks around the circumference
        float edge = smoothstep(.05,.75,vFacing);
        float len = (1.-vY); len *= len*smoothstep(0.,.08,vY);
        float streak = .55+.45*sin(vAng*37.7+vSeed+time*.7)*sin(vAng*17.3-vSeed*1.7-time*.43);
        float a = edge*len*streak;
        gl_FragColor = vec4(vCol*a*.55, 1.);
      }`,
  });
  const leakMat = new THREE.ShaderMaterial({
    ...common, name: 'GeodeLeakMat', side: THREE.FrontSide,
    uniforms: { time },
    vertexShader: /* glsl */`
      varying vec2 vP; varying vec3 vCol; varying float vSeed;
      void main(){
        vec4 lp = vec4(position,1.);
        #ifdef USE_INSTANCING
          lp = instanceMatrix*lp; vSeed = instanceMatrix[3].y*11.3+instanceMatrix[3].x*5.1;
        #else
          vSeed = 0.;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
        #else
          vCol = vec3(1.);
        #endif
        vP = position.xz; gl_Position = projectionMatrix*modelViewMatrix*lp;
      }`,
    fragmentShader: /* glsl */`
      uniform float time; varying vec2 vP; varying vec3 vCol; varying float vSeed;
      void main(){
        float r = length(vP);
        float core = exp(-r*r*5.5);
        // faceted star sparkle inside the cavity (angular 6-fold), slow twinkle
        float ang = atan(vP.y,vP.x);
        float facet = .75+.25*cos(ang*6.+vSeed)*(.6+.4*sin(time*1.9+vSeed));
        float a = core*facet*(1.-smoothstep(.6,1.,r));
        gl_FragColor = vec4(vCol*a, 1.);
      }`,
  });
  return { time, shaftGeo, leakGeo, shaftMat, leakMat };
}

/**
 * createGeodeLight({root, id, fracture?, maxHoles=10, color=0xbfdcff, rimColor=0x9a86ff, shaftLength=1.6, intensity=1})
 *  root     : the deposit root Group (same root given to attachFracture).
 *  fracture : optional handle from attachFracture (used only for removedCells().length sanity in stats).
 * Returns {damage(level01, holes?), update(dt, camera?, enabled=true), dispose(), stats(), group}
 *  holes (optional): [{centroid:Vector3, normal:Vector3, radius:number}] in the fracture host's local space.
 */
export function createGeodeLight({ root, id = '', fracture = null, maxHoles = 10, color = 0xbfdcff, rimColor = 0x9a86ff,
  shaftLength = 1.1, intensity = 1, maxDistance = GEODE_LIGHT_DISTANCE } = {}) {
  if (!shared) shared = buildShared();
  users++;
  const S = shared;
  const shafts = new THREE.InstancedMesh(S.shaftGeo, S.shaftMat, maxHoles);
  const leaks = new THREE.InstancedMesh(S.leakGeo, S.leakMat, maxHoles);
  for (const m of [shafts, leaks]) {
    m.count = 0; m.frustumCulled = false; m.raycast = () => {}; m.castShadow = m.receiveShadow = false;
    m.userData.fractureOwned = true; m.userData.geodeLight = true; m.userData.ignoreContact = true;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.setColorAt(0, new THREE.Color(0, 0, 0)); m.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }
  shafts.name = 'GeodeShafts'; leaks.name = 'GeodeLeaks';
  shafts.renderOrder = 3; leaks.renderOrder = 1;

  // preallocated state
  const holes = Array.from({ length: maxHoles }, () => ({ c: new THREE.Vector3(), n: new THREE.Vector3(), r: .1, age: 0, on: false }));
  let holeCount = 0, level = 0, shown = 0, hasSlot = false, host = null, disposed = false;
  const centre = new THREE.Vector3(), bounds = new THREE.Box3(), tmpBox = new THREE.Box3();
  const knownShells = []; // shell meshes owned by fracture, discovered lazily
  const seenGone = new Set();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const cA = new THREE.Color(color), cB = new THREE.Color(rimColor), col = new THREE.Color();
  const wp = new THREE.Vector3(), cp = new THREE.Vector3();
  let radiusScale = 1;

  function discover() {
    // host = parent of the authored meshes (fracture adds shells, craters and walls there)
    if (!host) {
      root.traverse(n => { if (!host && n.isMesh && !n.userData.fractureOwned) host = n.parent; });
      if (!host) return;
      bounds.makeEmpty();
      host.children.forEach(n => { if (n.isMesh && !n.userData.fractureOwned && n.geometry) { n.geometry.computeBoundingBox(); tmpBox.copy(n.geometry.boundingBox).applyMatrix4(n.matrix); bounds.union(tmpBox); } });
      bounds.getCenter(centre); radiusScale = bounds.getSize(s).length() * .5;
      host.add(leaks); host.add(shafts);
    }
    if (!knownShells.length) for (const n of host.children) {
      if (!n.isMesh || !n.userData.fractureOwned || n.userData.geodeLight) continue;
      const mat = Array.isArray(n.material) ? n.material[0] : n.material;
      if (mat && mat.name === 'FractureInterior') continue; // craters/walls
      knownShells.push(n);
    }
  }

  // Snapshot shells NOW: create the light right after attachFracture() and before its first setDamage(), otherwise
  // shells removed with {animate:false} are already gone (pass explicit holes in that case).
  discover();

  function addHole(cLocal, nLocal, r) {
    if (holeCount >= maxHoles) return;
    const h = holes[holeCount++]; h.c.copy(cLocal); h.n.copy(nLocal).normalize(); h.r = r; h.age = 0; h.on = true;
  }

  /** level01: 0..1 damage. holes: optional explicit list; otherwise derived from shells the fracture detached. */
  function damage(level01, explicit) {
    if (disposed) return;
    level = Math.min(1, Math.max(0, +level01 || 0));
    discover();
    if (!host) return;
    // The recessed faces belong to this fracture, never the shared source GLB.
    // Give the exposed chamber its own restrained light, so shafts read as
    // escaping a luminous interior rather than appearing above unlit stone.
    for (const n of host.children) {
      const mat = n.isMesh && n.material;
      if (mat?.name === 'FractureInterior' && mat.emissive) {
        mat.emissive.copy(cA).lerp(cB, .2);
        mat.emissiveIntensity = intensity * (.06 + .36 * level);
      }
    }
    if (explicit) { holeCount = 0; for (const e of explicit) addHole(e.centroid, e.normal ?? p.copy(e.centroid).sub(centre), e.radius ?? .25 * radiusScale); return; }
    for (const sh of knownShells) {
      if (sh.parent === host || seenGone.has(sh)) continue;
      seenGone.add(sh);
      let info = shellInfo.get(sh.geometry);
      if (!info) { sh.geometry.computeBoundingSphere(); info = { c: sh.geometry.boundingSphere.center.clone(), r: sh.geometry.boundingSphere.radius }; shellInfo.set(sh.geometry, info); }
      // merge with an existing hole from the same cell (multi-primitive shells share a cell centroid)
      let merged = false;
      for (let i = 0; i < holeCount; i++) if (holes[i].c.distanceTo(info.c) < info.r * .5) { holes[i].r = Math.max(holes[i].r, info.r); merged = true; break; }
      if (!merged) addHole(info.c, p.copy(info.c).sub(centre), info.r);
    }
  }

  function hide() { shafts.visible = leaks.visible = false; shown = 0; release(); }
  function update(dt = 0, camera = null, enabled = true) {
    if (disposed || !host || !holeCount) return;
    if (!enabled) { hide(); return; }
    if (camera) { // distance LOD: beyond maxDistance nothing draws
      root.getWorldPosition(wp); camera.getWorldPosition(cp);
      const far = wp.distanceToSquared(cp) > maxDistance * maxDistance;
      if (far) { hide(); return; }
    }
    if (!hasSlot) { if (lit >= budget) { hide(); return; } lit++; hasSlot = true; }
    shafts.visible = leaks.visible = true;
    S.time.value = frameTime;
    const glow = intensity * (.45 + .55 * level); // interior brightens with total damage
    shown = 0;
    for (let i = 0; i < holeCount; i++) {
      const h = holes[i]; h.age = Math.min(1, h.age + dt * 1.8);
      const fade = h.age * h.age * (3 - 2 * h.age);
      // leak: on the recessed crater floor (fracture RECESS .76), facing out, slightly above the floor
      p.copy(h.c).sub(centre).multiplyScalar(.8).add(centre);
      q.setFromUnitVectors(up, h.n);
      s.setScalar(h.r * .62);
      m4.compose(p, q, s); leaks.setMatrixAt(shown, m4);
      col.copy(cA).lerp(cB, .25).multiplyScalar(glow * fade * 1.1); leaks.setColorAt(shown, col);
      // shaft: starts inside the cavity, exits through the opening, length grows with damage
      s.set(h.r * .42, shaftLength * h.r * (.6 + .8 * level) * fade, h.r * .42);
      m4.compose(p, q, s); shafts.setMatrixAt(shown, m4);
      col.copy(cA).lerp(cB, .5).multiplyScalar(glow * fade); shafts.setColorAt(shown, col);
      shown++;
    }
    shafts.count = leaks.count = shown;
    shafts.instanceMatrix.needsUpdate = leaks.instanceMatrix.needsUpdate = true;
    shafts.instanceColor.needsUpdate = leaks.instanceColor.needsUpdate = true;
  }
  function release() { if (hasSlot) { hasSlot = false; lit--; } }
  function dispose() {
    if (disposed) return; disposed = true; release();
    shafts.removeFromParent(); leaks.removeFromParent(); shafts.dispose(); leaks.dispose();
    if (--users <= 0 && shared) { shared.shaftGeo.dispose(); shared.leakGeo.dispose(); shared.shaftMat.dispose(); shared.leakMat.dispose(); shared = null; users = 0; }
  }
  function stats() {
    return { id, holes: holeCount, shown, draws: hasSlot && shown ? 2 : 0, lit: hasSlot, level, fractureRemoved: fracture?.removedCells?.().length ?? null, sharedUsers: users, globalLit: lit, budget };
  }
  return { damage, update, dispose, stats, group: { shafts, leaks } };
}
