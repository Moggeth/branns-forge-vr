import * as THREE from 'three';
import {prepareAsset, prepareProjectile} from './asset-pose.js';
import {updateSkinBounds} from './skin-bounds.js';
import {createCombatDamageNumbers} from './combat-damage-numbers.js';
import {createCreatureLifeDeath} from './creature-life-death.js';
import {createEmbedFractures} from './embed-fractures.js';
import {createProjectileStreaks} from './projectile-streaks.js';
import {attachEmberdew} from './emberdew-presentation.js';

const PARTS = ['head', 'torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
const NAMES = {head: ['Head'], torso: ['Torso', 'BodyCore'], leftArm: ['LeftArm', 'ArmL'], rightArm: ['RightArm', 'ArmR'], leftLeg: ['LeftLeg', 'LegL'], rightLeg: ['RightLeg', 'LegR']};
const forward = new THREE.Vector3(0, 0, -1);
const geometryRecords = new WeakMap();
const sharedTriangleRecords = new WeakMap();
const golemPoses = new WeakMap();
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

export function updateGolemPose(entry, dt, tick, elapsed) {
  const root = entry.visual;
  if (root.userData.mixer) return;
  let pose = golemPoses.get(root);
  if (!pose) {
    pose = {distance: 0, previous: entry.root.position.clone(), nodes: {}};
    for (const name of ['Head', 'BodyCore', 'ArmL', 'ArmR', 'LegL', 'LegR']) {
      const node = root.getObjectByName(name); if (node) pose.nodes[name] = {node, rest: node.quaternion.clone()};
    }
    golemPoses.set(root, pose);
  }
  const travel = pose.previous.distanceTo(entry.root.position); pose.previous.copy(entry.root.position);
  if (travel < .5) pose.distance += travel;
  const moving = travel > .0001, phase = pose.distance / 1.1 * Math.PI * 2;
  const attackAge = (tick - (entry.data.attackTick ?? -1000)) / 60;
  const attack = attackAge >= 0 && attackAge < 1;
  for (const [name, {node, rest}] of Object.entries(pose.nodes)) {
    const angles = new THREE.Euler();
    if (attack) {
      const t = attackAge;
      let lift = t <= .65 ? Math.sin(Math.min(t / .65, 1) * Math.PI / 2) * -1.55 : THREE.MathUtils.lerp(-1.55, .55, THREE.MathUtils.clamp((t - .65) / .15, 0, 1));
      if (t > .8) lift = THREE.MathUtils.lerp(.55, 0, (t - .8) / .2);
      if (name === 'ArmL' || name === 'ArmR') angles.x = lift;
      if (name === 'BodyCore') angles.x = -lift * .09;
    } else if (moving) {
      if (/Arm|Leg/.test(name)) angles.x = Math.sin(phase) * .22 * (['ArmL', 'LegR'].includes(name) ? -1 : 1);
      if (name === 'Head') angles.z = Math.sin(phase) * .035;
    } else {
      if (name === 'Head') angles.y = Math.sin(elapsed * Math.PI * .4) * .045;
      if (name === 'BodyCore') angles.x = Math.sin(elapsed * Math.PI * .4) * .012;
    }
    node.quaternion.copy(rest).multiply(new THREE.Quaternion().setFromEuler(angles));
  }
}

export function canonicalPart(name = '') {
  const n = name.toLowerCase().replace(/[^a-z]/g, '');
  if (/head|skull/.test(n)) return 'head';
  if (/leftleg|leftknee|leftfoot|legl/.test(n)) return 'leftLeg';
  if (/rightleg|rightknee|rightfoot|legr/.test(n)) return 'rightLeg';
  if (/leftarm|lefthand|arml|shoulderl|forearml|elbowl/.test(n)) return 'leftArm';
  if (/rightarm|righthand|armr|shoulderr|forearmr|elbowr/.test(n)) return 'rightArm';
  return 'torso';
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
    return {targetId, part, boneName: bone?.name || (!root.userData.detachedPart && anchor !== root ? anchor.name : ''), point: hit.point.toArray(), normal: normal.toArray(),
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
      for (const index of triangle.ids) {
        const point = mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).applyMatrix4(worldToDetached);
        positions.push(...point.toArray());
        for (const attr of Object.values(attributes)) for (let c = 0; c < attr.source.itemSize; c++) attr.values.push(attr.source.getComponent(index, c));
      }
      appendMaterialGroup(geometry, offset, triangle.materialIndex); offset += 3;
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    for (const [name, attr] of Object.entries(attributes)) geometry.setAttribute(name, new THREE.Float32BufferAttribute(attr.values, attr.source.itemSize));
    geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    const piece = new THREE.Mesh(geometry, mesh.material); piece.name = `${mesh.name}:detached`;
    piece.userData.detachedPart = part; detached.add(piece);
  });
  return detached;
}

export function maskMissingParts(root, missing = []) {
  const signature = [...missing].sort().join(',');
  root.traverse(mesh => {
    if (!mesh.isMesh || !isVisible(mesh, root)) return;
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

export function createCombatView({scene, templates, actors, camera, beforeContacts = () => {}, onContact = () => {}, worldContact = () => null, height = () => 0}) {
  let snapshot = {}, disposed = false, elapsed = 0, contactRevision = 0;
  const damageNumbers = createCombatDamageNumbers(scene);
  const creatures = createCreatureLifeDeath({scene, height});
  const fractures = createEmbedFractures({camera});
  const streaks = createProjectileStreaks();
  scene.add(fractures.object, streaks.object);
  const embedPoint = new THREE.Vector3(), embedTravel = new THREE.Vector3(), embedQuaternion = new THREE.Quaternion();
  const streakFallback = new THREE.Vector3();
  const emberPoint = new THREE.Vector3(), emberQuaternion = new THREE.Quaternion();
  const surfaceCaches = new WeakMap();
  function surface(root) {
    let cache = surfaceCaches.get(root);
    if (!cache || cache.revision !== contactRevision) { cache = prepareSurfaceCache(root); cache.revision = contactRevision; surfaceCaches.set(root, cache); }
    return cache;
  }
  const detached = new Map(), projectiles = new Map(), embeds = new Map(), reported = new Set(), sweptUntil = new Map();
  const fractureAnchors = new Map();
  const actorFor = id => actors.get(`e:${id}`) || actors.get(id);
  const creatureActor = entry => entry?.enemy && (entry.data?.kind === 'skeleton' || entry.data?.kind === 'golem');
  const remove = (map, id, ownsGeometry = false) => {
    const node = map.get(id); if (!node) return;
    node.userData.emberdew?.dispose();
    node.removeFromParent(); if (ownsGeometry) node.traverse(n => n.geometry?.dispose()); map.delete(id);
  };
  function projectile(kind) {
    // Flame tongues are pooled by the fire presentation; collision still sweeps
    // the same complete authoritative trail, independently of this empty group.
    if(kind==='flame')return new THREE.Group();
    const visual = kind==='fuel' ? templates.get('flask')?.scene.clone(true) : prepareProjectile(templates, kind);
    if (!visual) return null;
    // Arrow's basis is already canonical; always retain it beneath attachment pose.
    const group = new THREE.Group(); group.userData.ignoreContact = true; group.add(visual);
    if (kind === 'fuel') { group.userData.emberdewRoot = visual; group.userData.emberdew = attachEmberdew({root: visual}); }
    return group;
  }
  function sync(next) {
    contactRevision++;
    snapshot = next;
    for (const data of next.detachedParts || []) {
      let node = detached.get(data.id);
      if (!node) {
        let source = actorFor(data.sourceId)?.visual;
        if (!source && templates.has(data.kind)) source = prepareAsset(templates.get(data.kind), data.kind).visual;
        if (!source || source.userData.placeholder) continue;
        node = snapshotDetachedPart(source, data.part); detached.set(data.id, node); scene.add(node);
        node.position.fromArray(data.position); node.quaternion.fromArray(data.quaternion || [0, 0, 0, 1]);
      }
      const targetPosition = new THREE.Vector3().fromArray(data.position), targetQuaternion = new THREE.Quaternion().fromArray(data.quaternion || [0, 0, 0, 1]);
      const oldPose = node.userData.pose;
      if (!oldPose || !oldPose.position.equals(targetPosition) || !oldPose.quaternion.equals(targetQuaternion)) {
        node.userData.pose = {from: node.position.clone(), fromQuaternion: node.quaternion.clone(), position: targetPosition, quaternion: targetQuaternion, age: 0};
      }
      node.userData.targetId = data.id; node.userData.heldBy = data.heldBy;
    }
    for (const [id] of detached) if (!(next.detachedParts || []).some(p => p.id === id)) remove(detached, id, true);
    // Release owned mask buffers before the caller removes dead actor roots.
    for (const entry of actors.values()) if (entry.enemy && !(next.enemies || []).some(p => p.id === entry.data?.id)) maskMissingParts(entry.visual, []);
    for (const data of next.enemies || []) {
      const actor = actorFor(data.id); if (!actor) continue;
      if (data.kind === 'golem') updateGolemArmor(actor.visual, data.armor);
      maskMissingParts(actor.visual, data.missingParts || []);
    }
    for (const data of next.projectiles || []) {
      let node = projectiles.get(data.id);
      if (!node) { node = projectile(data.kind); if (!node) continue; projectiles.set(data.id, node); scene.add(node); }
      node.position.fromArray(data.position);
      node.userData.flight = {position: new THREE.Vector3().fromArray(data.position), velocity: new THREE.Vector3().fromArray(data.velocity), age: 0};
      node.userData.projectileData = data;
      const velocity = new THREE.Vector3().fromArray(data.velocity);
      if (velocity.lengthSq()) node.quaternion.setFromUnitVectors(forward, velocity.normalize());
      if (data.kind === 'arrow' && templates.has('wings') && !node.userData.wings) {
        const wings = prepareAsset(templates.get('wings'), 'wings').visual;
        wings.position.z = .42; node.add(wings); node.userData.wings = wings;
      }
      if (node.userData.wings) {
        const age = Math.max(0, (next.tick - data.bornTick) / 60) || 0, curve = new THREE.Vector3().fromArray(data.curve || [0, 0, 0]);
        const fade = Math.max(0, 1 - age / .85); node.userData.wings.visible = curve.lengthSq() > .000001 && fade > 0;
        node.userData.wings.scale.setScalar(Math.max(.002, fade * 1.1));
        node.userData.wings.rotation.z = THREE.MathUtils.clamp(curve.y, -1, 1) * -.8 * fade;
      }
    }
    for (const [id] of projectiles) if (!(next.projectiles || []).some(p => p.id === id)) { remove(projectiles, id); reported.delete(id); sweptUntil.delete(id); }
    for (const data of next.embeds || []) {
      let node = embeds.get(data.id);
      if (!node) { node = projectile(data.kind); if (!node) continue; embeds.set(data.id, node); }
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
    for (const [id] of embeds) if (!(next.embeds || []).some(p => p.id === id)) {
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
  function tick(dt, isHost = false, time = elapsed + dt) {
    if (disposed) return;
    elapsed += dt;
    damageNumbers.tick(dt);
    for (const node of projectiles.values()) {
      const flight = node.userData.flight;
      if (!flight || !node.visible) continue;
      flight.age = Math.min(.05, flight.age + dt);
      node.position.copy(flight.position).addScaledVector(flight.velocity, flight.age);
      if (node.userData.emberdew) {
        const root = node.userData.emberdewRoot;
        root.updateWorldMatrix(true, false);
        node.userData.emberdew.update({dt,time,lit:node.userData.projectileData?.lit,
          worldPosition:root.getWorldPosition(emberPoint),worldQuaternion:root.getWorldQuaternion(emberQuaternion),velocity:flight.velocity});
      }
    }
    for (const node of detached.values()) {
      const pose = node.userData.pose; if (!pose) continue;
      pose.age = Math.min(.05, pose.age + dt); const alpha = pose.age / .05;
      node.position.lerpVectors(pose.from, pose.position, alpha); node.quaternion.slerpQuaternions(pose.fromQuaternion, pose.quaternion, alpha);
    }
    streaks.update(snapshot.projectiles, {positionOf: data => projectiles.get(data.id)?.position || streakFallback.fromArray(data.position), hidden: reported});
    if (camera) fractures.update(camera);
    for (const entry of actors.values()) if (entry.enemy && entry.data?.kind === 'golem') updateGolemPose(entry, dt, snapshot.tick || 0, elapsed);
    beforeContacts();
    for (const entry of actors.values()) if (creatureActor(entry)) creatures.sync(entry, snapshot.tick || 0, dt);
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
        const hit = hits.sort((a, b) => a.distance - b.distance)[0];
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
  function dispose() {
    disposed = true;
    damageNumbers.dispose();
    creatures.dispose();
    fractures.dispose();
    streaks.dispose();
    fractureAnchors.clear();
    for (const [id] of embeds) remove(embeds, id);
    for (const [id] of projectiles) remove(projectiles, id);
    for (const [id] of detached) remove(detached, id, true);
    for (const actor of actors.values()) maskMissingParts(actor.visual, []);
  }
  return {sync, tick, segmentContacts, grabTarget, poseLocalHeld, forEachEmbedFracture, dispose, detached, embeds, projectiles,
    rangedEffectStats: () => ({fracturesStored: fractures.embeds.size, fracturesVisible: fractures.object.count, streaksVisible: streaks.object.count}),
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
    },
    damageNumberStats: () => damageNumbers.stats()};
}
