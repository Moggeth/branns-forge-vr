// Local Stormreel handling: hold to charge (the glass capacitor tubes fill and arcs climb the horns), aim preview drawn
// every frame from the local aim, release to fire. The authority resolves the shot (shared/stormreel.js stormShot);
// this file only predicts what the player sees and hears before the result returns.
import * as THREE from 'three';
import {STORMREEL,rayEnemy,rayGround,rayWorld,chargeShots,cableStrain,cableLength,packOf} from '../shared/stormreel.js';
import {POLE,finishCrossbow,glyphTexture,flicker} from './stormreel-look.js';
import './stormreel-hud.css';

/** A damped spring on the presentation clock: k stiffness, z damping ratio (below 1 overshoots and rings). */
function spring(k, z) {
  const c = 2 * z * Math.sqrt(k);
  return {x: 0, v: 0, step(dt, target) { let t = dt; while (t > 1e-6) { const h = Math.min(t, 1 / 240); this.v += (k * (target - this.x) - c * this.v) * h; this.x += this.v * h; t -= h; } }};
}
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
  let started = null, lastShot = -Infinity, charge = 0, hum = null, idleArc = 0, model = null, nodes = {}, wallFrame = 0, wall = null;
  // Handling springs (presentation clock, dt-integrated): recoil, the tether yank, the prod limbs' flex, the tube level.
  const rec = spring(150, .42), tugS = spring(110, .32), flex = spring(1400, .16), fill = spring(260, .9), pulse = spring(500, .35);
  let rig = null, coreMat = null, reloaded = true, clicked = true, fullPinged = false;
  // Aim preview: a thin line to the predicted contact, a ring there, and a wide splash ring when this bolt would
  // close the circuit (the other pole already sits in that same foe).
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
    if (m === model) return;
    if (rig) restRig();
    model = m; nodes = {}; rig = null; coreMat = null;
    m?.traverse(n => { if (n.name) nodes[n.name] = n; });
    rig = m ? makeRig() : null;
  }
  /** The moving parts the builder exports (assets-source/stormreel-crossbow/README.md); any may be missing on an older glb. */
  function makeRig() {
    const root = nodes.Stormreel; if (!root) return null;
    const r = {root, restQ: root.quaternion.clone(), restP: root.position.clone(), limbs: [], strings: [], nock: nodes.String?.position.clone() || null, bolt: nodes.Bolt_Mesh || null, cores: ['L', 'R'].map(s => nodes[`Charge_${s}_Core`]).filter(Boolean)};
    for (const side of ['L', 'R']) {
      const prod = nodes[`Prod_${side}`], tip = nodes[`Prod_${side}_Tip`], str = nodes[`String_${side}`];
      if (prod && tip) r.limbs.push({prod, tip, restQ: prod.quaternion.clone(), sign: side === 'L' ? -1 : 1});
      if (str && r.nock) r.strings.push({node: str, restQ: str.quaternion.clone(), restP: str.position.clone(), restS: str.scale.clone(), rest: str.position.distanceTo(r.nock), side});
    }
    return r;
  }
  function restRig() {
    if (!rig) return;
    rig.root.quaternion.copy(rig.restQ); rig.root.position.copy(rig.restP);
    for (const l of rig.limbs) l.prod.quaternion.copy(l.restQ);
    for (const s of rig.strings) { s.node.quaternion.copy(s.restQ); s.node.position.copy(s.restP); s.node.scale.copy(s.restS); }
    if (rig.bolt) rig.bolt.scale.setScalar(1);
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
    lastShot = ctx.now(); charge = 0; reloaded = false; clicked = false; fullPinged = false;
    rec.v += 7 + 5 * amount; flex.v += 30; pulse.x = 0;
    if (rig?.bolt) rig.bolt.visible = false;   // it is the flying bolt now (stormreel-view.js draws it from the muzzle)
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
    const seat = nodes.PolarityBadge_Seat; if (seat) badge.position.copy(seat.position); else badge.position.set(0, .1045, .11);
    badge.geometry.dispose(); badge.geometry = new THREE.PlaneGeometry(seat ? .0175 : .038, seat ? .0175 : .038).rotateX(-Math.PI / 2); badge.userData = {model, pole: p}; badge.name = 'PolarityBadge'; badge.raycast = () => {}; badge.renderOrder = 15; root.add(badge);
  }
  /** The hand-held model's own motion: muzzle climb, limbs and string, re-cock, bolt reload, tube fill and glow. */
  const UP = new THREE.Vector3(0, 1, 0), nockP = new THREE.Vector3(), dirV = new THREE.Vector3(), eul = new THREE.Euler(), qA = new THREE.Quaternion(), FWD = new THREE.Vector3(0, 0, -1);
  const SEQ = Object.freeze({release: .035, hold: .13, cock: .36, load: .47});   // seconds after the shot (cooldown is .5)
  const smooth = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
  function animate(dt, live) {
    const now = ctx.now(), since = now - lastShot;
    dt = Math.min(dt, .05);
    // Uncocked amount: the string flies to the brace line, waits, then the magnetic latch draws it back.
    const uncock = reloaded ? 0 : since < SEQ.release ? 1 - (1 - since / SEQ.release) ** 3 : since < SEQ.hold ? 1 : 1 - smooth((since - SEQ.hold) / (SEQ.cock - SEQ.hold));
    if (!clicked && since >= SEQ.cock) { clicked = true; rec.v += 2.2; flex.v -= 6; spark(nodes.String, .5); }   // the latch clicks home
    if (!reloaded && since >= SEQ.load) { reloaded = true; if (rig?.bolt) { rig.bolt.visible = true; spark(nodes.BoltSeat, 1); } }
    const pulling = started !== null;
    rec.step(dt, 0); tugS.step(dt, 0); flex.step(dt, uncock); pulse.step(dt, 0);
    // Tube level follows the hold (eased so it races up then crawls into the last bit), idles low while live, drains on a shot.
    const target = pulling ? .12 + .88 * (1 - (1 - charge) ** 1.6) : !reloaded ? 0 : live ? .2 + .03 * Math.sin(now * 2.6) : 0;
    fill.step(dt, target);
    if (pulling && charge >= 1 && !fullPinged) { fullPinged = true; pulse.v += 14; }   // full: the tubes flash and swell once
    if (!pulling) fullPinged = false;
    if (!rig) { for (const side of ['L', 'R']) { const core = nodes[`Charge_${side}_Core`]; if (core) { core.scale.z = Math.max(.05, fill.x); core.visible = live || pulling; } } return; }
    const r = rig, f = Math.min(1.6, Math.max(-.4, flex.x));
    // Whole-weapon motion about the grip: recoil climbs the muzzle, the tug dips it, charging braces it in a hair.
    const hum = pulling ? .006 * charge * Math.sin(now * 23.3) * Math.sin(now * 9.1 + 1) : 0;
    eul.set(rec.x * .085 - tugS.x * .07 + hum * .3, tugS.x * .025, rec.x * .03 + hum, 'XYZ');
    r.root.quaternion.copy(r.restQ).multiply(qA.setFromEuler(eul));
    // Limbs: tips spring forward on release, ring down, then bend back as the latch draws the string.
    for (const l of r.limbs) l.prod.quaternion.copy(l.restQ).multiply(qA.setFromAxisAngle(UP, l.sign * .085 * f));
    if (r.nock && r.limbs.length === 2 && r.strings.length === 2) {
      const tips = r.limbs.map(l => l.tip.position.clone().applyQuaternion(l.prod.quaternion).add(l.prod.position));
      const brace = (tips[0].z + tips[1].z) / 2 + .004;
      nockP.copy(r.nock); nockP.z += (brace - r.nock.z) * Math.min(1, Math.max(0, uncock + (f - uncock) * .3));
      for (const s of r.strings) {
        const a = tips[s.side === 'L' ? 0 : 1]; s.node.position.copy(a); dirV.subVectors(nockP, a); const len = dirV.length();
        s.node.quaternion.setFromUnitVectors(FWD, dirV.multiplyScalar(1 / len)); s.node.scale.set(1, 1, len / s.rest);
      }
    }
    // Bolt: zaps into the seat at the end of the re-cock, overshooting a touch.
    if (r.bolt && r.bolt.visible) { const u = reloaded ? Math.min(1, (since - SEQ.load) / .09) : 1, e = u >= 1 ? 1 : 1 + 2.2 * (u - 1) ** 3 + 1.2 * (u - 1) ** 2; r.bolt.scale.set(.4 + .6 * e, .4 + .6 * e, Math.max(.01, e)); }
    // Charge cores: per-model glow so the planted and remote crossbows keep their own.
    for (const core of r.cores) {
      const m = core.material;
      if (m !== coreMat && m?.name === 'Charge') {   // a new pole (finishCrossbow swapped it): take a fresh private copy
        if (!coreMat || coreMat.userData.finish !== m) { coreMat?.dispose(); coreMat = m.clone(); coreMat.userData = {baseMaterial: m.userData.baseMaterial || m, finish: m}; }
        core.material = coreMat;
      }
      core.scale.z = Math.max(.04, fill.x); const swell = 1 + .35 * Math.max(0, pulse.x); core.scale.x = core.scale.y = swell;
      core.visible = live || pulling || fill.x > .06;
    }
    if (coreMat) coreMat.emissiveIntensity = (.9 + 2.2 * fill.x + 2.5 * Math.max(0, pulse.x)) * (.85 + .3 * flicker(now, 4));
  }
  function spark(node, k) {
    if (!node || !lightning) return; node.getWorldPosition(a);
    lightning.burst?.(a.clone(), {count: Math.round(3 + 4 * k), speed: .5 + .5 * k, life: .18});
    lightning.glow?.(a.clone(), {size: .05 + .06 * k, life: .12, color: POLE[pole()].glow});
  }
  function update(dt) {
    const t = tower(), wearing = !!t && !!model;
    if (!t && started !== null) cancel();
    if (started !== null) charge = Math.min(1, (ctx.now() - started) / STORMREEL_FEEL.chargeSeconds);
    if (model) { finishCrossbow(model, pole()); polarityBadge(); }
    const shots = t ? chargeShots(t) : 0, live = !!t && t.charge >= Math.max(1, Math.round(STORMREEL.shotCost * Math.max(STORMREEL.minCharge, charge || 1)));
    animate(dt, live);
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
      const mine = nextProbe(t, ctx.playerId()), other = t.probes?.[mine === 'red' ? 'blue' : 'red'];
      const closes = !!(live && hitEnemy && other && !other.fell && other.enemy === hitEnemy.enemy.id);
      let earth = null;
      if (hitEnemy) { const e = hitEnemy.enemy; earth = [e.position[0], height(e.position[0], e.position[2]), e.position[2]]; }
      else if (wall) earth = [wall.point[0], height(wall.point[0], wall.point[2]), wall.point[2]];
      else if (ground) earth = ground.point;
      const color = closes ? COLORS.circuit : live ? COLORS[mine] : COLORS.dead;
      const p = lineGeo.attributes.position.array; p.set([muzzle.x, muzzle.y, muzzle.z, end.x, end.y, end.z]); lineGeo.attributes.position.needsUpdate = true; line.computeLineDistances();
      lineMat.color.setHex(color); lineMat.opacity = .35 + .5 * charge; line.visible = true;
      if (earth) {
        ring.position.set(earth[0], earth[1] + .05, earth[2]); ring.material.color.setHex(color); ring.visible = true;
        const pulse = 1 + (closes ? .16 : .08) * Math.sin(ctx.now() * (closes ? 22 : 14)); ring.scale.setScalar(pulse * (closes ? 1.8 : hitEnemy ? 1.3 : 1));
        if (closes) { step.position.copy(ring.position); step.material.color.setHex(color); step.material.opacity = .12 + .25 * charge; step.visible = true; }
      }
    }
    // HUD
    if (hud) {
      hud.hidden = !wearing;
      if (wearing) {
        const me = ctx.localPosition(), pack = packOf(t, ctx.playerId()) || 'red', d = cableLength(t, [me.x, 0, me.z], pack), left = Math.max(0, STORMREEL.cable - d), strain = cableStrain(t, [me.x, 0, me.z], pack);
        const next = nextProbe(t, ctx.playerId()), arc = t.arc ? 'live' : t.probes?.red && t.probes?.blue ? 'open' : t.probes?.red || t.probes?.blue ? 'half' : '';
        const out = t.probes?.red || t.probes?.blue ? 1 : 0, text = `${shots}|${Math.round(left)}|${strain > .01 ? 1 : 0}|${next}|${arc}|${pack}|${out}`;
        if (text !== hudText) {
          hudText = text;
          hud.querySelector('.sr-shots').textContent = shots ? `${shots} shot${shots === 1 ? '' : 's'}` : 'Tower empty: feed it Crystal';
          hud.querySelector('.sr-cable i').style.width = `${Math.round(left / STORMREEL.cable * 100)}%`;
          hud.querySelector('.sr-cable').title = `${Math.round(left)} m of cable left`;
          hud.classList.toggle('sr-strain', strain > .01); hud.classList.toggle('sr-empty', !shots);
          hud.dataset.pack = pack; hud.querySelector('.sr-probe').dataset.next = next;
          const reelKey = ctx.severKey?.() || 'Q', lodged = t.probes?.red ? 'red' : 'blue', want = lodged === 'red' ? 'blue (\u2212)' : 'red (+)';
          const sameFoe = t.probes?.[lodged]?.enemy && !t.probes[lodged].fell;
          hud.querySelector('.sr-pole').textContent = pack === 'red' ? '+' : '\u2212'; hud.querySelector('.sr-pole').title = pack === 'red' ? 'Positive (red) crossbow' : 'Negative (blue) crossbow';
          hud.querySelector('.sr-arc').textContent = arc === 'live' ? `Circuit live · ${reelKey} reel in`
            : arc === 'open' ? `Open circuit: both bolts must be in one foe · ${reelKey} reel in`
            : arc === 'half' ? (sameFoe ? `${lodged === 'red' ? 'Red (+)' : 'Blue (\u2212)'} bolt in a foe · hit it with ${want}` : `Bolt in the ground · ${reelKey} reel in`) : '';
        }
      }
    }
  }
  /** Weapon pose offsets for game.js: recoil kick back and up, a faint buzz while charging. */
  function poseOffset(out) {
    // Recoil shoves the stock back into the shoulder and lifts a touch; a capacitor hum while charging (smooth noise from
    // the presentation clock, never per-frame random); the tether tug yanks forward and down toward the tower.
    const now = ctx.now(), h = started !== null ? .0016 * charge * charge : 0;
    const bx = h * Math.sin(now * 83.1) * Math.sin(now * 13.7 + 1), by = h * Math.sin(now * 71.3 + 2) * Math.sin(now * 17.9);
    const k = rec.x, y = tugS.x;
    return out.set(bx + y * .018, by + k * .010 - y * .045, k * STORMREEL_FEEL.kick - y * .08 - .006 * charge);
  }
  function tug() { tugS.v += 9; }
  return {begin, end, cancel, update, setModel, poseOffset, tug, charging: () => started !== null, charge: () => charge,
    stats: () => ({charging: started !== null, charge, preview: line.visible, wearing: !!tower(), fill: +fill.x.toFixed(3), recoil: +rec.x.toFixed(3), flex: +flex.x.toFixed(3), reloaded, rigged: !!rig}),
    dispose() { cancel(); restRig(); badge?.removeFromParent(); badge?.material.map?.dispose(); badge?.material.dispose(); for (const o of [line, ring, step]) { o.removeFromParent(); o.geometry.dispose(); o.material.dispose(); } hud?.remove(); }};
}
