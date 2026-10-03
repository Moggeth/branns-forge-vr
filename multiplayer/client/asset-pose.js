import * as THREE from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {siegebirdMechanism} from './siegebird-reload.js';

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

// The authored cord cylinders share geometry; stretch only their node transforms.
// Each bowstring keeps its limb endpoint while the inner end follows the sled.
const cordRigs=new WeakMap();
export function updateCrossbowCords(visual,sledY){
 let rig=cordRigs.get(visual);
 if(!rig){rig=[];for(const name of ['LiveCord_00','LiveCord_01','LiveCord_19']){
  const node=visual.getObjectByName(name);if(!node?.geometry)continue;
  node.geometry.computeBoundingBox();const box=node.geometry.boundingBox;
  node.updateMatrix();const a=new THREE.Vector3(0,box.min.y,0).applyMatrix4(node.matrix),b=new THREE.Vector3(0,box.max.y,0).applyMatrix4(node.matrix);
  const moving=name==='LiveCord_19'?(a.y>b.y?a:b):(Math.abs(a.x)<Math.abs(b.x)?a:b),fixed=moving===a?b:a;
  rig.push({node,fixed:fixed.clone(),moving:moving.clone(),target:moving.clone(),axis:new THREE.Vector3(),up:new THREE.Vector3(0,1,0),length:box.max.y-box.min.y,mid:(box.max.y+box.min.y)*.5});
 }cordRigs.set(visual,rig);}
 for(const r of rig){r.target.copy(r.moving);r.target.y+=sledY-.535;r.axis.subVectors(r.target,r.fixed);const length=r.axis.length();r.node.quaternion.setFromUnitVectors(r.up,r.axis.normalize());r.node.scale.y=length/r.length;r.node.position.copy(r.fixed).add(r.target).multiplyScalar(.5).addScaledVector(r.axis,-r.mid*r.node.scale.y);}
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
    // Reload time (seconds since the shot) drives the whole Siegebird cycle: release, two-turn wind, latch and
    // the songbird seating the next bolt (siegebird-reload.js). Callers without a clock pass legacy recoil 0..1.
    const t = Number.isFinite(reload) ? reload : recoil > 0 ? (1 - THREE.MathUtils.clamp(recoil, 0, 1)) * .45 : Infinity;
    const m = siegebirdMechanism(t), cocked = m.cocked;
    const parts = visual.userData.crossbowParts ||= Object.fromEntries(['Pinion', 'Reduction', 'Drum', 'Crank', 'CrankKnob', 'Trigger', 'Latch', 'Sled', 'Bolt'].map(n => [n, visual.getObjectByName(n)]));
    const rotate = (name, axis, value) => { const node = parts[name]; if (node) node.rotation[axis] = value; };
    // Crank and pinion share a shaft (2 turns); the 10:20 reduction and drum turn one.
    rotate('Pinion', 'x', m.crank); rotate('Reduction', 'x', -m.crank / 2 + Math.PI / 20);
    rotate('Drum', 'x', -m.crank / 2); rotate('Crank', 'x', m.crank); rotate('CrankKnob', 'x', -m.crank);
    rotate('Trigger', 'x', -.32 * m.trigger); rotate('Latch', 'y', m.latch);
    if (parts.Sled) { parts.Sled.position.y = .79 - .255 * cocked + .014 * m.string * (1 - cocked); updateCrossbowCords(visual, parts.Sled.position.y); }
    if (parts.Bolt) { parts.Bolt.userData.rest ||= parts.Bolt.position.clone(); parts.Bolt.visible = m.bolt; parts.Bolt.position.z = parts.Bolt.userData.rest.z + .012 * m.boltDrop; }
    visual.traverse(mesh => { if (mesh.morphTargetDictionary?.Drawn !== undefined) mesh.morphTargetInfluences[mesh.morphTargetDictionary.Drawn] = cocked; });
  }
}
