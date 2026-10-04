import * as THREE from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {siegebirdMechanism, SIEGEBIRD_WINCH} from './siegebird-reload.js';

// Engine contract: metres, +Y up, -Z forward. Model axes are independently
// authored facts, never inferred from a bounding box or camera angle.
export const ASSET_POSES = Object.freeze({
  skeleton: {forward: [0, 0, 1], up: [0, 1, 0], pivot: 'feet', height: 1.7},
  golem: {forward: [0, 0, 1], up: [0, 1, 0], pivot: 'feet', height: 2.2},
  crossbow: {forward: [0, 1, 0], up: [0, 0, 1], pivot: 'GripAnchor', height: 1, nativeScale: 1, tip: 'BoltSeat'},
  bow: {forward: [0, 0, -1], up: [0, 1, 0], pivot: 'Grip', height: 1.48, nativeScale: 1, tip: 'ArrowGuide'},
  wyrmspout: {forward:[0,0,-1],up:[0,1,0],pivot:'GripAnchor',height:.4,nativeScale:1,tip:'Muzzle'},
  flask: {forward:[0,0,-1],up:[0,1,0],pivot:[0,0,0],height:.18,nativeScale:1,tip:'Muzzle'},
  arrow: {forward: [0, 0, -1], up: [0, 1, 0], pivot: 'ArrowTip', height: .78, nativeScale: 1},
  wings: {forward: [0, 0, -1], up: [0, 1, 0], pivot: [0, 0, 0], height: .5, nativeScale: 1},
  // Generated Sunfall's crimson grip runs y=.03..38 and hammer face is X.
  hammer: {forward: [1, 0, 0], up: [0, 1, 0], pivot: [0, .205, 0], height: 1.34, nativeScale: 1, tipPoint: [.34, .83, 0]},
  pick: {forward: [1, 0, 0], up: [0, 1, 0], pivot: 'Grip', height: .75},
  axe: {forward: [1, 0, 0], up: [0, 1, 0], pivot: 'Grip_Center', height: 0.7},
  tree_b: {forward: [0, 0, -1], up: [0, 1, 0], pivot: 'feet', height: 4},
  tree_young: {forward: [0, 0, -1], up: [0, 1, 0], pivot: 'feet', height: 4},
  tree: {forward: [0, 0, -1], up: [0, 1, 0], pivot: 'feet', height: 4},
});

export function assetBasis(contract) {
  const forward = new THREE.Vector3(...contract.forward).normalize();
  const up = new THREE.Vector3(...contract.up).normalize();
  if (forward.lengthSq() < .99 || up.lengthSq() < .99 || Math.abs(forward.dot(up)) > 1e-6)
    throw new Error('Asset forward/up must be nonzero perpendicular axes');
  const back = forward.clone().negate();
  const right = up.clone().cross(back);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, back)).invert();
}

export function prepareAsset(template, name, height = ASSET_POSES[name]?.height) {
  const contract = ASSET_POSES[name];
  if (!contract || !(height > 0)) throw new Error(`Unreviewed asset pose: ${name}`);
  const model = clone(template.scene);
  model.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  if (!(size.y > .001)) throw new Error(`Invalid asset bounds: ${name}`);
  const pivot = new THREE.Vector3(0, bounds.min.y, 0);
  if (Array.isArray(contract.pivot)) {
    pivot.fromArray(contract.pivot);
  } else if (contract.pivot === 'bounds') {
    pivot.x = (bounds.min.x + bounds.max.x) / 2;
    pivot.z = (bounds.min.z + bounds.max.z) / 2;
  } else if (contract.pivot !== 'feet') {
    const socket = model.getObjectByName(contract.pivot);
    if (!socket) throw new Error(`Missing ${name} socket ${contract.pivot}`);
    socket.getWorldPosition(pivot);
  }
  // Keep conversion OUTSIDE the animated hierarchy. Animation tracks must not
  // overwrite units/pivot/basis; asymmetric shields must not recenter the actor.
  const normalization = new THREE.Group();
  const factor = contract.nativeScale ?? height / size.y;
  normalization.scale.setScalar(factor);
  normalization.position.copy(pivot).multiplyScalar(-factor);
  normalization.add(model);
  const visual = new THREE.Group();
  visual.name = `${name}:canonical`;
  visual.quaternion.copy(assetBasis(contract));
  visual.add(normalization);
  return {visual, model};
}

// Separate presentation transforms from the canonical asset basis. Both XR
// hands share resources; left-hand Emberwing mirrors across the grip to clear the sightline.
export function setWeaponGrip(visual, xr = false, tool = 'axe', hand = 'right') {
  visual.scale.set(tool==='bow'&&hand==='left'?-1:1,1,1);
  visual.position.set(0, 0, 0);
  visual.quaternion.copy(assetBasis(ASSET_POSES[tool]));
  if (xr && !['crossbow', 'bow', 'wyrmspout', 'flask'].includes(tool)) visual.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 4));
}

export function weaponTip(visual, tool, target = new THREE.Vector3()) {
  const pose = ASSET_POSES[tool];
  if (tool === 'bow' && visual.userData.nockedArrow) return visual.userData.nockedArrow.getWorldPosition(target);
  const socket = visual.getObjectByName(pose?.tip || (tool === 'axe' ? 'CuttingEdge_Mid' : 'PickTipRight'));
  visual.updateWorldMatrix(true, true);
  if (socket) return socket.getWorldPosition(target);
  if (pose?.tipPoint) return visual.children[0].children[0].localToWorld(target.fromArray(pose.tipPoint));
  return visual.localToWorld(target.set(0, .55, 0));
}

export function weaponForward(visual, tool, target = new THREE.Vector3()) {
  const pose = ASSET_POSES[tool];
  if (!pose) throw new Error(`Unreviewed weapon direction: ${tool}`);
  visual.updateWorldMatrix(true, false);
  return target.fromArray(pose.forward).applyQuaternion(visual.getWorldQuaternion(new THREE.Quaternion())).normalize();
}

// Tip is the origin, so an embedded shaft extends backwards out of the surface.
export function prepareProjectile(templates, kind = 'arrow') {
  const template = templates.get(kind === 'bolt' ? 'crossbow' : 'arrow');
  if (!template) return null;
  if (kind !== 'bolt') return prepareAsset(template, 'arrow').visual;
  const bolt = template.scene.getObjectByName('Bolt');
  if (!bolt) return null;
  const model = clone(bolt); model.position.set(0, 0, 0);
  const bounds = new THREE.Box3().setFromObject(model);
  const normalization = new THREE.Group(); normalization.position.y = -bounds.max.y; normalization.add(model);
  const result = new THREE.Group(); result.quaternion.copy(assetBasis(ASSET_POSES.crossbow)); result.add(normalization);
  // The canonical conversion must remain inside the direction/attachment group.
  const root = new THREE.Group(); root.add(result); return root;
}

export const FPS_WEAPON_POSE = Object.freeze({position: [.33, -.38, -.48], rotation: [-.2, .55, .12]});

// Siegebird winch geometry in the crossbow's native frame (assets/siegebird-opus/contract/assembly.json and the
// builder's runtime replica): sled travel, limb-tip path, cable guide and drum.
const SB = Object.freeze({front: .79, travel: .255, limb: .551, tipY: .80, tipBack: .03, tipZ: .105, nockZ: .179,
  gearX: .195, drumY: .648, cableR: .255 / (Math.PI * 2) + .001, cableX: .14, wrapX0: .1285, wrapPitch: (.1515 - .1285) / 3.4, cordR: .0032});
const crossbowTip = draw => { const sledY = SB.front - SB.travel * draw, y = SB.tipY - SB.tipBack * draw; return {x: Math.sqrt(SB.limb ** 2 + 1e-4 - (y - sledY) ** 2), y, sledY}; };

// The authored cord cylinders share geometry; stretch only their node transforms between two native points.
// Bowstrings run from each limb tip to the nock on the sled; the haul cable leaves the drum at the level-wind
// position and runs over the guide pulley to the sled anchor.
const cordRigs = new WeakMap();
function cordRig(visual) {
  let rig = cordRigs.get(visual); if (rig) return rig;
  rig = {};
  for (const name of ['LiveCord_00', 'LiveCord_01', 'LiveCord_02', 'LiveCord_19']) {
    const node = visual.getObjectByName(name); if (!node?.geometry) continue;
    node.geometry.computeBoundingBox(); const box = node.geometry.boundingBox; node.updateMatrix();
    const a = new THREE.Vector3(0, box.min.y, 0).applyMatrix4(node.matrix), b = new THREE.Vector3(0, box.max.y, 0).applyMatrix4(node.matrix);
    rig[name] = {node, a, b, length: box.max.y - box.min.y, mid: (box.max.y + box.min.y) * .5};
  }
  // Fixed ends from the authored pose: the guide-side ends of the cable, i.e. the end away from the drum / sled.
  if (rig.LiveCord_02) { const r = rig.LiveCord_02; r.fixed = (r.a.y < r.b.y ? r.a : r.b).clone(); }
  if (rig.LiveCord_19) { const r = rig.LiveCord_19; r.fixed = (r.a.y < r.b.y ? r.a : r.b).clone(); r.anchor = (r.a.y < r.b.y ? r.b : r.a).clone(); }
  cordRigs.set(visual, rig); return rig;
}
const cordUp = new THREE.Vector3(0, 1, 0), cordAxis = new THREE.Vector3(), cordFrom = new THREE.Vector3(), cordTo = new THREE.Vector3();
function stretchCord(r, from, to) {
  cordAxis.subVectors(to, from); const length = Math.max(1e-4, cordAxis.length());
  r.node.quaternion.setFromUnitVectors(cordUp, cordAxis.normalize()); r.node.scale.y = length / r.length;
  r.node.position.copy(from).add(to).multiplyScalar(.5).addScaledVector(cordAxis, -r.mid * r.node.scale.y);
}
// draw: string/limb draw (may dip below 0 as the arms overshoot); sledY: carriage position; wound: cable turns on the drum.
export function updateCrossbowCords(visual, sledY, {draw = (SB.front - sledY) / SB.travel, wound = SIEGEBIRD_WINCH.baseWraps + draw} = {}) {
  const rig = cordRig(visual), tip = crossbowTip(draw), nockY = SB.front - SB.travel * draw;
  for (const [name, side] of [['LiveCord_00', -1], ['LiveCord_01', 1]]) if (rig[name]) stretchCord(rig[name], cordFrom.set(side * tip.x, tip.y, SB.tipZ), cordTo.set(0, nockY, SB.nockZ));
  if (rig.LiveCord_02) stretchCord(rig.LiveCord_02, cordFrom.set(SB.wrapX0 + SB.wrapPitch * wound, SB.drumY, SB.cableR), rig.LiveCord_02.fixed);
  if (rig.LiveCord_19) stretchCord(rig.LiveCord_19, rig.LiveCord_19.fixed, cordTo.copy(rig.LiveCord_19.anchor).setY(rig.LiveCord_19.anchor.y + sledY - .535));
}

// The cable laid on the drum. The authored static coil is replaced (once per template geometry) by a level-wound
// helix in the drum's frame; each crossbow shows only the wound length via a per-draw range, so clones still
// share one geometry. Wraps start deep at the flange and end where the cable leaves the top of the drum.
const WRAP = {turns: SIEGEBIRD_WINCH.baseWraps + 1, perTurn: 40, radial: 8};
function cableWrapGeometry(geometry) {
  if (geometry.userData.siegebirdWrap) return geometry;
  const segs = Math.round(WRAP.turns * WRAP.perTurn), a0 = Math.PI / 2 - SIEGEBIRD_WINCH.baseWraps * Math.PI * 2;
  const pos = [], nor = [], uv = [], index = [], c = new THREE.Vector3(), n = new THREE.Vector3(), tan = new THREE.Vector3(), side = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const turns = i / WRAP.perTurn, a = a0 + turns * Math.PI * 2;
    c.set(SB.wrapX0 + SB.wrapPitch * turns - SB.gearX, SB.cableR * Math.cos(a), SB.cableR * Math.sin(a));
    const radial = new THREE.Vector3(0, Math.cos(a), Math.sin(a)); tan.set(SB.wrapPitch / (Math.PI * 2), -Math.sin(a) * SB.cableR, Math.cos(a) * SB.cableR).normalize();
    side.crossVectors(tan, radial).normalize();
    for (let k = 0; k < WRAP.radial; k++) {
      const phi = k / WRAP.radial * Math.PI * 2; n.copy(radial).multiplyScalar(Math.cos(phi)).addScaledVector(side, Math.sin(phi));
      pos.push(c.x + n.x * SB.cordR, c.y + n.y * SB.cordR, c.z + n.z * SB.cordR); nor.push(n.x, n.y, n.z); uv.push(turns * 6, k / WRAP.radial);
    }
  }
  for (let i = 0; i < segs; i++) for (let k = 0; k < WRAP.radial; k++) {
    const k1 = (k + 1) % WRAP.radial, p = i * WRAP.radial;
    index.push(p + k, p + WRAP.radial + k, p + k1, p + k1, p + WRAP.radial + k, p + WRAP.radial + k1);
  }
  geometry.setIndex(index); geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  for (const name of Object.keys(geometry.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere(); geometry.clearGroups();
  geometry.userData.siegebirdWrap = {segs, perTurn: WRAP.perTurn, radial: WRAP.radial, turns: WRAP.turns};
  return geometry;
}
function setWrapRange() { this.geometry.setDrawRange(0, this.userData.siegebirdWrapCount ?? Infinity); }
export function crossbowCableWrap(visual) {
  if (visual.userData.crossbowWrap !== undefined) return visual.userData.crossbowWrap;
  let wrap = null;
  visual.getObjectByName('Drum')?.traverse(o => { if (!wrap && o.isMesh && /Cord/.test(o.material?.name || '')) wrap = o; });
  if (wrap) { cableWrapGeometry(wrap.geometry); wrap.onBeforeRender = wrap.onBeforeShadow = setWrapRange; wrap.frustumCulled = false; }
  return (visual.userData.crossbowWrap = wrap);
}
function showWound(wrap, wound) {
  const w = wrap.geometry.userData.siegebirdWrap, segs = Math.max(1, Math.min(w.segs, Math.round(wound * w.perTurn)));
  wrap.userData.siegebirdWrapCount = segs * w.radial * 6;
}

export function updateWeaponPresentation(visual, tool, {draw = 0, recoil = 0, reload, time = 0, templates} = {}) {
  const amount = THREE.MathUtils.clamp(draw, 0, 1);
  if (tool === 'bow') {
    const upper = visual.getObjectByName('UpperLimb'), lower = visual.getObjectByName('LowerLimb');
    for (const [node, sign] of [[upper, 1], [lower, -1]]) if (node) {
      node.userData.restQuaternion ||= node.quaternion.clone();
      node.quaternion.copy(node.userData.restQuaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), sign * amount * .09));
    }
    const top = visual.getObjectByName('StringTop'), bottom = visual.getObjectByName('StringBottom'), rest = visual.getObjectByName('ArrowRest');
    if (!top || !bottom || !rest) return;
    if (!visual.userData.bowstring) {
      const geometry = new THREE.BufferGeometry().setFromPoints(Array.from({length: 4}, () => new THREE.Vector3()));
      const line = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({color: 0xdec8a6}));
      line.userData.ignoreContact = true; visual.add(line); visual.userData.bowstring = line;
    }
    visual.updateWorldMatrix(true, true);
    const nock = visual.worldToLocal(rest.getWorldPosition(new THREE.Vector3())); nock.z += amount * .68;
    const points = [visual.worldToLocal(top.getWorldPosition(new THREE.Vector3())), nock, nock, visual.worldToLocal(bottom.getWorldPosition(new THREE.Vector3()))];
    points.forEach((p, i) => visual.userData.bowstring.geometry.attributes.position.setXYZ(i, p.x, p.y, p.z));
    visual.userData.bowstring.geometry.attributes.position.needsUpdate = true;
    visual.userData.bowstring.geometry.computeBoundingSphere();
    if (!visual.userData.nockedArrow && templates?.has('arrow')) {
      const arrow = prepareProjectile(templates, 'arrow'); arrow.userData.ignoreContact = true;
      visual.add(arrow); visual.userData.nockedArrow = arrow;
    }
    const arrow = visual.userData.nockedArrow;
    if (arrow) { arrow.visible = amount > 0; arrow.position.copy(nock).z -= .78; }
  } else if (tool === 'crossbow') {
    // Reload time (seconds since the shot) drives the whole Siegebird cycle (siegebird-reload.js): the string
    // throws the sled forward and the drum freewheels back, the clutch bites, two crank turns wind one drum turn
    // through the 10:20 gears while the pawl clicks over the ratchet, the cable winds on, the arms fold back, and
    // the songbird seats the next bolt. Callers without a clock pass legacy recoil 0..1.
    const t = Number.isFinite(reload) ? reload : recoil > 0 ? (1 - THREE.MathUtils.clamp(recoil, 0, 1)) * .45 : Infinity;
    const m = siegebirdMechanism(t), cocked = m.cocked;
    const parts = visual.userData.crossbowParts ||= Object.fromEntries(['Pinion', 'Reduction', 'Drum', 'Crank', 'CrankKnob', 'Clutch', 'Trigger', 'Latch', 'Sled', 'Bolt'].map(n => [n, visual.getObjectByName(n)]));
    const rotate = (name, axis, value) => { const node = parts[name]; if (node) node.rotation[axis] = value; };
    rotate('Pinion', 'x', m.pinion); rotate('Reduction', 'x', m.drum + Math.PI / 20); rotate('Drum', 'x', m.drum);
    rotate('Crank', 'x', m.crank); rotate('CrankKnob', 'x', -m.crank);
    rotate('Trigger', 'x', -.32 * m.trigger); rotate('Latch', 'y', m.latch);
    if (parts.Clutch) { parts.Clutch.userData.rest ??= parts.Clutch.position.x; parts.Clutch.position.x = parts.Clutch.userData.rest + SIEGEBIRD_WINCH.clutchTravel * m.clutch; }
    const draw = cocked + m.flex + .03 * m.string * (1 - cocked) ** 4;   // the string (and arms) overshoot and hum at the front stop
    if (parts.Sled) { parts.Sled.position.y = SB.front - SB.travel * cocked; updateCrossbowCords(visual, parts.Sled.position.y, {draw, wound: m.wound}); }
    const wrap = crossbowCableWrap(visual); if (wrap) showWound(wrap, m.wound);
    if (parts.Bolt) { parts.Bolt.userData.rest ||= parts.Bolt.position.clone(); parts.Bolt.visible = m.bolt; parts.Bolt.position.z = parts.Bolt.userData.rest.z + .012 * m.boltDrop; }
    const narrow = (SB.limb - crossbowTip(draw).x) / .053;
    visual.traverse(mesh => { const d = mesh.morphTargetDictionary; if (d?.Drawn === undefined) return; mesh.morphTargetInfluences[d.Drawn] = draw; if (d.Narrow !== undefined) mesh.morphTargetInfluences[d.Narrow] = narrow; });
  }
}
