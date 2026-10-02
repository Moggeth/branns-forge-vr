// node --test tests/codec.mjs  (no network, no dependencies)
import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeDelta, applyDelta, hashText, CodecError, CODEC_LIMITS, codecHello, supportsCodec,
  SnapshotDeltaEncoder, SnapshotDeltaDecoder} from '../client/state-codec.js';
import {createSimulation} from '../shared/simulation.js';
import {quantizeWire} from '../client/wire-quantize.js';

const wire = v => JSON.parse(JSON.stringify(v)); // What reliable JSON transport delivers.
const snap = (tick, extra = {}) => ({tick, time: tick / 60, players: [{id: 'a', position: [0, 1, 2], hp: 100}], enemies: [], ...extra});
const roundTrip = (a, b) => { const p = encodeDelta(wire(a), wire(b)); return applyDelta(wire(a), p === undefined ? undefined : wire(p)); };
const same = (actual, expected) => assert.equal(JSON.stringify(actual), JSON.stringify(wire(expected)));

function link({keyframeEvery} = {}) {
  let clock = 0;
  const enc = new SnapshotDeltaEncoder({keyframeEvery}), dec = new SnapshotDeltaDecoder({now: () => clock});
  enc.enable('g');
  return {enc, dec, tick: ms => { clock += ms; },
    send(s) { enc.publish(s); return wire(enc.frame('g', 1)); },
    deliver(s) { enc.publish(s); return dec.accept(wire(enc.frame('g', 1))); }};
}

test('pure delta: objects, keyed arrays, xz cells, deletes, order, empty, floats, new fields', () => {
  const a = {tick: 1, players: [{id: 'a', position: [1.001, 2, 3], hp: 100, head: {q: [0, 0, 0, 1]}}, {id: 'b', hp: 5}],
    fireCells: [{x: 0.5, z: 1, fuel: .3, heat: 0, burning: false}, {x: 1, z: 1, fuel: .2, heat: .1, burning: true}],
    edits: [{id: 'r1', x: 1}], misc: [{k: 1}, {k: 2}], numbers: [1, 2, 3], empty: [], gone: true};
  const b = {tick: 2, players: [{id: 'b', hp: 4, extra: {nested: ['x']}}, {id: 'c', hp: 100}],
    fireCells: [{x: 1, z: 1, fuel: .19, heat: .1, burning: true}, {x: 2.5, z: -1, fuel: 1, heat: 1, burning: true}],
    edits: [{id: 'r1', x: 1}], misc: [{k: 1}], numbers: [1, 2.0001, 3], empty: [], adventure: {newField: {deep: [1, {z: null}]}, stage: 'camp'},
    looseLogs: [], fuel: 0.12345};
  same(roundTrip(a, b), b);
  same(roundTrip(b, a), a);
  // Unchanged static arrays are not repeated.
  const p = encodeDelta(wire(a), {...wire(a), tick: 9});
  assert.deepEqual(p, [4, {tick: 9}]);
  assert.equal(encodeDelta(wire(a), wire(a)), undefined);
  // Key order and keyed-array order are exact, not just deep-equal.
  same(roundTrip({a: 1, b: 2}, {b: 2, a: 1}), {b: 2, a: 1});
  same(roundTrip({x: [{id: 1}, {id: 2}, {id: 3}]}, {x: [{id: 3}, {id: 1}, {id: 2}]}), {x: [{id: 3}, {id: 1}, {id: 2}]});
  same(roundTrip({x: [{id: 1}, {id: '1'}]}, {x: [{id: '1', v: 2}, {id: 1}]}), {x: [{id: '1', v: 2}, {id: 1}]});
  // Array deletes, growth from/to empty, positional shrink, duplicate ids fall back to positional.
  same(roundTrip({e: [{id: 'a'}, {id: 'b'}, {id: 'c'}]}, {e: [{id: 'c'}]}), {e: [{id: 'c'}]});
  same(roundTrip({e: []}, {e: [{id: 'a'}]}), {e: [{id: 'a'}]});
  same(roundTrip({e: [{id: 'a'}]}, {e: []}), {e: []});
  same(roundTrip({e: [{id: 'a', v: 1}, {id: 'a', v: 2}]}, {e: [{id: 'a', v: 3}, {id: 'a', v: 2}, {id: 'a'}]}), {e: [{id: 'a', v: 3}, {id: 'a', v: 2}, {id: 'a'}]});
  same(roundTrip({e: [[1, 2], [3]]}, {e: [[1, 2]]}), {e: [[1, 2]]});
  same(roundTrip({v: [1, 2]}, {v: {0: 1}}), {v: {0: 1}});
  same(roundTrip({v: null}, {v: {a: -0.0001}}), {v: {a: -0.0001}});
  same(roundTrip({v: 1}, {}), {});
});

test('stream: keyframe then deltas reproduce the exact quantized wire snapshot (real simulation)', () => {
  const sim = createSimulation({room: 'T', seed: 41});
  for (let i = 0; i < 8; i++) sim.addPlayer({id: `p${i}`, name: `P${i}`, role: i ? 'hero' : 'god'});
  const {deliver} = link();
  for (let i = 0; i < 90; i++) {
    for (let k = 0; k < 3; k++) sim.step();
    if (i % 5 === 0) sim.command('p0', {type: 'cast', seq: i + 1, spell: 'skeleton', point: [i % 20 - 10, 0, -10]});
    const s = sim.snapshot();
    const q = quantizeWire({...s, projectiles: s.projectiles.map(({trail, ...shot}) => shot)});
    const r = deliver(q);
    assert.ok(r.snapshot, r.error); same(r.snapshot, q);
  }
});

test('missing base, gap, out of order, stale and resync request rate limit', () => {
  const l = link();
  assert.ok(l.deliver(snap(1)).snapshot);
  const lost = l.send(snap(2)); // dropped by the receiver's rate limit
  const r3 = l.deliver(snap(3));
  assert.equal(r3.error, 'gap'); assert.deepEqual(r3.request, codecHello(true));
  assert.equal(l.deliver(snap(4)).request, undefined, 'requests are rate limited');
  same(l.dec.accept(lost).snapshot, snap(2)); // a late frame that still matches the base applies
  assert.equal(l.dec.accept(lost).error, 'stale');
  l.enc.resync('g');
  const r5 = l.deliver(snap(5)); assert.ok(r5.snapshot); same(r5.snapshot, snap(5));
  assert.equal(l.dec.seq, 5);
  const d6 = l.send(snap(6)), d7 = l.send(snap(7));
  assert.ok(l.dec.accept(d6).snapshot); assert.ok(l.dec.accept(d7).snapshot);
  assert.equal(l.dec.accept(d6).error, 'stale', 'duplicates/out-of-order frames are ignored without a request');
  // Fresh decoder (rejoin) has no base: delta refused and keyframe requested.
  const fresh = new SnapshotDeltaDecoder();
  const r = fresh.accept(l.send(snap(8))); assert.equal(r.error, 'missing_base'); assert.ok(r.request);
});

test('send failure, host reset/migration and periodic keyframes', () => {
  const l = link({keyframeEvery: 4});
  const kinds = [];
  for (let t = 1; t <= 12; t++) { const m = l.send(snap(t)); kinds.push(m.b === -1 ? 'K' : 'd'); assert.ok(l.dec.accept(m).snapshot); }
  assert.equal(kinds[0], 'K'); assert.ok(kinds.filter(k => k === 'K').length >= 3, kinds.join(''));
  l.enc.resync('g'); assert.equal(l.send(snap(13)).b, -1, 'a failed send is followed by a keyframe');
  // Host migration: a different encoder (new stream id, seq restarts at 1) must not be mixed with the old base.
  const host2 = new SnapshotDeltaEncoder(); host2.enable('g');
  host2.publish(snap(20)); const k = wire(host2.frame('g', 2));
  host2.publish(snap(21)); const d = wire(host2.frame('g', 2));
  assert.equal(l.dec.accept(d).error, 'missing_base');
  assert.ok(l.dec.accept(k).snapshot, 'new stream keyframe accepted even with a lower seq');
  same(l.dec.accept(d).snapshot, snap(21));
  // World reset on the same host: new stream.
  host2.reset(); host2.publish(snap(0)); const k0 = wire(host2.frame('g', 2));
  assert.equal(k0.b, -1); same(l.dec.accept(k0).snapshot, snap(0));
});

test('malformed envelopes and patches are rejected without changing the base', () => {
  const l = link();
  l.deliver(snap(1));
  const good = l.send(snap(2));
  const cases = [null, 'text', 42, [], {kind: 'snapshot_delta'}, {...good, v: 2}, {...good, s: 5}, {...good, n: 0},
    {...good, b: 7}, {...good, h: -1}, {...good, b: -1}, {...good, p: [9, 1]}, {...good, p: [1, []]}, {...good, p: 'x'},
    {...good, p: [2, 0, [['nope', [1, {}]]]]}, {...good, p: [1, {players: [2, 0, [], ['a', 'a']]}]},
    {...good, p: [1, {players: [3, 99999, []]}]}, {...good, p: [1, {players: [3, 3, [[0, [0, {}]]]]}]},
    {...good, p: [1, {tick: [0, 'x']}]}, {...good, p: [1, {}, ['missing']]}, {...good, p: [1, {}, 0, ['tick']]},
    {...good, h: (good.h + 1) >>> 0}];
  for (const bad of cases) {
    const r = l.dec.accept(bad);
    assert.ok(r.error, JSON.stringify(bad)); assert.equal(r.snapshot, undefined);
    assert.equal(l.dec.seq, 1);
  }
  same(l.dec.accept(good).snapshot, snap(2));
  assert.throws(() => applyDelta({a: 1}, [1, {a: [1, {}]}]), CodecError);
  assert.throws(() => applyDelta({a: 1}, JSON.parse('[1,{"b":[2,0,[]]}]')), CodecError, 'patching a missing key');
});

test('prototype pollution is rejected and unknown fields survive', () => {
  const l = link();
  l.deliver(snap(1));
  const good = l.send(snap(2));
  for (const text of ['[1,{"__proto__":[0,{"polluted":1}]}]', '[1,{"x":[0,{"__proto__":{"polluted":1}}]}]',
    '[1,{"players":[2,0,[["a",[1,{"__proto__":[0,1]}]]]]}]', '[1,{},0,["__proto__"]]', '[4,{"__proto__":1}]', '[4,{"x":{"__proto__":1}}]', '[1,{"players":[3,1,[[0,[4,{"__proto__":{"p":1}}]]]]}]']) {
    const r = l.dec.accept({...good, p: JSON.parse(text)});
    assert.ok(r.error, text);
  }
  assert.equal({}.polluted, undefined); assert.equal(Object.prototype.polluted, undefined);
  same(l.dec.accept(good).snapshot, snap(2));
  const keyframe = JSON.parse('{"kind":"snapshot_delta","v":1,"s":"zz","n":9,"b":-1,"k":{"tick":1,"players":[],"__proto__":{"polluted":1}}}');
  assert.equal(new SnapshotDeltaDecoder().accept(keyframe).error, 'bad_key');
  assert.equal({}.polluted, undefined);
  const enc = new SnapshotDeltaEncoder();
  assert.throws(() => enc.publish(JSON.parse('{"tick":1,"players":[],"x":{"__proto__":1}}')), CodecError);
  // Unknown/future fields (adventure, trees, fuel...) at any depth round-trip; 'constructor' is just data.
  const extra = snap(3, {adventure: {futureStage: {constructor: 'ok', list: [{id: 'q', note: 'x'}]}}, looseLogs: [{id: 'log1', sleeping: false}], fuel: [0.5]});
  same(l.deliver(extra).snapshot, extra);
});

test('legacy fallback and capability negotiation', () => {
  const enc = new SnapshotDeltaEncoder();
  enc.publish(snap(1));
  assert.equal(enc.frame('old-client', 1), null, 'peers that never sent a hello keep legacy snapshots');
  assert.ok(supportsCodec(wire(codecHello())));
  assert.ok(!supportsCodec({v: [2]}) && !supportsCodec(null) && !supportsCodec({v: 'x'}));
  assert.equal(new SnapshotDeltaDecoder().accept({kind: 'snapshot', snapshot: snap(1)}).error, 'malformed');
  enc.enable('new'); assert.equal(enc.frame('new', 1).b, -1);
  enc.forget('new'); assert.equal(enc.frame('new', 1), null, 'a reconnecting peer must re-announce');
});

test('bounded state and size caps', () => {
  const limits = {...CODEC_LIMITS, nodes: 200, arrayLength: 50, peers: 3};
  const enc = new SnapshotDeltaEncoder({limits});
  for (let i = 0; i < 10; i++) enc.enable(`p${i}`);
  assert.equal(enc.size, 3, 'encoder peer table is capped');
  assert.throws(() => enc.publish(snap(1, {big: Array.from({length: 60}, (_, i) => i)})), CodecError);
  assert.throws(() => enc.publish(snap(1, {many: Array.from({length: 40}, () => [1, 2, 3, 4, 5])})), CodecError);
  enc.publish(snap(2)); assert.ok(enc.frame('p0', 1));
  const dec = new SnapshotDeltaDecoder({limits});
  assert.equal(dec.accept(wire({...enc.frame('p1', 1), k: snap(1, {big: Array(51).fill(0)})})).error, 'too_long');
  let deep = 0; for (let i = 0; i < 40; i++) deep = [deep];
  assert.equal(new SnapshotDeltaDecoder().accept({kind: 'snapshot_delta', v: 1, s: 'a', n: 1, b: -1, k: snap(1, {deep})}).error, 'too_deep');
  // A decoder retains exactly one base no matter how long it runs.
  const l = link();
  for (let t = 1; t <= 300; t++) l.deliver(snap(t, {e: [{id: `e${t}`}]}));
  assert.equal(l.dec.base.e.length, 1); assert.deepEqual(Object.keys(l.dec).sort(), ['base', 'lastRequest', 'limits', 'now', 'resyncMs', 'seq', 'stats', 'stream']);
  assert.equal(typeof hashText('x'), 'number');
});

test('returned snapshots are detached from the decoder base', () => {
  const l = link();
  const r = l.deliver(snap(1)); r.snapshot.players[0].position[0] = 999; r.snapshot.players.push({id: 'zz'});
  const r2 = l.deliver(snap(2)); assert.ok(r2.snapshot); same(r2.snapshot, snap(2));
});
