// Stormreel circuit through a foe (presentation): a + bolt and a - bolt in the same body close the loop, and this is what
// the player sees. The power is the Stormspire's, carried down the cable, so the kill reads as an industrial ARC FLASH,
// not weather (Mitch, 2026-10-11: "an industrial electrical arc", "mechanically coherent"; 2026-10-10: "a big fuckin deal").
// The SURGE: a fat violet-white plasma arc roars bolt -> body -> bolt, a fireball of plasma swells in the body, molten
// spatter sprays and drips, the soil current spits at the neighbours, and the glare is so bright the world around it goes dark
// (ctx.darken dips the exposure; every arc material is drawn untonemapped, so the arc itself stays white-hot). While the
// circuit holds (half a second) the COOK keeps that arc writhing like a welder's, lights the body from inside and shakes it.
// A foe that dies in it is left charred, smoking, on a scorch mark. Reads authority events and snapshots; never writes gameplay state.
import * as THREE from 'three';
import {POLE,MIXED_HUE,makeSprite,flicker} from './stormreel-look.js';

// ARC tints the white-blue lightning ribbon toward the violet of a real electric arc.
export const ARC = new THREE.Color(.6, .2, 1);
const HOT = new THREE.Color(0xdff2ff), BODY = new THREE.Color(0x7cc4ff), RED_HOT = new THREE.Color(POLE.red.hot), BLUE_HOT = new THREE.Color(POLE.blue.hot);

function smokeTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  for (let i = 0; i < 7; i++) {
    const x = 20 + Math.random() * 24, y = 20 + Math.random() * 24, r = 12 + Math.random() * 14, gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function scorchTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); g.translate(64, 64);
  const r = g.createRadialGradient(0, 0, 4, 0, 0, 62); r.addColorStop(0, 'rgba(10,8,6,.85)'); r.addColorStop(.5, 'rgba(20,16,12,.55)'); r.addColorStop(1, 'rgba(20,16,12,0)');
  g.fillStyle = r; g.fillRect(-64, -64, 128, 128);
  g.strokeStyle = 'rgba(8,6,4,.7)'; g.lineCap = 'round';
  for (let i = 0; i < 9; i++) {   // Lichtenberg-ish burn tendrils
    let a = Math.random() * Math.PI * 2, x = 0, y = 0; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 0);
    for (let k = 0; k < 6; k++) { a += (Math.random() - .5) * 1.1; x += Math.cos(a) * 9; y += Math.sin(a) * 9; g.lineTo(x, y); g.lineWidth = Math.max(.6, 3 - k * .45); }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/**
 * ctx: scene, lightning, height(x,z), beads (stormreel-look createBeads), tex {soft}, sound(name, ...args),
 *      bodyPoints(enemyId, outVectors) -> count, enemyVisual(enemyId) -> Object3D | null, enemyAt(enemyId, out) -> Vector3 | null,
 *      shake(amount, at) (camera), flash(amount, at) (screen), darken(amount, at) (the world dims round the strike)
 */
export function createCircuitFx(ctx) {
  const {scene, lightning} = ctx;
  const tex = {smoke: smokeTexture(), scorch: scorchTexture()};
  const victims = new Map(), smokes = [], scorches = [], v = new THREE.Vector3(), v2 = new THREE.Vector3(), c3 = new THREE.Color();
  const body = Array.from({length: 8}, () => new THREE.Vector3());
  // One permanent light for the circuit (never added or removed, so no shader rebuilds): the surge floods the
  // surroundings blue-white, then the cook flickers it while the current runs. Off (intensity 0) the rest of the time.
  const light = new THREE.PointLight(0xd8ccff, 0, 11, 2); light.castShadow = false; light.name = 'StormCircuitLight'; scene.add(light);
  let flashK = 0, cookK = 0, blastK = 0;
  // Lit-from-inside and charred variants of an enemy's own materials, shared by every foe wearing them.
  const lit = new Map(), char = new Map(), litMats = new Set();
  function variant(cache, m, make) { if (!m) return m; let x = cache.get(m.uuid); if (!x) { x = make(m); cache.set(m.uuid, x); } return x; }
  const litOf = m => variant(lit, m, m => { const c = m.clone(); if (c.emissive) { c.emissive.copy(BODY); c.emissiveIntensity = 0; } c.userData.stormLit = true; litMats.add(c); return c; });
  const charOf = m => variant(char, m, m => { const c = m.clone(); if (c.color) c.color.multiplyScalar(.16).lerp(new THREE.Color(0x1a1410), .4); if (c.emissive) { c.emissive.setHex(0x3a1606); c.emissiveIntensity = .25; } if ('roughness' in c) c.roughness = 1; if ('metalness' in c) c.metalness = 0; c.userData.stormChar = true; return c; });
  function dress(x, kind) {
    const root = ctx.enemyVisual?.(x.id); if (!root) return;
    if (!x.meshes) { x.meshes = []; root.traverse(n => { if (n.isMesh && !n.userData.ignoreContact && n.material) x.meshes.push({n, m: n.material}); }); x.root = root; }
    for (const {n, m} of x.meshes) {
      const list = [m].flat(), out = list.map(mm => kind === 'lit' ? litOf(mm) : kind === 'char' ? charOf(mm) : mm);
      n.material = Array.isArray(m) ? out : out[0];
    }
  }
  function victim(id) {
    let x = victims.get(id);
    if (!x) {
      x = {id, since: 0, ground: 0, smoke: 0, zap: 0, age: 0, flare: makeSprite(scene, ctx.tex.soft, 0xa890ff, 14), core: makeSprite(scene, ctx.tex.soft, 0xffffff, 15), base: null, at: new THREE.Vector3()};
      victims.set(id, x); dress(x, 'lit');
    }
    return x;
  }
  function release(x, charred) {
    x.flare.removeFromParent(); x.flare.material.dispose(); x.core.removeFromParent(); x.core.material.dispose();
    if (x.root && x.base) x.root.position.copy(x.base);
    if (x.meshes) dress(x, charred ? 'char' : 'plain');
    victims.delete(x.id);
  }

  function puff(at, {size = .5, life = 1.6, rise = .9, color = 0x55504a, drift = .25} = {}) {
    const m = new THREE.SpriteMaterial({map: tex.smoke, color, transparent: true, depthWrite: false, opacity: 0}), s = new THREE.Sprite(m);
    s.position.copy(at); s.raycast = () => {}; s.userData.ignoreContact = true; s.renderOrder = 9; scene.add(s);
    smokes.push({s, age: 0, life, size, rise, vx: (Math.random() - .5) * drift, vz: (Math.random() - .5) * drift, spin: (Math.random() - .5) * 1.5});
  }
  function scorch(at, radius = 1.4) {
    const m = new THREE.MeshBasicMaterial({map: tex.scorch, transparent: true, depthWrite: false, opacity: .9, polygonOffset: true, polygonOffsetFactor: -2});
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2).rotateX(-Math.PI / 2), m);
    mesh.position.set(at.x, ctx.height(at.x, at.z) + .03, at.z); mesh.rotation.y = Math.random() * Math.PI * 2; mesh.raycast = () => {}; mesh.userData.ignoreContact = true; mesh.renderOrder = 2; scene.add(mesh);
    scorches.push({mesh, age: 0, life: 14});
  }

  /** The crown of the arc between the two bolts: it jumps through the air outside the body (bowing out from the foe's
   *  middle, `mid`) and hot plasma rises, so it lifts too. */
  const bowOut = new THREE.Vector3();
  function bow(pa, pb, mid, out) {
    const d = pa.distanceTo(pb); out.lerpVectors(pa, pb, .5);
    bowOut.set(out.x - mid.x, 0, out.z - mid.z); if (bowOut.lengthSq() < 1e-4) bowOut.set(pb.z - pa.z, 0, pa.x - pb.x); if (bowOut.lengthSq() < 1e-4) bowOut.set(1, 0, 0);
    return out.addScaledVector(bowOut.normalize(), .75 + .3 * Math.min(2, d)).setY(out.y + .25 + .15 * Math.min(2, d));
  }

  /** ev: storm_arc {enemy, red, blue, at, splash, wet}, plus where the bolts are drawn (pa, pb) and splash foe positions. */
  function surge(ev, pa, pb, splashAt = [], local = false) {
    const at = v.fromArray(ev.at || ev.red).clone(), x = victim(ev.enemy); x.age = 0; x.kick = 1;
    ctx.sound?.('surge', ev.at, !!ev.wet);
    ctx.darken?.(1, at); ctx.flash?.(local ? .9 : .7, at); ctx.shake?.(local ? 1 : .8, local ? undefined : at);
    light.position.copy(at); light.position.y += 1.5; flashK = 1; blastK = 1;
    if (!lightning) return;
    // The arc flash: a thick, ropey plasma channel bolt -> body -> bolt (no forks: a power arc is one writhing rope),
    // with a thin white-hot core inside it. It holds for the circuit's half second; cook() keeps it writhing.
    const floor0 = new THREE.Vector3(at.x, ctx.height(at.x, at.z) + .05, at.z);
    for (const [from, to] of [[pa, at], [at, pb]]) lightning.strike(from.clone(), to.clone(), {life: .5, width: .12, rough: .07, depth: 4, branches: 0, restrikes: 0, intensity: 3, hue: ARC});
    // Outside the body the two bolts arc straight to each other like electrodes: a fat rope that bows up off the heat.
    const top = bow(pa, pb, ctx.enemyAt?.(ev.enemy, v2)?.clone().setY(at.y) || at, new THREE.Vector3());
    for (const [from, to] of [[pa, top], [top, pb]]) {
      lightning.strike(from.clone(), to.clone(), {life: .6, width: .17, rough: .06, depth: 5, branches: 0, restrikes: 0, intensity: 3.5, hue: ARC});
      lightning.strike(from.clone(), to.clone(), {life: .45, width: .045, rough: .04, depth: 5, branches: 0, restrikes: 2, intensity: 2});
    }
    // The plasma fireball swelling in the body, and the glare round it.
    lightning.glow(at, {size: 1.6, life: .7, color: 0xffffff}); lightning.glow(at, {size: 3.2, life: .8, color: 0x9a7cff}); 
    lightning.ring(floor0.clone(), {radius: 3.5, life: .45, color: 0xcdbfff});
    // Molten spatter: a hard spray, then heavy drips that fall and cool orange.
    lightning.burst(at, {count: 90, speed: 8, life: .9, molten: true}); lightning.burst(at, {count: 40, speed: 2.5, up: .9, life: 1.3, molten: true}); lightning.burst(at, {count: 30, speed: 6});
    for (const [p, pole] of [[pa, 'red'], [pb, 'blue']]) {
      lightning.glow(p, {size: 2.6, life: .5, color: POLE[pole].glow}); lightning.burst(p, {count: 14, speed: 3, life: .8, molten: true});
    }
    // The soil current leaps to each neighbour and spits up out of the ground in a ring.
    const floor = new THREE.Vector3(at.x, ctx.height(at.x, at.z) + .05, at.z);
    for (const s of splashAt) lightning.strike(floor.clone(), s.clone().setY(s.y + .9), {life: .32, width: .07, rough: .2, branches: 1, restrikes: 2, intensity: 1.1, hue: MIXED_HUE});
    for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2 + Math.random() * .4, r = 1.2 + Math.random() * 1.6; v2.set(at.x + Math.cos(a) * r, 0, at.z + Math.sin(a) * r); v2.y = ctx.height(v2.x, v2.z) + .03;
      lightning.strike(floor.clone(), v2.clone(), {life: .25, width: .04, rough: .25, depth: 3, branches: 1, restrikes: 1, intensity: .9, hue: MIXED_HUE}); }
  }

  /** Every frame while the circuit runs through `id`, with the bolts drawn at pa (+) and pb (-). power 0..1. */
  function cook(id, pa, pb, dt, time, power = 1) {
    const x = victim(id); x.age += dt; x.seen = true;
    const n = ctx.bodyPoints?.(id, body) || 0, centre = n ? body[0] : (ctx.enemyAt?.(id, v) || pa);
    x.at.copy(centre); light.position.lerp(centre, Math.min(1, dt * 12)); cookK = Math.max(cookK, (.35 + .65 * flicker(time * 2.3, 5)) * (.5 + .5 * power));
    // Lit from inside: one shared pulse for every lit material (bright on each surge-like flicker).
    const f = flicker(time * 1.3, 4), k = (.35 + .9 * f) * (.5 + .5 * power) * (1 + 1.5 * Math.max(0, x.kick || 0));
    for (const m of litMats) { m.emissiveIntensity = k; m.emissive.copy(BODY).lerp(HOT, f * .6); }
    x.kick = Math.max(0, (x.kick || 0) - dt * 2.5);
    // Shake: the whole body buzzes on its feet (restored when the circuit lets go).
    if (x.root) { x.base ||= x.root.position.clone(); const a = (.025 + .03 * x.kick) * (.6 + .4 * power); x.root.position.set(x.base.x + (Math.random() - .5) * a, x.base.y + Math.random() * a * .6, x.base.z + (Math.random() - .5) * a); }
    x.flare.position.copy(centre); x.flare.scale.setScalar((.9 + .5 * flicker(time, 1)) * (1 + .4 * x.kick)); x.flare.material.opacity = .22 + .18 * f;
    x.core.position.copy(centre); x.core.scale.setScalar(.45 + .35 * flicker(time * 1.9, 7)); x.core.material.opacity = .5 + .4 * f;
    // Carriers: + -> body -> -.
    if (ctx.beads) for (let i = 0; i < 10; i++) {
      const u = ((time * 1.6 + i / 10) % 1), p = u < .5 ? v.lerpVectors(pa, centre, u * 2) : v.lerpVectors(centre, pb, u * 2 - 1);
      p.x += (Math.random() - .5) * .05; p.y += (Math.random() - .5) * .05; c3.copy(RED_HOT).lerp(BLUE_HOT, u); ctx.beads.add(p, c3, 1.1);
    }
    if (!lightning) return;
    x.since -= dt;
    if (x.since <= 0) {
      x.since = .05 + Math.random() * .03;
      // The arc holds: a writhing violet rope from the + bolt through the body's core and out through the - bolt, the
      // poles' own colours licking at each end, molten beads dripping off both bolts.
      lightning.strike(pa.clone(), centre.clone(), {life: .1, width: .09, rough: .08, depth: 4, branches: 0, restrikes: 0, intensity: 3.5, hue: ARC});
      lightning.strike(centre.clone(), pb.clone(), {life: .1, width: .09, rough: .08, depth: 4, branches: 0, restrikes: 0, intensity: 3.5, hue: ARC});
      const top = bow(pa, pb, centre, v2).clone(); top.y += (Math.random() - .5) * .15;
      lightning.strike(pa.clone(), top, {life: .1, width: .14, rough: .07, depth: 5, branches: 0, restrikes: 0, intensity: 4, hue: ARC});
      lightning.strike(top.clone(), pb.clone(), {life: .1, width: .14, rough: .07, depth: 5, branches: 0, restrikes: 0, intensity: 4, hue: ARC});
      lightning.strike(pa.clone(), centre.clone().lerp(pa, .6), {life: .08, width: .07, rough: .12, depth: 3, branches: 0, restrikes: 0, intensity: 1.2, hue: POLE.red.hue});
      lightning.strike(pb.clone(), centre.clone().lerp(pb, .6), {life: .08, width: .07, rough: .12, depth: 3, branches: 0, restrikes: 0, intensity: 1.2, hue: POLE.blue.hue});
      if (Math.random() < .5) lightning.burst(Math.random() < .5 ? pa : pb, {count: 3, speed: 1.4, up: .2, life: .9, molten: true});
      // Crawling over the limbs.
      if (n >= 2) for (let r = 0; r < 2; r++) {
        const i = Math.floor(Math.random() * n); let j = Math.floor(Math.random() * n); if (j === i) j = (j + 1) % n;
        lightning.strike(body[i].clone(), body[j].clone(), {life: .07, width: .03, rough: .35, depth: 3, branches: 1, restrikes: 0, intensity: 1.2, hue: Math.random() < .5 ? POLE.red.hue : MIXED_HUE});
      }
    }
    x.ground -= dt;
    if (x.ground <= 0) {   // stray current spitting from the feet into the soil
      x.ground = .1 + Math.random() * .14; const from = n > 4 ? body[4 + Math.floor(Math.random() * Math.min(2, n - 4))] : centre;
      v2.set(from.x + (Math.random() - .5) * 1.6, 0, from.z + (Math.random() - .5) * 1.6); v2.y = ctx.height(v2.x, v2.z) + .02;
      lightning.strike(from.clone(), v2.clone(), {life: .09, width: .03, rough: .3, depth: 3, branches: 0, restrikes: 0, intensity: 1, hue: MIXED_HUE}); lightning.burst(v2, {count: 3, speed: 2, up: 1});
    }
    x.zap -= dt; if (x.zap <= 0) { x.zap = .18 + Math.random() * .16; ctx.sound?.('shock', [centre.x, centre.y, centre.z]); }
    x.smoke -= dt; if (x.smoke <= 0 && x.age > .3) { x.smoke = .14; puff((n > 1 ? body[1] : centre).clone().add(v2.set(0, .15, 0)), {size: .35, life: 1.3, rise: 1, color: 0x6a6660}); }
  }
  /** The circuit let go of `id`; `cooked` when the foe died in it (charred, smoking, scorch mark). */
  function end(id, cooked) {
    const x = victims.get(id); if (!x) return;
    if (cooked) {
      ctx.sound?.('cooked', [x.at.x, x.at.y, x.at.z]); scorch(x.at, 1.5);
      for (let i = 0; i < 6; i++) puff(x.at.clone().add(v2.set((Math.random() - .5) * .5, Math.random() * .8, (Math.random() - .5) * .5)), {size: .6, life: 2.6, rise: 1.2, color: 0x3c3834, drift: .4});
      if (lightning) { lightning.burst(x.at, {count: 30, speed: 4}); lightning.glow(x.at, {size: 2.4, life: .4, color: 0xffc89a}); }
    }
    release(x, cooked);
  }
  function update(dt, camPos) {
    // Surge: a white-hot flash that falls off fast; cook: a cooler violet flicker held while a victim is lit.
    // The arc flash floods everything within 35 m with white light (the same one light: only its numbers change, never its shader).
    light.intensity = 40 * flashK * flashK + 6 * cookK + 260 * blastK * blastK; light.distance = 9 + 16 * blastK; light.color.setHex(flashK > .4 ? 0xf1ecff : 0xb8a8ff);
    flashK = Math.max(0, flashK - dt * 2.4); cookK = Math.max(0, cookK - dt * 8); blastK = Math.max(0, blastK - dt * 2.8);
    for (const x of [...victims.values()]) { if (!x.seen) end(x.id, false); x.seen = false; }
    for (let i = smokes.length - 1; i >= 0; i--) {
      const s = smokes[i]; s.age += dt; const t = s.age / s.life;
      if (t >= 1) { s.s.removeFromParent(); s.s.material.dispose(); smokes.splice(i, 1); continue; }
      s.s.position.x += s.vx * dt; s.s.position.z += s.vz * dt; s.s.position.y += s.rise * dt * (1 - t * .5);
      s.s.scale.setScalar(s.size * (.6 + 1.6 * t)); s.s.material.rotation += s.spin * dt; s.s.material.opacity = Math.min(1, t * 6) * (1 - t) * .7;
    }
    for (let i = scorches.length - 1; i >= 0; i--) {
      const s = scorches[i]; s.age += dt; const t = s.age / s.life;
      if (t >= 1) { s.mesh.removeFromParent(); s.mesh.geometry.dispose(); s.mesh.material.dispose(); scorches.splice(i, 1); continue; }
      s.mesh.material.opacity = .9 * Math.min(1, (1 - t) * 3);
    }
    void camPos;
  }
  return {surge, cook, end, update, puff, active: () => victims.size,
    stats: () => ({victims: victims.size, smokes: smokes.length, scorches: scorches.length}),
    dispose() { light.removeFromParent(); for (const x of [...victims.values()]) release(x, false); for (const s of smokes) { s.s.removeFromParent(); s.s.material.dispose(); } smokes.length = 0;
      for (const s of scorches) { s.mesh.removeFromParent(); s.mesh.geometry.dispose(); s.mesh.material.dispose(); } scorches.length = 0; tex.smoke?.dispose(); tex.scorch?.dispose(); }};
}
