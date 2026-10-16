// The Brinedeep's dangers, drawn (rules: shared/salt-mine-rules.js). Presentation only; every frame from the
// interpolated presentation tick, nothing tick-stepped.
// - A roof about to fall (snapshot.mines.falls): grit trickling from the roof and a dark ring growing on the floor
//   under it, tightening and quickening as the fall nears, so you can see where to jump clear.
// - The fall (mine_fall): salt-rock chunks dropping and bouncing, a dust burst rolling out, a jolt of the view.
// - Firedamp: a sickly yellow-green seep curling over each full vent; the blast (firedamp_blast) is a white-gold flash,
//   a rolling fireball and a ring of sparks, with the viewer's pooled lantern light thrown to it for a moment.
// Pooled: one points cloud for dust, one for glow, one instanced mesh of rocks, one of warning rings, two fireballs.
import * as THREE from 'three';
import {SALT} from '../shared/salt-mine-rules.js';
import {MINE_SIDES, mineCeiling} from '../shared/salt-mines.js';
import {ventPoint} from '../shared/salt-mine-rules.js';

const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
function softDot() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.35, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// A pool of soft particles in one Points draw: position, velocity, life, size and colour per slot.
function particlePool(n, {additive = false, name}) {
  const g = new THREE.BufferGeometry(), p = new Float32Array(n * 3), c = new Float32Array(n * 3), s = new Float32Array(n);
  g.setAttribute('position', new THREE.BufferAttribute(p, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(c, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('size', new THREE.BufferAttribute(s, 1).setUsage(THREE.DynamicDrawUsage));
  const map = softDot();
  const m = new THREE.ShaderMaterial({
    uniforms: {uMap: {value: map}, uScale: {value: 600}},
    vertexShader: `attribute float size; varying vec3 vColor; uniform float uScale;
      void main(){ vColor = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * uScale / max(.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D uMap; varying vec3 vColor;
      void main(){ vec4 t = texture2D(uMap, gl_PointCoord); float a = t.a * ${additive ? '1.0' : '.75'}; if (a < .01) discard; gl_FragColor = vec4(vColor * ${additive ? 'a' : '1.0'}, ${additive ? 'a' : 'a'}); }`,
    vertexColors: true, transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const points = new THREE.Points(g, m); points.name = name; points.frustumCulled = false; points.raycast = () => {}; points.renderOrder = 3;
  const vel = new Float32Array(n * 3), life = new Float32Array(n), max = new Float32Array(n), size = new Float32Array(n), col = new Float32Array(n * 3), drag = new Float32Array(n), grav = new Float32Array(n);
  let next = 0, live = 0;
  return {
    points,
    spawn(x, y, z, vx, vy, vz, {life: l = 1, size: sz = .2, color = [1, 1, 1], drag: dr = 1, gravity = 0} = {}) {
      const i = next; next = (next + 1) % n;
      p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z; vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
      life[i] = max[i] = l; size[i] = sz; col.set(color, i * 3); drag[i] = dr; grav[i] = gravity;
    },
    update(dt) {
      live = 0;
      for (let i = 0; i < n; i++) {
        if (life[i] <= 0) { s[i] = 0; continue; }
        life[i] -= dt; live++;
        const k = Math.exp(-drag[i] * dt);
        vel[i * 3] *= k; vel[i * 3 + 1] = vel[i * 3 + 1] * k - grav[i] * dt; vel[i * 3 + 2] *= k;
        p[i * 3] += vel[i * 3] * dt; p[i * 3 + 1] += vel[i * 3 + 1] * dt; p[i * 3 + 2] += vel[i * 3 + 2] * dt;
        const t = clamp(life[i] / max[i]), fade = Math.min(1, (1 - t) * 6) * t;
        s[i] = size[i] * (1.6 - .6 * t);
        c[i * 3] = col[i * 3] * fade; c[i * 3 + 1] = col[i * 3 + 1] * fade; c[i * 3 + 2] = col[i * 3 + 2] * fade;
      }
      for (const a of ['position', 'color', 'size']) g.attributes[a].needsUpdate = true;
    },
    live: () => live,
    dispose() { g.dispose(); m.dispose(); map.dispose(); },
  };
}

export function createSaltMineHazards({scene, height, rockMaterial, quality = 'high', kick = () => {}, sound = () => {}, lantern = null} = {}) {
  const low = quality === 'low', group = new THREE.Group(); group.name = 'SaltMineHazards'; scene.add(group);
  const dust = particlePool(low ? 260 : 520, {name: 'salt-mine-dust'}), sparks = particlePool(low ? 220 : 420, {additive: true, name: 'salt-mine-glow'});
  group.add(dust.points, sparks.points);
  // Falling chunks: salt rock, bouncing once or twice and settling into the rubble the sim leaves.
  const ROCKS = 36, rockGeo = new THREE.DodecahedronGeometry(.16, 0);
  const rocks = new THREE.InstancedMesh(rockGeo, rockMaterial, ROCKS); rocks.name = 'salt-mine-rocks'; rocks.frustumCulled = false; rocks.raycast = () => {};
  const rockState = Array.from({length: ROCKS}, () => ({life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), s: 1}));
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < ROCKS; i++) rocks.setMatrixAt(i, hidden);
  group.add(rocks);
  let rockNext = 0;
  // Warning rings on the floor under a roof about to come down.
  const RINGS = SALT.fall.cap * 2, ringGeo = new THREE.RingGeometry(.55, 1, 40); ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({color: 0x1a0a08, transparent: true, opacity: .55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4});
  const shadowGeo = new THREE.CircleGeometry(1, 32); shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({color: 0x120606, transparent: true, opacity: .35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4});
  const rings = new THREE.InstancedMesh(ringGeo, ringMat, RINGS), shadows = new THREE.InstancedMesh(shadowGeo, shadowMat, RINGS);
  for (const m of [rings, shadows]) { m.frustumCulled = false; m.raycast = () => {}; m.renderOrder = 2; m.count = 0; group.add(m); }
  // Fireballs: a hot core and a rolling outer shell, additive, two in the pool.
  const fireGeo = new THREE.IcosahedronGeometry(1, low ? 2 : 3);
  const fires = [0, 1].map(() => {
    const outer = new THREE.Mesh(fireGeo, new THREE.MeshBasicMaterial({color: 0xff6418, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false}));
    const core = new THREE.Mesh(fireGeo, new THREE.MeshBasicMaterial({color: 0xfff0b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false}));
    outer.visible = core.visible = false; outer.raycast = core.raycast = () => {}; group.add(outer, core);
    return {outer, core, t: 9, at: new THREE.Vector3()};
  });
  let fireNext = 0, flash = 0;
  const flashAt = new THREE.Vector3(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v3 = new THREE.Vector3(), eye = new THREE.Vector3();
  const stat = {warnings: 0, falls: 0, blasts: 0, seeping: 0};
  let seepClock = 0, grit = 0;
  const rnd = (() => { let s = 1234567; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 1013904223 | 0) >>> 0) / 4294967296; })();

  function fall(position, roof) {
    const [x, y, z] = position, top = Number.isFinite(roof) ? roof : y + 3;
    for (let k = 0; k < (low ? 9 : 14); k++) {
      const r = rockState[rockNext]; rockNext = (rockNext + 1) % ROCKS;
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * SALT.fall.radius * .7;
      r.p.set(x + Math.cos(a) * d, top - .2 - rnd() * .5, z + Math.sin(a) * d); r.v.set((rnd() - .5) * .6, -1 - rnd() * 1.5, (rnd() - .5) * .6);
      r.w.set(rnd() * 8 - 4, rnd() * 8 - 4, rnd() * 8 - 4); r.r.set(rnd() * 6, rnd() * 6, rnd() * 6); r.s = .6 + rnd() * 1.1; r.life = 2.4 + rnd() * .6;
    }
    // Dust rolls out along the floor and hangs in the lantern light.
    for (let k = 0; k < (low ? 26 : 50); k++) {
      const a = rnd() * Math.PI * 2, sp = 1.2 + rnd() * 2.6;
      dust.spawn(x + Math.cos(a) * .4, y + .15 + rnd() * .5, z + Math.sin(a) * .4, Math.cos(a) * sp, .25 + rnd() * .7, Math.sin(a) * sp, {life: 1.6 + rnd() * 1.8, size: .35 + rnd() * .45, color: [.78, .62, .6], drag: 1.8});
    }
    for (let k = 0; k < (low ? 10 : 18); k++) dust.spawn(x + (rnd() - .5) * 1.4, top - rnd() * .8, z + (rnd() - .5) * 1.4, 0, -1.4 - rnd(), 0, {life: .9 + rnd() * .5, size: .2 + rnd() * .2, color: [.85, .7, .68], drag: .6});
  }
  function blast(position) {
    const [x, y, z] = position, f = fires[fireNext]; fireNext = (fireNext + 1) % fires.length;
    f.t = 0; f.at.set(x, y + .3, z); f.outer.visible = f.core.visible = true;
    flash = 1; flashAt.set(x, y + 1.2, z);
    for (let k = 0; k < (low ? 70 : 140); k++) {
      const a = rnd() * Math.PI * 2, e = rnd() * 1.2 - .1, sp = 3 + rnd() * 6;
      sparks.spawn(x, y + .5, z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 1, Math.sin(a) * Math.cos(e) * sp, {life: .5 + rnd() * .9, size: .1 + rnd() * .14, color: rnd() < .3 ? [1, .95, .7] : [1, .55, .2], drag: 1.4, gravity: 3});
    }
    for (let k = 0; k < (low ? 22 : 40); k++) {
      const a = rnd() * Math.PI * 2, sp = 1.5 + rnd() * 3;
      dust.spawn(x, y + .3 + rnd(), z, Math.cos(a) * sp, .4 + rnd(), Math.sin(a) * sp, {life: 2 + rnd() * 2, size: .5 + rnd() * .5, color: [.35, .26, .24], drag: 1.2});
    }
  }

  return {
    group,
    event(event, viewer) {
      if (!event?.position) return;
      const dist = viewer ? viewer.distanceTo(v3.set(...event.position)) : 99;
      if (event.kind === 'mine_creak') { sound('mine_creak', event.position); grit = Math.max(grit, 1); }
      else if (event.kind === 'mine_fall') { fall(event.position, event.roof); stat.falls++; sound('mine_fall', event.position); kick(clamp(1.2 - dist / 14) * .9); }
      else if (event.kind === 'firedamp_blast') { blast(event.position); stat.blasts++; sound('firedamp_boom', event.position); kick(clamp(1.4 - dist / 22) * 1.6); }
    },
    /** snapshot: the latest sim snapshot (falls on their way and the vents' fill); tick: the presentation tick. */
    update(dt, {snapshot, tick, camera} = {}) {
      dt = Math.min(dt || 0, .1);
      if (camera) camera.getWorldPosition(eye);
      // Warnings.
      const falls = snapshot?.mines?.falls || [];
      let n = 0;
      for (const f of falls) {
        const left = f.fallTick - tick; if (left < -2 || left > SALT.fall.warnTicks + 4 || n >= RINGS) continue;
        const k = clamp(1 - left / SALT.fall.warnTicks), y = height(f.x, f.z), r = SALT.fall.radius;
        const pulse = .5 + .5 * Math.sin(tick * (.12 + .5 * k * k));
        m4.compose(v3.set(f.x, y + .03, f.z), q.identity(), sc.set(r * (1.15 - .15 * k), 1, r * (1.15 - .15 * k))); rings.setMatrixAt(n, m4);
        m4.compose(v3.set(f.x, y + .025, f.z), q.identity(), sc.set(r * (.35 + .65 * k), 1, r * (.35 + .65 * k))); shadows.setMatrixAt(n, m4);
        n++;
        // grit trickling from the roof: more and faster as the moment nears
        const rate = (6 + 40 * k * k) * (low ? .5 : 1) * dt;
        const roof = y + Math.max(2.2, mineCeiling(f.x, f.z) - .3);
        for (let c = rate + rnd(); c >= 1; c--) { const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r * .8; dust.spawn(f.x + Math.cos(a) * d, roof, f.z + Math.sin(a) * d, 0, -.8 - 2 * k - rnd(), 0, {life: .8 + rnd() * .6, size: .06 + rnd() * .08 + .1 * k * rnd(), color: [.9, .78, .76], drag: .3}); }
        ringMat.opacity = .35 + .35 * pulse * k;
      }
      stat.warnings = n; rings.count = shadows.count = n;
      if (n) { rings.instanceMatrix.needsUpdate = true; shadows.instanceMatrix.needsUpdate = true; }
      // Firedamp seeping over full vents, a sickly glow of yellow-green wisps.
      seepClock += dt; stat.seeping = 0;
      if (snapshot?.mines) for (const side of MINE_SIDES) for (let i = 0; i < 2; i++) {
        if (!(snapshot.tick >= (snapshot.mines[side]?.damp?.[i] ?? 0))) continue;
        const [x, z] = ventPoint(side, i); if (eye.distanceToSquared(v3.set(x, eye.y, z)) > 30 * 30) continue;
        stat.seeping++;
        const y = height(x, z) + .3, rate = (low ? 5 : 10) * dt;
        for (let c = rate + rnd(); c >= 1; c--) { const a = rnd() * Math.PI * 2, d = rnd() * .35; sparks.spawn(x + Math.cos(a) * d, y, z + Math.sin(a) * d, Math.cos(a + 1.6) * .18, .22 + rnd() * .25, Math.sin(a + 1.6) * .18, {life: 2.2 + rnd() * 1.6, size: .28 + rnd() * .3, color: [.32, .4, .08], drag: .5}); }
      }
      // Rocks.
      let rocksLive = 0;
      for (let i = 0; i < ROCKS; i++) {
        const r = rockState[i]; if (r.life <= 0) continue;
        r.life -= dt; rocksLive++;
        r.v.y -= 14 * dt; r.p.addScaledVector(r.v, dt);
        const floor = height(r.p.x, r.p.z) + .1 * r.s;
        if (r.p.y < floor) { r.p.y = floor; if (r.v.y < -1.2) { r.v.y *= -.32; r.v.x *= .6; r.v.z *= .6; r.w.multiplyScalar(.6); } else { r.v.set(0, 0, 0); r.w.multiplyScalar(.85); } }
        r.r.x += r.w.x * dt; r.r.y += r.w.y * dt; r.r.z += r.w.z * dt;
        const shrink = r.life < .5 ? r.life / .5 : 1;
        m4.compose(r.p, q.setFromEuler(r.r), sc.setScalar(r.s * shrink)); rocks.setMatrixAt(i, r.life > 0 ? m4 : hidden);
      }
      if (rocksLive || rocks.userData.wasLive) rocks.instanceMatrix.needsUpdate = true;
      rocks.userData.wasLive = rocksLive > 0;
      // Fireballs.
      for (const f of fires) {
        if (f.t > 1.4) { f.outer.visible = f.core.visible = false; continue; }
        f.t += dt; const t = f.t, R = SALT.damp.radius;
        const grow = 1 - Math.pow(1 - clamp(t / .35), 3), fade = clamp(1 - (t - .15) / 1.1);
        f.outer.position.copy(f.at).y += grow * 1.1; f.outer.scale.setScalar(.4 + grow * R * .75); f.outer.material.opacity = .42 * fade * fade;
        f.core.position.copy(f.at).y += grow * .7; f.core.scale.setScalar(.25 + grow * R * .38); f.core.material.opacity = .55 * clamp(1 - t / .5);
        f.outer.rotation.y += dt * 1.3; f.core.rotation.y -= dt * 2;
      }
      dust.update(dt); sparks.update(dt);
      // The viewer's lantern is the mine's one light: a blast throws it out to the fireball for a heartbeat.
      if (lantern && flash > 0) { flash = Math.max(0, flash - dt * 1.6); const k = flash * flash; lantern.position.lerp(flashAt, Math.min(1, k * 1.5)); lantern.intensity = Math.max(lantern.intensity, 34 * k); lantern.distance = 13 + 14 * k; lantern.color.setRGB(1, .75 - .2 * k, .48 - .3 * k); }
      else if (lantern) { lantern.distance = 13; lantern.color.set(0xffc07a); }
      grit = Math.max(0, grit - dt);
    },
    stats: () => ({...stat, dust: dust.live(), sparks: sparks.live()}),
    dispose() { scene.remove(group); dust.dispose(); sparks.dispose(); rockGeo.dispose(); ringGeo.dispose(); ringMat.dispose(); shadowGeo.dispose(); shadowMat.dispose(); fireGeo.dispose(); for (const f of fires) { f.outer.material.dispose(); f.core.material.dispose(); } },
  };
}
