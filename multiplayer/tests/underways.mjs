// The Underways: seeded generation is reproducible and well-formed for every style, and a full delve works through the
// shared simulation (enter, rooms wake, hazards, urns, key, gate, shrine, guardian and its waves, hoard, way out, close,
// save and load, determinism between two hosts).
import assert from 'node:assert/strict';
import {generateUnderway, UNDERWAY_STYLES, GRID, TILE, tileAt, tileCenter, floorTile, floorHeight, pacingPlan} from '../shared/underways/gen.js';
import {inUnderway, slotOrigin, resolveUnderway, gateClosed, GATE_RISE} from '../shared/underways/space.js';
import {UNDERWAYS, BOSS_HP, hazardPhase} from '../shared/underways/rules.js';
import {ARENA_UNDERWAYS} from '../shared/underways/sites.js';
import {createSimulation, loadSimulation} from '../shared/simulation.js';
import {terrainHeight} from '../shared/terrain.js';

const t0 = performance.now();
// ---- Generation: deterministic, connected, readable.
let worst = 0;
for (const style of UNDERWAY_STYLES) for (let seed = 1; seed <= 40; seed++) for (const depth of [1, 3]) {
  const a = performance.now(), d = generateUnderway(seed * 7919 + depth, {style, depth});
  worst = Math.max(worst, performance.now() - a);
  const again = generateUnderway(seed * 7919 + depth, {style, depth});
  assert.equal(again, d, 'cached');
  const plan = pacingPlan(depth);
  assert.equal(d.rooms.filter(r => r.spine).length, plan.spine.length, `${style} ${seed}: every spine beat placed`);
  assert.equal(d.rooms.length, plan.spine.length + plan.branches.length);
  for (const q of d.rooms) assert.ok(q.x0 >= 0 && q.y0 >= 0 && q.x1 < GRID && q.y1 < GRID);
  // Flood fill from the entry with the gate shut, then open.
  const gate = d.gate, flood = open => {
    const seen = new Uint8Array(GRID * GRID), [si, sj] = tileAt(d.entry.x, d.entry.z), stack = [[si, sj]]; seen[sj * GRID + si] = 1;
    while (stack.length) {
      const [i, j] = stack.pop();
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj; if (!floorTile(d, ni, nj) || seen[nj * GRID + ni]) continue;
        const [x, z] = tileCenter(ni, nj);
        if (!open && Math.abs(x - gate.x) <= gate.half[0] + TILE / 2 - .01 && Math.abs(z - gate.z) <= gate.half[1] + TILE / 2 - .01) continue;
        seen[nj * GRID + ni] = 1; stack.push([ni, nj]);
      }
    }
    return q => { for (let j = q.y0; j <= q.y1; j++) for (let i = q.x0; i <= q.x1; i++) if (d.roomOf[j * GRID + i] === q.id && seen[j * GRID + i]) return true; return false; };
  };
  const shut = flood(false), opened = flood(true);
  for (const q of d.rooms) assert.ok(opened(q), `${style} ${seed}: room ${q.id} (${q.beat}) reachable`);
  assert.ok(shut(d.rooms.find(q => q.beat === 'key')), `${style} ${seed}: the key is reachable before the gate`);
  assert.ok(!shut(d.rooms.find(q => q.beat === 'finale')), `${style} ${seed}: the finale is behind the gate`);
  assert.equal(d.encounters.filter(e => e.boss).length, 1, 'one guardian');
  assert.ok(d.hoard && d.exit && d.key && d.shrine && d.entry, 'finale, key and shrine placed');
  // Nothing solid sits on a door lane, and every encounter, chest and hazard stands on open floor.
  for (const thing of [...d.encounters, ...d.chests, d.key, d.shrine, d.hoard, d.exit]) {
    const [i, j] = tileAt(thing.x, thing.z); assert.ok(floorTile(d, i, j), `${style} ${seed}: ${thing.id} on floor`);
  }
  for (const h of d.hazards) { const [i, j] = tileAt(h.x, h.z); assert.ok(floorTile(d, i, j), `${style} ${seed}: hazard ${h.id} on floor`); }
  // Corridors ramp without cliffs: neighbouring floor tiles never differ by more than a gentle step.
  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID - 1; i++) if (floorTile(d, i, j) && floorTile(d, i + 1, j)) {
    const [x, z] = tileCenter(i, j); assert.ok(Math.abs(floorHeight(d, x, z) - floorHeight(d, x + TILE, z)) < .75, `${style} ${seed}: step at ${i},${j}`);
  }
}
assert.ok(worst < 120, `generation ${worst.toFixed(1)} ms`);
assert.notEqual(generateUnderway(1, {style: 'mine'}).name + generateUnderway(2, {style: 'mine'}).rooms[3].x0, generateUnderway(3, {style: 'mine'}).name + generateUnderway(4, {style: 'mine'}).rooms[3].x0);

// ---- A delve through the shared simulation.
const site = ARENA_UNDERWAYS[0];
function host() {
  const game = createSimulation({room: 'DELVE', seed: 77});
  game.addPlayer({id: 'h1', name: 'Brann', role: 'hero'});
  game.addPlayer({id: 'h2', name: 'Pip', role: 'hero'});
  return game;
}
const steps = (game, n) => { const out = []; for (let i = 0; i < n; i++) out.push(...game.step()); return out; };
const S = g => g.adventureWorld(), hero = (g, id) => S(g).players.find(p => p.id === id);
const put = (g, id, x, z) => { const p = hero(g, id); p.position = [x, terrainHeight(S(g), x, z) + .01, z]; p.vy = 0; };
function delve(game) {
  const log = [];
  steps(game, 200); // spawn protection, settle
  put(game, 'h1', site.mouth[0], site.mouth[1]);
  let ev = steps(game, 2); log.push(...ev);
  const enter = ev.find(e => e.kind === 'underway_enter'); assert.ok(enter, 'standing in the mouth goes down');
  const run = S(game).underways.runs[0], d = generateUnderway(run.seed, {style: run.style, depth: run.depth}), [ox, oz] = slotOrigin(run.slot);
  assert.ok(inUnderway(...[hero(game, 'h1').position[0], hero(game, 'h1').position[2]]));
  assert.equal(run.site, site.id);
  const at = (id, x, z) => put(game, id, x + ox, z + oz);
  // Walking in the entry room stays on the floor and inside the walls.
  const p = hero(game, 'h1'), y0 = p.position[1];
  game.command('h1', {type: 'input', seq: 1, move: {x: 0, z: -1}, yaw: 0}); ev = steps(game, 15); log.push(...ev);
  assert.ok(Math.abs(hero(game, 'h1').position[1] - y0) < .2, 'on the dungeon floor');
  // Step into each spine room in turn: its foes wake.
  const byBeat = b => d.rooms.find(q => q.beat === b), centre = q => [((q.x0 + q.x1 + 1) / 2 - GRID / 2) * TILE, ((q.y0 + q.y1 + 1) / 2 - GRID / 2) * TILE];
  const teach = byBeat('teach'); at('h1', ...centre(teach)); ev = steps(game, 2); log.push(...ev);
  assert.ok(ev.some(e => e.kind === 'underway_room' && e.room === teach.id), 'teach room woke');
  const foes = S(game).enemies.filter(e => e.uw === run.id && e.room === teach.id);
  assert.equal(foes.length, d.encounters.filter(e => e.room === teach.id && !e.boss && !e.wave).length);
  // Hazards hurt on the shared rhythm (stand a Hero on one and wait for its strike tick).
  const hz = d.hazards.find(h => h.room === teach.id);
  if (hz) {
    put(game, 'h2', site.mouth[0], site.mouth[1]); steps(game, 2); // second Hero joins the same run
    assert.equal(S(game).underways.runs.length, 1, 'one run per site');
    hero(game, 'h2').protectedUntil = 0;
    const strikeAt = hz.type === 'rockfall' ? hz.warn : hz.type === 'flame' ? 6 : 0;
    const wait = (strikeAt - hazardPhase(hz, S(game).tick) + hz.period * 2 - 1) % hz.period;
    steps(game, wait); at('h2', hz.x, hz.z); hero(game, 'h2').protectedUntil = 0;
    const before = hero(game, 'h2').hp; steps(game, 2);
    assert.ok(hero(game, 'h2').hp < before, `${hz.type} hurts a Hero standing on it`);
  }
  // Urns and chests break open to a swing.
  const urn = d.chests.find(c => run.woke.includes(c.room) || c.room === teach.id) || d.chests[0];
  at('h1', ...centre(d.rooms[urn.room])); steps(game, 2);
  S(game).enemies = S(game).enemies.filter(e => e.uw !== run.id); // clear foes so the swing is free
  at('h1', urn.x, urn.z + .9); hero(game, 'h1').yaw = 0; hero(game, 'h1').attackTick = -1000;
  const swing = game.command('h1', {type: 'action', seq: 2, action: 'strike', tool: hero(game, 'h1').tool});
  assert.ok(swing.ok && swing.events.some(e => e.kind === 'underway_open'), 'swing opens the urn');
  assert.ok(run.opened.includes(urn.id));
  // The gate holds without the key; the key opens it.
  const g = d.gate; at('h1', g.x + (g.axis === 'z' ? 0 : -3), g.z + (g.axis === 'z' ? 3 : 0));
  assert.ok(gateClosed(run, S(game).tick));
  const keyRoom = byBeat('key'); at('h1', ...centre(keyRoom)); steps(game, 2); S(game).enemies = S(game).enemies.filter(e => e.uw !== run.id);
  at('h1', d.key.x, d.key.z); ev = steps(game, 2); log.push(...ev);
  assert.ok(ev.some(e => e.kind === 'underway_key') && run.key, 'key taken');
  at('h1', g.x, g.z + (g.axis === 'z' ? 2.4 : 0)); if (g.axis === 'x') at('h1', g.x - 2.4, g.z); ev = steps(game, 2); log.push(...ev);
  assert.ok(ev.some(e => e.kind === 'underway_gate'), 'gate opens');
  steps(game, GATE_RISE); assert.ok(!gateClosed(run, S(game).tick));
  // The shrine restores.
  hero(game, 'h1').hp = 20; at('h1', d.shrine.x, d.shrine.z); ev = steps(game, 2); log.push(...ev);
  assert.ok(ev.some(e => e.kind === 'underway_rest') && hero(game, 'h1').hp > 90, 'shrine heals');
  // The guardian: crowned, tougher than any golem, calls two waves, and its fall bursts the hoard.
  const fin = byBeat('finale'); at('h1', ...centre(fin)); ev = steps(game, 2); log.push(...ev);
  const boss = S(game).enemies.find(e => e.id === run.bossId); assert.ok(boss && boss.boss && boss.hp === BOSS_HP, 'guardian woke');
  boss.hp = BOSS_HP * .6; ev = steps(game, 1); assert.ok(ev.some(e => e.kind === 'underway_wave' && e.wave === 1));
  boss.hp = BOSS_HP * .3; ev = steps(game, 1); assert.ok(ev.some(e => e.kind === 'underway_wave' && e.wave === 2));
  // Save mid-fight and load: the run, its foes and the guardian come back exactly.
  const saved = JSON.parse(JSON.stringify(game.checkpoint())), loaded = loadSimulation(saved);
  assert.deepEqual(loaded.checkpoint().underways, saved.underways);
  assert.ok(loaded.checkpoint().enemies.some(e => e.boss && e.uw === run.id));
  S(game).enemies.splice(S(game).enemies.indexOf(boss), 1);
  hero(game, 'h1').protectedUntil = S(game).tick + 9999;
  ev = steps(game, 2); assert.ok(ev.some(e => e.kind === 'underway_boss_down'));
  ev = steps(game, UNDERWAYS.hoardDelay + 2); log.push(...ev);
  const hoard = ev.find(e => e.kind === 'underway_hoard'); assert.ok(hoard && hoard.drops.length >= 5, 'hoard bursts');
  assert.ok(hoard.granted.length >= 1, 'everyone inside gets a piece of kit');
  steps(game, UNDERWAYS.exitDelay + 2);
  at('h1', d.exit.x, d.exit.z); ev = steps(game, 2); log.push(...ev);
  assert.ok(ev.some(e => e.kind === 'underway_leave' && e.id === 'h1' && e.reason === 'victory'), 'way out');
  assert.ok(!inUnderway(hero(game, 'h1').position[0], hero(game, 'h1').position[2]));
  assert.ok(Math.hypot(hero(game, 'h1').position[0] - site.back[0], hero(game, 'h1').position[2] - site.back[1]) < .5, 'back at the portal');
  // The other Hero walks home through the entry circle; the cleared run closes and the site rerolls its seed.
  at('h2', d.entry.x, d.entry.z); ev = steps(game, 3); log.push(...ev);
  assert.ok(ev.some(e => e.kind === 'underway_leave' && e.id === 'h2' && e.reason === 'return'));
  assert.ok(ev.some(e => e.kind === 'underway_closed' && e.cleared));
  assert.equal(S(game).underways.runs.length, 0);
  assert.equal(S(game).underways.delves[site.id], 1, 'the next delve is a new dungeon');
  assert.ok(!S(game).enemies.some(e => e.uw) && !S(game).pickups.some(q => inUnderway(q.x, q.z)), 'nothing left behind');
  return log;
}
const a = delve(host()), b = delve(host());
assert.deepEqual(JSON.stringify(a), JSON.stringify(b), 'two hosts agree tick for tick');

// Walls hold: a body pushed into rock comes back out onto the floor.
{
  const game = host(); steps(game, 200); put(game, 'h1', site.mouth[0], site.mouth[1]); steps(game, 2);
  const st = S(game), run = st.underways.runs[0], [ox, oz] = slotOrigin(run.slot), d = generateUnderway(run.seed, {style: run.style, depth: run.depth});
  const e0 = d.rooms[0], q = [ox + d.entry.x, 0, oz + (e0.y1 + 1 - GRID / 2) * TILE + .12]; // just through the south wall
  resolveUnderway(st, q, .3); const [i, j] = tileAt(q[0] - ox, q[2] - oz); assert.ok(floorTile(d, i, j), 'pushed back to floor');
  // An abandoned run closes after a while and takes its foes with it.
  put(game, 'h1', 0, 6); steps(game, UNDERWAYS.emptyClose + 2);
  assert.equal(S(game).underways.runs.length, 0); assert.equal(S(game).underways.delves[site.id] ?? 0, 0, 'abandoning does not reroll');
}
console.log(`underways: ${UNDERWAY_STYLES.length * 80} dungeons valid (worst ${worst.toFixed(1)} ms), full delve deterministic, ${(performance.now() - t0).toFixed(0)} ms`);
