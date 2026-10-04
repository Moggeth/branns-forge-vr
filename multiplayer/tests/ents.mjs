// Ents: awakened trees walk, fight, drop real timber when killed and root as new trees when left alone.
import assert from 'node:assert/strict';
import {createSimulation, loadSimulation} from '../shared/simulation.js';
import {worldTrees} from '../shared/world-content.js';
import {ENT, ENT_SIZES, entTargets, entHeight, entPartPosition} from '../shared/ents.js';
import {SPELLS} from '../shared/spells.js';

const world = () => { const sim = createSimulation({room: 'ENTS', seed: 41}); sim.addPlayer({id: 'g', role: 'god'}); sim.addPlayer({id: 'h', role: 'hero'}); return sim; };
let seq = 1;
const cast = (sim, spell, point, id = 'g') => sim.command(id, {type: 'cast', seq: seq++, spell, point});
const step = (sim, n = 1) => { const events = []; for (let i = 0; i < n; i++) events.push(...sim.step()); return events; };
const state = sim => sim.adventureWorld();
const roundTrip = sim => loadSimulation(JSON.parse(JSON.stringify(sim.checkpoint())));

// Catalogue: two tray spells, mana-costed like any other.
assert.ok(SPELLS.some(s => s.id === 'awaken') && SPELLS.some(s => s.id === 'wildwake'));

{ // Awaken takes the nearest standing tree; the tree leaves the world while its ent walks.
  const sim = world(), s = state(sim), tree = worldTrees(s).find(t => t.id === 'tree6');
  const mana = s.players[0].mana, before = worldTrees(s).length;
  const r = cast(sim, 'awaken', [tree.x + 2, 0, tree.z + 1]);
  assert.equal(r.ok, true, r.code);
  const ent = s.enemies.find(e => e.kind === 'ent');
  assert.ok(ent, 'an ent woke');
  assert.equal(ent.treeId, 'tree6'); assert.equal(ent.size, tree.variant === 2 ? 'sapling' : 'elder');
  assert.equal(s.players[0].mana, mana - SPELLS.find(x => x.id === 'awaken').cost);
  assert.ok(!worldTrees(s).some(t => t.id === 'tree6'), 'the awakened tree is no longer standing');
  assert.equal(worldTrees(s).length, before - 1);
  assert.ok(r.events.some(e => e.kind === 'ent_wake' && e.id === ent.id));
  // It holds still while it tears free, then walks.
  const at = [...ent.position]; step(sim, ENT.wakeTicks - 2); assert.deepEqual(ent.position.map(n => +n.toFixed(4)), at.map(n => +n.toFixed(4)));
  step(sim, 60); assert.ok(Math.hypot(ent.position[0] - at[0], ent.position[2] - at[2]) > .2, 'it walks toward the Hero once awake');
  // Saves keep both the ent and the absence of its tree.
  const again = roundTrip(sim), s2 = state(again);
  assert.ok(s2.enemies.some(e => e.id === ent.id && e.kind === 'ent' && e.treeId === 'tree6'));
  assert.ok(!worldTrees(s2).some(t => t.id === 'tree6'));
}

{ // Nothing standing near the tap: a clear refusal, no mana spent.
  const sim = world(), s = state(sim), mana = s.players[0].mana;
  const r = cast(sim, 'awaken', [50, 0, -50]);
  assert.equal(r.ok, false); assert.equal(r.code, 'no_tree'); assert.equal(s.players[0].mana, mana);
}

{ // Wild Awakening wakes up to three, nearest first; notched trees cannot be woken.
  const sim = world(), s = state(sim);
  const r0 = cast(sim, 'grove', [-30, 0, -30]); assert.equal(r0.ok, true, r0.code); step(sim, 50);
  const grove = worldTrees(s).filter(t => t.id.startsWith(s.groves[0].id));
  assert.equal(grove.length, 5);
  s.harvestedTrees.push({id: grove[0].id, cuts: 1, cutHeight: 1, felledTick: 0, fallYaw: 0, landed: false});
  const picks = entTargets(worldTrees(s), s.harvestedTrees, 'wildwake', [-30, 0, -30]);
  assert.equal(picks.length, 3); assert.ok(!picks.some(t => t.id === grove[0].id));
  const r = cast(sim, 'wildwake', [-30, 0, -30]); assert.equal(r.ok, true, r.code);
  const ents = s.enemies.filter(e => e.kind === 'ent');
  assert.deepEqual(ents.map(e => e.treeId).sort(), picks.map(t => t.id).sort());
  for (const e of ents) assert.equal(e.size, e.variant === 2 ? 'sapling' : 'elder');
  roundTrip(sim);
}

{ // Size follows the tree: young trees are small and quick, mature trees big and tough.
  assert.ok(ENT_SIZES.sapling.height < ENT_SIZES.elder.height && ENT_SIZES.sapling.speed > ENT_SIZES.elder.speed && ENT_SIZES.sapling.hp < ENT_SIZES.elder.hp);
}

{ // The axe bites twice as deep; branches come off as logs; a felled ent leaves its trunk as physical timber.
  const sim = world(), s = state(sim), tree = worldTrees(s).find(t => t.variant !== 2 && Math.hypot(t.x, t.z) > 10);
  assert.equal(cast(sim, 'awaken', [tree.x, 0, tree.z]).ok, true);
  const ent = s.enemies.find(e => e.kind === 'ent'), hero = s.players.find(p => p.id === 'h');
  assert.equal(ent.size, 'elder');
  step(sim, 1);
  const strike = (part, tool) => {
    hero.tool = tool; hero.attackTick = -1000;
    const center = entPartPosition(ent, part), d = 1.2;
    hero.position = [ent.position[0] + Math.sin(ent.yaw) * -d, ent.position[1], ent.position[2] - Math.cos(ent.yaw) * d];
    const dx = ent.position[0] - hero.position[0], dz = ent.position[2] - hero.position[2]; hero.yaw = Math.atan2(-dx, -dz);
    return sim.command('h', {type: 'action', seq: seq++, action: 'strike', tool, targetId: ent.id, part, point: center, normal: [0, 1, 0]});
  };
  const hp = ent.hp; let r = strike('torso', 'hammer'); assert.equal(r.ok, true, r.code); const hammer = hp - ent.hp;
  const hp2 = ent.hp; r = strike('torso', 'axe'); assert.equal(r.ok, true, r.code); const axe = hp2 - ent.hp;
  assert.equal(hammer, 70); assert.equal(axe, 68, 'axe 34 doubled against wood');
  assert.ok(r.events.some(e => e.kind === 'hit' && e.material === 'wood'));
  const logs0 = s.looseLogs.length;
  for (let i = 0; i < 4 && !ent.missingParts.includes('leftArm'); i++) r = strike('leftArm', 'axe');
  assert.ok(ent.missingParts.includes('leftArm'), 'the branch arm is cut away');
  assert.ok(r.events.some(e => e.kind === 'ent_limb' && e.part === 'leftArm'));
  assert.equal(s.looseLogs.length, logs0 + ENT_SIZES.elder.limbLogs, 'a severed branch drops as a log');
  for (let i = 0; i < 12 && s.enemies.includes(ent); i++) r = strike('torso', 'axe');
  assert.ok(!s.enemies.includes(ent), 'felled');
  assert.ok(r.events.some(e => e.kind === 'death' && e.creature === 'ent'));
  const timber = s.looseLogs.filter(l => l.sourceId === tree.id);
  assert.equal(timber.length, ENT_SIZES.elder.trunkLogs + 2 * ENT_SIZES.elder.limbLogs, 'trunk sections plus both branch arms');
  step(sim, 240);
  assert.ok(timber.every(l => l.sleeping), 'logs settle on the ground');
  const again = roundTrip(sim); assert.equal(state(again).looseLogs.filter(l => l.sourceId === tree.id).length, timber.length);
  // Collect one: real wood.
  const log = timber[0], wood = hero.resources.wood; hero.position = [log.position[0], log.position[1], log.position[2] + .6];
  r = sim.command('h', {type: 'action', seq: seq++, action: 'collectTarget', targetId: log.id}); assert.equal(r.ok, true, r.code);
  assert.ok(hero.resources.wood > wood);
}

{ // Fire catches on ents and burns them twice as hard.
  const sim = world(), s = state(sim), tree = worldTrees(s).find(t => Math.hypot(t.x, t.z) > 10);
  assert.equal(cast(sim, 'awaken', [tree.x, 0, tree.z]).ok, true);
  const ent = s.enemies.find(e => e.kind === 'ent'); s.players.find(p => p.id === 'h').position = [-50, 0, -50];
  step(sim, ENT.wakeTicks);
  for (let i = 0; i < 9; i++) s.fireCells.push({x: Math.round(ent.position[0] * 2) / 2 + (i % 3 - 1) * .5, z: Math.round(ent.position[2] * 2) / 2 + (Math.floor(i / 3) - 1) * .5, fuel: 1, heat: 1, burning: true, wetUntil: 0, expiresTick: s.tick + 1800});
  const hp = ent.hp; step(sim, 61);
  assert.ok((ent.burnUntil ?? 0) > s.tick, 'it catches fire');
  assert.ok(hp - ent.hp >= 20, `burning hurts (${hp - ent.hp})`);
}

{ // Left alone it roots where it stands after a minute and becomes a new tree there.
  const sim = world(), s = state(sim), tree = worldTrees(s).find(t => Math.hypot(t.x, t.z) > 15);
  s.players.find(p => p.id === 'h').position = [tree.x + 6, 0, tree.z]; // a Hero to walk toward
  assert.equal(cast(sim, 'awaken', [tree.x, 0, tree.z]).ok, true);
  const ent = s.enemies.find(e => e.kind === 'ent'), wake = ent.wakeTick;
  sim.removePlayer('h'); // nobody to chase: it stands where it woke
  step(sim, ENT.rootTicks - ENT.rootWindTicks - 1 - (s.tick - wake));
  step(sim, ENT.rootWindTicks - 5);
  const mid = roundTrip(sim); // a save during rooting still roots on schedule
  const events = step(sim, 10);
  assert.ok(!s.enemies.includes(ent));
  const root = events.find(e => e.kind === 'ent_root');
  assert.ok(root, 'it roots');
  {
    const grown = worldTrees(s).find(t => t.id === `${ent.id}-tree`);
    assert.ok(grown, 'a new tree stands where it rooted');
    assert.equal(grown.variant, tree.variant); assert.equal(grown.height, tree.height);
    assert.ok(Math.hypot(grown.x - ent.position[0], grown.z - ent.position[2]) < .01);
    // The rooted tree can be awakened again, and is choppable like any tree.
    assert.ok(entTargets(worldTrees(s), s.harvestedTrees, 'awaken', [grown.x, 0, grown.z]).some(t => t.id === grown.id));
    const again = roundTrip(sim); assert.ok(worldTrees(state(again)).some(t => t.id === grown.id));
    s.players.find(p => p.id === 'g').mana = 100; s.players.find(p => p.id === 'g').castTick = -1000;
    assert.equal(cast(sim, 'awaken', [grown.x, 0, grown.z]).ok, true);
    assert.ok(!s.wildTrees.some(t => t.id === grown.id) && s.awakenedTrees.some(t => t.id === grown.id));
    roundTrip(sim);
  }
  step(mid, 10); assert.ok(!state(mid).enemies.some(e => e.id === ent.id));
}

{ // Crowded ground (the forge apron) cannot hold a tree: the ent gives its timber instead.
  const sim = world(), s = state(sim), tree = worldTrees(s).find(t => t.id === 'tree1');
  assert.equal(cast(sim, 'awaken', [tree.x, 0, tree.z]).ok, true);
  const ent = s.enemies.find(e => e.kind === 'ent'); sim.removePlayer('h'); ent.position = [1, ent.position[1], 1];
  const events = step(sim, ENT.rootTicks + 2);
  assert.ok(events.some(e => e.kind === 'ent_fade' && e.id === ent.id));
  assert.equal(s.looseLogs.filter(l => l.sourceId === 'tree1').length, ENT_SIZES[ent.size].trunkLogs);
}

{ // An ent that is chasing a Hero stops to sink its roots for the last two seconds.
  const sim = world(), s = state(sim), tree = worldTrees(s).find(t => Math.hypot(t.x, t.z) > 15);
  assert.equal(cast(sim, 'awaken', [tree.x, 0, tree.z]).ok, true);
  const ent = s.enemies.find(e => e.kind === 'ent'), hero = s.players.find(p => p.id === 'h');
  step(sim, ENT.rootTicks - ENT.rootWindTicks);
  hero.position = [ent.position[0] + 8, ent.position[1], ent.position[2]]; hero.protectedUntil = 1e9;
  const at = [...ent.position]; step(sim, ENT.rootWindTicks - 5);
  assert.ok(Math.hypot(ent.position[0] - at[0], ent.position[2] - at[2]) < .02, 'it stops to sink its roots');
}

{ // Live ents are capped; past the cap the cast is refused before mana is spent.
  const sim = world(), s = state(sim);
  for (let i = 0; i < 4; i++) { cast(sim, 'grove', [-40 + i * 12, 0, 40]); s.players[0].castTick = -1000; s.players[0].mana = 100; }
  let woke = 0;
  for (const g of s.groves) { for (let k = 0; k < 2; k++) { s.players[0].castTick = -1000; s.players[0].mana = 100; const r = cast(sim, 'wildwake', [g.x, 0, g.z]); if (r.ok) woke = s.enemies.filter(e => e.kind === 'ent').length; } }
  assert.equal(woke, ENT.maxAwake);
  s.players[0].castTick = -1000; s.players[0].mana = 100;
  const tree = worldTrees(s).find(t => !t.id.includes('-tree'));
  const r = cast(sim, 'awaken', [tree.x, 0, tree.z]); assert.equal(r.code, 'ent_limit'); assert.equal(s.players[0].mana, 100);
}

{ // Strict saves: an ent must name a remembered awakened tree; a tree cannot be both awake and rooted.
  const sim = world(), s = state(sim), tree = worldTrees(s)[3];
  assert.equal(cast(sim, 'awaken', [tree.x, 0, tree.z]).ok, true);
  const bad = JSON.parse(JSON.stringify(sim.checkpoint())); bad.awakenedTrees = [];
  assert.throws(() => loadSimulation(bad));
  const bad2 = JSON.parse(JSON.stringify(sim.checkpoint())); bad2.wildTrees = [{...bad2.awakenedTrees[0]}];
  assert.throws(() => loadSimulation(bad2));
  const bad3 = JSON.parse(JSON.stringify(sim.checkpoint())); bad3.enemies.find(e => e.kind === 'ent').hp = 9999;
  assert.throws(() => loadSimulation(bad3));
  // Pre-ent saves load unchanged.
  const old = JSON.parse(JSON.stringify(world().checkpoint())); delete old.awakenedTrees; delete old.wildTrees;
  assert.equal(worldTrees(state(loadSimulation(old))).length, worldTrees(old).length);
}
console.log('ents: ok');
