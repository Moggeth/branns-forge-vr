import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {indexFor, weaponMount, aimIndex, triggerRole, moveIndexes, buttonActions, createPressRouter, LEFT_SPECIAL_TOOLS} from '../client/vr-input-policy.js';
import {createWeaponController} from '../client/weapon-controller.js';
import {createContactFeedback} from '../client/contact-feedback.js';

// XRInputSource-shaped fixtures. Index order is deliberately varied: no test may rely on index 0 being a given hand.
const pad = (pressed = []) => ({axes: [0, 0, 0, 0], buttons: Array.from({length: 6}, (_, i) => ({pressed: pressed.includes(i)})), hapticActuators: []});
const src = (handedness, pressed, extra = {}) => ({handedness, targetRayMode: 'tracked-pointer', gripSpace: {}, gamepad: pad(pressed), ...extra});

test('hands come from handedness, not controller index (connect/disconnect/reassign)', () => {
  const sources = new Map([[0, src('right')], [1, src('left')]]);
  assert.equal(indexFor(sources, 'left'), 1);
  assert.deepEqual(weaponMount('bow', sources), {index: 1, hand: 'left'});
  assert.deepEqual(weaponMount('axe', sources), {index: 0, hand: 'right'});
  sources.delete(1); // left lost: bow moves to the remaining tracked hand
  assert.deepEqual(weaponMount('bow', sources), {index: 0, hand: 'right'});
  sources.delete(0); sources.set(0, src('left')); // runtime reassigns index 0 to the left hand
  assert.equal(indexFor(sources, 'right'), undefined);
  assert.deepEqual(weaponMount('axe', sources), {index: 0, hand: 'left'});
  assert.equal(weaponMount('axe', new Map([[1, src('right', [], {targetRayMode: 'gaze'})]])), null, 'non-tracked sources never hold a weapon');
});

test('aim follows the hand that actually holds the weapon; no blind index 0', () => {
  // Old weaponAim: bow -> find left, else index 0. Only a right controller at index 1 => it aimed from index 0 (absent).
  const rightOnly = new Map([[1, src('right')]]);
  assert.equal(aimIndex({tool: 'bow', sources: rightOnly, weaponHand: 'right'}), 1);
  assert.equal(aimIndex({tool: 'bow', sources: rightOnly, weaponHand: null}), 1, 'mount rule when attachWeapon has not run');
  const both = new Map([[0, src('left')], [1, src('right')]]);
  assert.equal(aimIndex({tool: 'bow', sources: both, weaponHand: 'left'}), 0);
  assert.equal(aimIndex({tool: 'axe', sources: both, weaponHand: 'right'}), 1);
  // Grab/throw/drop aim from the pressing controller, even when the bow is in the other hand.
  assert.equal(aimIndex({purpose: 'press', tool: 'bow', sources: both, weaponHand: 'left', pressIndex: 1}), 1);
  assert.equal(aimIndex({purpose: 'press', tool: 'bow', sources: both, weaponHand: 'left', pressIndex: 7}), 0, 'stale press index falls back to the weapon hand');
  assert.equal(aimIndex({tool: 'axe', sources: new Map(), weaponHand: 'right'}), null, 'no controllers => caller uses the head');
});

test('trigger roles preserve two-controller bindings and give single controllers a usable primary', () => {
  const both = new Map([[0, src('left')], [1, src('right')]]);
  for (const tool of LEFT_SPECIAL_TOOLS) assert.equal(triggerRole({tool, hand: 'left', sources: both}), 'special');
  for (const tool of ['axe', 'pick', 'hammer', 'crossbow']) assert.equal(triggerRole({tool, hand: 'left', sources: both}), 'primary', 'unchanged: left primaryDown');
  for (const tool of ['bow', 'axe', 'wyrmspout']) assert.equal(triggerRole({tool, hand: 'right', sources: both}), 'primary');
  // Held loose log/limb: primary-hand trigger throws; the off hand keeps its weapon role (no silent re-mapping).
  assert.equal(triggerRole({tool: 'axe', hand: 'right', sources: both, holding: true}), 'throw');
  assert.equal(triggerRole({tool: 'bow', hand: 'left', sources: both, holding: true}), 'special');
  // Single left controller: previously special-only (flame/bow unreachable, release dropped). Now primary.
  const leftOnly = new Map([[1, src('left')]]);
  assert.equal(triggerRole({tool: 'wyrmspout', hand: 'left', sources: leftOnly}), 'primary');
  assert.equal(triggerRole({tool: 'bow', hand: 'left', sources: leftOnly}), 'primary');
  assert.equal(triggerRole({tool: 'axe', hand: 'left', sources: leftOnly, holding: true}), 'throw');
  // handedness 'none' behaves as the primary hand.
  assert.equal(triggerRole({tool: 'bow', hand: 'none', sources: new Map([[0, src('none')]])}), 'primary');
});

test('movement sticks: left/none as before; sole right controller walks', () => {
  assert.deepEqual(moveIndexes(new Map([[0, src('right')], [1, src('left')]])), [1]);
  assert.deepEqual(moveIndexes(new Map([[0, src('right')]])), [0]);
  assert.deepEqual(moveIndexes(new Map([[0, src('none')], [1, src('right')]])), [0]);
  assert.deepEqual(moveIndexes(new Map([[0, {handedness: 'left'}]])), [], 'no gamepad, no axes');
});

test('button edges keep familiar bindings and add only left stick click = interact', () => {
  const edge = (hand, buttons, previous, ctx) => buttonActions(src(hand, buttons), previous, ctx);
  assert.deepEqual(edge('left', [1]).actions, ['cycle']);
  assert.deepEqual(edge('right', [1]).actions, ['hand']);
  assert.deepEqual(edge('right', [3]).actions, ['bridge']);
  assert.deepEqual(edge('left', [3]).actions, ['interact']);
  assert.deepEqual(edge('none', [3]).actions, []);
  assert.deepEqual(edge('left', [4]).actions, ['jump']);
  assert.deepEqual(edge('right', [5]).actions, ['menu']);
  assert.deepEqual(edge('right', [1, 4], {squeeze: true, jump: true}).actions, [], 'held buttons do not repeat');
  assert.deepEqual(edge('right', [1, 5], {}, {hero: false}).actions, ['menu'], 'God role: only menu');
  assert.deepEqual(edge('right', [1, 5], {}, {active: false}).actions, []);
  // connect latch: game.js seeds state with active:false, so a button held through reconnect is not an edge.
  const latched = buttonActions(src('right', [5]), {}, {active: false}).state;
  assert.deepEqual(edge('right', [5], latched).actions, []);
});

// Mirrors the proposed game.js selectstart/selectend/disconnected wiring with the real weapon controller.
function rig(sources, {tool = 'wyrmspout', holding = false} = {}) {
  let now = 0;
  const log = [], panel = {pressed: null, consumeNext: false,
    handleSelectStart(i) { if (!this.consumeNext) return false; this.consumeNext = false; this.pressed = i; return true; },
    handleSelectEnd(i) { if (this.pressed !== i) return false; this.pressed = null; log.push(sources.has(i) ? 'panel-activate' : 'panel-clear'); return true; }};
  const r = {tool, holding, log, panel, sources, presses: createPressRouter(), tick: ms => { now += ms; r.weapons.tick(); }};
  let aim = {origin: [0, 1, 0], direction: [0, 0, -1]};
  r.setAim = d => { aim = {...aim, direction: d}; };
  r.weapons = createWeaponController({getTool: () => r.tool, getAim: () => aim, clock: () => now,
    fire: x => log.push(['fire', x]), emitFlame: () => log.push('flame'), pourFuel: () => log.push('pour'), special: () => log.push('special')});
  r.start = i => {
    if (panel.handleSelectStart(i)) { r.presses.begin(i, 'panel'); return; }
    const kind = triggerRole({tool: r.tool, hand: sources.get(i)?.handedness, sources, holding: r.holding});
    if (r.presses.begin(i, kind, r.tool)?.owner === 'primary') r.weapons.cancel();
    if (kind === 'throw') log.push('throw'); else if (kind === 'special') r.weapons.special(); else if (!r.weapons.begin()) r.weapons.special();
  };
  r.end = i => { const p = r.presses.end(i); if (p?.owner === 'panel') panel.handleSelectEnd(i); else if (p?.owner === 'primary') r.weapons.end(); };
  r.lose = i => { sources.delete(i); const p = r.presses.lose(i); if (p?.owner === 'primary') { r.weapons.cancel(); r.presses.invalidate(); } if (p?.owner === 'panel') panel.handleSelectEnd(i); };
  r.equip = next => { r.weapons.cancel(); r.presses.invalidate(); r.tool = next; };
  return r;
}
const fires = log => log.filter(e => Array.isArray(e) && e[0] === 'fire');

test('bow: right draws, left locks the curve, left release is inert, right release fires once', () => {
  const r = rig(new Map([[0, src('right')], [1, src('left')]]), {tool: 'bow'});
  r.start(0); r.tick(850); r.start(1); r.end(1);
  assert.equal(fires(r.log).length, 0, 'left release never fires');
  r.setAim([-.6, 0, -.8]); r.end(0);
  const [, shot] = fires(r.log)[0];
  assert.deepEqual(shot.direction, [0, 0, -1]); assert.ok(shot.curve[1] > .6); assert.equal(shot.draw, 1);
  r.end(0); assert.equal(fires(r.log).length, 1, 'duplicate selectend is inert');
});

test('single left controller: flame starts and stops on its own release (was stranded/unreachable)', () => {
  const r = rig(new Map([[1, src('left')]]));
  r.start(1); r.tick(110); r.tick(110);
  assert.ok(r.weapons.state().firing && r.log.filter(e => e === 'flame').length >= 2);
  r.end(1); const n = r.log.length; r.tick(300);
  assert.equal(r.weapons.state().firing, false); assert.equal(r.log.length, n, 'no flame after release');
});

test('flame cancel on controller loss; reconnect + late selectend never restarts or fires', () => {
  const sources = new Map([[0, src('right')], [1, src('left')]]);
  const r = rig(sources);
  r.start(0); r.tick(110); r.lose(0);
  assert.equal(r.weapons.state().firing, false);
  sources.set(0, src('right')); r.end(0); const n = r.log.length; r.tick(500);
  assert.equal(r.log.length, n);
  // Half-drawn bow lost with its controller: cancelled, never released as a shot.
  r.equip('bow'); r.start(0); r.tick(400); r.lose(0); r.end(0);
  assert.equal(fires(r.log).length, 0);
});

test('release after tool/role/menu change is inert; crossbow press fires exactly once', () => {
  const r = rig(new Map([[0, src('right')], [1, src('left')]]), {tool: 'bow'});
  r.start(0); r.tick(850); r.equip('crossbow'); r.end(0);
  assert.equal(fires(r.log).length, 0, 'bow drawn then cycled away does not fire the crossbow');
  r.start(0); assert.equal(fires(r.log).length, 1); r.end(0); assert.equal(fires(r.log).length, 1);
  r.equip('bow'); r.start(0); r.tick(300); r.presses.clear(); r.weapons.cancel(); r.end(0); // clearInput (role/session/blur)
  assert.equal(fires(r.log).length, 1);
});

test('wrist panel owns its press; stale panel press after controller loss cannot swallow a weapon release', () => {
  const sources = new Map([[0, src('right')], [1, src('left')]]);
  const r = rig(sources);
  r.panel.consumeNext = true; r.start(0); assert.equal(r.weapons.state().firing, false, 'panel press never attacks');
  r.lose(0); assert.equal(r.panel.pressed, null); assert.deepEqual(r.log, ['panel-clear'], 'lost panel press clears without activating');
  sources.set(0, src('right')); r.start(0); r.tick(110); assert.equal(r.weapons.state().firing, true);
  r.end(0); assert.equal(r.weapons.state().firing, false, 'old game.js: panel.handleSelectEnd consumed this release => flame stranded');
  r.panel.consumeNext = true; r.start(0); r.end(0); assert.equal(r.log.at(-1), 'panel-activate');
});

test('held log vs weapon arbitration: primary hand throws, never strikes; off hand keeps its role', () => {
  const r = rig(new Map([[0, src('right')], [1, src('left')]]), {tool: 'wyrmspout', holding: true});
  r.start(0); r.end(0);
  assert.deepEqual(r.log, ['throw']); assert.equal(r.weapons.state().firing, false);
  r.start(1); r.end(1); assert.equal(r.log.at(-1), 'special');
});

test('router invalidation keeps panel ownership; clear returns every open press', () => {
  const p = createPressRouter();
  p.begin(0, 'panel'); p.begin(1, 'primary', 'bow'); p.invalidate();
  assert.equal(p.owners().get(0).owner, 'panel'); assert.equal(p.owners().get(1).owner, 'inert');
  p.owners().get(1).owner = 'primary'; assert.equal(p.owners().get(1).owner, 'inert', 'owners() is a copy');
  assert.equal(p.clear().length, 2); assert.equal(p.end(1), null);
});

test('haptics: exact local weapon hand, and a missing actuator is counted, not thrown', () => {
  const pulses = [];
  const left = src('left'); left.gamepad.hapticActuators = [{pulse: (a, d) => { pulses.push(['left', a, d]); return Promise.resolve(true); }}];
  const right = src('right'); // no actuator
  const sources = new Map([[0, right], [1, left]]);
  const hand = weaponMount('bow', sources).hand;
  const feedback = createContactFeedback({sources: () => sources.values(), playerId: () => 'p1', tool: () => 'bow', weaponHand: () => hand, presenting: () => true});
  assert.doesNotThrow(() => feedback.release('bow'));
  assert.ok(pulses.length >= 1 && pulses.every(p => p[0] === 'left'));
  assert.ok(feedback.stats().noActuator >= 1, 'the draw-hand string pulse has no actuator and is counted');
});

test('proposed game.js routes through the policy (source wiring guard)', () => {
  const game = readFileSync(new URL('../client/game.js', import.meta.url), 'utf8');
  assert.match(game, /const press=presses\.end\(i\);if\(press\?\.owner==='panel'\)adventurePanel\.handleSelectEnd\(i\);else if\(press\?\.owner==='primary'\)primaryUp\(\);/);
  assert.match(game, /presses\.lose\(i\)/);
  assert.match(game, /aimIndex\(\{purpose:/);
  assert.match(game, /moveIndexes\(controllerSources\)/);
  assert.doesNotMatch(game, /\?\.\[0\]\?\?0;controllers\[index\]/, 'blind index-0 aim removed');
  assert.doesNotMatch(game, /handedness!=='left'\)primaryUp/, 'hand-based release dropping removed');
});
