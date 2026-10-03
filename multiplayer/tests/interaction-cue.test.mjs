// node test/interaction-cue.test.mjs  — no dependencies. BRANN_CUE_SOURCE=<multiplayer dir> audits a live checkout
// instead of ../reference/multiplayer.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {decideCue, createCueStabilizer, deliverableNow, rayLogDistance, terrainDistance, CUE_RULES, CONTROLS} from '../client/interaction-cue.js';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = process.env.BRANN_CUE_SOURCE || join(here, '..');
const results = [];
const test = (name, fn) => { const t0 = performance.now(); try { fn(); results.push([true, name, performance.now() - t0]); } catch (e) { results.push([false, name, performance.now() - t0, e]); } };
const freeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) freeze(v); } return o; };
const norm = v => { const l = Math.hypot(...v); return v.map(n => n / l); };
const toward = (o, p) => norm([p[0] - o[0], p[1] - o[1], p[2] - o[2]]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const TREE = {id: 't1', x: 0, z: -3, height: 6.002, variant: 0};            // authored scale 1
const view = (o = {}) => ({active: true, role: 'hero', xr: false, menuOpen: false, mode: 'desktop', ...o});
const hero = (o = {}) => ({id: 'p1', role: 'hero', hp: 75, position: [0, 0, 0], yaw: 0, tool: 'axe', resources: {wood: 0, stone: 0, gems: 0}, ...o});
const snap = (o = {}) => freeze({harvestedTrees: [], deposits: [], pickups: [], looseLogs: [], detachedParts: [], ...o});
const EYE = [0, 1.65, 0];
const aimAt = (point, targetId, origin = EYE) => ({origin, direction: toward(origin, point), yaw: 0, hit: targetId ? {targetId, point, distance: dist(origin, point)} : null});
const flatGround = () => 0;
const ctx = (o = {}) => ({tree: id => id === TREE.id ? TREE : null, height: flatGround, deliver: null, ...o});
const LOG_X = [0, 0, -Math.SQRT1_2, Math.SQRT1_2];                         // log +Y axis laid along world x
const log = (id, position, o = {}) => ({id, sourceId: 't1', position, quaternion: LOG_X, velocity: [0, 0, 0], angularVelocity: [0, 0, 0], heldBy: null, bornTick: 0, sleeping: true, ...o});
const trunk = y => [0, y, -3 + .26];

test('hidden when inactive, God, XR or menu', () => {
  const a = aimAt(trunk(1), 't1');
  for (const v of [view({active: false}), view({role: 'god'}), view({xr: true}), view({menuOpen: true})]) assert.equal(decideCue(v, hero(), snap(), a, ctx()), null);
});
test('tree in reach with axe at cut height: Chop + Click', () => {
  const c = decideCue(view(), hero(), snap(), aimAt(trunk(1), 't1'), ctx());
  assert.deepEqual([c.kind, c.state, c.name, c.action, c.control, c.progress], ['tree', 'ready', 'Tree', 'Chop', 'Click', null]);
});
test('touch names match visible controls', () => {
  const c = decideCue(view({mode: 'touch'}), hero(), snap(), aimAt(trunk(1), 't1'), ctx());
  assert.equal(c.control, 'Attack');
  const w = decideCue(view({mode: 'touch'}), hero({tool: 'pick'}), snap(), aimAt(trunk(1), 't1'), ctx());
  assert.deepEqual([w.state, w.action, w.control], ['tool', 'Needs the Axe', 'Axe']);
});
test('wrong tool on tree names the Axe key', () => {
  const c = decideCue(view(), hero({tool: 'hammer'}), snap(), aimAt(trunk(1), 't1'), ctx());
  assert.deepEqual([c.state, c.action, c.control], ['tool', 'Needs the Axe', '1']);
});
test('distant tree: Move closer, no control', () => {
  const far = {...TREE, z: -6}, point = [0, 1, -6 + .26];
  const c = decideCue(view(), hero(), snap(), aimAt(point, 't1'), ctx({tree: id => id === 't1' ? far : null}));
  assert.deepEqual([c.state, c.action, c.control], ['far', 'Move closer', '']);
});
test('outside CUT_RANGE asks for the straight trunk', () => {
  assert.equal(decideCue(view(), hero(), snap(), aimAt(trunk(2.2), 't1'), ctx()).action, 'Aim lower on the trunk');
  assert.equal(decideCue(view(), hero(), snap(), aimAt([0, .1, -3 + .4], 't1'), ctx()).action, 'Aim higher on the trunk');
});
test('canopy/limb hit off the trunk asks for the trunk', () => {
  const c = decideCue(view(), hero(), snap(), aimAt([1.2, 2.2, -2.4], 't1', [0, 1.65, -.5]), ctx());
  assert.equal(c.action, 'Aim at the trunk');
});
test('existing notch: progress and notch tolerance', () => {
  const s = snap({harvestedTrees: [{id: 't1', cuts: 1, cutHeight: .9, felledTick: 0, fallYaw: 0, landed: false}]});
  const ok = decideCue(view(), hero(), s, aimAt(trunk(1), 't1'), ctx());
  assert.deepEqual([ok.action, ok.progress], ['Chop', {done: 1, total: 3}]);
  assert.equal(decideCue(view(), hero(), s, aimAt(trunk(1.5), 't1'), ctx()).action, 'Aim lower, at the notch');
});
test('felled tree gives no tree cue', () => {
  const s = snap({harvestedTrees: [{id: 't1', cuts: 3, cutHeight: .9, felledTick: 5, fallYaw: 0, landed: true}]});
  assert.equal(decideCue(view(), hero(), s, aimAt(trunk(1), 't1'), ctx()), null);
});
test('ore: Mine with pick, wrong tool, star shard naming, progress', () => {
  const s = snap({deposits: [{id: 'ore1', x: 0, z: -2.5, kind: 'stone', hits: 1, maxHits: 3, depleted: false}, {id: 'm1', x: 0, z: -2.5, kind: 'meteor', hits: 0, maxHits: 5, depleted: false}]});
  const p = [0, .6, -2.0];
  const m = decideCue(view(), hero({tool: 'pick'}), s, aimAt(p, 'ore1'), ctx());
  assert.deepEqual([m.kind, m.name, m.action, m.control, m.note, m.progress], ['ore', 'Stone boulder', 'Mine', 'Click', 'Foundations, walls and heavy ammunition.', {done: 1, total: 3}]);
  const w = decideCue(view(), hero(), s, aimAt(p, 'ore1'), ctx());
  assert.deepEqual([w.action, w.control], ['Needs the Pick', '2']);
  assert.equal(decideCue(view(), hero({tool: 'pick'}), s, aimAt(p, 'm1'), ctx()).name, 'Meteor');
});
test('loose log in reach: Collect E directly', () => {
  const s = snap({looseLogs: [log('log1', [0, .16, -1.8])]});
  const c = decideCue(view(), hero(), s, aimAt([0, .16, -1.8], null), ctx());
  assert.deepEqual([c.kind, c.action, c.control, c.note], ['log', 'Collect', 'E', 'Frames, ammunition shafts and repairs.']);
  const t = decideCue(view({mode: 'touch'}), hero(), s, aimAt([0, .16, -1.8], null), ctx());
  assert.deepEqual([t.control, t.note], ['Collect', 'Frames, ammunition shafts and repairs.']);
});
test('log beyond grab reach: Move closer', () => {
  const s = snap({looseLogs: [log('log1', [0, .16, -4])]});
  assert.equal(decideCue(view(), hero(), s, aimAt([0, .16, -4], null), ctx()).action, 'Move closer');
});
test('log occluded by a nearer surface or terrain is not cued', () => {
  const s = snap({looseLogs: [log('log1', [0, .16, -2.2])]});
  const a = aimAt([0, .16, -2.2], null);
  assert.equal(decideCue(view(), hero(), s, {...a, hit: {targetId: 'shrine', point: [0, 1, -1], distance: 1.0}}, ctx()), null);
  assert.equal(decideCue(view(), hero(), s, a, ctx({height: (x, z) => z < -1 ? 1.2 : 0})), null);
});
test('held log: Stow E with drop/throw; full pack', () => {
  const s = snap({looseLogs: [log('log1', [0, 1.1, -.75], {heldBy: 'p1', sleeping: false})]});
  const c = decideCue(view(), hero(), s, aimAt(trunk(1), 't1'), ctx());
  assert.deepEqual([c.kind, c.action, c.control, c.note], ['carry', 'Stow', 'E', 'G drop · X throw']);
  const f = decideCue(view(), hero({resources: {wood: 999}}), s, null, ctx());
  assert.deepEqual([f.state, f.action], ['full', 'Pack full']);
});
test('held bone permits direct lumber collection', () => {
  const s = snap({looseLogs: [log('log1', [0, .16, -1.8])], detachedParts: [{id: 'd1', heldBy: 'p1'}]});
  assert.equal(decideCue(view(), hero(), s, aimAt([0, .16, -1.8], null), ctx()).action, 'Collect');
});
test('nearby pickups: Collect / Eat / full', () => {
  const st = snap({pickups: [{id: 'q1', kind: 'stone', x: 1, z: 0, y: 0, amount: 2}]});
  const c = decideCue(view(), hero(), st, null, ctx());
  assert.deepEqual([c.name, c.action, c.control], ['Stone ×2', 'Collect', 'E']);
  assert.equal(decideCue(view(), hero({resources: {stone: 998}}), st, null, ctx()).action, 'Pack full');
  assert.equal(decideCue(view(), hero(), snap({pickups: [{id: 'a', kind: 'apple', x: 0, z: 1, y: 0, amount: 1}]}), null, ctx()).action, 'Eat');
  assert.equal(decideCue(view(), hero(), snap({pickups: [{id: 'q1', kind: 'stone', x: 3, z: 0, y: 0, amount: 2}]}), null, ctx()), null);
});
test('forge Deliver only in range with accepted carried kinds', () => {
  const deliver = {kinds: ['wood', 'stone'], held: {wood: 3, stone: 2}};
  const c = decideCue(view(), hero({position: [4, 0, 4]}), snap(), null, ctx({deliver}));
  assert.deepEqual([c.kind, c.action, c.control, c.note], ['forge', 'Deliver', 'Deliver', '3 timber · 2 stone']);
  assert.equal(decideCue(view(), hero({position: [9.5, 0, 0]}), snap(), null, ctx({deliver})), null);
  assert.equal(decideCue(view(), hero({position: [1, 0, 0]}), snap(), null, ctx({deliver: {kinds: [], held: {}}})), null);
  assert.equal(decideCue(view(), hero({position: [1, 0, 0]}), snap(), null, ctx()), null);
});
test('deliverableNow mirrors RUNNING stages and depositRoom', () => {
  const camp = freeze({stage: 'camp', need: {wood: 6, stone: 4, star: 6}, stock: {wood: 6, stone: 1}, star: {charge: 0}, flame: 100});
  assert.deepEqual(deliverableNow(camp, 'hero', {wood: 2, stone: 1, gems: 3}), ['stone']);   // timber already met
  assert.deepEqual(deliverableNow(camp, 'god', {stone: 1}), []);
  assert.deepEqual(deliverableNow({...camp, stage: 'idle'}, 'hero', {stone: 1}), []);
  assert.deepEqual(deliverableNow({...camp, stage: 'star', star: {charge: 2}}, 'hero', {wood: 1, gems: 1}), ['gems']);
  assert.deepEqual(deliverableNow({...camp, stage: 'rekindle', flame: 100}, 'hero', {wood: 1}), []);
  assert.deepEqual(deliverableNow({...camp, stage: 'rekindle', flame: 40}, 'hero', {wood: 1, gems: 2}), ['wood', 'gems']);
});
test('stabilizer keeps the shown cue when a mode switch changes only the control label', () => {
  const st = createCueStabilizer();
  const a = decideCue(view(), hero(), snap(), aimAt(trunk(1), 't1'), ctx()), b = decideCue(view({mode: 'touch'}), hero(), snap(), aimAt(trunk(1), 't1'), ctx());
  st.push(a, 0); st.push(a, 100); assert.equal(st.push(b, 200), b); assert.notEqual(a.key, b.key);
});
test('frozen snapshot is never mutated', () => {
  const s = snap({looseLogs: [log('log1', [0, .16, -1.8])], pickups: [{id: 'q', kind: 'wood', x: 0, z: 1, y: 0, amount: 1}], harvestedTrees: [{id: 't1', cuts: 2, cutHeight: 1, felledTick: 0, fallYaw: 0, landed: false}]});
  decideCue(view(), freeze(hero()), s, freeze(aimAt(trunk(1), 't1')), ctx());
  decideCue(view(), freeze(hero()), s, freeze(aimAt([0, .16, -1.8], null)), ctx());
});
test('stabilizer: enter after 2 samples, same-target state change immediate, linger 300 ms', () => {
  const st = createCueStabilizer({enter: 2, holdMs: 300});
  const a = {key: 'a', kind: 'tree', target: 't1'}, a2 = {key: 'a2', kind: 'tree', target: 't1'}, b = {key: 'b', kind: 'ore', target: 'o1'};
  assert.equal(st.push(a, 0), null); assert.equal(st.push(a, 100), a);
  assert.equal(st.push(a2, 200), a2);                           // own cut feedback, no delay
  assert.equal(st.push(b, 300), a2); assert.equal(st.push(b, 400), b);
  assert.equal(st.push(null, 500), b); assert.equal(st.push(null, 790), b); assert.equal(st.push(null, 800), null);
});
test('geometry helpers', () => {
  const l = log('l', [0, 1, -2]);
  assert.ok(Math.abs(rayLogDistance([0, 1, 0], [0, 0, -1], l, 8) - (2 - .16)) < 1e-6);
  assert.equal(rayLogDistance([0, 1.5, 0], [0, 0, -1], l, 8), null);
  assert.ok(Math.abs(rayLogDistance([2, 1, -2], [-1, 0, 0], l, 8) - (2 - .55)) < 1e-6); // capsule cap along its axis
  assert.ok(Math.abs(terrainDistance([0, 1, 0], norm([0, -1, -1]), () => 0, 8) - 1.5) < .3);
});
test('mirrored rules and control names match the reference source', () => {
  const read = p => readFileSync(join(SRC, p), 'utf8');
  const sim = read('shared/simulation.js'), adv = read('shared/adventure.js'), game = read('client/game.js'), wc = read('client/world-content-view.js');
  const html = read('index.html'), mui = read('client/mobile-ui.js'), av = read('client/adventure-view.js'), vr = read('client/vr-input-policy.js');
  assert.match(adv, /DEPOSIT_RANGE = 9\b/); assert.match(adv, /const RUNNING = \['camp', 'star', 'rekindle'\]/); assert.match(adv, /const per = \{wood: 4, stone: 2, gems: 10\}\[kind\]/);
  assert.match(adv, /kind === 'wood' \? adv\.need\.wood - adv\.stock\.wood : kind === 'stone' \? adv\.need\.stone - adv\.stock\.stone/); assert.match(adv, /kind === 'gems' \? adv\.need\.star - adv\.star\.charge/); assert.equal(CUE_RULES.forgeRange, 9);
  assert.equal(CUE_RULES.pickupReach, 2.5); assert.match(sim, /d<=3\.2 && \(d<\.5 \|\| \(facing\[0\]\*dx\+facing\[1\]\*dz\)\/d>=\.45\)/);
  assert.match(sim, /Math\.hypot\(message\.point\[0\]-ore\.x,message\.point\[2\]-ore\.z\) > 1\.5/);
  assert.match(game, /raycaster\.far=3\.2/); assert.match(wc, /Math\.min\(max\?\?2\.5,2\.5\)/);
  for (const [id, name] of [['collect', 'Collect'], ['grab', 'Grab'], ['drop', 'Drop'], ['throw', 'Throw']]) assert.match(html, new RegExp(`id="${id}"[^>]*>.*?<span class="bf-name">${name}</span>`));
  assert.match(html, /data-equip="axe"[\s\S]*?bf-name">Axe</); assert.match(html, /data-equip="pick"[\s\S]*?bf-name">Pick</);
  assert.match(mui, /actionButton\('strike', 'Attack'/); assert.match(av, /deposit: 'Deliver'/);
  assert.match(game, /KeyE/);
  assert.match(vr, /hand === 'left'\) actions\.push\('interact'\)/); assert.match(vr, /edge\('squeeze'\)\) actions\.push\(hand === 'left' \? 'cycle' : 'hand'\)/);
  assert.equal(CONTROLS.touch.collect, 'Collect');
});
test('forge proximity offers direct workshop; loose pickups retain E priority', () => {
  const forge={id:'central-forge',type:'forge',position:[0,0,0],hp:100,side:'neutral'};
  const s=snap({inventions:{structures:[forge]}}), h=hero({position:[0,0,4.8]});
  const c=decideCue(view(),h,s,null,ctx());assert.equal(c.target,forge.id);assert.equal(c.action,'Open workshop');assert.equal(c.control,'E');
  assert.equal(decideCue(view(),hero({position:[0,0,5.1]}),s,null,ctx()),null);
  assert.equal(decideCue(view(),h,snap({inventions:{structures:[forge]},pickups:[{id:'stone1',kind:'stone',x:0,y:0,z:4,amount:1}]}),null,ctx()).target,'stone1');
});

test('cost: 48 logs + 256 pickups, 10k decisions', () => {
  const logs = Array.from({length: 48}, (_, i) => log(`log${i}`, [i % 8 - 4, .16, -10 - (i >> 3)]));
  const pickups = Array.from({length: 256}, (_, i) => ({id: `p${i}`, kind: 'stone', x: 20 + i % 16, z: 20 + (i >> 4), y: 0, amount: 1}));
  const s = snap({looseLogs: logs, pickups}), a = aimAt(trunk(1), 't1'), h = hero(), c = ctx({height: (x, z) => .02 * Math.sin(x) * Math.cos(z)});
  const t0 = performance.now(); for (let i = 0; i < 10000; i++) decideCue(view(), h, s, a, c); const per = (performance.now() - t0) / 10000;
  console.log(`  decideCue worst-case: ${(per * 1000).toFixed(1)} µs per call (10 Hz budget => ${(per * 10).toFixed(3)} ms/s)`);
  assert.ok(per < .5, `too slow: ${per} ms`);
});

let failed = 0;
for (const [ok, name, ms, e] of results) { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} (${ms.toFixed(1)} ms)`); if (!ok) { failed++; console.log(e); } }
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
