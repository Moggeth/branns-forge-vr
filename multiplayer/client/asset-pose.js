import * as THREE from 'three';
import {cloneSkinnedAsset as clone} from './clone-skinned-asset.js';
import {siegebirdMechanism, SIEGEBIRD_WINCH} from './siegebird-reload.js';
import {driveLiquid} from './wyrmspout-liquid.js';
import {wyrmTime} from './wyrmspout-look.js';

// Engine contract: metres, +Y up, -Z forward. Model axes are independently
// authored facts, never inferred from a bounding box or camera angle.
export const ASSET_POSES = Object.freeze({
  skeleton: {forward: [0, 0, 1], up: [0, 1, 0], pivot: 'feet', height: 1.7},
  forgeling: {forward: [0, 0, 1], up: [0, 1, 0], pivot: 'feet', height: 1.81}, // the skeleton's rig at the skeleton's scale (its chimney stands taller)
  golem: {forward: [0, 0, 1], up: [0, 1, 0], pivot: 'feet', height: 2.2},
  crossbow: {forward: [0, 1, 0], up: [0, 0, 1], pivot: 'GripAnchor', height: 1, nativeScale: 1, tip: 'BoltSeat'},
  bow: {forward: [0, 0, -1], up: [0, 1, 0], pivot: 'Grip', height: 1.48, nativeScale: 1, tip: 'ArrowGuide'},
  wyrmspout: {forward:[0,0,-1],up:[0,1,0],pivot:'GripAnchor',height:.4,nativeScale:1,tip:'Muzzle'},
  stormreel: {forward:[0,0,-1],up:[0,1,0],pivot:'GripAnchor',height:.5,nativeScale:1,tip:'Muzzle'},
  staff: {forward:[0,0,-1],up:[0,1,0],pivot:'GripAnchor',height:1.6,nativeScale:1,tip:'Crown'},
  flask: {forward:[0,0,-1],up:[0,1,0],pivot:[0,0,0],height:.18,nativeScale:1,tip:'Muzzle'},
  arrow: {forward: [0, 0, -1], up: [0, 1, 0], pivot: 'ArrowTip', height: .78, nativeScale: 1},
  wings: {forward: [0, 0, -1], up: [0, 1, 0], pivot: [0, 0, 0], height: .5, nativeScale: 1},
  // Generated Sunfall's crimson grip runs y=.03..38 and hammer face is X.
  hammer: {forward: [1, 0, 0], up: [0, 1, 0], pivot: [0, .205, 0], height: 1.34, nativeScale: 1, tipPoint: [.34, .83, 0]},
  pick: {forward: [1, 0, 0], up: [0, 1, 0], pivot: 'Grip', height: .75},
  axe: {forward: [1, 0, 0], up: [0, 1, 0], pivot: 'Grip_Center', height: 0.7, nativeScale: .81}, // Kingsfell: haft authored at the Orchard's Edge size; .81 keeps the hand fit
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
  if (xr && !['crossbow', 'bow', 'wyrmspout', 'flask', 'stormreel', 'staff'].includes(tool)) visual.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 4));
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
// Emberwing arrows carry variant heads and fletchings (Head_0.., Fletch_0..) beside one shared shaft. The arrow's
// id picks one of each, so an arrow keeps its look from flight to embed and no two volleys look stamped out.
const variantHash = id => [...String(id)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
export function dressArrowVariant(visual, id) {
  const families = visual.userData.arrowFamilies ||= (() => {
    const found = {};
    visual.traverse(node => { const m = /^(Head|Fletch)_(\d+)$/.exec(node.name); if (m) (found[m[1]] ||= [])[+m[2]] = node; });
    return Object.values(found).map(list => list.filter(Boolean));
  })();
  let h = variantHash(id);
  for (const list of families) { const pick = h % list.length; h = Math.floor(h / list.length) ^ 0x9e37; list.forEach((node, i) => { node.visible = i === pick; }); }
  visual.userData.arrowVariant = id;
  return visual;
}
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

// Emberwing's string: two thin square prisms (top->nock, nock->bottom) in one mesh, rewritten in place each frame.
// Unlit, so it reads as a taut glowing cord against any sky; `glow` warms it from sinew to ember.
const STRING_RADIUS = .0016, STRING_SINEW = new THREE.Color(0xe6d2ad), STRING_EMBER = new THREE.Color(0xffa040);
function createBowstring() {
  const geometry = new THREE.BufferGeometry(), index = [];
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 3), 3).setUsage(THREE.DynamicDrawUsage));
  for (let seg = 0; seg < 2; seg++) for (let f = 0; f < 4; f++) {
    const a = seg * 8 + f, b = seg * 8 + (f + 1) % 4, c = a + 4, d = b + 4; index.push(a, b, c, b, d, c);
  }
  geometry.setIndex(index);
  const line = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({color: STRING_SINEW.clone(), toneMapped: false, side: THREE.DoubleSide, fog: true}));
  line.name = 'EmberwingString'; line.frustumCulled = false; line.userData.ignoreContact = true;
  return line;
}
const _side = new THREE.Vector3(), _up = new THREE.Vector3(), _dir = new THREE.Vector3(), _ref = new THREE.Vector3(1, 0, 0);
function writePrism(attr, base, a, b, r) {
  _dir.subVectors(b, a).normalize(); _side.crossVectors(_dir, _ref); if (_side.lengthSq() < 1e-8) _side.set(0, 0, 1); _side.normalize();
  _up.crossVectors(_dir, _side).normalize();
  for (let end = 0; end < 2; end++) for (let f = 0; f < 4; f++) {
    const p = end ? b : a, ang = f * Math.PI / 2, cs = Math.cos(ang) * r, sn = Math.sin(ang) * r;
    attr.setXYZ(base + end * 4 + f, p.x + _side.x * cs + _up.x * sn, p.y + _side.y * cs + _up.y * sn, p.z + _side.z * cs + _up.z * sn);
  }
}
// The FPS bow gets its own copy of the Ember material(s) the first time `ember` is supplied, so one player's draw
// never lights every bow sharing the template; the copies live and die with that visual.
function emberMaterials(visual) {
  if (visual.userData.emberMaterials) return visual.userData.emberMaterials;
  const list = [];
  visual.traverse(mesh => {
    if (!mesh.isMesh) return;
    const swap = m => { if (!/^Ember$/.test(m?.name || '')) return m; const copy = m.clone(); copy.userData.baseEmissive = copy.emissiveIntensity ?? 1; list.push(copy); return copy; };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
  return (visual.userData.emberMaterials = list);
}

export function updateWeaponPresentation(visual, tool, {draw = 0, recoil = 0, reload, hand = null, time = 0, templates, ember, stringSnap = 0, stringGlow = 0, spray = 0, fill = 1, gout = 0, charge = 1, locked = false} = {}) {
  const amount = THREE.MathUtils.clamp(draw, 0, 1);
  if (tool === 'wyrmspout') { animateWyrmspout(visual, {spray, fill, gout, time, charge, locked}); return; }
  if (tool === 'bow') {
    const upper = visual.getObjectByName('UpperLimb'), lower = visual.getObjectByName('LowerLimb');
    for (const [node, sign] of [[upper, 1], [lower, -1]]) if (node) {
      node.userData.restQuaternion ||= node.quaternion.clone();
      node.quaternion.copy(node.userData.restQuaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), sign * amount * .09));
    }
    const top = visual.getObjectByName('StringTop'), bottom = visual.getObjectByName('StringBottom'), rest = visual.getObjectByName('ArrowRest');
    if (!top || !bottom || !rest) return;
    if (!visual.userData.bowstring) { const line = createBowstring(); visual.add(line); visual.userData.bowstring = line; }
    visual.updateWorldMatrix(true, true);
    // stringSnap: the released string's hum, in metres at the nock (emberwing-motion.js).
    const nock = visual.worldToLocal(rest.getWorldPosition(new THREE.Vector3())); nock.z += amount * .68 + stringSnap;
    const string = visual.userData.bowstring, attr = string.geometry.attributes.position;
    // The canonical visual is scaled to its reviewed height; keep the cord a constant real thickness.
    const radius = STRING_RADIUS / Math.max(1e-6, visual.getWorldScale(_dir).y || 1);
    writePrism(attr, 0, visual.worldToLocal(top.getWorldPosition(new THREE.Vector3())), nock, radius);
    writePrism(attr, 8, nock, visual.worldToLocal(bottom.getWorldPosition(new THREE.Vector3())), radius);
    attr.needsUpdate = true; string.geometry.computeBoundingSphere();
    string.material.color.copy(STRING_SINEW).lerp(STRING_EMBER, THREE.MathUtils.clamp(stringGlow, 0, 1)).multiplyScalar(1 + .6 * THREE.MathUtils.clamp(stringGlow, 0, 1));
    if (Number.isFinite(ember)) {
      // Embers breathe slowly at rest and surge with the draw, the phoenix latch and the shot.
      const glow = 1 + .12 * Math.sin(time * 2.1) + 1.7 * THREE.MathUtils.clamp(ember, 0, 1);
      for (const m of emberMaterials(visual)) m.emissiveIntensity = m.userData.baseEmissive * glow;
    }
    if (!visual.userData.nockedArrow && templates?.has('arrow')) {
      const arrow = prepareProjectile(templates, 'arrow'); arrow.userData.ignoreContact = true;
      visual.add(arrow); visual.userData.nockedArrow = arrow;
    }
    const arrow = visual.userData.nockedArrow;
    if (arrow) {
      // Each new draw nocks a fresh-looking arrow.
      if (amount > 0 && !arrow.visible) dressArrowVariant(arrow, `nock:${visual.userData.nocks = (visual.userData.nocks || 0) + 1}`);
      arrow.visible = amount > 0; arrow.position.copy(nock).z -= .78;
    }
  } else if (tool === 'crossbow') {
    // Reload time (seconds since the shot) drives the whole Siegebird cycle (siegebird-reload.js): the string
    // throws the sled forward and the drum freewheels back, the clutch bites, two crank turns wind one drum turn
    // through the 10:20 gears while the pawl clicks over the ratchet, the cable winds on, the arms fold back, and
    // the songbird seats the next bolt. Callers without a clock pass legacy recoil 0..1. hand: a VR hand's wind.
    const t = Number.isFinite(reload) ? reload : recoil > 0 ? (1 - THREE.MathUtils.clamp(recoil, 0, 1)) * .45 : Infinity;
    const m = siegebirdMechanism(t, hand), cocked = m.cocked;
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

// Wyrmspout III (assets-source/wyrmspout-v3): the jaw drops while it sprays and snaps wide for the Gout; the liquid
// sloshes in the glass (wyrmspout-liquid.js); and the wyrm tells you how it is doing with its own body:
//   * the Wyrm's Eye on the tank's rear cap: a wide round pupil when full, a thin slit when nearly dry; it squints
//     while spraying, blinks now and then, and shuts while the tank refills, opening as it fills back up;
//   * three dorsal fins light their veins one by one as Gout recharges, and breathe when it is ready;
//   * little flames flicker in its nostrils while Gout is ready.
// spray 0..1 (smoothed trigger), fill 0..1 (tank), gout 1..0 (just hocked a Gout), charge 0..1 (Gout readiness),
// locked (tank refilling). Older models simply lack the nodes. Everything runs on the presentation clock.
const WYRM_NODES = ['Jaw', 'FuelLiquid', 'Gauge_Needle', 'EmberCore', 'Head', 'Eye_Pupil', 'Eye_LidUpper', 'Eye_LidLower', 'Eye_Glow',
  'FinVein_1', 'FinVein_2', 'FinVein_3', 'NostrilFlame_L', 'NostrilFlame_R'];
const blinkAt = n => { const x = Math.sin(n * 91.7 + 13.1) * 43758.5453; return x - Math.floor(x); };
export function animateWyrmspout(visual, {spray = 0, fill = 1, gout = 0, time = 0, charge = 1, locked = false} = {}) {
  // Shared template materials stay shared (remote copies reuse them): only nodes move and grow.
  const parts = visual.userData.wyrmParts ||= Object.fromEntries(WYRM_NODES.map(n => [n, visual.getObjectByName(n)]));
  const st = visual.userData.wyrmState ||= {time, open: 1, ready: 0, veins: [0, 0, 0]};
  const dt = Math.min(.1, Math.max(0, time - st.time)); st.time = time;
  const s = THREE.MathUtils.clamp(spray, 0, 1), f = THREE.MathUtils.clamp(fill, 0, 1), k = THREE.MathUtils.clamp(gout, 0, 1), c = THREE.MathUtils.clamp(charge, 0, 1);
  const ease = rate => 1 - Math.exp(-dt * rate);
  wyrmTime.value = time % 1800;
  if (parts.Jaw) parts.Jaw.rotation.x = -(.36 * s + .62 * Math.sin(Math.PI * Math.min(1, (1 - k) * 1.4)) * (k > 0 ? 1 : 0)) - .03 * s * Math.sin(time * 38);
  if (parts.Head) { parts.Head.userData.rest ??= parts.Head.position.clone(); parts.Head.position.copy(parts.Head.userData.rest); parts.Head.position.y += .003 * s * Math.sin(time * 47); parts.Head.position.z += .012 * k * k; }
  const liquid = parts.FuelLiquid;
  if (liquid?.material?.userData?.wyrmLiquid) driveLiquid(liquid, {dt, fill: f, spray: s, gout: k, time});
  else if (liquid) { liquid.visible = f > .01; liquid.scale.y = Math.max(.01, f) * (1 + .04 * s * Math.sin(time * 29)); }
  if (parts.Gauge_Needle) parts.Gauge_Needle.rotation.z = THREE.MathUtils.degToRad(120 - 240 * f) + .05 * s * Math.sin(time * 61);
  if (parts.EmberCore) parts.EmberCore.scale.setScalar(.7 + 1.1 * s + 1.4 * k + .08 * Math.sin(time * 5));
  // The eye. Pupil: round when full, a slit when dry, narrowed by the glare of its own fire.
  if (parts.Eye_Pupil) { parts.Eye_Pupil.scale.x = (.32 + 2.1 * f ** .8) * (1 - .3 * s) * (1 + .03 * Math.sin(time * 1.3)); }
  if (parts.Eye_Glow) parts.Eye_Glow.scale.setScalar(.55 + .6 * f + .5 * s + .1 * Math.sin(time * 2.2));
  // Lids: shut while refilling and open over the last third of the refill; a squint while spraying; a blink every few seconds.
  const want = (locked ? THREE.MathUtils.smoothstep(f, .62, 1) : 1) * (1 - .32 * s);
  st.open += (want - st.open) * ease(locked ? 9 : 6);
  const slot = Math.floor(time / 4.5), phase = time - slot * 4.5 - blinkAt(slot) * 3.2, blink = phase > 0 && phase < .16 ? Math.sin(phase / .16 * Math.PI) : 0;
  const open = st.open * (1 - blink);
  for (const lid of [parts.Eye_LidUpper, parts.Eye_LidLower]) if (lid) { lid.userData.restX ??= lid.rotation.x; lid.rotation.x = lid.userData.restX * open; }
  // Fin veins fill one by one with the Gout charge (the light climbs each vein from its root), then breathe.
  const ready = c >= 1 ? 1 : 0; st.ready += (ready - st.ready) * ease(ready ? 5 : 14);
  for (let i = 0; i < 3; i++) {
    const vein = parts[`FinVein_${i + 1}`]; if (!vein) continue;
    const target = THREE.MathUtils.clamp(c * 3 - i, 0, 1);
    st.veins[i] += (target - st.veins[i]) * ease(target >= st.veins[i] ? 10 : 30);   // fills steadily, drains at once
    const v = st.veins[i], breathe = 1 + st.ready * .16 * Math.sin(time * 4.2 - i * .9);
    vein.visible = v > .02; vein.scale.set(breathe, breathe, Math.max(.02, v));
  }
  // Nostril flames: lit while Gout is ready, flickering, and blown out by the Gout itself.
  for (const [i, flame] of [parts.NostrilFlame_L, parts.NostrilFlame_R].entries()) if (flame) {
    const lit = st.ready * (1 - k), flick = .75 + .25 * Math.sin(time * 23 + i * 2.1) * Math.sin(time * 7.7 + i);
    flame.visible = lit > .03; flame.scale.set(lit * (.85 + .15 * flick), lit * (.85 + .15 * flick), lit * flick * (1 + .4 * s));
  }
}
