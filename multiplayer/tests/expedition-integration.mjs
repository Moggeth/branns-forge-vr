// Forge Expedition wired inside the authoritative simulation: command route, cast gate, stepping, atomic saves.
import assert from 'node:assert/strict';
import {createSimulation, loadSimulation} from '../shared/simulation.js';
import {adventureView} from '../shared/adventure.js';
const started = performance.now();
// All commands share one sequence: an old expedition packet cannot run after newer movement.
const ordered = createSimulation({legacyBattle:true,legacyBattle:true}); ordered.addPlayer({id:'order'});
assert.equal(ordered.command('order',{type:'input',seq:10,move:{x:0,z:0},yaw:0}).ok,true);
assert.equal(ordered.command('order',{type:'adventure',seq:9,action:'start'}).code,'duplicate_sequence');
assert.equal(ordered.snapshot().adventure.stage,'idle');
assert.equal(ordered.command('order',{type:'adventure',seq:11,action:'start'}).ok,true);
assert.equal(ordered.command('order',{type:'input',seq:11,move:{x:0,z:0},yaw:0}).code,'duplicate_sequence');
let sim = createSimulation({legacyBattle:true,seed: 41}); sim.addPlayer({id: 'h'}); sim.addPlayer({id: 'g', role: 'god'});
let seq = {h: 0, g: 0}; const send = (id, body) => sim.command(id, {seq: ++seq[id], ...body});
const steps = n => { const out = []; for (let i = 0; i < n; i++) out.push(...sim.step()); return out; };
// Sandbox is untouched until someone starts: hostile casts are not gated.
assert.equal(sim.snapshot().adventure.stage, 'idle');
assert.equal(send('g', {type: 'cast', spell: 'skeleton', point: [3, 0, 3]}).ok, true, 'sandbox summon near forge allowed');
steps(50);
const start = send('h', {type: 'adventure', action: 'start'}); assert.equal(start.ok, true);
assert.ok(start.events.some(e => e.kind === 'adventure_stage' && e.stage === 'camp'));
assert.equal(sim.checkpoint().players.find(p => p.id === 'h').seq >= seq.h, true, 'expedition seq advances the shared sequence');
// During a run a summon aimed at the forge emerges at the keep-out edge instead of being refused.
const kept = send('g', {type: 'cast', spell: 'skeleton', point: [2, 0, 2]}); assert.equal(kept.ok, true, kept.code);
const raised = sim.snapshot().enemies.at(-1); assert.ok(Math.abs(Math.hypot(raised.position[0], raised.position[2]) - 12) < 1e-9, 'summon lands at the keep-out edge');
assert.equal(send('g', {type: 'cast', spell: 'raise', point: [0, 0, 20]}).ok, true, 'terrain shaping never gated');
// Deposit real carried resources once; surplus is never taken.
let cp = sim.checkpoint(); cp.players.find(p => p.id === 'h').resources = {wood: 40, stone: 3, gems: 0}; sim = loadSimulation(cp);
const need = sim.snapshot().adventure.need.wood;
assert.equal(send('h', {type: 'adventure', action: 'deposit', kind: 'wood', amount: 40}).ok, true);
assert.equal(sim.snapshot().players.find(p => p.id === 'h').resources.wood, 40 - need);
assert.equal(sim.snapshot().adventure.stock.wood, need);
assert.equal(send('h', {type: 'adventure', action: 'deposit', kind: 'wood', amount: 1}).code, 'not_needed');
assert.equal(send('h', {type: 'adventure', action: 'deposit', kind: 'stone', amount: 3}).ok, true);
// Duplicate expedition sequence rejected.
assert.equal(sim.command('h', {type: 'adventure', seq: seq.h, action: 'deposit', kind: 'stone', amount: 1}).ok, false);
// The clock advances with sim ticks and survives an exact JSON save/restore.
steps(600);
const saved = JSON.parse(JSON.stringify(sim.checkpoint())), resumed = loadSimulation(saved);
for (let i = 0; i < 300; i++) { sim.step(); resumed.step(); }
assert.deepEqual(resumed.checkpoint(), sim.checkpoint(), 'mid-run save resumes byte-identically');
assert.ok(sim.snapshot().adventure.elapsed >= 900);
// Strict restore; legacy saves load idle.
for (const corrupt of [s => s.adventure.stage = 'boss', s => s.adventure.stock.wood = 1e6, s => s.adventure.extra = 1, s => s.adventure.foes = Array(40).fill(s.adventure.foes[0] || {})])
  { const bad = structuredClone(saved); corrupt(bad); assert.throws(() => loadSimulation(bad)); }
const legacy = structuredClone(saved); delete legacy.adventure; assert.equal(loadSimulation(legacy).snapshot().adventure.stage, 'idle');
// The client view model works from the replicated snapshot alone.
const view = adventureView(sim.snapshot().adventure, sim.snapshot(), 'h');
assert.equal(view.stage, 'camp'); assert.ok(view.objectives.length >= 2); assert.ok(view.objectives.find(o => o.id === 'wood' || /timber/i.test(o.label))?.done);
// Leave vote returns the room to free sandbox.
assert.equal(send('h', {type: 'adventure', action: 'leave'}).ok, true); assert.equal(send('g', {type: 'adventure', action: 'leave'}).ok, true);
assert.equal(sim.snapshot().adventure.stage, 'idle');
console.log(`expedition-integration: sandbox ungated, start, keep-out gate, deposit once, seq, exact resume, strict/legacy restore, view, leave pass (${((performance.now() - started) / 1000).toFixed(3)} s)`);
