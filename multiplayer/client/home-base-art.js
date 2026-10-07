// Blender-built Dawnhold and Grumblekeep (assets/home-bases-20261004/build_bases.py -> /assets/bases_kit.glb).
// prepareHomeKit() checks the kit and tunes its materials once; buildKitBase() lays one base out with
// shared/home-bases.js HOME_LAYOUT and returns the same handles the code-built stand-ins expose, so
// home-base-view.js animates either. Static pieces are baked into one mesh per material per base.
import * as THREE from 'three';
import {HOME, HOME_LAYOUT, HOME_SCALE, barracksYaw, gateYaw, homePoint} from '../shared/home-bases.js';

const PIECES = ['Heart', 'HeartCrystal', 'HeartRingA', 'HeartRingB', 'Barracks', 'Bell', 'Fountain', 'FountainWater', 'FountainCrystal',
  'Pylon', 'PylonCrystal', 'Spire', 'SpireCrystal', 'BallistaBase', 'BallistaYoke', 'BallistaBow', 'BallistaBolt', 'Gate', 'Ward'];
const GLOW = {Crystal: 1.5, Amethyst: 1.5, Ember: 2.4, Ooze: 1.7};
export const kitPrefix = side => side === 'rivals' ? 'G' : 'D';

export function prepareHomeKit(gltf) {
  const nodes = new Map();
  for (const o of gltf.scene.children) nodes.set(o.name, o);
  for (const pre of ['D', 'G']) if (PIECES.some(n => !nodes.has(`${pre}_${n}`))) return null;
  const mats = new Map();
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = false; o.receiveShadow = false;
    const m = o.material; if (mats.has(m.name)) return;
    m.vertexColors = !!o.geometry.attributes.color;
    if (GLOW[m.name] !== undefined) { m.emissive.setRGB(1, 1, 1); m.emissiveIntensity = GLOW[m.name]; }
    if (m.name !== 'Cloth') m.side = THREE.FrontSide; // only banners and the cloth roof are seen from both faces
    m.needsUpdate = true; mats.set(m.name, m);
  });
  return {nodes, mats};
}

function mergeMeshes(meshes, into) {
  // Bake world-placed kit meshes (sharing materials) into one indexed geometry per material.
  const byMat = new Map();
  for (const mesh of meshes) { const list = byMat.get(mesh.material) || []; list.push(mesh); byMat.set(mesh.material, list); }
  const made = [];
  for (const [material, list] of byMat) {
    const geos = list.map(m => { m.updateWorldMatrix(true, false); return m.geometry.clone().applyMatrix4(m.matrixWorld); });
    const names = Object.keys(geos[0].attributes).filter(n => geos.every(g => g.attributes[n]?.itemSize === geos[0].attributes[n].itemSize));
    let verts = 0, idx = 0; for (const g of geos) { verts += g.attributes.position.count; idx += g.index ? g.index.count : g.attributes.position.count; }
    const out = new THREE.BufferGeometry(), index = new Uint32Array(idx);
    for (const n of names) {
      const size = geos[0].attributes[n].itemSize, arr = new Float32Array(verts * size); let o = 0;
      for (const g of geos) { const a = g.attributes[n]; for (let i = 0; i < a.count; i++) for (let k = 0; k < size; k++) arr[o++] = a.getComponent(i, k); }
      out.setAttribute(n, new THREE.BufferAttribute(arr, size));
    }
    let vo = 0, io = 0;
    for (const g of geos) { const c = g.attributes.position.count; if (g.index) for (let i = 0; i < g.index.count; i++) index[io++] = g.index.getX(i) + vo; else for (let i = 0; i < c; i++) index[io++] = i + vo; vo += c; g.dispose(); }
    out.setIndex(new THREE.BufferAttribute(index, 1)); out.computeBoundingSphere(); out.computeBoundingBox();
    const mesh = new THREE.Mesh(out, material); mesh.matrixAutoUpdate = false; into.add(mesh); made.push(mesh);
  }
  return made;
}

/**
 * Lay out one base from the kit. ctx: {snapshot, height(x, z), glowLight, ooze, glow, ring} supplies terrain height and
 * the view's shared bits. Returns {group, heart, fountain, parts(Map), statics, bell, water} handles for the view.
 */
export function buildKitBase(kit, data, ctx) {
  const side = data.side, pre = kitPrefix(side), group = new THREE.Group(), staticRoot = new THREE.Group();
  group.name = `home-${side}`; group.add(staticRoot);
  const clone = name => kit.nodes.get(`${pre}_${name}`).clone(true);
  const anchor = (obj, name) => obj.getObjectByName(`${pre}_${name}`)?.position.clone() ?? new THREE.Vector3();
  const yaw0 = gateYaw(side);
  // Buildings grow with the widened keep (HOME_SCALE); ballistas keep their size so the crew seat still fits.
  const K = HOME_SCALE;
  const place = (obj, local, extraYaw = 0, parent = group, scale = K) => { const [x, z] = homePoint(side, local); obj.position.set(x, ctx.height(x, z), z); obj.rotation.y = yaw0 + extraYaw; obj.scale.multiplyScalar(scale); parent.add(obj); return obj; };
  const worldAt = local => { const [x, z] = homePoint(side, local); return new THREE.Vector3(x, ctx.height(x, z), z); };
  const tag = (obj, id) => obj.traverse(n => { if (n.isMesh) n.userData.targetId = id; });

  // Plaza: a big disc of the side's stone, tiled.
  const stone = kit.mats.get(side === 'rivals' ? 'Basalt' : 'Stone');
  const disc = new THREE.CylinderGeometry(9.5, 9.7, .14, side === 'rivals' ? 6 : 8, 1);
  const uv = disc.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 7, uv.getY(i) * 7);
  disc.setAttribute('color', new THREE.BufferAttribute(new Float32Array(disc.attributes.position.count * 3).fill(.82), 3));
  const plaza = new THREE.Mesh(disc, stone); place(plaza, [0, 0], Math.PI / 8, staticRoot); plaza.position.y += .03;

  // Heart forge: static plinth and forge; the crystal and its two rings hover over it.
  const heartMain = place(clone('Heart'), [0, 0], 0, staticRoot); tag(heartMain, data.id);
  const coreAt = anchor(heartMain, 'Heart_Core'), heartPivot = new THREE.Group();
  heartPivot.position.copy(worldAt([0, 0])); heartPivot.rotation.y = yaw0; heartPivot.scale.setScalar(K); group.add(heartPivot);
  const heart = new THREE.Group(); heart.position.copy(coreAt); heartPivot.add(heart);
  const core = clone('HeartCrystal'), ringA = clone('HeartRingA'), ringB = clone('HeartRingB'); heart.add(core, ringA, ringB);
  tag(heartPivot, data.id);
  const light = new THREE.PointLight(ctx.glowColor, 6, 16, 2); heart.add(light);

  const barracks = place(clone('Barracks'), HOME_LAYOUT.barracks, barracksYaw(side) - yaw0, staticRoot);
  const bellPivot = new THREE.Group(); bellPivot.position.copy(worldAt(HOME_LAYOUT.barracks));
  bellPivot.rotation.y = barracksYaw(side); bellPivot.scale.setScalar(K); group.add(bellPivot);
  const bell = clone('Bell'); bell.position.copy(anchor(barracks, 'Barracks_Bell')); bellPivot.add(bell);

  const fountainMain = place(clone('Fountain'), HOME_LAYOUT.fountain, 0, staticRoot);
  const fountain = place(new THREE.Group(), HOME_LAYOUT.fountain);
  const water = clone('FountainWater'); fountain.add(water);
  const fcrystal = clone('FountainCrystal'), fAt = anchor(fountainMain, 'Fountain_Crystal'); fcrystal.position.copy(fAt); fountain.add(fcrystal);
  const bubbles = [fcrystal]; fcrystal.userData.baseY = fAt.y;
  if (side === 'rivals') for (let i = 0; i < 5; i++) { const b = new THREE.Mesh(ctx.ball, ctx.ooze); b.scale.setScalar(.12); b.position.set(Math.cos(i * 1.9) * .8, 1.45, Math.sin(i * 1.9) * .8); b.userData.baseY = 1.42; fountain.add(b); bubbles.push(b); }
  fountain.userData.bubbles = bubbles;

  place(clone('Gate'), HOME_LAYOUT.gate, 0, staticRoot);
  const [cx, cz] = homePoint(side, [0, 0]);
  for (const at of HOME_LAYOUT.wards) { const w = place(clone('Ward'), at, 0, staticRoot); w.rotation.y = Math.atan2(w.position.x - cx, w.position.z - cz); }

  const parts = new Map();
  for (const part of data.parts) {
    const i = +part.id.at(-1), g = new THREE.Group(); let built;
    if (part.kind === 'pylon') {
      const column = clone('Pylon'), crown = new THREE.Group(); crown.position.copy(anchor(column, 'Pylon_Crystal')); column.add(crown);
      const orb = clone('PylonCrystal'); crown.add(orb); g.add(column);
      built = {group: g, column, crown, orb, orbY: 0}; place(g, HOME_LAYOUT.pylons[i]);
    } else if (part.kind === 'spire') {
      const body = clone('Spire'), tipY = anchor(body, 'Spire_Crystal').y, tip = new THREE.Group(); tip.position.y = tipY; g.add(body, tip);
      tip.add(clone('SpireCrystal')); const halo = new THREE.Mesh(ctx.ring, ctx.glow); halo.scale.setScalar(.62); halo.rotation.x = Math.PI / 2; halo.position.y = .95; tip.add(halo);
      built = {group: g, tip, halo, tipY, scale: K}; place(g, HOME_LAYOUT.spires[i]);
    } else {
      const base = clone('BallistaBase'), head = new THREE.Group(); head.position.copy(anchor(base, 'BallistaBase_Yoke')); g.add(base, head);
      const yoke = clone('BallistaYoke'), bow = new THREE.Group(); bow.position.copy(anchor(yoke, 'BallistaYoke_Bow')); head.add(yoke); yoke.add(bow);
      const bowMesh = clone('BallistaBow'), bolt = clone('BallistaBolt'); bolt.position.copy(anchor(bowMesh, 'BallistaBow_Bolt')); bow.add(bowMesh); bowMesh.add(bolt);
      built = {group: g, head, bow, bolt, aim: 0, targetAim: 0, pitch: 0}; place(g, HOME_LAYOUT.ballistas[i], 0, group, 1);
    }
    tag(g, part.id); built.kind = part.kind; built.alive = 1; built.data = part; parts.set(part.id, built);
  }

  // Bake the static decor: tens of kit meshes become one draw per material for the whole base.
  group.updateMatrixWorld(true);
  const statics = []; staticRoot.traverse(o => { if (o.isMesh) statics.push(o); });
  const baked = new THREE.Group(); baked.name = `home-${side}-static`;
  const merged = mergeMeshes(statics, baked);
  for (const m of merged) m.userData.targetId = undefined;
  group.remove(staticRoot); group.add(baked); disc.dispose();
  // The heart's plinth stays hittable through a hidden proxy (the merged mesh is shared decor).
  const proxy = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.3, 5.5, 8), new THREE.MeshBasicMaterial({visible: false}));
  place(proxy, [0, 0]); proxy.position.y += 2.75 * K; proxy.userData.targetId = data.id;
  return {group, heart: {group: heartPivot, heart, core, rings: [ringA, ringB], light, heartY: coreAt.y, kit: true, proxy}, fountain, parts, bell, water, baked: merged, draws: merged.length};
}
