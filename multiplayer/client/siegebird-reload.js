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
  quick: .75,                // a perfect wind makes the next reload run in 0.75 s (shared/combat.js quickTicks)
});

// Reload n=1 (the first) comes from the right, n=2 from the left, alternating after that.
export const siegebirdSide = n => (n % 2 === 1 ? 1 : -1);

const clamp01 = n => Math.max(0, Math.min(1, n));
const smooth = t => t * t * (3 - 2 * t);
export const easeInOut = t => { t = clamp01(t); return t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; };

// Winch geometry (assets/siegebird-opus contract): the crank and the 10-tooth pinion share a shaft through a cone
// clutch; the pinion drives the 20-tooth reduction gear, which is fixed to the cable drum. One drum turn hauls the
// sled the full 0.255 m draw (drum cable radius = travel / tau), so two crank turns cock the bow.
// An 18-tooth crown ratchet on the drum carries the pawl (Latch): it clicks over every tooth while winding and
// holds the drawn string. The trigger lifts the pawl and the clutch slides out, so on release the string throws
// the sled forward, the cable pays out and the drum, reduction and pinion spin back while the crank stays put.
export const SIEGEBIRD_WINCH = Object.freeze({
  pinionTeeth: 10, gearTeeth: 20, ratchetTeeth: 18, crankTurns: 2,
  release: .045,             // string throws the sled from full draw to the front stop
  baseWraps: 2.4,            // cable turns left on the drum with the string forward (one more when drawn)
  clutchTravel: .027,        // the cone clutch slides outboard on release
});

// Mechanism pose for a reload time t (Infinity = fully loaded at rest). Angles in radians about each part's axle.
// cocked: sled draw 0 forward .. 1 drawn and latched. flex: bow-arm overshoot after release (negative = forward).
// string: decaying string hum. clutch: 0 engaged .. 1 slid out. wound: cable turns on the drum.
// hand (0..1, optional): a VR hand turning the crank drives the wind instead of the clock (siegebird-wind.js).
export function siegebirdMechanism(t, hand = null) {
  const R = SIEGEBIRD_RELOAD, W = SIEGEBIRD_WINCH;
  if (!Number.isFinite(t) || t < 0) return {cocked: 1, crank: 0, pinion: 0, drum: 0, clutch: 0, latch: 0, trigger: 0, string: 0, flex: 0, wound: W.baseWraps + 1, bolt: true, boltDrop: 0, kick: 0};
  const wind = Number.isFinite(hand) && t >= R.windStart ? clamp01(hand) : easeInOut((t - R.windStart) / (R.windEnd - R.windStart));
  const cocked = t < W.release ? 1 - (t / W.release) ** 2 : wind;
  const u = t - W.release;
  const flex = u > 0 && u < .5 ? -.26 * Math.exp(-u * 16) * Math.sin(Math.PI * 2 * 7 * u) * (1 - cocked) ** 2 : 0;
  const string = u > 0 && u < .45 ? Math.exp(-u * 13) * Math.sin(u * Math.PI * 2 * 21) : 0;
  const clutch = t < R.windStart - .04 ? smooth(clamp01(t / .02)) : 1 - smooth(clamp01((t - (R.windStart - .04)) / .03));
  // Pawl: lifted by the trigger, dropped onto the ratchet as the clutch bites, rides up each tooth and snaps
  // off its crest (one click per tooth), then falls into the last notch to hold the draw.
  const tooth = cocked * W.ratchetTeeth, ride = -(.05 + .14 * (tooth - Math.floor(tooth)));
  const latch = t < .03 ? -.8 * t / .03 : t < R.windStart - .03 ? -.8
    : t < R.windStart ? -.8 + (.8 + ride) * smooth((t - (R.windStart - .03)) / .03)
    : wind >= 1 ? 0 : wind > .97 ? ride * (1 - smooth((wind - .97) / .03)) : ride;
  const trigger = t < R.trigger ? Math.sin(Math.PI * t / R.trigger) : 0;
  const since = t - R.seat, boltDrop = since >= 0 && since < R.settle ? Math.abs(Math.cos(since / R.settle * Math.PI * 1.5)) * (1 - since / R.settle) ** 2 : 0;
  // Recoil impulse: fast back, springy return (FPS anchor and remote hands use it).
  const kick = t < .45 ? Math.exp(-t * 11) * Math.cos(t * 17) * clamp01(t / .018) : 0;
  const drumTurns = cocked, crank = t < R.windStart ? 0 : wind * W.crankTurns * Math.PI * 2;
  return {cocked, crank, pinion: drumTurns * W.crankTurns * Math.PI * 2, drum: -drumTurns * Math.PI * 2, clutch, latch, trigger, string, flex,
    wound: W.baseWraps + cocked, bolt: t >= R.seat, boltDrop, kick};
}

// Ratchet cues crossed while a hand winds from draw a to draw b: one click per tooth, then the latch.
export function siegebirdHandCues(a, b) {
  const W = SIEGEBIRD_WINCH, out = [];
  if (!(b > a)) return out;
  for (let i = Math.floor(a * W.ratchetTeeth) + 1; i < W.ratchetTeeth && i / W.ratchetTeeth <= b; i++) out.push({cue: 'click', index: i});
  if (a < 1 && b >= 1) out.push({cue: 'latch'});
  return out;
}

// Reload time at which the winding reaches a given draw (inverse of the eased wind).
function windTime(draw) {
  const R = SIEGEBIRD_RELOAD; let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (easeInOut(mid) < draw) lo = mid; else hi = mid; }
  return R.windStart + (R.windEnd - R.windStart) * (lo + hi) / 2;
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
// release: string thrown and drum spinning back, engage: clutch bites, click: one per ratchet tooth the pawl
// drops off while winding (17), latch: the pawl falls into the last notch, enter/arrive/seat/leave: the bird,
// ready: shot allowed.
const CUES = (() => {
  const R = SIEGEBIRD_RELOAD, W = SIEGEBIRD_WINCH, list = [{at: 1e-6, cue: 'release'}, {at: R.windStart - .02, cue: 'engage'}];
  for (let i = 1; i < W.ratchetTeeth; i++) list.push({at: windTime(i / W.ratchetTeeth), cue: 'click', index: i});
  list.push({at: R.windEnd, cue: 'latch'}, {at: R.enter, cue: 'enter'}, {at: R.arrive - .1, cue: 'arrive'}, {at: R.seat, cue: 'seat'}, {at: R.seat + .06, cue: 'leave'}, {at: R.seconds, cue: 'ready'});
  return Object.freeze(list.sort((a, b) => a.at - b.at).map(Object.freeze));
})();
export const SIEGEBIRD_CUES = CUES;
export function siegebirdCues(prev, next) {
  if (!Number.isFinite(next) || next <= prev) return [];
  return CUES.filter(c => c.at > prev && c.at <= next);
}
