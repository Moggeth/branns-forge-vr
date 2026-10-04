// Siegebird reload audio, synthesized on the game's shared AudioContext (no assets, nothing loaded).
// Local player only: string release, ratchet while winding, the latch, a songbird call as the bird
// arrives (one voice per plumage), wingbeats while it hovers, the bolt seating, and the golden bird's chime.
// Panned to the side the bird comes from. Bounded: every voice stops itself within ~0.9 s.

// Short call phrases per plumage: [startHz, endHz, seconds, gap] notes.
const CALLS = Object.freeze({
  kingfisher: [[5200, 6100, .07, .03], [5600, 6400, .07, .03], [5400, 6200, .08, 0]],          // piercing "tsee-tsee"
  robin: [[2300, 2900, .09, .04], [2900, 2400, .1, .05], [2500, 3100, .09, 0]],                // "cheer-i-ly"
  bluebird: [[1900, 2300, .12, .05], [2300, 2050, .14, 0]],                                    // soft "tu-wee"
  cardinal: [[3200, 1600, .13, .04], [3000, 1700, .11, 0]],                                    // down-slurred "birdie"
  chickadee: [[3700, 3600, .06, .03], [3300, 3200, .05, .03], [2400, 2300, .12, 0]],          // "chick-a-dee"
  greenfinch: [[3000, 3300, .035, .015], [3100, 3400, .035, .015], [3000, 3300, .035, .015], [3200, 3500, .035, 0]], // trill
  golden: [[1568, 1568, .1, .02], [1976, 1976, .1, .02], [2349, 2349, .1, .02], [3136, 3136, .22, 0]], // bright arpeggio
});

export function createSiegebirdAudio({context, volume = 1} = {}) {
  if (!context?.createOscillator) throw new Error('createSiegebirdAudio needs the game\'s AudioContext');
  const out = context.createGain(); out.gain.value = .9 * volume; out.connect(context.destination);
  let noise = null;
  const noiseBuffer = () => {
    if (noise) return noise;
    noise = context.createBuffer(1, Math.floor(context.sampleRate * .6), context.sampleRate);
    const d = noise.getChannelData(0); let seed = 1234567;
    for (let i = 0; i < d.length; i++) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; d[i] = (seed / 2147483648) - 1; }
    return noise;
  };
  const stats = {voices: 0};
  function bus(pan = 0) {
    const g = context.createGain(); g.gain.value = 0;
    if (context.createStereoPanner) { const p = context.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p).connect(out); }
    else g.connect(out);
    return g;
  }
  function tone({type = 'sine', from, to = from, at = 0, length, gain, pan = 0, attack = .004}) {
    const t0 = context.currentTime + at, o = context.createOscillator(), g = bus(pan);
    o.type = type; o.frequency.setValueAtTime(from, t0); if (to !== from) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + length);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + attack); g.gain.exponentialRampToValueAtTime(.0001, t0 + length);
    o.connect(g); o.start(t0); o.stop(t0 + length + .02); stats.voices++;
    return o;
  }
  function hiss({at = 0, length, gain, pan = 0, freq = 2000, q = 1, type = 'bandpass', rate = 1}) {
    const t0 = context.currentTime + at, src = context.createBufferSource(), f = context.createBiquadFilter(), g = bus(pan);
    src.buffer = noiseBuffer(); src.playbackRate.value = rate; f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(.0001, t0 + length);
    src.connect(f).connect(g); src.start(t0, Math.random() * .3); src.stop(t0 + length + .02); stats.voices++;
    return {src, gain: g};
  }

  return {
    // Prod release: deep twang with a pitch drop, a wooden thump, and for a golden bolt a ringing chime.
    fire(golden = false) {
      tone({type: 'triangle', from: 196, to: 92, length: .26, gain: .16});
      tone({type: 'sawtooth', from: 294, to: 140, length: .12, gain: .035});
      hiss({length: .07, gain: .2, freq: 900, q: .8});
      if (golden) for (const [f, a] of [[1047, .05], [1568, .04], [2093, .035], [3136, .02]]) tone({from: f, length: .9, gain: a, at: .01, attack: .01});
    },
    // One ratchet tooth on the crank.
    click(index = 0) {
      hiss({length: .014, gain: .055, freq: 4200 + (index % 3) * 300, q: 3});
      tone({type: 'square', from: 2600, to: 1900, length: .011, gain: .009});
    },
    // Cone clutch biting back onto the pinion shaft before the wind: a dull bronze clunk.
    engage() { tone({type: 'triangle', from: 210, to: 120, length: .07, gain: .05}); hiss({length: .04, gain: .05, freq: 900, q: 1.2}); },
    latch() { tone({type: 'square', from: 1300, to: 640, length: .035, gain: .03}); hiss({length: .03, gain: .09, freq: 2500, q: 2}); },
    // The bird's call as it swoops in from its side.
    call(plumage = 'kingfisher', side = 1, golden = false, delay = 0) {
      let at = delay;
      for (const [a, b, len, gap] of CALLS[golden ? 'golden' : plumage] || CALLS.kingfisher) {
        tone({from: a, to: b, at, length: len, gain: golden ? .05 : .045, pan: side * .7, attack: .008}); at += len + gap;
      }
      if (golden) hiss({at: delay, length: .5, gain: .03, freq: 7000, q: .7, pan: side * .6});
    },
    // Wingbeats while hovering: noise gated at the flap rate.
    flutter(side = 1, length = .26, rate = 15, delay = 0) {
      const beats = Math.max(1, Math.round(length * rate));
      for (let i = 0; i < beats; i++) hiss({at: delay + i / rate, length: .045, gain: .05, freq: 520, q: .9, pan: side * (.35 - .3 * i / beats), rate: .7});
    },
    // Bolt dropped into the channel: a soft wooden tock (and a chime when golden).
    seat(golden = false) {
      tone({from: 620, to: 330, length: .06, gain: .07}); hiss({length: .025, gain: .06, freq: 1800, q: 1.5});
      if (golden) { tone({from: 2637, length: .6, gain: .03, at: .02}); tone({from: 3951, length: .5, gain: .018, at: .05}); }
    },
    ready() { tone({from: 2350, length: .07, gain: .012}); },
    stats,
    dispose() { try { out.disconnect(); } catch { /* already gone */ } },
  };
}
