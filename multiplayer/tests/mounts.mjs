// Mounts in a generated world: horses wait at the start, a wild tiger takes an apple, riding is faster and jumps
// higher, every way off the saddle leaves the mount behind, and saves keep it all.
import assert from 'node:assert/strict';
import {createSimulation, loadSimulation, terrainHeight} from '../shared/simulation.js';
import {worldDescriptor, worldFor} from '../shared/worldgen/registry.js';
import {withWorld} from '../shared/world-extent.js';
import {MOUNT, mountOf, mountSpeed, mountJump} from '../shared/mounts.js';

const world = worldDescriptor({kind: 'wilds', seed: 'ci-mounts', preset: 'continent', size: 2048});
const sim = createSimulation({room: 'M', seed: 41, world});
sim.addPlayer({id: 'h1', name: 'Rider', role: 'hero'});
const st = sim.adventureWorld(), w = worldFor(world);
let seq = 0;
const cmd = m => sim.command('h1', {seq: ++seq, ...m});
const place = (p, x, z) => withWorld(w, () => { p.position = [x, terrainHeight(st, x, z), z]; p.vy = 0; });

const snap = sim.snapshot();
const horses = snap.mounts.filter(m => m.kind === 'horse'), tiger = snap.mounts.find(m => m.kind === 'tiger');
assert.equal(horses.length, 2, 'two horses at the start');
assert.ok(horses.every(m => Math.hypot(m.position[0], m.position[2]) < 30 && m.tamed && !m.rider), 'horses are tame and near the forge');
assert.ok(tiger && !tiger.tamed && Math.hypot(tiger.position[0], tiger.position[2]) > 60, 'a wild tiger lives further out');
assert.deepEqual(createSimulation({room: 'M', seed: 41, world}).snapshot().mounts, snap.mounts, 'every host places the same mounts');

// Too far, then on.
const hero = st.players[0], horse = st.mounts.find(m => m.id === horses[0].id);
place(hero, horse.position[0] + 8, horse.position[2]);
assert.equal(cmd({type: 'action', action: 'mount', mountId: horse.id}).code, 'too_far');
place(hero, horse.position[0] + 1.5, horse.position[2]);
const on = cmd({type: 'action', action: 'mount', mountId: horse.id});
assert.equal(on.ok, true, on.code); assert.equal(mountOf(st, hero), horse);
assert.equal(cmd({type: 'action', action: 'mount', mountId: horses[1].id}).code, 'already_riding');
assert.equal(mountSpeed(st, hero), MOUNT.kinds.horse.speed); assert.ok(mountJump(st, hero) > 5.5);

// Gallop: ten ticks of full input cover about twice the ground a Hero does on foot.
const ride = () => { const from = [...hero.position]; for (let i = 0; i < 30; i++) { cmd({type: 'input', move: {x: 1, z: 0}, yaw: 0}); sim.step(); } return Math.hypot(hero.position[0] - from[0], hero.position[2] - from[2]); };
const mounted = ride();
assert.ok(Math.hypot(horse.position[0] - hero.position[0], horse.position[2] - hero.position[2]) < .01, 'the horse carries its rider');
assert.ok(Math.abs(horse.yaw - Math.atan2(-1, 0)) < .3, 'the horse faces where it runs');

// Save mid-ride and load: the rider is still in the saddle.
const loaded = loadSimulation(JSON.parse(JSON.stringify(sim.checkpoint())));
assert.equal(loaded.snapshot().mounts.find(m => m.id === horse.id).rider, 'h1', 'riding survives a save');
const older = JSON.parse(JSON.stringify(sim.checkpoint())); delete older.mounts;
assert.deepEqual(loadSimulation(older).snapshot().mounts, undefined, 'older saves load without mounts');
const bad = JSON.parse(JSON.stringify(sim.checkpoint())); bad.mounts[1].rider = 'h1';
assert.throws(() => loadSimulation(bad), /mount/i, 'one Hero cannot ride two mounts');

assert.equal(cmd({type: 'action', action: 'dismount'}).ok, true);
const left = [...horse.position];
const walked = ride();
assert.ok(mounted > walked * 1.8, `riding is about twice as fast (${mounted.toFixed(1)} m vs ${walked.toFixed(1)} m)`);
assert.ok(Math.hypot(horse.position[0] - left[0], horse.position[2] - left[2]) < 1, 'the horse stays where you got off');

// A portal or respawn sets the rider down: the mount does not teleport with them.
place(hero, horse.position[0] + 1, horse.position[2]);
assert.equal(cmd({type: 'action', action: 'mount', mountId: horse.id}).ok, true);
place(hero, hero.position[0] + 200, hero.position[2]); sim.step();
assert.equal(mountOf(st, hero), null, 'a long jump sets the rider down');

// The wild tiger wants an apple from your hand.
const cat = st.mounts.find(m => m.kind === 'tiger');
place(hero, cat.position[0] + 1.2, cat.position[2]);
assert.equal(cmd({type: 'action', action: 'mount', mountId: cat.id}).code, 'mount_wild');
st.fruit.drops.push({id: 'apple-t', position: [...hero.position], velocity: [0, 0, 0], mode: 'held', heldBy: 'h1', bites: 0, biteTick: st.tick, bornTick: st.tick});
const tamed = cmd({type: 'action', action: 'mount', mountId: cat.id});
assert.equal(tamed.ok, true, tamed.code); assert.ok(tamed.events.some(e => e.kind === 'mount_tamed'));
assert.ok(cat.tamed && !st.fruit.drops.some(d => d.id === 'apple-t'), 'the tiger ate the apple and stays tame');

// Leaving the room sets the mount free to graze.
sim.removePlayer('h1'); sim.step();
assert.equal(cat.rider, null);
const graze = [...cat.position]; for (let i = 0; i < 1200; i++) sim.step();
assert.ok(Math.hypot(cat.position[0] - cat.home[0], cat.position[2] - cat.home[1]) <= MOUNT.wander.radius + .5, 'grazing stays near home');
assert.ok(cat.position.every(Number.isFinite) && graze.every(Number.isFinite));

// The valley has no mounts.
assert.equal(createSimulation({room: 'V', seed: 41}).snapshot().mounts, undefined);
console.log('PASS mounts: horses at the start, an apple tames the tiger, riding is twice as fast, saves keep riders');
