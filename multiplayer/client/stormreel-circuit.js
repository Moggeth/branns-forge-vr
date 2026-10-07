// Stormreel circuit through a foe (presentation): a + bolt and a - bolt in the same body close the loop, and this is what
// the player sees while the current runs. The closing SURGE: a white-hot flash, a ground shockwave, thick channels from
// each bolt into the body, arcs leaping to the neighbours the soil current jolts. Then the COOK: the body lights up blue-white
// from inside and shakes, current pours bolt -> body -> bolt as a branching red-to-blue channel with carriers riding it,
// arcs crawl over the limbs and spit into the ground, smoke curls off the head. If it dies in the circuit it is left
// charred, smoking, on a scorch mark. Reads authority events and snapshots; never writes gameplay state.
import * as THREE from 'three';
import {POLE,MIXED_HUE,makeSprite,flicker} from './stormreel-look.js';

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
 *      shake(amount, at) (camera, local only), flash(amount) (screen, local only)
 */
export function createCircuitFx(ctx) {
  const {scene, lightning} = ctx;
  const tex = {smoke: smokeTexture(), scorch: scorchTexture()};
  const victims = new Map(), smokes = [], scorches = [], v = new THREE.Vector3(), v2 = new THREE.Vector3(), c3 = new THREE.Color();
  const body = Array.from({length: 8}, () => new THREE.Vector3());
  // One permanent light for the circuit (never added or removed, so no shader rebuilds): the surge floods the
  // surroundings blue-white, then the cook flickers it while the current runs. Off (intensity 0) the rest of the time.
  const light = new THREE.PointLight(0xbfe0ff, 0, 11, 2); light.castShadow = false; light.name = 'StormCircuitLight'; scene.add(light);
  let flashK = 0, cookK = 0;
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
      x = {id, since: 0, ground: 0, smoke: 0, zap: 0, age: 0, flare: makeSprite(scene, ctx.tex.soft, 0x9fd0ff, 14), core: makeSprite(scene, ctx.tex.soft, 0xffffff, 15), base: null, at: new THREE.Vector3()};
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

  /** ev: storm_arc {enemy, red, blue, at, splash, wet}, plus where the bolts are drawn (pa, pb) and splash foe positions. */
  function surge(ev, pa, pb, splashAt = [], local = false) {
    const at = v.fromArray(ev.at || ev.red).clone(), x = victim(ev.enemy); x.age = 0; x.kick = 1;
    ctx.sound?.('surge', ev.at, !!ev.wet);
    if (local) { ctx.flash?.(.55); ctx.shake?.(.7); } else ctx.shake?.(.35, at);
    light.position.copy(at); flashK = 1;
    if (!lightning) return;
    lightning.glow(at, {size: 5.5, life: .5, color: 0xffffff}); lightning.glow(at, {size: 3, life: .9, color: 0x9fd0ff});
    lightning.ring(new THREE.Vector3(at.x, ctx.height(at.x, at.z) + .04, at.z), {radius: 3.2, life: .6, color: 0xbfe2ff});
    lightning.burst(at, {count: 60, speed: 6.5, life: .8}); lightning.burst(at, {count: 24, speed: 3, up: 1.5});
    for (const [p, pole] of [[pa, 'red'], [pb, 'blue']]) {
      lightning.strike(p.clone(), at.clone(), {life: .35, width: .2, rough: .12, depth: 5, branches: 3, restrikes: 3, intensity: 1.8, hue: POLE[pole].hue});
      lightning.glow(p, {size: 2.2, life: .4, color: POLE[pole].glow});
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
    x.flare.position.copy(centre); x.flare.scale.setScalar((1.3 + .9 * flicker(time, 1)) * (1 + x.kick)); x.flare.material.opacity = .3 + .25 * f;
    x.core.position.copy(centre); x.core.scale.setScalar(.45 + .35 * flicker(time * 1.9, 7)); x.core.material.opacity = .5 + .4 * f;
    // Carriers: + -> body -> -.
    if (ctx.beads) for (let i = 0; i < 10; i++) {
      const u = ((time * 1.6 + i / 10) % 1), p = u < .5 ? v.lerpVectors(pa, centre, u * 2) : v.lerpVectors(centre, pb, u * 2 - 1);
      p.x += (Math.random() - .5) * .05; p.y += (Math.random() - .5) * .05; c3.copy(RED_HOT).lerp(BLUE_HOT, u); ctx.beads.add(p, c3, 1.1);
    }
    if (!lightning) return;
    x.since -= dt;
    if (x.since <= 0) {
      x.since = .045 + Math.random() * .04;
      // The main channel: from the + bolt into the body's core and out through the - bolt, red fading to blue.
      lightning.strike(pa.clone(), centre.clone(), {life: .1 + Math.random() * .06, width: .11, rough: .14, depth: 4, branches: 2, restrikes: 1, intensity: 1.5, hue: POLE.red.hue});
      lightning.strike(centre.clone(), pb.clone(), {life: .1 + Math.random() * .06, width: .11, rough: .14, depth: 4, branches: 2, restrikes: 1, intensity: 1.5, hue: POLE.blue.hue});
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
    // Surge: a white-hot flash that falls off fast; cook: a cooler flicker held while a victim is lit.
    light.intensity = 40 * flashK * flashK + 6 * cookK; light.color.setHex(flashK > .4 ? 0xeef6ff : 0x9fd0ff);
    flashK = Math.max(0, flashK - dt * 3.2); cookK = Math.max(0, cookK - dt * 8);
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
