import * as THREE from 'three';
// Presentation for the skeleton warband's violent moments (no lights, no bloom: Quest-safe, 4 draws total):
// - Golden Siegebird bolt: twin spiral contrails of gold sparks wound round its flight line.
// - Radiant pierce: where a golden bolt bursts through a shield, body or bones, a white-gold flash, two
//   shock rings square to the flight, a forward exit spray and slow-falling embers.
// - Shield break: the shield splinters into tumbling wood or iron shards (gold-edged when a golden bolt did it).
// One additive point pool (sparks, embers, contrails), one instanced shard pool, one billboard pool
// (flash, rings). Everything is pooled and bounded; nothing allocates per frame.
const SPARKS = 1400, SHARDS = 96, CARDS = 24;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
function hash(seed, n) {let h = Math.imul(seed ^ Math.imul(n + 1, 0x9e3779b1), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296;}
function seedOf(text) {let h = 0x811c9dc5; for (const c of String(text)) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193); return h >>> 0;}
const GOLD = [1, .78, .3], WHITE_GOLD = [1, .95, .75];
const SHIELD_COLOURS = {wood: [[.5, .33, .18], [.62, .45, .26], [.32, .4, .2]], iron: [[.42, .42, .45], [.5, .3, .18], [.6, .6, .62]]};

function sparkMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: {scale: {value: 400}},
    vertexShader: `attribute vec4 tint; attribute float size; varying vec4 vTint; uniform float scale;
      void main(){ vTint=tint; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=size*scale/max(.1,-mv.z); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `varying vec4 vTint; void main(){ vec2 p=gl_PointCoord*2.-1.; float r=dot(p,p); if(r>1.)discard; float core=exp(-r*4.); gl_FragColor=vec4(vTint.rgb*(core*1.6+.15),vTint.a*core); }`,
  });
}
function glowTexture(ring) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (ring) {grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(.62, 'rgba(255,255,255,0)'); grad.addColorStop(.8, 'rgba(255,255,255,1)'); grad.addColorStop(1, 'rgba(255,255,255,0)');}
  else {grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(.25, 'rgba(255,240,200,.75)'); grad.addColorStop(1, 'rgba(255,200,80,0)');}
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function createSkeletonFx({scene, height = () => 0, audio = () => null}) {
  const group = new THREE.Group(); group.name = 'skeleton-fx'; group.userData.ignoreContact = true; scene.add(group);
  // ---- spark pool ----
  const sp = {n: 0, pos: new Float32Array(SPARKS * 3), vel: new Float32Array(SPARKS * 3), tint: new Float32Array(SPARKS * 4), size: new Float32Array(SPARKS), life: new Float32Array(SPARKS), max: new Float32Array(SPARKS), grav: new Float32Array(SPARKS), drag: new Float32Array(SPARKS), col: new Float32Array(SPARKS * 3), base: new Float32Array(SPARKS)};
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp.pos, 3).setUsage(THREE.DynamicDrawUsage));
  sg.setAttribute('tint', new THREE.BufferAttribute(sp.tint, 4).setUsage(THREE.DynamicDrawUsage));
  sg.setAttribute('size', new THREE.BufferAttribute(sp.size, 1).setUsage(THREE.DynamicDrawUsage));
  const sparkMat = sparkMaterial(), points = new THREE.Points(sg, sparkMat); points.frustumCulled = false; points.userData.ignoreContact = true; group.add(points);
  function spark(x, y, z, vx, vy, vz, c, size, life, grav = 0, drag = 1.5) {
    let i = sp.n < SPARKS ? sp.n++ : -1;
    if (i < 0) {let best = 0, low = Infinity; for (let k = 0; k < SPARKS; k++) if (sp.life[k] < low) {low = sp.life[k]; best = k;} i = best;}
    const k = i * 3; sp.pos[k] = x; sp.pos[k + 1] = y; sp.pos[k + 2] = z; sp.vel[k] = vx; sp.vel[k + 1] = vy; sp.vel[k + 2] = vz; sp.col[k] = c[0]; sp.col[k + 1] = c[1]; sp.col[k + 2] = c[2];
    sp.base[i] = size; sp.life[i] = life; sp.max[i] = life; sp.grav[i] = grav; sp.drag[i] = drag;
  }
  function stepSparks(dt) {
    for (let i = 0; i < sp.n; i++) {
      sp.life[i] -= dt;
      if (sp.life[i] <= 0) { // swap-remove
        const j = --sp.n; if (i !== j) {
          for (const [a, w] of [[sp.pos, 3], [sp.vel, 3], [sp.col, 3]]) a.copyWithin(i * w, j * w, j * w + w);
          sp.base[i] = sp.base[j]; sp.life[i] = sp.life[j]; sp.max[i] = sp.max[j]; sp.grav[i] = sp.grav[j]; sp.drag[i] = sp.drag[j];
        }
        i--; continue;
      }
      const k = i * 3, f = Math.exp(-sp.drag[i] * dt);
      sp.vel[k] *= f; sp.vel[k + 1] = sp.vel[k + 1] * f - sp.grav[i] * dt; sp.vel[k + 2] *= f;
      sp.pos[k] += sp.vel[k] * dt; sp.pos[k + 1] += sp.vel[k + 1] * dt; sp.pos[k + 2] += sp.vel[k + 2] * dt;
      const g = height(sp.pos[k], sp.pos[k + 2]); if (sp.pos[k + 1] < g) {sp.pos[k + 1] = g; sp.vel[k + 1] *= -.3; sp.vel[k] *= .5; sp.vel[k + 2] *= .5;}
      const u = sp.life[i] / sp.max[i], a = Math.min(1, u * 2.2);
      sp.tint[i * 4] = sp.col[k]; sp.tint[i * 4 + 1] = sp.col[k + 1] * (.7 + .3 * u); sp.tint[i * 4 + 2] = sp.col[k + 2] * u; sp.tint[i * 4 + 3] = a;
      sp.size[i] = sp.base[i] * (.45 + .55 * u);
    }
    sg.setDrawRange(0, sp.n);
    for (const name of ['position', 'tint', 'size']) sg.attributes[name].needsUpdate = true;
  }
  // ---- shards ----
  const shardGeo = new THREE.BoxGeometry(1, 1, 1);
  const shardMat = new THREE.MeshStandardMaterial({roughness: .8, metalness: .1, vertexColors: false});
  const shardMesh = new THREE.InstancedMesh(shardGeo, shardMat, SHARDS); shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); shardMesh.count = 0; shardMesh.frustumCulled = false; shardMesh.userData.ignoreContact = true;
  shardMesh.setColorAt(0, new THREE.Color()); group.add(shardMesh);
  const shards = []; const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color();
  function shard(p, v, size, colour, spin, life, glow) {
    if (shards.length >= SHARDS) shards.shift();
    shards.push({p: p.clone(), v: v.clone(), q: new THREE.Quaternion().setFromEuler(_e.set(spin.x * 3, spin.y * 3, spin.z * 3)), w: spin, size, colour, life, max: life, glow, rest: false});
  }
  function stepShards(dt) {
    let n = 0;
    for (let i = shards.length - 1; i >= 0; i--) if ((shards[i].life -= dt) <= 0) shards.splice(i, 1);
    for (const s of shards) {
      if (!s.rest) {
        s.v.y -= 9.8 * dt; s.p.addScaledVector(s.v, dt);
        _q.setFromEuler(_e.set(s.w.x * dt, s.w.y * dt, s.w.z * dt)); s.q.premultiply(_q);
        const g = height(s.p.x, s.p.z) + s.size.y * .5;
        if (s.p.y < g) {s.p.y = g; s.v.y = Math.abs(s.v.y) > 1.2 ? -s.v.y * .3 : 0; s.v.x *= .55; s.v.z *= .55; s.w.multiplyScalar(.5); if (s.v.lengthSq() < .02) s.rest = true;}
      }
      const fade = Math.min(1, s.life / .6);
      _s.copy(s.size).multiplyScalar(fade);
      shardMesh.setMatrixAt(n, _m.compose(s.p, s.q, _s));
      const g = s.glow * Math.min(1, (s.max - s.life) < .8 ? 1 : s.life / s.max * 2);
      shardMesh.setColorAt(n, _c.setRGB(s.colour[0] + g, s.colour[1] + g * .75, s.colour[2] + g * .3));
      n++;
    }
    shardMesh.count = n; shardMesh.instanceMatrix.needsUpdate = true; if (shardMesh.instanceColor) shardMesh.instanceColor.needsUpdate = true;
  }
  // ---- billboards (flash) and oriented rings ----
  const flashTex = glowTexture(false), ringTex = glowTexture(true), cards = [];
  for (let i = 0; i < CARDS; i++) {
    const ring = i % 2 === 1;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({map: ring ? ringTex : flashTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide}));
    m.visible = false; m.userData.ignoreContact = true; m.userData.ring = ring; group.add(m); cards.push({mesh: m, life: 0, max: 1, from: 0, to: 1, billboard: !ring, colour: [1, 1, 1]});
  }
  function card(ring, at, dir, from, to, life, colour) {
    const c = cards.filter(k => k.mesh.userData.ring === ring).sort((a, b) => a.life - b.life)[0];
    c.mesh.position.copy(at); c.life = life; c.max = life; c.from = from; c.to = to; c.colour = colour; c.mesh.visible = true;
    if (ring) c.mesh.quaternion.setFromUnitVectors(_p.set(0, 0, 1), dir);
  }
  function stepCards(dt, camera) {
    for (const c of cards) {
      if (!c.mesh.visible) continue;
      if ((c.life -= dt) <= 0) {c.mesh.visible = false; continue;}
      const u = 1 - c.life / c.max, e = 1 - Math.pow(1 - u, 3), s = c.from + (c.to - c.from) * e;
      c.mesh.scale.setScalar(s);
      if (c.billboard && camera) c.mesh.quaternion.copy(camera.quaternion);
      const a = (1 - u) * (1 - u); c.mesh.material.color.setRGB(c.colour[0] * a, c.colour[1] * a, c.colour[2] * a);
    }
  }
  // ---- contrails: per golden projectile, two gold strands wound round the flight line ----
  const trails = new Map(); // id -> {last: Vector3, phase, seed}
  const _d = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _w = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  function contrails(list, dt) {
    const live = new Set();
    for (const g of list) {
      live.add(g.id);
      let t = trails.get(g.id); if (!t) {t = {last: g.position.clone(), phase: 0, seed: seedOf(g.id), n: 0}; trails.set(g.id, t);}
      _d.subVectors(g.position, t.last); const travel = _d.length(); if (travel < 1e-4) continue;
      _d.divideScalar(travel);
      _a.crossVectors(_d, Math.abs(_d.y) > .9 ? _w.set(1, 0, 0) : UP).normalize(); _b.crossVectors(_d, _a);
      // ~ one spark per 4 cm per strand: a 42 m/s bolt lays ~17 sparks per strand each 60 Hz frame.
      const steps = Math.min(24, Math.ceil(travel / .04));
      for (let i = 1; i <= steps; i++) {
        const f = i / steps, along = travel * f; t.phase += travel / steps * 9.5; // ~1.5 turns per metre
        _p.copy(t.last).addScaledVector(_d, along);
        for (const strand of [0, Math.PI]) {
          const ang = t.phase + strand, r = .075 + .025 * Math.sin(t.phase * .37 + strand);
          const ox = Math.cos(ang) * r, oy = Math.sin(ang) * r;
          _w.copy(_a).multiplyScalar(ox).addScaledVector(_b, oy);
          // Sparks drift outward and lag, so the spiral loosens and glitters behind the bolt.
          spark(_p.x + _w.x, _p.y + _w.y, _p.z + _w.z, _w.x * 4 - _d.x * 1.5, _w.y * 4 - _d.y * 1.5 + .2, _w.z * 4 - _d.z * 1.5, strand ? GOLD : WHITE_GOLD, .028, .42 + hash(t.seed, t.n++) * .2, .4, 2.2);
        }
        if (i % 4 === 0) spark(_p.x, _p.y, _p.z, (hash(t.seed, t.n++) - .5) * .6, (hash(t.seed, t.n++) - .5) * .6 + .3, (hash(t.seed, t.n++) - .5) * .6, WHITE_GOLD, .05, .25, 0, 3);
      }
      t.last.copy(g.position);
    }
    for (const id of trails.keys()) if (!live.has(id)) trails.delete(id);
  }
  // ---- events ----
  const _at = new THREE.Vector3(), _dir = new THREE.Vector3();
  function pierce(e) {
    const s = seedOf(e.id + ':' + e.targetId); _at.fromArray(e.position); _dir.fromArray(e.direction || [0, 0, -1]).normalize();
    card(false, _at, _dir, .2, 1.5, .28, [1, .96, .8]);
    card(false, _at, _dir, .1, .7, .12, [1, 1, 1]);
    card(true, _at, _dir, .15, 1.6, .38, [1, .8, .35]);
    card(true, _at.clone().addScaledVector(_dir, .25), _dir, .1, 1.05, .3, [1, .9, .55]);
    _a.crossVectors(_dir, Math.abs(_dir.y) > .9 ? _w.set(1, 0, 0) : UP).normalize(); _b.crossVectors(_dir, _a);
    for (let i = 0; i < 46; i++) { // exit spray: a cone along the flight, plus a radial ring burst
      const ring = i < 18, ang = hash(s, i) * Math.PI * 2, spread = ring ? 1 : .35 + hash(s, i + 99) * .45, sp = ring ? 3 + hash(s, i + 7) * 3 : 5 + hash(s, i + 7) * 7;
      _w.copy(_a).multiplyScalar(Math.cos(ang) * spread).addScaledVector(_b, Math.sin(ang) * spread).addScaledVector(_dir, ring ? .15 : 1).normalize();
      spark(_at.x, _at.y, _at.z, _w.x * sp, _w.y * sp, _w.z * sp, i % 3 ? GOLD : WHITE_GOLD, ring ? .05 : .035, .35 + hash(s, i + 31) * .35, ring ? 1 : 6, ring ? 4 : 2.5);
    }
    for (let i = 0; i < 14; i++) spark(_at.x + (hash(s, i + 300) - .5) * .4, _at.y + (hash(s, i + 301) - .5) * .4, _at.z + (hash(s, i + 302) - .5) * .4, (hash(s, i + 303) - .5) * .5, .3 + hash(s, i + 304) * .5, (hash(s, i + 305) - .5) * .5, GOLD, .045, 1.2 + hash(s, i + 306) * .8, .25, 1.2);
    sound('pierce', e.position);
  }
  function burst(e) {
    _at.fromArray(e.position); const r = e.radius || 1.8;
    card(false, _at, UP, r * .2, r * 1.05, .32, [.85, .55, .22]);
    card(true, _at, UP, .3, r * 1.7, .5, [1, .7, .3]);
  }
  function shieldBreak(e) {
    const s = seedOf(e.id + ':shield'), golden = !!e.golden, palette = SHIELD_COLOURS[e.material] || SHIELD_COLOURS.wood;
    _at.fromArray(e.position); const n = _dir.fromArray(e.normal || [0, 0, 1]).normalize();
    const count = golden ? 18 : 13;
    for (let i = 0; i < count; i++) {
      const plank = e.material !== 'iron' && i % 3 !== 2;
      const size = plank ? new THREE.Vector3(.04 + hash(s, i) * .05, .12 + hash(s, i + 1) * .2, .02) : new THREE.Vector3(.06 + hash(s, i + 2) * .06, .05 + hash(s, i + 3) * .06, .015);
      const v = new THREE.Vector3((hash(s, i + 4) - .5) * 3, 1.2 + hash(s, i + 5) * 2.4, (hash(s, i + 6) - .5) * 3).addScaledVector(n, -1.2 - hash(s, i + 7) * 2.2); // driven back, away from the blow
      const p = _at.clone().add(new THREE.Vector3((hash(s, i + 8) - .5) * .35, (hash(s, i + 9) - .5) * .45, (hash(s, i + 10) - .5) * .35));
      shard(p, v, size, palette[i % palette.length], new THREE.Vector3((hash(s, i + 11) - .5) * 18, (hash(s, i + 12) - .5) * 14, (hash(s, i + 13) - .5) * 18), 2.6 + hash(s, i + 14) * 1.6, golden ? .9 : 0);
    }
    for (let i = 0; i < 26; i++) spark(_at.x, _at.y, _at.z, (hash(s, i + 50) - .5) * 4 - n.x * 1.5, hash(s, i + 51) * 2.5, (hash(s, i + 52) - .5) * 4 - n.z * 1.5, golden ? GOLD : e.material === 'iron' ? [1, .7, .4] : [.75, .6, .4], golden ? .04 : .03, .4 + hash(s, i + 53) * .4, golden ? 2 : 6, 2);
    if (!golden) card(false, _at, n, .2, .9, .16, e.material === 'iron' ? [1, .7, .4] : [.6, .5, .35]);
    sound('shield', e.position, e.material);
  }
  // A small WebAudio voice: a radiant crack (noise + bright chime) for pierces, a splintering crunch for shields.
  function sound(kind, position, material) {
    const ctx = audio(); if (!ctx) return;
    try {
      const t = ctx.currentTime, out = ctx.createGain(); out.connect(ctx.destination);
      out.gain.setValueAtTime(kind === 'pierce' ? .16 : .2, t); out.gain.exponentialRampToValueAtTime(.001, t + (kind === 'pierce' ? .9 : .5));
      const len = Math.floor(ctx.sampleRate * .25), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0); let h = 1;
      for (let i = 0; i < len; i++) {h = Math.imul(h, 48271) % 2147483647; d[i] = ((h / 2147483647) * 2 - 1) * Math.pow(1 - i / len, kind === 'pierce' ? 6 : 3);}
      const noise = ctx.createBufferSource(); noise.buffer = buf; const f = ctx.createBiquadFilter(); f.type = kind === 'pierce' ? 'highpass' : 'bandpass'; f.frequency.value = kind === 'pierce' ? 2400 : material === 'iron' ? 1800 : 700; f.Q.value = .8;
      noise.connect(f).connect(out); noise.start(t);
      if (kind === 'pierce') for (const [hz, g] of [[1568, .5], [2350, .35], [3136, .2]]) {const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(hz, t); o.frequency.exponentialRampToValueAtTime(hz * 1.5, t + .6); og.gain.setValueAtTime(g * .3, t); og.gain.exponentialRampToValueAtTime(.001, t + .8); o.connect(og).connect(out); o.start(t); o.stop(t + .85);}
      else {const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(material === 'iron' ? 420 : 140, t); o.frequency.exponentialRampToValueAtTime(material === 'iron' ? 260 : 70, t + .3); og.gain.setValueAtTime(.4, t); og.gain.exponentialRampToValueAtTime(.001, t + .35); o.connect(og).connect(out); o.start(t); o.stop(t + .4);}
    } catch { /* audio is optional */ }
  }
  function handle(e) {
    if (!e) return;
    if (e.kind === 'pierce' && e.golden) pierce(e);
    else if (e.kind === 'radiant_burst') burst(e);
    else if (e.kind === 'shield_break') shieldBreak(e);
  }
  // golden: [{id, position: Vector3}] for golden bolts in flight this frame.
  function update(dt, {camera, golden = [], viewportHeight = 800} = {}) {
    dt = clamp(Number.isFinite(dt) ? dt : 1 / 60, 0, .1);
    contrails(golden, dt); stepSparks(dt); stepShards(dt); stepCards(dt, camera);
    // Point sprites are sized in metres: pixels = size * viewport height / (2 tan(fov/2) depth).
    if (camera?.isPerspectiveCamera) sparkMat.uniforms.scale.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }
  function stats() {return {sparks: sp.n, shards: shards.length, cards: cards.filter(c => c.mesh.visible).length, trails: trails.size};}
  function dispose() {
    group.removeFromParent(); sg.dispose(); sparkMat.dispose(); shardGeo.dispose(); shardMat.dispose(); shardMesh.dispose?.();
    flashTex.dispose(); ringTex.dispose(); for (const c of cards) {c.mesh.geometry.dispose(); c.mesh.material.dispose();}
  }
  return {handle, update, stats, dispose, group};
}
