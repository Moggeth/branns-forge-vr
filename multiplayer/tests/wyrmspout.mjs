// Wyrmspout: tank, sticky globs, Gout, specialties, model contract and the stream's fixed budgets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {createSimulation} from '../shared/simulation.js';
import {WYRMSPOUT,sprayTuning,stickGlob,clingSplash,goutBurst} from '../shared/wyrmspout.js';
import {hitEnemyPart,createEnemy} from '../shared/combat.js';
import {createWyrmspoutStream,STREAM_CAPS} from '../client/wyrmspout-stream.js';
import {createWyrmspoutFeel} from '../client/wyrmspout-feel.js';
const started = performance.now();

// --- authority: a glob that lands on a foe sticks, burns and stacks; Clinging Fire doubles the burn and splashes on death
{
  const state = {tick: 100, players: [{id: 'h', talents: {}}], enemies: [createEnemy('e1', [0, 0, 0]), createEnemy('e2', [1.5, 0, 0]), createEnemy('e3', [9, 0, 0])], fireCells: [], fireSurfaces: [], pickups: [], embeds: [], detachedParts: [], projectiles: [], bloom: 0, idCounter: 0};
  stickGlob(state, state.enemies[0], 'torso', 'h', sprayTuning(state.players[0]).burnTicks);
  assert.equal(state.enemies[0].burnUntil, 100 + WYRMSPOUT.burnTicks); assert.equal(state.enemies[0].goo, 1); assert.ok(!state.enemies[0].cling);
  for (let i = 0; i < 10; i++) stickGlob(state, state.enemies[0], 'torso', 'h', 120);
  assert.equal(state.enemies[0].goo, WYRMSPOUT.maxGoo, 'stacks are capped');
  // Without Clinging Fire a dying foe does not splash.
  const ctx = {nextId: (s, p) => `${p}${++s.idCounter}`, terrainHeight: () => 0}; state.idCounter = 0;
  let events = []; clingSplash(state, state.enemies[0], ctx, events); assert.equal(events.length, 0);
  state.players[0].talents = {wyrmspout: ['cling']};
  const cling = sprayTuning(state.players[0]); assert.equal(cling.burnTicks, WYRMSPOUT.burnTicks * 2);
  stickGlob(state, state.enemies[0], 'torso', 'h', cling.burnTicks); assert.ok(state.enemies[0].cling);
  // Killing it through the normal damage path splashes sticky fire on the neighbour within reach only.
  events = []; hitEnemyPart(state, state.enemies[0], 'torso', 999, {ownerId: 'h'}, ctx, events);
  assert.ok(events.some(e => e.kind === 'cling_splash'), 'clinging foe bursts on death');
  assert.ok(state.enemies.find(e => e.id === 'e2').burnUntil > state.tick, 'neighbour catches'); assert.ok(!(state.enemies.find(e => e.id === 'e3').burnUntil > state.tick), 'far foe untouched');
  assert.ok(state.fireCells.some(c => c.burning), 'splash leaves burning ground');
  // Gout: a wide splash that burns foes near the burst and lights the ground.
  const g = {tick: 10, players: [{id: 'h'}], enemies: [createEnemy('g1', [0, 0, 0]), createEnemy('g2', [6, 0, 0])], fireCells: [], fireSurfaces: []};
  let hits = 0; events = [];
  goutBurst(g, {id: 'q1', ownerId: 'h'}, [0, .6, 0], {terrainHeight: () => 0, damageEnemy: () => hits++}, events);
  assert.equal(hits, 1); assert.ok(g.enemies[0].burnUntil > g.tick && !(g.enemies[1].burnUntil > 0)); assert.ok(g.fireCells.some(c => c.burning)); assert.equal(events.at(-1).kind, 'gout_burst');
}

// --- authority through the simulation: globs fly on the shared ballistics and the burst lasts the tank
{
  const s = createSimulation({legacyBattle: true}); s.addPlayer({id: 'h'}); let seq = 0;
  const act = (action, rest = {}) => s.command('h', {type: 'action', seq: ++seq, action, ...rest});
  assert.equal(act('equip', {tool: 'wyrmspout'}).ok, true);
  const origin = [0, 1.5, 8], direction = [0, 0, -1];
  let accepted = 0;
  for (let t = 0; t < 400; t++) { if (t % 5 === 0 && act('flame', {origin, direction}).ok) accepted++; s.step(); if (s.snapshot().players[0].overheatUntil > s.snapshot().tick) break; }
  assert.equal(accepted, WYRMSPOUT.globs, 'a full tank is one burst of globs');
  const glob = s.snapshot().projectiles.find(p => p.kind === 'flame');
  if (glob) assert.ok(Math.abs(Math.hypot(...glob.velocity) - WYRMSPOUT.speed) < 2);
}

// --- model contract: the runtime animates these nodes by name
{
  const glb = fs.readFileSync(new URL('../public/assets/wyrmspout.glb', import.meta.url));
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString());
  const names = new Set(json.nodes.map(n => n.name));
  for (const n of ['GripAnchor', 'Muzzle', 'Jaw', 'Head', 'FuelLiquid', 'EmberCore', 'EyeGauge', 'Eye_Pupil', 'Eye_LidUpper', 'Eye_LidLower', 'Eye_Glow',
    'FinVein_1', 'FinVein_2', 'FinVein_3', 'NostrilFlame_L', 'NostrilFlame_R', ...['L', 'R'].flatMap(s => [1, 2, 3].map(k => `HeatVent_${s}${k}`))]) assert.ok(names.has(n), `wyrmspout.glb keeps ${n}`);
  const mats = new Set(json.materials.map(m => m.name));
  for (const m of ['LiquidFire', 'WyrmHide', 'ScaleSteel', 'Brass', 'TankGlass', 'VeinGlow']) assert.ok(mats.has(m), `wyrmspout.glb keeps material ${m} (wyrmspout-look.js patches it by name)`);
  assert.ok(json.meshes.length <= 40, `draw-friendly mesh count (${json.meshes.length})`);
  assert.ok(glb.length < 600_000, 'small download');
}

// --- presentation: the rope from the nozzle holds together on slow frames (phones, software rendering)
for (const dt of [1 / 60, 1 / 30, .1]) {
  const scene = new THREE.Scene(); let t = 0;
  const view = createWyrmspoutStream({scene, height: () => -1.7, now: () => t});
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, .05, 180); camera.updateMatrixWorld();
  const muzzle = new THREE.Vector3(.22, -.17, -.8), dir = new THREE.Vector3(0, 0, -40).sub(muzzle).normalize().toArray();
  for (let f = 0; f < Math.round(.6 / dt); f++) { t += dt; view.emitLocal('p:me', muzzle.clone(), dir, sprayTuning({}), dt); view.update(dt, camera); }
  assert.equal(view.stats().ribbons, 1, `rope visible at ${Math.round(1 / dt)} fps`);
  view.dispose();
}

// --- presentation: liquid creep. Puddles slide a short way downhill; splats on a wall run down it and leave a streak.
{
  const slope = .3, scene = new THREE.Scene(); let t = 0;
  const view = createWyrmspoutStream({scene, height: (x) => -x * slope, now: () => t});
  const splatAt = () => { const m = new THREE.Matrix4(), p = new THREE.Vector3(), out = []; const mesh = view.group.children.find(c => c.name === 'WyrmspoutSplats'); for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, m); out.push(p.setFromMatrixPosition(m).clone()); } return out; };
  view.handleEvent({kind: 'goo_splat', by: 'x', position: [0, 0, 0], normal: [0, 1, 0]});
  view.handleEvent({kind: 'goo_splat', by: 'x', position: [-5, 6, 0], normal: [1, 0, 0]});       // on a wall face, well above the ground
  for (let f = 0; f < 120; f++) { t += 1 / 60; view.update(1 / 60); }
  const after = splatAt(), puddle = after.find(p => Math.abs(p.x) < 1), wall = after.filter(p => p.x < -4);
  assert.ok(puddle.x > .05 && puddle.x < .45, `puddle creeps a short way downhill (${puddle.x.toFixed(2)} m)`);
  assert.ok(Math.abs(puddle.y + puddle.x * slope) < .03, 'and stays on the ground');
  assert.ok(Math.min(...wall.map(p => p.y)) < 5.8 && Math.min(...wall.map(p => p.y)) > 5.3, 'wall splat runs down the face'); assert.ok(wall.length >= 2, 'leaving a streak');
  view.dispose();
}

// --- presentation: the stream stays inside its fixed budgets under a long burst, remote globs and many hits
{
  const scene = new THREE.Scene(); let t = 0;
  const view = createWyrmspoutStream({scene, height: () => 0, now: () => t});
  const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 1.7, 3);
  const tuning = sprayTuning({talents: {wyrmspout: ['flood']}});
  const feel = createWyrmspoutFeel({clock: () => t});
  let max = 0, sumMs = 0;
  for (let f = 0; f < 600; f++) {
    const dt = 1 / 60; t += dt;
    if (f < 400) view.emitLocal('p:me', new THREE.Vector3(Math.sin(t) * .3, 1.4, 0), [0, .1, -1], tuning, dt); else view.stopLocal('p:me');
    if (f % 5 === 0) view.sync({tick: f, projectiles: [{id: `r${f}`, kind: 'flame', ownerId: 'other', bornTick: f, position: [3, 1.4, 0], velocity: [0, 0, -15], trail: [[3, 1.4, 0]]}]}, {localId: 'me', renderTick: f - 2});
    if (f % 7 === 0) view.handleEvent({kind: 'goo_splat', by: 'other', position: [Math.sin(f) * 4, .01, -6], normal: [0, 1, 0]});
    if (f % 3 === 0) view.handleEvent({kind: 'goo_stick', id: `e${f % 30}`, part: 'torso', position: [0, 1, -5], burn: 240}, {resolveTarget: () => scene});
    if (f === 300) view.handleEvent({kind: 'gout_burst', id: 'g', position: [0, 0, -8], ground: [0, 0, -8], radius: 2.4});
    const a = performance.now(); view.update(dt, camera); sumMs += performance.now() - a;
    feel.update(dt, {spraying: f < 400, player: {heat: 0}, tick: f, tool: 'wyrmspout'});
    const st = view.stats(); max = Math.max(max, st.drops);
    assert.ok(st.drops <= STREAM_CAPS.drops && st.splats <= STREAM_CAPS.splats && st.stuck <= STREAM_CAPS.stuck && st.licks <= STREAM_CAPS.licks && st.draws <= st.maxDraws);
  }
  assert.ok(max > 60, 'a dense stream while spraying');
  assert.ok(feel.spray() < .1, 'jaw settles after letting go');
  for (let f = 0; f < 400; f++) { t += 1 / 60; view.update(1 / 60, camera); }
  assert.equal(view.stats().drops, 0, 'everything lands or expires');
  view.dispose(); assert.equal(scene.children.length, 0);
  console.log(JSON.stringify({result: 'pass', peakDrops: max, meanUpdateMs: +(sumMs / 600).toFixed(3), seconds: +((performance.now() - started) / 1000).toFixed(3)}));
}
