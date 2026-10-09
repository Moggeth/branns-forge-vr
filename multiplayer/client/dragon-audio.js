// Dragon streak sounds, procedural Web Audio (no downloads): a goofy-big roar, fireball whooshes, booms, a breath hiss
// loop, streak chimes and a little fanfare when the dragon is earned. Spatialised by distance and left/right pan from the
// listener pose; at most MAX_VOICES one-shots at once and every gain ramps, so nothing clicks or piles up.
const MAX_VOICES = 12;
export function createDragonAudio(getContext) {
  let ctx = null, out = null, noise = null, voices = 0, breath = null;
  function ready() {
    const c = getContext?.(); if (!c || c.state !== 'running') return null;
    if (c !== ctx) { ctx = c; out = c.createGain(); out.gain.value = .7; out.connect(c.destination); noise = null; breath = null; }
    return ctx;
  }
  function noiseBuffer() {
    if (noise) return noise;
    const n = ctx.sampleRate * 2 | 0, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0); let s = 987654;
    for (let i = 0; i < n; i++) { s = (Math.imul(s, 1103515245) + 12345) | 0; d[i] = ((s >>> 9) / 4194304) - 1; }
    return noise = b;
  }
  // Distance gain and pan towards the source; a source with no position plays centred and full (the rider's own dragon).
  function place(position, listener, level) {
    const g = ctx.createGain(), pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    let gain = level, p = 0;
    if (position && listener) {
      const dx = position[0] - listener.position[0], dy = position[1] - listener.position[1], dz = position[2] - listener.position[2], d = Math.hypot(dx, dy, dz);
      gain = level * Math.min(1, 6 / Math.max(6, d)) ** .8;
      const f = listener.forward, rx = -f[2], rz = f[0], rl = Math.hypot(rx, rz) || 1; // right = forward x up
      p = d > .5 ? Math.max(-.9, Math.min(.9, (dx * rx + dz * rz) / rl / d)) : 0;
    }
    g.gain.value = gain; if (pan) { pan.pan.value = p; g.connect(pan).connect(out); } else g.connect(out);
    return g;
  }
  const claim = () => voices < MAX_VOICES && ++voices;
  const done = node => { node.onended = () => { voices = Math.max(0, voices - 1); }; };
  function env(param, t, peak, attack, hold, decay) { param.setValueAtTime(.0001, t); param.exponentialRampToValueAtTime(peak, t + attack); param.setValueAtTime(peak, t + attack + hold); param.exponentialRampToValueAtTime(.0001, t + attack + hold + decay); }
  function hiss(dest, t, {from, to, q = 1.2, type = 'bandpass', peak, attack, hold = 0, decay, rate = 1}) {
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuffer(); src.playbackRate.value = rate; f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + attack + hold + decay);
    env(g.gain, t, peak, attack, hold, decay); src.connect(f).connect(g).connect(dest); src.start(t, Math.random()); src.stop(t + attack + hold + decay + .05); return src;
  }
  function tone(dest, t, {type = 'sine', from, to = from, peak, attack, hold = 0, decay}) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type;
    o.frequency.setValueAtTime(from, t); o.frequency.exponentialRampToValueAtTime(to, t + attack + hold + decay);
    env(g.gain, t, peak, attack, hold, decay); o.connect(g).connect(dest); o.start(t); o.stop(t + attack + hold + decay + .05); return o;
  }
  return {
    /** A big, slightly silly roar: a growling saw through a vowel filter that wobbles, over a breathy rush. */
    roar(position, listener, {level = .9, pitch = 1} = {}) {
      if (!ready() || !claim()) return; const t = ctx.currentTime, dest = place(position, listener, level);
      const o = ctx.createOscillator(), wob = ctx.createOscillator(), wg = ctx.createGain(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(150 * pitch, t); o.frequency.exponentialRampToValueAtTime(210 * pitch, t + .25); o.frequency.exponentialRampToValueAtTime(70 * pitch, t + 1.3);
      wob.frequency.value = 23; wg.gain.value = 18 * pitch; wob.connect(wg).connect(o.frequency);
      f.type = 'bandpass'; f.Q.value = 3; f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(900, t + .3); f.frequency.exponentialRampToValueAtTime(320, t + 1.3);
      env(g.gain, t, .45, .08, .35, .95); o.connect(f).connect(g).connect(dest); o.start(t); wob.start(t); o.stop(t + 1.45); wob.stop(t + 1.45); done(o);
      hiss(dest, t, {from: 1400, to: 500, q: .7, peak: .35, attack: .06, hold: .3, decay: .9});
    },
    /** One fireball leaving the mouth. */
    whoosh(position, listener) { if (!ready() || !claim()) return; const t = ctx.currentTime, d = place(position, listener, .55); done(hiss(d, t, {from: 300, to: 2400, q: 1.6, peak: .6, attack: .05, decay: .4})); tone(d, t, {type: 'triangle', from: 220, to: 90, peak: .18, attack: .01, decay: .35}); },
    /** An impact; `big` for the dive. */
    boom(position, listener, big = false) {
      if (!ready() || !claim()) return; const t = ctx.currentTime, d = place(position, listener, big ? 1 : .75);
      done(hiss(d, t, {from: big ? 900 : 1600, to: 120, type: 'lowpass', q: .9, peak: big ? .95 : .7, attack: .004, decay: big ? 1.6 : .7}));
      tone(d, t, {from: big ? 95 : 130, to: 32, peak: big ? .9 : .6, attack: .004, decay: big ? 1.1 : .45});
      hiss(d, t + .02, {from: 4000, to: 1500, type: 'highpass', q: .6, peak: .25, attack: .003, decay: .25, rate: 1.4});
    },
    /** The breath loop: call every frame with the current breath amount (0 stops it). */
    breath(amount, position, listener) {
      if (!ready()) return; const t = ctx.currentTime;
      if (!breath && amount > .01) {
        const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), low = ctx.createBiquadFilter(), lg = ctx.createGain();
        src.buffer = noiseBuffer(); src.loop = true; f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = .8; low.type = 'lowpass'; low.frequency.value = 220; g.gain.value = .0001; lg.gain.value = .0001;
        const dest = place(position, listener, 1); src.connect(f).connect(g).connect(dest); src.connect(low).connect(lg).connect(dest); src.start(t);
        breath = {src, g, lg, f, dest};
      }
      if (!breath) return;
      const level = Math.max(.0001, amount * .5);
      breath.g.gain.setTargetAtTime(level, t, .06); breath.lg.gain.setTargetAtTime(level * 1.4, t, .06); breath.f.frequency.setTargetAtTime(700 + 500 * Math.random(), t, .05);
      if (amount <= .01) { const b = breath; breath = null; b.g.gain.setTargetAtTime(.0001, t, .08); b.lg.gain.setTargetAtTime(.0001, t, .08); b.src.stop(t + .5); }
    },
    /** Streak progress: a brighter note for each kill. */
    chime(count) { if (!ready() || !claim()) return; const t = ctx.currentTime, d = place(null, null, .35), f = 523.25 * 2 ** ([0, 2, 4, 7, 9][Math.max(0, Math.min(4, count - 1))] / 12); done(tone(d, t, {type: 'triangle', from: f, peak: .4, attack: .005, decay: .5})); tone(d, t, {from: f * 2, peak: .12, attack: .005, decay: .3}); },
    /** Dragon earned: a rising three-note horn call, then a distant roar. */
    fanfare() { if (!ready() || !claim()) return; const t = ctx.currentTime, d = place(null, null, .5); let last = null; [392, 523.25, 783.99].forEach((f, i) => { last = tone(d, t + i * .13, {type: 'sawtooth', from: f, peak: .16, attack: .02, hold: i === 2 ? .25 : .05, decay: .3}); }); done(last); },
    stop() { if (breath) { try { breath.src.stop(); } catch {} breath = null; } },
    stats() { return {voices, breath: !!breath}; },
  };
}
