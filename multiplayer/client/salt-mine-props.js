// The Brinedeep salt mines' kit (Blender, assets-source/salt-mine-kit -> /assets/salt-mine-kit.glb), placed from the
// shared mine shape: the timbered portal with its lantern, tunnel sets, a run of track with an ore cart heaped with
// salt at the hall's mouth, lanterns under the sets, showpiece salt clusters against the walls, the firedamp vents and
// the brine pools with their crusted rims. Presentation only (no raycast targets); every piece is instanced per
// material, so the whole kit for both mines is a handful of draws. The salt glows from inside like a salt lamp, from
// the kit's glow mask (TEXCOORD_1.x) as emissive only: no lights.
import * as THREE from 'three';
import {MINE, MINE_SIDES, mineArch, mineField, minePoint, mineDirection, minePortal, portalAlong, pathLength} from '../shared/salt-mines.js';
import {DAMP_VENTS, SEAM_SPOTS} from '../shared/salt-mine-rules.js';

export const KIT_URL = '/assets/salt-mine-kit.glb';
const KIT_NODES = ['MinePortal', 'TimberSet', 'RailStraight', 'MineCart', 'Lantern', 'SaltCluster', 'SaltClusterSmall', 'FiredampVent', 'RubblePile', 'BrineRim'];
const LANTERN_HOOK = Object.freeze([2.1, 2.494, .664]); // in MinePortal space (assets-source/salt-mine-kit/README.md)
const SET_OPENING = Object.freeze({width: 3.4, height: 3.1});
const PORTAL_OPENING = 3.8;

// ---- Where everything goes, in corner space: pure maths over the shared shape (tests read this too).
/** Point and direction along the walked path at distance s from the meadow end (straight on past either end). */
export function pathAt(s) {
  const P = MINE.path;
  let left = s;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1], du = b[0] - a[0], dv = b[1] - a[1], len = Math.hypot(du, dv);
    if (left <= len || i === P.length - 2) {
      const t = left / len;
      return {u: a[0] + du * t, v: a[1] + dv * t, du: du / len, dv: dv / len, half: a[2] + (b[2] - a[2]) * Math.min(1, Math.max(0, t))};
    }
    left -= len;
  }
  return null;
}
const insideAt = (u, v) => MINE.wall - mineField(u, v).d;
/** March from a hall centre outward along an angle to the point `inset` metres inside the wall. */
function wallPoint(c, angle, inset) {
  const du = Math.cos(angle), dv = Math.sin(angle);
  let lo = 0, hi = 9;
  if (insideAt(c[0] + du * hi, c[1] + dv * hi) > inset) return null;
  for (let k = 0; k < 28; k++) { const m = (lo + hi) / 2; if (insideAt(c[0] + du * m, c[1] + dv * m) > inset) lo = m; else hi = m; }
  return [c[0] + du * lo, c[1] + dv * lo];
}
export function kitLayout() {
  const busy = [...SEAM_SPOTS.map(s => [s.u, s.v, 1.0]), ...DAMP_VENTS.map(v => [v[0], v[1], 1.6]), ...MINE.pools.map(p => [p[0], p[1], p[2] + 1.1])];
  const clear = (u, v, r) => busy.every(([bu, bv, br]) => Math.hypot(u - bu, v - bv) > br + r);
  const sets = [], rails = [], lanterns = [], big = [], small = [], rubble = [];
  // Tunnel sets every 2.2 m from just inside the portal to the hall's mouth.
  const p0 = portalAlong(), end = pathLength();
  for (let s = p0 + 1.4; s < end - .4; s += 2.2) {
    const q = pathAt(s), crown = mineArch(q.u, q.v).height;
    sets.push({u: q.u, v: q.v, du: q.du, dv: q.dv, sx: (q.half * 2 + .05) / SET_OPENING.width, sy: Math.min(1.08, (crown - .1) / SET_OPENING.height)});
  }
  // Every other set carries a lantern under its cap, on the wall side of the track.
  sets.forEach((t, i) => { if (i % 2 === 0) lanterns.push({u: t.u - t.dv * .95 * t.sx, v: t.v + t.du * .95 * t.sx, up: SET_OPENING.height * t.sy - .18}); });
  // Track from the cutting to a few metres into the hall, 2 m pieces.
  for (let s = p0 - 2.6; s < end + 2.6; s += 2) {
    const a = pathAt(s), b = pathAt(s + 2), m = pathAt(s + 1);
    rails.push({u: m.u, v: m.v, a: [a.u, a.v], b: [b.u, b.v]});
  }
  const cartAt = pathAt(end + 1.6);
  const cart = {u: cartAt.u, v: cartAt.v, du: cartAt.du, dv: cartAt.dv};
  for (const r of rails) busy.push([r.u, r.v, 1.1]);
  busy.push([cart.u, cart.v, 1.4]);
  // Showpiece clusters stand into the hall's walls (half in the rock: they keep out of the walking space).
  for (let k = 0; k < 80 && big.length < 4; k++) {
    const p = wallPoint(MINE.halls[k % 2 ? 1 : 0], k * 2.399 + .7, .05);
    if (p && clear(p[0], p[1], .6) && big.every(b => Math.hypot(b.u - p[0], b.v - p[1]) > 3)) { big.push({u: p[0], v: p[1], yaw: k * 1.7, s: .85 + .25 * ((k * 7) % 5) / 4}); busy.push([p[0], p[1], .9]); }
  }
  // Scatter: small clusters along every wall, tunnel and hall.
  for (const h of MINE.halls) for (let k = 0; k < 60; k++) {
    const p = wallPoint(h, k * 2.399 + .2, .12 + .1 * (k % 3));
    if (p && clear(p[0], p[1], .2) && small.every(b => Math.hypot(b.u - p[0], b.v - p[1]) > .9)) { small.push({u: p[0], v: p[1], yaw: k * 2.1, s: .8 + .5 * ((k * 5) % 7) / 6}); busy.push([p[0], p[1], .35]); }
  }
  for (let s = p0 + .6; s < end; s += 1.35) for (const side of [-1, 1]) {
    const q = pathAt(s + (side > 0 ? .6 : 0)), u = q.u - q.dv * side * (q.half - .05), v = q.v + q.du * side * (q.half - .05);
    if (clear(u, v, .3)) small.push({u, v, yaw: s * 3.1 + side, s: .7 + .3 * ((Math.round(s * 10) % 4) / 3)});
  }
  // Two old falls left at the bend, rubble against the walls.
  for (const s of [p0 + 4.3, end - .9]) {
    const q = pathAt(s), side = s > p0 + 5 ? 1 : -1, u = q.u - q.dv * side * (q.half - .25), v = q.v + q.du * side * (q.half - .25);
    rubble.push({u, v, yaw: s * 1.3, s: .7});
  }
  const vents = DAMP_VENTS.map(([u, v], i) => ({u, v, yaw: i * 2.2 + .4}));
  const pools = MINE.pools.map(([u, v, r]) => ({u, v, r}));
  return {sets, rails, lanterns, cart, big, small, rubble, vents, pools};
}

// ---- Glow: the salt materials' mask as emissive, a slow warm breathing.
const glow = {uSaltKitTime: {value: 0}, uSaltKitGlow: {value: 1}};
function patchKitGlow(material, strength) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, glow);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float saltGlow; varying float vSaltGlow; varying vec3 vSaltPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSaltGlow = saltGlow;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 saltWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          saltWorld = instanceMatrix * saltWorld;
        #endif
        vSaltPos = (modelMatrix * saltWorld).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vSaltGlow; varying vec3 vSaltPos; uniform float uSaltKitTime, uSaltKitGlow;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float saltBreath = .82 + .18 * sin(uSaltKitTime * .8 + vSaltPos.x * .7 + vSaltPos.z * .5);
        totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, .55, .38) * vSaltGlow * ${strength.toFixed(3)} * uSaltKitGlow * saltBreath;`);
  };
  material.customProgramCacheKey = () => `salt-kit-glow-${strength}`;
  return material;
}

/** Place the kit in both mines once the game's asset pipeline delivers it: install(gltf, prepare) builds the instanced
 * pieces off-scene, awaits prepare(group) (texture upload and shader compile) and only then adds them to the scene. */
export function createSaltMineProps({scene, height, quality = 'high'} = {}) {
  const low = quality === 'low', group = new THREE.Group(); group.name = 'SaltMineKit';
  const stat = {ready: false, failed: false, draws: 0, instances: 0, triangles: 0};
  const disposables = new Set();
  const layout = kitLayout();
  const pieces = new Map(); // node name -> [{geometry, material}]
  const materials = new Map();
  function adopt(material) {
    if (materials.has(material.name)) return materials.get(material.name);
    const m = material.clone(); m.name = material.name;
    if (m.name === 'SaltCrystal') patchKitGlow(m, low ? 1.6 : 1.9);
    else if (m.name === 'SaltRock') patchKitGlow(m, .9);
    else if (m.name === 'LanternGlow') { m.emissive = new THREE.Color(1, .62, .28); m.emissiveIntensity = 2.6; m.toneMapped = true; }
    materials.set(m.name, m); disposables.add(m); if (m.map) disposables.add(m.map); return m;
  }
  function harvest(gltf) {
    for (const name of KIT_NODES) {
      const node = gltf.scene.getObjectByName(name); if (!node) throw Error(`salt-mine-kit is missing ${name}`);
      const parts = [];
      node.updateMatrixWorld(true);
      node.traverse(o => {
        if (!o.isMesh) return;
        const g = o.geometry.clone();
        if (o !== node) g.applyMatrix4(new THREE.Matrix4().copy(node.matrixWorld).invert().multiply(o.matrixWorld));
        const n = g.attributes.position.count, glowArr = new Float32Array(n), uv1 = g.attributes.uv1;
        if (uv1) for (let i = 0; i < n; i++) glowArr[i] = uv1.getX(i);
        g.setAttribute('saltGlow', new THREE.BufferAttribute(glowArr, 1));
        disposables.add(g); parts.push({geometry: g, material: adopt(o.material)});
      });
      pieces.set(name, parts);
    }
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const yawOf = (side, du, dv) => { const [dx, dz] = mineDirection(side, [du, dv]); return Math.atan2(dx, dz); };
  function instanced(name, transforms) {
    if (!transforms.length) return;
    for (const {geometry, material} of pieces.get(name)) {
      const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
      transforms.forEach((t, i) => mesh.setMatrixAt(i, t));
      mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
      mesh.name = `SaltMineKit_${name}`; mesh.raycast = () => {}; mesh.castShadow = false; mesh.receiveShadow = false; mesh.matrixAutoUpdate = false; mesh.userData.presentationOnly = true;
      group.add(mesh); stat.draws++; stat.instances += transforms.length; stat.triangles += transforms.length * (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
    }
  }
  const at = (side, u, v, yaw, s = 1, lift = 0, pitch = 0, sx = s, sy = s) => {
    const [x, z] = minePoint(side, [u, v]);
    e.set(pitch, yaw, 0); q.setFromEuler(e); pos.set(x, height(x, z) + lift, z); scl.set(sx, sy, s);
    return m4.compose(pos, q, scl).clone();
  };
  const water = [];
  function place() {
    const L = layout, T = {};
    for (const n of KIT_NODES) T[n] = [];
    for (const side of MINE_SIDES) {
      // The portal frame across the opening, its lantern on the hook.
      const P = minePortal(side), py = height(P.x, P.z), ps = (P.half * 2 + .1) / PORTAL_OPENING;
      e.set(0, P.yaw, 0); q.setFromEuler(e); const portalM = m4.compose(pos.set(P.x, py, P.z), q, scl.set(ps, ps, ps)).clone();
      T.MinePortal.push(portalM);
      T.Lantern.push(portalM.clone().multiply(new THREE.Matrix4().makeTranslation(...LANTERN_HOOK)));
      for (const t of L.sets) T.TimberSet.push(at(side, t.u, t.v, yawOf(side, t.du, t.dv), 1, 0, 0, t.sx, t.sy));
      for (const l of L.lanterns) T.Lantern.push(at(side, l.u, l.v, 0, 1, l.up));
      for (const r of L.rails) {
        const [ax, az] = minePoint(side, r.a), [bx, bz] = minePoint(side, r.b), rise = height(bx, bz) - height(ax, az), [mx, mz] = minePoint(side, [r.u, r.v]);
        const yaw = Math.atan2(bx - ax, bz - az), pitch = -Math.atan2(rise, 2), y = (height(ax, az) + height(bx, bz) + 2 * height(mx, mz)) / 4;
        e.set(pitch, yaw, 0); q.setFromEuler(e); T.RailStraight.push(m4.compose(pos.set(mx, y - .02, mz), q, scl.set(1, 1, 1)).clone());
      }
      T.MineCart.push(at(side, L.cart.u, L.cart.v, yawOf(side, L.cart.du, L.cart.dv)));
      for (const b of L.big) T.SaltCluster.push(at(side, b.u, b.v, b.yaw, b.s, -.08));
      for (const b of (low ? L.small.filter((_, i) => i % 2 === 0) : L.small)) T.SaltClusterSmall.push(at(side, b.u, b.v, b.yaw, b.s, -.03));
      for (const r of L.rubble) T.RubblePile.push(at(side, r.u, r.v, r.yaw, r.s, -.06));
      for (const v of L.vents) T.FiredampVent.push(at(side, v.u, v.v, v.yaw, 1, -.02));
      for (const p of L.pools) {
        // Water level: the hall floor round the pool's edge.
        let rim = 0; for (let k = 0; k < 8; k++) { const [x, z] = minePoint(side, [p.u + Math.cos(k * .785) * p.r * 1.12, p.v + Math.sin(k * .785) * p.r * 1.12]); rim += height(x, z) / 8; }
        const [x, z] = minePoint(side, [p.u, p.v]), s = p.r / .95;
        e.set(0, p.u * 1.3, 0); q.setFromEuler(e); T.BrineRim.push(m4.compose(pos.set(x, rim - .04, z), q, scl.set(s, s, s)).clone());
        water.push({x, y: rim - .07, z, r: p.r * 1.02});
      }
    }
    for (const n of KIT_NODES) instanced(n, T[n]);
    // Brine: still, clear teal water lit from the salt beneath; one draw for all four pools.
    const disc = new THREE.CircleGeometry(1, low ? 20 : 36); disc.rotateX(-Math.PI / 2); disposables.add(disc);
    const brine = new THREE.MeshStandardMaterial({color: 0x2c8a86, emissive: 0x2fa69c, emissiveIntensity: .55, roughness: .08, metalness: 0, transparent: true, opacity: .84, envMapIntensity: .8});
    disposables.add(brine);
    const pools = new THREE.InstancedMesh(disc, brine, water.length);
    water.forEach((w, i) => pools.setMatrixAt(i, m4.compose(pos.set(w.x, w.y, w.z), q.identity(), scl.set(w.r, 1, w.r)).clone()));
    pools.instanceMatrix.needsUpdate = true; pools.computeBoundingSphere(); pools.name = 'SaltMineKit_brine'; pools.raycast = () => {}; pools.matrixAutoUpdate = false; pools.renderOrder = 2;
    group.add(pools); stat.draws++;
    group.updateMatrixWorld(true);
  }
  let disposed = false;
  async function install(gltf, prepare = async () => {}) {
    if (disposed || stat.ready) return false;
    try { harvest(gltf); place(); await prepare(group); }
    catch (err) { stat.failed = String(err?.message || err); return false; }
    if (disposed) return false;
    scene.add(group); stat.ready = true; return true;
  }
  return {
    group, layout, install, failed(reason) { stat.failed = String(reason || 'unavailable'); },
    update(dt, level = 1) { glow.uSaltKitTime.value += dt; glow.uSaltKitGlow.value = level; },
    stats: () => ({...stat}),
    dispose() { disposed = true; scene.remove(group); for (const d of disposables) d.dispose?.(); },
  };
}
