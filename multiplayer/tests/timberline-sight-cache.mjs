import assert from 'node:assert/strict';
import * as T from 'three';
import {createTimberlineSight, forecastTimberline} from '../client/timberline-sight.js';
import {mannedShot} from '../shared/inventions.js';
import {terrainHeight, terrainFrameKey, foundationTerrainKey} from '../shared/terrain.js';
import {castEarthLine} from '../shared/earth-spells.js';

// Canvas drawing is irrelevant to this scene-graph/cache check; real forecast and terrain are exercised.
const previousDocument = globalThis.document;
const context = new Proxy({}, {get: () => () => {}});
globalThis.document = {createElement: () => ({getContext: () => context})};
const scene = new T.Scene(), camera = new T.PerspectiveCamera(), eye = new T.Vector3(10, 2, 2);
const sight = createTimberlineSight({scene});
// game.js reuses this existing once-per-snapshot starting-world terrain stamp.
const timberlineTerrainKey = state => terrainFrameKey(state.edits, state.tick) + '|' + foundationTerrainKey(state);
try {
  const state = {tick: 0, edits: [], deposits: [], pendingStarfalls: []};
  castEarthLine(state, {id: 'god'}, 'wall', 'wall-a', [4, 0, -8], [16, 0, -8], {nextId: () => `deposit-${state.deposits.length}`}, []);
  const b = {id: 'machine', position: [10, terrainHeight(state, 10, 0, false), 0], yaw: 0}, aim = {yaw: 0, pitch: 0};
  const height = (x, z) => terrainHeight(state, x, z, false);
  const update = () => sight.update({b, aim, height, eye, camera, time: state.tick / 60, editsKey: timberlineTerrainKey(state)});
  const before = update();
  state.tick = 120;
  const after = update(), expected = forecastTimberline(mannedShot(b, aim), height);
  assert.notEqual(after, before, 'rising wall refreshes a stationary aim');
  assert.ok(Math.abs(before.distance - after.distance) > 30);
  assert.deepEqual(after, expected);
  state.tick = 121;
  assert.equal(update(), after, 'settled terrain reuses forecast across ticks');
  b.position[1] += 1;
  const raised = update();
  assert.notEqual(raised, after, 'a shifted launcher invalidates its origin');
  assert.deepEqual(raised, forecastTimberline(mannedShot(b, aim), height));
  const oldKey = timberlineTerrainKey(state);
  state.terrainBake = {rev: 1};
  assert.notEqual(timberlineTerrainKey(state), oldKey, 'baked terrain revision invalidates the forecast');
  const settledKey = timberlineTerrainKey(state);
  state.tick = 3620;
  assert.notEqual(timberlineTerrainKey(state), settledKey, 'sinking walls invalidate the forecast');
  console.log('timberline-sight-cache: rise, settle, sink, bake and launcher-origin checks pass');
} finally {
  sight.dispose(); globalThis.document = previousDocument;
}
