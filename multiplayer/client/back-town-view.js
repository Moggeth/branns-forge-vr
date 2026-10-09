// The back towns: through each keep's pass, in the corner past the old map edge. A Workshop (furnace, anvil, bar
// rack), the Stores, two cottages, a well and lanterns up the pass. Reads the authoritative layout from
// shared/keep-sites.js (backTownPiece / backTownPoint) and animates on the frame clock: the furnace breathes, roars
// while someone smelts, and each `workshop_smelt` event throws sparks off the anvil and drops a glowing bar on the rack.
// Code-built stand-ins draw until the Blender kit (assets/backtown-20261008 -> /assets/backtown_kit.glb) loads.
import * as THREE from 'three';
import {BACK_TOWN_LANTERNS, backTownPiece, backTownPoint} from '../shared/keep-sites.js';
import {WORKSHOP} from '../shared/home-workshop.js';
import {terrainHeight} from '../shared/terrain.js';

const PIECES = ['Workshop', 'Stores', 'Cottage', 'CottageB', 'Well', 'Lantern'];
const LAYOUT = [['workshop', 'Workshop'], ['stores', 'Stores'], ['cottage', 'Cottage'], ['cottage2', 'CottageB'], ['well', 'Well']];
const GLOW = {Crystal: 1.5, Amethyst: 1.5, Ember: 2.4, Ooze: 1.7};
const SIDES = {party: {pre: 'D', wood: 0x8a6440, roof: 0x3d4a5c, stone: 0xb9ad97, trim: 0xc49a52, glow: 0xffc76a},
  rivals: {pre: 'G', wood: 0x3a3134, roof: 0x5a4a62, stone: 0x4f4656, trim: 0x5a3a2c, glow: 0xb0ff6a}};
const METAL = {iron: 0xb8c0c8, copper: 0xe08850, gold: 0xffd24a, mithril: 0x9ad8ff, starMetal: 0xb48cff};
const ROAR = 2.2; // seconds the furnace stays roaring after the last smelt

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({color, roughness: .8, metalness: 0, flatShading: true, ...extra});

export function createBackTownView({scene}) {
  const root = new THREE.Group(); root.name = 'back-towns'; scene.add(root);
  const pieces = new Map(), sparks = [], sparkPool = [], bars = [];
  let snapshot = null, enabled = false, kit = null;
  const geo = {box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(1, 1, 1, 8), cone: new THREE.ConeGeometry(1, 1, 8),
    spark: new THREE.OctahedronGeometry(.06, 0), bar: new THREE.BoxGeometry(.34, .09, .13)};
  const sparkMats = new Map();
  const sparkMat = color => { let m = sparkMats.get(color); if (!m) { m = new THREE.MeshBasicMaterial({color, transparent: true, depthWrite: false}); sparkMats.set(color, m); } return m; };
  const barMats = new Map();
  const barMat = metal => { let m = barMats.get(metal); if (!m) { const c = METAL[metal] ?? 0xd0d0d0; m = new THREE.MeshStandardMaterial({color: c, emissive: 0xff6a1a, emissiveIntensity: 1.6, metalness: .8, roughness: .35}); barMats.set(metal, m); } return m; };
  const fireMat = new THREE.MeshBasicMaterial({color: 0xffa04a, transparent: true, opacity: .85, depthWrite: false, blending: THREE.AdditiveBlending});
  const standMats = {};
  for (const [side, s] of Object.entries(SIDES)) standMats[side] = {wood: mat(s.wood), roof: mat(s.roof), stone: mat(s.stone), trim: mat(s.trim, {metalness: .4, roughness: .5}),
    glow: new THREE.MeshStandardMaterial({color: s.glow, emissive: s.glow, emissiveIntensity: 2, flatShading: true})};
  const add = (parent, g, m, [x, y, z], [sx, sy, sz] = [1, 1, 1]) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); parent.add(o); return o; };

  // ---- Stand-ins (same footprints and anchors as the kit) ----
  function standHouse(M, w, d, h) {
    const g = new THREE.Group();
    add(g, geo.box, M.stone, [0, h / 2, 0], [w, h, d]);
    const roof = add(g, geo.cone, M.roof, [0, h + .9, 0], [Math.hypot(w, d) * .55, 1.8, Math.hypot(w, d) * .55]); roof.rotation.y = Math.PI / 4;
    add(g, geo.box, M.wood, [0, .9, d / 2 + .02], [1, 1.8, .08]);
    return g;
  }
  function stand(kind, side) {
    const M = standMats[side];
    if (kind === 'Workshop') {
      const g = new THREE.Group();
      add(g, geo.box, M.stone, [0, 1.5, -2.3], [6, 3, .5]);
      for (const s of [-1, 1]) add(g, geo.box, M.stone, [s * 2.8, 1.5, -.2], [.5, 3, 4.6]);
      add(g, geo.box, M.roof, [0, 3.2, -.2], [6.4, .3, 5.2]);
      add(g, geo.box, M.stone, [-1.3, .8, -1.2], [1.8, 1.6, 1.6]); add(g, geo.cyl, M.stone, [-1.3, 3.2, -1.4], [.4, 2.6, .4]);
      add(g, geo.box, M.trim, [.4, .45, 1.3], [.8, .9, .35]);
      add(g, geo.box, M.wood, [1.9, .4, 1.4], [.9, .8, .9]); add(g, geo.box, M.wood, [-2.15, .8, 1.2], [.5, 1.6, .7]);
      add(g, geo.box, M.wood, [2.1, .3, -1.3], [.6, .6, 1.2]);
      return {group: g, furnace: new THREE.Vector3(-1.3, .65, -.45), anvil: new THREE.Vector3(.4, .96, 1.3), rack: new THREE.Vector3(-2.15, 1.1, 1.2)};
    }
    if (kind === 'Stores') return {group: standHouse(M, 5, 3.5, 2.6)};
    if (kind === 'Cottage' || kind === 'CottageB') return {group: standHouse(M, 4.5, 4, 2.4)};
    if (kind === 'Well') { const g = new THREE.Group(); add(g, geo.cyl, M.stone, [0, .4, 0], [.9, .8, .9]); add(g, geo.cone, M.roof, [0, 2.3, 0], [1.2, .8, 1.2]); for (const s of [-1, 1]) add(g, geo.box, M.wood, [s * .75, 1.2, 0], [.12, 2, .12]); return {group: g}; }
    const g = new THREE.Group(); add(g, geo.cyl, M.wood, [0, 1.1, 0], [.07, 2.2, .07]); add(g, geo.box, M.glow, [0, 2.15, .55], [.22, .3, .22]); add(g, geo.box, M.wood, [0, 2.3, .27], [.06, .06, .6]);
    return {group: g};
  }

  // ---- Kit pieces ----
  const anchor = (obj, pre, name, fallback) => obj.getObjectByName(`${pre}_${name}`)?.position.clone() ?? new THREE.Vector3(...fallback);
  function fromKit(kind, side) {
    const pre = SIDES[side].pre, body = kit.nodes.get(`${pre}_${kind}`)?.clone(true);
    if (!body) return null;
    const g = new THREE.Group(); g.add(body); body.position.set(0, 0, 0); body.rotation.set(0, 0, 0);
    if (kind !== 'Workshop') return {group: g};
    return {group: g, furnace: anchor(body, pre, 'Workshop_Furnace', [-1.3, .65, -.45]), anvil: anchor(body, pre, 'Workshop_Anvil', [.4, .96, 1.3]), rack: anchor(body, pre, 'Workshop_Rack', [-2.15, 1.1, 1.2])};
  }

  function build(id, kind, side, placed) {
    const made = (kit && fromKit(kind, side)) || stand(kind, side);
    made.group.name = id; made.group.rotation.y = placed.yaw; made.kind = kind; made.side = side; made.placed = placed;
    made.group.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    if (made.furnace) {
      // A soft additive flame in the furnace mouth: breathes at rest, roars while smelting.
      made.flame = add(made.group, geo.cone, fireMat, [made.furnace.x, made.furnace.y - .05, made.furnace.z - .3], [.22, .4, .22]);
      made.roar = 0; made.shelf = 0;
    }
    root.add(made.group); pieces.set(id, made); return made;
  }
  function layout() {
    if (!snapshot) return;
    for (const side of ['party', 'rivals']) {
      for (const [name, kind] of LAYOUT) {
        const id = `${name}-${side}`, placed = backTownPiece(side, name), p = pieces.get(id) || build(id, kind, side, placed);
        p.group.position.set(placed.x, terrainHeight(snapshot, placed.x, placed.z, false), placed.z);
      }
      BACK_TOWN_LANTERNS.forEach((at, i) => {
        const [x, z] = backTownPoint(side, at), id = `lantern-${side}-${i}`;
        // Lanterns hang toward the pass's centre line so the light falls on the path.
        const [cx, cz] = backTownPoint(side, [(at[0] + at[1]) / 2, (at[0] + at[1]) / 2]);
        const placed = {x, z, yaw: Math.hypot(cx - x, cz - z) > .1 ? Math.atan2(cx - x, cz - z) : 0};
        const p = pieces.get(id) || build(id, 'Lantern', side, placed);
        p.group.position.set(x, terrainHeight(snapshot, x, z, false), z);
      });
    }
  }
  function clear() { for (const p of pieces.values()) p.group.removeFromParent(); pieces.clear(); for (const b of bars) b.m.removeFromParent(); bars.length = 0; }

  function installKit(gltf) {
    const nodes = new Map(); for (const o of gltf.scene.children) nodes.set(o.name, o);
    for (const pre of ['D', 'G']) if (PIECES.some(n => !nodes.has(`${pre}_${n}`))) return false;
    const seen = new Set();
    gltf.scene.traverse(o => {
      if (!o.isMesh || seen.has(o.material)) return; seen.add(o.material);
      const m = o.material; m.vertexColors = !!o.geometry.attributes.color;
      if (GLOW[m.name] !== undefined) { m.emissive.setRGB(1, 1, 1); m.emissiveIntensity = GLOW[m.name]; }
      if (m.name !== 'Cloth') m.side = THREE.FrontSide;
      m.needsUpdate = true;
    });
    kit = {nodes}; clear(); if (enabled) layout();
    return true;
  }

  const total = 2 * (LAYOUT.length + BACK_TOWN_LANTERNS.length);
  function sync(s) {
    snapshot = s; const on = s?.battle?.v === 2 && s.battle.status === 'running';
    if (on !== enabled) { enabled = on; root.visible = on; }
    if (on && pieces.size < total) layout();
  }

  // ---- Effects: anvil sparks and cooling bars on the rack, pooled ----
  function spark(from, color, vel, life = .7, delay = 0) {
    const m = sparkPool.pop() || (() => { const c = new THREE.Mesh(geo.spark); root.add(c); return c; })();
    m.material = sparkMat(color); m.visible = false; sparks.push({m, p: new THREE.Vector3(...from), v: new THREE.Vector3(...vel), t: -delay, life});
  }
  const worldOf = (p, local) => p.group.localToWorld(local.clone());
  function event(ev) {
    if (!enabled || ev.kind !== 'workshop_smelt') return;
    const p = pieces.get(`workshop-${ev.side}`); if (!p) return;
    p.roar = ROAR;
    const a = worldOf(p, p.anvil);
    for (let i = 0; i < 12; i++) { const ang = Math.random() * Math.PI * 2, r = 1 + Math.random() * 1.6; spark([a.x, a.y + .08, a.z], i % 3 ? 0xffb347 : 0xfff2b0, [Math.cos(ang) * r, 1.6 + Math.random() * 2, Math.sin(ang) * r], .45 + Math.random() * .35, i * .01); }
    // A fresh bar lands on the rack's next shelf and cools from forge-orange to its own metal over a few seconds.
    const slot = p.shelf++ % 6, rack = p.rack.clone().add(new THREE.Vector3(0, -.35 + (slot >> 1) * .36, (slot & 1 ? .14 : -.14)));
    const m = new THREE.Mesh(geo.bar, barMat(ev.metal).clone()); m.position.copy(rack); m.rotation.y = Math.PI / 2; p.group.add(m);
    bars.push({m, t: 0, from: a.clone(), piece: p, life: 6});
  }

  function update(dt) {
    if (!enabled || !snapshot) return;
    const t = performance.now() / 1000;
    for (const p of pieces.values()) {
      if (!p.flame) continue;
      p.roar = Math.max(0, p.roar - dt);
      const hot = Math.min(1, p.roar / .6), f = 1 + Math.sin(t * 8.3 + p.placed.x) * .14 + Math.sin(t * 13.7) * .09;
      p.flame.scale.set(.22 + hot * .08, (.4 + hot * .25) * f, .22 + hot * .08);
      fireMat.opacity = .7 + hot * .25;
      if (hot > .3 && Math.random() < dt * 14) { const w = worldOf(p, p.furnace); spark([w.x + (Math.random() - .5) * .4, w.y + .4, w.z], 0xff8a3a, [(Math.random() - .5) * .4, 1.4 + Math.random(), (Math.random() - .5) * .4], .6); }
    }
    for (let i = bars.length - 1; i >= 0; i--) {
      const b = bars[i]; b.t += dt;
      const cool = Math.min(1, b.t / 4); b.m.material.emissiveIntensity = 1.6 * (1 - cool) ** 2;
      b.m.scale.setScalar(Math.min(1, b.t * 6));
      if (b.t >= b.life) { b.m.removeFromParent(); b.m.material.dispose(); bars.splice(i, 1); }
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i]; s.t += dt;
      if (s.t < 0) continue;
      if (s.t >= s.life) { s.m.visible = false; sparks.splice(i, 1); sparkPool.push(s.m); continue; }
      s.v.y -= 6 * dt; s.v.multiplyScalar(Math.exp(-dt * 1.2)); s.p.addScaledVector(s.v, dt); s.m.visible = true; s.m.position.copy(s.p);
      const u = s.t / s.life; s.m.scale.setScalar(1.2 * (1 - u * u));
    }
  }

  return {sync, event, update, installKit, object: root,
    stats: () => ({kit: !!kit, pieces: pieces.size, bars: bars.length, roaring: [...pieces.values()].filter(p => p.roar > 0).map(p => p.side)}),
    dispose() { clear(); root.removeFromParent(); for (const g of Object.values(geo)) g.dispose(); fireMat.dispose(); for (const m of [...sparkMats.values(), ...barMats.values()]) m.dispose(); }};
}
// Exposed for tests: the smelting pace the furnace roar is tuned against.
export const BACK_TOWN_VIEW = Object.freeze({roar: ROAR, every: WORKSHOP.every});
