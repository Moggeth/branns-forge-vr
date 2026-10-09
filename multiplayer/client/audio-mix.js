// The game's one mixing desk. Every sound module still synthesises on the shared AudioContext, but instead of each
// wiring straight to the speakers they land on a bus here:
//
//   sfx ─────┐                                   ┌─ glue compressor (gentle, keeps a busy fight from turning to mush)
//   ui ──────┼─> master ─> glue ─> limiter ─> destination
//   ambience ┘   (ambience and sfx duck for a moment under huge hits: quakes, starfall, dragon dives)
//
// Modules keep calling `context.destination`; `contextFor(bus)` hands them a thin view of the real context whose
// `destination` is that bus, so no module needed rewriting to join the mix. Everything else (createGain, currentTime,
// listener, state) passes straight through to the real context.
//
// Also owns the polite-in-multiplayer rules: a global voice budget for one-shots (phones get fewer), and `level()`,
// the shared distance curve with left/right pan, so new cues place themselves the same way.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function createAudioMix(context, {phone = false, volume = 1} = {}) {
  const master = context.createGain(), glue = context.createDynamicsCompressor(), limiter = context.createDynamicsCompressor();
  // Glue: a soft 3:1 above -20 dB so stacked hits sit together. Limiter: a hard ceiling so nothing ever clips,
  // which matters most on phone speakers where a clipped burst sounds like a crackle.
  glue.threshold.value = -20; glue.knee.value = 12; glue.ratio.value = 3; glue.attack.value = .006; glue.release.value = .25;
  limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = .001; limiter.release.value = .12;
  master.gain.value = volume * (phone ? 1.1 : 1); // phone speakers are quieter; the limiter keeps the extra safe
  master.connect(glue).connect(limiter).connect(context.destination);

  const buses = {};
  const bus = (name, gain) => { const g = context.createGain(); g.gain.value = gain; g.connect(master); buses[name] = {node: g, base: gain}; return g; };
  bus('sfx', 1); bus('ui', .8); bus('ambience', .85);

  const views = new Map();
  function contextFor(name = 'sfx') {
    if (views.has(name)) return views.get(name);
    const destination = buses[name]?.node || buses.sfx.node;
    const view = new Proxy(context, {
      get(target, key) {
        if (key === 'destination') return destination;
        if (key === 'raw') return target;
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
      set(target, key, value) { return Reflect.set(target, key, value, target); },
    });
    views.set(name, view); return view;
  }

  // Ducking: big moments push the bed and other effects down briefly so the moment reads clearly.
  let duckUntil = 0;
  function duck(amount = .5, seconds = 1.2, {keep = []} = {}) {
    const t = context.currentTime; if (t < duckUntil - .2 && amount < .6) return; duckUntil = t + seconds;
    for (const [name, b] of Object.entries(buses)) {
      if (keep.includes(name)) continue;
      const depth = name === 'ambience' ? amount : amount * .45, g = b.node.gain;
      g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(b.base * (1 - depth), t + .04);
      g.setValueAtTime(b.base * (1 - depth), t + seconds * .35); g.linearRampToValueAtTime(b.base, t + seconds);
    }
  }

  // A simple global budget for the cues added in this pass (older kits keep their own pools). Phones get fewer voices.
  const budget = phone ? 18 : 32; let voices = 0, culled = 0;
  function claim(seconds) {
    if (voices >= budget) { culled++; return false; }
    voices++; setTimeout(() => { voices = Math.max(0, voices - 1); }, Math.max(40, seconds * 1000)); return true;
  }

  // Shared placement: 1 up close, half at ~14 m, gone by `range`; pan from the listener's facing.
  function level(position, ear, {range = 45, near = 4, minimum = 0} = {}) {
    if (!position || !ear) return {gain: 1, pan: 0, distance: 0};
    const dx = position[0] - ear.position[0], dz = position[2] - ear.position[2], d = Math.hypot(dx, dz);
    const fall = d <= near ? 1 : 1 / (1 + ((d - near) / (range * .22)) ** 1.6), edge = clamp(1 - d / range, 0, 1);
    const rx = -ear.forward[2], rz = ear.forward[0], n = Math.hypot(rx, rz) || 1;
    return {gain: Math.max(minimum, fall * Math.sqrt(edge)), pan: d < 1.5 ? 0 : clamp((dx * rx + dz * rz) / n / d, -.85, .85), distance: d};
  }

  return {
    context, contextFor, duck, claim, level,
    bus: name => buses[name]?.node || buses.sfx.node,
    setVolume(v) { master.gain.setTargetAtTime(clamp(v, 0, 1.5) * (phone ? 1.1 : 1), context.currentTime, .05); },
    stats: () => ({voices, budget, culled, reduction: +glue.reduction?.toFixed?.(1) || 0}),
    dispose() { master.disconnect(); for (const b of Object.values(buses)) b.node.disconnect(); },
  };
}
