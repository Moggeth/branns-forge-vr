// Keep town presentation (2026-10-07): the town kit carries every piece and anchor the rules assume (bar, counter,
// hopper, capstan, chute), stays phone-sized, and the view lays out three taverns, two stalls and two mills whose
// sails speed up while grinding and race while cranked; coins hop out on Gold events and are pooled.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createSimulation} from '../shared/simulation.js';
import {homePiece, neutralTavern, pieceWorld} from '../shared/home-bases.js';
import {MILL, millOf} from '../shared/home-mill.js';
import {SHOP} from '../shared/home-shop.js';
import {TAVERN} from '../shared/taverns.js';
import {createHomeTownView} from '../client/home-town-view.js';

let count = 0;
const test = (name, fn) => { fn(); count++; console.log('PASS', name); };

const glb = readFileSync(new URL('../public/assets/town_kit.glb', import.meta.url));
const json = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)));
const byName = new Map(json.nodes.map(n => [n.name, n]));
const child = (n, name) => (n.children || []).map(i => json.nodes[i]).find(c => c.name === name);
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test('town kit carries every piece and the anchors the rules stand players at', () => {
  assert.equal(glb.toString('utf8', 0, 4), 'glTF');
  assert.ok(glb.length < 4.5e6, `town kit stays phone-sized (${glb.length} bytes)`);
  for (const pre of ['D', 'G']) {
    for (const piece of ['Tavern', 'Quartermaster', 'Mill', 'MillSails', 'MillCrank']) assert.ok(byName.has(`${pre}_${piece}`), `${pre}_${piece}`);
    const bar = child(byName.get(`${pre}_Tavern`), `${pre}_Tavern_Bar`).translation;
    near(bar[0], TAVERN.bar.keep[0], .1, 'keep bar x'); near(bar[2], TAVERN.bar.keep[1], .1, 'keep bar z');
    const counter = child(byName.get(`${pre}_Quartermaster`), `${pre}_Quartermaster_Counter`).translation;
    near(counter[2], SHOP.counter[1], .3, 'counter front'); near(counter[0], SHOP.counter[0], .1, 'counter x');
    const mill = byName.get(`${pre}_Mill`);
    const hop = child(mill, `${pre}_Mill_Hopper`).translation, crank = child(mill, `${pre}_Mill_Crank`).translation, chute = child(mill, `${pre}_Mill_Chute`).translation;
    near(hop[0], MILL.hopper[0], .1, 'hopper x'); near(hop[2], MILL.hopper[1], .1, 'hopper z');
    near(crank[0], MILL.crank[0], .1, 'crank x'); near(crank[2], MILL.crank[1], .1, 'crank z');
    near(chute[0], MILL.chute[0], .1, 'chute x'); near(chute[2], MILL.chute[1], .1, 'chute z');
    assert.ok(child(mill, `${pre}_Mill_Hub`), 'mill hub');
  }
  const n = byName.get('N_Tavern'); assert.ok(n, 'N_Tavern');
  const bar = child(n, 'N_Tavern_Bar').translation; near(bar[2], TAVERN.bar.neutral[1], .1, 'neutral bar z');
});

function world() {
  const sim = createSimulation({seed: 9}); sim.addPlayer({id: 'host'});
  const w = sim.adventureWorld(); return {sim, w, snap: () => structuredClone({...w, battle: w.battle})};
}

test('the view lays out three taverns, two stalls and two mills at the rules’ own places', () => {
  const {w} = world(); assert.equal(w.battle.v, 2);
  const scene = new THREE.Scene(), view = createHomeTownView({scene});
  view.sync(w); assert.equal(view.stats().pieces, 7); assert.equal(view.stats().kit, false);
  const mill = view.object.getObjectByName('mill-party'), placed = homePiece('party', 'mill');
  near(mill.position.x, placed.x, 1e-6, 'mill x'); near(mill.position.z, placed.z, 1e-6, 'mill z'); near(mill.rotation.y, placed.yaw, 1e-6, 'mill yaw');
  const mug = view.object.getObjectByName('tavern-neutral'), n = neutralTavern(); near(mug.position.x, n.x, 1e-6, 'mug x');
  view.sync({...w, battle: {...w.battle, status: 'off'}}); assert.equal(view.object.visible, false);
  view.dispose();
});

test('mill sails idle, grind faster with a queue and race on the capstan; coins pool', () => {
  const {w} = world();
  const scene = new THREE.Scene(), view = createHomeTownView({scene});
  view.sync(w); for (let i = 0; i < 120; i++) view.update(1 / 60);
  const idle = view.stats().mills.find(m => m.side === 'party').spin;
  const base = w.battle.bases.find(b => b.side === 'party'); millOf(base).queue.push({id: 'host', gold: 5});
  view.sync(w); for (let i = 0; i < 240; i++) view.update(1 / 60);
  const grind = view.stats().mills.find(m => m.side === 'party').spin;
  base.mill.crankUntil = w.tick + 1e6; view.sync(w); for (let i = 0; i < 240; i++) view.update(1 / 60);
  const crank = view.stats().mills.find(m => m.side === 'party').spin;
  assert.ok(idle < grind && grind < crank, `${idle} < ${grind} < ${crank}`);
  const at = pieceWorld(homePiece('party', 'mill'), MILL.chute);
  for (let i = 0; i < 5; i++) view.event({kind: 'mill_coin', side: 'party', id: 'host', gold: i, owed: 4 - i, position: [at[0], 5, at[1]]});
  view.event({kind: 'gold_earned', id: 'host', amount: 3, position: [0, 5, 0]});
  view.update(1 / 60); const meshes = view.object.children.length;
  for (let i = 0; i < 120; i++) view.update(1 / 60);
  for (let i = 0; i < 5; i++) view.event({kind: 'mill_coin', side: 'party', id: 'host', gold: i, owed: 1, position: [at[0], 5, at[1]]});
  view.update(1 / 60); assert.equal(view.object.children.length, meshes, 'spent coins are reused');
  view.dispose();
});

console.log(`home-town-view: ${count} checks passed`);
