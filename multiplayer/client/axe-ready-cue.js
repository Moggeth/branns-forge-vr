// Orchard's Edge ready cue (2026-10-03): when the held axe's cleave finishes recharging and the light reaches
// the horns of the edge, a quiet whetstone "shing" and a resonant ring, plus one light haptic tick. Local player only;
// edge-triggered on the shared readiness fraction (never on a timer of its own), so it fires once per recharge.

export function createAxeReadyCue({audio = () => null, haptic = () => {}} = {}) {
  let wasReady = null;
  return {
    // Call every frame with the held tool and its special readiness. Returns true on the frame the cue plays.
    update(tool, specialReady) {
      const ready = tool === 'axe' ? specialReady >= .999 : null;
      const fire = wasReady === false && ready === true;
      wasReady = ready;
      if (!fire) return false;
      const context = audio(); if (context) try { playShing(context); } catch {}
      try { haptic(); } catch {}
      return true;
    },
    reset() { wasReady = null; },
  };
}

// Oscillators and one short noise buffer: no assets, ~0.8 s, peak gain well under the impact sounds (.055).
export function playShing(context) {
  const now = context.currentTime, out = context.createGain();
  out.gain.value = 1; out.connect(context.destination);
  // The hone: a bright noise swipe rising through a band-pass.
  const length = Math.round(context.sampleRate * .16), buffer = context.createBuffer(1, length, context.sampleRate), data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const noise = context.createBufferSource(), band = context.createBiquadFilter(), swipe = context.createGain();
  noise.buffer = buffer; band.type = 'bandpass'; band.Q.value = 6;
  band.frequency.setValueAtTime(3200, now); band.frequency.exponentialRampToValueAtTime(7200, now + .14);
  swipe.gain.setValueAtTime(.0001, now); swipe.gain.exponentialRampToValueAtTime(.022, now + .03); swipe.gain.exponentialRampToValueAtTime(.0001, now + .16);
  noise.connect(band).connect(swipe).connect(out); noise.start(now); noise.stop(now + .17);
  // The ring: a fifth, slightly detuned so it shimmers, entering as the swipe ends.
  for (const [hz, gain] of [[1568, .02], [2352, .01], [1572, .008]]) {
    const osc = context.createOscillator(), g = context.createGain();
    osc.type = 'sine'; osc.frequency.value = hz;
    g.gain.setValueAtTime(.0001, now + .07); g.gain.exponentialRampToValueAtTime(gain, now + .09); g.gain.exponentialRampToValueAtTime(.0001, now + .85);
    osc.connect(g).connect(out); osc.start(now + .07); osc.stop(now + .87);
  }
}
