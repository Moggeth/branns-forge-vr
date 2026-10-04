// Earth that animates (Raise Wall, Sunder, sinking segments) is drawn at the presentation clock every frame.
// The partial ground refresh must match a full rebuild exactly, and the terrain must change between ticks.
// Run: node tests/smooth-terrain.mjs
import assert from 'node:assert/strict';
import * as T from 'three';
import {readFileSync} from 'node:fs';
import {groundRect, refreshGround} from '../client/ground-refresh.js';
import {createSimulation} from '../shared/simulation.js';
import {terrainHeight, hasActiveTerrain, TERRAIN_GRID, sunderFront, SUNDER_SETTLE_DISTANCE} from '../shared/terrain.js';
import {createPresentationClock} from '../client/presentation-clock.js';

const started = performance.now();
// ---- Partial refresh == full rebuild, positions and normals ----
{
  const make = () => { const g = new T.PlaneGeometry(120, 120, 160, 160); g.rotateX(-Math.PI / 2); return g; };
  assert.equal(TERRAIN_GRID.step, .75); assert.equal(TERRAIN_GRID.half, 60);
  const bump = t => (x, z) => Math.sin(x * .3) * Math.cos(z * .2) + t * Math.max(0, 3 - Math.hypot(x - 10, z + 7));
  const full = make(), part = make(), pos = full.attributes.position;
  for (const g of [full, part]) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, bump(0)(p.getX(i), p.getZ(i))); g.computeVertexNormals(); }
  // vertex (i,j) sits at x=-60+.75i, z=-60+.75j
  assert.equal(pos.getX(161 * 5 + 7), -60 + 7 * .75); assert.equal(pos.getZ(161 * 5 + 7), -60 + 5 * .75);
  for (let i = 0; i < pos.count; i++) pos.setY(i, bump(1)(pos.getX(i), pos.getZ(i))); full.computeVertexNormals();
  const rect = groundRect(part, [{x: 10, z: -7, radius: 3}], 0); refreshGround(part, rect, bump(1));
  const a = full.attributes, b = part.attributes;
  for (let i = 0; i < a.position.array.length; i++) {
    assert.ok(Math.abs(a.position.array[i] - b.position.array[i]) < 1e-6, `position ${i}`);
    assert.ok(Math.abs(a.normal.array[i] - b.normal.array[i]) < 1e-5, `normal ${i}: ${a.normal.array[i]} vs ${b.normal.array[i]}`);
  }
  assert.ok(b.position.updateRanges.length === 1 && b.position.updateRanges[0].count < b.position.array.length / 4, 'uploads only the touched rows');
}

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
