import * as THREE from 'three';

// Brann's Forge — how getting hurt feels (presentation only; the host's 'hit' event with `hero:true` is the evidence).
// Clear but never a red screen: a soft crimson bloom swells on the edge of the view that faces the blow (behind = the
// bottom edge), the HP bar flashes and leaves a pale chip of what was lost, the view gets one small nudge (flat screens
// only: never in VR), phones buzz, VR hands rumble on the side that was struck; the hit sound itself is the sound kit's "hurt" cue. Below
// 30% health a faint edge glow breathes with a quiet heartbeat. Everything decays per frame from performance time.
// Round 2: a crisp crescent (the Overwatch-style damage arc) circles the middle of the view toward each blow, and both
// arc and bloom keep pointing at where the blow came from as you turn, so you can swing round to face it. Healing
// breathes a soft gold-green from the edges. The killing blow stays on screen through the respawn and fades.
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
  arc: .44,               // crescent radius, as a share of the half view height
  arcSpan: .42,           // half-width of the crescent, radians (~24°)
  arcLife: 2,             // seconds the crescent stays (it outlasts the bloom so you can turn to it)
  heal: 1.1,              // seconds a heal glow takes to fade
});

const VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAG = /* glsl */`
precision mediump float;
varying vec2 vUv;
uniform vec4 uHits[${HURT_TUNING.slots}];  // xy screen direction (up = in front), z strength, w warm (fire) 0..1
uniform vec4 uArcs[${HURT_TUNING.slots}];  // x age (s), y crescent strength
uniform float uAspect, uGlow, uLow, uBeat, uTime, uWarm, uHeal, uArcR, uArcSpan;
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
  float hit = 0.0, warm = uWarm * uGlow, arc = 0.0, core = 0.0;
  // Distance from the middle in half-heights, so the crescent is a true circle on any screen shape.
  float r = length(vec2(q.x * uAspect, q.y));
  for (int i = 0; i < ${HURT_TUNING.slots}; i++) {
    vec4 h = uHits[i], c = uArcs[i];
    if (h.z <= .001 && c.y <= .001) continue;     // the crescent outlives the bloom
    float facing = max(0.0, dot(dirN, h.xy) * .5 + .5);
    float band = smoothstep(.5, 1.12, edge * ripple);
    float lobe = pow(facing, 6.0) * band * sqrt(band) * (1.5 + .5 * h.z);
    hit += lobe * h.z; warm += lobe * h.z * h.w;
    // Crescent: pops in a little wide and settles onto its ring; thick in the middle, tapering to points.
    if (c.y > .001) {
      float settle = 1.0 + .22 * exp(-c.x * 14.0), radius = uArcR * settle;
      float off = acos(clamp(dot(dirN, h.xy), -1.0, 1.0)) / uArcSpan;            // 0 at the middle of the arc, 1 at its tips
      float taper = 1.0 - smoothstep(.55, 1.0, off);
      float thick = .034 * (1.0 - off * off) + .006;
      float d = abs(r - radius);
      float body = 1.0 - smoothstep(thick * .7, thick, d);
      float halo = exp(-d * d / (thick * thick * 9.0)) * .55;
      arc += max(body, halo) * taper * c.y;
      core += body * taper * c.y * smoothstep(.45, 0.0, off);
      warm += max(body, halo) * taper * c.y * h.w;
    }
  }
  float low = rim * uLow * (.45 + .55 * uBeat);
  float heal = rim * uHeal;
  float alpha = clamp(hit * .9 + rim * uGlow * .9 + low * .75 + arc * .95 + heal * .8, 0.0, .95);
  if (alpha < .004) discard;
  // Deep crimson on the very rim, a warmer red toward the inside; fire leans ember orange; the crescent burns hot in
  // its middle; healing is a soft gold-green. Output is premultiplied so red stays red over green grass.
  float inner = smoothstep(1.1, .55, edge);
  vec3 blood = mix(vec3(.62, .0, .04), vec3(1.0, .1, .08), inner);
  vec3 ember = mix(vec3(.85, .24, .02), vec3(1.0, .62, .2), inner);
  float total = hit + rim * uGlow + low + arc + heal + 1e-4;
  vec3 col = mix(blood, ember, clamp(warm / max(total, .05), 0.0, 1.0));
  col = mix(col, vec3(1.0, .78, .62), clamp(core * .7, 0.0, .7));
  col = mix(col, vec3(.72, 1.0, .5), clamp(heal / total, 0.0, 1.0));
  gl_FragColor = vec4(col * alpha * 1.2, alpha);
}`;

/**
 * ctx: {camera, view() -> {position: Vector3, yaw} (the live eye, so blooms follow as you turn), presenting(), touch(), reducedMotion,
 *       audio() -> AudioContext|null, haptic(pattern, hand), self() -> player|null}
 */
export function createHurtFeedback({camera, view = null, presenting = () => false, touch = () => false, reducedMotion = false, audio = () => null, haptic = null, self = () => null, maxHp = p => p?.maxHp || 100} = {}) {
  const T = HURT_TUNING;
  const hits = Array.from({length: T.slots}, () => new THREE.Vector4()), arcs = Array.from({length: T.slots}, () => new THREE.Vector4());
  const uniforms = {uHits: {value: hits}, uArcs: {value: arcs}, uAspect: {value: 1}, uGlow: {value: 0}, uLow: {value: 0}, uBeat: {value: 0}, uTime: {value: 0}, uWarm: {value: 0},
    uHeal: {value: 0}, uArcR: {value: T.arc}, uArcSpan: {value: T.arcSpan}};
  // Premultiplied "over": the shader's colour is already multiplied by its alpha (and lifted a touch), so a red edge
  // stays red over grass instead of mixing to brown.
  const material = new THREE.ShaderMaterial({vertexShader: VERT, fragmentShader: FRAG, uniforms, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor});
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  quad.name = 'HurtOverlay'; quad.renderOrder = 10000; quad.frustumCulled = false; quad.visible = false;
  camera?.add(quad);

  const slots = hits.map(() => ({x: 0, y: 1, strength: 0, warm: 0, arc: 0, age: 0, from: null}));
  let heal = 0;
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

  // Screen direction of a world point from the eye: x right, y ahead (behind = down the screen).
  function screenDir(from, v, out) {
    const dx = from[0] - v.position.x, dz = from[2] - v.position.z;
    if (dx * dx + dz * dz <= .04) return false;
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), rx = -fz, rz = fx, a = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
    out.x = Math.sin(a); out.y = Math.cos(a); return true;
  }
  const _d = {x: 0, y: 1};

  // ---- the event -----------------------------------------------------------------------------------------------
  /** A host 'hit' on the local Hero. view: {position: Vector3 (eye), yaw: radians} at the moment it lands. */
  function hurt(event, view) {
    const me = self(); if (!me) return false;
    const max = Math.max(1, maxHp(me)), damage = Math.max(0, Number(event.damage) || 0);
    const severity = THREE.MathUtils.clamp(damage / max * 3.2, .22, 1), warm = event.fire ? 1 : 0;
    let side = 0;
    const at = view?.position ? view : null;
    if (Array.isArray(event.from) && at && screenDir(event.from, at, _d)) {
      // Angle of the source from the view's forward, clockwise positive (right = +90°); behind lands on the bottom edge.
      side = _d.x;
      let slot = slots.reduce((m, s) => s.strength < m.strength ? s : m, slots[0]);
      // Repeated blows from the same side build one bloom instead of stacking copies.
      for (const s of slots) if (s.strength > .05 && s.x * _d.x + s.y * _d.y > .92) { slot = s; break; }
      slot.x = _d.x; slot.y = _d.y; slot.strength = Math.min(1.25, slot.strength * .6 + .5 + .6 * severity); slot.warm = warm;
      slot.from = event.from.slice(0, 3); slot.age = 0; slot.arc = warm ? .55 : Math.min(1, .7 + .5 * severity);
      if (severity > .6) glow = Math.min(1, glow + .3 * severity);          // a heavy blow also flares the whole rim
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
    const eye = view?.();
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      s.strength = Math.max(0, s.strength - dt / T.fade * (s.strength > .7 ? 1.4 : 1));
      s.age += dt; s.arc = Math.max(0, s.arc - dt / T.arcLife * (s.age < .3 ? .3 : 1));
      // Keep pointing at the blow's origin as the player turns (every frame, from the live eye).
      if (s.from && eye && (s.strength > .002 || s.arc > .002) && screenDir(s.from, eye, _d)) {
        const k = 1 - Math.exp(-dt * 30); s.x += (_d.x - s.x) * k; s.y += (_d.y - s.y) * k;
        const l = Math.hypot(s.x, s.y) || 1; s.x /= l; s.y /= l;
      }
      hits[i].set(s.x, s.y, s.strength, s.warm); arcs[i].set(s.age, s.arc, 0, 0);
    }
    glow = Math.max(0, glow - dt / T.fade); warmGlow = Math.max(0, warmGlow - dt * 1.5);
    const me = self(), max = Math.max(1, maxHp(me)), frac = me && me.hp > 0 ? me.hp / max : 1;
    // A respawn (HP jumps back up past half) drops the low-health glow at once but lets the killing blow fade out;
    // a real heal (10%+ at once: draught, drink, ale, Blessing) breathes a soft gold-green; the fountain's trickle does not.
    if (lastHp !== null && me && me.hp > 0 && lastHp > 0) {
      const gain = me.hp - lastHp;
      if (gain > max * .5) low = 0;
      else if (gain >= Math.max(1, max * .1)) heal = Math.min(1, heal + .35 + gain / max * 2);
    }
    lastHp = me ? me.hp : null;
    heal = Math.max(0, heal - dt / T.heal);
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

    const active = glow > .002 || low > .01 || heal > .005 || slots.some(s => s.strength > .002 || s.arc > .002);
    quad.visible = active && !!camera;
    if (!quad.visible) return;
    uniforms.uGlow.value = glow; uniforms.uLow.value = low; uniforms.uBeat.value = beatPulse; uniforms.uTime.value = time; uniforms.uWarm.value = warmGlow; uniforms.uHeal.value = heal;
    // Fill the flat view exactly; in a headset sit a metre out and cover well past the edge of vision.
    const d = xr ? T.xrDistance : Math.max(.06, (camera.near || .05) * 1.6);
    const h = xr ? 2 * d * Math.tan(THREE.MathUtils.degToRad(52)) : 2 * d * Math.tan(THREE.MathUtils.degToRad((camera.fov || 70) / 2));
    const w = xr ? h * 1.15 : h * (camera.aspect || 1);
    quad.position.set(0, 0, -d); quad.scale.set(w * 1.02, h * 1.02, 1);
    uniforms.uAspect.value = w / h;
  }

  function reset() { for (const s of slots) { s.strength = s.arc = 0; s.from = null; } glow = low = warmGlow = heal = 0; spring.pitch = spring.roll = spring.vp = spring.vr = 0; quad.visible = false; meterEl?.classList.remove('bf-low', 'bf-hurt'); }
  function dispose() { reset(); quad.removeFromParent(); quad.geometry.dispose(); material.dispose(); ghost?.remove(); ghost = null; meterEl = null; }
  return {hurt, update, reset, dispose, stats: () => ({visible: quad.visible, glow, low, blooms: slots.filter(s => s.strength > .002).map(s => ({x: s.x, y: s.y, strength: s.strength, arc: s.arc})), heal, pitch: spring.pitch, roll: spring.roll})};
}
