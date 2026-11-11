// Rabble critter voices (client only, synthesized, no samples): the Kettlebelly's chuffs, whistle, vent and burst;
// the Bramblehog's snorts, rev, crash and squeal; the Kegtoter's squeaks, fuse fizz, boom and cheer.
// play(event, ear) takes a client/critter-view.js onSound event and the listener position; levels fall off with distance.
const DIST = 34;

export function createCritterAudio(context) {
  let noiseBuf = null; const last = new Map();
  function noiseBuffer(ctx) { if (noiseBuf) return noiseBuf; const n = ctx.sampleRate * 2, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0); let s = 1; for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; d[i] = s / 1073741823.5 - 1; } return noiseBuf = b; }
  function env(ctx, g, t, peak, attack, release) { g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(.0002, peak), t + attack); g.gain.exponentialRampToValueAtTime(.0001, t + attack + release); }
  function tone(ctx, out, t, {type = 'sine', f0, f1 = f0, peak = .05, attack = .01, release = .3, glide = attack + release}) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + glide);
    env(ctx, g, t, peak, attack, release); o.connect(g).connect(out); o.start(t); o.stop(t + attack + release + .05); o.onended = () => { o.disconnect(); g.disconnect(); };
  }
  function noise(ctx, out, t, {type = 'bandpass', f0 = 1000, f1 = f0, q = 1, peak = .05, attack = .01, release = .3}) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = noiseBuffer(ctx); s.loop = true;
    f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + release);
    env(ctx, g, t, peak, attack, release); s.connect(f).connect(g).connect(out); s.start(t, Math.random()); s.stop(t + attack + release + .05); s.onended = () => { s.disconnect(); f.disconnect(); g.disconnect(); };
  }
  const clang = (c, o, t, k = 1) => { for (const [f, p, r] of [[523, .05, .9], [1371, .03, .6], [2219, .02, .4], [3301, .012, .25]]) tone(c, o, t, {type: 'sine', f0: f * (.97 + .06 * Math.random()), f1: f * .985, peak: p * k, attack: .002, release: r}); noise(c, o, t, {type: 'highpass', f0: 3000, peak: .03 * k, attack: .001, release: .05}); };
  const squeak = (c, o, t, f, up = 1.6, dur = .14, peak = .045) => tone(c, o, t, {type: 'triangle', f0: f, f1: f * up, peak, attack: .015, release: dur});
  const CUES = {
    kettle_chuff: (c, o, t) => noise(c, o, t, {type: 'bandpass', f0: 520, f1: 260, q: 1.4, peak: .035, attack: .01, release: .16}),
    kettle_clang: (c, o, t, e) => clang(c, o, t, e.small ? .5 : 1),
    kettle_whistle: (c, o, t) => { tone(c, o, t, {type: 'sine', f0: 900, f1: 2300, peak: .035, attack: .25, release: .35, glide: .55}); tone(c, o, t + .02, {type: 'sine', f0: 1350, f1: 3450, peak: .015, attack: .25, release: .35, glide: .55}); for (let i = 0; i < 6; i++) noise(c, o, t + i * .08, {type: 'bandpass', f0: 2600, q: 5, peak: .03, attack: .002, release: .04}); },
    kettle_vent: (c, o, t) => { noise(c, o, t, {type: 'highpass', f0: 1800, f1: 3500, peak: .12, attack: .02, release: 1.1}); noise(c, o, t, {type: 'lowpass', f0: 300, f1: 120, peak: .1, attack: .01, release: .4}); },
    kettle_leak: (c, o, t) => { noise(c, o, t, {type: 'bandpass', f0: 2400, f1: 4800, q: 2.5, peak: .08, attack: .05, release: 2.4}); tone(c, o, t, {type: 'sine', f0: 1500, f1: 2800, peak: .012, attack: .3, release: 2.1, glide: 2.4}); },
    kettle_burst: (c, o, t) => { noise(c, o, t, {type: 'lowpass', f0: 900, f1: 90, peak: .28, attack: .004, release: .7}); tone(c, o, t, {type: 'sine', f0: 110, f1: 38, peak: .2, attack: .004, release: .6}); clang(c, o, t + .02, 1.2); noise(c, o, t + .05, {type: 'highpass', f0: 2200, peak: .09, attack: .02, release: 1.4}); },
    hog_squeal: (c, o, t, e) => squeak(c, o, t, 700 + Math.random() * 120, e.last ? .5 : 1.4, e.last ? .4 : .15, .05),
    hog_nip: (c, o, t) => { noise(c, o, t, {type: 'bandpass', f0: 600, q: 3, peak: .05, attack: .005, release: .08}); noise(c, o, t + .1, {type: 'bandpass', f0: 520, q: 3, peak: .04, attack: .005, release: .08}); },
    hog_rev: (c, o, t) => { tone(c, o, t, {type: 'sawtooth', f0: 70, f1: 210, peak: .03, attack: .1, release: .4, glide: .5}); noise(c, o, t, {type: 'bandpass', f0: 300, f1: 900, q: 2, peak: .05, attack: .1, release: .4}); },
    hog_bowl: (c, o, t) => { noise(c, o, t, {type: 'lowpass', f0: 500, f1: 150, peak: .12, attack: .003, release: .2}); for (let i = 0; i < 3; i++) noise(c, o, t + .03 + i * .04, {type: 'bandpass', f0: 1800 + i * 400, q: 6, peak: .05, attack: .002, release: .05}); },
    hog_crash: (c, o, t) => { noise(c, o, t, {type: 'lowpass', f0: 700, f1: 100, peak: .16, attack: .003, release: .35}); noise(c, o, t + .02, {type: 'bandpass', f0: 3000, f1: 1500, q: 1, peak: .05, attack: .01, release: .5}); CUES.hog_dizzy(c, o, t + .35); },
    hog_stop: (c, o, t) => { noise(c, o, t, {type: 'bandpass', f0: 1200, f1: 400, q: 1, peak: .06, attack: .01, release: .3}); CUES.hog_dizzy(c, o, t + .25); },
    hog_dizzy: (c, o, t) => { for (let i = 0; i < 3; i++) tone(c, o, t + i * .18, {type: 'triangle', f0: 1500 - i * 150, f1: 1100 - i * 150, peak: .025, attack: .01, release: .14}); },
    mole_squeak: (c, o, t, e) => squeak(c, o, t, 1100 + Math.random() * 200, e.last ? .55 : 1.5, e.last ? .35 : .12),
    mole_cheer: (c, o, t) => { squeak(c, o, t, 900, 1.8, .12, .05); squeak(c, o, t + .2, 1000, 2.1, .22, .05); },
    keg_plant: (c, o, t) => { noise(c, o, t, {type: 'lowpass', f0: 400, f1: 150, peak: .09, attack: .003, release: .12}); noise(c, o, t + .1, {type: 'bandpass', f0: 4200, q: 1, peak: .045, attack: .05, release: 2.4}); squeak(c, o, t + .45, 1300, 1.3, .1, .035); },
    keg_boom: (c, o, t) => { noise(c, o, t, {type: 'lowpass', f0: 1400, f1: 60, peak: .4, attack: .003, release: 1.3}); tone(c, o, t, {type: 'sine', f0: 90, f1: 28, peak: .3, attack: .004, release: 1}); for (let i = 0; i < 6; i++) noise(c, o, t + .1 + i * .07 * Math.random() * 2, {type: 'bandpass', f0: 1500 + Math.random() * 2500, q: 4, peak: .04, attack: .002, release: .06}); },
  };
  function play(event, ear) {
    const ctx = typeof context === 'function' ? context() : context, cue = CUES[event?.kind]; if (!ctx || !cue || !Array.isArray(event.position) || !ear) return;
    const d = Math.hypot(event.position[0] - ear[0], event.position[2] - ear[2]), big = event.kind === 'keg_boom' || event.kind === 'kettle_burst', k = Math.max(0, 1 - d / (big ? DIST * 1.8 : DIST)); if (k < .02) return;
    const key = `${event.kind}:${event.id ?? ''}`, now = ctx.currentTime; if (now - (last.get(key) ?? -9) < (event.kind === 'kettle_chuff' ? .12 : .05)) return; last.set(key, now); if (last.size > 128) last.delete(last.keys().next().value);
    const out = ctx.createGain(); out.gain.value = k * k; out.connect(ctx.destination); cue(ctx, out, now + .005, event); setTimeout(() => out.disconnect(), 3500);
  }
  return {play};
}
