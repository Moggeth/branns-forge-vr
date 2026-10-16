// Expedition Roguelite on the VR wrist panel: each stage gets readable rows and at most three trigger buttons, and
// every button maps to a valid run command.
import assert from 'node:assert/strict';
import {runWristView, runVrAction} from '../client/run-vr.js';
import {heroPanelModel, layoutButtons} from '../client/vr-adventure-panel.js';
import {createRun} from '../shared/expedition-run.js';

const sites = Array.from({length: 40}, (_, i) => [Math.cos(i * 2.4) * (12 + i * 1.1), Math.sin(i * 2.4) * (12 + i * 1.1)]);
const run = createRun({seed: 777, camp: [0, 0], sites, bound: 60});
const hero = {id: 'p1', role: 'hero', name: 'Mitch', resources: {}}, snap = {run, players: [hero], enemies: []};
const check = (view, stage) => {
  assert.equal(view.stage, stage);
  assert.ok(view.buttons.length <= 3 && view.objectives.length <= 3);
  for (const b of view.buttons) assert.ok(runVrAction(b.id), `button ${b.id} maps to a command`);
  const model = heroPanelModel(view, {});
  assert.equal(model.buttons.length, view.buttons.length);
  assert.deepEqual(model.buttons.map(b => b.id), view.buttons.map(b => b.id));
  assert.ok(model.next && model.title);
  return view;
};
let v = check(runWristView(snap, 'p1'), 'camp');
assert.deepEqual(runVrAction(v.buttons[0].id), {action: 'kit', payload: {kit: 'woodcutter'}});
assert.deepEqual(runVrAction('run:begin:'), {action: 'begin', payload: {}});
run.kits.p1 = 'woodcutter';
assert.equal(runVrAction(runWristView(snap, 'p1').buttons[0].id).payload.kit, 'prospector', 'the kit button cycles');
run.stage = 'route';
v = check(runWristView(snap, 'p1'), 'route');
assert.equal(v.buttons.length, 3); assert.equal(runVrAction(v.buttons[1].id).action, 'route');
run.stage = 'reward'; run.at = 'n00'; run.offers.p1 = ['ironhide', 'keen', 'fleet'];
v = check(runWristView(snap, 'p1'), 'reward');
assert.deepEqual(runVrAction(v.buttons[2].id), {action: 'boon', payload: {boon: 'fleet'}});
run.picks.p1 = 'keen'; assert.equal(runWristView(snap, 'p1').buttons.length, 0, 'no buttons once picked');
// The Wandering Smith: affordable wares (cheapest first) plus Keep Embers, and nothing once bought or skipped.
run.picks = {}; run.nodes.find(n => n.id === 'n00').kind = 'trader'; run.haul = 40; run.offers.p1 = ['ironhide', 'keen', 'fleet'];
v = check(runWristView(snap, 'p1'), 'reward');
assert.equal(v.buttons.at(-1).id, 'run:skip:'); assert.deepEqual(runVrAction('run:skip:'), {action: 'skip', payload: {}});
assert.ok(v.buttons.length >= 1 && v.buttons.length <= 3);
run.haul = 0; assert.deepEqual(runWristView(snap, 'p1').buttons.map(b => b.id), ['run:skip:'], 'nothing affordable: only Keep Embers');
run.picks.p1 = 'skip'; assert.equal(runWristView(snap, 'p1').buttons.length, 0); assert.match(runWristView(snap, 'p1').nextStep, /Kept your Embers/);
run.nodes.find(n => n.id === 'n00').kind = 'skirmish';
run.stage = 'decide'; v = check(runWristView(snap, 'p1'), 'decide');
assert.deepEqual(v.buttons.map(b => runVrAction(b.id).payload.choice), ['return', 'push']);
run.stage = 'won'; run.result = {outcome: 'won', banked: 400, kills: 30, path: ['n00', 'n10', 'n20', 'heart']};
assert.deepEqual(check(runWristView(snap, 'p1', {isHost: true}), 'won').buttons.map(b => runVrAction(b.id).local), ['again', 'leave']);
assert.deepEqual(runWristView(snap, 'p1').buttons.map(b => runVrAction(b.id).local), ['leave'], 'guests cannot restart');
assert.equal(runWristView({players: []}, 'p1'), null);
assert.equal(runVrAction('deposit'), null);
assert.ok(layoutButtons(['a', 'b', 'c']).every(b => b.h >= 70));
console.log('run-vr: ok');
