// Shared world clock: time of day and weather derived purely from the authoritative tick and room seed.
// Every client reads the same snapshot.tick, so the whole room sees the same sky with no extra network state.
// Saves keep their tick, so a reloaded world resumes at the same hour.
export const CLOCK_HZ = 60;
export const DAY_SECONDS = 20 * 60;              // one full cycle
export const DAY_TICKS = DAY_SECONDS * CLOCK_HZ;
export const DAYLIGHT_SHARE = 0.65;              // ~13 min of sun, ~7 min of dusk and night
export const START_PHASE = 0.06;                 // a fresh room opens on a soft morning, not at sunrise
export const WEATHER_SECONDS = 4 * 60;           // one weather front
export const WEATHER_TICKS = WEATHER_SECONDS * CLOCK_HZ;
export const WEATHER_BLEND_TICKS = 40 * CLOCK_HZ; // fronts roll in over 40 s
export const WEATHER_KINDS = Object.freeze(['clear', 'fog', 'rain', 'storm', 'snow']);

const clamp01 = x => Math.min(1, Math.max(0, x));
const smooth = x => { x = clamp01(x); return x * x * (3 - 2 * x); };

function hash(seed, n) {
  let h = (Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(n | 0, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0; h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// phase: 0 = sunrise, DAYLIGHT_SHARE = sunset, 1 = next sunrise. solar: 0..PI while the sun is up, PI..2PI at night.
export function dayPhase(tick = 0) {
  return ((Math.max(0, tick) / DAY_TICKS) + START_PHASE) % 1;
}
export function solarAngle(phase) {
  return phase < DAYLIGHT_SHARE ? Math.PI * phase / DAYLIGHT_SHARE : Math.PI + Math.PI * (phase - DAYLIGHT_SHARE) / (1 - DAYLIGHT_SHARE);
}
// 0 full day .. 1 deep night, with soft twilight either side of the horizon.
export function nightAmount(phase) {
  const s = Math.sin(solarAngle(phase));
  return smooth((0.1 - s) / 0.32);
}

// Weather picked per front from the seed. The first front of every room is clear; snow leans toward night fronts.
function frontWeather(seed, index) {
  if (index <= 0) return {kind: 'clear', strength: 0};
  const r = hash(seed, index * 7 + 1), s = 0.55 + 0.45 * hash(seed, index * 7 + 2);
  const night = nightAmount(dayPhase(index * WEATHER_TICKS + WEATHER_TICKS / 2)) > 0.5;
  const table = night ? [['clear', .42], ['fog', .2], ['rain', .14], ['storm', .06], ['snow', .18]] : [['clear', .52], ['fog', .14], ['rain', .18], ['storm', .07], ['snow', .09]];
  let acc = 0;
  for (const [kind, w] of table) { acc += w; if (r < acc) return {kind, strength: kind === 'clear' ? 0 : s}; }
  return {kind: 'clear', strength: 0};
}

// Weights per kind (summing to 1) for smooth crossfades: {clear, fog, rain, storm, snow}.
export function weatherAt(tick = 0, seed = 41, override = null) {
  tick = Math.max(0, tick);
  const index = Math.floor(tick / WEATHER_TICKS), into = tick - index * WEATHER_TICKS;
  const w = {clear: 0, fog: 0, rain: 0, storm: 0, snow: 0};
  const t = smooth(into / WEATHER_BLEND_TICKS);
  addFront(w, frontWeather(seed, index - 1), 1 - t); addFront(w, frontWeather(seed, index), t);
  // An authoritative override (e.g. a God-cast rain) takes over while active and fades in and out.
  let overridden = false;
  if (override && Number.isFinite(override.untilTick) && WEATHER_KINDS.includes(override.kind)) {
    const start = Number.isFinite(override.startTick) ? override.startTick : override.untilTick - WEATHER_TICKS;
    const k = Math.min(smooth((tick - start) / (WEATHER_BLEND_TICKS * .5)), 1 - smooth((tick - override.untilTick) / WEATHER_BLEND_TICKS));
    if (k > 0) {
      overridden = true;
      for (const key in w) w[key] *= 1 - k;
      addFront(w, {kind: override.kind, strength: Number.isFinite(override.strength) ? clamp01(override.strength) : 1}, k);
    }
  }
  const kind = Object.keys(w).reduce((m, key) => w[key] > w[m] ? key : m, 'clear');
  return {weights: w, kind, index, override: overridden};
}
function addFront(w, front, k) {
  w[front.kind] += (front.kind === 'clear' ? 1 : front.strength) * k;
  if (front.kind !== 'clear') w.clear += (1 - front.strength) * k;
}

// Storm lightning: deterministic strike ticks so everyone sees the same flash. Returns 0..1 flash brightness.
export function lightningAt(tick, seed, stormWeight) {
  if (stormWeight < 0.3) return 0;
  const slot = Math.floor(tick / 300), into = tick - slot * 300; // a 5 s window may hold one strike
  if (hash(seed, slot * 13 + 5) > 0.35 * stormWeight) return 0;
  const at = Math.floor(hash(seed, slot * 13 + 6) * 240), d = into - at;
  if (d < 0 || d > 24) return 0;
  return d < 4 ? 1 : d < 8 ? 0.25 : d < 11 ? 0.8 : Math.max(0, 1 - (d - 11) / 13) * 0.5;
}

export function worldClock(tick = 0, seed = 41, override = null) {
  const phase = dayPhase(tick), solar = solarAngle(phase);
  const weather = weatherAt(tick, seed, override);
  return {tick, phase, solar, night: nightAmount(phase), weather, lightning: lightningAt(tick, seed, weather.weights.storm),
    hour: phase < DAYLIGHT_SHARE ? 6 + 12 * phase / DAYLIGHT_SHARE : (18 + 12 * (phase - DAYLIGHT_SHARE) / (1 - DAYLIGHT_SHARE)) % 24};
}
