import * as THREE from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';

// Remote Hero body (opus-player-character). Presentation only: reads snapshot
// position/yaw/role/hp/head/hands, never writes input, physics or network state.
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

export function heroSocket(root, name) {
  return root.getObjectByName(name) || root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
}
export function heroVariant(id) {
  const names = Object.keys(HERO_PALETTES);
  let h = 2166136261; for (const c of String(id ?? '')) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return names[(h >>> 0) % names.length];
}

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _s = new THREE.Vector3(), _e = new THREE.Vector3(), _t = new THREE.Vector3(), _pole = new THREE.Vector3();
const GRIP_TO_SOCKET = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

export function createHeroView({lodDistance = HERO_LOD_DISTANCE} = {}) {
  let template = null, clips = null;
  const materials = new Map(), live = new Set();

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
  }

  function create(data = {}, {variant = heroVariant(data.id), firstPerson = false} = {}) {
    if (!template) return null;
    const model = clone(template.scene), set = materials.get(variant) || materials.values().next().value;
    model.traverse(n => { if (n.material) n.material = set.get(n.material.name) || n.material; });   // shadow policy stays with the caller (orchard.enableShadowCasting on the template)
    const high = ['HeroBody', 'HeroHead'].map(n => model.getObjectByName(n)).filter(Boolean);
    const low = model.getObjectByName('HeroBody_LOD');
    const head = heroSocket(model, HERO_SOCKETS.head);
    const bones = {}; model.traverse(n => { if (n.isBone) bones[n.name] = n; });
    const mixer = new THREE.AnimationMixer(model), actions = {};
    for (const [name, clip] of clips) {
      const a = actions[name] = mixer.clipAction(clip);
      if (name === 'Attack' || name === 'Hit') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false; }
    }
    for (const n of ['Idle', 'Walk', 'Run']) if (actions[n]) { actions[n].play(); actions[n].setEffectiveWeight(n === 'Idle' ? 1 : 0); }
    const group = new THREE.Group(); group.name = 'HeroView'; group.add(model);
    // `placeholder:false` keeps game.js disposePlaceholder() away from shared GPU resources.
    group.userData = {hero: true, placeholder: false, variant, model, high, low, head, bones, heroMixer: mixer, heroActions: actions,
      speed: 0, last: null, hp: data.hp, lod: false, firstPerson};
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

  function aimBone(bone, child, target) {
    bone.getWorldPosition(_s); child.getWorldPosition(_e);
    _q.setFromUnitVectors(_w.subVectors(_e, _s).normalize(), _t.subVectors(target, _s).normalize());
    bone.getWorldQuaternion(_q2); _q2.premultiply(_q);
    bone.parent.getWorldQuaternion(_q).invert(); bone.quaternion.copy(_q.multiply(_q2)); bone.updateMatrixWorld(true);
  }
  // Rigid two-bone arm reach toward a tracked controller (presentation-only).
  function reach(u, side, pose, root) {
    const up = u.bones[`UpperArm${side}`], fore = u.bones[`Forearm${side}`], palm = u.bones[`Palm${side}`];
    const grip = heroSocket(u.model, side === 'L' ? HERO_SOCKETS.weaponGripL : HERO_SOCKETS.weaponGrip);
    if (!up || !fore || !palm || !grip) return;
    const target = _t.fromArray(pose.position); root.localToWorld(target);
    const want = new THREE.Quaternion().fromArray(pose.quaternion).multiply(GRIP_TO_SOCKET);
    want.multiply(_q.copy(grip.quaternion).invert());                       // palm world orientation
    const wrist = target.clone().sub(grip.position.clone().applyQuaternion(want));
    const S = up.getWorldPosition(new THREE.Vector3()), F = fore.getWorldPosition(new THREE.Vector3()), P = palm.getWorldPosition(new THREE.Vector3());
    const a = S.distanceTo(F), b = F.distanceTo(P), dir = wrist.clone().sub(S); const d = THREE.MathUtils.clamp(dir.length(), .05, a + b - 1e-3); dir.normalize();
    const cos = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
    _pole.set(side === 'L' ? -.4 : .4, -1, .3).applyQuaternion(u.model.getWorldQuaternion(_q2));
    const perp = _pole.sub(dir.clone().multiplyScalar(_pole.dot(dir))).normalize();
    const elbow = S.clone().addScaledVector(dir, a * cos).addScaledVector(perp, a * Math.sqrt(1 - cos * cos));
    aimBone(up, fore, elbow); aimBone(fore, palm, wrist);
    palm.parent.getWorldQuaternion(_q).invert(); palm.quaternion.copy(_q.multiply(want)); palm.updateMatrixWorld(true);
  }

  /** Per frame. root: game actor root (position/yaw already applied by game.js). */
  function update(group, data, root, dt, cameraPosition) {
    const u = group.userData;
    if (cameraPosition) { const far = root.getWorldPosition(_v).distanceToSquared(cameraPosition) > lodDistance * lodDistance; if (far !== u.lod) setLod(group, far); }
    if (data.hp !== undefined && u.hp !== undefined && data.hp < u.hp) trigger(group, 'Hit');   // derived from authoritative HP drop
    u.hp = data.hp;
    if (data.head) {   // VR remote: game zeroes root yaw; face the tracked head and stand under it.
      _q.fromArray(data.head.quaternion); _w.set(0, 0, -1).applyQuaternion(_q);
      const yaw = Math.atan2(-_w.x, -_w.z), cur = u.model.rotation.y;
      u.model.rotation.y = cur + Math.atan2(Math.sin(yaw - cur), Math.cos(yaw - cur)) * (1 - Math.exp(-dt * 10));
      const h = data.head.position, r = u.model.rotation.y;
      u.model.position.set(h[0] - Math.sin(r) * .06, 0, h[2] - Math.cos(r) * .06);
    } else if (u.model.rotation.y || u.model.position.x || u.model.position.z) { u.model.rotation.y = 0; u.model.position.set(0, 0, 0); }
    locomotion(u, u.model, dt);
    u.heroMixer.update(dt);
    if (data.head) { u.model.updateMatrixWorld(true);   // hands[0] = left, hands[1] = right (game.js order)
      if (data.hands?.[0]) reach(u, 'L', data.hands[0], root);
      if (data.hands?.[1]) reach(u, 'R', data.hands[1], root); }
  }

  function release(group) {
    if (!group?.userData.hero) return;
    const m = group.userData.heroMixer; m.stopAllAction(); m.uncacheRoot(group.userData.model);
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
  return {install, ready: () => !!template, create, update, trigger, release, setFirstPerson, setLod, dispose,
    stats: () => ({live: live.size, materials: [...materials.values()].reduce((n, s) => n + s.size, 0)})};
}
