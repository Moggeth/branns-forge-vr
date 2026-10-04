// Skeleton remains are a jointed ragdoll in the shared simulation: they hold together, land on the terrain,
// go to sleep, wake when struck, survive a save/restore and replay identically on every peer.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createEnemy, hitEnemyPart, stepCombat, restoreCombat, validateCombat} from '../shared/combat.js';
import {rotate, applyImpulse, partMass} from '../shared/remains-physics.js';

const hill = (x, z) => Math.sin(x * .3) * .4 + z * .05;
function world() {
  let n = 0;
  const ctx = {nextId: (s, p) => `${p}${++n}`, terrainHeight: (s, x, z) => hill(x, z)};
  const state = {tick: 100, players: [], enemies: [], detachedParts: [], embeds: [], projectiles: [], pickups: []};
  const e = createEnemy('s1', [1, hill(1, 0), 0]); state.enemies.push(e);
  hitEnemyPart(state, e, 'head', 500, {normal: [0, 0, 1], point: [1, 1.5, .1], energy: 1}, ctx, [], {projectile: true});
  return {state, ctx};
}
const step = ({state, ctx}, n) => { for (let i = 0; i < n; i++) { state.tick++; stepCombat(state, ctx, []); } };
const jointError = state => {
  let worst = 0;
  for (const d of state.detachedParts) if (d.joint) {
    const t = state.detachedParts.find(o => o.id === d.joint.to);
    const a = rotate(d.joint.a, t.quaternion).map((v, k) => v + t.position[k]), b = rotate(d.joint.b, d.quaternion).map((v, k) => v + d.position[k]);
    worst = Math.max(worst, Math.hypot(...a.map((v, k) => v - b[k])));
  }
  return worst;
};

// A killed skeleton falls apart into one linked body, not six loose props.
const w = world();
assert.equal(w.state.enemies.length, 0, 'the skeleton died');
const parts = w.state.detachedParts;
assert.equal(parts.length, 6, 'six pieces of remains');
const torso = parts.find(d => d.part === 'torso');
assert.ok(torso && !torso.joint, 'the torso is the ragdoll root');
for (const d of parts) if (d !== torso) assert.equal(d.joint?.to, torso.id, `${d.part} hangs from the torso`);

// It holds together while it falls, lands on (not in) the slope and comes to rest.
let worst = 0; const t0 = performance.now();
for (let i = 0; i < 400; i++) { step(w, 1); worst = Math.max(worst, jointError(w.state)); }
const msPerTick = (performance.now() - t0) / 400;
assert.ok(worst < .08, `joints stay together (worst ${worst.toFixed(3)} m)`);
for (const d of parts) assert.ok(d.position[1] - hill(d.position[0], d.position[2]) > -.05, `${d.part} rests on the terrain`);
assert.ok(parts.every(d => d.rest > 0), 'the ragdoll goes to sleep');
assert.ok(msPerTick < 3, `cheap enough to step (${msPerTick.toFixed(3)} ms/tick)`);

// A blow wakes the whole body, not just the bone it hit.
const before = parts.map(d => [...d.position]);
applyImpulse(w.state, parts.find(d => d.part === 'leftLeg'), [0, 1.5 * partMass(parts.find(d => d.part === 'leftLeg')), 2], null);
assert.ok(parts.every(d => !d.rest), 'an impulse wakes every linked part');
step(w, 30);
assert.ok(parts.some((d, i) => Math.hypot(...d.position.map((v, k) => v - before[i][k])) > .05), 'the struck remains move');

// Same inputs give the same pile on every machine, and a save mid-tumble resumes exactly.
const a = world(), b = world();
step(a, 25); step(b, 25);
const saved = JSON.parse(JSON.stringify({...a.state, players: []}));
validateCombat(saved, new Set());
const resumed = {state: {...a.state, ...restoreCombat(saved)}, ctx: a.ctx};
step(resumed, 120); step(b, 120);
assert.deepEqual(resumed.state.detachedParts.map(d => [d.position, d.quaternion, d.rest]), b.state.detachedParts.map(d => [d.position, d.quaternion, d.rest]), 'deterministic across save/restore');
console.log(`remains physics ok: joint error ${worst.toFixed(3)} m, ${msPerTick.toFixed(3)} ms/tick`);
