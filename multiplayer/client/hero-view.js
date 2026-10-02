import * as THREE from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {setWeaponGrip, updateWeaponPresentation} from './asset-pose.js';

// Remote Hero body (opus-player-character). Presentation only: reads snapshot
// position/yaw/role/hp/tool/head/hands and attributed events, never writes input, physics or network state.
// Model contract: metres, +Y up, -Z forward, feet at origin, 1.75 m tall.
export const HERO_PALETTES = Object.freeze({
  emberwright: {HeroSkin: 0xd9a07a, HeroHair: 0x4a2c1c, HeroCloth: 0x9a3b2a, HeroTrim: 0xc9a25a, HeroLeather: 0x5b3a24, HeroMetal: 0x9a958a},
  mosswarden: {HeroSkin: 0xa8714f, HeroHair: 0x231c18, HeroCloth: 0x3f6b4f, HeroTrim: 0xd6c8a2, HeroLeather: 0x6e4a2c, HeroMetal: 0xb08d57},
});
// glTF names "Hand.L" etc.; three's GLTFLoader strips the dot ("HandL").
export const HERO_SOCKETS = Object.freeze({head: 'Head', handL: 'Hand.L', handR: 'Hand.R', weaponGrip: 'WeaponGrip', weaponGripL: 'WeaponGrip.L'});
// Locomotion is *derived* from observed root motion; clip native speeds are authored stride speeds.
export const HERO_LOCOMOTION = Object.freeze({moveThreshold: .25, walkSpeed: 1.6, runSpeed: 4.2, runBlendStart: 2.6, runBlendEnd: 3.8, smoothing: 10});
export const HERO_LOD_DISTANCE = 16;
// Remote equipment. Same canonical asset-pose contract as the local XR weapon (setWeaponGrip(visual, true, tool)),
// re-expressed in the authored WeaponGrip socket frame. Bow is a left-hand weapon locally, so it is here too.
// 'limb' (held bone) is presented by combat-view's detached part, so the grip stays empty.
export const HERO_WEAPONS = Object.freeze({tools: ['axe', 'pick', 'hammer', 'crossbow', 'bow', 'wyrmspout', 'flask'], leftHand: ['bow'], none: ['limb'], melee: ['axe', 'pick', 'hammer', 'limb']});
// Bounded VR body: the neck carries part of the head turn; the torso lags but never more than torsoLag behind.
export const HERO_HEADLOOK = Object.freeze({yaw: 1.2, pitchUp: .6, pitchDown: .8, roll: .35, neckShare: .4, torsoLag: .75, torsoRate: 4, movingTorsoRate: 10});
export const HERO_CROUCH = Object.freeze({deadband: .04, maxDrop: .45, lean: .28, rate: 10});
// Authoritative swing evidence: attributed strike results (event.by) and specials. Air swings emit nothing.
export const HERO_ATTACK_EVIDENCE = Object.freeze({strike: ['hit', 'wood_hit', 'stone_hit'], special: ['hammer_slam', 'pick_burst', 'axe_cleave'], reach: 3.6, debounce: .35, strikeFrame: 8 / 24});

export function heroSocket(root, name) {
  return root.getObjectByName(name) || root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
}
export function heroVariant(id) {
  const names = Object.keys(HERO_PALETTES);
  let h = 2166136261; for (const c of String(id ?? '')) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return names[(h >>> 0) % names.length];
}

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _s = new THREE.Vector3(), _e = new THREE.Vector3(), _t = new THREE.Vector3(), _pole = new THREE.Vector3(), _euler = new THREE.Euler();
const _S = new THREE.Vector3(), _F = new THREE.Vector3(), _P = new THREE.Vector3(), _dir = new THREE.Vector3(), _perp = new THREE.Vector3(), _mid = new THREE.Vector3(), _wrist = new THREE.Vector3();
const _want = new THREE.Quaternion(), _feet = [new THREE.Vector3(), new THREE.Vector3()], _feetQ = [new THREE.Quaternion(), new THREE.Quaternion()];
// Tracked grip -Z (pointing) maps to socket +Y (haft): socket = grip * GRIP_TO_SOCKET.
export const GRIP_TO_SOCKET = Object.freeze(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
const SOCKET_TO_GRIP = GRIP_TO_SOCKET.clone().invert();

/** Pose a canonical weapon visual in a WeaponGrip socket exactly as the local XR hand holds it. */
export function poseRemoteWeapon(visual, tool) {
  setWeaponGrip(visual, true, tool);                 // grip-space pose: the local XR contract, incl. the melee -45 deg tilt
  visual.quaternion.premultiply(SOCKET_TO_GRIP);     // re-express in socket space (grip = socket * SOCKET_TO_GRIP)
  return visual;
}

/**
 * resolveWeapon(tool) -> fresh canonical visual (prepareAsset clone sharing template geometry/materials) or null
 * while the template is not loaded. The view never disposes template GPU resources; it only disposes what
 * updateWeaponPresentation itself allocates per visual (the bowstring line).
 */
export function createHeroView({lodDistance = HERO_LOD_DISTANCE, resolveWeapon = null, onWarning = null} = {}) {
  let template = null, clips = null, eyeHeight = 1.645;
  const materials = new Map(), live = new Set(), warned = new Set();

  function install(gltf) {
    if (template) return;
    template = gltf; clips = new Map(gltf.animations.map(c => [c.name, c]));
    for (const name of Object.keys(HERO_PALETTES)) {
      const set = new Map();
      gltf.scene.traverse(n => { if (n.material && !set.has(n.material.name)) {
        const m = n.material.clone(); const hex = HERO_PALETTES[name][m.name]; if (hex !== undefined) m.color.setHex(hex);
        set.set(m.name, m);
      } });
      materials.set(name, set);
    }
    gltf.scene.updateMatrixWorld(true);
    const head = heroSocket(gltf.scene, HERO_SOCKETS.head); if (head) eyeHeight = head.getWorldPosition(_v).y;
  }

  function create(data = {}, {variant = heroVariant(data.id), firstPerson = false} = {}) {
    if (!template) return null;
    const model = clone(template.scene), set = materials.get(variant) || materials.values().next().value;
    model.traverse(n => { if (n.material) n.material = set.get(n.material.name) || n.material; });   // shadow policy stays with the caller (orchard.enableShadowCasting on the template)
    const high = ['HeroBody', 'HeroHead'].map(n => model.getObjectByName(n)).filter(Boolean);
    const low = model.getObjectByName('HeroBody_LOD');
    const head = heroSocket(model, HERO_SOCKETS.head);
    const bones = {}; model.traverse(n => { if (n.isBone) bones[n.name] = n; });
    // Procedural layers (IK, crouch, head look) write bones that clips may not key; restore before each mixer pass.
    const rest = Object.values(bones).map(b => [b, b.position.clone(), b.quaternion.clone()]);
    const mixer = new THREE.AnimationMixer(model), actions = {};
    for (const [name, clip] of clips) {
      const a = actions[name] = mixer.clipAction(clip);
      if (name === 'Attack' || name === 'Hit') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false; }
    }
    for (const n of ['Idle', 'Walk', 'Run']) if (actions[n]) { actions[n].play(); actions[n].setEffectiveWeight(n === 'Idle' ? 1 : 0); }
    const group = new THREE.Group(); group.name = 'HeroView'; group.add(model);
    const sockets = {R: heroSocket(model, HERO_SOCKETS.weaponGrip), L: heroSocket(model, HERO_SOCKETS.weaponGripL)};
    // `placeholder:false` keeps game.js disposePlaceholder() away from shared GPU resources.
    group.userData = {hero: true, placeholder: false, variant, model, high, low, head, bones, rest, posed: false, sockets, heroMixer: mixer, heroActions: actions,
      speed: 0, last: null, hp: data.hp, lod: false, firstPerson, clock: 0, attackAt: -Infinity, embedAt: -Infinity, recoil: 0,
      weapons: new Map(), weapon: null, weaponTool: null, crouch: 0, torsoYaw: null};
    if (firstPerson) setFirstPerson(group, true);
    setLod(group, false);
    live.add(group);
    return group;
  }

  // Local body (if ever shown): the head mesh must never render to its own camera.
  function setFirstPerson(group, on) {
    const u = group.userData; u.firstPerson = on;
    const head = u.model.getObjectByName('HeroHead'); if (head) head.visible = !on && !u.lod;
  }
  function setLod(group, lod) {
    const u = group.userData; u.lod = lod;
    for (const m of u.high) m.visible = !lod && !(u.firstPerson && m.name === 'HeroHead');
    if (u.low) u.low.visible = lod;
  }

  // ---- equipment ------------------------------------------------------------------------------------------
  function weaponFor(u, tool) {
    if (u.weapons.has(tool)) return u.weapons.get(tool);
    if (!resolveWeapon || warned.has(tool)) return null;
    let visual = null;
    try { visual = resolveWeapon(tool); }
    catch (error) { warned.add(tool); onWarning?.(`Remote ${tool} unavailable (${error.message || error}).`); return null; }
    if (!visual) return null;                          // template still loading: retried next frame (a Map lookup)
    visual.name = `RemoteWeapon:${tool}`; visual.userData.remoteWeapon = tool;
    poseRemoteWeapon(visual, tool);
    if (tool === 'bow' || tool === 'crossbow') updateWeaponPresentation(visual, tool, {draw: 0, recoil: 0});   // strung bow / cocked crossbow
    u.weapons.set(tool, visual);
    return visual;
  }
  function syncWeapon(u, data) {
    const tool = data.role === undefined || data.role === 'hero' ? data.tool : null;
    const want = HERO_WEAPONS.tools.includes(tool) ? tool : null;
    if (want === u.weaponTool && (u.weapon || !want)) return;
    const visual = want ? weaponFor(u, want) : null;
    if (want && !visual && want === u.weaponTool) return;
    u.weapon?.removeFromParent(); u.weapon = null; u.weaponTool = want; u.recoil = 0;
    if (!visual) return;
    const socket = u.sockets[HERO_WEAPONS.leftHand.includes(want) ? 'L' : 'R'] || u.sockets.R;
    if (!socket) return;
    socket.add(visual); u.weapon = visual;
  }
  function disposeOwned(visual) {    // only per-visual allocations; template geometry/materials are shared
    const line = visual.userData.bowstring;
    if (line) { line.geometry.dispose(); line.material.dispose(); line.removeFromParent(); visual.userData.bowstring = null; }
    visual.removeFromParent();
  }

  /** Attributed authoritative event for this hero (event.by === its player id). Returns the reaction or null. */
  function event(group, ev, data = {}) {
    const u = group?.userData; if (!u?.hero || !ev) return null;
    if (ev.kind === 'embed') { u.embedAt = u.clock; return null; }        // same-frame hits are a projectile contact relayed by the host
    if (ev.kind === 'shoot' && ['bow', 'crossbow'].includes(ev.weapon)) { u.recoil = 1; return 'recoil'; }
    const special = HERO_ATTACK_EVIDENCE.special.includes(ev.kind), strike = HERO_ATTACK_EVIDENCE.strike.includes(ev.kind);
    if (!special && !strike) return null;
    const tool = data.tool ?? u.weaponTool;
    if (!HERO_WEAPONS.melee.includes(tool) || u.embedAt === u.clock) return null;
    if (strike && ev.position && Array.isArray(data.position)) {
      const d = Math.hypot(ev.position[0] - data.position[0], ev.position[2] - data.position[2]);
      if (!(d <= HERO_ATTACK_EVIDENCE.reach)) return null;               // too far for this hero's own strike
    }
    if (u.clock - u.attackAt < HERO_ATTACK_EVIDENCE.debounce) return null;   // one strike, many result events
    const a = u.heroActions.Attack; if (!a) return null;
    u.attackAt = u.clock;
    a.reset().setEffectiveWeight(1).fadeIn(special ? .06 : .03).play();
    if (strike) a.time = HERO_ATTACK_EVIDENCE.strikeFrame;                  // the event is post-contact: show strike + recovery, not a late wind-up
    return special ? 'special' : 'strike';
  }

  // ---- body -----------------------------------------------------------------------------------------------
  function locomotion(u, root, dt) {
    const p = root.getWorldPosition(_v);
    if (u.last) { const d = Math.hypot(p.x - u.last.x, p.z - u.last.z) / Math.max(dt, 1e-3);
      u.speed += (Math.min(d, 9) - u.speed) * (1 - Math.exp(-dt * HERO_LOCOMOTION.smoothing)); }
    (u.last ||= new THREE.Vector3()).copy(p);
    const L = HERO_LOCOMOTION, a = u.heroActions, s = u.speed;
    const move = THREE.MathUtils.smoothstep(s, L.moveThreshold * .6, L.moveThreshold * 1.6);
    const run = THREE.MathUtils.smoothstep(s, L.runBlendStart, L.runBlendEnd);
    a.Idle?.setEffectiveWeight(1 - move); a.Walk?.setEffectiveWeight(move * (1 - run)); a.Run?.setEffectiveWeight(move * run);
    if (a.Walk) a.Walk.timeScale = THREE.MathUtils.clamp(s / L.walkSpeed, .6, 1.6);
    if (a.Run) a.Run.timeScale = THREE.MathUtils.clamp(s / L.runSpeed, .7, 1.4);
  }

  /** Play a one-shot authored clip ('Attack' | 'Hit'). Only call from authoritative evidence. */
  function trigger(group, name) {
    const a = group?.userData.heroActions?.[name]; if (!a) return false;
    a.reset().setEffectiveWeight(1).fadeIn(.06).play(); return true;
  }

  function setWorldQuaternion(bone, q) { bone.parent.getWorldQuaternion(_q3).invert(); bone.quaternion.copy(_q3.multiply(q)); bone.updateMatrixWorld(true); }
  function aimBone(bone, child, target) {
    bone.getWorldPosition(_s); child.getWorldPosition(_e);
    _q.setFromUnitVectors(_w.subVectors(_e, _s).normalize(), _t.subVectors(target, _s).normalize());
    bone.getWorldQuaternion(_q2); _q2.premultiply(_q); setWorldQuaternion(bone, _q2);
  }
  // Rigid two-bone chain (shoulder/elbow or hip/knee) reaching `end`, bending toward world-space `pole`.
  function twoBone(upper, middle, last, end, pole) {
    upper.getWorldPosition(_S); middle.getWorldPosition(_F); last.getWorldPosition(_P);
    const a = _S.distanceTo(_F), b = _F.distanceTo(_P); _dir.subVectors(end, _S);
    const d = THREE.MathUtils.clamp(_dir.length(), .05, a + b - 1e-3); _dir.normalize();
    const cos = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
    _perp.copy(pole).addScaledVector(_dir, -pole.dot(_dir)).normalize();
    _mid.copy(_S).addScaledVector(_dir, a * cos).addScaledVector(_perp, a * Math.sqrt(1 - cos * cos));
    const target = end.clone();                       // aimBone reuses the _s/_e/_t scratch vectors
    aimBone(upper, middle, _mid.clone()); aimBone(middle, last, target);
  }
  // Arm reach toward a tracked controller (presentation-only); the palm takes the tracked grip orientation.
  function reach(u, side, pose, root) {
    const up = u.bones[`UpperArm${side}`], fore = u.bones[`Forearm${side}`], palm = u.bones[`Palm${side}`];
    const grip = u.sockets[side];
    if (!up || !fore || !palm || !grip) return;
    const target = _t.fromArray(pose.position); root.localToWorld(target);
    root.getWorldQuaternion(_q2); _want.fromArray(pose.quaternion).premultiply(_q2).multiply(GRIP_TO_SOCKET);
    _want.multiply(_q.copy(grip.quaternion).invert());                       // palm world orientation
    _wrist.copy(target).sub(_v.copy(grip.position).applyQuaternion(_want));
    _pole.set(side === 'L' ? -.4 : .4, -1, .3).applyQuaternion(u.model.getWorldQuaternion(_q2));
    twoBone(up, fore, palm, _wrist, _pole);
    setWorldQuaternion(palm, _want);
  }
  // Rotation by `amount` of the model-local rotation `local`, applied in world space to `bone`.
  function turnBone(bone, local, amount, modelQ) {
    if (!bone) return;
    _q.identity().slerp(local, amount); _q.premultiply(modelQ).multiply(_q2.copy(modelQ).invert());
    bone.getWorldQuaternion(_q2).premultiply(_q); setWorldQuaternion(bone, _q2);
  }

  // VR remote: the torso follows the tracked head yaw with lag; the neck/skull carry the remainder (bounded).
  function placeBody(u, data, root, dt) {
    _q.fromArray(data.head.quaternion); _w.set(0, 0, -1).applyQuaternion(_q);
    const headYaw = Math.atan2(-_w.x, -_w.z), H = HERO_HEADLOOK;
    if (u.torsoYaw === null) u.torsoYaw = headYaw;
    const rate = u.speed > HERO_LOCOMOTION.moveThreshold ? H.movingTorsoRate : H.torsoRate;
    let diff = Math.atan2(Math.sin(headYaw - u.torsoYaw), Math.cos(headYaw - u.torsoYaw));
    u.torsoYaw += diff * (1 - Math.exp(-dt * rate));
    diff = Math.atan2(Math.sin(headYaw - u.torsoYaw), Math.cos(headYaw - u.torsoYaw));
    if (Math.abs(diff) > H.torsoLag) u.torsoYaw = headYaw - Math.sign(diff) * H.torsoLag;
    const r = u.model.rotation.y = u.torsoYaw, h = data.head.position;
    u.model.position.set(h[0] - Math.sin(r) * .06, 0, h[2] - Math.cos(r) * .06);   // feet stay at the root's ground height
    const drop = THREE.MathUtils.clamp(eyeHeight - h[1] - HERO_CROUCH.deadband, 0, HERO_CROUCH.maxDrop);
    u.crouch += (drop - u.crouch) * (1 - Math.exp(-dt * HERO_CROUCH.rate));
  }
  function crouch(u) {
    const hips = u.bones.Hips, c = u.crouch; if (!hips || c < 1e-3) return;
    const legs = ['L', 'R'].map(s => [u.bones[`UpperLeg${s}`], u.bones[`LowerLeg${s}`], u.bones[`Foot${s}`]]);
    legs.forEach(([, , f], i) => { if (f) { f.getWorldPosition(_feet[i]); f.getWorldQuaternion(_feetQ[i]); } });
    hips.getWorldPosition(_v); _v.y -= c; hips.parent.worldToLocal(_v); hips.position.copy(_v); hips.updateMatrixWorld(true);
    const modelQ = u.model.getWorldQuaternion(new THREE.Quaternion());
    turnBone(u.bones.Spine, new THREE.Quaternion().setFromAxisAngle(_w.set(1, 0, 0), -HERO_CROUCH.lean * c / HERO_CROUCH.maxDrop), 1, modelQ);
    legs.forEach(([up, low, foot], i) => { if (!up || !low || !foot) return;
      _pole.set(i ? .15 : -.15, 0, -1).applyQuaternion(modelQ);                // knees forward, slightly out
      twoBone(up, low, foot, _feet[i], _pole); setWorldQuaternion(foot, _feetQ[i]); });
  }
  function headLook(u, data, root) {
    const H = HERO_HEADLOOK, modelQ = u.model.getWorldQuaternion(new THREE.Quaternion());
    root.getWorldQuaternion(_q2); _q.fromArray(data.head.quaternion).premultiply(_q2);   // tracked head in world (root yaw is zeroed for VR)
    _q.premultiply(_q2.copy(modelQ).invert());                                          // relative to the torso facing
    _euler.setFromQuaternion(_q, 'YXZ');
    const lean = -HERO_CROUCH.lean * u.crouch / HERO_CROUCH.maxDrop;                     // spine lean already pitched the head
    _euler.set(THREE.MathUtils.clamp(_euler.x - lean, -H.pitchDown, H.pitchUp), THREE.MathUtils.clamp(_euler.y, -H.yaw, H.yaw),
      THREE.MathUtils.clamp(_euler.z, -H.roll, H.roll), 'YXZ');
    const local = new THREE.Quaternion().setFromEuler(_euler);
    turnBone(u.bones.Neck, local, H.neckShare, modelQ);
    turnBone(u.bones.Skull, local, 1 - H.neckShare, modelQ);
    u.look = {yaw: _euler.y, pitch: _euler.x, roll: _euler.z};
  }

  /** Per frame. root: game actor root (position/yaw already applied by game.js). */
  function update(group, data, root, dt, cameraPosition) {
    const u = group.userData; u.clock += dt;
    if (cameraPosition) { const far = root.getWorldPosition(_v).distanceToSquared(cameraPosition) > lodDistance * lodDistance; if (far !== u.lod) setLod(group, far); }
    if (data.hp !== undefined && u.hp !== undefined && data.hp < u.hp) trigger(group, 'Hit');   // derived from authoritative HP drop
    u.hp = data.hp;
    syncWeapon(u, data);
    if (u.weapon) u.weapon.visible = !(u.lod && cameraPosition && root.getWorldPosition(_v).distanceToSquared(cameraPosition) > 4 * lodDistance * lodDistance);
    if (u.recoil > 0) { u.recoil = Math.max(0, u.recoil - dt * 1.4);
      if (u.weaponTool === 'crossbow' && u.weapon) updateWeaponPresentation(u.weapon, 'crossbow', {recoil: u.recoil, time: u.clock}); }
    if (data.head) placeBody(u, data, root, dt);
    else { u.torsoYaw = null; u.crouch = 0; u.look = null; if (u.model.rotation.y || u.model.position.x || u.model.position.z) { u.model.rotation.y = 0; u.model.position.set(0, 0, 0); } }
    locomotion(u, u.model, dt);
    if (u.posed) { for (const [b, p, q] of u.rest) { b.position.copy(p); b.quaternion.copy(q); } u.posed = false; }
    u.heroMixer.update(dt);
    if (data.head) { u.model.updateMatrixWorld(true); u.posed = true;
      crouch(u);                                                                 // feet pinned, hips lowered: before the arms
      if (data.hands?.[0]) reach(u, 'L', data.hands[0], root);                    // hands[0] = left, hands[1] = right (game.js order)
      if (data.hands?.[1]) reach(u, 'R', data.hands[1], root);
      headLook(u, data, root); }
  }

  function release(group) {
    if (!group?.userData.hero) return;
    const u = group.userData;
    for (const visual of u.weapons.values()) disposeOwned(visual);
    u.weapons.clear(); u.weapon = null; u.weaponTool = null;
    const m = u.heroMixer; m.stopAllAction(); m.uncacheRoot(u.model);
    group.traverse(n => n.skeleton?.dispose()); group.removeFromParent(); live.delete(group);
  }
  function dispose() {
    for (const g of [...live]) release(g);
    const geo = new Set(), tex = new Set();
    template?.scene.traverse(n => { n.geometry && geo.add(n.geometry); });
    for (const set of materials.values()) for (const m of set.values()) { for (const v of Object.values(m)) if (v?.isTexture) tex.add(v); m.dispose(); }
    template?.scene.traverse(n => { const ms = Array.isArray(n.material) ? n.material : n.material ? [n.material] : []; ms.forEach(m => m.dispose()); });
    geo.forEach(g => g.dispose()); tex.forEach(t => t.dispose()); materials.clear(); template = null;
  }
  return {install, ready: () => !!template, create, update, trigger, event, release, setFirstPerson, setLod, dispose,
    stats: () => ({live: live.size, materials: [...materials.values()].reduce((n, s) => n + s.size, 0),
      equipped: [...live].map(g => g.userData.weapon?.userData.remoteWeapon || null),
      weapons: [...live].reduce((n, g) => n + g.userData.weapons.size, 0), attached: [...live].filter(g => g.userData.weapon).length})};
}
