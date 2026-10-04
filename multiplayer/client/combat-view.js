import {phoenixBank} from './phoenix-bank.js';
import * as THREE from 'three';
import {prepareAsset, prepareProjectile, dressArrowVariant} from './asset-pose.js';
import {dressSkeleton, setShieldBroken} from './skeleton-look.js';
import {updateSkinBounds} from './skin-bounds.js';
import {createCombatDamageNumbers} from './combat-damage-numbers.js';
import {createCreatureLifeDeath} from './creature-life-death.js';
import {createEmbedFractures} from './embed-fractures.js';
import {createProjectileStreaks} from './projectile-streaks.js';
import {dressGoldenProjectile, disposeGoldenProjectile} from './siegebird-flock.js';
import {attachEmberdew} from './emberdew-presentation.js';
import {predictArrow, createPhoenixContrails} from './phoenix-flight.js';
import {carryPose} from '../shared/phoenix-carry.js';
import {createPhoenixFlareView, dressFlareArrow} from './phoenix-flare-view.js';

const PARTS = ['head', 'torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
const NAMES = {head: ['Head'], torso: ['Torso', 'BodyCore'], leftArm: ['LeftArm', 'ArmL'], rightArm: ['RightArm', 'ArmR'], leftLeg: ['LeftLeg', 'LegL'], rightLeg: ['RightLeg', 'LegR']};
const forward = new THREE.Vector3(0, 0, -1);
const geometryRecords = new WeakMap();
const sharedTriangleRecords = new WeakMap();
const hashId = id => [...String(id)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);

export function updateGolemArmor(root, armor = 3) {
  // The simulation exposes three armor stages. Remove existing authored plates
  // rather than recolouring the whole enemy or substituting block geometry.
  for (const [name, threshold] of [['ForearmL', 3], ['ForearmR', 3], ['ShoulderL', 2], ['ShoulderR', 2], ['ChestPlate', 1]]) {
    const node = root.getObjectByName(name); if (node) node.visible = armor >= threshold;
  }
  const core = root.getObjectByName('CoreGlow');
  if (core) { core.userData.restScale ||= core.scale.clone(); core.scale.copy(core.userData.restScale).multiplyScalar(armor === 0 ? 1.12 : 1); }
}

export function canonicalPart(name = '') {
  const n = name.toLowerCase().replace(/[^a-z]/g, '');
  if (/head|skull/.test(n)) return 'head';
  if (/leftleg|leftknee|leftfoot|legl/.test(n)) return 'leftLeg';
  if (/rightleg|rightknee|rightfoot|legr/.test(n)) return 'rightLeg';
  if (/leftarm|leftforearm|lefthand|arml|shoulderl|forearml|elbowl/.test(n)) return 'leftArm';
  if (/rightarm|rightforearm|righthand|armr|shoulderr|forearmr|elbowr/.test(n)) return 'rightArm';
  return 'torso';
}

// Shield primitives are skinned to an arm, but their surface is armour, not flesh.
// Preserve this tag on baked detached geometry as well as authored GLB groups.
function contactSurface(node) {
  for (let n = node; n; n = n.parent) {
    if (n.userData.contactSurface === 'shield' || /^shield(?:_|:|$)/i.test(n.name)) return 'shield';
  }
  return undefined;
}

function namedPart(node) {
  for (let n = node; n; n = n.parent) {
    const part = canonicalPart(n.name);
    if (part !== 'torso' || /torso|bodycore/i.test(n.name)) return part;
  }
  return 'torso';
}

export function partAnchor(root, part) {
  let result = null;
  root.traverse(n => {
    if (NAMES[part]?.includes(n.name) && (!result || n.isBone)) result = n;
  });
  return result || root;
}

function triangleBone(mesh, ids, weights = [1 / 3, 1 / 3, 1 / 3]) {
  const indices = mesh.geometry.attributes.skinIndex, skin = mesh.geometry.attributes.skinWeight;
  if (!mesh.isSkinnedMesh || !indices || !skin) return null;
  const sums = new Map();
  ids.forEach((id, v) => {
    for (let i = 0; i < 4; i++) {
      const bone = indices.getComponent(id, i), weight = skin.getComponent(id, i) * weights[v];
      sums.set(bone, (sums.get(bone) || 0) + weight);
    }
  });
  const winner = [...sums].sort((a, b) => b[1] - a[1])[0];
  return winner ? mesh.skeleton.bones[winner[0]] : null;
}

function recordGeometry(mesh) {
  let record = geometryRecords.get(mesh);
  if (record) return record;
  const geometry = mesh.geometry;
  const layout = mesh.isSkinnedMesh ? mesh.skeleton.bones.map(b=>b.name).join('|') : namedPart(mesh);
  let layouts = sharedTriangleRecords.get(geometry);
  if (!layouts) sharedTriangleRecords.set(geometry, layouts = new Map());
  let topology = layouts.get(layout);
  if (!topology) {
    const indices = geometry.index ? geometry.index.array : Array.from({length: geometry.attributes.position.count}, (_, i) => i);
    const triangles = [], unique = Object.fromEntries(PARTS.map(part=>[part,new Set()]));
    for (let i = 0; i < indices.length; i += 3) {
      const ids = [indices[i],indices[i+1],indices[i+2]], bone = triangleBone(mesh, ids);
      const group = geometry.groups.find(g => i >= g.start && i < g.start + g.count);
      const part = bone ? canonicalPart(bone.name) : namedPart(mesh);
      triangles.push({ids, part, materialIndex: group?.materialIndex || 0});
      for (const id of ids) unique[part].add(id);
    }
    topology = {triangles, partIndices:Object.fromEntries(PARTS.map(part=>[part,[...unique[part]]]))};
    layouts.set(layout, topology);
  }
  record = {original: geometry, ...topology, signature: '', owned: null}; geometryRecords.set(mesh, record);
  return record;
}

function appendMaterialGroup(geometry, offset, materialIndex) {
  const last = geometry.groups.at(-1);
  if (last && last.materialIndex === materialIndex && last.start + last.count === offset) last.count += 3;
  else geometry.addGroup(offset, 3, materialIndex);
}

function isVisible(node, root) {
  for (let n = node; n; n = n.parent) { if (!n.visible || n.userData.ignoreContact) return false; if (n === root) break; }
  return true;
}

function prepareSurfaceCache(root) {
  root.updateWorldMatrix(true, true);
  const meshes = [], bounds = new THREE.Box3();
  root.traverse(mesh => {
    if (!mesh.isMesh || !isVisible(mesh, root)) return;
    let box;
    if (mesh.isSkinnedMesh) {
      mesh.skeleton.update(); updateSkinBounds(mesh);
      mesh.boundingSphere ||= new THREE.Sphere(); mesh.boundingBox.getBoundingSphere(mesh.boundingSphere); box = mesh.boundingBox;
    } else { if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox(); box = mesh.geometry.boundingBox; }
    bounds.union(box.clone().applyMatrix4(mesh.matrixWorld)); meshes.push(mesh);
  });
  return {meshes, bounds};
}

export function segmentSurfaceContacts(root, from, to, targetId, prepared, {includePartPoses = true} = {}) {
  const origin = new THREE.Vector3().fromArray(from), end = new THREE.Vector3().fromArray(to);
  const delta = end.sub(origin), length = delta.length();
  if (length < 1e-8) return [];
  const direction = delta.normalize(), ray = new THREE.Raycaster(origin, direction, 0, length);
  const cache = prepared || prepareSurfaceCache(root);
  if (!ray.ray.intersectsBox(cache.bounds)) return [];
  const intersections = ray.intersectObjects(cache.meshes, false);
  const partPoses = includePartPoses && intersections.length && !root.userData.detachedPart ? (cache.partPoses ||= capturePartPoses(root)) : undefined;
  return intersections.map(hit => {
    const mesh = hit.object, ids = [hit.face.a, hit.face.b, hit.face.c];
    const vertices = ids.map(i => mesh.getVertexPosition(i, new THREE.Vector3()));
    const localHit = mesh.worldToLocal(hit.point.clone());
    const bary = THREE.Triangle.getBarycoord(localHit, ...vertices, new THREE.Vector3());
    const bone = triangleBone(mesh, ids, bary ? bary.toArray() : undefined);
    const part = mesh.userData.detachedPart || (bone ? canonicalPart(bone.name) : namedPart(mesh));
    const anchor = bone || (root.userData.detachedPart ? root : partAnchor(root, part));
    const partRoot = root.userData.detachedPart ? root : partAnchor(root, part);
    const orientation = new THREE.Quaternion().setFromUnitVectors(forward, direction);
    const inverse = anchor.getWorldQuaternion(new THREE.Quaternion()).invert();
    const worldVertices = vertices.map(v => v.applyMatrix4(mesh.matrixWorld));
    const normal = THREE.Triangle.getNormal(...worldVertices, new THREE.Vector3());
    if (normal.dot(direction) > 0) normal.negate();
    const localNormal = normal.clone().applyQuaternion(inverse).normalize();
    const partBounds = partPoses?.[part]?.localBounds;
    let impactThickness;
    if (partBounds) {
      // An oriented part box gives a conservative travel distance through the
      // authored skull/limb. It affects only the visual embed, never hit authority.
      const justInside = hit.point.clone().addScaledVector(direction, .002);
      const localOrigin = partRoot.worldToLocal(justInside.clone());
      const localDirection = partRoot.worldToLocal(justInside.clone().add(direction)).sub(localOrigin).normalize();
      const exit = new THREE.Ray(localOrigin, localDirection).intersectBox(
        new THREE.Box3(new THREE.Vector3().fromArray(partBounds.min), new THREE.Vector3().fromArray(partBounds.max)), new THREE.Vector3());
      if (exit) impactThickness = THREE.MathUtils.clamp(justInside.distanceTo(partRoot.localToWorld(exit)) + .002, 0, .8);
    }
    return {targetId, part, ...(contactSurface(mesh) ? {surface: 'shield'} : {}), boneName: bone?.name || (!root.userData.detachedPart && anchor !== root ? anchor.name : ''), point: hit.point.toArray(), normal: normal.toArray(),
      localPoint: anchor.worldToLocal(hit.point.clone()).toArray(), localNormal: localNormal.toArray(), localQuaternion: inverse.multiply(orientation).toArray(),
      partPosition: partRoot.getWorldPosition(new THREE.Vector3()).toArray(), partQuaternion: partRoot.getWorldQuaternion(new THREE.Quaternion()).toArray(),
      partPoses, localBounds: partBounds, ...(impactThickness===undefined?{}:{impactThickness}), distance: hit.distance};
  });
}

export function capturePartPoses(root) {
  const poses = {}, bounds = {}, inverse = {};
  for (const part of PARTS) {
    const anchor = partAnchor(root, part), position = anchor.getWorldPosition(new THREE.Vector3()), quaternion = anchor.getWorldQuaternion(new THREE.Quaternion());
    poses[part] = {position: position.toArray(), quaternion: quaternion.toArray()}; bounds[part] = new THREE.Box3();
    inverse[part] = new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(1, 1, 1)).invert();
  }
  root.traverse(mesh => {
    if (!mesh.isMesh || !isVisible(mesh, root)) return;
    const record = recordGeometry(mesh);
    const point = new THREE.Vector3();
    for (const part of PARTS) for (const index of record.partIndices[part]) {
      bounds[part].expandByPoint(mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse[part]));
    }
  });
  for (const part of PARTS) if (!bounds[part].isEmpty()) poses[part].localBounds = {min: bounds[part].min.toArray(), max: bounds[part].max.toArray()};
  return poses;
}

// Bake visible posed triangles, retaining UVs, colours and material groups.
// A whole leg includes every triangle weighted to its thigh, knee and foot.
// Rotation taking local face direction f (and local up, +Y of the frozen bone) onto world direction `to` with `up`.
const _fb = new THREE.Matrix4(), _tb = new THREE.Matrix4(), _fx = new THREE.Vector3(), _fu = new THREE.Vector3(), _tx = new THREE.Vector3(), _tu = new THREE.Vector3();
export function faceToward(out, f, to, up) {
  _fu.set(0, 1, 0).addScaledVector(f, -f.y).normalize(); _fx.crossVectors(_fu, f);
  _tu.copy(up).addScaledVector(to, -up.dot(to)).normalize(); _tx.crossVectors(_tu, to);
  _fb.makeBasis(_fx, _fu, f); _tb.makeBasis(_tx, _tu, to);
  return out.setFromRotationMatrix(_tb.multiply(_fb.transpose()));
}
export function snapshotDetachedPart(root, part) {
  root.updateWorldMatrix(true, true);
  const anchor = partAnchor(root, part);
  const detached = new THREE.Group(); detached.userData.detachedPart = part;
  detached.position.copy(anchor.getWorldPosition(new THREE.Vector3()));
  detached.quaternion.copy(anchor.getWorldQuaternion(new THREE.Quaternion()));
  const worldToDetached = new THREE.Matrix4().compose(detached.position, detached.quaternion, new THREE.Vector3(1, 1, 1)).invert();
  // Anchors preserve actual bone space, including actor scale, after freezing.
  root.traverse(node => {
    if (!node.isBone && node !== anchor) return;
    const frozen = new THREE.Group(); frozen.name = node.name; frozen.matrix.copy(worldToDetached).multiply(node.matrixWorld);
    frozen.matrix.decompose(frozen.position, frozen.quaternion, frozen.scale); detached.add(frozen);
  });
  const eyes = new THREE.Vector3(); let eyeCount = 0, centre = null;
  root.traverse(mesh => {
    if (!mesh.isMesh || !isVisible(mesh, root)) return;
    const record = recordGeometry(mesh), selected = record.triangles.filter(t => t.part === part);
    if (!selected.length) return;
    if (mesh.isSkinnedMesh) mesh.skeleton.update();
    const geometry = new THREE.BufferGeometry(), positions = [], attributes = {};
    for (const [name, attr] of Object.entries(record.original.attributes)) {
      if (!['position', 'normal', 'skinIndex', 'skinWeight', 'tangent'].includes(name)) attributes[name] = {source: attr, values: []};
    }
    let offset = 0;
    for (const triangle of selected) {
      const glow = (Array.isArray(mesh.material) ? mesh.material[triangle.materialIndex] : mesh.material)?.name === 'EyeGlow';
      for (const index of triangle.ids) {
        const point = mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).applyMatrix4(worldToDetached);
        positions.push(...point.toArray());
        if (glow) { eyes.add(point); eyeCount++; }
        for (const attr of Object.values(attributes)) for (let c = 0; c < attr.source.itemSize; c++) attr.values.push(attr.source.getComponent(index, c));
      }
      appendMaterialGroup(geometry, offset, triangle.materialIndex); offset += 3;
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    for (const [name, attr] of Object.entries(attributes)) geometry.setAttribute(name, new THREE.Float32BufferAttribute(attr.values, attr.source.itemSize));
    geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    const piece = new THREE.Mesh(geometry, mesh.material); piece.name = `${mesh.name}:detached`;
    piece.userData.detachedPart = part;
    if (contactSurface(mesh)) piece.userData.contactSurface = 'shield';
    detached.add(piece);
    if (piece.material?.name === 'Bone' || (Array.isArray(piece.material) && piece.material.some(m => m.name === 'Bone'))) centre = (centre || new THREE.Box3()).union(geometry.boundingBox || (geometry.computeBoundingBox(), geometry.boundingBox));
  });
  // A skull remembers which way its face looks (towards its glowing eyes), so a hero holding it sees it grin back.
  if (eyeCount && centre) {
    const face = eyes.divideScalar(eyeCount).sub(centre.getCenter(new THREE.Vector3()));
    if (face.lengthSq() > 1e-8) detached.userData.faceLocal = face.normalize();
  }
  return detached;
}

export function maskMissingParts(root, missing = []) {
  const signature = [...missing].sort().join(',');
  root.traverse(mesh => {
    // Reset also runs during actor teardown: broken shields and hidden actors can still own mask buffers.
    if (!mesh.isMesh || (missing.length && !isVisible(mesh, root))) return;
    // An untouched enemy needs no expensive per-triangle dismemberment map.
    if (!missing.length && !geometryRecords.has(mesh)) return;
    const record = recordGeometry(mesh);
    if (record.signature === signature) return;
    record.owned?.dispose(); record.owned = null;
    if (!missing.length) mesh.geometry = record.original;
    else {
      const geometry = record.original.clone(), indices = [];
      geometry.clearGroups();
      for (const triangle of record.triangles) if (!missing.includes(triangle.part)) {
        appendMaterialGroup(geometry, indices.length, triangle.materialIndex); indices.push(...triangle.ids);
      }
      geometry.setIndex(indices); record.owned = geometry; mesh.geometry = geometry;
    }
    record.signature = signature;
  });
}

export function createCombatView({scene, templates, actors, camera, beforeContacts = () => {}, onContact = () => {}, worldContact = () => null, height = () => 0, playerPosition = () => null}) {
  let snapshot = {}, disposed = false, elapsed = 0, contactRevision = 0;
  const damageNumbers = createCombatDamageNumbers(scene);
  const creatures = createCreatureLifeDeath({scene, height});
  const fractures = createEmbedFractures({camera});
  const streaks = createProjectileStreaks();
  const contrails = createPhoenixContrails();
  const flares = createPhoenixFlareView({scene, templates, height});
  scene.add(fractures.object, streaks.object, contrails.object);
  const flightPoint = new THREE.Vector3(), flightVelocity = new THREE.Vector3(), wingTip = new THREE.Vector3();
  let wingTips = null; // [left, right] wing-tip points in each wing node's own frame, measured once from the mesh
  // The vertex furthest from each wing's pivot is its tip: contrails stream from there, flapping included.
  function measureWingTips(wingNodes) {
    return wingNodes.map(wing => {
      const tip = new THREE.Vector3(), v = new THREE.Vector3(); if (!wing) return tip;
      wing.updateWorldMatrix(true, true); let best = -1;
      wing.traverse(mesh => { if (!mesh.isMesh) return; const p = mesh.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld); wing.worldToLocal(v); const d = v.lengthSq(); if (d > best) { best = d; tip.copy(v); } } });
      return tip;
    });
  }
  const flapAxis = new THREE.Vector3(0, 0, 1), flapTurn = new THREE.Quaternion(), velocityArray = [0, 0, 0];
  // Wings unfurl at release, bank into the curl, beat hard while the phoenix turns and fold away as the curve completes.
  // Phoenix skull carry-off (shared/phoenix-carry.js). The arrow that made the headshot becomes the phoenix: while it
  // carries, the embedded arrow is hidden and a winged arrow hauls the skull from just above it, beating frantically;
  // when it fumbles the skull it climbs away and fades. Every frame samples the same pure path the host steps.
  const carries = new Map(), carryUp = new THREE.Vector3(0, 1, 0), carryHeading = new THREE.Vector3(), carryLook = new THREE.Quaternion(), carryPitch = new THREE.Quaternion();
  const xAxis = new THREE.Vector3(1, 0, 0), zAxis = new THREE.Vector3(0, 0, 1), carryBox = new THREE.Box3();
  function carryRig(id, arrowId) {
    let rig = carries.get(id); if (rig) return rig;
    const arrow = prepareProjectile(templates, 'arrow'); if (!arrow || !templates.has('wings')) return null;
    dressArrowVariant(arrow, arrowId);
    const group = new THREE.Group(); group.userData.ignoreContact = true; group.add(arrow);
    const wings = prepareAsset(templates.get('wings'), 'wings').visual; wings.position.z = .42; arrow.add(wings);
    const wingNodes = ['WingLeft', 'WingRight'].map(name => { const w = wings.getObjectByName(name); if (w) w.userData.rest ||= w.quaternion.clone(); return w; });
    group.userData = {...group.userData, arrow, wings, wingNodes, flapSeed: (hashId(id) % 997) / 997 * Math.PI * 2, leaving: null, age: 0};
    scene.add(group); rig = {group, arrowId: null}; carries.set(id, rig); return rig;
  }
  function poseRig(rig, skullPosition, heading, effort, t, wobble = 0) {
    const {group} = rig, u = group.userData;
    // Up and a little ahead of the skull, nose high: hauling, not cruising.
    carryLook.setFromUnitVectors(forward, heading);
    group.quaternion.copy(carryLook).multiply(carryPitch.setFromAxisAngle(xAxis, .5 + .12 * Math.sin(t * 3.3) + wobble));
    group.quaternion.multiply(carryPitch.setFromAxisAngle(zAxis, .22 * Math.sin(t * 2.7 + u.flapSeed)));
    // The wings (0.42 m behind the arrow tip) beat just above the skull; the nose leads, up and ahead.
    group.position.copy(skullPosition).addScaledVector(carryUp, .22 + .05 * Math.sin(t * 19 + u.flapSeed))
      .addScaledVector(wingTip.copy(forward).applyQuaternion(group.quaternion), .42);
    u.wings.scale.setScalar(1.8);
    const rate = 8.5 + 4 * effort, amp = .55 + .5 * effort, flap = Math.sin(t * Math.PI * 2 * rate + u.flapSeed) * amp;
    for (let i = 0; i < 2; i++) { const w = u.wingNodes[i]; if (w) w.quaternion.copy(w.userData.rest).multiply(flapTurn.setFromAxisAngle(flapAxis, i ? flap : -flap)); }
    group.updateWorldMatrix(false, true);
    // Frantic wing tips would scribble at carrying speed; one soft ember wisp streams from the tail instead.
    contrails.emit(`carry:${rig.group.id}`, u.arrow.localToWorld(wingTip.set(0, 0, .78)), .5 * (u.fade ?? 1));
  }
  function updateCarries(dt, tick) {
    const live = new Set();
    for (const [id, node] of detached) {
      const carry = node.userData.carry; if (!carry) continue;
      // The phoenix brings the skull home to its archer: the local archer's predicted feet, others' from the snapshot.
      const home = playerPosition(carry.by) || (snapshot.players || []).find(p => p.id === carry.by)?.position || null;
      const pose = carryPose(carry, tick, height, home);
      // The first moments blend from where the skull was knocked off, so the snatch never pops.
      if (!node.userData.carryFrom || node.userData.carryFrom.arrow !== carry.arrow) {
        node.userData.carryFrom = {arrow: carry.arrow, position: node.position.clone(), quaternion: node.quaternion.clone()};
      }
      const from = node.userData.carryFrom, blend = Math.min(1, pose.t / .3), ease = blend * blend * (3 - 2 * blend);
      node.position.fromArray(pose.position).lerp(from.position, 1 - ease); node.quaternion.fromArray(pose.quaternion); node.quaternion.slerp(from.quaternion, 1 - ease);
      node.userData.pose = null; // a dropped skull resumes from here when snapshots stop carrying it
      const rig = carryRig(id, carry.arrow); if (!rig) continue; live.add(id);
      node.updateMatrixWorld(); carryBox.setFromObject(node);
      // Head pieces can include a hood or neck gear; the bird grips the top of the skull.
      const skullCentre = carryBox.getCenter(flightVelocity); skullCentre.y = carryBox.max.y - .12;
      rig.arrowId = carry.arrow; rig.group.userData.leaving = null; rig.group.userData.fade = 1;
      const embed = embeds.get(carry.arrow); if (embed) embed.visible = false;
      carryHeading.set(pose.velocity[0], 0, pose.velocity[2]); if (carryHeading.lengthSq() < 1e-6) carryHeading.set(carry.dir[0], 0, carry.dir[1]);
      carryHeading.normalize();
      rig.group.userData.heading = carryHeading.clone();
      poseRig(rig, skullCentre, carryHeading, pose.effort, pose.t, -.35 * Math.max(0, -pose.velocity[1]) / 4);
    }
    // Let go: the phoenix climbs away along its heading, wings still beating, and fades out.
    for (const [id, rig] of carries) {
      if (live.has(id)) continue;
      const u = rig.group.userData;
      if (!u.leaving) u.leaving = {age: 0, from: rig.group.position.clone()};
      u.leaving.age += dt; const a = u.leaving.age, k = Math.min(1, a / 1.3);
      u.fade = 1 - k;
      const heading = u.heading || carryHeading.set(0, 0, -1);
      flightPoint.copy(u.leaving.from).addScaledVector(heading, 6 * a + 3 * a * a).addScaledVector(carryUp, 2.5 * a + 2 * a * a);
      if (k >= 1) { rig.group.removeFromParent(); carries.delete(id); continue; }
      poseRig(rig, flightPoint.addScaledVector(carryUp, -.26), heading, .3, a + 10, -.25);
      u.wings.scale.setScalar(1.8 * (1 - k * k)); u.arrow.scale.setScalar(Math.max(.002, 1 - k * k));
    }
  }
  function updatePhoenixWings(node, data, age) {
    const wings = node.userData.wings, curve = data.curve || [0, 0, 0];
    const fade = Math.max(0, 1 - age / .85), curved = curve[0] * curve[0] + curve[1] * curve[1] + curve[2] * curve[2] > .000001;
    wings.visible = curved && fade > 0; if (!wings.visible) return;
    const open = Math.min(1, age / .08);
    wings.scale.setScalar(Math.max(.002, fade * 1.1 * (.35 + .65 * open)));
    flightVelocity.toArray(velocityArray);
    wings.rotation.z = phoenixBank(curve, velocityArray, age, node.quaternion);
    const flap = Math.sin(age * Math.PI * 2 * 6.5 + node.userData.flapSeed) * .5 * (.35 + .65 * fade);
    const nodes = node.userData.wingNodes;
    wingTips ||= measureWingTips(nodes);
    for (let i = 0; i < 2; i++) {
      const wing = nodes[i]; if (!wing) continue;
      wing.quaternion.copy(wing.userData.rest).multiply(flapTurn.setFromAxisAngle(flapAxis, i ? flap : -flap));
    }
    node.updateWorldMatrix(false, true);
    for (let i = 0; i < 2; i++) if (nodes[i]) contrails.emit(`${data.id}:${i}`, nodes[i].localToWorld(wingTip.copy(wingTips[i])), fade);
  }
  const embedPoint = new THREE.Vector3(), embedTravel = new THREE.Vector3(), embedQuaternion = new THREE.Quaternion();
  const streakFallback = new THREE.Vector3();
  const emberPoint = new THREE.Vector3(), emberQuaternion = new THREE.Quaternion();
  const surfaceCaches = new WeakMap();
  function surface(root) {
    let cache = surfaceCaches.get(root);
    if (!cache || cache.revision !== contactRevision) { cache = prepareSurfaceCache(root); cache.revision = contactRevision; surfaceCaches.set(root, cache); }
    return cache;
  }
  const detached = new Map(), projectiles = new Map(), embeds = new Map(), reported = new Set(), sweptUntil = new Map(), piercedBy = new Map();
  const fractureAnchors = new Map();
  const actorFor = id => actors.get(`e:${id}`) || actors.get(id);
  const creatureActor = entry => entry?.enemy && (entry.data?.kind === 'skeleton' || entry.data?.kind === 'golem');
  const remove = (map, id, ownsGeometry = false) => {
    const node = map.get(id); if (!node) return;
    node.userData.emberdew?.dispose(); node.userData.flareGlow?.material.dispose(); node.traverse(n => { if (n.userData.siegebirdGolden) disposeGoldenProjectile(n); });
    node.removeFromParent(); if (ownsGeometry) node.traverse(n => n.geometry?.dispose()); map.delete(id);
  };
  function projectile(kind, golden = false, id = '') {
    // Flame tongues are pooled by the fire presentation; collision still sweeps
    // the same complete authoritative trail, independently of this empty group.
    if(kind==='flame')return new THREE.Group();
    const visual = kind==='fuel' ? templates.get('flask')?.scene.clone(true) : prepareProjectile(templates, kind);
    if (!visual) return null;
    if (golden && kind === 'bolt') dressGoldenProjectile(visual);
    if (kind === 'arrow') dressArrowVariant(visual, id);
    // Arrow's basis is already canonical; always retain it beneath attachment pose.
    const group = new THREE.Group(); group.userData.ignoreContact = true; group.add(visual);
    if (kind === 'fuel') { group.userData.emberdewRoot = visual; group.userData.emberdew = attachEmberdew({root: visual}); }
    return group;
  }
  // Capture limbs while their animated source actors still exist. The game calls
  // this before replacing/removing actors, then syncs flight/embeds only once.
  function prepareActors(next) {
    for (const data of next.detachedParts || []) {
      let node = detached.get(data.id);
      if (!node) {
        let source = actorFor(data.sourceId)?.visual;
        if (!source && templates.has(data.kind)) { source = prepareAsset(templates.get(data.kind), data.kind).visual; if (data.kind === 'skeleton') dressSkeleton(source, data.sourceId); }
        if (!source || source.userData.placeholder) continue;
        node = snapshotDetachedPart(source, data.part); detached.set(data.id, node); scene.add(node);
        node.position.fromArray(data.position); node.quaternion.fromArray(data.quaternion || [0, 0, 0, 1]);
      }
      const targetPosition = new THREE.Vector3().fromArray(data.position), targetQuaternion = new THREE.Quaternion().fromArray(data.quaternion || [0, 0, 0, 1]);
      const oldPose = node.userData.pose;
      if (!oldPose || !oldPose.position.equals(targetPosition) || !oldPose.quaternion.equals(targetQuaternion)) {
        node.userData.pose = {from: node.position.clone(), fromQuaternion: node.quaternion.clone(), position: targetPosition, quaternion: targetQuaternion, age: 0};
      }
      node.userData.targetId = data.id; node.userData.heldBy = data.heldBy; node.userData.carry = data.carry || null;
    }
    const detachedIds=new Set((next.detachedParts||[]).map(p=>p.id));
    for (const [id] of detached) if (!detachedIds.has(id)) remove(detached, id, true);
    // Release owned mask buffers before the caller removes dead actor roots.
    const enemyIds=new Set((next.enemies||[]).map(p=>p.id));
    for (const entry of actors.values()) if (entry.enemy && !enemyIds.has(entry.data?.id)) maskMissingParts(entry.visual, []);
  }
  function sync(next,{prepared=false}={}) {
    contactRevision++;snapshot=next;
    if(!prepared)prepareActors(next);
    for (const data of next.enemies || []) {
      const actor = actorFor(data.id); if (!actor) continue;
      if (data.kind === 'golem') updateGolemArmor(actor.visual, data.armor);
      if (data.kind === 'skeleton') setShieldBroken(actor.visual, !!data.shieldBroken);
      maskMissingParts(actor.visual, data.missingParts || []);
    }
    for (const data of next.projectiles || []) {
      let node = projectiles.get(data.id);
      if (!node) { node = projectile(data.kind, data.golden, data.id); if (!node) continue; projectiles.set(data.id, node); scene.add(node); }
      // A fresh snapshot replaces the prediction; the visible gap closes over ~60 ms instead of popping.
      const rendered = node.userData.flight ? node.position.clone() : null;
      node.position.fromArray(data.position);
      node.userData.flight = {position: new THREE.Vector3().fromArray(data.position), velocity: new THREE.Vector3().fromArray(data.velocity), age: 0,
        tick: next.tick || 0, offset: rendered ? rendered.sub(node.position) : new THREE.Vector3()};
      if (node.userData.flight.offset.lengthSq() > 4) node.userData.flight.offset.set(0, 0, 0);
      node.userData.projectileData = data;
      if (data.flare) dressFlareArrow(node);
      const velocity = new THREE.Vector3().fromArray(data.velocity);
      if (velocity.lengthSq()) node.quaternion.setFromUnitVectors(forward, velocity.normalize());
      if (data.kind === 'arrow' && templates.has('wings') && !node.userData.wings) {
        const wings = prepareAsset(templates.get('wings'), 'wings').visual;
        wings.position.z = .42; node.add(wings); node.userData.wings = wings;
        node.userData.wingNodes = ['WingLeft', 'WingRight'].map(name => { const w = wings.getObjectByName(name); if (w) w.userData.rest ||= w.quaternion.clone(); return w; });
        node.userData.flapSeed = (hashId(data.id) % 997) / 997 * Math.PI * 2;
      }
      if (node.userData.wings) {
        const age = Math.max(0, (next.tick - data.bornTick) / 60) || 0, curve = new THREE.Vector3().fromArray(data.curve || [0, 0, 0]);
        const fade = Math.max(0, 1 - age / .85); node.userData.wings.visible = curve.lengthSq() > .000001 && fade > 0;
        node.userData.wings.scale.setScalar(Math.max(.002, fade * 1.1));
        node.userData.wings.rotation.z = phoenixBank(data.curve,data.velocity,age,node.quaternion);
      }
    }
    const projectileIds=new Set((next.projectiles||[]).map(p=>p.id));
    for (const [id] of projectiles) if (!projectileIds.has(id)) { remove(projectiles, id); reported.delete(id); sweptUntil.delete(id); piercedBy.delete(id); }
    for (const data of next.embeds || []) {
      let node = embeds.get(data.id);
      if (!node) { node = projectile(data.kind, data.golden, data.id); if (!node) continue; embeds.set(data.id, node); }
      const world = data.targetId === 'world' || data.targetId === 'terrain';
      const loose = detached.get(data.targetId), actor = actorFor(data.targetId), target = world ? scene : loose || actor?.visual;
      if (!target) { node.visible = false; fractures.remove(data.id); fractureAnchors.delete(data.id); continue; }
      let anchor = world ? scene : null;
      if (data.boneName) target.traverse(n => { if (n.name === data.boneName && (!anchor || n.isBone)) anchor = n; });
      anchor ||= loose || partAnchor(target, data.part);
      if (node.parent !== anchor) anchor.add(node);
      node.visible = true; node.quaternion.fromArray(data.localQuaternion || [0, 0, 0, 1]);
      const scale = anchor.getWorldScale(new THREE.Vector3()); node.scale.set(1 / scale.x, 1 / scale.y, 1 / scale.z);
      const penetration = data.penetration ?? (world ? .025 : data.kind === 'bolt' && data.part === 'head' ? .125 : .065);
      anchor.updateWorldMatrix(true, false);
      embedPoint.fromArray(data.localPoint || [0, 0, 0]); anchor.localToWorld(embedPoint);
      embedTravel.copy(forward).applyQuaternion(node.quaternion).applyQuaternion(anchor.getWorldQuaternion(embedQuaternion)).normalize().multiplyScalar(penetration);
      node.position.copy(anchor.worldToLocal(embedPoint.add(embedTravel)));
      // Crack art can attach to this same bone/root with an exact surface
      // tangent, while the projectile tip sits deeper along its entry path.
      const localNormal = data.localNormal || new THREE.Vector3().fromArray(data.normal || [0, 0, 1])
        .applyQuaternion(anchor.getWorldQuaternion(embedQuaternion).invert()).normalize().toArray();
      node.userData.fracture = {id:data.id,part:data.part,targetId:data.targetId,localPoint:data.localPoint,
        localNormal,penetration};
      const previous = fractureAnchors.get(data.id);
      if (!previous || previous.anchor !== anchor || previous.targetId !== data.targetId) {
        const piece = (snapshot.detachedParts || []).find(d => d.id === data.targetId);
        fractures.add({embedId:data.id,targetId:data.targetId,part:data.part,anchor,localPoint:data.localPoint,
          localSurfaceNormal:localNormal,penetration,seed:hashId(data.id),
          material:world || piece?.kind === 'golem' || actor?.data?.kind === 'golem' ? 'stone' : 'bone'});
        fractureAnchors.set(data.id, {anchor,targetId:data.targetId});
      }
    }
    const embedIds=new Set((next.embeds||[]).map(p=>p.id));
    for (const [id] of embeds) if (!embedIds.has(id)) {
      remove(embeds, id); fractures.remove(id); fractureAnchors.delete(id);
    }
  }
  function segmentContacts(from, to, {excludeId, includePartPoses = true} = {}) {
    const contacts = [];
    for (const entry of actors.values()) if (entry.enemy && entry.data?.id !== excludeId && !entry.visual.userData.placeholder) {
      contacts.push(...segmentSurfaceContacts(entry.visual, from, to, entry.data.id, surface(entry.visual), {includePartPoses}));
    }
    for (const [id, node] of detached) if (id !== excludeId) contacts.push(...segmentSurfaceContacts(node, from, to, id, surface(node), {includePartPoses}));
    return contacts.sort((a, b) => a.distance - b.distance);
  }
  function tick(dt, isHost = false, time = elapsed + dt, renderTick = snapshot.tick || 0) {
    if (disposed) return;
    elapsed += dt;
    damageNumbers.tick(dt);
    for (const node of projectiles.values()) {
      const flight = node.userData.flight;
      if (!flight || !node.visible) continue;
      const data = node.userData.projectileData;
      if (data && ['arrow', 'bolt', 'fuel'].includes(data.kind) && data.bornTick !== undefined) {
        // Arrows, bolts and thrown Emberdew follow the authoritative flight equation every frame (curl, drag, gravity).
        flight.age = Math.min(.1, flight.age + dt);
        predictArrow(data, flight.tick, flight.age * 60, flightPoint, flightVelocity);
        flight.offset.multiplyScalar(Math.exp(-dt / .06));
        node.position.copy(flightPoint).add(flight.offset);
        if (flightVelocity.lengthSq() > 1e-6) node.quaternion.setFromUnitVectors(forward, flightPoint.copy(flightVelocity).normalize());
        if (node.userData.wings) updatePhoenixWings(node, data, (flight.tick - data.bornTick) / 60 + flight.age);
      } else {
        flight.age = Math.min(.05, flight.age + dt);
        node.position.copy(flight.position).addScaledVector(flight.velocity, flight.age);
      }
      if (node.userData.emberdew) {
        const root = node.userData.emberdewRoot;
        root.updateWorldMatrix(true, false);
        node.userData.emberdew.update({dt,time,lit:node.userData.projectileData?.lit,
          worldPosition:root.getWorldPosition(emberPoint),worldQuaternion:root.getWorldQuaternion(emberQuaternion),velocity:flight.velocity});
      }
    }
    for (const node of detached.values()) {
      if (node.userData.carry) continue; // drawn every frame from the shared flight path below
      const pose = node.userData.pose; if (!pose) continue;
      pose.age = Math.min(.05, pose.age + dt); const alpha = pose.age / .05;
      node.position.lerpVectors(pose.from, pose.position, alpha); node.quaternion.slerpQuaternions(pose.fromQuaternion, pose.quaternion, alpha);
    }
    updateCarries(dt, renderTick);
    flares.update(dt);
    contrails.update(dt, camera);
    streaks.update(snapshot.projectiles, {positionOf: data => projectiles.get(data.id)?.position || streakFallback.fromArray(data.position), hidden: reported});
    if (camera) fractures.update(camera);
    beforeContacts();
    for (const entry of actors.values()) if (creatureActor(entry)) creatures.sync(entry, renderTick, dt);
    creatures.syncDetached(detached, snapshot.detachedParts || []);
    creatures.tick(dt);
    contactRevision++;
    if (!isHost) return;
    for (const data of snapshot.projectiles || []) {
      if (reported.has(data.id)) continue;
      const previous = sweptUntil.get(data.id);
      let path = data.trail?.length > 1 ? data.trail : [previous || data.previousPosition || data.position, data.position];
      if (previous) {
        const index = path.findIndex(p => p.every((n, i) => n === previous[i]));
        path = index >= 0 ? path.slice(index) : [previous, ...path];
      }
      // Snapshots may contain several simulation steps. Sweep the complete
      // curved trail once; using only previousPosition tunnels at lower rates.
      for (let i = 1; i < path.length; i++) {
        const from = path[i - 1], to = path[i];
        if (from.every((n, axis) => n === to[axis])) continue;
        const hits = segmentContacts(from, to, {excludeId: data.ownerId}), world = worldContact(from, to);
        if (world) hits.push({...world, distance: world.distance ?? new THREE.Vector3().fromArray(from).distanceTo(new THREE.Vector3().fromArray(world.point))});
        hits.sort((a, b) => a.distance - b.distance);
        if (data.golden) {
          // Radiant bolt: report every body it passes through (shield and the body behind count separately),
          // each once; it stops only at the world.
          const seen = piercedBy.get(data.id) || piercedBy.set(data.id, new Set(data.pierced || [])).get(data.id);
          let stop = false;
          for (const hit of hits) {
            const key = hit.targetId + (hit.surface === 'shield' ? '#shield' : '');
            if (seen.has(key)) continue;
            seen.add(key); onContact({type: 'projectileHit', projectileId: data.id, ...hit});
            if (hit.targetId === 'world' || hit.targetId === 'terrain' || seen.size > 6) { stop = true; break; }
          }
          if (stop) { reported.add(data.id); const visual = projectiles.get(data.id); if (visual) visual.visible = false; break; }
          continue;
        }
        const hit = hits[0];
        if (hit) { reported.add(data.id); const visual = projectiles.get(data.id); if (visual) visual.visible = false; onContact({type: 'projectileHit', projectileId: data.id, ...hit}); break; }
      }
      sweptUntil.set(data.id, [...data.position]);
    }
  }
  function grabTarget(origin, direction, range = 3) {
    const to = new THREE.Vector3().fromArray(origin).addScaledVector(new THREE.Vector3().fromArray(direction).normalize(), range).toArray();
    const candidates = [];
    for (const [id, node] of detached) if (!node.userData.heldBy) candidates.push(...segmentSurfaceContacts(node, origin, to, id, surface(node)));
    return candidates.sort((a, b) => a.distance - b.distance)[0]?.targetId || null;
  }
  // Presentation-only FPS pose. The authoritative held part still follows the
  // server's hand/yaw; the local view follows the camera-attached weapon grip,
  // including pitch. Call after tick(), before render(), only outside XR.
  const heldEye = new THREE.Vector3(), heldUp = new THREE.Vector3(), heldCamQ = new THREE.Quaternion();
  function poseLocalHeld(holderId, grip) {
    if (disposed || !holderId || !grip?.isObject3D) return false;
    const data = (snapshot.detachedParts || []).find(d => d.heldBy === holderId);
    const node = data && detached.get(data.id);
    if (!node) return false;
    grip.updateWorldMatrix(true, false);
    const rotation = grip.getWorldQuaternion(embedQuaternion);
    const centre = data.localBounds
      ? new THREE.Vector3().fromArray(data.localBounds.min).add(new THREE.Vector3().fromArray(data.localBounds.max)).multiplyScalar(.5)
      : new THREE.Vector3();
    const face = node.userData.faceLocal;
    if (face && camera) { // a held skull turns its grin to the viewer, a little three-quarter, like holding up Yorick
      const at = grip.getWorldPosition(embedPoint), eye = camera.getWorldPosition(heldEye);
      heldUp.set(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(heldCamQ));
      faceToward(rotation, face, eye.sub(at).normalize().applyAxisAngle(heldUp, .32), heldUp);
    }
    node.quaternion.copy(rotation);
    node.position.copy(grip.getWorldPosition(embedPoint)).sub(centre.applyQuaternion(rotation));
    if (camera) fractures.update(camera);
    return true;
  }
  function forEachEmbedFracture(visit) {
    if (disposed || typeof visit !== 'function') return 0;
    let count = 0;
    for (const node of embeds.values()) {
      if (!node.visible || !node.parent || !node.userData.fracture) continue;
      visit(node.userData.fracture, node.parent, node);
      count++;
    }
    return count;
  }
  // Actual animated joint positions, bounded to eight samples per region. This
  // reuses rendered transforms; it never reskins all vertices for fire ecology.
  function fireSamples(id) {
    const actor=actorFor(typeof id==='object'?id.id:id);if(!actor)return null;
    // Joint pivots describe articulation rather than the extent of a surface.
    // Use actual authored geometry so low flames can reach toes and lower limbs.
    // Cache authored bounds relative to the actual weighted bone once, then
    // transform at most eight points per region as that bone animates.
    actor.root.updateMatrixWorld(true);
    const cache=fireSamples.cache ||= new WeakMap();let records=cache.get(actor.visual);
    if(!records){
      const byAnchor=new Map(),point=new THREE.Vector3();
      actor.visual.traverse(mesh=>{
        if(!mesh.isMesh||!isVisible(mesh,actor.visual)||contactSurface(mesh))return;
        if(mesh.isSkinnedMesh)mesh.skeleton.update();
        const ids=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight;
        for(let i=0;i<mesh.geometry.attributes.position.count;i++){
          let anchor=null;
          if(mesh.isSkinnedMesh&&ids&&weights){let best=-1;for(let j=0;j<4;j++)if(weights.getComponent(i,j)>best){best=weights.getComponent(i,j);anchor=mesh.skeleton.bones[ids.getComponent(i,j)];}}
          const part=anchor?canonicalPart(anchor.name):namedPart(mesh);anchor ||= partAnchor(actor.visual,part);
          let record=byAnchor.get(anchor);
          if(!record){record={anchor,part,bounds:new THREE.Box3(),inverse:anchor.matrixWorld.clone().invert()};byAnchor.set(anchor,record);}
          mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld).applyMatrix4(record.inverse);record.bounds.expandByPoint(point);
        }
      });
      records=[...byAnchor.values()].filter(r=>!r.bounds.isEmpty()).map(r=>{
        const c=r.bounds.getCenter(new THREE.Vector3()),lo=r.bounds.min,hi=r.bounds.max;
        return {anchor:r.anchor,part:r.part,points:[c,new THREE.Vector3(c.x,lo.y,c.z),new THREE.Vector3(c.x,hi.y,c.z),new THREE.Vector3(lo.x,c.y,c.z),new THREE.Vector3(hi.x,c.y,c.z),new THREE.Vector3(c.x,c.y,lo.z),new THREE.Vector3(c.x,c.y,hi.z)]};
      });cache.set(actor.visual,records);
    }
    const out=Object.fromEntries(PARTS.map(p=>[p,[]]));
    // Round-robin preserves feet/hands when a part spans several weighted bones.
    for(let sample=0;sample<7;sample++)for(const record of records){
      if(actor.data?.missingParts?.includes(record.part)||out[record.part].length>=8)continue;
      out[record.part].push(record.points[sample].clone().applyMatrix4(record.anchor.matrixWorld).toArray());
    }
    return out;
  }

  function dispose() {
    disposed = true;
    damageNumbers.dispose();
    creatures.dispose();
    fractures.dispose();
    streaks.dispose(); contrails.dispose(); flares.dispose(); for (const rig of carries.values()) rig.group.removeFromParent(); carries.clear();
    fractureAnchors.clear();
    for (const [id] of embeds) remove(embeds, id);
    for (const [id] of projectiles) remove(projectiles, id);
    for (const [id] of detached) remove(detached, id, true);
    for (const actor of actors.values()) maskMissingParts(actor.visual, []);
  }
  return {sync, prepareActors, tick, fireSamples, segmentContacts, grabTarget, poseLocalHeld, forEachEmbedFracture, dispose, detached, embeds, projectiles,
    rangedEffectStats: () => ({fracturesStored: fractures.embeds.size, fracturesVisible: fractures.object.count, streaksVisible: streaks.object.count, contrails: contrails.stats().trails, flares: flares.stats().flares}),
    beginCreatureFrame: () => creatures.beginFrame(),
    creatureStats: () => creatures.stats(),
    heldLimbRoot: holderId => {
      for (const node of detached.values()) if (node.userData.heldBy === holderId) return node;
      return null;
    },
    setDamageNumbers: value => damageNumbers.setEnabled(value),
    handleEvent: event => {
      damageNumbers.note(event);
      const actor = event?.id === undefined ? null : actorFor(event.id);
      if ((event?.kind === 'hit' || event?.kind === 'headshot') && creatureActor(actor)) creatures.hit(actor, event);
      if (event?.kind === 'death' && (creatureActor(actor) || ['skeleton', 'golem'].includes(event.creature))) creatures.death(actor, event);
      if (event?.kind === 'phoenix_flare' && Array.isArray(event.position)) flares.burst(event);
    },
    damageNumberStats: () => damageNumbers.stats()};
}
