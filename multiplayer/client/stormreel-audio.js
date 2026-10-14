// Stormreel sound: everything is synthesised on the game's shared AudioContext (no files). Layered per moment, the way
// the weapon should read by ear alone:
//   charge   a capacitor whine climbing with the hold, crackle clicks that speed up, a ready ping at full charge
//   fire     string twang + sharp crack + sub thump + a falling zap, then a polarity chime: bright and rising for the red
//            (+) bolt, low and falling for the blue (-) one, so you can hear which pole you just lodged
//   plant    the bolt biting in: thud, sizzle, the same polarity chime
//   circuit  an arc-flash bang and roar as the second pole lands (surge), then a held mains buzz with random crackle until it ends
//   reel     a ratchet that speeds up under a rising winch whine and an air zip, ending in a metallic clack and a tiny zap
//   cable    taut-cable creak, the snap when a tether lets go, pack buckle and spin-up when you take or hang it
//   tower    a low transformer hum that swells with the stored charge, and glassy chimes when Crystal goes in
// Sounds are placed by distance and a left/right pan from the listener; every voice disconnects itself.

const POLES = {red: {chime: [1318, 1760], gain: .16}, blue: {chime: [784, 587], gain: .2}};

export function createStormreelAudio({audio = () => null, listener = () => null, volume = 1} = {}) {
  let ctx = null, bus = null, noise = null, loopNoise = null;
  const stats = {voices: 0, loops: 0};
  const ready = () => {
    const c = audio(); if (!c || c.state !== 'running') return null;
    if (c !== ctx) {
      ctx = c; noise = loopNoise = null;
      const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = .004; comp.release.value = .18;
      bus = c.createGain(); bus.gain.value = .85 * volume; bus.connect(comp).connect(c.destination);
    }
    return ctx;
  };
  const noiseBuf = () => {
    if (noise) return noise;
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * .8), ctx.sampleRate); const d = noise.getChannelData(0); let s = 987654321;
    for (let i = 0; i < d.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; d[i] = s / 2147483648 - 1; }
    return noise;
  };
  /** Where a sound lands: loudness by distance and a pan to the side it comes from. `at` is [x,y,z] or null for the player. */
  function place(at, local = false) {
    if (local || !at) return {gain: 1, pan: 0};
    const ear = listener(); if (!ear) return {gain: 1, pan: 0};
    const dx = at[0] - ear.position[0], dz = at[2] - ear.position[2], d = Math.hypot(dx, dz);
    const rx = -ear.forward[2], rz = ear.forward[0], n = Math.hypot(rx, rz) || 1;
    return {gain: 1 / (1 + (d / 14) ** 1.6), pan: d < 1.5 ? 0 : Math.max(-.85, Math.min(.85, (dx * rx + dz * rz) / n / d))};
  }
  /** The arc flash carries: the surge is heard right across the map, a little later the further away you stand. */
  function placeFar(at) {
    const p = place(at), ear = at && listener(); if (!ear) return {...p, delay: 0};
    const d = Math.hypot(at[0] - ear.position[0], at[2] - ear.position[2]);
    return {gain: 1 / (1 + (d / 45) ** 1.4), pan: p.pan, delay: Math.min(.35, d / 343)};
  }
  function out(place_, gain) {
    const g = ctx.createGain(); g.gain.value = gain * place_.gain;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = place_.pan; g.connect(p).connect(bus); } else g.connect(bus);
    return g;
  }
  const done = (src, ...nodes) => { src.onended = () => { try { src.disconnect(); nodes.forEach(n => n.disconnect()); } catch { /* already gone */ } }; };
  function tone(dest, {type = 'sine', from, to = from, at = 0, length, gain, attack = .003, curve = 'exp', hold = 0}) {
    const t = ctx.currentTime + at, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(from, t); if (to !== from) o.frequency[curve === 'lin' ? 'linearRampToValueAtTime' : 'exponentialRampToValueAtTime'](Math.max(20, to), t + length);
    g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack); if (hold) g.gain.setValueAtTime(gain, t + Math.max(attack, length * hold)); g.gain.exponentialRampToValueAtTime(.0001, t + length);   // hold: sustain for that share of the length
    o.connect(g).connect(dest); o.start(t); o.stop(t + length + .03); done(o, g); stats.voices++; return o;
  }
  function hiss(dest, {at = 0, length, gain, type = 'bandpass', from = 2000, to = from, q = 1, rate = 1, am = 0}) {
    const t = ctx.currentTime + at, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf(); s.playbackRate.value = rate; s.loop = length > .35;   // long tails loop the noise
    f.type = type; f.Q.value = q; f.frequency.setValueAtTime(from, t);
    if (to !== from) f.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + length);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(.0001, t + length);
    s.connect(f).connect(g).connect(dest);
    if (am) { const l = ctx.createOscillator(), lg = ctx.createGain(), mod = ctx.createGain(); mod.gain.value = .5; lg.gain.value = .5; l.frequency.value = am; l.type = 'square'; l.connect(lg).connect(mod.gain); g.disconnect(); g.connect(mod).connect(dest); l.start(t); l.stop(t + length + .03); }
    s.start(t, Math.random() * .4); s.stop(t + length + .03); done(s, f, g); stats.voices++; return s;
  }
  const chime = (dest, pole, at = 0, scale = 1) => { const {chime: [a, b], gain} = POLES[pole] || POLES.red; tone(dest, {from: a, at, length: .32, gain: gain * scale, attack: .004}); tone(dest, {from: b, at: at + .07, length: .45, gain: gain * .9 * scale, attack: .004}); tone(dest, {type: 'triangle', from: a * 2, at, length: .15, gain: gain * .25 * scale}); };
  const cleanup = (node, ms) => setTimeout(() => { try { node.disconnect(); } catch { /* gone */ } }, ms);

  /** A bolt leaves the crossbow. `live`: lightning rode it; otherwise just the string and a fizzle. */
  function fire({pole = 'red', charge = 1, live = true, at = null, local = false} = {}) {
    if (!ready()) return; const o = out(place(at, local), local ? 1 : .8); cleanup(o, 1600);
    tone(o, {type: 'triangle', from: 260, to: 150, length: .14, gain: .28});   // string
    hiss(o, {type: 'highpass', from: 1500, length: .05, gain: .5});
    if (!live) { hiss(o, {from: 2400, to: 400, length: .35, gain: .16, q: .8}); return; }
    const k = .55 + .45 * charge;
    hiss(o, {type: 'highpass', from: 2200, length: .07, gain: 1 * k, rate: 1.3});   // the crack
    tone(o, {from: 150, to: 36, length: .22, gain: .85 * k, attack: .002});          // sub thump
    tone(o, {type: 'sawtooth', from: 3800, to: 220, length: .24, gain: .22 * k, curve: 'exp'});   // falling zap
    hiss(o, {from: 1100, q: 3.5, length: .3, gain: .22 * k, am: 110});               // arc buzz tail
    chime(o, pole, .05, .8 * k);
  }
  /** The bolt biting into something: thud, sizzle, then the polarity chime. */
  function plant({pole = 'red', charge = 1, at = null, ground = false} = {}) {
    if (!ready()) return; const o = out(place(at), .85); cleanup(o, 1800); const k = .5 + .5 * charge;
    tone(o, {from: ground ? 130 : 240, to: 80, length: .1, gain: .55 * k});
    hiss(o, {from: 2600, q: 1.6, length: .1, gain: .5 * k});
    hiss(o, {type: 'highpass', from: 5200, length: .45, gain: .2 * k, am: 55});          // sizzle
    chime(o, pole, .06, k);
  }
  /** The second pole lands: a thunder crack; the held buzz is `arcLoop`. */
  function circuitClose(at = null) {
    if (!ready()) return; const o = out(place(at), 1); cleanup(o, 2600);
    hiss(o, {type: 'highpass', from: 3000, length: .09, gain: .9});
    hiss(o, {type: 'lowpass', from: 900, to: 90, length: 1.5, gain: 1, rate: .7});
    tone(o, {from: 80, to: 26, length: .8, gain: 1, attack: .004});
    tone(o, {type: 'sawtooth', from: 2400, to: 120, length: .35, gain: .25});
    chime(o, 'red', .1, .6); chime(o, 'blue', .22, .6);
  }
  function circuitEnd(why, at = null) {
    if (!ready()) return; const o = out(place(at), .9); cleanup(o, 1400);
    if (why === 'reeled') return;   // the reel carries its own sound
    if (why === 'severed' || why === 'snapped') { hiss(o, {from: 5200, to: 900, q: 1.2, length: .12, gain: .8}); tone(o, {from: 900, to: 260, length: .1, gain: .4}); }
    else hiss(o, {from: 2400, to: 300, q: .8, length: .6, gain: .3});
    tone(o, {from: 90, to: 40, length: .3, gain: .3});
  }

  // ---- the held arc: a mains-style buzz with irregular crackle, placed at the line's midpoint --------------------------
  function arcLoop() {
    if (!ready()) return null;
    const g = ctx.createGain(); g.gain.value = 0; const pan = ctx.createStereoPanner?.(); (pan ? g.connect(pan).connect(bus) : g.connect(bus));
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.connect(g);
    const a = ctx.createOscillator(), b = ctx.createOscillator(); a.type = 'square'; b.type = 'sawtooth'; a.frequency.value = 60; b.frequency.value = 121.5; a.connect(lp); b.connect(lp);
    const ns = ctx.createBufferSource(); ns.buffer = noiseBuf(); ns.loop = true; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 1.2;
    const ng = ctx.createGain(); ng.gain.value = .0; ns.connect(bp).connect(ng).connect(g);
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 9; lg.gain.value = .18; lfo.connect(lg).connect(ng.gain);
    const t = ctx.currentTime; for (const n of [a, b, ns, lfo]) n.start(t);
    stats.loops++;
    let alive = true, level = 0, since = 0;
    return {
      /** at: midpoint [x,y,z]; power 0..1 (the tower's charge and rain), dt seconds since the last call. */
      update(at, dt, power = 1) {
        if (!alive) return; const p = place(at, false), now = ctx.currentTime;
        level += (1 - level) * Math.min(1, dt * 8);
        g.gain.setTargetAtTime(.16 * p.gain * level * (.5 + .5 * power), now, .05); if (pan) pan.pan.setTargetAtTime(p.pan, now, .05);
        ng.gain.setTargetAtTime(.12 + .1 * Math.random(), now, .02); bp.frequency.setTargetAtTime(1400 + Math.random() * 1800, now, .03);
        a.frequency.setTargetAtTime(58 + Math.random() * 5, now, .05);
        since += dt;   // irregular crackle: bright cracks at random
        if (since > .05 && Math.random() < dt * 20) { since = 0; const o = out(p, .5 * level); cleanup(o, 400); hiss(o, {type: 'highpass', from: 2500 + Math.random() * 3500, length: .03 + Math.random() * .05, gain: .7}); }
      },
      stop() {
        if (!alive) return; alive = false; const now = ctx.currentTime; g.gain.cancelScheduledValues(now); g.gain.setTargetAtTime(0, now, .04);
        for (const n of [a, b, ns, lfo]) try { n.stop(now + .3); } catch { /* stopped */ }
        setTimeout(() => { try { g.disconnect(); pan?.disconnect(); } catch { /* gone */ } stats.loops--; }, 450);
      },
    };
  }

  // ---- charging in the hand (local) ----------------------------------------------------------------------------------
  function charger() {
    if (!ready()) return null;
    const g = ctx.createGain(); g.gain.value = 0; g.connect(bus);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.connect(g);
    const a = ctx.createOscillator(), b = ctx.createOscillator(), whine = ctx.createOscillator(), wg = ctx.createGain(), trem = ctx.createOscillator(), tg = ctx.createGain();
    a.type = 'sawtooth'; b.type = 'square'; a.frequency.value = 55; b.frequency.value = 110.7; whine.type = 'sine'; whine.frequency.value = 500; wg.gain.value = 0;
    trem.frequency.value = 14; tg.gain.value = .02; trem.connect(tg).connect(wg.gain);
    a.connect(lp); b.connect(lp); whine.connect(wg).connect(g);
    const t = ctx.currentTime; for (const n of [a, b, whine, trem]) n.start(t);
    let alive = true, last = 0, ping = false;
    return {
      /** k 0..1 of the full charge; live false when the tower is dry (a thin dead whine, no climb). */
      set(k, live = true, dt = .016) {
        if (!alive) return; const now = ctx.currentTime, kk = live ? k : .05;
        a.frequency.setTargetAtTime(55 + 150 * kk, now, .05); b.frequency.setTargetAtTime(110.7 + 330 * kk, now, .05); lp.frequency.setTargetAtTime(380 + 2600 * kk, now, .05);
        whine.frequency.setTargetAtTime(520 + 3100 * kk * kk, now, .04); wg.gain.setTargetAtTime(live ? .035 + .07 * kk : .008, now, .05); trem.frequency.setTargetAtTime(11 + 30 * kk, now, .08);
        g.gain.setTargetAtTime(live ? .1 + .13 * kk : .03, now, .05);
        last += dt; if (live && last > .03 && Math.random() < dt * (3 + 40 * kk * kk)) { last = 0; hiss(g, {type: 'highpass', from: 3000 + Math.random() * 3000, length: .012 + Math.random() * .018, gain: .35 + .4 * kk}); }
        if (live && kk >= .98 && !ping) { ping = true; tone(g, {from: 2093, length: .22, gain: .1}); tone(g, {from: 3136, at: .06, length: .2, gain: .07}); }
      },
      stop() { if (!alive) return; alive = false; const now = ctx.currentTime; g.gain.cancelScheduledValues(now); g.gain.setTargetAtTime(0, now, .025); for (const n of [a, b, whine, trem]) try { n.stop(now + .15); } catch { /* stopped */ } setTimeout(() => { try { g.disconnect(); } catch { /* gone */ } }, 300); },
    };
  }

  /** Winding the bolt back in: ratchet clicks that quicken, a rising winch whine, an air zip, then the clack of the seat. */
  function reel({pole = 'red', seconds = .45, at = null, local = false} = {}) {
    if (!ready()) return; const o = out(place(at, local), local ? 1 : .8); cleanup(o, (seconds + 1.2) * 1000);
    let t = 0, gap = .075; while (t < seconds - .03) { hiss(o, {at: t, from: 2300 + Math.random() * 500, q: 3, length: .012, gain: .55}); tone(o, {type: 'square', from: 420, to: 300, at: t, length: .012, gain: .06}); t += gap; gap = Math.max(.016, gap * .9); }
    tone(o, {type: 'sawtooth', from: 180, to: 820, length: seconds, gain: .1, curve: 'exp'});
    hiss(o, {from: 700, to: 4200, q: 1.1, length: seconds, gain: .22});
    const end = seconds;
    tone(o, {from: 1760, at: end, length: .12, gain: .22}); tone(o, {from: 2637, at: end, length: .09, gain: .14}); hiss(o, {at: end, from: 3000, q: 1, length: .03, gain: .6});   // clack
    tone(o, {type: 'sawtooth', from: 2600, to: 400, at: end, length: .16, gain: .12});                                                                                           // seat zap
    chime(o, pole, end + .05, .4);
  }
  function snap(at = null) {
    if (!ready()) return; const o = out(place(at), 1); cleanup(o, 800);
    hiss(o, {from: 6500, to: 1400, q: 1.3, length: .1, gain: .8}); tone(o, {from: 900, to: 280, length: .09, gain: .35}); tone(o, {type: 'sawtooth', from: 2200, to: 300, at: .02, length: .2, gain: .1});
  }
  /** Taut cable groans as the wearer nears the end of the drum. k 0..1. Throttled by the caller. */
  function creak(k, at = null) {
    if (!ready()) return; const o = out(place(at, !at), .5 * k); cleanup(o, 700);
    tone(o, {type: 'sawtooth', from: 190 + 110 * k, to: 150 + 100 * k, length: .3, gain: .12}); hiss(o, {from: 700, q: 6, length: .3, gain: .05 + .05 * k});
  }
  function pack(kind, pole = 'red', at = null, local = false) {
    if (!ready()) return; const o = out(place(at, local), .9), up = kind === 'take'; cleanup(o, 1500);
    tone(o, {from: 190, to: 70, length: .1, gain: .55}); hiss(o, {from: 1300, q: 2, length: .06, gain: .5}); hiss(o, {from: 3200, q: 2, at: .09, length: .04, gain: .35});   // buckle
    tone(o, {type: 'sine', from: up ? 180 : 1400, to: up ? 1400 : 180, at: .1, length: .5, gain: .12, curve: 'exp'});                                                    // capacitors spin up or down
    chime(o, pole, up ? .35 : .3, .35);
  }
  /** Crystal into the hopper (glass chime and a low bloop), or a God's lightning filling the tower (thunder). */
  function towerCharge({at = null, sky = false, crystal = true} = {}) {
    if (!ready()) return; const o = out(place(at), 1); cleanup(o, 3000);
    if (sky) { hiss(o, {type: 'highpass', from: 2800, length: .08, gain: .9}); hiss(o, {type: 'lowpass', from: 800, to: 80, length: 1.6, gain: 1, rate: .65}); tone(o, {from: 70, to: 24, length: .9, gain: 1}); }
    if (crystal) [1568, 2093, 2637, 3136].forEach((f, i) => tone(o, {from: f, at: i * .055, length: .55, gain: .13 - i * .02}));
    tone(o, {from: 120, to: 55, length: .35, gain: .4}); tone(o, {type: 'sawtooth', from: 260, to: 1900, at: .05, length: .5, gain: .06});
  }
  /** A small zap where current catches a foe: called a few times a second per victim by the view. */
  function shock(at = null) {
    if (!ready()) return; const o = out(place(at), .55); cleanup(o, 400);
    hiss(o, {from: 1500 + Math.random() * 900, q: 2, length: .11, gain: .7, am: 85}); tone(o, {type: 'square', from: 220, to: 90, length: .09, gain: .09});
  }

  /** The circuit closes through a foe: an industrial arc flash, not thunder (Mitch, 2026-10-11; "pretty loud", 2026-10-10).
   *  The blast of the flash itself, a distorted mains ROAR with crackle for as long as the arc holds, the breaker slamming
   *  open, the transformer whining down and the slap of the bang coming back off the walls. Heard map-wide. */
  function surge(at = null, wet = false) {
    if (!ready()) return; const p = placeFar(at), o = out(p, 1.9), d = p.delay; cleanup(o, 3600);
    // The flash: a hard crack and a short, punchy blast (an arc flash is an explosion).
    hiss(o, {type: 'highpass', from: 2400, at: d, length: .08, gain: 1.7}); hiss(o, {type: 'bandpass', from: 1100, q: .5, at: d, length: .22, gain: 1.4});
    tone(o, {from: 110, to: 34, at: d, length: .55, gain: 1.6, attack: .002});
    // The roar: mains harmonics driven into distortion, a fierce 100 Hz buzz with a hiss of plasma riding it.
    const drive = ctx.createWaveShaper(), curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 127.5 - 1; curve[i] = Math.tanh(x * 4); }
    drive.curve = curve; const roar = ctx.createGain(); roar.gain.value = .55; drive.connect(roar).connect(o);
    tone(drive, {type: 'sawtooth', from: 100, to: 96, at: d, length: .75, gain: .8, attack: .004, curve: 'lin', hold: .85});
    tone(drive, {type: 'square', from: 50, to: 48, at: d, length: .75, gain: .6, attack: .004, curve: 'lin', hold: .85});
    tone(drive, {type: 'sawtooth', from: 150.5, to: 146, at: d, length: .7, gain: .45, attack: .004, curve: 'lin', hold: .85});
    hiss(o, {from: 2600, q: 1.1, at: d, length: .75, gain: .9, am: 100});
    for (let i = 0; i < 9; i++) hiss(o, {type: 'highpass', from: 2200 + Math.random() * 4000, at: d + .03 + Math.random() * .62, length: .02 + Math.random() * .04, gain: .9 + Math.random() * .5});
    // The breaker slams open and the arc dies; the transformer whines down; the bang slaps back off the walls.
    tone(o, {from: 190, to: 60, at: d + .72, length: .09, gain: .8}); hiss(o, {from: 1300, q: 1.5, at: d + .72, length: .06, gain: .9});
    tone(o, {from: 1900, to: 180, at: d + .7, length: 1.1, gain: .1}); tone(o, {type: 'square', from: 60, to: 55, at: d + .72, length: 1.2, gain: .08});
    hiss(o, {type: 'lowpass', from: 700, to: 90, at: d + .14, length: 1.3, gain: .55, rate: .6});
    if (wet) hiss(o, {type: 'highpass', from: 4200, at: d + .05, length: 1.6, gain: .4});   // steam
    chime(o, 'red', d + .8, .5); chime(o, 'blue', d + .88, .5);
  }
  /** A foe cooked by the circuit: a last fat crackle, a pop and a hiss of smoke. */
  function cooked(at = null) {
    if (!ready()) return; const o = out(place(at), .9); cleanup(o, 2600);
    hiss(o, {from: 2600, q: 1.5, length: .22, gain: .8, am: 95}); tone(o, {from: 300, to: 60, at: .12, length: .18, gain: .45});
    hiss(o, {type: 'highpass', from: 3800, to: 1800, at: .2, length: 1.8, gain: .22});
  }
  /** Hitting the end of the cable: the drum's brake bites (clunk), the cable thrums taut, a spark spits at the fairlead. */
  function tug(k = 1, at = null) {
    if (!ready()) return; const o = out(place(at, !at), .9 * k); cleanup(o, 1200);
    tone(o, {from: 170, to: 70, length: .09, gain: .55}); hiss(o, {from: 1100, q: 2.5, length: .05, gain: .5});                  // brake clunk
    tone(o, {type: 'triangle', from: 92, to: 84, at: .02, length: .55, gain: .3}); tone(o, {type: 'triangle', from: 184, to: 168, at: .02, length: .35, gain: .12});   // thrum
    hiss(o, {type: 'highpass', from: 4500, at: .03, length: .07, gain: .35});                                                        // spark spit
  }
  /** Planting the crossbow: a grunt of effort is the player's; this is the butt biting into the earth and the rail ringing. */
  function spike(pole = 'red', at = null, local = false) {
    if (!ready()) return; const o = out(place(at, local), .95); cleanup(o, 1600);
    tone(o, {from: 120, to: 45, length: .16, gain: .8}); hiss(o, {type: 'lowpass', from: 900, to: 200, length: .25, gain: .6});     // thunk into soil
    tone(o, {type: 'triangle', from: 1180, at: .02, length: .5, gain: .07}); tone(o, {type: 'triangle', from: 1770, at: .02, length: .35, gain: .04});   // rail ring
    chime(o, pole, .12, .3);
  }
  /** A bolt dropping out of a felled foe and clattering on the ground. */
  function clatter(at = null) {
    if (!ready()) return; const o = out(place(at), .7); cleanup(o, 700);
    for (const [t, f] of [[0, 2200], [.09, 2700], [.15, 1900]]) { tone(o, {type: 'triangle', from: f, at: t, length: .06, gain: .12}); hiss(o, {from: f * 1.5, q: 4, at: t, length: .03, gain: .3}); }
  }

  // ---- the tower's transformer hum (one voice, placed at the nearest charged tower) ----------------------------------
  let hum = null;
  function towerHum() {
    if (hum || !ready()) return hum;
    const g = ctx.createGain(); g.gain.value = 0; const pan = ctx.createStereoPanner?.(); (pan ? g.connect(pan).connect(bus) : g.connect(bus));
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300; lp.connect(g);
    const a = ctx.createOscillator(), b = ctx.createOscillator(), c = ctx.createOscillator(); a.type = 'sine'; b.type = 'sawtooth'; c.type = 'sine'; a.frequency.value = 60; b.frequency.value = 120.4; c.frequency.value = 180;
    const bg = ctx.createGain(); bg.gain.value = .35; const cg = ctx.createGain(); cg.gain.value = 0; a.connect(lp); b.connect(bg).connect(lp); c.connect(cg).connect(lp);
    const t = ctx.currentTime; a.start(t); b.start(t); c.start(t);
    hum = {g, pan, lp, a, b, c, cg, since: 0};
    return hum;
  }
  /** towers: [{at:[x,y,z], charge: 0..1, working: bool}] (any order). Call every frame; silent far from every tower. */
  function updateTowers(towers, dt) {
    if (!ready()) return;
    let best = null, bestG = 0;
    for (const t of towers) { const p = place(t.at), power = Math.min(1, t.charge) * (t.working ? 1.7 : 1); if (p.gain * power > bestG) { bestG = p.gain * power; best = {t, p, power}; } }
    if (!best || bestG < .02) { if (hum) hum.g.gain.setTargetAtTime(0, ctx.currentTime, .15); return; }
    const h = towerHum(); if (!h) return; const now = ctx.currentTime, {t, p, power} = best;
    h.g.gain.setTargetAtTime(Math.min(.06, .028 * p.gain * (.25 + power)), now, .12); h.pan?.pan.setTargetAtTime(p.pan, now, .1);
    h.lp.frequency.setTargetAtTime(260 + 500 * Math.min(1, power / 1.7) + (t.working ? 700 : 0), now, .1); h.cg.gain.setTargetAtTime(t.working ? .3 : .05, now, .1);
    h.a.frequency.setTargetAtTime(59.5 + Math.sin(now * .7) * .5, now, .2);
    h.since += dt; if (t.charge > .6 && h.since > .25 && Math.random() < dt * (t.working ? 8 : 1.4)) { h.since = 0; const o = out(p, .35); cleanup(o, 300); hiss(o, {type: 'highpass', from: 3000 + Math.random() * 2000, length: .03, gain: .6}); }
  }
  function dispose() { if (hum) { try { hum.a.stop(); hum.b.stop(); hum.c.stop(); hum.g.disconnect(); } catch { /* gone */ } hum = null; } }

  return {fire, plant, surge, cooked, tug, spike, clatter, circuitClose, circuitEnd, arcLoop, charger, reel, snap, creak, pack, towerCharge, shock, updateTowers, dispose, stats: () => ({...stats})};
}
