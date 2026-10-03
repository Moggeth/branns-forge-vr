// Timberline flight model: deterministic presentation kinematics for the
// twin-bolt pair. Pure math (no Three.js, no DOM) so a server, a test or a
// client can evaluate it identically. Vectors are plain [x, y, z] arrays in
// metres, Three.js axes (+Y up). Time is seconds since release.
//
// This is a physically *inspired* sequence, not validated aerodynamics:
//   release -> vanes flick open -> lateral spread -> filament snaps taut.
// The vanes give a sideways push only; nothing here produces thrust.

export const TIMBERLINE_FLIGHT = Object.freeze({
  speed: 46,            // m/s along the launch direction
  gravity: 4.0,         // m/s^2 of visible drop (lighter than real g so the pair stays readable)
  deployDelay: 0.035,   // s after release before the vanes open (clear of the horn)
  tautTime: 0.26,       // s after release when the filament reaches full length
  loadedHalf: 0.45,     // half eye-to-eye spacing on the rails (m); launch() overrides from the machine
  tautHalf: 0.56,       // half filament length (m)
  maxYawDeg: 7,         // outward yaw while spreading (exaggerated for readability)
  reboundHalf: 0.018,   // inward give when the filament snaps taut (m)
  reboundDecay: 0.07,   // s
  reboundFreq: 9,       // Hz
  range: 90,            // m before the visual despawns if nothing is hit
});

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };

// Lateral half-spacing (eye to pair centre) and its rate at time t.
export function timberlineHalfSpacing(t, cfg = TIMBERLINE_FLIGHT) {
  const {deployDelay: td, tautTime: tT, loadedHalf: h0, tautHalf: hT} = cfg;
  if (t <= td) return {half: h0, rate: 0, phase: t <= 0 ? 'loaded' : 'release'};
  if (t < tT) {
    // Constant sideways push from the vanes: the gap opens with ease-in
    // (accelerating apart) and is arrested by the filament at tT.
    const u = (t - td) / (tT - td);
    const half = h0 + (hT - h0) * u * u;
    const rate = (hT - h0) * 2 * u / (tT - td);
    return {half, rate, phase: u < 0.12 ? 'deploy' : 'spread'};
  }
  const tau = t - tT;
  const give = cfg.reboundHalf * Math.exp(-tau / cfg.reboundDecay) * Math.abs(Math.sin(Math.PI * cfg.reboundFreq * tau));
  return {half: hT - give, rate: 0, phase: 'taut'};
}

// Filament tension 0..~1.25 (1 = taut, spike on the snap).
export function timberlineTension(t, cfg = TIMBERLINE_FLIGHT) {
  const {tautTime: tT, deployDelay: td} = cfg;
  if (t <= td) return 0.08;
  if (t < tT) return 0.08 + 0.32 * smooth((t - (td + tT) / 2) / ((tT - td) / 2));
  const tau = t - tT;
  return 0.9 + 0.35 * Math.exp(-tau / 0.05);
}

// Vane opening 0..1 (geometry clip does the overshoot; this is the gate).
export function timberlineVaneOpen(t, cfg = TIMBERLINE_FLIGHT) {
  return t < cfg.deployDelay ? 0 : 1;
}

function add(a, b, k = 1) { return [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]; }

// launch = {origin:[x,y,z] midpoint between loaded eyes, forward:[..] unit,
//           right:[..] unit (pair's +X), up:[..] unit}
// Returns world positions of both filament eyes plus per-bolt outward yaw.
export function timberlinePairState(t, launch, cfg = TIMBERLINE_FLIGHT, impact = null) {
  const {half, rate, phase} = timberlineHalfSpacing(t, cfg);
  let dist = cfg.speed * Math.max(0, t);
  let drop = 0.5 * cfg.gravity * Math.max(0, t) ** 2;
  let bow = 0, speedScale = 1, inwardYaw = 0, tension = timberlineTension(t, cfg);
  let impactHalf = half;
  if (impact && t >= impact.time) {
    const r = timberlineImpactResponse(t - impact.time, impact.resistance ?? 0.6, cfg);
    // Distance travelled is integrated piecewise: full speed until impact, then scaled.
    const d0 = cfg.speed * impact.time;
    dist = d0 + r.distance;
    bow = r.bow; speedScale = r.speedScale; inwardYaw = r.inwardYawDeg;
    tension = Math.max(tension, r.tension);
    impactHalf = half - r.pullIn;
  }
  const centre = add(add(launch.origin, launch.forward, dist), launch.up, -drop);
  const yawOut = Math.min(cfg.maxYawDeg, (rate / cfg.speed) * 57.2958 * 30) - inwardYaw;
  return {
    phase: impact && t >= impact.time ? 'impact' : phase,
    left: add(centre, launch.right, -impactHalf),
    right: add(centre, launch.right, impactHalf),
    centre, half: impactHalf, tension, bow, speedScale,
    vaneOpen: timberlineVaneOpen(t, cfg),
    yawOutDeg: yawOut,   // left bolt yaws left by this, right bolt yaws right
    pitchDeg: -Math.atan2(cfg.gravity * Math.max(0, t), cfg.speed) * 57.2958,
  };
}

// Impact response for `tau` seconds after the filament meets resistance.
// resistance 0..1: 0 slices through (grass, a sapling), 1 stops the pair.
// depth: thickness of material along the flight path (m), e.g. trunk diameter.
// There is no thrust, so speed only ever decays: the pair decelerates hard
// while the wire bows and saws through, then carries on at the cut speed.
export function timberlineCutTime(resistance) {
  return 0.04 + 0.16 * clamp01(resistance);
}

export function timberlineImpactResponse(tau, resistance, cfg = TIMBERLINE_FLIGHT, depth = 0.5) {
  const r = clamp01(resistance);
  const stop = r >= 0.999;
  const v0 = cfg.speed;
  const Tc = timberlineCutTime(r);
  const vCut = stop ? 0 : Math.min(v0, depth / Tc + v0 * (1 - r) ** 2);
  const decay = 0.02;
  const e = Math.exp(-tau / decay);
  const speed = vCut + (v0 - vCut) * e;
  const distance = vCut * tau + (v0 - vCut) * decay * (1 - e);
  const maxBow = 0.12 + 0.28 * r;
  const cut = stop ? 0 : smooth((tau - Tc) / 0.05);
  const bow = maxBow * (1 - e) * (1 - cut) * (stop ? 1 - 0.4 * smooth((tau - 0.3) / 0.4) : 1);
  return {
    bow,
    speedScale: speed / v0,
    distance,
    pullIn: bow * 0.35,                     // bowing shortens the chord: bolts are drawn inward
    inwardYawDeg: 14 * bow / 0.40,          // bolts swing toward the obstruction
    tension: 1.0 + 0.6 * (bow / 0.40),
    cut,
  };
}
