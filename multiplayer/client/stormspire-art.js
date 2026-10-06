// Stormspire presentation: the authored tower (assets-source/stormreel), its glowing charge column, the crystal
// capacitor in the hat, crackling arcs when it is full, and the reel pack hanging on its hook between uses.
// Reads authoritative structure data only (charge 0..240, operator); writes nothing back.
import * as THREE from 'three';
import {STORMREEL} from '../shared/stormreel.js';
import {createLizardCrew} from './stormspire-lizards.js';
import {POLE,MIXED_HUE,glyphTexture,coronaTexture,makeSprite,flicker} from './stormreel-look.js';

const GLOW_NAMES = ['Charge', 'CrystalCore', 'Crystal', 'Window'];
// The two packs: red (+) and blue (-). Their cable, reel windings and lamp take the pack's colour.
export const PACK_COLORS = Object.freeze({red: 0xd8402e, blue: 0x2f74e0});
const tinted = new Map();
export function tintPack(root, pack) {
  root.traverse(n => {
    if (!n.isMesh) return;
    const m = n.material, lamp = n.name === 'Lamp_Glow' || n.parent?.name === 'Lamp_Glow';
    if (!m || !lamp && !['Cable', 'CeramicBlue'].includes(m.name)) return;
    const key = `${m.uuid}:${pack}:${lamp}`;
    if (!tinted.has(key)) {
      const c = m.clone(), hex = PACK_COLORS[pack];
      if (lamp) { c.emissive?.setHex(hex); c.color?.setHex(hex); } else c.color?.setHex(m.name === 'Cable' ? hex : pack === 'red' ? 0xd8463a : 0x5d86c8);
      tinted.set(key, c);
    }
    n.material = tinted.get(key);
  });
  return root;
}
export function createStormspireArt({lightning = null} = {}) {
  let tower = null, pack = null;
  const live = new Set(), v = new THREE.Vector3(), w = new THREE.Vector3();
  const glyphs = {red: glyphTexture('red'), blue: glyphTexture('blue')}, corona = coronaTexture(3);
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
    e.spire = {root, nodes, glow, shown: e.data.charge || 0, arcAt: 0, flash: 0, hang: {red: null, blue: null}, badges: {}, topAt: 0};
    // Polarity badges on the two cable terminals: red (+) on the east face, blue (-) on the west, so the poles read at a glance.
    for (const colour of ['red', 'blue']) {
      const node = nodes[colour === 'blue' ? 'CableTerminal_B' : 'CableTerminal']; if (!node) continue;
      const badge = new THREE.Sprite(new THREE.SpriteMaterial({map: glyphs[colour], transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false}));
      badge.position.set(0, .34, 0); badge.scale.setScalar(.3); badge.renderOrder = 15; badge.raycast = () => {}; node.add(badge);
      const flare = new THREE.Sprite(new THREE.SpriteMaterial({map: corona, color: POLE[colour].glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false}));
      flare.scale.setScalar(.6); flare.renderOrder = 14; flare.raycast = () => {}; node.add(flare); e.spire.badges[colour] = {badge, flare};
    }
    e.spire.crew = createLizardCrew(); root.add(e.spire.crew.group);
    attachPack(e);
  }
  function attachPack(e) {
    if (!pack || !e.spire) return;
    for (const colour of ['red', 'blue']) {
      const hook = e.spire.nodes[colour === 'blue' ? 'PackHook_B' : 'PackHook'];
      if (e.spire.hang[colour] || !hook) continue;
      const hang = tintPack(pack.scene.clone(true), colour); hang.name = `HangingReelPack_${colour}`;
      hang.traverse(n => { if (n.isMesh) { n.castShadow = true; n.userData.targetId = e.data.id; } });
      // The pack's back faces the tower wall; its hang point sits on the hook (east hook for red, west for blue).
      const hp = hang.getObjectByName('HangPoint');
      hang.rotation.y = colour === 'blue' ? -Math.PI / 2 : Math.PI / 2; hang.updateMatrixWorld(true);
      const off = hp ? hp.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
      hang.position.copy(hook.position).sub(off);
      e.spire.root.add(hang); e.spire.hang[colour] = hang;
    }
  }
  function detach(e) {
    live.delete(e); e.spire?.root.removeFromParent(); for (const m of e.spire?.glow || []) m.dispose();
    for (const {badge, flare} of Object.values(e.spire?.badges || {})) { badge.material.dispose(); flare.material.dispose(); }
    e.spire = null;
  }
  /** Where a cable leaves the tower, world space (falls back to the shared constant before the model loads). */
  function terminal(e, out = new THREE.Vector3(), colour = 'red') {
    const n = e.spire?.nodes[colour === 'blue' ? 'CableTerminal_B' : 'CableTerminal']; if (!n) return null;
    return n.getWorldPosition(out);
  }
  function hookPoint(e, out = new THREE.Vector3(), colour = 'red') { return e.spire?.nodes[colour === 'blue' ? 'PackHook_B' : 'PackHook']?.getWorldPosition(out) || null; }
  /** Presentation pulse when Crystal or a God's bolt charges it. */
  function charged(e, {lightning: fromSky = false} = {}) {
    if (!e.spire) return; e.spire.flash = 1; e.spire.crew?.cheer();
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
    const b = e.data, working = !!b.arc, target = Math.max(0, Math.min(1, (b.charge || 0) / STORMREEL.maxCharge));
    s.shown += (target * STORMREEL.maxCharge - s.shown) * Math.min(1, dt * 4);   // drains and fills smoothly between snapshots
    const fill = s.shown / STORMREEL.maxCharge;
    const core = s.nodes.ChargeColumn_Core; if (core) { core.scale.y = Math.max(.02, fill); core.visible = fill > .01; }
    s.flash = Math.max(0, s.flash - dt * 1.5);
    const hum = .55 + .45 * Math.sin(time * 3.1) * Math.sin(time * 1.7 + 1);
    for (const m of s.glow) {
      const base = m.userData.base;
      if (m.name === 'CrystalCore') m.emissiveIntensity = base * (.25 + 1.6 * fill * (.8 + .2 * hum) + 2 * s.flash);
      else if (m.name === 'Charge') m.emissiveIntensity = base * (.6 + .4 * hum + 1.5 * s.flash + (working ? 1.4 : 0));
      else if (m.name === 'Window') m.emissiveIntensity = base * (.4 + .8 * fill);
    }
    if (s.nodes.Capacitor_Crystal) s.nodes.Capacitor_Crystal.rotation.y = time * .4;
    s.crew?.update(time, dt);
    // Terminal badges glow with the flow: faint at idle, hot while a pack is worn or the circuit runs.
    for (const [colour, {badge, flare}] of Object.entries(s.badges)) {
      const worn = !!b[colour === 'red' ? 'operator' : 'operator2'], k = (fill > .02 ? .35 : .12) + (worn ? .3 : 0) + (working ? .45 : 0) + .2 * s.flash;
      badge.material.opacity = Math.min(1, k + .12 * flicker(time, colour === 'red' ? 0 : 2)); flare.material.opacity = Math.min(1, (worn ? .35 : .12) + (working ? .6 : 0) + s.flash * .5);
      flare.scale.setScalar(.5 + .5 * flicker(time * 1.3, colour === 'red' ? 1 : 4) + (working ? .5 : 0)); flare.material.rotation = time * (colour === 'red' ? 1.5 : -1.5);
    }
    // While the circuit runs the whole tower works: streamers leap from the hat into the air and the capacitor roars.
    if (lightning && working && b.hp > 0) {
      s.topAt -= dt;
      if (s.topAt <= 0 && s.nodes.TopLoad) {
        s.topAt = .09 + Math.random() * .16; s.nodes.TopLoad.getWorldPosition(v);
        const a = Math.random() * Math.PI * 2, r = 1.2 + Math.random() * 1.6;
        w.set(v.x + Math.cos(a) * r, v.y + .6 + Math.random() * 2.2, v.z + Math.sin(a) * r);
        lightning.strike(v.clone(), w.clone(), {life: .12, width: .05, rough: .2, depth: 4, branches: 1, restrikes: 1, intensity: 1.1, hue: MIXED_HUE});
      }
    }
    if (s.hang.red) s.hang.red.visible = !b.operator && !e.packAway?.red;
    if (s.hang.blue) s.hang.blue.visible = !b.operator2 && !e.packAway?.blue;
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
