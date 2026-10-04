// Earth that animates (Raise Wall, Sunder, sinking segments) is drawn at the presentation clock every frame.
// The terrain must change between whole ticks, and the game must draw it at the shown tick.
// Run: node tests/smooth-terrain.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../shared/simulation.js';
import {terrainHeight, hasActiveTerrain, sunderFront, SUNDER_SETTLE_DISTANCE} from '../shared/terrain.js';
import {createPresentationClock} from '../client/presentation-clock.js';

const started = performance.now();
// ---- Terrain differs between whole ticks while a front runs (fractional ticks are honoured) ----
{
  const s = createSimulation({seed: 9}); s.addPlayer({id: 'g', role: 'god'}); let seq = 0;
  for (const [spell, z] of [['wall', -16], ['sunder', 16]]) {
    s.adventureWorld().players[0].mana = 100;
    const r = s.command('g', {type: 'cast', seq: ++seq, spell, point: [24, 0, z], start: [18, 0, z], end: [30, 0, z]}); assert.equal(r.ok, true, r.code);
  }
  for (let i = 0; i < 40; i++) s.step();
  const snap = s.snapshot(), t = snap.tick;
  assert.ok(hasActiveTerrain(snap.edits, t + .5));
  for (const z of [-16, 16]) {
    const r = snap.edits.find(e => Math.abs(e.z - z) < 1).rupture, x = 18 + sunderFront(r, t - 6).distance - SUNDER_SETTLE_DISTANCE / 2; // just behind the front
    const h = k => terrainHeight({...snap, tick: k}, x, z);
    const samples = [0, .25, .5, .75, 1].map(f => h(t - 6 + f));
    assert.ok(new Set(samples.map(v => v.toFixed(6))).size > 2, `${z < 0 ? 'wall' : 'chasm'} moves between ticks ${samples}`);
  }
}

// ---- The presentation clock advances smoothly between 20 Hz snapshots ----
{
  const clock = createPresentationClock(); let ms = 0, tick = 100, last = 0, maxStep = 0, minStep = Infinity;
  clock.observe(tick, ms);
  for (let f = 0; f < 600; f++) { ms += 1000 / 120; if (f % 6 === 5) { tick += 3; clock.observe(tick, ms); } const v = clock.sample(ms); if (f > 30) { maxStep = Math.max(maxStep, v - last); minStep = Math.min(minStep, v - last); } last = v; }
  assert.ok(maxStep < .9 && minStep > .2, `per-frame tick advance ${minStep}..${maxStep} at 120 fps`);
}

// ---- Wiring: the ground, the earth-line fx and the local Hero follow the shown tick, not the snapshot tick ----
{
  const game = readFileSync(new URL('../client/game.js', import.meta.url), 'utf8');
  assert.match(game, /renderTick=presentationClock\.sample\(now\);liveTerrain\(\);/);
  assert.match(game, /getTerrainTick:\(\)=>\{const t=terrainShownTick\(\)/);
  assert.match(game, /simulationHeight\(terrainLive\?\{\.\.\.snapshot,tick:terrainShownTick\(\)\}:snapshot/);
  assert.match(game, /terrainSampler\.setState\(\{\.\.\.snapshot,tick:terrainShownTick\(\)\}\)/);
}
console.log(JSON.stringify({suite: 'smooth-terrain', pass: true, elapsedSeconds: (performance.now() - started) / 1000}));
