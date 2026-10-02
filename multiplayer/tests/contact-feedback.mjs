import assert from 'node:assert/strict';
import {createContactFeedback, attributeEvent, contactProfile, toolHand} from '../client/contact-feedback.js';

// Mock XR sources. Array order deliberately puts RIGHT at index 0 so index assumptions would fail.
function rig({order = ['right', 'left'], actuator = 'ok'} = {}) {
  const log = [], queue = [];
  let now = 1000, tool = 'axe', presenting = true, weaponHand = null, me = 'me';
  const make = hand => ({handedness: hand, gamepad: actuator === 'none' ? undefined : {hapticActuators: actuator === 'empty' ? [] : [{
    pulse(a, d) { log.push({hand, a, d, t: now});
      if (actuator === 'reject') return Promise.reject(Error('NotAllowed'));
      if (actuator === 'throw') throw Error('InvalidState');
      return Promise.resolve(true); }}]}});
  const sources = order.map(make);
  const fb = createContactFeedback({sources: () => sources, playerId: () => me, tool: () => tool, weaponHand: () => weaponHand,
    presenting: () => presenting, clock: () => now,
    schedule: (f, ms) => { const id = {f, at: now + ms}; queue.push(id); return id; },
    cancel: id => { const i = queue.indexOf(id); if (i >= 0) queue.splice(i, 1); }});
  const advance = ms => { now += ms; for (const job of [...queue]) if (job.at <= now) { queue.splice(queue.indexOf(job), 1); job.f(); } };
  return {fb, log, queue, sources, advance,
    set tool(v) { tool = v; }, set presenting(v) { presenting = v; }, set hand(v) { weaponHand = v; }, set me(v) { me = v; }};
}
const P = (x, y = 1, z = 0) => [x, y, z];
let checks = 0; const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

// 1. Local contact: immediate pulse on the weapon hand (right), material-shaped; authoritative confirm adds no duplicate.
{ const r = rig();
  ok(r.fb.contact({targetId: 't1', point: P(0), normal: [1, 0, 0], direction: [-1, 0, 0], speed: 4, material: 'wood'}), 'local contact pulses');
  ok(r.log.length === 1 && r.log[0].hand === 'right', 'weapon hand is right by handedness, not index');
  r.advance(80);
  const res = r.fb.handleEvent({kind: 'wood_hit', id: 't1', position: P(0), material: 'wood', normal: [1, 0, 0], glance: true});
  ok(res.owner === 'local' && res.reason === 'contact-correlation', 'confirmed by local outstanding contact');
  r.advance(200); ok(r.log.length === 1, 'plain/glance confirmation does not double pulse'); }

// 2. Two peers striking the same tree: only our contact point is ours.
{ const r = rig();
  r.fb.contact({targetId: 't1', point: P(0), material: 'wood'}); r.advance(60);
  const remote = r.fb.handleEvent({kind: 'wood_hit', id: 't1', position: P(.7, 1, .2), cuts: 1});
  ok(remote.owner === 'none', 'peer strike on the same tree at another point is suppressed');
  r.advance(200); ok(r.log.length === 1, 'peer cut never vibrates us');
  const local = r.fb.handleEvent({kind: 'wood_hit', id: 't1', position: P(.02), cuts: 2});
  ok(local.owner === 'local', 'our own point still confirms'); r.advance(100);
  ok(r.log.length === 2 && r.log[1].hand === 'right', 'notch cut adds one follow-up on the weapon hand');
  // A further same-target event cannot reuse the consumed contact.
  ok(r.fb.handleEvent({kind: 'wood_hit', id: 't1', position: P(.01), cuts: 3}).owner === 'none', 'contact consumed once'); }

// 2b. Proposed `by` stamp makes the same-point race exact.
{ const r = rig();
  r.fb.contact({targetId: 't1', point: P(0), material: 'wood'}); r.advance(40);
  ok(r.fb.handleEvent({kind: 'wood_hit', id: 't1', position: P(0), cuts: 1, by: 'peer'}).owner === 'remote', 'stamped peer at our exact point is remote');
  ok(r.fb.handleEvent({kind: 'wood_hit', id: 't1', position: P(0), cuts: 2, by: 'me'}).owner === 'local', 'stamped local still matched'); }

// 3. Remote hits near and far with no local contact: silent.
{ const r = rig();
  for (const position of [P(.5), P(60, 0, 40)]) for (const kind of ['hit', 'headshot', 'wood_hit', 'stone_hit', 'death', 'detach', 'tree_fell', 'ore_break', 'shoot', 'pickup', 'build', 'shockwave'])
    r.fb.handleEvent({kind, id: 'e7', sourceId: 'e7', part: 'torso', position});
  ok(r.log.length === 0, 'remote nearby/far events never pulse');
  ok(r.fb.handleEvent({kind: 'hammer_slam', id: 'peer', position: P(0)}).owner === 'remote', 'peer special is remote by actor id'); }

// 4. Handedness: left-handed melee and the bow hand.
{ const r = rig({order: ['left', 'right']}); r.hand = 'left';
  r.fb.contact({targetId: 'e1', point: P(0), material: 'bone'});
  ok(r.log[0].hand === 'left', 'left-held melee weapon pulses left');
  ok(toolHand('bow') === 'left' && toolHand('axe') === 'right' && toolHand('axe', 'left') === 'left', 'tool hands'); }

// 5. Bow vs melee.
{ const r = rig(); r.tool = 'bow';
  ok(!r.fb.contact({targetId: 't1', point: P(0)}), 'bow never produces melee contact');
  ok(!r.fb.draw({drawing: true, draw: .5}), 'partial draw is silent');
  ok(r.fb.draw({drawing: true, draw: 1}) && r.log.at(-1).hand === 'right' && r.log.at(-1).a <= .15, 'full draw: one faint tick on the string hand');
  r.advance(100); ok(!r.fb.draw({drawing: true, draw: 1}), 'no continuous buzzing while held');
  r.fb.release('bow');
  const rel = r.log.slice(-2); ok(rel[0].hand === 'left' && rel[0].a > rel[1].a && rel[1].hand === 'right', 'release: bow hand thump, string hand snap');
  r.tool = 'crossbow'; r.advance(100); r.fb.release('crossbow'); ok(r.log.at(-1).hand === 'right', 'crossbow recoil on its hand');
  r.tool = 'hammer'; r.advance(100); r.fb.handleEvent({kind: 'hammer_slam', id: 'me', position: P(0)});
  ok(r.log.at(-1).hand === 'right' && r.log.at(-1).a >= .7, 'own special: heavy weapon-hand thump');
  ok(contactProfile({material: 'stone', tool: 'pick'}).duration < contactProfile({material: 'wood', tool: 'axe'}).duration, 'stone is crisper than wood');
  ok(contactProfile({material: 'wood', tool: 'hammer'}).amplitude > contactProfile({material: 'wood', tool: 'axe'}).amplitude, 'hammer weighs more');
  ok(contactProfile({material: 'wood', normal: [0, 1, 0], direction: [1, 0, 0]}).amplitude < contactProfile({material: 'wood', normal: [1, 0, 0], direction: [1, 0, 0]}).amplitude, 'grazing normal is lighter'); }

// 5b. Projectiles: ownership from authoritative snapshot ownerId, retained after removal.
{ const r = rig(); r.tool = 'bow';
  r.fb.sync({projectiles: [{id: 'a1', ownerId: 'me'}, {id: 'a2', ownerId: 'peer'}]}); r.advance(100); r.fb.sync({projectiles: []});
  ok(r.fb.handleEvent({kind: 'embed', id: 'a2', targetId: 'e1', impact: false, position: P(9)}).owner === 'none', 'peer arrow silent');
  ok(r.fb.handleEvent({kind: 'embed', id: 'a1', targetId: 'e1', impact: false, position: P(9)}).owner === 'local' && r.log.at(-1).hand === 'left' && r.log.at(-1).a < .2, 'own arrow on enemy: faint bow-hand confirm');
  const n = r.log.length; r.advance(100);
  r.fb.sync({projectiles: [{id: 'a3', ownerId: 'me'}]}); r.fb.handleEvent({kind: 'embed', id: 'a3', targetId: 'world', impact: true, position: P(30)});
  ok(r.log.length === n, 'own arrow in a wall stays silent (no fake hand impact at range)');
  ok(r.fb.handleEvent({kind: 'embed', id: 'a1', ownerId: 'peer', impact: false, position: P(9, 2)}).owner === 'remote', 'stamped ownerId wins'); }

// 6. Repeated / duplicate events, throttle and caps.
{ const r = rig();
  r.fb.contact({targetId: 'e1', point: P(0), material: 'bone'}); r.advance(50);
  const ev = {kind: 'hit', id: 'e1', part: 'torso', position: P(0), material: 'bone'};
  ok(r.fb.handleEvent(ev).owner === 'local', 'first copy local');
  ok(r.fb.handleEvent({...ev}).reason === 'duplicate', 'replayed copy deduped');
  // One kill: limbs detach then death; only one follow-up.
  for (const part of ['arm_l', 'arm_r', 'leg_l', 'leg_r']) r.fb.handleEvent({kind: 'detach', id: `d_${part}`, sourceId: 'e1', part, position: P(0)});
  r.fb.handleEvent({kind: 'death', id: 'e1', position: P(0, 0)}); r.advance(150);
  ok(r.log.length === 2, 'kill with four detaches is one follow-up, not five');
  const q = rig(); let fired = 0;
  for (let i = 0; i < 40; i++) { if (q.fb.contact({targetId: 't1', point: P(i)})) fired++; q.advance(10); }
  ok(fired <= 10 && fired >= 5, `rapid contacts capped (${fired}/40 in 400 ms)`);
  ok(q.log.every((p, i) => i === 0 || p.t - q.log[i - 1].t >= 45), 'min gap respected');
  ok(q.log.every(p => p.a <= .85 && p.d <= 70), 'amplitude/duration caps'); }

// 7. Actuator unavailable, empty, rejecting, throwing.
for (const actuator of ['none', 'empty', 'reject', 'throw']) {
  const r = rig({actuator});
  assert.doesNotThrow(() => { r.fb.contact({targetId: 't1', point: P(0)}); r.advance(60); r.fb.release('axe'); r.fb.handleEvent({kind: 'hit', id: 'me', position: P(0)}); });
  await Promise.resolve(); await Promise.resolve();
  const s = r.fb.stats();
  if (actuator === 'none' || actuator === 'empty') ok(s.noActuator > 0 && s.pulses === 0, `${actuator}: graceful no-op`);
  else ok(s.rejected > 0, `${actuator}: caught`);
}
{ const r = rig({order: ['right']}); r.tool = 'bow'; r.fb.release('bow');
  ok(r.log.length === 1 && r.log[0].hand === 'right', 'missing bow-hand tracking: no index fallback onto the wrong hand'); }

// 8. Mode/session changes: stale contacts and queued follow-ups never reach a newly equipped tool.
{ const r = rig();
  r.fb.contact({targetId: 't1', point: P(0)}); r.advance(40);
  r.fb.handleEvent({kind: 'wood_hit', id: 't1', position: P(0), cuts: 1}); // schedules a follow-up
  r.fb.reset(); r.tool = 'pick'; r.advance(200);
  ok(r.log.length === 1 && r.queue.length === 0, 'reset cancels queued follow-up');
  r.fb.contact({targetId: 'o1', point: P(3), material: 'stone', tool: 'pick'}); r.fb.reset(); r.advance(60);
  ok(r.fb.handleEvent({kind: 'stone_hit', id: 'o1', position: P(3)}).owner === 'none', 'late confirm after equip/role/session reset is suppressed');
  ok(!r.fb.contact({targetId: 't1', point: P(0), tool: 'axe'}), 'contact for a tool no longer held is ignored');
  r.presenting = false; r.advance(100);
  ok(!r.fb.contact({targetId: 'o1', point: P(3), material: 'stone'}) && r.fb.stats().pulses === 2, 'desktop/touch: no XR pulse, no error');
  const late = rig(); late.fb.contact({targetId: 't1', point: P(0)}); late.advance(800);
  ok(late.fb.handleEvent({kind: 'wood_hit', id: 't1', position: P(0), cuts: 1}).owner === 'none', 'contact window expires'); }

// 9. Local damage: bounded, both hands, fire ticks ignored; enemy hits carrying our id-like target with part are not damage.
{ const r = rig();
  r.fb.handleEvent({kind: 'hit', id: 'me', position: P(0)}); ok(r.log.length === 2 && new Set(r.log.map(p => p.hand)).size === 2, 'damage on both hands');
  r.advance(100); r.fb.handleEvent({kind: 'hit', id: 'me', position: P(1)}); ok(r.log.length === 2, 'damage gap');
  r.advance(500); r.fb.handleEvent({kind: 'hit', id: 'me', position: P(2), fire: true}); ok(r.log.length === 2, 'fire damage ignored');
  r.fb.handleEvent({kind: 'hit', id: 'me', position: P(3)}); r.fb.handleEvent({kind: 'death', id: 'me', position: P(3)}); r.advance(100);
  ok(r.log.length === 6, 'hit then delayed death');
  ok(attributeEvent({kind: 'hit', id: 'me', position: P(0), by: 'god'}, {playerId: 'me'}).owner === 'local', 'being damaged is local regardless of stamp'); }

// 10. Dispose.
{ const r = rig();
  r.fb.contact({targetId: 't1', point: P(0)}); r.advance(40); r.fb.handleEvent({kind: 'wood_hit', id: 't1', position: P(0), cuts: 1});
  r.fb.dispose(); r.advance(200);
  ok(r.log.length === 1 && r.queue.length === 0, 'dispose cancels follow-ups');
  ok(!r.fb.contact({targetId: 't1', point: P(0)}) && r.fb.handleEvent({kind: 'hit', id: 'me', position: P(0)}) === null && !r.fb.release('bow'), 'disposed is inert');
  assert.doesNotThrow(() => r.fb.dispose()); ok(r.fb.stats().disposed, 'idempotent dispose'); }

console.log(`contact-feedback: ${checks} checks pass (ownership, peers, handedness, bow/melee, dedupe/caps, actuators, resets, damage, dispose)`);
