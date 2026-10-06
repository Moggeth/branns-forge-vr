// Stormspire presentation: the authored tower (assets-source/stormreel), its glowing charge column, the crystal
// capacitor in the hat, crackling arcs when it is full, and the reel pack hanging on its hook between uses.
// Reads authoritative structure data only (charge 0..240, operator); writes nothing back.
import * as THREE from 'three';
import {STORMREEL} from '../shared/stormreel.js';

const GLOW_NAMES = ['Charge', 'CrystalCore', 'Crystal', 'Window'];
export function createStormspireArt({lightning = null} = {}) {
  let tower = null, pack = null;
  const live = new Set(), v = new THREE.Vector3(), w = new THREE.Vector3();
  function install(gltf) { tower = gltf; for (const e of live) attach(e); }
  function installPack(gltf) { pack = gltf; for (const e of live) attachPack(e); }
  /** Per-tower glow materials, so one tower's charge never lights another (two or three towers at most). */
  function ownMaterials(root) {
    const own = new Map(), glow = [];
    root.traverse(n => {
      if (!n.isMesh) return;
      const m = n.material; if (!m || !GLOW_NAMES.includes(m.name)) return;
      if (!own.has(m)) { const c = m.clone(); c.userData.base = m.emissiveIntensity ?? 1; own.set(m, c); glow.push(c); }
      n.material = own.get(m);
    });
    return glow;
  }
  function attach(e) {
    live.add(e);
    if (!tower || e.spire) return;
    const root = tower.scene.clone(true); root.name = 'Stormspire';
    root.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; n.userData.targetId = e.data.id; } });
    const nodes = {}; root.traverse(n => { if (n.name) nodes[n.name] = n; });
    const glow = ownMaterials(root);
    for (const c of e.root.children) c.visible = false;   // the code-built stand-in
    e.root.add(root);
    e.spire = {root, nodes, glow, shown: e.data.charge || 0, arcAt: 0, flash: 0, hang: null};
    attachPack(e);
  }
  function attachPack(e) {
    if (!pack || !e.spire || e.spire.hang) return;
    const hang = pack.scene.clone(true); hang.name = 'HangingReelPack';
    hang.traverse(n => { if (n.isMesh) { n.castShadow = true; n.userData.targetId = e.data.id; } });
    // The pack's back faces the tower; its hang point sits on the hook.
    const hook = e.spire.nodes.PackHook, hp = hang.getObjectByName('HangPoint');
    hang.rotation.y = Math.PI / 2; hang.updateMatrixWorld(true);
    const off = hp ? hp.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
    hang.position.copy(hook.position).sub(off);
    e.spire.root.add(hang); e.spire.hang = hang;
  }
  function detach(e) { live.delete(e); e.spire?.root.removeFromParent(); for (const m of e.spire?.glow || []) m.dispose(); e.spire = null; }
  /** Where a cable leaves the tower, world space (falls back to the shared constant before the model loads). */
  function terminal(e, out = new THREE.Vector3()) {
    const n = e.spire?.nodes.CableTerminal; if (!n) return null;
    return n.getWorldPosition(out);
  }
  function hookPoint(e, out = new THREE.Vector3()) { return e.spire?.nodes.PackHook?.getWorldPosition(out) || null; }
  /** Presentation pulse when Crystal or a God's bolt charges it. */
  function charged(e, {lightning: fromSky = false} = {}) {
    if (!e.spire) return; e.spire.flash = 1;
    const top = e.spire.nodes.Capacitor?.getWorldPosition(new THREE.Vector3()), hop = e.spire.nodes.Hopper?.getWorldPosition(new THREE.Vector3());
    if (!lightning || !top) return;
    if (fromSky) { lightning.glow(top, {size: 5, life: .6}); lightning.burst(top, {count: 40, speed: 6}); }
    else if (hop) {   // a little arc climbs from the hopper up the charge column
      const col = e.spire.nodes.ChargeColumn?.getWorldPosition(new THREE.Vector3());
      lightning.strike(hop, col || top, {life: .35, width: .05, branches: 1});
      lightning.burst(hop, {count: 14, speed: 2});
    }
  }
  function animate(e, time, dt) {
    const s = e.spire; if (!s) return;
    const b = e.data, target = Math.max(0, Math.min(1, (b.charge || 0) / STORMREEL.maxCharge));
    s.shown += (target * STORMREEL.maxCharge - s.shown) * Math.min(1, dt * 4);   // drains and fills smoothly between snapshots
    const fill = s.shown / STORMREEL.maxCharge;
    const core = s.nodes.ChargeColumn_Core; if (core) { core.scale.y = Math.max(.02, fill); core.visible = fill > .01; }
    s.flash = Math.max(0, s.flash - dt * 1.5);
    const hum = .55 + .45 * Math.sin(time * 3.1) * Math.sin(time * 1.7 + 1);
    for (const m of s.glow) {
      const base = m.userData.base;
      if (m.name === 'CrystalCore') m.emissiveIntensity = base * (.25 + 1.6 * fill * (.8 + .2 * hum) + 2 * s.flash);
      else if (m.name === 'Charge') m.emissiveIntensity = base * (.6 + .4 * hum + 1.5 * s.flash);
      else if (m.name === 'Window') m.emissiveIntensity = base * (.4 + .8 * fill);
    }
    if (s.nodes.Capacitor_Crystal) s.nodes.Capacitor_Crystal.rotation.y = time * .4;
    if (s.hang) s.hang.visible = !b.operator && !e.packAway;
    // Full and idle: little arcs leap between the torus brim and the hat tip.
    if (lightning && fill > .66 && b.hp > 0) {
      s.arcAt -= dt;
      if (s.arcAt <= 0) {
        s.arcAt = .5 + Math.random() * (2.4 - 1.6 * fill);
        const top = s.nodes.TopLoad, cap = s.nodes.Capacitor;
        if (top && cap) {
          top.getWorldPosition(v); const a = Math.random() * Math.PI * 2;
          const yaw = e.root.rotation.y, r = 1.12;
          v.x += Math.cos(a + yaw) * r; v.z -= Math.sin(a + yaw) * r;
          cap.getWorldPosition(w);
          lightning.strike(v, w, {life: .18 + Math.random() * .12, width: .06, branches: 1, restrikes: 1, intensity: .8});
        }
      }
    }
  }
  return {install, installPack, ready: () => !!tower, attach, detach, animate, charged, terminal, hookPoint,
    packTemplate: () => pack, stats: () => ({towers: live.size, model: !!tower, pack: !!pack})};
}
