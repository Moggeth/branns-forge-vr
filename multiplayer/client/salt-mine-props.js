// The Brinedeep salt mines' kit (Blender, assets-source/salt-mine-kit -> /assets/salt-mine-kit.glb), placed from the
// shared mine shape: the timbered portal with its lantern, tunnel sets, a run of track with an ore cart heaped with
// salt at the hall's mouth, lanterns under the sets, showpiece salt clusters against the walls, the firedamp vents and
// the brine pools with their crusted rims. Presentation only (no raycast targets); every piece is instanced per
// material, so the whole kit for both mines is a handful of draws. The salt glows from inside like a salt lamp, from
// the kit's glow mask (TEXCOORD_1.x) as emissive only: no lights.
import * as THREE from 'three';
import {MINE, MINE_SIDES, mineArch, mineField, minePoint, mineDirection, minePortal, portalAlong, pathLength} from '../shared/salt-mines.js';
import {DAMP_VENTS, SEAM_SPOTS, SHAKER_SPOT} from '../shared/salt-mine-rules.js';

export const KIT_URL = '/assets/salt-mine-kit.glb';
export const CURIOS_URL = '/assets/salt-mine-curios.glb';
const KIT_NODES = ['MinePortal', 'TimberSet', 'RailStraight', 'MineCart', 'Lantern', 'SaltCluster', 'SaltClusterSmall', 'FiredampVent', 'RubblePile', 'BrineRim'];
// The chapel's carvings and the Deep's formations (assets-source/salt-mine-kit) ...
const CHAPEL_NODES = ['StatueBrann', 'StatueCrab', 'StatueGoat', 'SaltChandelier', 'ChapelRelief', 'CarversBench', 'SaltSpire', 'Stalactites', 'SaltDrapery'];
// ... and the mine's curios (assets-source/salt-mine-curios -> /assets/salt-mine-curios.glb): the canary and its cage,
// the lunch, the Saltman, the Great Salt Shaker, King Pinchy's crown, the sign, the tally board and the tool rack.
const CURIO_NODES = ['CanaryCage', 'Canary', 'CanaryKeeled', 'LunchPail', 'Saltman', 'SaltShaker', 'CrabCrown', 'SignCrabs', 'TallyBoard', 'ToolRack'];
const CAGE = {perch: [0, -.3782, 0], floor: [0, -.476, 0]}; // in CanaryCage space (assets-source/salt-mine-curios/README.md)
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
/** March from a room's centre outward along an angle to the point `inset` metres inside its wall (null if the ray
 * leaves the room through an opening first). */
function wallPoint(room, angle, inset) {
  const c = MINE.halls[room], du = Math.cos(angle), dv = Math.sin(angle);
  let lo = 0, hi = 9;
  for (let k = 1; k <= 36; k++) if (insideAt(c[0] + du * k * .25, c[1] + dv * k * .25) <= inset) { hi = k * .25; break; }
  if (insideAt(c[0] + du * hi, c[1] + dv * hi) > inset) return null;
  for (let k = 0; k < 28; k++) { const m = (lo + hi) / 2; if (insideAt(c[0] + du * m, c[1] + dv * m) > inset) lo = m; else hi = m; }
  const p = [c[0] + du * lo, c[1] + dv * lo];
  return mineField(p[0], p[1]).room === room && mineField(p[0], p[1]).tunnel > .4 ? p : null;
}
/** Point and heading along a drift's centre line at distance s from its first point. */
function driftAt(name, s) {
  const P = MINE.drifts.find(d => d.name === name).points;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1], du = b[0] - a[0], dv = b[1] - a[1], len = Math.hypot(du, dv);
    if (s <= len || i === P.length - 2) { const t = s / len; return {u: a[0] + du * t, v: a[1] + dv * t, du: du / len, dv: dv / len, half: a[2] + (b[2] - a[2]) * Math.min(1, t)}; }
    s -= len;
  }
  return null;
}
const driftLength = name => { const P = MINE.drifts.find(d => d.name === name).points; let l = 0; for (let i = 0; i < P.length - 1; i++) l += Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]); return l; };
// Roof height over the floor at a corner-space point.
const roofAt = (u, v) => mineArch(u, v).height;
const towards = (from, to) => { const du = to[0] - from[0], dv = to[1] - from[1], l = Math.hypot(du, dv) || 1; return [du / l, dv / l]; };
const DIAG = Math.SQRT1_2;
export function kitLayout() {
  const busy = [...SEAM_SPOTS.map(s => [s.u, s.v, 1.0]), ...DAMP_VENTS.map(v => [v[0], v[1], 1.6]), ...MINE.pools.map(p => [p[0], p[1], p[2] + 1.1]), [SHAKER_SPOT[0], SHAKER_SPOT[1], 1.4]];
  const clear = (u, v, r) => busy.every(([bu, bv, br]) => Math.hypot(u - bu, v - bv) > br + r);
  const sets = [], rails = [], lanterns = [], big = [], small = [], rubble = [], spires = [], stalactites = [], drapes = [];
  // Tunnel sets every 2.2 m from just inside the portal to the hall's mouth, and down both timbered drifts.
  const p0 = portalAlong(), end = pathLength();
  const setAt = q => sets.push({u: q.u, v: q.v, du: q.du, dv: q.dv, sx: (q.half * 2 + .05) / SET_OPENING.width, sy: Math.min(1.08, (roofAt(q.u, q.v) - .1) / SET_OPENING.height)});
  for (let s = p0 + 1.4; s < end - .4; s += 2.2) setAt(pathAt(s));
  const mainSets = sets.length;
  for (const name of ['chapel', 'deep']) for (let s = .5, L = driftLength(name); s < L - .2; s += 2.1) setAt(driftAt(name, s));
  // Every other main set and the first set of each drift carries a lantern under its cap, on the wall side.
  sets.forEach((t, i) => { if (i < mainSets ? i % 2 === 0 : i === mainSets || i === sets.length - 1) lanterns.push({u: t.u - t.dv * .95 * t.sx, v: t.v + t.du * .95 * t.sx, up: SET_OPENING.height * t.sy - .18}); });
  // Track from the cutting to a few metres into the hall, 2 m pieces.
  for (let s = p0 - 2.6; s < end + 2.6; s += 2) {
    const a = pathAt(s), b = pathAt(s + 2), m = pathAt(s + 1);
    rails.push({u: m.u, v: m.v, a: [a.u, a.v], b: [b.u, b.v]});
  }
  const cartAt = pathAt(end + 1.6);
  const cart = {u: cartAt.u, v: cartAt.v, du: cartAt.du, dv: cartAt.dv};
  for (const r of rails) busy.push([r.u, r.v, 1.1]);
  busy.push([cart.u, cart.v, 1.4]);
  for (const t of sets) busy.push([t.u, t.v, 1.2]);

  // ---- The Carvers' Chapel: Brann before the carved relief at the far wall, the crab and the goat at either end,
  // the carvers' bench, and the salt chandelier hanging from the crown.
  const C = MINE.halls[MINE.chapel], cc = [C[0], C[1]], door = driftAt('chapel', driftLength('chapel'));
  const back = towards([door.u, door.v], cc), far = wallPoint(MINE.chapel, Math.atan2(back[1], back[0]), 0) || cc;
  const facing = to => towards(to, [door.u + back[0] * 2.5, door.v + back[1] * 2.5]);
  const relief = {u: far[0], v: far[1], du: -back[0], dv: -back[1]};
  const brannAt = [far[0] - back[0] * 1.35, far[1] - back[1] * 1.35];
  const along = [DIAG, DIAG];
  const endAt = sgn => { const w = wallPoint(MINE.chapel, Math.atan2(along[1] * sgn, along[0] * sgn), .95); return w || [cc[0] + along[0] * sgn * 2.6, cc[1] + along[1] * sgn * 2.6]; };
  const crabAt = endAt(1), goatAt = endAt(-1);
  const benchAt = [brannAt[0] + along[0] * 1.9 - back[0] * .1, brannAt[1] + along[1] * 1.9 - back[1] * .1];
  const chapel = {
    relief, brann: {u: brannAt[0], v: brannAt[1], du: -back[0], dv: -back[1]},
    crab: {u: crabAt[0], v: crabAt[1], ...dir(facing(crabAt))}, goat: {u: goatAt[0], v: goatAt[1], ...dir(facing(goatAt))},
    bench: {u: benchAt[0], v: benchAt[1], du: -back[0], dv: -back[1]},
    chandelier: {u: cc[0] + back[0] * .3, v: cc[1] + back[1] * .3, up: roofAt(cc[0] + back[0] * .3, cc[1] + back[1] * .3) - .38},
  };
  for (const p of [brannAt, crabAt, goatAt, benchAt]) busy.push([p[0], p[1], 1.1]);
  busy.push([far[0], far[1], 1.5]);

  // ---- The Brine Deep: salt spires round the lake, icicles over it, and a glowing salt curtain half across the
  // squeeze (walk past its end); the Saltman stands in the far corner.
  const D = MINE.halls[MINE.deep], lake = MINE.pools[MINE.lake], sq = MINE.drifts.find(d => d.name === 'squeeze').points;
  for (let k = 0; k < 10; k++) {
    const a = k * 2.399 + .3, r = lake[2] * (.25 + .6 * ((k * 7) % 10) / 10);
    stalactites.push({u: lake[0] + Math.cos(a) * r, v: lake[1] + Math.sin(a) * r, s: .7 + .5 * ((k * 3) % 5) / 4, yaw: k * 1.9});
  }
  for (let k = 0; k < 48 && spires.length < 7; k++) {
    const a = k * 2.399 + 1.1, r = lake[2] + .55 + .6 * ((k * 3) % 4) / 3, u = lake[0] + Math.cos(a) * r, v = lake[1] + Math.sin(a) * r;
    if (insideAt(u, v) > .7 && mineField(u, v).room === MINE.deep && DAMP_VENTS.every(p => Math.hypot(p[0] - u, p[1] - v) > 1.8) && SEAM_SPOTS.every(p => Math.hypot(p.u - u, p.v - v) > 1.1) && spires.every(q => Math.hypot(q.u - u, q.v - v) > 1.4)) {
      spires.push({u, v, s: .6 + .5 * ((k * 5) % 4) / 3, yaw: k * 1.3}); busy.push([u, v, .5]);
    }
  }
  // Salt curtains hang down the Deep's walls where the roof springs from them (flowstone, facing into the chamber).
  for (let k = 0; k < 40 && drapes.length < 3; k++) {
    const p = wallPoint(MINE.deep, k * 2.399 + .9, .02);
    if (p && Math.hypot(p[0] - sq[0][0], p[1] - sq[0][1]) > 2.5 && drapes.every(q => Math.hypot(q.u - p[0], q.v - p[1]) > 3)) drapes.push({u: p[0], v: p[1], ...dir(towards(p, [D[0], D[1]])), s: .8 + .15 * (k % 2)});
  }
  const deepFar = wallPoint(MINE.deep, Math.PI / 4, 1.0) || [D[0] + 2.5, D[1] + 2.5];
  const saltman = {u: deepFar[0], v: deepFar[1], ...dir(towards(deepFar, [lake[0], lake[1]]))};
  busy.push([saltman.u, saltman.v, 1]);
  // Grotto: the Great Salt Shaker facing the squeeze, two icicles over it.
  const G = MINE.halls[MINE.grotto];
  const shaker = {u: SHAKER_SPOT[0], v: SHAKER_SPOT[1], ...dir(towards(SHAKER_SPOT, sq[1]))};
  stalactites.push({u: G[0] + .5, v: G[1] + .3, s: .55, yaw: .4}, {u: G[0] - .4, v: G[1] + .6, s: .45, yaw: 2.2});

  // ---- Bits of mine life: the canary's cage hangs from the chapel drift's first set (by the hall's firedamp), a
  // miner's lunch by the cart, a crab warning at the top of the drift down to the Deep, a tally board on the tunnel
  // wall and a tool rack in the hall.
  const cs = sets[mainSets], cageSide = -1;
  const canary = {u: cs.u - cs.dv * cageSide * .85 * cs.sx, v: cs.v + cs.du * cageSide * .85 * cs.sx, up: SET_OPENING.height * cs.sy - .12, du: cs.du, dv: cs.dv};
  const lunchAt = [cart.u - cart.dv * 1.15 + cart.du * .4, cart.v + cart.du * 1.15 + cart.dv * .4];
  const lunch = {u: lunchAt[0], v: lunchAt[1], ...dir(towards(lunchAt, [cart.u, cart.v]))};
  const dd = driftAt('deep', .2), signAt = [dd.u - dd.dv * (dd.half - .35), dd.v + dd.du * (dd.half - .35)];
  const sign = {u: signAt[0] - dd.du * .9, v: signAt[1] - dd.dv * .9, du: -dd.du, dv: -dd.dv};
  const tq = pathAt(p0 + 3.3), tally = {u: tq.u + tq.dv * (tq.half + .1), v: tq.v - tq.du * (tq.half + .1), du: -tq.dv, dv: tq.du};
  let rack = null;
  for (let k = 0; k < 24 && !rack; k++) {
    const w = wallPoint(0, 2.2 + k * .26, .05);
    if (w && clear(w[0], w[1], .2)) rack = {u: w[0], v: w[1], ...dir(towards(w, [MINE.halls[0][0], MINE.halls[0][1]]))};
  }
  for (const p of [lunch, sign, ...(rack ? [rack] : [])]) busy.push([p.u, p.v, .9]);

  // Showpiece clusters stand into the hall's and the Deep's walls (half in the rock: they keep out of the walking space).
  for (let k = 0; k < 120 && big.length < 7; k++) {
    const room = [0, 1, MINE.deep][k % 3], p = wallPoint(room, k * 2.399 + .7, .05);
    if (p && clear(p[0], p[1], .6) && big.every(b => Math.hypot(b.u - p[0], b.v - p[1]) > 3)) { big.push({u: p[0], v: p[1], yaw: k * 1.7, s: .85 + .25 * ((k * 7) % 5) / 4}); busy.push([p[0], p[1], .9]); }
  }
  // Scatter: small clusters along every wall, tunnel, drift and chamber (fewer in the chapel, where the carvings are).
  MINE.halls.forEach((h, room) => {
    const n = room === MINE.chapel ? 24 : room === MINE.grotto ? 14 : 60;
    for (let k = 0; k < n; k++) {
      const p = wallPoint(room, k * 2.399 + .2, .12 + .1 * (k % 3));
      if (p && clear(p[0], p[1], .2) && small.every(b => Math.hypot(b.u - p[0], b.v - p[1]) > .9)) { small.push({u: p[0], v: p[1], yaw: k * 2.1, s: .8 + .5 * ((k * 5) % 7) / 6}); busy.push([p[0], p[1], .35]); }
    }
  });
  const edge = (q, side, s) => { const u = q.u - q.dv * side * (q.half - .05), v = q.v + q.du * side * (q.half - .05); if (clear(u, v, .3) && insideAt(u, v) > -.05) small.push({u, v, yaw: s * 3.1 + side, s: .7 + .3 * ((Math.round(s * 10) % 4) / 3)}); };
  for (let s = p0 + .6; s < end; s += 1.35) for (const side of [-1, 1]) edge(pathAt(s + (side > 0 ? .6 : 0)), side, s);
  for (const name of ['chapel', 'deep', 'squeeze']) for (let s = .4, L = driftLength(name); s < L; s += 1.2) for (const side of [-1, 1]) edge(driftAt(name, s + (side > 0 ? .5 : 0)), side, s);
  // Two old falls left at the bend, rubble against the walls.
  for (const s of [p0 + 4.3, end - .9]) {
    const q = pathAt(s), side = s > p0 + 5 ? 1 : -1, u = q.u - q.dv * side * (q.half - .25), v = q.v + q.du * side * (q.half - .25);
    rubble.push({u, v, yaw: s * 1.3, s: .7});
  }
  const vents = DAMP_VENTS.map(([u, v], i) => ({u, v, yaw: i * 2.2 + .4}));
  const pools = MINE.pools.map(([u, v, r]) => ({u, v, r}));
  return {sets, rails, lanterns, cart, big, small, rubble, vents, pools, chapel, spires, stalactites, drapes, saltman, shaker, canary, lunch, sign, tally, rack};
}
function dir([du, dv]) { return {du, dv}; }

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
  const stat = {ready: false, curios: false, failed: false, draws: 0, instances: 0, triangles: 0, missing: []};
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
  function harvest(gltf, names, required) {
    for (const name of names) {
      const node = gltf.scene.getObjectByName(name);
      if (!node) { if (required) throw Error(`salt-mine kit is missing ${name}`); stat.missing.push(name); continue; }
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
  function instanced(name, transforms, into = group) {
    if (!transforms.length || !pieces.has(name)) return;
    for (const {geometry, material} of pieces.get(name)) {
      const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
      transforms.forEach((t, i) => mesh.setMatrixAt(i, t));
      mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
      mesh.name = `SaltMineKit_${name}`; mesh.raycast = () => {}; mesh.castShadow = false; mesh.receiveShadow = false; mesh.matrixAutoUpdate = false; mesh.userData.presentationOnly = true;
      into.add(mesh); stat.draws++; stat.instances += transforms.length; stat.triangles += transforms.length * (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
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
    // The chapel and the Deep.
    const X = Object.fromEntries(CHAPEL_NODES.map(n => [n, []])), ch = L.chapel, face = (side, o) => yawOf(side, o.du, o.dv);
    for (const side of MINE_SIDES) {
      X.StatueBrann.push(at(side, ch.brann.u, ch.brann.v, face(side, ch.brann), 1, -.05));
      X.StatueCrab.push(at(side, ch.crab.u, ch.crab.v, face(side, ch.crab), 1, -.04));
      X.StatueGoat.push(at(side, ch.goat.u, ch.goat.v, face(side, ch.goat), 1, -.04));
      X.CarversBench.push(at(side, ch.bench.u, ch.bench.v, face(side, ch.bench), 1, -.03));
      X.ChapelRelief.push(at(side, ch.relief.u - ch.relief.du * .22, ch.relief.v - ch.relief.dv * .22, face(side, ch.relief), 1, .55));
      X.SaltChandelier.push(at(side, ch.chandelier.u, ch.chandelier.v, side.length, 1, ch.chandelier.up));
      for (const p of L.spires) X.SaltSpire.push(at(side, p.u, p.v, p.yaw, p.s, -.08));
      for (const p of L.stalactites) { const [x, z] = minePoint(side, [p.u, p.v]); X.Stalactites.push(at(side, p.u, p.v, p.yaw, p.s, mineArch(p.u, p.v).height - .2 + .05 * Math.sin(x + z))); }
      for (const p of L.drapes) X.SaltDrapery.push(at(side, p.u - p.du * .18, p.v - p.dv * .18, face(side, p), p.s, mineArch(p.u, p.v).height + .05)); // tucked into the wall's bulge
    }
    for (const n of CHAPEL_NODES) instanced(n, X[n]);
    // Brine: still, clear teal water lit from the salt beneath; one draw for all four pools.
    const disc = new THREE.CircleGeometry(1, low ? 20 : 36); disc.rotateX(-Math.PI / 2); disposables.add(disc);
    const brine = new THREE.MeshStandardMaterial({color: 0x2c8a86, emissive: 0x2fa69c, emissiveIntensity: .55, roughness: .08, metalness: 0, transparent: true, opacity: .84, envMapIntensity: .8});
    disposables.add(brine);
    // Brine: shallow and pale over the salt crust at the edge, deep teal in the middle, with slow caustic light
    // wandering across it (lit from the salt below, emissive only).
    brine.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, glow);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBrine; varying vec3 vBrineW;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBrine = position;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvec4 bw = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nbw = instanceMatrix * bw;\n#endif\nvBrineW = (modelMatrix * bw).xyz;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vBrine; varying vec3 vBrineW; uniform float uSaltKitTime;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          float brineR = length(vBrine.xz), brineShallow = smoothstep(.6, .98, brineR);
          diffuseColor.rgb = mix(vec3(.03, .24, .28), vec3(.5, .74, .72), brineShallow);
          diffuseColor.a = mix(.9, .55, brineShallow);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          vec2 bq = vBrineW.xz * 2.3; float bt = uSaltKitTime * .5;
          float caustic = abs(sin(bq.x + sin(bq.y * 1.3 + bt) * 1.4 + bt) * sin(bq.y * 1.1 + sin(bq.x * .9 - bt * 1.2) * 1.3 - bt * .7));
          caustic = pow(1.0 - caustic, 6.0);
          totalEmissiveRadiance = vec3(.04, .26, .28) * (1.0 - brineShallow * .5) + vec3(.6, 1.0, .92) * caustic * .2 + vec3(1.0, .85, .85) * brineShallow * .08;`);
    };
    brine.customProgramCacheKey = () => 'salt-brine';
    const pools = new THREE.InstancedMesh(disc, brine, water.length);
    water.forEach((w, i) => pools.setMatrixAt(i, m4.compose(pos.set(w.x, w.y, w.z), q.identity(), scl.set(w.r, 1, w.r)).clone()));
    pools.instanceMatrix.needsUpdate = true; pools.computeBoundingSphere(); pools.name = 'SaltMineKit_brine'; pools.raycast = () => {}; pools.matrixAutoUpdate = false; pools.renderOrder = 2;
    group.add(pools); stat.draws++;
    group.updateMatrixWorld(true);
  }
  // The curios: placed like the kit, except the canaries, which move (one bird per mine, perched or keeled over).
  const canaries = [], curios = new THREE.Group(); curios.name = 'SaltMineCurios';
  function placeCurios() {
    const L = layout, Y = Object.fromEntries(CURIO_NODES.map(n => [n, []])), face = (side, o) => yawOf(side, o.du, o.dv);
    for (const side of MINE_SIDES) {
      const c = L.canary, cage = at(side, c.u, c.v, face(side, c), 1, c.up);
      Y.CanaryCage.push(cage);
      Y.LunchPail.push(at(side, L.lunch.u, L.lunch.v, face(side, L.lunch), 1, -.01));
      Y.Saltman.push(at(side, L.saltman.u, L.saltman.v, face(side, L.saltman), 1, -.05));
      Y.SaltShaker.push(at(side, L.shaker.u, L.shaker.v, face(side, L.shaker), 1, -.04));
      Y.SignCrabs.push(at(side, L.sign.u, L.sign.v, face(side, L.sign), 1, -.06));
      Y.TallyBoard.push(at(side, L.tally.u, L.tally.v, face(side, L.tally), 1, 1.15));
      if (L.rack) Y.ToolRack.push(at(side, L.rack.u, L.rack.v, face(side, L.rack), 1, .25));
      // The bird: its own little group under the cage, so it can hop, sing and keel over.
      const bird = new THREE.Group(); bird.name = `SaltMineCanary_${side}`; bird.matrixAutoUpdate = false;
      bird.matrix.copy(cage); bird.matrixWorldNeedsUpdate = true;
      const perched = new THREE.Group(), keeled = new THREE.Group(); perched.position.fromArray(CAGE.perch); keeled.position.fromArray(CAGE.floor); keeled.visible = false;
      for (const [node, host] of [['Canary', perched], ['CanaryKeeled', keeled]]) for (const {geometry, material} of pieces.get(node) || []) {
        const m = new THREE.Mesh(geometry, material); m.raycast = () => {}; m.castShadow = false; m.userData.presentationOnly = true; host.add(m); stat.draws++;
      }
      bird.add(perched, keeled); curios.add(bird);
      canaries.push({side, perched, keeled, hop: 0, down: 0, seed: side === 'east' ? 0 : 3.7});
    }
    for (const n of CURIO_NODES) if (n !== 'Canary' && n !== 'CanaryKeeled' && n !== 'CrabCrown') instanced(n, Y[n], curios);
    curios.updateMatrixWorld(true);
  }
  /** Is any firedamp in this mine's hall ready to blow? The canary knows (vents 0 and 1 are the hall's). */
  const gasReady = (snapshot, side, tick) => { const d = snapshot?.mines?.[side]?.damp; return !!d && [0, 1].some(i => tick >= (d[i] ?? Infinity)); };
  let birdTime = 0;
  function updateCanaries(dt, snapshot, tick) {
    birdTime += dt;
    for (const c of canaries) {
      // Keeled over while the gas is up (with a comic delay); hops up again once it has gone.
      const want = gasReady(snapshot, c.side, tick) ? 1 : 0;
      c.down += (want - c.down) * Math.min(1, dt * (want ? 1.4 : 3));
      const down = c.down > .5;
      c.perched.visible = !down; c.keeled.visible = down;
      const t = birdTime + c.seed, song = Math.max(0, Math.sin(t * 1.3)) ** 8;
      // Perched: a little hop now and then, a tilt of the head while it sings, turning on the perch.
      c.perched.position.y = CAGE.perch[1] + .025 * Math.max(0, Math.sin(t * 5.1)) ** 12;
      c.perched.rotation.set(-.15 * song, Math.sin(t * .37) * .9, .08 * Math.sin(t * 9) * song);
      // Keeled: feet twitching in the air.
      c.keeled.rotation.set(0, Math.sin(t * .2) * .3, .05 * Math.sin(t * 13) * (Math.sin(t * .9) > .6 ? 1 : 0));
    }
  }
  let disposed = false;
  async function install(gltf, prepare = async () => {}) {
    if (disposed || stat.ready) return false;
    try { harvest(gltf, KIT_NODES, true); harvest(gltf, CHAPEL_NODES, false); place(); await prepare(group); }
    catch (err) { stat.failed = String(err?.message || err); return false; }
    if (disposed) return false;
    scene.add(group); stat.ready = true; return true;
  }
  /** The curios come in their own file, any time after the kit's or before it. */
  async function installCurios(gltf, prepare = async () => {}) {
    if (disposed || stat.curios) return false;
    try { harvest(gltf, CURIO_NODES, false); placeCurios(); await prepare(curios); }
    catch (err) { stat.failed = String(err?.message || err); return false; }
    if (disposed) return false;
    scene.add(curios); stat.curios = true; return true;
  }
  return {
    group, curios, layout, install, installCurios, failed(reason) { stat.failed = String(reason || 'unavailable'); },
    /** King Pinchy's crown, a fresh mesh group for the crab view (null until the curios arrive). */
    crown() {
      const parts = pieces.get('CrabCrown'); if (!parts) return null;
      const g = new THREE.Group(); g.name = 'KingPinchyCrown';
      for (const {geometry, material} of parts) { const m = new THREE.Mesh(geometry, material); m.raycast = () => {}; m.castShadow = false; g.add(m); }
      return g;
    },
    update(dt, level = 1, {snapshot, tick = 0} = {}) { glow.uSaltKitTime.value += dt; glow.uSaltKitGlow.value = level; if (canaries.length) updateCanaries(dt, snapshot, tick); },
    stats: () => ({...stat, canaries: canaries.map(c => c.down > .5 ? 'keeled' : 'singing')}),
    dispose() { disposed = true; scene.remove(group); scene.remove(curios); for (const d of disposables) d.dispose?.(); },
  };
}
