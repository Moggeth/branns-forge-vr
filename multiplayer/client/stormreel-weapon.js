// Local Stormreel handling: hold to charge (the glass capacitor tubes fill and arcs climb the horns), aim preview drawn
// every frame from the local aim, release to fire. The authority resolves the shot (shared/stormreel.js stormShot);
// this file only predicts what the player sees and hears before the result returns.
import * as THREE from 'three';
import {STORMREEL,rayEnemy,rayGround,rayWorld,chargeShots,cableStrain,cableLength,packOf} from '../shared/stormreel.js';
import {POLE,finishCrossbow,glyphTexture,flicker} from './stormreel-look.js';
import './stormreel-hud.css';

export const STORMREEL_FEEL = Object.freeze({chargeSeconds: STORMREEL.chargeTicks / 60, cooldownSeconds: STORMREEL.cooldownTicks / 60, kick: .05});
const COLORS = Object.freeze({circuit: 0x5cc8ff, red: 0xff6a4a, blue: 0x6fb8ff, dead: 0x9aa3ad});
/** The pole your next live bolt lays (shared/stormreel.js layProbe): always your pack's, red (+) or blue (-). */
export function nextProbe(b, id) { return packOf(b, id) || 'red'; }

/**
 * ctx: scene, lightning, send(action, payload), aim() -> {origin, direction}, snapshot(), playerId(), height(x,z),
 *      localPosition() -> Vector3, audio() -> AudioContext|null, now() -> seconds, hud (HTMLElement parent) optional,
 *      sfx (stormreel-audio) optional: charge whine and ready ping
 */
export function createStormreelWeapon(ctx) {
  const {scene, lightning} = ctx;
  let started = null, lastShot = -Infinity, charge = 0, kick = 0, hum = null, idleArc = 0, model = null, nodes = {}, wallFrame = 0, wall = null;
  // Aim preview: a thin line to the predicted contact and a ring where the current would meet the earth.
  const lineGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const lineMat = new THREE.LineDashedMaterial({color: COLORS.circuit, dashSize: .35, gapSize: .25, transparent: true, opacity: .75, depthWrite: false});
  const line = new THREE.Line(lineGeo, lineMat); line.frustumCulled = false; line.visible = false; line.renderOrder = 14;
  const ring = new THREE.Mesh(new THREE.RingGeometry(.32, .4, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({color: COLORS.circuit, transparent: true, opacity: .85, depthWrite: false, side: THREE.DoubleSide}));
  ring.visible = false; ring.renderOrder = 14;
  const step = new THREE.Mesh(new THREE.RingGeometry(STORMREEL.stepRadius - .05, STORMREEL.stepRadius, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({color: COLORS.circuit, transparent: true, opacity: .25, depthWrite: false, side: THREE.DoubleSide}));
  step.visible = false; step.renderOrder = 14;
  for (const o of [line, ring, step]) { o.raycast = () => {}; o.userData.ignoreContact = true; scene.add(o); }
  // Small HUD: stored shots and cable left.
  let hud = null;
  if (typeof document !== 'undefined' && ctx.hud) {
    hud = document.createElement('div'); hud.className = 'stormreel-hud'; hud.hidden = true;
    hud.innerHTML = '<span class="sr-bolt" aria-hidden="true">ϟ</span><span class="sr-pole"></span><span class="sr-shots"></span><span class="sr-probe" title="Next bolt"></span><span class="sr-arc"></span><span class="sr-cable"><i></i></span>';
    ctx.hud.appendChild(hud);
  }
  let hudText = '';

  function tower() {
    const s = ctx.snapshot(), id = ctx.playerId();
    return s?.inventions?.structures?.find(b => b.type === 'stormspire' && (b.operator === id || b.operator2 === id) && b.hp > 0) || null;
  }
  function setModel(m) {
    model = m; nodes = {};
    m?.traverse(n => { if (n.name) nodes[n.name] = n; });
  }
  function begin() {
    if (!tower() || started !== null) return false;
    if (ctx.now() - lastShot < STORMREEL_FEEL.cooldownSeconds) return true;
    started = ctx.now(); startHum(); return true;
  }
  function end() {
    if (started === null) return false;
    const held = (ctx.now() - started) / STORMREEL_FEEL.chargeSeconds; started = null; stopHum();
    const amount = Math.max(STORMREEL.minCharge, Math.min(1, held)), aim = ctx.aim();
    ctx.send('storm', {origin: aim.origin, direction: aim.direction, charge: Math.round(amount * 100) / 100});
    lastShot = ctx.now(); kick = 1; charge = 0;
    return true;
  }
  function cancel() { started = null; charge = 0; stopHum(); }

  // Charge sound: a capacitor whine that climbs with the hold, crackle clicks, a ping at full charge (stormreel-audio.js charger).
  function startHum() { if (!hum) hum = ctx.sfx?.charger?.() || null; }
  function stopHum() { hum?.stop(); hum = null; }

  const tmp = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  const pole = () => { const t = tower(); return t ? nextProbe(t, ctx.playerId()) : 'red'; };
  /** At high charge the muzzle itself crackles: little arcs reach out from the nose in the pole's colour. */
  function muzzleCrackle(scale) {
    const M = nodes.Muzzle; if (!M || !lightning) return; M.getWorldPosition(a);
    const reach = .05 + .12 * scale; b.set(Math.random() - .5, Math.random() - .5, Math.random() - .5).normalize().multiplyScalar(reach).add(a);
    lightning.strike(a.clone(), b.clone(), {life: .06, width: .003 + .004 * scale, rough: .4, depth: 3, branches: 0, restrikes: 0, intensity: .9 + .5 * scale, hue: POLE[pole()].hue});
  }
  function hornArc(scale) {
    const L = nodes.ArcHorn_L, R = nodes.ArcHorn_R; if (!L || !R || !lightning) return;
    // The arc climbs the horns as it charges: start low between the bases, finish across the tips.
    const climb = .25 + .75 * scale;
    lightning.strike(L.getWorldPosition(a), R.getWorldPosition(b), {life: .07 + .05 * Math.random(), width: .0035 + .004 * scale, rough: .3, depth: 3, branches: 0, restrikes: 0, intensity: .6 + .5 * scale, hue: POLE[pole()].hue,
      follow: () => { L.getWorldPosition(a); R.getWorldPosition(b); const base = (nodes.Horn_Base || L); base.getWorldPosition(tmp); a.lerp(tmp, 1 - climb); b.lerp(tmp, 1 - climb); return [a, b]; }});
  }
  // A glowing polarity badge (+ or -) on the receiver, so the crossbow in your hands tells you which pole it is.
  let badge = null;
  function polarityBadge() {
    const p = pole();
    if (badge && badge.userData.model === model && badge.userData.pole === p) { badge.material.opacity = .75 + .25 * flicker(ctx.now(), 2); return; }
    badge?.removeFromParent(); badge?.material.map?.dispose(); badge?.material.dispose();
    const root = nodes.Stormreel || model; if (!root) return;
    badge = new THREE.Mesh(new THREE.PlaneGeometry(.038, .038).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({map: glyphTexture(p), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false}));
    badge.position.set(0, .1045, .11); badge.userData = {model, pole: p}; badge.name = 'PolarityBadge'; badge.raycast = () => {}; badge.renderOrder = 15; root.add(badge);
  }
  function update(dt) {
    const t = tower(), wearing = !!t && !!model;
    if (!t && started !== null) cancel();
    if (started !== null) charge = Math.min(1, (ctx.now() - started) / STORMREEL_FEEL.chargeSeconds);
    kick = Math.max(0, kick - dt * 6);
    if (model) { finishCrossbow(model, pole()); polarityBadge(); }
    const shots = t ? chargeShots(t) : 0, live = !!t && t.charge >= Math.max(1, Math.round(STORMREEL.shotCost * Math.max(STORMREEL.minCharge, charge || 1)));
    // Capacitor tubes: dim with the tower's store, fill with the hold.
    for (const side of ['L', 'R']) {
      const core = nodes[`Charge_${side}_Core`]; if (!core) continue;
      core.scale.z = Math.max(.05, started !== null ? charge : live ? .18 + .06 * Math.sin(ctx.now() * 6) : .05);
      core.visible = live || started !== null;
    }
    hum?.set(charge, live, dt);
    if (wearing && lightning) {
      idleArc -= dt;
      const rate = started !== null ? (live ? 1 / (24 + 30 * charge) : .4) : live ? 1.4 : Infinity;
      if (idleArc <= 0 && rate < Infinity) { idleArc = rate * (.6 + Math.random() * .8); hornArc(started !== null ? charge : .15); }
      if (started !== null && live && charge > .45 && Math.random() < dt * (10 + 40 * charge)) muzzleCrackle(charge);
    }
    // Aim preview, only while charging so it never clutters the screen.
    const showPreview = wearing && started !== null;
    line.visible = ring.visible = step.visible = false;
    if (showPreview) {
      const aim = ctx.aim(), s = ctx.snapshot(), height = (x, z) => ctx.height(x, z);
      const muzzle = nodes.Muzzle ? nodes.Muzzle.getWorldPosition(a) : a.fromArray(aim.origin);
      const enemy = rayEnemy(s, aim.origin, aim.direction, STORMREEL.range, s.players?.find(p => p.id === ctx.playerId())?.side || 'party');
      const ground = rayGround(height, aim.origin, aim.direction, STORMREEL.range);
      // Walls, trees and stone stop the bolt (the authority uses the same volumes); a few times a second is plenty.
      if (wallFrame++ % 4 === 0) wall = rayWorld(s, height, aim.origin, aim.direction, Math.min(STORMREEL.range, enemy?.t ?? Infinity, ground?.t ?? Infinity), t.id);
      else if (wall && ((enemy && enemy.t < wall.t) || (ground && ground.t < wall.t))) wall = null;
      const hitEnemy = !wall && enemy && (!ground || enemy.t <= ground.t + .3) ? enemy : null;
      const end = wall ? b.fromArray(wall.point) : hitEnemy ? b.fromArray(hitEnemy.point) : ground ? b.fromArray(ground.point) : b.fromArray(aim.origin).addScaledVector(tmp.fromArray(aim.direction), STORMREEL.range);
      let earth = null, grounded = false;
      if (hitEnemy) { const e = hitEnemy.enemy, fl = height(e.position[0], e.position[2]); grounded = e.position[1] - fl <= STORMREEL.arcGap; earth = [e.position[0], fl, e.position[2]]; }
      else if (wall) { earth = [wall.point[0], height(wall.point[0], wall.point[2]), wall.point[2]]; grounded = true; }
      else if (ground) { earth = ground.point; grounded = true; }
      const color = live ? COLORS[nextProbe(t, ctx.playerId())] : COLORS.dead;
      const p = lineGeo.attributes.position.array; p.set([muzzle.x, muzzle.y, muzzle.z, end.x, end.y, end.z]); lineGeo.attributes.position.needsUpdate = true; line.computeLineDistances();
      lineMat.color.setHex(color); lineMat.opacity = .35 + .5 * charge; line.visible = true;
      if (earth) {
        ring.position.set(earth[0], earth[1] + .05, earth[2]); ring.material.color.setHex(color); ring.visible = true;
        const pulse = 1 + .08 * Math.sin(ctx.now() * 14); ring.scale.setScalar(pulse * (hitEnemy && grounded ? 1.4 : 1));
        if (live && grounded) { step.position.copy(ring.position); step.material.color.setHex(color); step.material.opacity = .12 + .25 * charge; step.visible = true; }
      }
    }
    // HUD
    if (hud) {
      hud.hidden = !wearing;
      if (wearing) {
        const me = ctx.localPosition(), pack = packOf(t, ctx.playerId()) || 'red', d = cableLength(t, [me.x, 0, me.z], pack), left = Math.max(0, STORMREEL.cable - d), strain = cableStrain(t, [me.x, 0, me.z], pack);
        const next = nextProbe(t, ctx.playerId()), arc = t.arc ? 'live' : t.probes?.red || t.probes?.blue ? 'half' : '';
        const out = t.probes?.red || t.probes?.blue ? 1 : 0, text = `${shots}|${Math.round(left)}|${strain > .01 ? 1 : 0}|${next}|${arc}|${pack}|${out}`;
        if (text !== hudText) {
          hudText = text;
          hud.querySelector('.sr-shots').textContent = shots ? `${shots} shot${shots === 1 ? '' : 's'}` : 'Tower empty: feed it Crystal';
          hud.querySelector('.sr-cable i').style.width = `${Math.round(left / STORMREEL.cable * 100)}%`;
          hud.querySelector('.sr-cable').title = `${Math.round(left)} m of cable left`;
          hud.classList.toggle('sr-strain', strain > .01); hud.classList.toggle('sr-empty', !shots);
          hud.dataset.pack = pack; hud.querySelector('.sr-probe').dataset.next = next;
          const reelKey = ctx.severKey?.() || 'Q', lodged = t.probes?.red ? 'positive' : 'negative';
          hud.querySelector('.sr-pole').textContent = pack === 'red' ? '+' : '\u2212'; hud.querySelector('.sr-pole').title = pack === 'red' ? 'Positive (red) crossbow' : 'Negative (blue) crossbow';
          hud.querySelector('.sr-arc').textContent = arc === 'live' ? `Arc live · ${reelKey} reel in` : arc === 'half' ? `${t.probes?.red && t.probes?.blue ? 'Both' : lodged} lodged · ${reelKey} reel in` : '';
        }
      }
    }
  }
  /** Weapon pose offsets for game.js: recoil kick back and up, a faint buzz while charging. */
  function poseOffset(out) {
    const buzz = started !== null ? (Math.random() - .5) * .0025 * charge : 0;
    return out.set(buzz, kick * .012 + buzz, kick * STORMREEL_FEEL.kick);
  }
  return {begin, end, cancel, update, setModel, poseOffset, charging: () => started !== null, charge: () => charge,
    stats: () => ({charging: started !== null, charge, preview: line.visible, wearing: !!tower()}),
    dispose() { cancel(); badge?.removeFromParent(); badge?.material.map?.dispose(); badge?.material.dispose(); for (const o of [line, ring, step]) { o.removeFromParent(); o.geometry.dispose(); o.material.dispose(); } hud?.remove(); }};
}
