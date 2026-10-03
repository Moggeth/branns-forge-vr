// Siegebird reload timeline: pure numbers shared by the crossbow mechanism (asset-pose.js), the songbird
// flock (siegebird-flock.js), the reload audio and the tests. Times are seconds since the shot.
// The host owns the cooldown (shared/combat.js SIEGEBIRD: 60 ticks, accepted from 54); presentation never
// lets the local player fire before the bird has seated the bolt.

export const SIEGEBIRD_RELOAD = Object.freeze({
  seconds: 1.0,
  trigger: .18,              // talon trigger pulls and returns
  windStart: .10, windEnd: .60, crankTurns: 2,
  enter: .26,                // bird appears off-frame
  arrive: .62,               // hovering beside the rail
  seat: .80,                 // bolt released into the channel; the crossbow's own Bolt shows from here
  settle: .09,               // seated bolt's little drop-and-bounce
  gone: 1.6,                 // bird has flown off the far side
});

// Reload n=1 (the first) comes from the right, n=2 from the left, alternating after that.
export const siegebirdSide = n => (n % 2 === 1 ? 1 : -1);

const clamp01 = n => Math.max(0, Math.min(1, n));
const smooth = t => t * t * (3 - 2 * t);
export const easeInOut = t => { t = clamp01(t); return t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; };

// Mechanism pose for a reload time t (Infinity = fully loaded at rest).
// cocked: 0 string forward .. 1 drawn and latched. string: decaying release vibration (-1..1).
export function siegebirdMechanism(t) {
  const R = SIEGEBIRD_RELOAD;
  if (!Number.isFinite(t) || t < 0) return {cocked: 1, crank: 0, latch: 0, trigger: 0, string: 0, bolt: true, boltDrop: 0, kick: 0};
  const cocked = easeInOut((t - R.windStart) / (R.windEnd - R.windStart));
  const latch = cocked >= 1 ? 0 : t < .05 ? -.8 * t / .05 : cocked > .94 ? -.8 * (1 - smooth((cocked - .94) / .06)) : -.8;
  const trigger = t < R.trigger ? Math.sin(Math.PI * t / R.trigger) : 0;
  const string = t < .4 ? Math.exp(-t * 13) * Math.sin(t * Math.PI * 2 * 21) : 0;
  const since = t - R.seat, boltDrop = since >= 0 && since < R.settle ? Math.abs(Math.cos(since / R.settle * Math.PI * 1.5)) * (1 - since / R.settle) ** 2 : 0;
  // Recoil impulse: fast back, springy return (FPS anchor and remote hands use it).
  const kick = t < .45 ? Math.exp(-t * 11) * Math.cos(t * 17) * clamp01(t / .018) : 0;
  return {cocked, crank: cocked * R.crankTurns * Math.PI * 2, latch, trigger, string, bolt: t >= R.seat, boltDrop, kick};
}

// Deterministic plumage: each player cycles through all six colours in a shuffled order that changes every
// cycle and never repeats back to back, so it reads as a whole flock rather than one bird.
function hash(text) { let h = 0x811c9dc5; for (const c of text) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193); } return h >>> 0; }
function cycleOrder(id, cycle, count) {
  const order = Array.from({length: count}, (_, i) => i);
  let h = hash(`${id}|${cycle}`);
  for (let i = count - 1; i > 0; i--) { h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0; const j = h % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  return order;
}
export function siegebirdPlumage(id = '', n = 1, count = 6) {
  const i = Math.max(0, n - 1), cycle = Math.floor(i / count), slot = i % count;
  const order = cycleOrder(String(id), cycle, count);
  if (cycle > 0) { const prev = cycleOrder(String(id), cycle - 1, count); if (order[0] === prev[count - 1]) [order[0], order[1]] = [order[1], order[0]]; }
  return order[slot];
}

// Reload cues crossed between two reload times (prev exclusive, next inclusive): drives audio and rumble.
// click: ratchet teeth while winding (8 per reload), latch: string caught, enter/arrive/seat/leave: the bird, ready: shot allowed.
const CUES = (() => {
  const R = SIEGEBIRD_RELOAD, list = [];
  for (let i = 1; i <= 8; i++) list.push({at: R.windStart + (R.windEnd - R.windStart) * (i - .5) / 8.4, cue: 'click', index: i});
  list.push({at: R.windEnd, cue: 'latch'}, {at: R.enter, cue: 'enter'}, {at: R.arrive - .1, cue: 'arrive'}, {at: R.seat, cue: 'seat'}, {at: R.seat + .06, cue: 'leave'}, {at: R.seconds, cue: 'ready'});
  return Object.freeze(list.sort((a, b) => a.at - b.at).map(Object.freeze));
})();
export const SIEGEBIRD_CUES = CUES;
export function siegebirdCues(prev, next) {
  if (!Number.isFinite(next) || next <= prev) return [];
  return CUES.filter(c => c.at > prev && c.at <= next);
}
