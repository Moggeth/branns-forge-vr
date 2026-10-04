// Landmark sounds (procedural Web Audio, no assets): glassy stone bells, rolled chords, a travel whoosh and a crystal
// shatter. Shared by the sanctuary waygate and the outcrop geode views. Distance-attenuated; every node disconnects.
export function createLandmarkAudio({audio = () => null, listener = () => null} = {}) {
  const ready = () => { const ctx = audio(); return ctx && ctx.state === 'running' ? ctx : null; };
  const level = (position, gain) => { const ear = listener(); const d = ear && position ? Math.hypot(position[0] - ear.position[0], position[2] - ear.position[2]) : 0; return gain * Math.max(0, 1 - d / 45); };
  // Bell: inharmonic partials with faster decay on the upper ones. step = semitones above G3.
  function bell(position, step, gain, decay) {
    const ctx = ready(); if (!ctx) return; const g0 = level(position, gain); if (g0 < 0.004) return;
    const t = ctx.currentTime, bus = ctx.createGain(); bus.gain.value = g0; bus.connect(ctx.destination);
    const f = 196 * Math.pow(2, step / 12);
    for (const [ratio, amp] of [[1, 1], [2.0, 0.45], [2.98, 0.25], [4.16, 0.12]]) {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f * ratio;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(amp, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + decay / (1 + ratio * 0.3));
      o.connect(g).connect(bus); o.start(t); o.stop(t + decay + 0.1); o.onended = () => { o.disconnect(); g.disconnect(); };
    }
    setTimeout(() => bus.disconnect(), (decay + 0.3) * 1000);
  }
  const chord = (position, steps, gain = 0.09, gap = 70, decay = 3.2) => steps.forEach((s, i) => setTimeout(() => bell(position, s, gain, decay), i * gap));
  function whoosh(position, gain = 0.12) {
    const ctx = ready(); if (!ctx) return; const g0 = level(position, gain); if (g0 < 0.004) return;
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.6);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(g0, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.75); o.onended = () => { o.disconnect(); g.disconnect(); };
  }
  // Shatter: a bright noise burst through a high-pass, under a falling glass chime.
  function shatter(position, gain = 0.14) {
    const ctx = ready(); if (!ctx) return; const g0 = level(position, gain); if (g0 < 0.004) return;
    const t = ctx.currentTime, n = ctx.sampleRate * 0.4 | 0, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    let s = 9; for (let i = 0; i < n; i++) { s = (Math.imul(s, 1103515245) + 12345) | 0; d[i] = ((s >>> 16) / 32768 - 1) * (1 - i / n) ** 2; }
    const src = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = b; hp.type = 'highpass'; hp.frequency.value = 2400; g.gain.value = g0;
    src.connect(hp).connect(g).connect(ctx.destination); src.start(t); src.onended = () => { src.disconnect(); hp.disconnect(); g.disconnect(); };
    chord(position, [24, 21, 19, 16, 12], gain * 0.55, 45, 1.6);
  }
  return {bell, chord, whoosh, shatter};
}
