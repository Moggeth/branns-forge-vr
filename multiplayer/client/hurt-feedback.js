import * as THREE from 'three';

// Brann's Forge — how getting hurt feels (presentation only; the host's 'hit' event with `hero:true` is the evidence).
// Clear but never a red screen: a soft crimson bloom swells on the edge of the view that faces the blow (behind = the
// bottom edge), the HP bar flashes and leaves a pale chip of what was lost, the view gets one small nudge (flat screens
// only: never in VR), phones buzz, VR hands rumble on the side that was struck; the hit sound itself is the sound kit's "hurt" cue. Below
// 30% health a faint edge glow breathes with a quiet heartbeat. Everything decays per frame from performance time.
// One camera-held quad draws the overlay, so desktop, phone and headset share the look; it is hidden when idle.

export const HURT_TUNING = Object.freeze({
  slots: 4,               // simultaneous directional blooms (older ones are replaced)
  fade: 1.15,             // seconds a bloom takes to fade out
  low: .3,                // HP fraction that starts the low-health glow and heartbeat
  beat: .86,              // heartbeat period (s) at the threshold; quicker as health falls
  nudge: .022,            // radians of pitch kick at full severity (flat screens only)
  roll: .028,             // radians of roll toward the blow at full severity
  hapticGap: .12,
  xrDistance: 1,          // metres: the overlay sits at a comfortable focal distance in a headset
});

const VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAG = /* glsl */`
precision mediump float;
varying vec2 vUv;
uniform vec4 uHits[${HURT_TUNING.slots}];  // xy screen direction (up = in front), z strength, w warm (fire) 0..1
uniform float uAspect, uGlow, uLow, uBeat, uTime, uWarm;
float hash(float n){ return fract(sin(n) * 43758.5453); }
float noise(float x){ float i = floor(x), f = fract(x); return mix(hash(i), hash(i + 1.0), f * f * (3.0 - 2.0 * f)); }
void main(){
  vec2 q = vUv * 2.0 - 1.0;
  // Superellipse edge distance: 0 in the middle, 1 on the frame, rounder corners than a box.
  vec2 a = abs(q); float edge = pow(pow(a.x, 4.0) + pow(a.y, 4.0), .25);
  vec2 dirN = normalize(vec2(q.x * uAspect, q.y) + 1e-5);
  float ang = atan(dirN.y, dirN.x);
  // A slow living ripple along the rim so the glow reads as light, not a flat gradient.
  float ripple = .82 + .18 * noise(ang * 3.2 + uTime * .9) + .08 * noise(ang * 9.0 - uTime * 2.3);
  float rim = smoothstep(.58, 1.15, edge * ripple); rim *= rim;
  float hit = 0.0, warm = uWarm * uGlow;
  for (int i = 0; i < ${HURT_TUNING.slots}; i++) {
    vec4 h = uHits[i];
    if (h.z <= .001) continue;
    float facing = max(0.0, dot(dirN, h.xy) * .5 + .5);
    float band = smoothstep(.5, 1.12, edge * ripple);
    float lobe = pow(facing, 6.0) * band * sqrt(band) * (1.5 + .5 * h.z);
    hit += lobe * h.z; warm += lobe * h.z * h.w;
  }
  float low = rim * uLow * (.45 + .55 * uBeat);
  float alpha = clamp(hit * .9 + rim * uGlow * .9 + low * .75, 0.0, .9);
  if (alpha < .004) discard;
  // Deep crimson on the very rim, a warmer red toward the inside; fire leans ember orange.
  float inner = smoothstep(1.1, .55, edge);
  vec3 blood = mix(vec3(.5, .0, .03), vec3(.95, .08, .08), inner);
  vec3 ember = mix(vec3(.75, .2, .02), vec3(1.0, .58, .18), inner);
  vec3 col = mix(blood, ember, clamp(warm / max(alpha * 1.4, .05), 0.0, 1.0));
  gl_FragColor = vec4(col, alpha);
}`;

/**
 * ctx: {camera, presenting(), touch(), reducedMotion, audio() -> AudioContext|null, haptic(pattern, hand), self() -> player|null}
 */
export function createHurtFeedback({camera, presenting = () => false, touch = () => false, reducedMotion = false, audio = () => null, haptic = null, self = () => null, maxHp = p => p?.maxHp || 100} = {}) {
  const T = HURT_TUNING;
  const hits = Array.from({length: T.slots}, () => new THREE.Vector4());
  const uniforms = {uHits: {value: hits}, uAspect: {value: 1}, uGlow: {value: 0}, uLow: {value: 0}, uBeat: {value: 0}, uTime: {value: 0}, uWarm: {value: 0}};
  const material = new THREE.ShaderMaterial({vertexShader: VERT, fragmentShader: FRAG, uniforms, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false});
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  quad.name = 'HurtOverlay'; quad.renderOrder = 10000; quad.frustumCulled = false; quad.visible = false;
  camera?.add(quad);

  const slots = hits.map(() => ({x: 0, y: 1, strength: 0, warm: 0}));
  let glow = 0, warmGlow = 0, low = 0, beatClock = 0, beatPulse = 0, time = 0, lastHaptic = -1;
  const spring = {pitch: 0, vp: 0, roll: 0, vr: 0};
  let lastHp = null, ghost = null, ghostTimer = 0, meterEl = null;

  // ---- HP bar: a white flash and a pale chip of the lost health that drains after a beat ----------------------
  function meter() {
    if (meterEl?.isConnected) return meterEl;
    const doc = globalThis.document, fill = doc?.getElementById('hpFill');
    if (!fill) return null;
    if (!doc.getElementById('bfHurtStyle')) {
      const style = doc.createElement('style'); style.id = 'bfHurtStyle';
      style.textContent = `.meter-ghost{position:absolute;inset:0;transform-origin:left;border-radius:4px;background:linear-gradient(90deg,#f6d7c6,#ffe9dc);opacity:.75;transition:transform .55s cubic-bezier(.4,0,.2,1),opacity .55s}
.meter.hp.bf-hurt .meter-track{animation:bf-hurt-flash .42s ease-out}
.meter.hp.bf-low .meter-label,.meter.hp.bf-low .meter-value{animation:bf-low-pulse var(--bf-beat,.86s) ease-in-out infinite}
@keyframes bf-hurt-flash{0%{box-shadow:0 0 0 2px rgba(255,236,222,.95),0 0 14px rgba(255,90,70,.9)}100%{box-shadow:0 0 0 0 rgba(255,236,222,0),0 0 0 rgba(255,90,70,0)}}
@keyframes bf-low-pulse{0%,100%{color:inherit}40%{color:#ff9a86}}
@media (prefers-reduced-motion:reduce){.meter.hp.bf-low .meter-label,.meter.hp.bf-low .meter-value{animation:none;color:#ff9a86}}`;
      doc.head.append(style);
    }
    ghost = fill.parentElement.querySelector('.meter-ghost');
    if (!ghost) { ghost = doc.createElement('span'); ghost.className = 'meter-ghost'; ghost.style.transform = fill.style.transform || 'scaleX(1)'; fill.before(ghost); }
    meterEl = fill.closest('.meter');
    return meterEl;
  }
  function meterHit(fromRatio, toRatio) {
    const el = meter(); if (!el || !ghost) return;
    el.classList.remove('bf-hurt'); void el.offsetWidth; el.classList.add('bf-hurt');
    // Hold the chip at the old health, then let it drain down to the new fill.
    ghost.style.transition = 'none'; ghost.style.opacity = '.75';
    ghost.style.transform = `scaleX(${Math.max(fromRatio, toRatio)})`; void ghost.offsetWidth; ghost.style.transition = '';
    ghostTimer = .38; ghost.dataset.to = String(toRatio);
  }

  // ---- sound: the hit itself is the sound kit's 'hurt' cue (event-sounds.js); this owns only the low-health heartbeat.
// audio() is the mix's sfx view, so `destination` here is the sfx bus, not the speakers.
  function thump(ctx, at, {freq = 118, end = 52, length = .16, gain = .2, pan = 0, noise = .06} = {}) {
    const out = ctx.createGain(); out.gain.value = 1;
    let dest = ctx.destination;
    if (ctx.createStereoPanner && pan) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); p.connect(dest); dest = p; }
    out.connect(dest);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(freq, at); o.frequency.exponentialRampToValueAtTime(end, at + length);
    g.gain.setValueAtTime(.0001, at); g.gain.exponentialRampToValueAtTime(gain, at + .008); g.gain.exponentialRampToValueAtTime(.0001, at + length);
    o.connect(g).connect(out); o.start(at); o.stop(at + length + .02);
    if (noise > 0) {
      const n = Math.floor(ctx.sampleRate * .09), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
      const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), ng = ctx.createGain();
      src.buffer = buf; bp.type = 'bandpass'; bp.frequency.value = 820; bp.Q.value = 1.1; ng.gain.value = noise;
      src.connect(bp).connect(ng).connect(out); src.start(at);
    }
  }
  function heartbeat(level) {
    const ctx = audio(); if (!ctx || ctx.state !== 'running') return;
    const at = ctx.currentTime + .005, g = .045 + .06 * level;
    thump(ctx, at, {freq: 72, end: 44, length: .12, gain: g, noise: 0});
    thump(ctx, at + .19, {freq: 64, end: 40, length: .14, gain: g * .7, noise: 0});
  }

  // ---- the event -----------------------------------------------------------------------------------------------
  /** A host 'hit' on the local Hero. view: {position: Vector3 (eye), yaw: radians} at the moment it lands. */
  function hurt(event, view) {
    const me = self(); if (!me) return false;
    const max = Math.max(1, maxHp(me)), damage = Math.max(0, Number(event.damage) || 0);
    const severity = THREE.MathUtils.clamp(damage / max * 3.2, .22, 1), warm = event.fire ? 1 : 0;
    let side = 0;
    if (Array.isArray(event.from) && view?.position) {
      const dx = event.from[0] - view.position.x, dz = event.from[2] - view.position.z;
      if (dx * dx + dz * dz > .04) {
        // Angle of the source from the view's forward, clockwise positive (right = +90°); behind lands on the bottom edge.
        const fx = -Math.sin(view.yaw), fz = -Math.cos(view.yaw), rx = -fz, rz = fx;
        const a = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
        side = Math.sin(a);
        let slot = slots.reduce((m, s) => s.strength < m.strength ? s : m, slots[0]);
        // Repeated blows from the same side build one bloom instead of stacking copies.
        for (const s of slots) if (s.strength > .05 && s.x * Math.sin(a) + s.y * Math.cos(a) > .92) { slot = s; break; }
        slot.x = Math.sin(a); slot.y = Math.cos(a); slot.strength = Math.min(1.25, slot.strength * .6 + .5 + .6 * severity); slot.warm = warm;
      } else glow = Math.min(1, glow + .45 + .5 * severity);
    } else glow = Math.min(1, glow + (warm ? .22 : .4) + .45 * severity);
    if (warm) warmGlow = 1;
    if (!presenting() && !reducedMotion) {
      spring.vp += T.nudge * severity * 26 * (warm ? .3 : 1);
      spring.vr += -side * T.roll * severity * 26 * (warm ? .3 : 1);
    }
    if (time - lastHaptic >= T.hapticGap) {
      lastHaptic = time;
      if (presenting()) {
        const k = warm ? .45 : 1, main = side > .25 ? 'right' : side < -.25 ? 'left' : null;
        haptic?.([{at: 0, amplitude: (.35 + .5 * severity) * k, duration: 40 + 70 * severity}], main || 'right');
        haptic?.([{at: 0, amplitude: (main ? .25 : .35 + .5 * severity) * k, duration: 40 + 50 * severity}], main === 'right' ? 'left' : main === 'left' ? 'right' : 'left');
      } else if (touch()) try { navigator.vibrate?.(warm ? [12] : severity > .6 ? [45, 40, 25] : [Math.round(18 + 30 * severity)]); } catch {}
    }
    const after = Math.max(0, Number(me.hp) || 0), before = Math.min(max, after + damage);
    meterHit(before / max, after / max);
    return true;
  }

  /** Per frame, after the camera pose is set. Applies the view nudge on flat screens and draws the overlay. */
  function update(dt) {
    dt = Math.min(.1, Math.max(0, dt)); time += dt;
    const xr = presenting();
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      s.strength = Math.max(0, s.strength - dt / T.fade * (s.strength > .7 ? 1.4 : 1));
      hits[i].set(s.x, s.y, s.strength, s.warm);
    }
    glow = Math.max(0, glow - dt / T.fade); warmGlow = Math.max(0, warmGlow - dt * 1.5);
    const me = self(), max = Math.max(1, maxHp(me)), frac = me && me.hp > 0 ? me.hp / max : 1;
    // A respawn (HP jumps back up) clears everything at once; healing eases the glow away.
    if (lastHp !== null && me && me.hp > lastHp + max * .5) { for (const s of slots) s.strength = 0; glow = 0; low = 0; }
    lastHp = me ? me.hp : null;
    const lowTarget = me && me.role !== 'god' && frac < T.low ? THREE.MathUtils.clamp((T.low - frac) / T.low * 1.3 + .25, 0, 1) : 0;
    low += (lowTarget - low) * (1 - Math.exp(-dt * (lowTarget > low ? 2.5 : 1.2)));
    const period = T.beat * (.75 + .25 * frac / T.low);
    if (low > .05) {
      beatClock += dt;
      if (beatClock >= period) { beatClock = 0; heartbeat(low); }
      const p = beatClock / period; beatPulse = Math.exp(-((p - .06) ** 2) / .004) + .6 * Math.exp(-((p - .28) ** 2) / .005);
    } else { beatClock = period * .8; beatPulse = 0; }

    if (ghost && ghostTimer > 0 && (ghostTimer -= dt) <= 0) { ghost.style.transform = `scaleX(${ghost.dataset.to})`; ghost.style.opacity = '.45'; }
    const el = meterEl?.isConnected ? meterEl : (low > .05 ? meter() : null);
    if (el) { el.classList.toggle('bf-low', low > .2); el.style.setProperty('--bf-beat', `${period.toFixed(2)}s`); }

    // View nudge: a damped spring back to rest, never a shake. Flat screens only.
    const k = 210, c = 22;
    spring.vp += (-k * spring.pitch - c * spring.vp) * dt; spring.pitch += spring.vp * dt;
    spring.vr += (-k * spring.roll - c * spring.vr) * dt; spring.roll += spring.vr * dt;
    if (xr || reducedMotion) { spring.pitch = spring.roll = spring.vp = spring.vr = 0; }
    else if (camera && (Math.abs(spring.pitch) > 1e-5 || Math.abs(spring.roll) > 1e-5)) { camera.rotation.x += spring.pitch; camera.rotation.z += spring.roll; }

    const active = glow > .002 || low > .01 || slots.some(s => s.strength > .002);
    quad.visible = active && !!camera;
    if (!quad.visible) return;
    uniforms.uGlow.value = glow; uniforms.uLow.value = low; uniforms.uBeat.value = beatPulse; uniforms.uTime.value = time; uniforms.uWarm.value = warmGlow;
    // Fill the flat view exactly; in a headset sit a metre out and cover well past the edge of vision.
    const d = xr ? T.xrDistance : Math.max(.06, (camera.near || .05) * 1.6);
    const h = xr ? 2 * d * Math.tan(THREE.MathUtils.degToRad(52)) : 2 * d * Math.tan(THREE.MathUtils.degToRad((camera.fov || 70) / 2));
    const w = xr ? h * 1.15 : h * (camera.aspect || 1);
    quad.position.set(0, 0, -d); quad.scale.set(w * 1.02, h * 1.02, 1);
    uniforms.uAspect.value = w / h;
  }

  function reset() { for (const s of slots) s.strength = 0; glow = low = warmGlow = 0; spring.pitch = spring.roll = spring.vp = spring.vr = 0; quad.visible = false; meterEl?.classList.remove('bf-low', 'bf-hurt'); }
  function dispose() { reset(); quad.removeFromParent(); quad.geometry.dispose(); material.dispose(); ghost?.remove(); ghost = null; meterEl = null; }
  return {hurt, update, reset, dispose, stats: () => ({visible: quad.visible, glow, low, blooms: slots.filter(s => s.strength > .002).map(s => ({x: s.x, y: s.y, strength: s.strength})), pitch: spring.pitch, roll: spring.roll})};
}
