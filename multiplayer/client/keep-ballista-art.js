// Keep ballista rigs from the Blender kit (assets-source/keep-ballistas/build_keep_ballistas.py -> /assets/keep_ballistas.glb).
// prepareKeepKit() checks the kit once; buildKeepRig() clones one machine with its own glow materials and code-built string;
// poseKeepRig() applies a pose every frame. Presentation only: the view decides the pose from the snapshot and local input.
import * as THREE from 'three';

export const KEEP_RIGS = Object.freeze({
  sunlance: Object.freeze({pre: 'S', limbs: Object.freeze(['WingL', 'WingR']), bolt: 'S_Bolt', spin: 'S_Crank', flex: .3}),
  gnashjaw: Object.freeze({pre: 'G', limbs: Object.freeze(['HornL', 'HornR']), bolt: 'G_Harpoon', spin: 'G_Drum', flex: .22}),
});
const GLOW = {KBGlowBlue: 1.6, KBSun: .5, KBGlowPurple: 1.6, KBOoze: 1.4};
const NEED = ['Root', 'Base', 'Turret', 'Cradle', 'Nock', 'Muzzle'];

export function prepareKeepKit(gltf) {
  const nodes = new Map();
  gltf.scene.traverse(o => { if (o.name) nodes.set(o.name, o); });
  for (const [style, r] of Object.entries(KEEP_RIGS)) {
    const names = [...NEED.map(n => `${r.pre}_${n}`), ...r.limbs.flatMap(l => [`${r.pre}_${l}`, `${r.pre}_${l}_Tip`]), r.bolt, r.spin];
    if (style === 'gnashjaw') names.push('G_Jaw');
    if (names.some(n => !nodes.has(n))) return null;
  }
  const mats = new Map();
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = false; o.receiveShadow = false;
    const m = o.material; if (mats.has(m.name)) return;
    m.vertexColors = !!o.geometry.attributes.color;
    if (GLOW[m.name] !== undefined) { m.emissiveIntensity = GLOW[m.name]; m.toneMapped = true; }
    if (m.name === 'KBMetal') { m.metalness = .85; m.roughness = .34; }
    m.side = THREE.FrontSide; m.needsUpdate = true; mats.set(m.name, m);
  });
  const stringMat = new THREE.MeshStandardMaterial({color: 0xeae0c8, roughness: .7, metalness: 0});
  const stringGeo = new THREE.CylinderGeometry(.011, .011, 1, 5, 1, true).translate(0, .5, 0).rotateX(Math.PI / 2); // unit length along +Z
  return {nodes, mats, stringMat, stringGeo};
}

/** A fresh machine for one gate. Returns handles the view poses every frame. */
export function buildKeepRig(kit, style) {
  const r = KEEP_RIGS[style], group = kit.nodes.get(`${r.pre}_Root`).clone(true);
  group.name = `keep-${style}`;
  const find = n => group.getObjectByName(`${r.pre}_${n}`);
  // Per-machine glow so one ballista's draw or hook lights only itself.
  const own = new Map();
  group.traverse(o => {
    if (!o.isMesh || !['KBSun', 'KBOoze', 'KBGlowPurple'].includes(o.material.name)) return;
    if (!own.has(o.material.name)) own.set(o.material.name, o.material.clone());
    o.material = own.get(o.material.name);
  });
  const cradle = find('Cradle'), turret = find('Turret');
  const limbs = r.limbs.map(n => find(n)), tips = r.limbs.map(n => find(`${n}_Tip`));
  const nock = find('Nock'), muzzle = find('Muzzle');
  const strings = tips.map(() => { const s = new THREE.Mesh(kit.stringGeo, kit.stringMat); s.frustumCulled = false; cradle.add(s); return s; });
  const bolt = kit.nodes.get(r.bolt).clone(true); bolt.position.set(0, 0, 0); bolt.rotation.set(0, 0, 0);
  const boltPivot = new THREE.Group(); boltPivot.add(bolt); cradle.add(boltPivot);
  const rig = {style, group, turret, cradle, limbs, tips, nock, muzzle, strings, bolt: boltPivot, spinner: kit.nodes.has(r.spin) ? group.getObjectByName(r.spin) : null,
    jaw: style === 'gnashjaw' ? find('Jaw') : null, sun: own.get('KBSun') || null, eyes: own.get('KBOoze') || null, gem: own.get('KBGlowPurple') || null,
    nockRest: nock.position.clone(), cradleRest: cradle.position.clone(), tipRest: tips.map(t => t.position.clone()), flexSign: [1, -1]};
  // String rest line: where the limb tips sit unflexed, in cradle space.
  rig.braceZ = tipInCradle(rig, 0).z;
  return rig;
}

const tmp = new THREE.Vector3(), tmpB = new THREE.Vector3(), zAxis = new THREE.Vector3(0, 0, 1);
function tipInCradle(rig, i) { rig.group.updateMatrixWorld(true); rig.tips[i].getWorldPosition(tmp); return rig.cradle.worldToLocal(tmp); }

/**
 * pose: {yaw, pitch} radians (yaw is the turret's world heading in the group's frame), flex 0..1 (limbs bent back),
 * string 0..1 (0 braced at the tips, 1 at the latch), back metres (extra draw past the latch), loaded 0..1, spin radians,
 * jaw radians (open), recoil 0..1, glow (sun/eye emissive), gem.
 */
export function poseKeepRig(rig, pose) {
  const r = KEEP_RIGS[rig.style];
  rig.turret.rotation.y = pose.yaw;
  rig.cradle.rotation.x = pose.pitch + (pose.recoil || 0) * .05;
  rig.cradle.position.copy(rig.cradleRest); rig.cradle.position.z += (pose.recoil || 0) * .1;
  rig.limbs.forEach((l, i) => { l.rotation.y = rig.flexSign[i] * pose.flex * r.flex; });
  if (rig.spinner) rig.spinner.rotation.x = pose.spin || 0;
  if (rig.jaw) rig.jaw.rotation.x = -(pose.jaw || 0); // opens downward
  // String: from each tip to the nock, which slides between the braced line and the latch (and past it while drawing).
  const nz = THREE.MathUtils.lerp(rig.braceZ, rig.nockRest.z, THREE.MathUtils.clamp(pose.string, 0, 1)) + (pose.back || 0);
  const nockAt = tmpB.set(rig.nockRest.x, rig.nockRest.y, nz).clone();
  rig.strings.forEach((s, i) => {
    const tip = tipInCradle(rig, i), d = nockAt.clone().sub(tip), len = d.length();
    s.position.copy(tip); s.scale.set(1, 1, Math.max(.001, len)); s.quaternion.setFromUnitVectors(zAxis, d.normalize());
  });
  rig.bolt.position.set(rig.nockRest.x, rig.nockRest.y, nz);
  const show = THREE.MathUtils.clamp(pose.loaded ?? 1, 0, 1);
  rig.bolt.visible = show > .02; rig.bolt.position.z -= (1 - show) * .25; // slides onto the rail as it loads
  if (rig.sun) rig.sun.emissiveIntensity = pose.glow ?? .5;
  if (rig.eyes) rig.eyes.emissiveIntensity = pose.glow ?? 1.4;
  if (rig.gem && pose.gem !== undefined) rig.gem.emissiveIntensity = pose.gem;
}

/** World position of the muzzle (where shots leave and chains start). */
export function rigMuzzle(rig, out = new THREE.Vector3()) { rig.muzzle.getWorldPosition(out); return out; }
