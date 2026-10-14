import assert from 'node:assert/strict';
import {noteEnemySnapshot, sampleEnemyRoot, presentEnemyRoot, enemyDelay} from '../client/enemy-interp.js';
// Enemy roots are drawn from a short snapshot history: continuous position, speed and heading every frame.
let passed = 0; const test = (name, fn) => { fn(); passed++; console.log('ok ', name); };
const entry = () => ({root: {position: {x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; }}, rotation: {y: 0}}, data: {}});

test('20 Hz packets of a 2 m/s walker present at an even speed (no surge and coast)', () => {
  const e = entry();
  let prev = null, min = Infinity, max = 0, next = 0;
  for (let rt = 0; rt < 240; rt += 60 / 144) {
    while (next <= rt) { noteEnemySnapshot(e, {position: [next / 60 * 2, 0, 0], yaw: 0}, next); next += 3; } // a packet lands as its tick comes due
    const p = sampleEnemyRoot(e, rt); if (rt > 20) { const v = (p.x - prev) * 144; min = Math.min(min, v); max = Math.max(max, v); } prev = p.x;
  }
  assert.ok(min > 1.97 && max < 2.03, `speed ${min}..${max}`);
});
test('yaw turns continuously, the short way across ±π', () => {
  const e = entry(), yaws = [3, 3.1, -3.12, -3.0, -2.9];
  yaws.forEach((y, i) => noteEnemySnapshot(e, {position: [0, 0, 0], yaw: y}, i * 3));
  let prev = sampleEnemyRoot(e, enemyDelay(e)).yaw;
  for (let rt = enemyDelay(e); rt < 12 + enemyDelay(e); rt += .25) { const y = sampleEnemyRoot(e, rt).yaw; assert.ok(Math.abs(y - prev) < .05, `yaw step ${y - prev}`); prev = y; }
});
test('a late packet extrapolates briefly, then holds; a teleport snaps', () => {
  const e = entry();
  for (let tick = 0; tick <= 30; tick += 3) noteEnemySnapshot(e, {position: [tick / 30, 0, 0], yaw: 0}, tick);
  const far = sampleEnemyRoot(e, 200).x; assert.ok(far > 1 && far < 1.3, `held at ${far}`);
  noteEnemySnapshot(e, {position: [20, 0, 0], yaw: 0}, 33);
  presentEnemyRoot(e, 400, 1 / 60); assert.equal(e.root.position.x, 20);
});
test('duplicate and rewound ticks never break the history', () => {
  const e = entry();
  noteEnemySnapshot(e, {position: [0, 0, 0], yaw: 0}, 10); noteEnemySnapshot(e, {position: [5, 0, 0], yaw: 0}, 10);
  assert.equal(e.interp.samples.length, 1);
  noteEnemySnapshot(e, {position: [1, 0, 0], yaw: 0}, 4);
  assert.equal(e.interp.samples.length, 1); assert.equal(e.interp.samples[0].tick, 4);
});
console.log(`${passed} enemy interpolation tests passed`);
