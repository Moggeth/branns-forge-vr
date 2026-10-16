// Weapon feel (client/strike-feel.js): contact reactions fit inside each tool's cooldown, the swing clock never jumps,
// the view kick snaps and settles without drifting, predicted impacts suppress exactly one authoritative echo, and the
// swing smear is drawn from the analytic path.
import assert from 'node:assert/strict';
import * as T from 'three';
import {createStrikeClock, createViewPunch, createImpactLedger, createSwingTrail, strikeMaterial, strikeReaction, STRIKE_REACTIONS, SHOT_PUNCH} from '../client/strike-feel.js';
import {SWING_PROFILES, swingPose} from '../client/weapon-motion.js';
import {createImpactPresentation} from '../client/impact-presentation.js';

// Mechanical coherence: what each tool does to each surface.
assert.equal(strikeReaction('axe', 'wood'), 'bite');
assert.equal(strikeReaction('axe', 'stone'), 'rebound');
assert.equal(strikeReaction('axe', 'bone'), 'cleave');
assert.equal(strikeReaction('pick', 'stone'), 'bite');
assert.equal(strikeReaction('hammer', 'stone'), 'rebound');
assert.equal(strikeReaction('limb', 'wood'), 'rebound', 'a swung bone bounces off bark, it never bites');
assert.equal(strikeReaction('axe', null), null);

const snapshot = {enemies: [{id: 'e1', kind: 'skeleton'}, {id: 'g1', kind: 'golem'}, {id: 'n1', kind: 'ent'}], players: [{id: 'p2'}], deposits: [{id: 'd1', kind: 'iron'}], inventions: {structures: [{id: 's1', type: 'foundation'}]}};
assert.equal(strikeMaterial('e1', snapshot), 'bone');
assert.equal(strikeMaterial('g1', snapshot), 'stone');
assert.equal(strikeMaterial('n1', snapshot), 'wood');
assert.equal(strikeMaterial('p2', snapshot), 'flesh');
assert.equal(strikeMaterial('d1', snapshot), 'stone');
assert.equal(strikeMaterial('tree4', snapshot, {trees: [{id: 'tree4'}]}), 'wood');
assert.equal(strikeMaterial('s1', snapshot, {structureMaterial: () => 'stone'}), 'stone');
assert.equal(strikeMaterial('shrine', snapshot), 'metal');
assert.equal(strikeMaterial('miss', snapshot), null);

// Every reaction is over before the tool's own cooldown lets the next swing start (no pose pop between swings).
for (const [tool, profile] of Object.entries(SWING_PROFILES)) {
  for (const material of ['wood', 'stone', 'metal', 'crystal', 'bone', 'flesh', 'earth']) {
    const kind = strikeReaction(tool, material), clock = createStrikeClock();
    clock.begin(0, profile.duration);
    const contactAt = profile.duration * .5;
    let t = 0, last = null, end = null;
    for (; t <= profile.cooldown + .3; t += 1 / 240) {
      if (t >= contactAt && clock.kind === null) clock.contact(t, kind);
      const f = clock.frame(t);
      if (last !== null && !f.done) {
        // The pose clock moves continuously: never faster than a bounce off stone (3.5x the average authored rate).
        assert.ok(Math.abs(f.progress - last.progress) <= 3.5 / 240 / profile.duration + 1e-9, `${tool}/${material} progress jump at ${t.toFixed(3)}`);
        assert.ok(Math.abs(f.home - last.home) < .12, `${tool}/${material} home blend jump`);
      }
      if (f.done) { end = t; break; }
      last = {progress: f.progress, home: f.home};
    }
    assert.ok(end !== null && end <= profile.cooldown + 1e-6, `${tool} on ${material} (${kind}) ends at ${end?.toFixed(3)} after its ${profile.cooldown} s cooldown`);
  }
}

// A miss plays the authored swing exactly: no warp, no layer.
{
  const clock = createStrikeClock(); clock.begin(10, .38); clock.contact(10.19, 'miss');
  for (const t of [10.05, 10.2, 10.3]) { const f = clock.frame(t); assert.ok(Math.abs(f.progress - (t - 10) / .38) < 1e-9); assert.equal(f.offset.length(), 0); assert.equal(f.home, 0); }
}
// A bite holds the head at the contact, then pulls it back along the way it came in.
{
  const clock = createStrikeClock(); clock.begin(0, .38); clock.contact(.19, 'bite');
  const r = STRIKE_REACTIONS.bite, copy = f => ({phase: f.phase, progress: f.progress, offset: f.offset.clone()}), hold = copy(clock.frame(.19 + r.hold * .5)), out = copy(clock.frame(.19 + r.hold + r.out * .99));
  assert.equal(hold.phase, 'hold'); assert.ok(Math.abs(hold.progress - .5) < 1e-9); assert.ok(hold.offset.z < 0, 'driven into the wood');
  assert.equal(out.phase, 'out'); assert.ok(out.progress < .5 - r.back * .9, 'pulled back out along the entry path');
}
// Reduced motion keeps the timing and shrinks the shake.
{
  const a = createStrikeClock(), b = createStrikeClock({reducedMotion: true});
  for (const c of [a, b]) { c.begin(0, .38); c.contact(.19, 'rebound'); }
  const fa = a.frame(.2), fb = b.frame(.2); // separate clocks, separate result objects
  assert.equal(fa.progress, fb.progress);
  assert.ok(Math.abs(new T.Euler().setFromQuaternion(fb.quaternion).x) < Math.abs(new T.Euler().setFromQuaternion(fa.quaternion).x));
}

// View kick: snaps toward the kick, peaks about where it was asked, settles to rest inside half a second; a burst of
// kicks stays under the cap.
{
  const punch = createViewPunch();
  punch.kick([.013, 0, 0]);
  let peak = 0, t = 0;
  for (; t < .5; t += 1 / 60) { const v = punch.update(1 / 60); peak = Math.max(peak, v[0]); }
  assert.ok(peak > .008 && peak < .02, `peak ${peak}`);
  assert.ok(Math.abs(punch.value[0]) < 2e-4, `settled ${punch.value[0]}`);
  for (let i = 0; i < 30; i++) { punch.kick([.02, .02, .02]); punch.update(1 / 60); }
  assert.ok(punch.value.every(v => Math.abs(v) <= .045 + 1e-9));
  // Same motion at 30 and 144 fps.
  const a = createViewPunch(), b = createViewPunch(); a.kick(SHOT_PUNCH.crossbow); b.kick(SHOT_PUNCH.crossbow);
  for (let i = 0; i < 3; i++) a.update(1 / 30); for (let i = 0; i < 14; i++) b.update(1 / 144); b.update(.1 - 14 / 144);
  assert.ok(Math.abs(a.value[0] - b.value[0]) < 1e-3);
}

// Prediction ledger: one prediction suppresses one nearby authoritative impact, nothing far away or late.
{
  const ledger = createImpactLedger();
  ledger.record([1, 1, 1], 'wood', 0);
  assert.equal(ledger.consume({kind: 'wood_hit', position: [5, 1, 1]}, .1), false, 'another tree');
  assert.equal(ledger.consume({kind: 'tree_fell', position: [1, 1, 1]}, .1), false, 'not an impact');
  assert.equal(ledger.consume({kind: 'wood_hit', position: [1.2, 1.1, 1]}, .1), true);
  assert.equal(ledger.consume({kind: 'wood_hit', position: [1.2, 1.1, 1]}, .2), false, 'consumed once');
  ledger.record([1, 1, 1], 'stone', 0);
  assert.equal(ledger.consume({kind: 'stone_hit', position: [1, 1, 1]}, 5), false, 'stale');
}

// Swing smear: built from the analytic swing, one draw, hidden when faint.
{
  const trail = createSwingTrail(), rest = {position: new T.Vector3(.33, -.38, -.62), quaternion: new T.Quaternion()}, tip = new T.Vector3(0, .5, -.35);
  const sample = p => swingPose('axe', p, rest, tip, 2);
  assert.equal(trail.update({sample, head: .4, tail: .2, strength: 1, tipLocal: tip}), true);
  const pos = trail.mesh.geometry.attributes.position.array;
  assert.ok(pos.every(Number.isFinite));
  const head = swingPose('axe', .4, rest, tip, 2).tip;
  const n = pos.length / 6 - 1;
  assert.ok(Math.hypot(pos[n * 6] - head.x, pos[n * 6 + 1] - head.y, pos[n * 6 + 2] - head.z) < 1e-6, 'newest edge sits on the weapon tip');
  assert.equal(trail.update({sample, head: .4, tail: .2, strength: 0, tipLocal: tip}), false);
  assert.equal(trail.mesh.visible, false);
  trail.dispose();
}

// Impact hints: steel on stone throws more sparks and a glint; bone on stone none; earth and crystal are materials now.
{
  const fx = createImpactPresentation({});
  const steel = fx.emit({material: 'stone', position: [0, 1, 0], normal: [0, 0, 1], steel: true, seed: 3});
  const bone = fx.emit({material: 'stone', position: [0, 1, 0], normal: [0, 0, 1], steel: false, seed: 3});
  assert.ok(steel.sparks >= 4 && steel.flash); assert.equal(bone.sparks, 0); assert.equal(bone.flash, false);
  assert.ok(fx.emit({material: 'earth', position: [0, 0, 0], normal: [0, 1, 0], seed: 1}).chips > 0);
  assert.ok(fx.emit({material: 'crystal', position: [0, 0, 0], normal: [0, 1, 0], seed: 1}).chips > 0);
  const wood = fx.emit({material: 'wood', position: [0, 1, 0], normal: [0, 0, 1], direction: [-1, 0, 0], kind: 'bite', seed: 9});
  assert.ok(wood.chips >= 9);
  for (let i = 0; i < 120; i++) fx.update(1 / 60);
  const s = fx.stats(); assert.equal(s.flashes, 0); assert.equal(s.drawCalls, 4);
  fx.dispose();
}

console.log('strike-feel: reactions inside cooldowns, continuous swing clock, settling view kick, one-shot prediction ledger, analytic smear, steel sparks pass');
