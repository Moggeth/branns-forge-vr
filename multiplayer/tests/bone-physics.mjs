// Skeleton bone physics: how a skeleton comes apart (shared, deterministic) and how its loose bones look
// (hinged elbows/knees/jaw, splinters), checked on the shipped skeleton model.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createEnemy, hitEnemyPart, stepCombat, combatAction, deathStyle, BONE_DEATH, blastRemains} from '../shared/combat.js';
import {prepareAsset} from '../client/asset-pose.js';
import {snapshotDetachedPart} from '../client/combat-view.js';
import {stepHinges, HINGE_LIMITS} from '../client/bone-articulation.js';
import {createBoneShards, SHARDS} from '../client/bone-shards.js';
import {cueFor} from '../client/event-sounds.js';
import {createBlastFx, BLAST_FX} from '../client/blast-fx.js';
import {loadGlb} from './glb-node.mjs';

const began = performance.now();
const flat = () => 0;
function world(height = flat) {
  let n = 0;
  const ctx = {nextId: (s, p) => `${p}${++n}`, terrainHeight: (s, x, z) => height(x, z)};
  const state = {tick: 100, players: [], enemies: [], detachedParts: [], embeds: [], projectiles: [], pickups: []};
  return {state, ctx};
}
const step = (w, n) => { for (let i = 0; i < n; i++) { w.state.tick++; stepCombat(w.state, w.ctx, []); } };
const flatDist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
function kill(part, hit, projectile, id = 's1') {
  const w = world(), e = createEnemy(id, [0, 0, 0]); e.hp = 1; w.state.enemies.push(e);
  const events = []; hitEnemyPart(w.state, e, part, 500, {part, ...hit}, w.ctx, events, {projectile});
  return {w, events, death: events.find(ev => ev.kind === 'death'), parts: w.state.detachedParts};
}

// ---- which death -------------------------------------------------------------------------------------------------
assert.equal(deathStyle({kind: 'skeleton'}, 'torso', {tool: 'hammer'}, false), 'shatter', 'the War Hammer shatters');
assert.equal(deathStyle({kind: 'skeleton'}, 'head', {}, true), 'headshot', 'a bolt or arrow to the skull is a headshot');
assert.equal(deathStyle({kind: 'skeleton'}, 'torso', {tool: 'axe'}, false), 'crumple', 'anything else crumples');
assert.equal(deathStyle({kind: 'golem'}, 'torso', {tool: 'hammer'}, false), null, 'golems keep their own rock death');

// ---- shatter: every joint breaks and the bones scatter the way the hammer swung ------------------------------------
{
  const {w, death, parts} = kill('torso', {tool: 'hammer', point: [0, 1.1, .15], normal: [0, 0, 1]}, false);
  assert.equal(death.style, 'shatter'); assert.deepEqual(death.point, [0, 1.1, .15]);
  assert.ok(parts.every(d => !d.joint), 'no bone stays pinned');
  step(w, 240);
  const spread = parts.map(d => flatDist(d.position, [0, 0, 0]));
  assert.ok(Math.min(...spread) > .8 && Math.max(...spread) > 3, `bones scatter (${spread.map(v => v.toFixed(1))} m)`);
  assert.ok(parts.filter(d => d.position[2] < -.5).length >= 4, 'mostly the way the blow was going (-z)');
  assert.ok(parts.every(d => d.rest > 0), 'and come to rest');
}

// ---- crumple: legs fold out, the rest drops into a heap where it stood -------------------------------------------
{
  const {w, death, parts} = kill('torso', {tool: 'axe', point: [0, 1.1, .15], normal: [0, 0, 1]}, false);
  assert.equal(death.style, 'crumple');
  const torso = parts.find(d => d.part === 'torso');
  for (const d of parts) if (d !== torso) assert.equal(!!d.joint, !d.part.endsWith('Leg'), `${d.part} ${d.part.endsWith('Leg') ? 'falls away' : 'stays on the body'}`);
  let highest = 0; for (let i = 0; i < 300; i++) { step(w, 1); highest = Math.max(highest, ...parts.map(d => d.position[1])); }
  assert.ok(highest < 1.9, `nothing is thrown upward (${highest.toFixed(2)} m)`);
  assert.ok(parts.every(d => flatDist(d.position, [0, 0, 0]) < 1.6), 'a heap where it stood');
  assert.ok(torso.position[1] < .5, 'the ribcage ends up on the ground');
}

// ---- headshot: the skull snaps back, the body goes over backwards, joints hold -------------------------------------
{
  const {w, death, parts} = kill('head', {point: [0, 1.5, .1], normal: [0, 0, 1], direction: [0, 0, -1], shot: 'bolt'}, true);
  assert.equal(death.style, 'headshot'); assert.deepEqual(death.direction, [0, 0, -1]); assert.equal(death.shot, 'bolt');
  const torso = parts.find(d => d.part === 'torso'), head = parts.find(d => d.part === 'head');
  assert.ok(parts.every(d => d === torso || d.joint?.to === torso.id), 'the body holds together');
  step(w, 300);
  assert.ok(head.position[2] < -1.1 && torso.position[2] < -.6, `it lands on its back, head away from the shot (head z ${head.position[2].toFixed(2)})`);
  assert.ok(torso.position[2] > -2.2, 'knocked over, not launched');
  assert.equal(cueFor(death).name, 'skull_thunk');
}
assert.equal(cueFor({kind: 'death', creature: 'skeleton', style: 'shatter'}).name, 'bone_shatter');

// ---- blast: an explosion blows every joint; bones go up and away from the bang, the skull highest ------------------
assert.equal(deathStyle({kind: 'skeleton'}, 'torso', {tool: 'hammer', blastFrom: [0, 0, 0]}, false), 'blast', 'a bang beats a hammer');
{
  const {w, death, parts} = kill('torso', {point: [0, 1, 0], normal: [1, 0, 0], energy: 1.8, blast: true, blastFrom: [-1.5, 0, 0]}, false);
  assert.equal(death.style, 'blast'); assert.deepEqual(death.from, [-1.5, 0, 0]);
  assert.ok(parts.length === 6 && parts.every(d => !d.joint), 'every joint blows');
  const start = new Map(parts.map(d => [d.part, d.position[1]])), peak = new Map(parts.map(d => [d.part, 0]));
  for (let i = 0; i < 360; i++) { step(w, 1); for (const d of parts) peak.set(d.part, Math.max(peak.get(d.part), d.position[1])); }
  assert.ok(parts.every(d => peak.get(d.part) - start.get(d.part) > .5), `every bone goes up (${parts.map(d => `${d.part} +${(peak.get(d.part) - start.get(d.part)).toFixed(1)}`)})`);
  assert.equal([...peak.entries()].sort((a, b) => b[1] - a[1])[0][0], 'head', 'the skull flies highest');
  assert.ok(parts.filter(d => d.position[0] > .3).length >= 4, 'mostly away from the bang (+x)');
  assert.ok(parts.every(d => d.rest > 0), 'and the bones settle');
  assert.equal(cueFor(death).name, 'bone_shatter');
  const again = kill('torso', {point: [0, 1, 0], normal: [1, 0, 0], energy: 1.8, blast: true, blastFrom: [-1.5, 0, 0]}, false);
  step(again.w, 360);
  assert.deepEqual(again.parts.map(d => d.position), parts.map(d => d.position), 'deterministic: every peer sees the same tumble');
  // A second bang throws the bones already lying there.
  const spread = parts.map(d => flatDist(d.position, [0, 0, 0]));
  assert.ok(Math.max(...spread) > 2 && Math.max(...spread) < 7.5, `a big scatter that stays in view (${spread.map(v => v.toFixed(1))} m)`);
  const mid = parts.reduce((m, d) => m.map((v, k) => v + d.position[k] / parts.length), [0, 0, 0]);
  const before = parts.map(d => [...d.position]); blastRemains(w.state, [mid[0] - 1, 0, mid[2]], 6, 1.2); step(w, 30);
  assert.ok(parts.some((d, i) => Math.hypot(d.position[0] - before[i][0], d.position[2] - before[i][2]) > .4), 'loose bones skitter from a later blast');
}
// Golems blown up scatter their rocks instead of dropping them in a pile.
{
  const w = world(), g = createEnemy('g1', [0, 0, 0], 'golem'); g.hp = 1; g.armor = 0; w.state.enemies.push(g);
  hitEnemyPart(w.state, g, 'torso', 999, {point: [0, 1.5, 0], normal: [1, 0, 0], energy: 1.8, blast: true, blastFrom: [-2, 0, 0]}, w.ctx, []);
  const rocks = w.state.detachedParts; assert.ok(rocks.length >= 5, 'the golem comes apart');
  let peak = 0; for (let i = 0; i < 300; i++) { step(w, 1); peak = Math.max(peak, ...rocks.map(d => d.position[1] - (d.part === 'head' ? 3 : 0))); }
  assert.ok(rocks.filter(d => d.position[0] > .5).length >= 3, 'rocks thrown away from the bang');
}
assert.equal(cueFor({kind: 'death', creature: 'skeleton', style: 'crumple'}).name, 'death_bone');

// ---- bones break off a skeleton that keeps fighting ----------------------------------------------------------------
{
  const w = world(), e = createEnemy('s2', [0, 0, 0]); w.state.enemies.push(e);
  const events = [];
  hitEnemyPart(w.state, e, 'rightArm', 48, {part: 'rightArm', point: [-.4, 1.1, .1], normal: [0, 0, 1], shot: 'bolt'}, w.ctx, events, {projectile: true});
  const snap = events.find(ev => ev.kind === 'detach');
  assert.ok(snap && e.missingParts.includes('rightArm'), 'one Siegebird bolt snaps a cracked arm off');
  assert.ok(w.state.enemies.includes(e) && e.hp > 0, 'and the skeleton fights on');
  assert.equal(snap.creature, 'skeleton'); assert.ok(!snap.dying && snap.normal && snap.energy, 'the snap carries its blow for the splinters');
  hitEnemyPart(w.state, e, 'leftLeg', 38, {part: 'leftLeg', point: [.2, .5, .1], normal: [0, 0, 1]}, w.ctx, [], {projectile: true});
  assert.ok(!e.missingParts.includes('leftLeg') && e.parts.leftLeg === 17, 'one arrow only cracks a leg');
  hitEnemyPart(w.state, e, 'leftLeg', 1, {part: 'leftLeg', point: [.2, .5, .1], normal: [0, 0, 1]}, w.ctx, [], {projectile: true});
  assert.ok(e.missingParts.includes('leftLeg') && e.parts.leftLeg === 0, `a leg cracked down to ${BONE_DEATH.snapAt} gives way`);
  e.hp = 100; hitEnemyPart(w.state, e, 'rightLeg', 40, {part: 'rightLeg', tool: 'axe', point: [-.2, .5, .1], normal: [0, 0, 1]}, w.ctx, []);
  assert.ok(!e.missingParts.includes('rightLeg'), 'a plain axe swing still leaves the leg on (clean cuts are Limbsplitter\'s)');
  const g = createEnemy('g1', [3, 0, 0], 'golem'); g.armor = 0; w.state.enemies.push(g);
  hitEnemyPart(w.state, g, 'leftArm', 200, {part: 'leftArm', point: [3.5, 1.6, 0], normal: [0, 0, 1]}, w.ctx, [], {projectile: true});
  assert.ok(!g.missingParts.includes('leftArm'), 'arrows still never take a golem limb');
}

// ---- a limb that comes off with its foot buried is eased out, not fired into the sky -------------------------------
{
  const w = world(), e = createEnemy('s3', [0, 0, 0]); e.hp = 1; w.state.enemies.push(e);
  const id = [0, 0, 0, 1], leg = {position: [.1, .9, 0], quaternion: [1, 0, 0, 0], localBounds: {min: [-.08, -.03, -.08], max: [.08, .95, .2]}};
  hitEnemyPart(w.state, e, 'torso', 500, {part: 'torso', tool: 'axe', normal: [0, 0, 1], point: [0, 1.1, .1], partPoses: {leftLeg: leg, rightLeg: {...leg, position: [-.1, .9, 0]}, torso: {position: [0, 1.1, 0], quaternion: id}}}, w.ctx, []);
  let top = 0; for (let i = 0; i < 60; i++) { step(w, 1); top = Math.max(top, ...w.state.detachedParts.filter(d => d.part.endsWith('Leg')).map(d => d.position[1])); }
  assert.ok(top < 1.3, `buried legs pop out gently (highest hip ${top.toFixed(2)} m)`);
}

// ---- the hammer slam's shockwave throws bones away from its centre, whichever way the skeleton faces --------------
{
  const w = world(), hero = {id: 'h', position: [0, 0, 0], yaw: Math.PI, tool: 'hammer', hp: 100, specialTick: -1000};
  w.state.players.push(hero);
  const at = [0, 0, 1.5], e = createEnemy('east', [3, 0, 1.5]); e.yaw = Math.PI / 2; e.hp = 1; w.state.enemies.push(e); // east of the slam, facing east
  const r = combatAction(w.state, hero, {type: 'action', action: 'special'}, w.ctx);
  const death = r.events.find(ev => ev.kind === 'death');
  assert.equal(death?.style, 'shatter', 'the Q slam shatters too');
  assert.ok(death.direction[0] > .99, 'its blow points away from the slam centre');
  const before = w.state.detachedParts.map(d => d.position[0] - at[0]); step(w, 90);
  const after = w.state.detachedParts.map(d => d.position[0] - at[0]);
  assert.ok(after.reduce((a, b) => a + b, 0) > before.reduce((a, b) => a + b, 0) + 2, 'the bones fly outward, not back into the crater');
}

// ---- same blow, same pile, on every machine -----------------------------------------------------------------------
{
  const a = kill('torso', {tool: 'hammer', point: [0, 1.1, .15], normal: [.6, 0, .8]}, false, 'same'), b = kill('torso', {tool: 'hammer', point: [0, 1.1, .15], normal: [.6, 0, .8]}, false, 'same');
  step(a.w, 200); step(b.w, 200);
  assert.deepEqual(a.parts.map(d => d.position), b.parts.map(d => d.position), 'deterministic scatter');
}

// ---- hinged loose bones on the shipped skeleton --------------------------------------------------------------------
const template = await loadGlb(new URL('../public/assets/skeleton.glb', import.meta.url));
const {visual} = prepareAsset(template, 'skeleton', 1.7), actor = new THREE.Group(); actor.add(visual); actor.updateWorldMatrix(true, true);
const count = node => { let n = 0; node.traverse(m => { if (m.isMesh) n += m.geometry.attributes.position.count; }); return n; };
for (const part of ['leftArm', 'rightArm', 'leftLeg', 'rightLeg', 'head']) {
  const plain = snapshotDetachedPart(visual, part), hinged = snapshotDetachedPart(visual, part, {articulate: true});
  assert.equal(count(hinged), count(plain), `${part}: every triangle kept when split at the joints`);
  const hinges = hinged.userData.hinges;
  assert.equal(hinges?.length, part === 'head' ? 1 : 2, `${part}: ${part === 'head' ? 'a jaw' : 'two hinges'}`);
  for (const h of hinges) assert.ok(Math.abs(h.axis.length() - 1) < 1e-6 && h.length > .03 && h.limits[0] <= h.rest && h.rest <= h.limits[1], `${part}: sane hinge`);
  if (part === 'leftArm') {
    assert.ok(hinged.getObjectByName('LeftHand').parent.name === 'LeftHand:hinge', 'the hand bone (and arrows in it) ride the hand segment');
  }
}
// Hold a loose arm out flat and let go: the forearm drops at the elbow, only the way elbows bend, never through the ground.
{
  const arm = snapshotDetachedPart(visual, 'rightArm', {articulate: true}), scene = new THREE.Scene(); scene.add(arm);
  const elbow = arm.userData.hinges[0], hand = arm.getObjectByName('RightHand:hinge');
  const tip = () => hand.getWorldPosition(new THREE.Vector3());
  // Lay the upper arm horizontal, bend plane vertical (the elbow's axis level).
  arm.quaternion.identity(); arm.updateWorldMatrix(true, true);
  const straightWorld = elbow.straight.clone().applyQuaternion(arm.quaternion);
  const level = new THREE.Quaternion().setFromUnitVectors(straightWorld, new THREE.Vector3(1, 0, 0));
  arm.quaternion.premultiply(level); arm.updateWorldMatrix(true, true);
  // Roll about the arm so the way the elbow folds points straight down.
  const bendNow = elbow.bend.clone().applyQuaternion(arm.quaternion), roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.atan2(-bendNow.z, -bendNow.y) * -1);
  arm.quaternion.premultiply(roll); arm.position.set(0, 1.5, 0); arm.updateWorldMatrix(true, true);
  for (let i = 0; i < 120; i++) stepHinges(arm, 1 / 60, () => 0);
  const bent = elbow.theta;
  assert.ok(Math.abs(bent) > .5, `the forearm swings down at the elbow (${bent.toFixed(2)} rad)`);
  assert.ok(bent >= HINGE_LIMITS.elbow[0] - 1e-6 && bent <= Math.max(HINGE_LIMITS.elbow[1], elbow.rest) + 1e-6, 'within an elbow\'s range');
  // Drop it onto the ground: the hand stays above the ground.
  arm.position.y = .12; arm.updateWorldMatrix(true, true);
  for (let i = 0; i < 120; i++) stepHinges(arm, 1 / 60, () => 0);
  assert.ok(tip().y > -.05, 'the hand rests on the ground, not under it');
  // At rest it goes to sleep: no more work per frame.
  let awake = 0; for (let i = 0; i < 60; i++) if (stepHinges(arm, 1 / 60, () => 0)) awake++;
  assert.ok(awake < 60, 'a still bone stops being simulated');
}
// The skull's jaw falls open when the skull lies face up.
{
  const head = snapshotDetachedPart(visual, 'head', {articulate: true}), jaw = head.userData.hinges[0];
  head.position.set(0, 1, 0); head.updateWorldMatrix(true, true);
  for (let i = 0; i < 90; i++) stepHinges(head, 1 / 60, () => -5);
  assert.ok(jaw.theta > .2, `an upright dead skull's jaw drops open (${jaw.theta.toFixed(2)} rad)`);
}

// ---- splinters ---------------------------------------------------------------------------------------------------
{
  const scene = new THREE.Scene(), high = createBoneShards({scene, height: () => 0}), low = createBoneShards({scene, height: () => 0, quality: 'low'});
  const shatter = {kind: 'death', creature: 'skeleton', style: 'shatter', id: 's9', position: [0, 0, 0], point: [0, 1.1, 0], normal: [0, 0, 1]};
  assert.ok(high.handle(shatter) && low.handle(shatter));
  assert.equal(high.active(), SHARDS.shatter.splinter + SHARDS.shatter.knob);
  assert.ok(low.active() <= Math.ceil(high.active() / 2) + 1, 'phones throw about half as many');
  assert.equal(high.handle({kind: 'death', creature: 'skeleton', style: 'crumple', id: 'x', position: [0, 0, 0]}), false, 'a crumple throws no splinters');
  assert.ok(high.handle({kind: 'detach', creature: 'skeleton', id: 'd1', part: 'leftArm', position: [0, 1, 0], normal: [0, 0, 1]}), 'a snapped limb sheds slivers');
  assert.equal(high.handle({kind: 'detach', creature: 'skeleton', dying: true, id: 'd2', part: 'leftArm', position: [0, 1, 0]}), false, 'not every bone of a dying one');
  for (let i = 0; i < 30; i++) high.handle({...shatter, id: `s${i}`});
  assert.ok(high.stats().active <= SHARDS.pool.high + Math.ceil(SHARDS.pool.high / 2) + Math.ceil(SHARDS.pool.high / 3), 'a fixed pool, oldest recycled');
  let lowest = Infinity; for (let i = 0; i < 120; i++) { high.update(1 / 60); high.object.children.forEach(m => { for (let k = 0; k < m.count; k++) { const e = new THREE.Matrix4(); m.getMatrixAt(k, e); lowest = Math.min(lowest, e.elements[13]); } }); }
  assert.ok(lowest > -.01, 'splinters land on the ground');
  for (let i = 0; i < 60 * 9; i++) high.update(1 / 60);
  assert.equal(high.active(), 0, 'and shrink away');
  assert.ok(high.object.children.every(m => m.count === 0));
  high.dispose(); low.dispose();
}
// Golems topple away from the killing blow like a felled tower, and the stones tumble apart where they land.
{
  const w = world(), g = createEnemy('g2', [0, 0, 0], 'golem'); g.hp = 1; g.armor = 0; w.state.enemies.push(g);
  hitEnemyPart(w.state, g, 'torso', 999, {tool: 'axe', point: [0, 1.6, .5], normal: [0, 0, 1]}, w.ctx, []);
  const rocks = w.state.detachedParts, by = p => rocks.find(d => d.part === p);
  assert.ok(rocks.length >= 5, 'the golem comes apart');
  step(w, 360);
  const head = by('head'), legs = rocks.filter(d => d.part.endsWith('Leg'));
  assert.ok(head && head.position[2] < -1.2, `it falls away from the blow (head z ${head?.position[2].toFixed(2)})`);
  assert.ok(legs.every(l => l.position[2] > head.position[2] + .8), 'feet stay behind, the top goes furthest');
  assert.ok(rocks.every(d => d.position[1] < 1.2 && d.rest > 0), 'every stone ends on the ground and settles');
  const again = world(), g2 = createEnemy('g2', [0, 0, 0], 'golem'); g2.hp = 1; g2.armor = 0; again.state.enemies.push(g2);
  hitEnemyPart(again.state, g2, 'torso', 999, {tool: 'axe', point: [0, 1.6, .5], normal: [0, 0, 1]}, again.ctx, []); step(again, 360);
  assert.deepEqual(again.state.detachedParts.map(d => d.position), rocks.map(d => d.position), 'deterministic');
}
// ---- explosion effect: pooled, capped, and gone when it is over ---------------------------------------------------
{
  const scene = new THREE.Scene(), fx = createBlastFx({scene, height: () => 0});
  const meshes = scene.children.length;
  for (let i = 0; i < 6; i++) fx.blast([i, 0, 0], i % 2 ? 'kettle' : 'keg', 4);
  assert.equal(scene.children.length, meshes, 'a chain of blasts adds no meshes');
  assert.equal(fx.stats().live, BLAST_FX.pool); assert.equal(fx.stats().recycled, 2, 'the oldest blasts recycle');
  for (let i = 0; i < 9 * 30; i++) fx.update(1 / 30);
  assert.equal(fx.stats().live, 0); assert.ok(scene.children.every(m => !m.visible), 'nothing drawn once the smoke clears');
  fx.dispose();
}
console.log(`bone-physics: shatter, crumple, headshot, live limb snaps, buried-limb safety, hinged bones and splinters (${((performance.now() - began) / 1000).toFixed(2)}s)`);
