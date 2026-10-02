// node tests/expedition-presentation.test.mjs — drives the real shared/adventure.js and checks the presentation contract.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createAdventure, adventureAction, stepAdventure, adventureView, checkpointAdventure} from '../shared/adventure.js';
import {createExpeditionPresentation, readExpedition, STAR_SITES} from '../client/expedition-presentation.js';

const results = [];
const test = (name, fn) => { try { fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e.stack]); } };
const terrain = (x, z, edits = []) => { let h = .45 * Math.sin(x * .09) * Math.cos(z * .07); for (const e of edits) { const t = Math.max(0, Math.min(1, 1 - Math.hypot(x - e.x, z - e.z) / Math.max(.01, e.radius))); h += e.height * t * t * (3 - 2 * t); } return h; };
function makeWorld() {
  return {tick: 0, players: [{id: 'h1', role: 'hero', position: [0, 0, 3], resources: {wood: 40, stone: 30, gems: 20}, mana: 100}],
    enemies: [], deposits: [], pickups: [], pendingStarfalls: [], edits: [], shrine: {position: [0, 0, 0], hp: 100, maxHp: 100}};
}
function rig(opts = {}) {
  const scene = new THREE.Scene(), world = makeWorld(), adv = createAdventure({seed: 41});
  const fx = createExpeditionPresentation({scene, height: (x, z) => terrain(x, z, world.edits), ...opts});
  let seq = 1, events = [];
  const act = (action, extra = {}) => { const r = adventureAction(adv, 'h1', {type: 'adventure', seq: seq++, action, ...extra}, world); for (const it of r.intents) if (it.type === 'debit') world.players[0].resources[it.kind] -= it.amount; events.push(...r.events); return r; };
  const step = (n = 1) => { for (let i = 0; i < n; i++) { const out = stepAdventure(adv, world, []); events.push(...out.events); for (const it of out.intents) if (it.type === 'crater') world.edits.push({id: it.id, kind: 'starfall', x: it.x, z: it.z, radius: it.radius, height: it.height}); } };
  const flush = (dt = 1 / 60) => { const list = events; events = []; for (const e of list) fx.handleEvent(e); fx.applySnapshot(checkpointAdventure(adv), world); fx.update(0, dt, null); return list; };
  const frames = (n, dt = 1 / 60) => { for (let i = 0; i < n; i++) fx.update(0, dt, null); };
  return {scene, world, adv, fx, act, step, flush, frames};
}
function toStar(r) { r.act('start'); r.flush(); r.act('deposit', {kind: 'wood', amount: 24}); r.act('deposit', {kind: 'stone', amount: 16}); r.step(301); r.flush(); }
function toLanded(r) { toStar(r); r.step(5 * 60); r.flush(); r.step(8 * 60); r.flush(); }
function toRekindle(r) { toLanded(r); r.act('deposit', {kind: 'gems', amount: 8}); r.step(1); r.flush(); }

test('STAR_SITES mirrors shared/adventure.js sites', () => {
  for (let run = 1; run < 12; run++) {
    const adv = createAdventure({seed: 41}), world = makeWorld();
    adv.run = run - 1; adventureAction(adv, 'h1', {type: 'adventure', seq: 1, action: 'start'}, world);
    adv.stage = 'star'; adv.star.site = run % 3;
    const v = adventureView(adv, world, 'h1');
    assert.deepEqual([v.star.x, v.star.z], STAR_SITES[adv.star.site]);
  }
});
test('idle is hidden and free', () => {
  const r = rig(); r.flush(); r.frames(10);
  const s = r.fx.stats(); assert.equal(s.visible, false); assert.equal(s.drawCalls, 0); assert.equal(s.particles, 0);
});
test('camp: supplies grow with stock, drop in live, bounded draw calls', () => {
  const r = rig(); r.act('start'); r.flush(); r.frames(60);
  let s = r.fx.stats(); assert.equal(s.stage, 'camp'); assert.ok(s.drawCalls <= 6, `draws ${s.drawCalls}`);
  r.act('deposit', {kind: 'wood', amount: 4}); r.act('deposit', {kind: 'stone', amount: 3}); r.flush(); r.frames(5);
  s = r.fx.stats(); assert.ok(s.particles > 0, 'delivery glint'); assert.ok(s.drawCalls <= 10);
  const timber = r.fx.root.getObjectByName('ExpeditionTimber'), stone = r.fx.root.getObjectByName('ExpeditionStone');
  assert.equal(timber.count, 4); assert.equal(stone.count, 6 + 3);
  r.frames(120); s = r.fx.stats(); assert.equal(s.particles, 0); assert.ok(s.drawCalls <= 6);
});
test('late join restores persistent cues without bursts and ignores replayed events', () => {
  const r = rig(); toRekindle(r);
  r.adv.flame = 100; r.adv.rekindled = true; r.adv.waveIndex = 3; r.adv.foes = []; r.step(1);
  const late = createExpeditionPresentation({scene: new THREE.Scene(), height: (x, z) => terrain(x, z, r.world.edits)});
  late.handleEvent({kind: 'adventure_stage', stage: 'victory', run: r.adv.run}); // before first snapshot: ignored
  late.applySnapshot(checkpointAdventure(r.adv), r.world); late.update(0, 1 / 60, null);
  late.handleEvent({kind: 'adventure_stage', stage: 'victory', run: r.adv.run}); late.handleEvent({kind: 'adventure_rekindled'});
  late.update(0, 1 / 60, null);
  const s = late.stats(); assert.equal(s.stage, 'victory'); assert.equal(s.bursts, 0); assert.equal(s.particles, 0); assert.ok(s.visible); assert.ok(s.ignoredEvents >= 1);
});
test('star: telegraph descends, one impact flourish, site fades after recovery', () => {
  const r = rig(); toStar(r); r.frames(30);
  assert.equal(r.fx.stats().stage, 'star');
  r.step(5 * 60); r.flush(); r.frames(1);
  let s = r.fx.stats(); assert.equal(s.telegraphs, 1); assert.ok(s.starHead > .9, `head ${s.starHead}`);
  r.step(4 * 60); r.flush(); r.frames(1); s = r.fx.stats(); assert.ok(s.starHead > .4 && s.starHead < .6, `head ${s.starHead}`);
  r.step(4 * 60); const ev = r.flush(); assert.ok(ev.some(e => e.kind === 'adventure_star_impact'));
  s = r.fx.stats(); assert.equal(s.bursts, 1); assert.ok(s.drawCalls <= 10, `draws ${s.drawCalls}`); assert.ok(s.particles > 0 && s.particles <= 64);
  r.fx.handleEvent({kind: 'adventure_star_impact', position: [...STAR_SITES[r.adv.star.site].slice(0, 1), 0, STAR_SITES[r.adv.star.site][1]]});
  r.flush(); assert.equal(r.fx.stats().bursts, 1, 'duplicate impact is deduplicated');
  r.act('deposit', {kind: 'gems', amount: 3}); r.flush(); r.frames(60);
  assert.equal(r.fx.root.getObjectByName('ExpeditionStarGems').count, 3);
  r.act('deposit', {kind: 'gems', amount: 8}); r.step(1); r.flush(); r.frames(150);
  s = r.fx.stats(); assert.equal(s.stage, 'rekindle'); assert.equal(r.fx.root.getObjectByName('ExpeditionStarBeacon').visible, false);
});
test('rekindle: flame drives fill, falling flame raises urgency, telegraphs bounded to 8', () => {
  const r = rig(); toRekindle(r); r.frames(240);
  let s = r.fx.stats(); assert.ok(Math.abs(s.flame - r.adv.flame) < 3, `flame ${s.flame} vs ${r.adv.flame}`); assert.ok(s.urgency < .1);
  r.world.enemies = [{id: 'g1', kind: 'golem', position: [2, 0, 2]}, {id: 'g2', kind: 'golem', position: [-2, 0, 2]}];
  for (let i = 0; i < 40; i++) { r.step(6); r.flush(.1); }
  s = r.fx.stats(); assert.ok(s.urgency > .3, `urgency ${s.urgency}`);
  for (let i = 0; i < 12; i++) r.fx.handleEvent({kind: 'adventure_telegraph', telegraph: 'gate', id: `t${i}`, x: 10 + i, z: -10, radius: 3, until: 999, label: 'x'});
  r.fx.update(0, 1 / 60, null); s = r.fx.stats(); assert.ok(s.telegraphs <= 8); assert.ok(s.drawCalls <= 10, `draws ${s.drawCalls}`);
  for (let i = 0; i < 200; i++) r.fx.handleEvent({kind: 'adventure_deposit', id: 'h1', resource: 'wood', amount: 1});
  r.fx.update(0, 1 / 60, null); s = r.fx.stats(); assert.ok(s.particles <= 64); assert.ok(s.instances + s.particles + s.telegraphs <= 256);
});
test('defeat settles once; retry relights cleanly from dark', () => {
  const r = rig(); toRekindle(r);
  r.world.enemies = [{id: 'g1', kind: 'golem', position: [2, 0, 2]}, {id: 'g2', kind: 'golem', position: [-2, 0, 2]}];
  for (let i = 0; i < 400 && r.adv.stage === 'rekindle'; i++) { r.step(30); r.flush(.5); }
  assert.equal(r.adv.stage, 'defeat'); r.frames(10);
  let s = r.fx.stats(); assert.equal(s.stage, 'defeat'); const bursts = s.bursts;
  r.fx.handleEvent({kind: 'adventure_stage', stage: 'defeat', run: r.adv.run}); r.flush(); assert.equal(r.fx.stats().bursts, bursts);
  r.frames(600); assert.ok(r.fx.stats().flame < 2, 'dimmed');
  r.world.enemies = []; r.act('retry'); r.flush(); r.frames(1);
  s = r.fx.stats(); assert.equal(s.stage, 'rekindle'); assert.ok(s.flame < 5, 'relights from dark'); r.frames(240);
  assert.ok(Math.abs(r.fx.stats().flame - r.adv.flame) < 3);
});
test('victory flourish fires once per run; rematch run resets', () => {
  const r = rig(); toRekindle(r); r.frames(10);
  r.adv.flame = 99.99; r.adv.waveIndex = 3; r.adv.foes = []; r.adv.elapsed = 1000;
  r.step(3); r.flush(); r.frames(2);
  let s = r.fx.stats(); assert.equal(s.stage, 'victory'); assert.equal(s.burst, 'victory'); assert.ok(s.drawCalls <= 10, `draws ${s.drawCalls}`);
  const b = s.bursts; r.fx.handleEvent({kind: 'adventure_stage', stage: 'victory', run: r.adv.run}); r.flush(); assert.equal(r.fx.stats().bursts, b);
  r.frames(300); s = r.fx.stats(); assert.ok(s.drawCalls <= 6, `settled ${s.drawCalls}`); assert.equal(s.particles, 0);
  r.act('start'); r.flush(); r.frames(120); s = r.fx.stats(); assert.equal(s.stage, 'camp'); assert.equal(s.run, 2); assert.equal(s.burst, null);
  assert.equal(r.fx.root.getObjectByName('ExpeditionForgePlume').visible, false);
  r.act('leave'); r.flush(); r.frames(400); s = r.fx.stats(); assert.equal(s.visible, false); assert.equal(s.drawCalls, 0);
});
test('terrain edits and forge movement re-conform ground cues', () => {
  const r = rig(); r.act('start'); r.flush();
  const geo = r.fx.root.getObjectByName('ExpeditionForgeGround').geometry, before = r.fx.stats().terrain;
  r.world.edits = [{id: 'e1', kind: 'raise', x: 9, z: 0, radius: 4, height: 2}]; r.flush();
  assert.equal(r.fx.stats().terrain, before + 1);
  const p = geo.attributes.position, {xz, lift} = geo.userData; let checked = 0;
  for (let v = 0; v < lift.length; v++) if (Math.hypot(xz[v * 2] - 9, xz[v * 2 + 1]) < 1) { assert.ok(Math.abs(p.getY(v) - (terrain(xz[v * 2], xz[v * 2 + 1], r.world.edits) - terrain(0, 0, r.world.edits) + lift[v])) < 1e-4); checked++; }
  assert.ok(checked > 0);
  r.flush(); assert.equal(r.fx.stats().terrain, before + 1, 'unchanged terrain does not rebuild');
  r.world.shrine.position = [5, 0, -3]; r.flush();
  assert.equal(r.fx.root.getObjectByName('ExpeditionForgeGround').position.x, 5);
  const frameRebuilds = r.fx.stats().rebuilds; r.frames(30); assert.equal(r.fx.stats().rebuilds, frameRebuilds, 'no per-frame rebuilds');
});
test('inputs are not mutated, visuals are not raycast targets', () => {
  const r = rig(); toLanded(r);
  const deep = o => { Object.freeze(o); for (const v of Object.values(o)) if (v && typeof v === 'object') deep(v); return o; };
  const snap = deep(checkpointAdventure(r.adv)), world = deep(JSON.parse(JSON.stringify(r.world))), before = JSON.stringify([snap, world]);
  r.fx.applySnapshot(snap, world); r.fx.handleEvent(deep({kind: 'adventure_star_impact', position: [0, 0, 0]})); r.frames(5);
  assert.equal(JSON.stringify([snap, world]), before);
  r.scene.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 20, 0), new THREE.Vector3(0, -1, 0));
  assert.equal(ray.intersectObject(r.fx.root, true).length, 0);
  r.fx.root.traverse(o => assert.ok(o.userData.ignoreContact, o.name));
});
test('adventureView input is equivalent for the presentation', () => {
  const r = rig(); toLanded(r);
  const a = readExpedition(checkpointAdventure(r.adv)), b = readExpedition(adventureView(r.adv, r.world, 'h1'));
  assert.equal(a.stage, b.stage); assert.deepEqual(a.site, b.site); assert.equal(a.landed, b.landed); assert.deepEqual(a.gems, b.gems);
  assert.equal(readExpedition(null), null); assert.equal(readExpedition({stage: 'nope'}), null);
});
test('pause freezes authoritative countdown extrapolation', () => {
  const r = rig(); toStar(r); r.step(5 * 60); r.flush(); r.frames(1);
  const h0 = r.fx.stats().starHead; r.fx.setPaused(true); r.frames(600); const h1 = r.fx.stats().starHead;
  assert.ok(Math.abs(h1 - h0) < .001, `${h0} -> ${h1}`); r.fx.setPaused(false); r.frames(60);
  assert.ok(h0 - r.fx.stats().starHead <= .3 / 8 + .01, 'extrapolation capped');
});
test('low quality caps sparks', () => {
  const r = rig({quality: 'low'}); r.act('start'); r.flush();
  for (let i = 0; i < 50; i++) r.fx.handleEvent({kind: 'adventure_deposit', id: 'h1', resource: 'stone', amount: 1});
  r.fx.update(0, 1 / 60, null); assert.ok(r.fx.stats().particles <= 24); assert.equal(r.fx.stats().quality, 'low');
});
test('dispose removes and frees owned resources only once', () => {
  const r = rig(); toLanded(r); r.frames(5);
  let geos = 0, mats = 0; const seenG = new Set(), seenM = new Set();
  r.fx.root.traverse(o => { if (o.geometry && !seenG.has(o.geometry)) { seenG.add(o.geometry); o.geometry.addEventListener('dispose', () => geos++); }
    if (o.material && !seenM.has(o.material)) { seenM.add(o.material); o.material.addEventListener('dispose', () => mats++); } });
  r.fx.dispose(); r.fx.dispose();
  assert.equal(geos, seenG.size); assert.equal(mats, seenM.size); assert.ok(!r.scene.children.includes(r.fx.root));
  r.fx.update(0, .1, null); assert.equal(r.fx.applySnapshot(checkpointAdventure(r.adv), r.world), false); assert.equal(r.fx.handleEvent({kind: 'adventure_rekindled'}), false);
});

for (const [status, name, err] of results) console.log(`${status} ${name}${err ? '\n' + err : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
