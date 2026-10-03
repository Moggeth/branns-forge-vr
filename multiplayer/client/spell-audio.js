// Procedural WebAudio cues for the fourteen God spells and the Hero gifts they leave.
// Presentation only: no assets, no authority state. Every cue is short, layered from a
// shared noise buffer, oscillators and filters, and fades with distance from the listener.
const RANGE = 48;

export function createSpellAudio(context) {
  if (!context) return {play() {}, gift() {}, dispose() {}};
  const master = context.createGain(); master.gain.value = .9; master.connect(context.destination);
  const length = context.sampleRate * 2, noiseBuffer = context.createBuffer(1, length, context.sampleRate), data = noiseBuffer.getChannelData(0);
  let seed = 22222; for (let i = 0; i < length; i++) { seed = (seed * 16807) % 2147483647; data[i] = seed / 1073741823.5 - 1; }

  // Building blocks: each schedules itself at `t` into `out` and stops on its own.
  const env = (gain, t, attack, peak, release) => { gain.gain.setValueAtTime(.0001, t); gain.gain.exponentialRampToValueAtTime(peak, t + attack); gain.gain.exponentialRampToValueAtTime(.0001, t + attack + release); return t + attack + release + .05; };
  function noise(out, t, {type = 'bandpass', f0 = 800, f1 = f0, q = 1, attack = .01, peak = .1, release = .3, offset = 0} = {}) {
    const src = context.createBufferSource(), filter = context.createBiquadFilter(), g = context.createGain();
    src.buffer = noiseBuffer; filter.type = type; filter.Q.value = q;
    filter.frequency.setValueAtTime(f0, t); filter.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + release);
    src.connect(filter).connect(g).connect(out); const end = env(g, t, attack, peak, release); src.start(t, offset % 1.5); src.stop(end);
  }
  function tone(out, t, {type = 'sine', f0 = 440, f1 = f0, attack = .01, peak = .05, release = .4, vibrato = 0} = {}) {
    const osc = context.createOscillator(), g = context.createGain();
    osc.type = type; osc.frequency.setValueAtTime(f0, t); osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + release);
    if (vibrato) { const lfo = context.createOscillator(), depth = context.createGain(); lfo.frequency.value = vibrato; depth.gain.value = f0 * .03; lfo.connect(depth).connect(osc.frequency); lfo.start(t); lfo.stop(t + attack + release + .05); }
    osc.connect(g).connect(out); const end = env(g, t, attack, peak, release); osc.start(t); osc.stop(end);
  }
  const chord = (out, t, notes, o = {}) => notes.forEach((f, i) => tone(out, t + (o.stagger || 0) * i, {f0: f, f1: f * (o.bend || 1), ...o}));
  const rattle = (out, t, n, spacing = .045) => { for (let i = 0; i < n; i++) noise(out, t + i * spacing * (.7 + .6 * ((i * 7) % 5) / 5), {type: 'bandpass', f0: 1800 + 400 * (i % 3), q: 6, attack: .002, peak: .07, release: .05}); };
  const rumble = (out, t, f0, f1, dur, peak = .12) => { tone(out, t, {f0, f1, attack: dur * .3, peak, release: dur * .7}); noise(out, t, {type: 'lowpass', f0: 180, f1: 90, attack: dur * .25, peak: peak * .9, release: dur * .75}); };

  const CUES = {
    skeleton: (o, t) => { rattle(o, t, 7); tone(o, t + .05, {type: 'triangle', f0: 330, f1: 196, attack: .05, peak: .025, release: .7, vibrato: 6}); },
    squad: (o, t) => { for (let i = 0; i < 4; i++) rattle(o, t + i * .16, 5); tone(o, t, {type: 'triangle', f0: 262, f1: 147, attack: .08, peak: .03, release: 1, vibrato: 5}); },
    golem: (o, t) => { rumble(o, t, 55, 32, 1.4, .16); noise(o, t + .3, {type: 'bandpass', f0: 420, f1: 260, q: 1.5, attack: .2, peak: .05, release: .9}); },
    raise: (o, t) => { rumble(o, t, 38, 92, 1.1); noise(o, t + .45, {type: 'bandpass', f0: 600, f1: 300, q: 1, attack: .05, peak: .06, release: .6}); },
    lower: (o, t) => { rumble(o, t, 95, 34, 1.1); for (let i = 0; i < 5; i++) noise(o, t + .3 + i * .09, {type: 'bandpass', f0: 700, q: 3, attack: .005, peak: .04, release: .12}); },
    sunder: (o, t) => { noise(o, t, {type: 'highpass', f0: 2500, f1: 1200, attack: .002, peak: .16, release: .12}); rumble(o, t + .05, 70, 40, 1.6, .12); },
    wall: (o, t) => { noise(o, t, {type: 'bandpass', f0: 220, f1: 640, q: 2, attack: .2, peak: .08, release: .7}); tone(o, t + .75, {f0: 90, f1: 50, attack: .01, peak: .12, release: .35}); },
    grove: (o, t) => { noise(o, t, {type: 'highpass', f0: 3000, f1: 4500, attack: .3, peak: .025, release: 1.1}); chord(o, t + .1, [523, 659, 784], {attack: .25, peak: .02, release: 1.4, stagger: .12}); },
    ring: (o, t) => { noise(o, t, {type: 'highpass', f0: 3000, attack: .4, peak: .02, release: 1.2}); chord(o, t, [392, 494, 587, 784, 988], {attack: .08, peak: .018, release: 1.1, stagger: .09}); },
    starfall: (o, t, e) => e.phase === 'impact'
      ? (noise(o, t, {type: 'lowpass', f0: 900, f1: 120, attack: .005, peak: .28, release: 1.6}), tone(o, t, {f0: 70, f1: 28, attack: .005, peak: .2, release: 1.2}), chord(o, t + .05, [740, 1110], {attack: .01, peak: .015, release: 1.6}))
      : (tone(o, t, {f0: 1900, f1: 280, attack: .05, peak: .03, release: .8}), noise(o, t, {type: 'bandpass', f0: 3000, f1: 600, q: 2, attack: .1, peak: .04, release: .7})),
    crystal: (o, t) => { [1320, 1985, 2650, 1760].forEach((f, i) => tone(o, t + i * .07, {f0: f, attack: .003, peak: .03, release: 1.2})); noise(o, t, {type: 'highpass', f0: 5000, attack: .002, peak: .03, release: .2}); },
    heal: (o, t) => { noise(o, t, {type: 'bandpass', f0: 3200, q: .7, attack: .5, peak: .05, release: 1.6}); chord(o, t + .2, [349, 440, 523, 698], {attack: .5, peak: .016, release: 1.4}); },
    lightning: (o, t) => { noise(o, t, {type: 'highpass', f0: 4000, f1: 1500, attack: .001, peak: .3, release: .09}); noise(o, t + .12, {type: 'lowpass', f0: 500, f1: 60, attack: .08, peak: .2, release: 1.7, offset: .4}); },
    frost: (o, t) => { [2093, 2637, 3136, 4186].forEach((f, i) => tone(o, t + i * .05, {f0: f, f1: f * 1.02, attack: .01, peak: .012, release: .9, vibrato: 11})); for (let i = 0; i < 6; i++) noise(o, t + i * .06, {type: 'highpass', f0: 6000, attack: .002, peak: .03, release: .05}); },
  };
  const GIFTS = {
    charge: (o, t) => { noise(o, t, {type: 'highpass', f0: 3500, attack: .002, peak: .1, release: .15}); tone(o, t, {type: 'sawtooth', f0: 220, f1: 880, attack: .02, peak: .03, release: .35}); },
    swift: (o, t) => { noise(o, t, {type: 'bandpass', f0: 600, f1: 3000, q: 1.5, attack: .15, peak: .06, release: .3}); tone(o, t + .1, {f0: 1568, attack: .01, peak: .015, release: .5}); },
    charged_strike: (o, t) => { noise(o, t, {type: 'highpass', f0: 2800, attack: .001, peak: .12, release: .1}); tone(o, t, {type: 'square', f0: 1200, f1: 300, attack: .002, peak: .02, release: .18}); },
  };
  const resonance = (o, t) => chord(o, t, [880, 1320], {attack: .02, peak: .025, release: .9, stagger: .08}); // material gifts: one soft blue chime

  function at(position, ear, minimum = 0) {
    if (context.state === 'suspended') return null;
    const d = position && ear ? Math.hypot(position[0] - ear.x, position[2] - ear.z) : 0, gain = Math.max(minimum, 1 - d / RANGE);
    if (gain < .02) return null;
    const out = context.createGain(); out.gain.value = gain; out.connect(master);
    setTimeout(() => out.disconnect(), 4000);
    return out;
  }
  return {
    // `ear` is the listener position {x,z}; the caster always hears their own spell.
    play(event, ear, mine = false) { const cue = CUES[event.spell]; const out = cue && at(event.position, ear, mine ? .45 : 0); if (out) cue(out, context.currentTime + .01, event); },
    gift(event, ear, mine = false) { const cue = GIFTS[event.gift] || GIFTS[event.kind] || resonance; const out = at(event.position, ear, mine ? .5 : 0); if (out) cue(out, context.currentTime + .01); },
    dispose() { master.disconnect(); },
  };
}
