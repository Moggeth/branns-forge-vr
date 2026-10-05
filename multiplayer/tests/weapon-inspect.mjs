// Weapon Inspect: tap plays a turn and settles home, a held key spins it, the pose turns about the model's centre,
// and the motion never snaps from one frame to the next.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createWeaponInspect, measureWeapon, choreography, INSPECT_DURATION} from '../client/weapon-inspect.js';

const fit = {center: new THREE.Vector3(.05, .02, -.25), radius: .3}, dt = 1 / 60;
const run = (inspect, seconds, opts = {}) => { let pose; for (let i = 0; i < Math.round(seconds / dt); i++) pose = inspect.update(dt, {fit, ...opts}); return pose; };

// Tap: the turn plays, then the weapon settles back by itself.
{
  const inspect = createWeaponInspect();
  inspect.press(); inspect.release();
  let pose = run(inspect, .5); assert.equal(inspect.mode(), 'auto'); assert.ok(pose.amount > .99, 'fully raised after the blend-in');
  // The model's centre sits on the line of sight, at arm's length.
  const c = fit.center.clone().applyQuaternion(pose.quaternion).add(pose.position);
  assert.ok(Math.abs(c.x) < 1e-6 && Math.abs(c.y - .01) < .01 && c.z < -.35, `centre framed (${c.toArray().map(v => v.toFixed(3))})`);
  pose = run(inspect, INSPECT_DURATION); assert.equal(inspect.mode(), null, 'the turn ends on its own');
  pose = run(inspect, .5); assert.equal(pose.amount, 0); assert.equal(inspect.active(), false, 'and settles home');
}

// A second tap puts it away early; leaving first person stops it.
{
  const inspect = createWeaponInspect();
  inspect.press(); inspect.release(); run(inspect, 1); inspect.press(); inspect.release();
  assert.equal(inspect.mode(), null);
  inspect.press(); inspect.release(); run(inspect, .2); run(inspect, dt, {visible: false}); assert.equal(inspect.mode(), null, 'hidden weapon (VR, third person, God) ends it');
}

// Held key + mouse: the weapon turns with the mouse; without the key held, the mouse still looks around.
{
  const inspect = createWeaponInspect();
  inspect.press(); const before = new THREE.Euler().setFromQuaternion(run(inspect, .3).quaternion, 'YXZ').y;
  assert.equal(inspect.owningLook(), true);
  for (let i = 0; i < 30; i++) { assert.equal(inspect.spin(.03, 0), true); inspect.update(dt, {fit}); }
  assert.equal(inspect.mode(), 'manual');
  const pose = run(inspect, .4);
  const yaw = new THREE.Euler().setFromQuaternion(pose.quaternion, 'YXZ').y - before;
  assert.ok(Math.abs(yaw - .9) < .06, `mouse turned it ~0.9 rad further, picking up where the turn was (${yaw.toFixed(3)})`);
  inspect.release(); assert.equal(inspect.mode(), null, 'letting go of the key settles it home');
  assert.equal(inspect.spin(.1, 0), false, 'mouse is the camera again');
}

// Phone: toggle, drag turns it without holding anything.
{
  const inspect = createWeaponInspect();
  inspect.toggle(); run(inspect, .3);
  assert.equal(inspect.spin(.1, .05, {touch: true}), true); assert.equal(inspect.mode(), 'manual');
  inspect.toggle(); assert.equal(inspect.mode(), null);
}

// Smooth: no frame-to-frame jump in the choreography, and the blend in and out is continuous.
{
  const a = new THREE.Quaternion(), b = new THREE.Quaternion(); let worst = 0;
  for (let t = 0; t < INSPECT_DURATION; t += dt) { choreography(t, a); choreography(t + dt, b); worst = Math.max(worst, a.angleTo(b)); }
  assert.ok(worst < .09, `turn never jumps more than ~5° a frame (${(worst * 180 / Math.PI).toFixed(2)}°)`);
  const inspect = createWeaponInspect(); inspect.press(); inspect.release();
  let last = 0, step = 0; for (let i = 0; i < (INSPECT_DURATION + 1) / dt; i++) { const p = inspect.update(dt, {fit}); step = Math.max(step, Math.abs(p.amount - last)); last = p.amount; }
  assert.ok(step < .1, 'blend changes gradually');
}

// Measuring: the centre and size come from the meshes, in the anchor's frame.
{
  const anchor = new THREE.Group(); anchor.position.set(3, 1, 2); anchor.rotation.y = .7;
  const model = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(.2, .2, .8)); mesh.position.set(0, 0, -.4); model.add(mesh); anchor.add(model);
  const m = measureWeapon(model, anchor);
  assert.ok(m.center.distanceTo(new THREE.Vector3(0, 0, -.4)) < 1e-6); assert.ok(Math.abs(m.radius - Math.hypot(.2, .2, .8) / 2) < 1e-6);
}
// I belongs to the hero: it must not collide with a god spell key, and it only starts an inspect in the hero branch.
{
  const game = readFileSync(new URL('../client/game.js', import.meta.url), 'utf8');
  const spellKeys = game.match(/const spellKeys=\{[^}]*\}/)[0];
  assert.ok(!/KeyI:/.test(spellKeys), 'I must stay free of the god spellbook');
  const hero = game.slice(game.indexOf("else if (role === 'hero' && !event.repeat)"));
  assert.ok(hero.indexOf("if(event.code==='KeyI')startInspect();") < hero.indexOf('\n'), 'I only inspects on the hero keydown line');
}
console.log('weapon inspect ok');
