// Mining feel (client/mining-feel.js, 2026-10-29): a struck rock rocks and settles back exactly to its rest pose, the
// pick's pry reaction fits inside the pick's cooldown, ore sprays stay inside the impact caps, and a broken rock's shells
// fly, land and are all freed (with the split geometry) once they have sunk away.
import assert from 'node:assert/strict';
import * as T from 'three';
import {createMiningFeel, MINING_FEEL} from '../client/mining-feel.js';
import {createImpactPresentation, IMPACT_CAPS, ORE_KINDS} from '../client/impact-presentation.js';
import {createStrikeClock, strikeReaction, STRIKE_REACTIONS} from '../client/strike-feel.js';
import {SWING_PROFILES} from '../client/weapon-motion.js';

// The pick pries ore; every other tool and surface keeps its reaction.
assert.equal(strikeReaction('pick', 'stone', {deposit: true}), 'pry');
assert.equal(strikeReaction('pick', 'crystal', {deposit: true}), 'pry');
assert.equal(strikeReaction('pick', 'stone'), 'bite');
assert.equal(strikeReaction('axe', 'stone', {deposit: true}), 'rebound');
{
  const p = SWING_PROFILES.pick, clock = createStrikeClock(); clock.begin(0, p.duration);
  let end = null;
  for (let t = 0; t <= p.cooldown + .3; t += 1 / 240) { if (t >= p.duration * .5) clock.contact(t, 'pry'); if (clock.frame(t).done) { end = t; break; } }
  assert.ok(end !== null && end <= p.cooldown + 1e-6, `pry ends at ${end} after the pick's ${p.cooldown} s cooldown`);
  assert.ok(STRIKE_REACTIONS.pry.hold > STRIKE_REACTIONS.bite.hold, 'the pry holds longer than a bite: the hit-stop');
}

// Ore sprays and bursts: every mineral, bounded, finite, expiring.
{
  const scene = new T.Scene(), fx = createImpactPresentation({scene, height: 0});
  for (const kind of ORE_KINDS) {
    const r = fx.emit({material: 'ore:' + kind, position: [0, .5, 0], normal: [1, 0, 0], energy: 1.4, steel: true, kind: 'pry', seed: 3});
    assert.ok(r && r.chips > 0 && r.chunks > 0 && r.sparks > 0, `${kind} throws chips, rubble and sparks`);
    fx.emit({material: 'ore:' + kind, position: [0, .5, 0], normal: [0, 1, 0], energy: 2, burst: true, steel: true, seed: 9});
  }
  let peak = 0;
  for (let i = 0; i < 60 * 6; i++) { fx.update(1 / 60); const s = fx.stats(); for (const [k, cap] of Object.entries(IMPACT_CAPS)) assert.ok(s[k] <= cap, k); peak = Math.max(peak, s.chips); for (const m of scene.children) assert.ok(m.instanceMatrix.array.every(Number.isFinite)); }
  assert.ok(peak > 0);
  const s = fx.stats(); assert.equal(s.chips + s.sparks + s.dust + s.flashes, 0, 'all of it gone after six seconds');
  fx.dispose();
}

// A struck rock rocks away from the blow and returns exactly to rest.
const scene = new T.Scene();
{
  const feel = createMiningFeel({scene});
  const root = new T.Group(); root.rotation.y = .7; root.scale.setScalar(1.2); scene.add(root);
  const q0 = root.quaternion.clone(), s0 = root.scale.clone();
  let heat = 0, glow = 0;
  const fracture = {heat: a => { heat = a; }, glow: (hex, l) => { glow = l; }};
  feel.strike({root, fracture, kind: 'crystal', normal: [1, 0, 0], weakness: .5});
  assert.ok(heat > 0, 'fresh fracture glows'); assert.ok(glow > 0, 'crystal carries its own light');
  feel.strike({root: new T.Group(), fracture, kind: 'iron', normal: [0, 0, 1]}); // iron has no inner light of its own
  feel.update(1 / 60);
  assert.ok(root.quaternion.angleTo(q0) > .005, 'rocked'); assert.ok(root.scale.y < s0.y, 'squashed');
  for (let i = 0; i < 120; i++) feel.update(1 / 60);
  assert.ok(root.quaternion.angleTo(q0) < 1e-9 && root.scale.distanceTo(s0) < 1e-9, 'settled exactly');
  assert.equal(feel.stats().shuddering, 0);
  feel.dispose();
}

// The last blow: shells fly, land on the ground, sink and are freed with the fracture; no shell outlives the cap.
{
  const groupsBefore = scene.children.filter(c => c.isGroup).length;
  const emitted = [], ground = (x, z) => .2 + x * .05;
  const feel = createMiningFeel({scene, height: ground, emit: e => emitted.push(e)});
  const root = new T.Group(); root.position.set(3, .2, -1); scene.add(root);
  const shells = [];
  for (let i = 0; i < MINING_FEEL.burstCap + 6; i++) { const m = new T.Mesh(new T.BoxGeometry(.2, .2, .2)); root.add(m); shells.push(m); }
  root.updateMatrixWorld(true);
  let disposed = 0, done = 0;
  const fracture = {release: () => shells.map((mesh, i) => ({mesh, centroid: new T.Vector3(3, .6, -1), out: new T.Vector3(Math.cos(i), .3, Math.sin(i)).normalize()})), dispose: () => disposed++};
  feel.burst({root, fracture, kind: 'gold', position: [3, .2, -1], done: () => done++});
  assert.equal(root.parent, null, 'the rock itself is gone at once');
  assert.ok(emitted.length >= 1 && emitted.every(e => e.burst && e.material === 'ore:gold'), 'a rubble burst in the mineral\'s colours');
  assert.equal(feel.stats().flying, 0); feel.update(1 / 60);
  assert.equal(feel.stats().flying, MINING_FEEL.burstCap, 'capped');
  let minAbove = Infinity;
  for (let i = 0; i < 60 * 3; i++) { feel.update(1 / 60); for (const c of scene.children) if (c.isGroup && c.children[0]?.isMesh && c !== root) minAbove = Math.min(minAbove, c.position.y - ground(c.position.x, c.position.z)); }
  assert.ok(minAbove > -.3, `shells rest on the ground (${minAbove.toFixed(3)})`);
  assert.equal(feel.stats().flying, 0); assert.equal(disposed, 1, 'fracture freed once'); assert.equal(done, 1);
  assert.equal(scene.children.filter(c => c.isGroup).length, groupsBefore, 'no pivots left behind');
  feel.dispose();
}
console.log('mining-feel: pry inside the pick cooldown, bounded ore sprays, rock settles to rest, burst shells land and are freed pass');
