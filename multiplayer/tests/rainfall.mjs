// God's Rainfall (shared/weather-spell.js): world-wide rain the whole room sees, feeding groves and mending Heroes.
// Run: node tests/rainfall.mjs
import assert from 'node:assert/strict';
import {createSimulation, loadSimulation} from '../shared/simulation.js';
import {RAINFALL, raining} from '../shared/weather-spell.js';
import {weatherAt} from '../shared/world-clock.js';
import {BLOOM} from '../shared/bloom.js';

const world = () => { const s = createSimulation({legacyBattle:true,seed: 9}); s.addPlayer({id: 'g', role: 'god'}); s.addPlayer({id: 'h', role: 'hero'}); return s; };
const step = (s, n) => { const events = []; for (let i = 0; i < n; i++) events.push(...s.step()); return events; };
let seq = 0;
const cast = (s, spell, point = [10, 0, 10]) => { s.adventureWorld().players.find(p => p.id === 'g').mana = 100; return s.command('g', {type: 'cast', seq: ++seq, spell, point}); };

{
  const s = world(), w = s.adventureWorld();
  step(s, 10);
  assert.ok(!raining(w), 'first front is clear');
  assert.equal(s.snapshot().weather, undefined, 'no weather record until cast');
  const r = cast(s, 'rainfall');
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.events.some(e => e.kind === 'weather' && e.weather === 'rain' && e.by === 'g'));
  assert.equal(w.players.find(p => p.id === 'g').mana, 70, 'costs 30 mana');
  const snap = s.snapshot();
  assert.equal(snap.weather.kind, 'rain'); assert.equal(snap.weather.untilTick - snap.tick, RAINFALL.ticks);
  // Clients see the same weights from the snapshot alone.
  step(s, 30 * 60);
  assert.ok(weatherAt(s.snapshot().tick, s.snapshot().seed, s.snapshot().weather).weights.rain > .99 && raining(w));
  // Recasting stacks but never past the cap.
  cast(s, 'rainfall'); cast(s, 'rainfall');
  assert.equal(w.weather.untilTick - w.tick, RAINFALL.maxTicks);
  // Heroes mend in the rain.
  const hero = w.players.find(p => p.id === 'h'); hero.hp = 50; step(s, 600);
  assert.ok(hero.hp > 59 && hero.hp < 61, `hero hp ${hero.hp}`);
  // Groves breathe Bloom twice as often while it rains.
  assert.ok(cast(s, 'grove', [20, 0, 20]).ok);
  const before = w.bloom; step(s, BLOOM.passiveTicks);
  assert.equal(w.bloom - before, 2, 'two breaths per passive period in rain');
  // Saves keep the rain; old saves without weather still load; bad records are refused.
  const saved = s.checkpoint(), loaded = loadSimulation(saved);
  assert.deepEqual(loaded.snapshot().weather, s.snapshot().weather);
  const old = s.checkpoint(); delete old.weather; assert.equal(loadSimulation(old).snapshot().weather, undefined);
  const bad = s.checkpoint(); bad.weather.untilTick = bad.tick + RAINFALL.maxTicks + 1; assert.throws(() => loadSimulation(bad), /weather/);
  const lava = s.checkpoint(); lava.weather.kind = 'lava'; assert.throws(() => loadSimulation(lava), /weather/);
  // The record clears itself a minute after the rain ends.
  step(s, RAINFALL.maxTicks + 61 * 60);
  assert.equal(s.snapshot().weather, undefined);
}
console.log('rainfall: ok');
