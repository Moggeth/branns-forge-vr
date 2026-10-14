// Keep siege damage presentation: what a hit on a pylon, spire, gate ballista or heart looks like.
// Reads the authoritative hit events from shared/home-bases.js (home_part_hit, battle_base_hit, home_part_broken,
// home_siege_won); `blow` and `at` come from shared/combat.js on projectile hits ('chip' = a plain bolt or arrow that
// only scuffs the stone, 'magic' = a golden bolt). Everything animates on the frame clock:
//  - every hit throws stone chips and sparks from the impact point, with a flash; magic adds a gold rune ring;
//  - pylons and spires grow glowing cracks at two-thirds and one-third health (traced onto the real mesh);
//  - a pylon's crystal stutters as it weakens; a breaking part bursts into rubble;
//  - a small health bar floats over whatever was just hit, draining smoothly with a lagging ghost.
// Presentation only: never sends actions. Bounded pools keep it phone- and Quest-safe (about 8 draws when busy).
import * as THREE from 'three';

const CHIPS = 120, SPARKS = 80, FLASHES = 6, RINGS = 4, BARS = 3, BAR_SHOW = 3.6;
const STONE = {party: new THREE.Color(0xb9ad97), rivals: new THREE.Color(0x4f4656)};
const GLOW = {party: new THREE.Color(0x5fb4ff), rivals: new THREE.Color(0xb46cff)};
const GOLD = new THREE.Color(0xffcf4a), WARM = new THREE.Color(0xffd9a0);
const BLOW = Object.freeze({
  chip: {chips: 5, sparks: 7, speed: 3.2, flash: .7, color: WARM},
  hit: {chips: 10, sparks: 12, speed: 4.5, flash: 1.2, color: null},
  magic: {chips: 16, sparks: 22, speed: 6.5, flash: 2.2, color: GOLD},
  broken: {chips: 40, sparks: 26, speed: 7.5, flash: 3, color: null},
});
// Crack tiers: tier 1 shows below two-thirds health, tier 2 below one-third.
const TIERS = [2 / 3, 1 / 3];

function radialTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.25, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const rand = (a, b) => a + Math.random() * (b - a);

/**
 * lookup(id) -> {object, side, kind, data, heart?, part?} for a live target, or null.
 * `object` is the Object3D whose meshes are the target's visible body.
 */
export function createSiegeDamageView({root, lookup, height}) {
  const group = new THREE.Group(); group.name = 'siege-damage'; root.add(group);
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const radial = radialTexture();

  // Stone chips: one instanced draw.
  const chipMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({roughness: .9, flatShading: true}), CHIPS);
  chipMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); chipMesh.frustumCulled = false; chipMesh.count = 0;
  chipMesh.setColorAt(0, STONE.party); group.add(chipMesh);
  const chips = [];
  // Sparks: thin glowing streaks stretched along their flight, one instanced additive draw.
  const sparkGeo = new THREE.BoxGeometry(1, 1, 1); sparkGeo.translate(0, .5, 0);
  const sparkMesh = new THREE.InstancedMesh(sparkGeo, new THREE.MeshBasicMaterial({blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false}), SPARKS);
  sparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); sparkMesh.frustumCulled = false; sparkMesh.count = 0;
  sparkMesh.setColorAt(0, WARM); group.add(sparkMesh);
  const sparks = [];
  // Flashes (soft billboards) and gold rune rings, pooled.
  const flashGeo = new THREE.PlaneGeometry(1, 1), ringGeo = new THREE.RingGeometry(.82, 1, 40);
  const flashes = Array.from({length: FLASHES}, () => {
    const m = new THREE.Mesh(flashGeo, new THREE.MeshBasicMaterial({map: radial, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false}));
    m.visible = false; m.renderOrder = 6; group.add(m); return {mesh: m, start: 0, life: 0, size: 1};
  });
  const rings = Array.from({length: RINGS}, () => {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({color: GOLD, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false}));
    m.visible = false; m.renderOrder = 6; group.add(m); return {mesh: m, start: 0, life: 0, normal: new THREE.Vector3()};
  });

  // Health bars: background, lagging ghost and fill, drawn over the world.
  const barGeo = new THREE.PlaneGeometry(1, 1); barGeo.translate(.5, 0, 0);
  const barMat = (color, opacity) => new THREE.MeshBasicMaterial({color, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false});
  const bars = Array.from({length: BARS}, () => {
    const g = new THREE.Group(); g.visible = false; g.renderOrder = 20; group.add(g);
    const back = new THREE.Mesh(barGeo, barMat(0x0b0d12, .72)), ghost = new THREE.Mesh(barGeo, barMat(0xfff2d6, .85)), fill = new THREE.Mesh(barGeo, barMat(0xffffff, 1));
    for (const [m, z, h] of [[back, 0, .24], [ghost, .001, .16], [fill, .002, .16]]) { m.userData.alpha = m.material.opacity; m.position.set(-.5, 0, z); m.scale.set(1, h, 1); m.renderOrder = 20 + z * 1000; g.add(m); }
    back.position.x = -.52; back.scale.x = 1.04;
    return {group: g, fill, ghost, id: null, shown: 0, value: 1, lag: 1, lagHold: 0, top: new THREE.Vector3(), pulse: 0};
  });

  // Per-target cache: body bounds, crack ribbons and the hp we last saw (to flare the cracks on a hit).
  const targets = new Map();
  const ray = new THREE.Raycaster();
  function bodyMeshes(object) { const out = []; object.updateMatrixWorld(true); object.traverse(n => { if (n.isMesh && n.visible !== false && n.material?.visible !== false) out.push(n); }); return out; }
  function info(id) {
    const t = lookup(id); if (!t) return null;
    let c = targets.get(id);
    if (!c || c.object !== t.object) {
      if (c?.cracks) { c.cracks.removeFromParent(); c.cracks.geometry.dispose(); c.cracks.material.dispose(); }
      const box = new THREE.Box3().setFromObject(t.object);
      c = {object: t.object, box, centre: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()), cracks: null, crackFlare: 0, flicker: 0, orbScale: null};
      targets.set(id, c);
    }
    c.target = t; return c;
  }

  // Crack ribbons traced onto the real surface: jagged vertical runs, each vertex found by a ray fired at the body's axis.
  function buildCracks(c) {
    const meshes = bodyMeshes(c.object); if (!meshes.length) return null;
    const {box, centre, size} = c, R = Math.max(size.x, size.z) * .9 + .5, pos = [], col = [], idx = [], counts = [0, 0];
    // Each tier is a few main runs climbing the body in a zigzag, with short forks splitting off sideways.
    const r0 = Math.max(.25, Math.max(size.x, size.z) * .45), w = Math.max(.03, Math.min(.07, size.y * .01)), rise = size.y * .045;
    const glowA = new THREE.Color(.8, .8, .8), queue = [];
    for (const [tier, angle] of [[0, 0], [0, 2.1], [0, 4.2], [1, 1.05], [1, 3.15], [1, 5.3], [1, .4]])
      queue.push({tier, a: angle + rand(-.3, .3), y: box.min.y + size.y * rand(.12, .38), steps: 11, rise, zig: .22, fork: 2});
    while (queue.length) {
      const run = queue.shift(); let {a, y} = run, prev = null, last = null, lastN = null, sign = Math.random() < .5 ? 1 : -1;
      for (let s = 0; s <= run.steps; s++) {
        const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), from = new THREE.Vector3(centre.x + dir.x * R, y, centre.z + dir.z * R);
        ray.set(from, dir.clone().negate()); ray.far = R * 2;
        const hit = ray.intersectObjects(meshes, false)[0];
        if (hit) {
          const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : dir;
          // A crack only runs across one continuous face: a jump to another stone or a tusk starts a new run.
          if (last && (hit.point.distanceTo(last) > (run.rise + run.zig) * 1.6 || n.dot(lastN) < .5)) prev = null;
          last = hit.point.clone(); lastN = n.clone();
          const taper = 1 - s / run.steps * .7, p = hit.point.clone().addScaledVector(n, .02);
          const along = prev === null ? up : tmpV.subVectors(p, new THREE.Vector3(pos[prev * 3] / 2 + pos[prev * 3 + 3] / 2, pos[prev * 3 + 1], pos[prev * 3 + 2] / 2 + pos[prev * 3 + 5] / 2)).normalize();
          const side = new THREE.Vector3().crossVectors(n, along).normalize().multiplyScalar(w * taper * (run.fork ? 1 : .7));
          const base = pos.length / 3;
          pos.push(p.x - side.x, p.y - side.y, p.z - side.z, p.x + side.x, p.y + side.y, p.z + side.z);
          const fade = 1 - s / (run.steps + 2); for (let k = 0; k < 2; k++) col.push(glowA.r * fade, glowA.g * fade, glowA.b * fade);
          if (prev !== null) { idx.push(prev, prev + 1, base, prev + 1, base + 1, base); counts[run.tier] += 6; }
          prev = base;
          if (run.fork && s > 1 && s < run.steps - 2 && Math.random() < .28) { run.fork--; queue.unshift({tier: run.tier, a, y, steps: 4, rise: run.rise * .5, zig: run.zig * 1.6, fork: 0}); }
        } else { prev = null; last = null; }
        y += run.rise * rand(.6, 1.3); sign = -sign; a += sign * rand(.4, 1) * run.zig / r0;
      }
    }
    if (!idx.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setIndex(idx);
    geo.userData.tierEnds = [counts[0], counts[0] + counts[1]]; geo.setDrawRange(0, 0);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({color: GLOW[c.target.side] || GLOW.rivals, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2}));
    mesh.renderOrder = 4; mesh.frustumCulled = true; geo.computeBoundingSphere(); group.add(mesh);
    return mesh;
  }

  function impactPoint(c, ev) {
    if (Array.isArray(ev.at) && ev.at.every(Number.isFinite)) return tmpV.set(...ev.at).clone();
    // Melee, spells and ballistas: a point on the body's near face at chest-to-head height.
    const {centre, size, box} = c, a = Math.random() * Math.PI * 2, r = Math.max(size.x, size.z) * .42;
    return new THREE.Vector3(centre.x + Math.cos(a) * r, box.min.y + size.y * rand(.35, .7), centre.z + Math.sin(a) * r);
  }

  function burst(at, c, kind, side) {
    const spec = BLOW[kind] || BLOW.hit, now = performance.now(), stone = STONE[side] || STONE.rivals, glow = spec.color || GLOW[side] || WARM;
    const out = new THREE.Vector3(at.x - c.centre.x, 0, at.z - c.centre.z); if (out.lengthSq() < 1e-4) out.set(1, 0, 0); out.normalize();
    const ground = height ? height(at.x, at.z) : c.box.min.y;
    for (let i = 0; i < spec.chips; i++) {
      if (chips.length >= CHIPS) chips.shift();
      const v = out.clone().multiplyScalar(spec.speed * rand(.35, 1)).add(new THREE.Vector3(rand(-1.4, 1.4), rand(1, 3.4), rand(-1.4, 1.4)));
      chips.push({p: at.clone(), v, spin: new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9)), r: new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)),
        s: rand(.04, kind === 'broken' ? .22 : .12), born: now, life: rand(900, 1500), ground, color: stone.clone().multiplyScalar(rand(.7, 1.15))});
    }
    for (let i = 0; i < spec.sparks; i++) {
      if (sparks.length >= SPARKS) sparks.shift();
      const v = out.clone().multiplyScalar(spec.speed * rand(.6, 1.6)).add(new THREE.Vector3(rand(-2.5, 2.5), rand(-.5, 3.5), rand(-2.5, 2.5)));
      sparks.push({p: at.clone(), v, born: now, life: rand(220, 460), color: (Math.random() < .4 ? WARM : glow).clone()});
    }
    const f = flashes.reduce((a, b) => (a.start <= b.start ? a : b));
    f.mesh.position.copy(at).addScaledVector(out, .15); f.start = now; f.life = 140 + spec.flash * 80; f.size = spec.flash; f.mesh.material.color.copy(glow); f.mesh.visible = true;
    if (kind === 'magic' || kind === 'broken') {
      const r = rings.reduce((a, b) => (a.start <= b.start ? a : b));
      r.mesh.position.copy(at).addScaledVector(out, .1); r.normal.copy(out); r.start = now; r.life = kind === 'magic' ? 520 : 700;
      r.mesh.material.color.copy(kind === 'magic' ? GOLD : glow); r.mesh.visible = true;
    }
  }

  function showBar(id, c, at) {
    let b = bars.find(x => x.id === id) || bars.find(x => !x.id) || bars.reduce((a, x) => (a.shown <= x.shown ? a : x));
    if (b.id !== id) { const f = frac(c); b.id = id; b.value = f; b.lag = f; }
    b.shown = BAR_SHOW; b.pulse = 1; b.lagHold = .35; b.anchorY = at ? Math.min(c.box.max.y + .55, at.y + 1.8) : c.box.max.y + .55;
    b.fill.material.color.copy(GLOW[c.target.side] || GLOW.rivals).lerp(new THREE.Color(1, 1, 1), .15);
  }
  const frac = c => { const d = c.target.data; return d.maxHp > 0 ? Math.max(0, Math.min(1, d.hp / d.maxHp)) : 0; };

  function event(ev) {
    if (!ev) return;
    if (ev.kind === 'home_part_hit' || ev.kind === 'battle_base_hit') {
      const c = info(ev.id); if (!c) return;
      const at = impactPoint(c, ev); burst(at, c, ev.blow || 'hit', ev.side);
      c.crackFlare = ev.blow === 'chip' ? .5 : 1; c.flicker = 1; showBar(ev.id, c, at);
    } else if (ev.kind === 'home_part_broken') {
      const c = info(ev.id); if (!c) return;
      for (let i = 0; i < 3; i++) { const p = c.centre.clone(); p.y = c.box.min.y + c.size.y * (.25 + i * .25); burst(p, c, 'broken', ev.side); }
      const b = bars.find(x => x.id === ev.id); if (b) b.shown = Math.min(b.shown, .8);
    } else if (ev.kind === 'home_siege_won') {
      const c = info(`battle-base-${ev.fallen}`); if (!c) return;
      for (let i = 0; i < 4; i++) { const p = c.centre.clone(); p.y = c.box.min.y + c.size.y * (.3 + i * .18); burst(p, c, 'broken', ev.fallen); }
    }
  }

  function update(dt, camera) {
    const now = performance.now(), g = 9.8;
    // Chips: tumble, fall, skip once on the ground and settle, then shrink away.
    let n = 0;
    for (let i = chips.length - 1; i >= 0; i--) {
      const c = chips[i], u = (now - c.born) / c.life;
      if (u >= 1) { chips.splice(i, 1); continue; }
      c.v.y -= g * dt; c.p.addScaledVector(c.v, dt);
      if (c.p.y < c.ground + c.s) { c.p.y = c.ground + c.s; c.v.y = Math.abs(c.v.y) * .3; c.v.x *= .55; c.v.z *= .55; c.spin.multiplyScalar(.5); }
      c.r.x += c.spin.x * dt; c.r.y += c.spin.y * dt; c.r.z += c.spin.z * dt;
      const s = c.s * (u > .75 ? (1 - u) / .25 : 1);
      tmpM.compose(c.p, tmpQ.setFromEuler(c.r), tmpS.set(s, s * .8, s * 1.1)); chipMesh.setMatrixAt(n, tmpM); chipMesh.setColorAt(n, c.color); n++;
    }
    chipMesh.count = n; chipMesh.visible = n > 0; if (n) { chipMesh.instanceMatrix.needsUpdate = true; chipMesh.instanceColor.needsUpdate = true; }
    // Sparks: fast streaks that arc down and fade.
    n = 0;
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i], u = (now - s.born) / s.life;
      if (u >= 1) { sparks.splice(i, 1); continue; }
      s.v.y -= g * .6 * dt; s.p.addScaledVector(s.v, dt);
      const speed = s.v.length(), len = Math.min(.45, speed * .035) * (1 - u * .5), w = .025 * (1 - u);
      tmpQ.setFromUnitVectors(up, tmpV.copy(s.v).divideScalar(speed || 1));
      tmpM.compose(s.p, tmpQ, tmpS.set(w, len, w)); sparkMesh.setMatrixAt(n, tmpM); sparkMesh.setColorAt(n, s.color.clone().multiplyScalar(1 - u)); n++;
    }
    sparkMesh.count = n; sparkMesh.visible = n > 0; if (n) { sparkMesh.instanceMatrix.needsUpdate = true; sparkMesh.instanceColor.needsUpdate = true; }
    for (const f of flashes) {
      if (!f.mesh.visible) continue;
      const u = (now - f.start) / f.life; if (u >= 1) { f.mesh.visible = false; continue; }
      f.mesh.quaternion.copy(camera.quaternion); f.mesh.scale.setScalar(f.size * (.6 + u * .9)); f.mesh.material.opacity = (1 - u) * (1 - u);
    }
    for (const r of rings) {
      if (!r.mesh.visible) continue;
      const u = (now - r.start) / r.life; if (u >= 1) { r.mesh.visible = false; continue; }
      r.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), r.normal); r.mesh.scale.setScalar(.3 + u * 1.9); r.mesh.material.opacity = 1 - u;
    }
    // Cracks and pylon stutter, per damaged target.
    const t = now / 1000;
    for (const [id, c] of targets) {
      const live = lookup(id); if (live) c.target = live;
      const d = c.target?.data; if (!d) continue;
      const f = live && d.hp > 0 ? frac(c) : 1, tier = f <= TIERS[1] ? 2 : f <= TIERS[0] ? 1 : 0;
      const crackable = c.target.kind === 'pylon' || c.target.kind === 'spire';
      if (crackable && tier && !c.cracks) c.cracks = buildCracks(c);
      if (c.cracks) {
        const ends = c.cracks.geometry.userData.tierEnds; c.cracks.geometry.setDrawRange(0, tier ? ends[tier - 1] : 0); c.cracks.visible = tier > 0;
        c.crackFlare = Math.max(0, c.crackFlare - dt * 2.2);
        c.cracks.material.opacity = Math.min(1, .45 + tier * .2 + Math.sin(t * (2 + tier * 2.5)) * .12 + c.crackFlare * .6);
      }
      const orb = c.target.part?.orb;
      if (orb) {
        if (!c.orbScale) c.orbScale = orb.scale.clone();
        c.flicker = Math.max(0, c.flicker - dt * 3);
        const hurt = 1 - f, stutter = hurt > .3 ? (Math.sin(t * 23) * Math.sin(t * 7.3) > .55 - hurt * .4 ? .55 : 1) : 1;
        orb.scale.copy(c.orbScale).multiplyScalar((1 - hurt * .25) * stutter * (1 + c.flicker * .25));
      }
    }
    // Health bars over the struck target, facing the camera at a readable size.
    for (const b of bars) {
      if (!b.id) continue;
      b.shown -= dt;
      const c = targets.get(b.id), live = c && lookup(b.id);
      if (b.shown <= 0 || !live) { b.group.visible = false; b.id = null; continue; }
      c.target = live;
      const f = frac(c); b.value += (f - b.value) * (1 - Math.exp(-dt * 14));
      b.lagHold -= dt; if (b.lagHold <= 0) b.lag += (b.value - b.lag) * (1 - Math.exp(-dt * 3.5)); if (b.lag < b.value) b.lag = b.value;
      b.pulse = Math.max(0, b.pulse - dt * 4);
      b.top.set(c.centre.x, b.anchorY ?? c.box.max.y + .55, c.centre.z);
      const dist = camera.position.distanceTo(b.top), k = Math.min(5, Math.max(.9, dist * .07)) * (1 + b.pulse * .08);
      b.group.position.copy(b.top); b.group.quaternion.copy(camera.quaternion); b.group.scale.set(k * 1.6, k, k);
      b.fill.scale.x = Math.max(.0001, b.value); b.ghost.scale.x = Math.max(.0001, b.lag);
      const fade = Math.min(1, b.shown / .4); for (const m of b.group.children) m.material.opacity = m.userData.alpha * fade;
      b.group.visible = true;
    }
  }

  function reset() {
    for (const c of targets.values()) if (c.cracks) { c.cracks.removeFromParent(); c.cracks.geometry.dispose(); c.cracks.material.dispose(); }
    targets.clear(); for (const b of bars) { b.id = null; b.group.visible = false; }
  }
  /** Drop a target's cache (it was rebuilt, mended to full, or the base rebuilt). */
  function forget(id) { const c = targets.get(id); if (c?.cracks) { c.cracks.removeFromParent(); c.cracks.geometry.dispose(); c.cracks.material.dispose(); } if (c?.orbScale && c.target?.part?.orb) c.target.part.orb.scale.copy(c.orbScale); targets.delete(id); }

  return {event, update, reset, forget, stats: () => ({chips: chips.length, sparks: sparks.length, targets: targets.size, cracked: [...targets.values()].filter(c => c.cracks?.visible).length, bars: bars.filter(b => b.id).length}),
    dispose() { reset(); group.removeFromParent(); chipMesh.geometry.dispose(); chipMesh.material.dispose(); sparkGeo.dispose(); sparkMesh.material.dispose(); flashGeo.dispose(); ringGeo.dispose(); radial?.dispose();
      for (const f of flashes) f.mesh.material.dispose(); for (const r of rings) r.mesh.material.dispose(); for (const b of bars) b.group.traverse(m => m.material?.dispose()); barGeo.dispose(); }};
}
