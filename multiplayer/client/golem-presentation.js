import * as THREE from 'three';
import {enemyMotionState} from './enemy-motion.js';

// Geode golem presentation: the blue resonance light, footfall/slam dust and shockwave, procedural sound and rumble.
// Pure presentation, driven by enemy-motion's per-frame cues (stride crossings and the shared attack tick), so every
// peer sees and hears the same beats and nothing feeds back into the simulation.
//   light   each golem owns one clone of the Crystal material: a slow breath, a flare through the slam telegraph,
//           a flash on impact, a stutter when struck and an unsteady flicker when badly hurt.
//   ground  footfalls kick up a few soft puffs; the slam adds a ring of dust and an expanding blue resonance ring.
//   sound   Web Audio only (no assets): stone thud per step, a rising crystal hum on the telegraph, a boom + bell on the
//           slam, a glassy crack + crumble when a limb breaks away or the golem falls. Distance-gated, voice-capped.
//   rumble  the local player only, scaled by distance: slams and nearby footfalls (controller in VR, a buzz on phones).
// Budget: two instanced draws, both hidden when idle; no per-frame allocation in update().

const PUFFS = 48, RINGS = 6, HEAR = 38, MAX_VOICES = 10;
const BLUE = new THREE.Color(0.35, 0.72, 1);

const PUFF_VERT = `attribute vec2 aFade;varying vec2 vUv;varying float vA;
void main(){vUv=uv;vA=aFade.x;vec4 c=modelViewMatrix*instanceMatrix*vec4(0.,0.,0.,1.);float s=length(instanceMatrix[0].xyz);
c.xy+=position.xy*s;gl_Position=projectionMatrix*c;}`;
const PUFF_FRAG = `varying vec2 vUv;varying float vA;void main(){vec2 p=vUv*2.-1.;float d=dot(p,p);if(d>1.)discard;
gl_FragColor=vec4(vec3(.56,.52,.46),vA*(1.-d)*(1.-d));}`;
const RING_FRAG = `uniform vec3 uColor;varying vec2 vUv;varying float vA;void main(){float r=length(vUv*2.-1.);
float band=smoothstep(.62,.86,r)*(1.-smoothstep(.9,1.,r));gl_FragColor=vec4(uColor*band*vA,1.);}`;
const RING_VERT = `attribute vec2 aFade;varying vec2 vUv;varying float vA;void main(){vUv=uv;vA=aFade.x;
gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`;

export function createGolemPresentation({scene, height = () => 0, audio = () => null, haptic = null, listener = () => null} = {}) {
  // ---- pooled ground effects ----
  const puffGeo = new THREE.PlaneGeometry(1, 1), ringGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const puffFade = new THREE.InstancedBufferAttribute(new Float32Array(PUFFS * 2), 2), ringFade = new THREE.InstancedBufferAttribute(new Float32Array(RINGS * 2), 2);
  puffGeo.setAttribute('aFade', puffFade); ringGeo.setAttribute('aFade', ringFade);
  const puffMat = new THREE.ShaderMaterial({vertexShader: PUFF_VERT, fragmentShader: PUFF_FRAG, transparent: true, depthWrite: false});
  const ringMat = new THREE.ShaderMaterial({vertexShader: RING_VERT, fragmentShader: RING_FRAG, uniforms: {uColor: {value: BLUE.clone().multiplyScalar(1.6)}},
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending});
  const puffMesh = new THREE.InstancedMesh(puffGeo, puffMat, PUFFS), ringMesh = new THREE.InstancedMesh(ringGeo, ringMat, RINGS);
  for (const m of [puffMesh, ringMesh]) { m.frustumCulled = false; m.count = 0; m.visible = false; m.name = 'golem-presentation'; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene?.add(m); }
  puffMesh.renderOrder = 10; ringMesh.renderOrder = 11;
  const puffs = Array.from({length: PUFFS}, () => ({age: 1, life: 1, p: new THREE.Vector3(), v: new THREE.Vector3(), s0: 0, s1: 0, a: 0}));
  const rings = Array.from({length: RINGS}, () => ({age: 1, life: 1, p: new THREE.Vector3(), r: 0, a: 0}));
  let nextPuff = 0, nextRing = 0, seed = 1;
  const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822519) + 0x6d2b79f5 | 0) >>> 0) / 4294967296;
  function puff(x, y, z, size, speed, alpha) {
    const p = puffs[nextPuff]; nextPuff = (nextPuff + 1) % PUFFS;
    const a = rnd() * Math.PI * 2;
    p.p.set(x, y + .1, z); p.v.set(Math.cos(a) * speed, .35 + rnd() * .4, Math.sin(a) * speed);
    p.age = 0; p.life = .7 + rnd() * .5; p.s0 = size * .5; p.s1 = size * (1.4 + rnd() * .6); p.a = alpha;
  }
  function ring(x, y, z, radius, alpha) {
    const r = rings[nextRing]; nextRing = (nextRing + 1) % RINGS;
    r.p.set(x, y + .06, z); r.r = radius; r.age = 0; r.life = .55; r.a = alpha;
  }

  // ---- procedural audio ----
  let voices = 0, noise = null, out = null, ctxRef = null;
  const stats = {golems: 0, steps: 0, slams: 0, telegraphs: 0, breaks: 0, sounds: 0, culled: 0, rumbles: 0};
  function bus(context) {
    if (out && ctxRef === context) return out;
    ctxRef = context; out = context.createGain(); out.gain.value = .6; out.connect(context.destination); noise = null; return out;
  }
  function noiseBuffer(context) {
    if (noise) return noise;
    const n = context.sampleRate * 1.2 | 0, b = context.createBuffer(1, n, context.sampleRate), d = b.getChannelData(0); let s = 7919;
    for (let i = 0; i < n; i++) { s = (Math.imul(s, 1103515245) + 12345) | 0; d[i] = ((s >>> 9) / 4194304) - 1; }
    return noise = b;
  }
  function voice(position) {
    const context = audio(); if (!context || context.state !== 'running') return null;
    const l = listener(); const d = l ? Math.hypot(position.x - l.position[0], position.y - l.position[1], position.z - l.position[2]) : 10;
    if (d > HEAR) return null;
    if (voices >= MAX_VOICES) { stats.culled++; return null; }
    const p = context.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 4; p.maxDistance = HEAR; p.rolloffFactor = 1;
    if (p.positionX) { p.positionX.value = position.x; p.positionY.value = position.y + 1; p.positionZ.value = position.z; } else p.setPosition?.(position.x, position.y + 1, position.z);
    if (l) { const L = context.listener; if (L.positionX) { L.positionX.value = l.position[0]; L.positionY.value = l.position[1]; L.positionZ.value = l.position[2]; L.forwardX.value = l.forward[0]; L.forwardY.value = l.forward[1]; L.forwardZ.value = l.forward[2]; L.upX.value = l.up[0]; L.upY.value = l.up[1]; L.upZ.value = l.up[2]; } else { L.setPosition?.(...l.position); L.setOrientation?.(...l.forward, ...l.up); } }
    p.connect(bus(context)); voices++; stats.sounds++;
    return {context, dest: p, t: context.currentTime, done: at => setTimeout(() => { voices = Math.max(0, voices - 1); try { p.disconnect(); } catch {} }, Math.max(0, (at - context.currentTime) * 1000) + 60)};
  }
  const env = (g, t, peak, attack, decay) => { g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + attack); g.gain.exponentialRampToValueAtTime(.0001, t + attack + decay); };
  function thump(v, f0, f1, level, decay) {
    const {context, dest, t} = v, o = context.createOscillator(), g = context.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + decay * .8);
    env(g, t, level, .006, decay); o.connect(g).connect(dest); o.start(t); o.stop(t + decay + .05);
  }
  function grit(v, freq, level, decay, rate = 1, offset = 0) {
    const {context, dest, t} = v, s = context.createBufferSource(), f = context.createBiquadFilter(), g = context.createGain();
    s.buffer = noiseBuffer(context); s.playbackRate.value = rate; f.type = 'lowpass'; f.frequency.value = freq; f.Q.value = .8;
    env(g, t, level, .004, decay); s.connect(f).connect(g).connect(dest); s.start(t, offset); s.stop(t + decay + .05);
  }
  function bell(v, freq, level, decay) {
    const {context, dest, t} = v;
    for (const [r, a] of [[1, 1], [2.01, .45], [2.76, .35], [5.4, .16]]) {
      const o = context.createOscillator(), g = context.createGain(); o.type = 'sine'; o.frequency.value = freq * r;
      env(g, t, level * a, .005, decay / (1 + r * .4)); o.connect(g).connect(dest); o.start(t); o.stop(t + decay + .05);
    }
  }
  function soundStep(pos, strength) {
    const v = voice(pos); if (!v) return;
    thump(v, 70 + rnd() * 10, 34, .55 * strength, .32); grit(v, 380, .22 * strength, .22, .7, rnd());
    v.done(v.t + .4);
  }
  function soundTelegraph(pos) {
    const v = voice(pos); if (!v) return;
    const {context, dest, t} = v, o = context.createOscillator(), o2 = context.createOscillator(), g = context.createGain();
    o.type = 'triangle'; o2.type = 'sine';
    o.frequency.setValueAtTime(196, t); o.frequency.exponentialRampToValueAtTime(392, t + .3);
    o2.frequency.setValueAtTime(294, t); o2.frequency.exponentialRampToValueAtTime(588, t + .3);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.16, t + .2); g.gain.exponentialRampToValueAtTime(.0001, t + .42);
    o.connect(g); o2.connect(g); g.connect(dest); o.start(t); o2.start(t); o.stop(t + .45); o2.stop(t + .45);
    grit(v, 140, .25, .35, .5, rnd()); // stone groan under the hum
    v.done(t + .5);
  }
  function soundSlam(pos) {
    const v = voice(pos); if (!v) return;
    thump(v, 95, 28, 1.0, .75); grit(v, 900, .55, .45, 1.2, rnd()); grit(v, 180, .5, .9, .45, rnd()); bell(v, 523.25, .12, 1.3);
    v.done(v.t + 1.4);
  }
  function soundBreak(pos, big) {
    const v = voice(pos); if (!v) return;
    grit(v, 2400, .35, .18, 1.5, rnd()); bell(v, big ? 659.25 : 880, big ? .14 : .1, big ? 1.6 : .9);
    thump(v, big ? 80 : 110, 36, big ? .8 : .45, big ? .6 : .3); grit(v, 260, big ? .5 : .3, big ? 1.1 : .5, .6, rnd());
    v.done(v.t + (big ? 1.7 : 1));
  }
  function rumble(pos, near, amplitude, ms) {
    const l = listener(); if (!haptic || !l) return;
    const d = Math.hypot(pos.x - l.position[0], pos.z - l.position[2]); if (d > near) return;
    const k = 1 - d / near; haptic(amplitude * k, ms); stats.rumbles++;
  }

  // ---- per-golem crystal light ----
  let frameNo = 0;
  const looks = new WeakMap(), live = new Map(), fading = new Set(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _f = new THREE.Vector3(), _s = new THREE.Vector3(), _m = new THREE.Matrix4();
  function look(visual) {
    let rec = looks.get(visual);
    if (rec) return rec;
    rec = {meshes: [], flash: 0, hurt: 0, lastHurt: undefined};
    let own = null;
    visual.traverse(n => {
      if (!n.isMesh) return;
      const list = Array.isArray(n.material) ? n.material : [n.material];
      if (!list.some(m => /^crystal/i.test(m?.name || ''))) return;
      own ||= list.find(m => /^crystal/i.test(m.name)).clone();
      n.material = Array.isArray(n.material) ? n.material.map(m => /^crystal/i.test(m.name) ? own : m) : own;
      rec.meshes.push(n);
    });
    looks.set(visual, rec);
    return rec;
  }
  function glow(rec, value) {
    for (const mesh of rec.meshes) {
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of list) if (/^crystal/i.test(m?.name || '')) m.emissiveIntensity = value; // also reaches creature-life-death's damage variants
    }
  }
  function ground(node, out) { node.getWorldPosition(out); out.y = height(out.x, out.z); return out; }

  function update(actors, renderTick, dt, elapsed) {
    stats.golems = 0; frameNo++;
    for (const entry of actors.values()) {
      if (!entry.enemy || entry.data?.kind !== 'golem' || entry.visual?.userData.placeholder) continue;
      stats.golems++;
      const rec = look(entry.visual); live.set(entry.data.id, rec); rec.seenAt = frameNo;
      const st = enemyMotionState(entry.visual), data = entry.data;
      if (data.hurtTick !== rec.lastHurt) { if (rec.lastHurt !== undefined) rec.hurt = 1; rec.lastHurt = data.hurtTick; }
      for (const e of st?.events || []) {
        if (e.type === 'step') {
          const leg = entry.visual.getObjectByName(e.side === 'left' ? 'LegL' : 'LegR'); if (!leg) continue;
          ground(leg, _p); stats.steps++;
          for (let i = 0; i < 3; i++) puff(_p.x, _p.y, _p.z, .55, .6, .32 * e.strength);
          soundStep(_p, e.strength); rumble(_p, 7, .22, 30);
        } else if (e.type === 'telegraph') {
          entry.root.getWorldPosition(_p); stats.telegraphs++; soundTelegraph(_p);
        } else if (e.type === 'slam') {
          entry.root.getWorldPosition(_p); entry.root.getWorldQuaternion(_q); _f.set(0, 0, -1).applyQuaternion(_q);
          _p.addScaledVector(_f, 1.5); _p.y = height(_p.x, _p.z); stats.slams++; rec.flash = 1;
          for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; puff(_p.x + Math.cos(a) * .5, _p.y, _p.z + Math.sin(a) * .5, .9, 2.2, .45); }
          ring(_p.x, _p.y, _p.z, 4.2, 1); soundSlam(_p); rumble(_p, 12, .8, 90);
        }
      }
      // Light: breath, telegraph flare, slam flash, hit stutter, and an unsteady flicker below 35% health.
      const t = elapsed + (data.id?.length || 0) * .7, low = 1 - Math.min(1, (data.hp ?? 320) / 320);
      rec.flash = Math.max(0, rec.flash - dt * 2.4); rec.hurt = Math.max(0, rec.hurt - dt * 3.5);
      let k = 1.05 + .2 * Math.sin(t * 1.3) + 2.4 * (st?.telegraph || 0) + 3 * rec.flash * rec.flash;
      if (rec.hurt > 0) k *= .35 + .65 * (Math.sin(rec.hurt * 40) * .5 + .5) + rec.hurt * .8;
      if (low > .65) k *= .7 + .3 * Math.abs(Math.sin(t * 7.3) * Math.sin(t * 3.1 + 1));
      glow(rec, k);
    }
    for (const [id, rec] of live) if (frameNo - rec.seenAt > 240) live.delete(id); // despawned without a death (save load, room change)
    // A fallen golem's resonance flares once and gutters to an ember glow on its remains.
    for (const rec of fading) { rec.fade = Math.max(0, rec.fade - dt / 1.8); glow(rec, .16 + 3.2 * rec.fade * rec.fade * rec.fade); if (!rec.fade) fading.delete(rec); }
    // Ground effects.
    let n = 0;
    for (const p of puffs) {
      if (p.age >= p.life) continue;
      p.age += dt; if (p.age >= p.life) continue;
      const u = p.age / p.life; p.v.multiplyScalar(Math.exp(-dt * 3)); p.p.addScaledVector(p.v, dt);
      _m.makeScale(1, 1, 1).setPosition(p.p); const s = p.s0 + (p.s1 - p.s0) * (1 - (1 - u) * (1 - u));
      _m.scale(_s.set(s, s, s)); puffMesh.setMatrixAt(n, _m); puffFade.array[n * 2] = p.a * Math.sin(Math.PI * Math.min(1, u * 1.6 + .05)) * (1 - u); n++;
    }
    puffMesh.count = n; puffMesh.visible = n > 0; if (n) { puffMesh.instanceMatrix.needsUpdate = true; puffFade.needsUpdate = true; }
    n = 0;
    for (const r of rings) {
      if (r.age >= r.life) continue;
      r.age += dt; if (r.age >= r.life) continue;
      const u = r.age / r.life, s = r.r * (.2 + .8 * (1 - (1 - u) * (1 - u)));
      _m.makeScale(s, 1, s).setPosition(r.p); ringMesh.setMatrixAt(n, _m); ringFade.array[n * 2] = r.a * (1 - u) * (1 - u); n++;
    }
    ringMesh.count = n; ringMesh.visible = n > 0; if (n) { ringMesh.instanceMatrix.needsUpdate = true; ringFade.needsUpdate = true; }
  }

  // Authority events: limbs breaking away and the final collapse.
  function handleEvent(event) {
    if (!event?.position || !Array.isArray(event.position)) return;
    const golem = event.kind === 'death' ? event.creature === 'golem' : event.kind === 'detach' && live.has(event.sourceId);
    if (!golem) return;
    _p.fromArray(event.position); const big = event.kind === 'death'; stats.breaks++;
    soundBreak(_p, big);
    if (big) { _p.y = height(_p.x, _p.z); ring(_p.x, _p.y, _p.z, 3.2, .7); for (let i = 0; i < 8; i++) puff(_p.x + (rnd() - .5) * 1.2, _p.y, _p.z + (rnd() - .5) * 1.2, 1.1, 1.2, .4); rumble(_p, 10, .6, 120); const rec = live.get(event.id); if (rec) { rec.fade = 1; fading.add(rec); live.delete(event.id); } }
    else rumble(_p, 6, .35, 40);
  }

  function dispose() {
    for (const m of [puffMesh, ringMesh]) { m.removeFromParent(); m.dispose?.(); }
    puffGeo.dispose(); ringGeo.dispose(); puffMat.dispose(); ringMat.dispose();
    try { out?.disconnect(); } catch {}
  }
  return {update, handleEvent, dispose, stats: () => ({...stats, puffs: puffMesh.count, rings: ringMesh.count, voices})};
}
