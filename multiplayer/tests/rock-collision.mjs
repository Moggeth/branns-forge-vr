// Walkers never pass through rocks: a skeleton chasing a hero straight across an ore rock, a meteor, and a Crystal
// Outcrop boulder goes round it, never through it; a hero walking into one stops at its face.
import assert from 'node:assert/strict';
import {createSimulation, terrainHeight} from '../shared/simulation.js';
import {createEnemy} from '../shared/combat.js';
import {depositShape} from '../shared/colliders.js';
import {STARTING_SITES} from '../shared/starting-world.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('PASS', name); };
function rig() {
  const sim = createSimulation({seed: 3}); sim.addPlayer({id: 'h', role: 'hero'});
  const w = sim.adventureWorld(); w.enemies = []; if (w.battle) w.battle.nextWaveTick = 1e9;
  return {sim, w, hero: w.players[0]};
}
const put = (w, o, x, z) => { o.position = [x, terrainHeight(w, x, z), z]; };
// Chase across `rock` ({x, z, r}) from one side to the other and return the closest the skeleton's centre came.
function chase(rock, ticks = 600) {
  const {sim, w, hero} = rig(), e = createEnemy('foe', [0, 0, 0]);
  put(w, hero, rock.x + 6, rock.z + .2); put(w, e, rock.x - 6, rock.z - .2); w.enemies.push(e);
  let closest = Infinity;
  for (let i = 0; i < ticks; i++) {
    hero.hp = 100; sim.step(); put(w, hero, rock.x + 6, rock.z + .2);
    if (w.enemies[0]) closest = Math.min(closest, Math.hypot(w.enemies[0].position[0] - rock.x, w.enemies[0].position[2] - rock.z));
  }
  return closest;
}
for (const id of ['ore7', 'landmarkOre2']) {
  test(`a skeleton goes round ${id}, not through it`, () => {
    const {w} = rig(), d = w.deposits.find(d => d.id === id), min = depositShape(d).base * .92;
    const closest = chase({x: d.x, z: d.z});
    assert.ok(closest >= min, `${id}: skeleton came within ${closest.toFixed(2)} m of the rock's centre (rock base ${min.toFixed(2)} m)`);
  });
}
test('a skeleton goes round a Crystal Outcrop boulder, not through it', () => {
  const b = STARTING_SITES.find(s => s.id === 'outcrop').footprints[0], closest = chase({x: b.x, z: b.z});
  assert.ok(closest >= Math.min(b.w, b.d) / 2, `came within ${closest.toFixed(2)} m of the boulder's centre`);
});
test('a hero walking into a boulder stops at its face', () => {
  const {sim, w, hero} = rig(), d = w.deposits.find(d => d.id === 'ore1'), min = depositShape(d).base * .92;
  put(w, hero, d.x, d.z + .1); sim.step();
  assert.ok(Math.hypot(hero.position[0] - d.x, hero.position[2] - d.z) >= min, 'hero still inside the rock');
});
test('a mined-out rock no longer blocks', () => {
  const {sim, w, hero} = rig(), d = w.deposits.find(d => d.id === 'ore1'); d.depleted = true;
  put(w, hero, d.x + .3, d.z); sim.step();
  assert.ok(Math.hypot(hero.position[0] - d.x, hero.position[2] - d.z) < .5);
});
console.log(`${passed} rock collision tests passed`);
