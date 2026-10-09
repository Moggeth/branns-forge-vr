// The keep towns: three taverns (one per keep and The Muddled Mug between them), each keep's Quartermaster stall and
// its Gold mill. Reads the authoritative layout (shared/home-bases.js homePiece / neutralTavern) and mill state
// (battle.bases[].mill) from the snapshot and animates on the frame clock: mill sails idle, grind and race when
// cranked; the capstan turns; hearths flicker; coins hop out of the chute, the counter and fallen troops.
// Code-built stand-ins draw until the Blender kit (assets/town-20261007 -> /assets/town_kit.glb) loads.
import * as THREE from 'three';
import {TAVERN_SCALE, homePiece, neutralTavern} from '../shared/home-bases.js';
import {MILL} from '../shared/home-mill.js';
import {terrainHeight} from '../shared/terrain.js';

const PIECES = ['Tavern', 'Quartermaster', 'Mill', 'MillSails', 'MillCrank'];
const GLOW = {Crystal: 1.5, Amethyst: 1.5, Ember: 2.4, Ooze: 1.7};
const SIDES = {party: {pre: 'D', wood: 0x8a6440, roof: 0x3d4a5c, stone: 0xb9ad97, cloth: 0x2f6fd0, trim: 0xc49a52},
  rivals: {pre: 'G', wood: 0x3a3134, roof: 0xe6dac0, stone: 0x4f4656, cloth: 0x6b2a8c, trim: 0x5a3a2c},
  neutral: {pre: 'N', wood: 0x7a5636, roof: 0x5a7a3a, stone: 0xa89c84, cloth: 0xd08a2f, trim: 0xb08a4a}};
const SAIL_SPEED = {idle: .25, grind: 1.3, crank: 3.4};
const COIN = 0xffcf4a;

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({color, roughness: .8, metalness: 0, flatShading: true, ...extra});

export function createHomeTownView({scene}) {
  const root = new THREE.Group(); root.name = 'home-towns'; scene.add(root);
  const pieces = new Map(), coins = [], coinPool = [], sparks = [], sparkPool = [];
  let snapshot = null, enabled = false, kit = null;
  const geo = {box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(1, 1, 1, 8), cone: new THREE.ConeGeometry(1, 1, 8),
    coin: new THREE.CylinderGeometry(.11, .11, .03, 10), spark: new THREE.OctahedronGeometry(.07, 0)};
  const coinMat = new THREE.MeshStandardMaterial({color: COIN, emissive: 0xb07a10, emissiveIntensity: .6, metalness: .8, roughness: .3});
  const sparkMats = new Map();
  const sparkMat = color => { let m = sparkMats.get(color); if (!m) { m = new THREE.MeshBasicMaterial({color, transparent: true, depthWrite: false}); sparkMats.set(color, m); } return m; };
  const emberMat = new THREE.MeshStandardMaterial({color: 0xff8a2a, emissive: 0xff6a1a, emissiveIntensity: 2.2, flatShading: true});
  const standMats = {};
  for (const [side, s] of Object.entries(SIDES)) standMats[side] = {wood: mat(s.wood), roof: mat(s.roof), stone: mat(s.stone), cloth: mat(s.cloth, {side: THREE.DoubleSide}), trim: mat(s.trim, {metalness: .4, roughness: .5})};
  const add = (parent, g, m, [x, y, z], [sx, sy, sz] = [1, 1, 1]) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); parent.add(o); return o; };

  // ---- Stand-ins (same footprints and anchors as the kit) ----
  function standTavern(side) {
    const M = standMats[side], g = new THREE.Group(), n = side === 'neutral', hw = n ? 5.5 : 4, back = n ? -4 : -3, front = n ? 3.8 : 2.8, H = n ? 3.6 : 3.2;
    add(g, geo.box, M.stone, [0, .1, (back + front) / 2], [hw * 2, .2, front - back + .6]);
    add(g, geo.box, M.wood, [0, H / 2, back], [hw * 2, H, .3]);
    for (const s of [-1, 1]) { add(g, geo.box, M.wood, [s * hw, H / 2, back / 2 + .3], [.3, H, -back + .6]); add(g, geo.box, M.trim, [s * (hw - .2), H / 2, front], [.3, H, .3]); }
    const roof = add(g, geo.box, M.roof, [0, H + .5, (back + front) / 2], [hw * 2 + .8, .3, front - back + 1.2]); roof.rotation.x = .08;
    const barZ = n ? -2.55 : -1.75; add(g, geo.box, M.wood, [0, .55, barZ - .35], [n ? 4.4 : 3.4, 1.1, .7]); add(g, geo.box, M.trim, [0, 1.12, barZ - .35], [n ? 4.6 : 3.6, .06, .8]);
    for (const [x, z] of n ? [[-3, 1.4], [3, 1.4], [0, 2.2]] : [[-2, 1], [2, 1]]) { add(g, geo.cyl, M.wood, [x, .7, z], [.7, .08, .7]); add(g, geo.cyl, M.wood, [x, .35, z], [.12, .7, .12]); }
    const hx = n ? 5.3 : -3.8, hz = n ? 0 : -.8; add(g, geo.box, M.stone, [hx * .95, .9, hz], [.9, 1.8, 1.4]);
    const fire = add(g, geo.cone, emberMat, [hx * .9, .45, hz], [.3, .6, .3]);
    return {group: g, hearth: [fire]};
  }
  function standStall(side) {
    const M = standMats[side], g = new THREE.Group();
    add(g, geo.box, M.wood, [0, .55, 1.4], [4.6, 1.1, .7]); add(g, geo.box, M.trim, [0, 1.12, 1.4], [4.8, .06, .8]);
    add(g, geo.box, M.wood, [0, 1.3, -1.6], [4.8, 2.6, .25]);
    for (const x of [-2.3, 2.3]) for (const z of [-1.6, 1.6]) add(g, geo.box, M.wood, [x, 1.4, z], [.18, 2.8, .18]);
    const aw = add(g, geo.box, M.cloth, [0, 2.9, 0], [5.2, .1, 4]); aw.rotation.x = -.18;
    for (let i = 0; i < 4; i++) add(g, geo.box, M.trim, [-1.5 + i, 1.6 + (i % 2) * .5, -1.4], [.5, .4, .3]);
    return {group: g};
  }
  function standMill(side) {
    const M = standMats[side], g = new THREE.Group();
    add(g, geo.cyl, M.stone, [0, 3, 0], [2.4, 6, 2.4]);
    add(g, geo.cone, M.roof, [0, 7.2, 0], [2.7, 2.4, 2.7]);
    add(g, geo.box, M.wood, [0, 1.1, 3.3], [1.2, .8, 1.2]); add(g, geo.box, M.trim, [1.3, .4, 3], [.4, .2, .8]);
    const sails = new THREE.Group(); sails.position.set(0, 7.2, 2.3); g.add(sails);
    add(sails, geo.cyl, M.trim, [0, 0, 0], [.3, .4, .3]).rotation.x = Math.PI / 2;
    for (let i = 0; i < 4; i++) { const arm = new THREE.Group(); arm.rotation.z = i * Math.PI / 2; sails.add(arm); add(arm, geo.box, M.wood, [0, 2.3, 0], [.14, 4.4, .1]); add(arm, geo.box, M.cloth, [.45, 2.6, 0], [.8, 3.4, .04]); }
    const crank = new THREE.Group(); crank.position.set(-2, 0, 3); g.add(crank);
    add(crank, geo.cyl, M.wood, [0, .6, 0], [.12, 1.2, .12]);
    for (let i = 0; i < 4; i++) { const b = add(crank, geo.box, M.wood, [0, 1.05, 0], [1.4, .08, .08]); b.rotation.y = i * Math.PI / 4; }
    return {group: g, sails, crank};
  }

  // ---- Kit pieces ----
  function kitNode(pre, name) { return kit.nodes.get(`${pre}_${name}`)?.clone(true); }
  const anchor = (obj, pre, name, fallback) => obj.getObjectByName(`${pre}_${name}`)?.position.clone() ?? new THREE.Vector3(...fallback);
  function kitPiece(kind, side) {
    const pre = SIDES[side].pre, body = kitNode(pre, kind);
    if (!body) return null;
    const g = new THREE.Group(); g.add(body); body.position.set(0, 0, 0); body.rotation.set(0, 0, 0);
    if (kind === 'Tavern') {
      const at = anchor(body, pre, 'Tavern_Hearth', side === 'neutral' ? [5.3, .1, 0] : [-3.8, .1, -.8]);
      const hearth = []; body.traverse(o => { if (o.isMesh && o.material?.name === 'Ember' && o.getWorldPosition(new THREE.Vector3()).distanceTo(at) < 2) hearth.push(o); });
      const flame = add(g, geo.cone, emberMat, [at.x, at.y + .35, at.z], [.22, .5, .22]); hearth.push(flame);
      return {group: g, hearth};
    }
    if (kind === 'Mill') {
      const sails = kitNode(pre, 'MillSails'), crank = kitNode(pre, 'MillCrank');
      if (sails) { sails.position.copy(anchor(body, pre, 'Mill_Hub', [0, 7.2, 2.3])); sails.rotation.set(0, 0, 0); g.add(sails); }
      if (crank) { crank.position.copy(anchor(body, pre, 'Mill_Crank', [-2, 0, 3])); crank.rotation.set(0, 0, 0); g.add(crank); }
      return {group: g, sails, crank};
    }
    return {group: g};
  }

  function build(id, kind, side, placed) {
    const made = (kit && kitPiece(kind, side)) || (kind === 'Tavern' ? standTavern(side) : kind === 'Mill' ? standMill(side) : standStall(side));
    made.group.name = id; made.group.rotation.y = placed.yaw; made.kind = kind; made.side = side; made.placed = placed; made.kit = !!kit;
    if (kind === 'Tavern') made.group.scale.setScalar(TAVERN_SCALE); // roomier halls drawn from the same kit
    made.group.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    made.spin = 0; made.crankSpin = 0; made.sailAngle = 0;
    root.add(made.group); pieces.set(id, made); return made;
  }
  function layout() {
    if (!snapshot) return;
    const want = [];
    for (const side of ['party', 'rivals']) for (const [kind, name] of [['Tavern', 'tavern'], ['Quartermaster', 'quartermaster'], ['Mill', 'mill']]) want.push([`${name}-${side}`, kind, side, homePiece(side, name)]);
    want.push(['tavern-neutral', 'Tavern', 'neutral', neutralTavern()]);
    for (const [id, kind, side, placed] of want) {
      const p = pieces.get(id) || build(id, kind, side, placed);
      p.group.position.set(placed.x, terrainHeight(snapshot, placed.x, placed.z, false), placed.z);
    }
  }
  function clear() { for (const p of pieces.values()) p.group.removeFromParent(); pieces.clear(); }

  function installKit(gltf) {
    const nodes = new Map(); for (const o of gltf.scene.children) nodes.set(o.name, o);
    for (const pre of ['D', 'G']) if (PIECES.some(n => !nodes.has(`${pre}_${n}`))) return false;
    if (!nodes.has('N_Tavern')) return false;
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

  function sync(s) {
    snapshot = s; const on = s?.battle?.v === 2 && s.battle.status === 'running';
    if (on !== enabled) { enabled = on; root.visible = on; }
    if (on && pieces.size < 7) layout();
  }

  // ---- Effects: hopping coins and little sparkles, pooled ----
  function coin(from, vel, delay = 0, life = 1.1) {
    const m = coinPool.pop() || (() => { const c = new THREE.Mesh(geo.coin, coinMat); root.add(c); return c; })();
    m.visible = false; coins.push({m, p: new THREE.Vector3(...from), v: new THREE.Vector3(...vel), t: -delay, life, spin: 6 + Math.random() * 6});
  }
  function spark(from, color, vel, life = .9, delay = 0) {
    const m = sparkPool.pop() || (() => { const c = new THREE.Mesh(geo.spark); root.add(c); return c; })();
    m.material = sparkMat(color); m.visible = false; sparks.push({m, p: new THREE.Vector3(...from), v: new THREE.Vector3(...vel), t: -delay, life});
  }
  function burst(at, n, color, up = 2, spread = 1.2) { for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 + Math.random() * .4; spark(at, color, [Math.cos(a) * spread, up * (.6 + Math.random() * .6), Math.sin(a) * spread], .8 + Math.random() * .4, i * .015); } }
  function fountainOfCoins(at, n) { for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, r = .6 + Math.random() * 1.1; coin(at, [Math.cos(a) * r, 3 + Math.random() * 1.6, Math.sin(a) * r], i * .05); } }

  function event(ev) {
    if (!enabled || !ev.position) return;
    const at = ev.position;
    if (ev.kind === 'gold_earned') fountainOfCoins(at, Math.min(6, 1 + ev.amount));
    else if (ev.kind === 'mill_coin') {
      const p = pieces.get(`mill-${ev.side}`), yaw = p?.placed.yaw ?? 0;
      coin([at[0], at[1] + .3, at[2]], [Math.sin(yaw) * 1.4 + (Math.random() - .5) * .4, 2.4, Math.cos(yaw) * 1.4 + (Math.random() - .5) * .4], 0, .9);
    } else if (ev.kind === 'mill_feed') {
      const n = Math.min(14, 3 + Math.round(ev.gold / 3));
      for (let i = 0; i < n; i++) spark([at[0] + (Math.random() - .5) * .5, at[1] + 1.2, at[2] + (Math.random() - .5) * .5], i % 3 ? 0x9a8f80 : COIN, [0, -1.5, 0], .7, i * .05);
      const p = pieces.get(`mill-${ev.side}`); if (p) p.kick = 1;
    } else if (ev.kind === 'mill_crank') { const p = pieces.get(`mill-${ev.side}`); if (p) p.kick = 1; }
    else if (ev.kind === 'shop_buy') { fountainOfCoins([at[0], at[1] + .2, at[2]], 4); burst([at[0], at[1] + .5, at[2]], 14, 0xffe08a, 2.4); }
    else if (ev.kind === 'shop_sell') fountainOfCoins([at[0], at[1] + .2, at[2]], Math.min(6, 1 + (ev.refund >> 1)));
    else if (ev.kind === 'tavern_ale') burst(at, 18, 0xffc35a, 2.2, .9);
    else if (ev.kind === 'draught_drunk') burst([at[0], at[1] + 1, at[2]], 16, 0x6fc4ff, 2.6, .8);
  }

  function millState(side) { return snapshot?.battle?.bases?.find(b => b.side === side)?.mill; }
  function update(dt) {
    if (!enabled || !snapshot) return;
    const t = performance.now() / 1000, k = 1 - Math.exp(-dt * 2.5);
    for (const p of pieces.values()) {
      if (p.kind === 'Mill') {
        const m = millState(p.side), cranked = (m?.crankUntil ?? 0) > snapshot.tick, busy = !!m?.queue?.length;
        const want = cranked ? SAIL_SPEED.crank : busy ? SAIL_SPEED.grind : SAIL_SPEED.idle;
        p.spin += (want + (p.kick || 0) * .8 - p.spin) * k; p.kick = Math.max(0, (p.kick || 0) - dt * 1.5);
        if (p.sails) p.sails.rotation.z -= p.spin * dt;
        p.crankSpin += ((cranked ? 2.2 : 0) - p.crankSpin) * (1 - Math.exp(-dt * 5));
        if (p.crank) p.crank.rotation.y += p.crankSpin * dt;
      } else if (p.hearth) {
        const f = 1 + Math.sin(t * 9.1 + p.placed.x) * .12 + Math.sin(t * 15.3) * .08;
        for (const h of p.hearth) if (h.material === emberMat) h.scale.y = .5 * f;
        emberMat.emissiveIntensity = 2.2 * f;
      }
    }
    const g = 9.8;
    for (let i = coins.length - 1; i >= 0; i--) {
      const c = coins[i]; c.t += dt;
      if (c.t < 0) continue;
      if (c.t >= c.life) { c.m.visible = false; coins.splice(i, 1); coinPool.push(c.m); continue; }
      c.v.y -= g * dt; c.p.addScaledVector(c.v, dt); c.m.visible = true; c.m.position.copy(c.p);
      c.m.rotation.set(c.t * c.spin, 0, c.t * c.spin * .7); c.m.scale.setScalar(Math.min(1, (c.life - c.t) * 4));
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i]; s.t += dt;
      if (s.t < 0) continue;
      if (s.t >= s.life) { s.m.visible = false; sparks.splice(i, 1); sparkPool.push(s.m); continue; }
      s.v.multiplyScalar(Math.exp(-dt * 1.6)); s.p.addScaledVector(s.v, dt); s.m.visible = true; s.m.position.copy(s.p);
      const u = s.t / s.life; s.m.scale.setScalar(1.4 * (1 - u * u)); s.m.rotation.y = t * 4;
    }
  }

  return {sync, event, update, installKit, object: root, stats: () => ({kit: !!kit, pieces: pieces.size, mills: [...pieces.values()].filter(p => p.kind === 'Mill').map(p => ({side: p.side, spin: +p.spin.toFixed(2)}))}),
    dispose() { root.removeFromParent(); for (const g of Object.values(geo)) g.dispose(); coinMat.dispose(); emberMat.dispose(); for (const m of sparkMats.values()) m.dispose(); }};
}
// Exposed for tests: where coins leave the mill and how fast the sails turn.
export const TOWN_VIEW = Object.freeze({chute: MILL.chute, sail: SAIL_SPEED});
