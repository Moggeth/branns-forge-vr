import assert from 'node:assert/strict';
import * as THREE from 'three';
import {predictArrow, createPhoenixContrails, CONTRAIL} from '../client/phoenix-flight.js';
import {forecastTrajectory} from '../client/ranged-trajectory.js';

// Whole-tick prediction lands exactly on the authoritative path (forecastTrajectory mirrors stepCombat).
const origin = [0, 1.6, 0], velocity = [2, 1, -30], curve = [0, .9, 0];
const out = new Float32Array(3 * 200);
forecastTrajectory({origin, velocity, curve, out, sampleEvery: 1, maxTicks: 60});
const p = new THREE.Vector3(), v = new THREE.Vector3();
for (const ticks of [1, 5, 17, 40]) {
  predictArrow({kind: 'arrow', position: origin, velocity, curve, bornTick: 100}, 100, ticks, p, v);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(p.getComponent(i) - out[ticks * 3 + i]) < 1e-4, `tick ${ticks} axis ${i}`);
}
// Mid-flight snapshot: predicting from tick 20's state continues the same curve.
const mid = {kind: 'arrow', position: [out[60], out[61], out[62]], velocity: null, curve, bornTick: 100};
predictArrow({kind: 'arrow', position: origin, velocity, curve, bornTick: 100}, 100, 20, p, v); mid.velocity = v.toArray();
predictArrow(mid, 120, 10, p);
for (let i = 0; i < 3; i++) assert.ok(Math.abs(p.getComponent(i) - out[90 + i]) < 1e-4, 'continued curve');
// Fractional ticks move monotonically between whole ticks (no stepping).
let last = -Infinity;
for (let f = 0; f <= 1.001; f += .125) { predictArrow({kind: 'arrow', position: origin, velocity, curve, bornTick: 0}, 0, 3 + f, p); assert.ok(-p.z > last); last = -p.z; }

// Contrails: two trails per phoenix, bounded samples, at most the ribbon plus its ember motes (2 draws),
// shedding sparks while they burn and leaving nothing behind once their arrow is gone.
const trails = createPhoenixContrails();
const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 2, 5); camera.updateMatrixWorld();
for (let f = 0; f < 40; f++) {
  for (const side of [-1, 1]) trails.emit(`a:${side}`, new THREE.Vector3(side * .3, 1.6, -f * .5), 1);
  trails.update(1 / 60, camera);
}
assert.equal(trails.stats().trails, 2); assert.ok(trails.stats().drawCalls <= 2, 'ribbon plus motes stay at two draws');
assert.ok(trails.stats().motes > 0, 'a burning trail sheds embers');
assert.ok(trails.object.geometry.drawRange.count <= 2 * (CONTRAIL.samples - 1) * 3 * 6);
// Every ember is bounded by the pool, however long the phoenix flies.
for (let f = 0; f < 240; f++) {
  for (const side of [-1, 1]) trails.emit(`a:${side}`, new THREE.Vector3(side * .3, 1.6, -40 - f * .5), 1);
  trails.update(1 / 60, camera);
}
assert.ok(trails.stats().motes <= CONTRAIL.motes, 'ember pool is a hard cap');
for (let f = 0; f < 120; f++) trails.update(1 / 60, camera);
assert.equal(trails.stats().trails, 0); assert.equal(trails.stats().motes, 0);
assert.equal(trails.object.visible, false);
// Capacity is a hard cap.
for (let i = 0; i < CONTRAIL.trails + 10; i++) trails.emit(`x${i}`, new THREE.Vector3(i, 0, 0));
assert.equal(trails.stats().trails, CONTRAIL.trails);
trails.dispose();
console.log('phoenix-flight: exact per-frame arrow prediction and bounded wing contrails pass');
