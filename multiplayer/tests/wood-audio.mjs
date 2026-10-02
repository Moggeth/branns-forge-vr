// node test-wood-audio.mjs — adapter pool/lifetime/mapping against a mock WebAudio graph that counts live
// connections, plus a load pass that decodes the real WAV headers shipped in assets/.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {createWoodAudio, woodLayersFor, hash01, WOOD_SOUNDS} from '../client/wood-audio.js';

const t0 = performance.now();
class Param { constructor(v = 0) { this.value = v; this.events = []; } setTargetAtTime(v, t, c) { this.events.push(['target', v, t, c]); } cancelScheduledValues() {} setValueAtTime(v) { this.value = v; } }
function mockContext() {
 const ctx = {currentTime: 0, state: 'suspended', sampleRate: 48000, edges: 0, created: 0, sources: new Set(), resumed: 0, contexts: 1};
 const node = extra => { ctx.created++; const n = {out: new Set(), connect(d) { if (!n.out.has(d)) { n.out.add(d); ctx.edges++; } return d; }, disconnect() { ctx.edges -= n.out.size; n.out.clear(); }, ...extra}; return n; };
 ctx.destination = node({});
 ctx.listener = {positionX: new Param(), positionY: new Param(), positionZ: new Param(), forwardX: new Param(), forwardY: new Param(), forwardZ: new Param(-1), upX: new Param(), upY: new Param(1), upZ: new Param()};
 ctx.resume = () => { ctx.resumed++; ctx.state = 'running'; return Promise.resolve(); };
 ctx.createGain = () => node({gain: new Param(1)});
 ctx.createBiquadFilter = () => node({frequency: new Param(350), type: 'lowpass'});
 ctx.createPanner = () => node({positionX: new Param(), positionY: new Param(), positionZ: new Param()});
 ctx.createBuffer = (c, len, sr) => ({duration: len / sr});
 ctx.createBufferSource = () => { const s = node({playbackRate: new Param(1), buffer: null, onended: null, startAt: null, stopAt: Infinity,
  start(when = 0, offset = 0) { assert.equal(s.startAt, null, 'source started twice'); s.startAt = Math.max(when, ctx.currentTime); s.offset = offset; ctx.sources.add(s); },
  stop(when) { s.stopAt = Math.min(s.stopAt, when ?? ctx.currentTime); }}); return s; };
 ctx.decodeAudioData = bytes => { const b = Buffer.from(bytes), sr = b.readUInt32LE(24), dataLen = b.readUInt32LE(40); return Promise.resolve({duration: dataLen / 2 / sr, sampleRate: sr}); };
 ctx.advance = dt => { ctx.currentTime += dt; for (const s of [...ctx.sources]) { const natural = s.startAt + ((s.buffer?.duration ?? 0) - s.offset) / s.playbackRate.value;
  if (ctx.currentTime >= Math.min(natural, s.stopAt)) { ctx.sources.delete(s); s.onended?.(); } } };
 return ctx;
}
const fetchImpl = async url => { const bytes = await readFile(new URL(`../public/assets/wood-audio/${url.split('/').pop()}`, import.meta.url)); return {ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)}; };
const results = [];
async function test(name, fn) { const s = performance.now(); await fn(); results.push([name, +(performance.now() - s).toFixed(2)]); }

await test('mapping uses the real trees.js event shapes', () => {
 assert.deepEqual(woodLayersFor({kind: 'wood_hit', glance: true}).map(l => l.sound), ['bark_glance']);
 assert.deepEqual(woodLayersFor({kind: 'wood_hit', cuts: 1}).map(l => l.sound), ['axe_bite']);
 assert.deepEqual(woodLayersFor({kind: 'wood_hit', cuts: 2}).map(l => l.sound), ['axe_bite_deep']);
 assert.equal(woodLayersFor({kind: 'wood_hit', cuts: 3})[0].rateBase, .9);
 const m = new Map();
 assert.deepEqual(woodLayersFor({kind: 'tree_fell', id: 't1'}, m).map(l => l.sound), ['trunk_fracture', 'foliage_rustle']);
 assert.deepEqual(woodLayersFor({kind: 'tree_land', id: 't1'}, m).map(l => l.sound), ['log_land_heavy'], 'no landDelay -> tree_land owns the thud');
 assert.deepEqual(woodLayersFor({kind: 'tree_fell', id: 't2', landDelay: 2.2}, m).map(l => l.sound), ['trunk_fracture', 'foliage_rustle', 'log_land_heavy']);
 assert.deepEqual(woodLayersFor({kind: 'tree_land', id: 't2'}, m).map(l => l.sound), ['log_settle'], 'pre-scheduled thud is not doubled');
 assert.equal(m.size, 0);
 assert.equal(woodLayersFor({kind: 'tree_fell', id: 't3', landTicks: 150}, m)[2].delay, 2.5, 'authoritative landTicks hook');
 assert.deepEqual(woodLayersFor({kind: 'grab', id: 'part_3'}), [], 'non-log grabs stay with the game');
 assert.deepEqual(woodLayersFor({kind: 'grab', id: 'log_4'}).map(l => l.sound), ['log_grab']);
 assert.deepEqual(woodLayersFor({kind: 'pickup', id: 'log_4', material: 'wood'}).map(l => l.sound), ['log_stow']);
 assert.deepEqual(woodLayersFor({kind: 'pickup', id: 'gem', material: 'stone'}), []);
 assert.deepEqual(woodLayersFor({kind: 'log_throw'}).map(l => l.sound), ['log_toss']);
 assert.deepEqual(woodLayersFor({kind: 'stone_hit'}), []);
});

await test('deterministic variation', () => {
 assert.equal(hash01('wood_hit|tree_7|1'), hash01('wood_hit|tree_7|1'));
 const vals = Array.from({length: 200}, (_, i) => hash01(`wood_hit|tree_${i}|1|r`));
 assert.ok(Math.min(...vals) >= 0 && Math.max(...vals) < 1 && new Set(vals).size === 200);
 const mean = vals.reduce((a, b) => a + b) / vals.length; assert.ok(mean > .4 && mean < .6, `hash mean ${mean}`);
});

const ctx = mockContext();
const wood = createWoodAudio({context: ctx, fetchImpl});
const baseEdges = ctx.edges;
await test('loads every real asset via one shared context', async () => {
 assert.deepEqual(await wood.load(), {loaded: 14, total: 14});
 wood.unlock(); assert.equal(ctx.resumed, 1); assert.equal(ctx.state, 'running');
 ctx.advance(.01);
 assert.equal(ctx.edges, baseEdges, 'unlock primer disconnects after ending');
});

await test('spatial: listener drive, distance cull and air absorption', () => {
 wood.tick({position: [10, 1.6, 0], forward: [0, 0, -1], up: [0, 1, 0]});
 assert.equal(ctx.listener.positionX.value, 10);
 const near = wood.play({kind: 'wood_hit', id: 'tree_1', cuts: 1, position: [11, 1, 0]});
 assert.equal(near.length, 1); assert.equal(near[0].filter, null);
 assert.equal(near[0].panner.positionX.value, 11); assert.equal(near[0].panner.distanceModel, 'inverse');
 const far = wood.play({kind: 'wood_hit', id: 'tree_2', cuts: 1, position: [40, 1, 0]});
 assert.ok(far[0].filter && far[0].filter.frequency.value < 16000, 'distant chop is low-passed');
 assert.deepEqual(wood.play({kind: 'wood_hit', id: 'tree_3', cuts: 1, position: [200, 0, 0]}), []);
 assert.equal(wood.stats().culled, 1);
 const a = wood.play({kind: 'wood_hit', id: 'tree_9', cuts: 1, position: [10, 1, 1]})[0];
 const b = wood.play({kind: 'wood_hit', id: 'tree_9', cuts: 1, position: [10, 1, 1]});
 assert.deepEqual(b, [], 'duplicate packet within 30 ms is dropped');
 const r = a.source.playbackRate.value; assert.ok(r >= .95 && r <= 1.05);
 ctx.advance(2); assert.equal(wood.stats().voices, 0); assert.equal(ctx.edges, baseEdges, 'all voice edges released on end');
});

await test('landing scheduled from tree_fell, rustle end-aligned, no polling', () => {
 const t = ctx.currentTime;
 const v = wood.play({kind: 'tree_fell', id: 'tree_5', position: [12, 0, 0], landDelay: 2.3});
 assert.deepEqual(v.map(x => x.sound), ['trunk_fracture', 'foliage_rustle', 'log_land_heavy']);
 const rustle = v[1], land = v[2];
 assert.ok(Math.abs(land.source.startAt - (t + 2.3)) < 1e-9);
 assert.ok(Math.abs(rustle.endAt - (t + 2.3)) < 1e-6 || rustle.source.offset > 0, 'rustle crescendo meets impact');
 ctx.advance(2.3 + .6);
 assert.deepEqual(wood.play({kind: 'tree_land', id: 'tree_5', position: [12, 0, 2]}).map(x => x.sound), ['log_settle']);
 ctx.advance(3); assert.equal(wood.stats().voices, 0); assert.equal(ctx.edges, baseEdges);
});

await test('voice pool never exceeds 16 under a 200-event burst; priorities hold', () => {
 let maxSeen = 0; ctx.advance(1);
 const fell = wood.play({kind: 'tree_fell', id: 'big', position: [10, 0, 1], landDelay: 2});
 const important = fell.filter(v => v.sound !== 'foliage_rustle');
 for (let i = 0; i < 200; i++) {
  const kinds = [{kind: 'log_bounce', id: `log_${i}`}, {kind: 'wood_hit', id: `tree_${i}`, glance: true}, {kind: 'wood_hit', id: `tree_${i}`, cuts: 1}];
  wood.play({...kinds[i % 3], position: [10 + (i % 7), 0, 0]});
  // A hard-stolen source is stopped AND disconnected at once (silent, awaiting GC); count only connected ones.
  maxSeen = Math.max(maxSeen, wood.stats().voices, [...ctx.sources].filter(x => x.out.size).length);
  if (i % 10 === 0) ctx.advance(.01);
 }
 assert.ok(maxSeen <= 16, `voices ${maxSeen}`);
 assert.ok(important.every(v => !v.releasing && !v.dead), 'fracture and scheduled landing survive chop/bounce spam');
 const s = wood.stats(); assert.ok(s.stolen > 0 && s.peakVoices <= 16);
 assert.ok([...wood.stats().voices ? ctx.sources : []].filter(x => x.out.size).length <= 16);
 ctx.advance(.05);
 assert.ok([...ctx.sources].length <= 16, 'stopped sources drain once their stop time passes');
 ctx.advance(6); assert.equal(wood.stats().voices, 0); assert.equal(ctx.sources.size, 0); assert.equal(ctx.edges, baseEdges, 'no leaked connections after burst');
});

await test('per-sound cap steals the oldest instance', () => {
 for (let i = 0; i < 6; i++) wood.play({kind: 'log_bounce', id: `log_cap${i}`, position: [10, 0, 0]});
 const s = wood.stats(); assert.ok(s.voices - s.releasing <= WOOD_SOUNDS.log_bounce.cap);
 ctx.advance(2); assert.equal(ctx.edges, baseEdges);
});

await test('tick reaps voices whose onended never fires (interrupted context)', () => {
 const v = wood.play({kind: 'pickup', id: 'log_x', material: 'wood', position: [10, 1, 0]})[0];
 v.source.onended = null; // simulate a lost callback; the voice keeps its own reference
 ctx.sources.delete(v.source); ctx.currentTime += 1;
 wood.tick(); assert.equal(wood.stats().voices, 0); assert.equal(ctx.edges, baseEdges);
});

await test('dispose stops everything, disconnects master, ignores later events', () => {
 wood.play({kind: 'tree_fell', id: 'tree_d', position: [10, 0, 0], landDelay: 2});
 wood.play({kind: 'wood_hit', id: 'tree_d', cuts: 2, position: [10, 1, 0]});
 assert.ok(wood.stats().voices >= 3);
 wood.dispose();
 const s = wood.stats(); assert.equal(s.voices, 0); assert.equal(s.buffers, 0); assert.ok(s.disposed);
 assert.equal(ctx.edges, 0, 'master detached from destination');
 assert.deepEqual(wood.play({kind: 'wood_hit', cuts: 1, position: [0, 0, 0]}), []);
 wood.tick(); wood.dispose();
});

await test('requires an existing context; constructs no AudioContext of its own', async () => {
 assert.throws(() => createWoodAudio({}));
 const src = await readFile(new URL('../client/wood-audio.js', import.meta.url), 'utf8');
 assert.ok(!/new\s+\(?\s*(window\.)?(webkit)?AudioContext/i.test(src));
});

console.log(JSON.stringify({ok: true, tests: results, total_ms: +(performance.now() - t0).toFixed(1)}, null, 1));
