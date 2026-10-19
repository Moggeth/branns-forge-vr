// The Armoury (shared/armoury.js), off Dawnhold's gate: the Blender hall (assets/armoury-20261018 -> /assets/armoury.glb)
// with a real Flockwright resting on its stand, its crew idling (client/flockwright.js), and a slow warm glow on the
// cradle so the stand reads from the doorway. A code-built shell stands in until the kit loads. Only while the home
// bases run, like the taverns. Taking a crossbow down throws a little puff of teal and ivory feathers.
import * as THREE from 'three';
import {armouryPiece, homeBattle} from '../shared/home-bases.js';
import {ARMOURY_RULES} from '../shared/armoury.js';
import {terrainHeight} from '../shared/terrain.js';

const GLOW = {Crystal: 1.5, Ember: 2.4, Glass: 1.15};
const FLICKER = new Set(['Ember', 'Glass']);
const STAND = [0, 1.2, -.35];       // D_Armoury_Stand when the kit has no anchor
const FEATHERS = [0x1d8f9c, 0x30bac2, 0xf8f2e6];

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({color, roughness: .8, metalness: 0, flatShading: true, ...extra});

export function createArmouryView({scene}) {
  const root = new THREE.Group(); root.name = 'armoury'; root.visible = false; scene.add(root);
  let snapshot = null, enabled = false, hall = null, kit = null, crossbow = null, clock = 0;
  const stand = new THREE.Vector3(...STAND), glowMats = [], feathers = [];
  const featherGeo = new THREE.PlaneGeometry(.07, .16), featherMats = FEATHERS.map(c => new THREE.MeshBasicMaterial({color: c, side: THREE.DoubleSide, transparent: true, depthWrite: false}));
  // A soft pool of light on the cradle: an additive disc that breathes, cheap on phones (no real light).
  const halo = new THREE.Mesh(new THREE.CircleGeometry(.7, 24), new THREE.MeshBasicMaterial({color: 0xffd58a, transparent: true, opacity: .22, depthWrite: false, blending: THREE.AdditiveBlending}));
  halo.rotation.x = -Math.PI / 2; halo.renderOrder = 2;

  function standIn() {
    const g = new THREE.Group(), stone = mat(0xb9ad97), wood = mat(0x8a6440), roof = mat(0x3d4a5c);
    const box = (m, [x, y, z], [w, h, d]) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); g.add(o); };
    box(stone, [0, 1.5, -2.5], [7, 3, .5]); box(stone, [-3.4, 1.5, -.2], [.5, 3, 5]); box(stone, [3.4, 1.5, -.2], [.5, 3, 5]);
    box(roof, [0, 3.3, -.2], [7.6, .3, 5.8]); box(wood, [0, .7, -.35], [.9, .7, .6]);
    return g;
  }
  function build() {
    hall?.removeFromParent();
    const body = kit?.clone(true) || standIn();
    hall = new THREE.Group(); hall.add(body);
    const a = kit ? body.getObjectByName('D_Armoury_Stand') : null;
    stand.fromArray(a ? a.position.toArray() : STAND);
    halo.position.set(stand.x, stand.y - .08, stand.z); hall.add(halo);
    if (crossbow) placeCrossbow();
    hall.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    root.add(hall); layout();
  }
  function placeCrossbow() {
    crossbow.position.copy(stand); crossbow.rotation.set(0, -Math.PI / 2, 0); // nose toward the hall's right, crew facing the door
    hall.add(crossbow);
  }
  function layout() {
    if (!snapshot || !hall) return;
    const a = armouryPiece();
    root.position.set(a.x, terrainHeight(snapshot, a.x, a.z, false), a.z); root.rotation.y = a.yaw;
  }

  /** The Blender hall: D_Armoury with its stand anchor. */
  function installKit(gltf) {
    const node = gltf.scene.getObjectByName('D_Armoury'); if (!node) return false;
    const seen = new Set();
    gltf.scene.traverse(o => {
      if (!o.isMesh || seen.has(o.material)) return; seen.add(o.material);
      const m = o.material; m.vertexColors = !!o.geometry.attributes.color;
      if (GLOW[m.name] !== undefined) { m.emissive.setRGB(1, 1, 1); m.emissiveIntensity = GLOW[m.name]; if (FLICKER.has(m.name)) glowMats.push({m, base: GLOW[m.name], seed: glowMats.length * 2.3}); }
      if (m.name !== 'Cloth') m.side = THREE.FrontSide;
      m.needsUpdate = true;
    });
    kit = node; node.position.set(0, 0, 0); node.rotation.set(0, 0, 0); build();
    return true;
  }
  /** A canonical Flockwright copy (game.js instantiate) to rest on the stand; it idles with its crew. */
  function setCrossbow(model) { crossbow?.removeFromParent(); crossbow = model; if (crossbow && hall) placeCrossbow(); }

  function sync(s) {
    snapshot = s; const on = homeBattle(s);
    if (on !== enabled) { enabled = on; root.visible = on; if (on && !hall) build(); }
    if (on) layout();
  }
  function event(ev) {
    if (ev.kind !== 'armoury_take' || !enabled || !hall) return;
    const at = hall.localToWorld(stand.clone().add(new THREE.Vector3(0, .15, 0)));
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(featherGeo, featherMats[i % 3]); m.position.copy(at); root.parent?.add(m);
      const a = i / 14 * Math.PI * 2;
      feathers.push({m, v: new THREE.Vector3(Math.cos(a) * (.6 + Math.random() * .6), 1.4 + Math.random(), Math.sin(a) * (.6 + Math.random() * .6)), spin: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6), t: 0, life: 1.6 + Math.random() * .6});
    }
  }
  function update(dt) {
    if (!enabled) return;
    clock += dt;
    halo.material.opacity = .16 + .08 * Math.sin(clock * 1.7);
    for (const g of glowMats) g.m.emissiveIntensity = g.base * (.9 + .08 * Math.sin(clock * 7.3 + g.seed) + .05 * Math.sin(clock * 13.1 + g.seed * 2));
    for (let i = feathers.length - 1; i >= 0; i--) {
      const f = feathers[i]; f.t += dt;
      // feathers drift: quick drag, a gentle sway, slow fall
      f.v.multiplyScalar(Math.exp(-2.4 * dt)); f.v.y -= 1.2 * dt;
      f.m.position.addScaledVector(f.v, dt); f.m.position.x += Math.sin(f.t * 5 + i) * .25 * dt;
      f.m.rotation.x += f.spin.x * dt; f.m.rotation.y += f.spin.y * dt; f.m.rotation.z += f.spin.z * dt;
      const k = f.t / f.life; f.m.scale.setScalar(1 - Math.max(0, k - .7) / .3);
      if (k >= 1) { f.m.removeFromParent(); feathers.splice(i, 1); }
    }
  }
  /** World position of the stand (for the use prompt and the reach the host checks). */
  const standWorld = () => { const a = armouryPiece(), c = Math.cos(a.yaw), s = Math.sin(a.yaw), [px, pz] = ARMOURY_RULES.stand; return [a.x + px * c + pz * s, a.z - px * s + pz * c]; };
  return {installKit, setCrossbow, sync, event, update, standWorld, root, stats: () => ({enabled, kit: !!kit, crossbow: !!crossbow?.parent, feathers: feathers.length})};
}
