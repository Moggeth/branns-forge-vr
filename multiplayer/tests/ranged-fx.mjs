// node output/test/ranged-fx.test.mjs  (from the commission folder)
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {stepCombat} from '../shared/combat.js';
import {forecastTrajectory, bowShotFromAim, createTrajectoryGuide} from '../client/ranged-trajectory.js';
import {createProjectileStreaks} from '../client/projectile-streaks.js';
import {createEmbedFractures, FRACTURE_LIMITS} from '../client/embed-fractures.js';

// 1. Forecast == authoritative stepCombat (assumes tick++ then stepCombat).
for (const [aim, base, draw] of [[[0, .2, -1], [.3, .25, -1], .9], [[0, .1, -1], null, .5], [[-.6, .4, -1], [.5, .1, -1], 1]]) {
  const shot = bowShotFromAim(aim, base, draw), origin = [1, 1.5, 2];
  const velocity = shot.direction.map(n => n * shot.speed);
  const state = {tick: 100, projectiles: [{id: 'q1', kind: 'arrow', position: [...origin], previousPosition: [...origin], velocity: [...velocity], curve: [...shot.curve], bornTick: 100, trail: [[...origin]]}], detachedParts: [], players: [], enemies: []};
  const ctx = {terrainHeight: () => -1000};
  const out = new Float32Array(3 * 600), r = forecastTrajectory({origin, velocity, curve: shot.curve, out, sampleEvery: 1, maxTicks: 200});
  for (let k = 1; k <= 200 && state.projectiles.length; k++) {
    state.tick++; stepCombat(state, ctx, []);
    const p = state.projectiles[0]; if (!p) break;
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(p.position[i] - out[k * 3 + i]) < 1e-3, `tick ${k} axis ${i}: ${p.position[i]} vs ${out[k * 3 + i]}`);
  }
  // Forecast ends exactly where the server culls (bounds) or after 200 ticks.
  assert.equal(r.count - 1, r.reason === 'bounds' ? r.ticks : 200); assert.equal(state.projectiles.length === 0, r.reason === 'bounds');
}
// Hit query stops the path at the world contact point.
{
  const out = new Float32Array(3 * 64), r = forecastTrajectory({origin: [0, 1.5, 0], velocity: [0, 0, -30], out, hit: (a, b) => b[2] < -10 ? {point: [a[0], a[1], -10], normal: [0, 0, 1]} : null});
  assert.equal(r.reason, 'hit'); assert.equal(out[(r.count - 1) * 3 + 2], -10);
}
// 2. Guide: preallocated buffer reused, 2 draws, disposal.
{
  const g = createTrajectoryGuide({maxPoints: 48}), buf = g.object.children[0].geometry.attributes.position.array;
  const r = g.update({origin: [0, 1.5, 0], aimDirection: [.1, -.1, -1], curveBase: [0, -.1, -1], draw: 1, hit: (a, b) => b[1] < 0 ? {point: [b[0], 0, b[2]], normal: [0, 1, 0]} : null});
  assert.equal(g.object.children[0].geometry.attributes.position.array, buf); assert.equal(r.reason, 'hit'); assert.ok(g.object.children[1].visible);
  g.dispose();
}
// 3. Streaks: bounded pool, distinct identity, single draw.
{
  const s = createProjectileStreaks({capacity: 96}), list = [];
  for (let i = 0; i < 500; i++) list.push({id: 'q' + i, kind: i % 2 ? 'arrow' : 'bolt', position: [i * .1, 1, 0], velocity: [0, 0, -30], trail: new Array(8)});
  assert.equal(s.update(list), 96); assert.equal(s.update(list.slice(0, 10)), 10);
  const a = new THREE.Matrix4(), b = new THREE.Matrix4(); s.object.getMatrixAt(0, a); s.object.getMatrixAt(1, b);
  assert.notEqual(new THREE.Vector3().setFromMatrixScale(a).z, new THREE.Vector3().setFromMatrixScale(b).z, 'arrow and bolt lengths differ');
  s.dispose();
}
// 4. Fractures: 192 state cap with oldest eviction, 32 nearest, rotated anchors follow.
{
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(); scene.add(camera); camera.position.set(0, 0, 0); camera.updateMatrixWorld();
  const f = createEmbedFractures({camera}); scene.add(f.object);
  const anchor = new THREE.Object3D(); scene.add(anchor);
  for (let i = 0; i < 300; i++) f.add({embedId: 'e' + i, targetId: 't', part: 'arm', anchor, localPoint: [0, 0, -1 - i * .1], localSurfaceNormal: [0, 0, 1], penetration: .5, seed: i});
  assert.equal(f.embeds.size, FRACTURE_LIMITS.state); assert.ok(!f.embeds.has('e0') && f.embeds.has('e299'));
  scene.updateMatrixWorld(true); assert.equal(f.update(), 32);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(); f.object.getMatrixAt(0, m); p.setFromMatrixPosition(m);
  assert.ok(Math.abs(p.z - (-1 - 108 * .1 + .0015)) < 1e-4, 'nearest surviving embed first: ' + p.z);
  // Rotate + move anchor: crack point and normal must follow the bone.
  f.clear(); f.add({embedId: 'r', targetId: 't', part: 'arm', anchor, localPoint: [.2, 0, 0], localSurfaceNormal: [1, 0, 0], seed: 3});
  anchor.position.set(5, 0, 0); anchor.rotation.set(0, Math.PI / 2, 0); scene.updateMatrixWorld(true); f.update();
  f.object.getMatrixAt(0, m); p.setFromMatrixPosition(m); const n = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(m.clone().extractRotation(m)));
  assert.ok(p.distanceTo(new THREE.Vector3(5, 0, -.2015)) < 1e-3, 'rotated point ' + p.toArray());
  assert.ok(n.distanceTo(new THREE.Vector3(0, 0, -1)) < 1e-3, 'rotated normal ' + n.toArray());
  // Detached limb reanchor + hidden anchors skipped.
  const limb = new THREE.Object3D(); scene.add(limb); limb.position.set(0, 3, 0); scene.updateMatrixWorld(true);
  f.reanchor('t', 'arm', limb); f.update(); f.object.getMatrixAt(0, m); assert.ok(Math.abs(new THREE.Vector3().setFromMatrixPosition(m).y - 3) < 1e-6);
  limb.visible = false; assert.equal(f.update(), 0);
  f.dispose(); assert.equal(f.embeds.size, 0); assert.equal(f.object.parent, null);
}
console.log('ranged-fx tests passed');
