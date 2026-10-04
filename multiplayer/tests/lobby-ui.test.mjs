// Unit tests for ui/lobby-ui.js — node:test + built-in EventTarget fakes (no jsdom).
import test from 'node:test';
import assert from 'node:assert/strict';
import {knownErrorText, detectControlScheme, describeVr, normalizeObjective, renderObjective,
  bindObjectiveActions, bindConnectivity, releaseFocusAfterPointer, bindControlsCard, ONBOARD_KEY} from '../lobby-ui.js';

// ---- minimal fake DOM ----
class El extends EventTarget {
  constructor(id, tag = 'div') { super(); this.id = id; this.tag = tag; this.textContent = ''; this.hidden = false; this.attrs = {}; this.dataset = {}; this.style = {}; this.children = []; this.parentElement = null; this.blurred = 0; this.focused = 0; }
  setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return this.attrs[k] ?? null; }
  blur() { this.blurred++; } focus() { this.focused++; } getClientRects() { return this.hidden ? [] : [1]; }
  closest(sel) { return sel === 'label' ? this.label || null : null; }
  append(child) { child.parentElement?.children.splice(child.parentElement.children.indexOf(child), 1); child.parentElement = this; this.children.push(child); }
  after(child) { this.parentElement.append(child); }
  querySelectorAll(sel) { const out = []; const walk = n => { for (const c of n.children) { if (sel === '[data-controls-tab]' ? 'controlsTab' in c.dataset : sel === '[data-controls-panel]' ? 'controlsPanel' in c.dataset : false) out.push(c); walk(c); } }; walk(this); return out; }
}
function fakeDoc(ids) {
  const map = Object.fromEntries(ids.map(id => [id, new El(id)]));
  const body = new El('body'); body.classList = {set: new Set(), toggle(c, on) { on ? this.set.add(c) : this.set.delete(c); }, remove(c) { this.set.delete(c); }};
  return {map, body, getElementById: id => map[id] || null, querySelector: () => null};
}
const objectiveIds = ['objectiveBanner', 'objectiveTitle', 'objectivePhase', 'objectiveText', 'objectiveProgress', 'objectiveProgressFill', 'objectiveProgressText', 'objectiveStart', 'objectiveRestart'];

test('knownErrorText distinguishes server_full from room_full and falls through for unknown codes', () => {
  assert.match(knownErrorText('room_full'), /no free player slots.*Choose another world/);
  assert.match(knownErrorText('SERVER_FULL'), /as many worlds/);
  assert.doesNotMatch(knownErrorText('server_full'), /eight players/);
  assert.match(knownErrorText('invalid_token'), /rejoin pass/i);
  assert.equal(knownErrorText('inventory_full'), null);
  assert.equal(knownErrorText(''), null);
  assert.equal(knownErrorText('__proto__'), null);
});

test('detectControlScheme honours XR, explicit touch mode, then device', () => {
  assert.equal(detectControlScheme({xrPresenting: true, touchMode: 'on'}), 'vr');
  assert.equal(detectControlScheme({touchMode: 'on'}), 'touch');
  assert.equal(detectControlScheme({touchMode: 'off', coarse: true, maxTouchPoints: 5}), 'desktop');
  assert.equal(detectControlScheme({coarse: true}), 'touch');
  assert.equal(detectControlScheme({maxTouchPoints: 10}), 'touch');
  assert.equal(detectControlScheme(), 'desktop');
});

test('describeVr explains pending, ready, god role, insecure and unsupported', () => {
  assert.match(describeVr({supported: null}), /Checking/);
  assert.match(describeVr({supported: true, role: 'hero'}), /Enter VR/);
  assert.match(describeVr({supported: true, role: 'god'}), /Switch to Hero/);
  assert.match(describeVr({supported: false, secure: false}), /https/);
  assert.match(describeVr({supported: false, secure: true}), /No VR headset/);
});

test('normalizeObjective accepts only the agreed contract and invents nothing', () => {
  assert.deepEqual(normalizeObjective(null), {visible: false});
  assert.equal(normalizeObjective({}).visible, false);
  const a = normalizeObjective({title: ' Ember  Road ', objective: 'Reach the shrine', progress: 0.426, phase: 'active', canStart: 'yes', canRestart: true});
  assert.equal(a.title, 'Ember Road'); assert.equal(a.phaseLabel, 'Under way'); assert.equal(a.progressText, '43%');
  assert.equal(a.canStart, false, 'only literal true enables Start'); assert.equal(a.canRestart, true);
  assert.equal(normalizeObjective({title: 't', progress: 7}).fraction, 1);
  assert.equal(normalizeObjective({title: 't', progress: -1}).fraction, 0);
  const b = normalizeObjective({title: 't', progress: {current: 3, total: 5}});
  assert.equal(b.progressText, '3 / 5'); assert.equal(b.fraction, 0.6);
  assert.equal(normalizeObjective({title: 't', progress: {current: 1, total: 0}}).fraction, null);
  assert.equal(normalizeObjective({title: 't', progress: NaN}).fraction, null);
  assert.equal(normalizeObjective({title: 't', phase: 'scouting'}).phaseLabel, 'Scouting');
  assert.equal(normalizeObjective({title: 'x'.repeat(200)}).title.length, 48);
});

test('renderObjective fills, hides progress/buttons, and hides on null', () => {
  const doc = fakeDoc(objectiveIds);
  const wrap = new El('wrap'); wrap.append(doc.map.objectiveProgress);
  renderObjective(doc, {title: 'Ember Road', objective: 'Light 3 beacons', progress: {current: 1, total: 3}, phase: 'active', canStart: false, canRestart: true});
  assert.equal(doc.map.objectiveBanner.hidden, false);
  assert.equal(doc.map.objectiveBanner.dataset.phase, 'active');
  assert.equal(doc.map.objectiveText.textContent, 'Light 3 beacons');
  assert.equal(doc.map.objectiveProgress.getAttribute('aria-valuenow'), '33');
  assert.equal(doc.map.objectiveProgressFill.style.transform, `scaleX(${1 / 3})`);
  assert.equal(wrap.hidden, false);
  assert.equal(doc.map.objectiveStart.hidden, true); assert.equal(doc.map.objectiveRestart.hidden, false);
  renderObjective(doc, {title: 'Ember Road', objective: 'Wait'});
  assert.equal(wrap.hidden, true, 'no progress -> bar hidden');
  renderObjective(doc, null);
  assert.equal(doc.map.objectiveBanner.hidden, true);
  assert.equal(renderObjective({getElementById: () => null}, {title: 'x'}), null, 'missing banner is a no-op');
});

test('bindObjectiveActions forwards clicks only, and disposes', () => {
  const doc = fakeDoc(objectiveIds); let starts = 0, restarts = 0;
  const dispose = bindObjectiveActions(doc, {onStart: () => starts++, onRestart: () => restarts++});
  doc.map.objectiveStart.dispatchEvent(new Event('click'));
  doc.map.objectiveRestart.dispatchEvent(new Event('click'));
  assert.deepEqual([starts, restarts], [1, 1]);
  assert.equal(doc.map.objectiveStart.blurred, 1, 'button releases focus so game keys keep working');
  dispose(); doc.map.objectiveStart.dispatchEvent(new Event('click'));
  assert.equal(starts, 1);
});

test('bindConnectivity toggles the offline note from online/offline events', () => {
  const doc = fakeDoc(['offlineNote']); const win = new EventTarget(); win.navigator = {onLine: true};
  const dispose = bindConnectivity(doc, win);
  assert.equal(doc.map.offlineNote.hidden, true);
  win.navigator.onLine = false; win.dispatchEvent(new Event('offline'));
  assert.equal(doc.map.offlineNote.hidden, false);
  win.navigator.onLine = true; win.dispatchEvent(new Event('online'));
  assert.equal(doc.map.offlineNote.hidden, true);
  dispose(); win.navigator.onLine = false; win.dispatchEvent(new Event('offline'));
  assert.equal(doc.map.offlineNote.hidden, true, 'disposed listener no longer updates');
});

test('releaseFocusAfterPointer blurs after pointer toggles but not keyboard toggles', () => {
  const input = new El('quickCast', 'input'); const label = new El('label', 'label'); input.label = label;
  const dispose = releaseFocusAfterPointer(input);
  label.dispatchEvent(new Event('pointerdown')); input.dispatchEvent(new Event('change'));
  assert.equal(input.blurred, 1);
  input.dispatchEvent(new Event('keydown')); input.dispatchEvent(new Event('change'));
  assert.equal(input.blurred, 1, 'keyboard users keep focus');
  label.dispatchEvent(new Event('pointerdown')); input.dispatchEvent(new Event('keydown')); input.dispatchEvent(new Event('change'));
  assert.equal(input.blurred, 1, 'a keydown after pointerdown counts as keyboard');
  dispose();
});

test('bindControlsCard opens in the requested host, picks the device panel, marks onboarding done', () => {
  const ids = ['controlsCard', 'howToPlay', 'menuControls', 'controlsClose', 'controlsDone', 'controlsTitle'];
  const doc = fakeDoc(ids); const lobbyCard = new El('lobbyCard'), menuCard = new El('menuCard');
  doc.querySelector = sel => sel === '#lobby .card' ? lobbyCard : sel === '#menu .menu-card' ? menuCard : null;
  const card = doc.map.controlsCard; card.hidden = true;
  const tabs = ['desktop', 'touch', 'vr'].map(k => { const t = new El('tab-' + k); t.dataset.controlsTab = k; card.append(t); return t; });
  const panels = ['desktop', 'touch', 'vr'].map(k => { const p = new El('panel-' + k); p.dataset.controlsPanel = k; card.append(p); return p; });
  lobbyCard.append(doc.map.howToPlay); menuCard.append(doc.map.menuControls);
  const saved = new Map(); const store = {get: k => saved.get(k) || '', set: (k, v) => saved.set(k, v)};
  const ui = bindControlsCard(doc, {store, scheme: () => 'touch', role: () => 'god'});
  assert.equal(doc.body.classList.set.has('first-play'), true);
  doc.map.howToPlay.dispatchEvent(new Event('click'));
  assert.equal(card.hidden, false); assert.equal(card.parentElement, lobbyCard);
  assert.equal(card.dataset.activeRole, 'god');
  assert.deepEqual(panels.map(p => p.hidden), [true, false, true]);
  assert.equal(tabs[1].getAttribute('aria-pressed'), 'true');
  assert.equal(doc.map.howToPlay.getAttribute('aria-expanded'), 'true');
  doc.map.controlsDone.dispatchEvent(new Event('click'));
  assert.equal(card.hidden, true); assert.equal(saved.get(ONBOARD_KEY), '1');
  assert.equal(doc.body.classList.set.has('first-play'), false);
  doc.map.menuControls.dispatchEvent(new Event('click'));
  assert.equal(card.parentElement, menuCard, 'moved (not cloned) into the menu dialog');
  doc.map.menuControls.dispatchEvent(new Event('click'));
  assert.equal(card.hidden, true, 'trigger toggles closed');
  ui.dispose();
});
