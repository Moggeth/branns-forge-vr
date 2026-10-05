// Wyrmspout feel: the tank the player watches drain and refill, the jaw's spray amount, and the weapon's sound
// and rumble. Presentation only; the tank's truth is the host's (shared/wyrmspout.js), predicted here so the
// gauge and liquid move every frame and the local stream stops exactly when the tank runs dry.
import {WYRMSPOUT,tankFill} from '../shared/wyrmspout.js';

export function createWyrmspoutFeel({audio = () => null, haptic = () => {}, clock = () => performance.now() / 1000} = {}) {
  let fill = 1, shown = 1, spray = 0, goutAt = -Infinity, wasSpraying = false, wasLocked = false, lastPulse = 0, lastSizzle = 0, noise = null;

  // ---------------------------------------------------------------- tank
  function spent(cost) { fill = Math.max(0, fill - cost); }
  function update(dt, {spraying, player, tick, tool}) {
    dt = Math.min(.1, Math.max(0, dt || 0));
    const locked = !!player && (player.overheatUntil || 0) > tick, server = player ? tankFill(player) : 1;
    if (locked) fill = 0;
    else if (spraying) fill = Math.min(fill, server + .05);           // the host may lag our spend; never let it climb mid-burst
    else fill += (server - fill) * (1 - Math.exp(-dt * 6));
    // What the gauge and the liquid show: while locked the tank visibly refills toward the unlock.
    const target = locked ? 1 - Math.max(0, (player.overheatUntil - tick) / WYRMSPOUT.refillTicks) : fill;
    shown += (target - shown) * (1 - Math.exp(-dt * 14));
    spray += ((spraying ? 1 : 0) - spray) * (1 - Math.exp(-dt * (spraying ? 22 : 7)));
    if (tool === 'wyrmspout') {
      if (spraying && !wasSpraying) { whoomp(); haptic([{at: 0, amplitude: .45, duration: 50}], [16]); }
      if (!spraying && wasSpraying) { if (locked || fill <= .001) { dry(); haptic([{at: 0, amplitude: .6, duration: 60}, {at: 110, amplitude: .4, duration: 70}], [30, 40, 50]); } else sputter(); }
      if (spraying && clock() - lastPulse > .09) { lastPulse = clock(); haptic([{at: 0, amplitude: .2 + .1 * Math.random(), duration: 34}], clock() % .4 < .1 ? [8] : null); }
      if (wasLocked && !locked) { refilled(); haptic([{at: 0, amplitude: .25, duration: 25}, {at: 80, amplitude: .25, duration: 25}], [10, 50, 10]); }
    }
    wasSpraying = spraying; wasLocked = locked;
  }

  // ---------------------------------------------------------------- sound (synthesised; the authored flame loop plays underneath)
  function ctx() { const a = audio(); if (!a || a.state === 'closed') return null; if (!noise) { noise = a.createBuffer(1, a.sampleRate, a.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; } return a; }
  function noiseHit(a, at, {dur, from, to, type = 'lowpass', q = .8, gain, attack = .008}) {
    const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    src.buffer = noise; src.playbackRate.value = .8 + .4 * Math.random(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(from, at); f.frequency.exponentialRampToValueAtTime(to, at + dur);
    g.gain.setValueAtTime(.0001, at); g.gain.exponentialRampToValueAtTime(gain, at + attack); g.gain.exponentialRampToValueAtTime(.0001, at + dur);
    src.connect(f).connect(g).connect(a.destination); src.start(at, Math.random() * .5); src.stop(at + dur + .05);
    src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect(); };
  }
  function tone(a, at, {dur, from, to, type = 'sine', gain}) {
    const o = a.createOscillator(), g = a.createGain(); o.type = type;
    o.frequency.setValueAtTime(from, at); o.frequency.exponentialRampToValueAtTime(to, at + dur);
    g.gain.setValueAtTime(.0001, at); g.gain.exponentialRampToValueAtTime(gain, at + .01); g.gain.exponentialRampToValueAtTime(.0001, at + dur);
    o.connect(g).connect(a.destination); o.start(at); o.stop(at + dur + .05); o.onended = () => { o.disconnect(); g.disconnect(); };
  }
  // Ignition: a soft whoomp as the jet catches.
  function whoomp() { const a = ctx(); if (!a) return; const t = a.currentTime; noiseHit(a, t, {dur: .32, from: 220, to: 1800, gain: .22}); tone(a, t, {dur: .22, from: 95, to: 48, gain: .16}); }
  // Letting go: the last of the jet spits and pops.
  function sputter() { const a = ctx(); if (!a) return; const t = a.currentTime; for (let i = 0; i < 3; i++) noiseHit(a, t + .02 + i * .07 * (1 + Math.random() * .4), {dur: .06, from: 900 - i * 200, to: 300, type: 'bandpass', q: 2.5, gain: .09 - i * .02}); }
  // Run dry: a hiss of empty pipes and the brass tank's clunk.
  function dry() { const a = ctx(); if (!a) return; const t = a.currentTime; noiseHit(a, t, {dur: .5, from: 5000, to: 2400, type: 'highpass', gain: .07, attack: .02}); tone(a, t + .05, {dur: .25, from: 880, to: 840, type: 'triangle', gain: .05}); tone(a, t + .05, {dur: .18, from: 1330, to: 1290, type: 'triangle', gain: .03}); tone(a, t + .05, {dur: .2, from: 140, to: 70, gain: .12}); }
  // Refilled: two gulps and a click, ready to spray again.
  function refilled() { const a = ctx(); if (!a) return; const t = a.currentTime; tone(a, t, {dur: .12, from: 210, to: 130, gain: .1}); tone(a, t + .14, {dur: .12, from: 240, to: 150, gain: .1}); tone(a, t + .3, {dur: .04, from: 2400, to: 2000, type: 'square', gain: .025}); }
  // Gout: the wyrm hocks up a ball of fire.
  function gout() {
    goutAt = clock(); haptic([{at: 0, amplitude: .5, duration: 40}, {at: 70, amplitude: .85, duration: 70}], [20, 30, 45]);
    const a = ctx(); if (!a) return; const t = a.currentTime;
    noiseHit(a, t, {dur: .14, from: 600, to: 2200, type: 'bandpass', q: 1.5, gain: .12}); noiseHit(a, t + .1, {dur: .3, from: 1400, to: 260, gain: .2}); tone(a, t + .1, {dur: .3, from: 130, to: 55, gain: .2});
  }
  function distanceGain(event, ear, range = 34) { const p = event.position; if (!p || !ear?.position) return 1; return Math.max(0, 1 - Math.hypot(p[0] - ear.position[0], p[2] - ear.position[2]) / range); }
  function event(e, playerId, ear) {
    const a = ctx(); if (!a || !e) return; const t = a.currentTime;
    if (e.kind === 'gout_burst' || e.kind === 'cling_splash') {
      const k = distanceGain(e, ear); if (k < .03) return;
      noiseHit(a, t, {dur: .45, from: 1600, to: 180, gain: .26 * k}); tone(a, t, {dur: .35, from: 90, to: 40, gain: .22 * k});
      noiseHit(a, t + .15, {dur: .9, from: 6000, to: 3000, type: 'highpass', gain: .05 * k, attack: .1});   // sizzle as it spreads
      if (e.by === playerId) haptic([{at: 0, amplitude: .7, duration: 80}], null);
    } else if (e.kind === 'gout_launch' && e.by !== playerId) {
      const k = distanceGain(e, ear); if (k > .03) { noiseHit(a, t, {dur: .3, from: 1400, to: 260, gain: .14 * k}); tone(a, t, {dur: .3, from: 130, to: 55, gain: .12 * k}); }
    } else if (e.kind === 'goo_stick' && e.by === playerId && t - lastSizzle > .06) {
      lastSizzle = t; noiseHit(a, t, {dur: .09, from: 7000, to: 3500, type: 'highpass', gain: .05});
    }
  }

  return {update, spent, gout, event,
    fill: () => fill,                         // logical: gates the local stream
    shown: () => shown,                       // gauge and liquid
    spray: () => spray,
    goutKick: () => Math.max(0, 1 - (clock() - goutAt) / .35)};
}
