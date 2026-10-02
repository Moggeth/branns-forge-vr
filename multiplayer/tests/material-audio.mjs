// Adapter tests on a mock WebAudio graph that counts live edges. Loads the real WAVs. Run: node test-material-audio.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {createMaterialAudio, materialLayersFor, materialOf, energyOf, energyShape, hash01, MATERIAL_SOUNDS, VOICE_CEILING} from '../client/material-audio.js';

const t0 = performance.now();
const here = dirname(fileURLToPath(import.meta.url));
let edges = 0, constructed = 0;

class Param { constructor(v = 0) { this.value = v; this.events = []; } setTargetAtTime(v, t, c) { this.events.push(['target', v, t, c]); } cancelScheduledValues(t) { this.events.push(['cancel', t]); } }
class Node {
 constructor(ctx) { this.ctx = ctx; this.out = new Set(); constructed++; }
 connect(n) { if (!this.out.has(n)) { this.out.add(n); edges++; } return n; }
 disconnect() { edges -= this.out.size; this.out.clear(); }
}
class Source extends Node {
 constructor(c) { super(c); this.playbackRate = new Param(1); this.started = null; this.stopped = null; }
 start(when = 0, offset = 0) { this.started = {when, offset}; this.ctx.sources.add(this); }
 stop(when) { this.stopped = when ?? this.ctx.currentTime; }
 end() { this.ctx.sources.delete(this); this.onended?.(); }
}
class MockContext {
 constructor() { this.currentTime = 0; this.state = 'running'; this.sampleRate = 48000; this.destination = new Node(this); this.sources = new Set(); this.listener = {}; this.panners = []; this.filters = []; this.gains = []; }
 createGain() { const g = new Node(this); g.gain = new Param(1); this.gains.push(g); return g; }
 createBufferSource() { return new Source(this); }
 createPanner() { const p = new Node(this); p.positionX = new Param(); p.positionY = new Param(); p.positionZ = new Param(); this.panners.push(p); return p; }
 createBiquadFilter() { const f = new Node(this); f.frequency = new Param(350); this.filters.push(f); return f; }
 createBuffer(ch, len, sr) { return {duration: len / sr}; }
 decodeAudioData(bytes) { const v = new DataView(bytes); assert.equal(v.getUint32(24, true), 32000); return Promise.resolve({duration: v.getUint32(40, true) / 2 / 32000}); }
 advance(dt) { this.currentTime += dt; for (const s of [...this.sources]) { const end = s.stopped ?? (s.started.when + s.buffer.duration / s.playbackRate.value); if (this.currentTime >= end) s.end(); } }
}
const fetchImpl = async url => { const f = join(here, '../public/assets/material-audio', url.split('/').pop()); const b = readFileSync(f); return {ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)}; };
async function kit(opts = {}) { const context = new MockContext(); const k = createMaterialAudio({context, fetchImpl, ...opts}); const base = edges; const r = await k.load(); return {context, k, base, r}; }
let n = 0; const test = async (name, fn) => { await fn(); n++; };

// --- pure mapping on the real event shapes from reference/combat.js and game.js
await test('mapping', () => {
 const ev = (o) => ({position: [1, 1, 1], ...o});
 assert.deepEqual(materialLayersFor(ev({kind: 'hit', material: 'bone', energy: 1, normal: [0, 1, 0]})).map(l => l.sound), ['bone_crack']);
 assert.equal(materialLayersFor(ev({kind: 'headshot', material: 'bone'}))[0].gain, 1.15);
 assert.deepEqual(materialLayersFor(ev({kind: 'hit', material: 'stone', energy: 1})).map(l => l.sound), ['pick_stone']);   // pick/axe on golem
 assert.deepEqual(materialLayersFor(ev({kind: 'hit', material: 'stone', energy: 1.8})).map(l => l.sound), ['stone_fracture']); // hammer on golem
 assert.deepEqual(materialLayersFor(ev({kind: 'armor_break', id: 'e1'})).map(l => l.sound), ['stone_fracture']);
 assert.deepEqual(materialLayersFor(ev({kind: 'stone_hit', id: 'ore3'})).map(l => l.sound), ['pick_stone']);
 assert.deepEqual(materialLayersFor(ev({kind: 'ore_break'})).map(l => l.sound), ['ore_break']);
 assert.deepEqual(materialLayersFor(ev({kind: 'hammer_slam'})).map(l => l.sound), ['stone_fracture']);
 assert.deepEqual(materialLayersFor(ev({kind: 'hit', id: 'shrine'})).map(l => l.sound), ['metal_ricochet']);     // game.js inference
 assert.deepEqual(materialLayersFor(ev({kind: 'embed', impact: true, material: 'stone'})).map(l => l.sound), ['pick_stone']);
 assert.deepEqual(materialLayersFor(ev({kind: 'embed', impact: false, material: 'bone'})), []);  // enemy embed: hit event already sounds
 for (const k of ['wood_hit', 'tree_fell', 'pickup', 'shoot', 'death', 'detach', 'pick_burst', 'axe_cleave']) assert.deepEqual(materialLayersFor(ev({kind: k})), [], k);
 assert.deepEqual(materialLayersFor(ev({kind: 'hit', material: 'wood'})), []);
 assert.equal(materialOf({kind: 'stone_hit'}), 'stone');
 assert.equal(energyOf({energy: 9}), 2); assert.equal(energyOf({}), 1); assert.equal(energyOf({energy: NaN}), 1);
 assert.ok(energyShape(1.8).gain > energyShape(1).gain && energyShape(1.8).rate < energyShape(1).rate && energyShape(.2).gain >= .45);
 const h = Array.from({length: 3000}, (_, i) => hash01(`hit|e${i}|torso|${i}`)); assert.ok(h.every(x => x >= 0 && x < 1));
 assert.ok(Math.abs(h.reduce((a, b) => a + b) / h.length - .5) < .03);
});

await test('loads all real WAVs through the shared context', async () => {
 const {r, k} = await kit(); assert.deepEqual(r, {loaded: 13, total: 13}); assert.equal(k.stats().buffers, 13); k.dispose();
});

await test('deterministic variant/pitch/gain per event', async () => {
 const pick = async () => { const {k, context} = await kit(); const v = k.play({kind: 'hit', material: 'bone', id: 'e7', part: 'head', position: [2, 1, 0], energy: 1}, {position: [0, 1.6, 0]}, 410)[0];
  const out = {rate: v.source.playbackRate.value, gain: v.gain.gain.value, dur: v.source.buffer.duration}; k.dispose(); return out; };
 assert.deepEqual(await pick(), await pick());
});

await test('energy scales gain and lowers pitch; real normal offsets and occludes', async () => {
 const {k, context, base} = await kit();
 const L = {position: [0, 1.6, 3]};
 const soft = k.play({kind: 'stone_hit', id: 'oreA', position: [0, 0, 0], energy: .4, normal: [0, 0, 1]}, L, 1)[0];
 context.advance(.1);
 const hard = k.play({kind: 'stone_hit', id: 'oreA', position: [0, 0, 0], energy: 1.4, normal: [0, 0, 1]}, L, 1)[0];
 // same seed (same tick/id/position) -> same variant & jitter, so the ratio is the energy shaping alone
 assert.ok(Math.abs(hard.gain.gain.value / soft.gain.gain.value - energyShape(1.4).gain / energyShape(.4).gain) < 1e-9);
 assert.ok(hard.source.playbackRate.value < soft.source.playbackRate.value);
 assert.ok(Math.abs(hard.panner.positionZ.value - .04) < 1e-9, 'emits just outside the struck face');
 assert.equal(hard.filter, null);
 context.advance(.1);
 const behind = k.play({kind: 'stone_hit', id: 'oreB', position: [0, 0, 0], normal: [0, 0, -1]}, L, 2)[0];
 assert.ok(behind.filter && behind.filter.frequency.value <= 1800 && k.stats().occluded === 1);
 context.advance(2); assert.equal(k.stats().voices, 0); assert.equal(edges, base);
 k.dispose();
});

await test('far hits culled with no nodes; mid-distance air absorption', async () => {
 const {k, context} = await kit();
 const before = constructed;
 assert.deepEqual(k.play({kind: 'hit', material: 'bone', id: 'x', position: [40, 0, 0]}, {position: [0, 0, 0]}), []);
 assert.equal(constructed, before); assert.equal(k.stats().culled, 1);
 const far = k.play({kind: 'hammer_slam', id: 'p', position: [50, 0, 0]}, {position: [0, 0, 0]})[0]; // fracture reaches 60 m
 assert.ok(far.filter.frequency.value < 4000 && far.filter.frequency.value >= 2400);
 k.dispose();
});

await test('cooldowns: duplicate packets and same-sound flams', async () => {
 const {k, context} = await kit();
 const e = {kind: 'hit', material: 'bone', id: 'e1', part: 'torso', position: [1, 1, 1]};
 assert.equal(k.play(e, null, 1).length, 1);
 assert.equal(k.play(e, null, 1).length, 0, 'duplicate packet');
 assert.equal(k.play({...e, id: 'e2'}, null, 1).length, 0, 'global 15 ms bone spacing');
 context.advance(.02); assert.equal(k.play({...e, id: 'e2'}, null, 1).length, 1);
 assert.equal(k.play(e, null, 1).length, 0, 'e1 still inside 45 ms');
 context.advance(.03); assert.equal(k.play(e, null, 1).length, 1);
 assert.equal(k.play({kind: 'ore_break', id: 'o1', position: [0, 0, 0]}).length, 1);
 assert.equal(k.play({kind: 'ore_break', id: 'o2', position: [0, 0, 0]}).length, 1, 'rewards are never globally throttled');
 assert.equal(k.stats().cooldown, 3);
 k.dispose();
});

await test('burst: never more than 12 connected voices, priority survives, no edge leak', async () => {
 const {k, context, base} = await kit();
 let peakEdges = 0, maxVoices = 0;
 const kinds = [{kind: 'hit', material: 'bone'}, {kind: 'stone_hit'}, {kind: 'hit', material: 'metal'}, {kind: 'embed', impact: true, material: 'stone'}];
 let ore = null;
 for (let i = 0; i < 300; i++) {
  context.advance(.004);
  if (i === 150) ore = k.play({kind: 'ore_break', id: 'gem', position: [0, 0, 1]}, null, i)[0];
  k.play({...kinds[i % 4], id: `e${i % 9}`, position: [i % 7, 1, 2], energy: .2 + (i % 10) / 5}, null, i);
  maxVoices = Math.max(maxVoices, k.stats().voices); peakEdges = Math.max(peakEdges, edges - base);
 }
 assert.ok(maxVoices <= VOICE_CEILING, `voices ${maxVoices}`);
 assert.ok(peakEdges <= VOICE_CEILING * 4, `edges ${peakEdges}`);    // source->gain->filter->panner->master
 assert.ok(ore && !ore.dead && !ore.releasing, 'ore reward was not stolen by low-priority chatter');
 assert.ok(k.stats().stolen > 0);
 context.advance(3); assert.equal(k.stats().voices, 0); assert.equal(edges, base);
 for (const [s, d] of Object.entries(MATERIAL_SOUNDS)) assert.ok(d.cap <= VOICE_CEILING, s);
 k.dispose();
});

await test('maxVoices cannot exceed the 12 ceiling', async () => { const {k} = await kit({maxVoices: 40}); assert.equal(k.stats().maxVoices, 12); k.dispose(); });

await test('per-sound cap', async () => {
 const {k, context} = await kit();
 for (let i = 0; i < 6; i++) { context.advance(.06); k.play({kind: 'hit', material: 'metal', id: `m${i}`, position: [0, 0, 0]}, null, i); }
 assert.ok(k.stats().voices - k.stats().releasing <= MATERIAL_SOUNDS.metal_ricochet.cap);
 k.dispose();
});

await test('tick reaps voices whose onended was lost', async () => {
 const {k, context, base} = await kit();
 k.play({kind: 'hammer_slam', id: 'p', position: [0, 0, 0]}); context.sources.clear(); // onended will never fire
 context.currentTime += 3; k.tick({position: [0, 0, 0]}); assert.equal(k.stats().voices, 0); assert.equal(edges, base);
 k.dispose();
});

await test('dispose leaves nothing; later calls are no-ops', async () => {
 const context = new MockContext(); const base = edges; const k = createMaterialAudio({context, fetchImpl}); await k.load(); k.unlock();
 k.play({kind: 'ore_break', id: 'o', position: [0, 0, 0]}); k.play({kind: 'hit', material: 'bone', id: 'b', position: [0, 0, 0]});
 k.dispose(); const s = k.stats();
 assert.equal(s.voices, 0); assert.equal(s.buffers, 0); assert.equal(s.disposed, true);
 context.advance(1); assert.equal(edges, base);
 assert.deepEqual(k.play({kind: 'ore_break', id: 'o', position: [0, 0, 0]}), []); k.tick(); k.unlock(); k.dispose();
});

await test('does not construct an AudioContext and never touches haptics/camera', () => {
 const src = readFileSync(join(here, '../client/material-audio.js'), 'utf8');
 assert.ok(!/new\s+\(?\s*(window\.)?(AudioContext|webkitAudioContext)/.test(src));
 assert.ok(!/haptic|vibrate|shake|camera/i.test(src.replace(/\/\/.*$/gm, '')));
 assert.throws(() => createMaterialAudio({}));
});

console.log(`ok ${n} adapter tests, ${(performance.now() - t0).toFixed(1)} ms`);
