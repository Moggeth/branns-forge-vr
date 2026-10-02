// Pure + mock-XR tests for client/vr-adventure-panel.js.
// Run: node --test multiplayer/tests/vr-adventure-panel.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {FIXTURES} from './vr-adventure-fixtures.mjs';
import {adventureView} from '../shared/adventure.js';
import {PANEL, GATE, carried, deliverable, nextStep, layoutButtons, heroPanelModel, hitButton, toCanvas, drawHeroPanel, createVRAdventurePanel} from '../client/vr-adventure-panel.js';

// ---- mock canvas: records 2D calls so draws are countable without a browser
function mockCanvas() {
  const calls = [];
  const ctx = new Proxy({}, {get: (t, k) => k in t ? t[k] : (t[k] = (...a) => { calls.push([k, ...a]); }), set: (t, k, v) => { t[k] = v; return true; }});
  return {width: PANEL.px, height: PANEL.py, calls, getContext: () => ctx};
}
// ---- mock XR contract: renderer.xr target-ray/grip spaces are Groups; sources are XRInputSource-shaped
function xrSource(handedness) {
  const pulses = [];
  return {handedness, targetRayMode: 'tracked-pointer', gripSpace: {}, profiles: ['oculus-touch-v3'], pulses,
    gamepad: {buttons: Array.from({length: 7}, () => ({pressed: false, touched: false, value: 0})), axes: [0, 0, 0, 0],
      hapticActuators: [{pulse: (s, ms) => { pulses.push([s, ms]); return Promise.resolve(true); }}]}};
}
function rigFixture({pointerHand = 'right', name = 'camp', clock} = {}) {
  const scene = new THREE.Scene(), rig = new THREE.Group(); scene.add(rig);
  const controllers = [new THREE.Group(), new THREE.Group()], grips = [new THREE.Group(), new THREE.Group()];
  for (let i = 0; i < 2; i++) rig.add(controllers[i], grips[i]);
  const sources = new Map([[0, xrSource('left')], [1, xrSource('right')]]);
  const head = new THREE.PerspectiveCamera(); rig.add(head);
  const actions = [], time = clock || {t: 1000};
  const panel = createVRAdventurePanel({parent: scene, controllers, grips, sources, onAction: a => actions.push(a), pointerHand, createCanvas: mockCanvas, now: () => time.t});
  const f = FIXTURES[name]();
  panel.update(f.view, f.snapshot, f.playerId);
  return {scene, rig, controllers, grips, sources, head, panel, actions, time, f};
}
const look = (obj, eye, target) => { obj.position.copy(eye); obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, target, new THREE.Vector3(0, 1, 0))); obj.updateMatrixWorld(true); };
// Watch pose: head pitched down 30 deg; panel-hand controller across the chest pointing sideways (not aimed).
function watchPose(r, panelIndex = 0) {
  r.head.position.set(0, 1.6, 0); r.head.rotation.set(-Math.PI / 6, 0, 0, 'YXZ'); r.head.updateMatrixWorld(true);
  const g = r.grips[panelIndex], c = r.controllers[panelIndex];
  for (const o of [g, c]) { o.position.set(panelIndex === 0 ? -.05 : .05, 1.25, -.35); o.rotation.set(0, panelIndex === 0 ? -Math.PI / 2 : Math.PI / 2, 0); o.updateMatrixWorld(true); }
}
function buttonWorld(panel, id) {
  const b = panel.state().model.buttons.find(b => b.id === id);
  const x = ((b.x + b.w / 2) / PANEL.px - .5) * PANEL.width, y = (.5 - (b.y + b.h / 2) / PANEL.py) * PANEL.height;
  return panel.mesh.localToWorld(new THREE.Vector3(x, y, 0));
}
function pointAt(r, pointerIndex, target) { look(r.controllers[pointerIndex], new THREE.Vector3(pointerIndex === 1 ? .18 : -.18, 1.2, -.12), target); }
// The patched game.js selectstart/selectend contract, wired on real EventDispatchers in the same order as the patch.
function gameHandlers(r) {
  const fired = [];
  r.controllers.forEach((c, i) => {
    c.addEventListener('selectstart', () => { if (r.panel.handleSelectStart(i)) return; fired.push(['primaryDown', i]); });
    c.addEventListener('selectend', () => { if (r.panel.handleSelectEnd(i)) return; fired.push(['primaryUp', i]); });
  });
  return fired;
}

// ---------------------------------------------------------------- pure
test('view model: carried resources, deliverable kinds and next step mirror lobby semantics', () => {
  const camp = FIXTURES.camp();
  const held = carried(camp.snapshot, 'p1');
  assert.deepEqual(held, {wood: 3, stone: 0, gems: 0});
  assert.deepEqual(deliverable('camp', held), ['wood']);
  assert.deepEqual(deliverable('star', held), []);
  assert.deepEqual(deliverable('rekindle', {wood: 1, stone: 0, gems: 2}), ['wood', 'gems']);
  assert.equal(nextStep(camp.view, held), 'Deliver what you carry at the forge');
  const empty = FIXTURES.campEmpty();
  assert.equal(nextStep(empty.view, carried(empty.snapshot, 'p1')), 'Chop timber (3 more) and bring it back');
  assert.equal(nextStep(FIXTURES.star().view, {}), 'Defeat the star guardians');
  assert.match(nextStep(FIXTURES.rekindle().view, {}), /wave 2\/3/);
  assert.match(nextStep(FIXTURES.defeat().view, {}), /Retry \(2 left\)/);
});

test('buttons: hero-only contextual set, at most three, leave last', () => {
  const ids = name => { const f = FIXTURES[name](); return heroPanelModel(f.view, carried(f.snapshot, 'p1')).buttons.map(b => b.id); };
  assert.deepEqual(ids('idle'), ['start']);
  assert.deepEqual(ids('camp'), ['deposit', 'leave']);
  assert.deepEqual(ids('rekindle'), ['deposit', 'leave']);
  assert.deepEqual(ids('defeat'), ['rematch', 'retry', 'leave']);
  const f = FIXTURES.camp(); f.snapshot.players[0].role = 'god';
  const godView = adventureView(f.adv, f.snapshot, 'p1');
  assert.ok(godView.actions.includes('tithe'));
  assert.deepEqual(heroPanelModel(godView, {}).buttons.map(b => b.id), ['leave'], 'God mana actions are not offered on the Hero panel');
  const e = FIXTURES.campEmpty();
  assert.equal(heroPanelModel(e.view, carried(e.snapshot, 'p1')).buttons[0].enabled, false);
  for (const n of [1, 2, 3]) for (const b of layoutButtons(['a', 'b', 'c'].slice(0, n))) {
    assert.ok(b.x >= 14 && b.x + b.w <= PANEL.px - 13 && b.y + b.h <= PANEL.py - 8);
    assert.ok(b.h / PANEL.py * PANEL.height >= .03, 'button at least 3 cm tall');
  }
});

test('hit-test respects button bounds and padding; canvas mapping covers panel corners', () => {
  const [a, b] = layoutButtons(['deposit', 'leave']);
  assert.equal(hitButton([a, b], a.x + 1, a.y + 1).id, 'deposit');
  assert.equal(hitButton([a, b], a.x - 4, a.y).id, 'deposit');
  assert.equal(hitButton([a, b], a.x - 5, a.y), null);
  assert.equal(hitButton([a, b], b.x + b.w / 2, b.y + b.h + 5), null);
  assert.equal(hitButton([a, b], (a.x + a.w + b.x) / 2, a.y + 10), null, 'gap between buttons is dead space');
  assert.deepEqual(toCanvas(-PANEL.width / 2, PANEL.height / 2), {u: 0, v: 0});
  assert.deepEqual(toCanvas(PANEL.width / 2, -PANEL.height / 2), {u: PANEL.px, v: PANEL.py});
});

test('drawHeroPanel issues one bounded paint per call and draws every button label', () => {
  const c = mockCanvas(), f = FIXTURES.defeat();
  drawHeroPanel(c.getContext('2d'), heroPanelModel(f.view, {}));
  const texts = c.calls.filter(([k]) => k === 'fillText').map(x => x[1]);
  for (const label of ['Rematch', 'Retry stand', 'Leave', 'The Forge Went Dark']) assert.ok(texts.includes(label), label);
  assert.ok(c.calls.length < 200);
});

// ---------------------------------------------------------------- mock XR transforms and interaction
test('wrist anchor: shown in watch pose, faces the head, hidden when aiming forward or out of view (with hysteresis)', () => {
  const r = rigFixture(); watchPose(r);
  r.panel.tick(r.head);
  assert.equal(r.panel.state().shown, true);
  const gripPos = r.grips[0].getWorldPosition(new THREE.Vector3());
  assert.ok(r.panel.mesh.position.distanceTo(gripPos.clone().add(new THREE.Vector3(0, GATE.lift, 0))) < 1e-6);
  const normal = new THREE.Vector3(0, 0, 1).transformDirection(r.panel.mesh.matrixWorld);
  const toHead = r.head.getWorldPosition(new THREE.Vector3()).sub(r.panel.mesh.position);
  const distance = toHead.length();
  assert.ok(normal.dot(toHead.normalize()) > .999, 'panel faces the head');
  assert.ok(distance > .35 && distance < .6, `arm distance ${distance}`);
  // Bow/aim posture: panel hand pointing where the head looks -> hidden.
  r.grips[0].rotation.set(-Math.PI / 6, 0, 0); r.grips[0].updateMatrixWorld(true); r.panel.tick(r.head);
  assert.equal(r.panel.state().shown, false);
  // Hysteresis: ~32 deg off-axis does not show from hidden, but keeps a shown panel.
  watchPose(r); r.head.rotation.set(-Math.PI / 6, THREE.MathUtils.degToRad(-30), 0, 'YXZ'); r.head.updateMatrixWorld(true);
  r.panel.tick(r.head); const offAxisHidden = r.panel.state().shown;
  watchPose(r); r.panel.tick(r.head); r.head.rotation.set(-Math.PI / 6, THREE.MathUtils.degToRad(-30), 0, 'YXZ'); r.head.updateMatrixWorld(true); r.panel.tick(r.head);
  assert.equal(offAxisHidden, false); assert.equal(r.panel.state().shown, true);
  r.panel.tick(r.head, {suppressed: true}); assert.equal(r.panel.state().shown, false);
});

test('trigger on a button is consumed (no weapon press) and activates once on release over the same button', () => {
  const r = rigFixture(), fired = gameHandlers(r); watchPose(r); r.panel.tick(r.head);
  pointAt(r, 1, buttonWorld(r.panel, 'deposit')); r.panel.tick(r.head);
  assert.equal(r.panel.state().hover, 'deposit');
  assert.ok(r.sources.get(1).pulses.length >= 1, 'hover haptic on pointer hand');
  r.controllers[1].dispatchEvent({type: 'selectstart'});
  assert.equal(r.panel.state().pressed.button, 'deposit');
  r.controllers[1].dispatchEvent({type: 'selectend'});
  assert.deepEqual(fired, [], 'weapon never saw the press or release');
  assert.deepEqual(r.actions, ['deposit']);
  // Immediate repeat is debounced; after repeatMs it sends again.
  r.controllers[1].dispatchEvent({type: 'selectstart'}); r.controllers[1].dispatchEvent({type: 'selectend'});
  assert.deepEqual(r.actions, ['deposit']);
  r.time.t += GATE.repeatMs + 1; r.controllers[1].dispatchEvent({type: 'selectstart'}); r.controllers[1].dispatchEvent({type: 'selectend'});
  assert.deepEqual(r.actions, ['deposit', 'deposit']);
});

test('presses off the panel, from the panel hand, or while hidden still reach the game', () => {
  const r = rigFixture(), fired = gameHandlers(r); watchPose(r); r.panel.tick(r.head);
  pointAt(r, 1, new THREE.Vector3(0, 0, -10)); r.panel.tick(r.head);
  r.controllers[1].dispatchEvent({type: 'selectstart'}); r.controllers[1].dispatchEvent({type: 'selectend'});
  r.controllers[0].dispatchEvent({type: 'selectstart'}); r.controllers[0].dispatchEvent({type: 'selectend'});
  assert.deepEqual(fired, [['primaryDown', 1], ['primaryUp', 1], ['primaryDown', 0], ['primaryUp', 0]]);
  // Bow draw that starts off-panel and releases over the panel must still fire (pairing follows the start).
  fired.length = 0; r.controllers[1].dispatchEvent({type: 'selectstart'});
  pointAt(r, 1, buttonWorld(r.panel, 'deposit')); r.panel.tick(r.head); r.controllers[1].dispatchEvent({type: 'selectend'});
  assert.deepEqual(fired, [['primaryDown', 1], ['primaryUp', 1]]); assert.deepEqual(r.actions, []);
  // Hidden panel never consumes even if the ray geometry would cross its last pose.
  r.panel.tick(r.head, {suppressed: true}); fired.length = 0;
  r.controllers[1].dispatchEvent({type: 'selectstart'}); assert.deepEqual(fired, [['primaryDown', 1]]);
});

test('press on button, drag off, release: consumed but no action; panel body press is consumed without action', () => {
  const r = rigFixture(), fired = gameHandlers(r); watchPose(r); r.panel.tick(r.head);
  pointAt(r, 1, buttonWorld(r.panel, 'deposit')); r.panel.tick(r.head);
  r.controllers[1].dispatchEvent({type: 'selectstart'});
  pointAt(r, 1, new THREE.Vector3(0, 0, -10)); r.panel.tick(r.head);
  r.controllers[1].dispatchEvent({type: 'selectend'});
  const centre = r.panel.mesh.localToWorld(new THREE.Vector3(0, .03, 0));
  pointAt(r, 1, centre); r.panel.tick(r.head);
  assert.equal(r.panel.state().onPanel, true); assert.equal(r.panel.state().hover, null);
  r.controllers[1].dispatchEvent({type: 'selectstart'}); r.controllers[1].dispatchEvent({type: 'selectend'});
  assert.deepEqual(fired, []); assert.deepEqual(r.actions, []);
});

test('leave needs an intentional second press on a different button, expires, and can be cancelled', () => {
  const r = rigFixture(); gameHandlers(r); watchPose(r); r.panel.tick(r.head);
  const press = id => { pointAt(r, 1, buttonWorld(r.panel, id)); r.panel.tick(r.head); r.controllers[1].dispatchEvent({type: 'selectstart'}); r.controllers[1].dispatchEvent({type: 'selectend'}); r.panel.tick(r.head); };
  press('leave');
  assert.equal(r.panel.state().confirmLeave, true); assert.deepEqual(r.actions, []);
  assert.deepEqual(r.panel.state().model.buttons.map(b => b.id), ['confirm', 'cancel']);
  const leaveSlot = layoutButtons(['deposit', 'leave'])[1], confirmSlot = r.panel.state().model.buttons[0];
  assert.ok(confirmSlot.x + confirmSlot.w < leaveSlot.x, 'confirm is not under the original Leave position');
  press('confirm'); assert.deepEqual(r.actions, [], 'too-fast double press ignored');
  r.time.t += GATE.confirmMinMs; press('confirm'); assert.deepEqual(r.actions, ['leave']);
  press('leave'); press('cancel'); assert.equal(r.panel.state().confirmLeave, false);
  press('leave'); r.time.t += GATE.confirmMs + 1; r.panel.tick(r.head);
  assert.equal(r.panel.state().confirmLeave, false); assert.deepEqual(r.actions, ['leave']);
});

test('deliver with nothing carried shows an in-panel hint instead of sending (DOM toast is invisible in XR)', () => {
  const r = rigFixture({name: 'campEmpty'}); gameHandlers(r); watchPose(r); r.panel.tick(r.head);
  pointAt(r, 1, buttonWorld(r.panel, 'deposit')); r.panel.tick(r.head);
  assert.equal(r.panel.state().hover, null, 'disabled button does not highlight');
  r.controllers[1].dispatchEvent({type: 'selectstart'}); r.controllers[1].dispatchEvent({type: 'selectend'});
  assert.deepEqual(r.actions, []); assert.match(r.panel.state().hint, /Gather timber or stone/);
  r.time.t += GATE.hintMs + 1; r.panel.tick(r.head); assert.equal(r.panel.state().hint, null);
});

test('left-handed: panel on the right wrist, left ray operates, right trigger stays with the game', () => {
  const r = rigFixture({pointerHand: 'left'}), fired = gameHandlers(r); watchPose(r, 1); r.panel.tick(r.head);
  assert.equal(r.panel.state().shown, true);
  assert.ok(r.panel.mesh.position.x > 0);
  pointAt(r, 0, buttonWorld(r.panel, 'deposit')); r.panel.tick(r.head);
  r.controllers[0].dispatchEvent({type: 'selectstart'}); r.controllers[0].dispatchEvent({type: 'selectend'});
  r.controllers[1].dispatchEvent({type: 'selectstart'}); r.controllers[1].dispatchEvent({type: 'selectend'});
  assert.deepEqual(r.actions, ['deposit']); assert.deepEqual(fired, [['primaryDown', 1], ['primaryUp', 1]]);
  r.panel.setPointerHand('right'); assert.equal(r.panel.state().pointerHand, 'right'); assert.equal(r.panel.state().shown, false);
});

test('redraw economy: unchanged view and idle frames do not repaint; real changes do', () => {
  const r = rigFixture(); watchPose(r);
  const base = r.panel.state().redraws;
  assert.equal(r.panel.update(r.f.view, r.f.snapshot, 'p1'), false);
  for (let i = 0; i < 30; i++) r.panel.tick(r.head);
  assert.equal(r.panel.state().redraws, base);
  const later = FIXTURES.camp(); later.adv.elapsed += 60; const v = adventureView(later.adv, later.snapshot, 'p1');
  assert.equal(r.panel.update(v, later.snapshot, 'p1'), true);
  later.snapshot.players[0].resources.stone = 2;
  assert.equal(r.panel.update(v, later.snapshot, 'p1'), true, 'carried resources are part of the drawn model');
  assert.equal(r.panel.state().redraws, base + 2);
});

test('bounded draws and no world targets: panel + cursor only, both ignored by world raycasts', () => {
  const r = rigFixture(); watchPose(r); r.panel.tick(r.head);
  const meshes = []; r.panel.mesh.traverse(o => o.isMesh && meshes.push(o));
  assert.equal(meshes.length, 2);
  const hits = new THREE.Raycaster(r.head.getWorldPosition(new THREE.Vector3()), r.panel.mesh.position.clone().sub(r.head.getWorldPosition(new THREE.Vector3())).normalize()).intersectObject(r.scene, true);
  assert.equal(hits.length, 0);
  assert.equal(r.panel.mesh.material.map.isCanvasTexture, true);
});

test('session lifecycle: controller loss hides, endSession clears press/confirm, dispose is idempotent', () => {
  const r = rigFixture(); gameHandlers(r); watchPose(r); r.panel.tick(r.head);
  pointAt(r, 1, buttonWorld(r.panel, 'leave')); r.panel.tick(r.head);
  r.controllers[1].dispatchEvent({type: 'selectstart'}); r.controllers[1].dispatchEvent({type: 'selectend'});
  assert.equal(r.panel.state().confirmLeave, true);
  r.sources.delete(0); r.panel.tick(r.head); assert.equal(r.panel.state().shown, false);
  r.sources.set(0, xrSource('left')); r.panel.tick(r.head); assert.equal(r.panel.state().shown, true);
  r.controllers[1].dispatchEvent({type: 'selectstart'});
  r.panel.endSession();
  assert.equal(r.panel.state().shown, false); assert.equal(r.panel.state().pressed, null); assert.equal(r.panel.state().confirmLeave, false);
  assert.equal(r.panel.handleSelectEnd(1), false, 'no stale consumption after session end');
  r.panel.update(null); assert.equal(r.panel.state().shown, false);
  r.panel.dispose(); r.panel.dispose();
  assert.equal(r.panel.mesh.parent, null);
  assert.equal(r.panel.update(r.f.view, r.f.snapshot, 'p1'), false);
  r.panel.tick(r.head); assert.equal(r.panel.handleSelectStart(1), false);
});

// ---------------------------------------------------------------- actual runtime wiring contract
test('runtime wiring: panel guard runs first and lobby mirrors expeditionAction', async () => {
  const fs = await import('node:fs');
  const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const game = read('../client/game.js'), lobby = read('../lobby.js');
  assert.match(game, /'selectstart', \(\) => \{\n\s+if \(adventurePanel\.handleSelectStart\(i\)\) return;\n\s+if \(!active\) return;/);
  assert.match(game, /'selectend',\(\)=>\{if\(adventurePanel\.handleSelectEnd\(i\)\)return;/);
  assert.match(game, /movement\(\);\n\s+if \(renderer\.xr\.isPresenting\) adventurePanel\.tick\(renderer\.xr\.getCamera\(\), \{suppressed: !active \|\| role !== 'hero'\}\);/);
  assert.match(game, /'sessionend', \(\) => \{ clearInput\(\); adventurePanel\.endSession\(\);/);
  const panelSource = read('../client/vr-adventure-panel.js');
  assert.doesNotMatch(panelSource, /buttons\[|addEventListener|querySelector|getElementById/, 'panel reads no gamepad buttons and no DOM');
  assert.match(lobby, /onExpeditionAction: expeditionAction/);
  assert.match(lobby, /if \(xrActive\) game\.setExpedition\(view, snapshot, playerId\);/);
});
