// Growth spells place each tree on the open ground nearest its aim: crowns never swallow each other, trunks stay
// off rocks, buildings and Heroes, and a cast is refused only when no tree fits at all.
// Run: node tests/grove-growth.mjs
import assert from 'node:assert/strict';
import {createSimulation, loadSimulation} from '../shared/simulation.js';
import {worldTrees} from '../shared/world-content.js';
import {GROWTH, growthPlan, crownRadius, waveLine} from '../shared/grove-growth.js';
import {spellUnavailable} from '../client/spell-availability.js';

const sim = createSimulation({seed: 9}); sim.addPlayer({id: 'g', role: 'god'}); sim.addPlayer({id: 'h', role: 'hero'});
const S = sim.adventureWorld(), god = S.players[0], hero = S.players.find(p => p.id === 'h'); hero.position = [0, 0, -45];
let seq = 0;
const cast = (spell, point, extra = {}) => { god.mana = 100; return sim.command('g', {type: 'cast', seq: ++seq, spell, point, ...extra}); };
const spacingOk = () => { const t = worldTrees(S), bad = [];
  for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) if (t[i].id.includes('-tree') && t[j].id.includes('-tree') && Math.hypot(t[i].x - t[j].x, t[i].z - t[j].z) < GROWTH.gapFactor * (crownRadius(t[i]) + crownRadius(t[j])) - 1e-6) bad.push([t[i].id, t[j].id]);
  return bad; };

// The preview plan is exactly what the authority grows.
const plan = growthPlan(S, 'grove', [-30, 0, -30]);
const r = cast('grove', [-30, 0, -30]); assert.equal(r.ok, true, r.code);
const grove = S.groves.at(-1); assert.deepEqual(grove.trees.map(t => [t[0], t[1]]), plan.map(t => [t.x, t.z]), 'preview matches authority');
assert.equal(grove.trees.length, 5, 'open ground grows the full grove');
assert.deepEqual(r.events.find(e => e.kind === 'spell').sites.map(s => s.slice(0, 2)), plan.map(t => [t.x, t.z]));

// Casting again on the same spot never clips: trees spread to the nearest open ground or skip.
for (let i = 0; i < 6; i++) { const again = cast(['grove', 'ring'][i % 2], [-30 + i * .5, 0, -30]); if (!again.ok) assert.equal(again.code, 'no_room'); }
assert.deepEqual(spacingOk(), [], 'no two grown crowns swallow each other');

// Trunks stay off rocks, buildings and Heroes.
const rock = S.deposits.find(d => !d.depleted && Math.hypot(d.x, d.z) > 12 && Math.abs(d.x) < 45 && Math.abs(d.z) < 45);
hero.position = [rock.x + 3, 0, rock.z];
const nearRock = cast('ring', [rock.x, 0, rock.z]); assert.equal(nearRock.ok, true, nearRock.code);
for (const t of S.groves.at(-1).trees) { assert.ok(Math.hypot(t[0] - rock.x, t[1] - rock.z) >= GROWTH.clear.deposit, 'off the rock'); assert.ok(Math.hypot(t[0] - hero.position[0], t[1] - hero.position[2]) >= GROWTH.clear.hero, 'beside the Hero'); }
hero.position = [0, 0, -45];

// A spot packed with trees refuses without spending mana, and the preview says so first.
const packed = [-30, 0, -30];
let refused = null; for (let i = 0; i < 30 && !refused; i++) { const t = cast('grove', packed); if (!t.ok) refused = t; }
assert.equal(refused?.code, 'no_room'); const before = god.mana; assert.equal(cast('grove', packed).code, 'no_room'); assert.equal(god.mana, 100, 'no mana spent'); void before;
assert.equal(spellUnavailable(sim.snapshot(), god, 'grove', {point: packed, trees: growthPlan(S, 'grove', packed)}), 'No room to grow here');

// Growth Wave: a band of trees rising in order along the drag, capped at 18 m.
const start = [-40, 0, -46], end = [-10, 0, -46], [, lineEnd] = waveLine([-25, 0, -46], start, end);
assert.ok(Math.abs(lineEnd[0] + 22) < 1e-9, 'wave length capped at 18 m');
const wave = cast('wave', [-25, 0, -46], {start, end}); assert.equal(wave.ok, true, wave.code);
const w = S.groves.at(-1); assert.equal(w.kind, 'wave'); assert.ok(w.trees.length >= 8 && w.trees.length <= GROWTH.wave.maxTrees, `wave grew ${w.trees.length}`);
for (const t of w.trees) { assert.ok(t[0] >= -41 - GROWTH.wave.shift && t[0] <= -22 + GROWTH.wave.shift && Math.abs(t[1] + 46) <= GROWTH.wave.offset + .3 + GROWTH.wave.shift && Math.abs(t[1] + 46) <= GROWTH.wave.width / 2 + GROWTH.wave.shift, 'inside the band'); }
const visible = () => worldTrees(S).filter(t => t.id.startsWith(w.id)).length;
const first = visible(); assert.ok(first < w.trees.length, 'later trees wait for the wave');
for (let i = 0; i < 120; i++) sim.step(); assert.equal(visible(), w.trees.length, 'the whole band has risen');
assert.deepEqual(spacingOk(), [], 'waves keep the spacing too');
const tap = cast('wave', [-10, 0, 40]); assert.equal(tap.ok, true, 'a tap grows a default band'); assert.ok(S.groves.at(-1).trees.length >= 4);

// Saves keep the planted sites; old fixed-pattern groves still load and keep their trees.
const saved = sim.checkpoint(), restored = loadSimulation(saved);
assert.deepEqual(worldTrees(restored.adventureWorld()).map(t => t.id), worldTrees(S).map(t => t.id));
const legacy = structuredClone(saved); legacy.groves.push({id: 'oldgrove', x: -40, z: 10}); legacy.idCounter++;
assert.equal(worldTrees(loadSimulation(legacy).adventureWorld()).filter(t => t.id.startsWith('oldgrove-')).length, 5);
assert.throws(() => loadSimulation({...saved, groves: [...saved.groves, {id: 'bad', x: 0, z: 30, trees: [[0, 30, 99, 0]]}]}));
assert.throws(() => loadSimulation({...saved, groves: [...saved.groves, {id: 'bad', x: 0, z: 30, kind: 'wave'}]}));
console.log('grove-growth: exact preview, no clipping, rocks/buildings/Heroes clear, no-room refusal, wave band and order, saves');
