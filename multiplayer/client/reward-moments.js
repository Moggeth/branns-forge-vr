// Reward moments: every win the simulation reports answers with light, sound and touch.
// Presentation only. It reads broadcast events, never writes shared state, and is safe
// for late joiners (a missed event simply plays nothing). Quest budget: no lights, no
// textures, one instanced mote draw plus at most 6 rings and 3 pillars while active.
import * as THREE from 'three';
import {materialInfo} from '../shared/material-catalog.js';

export const REWARD_CAPS = Object.freeze({motes: 192, rings: 6, pillars: 3, voices: 12});

const COLOURS = Object.freeze({resonance: 0x7fd8ff, core: 0xd4f6ff, gold: 0xffcf6e, ember: 0xff9442, dusk: 0x8f6bff});
const NEAR = 4, HEARD = 40;
// Slight lift so flecks read as lit gems rather than flat paint.
const MOTE_TONE = 1.15;
const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const materialColour = key => materialInfo(key)?.color ?? COLOURS.resonance;

// Pure: what a broadcast event deserves. tier 0 = small sparkle, 1 = notable, 2 = grand.
// ctx: {playerId, side, position:[x,y,z]} for the local viewer.
export function classifyReward(event, ctx = {}) {
  if (!event || !Array.isArray(event.position)) return null;
  const here = Array.isArray(ctx.position) ? ctx.position : null;
  const distance = here ? flat(here, event.position) : Infinity;
  const near = distance <= NEAR, mine = event.by !== undefined && event.by === ctx.playerId;
  const ours = !event.side || !ctx.side || event.side === ctx.side;
  const both = (amplitude, duration, repeat = 1) => ({amplitude, duration, repeat});
  switch (event.kind) {
    case 'invention_victory': case 'forge_reward':
      return {kind: event.kind, tier: 2, colour: ours ? COLOURS.gold : COLOURS.dusk, accent: COLOURS.resonance,
        motes: 48, ring: true, pillar: true, flyTo: 'up', chime: ours ? 'victory' : 'warning', spatial: false,
        rumble: ours ? both(.42, 70, 3) : null};
    case 'meteor_reward':
      return {kind: event.kind, tier: 1, colour: COLOURS.gold, accent: materialColour('gems'), motes: 24, ring: true,
        pillar: false, flyTo: 'up', chime: 'discovery', spatial: true, rumble: distance < 12 ? both(.3, 45) : null};
    case 'geology_emerge':
      return {kind: event.kind, tier: 1, colour: materialColour(event.material), accent: COLOURS.resonance, motes: 14,
        ring: true, pillar: true, flyTo: 'up', chime: 'discovery', spatial: true, rumble: distance < 15 ? both(.22, 40) : null};
    case 'seam_survey':
      return {kind: event.kind, tier: 0, colour: COLOURS.resonance, accent: COLOURS.core, motes: 4, ring: true,
        pillar: false, flyTo: 'up', chime: 'ping', spatial: true, rumble: null};
    case 'salvage':
      return {kind: event.kind, tier: 0, colour: materialColour(event.resource), accent: COLOURS.core, motes: 6,
        ring: false, pillar: false, flyTo: near ? 'player' : 'up', chime: 'pickup', spatial: true, rumble: null};
    case 'pickup':
      return {kind: event.kind, tier: 0, colour: materialColour(event.material), accent: COLOURS.core, motes: near ? 9 : 5,
        ring: false, pillar: false, flyTo: near ? 'player' : 'up', chime: 'pickup', spatial: true,
        rumble: near ? {amplitude: .16, duration: 18, repeat: 1} : null};
    case 'refinery_output':
      return {kind: event.kind, tier: 1, colour: materialColour(event.material), accent: COLOURS.ember, motes: 16,
        ring: true, pillar: false, flyTo: 'up', chime: 'craft', spatial: true, rumble: near ? both(.2, 30) : null};
    case 'invention_build':
      return {kind: event.kind, tier: 1, colour: COLOURS.resonance, accent: COLOURS.gold, motes: 20, ring: true,
        pillar: false, flyTo: 'up', chime: 'build', spatial: true, rumble: mine ? both(.32, 45, 2) : null};
    case 'defender_recruit':
      return {kind: event.kind, tier: 1, colour: COLOURS.resonance, accent: COLOURS.core, motes: 12, ring: true,
        pillar: false, flyTo: 'up', chime: 'build', spatial: true, rumble: near ? both(.2, 30) : null};
    case 'invention_deposit':
      return {kind: event.kind, tier: 1, colour: COLOURS.gold, accent: COLOURS.resonance,
        motes: Math.min(24, 6 + (event.amount | 0)), ring: false, pillar: false, flyTo: 'store', chime: 'deposit',
        spatial: true, rumble: near ? both(.22, 28, 2) : null};
    case 'camp_return':
      return {kind: event.kind, tier: 0, colour: COLOURS.dusk, accent: 0x2a1f44, motes: 6, ring: true, pillar: false,
        flyTo: 'up', chime: 'warning', spatial: true, rumble: null};
    default: return null;
  }
}
// Toast text for the wins that also change stores out of sight. Null when the viewer's side did not win.
export function rewardBanner(event, side) {
  if (!event || (event.side && side && event.side !== side)) return null;
  const loot = event.reward && typeof event.reward === 'object' ? event.reward : event;
  const parts = ['iron', 'wood', 'stone', 'gems', 'starOre'].filter(k => Number.isFinite(loot[k]) && loot[k] > 0)
    .map(k => `${loot[k]} ${(materialInfo(k)?.label || k).toLowerCase()}`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  if (event.kind === 'invention_victory') return list ? `Raid repelled! Your stores gain ${list}.` : 'Raid repelled!';
  if (event.kind === 'forge_reward') return list ? `The settlement held. Its stores gain ${list}.` : 'The settlement held.';
  return null;
}

// Bell voices: inharmonic partials make a struck-metal shimmer without samples.
const NOTES = {
  pickup: [[1318.5, 0], [1975.5, .06]],
  ping: [[1760, 0]],
  deposit: [[1760, 0], [1318.5, .07], [1046.5, .14]],
  craft: [[220, 0, .5], [880, 0], [1318.5, .09]],
  build: [[523.3, 0], [659.3, .07], [784, .14], [1046.5, .21]],
  discovery: [[880, 0], [1318.5, .08], [1760, .16]],
  victory: [[523.3, 0], [587.3, .08], [659.3, .16], [784, .24], [880, .32], [1046.5, .42], [784, .42], [523.3, .42]],
  warning: [[98, 0, 1.6], [146.8, .05, 1.6]],
};
const GAPS = {pickup: 70, ping: 140, deposit: 120, craft: 120, build: 120, discovery: 200, victory: 800, warning: 600};

export function createRewardMoments({scene, camera, height = () => 0, audio = () => null, sources = () => [],
  presenting = () => false, context = () => ({}), clock = () => performance.now(), schedule = setTimeout} = {}) {
  const C = REWARD_CAPS;
  const root = new THREE.Group(); root.name = 'reward-moments'; root.visible = false; scene?.add(root);

  // Motes: one instanced octahedron draw, additive, per-instance colour.
  const moteGeometry = new THREE.OctahedronGeometry(.034, 0);
  // Motes are opaque-coloured gem flecks (normal blending) so gold and blue survive a bright sky;
  // rings and pillars carry the additive glow.
  const moteMaterial = new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: .92, depthWrite: false, toneMapped: false});
  const motes = new THREE.InstancedMesh(moteGeometry, moteMaterial, C.motes);
  motes.instanceMatrix.setUsage(THREE.DynamicDrawUsage); motes.frustumCulled = false; motes.count = 0;
  motes.setColorAt(0, new THREE.Color()); motes.instanceColor.setUsage(THREE.DynamicDrawUsage);
  root.add(motes);
  const mote = Array.from({length: C.motes}, () => ({alive: false, age: 0, life: 1, size: 1, spin: 0,
    a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), follow: false}));

  const ringGeometry = new THREE.RingGeometry(.94, 1, 64, 1); ringGeometry.rotateX(-Math.PI / 2);
  const rings = Array.from({length: C.rings}, () => {
    const mesh = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false}));
    mesh.visible = false; mesh.frustumCulled = false; root.add(mesh); return {mesh, age: 0, life: 1, radius: 1, alive: false};
  });

  // Pillar: open cylinder whose vertex alpha fades from base to tip.
  const pillarGeometry = new THREE.CylinderGeometry(.22, .5, 1, 20, 6, true); pillarGeometry.translate(0, .5, 0);
  { const p = pillarGeometry.attributes.position, colour = new Float32Array(p.count * 4);
    for (let n = 0; n < p.count; n++) { const y = p.getY(n); colour.set([1, 1, 1, Math.pow(1 - y, 1.6)], n * 4); }
    pillarGeometry.setAttribute('color', new THREE.BufferAttribute(colour, 4)); }
  const pillars = Array.from({length: C.pillars}, () => {
    const mesh = new THREE.Mesh(pillarGeometry, new THREE.MeshBasicMaterial({vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false}));
    mesh.visible = false; mesh.frustumCulled = false; root.add(mesh); return {mesh, age: 0, life: 1, tall: 1, alive: false};
  });

  const scratch = new THREE.Object3D(), tint = new THREE.Color(), eye = new THREE.Vector3();
  const origin = new THREE.Vector3(), q = new THREE.Vector3(), lens = new THREE.Vector3();
  const stats = {played: 0, motesDropped: 0, voices: 0, pulses: 0, ignored: 0};
  const lastChime = new Map(); let lastRumble = -Infinity, voices = 0, cursor = 0, disposed = false, seed = 1;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return ((seed >>> 8) & 0xffff) / 0xffff; };

  function spawnMotes(moment, at) {
    for (let n = 0; n < moment.motes; n++) {
      let slot = -1;
      for (let k = 0; k < C.motes; k++) { const i = (cursor + k) % C.motes; if (!mote[i].alive) { slot = i; break; } }
      if (slot < 0) { stats.motesDropped += moment.motes - n; return; }
      cursor = (slot + 1) % C.motes; const m = mote[slot];
      const angle = random() * Math.PI * 2, spread = (moment.tier === 2 ? 2.4 : moment.tier ? 1.3 : .7) * (.4 + random() * .6);
      m.alive = true; m.age = -random() * (moment.tier === 2 ? .35 : .12); m.life = .7 + random() * .5 + moment.tier * .35;
      m.size = (.7 + random() * .7) * (moment.tier === 2 ? 1.5 : moment.tier ? 1 : .6); m.spin = random() * 6;
      m.a.copy(at).add(q.set(Math.cos(angle) * .25, .2 + random() * .3, Math.sin(angle) * .25));
      m.b.copy(at).add(q.set(Math.cos(angle) * spread, 1.1 + random() * 1.4 + moment.tier, Math.sin(angle) * spread));
      m.follow = moment.flyTo === 'player';
      if (moment.flyTo === 'store') m.c.set(0, height(0, 0) + 1.6, 0);
      else if (!m.follow) m.c.copy(m.b).add(q.set(0, 1.2 + moment.tier * 1.4 + random(), 0));
      motes.setColorAt(slot, tint.setHex(random() < .35 ? moment.accent : moment.colour).multiplyScalar(MOTE_TONE));
    }
    motes.instanceColor.needsUpdate = true;
  }
  function spawnRing(moment, at) {
    const r = rings.find(r => !r.alive) || rings.reduce((a, b) => (a.age / a.life > b.age / b.life ? a : b));
    r.alive = true; r.age = 0; r.life = moment.tier === 2 ? 1.4 : .8; r.radius = moment.tier === 2 ? 7 : moment.tier ? 2.6 : 1.4;
    r.mesh.position.copy(at).setY(at.y + .06); r.mesh.material.color.setHex(moment.accent).multiplyScalar(.75); r.mesh.visible = true;
  }
  function spawnPillar(moment, at) {
    const p = pillars.find(p => !p.alive) || pillars.reduce((a, b) => (a.age > b.age ? a : b));
    p.alive = true; p.age = 0; p.life = moment.tier === 2 ? 2.2 : 1.5; p.tall = moment.tier === 2 ? 14 : 7;
    p.mesh.position.copy(at); p.mesh.material.color.setHex(moment.accent).multiplyScalar(.6); p.mesh.visible = true;
  }

  function chime(name, at) {
    const ctx = audio(); if (!ctx || !NOTES[name] || voices >= C.voices) return false;
    const now = clock(); if (now - (lastChime.get(name) ?? -Infinity) < GAPS[name]) return false;
    lastChime.set(name, now);
    let gainScale = 1, pan = 0;
    if (at) { camera.getWorldPosition(eye); const d = eye.distanceTo(at); if (d > HEARD) return false;
      gainScale = 1 / (1 + d / 7);
      q.copy(at).sub(eye).normalize(); origin.set(1, 0, 0).applyQuaternion(camera.quaternion); pan = Math.max(-.85, Math.min(.85, q.dot(origin))); }
    try {
      const t0 = ctx.currentTime + .005, out = ctx.createGain(); out.gain.value = (name === 'victory' ? .085 : .06) * gainScale;
      let tail = out; if (typeof ctx.createStereoPanner === 'function') { const p = ctx.createStereoPanner(); p.pan.value = pan; out.connect(p); tail = p; }
      tail.connect(ctx.destination);
      let end = t0;
      for (const [freq, at0, decayScale = 1] of NOTES[name]) {
        const decay = (name === 'victory' ? 1.8 : name === 'warning' ? 1.2 : .55) * decayScale;
        for (const [ratio, level] of [[1, 1], [2.76, .32], [5.4, .12]]) {
          if (freq * ratio > 12000) continue;
          const o = ctx.createOscillator(), g = ctx.createGain(), start = t0 + at0;
          o.type = name === 'warning' ? 'triangle' : 'sine'; o.frequency.value = freq * ratio;
          g.gain.setValueAtTime(0, start); g.gain.linearRampToValueAtTime(level, start + (name === 'warning' ? .18 : .004));
          g.gain.exponentialRampToValueAtTime(.0005, start + decay / ratio);
          o.connect(g).connect(out); o.start(start); o.stop(start + decay / ratio + .05); end = Math.max(end, start + decay + .05);
        }
      }
      voices++; stats.voices = voices;
      schedule(() => { voices = Math.max(0, voices - 1); try { tail.disconnect(); out.disconnect(); } catch {} }, (end - ctx.currentTime) * 1000 + 50);
      return true;
    } catch { return false; }
  }

  function rumble(r) {
    if (!r || !presenting()) return;
    const now = clock(); if (now - lastRumble < 150) return; lastRumble = now;
    for (let n = 0; n < r.repeat; n++) schedule(() => {
      if (disposed) return;
      for (const source of sources() || []) {
        const actuator = source?.gamepad?.hapticActuators?.[0];
        try { if (actuator?.pulse) { const p = actuator.pulse(Math.min(.6, r.amplitude), Math.min(120, r.duration)); p?.catch?.(() => {}); stats.pulses++; } } catch {}
      }
    }, n * 110);
  }

  return {
    handles: event => !!classifyReward(event, {}),
    handle(event) {
      if (disposed) return null;
      const moment = classifyReward(event, context() || {});
      if (!moment) return null;
      const [x, y, z] = event.position, ground = height(x, z);
      const at = new THREE.Vector3(x, Number.isFinite(y) && y > ground - 1 ? y : ground, z);
      if (moment.tier === 2) at.y = Math.max(at.y, ground);
      root.visible = true; stats.played++;
      spawnMotes(moment, at); if (moment.ring) spawnRing(moment, at); if (moment.pillar) spawnPillar(moment, at);
      chime(moment.chime, moment.spatial ? at : null); rumble(moment.rumble);
      return moment;
    },
    update(dt) {
      if (disposed || !root.visible) return;
      let active = false, top = 0;
      // Homing loot lands at the belt pouch, ahead of and below the eye, never on the lens.
      camera.getWorldPosition(eye); lens.copy(eye); camera.getWorldDirection(q); q.y = 0;
      if (q.lengthSq() > 1e-6) eye.addScaledVector(q.normalize(), .45); eye.y -= .6;
      for (let i = 0; i < C.motes; i++) {
        const m = mote[i]; if (!m.alive) continue;
        m.age += dt; active = true; top = i + 1;
        const t = Math.max(0, m.age) / m.life;
        if (t >= 1) { m.alive = false; scratch.scale.setScalar(0); scratch.updateMatrix(); motes.setMatrixAt(i, scratch.matrix); continue; }
        if (m.follow) m.c.copy(eye);
        const e = t * t * (3 - 2 * t), u = 1 - e;
        scratch.position.set(u * u * m.a.x + 2 * u * e * m.b.x + e * e * m.c.x,
          u * u * m.a.y + 2 * u * e * m.b.y + e * e * m.c.y, u * u * m.a.z + 2 * u * e * m.b.z + e * e * m.c.z);
        const swell = m.age < 0 ? 0 : Math.sin(Math.min(1, t * 1.15) * Math.PI);
        const land = m.follow ? Math.min(1, (1 - t) / .35) : 1;
        // Flecks born beside the viewer stay fleck-sized instead of filling the lens.
        const close = Math.min(1, scratch.position.distanceTo(lens) / 2.4);
        scratch.scale.setScalar(m.size * (.35 + swell * .9) * land * close * close); scratch.rotation.set(m.spin + t * 7, m.spin * .7 + t * 5, 0);
        scratch.updateMatrix(); motes.setMatrixAt(i, scratch.matrix);
      }
      motes.count = top; motes.instanceMatrix.needsUpdate = true;
      for (const r of rings) {
        if (!r.alive) continue; r.age += dt; const t = r.age / r.life;
        if (t >= 1) { r.alive = false; r.mesh.visible = false; continue; }
        active = true; const e = 1 - Math.pow(1 - t, 3);
        r.mesh.scale.setScalar(.25 + e * r.radius); r.mesh.material.opacity = (1 - t) * (1 - t) * .9;
      }
      for (const p of pillars) {
        if (!p.alive) continue; p.age += dt; const t = p.age / p.life;
        if (t >= 1) { p.alive = false; p.mesh.visible = false; continue; }
        active = true; const rise = Math.min(1, t * 4), width = 1 - t * .6;
        p.mesh.scale.set(width, p.tall * (1 - Math.pow(1 - rise, 3)), width);
        p.mesh.material.opacity = t < .2 ? .9 : .9 * (1 - (t - .2) / .8); p.mesh.rotation.y += dt * .8;
      }
      if (!active) root.visible = false;
    },
    stats: () => ({...stats, liveMotes: mote.filter(m => m.alive).length, liveRings: rings.filter(r => r.alive).length,
      livePillars: pillars.filter(p => p.alive).length, visible: root.visible}),
    dispose() {
      if (disposed) return; disposed = true; root.removeFromParent();
      moteGeometry.dispose(); moteMaterial.dispose(); ringGeometry.dispose(); pillarGeometry.dispose();
      for (const r of rings) r.mesh.material.dispose(); for (const p of pillars) p.mesh.material.dispose();
    },
  };
}
