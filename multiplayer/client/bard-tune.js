// The town square bard's tunes (shared/town-square.js square_tune): a plucked lute over a soft drum, played with Web
// Audio (no assets) and scheduled on the audio clock so the notes never drift. Four little jigs, picked by the host's
// tick so every player hears the same one. Distance-attenuated like the landmark sounds; every node disconnects.
// Notes are [beat, semitones above D4, beats long]; drum hits are beats.
export const BARD_SONGS = Object.freeze([
  {name: 'The Sunny Anvil', bpm: 150, notes: [[0, 0, 1], [1, 4, 1], [2, 7, 1], [3, 4, 1], [4, 5, 1], [5, 9, 1], [6, 12, 2], [8, 11, 1], [9, 9, 1], [10, 7, 1], [11, 5, 1], [12, 4, 1], [13, 2, 1], [14, 0, 2],
    [16, 0, 1], [17, 4, 1], [18, 7, 1], [19, 12, 1], [20, 11, 1], [21, 7, 1], [22, 9, 2], [24, 7, 1], [25, 5, 1], [26, 4, 1], [27, 2, 1], [28, 4, .5], [28.5, 2, .5], [29, 0, 3]], drum: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28]},
  {name: 'Goblin in the Butter', bpm: 168, notes: [[0, 7, .5], [.5, 9, .5], [1, 10, 1], [2, 9, .5], [2.5, 7, .5], [3, 5, 1], [4, 7, 1], [5, 3, 1], [6, 2, 2], [8, 7, .5], [8.5, 9, .5], [9, 10, 1], [10, 12, 1], [11, 14, 1], [12, 12, .5], [12.5, 10, .5], [13, 9, 1], [14, 7, 2],
    [16, 14, 1], [17, 12, .5], [17.5, 10, .5], [18, 9, 1], [19, 7, 1], [20, 5, 1], [21, 7, .5], [21.5, 9, .5], [22, 10, 2], [24, 9, 1], [25, 7, 1], [26, 2, 1], [27, 5, 1], [28, 7, 3]], drum: [0, 1.5, 3, 4, 5.5, 7, 8, 9.5, 11, 12, 13.5, 15, 16, 17.5, 19, 20, 21.5, 23, 24, 25.5, 27, 28]},
  {name: 'Brann Lost His Hammer', bpm: 132, notes: [[0, 0, 1.5], [1.5, 2, .5], [2, 4, 1], [3, 7, 1], [4, 9, 2], [6, 7, 2], [8, 5, 1.5], [9.5, 4, .5], [10, 2, 1], [11, 4, 1], [12, 0, 4],
    [16, 7, 1.5], [17.5, 9, .5], [18, 12, 1], [19, 9, 1], [20, 7, 2], [22, 4, 2], [24, 5, 1], [25, 4, 1], [26, 2, 1], [27, 4, 1], [28, 0, 4]], drum: [0, 3, 4, 7, 8, 11, 12, 15, 16, 19, 20, 23, 24, 27, 28]},
  {name: 'Apples for the Golem', bpm: 156, notes: [[0, 12, .5], [.5, 11, .5], [1, 12, 1], [2, 7, 1], [3, 4, 1], [4, 7, 1], [5, 12, 1], [6, 16, 2], [8, 14, .5], [8.5, 12, .5], [9, 11, 1], [10, 7, 1], [11, 11, 1], [12, 14, 1], [13, 11, 1], [14, 7, 2],
    [16, 12, .5], [16.5, 11, .5], [17, 12, 1], [18, 16, 1], [19, 19, 1], [20, 17, 1], [21, 16, 1], [22, 14, 2], [24, 12, 1], [25, 11, 1], [26, 9, 1], [27, 7, 1], [28, 12, 3]], drum: [0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28]},
]);
export const songLength = song => Math.max(...song.notes.map(([b, , l]) => b + l)) * 60 / song.bpm;

export function createBardTune({audio = () => null, listener = () => null} = {}) {
  const ready = () => { const ctx = audio(); return ctx && ctx.state === 'running' ? ctx : null; };
  const level = (position, gain) => { const ear = listener(); const d = ear && position ? Math.hypot(position[0] - ear.position[0], position[2] - ear.position[2]) : 0; return gain * Math.max(0, 1 - d / 40); };
  let playing = null;
  function pluck(ctx, bus, t, f, len) {
    // a lute-ish pluck: bright saw through a closing lowpass, a quick body thump, and a soft octave shimmer
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = f; o2.type = 'triangle'; o2.frequency.value = f * 2.003;
    lp.type = 'lowpass'; lp.Q.value = 2; lp.frequency.setValueAtTime(f * 9, t); lp.frequency.exponentialRampToValueAtTime(f * 1.4, t + .25);
    const end = t + Math.min(1.6, .35 + len * .5);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.32, t + .004); g.gain.exponentialRampToValueAtTime(.0001, end);
    const g2 = ctx.createGain(); g2.gain.value = .25;
    o.connect(lp); o2.connect(g2).connect(lp); lp.connect(g).connect(bus);
    o.start(t); o2.start(t); o.stop(end + .05); o2.stop(end + .05);
    o.onended = () => { o.disconnect(); o2.disconnect(); g2.disconnect(); lp.disconnect(); g.disconnect(); };
  }
  function thump(ctx, bus, t, accent) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine';
    o.frequency.setValueAtTime(accent ? 120 : 95, t); o.frequency.exponentialRampToValueAtTime(48, t + .14);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(accent ? .5 : .3, t + .005); g.gain.exponentialRampToValueAtTime(.0001, t + .22);
    o.connect(g).connect(bus); o.start(t); o.stop(t + .25); o.onended = () => { o.disconnect(); g.disconnect(); };
  }
  /** Plays song `index` from `position`; a new request while one plays is ignored. Returns the length in seconds. */
  function play(position, index = 0) {
    const ctx = ready(), song = BARD_SONGS[((index | 0) % BARD_SONGS.length + BARD_SONGS.length) % BARD_SONGS.length], length = songLength(song);
    if (!ctx || (playing && ctx.currentTime < playing)) return length;
    const g0 = level(position, .16); if (g0 < .004) return length;
    const t0 = ctx.currentTime + .05, beat = 60 / song.bpm, bus = ctx.createGain(); bus.gain.value = g0; bus.connect(ctx.destination);
    for (const [b, step, len] of song.notes) pluck(ctx, bus, t0 + b * beat, 293.66 * Math.pow(2, step / 12), len * beat);
    // the bass string: the low root at the top of every bar
    for (let b = 0; b < song.notes.at(-1)[0]; b += 4) pluck(ctx, bus, t0 + b * beat, 146.83, 2 * beat);
    for (const b of song.drum) thump(ctx, bus, t0 + b * beat, b % 4 === 0);
    playing = t0 + length;
    setTimeout(() => bus.disconnect(), (length + 2) * 1000);
    return length;
  }
  return {play, songs: BARD_SONGS};
}
