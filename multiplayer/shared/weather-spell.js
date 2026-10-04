// Rainfall: the God calls rain over the whole world. Authority state is one small record (state.weather) that every
// client reads through shared/world-clock.js, so the sky, sound and gameplay agree for the whole room.
// Any rain, called or natural, feeds life: groves breathe Bloom twice as often and Heroes slowly mend.
import {weatherAt, CLOCK_HZ} from './world-clock.js';
import {BLOOM, addBloom} from './bloom.js';

export const RAINFALL = Object.freeze({
  ticks: 3 * 60 * CLOCK_HZ,       // one cast: three minutes of rain
  maxTicks: 6 * 60 * CLOCK_HZ,    // recasting stacks up to six minutes ahead
  heroHpPerSecond: 1,             // boon: Heroes caught in the rain mend
  quenchRadius: 14,               // the first downpour douses fire around the cast point
  wet: .5,                        // rain weight above which the world counts as raining
});

export function castRainfall(state, at, by) {
  const live = state.weather && state.weather.untilTick > state.tick;
  const startTick = live ? state.weather.startTick : state.tick;
  const untilTick = Math.min(state.tick + RAINFALL.maxTicks, (live ? state.weather.untilTick : state.tick) + RAINFALL.ticks);
  state.weather = {kind: 'rain', startTick, untilTick, strength: 1, by};
  return {kind: 'weather', weather: 'rain', by, untilTick, position: [...at], tick: state.tick};
}

export function raining(state) {
  const w = weatherAt(state.tick, state.seed, state.weather).weights;
  return w.rain + w.storm >= RAINFALL.wet;
}

// Per tick, after stepBloom: an extra grove breath halfway between the normal ones, and slow healing for Heroes.
export function stepRain(state, events) {
  if (state.weather && state.weather.untilTick + 60 * CLOCK_HZ < state.tick) delete state.weather;
  if (!raining(state)) return;
  if (state.tick % BLOOM.passiveTicks === BLOOM.passiveTicks / 2 && state.groves.length) addBloom(state, Math.min(BLOOM.passiveCap, state.groves.length), events);
  for (const hero of state.players) if (hero.role === 'hero' && hero.hp > 0 && hero.hp < 100) hero.hp = Math.min(100, hero.hp + RAINFALL.heroHpPerSecond / CLOCK_HZ);
}

/** Save and snapshot restore. Older saves have no weather record. */
export function restoreWeather(saved) {
  const w = saved.weather;
  if (w === undefined || w === null) return {};
  if (typeof w !== 'object' || w.kind !== 'rain' || ![w.startTick, w.untilTick].every(Number.isSafeInteger) || w.startTick > w.untilTick ||
      w.untilTick > saved.tick + RAINFALL.maxTicks || w.strength !== 1 || (w.by !== undefined && (typeof w.by !== 'string' || w.by.length > 64))) throw Error('Invalid weather');
  return {weather: {kind: 'rain', startTick: w.startTick, untilTick: w.untilTick, strength: 1, ...(w.by !== undefined ? {by: w.by} : {})}};
}
