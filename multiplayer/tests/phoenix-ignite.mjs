import assert from 'node:assert/strict';
import * as T from 'three';
import {createPhoenixIgniteView, IGNITE} from '../client/phoenix-ignite-view.js';
import {createEnemy, projectileContact} from '../shared/combat.js';
import {fireContact} from '../shared/fire.js';

// The host's own ignite event drives the view: a curved (phoenix) arrow biting an enemy.
const ctx = {terrainHeight: () => 0, nextId: () => 'f1', damageEnemy: () => {}, damageHero: () => {}};
const point = [20, 1.15, 20];
const state = {tick: 30, fireCells: [], fireSurfaces: [], enemies: [createEnemy('e1', [20, 0, 20])], players: [],
  detachedParts: [], embeds: [], projectiles: [{id: 'q1', ownerId: 'h', kind: 'arrow', position: point,
    previousPosition: [20, 1.15, 19.9], trail: [[20, 1.15, 19.9], point], velocity: [0, 0, 24], curve: [0, .8, 0], bornTick: 10}]};
const hit = {projectileId: 'q1', targetId: 'e1', part: 'torso', point, normal: [0, 0, -1], localPoint: [0, 0, 0], localQuaternion: [0, 0, 0, 1]};
const result = projectileContact(state, hit, {...ctx, fireContact: (s, q, m) => fireContact(s, q, m, ctx)});
assert.ok(result.ok);
const event = result.events.find(e => e.kind === 'phoenix_ignite');
assert.ok(event, 'a phoenix arrow reports its ignite');

const scene = new T.Scene(), view = createPhoenixIgniteView({scene});
const materials = new Set(), released = new Set();
function watch(ignite) {
  for (const m of [ignite.flash.material, ignite.crown.material]) { materials.add(m); m.addEventListener('dispose', () => released.add(m)); }
  return ignite;
}
try {
  // The event the host sent is enough to raise the whole effect.
  const first = watch(view.burst(event));
  assert.equal(view.stats().ignites, 1);
  view.update(1 / 60);
  assert.ok(first.flash.material.opacity > 0 && first.crown.visible, 'flash and crown light up at once');
  // The crown opens in the struck surface, not flat on the floor: its normal is the contact normal.
  const facing = new T.Vector3(0, 0, 1).applyQuaternion(first.crown.quaternion);
  assert.ok(facing.dot(new T.Vector3(0, 0, -1)) > .99, 'crown lies in the struck surface');
  const openAt = first.crown.scale.x; view.update(.2);
  assert.ok(first.crown.scale.x > openAt, 'the crown keeps opening outward');
  // A hit with no usable normal still works (host surfaces can report a degenerate one).
  watch(view.burst({position: [0, 1, 0], normal: [0, 0, 0]}));
  // Concurrent ignites are capped, and a replaced one gives its materials back.
  for (let i = 0; i < IGNITE.max + 3; i++) watch(view.burst({position: [i, 1, 0], normal: [0, 1, 0]}));
  assert.equal(view.stats().ignites, IGNITE.max, 'concurrent ignites are bounded');
  assert.equal(materials.size - released.size, IGNITE.max * 2, 'replaced ignites release their materials');
  // Feathers outlive the flash and the crown, then the whole effect retires itself.
  view.update(IGNITE.crown + .05);
  assert.equal(view.stats().ignites, IGNITE.max, 'feathers keep burning after the flash');
  view.update(IGNITE.featherLife * 2);
  assert.equal(view.stats().ignites, 0, 'spent ignites clean themselves up');
  assert.equal(materials.size, released.size);
  assert.equal(scene.children.filter(c => c.name === 'phoenix-ignite').length, 0, 'nothing is left in the scene');
} finally {
  view.dispose();
}
assert.equal(materials.size, released.size, 'disposal releases every material');
console.log('phoenix-ignite: phoenix arrow hits bloom into fire, bounded and self-cleaning');
