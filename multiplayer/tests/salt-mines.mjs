// The Brinedeep salt mines: the shared shape (walls, floor, roof, both corners), the rules (seams, cave-ins, firedamp,
// Saltback crabs, salt at the mill) and the saved state (strict restore), plus the kit layout the client places.
import assert from 'node:assert/strict';
import {createSimulation, loadSimulation, terrainHeight} from '../shared/simulation.js';
import {MINE, MINE_SIDES, mineCarve, mineCeiling, mineDepth, mineInside, minePoint, minePortal, mineWalkable} from '../shared/salt-mines.js';
import {SALT, SEAM_SPOTS, DAMP_VENTS, ventPoint, poolPoint, isSeam} from '../shared/salt-mine-rules.js';
import {keepCarve, onKeepGround, HOME_SITES} from '../shared/keep-sites.js';
import {baseHeight, unminedHeight} from '../shared/terrain.js';
import {MILL} from '../shared/home-mill.js';
import {MATERIAL_KEYS, DEPOSIT_CATALOG} from '../shared/material-catalog.js';
import {kitLayout} from '../client/salt-mine-props.js';

// ---- Shape: walkable path and hall, solid rock round them, the same in both corners.
for (const side of MINE_SIDES) {
  for (const [u, v] of [MINE.path[0], MINE.path[1], MINE.path[2], MINE.path[3], MINE.halls[0], MINE.halls[1]]) {
    const [x, z] = minePoint(side, [u, v]);
    assert.ok(mineWalkable(x, z), `${side} [${u}, ${v}] is walkable`);
    assert.ok(onKeepGround(x, z), `${side} [${u}, ${v}] lets walkers past the meadow edge`);
  }
  // Rock beside the tunnel and behind the hall stays solid and mountain-high.
  for (const [u, v] of [[52, 46.5], [47, 53], [64.5, 62.5], [56, 49]]) {
    const [x, z] = minePoint(side, [u, v]);
    assert.ok(!mineWalkable(x, z), `${side} [${u}, ${v}] is rock`);
  }
  const P = minePortal(side);
  assert.ok(mineCeiling(P.x, P.z) === 0, 'no roof out in the cutting');
  const [hx, hz] = minePoint(side, MINE.halls[0]);
  assert.ok(mineCeiling(hx, hz) > 6, 'the hall vaults high');
  assert.ok(baseHeight(hx, hz) < -2.5 && unminedHeight(hx, hz) > 10, 'the hall is sunk deep under the mountain');
  assert.ok(baseHeight(hx, hz) + mineCeiling(hx, hz) < unminedHeight(hx, hz) - 2, 'rock stands over the hall roof');
  assert.equal(mineDepth(hx, hz), 1, 'deep in the hall');
  const [mx, mz] = minePoint(side, [42, 42]);
  assert.equal(mineDepth(mx, mz), 0, 'out on the meadow');
}
// Mirror images: east (u, -v) and west (-u, v).
for (const [u, v] of [[50, 49], [58, 57], [61, 54]]) assert.equal(mineCarve(u, -v), mineCarve(-u, v));
// The keeps and the old map are untouched; the mines never cut into the keeps' corners.
for (const [sx, sz] of Object.values(HOME_SITES)) assert.equal(mineCarve(sx, sz), 0);
assert.equal(keepCarve(50, -50, false), 0);
assert.equal(mineCarve(0, 0), 0);
assert.equal(mineInside(30, -30) < 0, true);

// ---- Rules.
assert.ok(SEAM_SPOTS.length >= 8, 'seam spots fit the hall');
assert.equal(DAMP_VENTS.length, 2);
for (const side of MINE_SIDES) for (let i = 0; i < 2; i++) { const [x, z] = ventPoint(side, i); assert.ok(mineWalkable(x, z), 'vents stand on the hall floor'); }
for (const side of MINE_SIDES) for (let i = 0; i < MINE.pools.length; i++) { const [x, z] = poolPoint(side, i); assert.ok(mineInside(x, z) > 0, 'pools are in the hall'); }
assert.ok(MATERIAL_KEYS.includes('salt') && MATERIAL_KEYS.at(-1) === 'salt', 'salt appended (save-compatible)');
assert.ok(MILL.rates.salt > MILL.rates.goldOre, 'salt is the richest thing to mill');
assert.ok(DEPOSIT_CATALOG.saltHeart.amount > DEPOSIT_CATALOG.salt.amount);

const hero = () => { const s = createSimulation({room: 'SALT', seed: 41}); s.addPlayer({id: 'me', name: 'A', role: 'hero'}); for (let i = 0; i < 40; i++) s.step(); return s; };
let sim = hero(), seq = 1;
const cmd = m => sim.command('me', {seq: seq++, ...m});
let snap = sim.snapshot();
const seams = snap.deposits.filter(isSeam);
assert.equal(seams.length, SALT.seamsPerMine * 2, 'seams in both mines');
assert.deepEqual(new Set(seams.map(d => d.mine)), new Set(MINE_SIDES));
for (const d of seams) assert.ok(mineWalkable(d.x, d.z) || mineInside(d.x, d.z) > 0, 'seams inside the mine');

// Mining salt: strain builds, a cave-in creaks, falls and leaves rubble; the hero gets salt.
assert.ok(cmd({type: 'action', action: 'equip', tool: 'pick'}).ok);
const all = [];
for (let round = 0; round < 6; round++) {
  const c = sim.checkpoint(); c.enemies = c.enemies.filter(e => e.kind !== 'saltback');
  const d = c.deposits.find(q => q.mine === 'east' && isSeam(q) && !q.depleted); if (!d) break;
  const p = c.players[0], [cx, cz] = minePoint('east', MINE.halls[0]), dx = d.x - cx, dz = d.z - cz, l = Math.hypot(dx, dz) || 1, px = d.x - dx / l * 1.1, pz = d.z - dz / l * 1.1;
  p.position = [px, terrainHeight(c, px, pz), pz]; p.yaw = Math.atan2(-(d.x - px), -(d.z - pz)); p.hp = 100; sim = loadSimulation(c);
  for (let k = 0; k < 12; k++) {
    for (let i = 0; i < 30; i++) all.push(...sim.step());
    const y = terrainHeight(sim.checkpoint(), d.x, d.z), r = cmd({type: 'action', action: 'strike', tool: 'pick', targetId: d.id, point: [d.x, y + .6, d.z], normal: [0, 1, 0]});
    all.push(...(r.events || []));
    if (sim.checkpoint().deposits.find(q => q.id === d.id).depleted) break;
  }
  for (let i = 0; i < 130; i++) all.push(...sim.step());
}
const kinds = all.map(e => e.kind);
assert.ok(kinds.includes('mine_creak'), 'the roof creaks under the picks');
assert.ok(kinds.includes('mine_fall'), 'and comes down');
const salt = sim.snapshot().players[0].resources.salt + sim.snapshot().pickups.filter(p => p.kind === 'salt').length;
assert.ok(salt > 0, 'salt mined');
assert.ok(sim.snapshot().deposits.some(d => d.kind === 'saltRubble'), 'cave-ins leave salt rubble');
const reload = () => loadSimulation(JSON.parse(JSON.stringify(sim.checkpoint())));
reload();

// Firedamp: Wyrmspout fire at a full vent blows it: a blast, a salt heart, loose salt; the vent refills later.
{
  const c = sim.checkpoint(), [vx, vz] = ventPoint('east', 0), p = c.players[0], px = vx + 2.2, pz = vz;
  c.enemies = c.enemies.filter(e => e.kind !== 'saltback');
  p.position = [px, terrainHeight(c, px, pz), pz]; p.tool = 'wyrmspout'; p.hp = 100; sim = loadSimulation(c);
  const vy = terrainHeight(c, vx, vz), o = [px, p.position[1] + 1.4, pz], dir = [vx - px, vy + .5 - o[1], 0], L = Math.hypot(...dir);
  const ev = [];
  for (let k = 0; k < 40 && !ev.some(e => e.kind === 'firedamp_blast'); k++) { const r = cmd({type: 'action', action: 'flame', origin: o, direction: dir.map(n => n / L)}); ev.push(...(r.events || [])); for (let i = 0; i < 3; i++) ev.push(...sim.step()); }
  assert.ok(ev.some(e => e.kind === 'firedamp_blast'), 'fire sets off the firedamp');
  const s = sim.snapshot();
  assert.ok(s.players[0].hp < 100, 'standing in the blast hurts');
  assert.ok(s.mines.east.damp[0] > s.tick, 'the vent must refill');
  assert.ok(s.deposits.some(d => d.kind === 'saltHeart' && !d.depleted), 'the blast cracks open a salt heart');
  reload();
}

// Saltback crabs surface by the pools in time and pinch a hero who crowds them; a saved crab restores.
{
  sim = hero();
  const c = sim.checkpoint(), [x, z] = poolPoint('east', 0), p = c.players[0];
  p.position = [x + 1.6, terrainHeight(c, x + 1.6, z), z]; sim = loadSimulation(c);
  const ev = []; for (let i = 0; i < 1500; i++) ev.push(...sim.step());
  assert.ok(ev.some(e => e.kind === 'saltback_emerge'), 'crabs surface');
  assert.ok(sim.snapshot().enemies.some(e => e.kind === 'saltback'), 'crabs stay about');
  assert.ok(ev.some(e => e.kind === 'saltback_pinch'), 'crabs pinch');
  reload();
}

// Strict restore: a malformed mine record is refused, an old save without one restores to empty mines.
{
  const good = JSON.parse(JSON.stringify(sim.checkpoint()));
  const bad = JSON.parse(JSON.stringify(good)); bad.mines.east.strain = -5;
  assert.throws(() => loadSimulation(bad));
  const bad2 = JSON.parse(JSON.stringify(good)); bad2.mines.falls = [{id: 'x', side: 'north', x: 0, z: 0, fallTick: 1}];
  assert.throws(() => loadSimulation(bad2));
  const old = JSON.parse(JSON.stringify(good)); delete old.mines;
  const restored = loadSimulation(old).snapshot();
  assert.deepEqual(restored.mines.falls, []);
}

// ---- The kit's layout: every piece inside the cave (or the cutting) and the cart on the track.
const L = kitLayout();
const insideAt = ([u, v]) => mineInside(...minePoint('east', [u, v]));
for (const t of L.sets) assert.ok(insideAt([t.u, t.v]) > 1, 'tunnel sets stand in the tunnel');
assert.ok(L.sets.length >= 3 && L.rails.length >= 6);
for (const r of L.rails) assert.ok(insideAt([r.u, r.v]) > .5, 'track runs down the middle');
assert.ok(mineWalkable(...minePoint('east', [L.cart.u, L.cart.v])), 'the cart waits on the hall floor');
for (const b of [...L.big, ...L.small, ...L.rubble]) assert.ok(insideAt([b.u, b.v]) > -.05, 'clusters stand against the walls, not in the rock');
assert.ok(L.big.length >= 2 && L.small.length >= 8);
console.log(`salt-mines: shape, ${SEAM_SPOTS.length} seam spots, ${seams.length} seams, cave-ins, firedamp, Saltback crabs, strict restore and the kit layout pass`);
