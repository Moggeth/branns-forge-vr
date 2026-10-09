// Keep ballista sound, synthesised on the game's shared AudioContext (no files). Each moment reads by ear alone:
//   Sunlance  draw     a wooden creak and a rising glassy shimmer that climbs with the draw; a bright bell "ting" on
//                      the golden beat (release now for a Dawnbreak)
//             loose    a deep bow thrum, a brassy snap and an airy whoosh; a Dawnbreak adds a rising choir-like chord
//             land     a crystal chime and a thunk (earth, wood or flesh); the Dawnbreak burst rings like a struck bell
//   Gnashjaw  spit     a bony jaw clack, a heavy thunk and a chain rattling out after the harpoon
//             hook     a meaty clank and a chain going taut; yanks jerk the chain with a grunt-like low thud
//             reel     a ratchet that ticks faster as the crank turns
//             chomp    a big crunch and a goofy low "nom" bloop
//   Both      crank    a soft ratchet while winding the reload
// Sounds are placed by distance and a left/right pan from the listener; every voice disconnects itself.

export function createKeepBallistaAudio({audio = () => null, listener = () => null, volume = 1} = {}) {
  let ctx = null, bus = null, noise = null;
  const stats = {voices: 0};
  const ready = () => {
    const c = audio(); if (!c || c.state !== 'running') return null;
    if (c !== ctx) {
      ctx = c; noise = null;
      const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = .004; comp.release.value = .2;
      bus = c.createGain(); bus.gain.value = .8 * volume; bus.connect(comp).connect(c.destination);
    }
    return ctx;
  };
  const noiseBuf = () => {
    if (noise) return noise;
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * .8), ctx.sampleRate); const d = noise.getChannelData(0); let s = 246813579;
    for (let i = 0; i < d.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; d[i] = s / 2147483648 - 1; }
    return noise;
  };
  function place(at, local = false) {
    if (local || !at) return {gain: 1, pan: 0};
    const ear = listener(); if (!ear) return {gain: 1, pan: 0};
    const dx = at[0] - ear.position[0], dz = at[2] - ear.position[2], d = Math.hypot(dx, dz);
    const rx = -ear.forward[2], rz = ear.forward[0], n = Math.hypot(rx, rz) || 1;
    return {gain: 1 / (1 + (d / 16) ** 1.6), pan: d < 1.5 ? 0 : Math.max(-.85, Math.min(.85, (dx * rx + dz * rz) / n / d))};
  }
  function out(p, gain) {
    const g = ctx.createGain(); g.gain.value = gain * p.gain;
    if (ctx.createStereoPanner) { const pn = ctx.createStereoPanner(); pn.pan.value = p.pan; g.connect(pn).connect(bus); } else g.connect(bus);
    setTimeout(() => { try { g.disconnect(); } catch { /* gone */ } }, 3000);
    return g;
  }
  const done = (src, ...nodes) => { src.onended = () => { try { src.disconnect(); nodes.forEach(n => n.disconnect()); } catch { /* gone */ } }; };
  function tone(dest, {type = 'sine', from, to = from, at = 0, length, gain, attack = .003}) {
    const t = ctx.currentTime + at, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(from, t); if (to !== from) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + length);
    g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(.0001, t + length);
    o.connect(g).connect(dest); o.start(t); o.stop(t + length + .03); done(o, g); stats.voices++;
  }
  function hiss(dest, {at = 0, length, gain, type = 'bandpass', from = 2000, to = from, q = 1, rate = 1}) {
    const t = ctx.currentTime + at, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf(); s.playbackRate.value = rate; f.type = type; f.Q.value = q; f.frequency.setValueAtTime(from, t);
    if (to !== from) f.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + length);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(.0001, t + length);
    s.connect(f).connect(g).connect(dest); s.start(t, Math.random() * .4); s.stop(t + length + .03); done(s, f, g); stats.voices++;
  }
  const clicks = (dest, {n, every, at = 0, from = 2600, gain = .3, accel = 1}) => { let t = at, e = every; for (let i = 0; i < n; i++) { hiss(dest, {at: t, length: .018, gain, type: 'bandpass', from: from * (.9 + (i % 3) * .08), q: 4}); t += e; e *= accel; } };
  const chain = (dest, at = 0, n = 10, every = .028) => clicks(dest, {n, every, at, from: 3400, gain: .22, accel: 1.06});

  // --- Sunlance ---------------------------------------------------------------------------------------------------
  function loose({perfect = false, charge = .5, at = null, local = false} = {}) {
    if (!ready()) return; const o = out(place(at, local), local ? 1 : .85), k = .55 + .45 * charge;
    tone(o, {type: 'triangle', from: 110, to: 62, length: .28, gain: .55 * k});     // deep bow thrum
    tone(o, {type: 'sawtooth', from: 340, to: 180, length: .08, gain: .16});          // brassy snap
    hiss(o, {type: 'highpass', from: 1800, length: .05, gain: .55});
    hiss(o, {from: 900, to: 3200, q: .7, length: .35 + .2 * charge, gain: .28 * k});  // whoosh
    if (perfect) for (const [f, a] of [[523, 0], [659, .04], [784, .08], [1047, .12]]) tone(o, {type: 'sine', from: f, to: f * 1.5, at: a, length: .7, gain: .1, attack: .02});
  }
  function land({material = 'earth', perfect = false, at = null} = {}) {
    if (!ready()) return; const o = out(place(at), .9);
    tone(o, {from: material === 'flesh' ? 180 : material === 'wood' ? 260 : 120, to: 70, length: .12, gain: .55});
    hiss(o, {from: material === 'wood' ? 1400 : 900, q: 1.4, length: .1, gain: .35});
    tone(o, {from: 1568, at: .02, length: .4, gain: .09}); tone(o, {from: 2093, at: .05, length: .35, gain: .06}); // crystal chime
    if (perfect) tone(o, {type: 'triangle', from: 880, at: .02, length: .6, gain: .1});
  }
  function burst(at = null) {
    if (!ready()) return; const o = out(place(at), 1);
    for (const [f, g] of [[392, .2], [587, .14], [784, .12], [1175, .08]]) tone(o, {from: f, length: 1.6, gain: g, attack: .004}); // struck bell
    tone(o, {from: 90, to: 40, length: .5, gain: .7}); hiss(o, {type: 'lowpass', from: 1400, to: 200, length: .6, gain: .4});
  }
  function drawStart({at = null, local = false} = {}) {
    if (!ready()) return; const o = out(place(at, local), local ? .8 : .5);
    clicks(o, {n: 5, every: .09, from: 900, gain: .22, accel: 1.15}); // wooden creak
    tone(o, {type: 'triangle', from: 330, to: 660, length: 1.1, gain: .05, attack: .3}); // shimmer
  }
  function perfectBeat() {
    if (!ready()) return; const o = out({gain: 1, pan: 0}, 1);
    tone(o, {from: 1760, length: .5, gain: .18, attack: .002}); tone(o, {from: 2637, at: .03, length: .4, gain: .1, attack: .002});
  }

  // --- Gnashjaw ---------------------------------------------------------------------------------------------------
  function spit({at = null, local = false} = {}) {
    if (!ready()) return; const o = out(place(at, local), local ? 1 : .85);
    hiss(o, {from: 1600, q: 2.5, length: .05, gain: .7});                      // jaw clack
    tone(o, {type: 'square', from: 210, to: 140, length: .05, gain: .18});
    tone(o, {from: 95, to: 45, length: .22, gain: .7});                         // heavy thunk
    chain(o, .04, 14, .022);
  }
  function hook(at = null) {
    if (!ready()) return; const o = out(place(at), 1);
    tone(o, {type: 'square', from: 180, to: 90, length: .09, gain: .25}); hiss(o, {from: 700, q: 1.2, length: .12, gain: .5}); // meaty clank
    tone(o, {type: 'triangle', from: 260, to: 520, at: .05, length: .25, gain: .1}); // chain goes taut
  }
  function yank(at = null) {
    if (!ready()) return; const o = out(place(at), 1);
    tone(o, {from: 120, to: 55, length: .16, gain: .6}); chain(o, 0, 6, .02);
  }
  function chomp(at = null) {
    if (!ready()) return; const o = out(place(at), 1.1);
    hiss(o, {type: 'lowpass', from: 2400, to: 300, length: .22, gain: .9, rate: .8}); // crunch
    clicks(o, {n: 4, every: .03, from: 1800, gain: .4});
    tone(o, {type: 'sine', from: 180, to: 110, at: .14, length: .25, gain: .35, attack: .02}); // "nom"
    tone(o, {type: 'sine', from: 150, to: 90, at: .36, length: .22, gain: .25, attack: .02});
  }
  function snap(at = null) {
    if (!ready()) return; const o = out(place(at), .9);
    hiss(o, {from: 5200, to: 900, q: 1.2, length: .12, gain: .6}); chain(o, .04, 8, .03);
  }
  /** Winding or reeling: call per tick of the crank (rate 0..1 picks the ratchet speed). */
  let lastRatchet = 0;
  function ratchet({at = null, local = false, rate = .5, reel = false} = {}) {
    if (!ready()) return; const now = ctx.currentTime, every = reel ? .07 - rate * .03 : .14 - rate * .06;
    if (now - lastRatchet < every) return; lastRatchet = now;
    const o = out(place(at, local), local ? .45 : .3);
    hiss(o, {from: reel ? 3000 : 2200, q: 5, length: .02, gain: .5});
  }

  /** Route an authority event to its sound. mine: this player fired it (heard close, not placed). */
  function event(ev, mine = false) {
    const at = ev.o || ev.position;
    if (ev.kind === 'keep_ballista_fire') { if (ev.style === 'gnashjaw') spit({at, local: mine}); else loose({perfect: ev.perfect, charge: ev.charge, at, local: mine}); }
    else if (ev.kind === 'keep_ballista_stop' && ev.style === 'sunlance') land({material: ev.material, perfect: ev.perfect, at});
    else if (ev.kind === 'keep_ballista_hit' && ev.style === 'sunlance') land({material: 'flesh', perfect: ev.perfect, at});
    else if (ev.kind === 'keep_ballista_burst') burst(at);
    else if (ev.kind === 'keep_ballista_hook') hook(at);
    else if (ev.kind === 'keep_ballista_yank') yank(at);
    else if (ev.kind === 'keep_ballista_chomp') chomp(at);
    else if (ev.kind === 'keep_ballista_release' && ev.reason === 'snap') snap(at);
    else if (ev.kind === 'keep_ballista_draw' && !mine) drawStart({at});
  }
  return {event, drawStart, perfectBeat, ratchet, stats};
}
