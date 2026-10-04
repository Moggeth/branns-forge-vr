import assert from 'node:assert/strict';
import {createSimulation, loadSimulation} from '../shared/simulation.js';
import {createEnemy, hitEnemyPart, partPosition} from '../shared/combat.js';
import {createEnt, rememberAwakened} from '../shared/ents.js';
import {createStumpling} from '../shared/stumplings.js';
import {worldTrees} from '../shared/world-content.js';
import {terrainHeight} from '../shared/terrain.js';

// A ranged hit may precede any killing blow. Saves must remain loadable immediately after
// death, while skeleton/golem arrows must follow their actual detached remains.
for (const kind of ['stumpling', 'ent', 'skeleton', 'golem']) for (const finish of ['arrow', 'axe']) {
  const sim = createSimulation({room: 'EMBEDS', seed: 7}); sim.addPlayer({id: 'h'});
  const s = sim.adventureWorld(); s.tick = 4000;
  const tree = worldTrees(s).find(t => t.id === 'tree4');
  const position = [tree.x, terrainHeight(s, tree.x, tree.z), tree.z];
  let enemy;
  if (kind === 'stumpling') {
    s.harvestedTrees.push({id: tree.id, cuts: 3, cutHeight: position[1] + .8, felledTick: 1, fallYaw: 0, landed: true});
    enemy = createStumpling('enemy', tree, position, 3900, s.seed);
  } else if (kind === 'ent') {
    assert.ok(rememberAwakened(s, tree, []));
    enemy = createEnt('enemy', tree, position, 3900);
  } else enemy = createEnemy('enemy', position, kind);
  s.enemies.push(enemy);
  assert.doesNotThrow(() => loadSimulation(sim.checkpoint()));
  const arrow = () => {
    const point = partPosition(enemy, 'torso'), previous = [point[0], point[1], point[2] + .1];
    const id = `q${++s.idCounter}`;
    s.projectiles.push({id, ownerId: 'h', kind: 'arrow', position: [...point], previousPosition: previous,
      velocity: [0, 0, -25], curve: [0, 0, 0], bornTick: s.tick, trail: [previous, [...point]]});
    const result = sim.projectileContact({projectileId: id, targetId: enemy.id, part: 'torso', point,
      normal: [0, 0, 1], localPoint: [0, 0, 0], localQuaternion: [0, 0, 0, 1]});
    assert.equal(result.ok, true, `${kind}: ${result.code}`);
  };
  arrow();
  assert.ok(s.embeds.some(e => e.targetId === enemy.id), `${kind}: first arrow embeds in living creature`);
  if (finish === 'arrow') {
    for (let n = 0; n < 30 && s.enemies.includes(enemy); n++) arrow();
  } else hitEnemyPart(s, enemy, 'torso', 1000, {tool: 'axe', ownerId: 'h'},
    {nextId: (state, prefix) => `${prefix}${++state.idCounter}`, terrainHeight}, []);
  assert.ok(!s.enemies.includes(enemy), `${kind}: ${finish} killed target`);
  assert.ok(!s.embeds.some(e => e.targetId === enemy.id), `${kind}: no orphaned arrows`);
  if (kind === 'skeleton' || kind === 'golem') {
    assert.ok(s.embeds.length > 0, `${kind}: retains arrows on remains`);
    assert.ok(s.embeds.every(e => s.detachedParts.some(d => d.id === e.targetId)), `${kind}: valid remains attachment`);
  }
  assert.doesNotThrow(() => loadSimulation(sim.checkpoint()), `${kind} ${finish}: checkpoint restores immediately`);
}
console.log('enemy-embed-lifecycle: ranged and melee deaths keep valid arrow attachments and loadable saves');
