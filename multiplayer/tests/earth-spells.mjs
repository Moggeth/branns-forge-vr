// God's Raise Wall and Sunder (shared/earth-spells.js): timed geode rampart and crystal chasm.
// Run: node tests/earth-spells.mjs
import assert from 'node:assert/strict';
import * as T from 'three';
import {createSimulation, loadSimulation} from '../shared/simulation.js';
import {createEnemy} from '../shared/combat.js';
import {terrainHeight, moveOnTerrain, RAISE_WALL, SUNDER, earthLineSegments, TERRAIN_LIMITS} from '../shared/terrain.js';
import {planEarthLine} from '../shared/earth-spells.js';
import {createCrystalWall} from '../client/crystal-wall.js';

const started = performance.now();
const world = () => { const s = createSimulation({seed: 9}); s.addPlayer({id: 'g', role: 'god'}); s.addPlayer({id: 'h', role: 'hero'}); return s; };
const step = (s, n) => { const events = []; for (let i = 0; i < n; i++) events.push(...s.step()); return events; };
const ground = (s, x, z) => terrainHeight(s.snapshot(), x, z);
let seq = 0;
const cast = (s, spell, a, b, by = 'g') => { const w = s.adventureWorld(); w.players.find(p => p.id === by).mana = 100;
  return s.command(by, {type: 'cast', seq: ++seq, spell, point: [(a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2], start: [a[0], 0, a[1]], end: [b[0], 0, b[1]]}); };

// ---- Plan: both ends ramp, the middle reaches full height/depth, segments split the line evenly ----
{
  const p = planEarthLine('wall', [0, 0, 0], [12, 0, 0]);
  assert.equal(p.segments.length, earthLineSegments(12));
  assert.equal(p.segments[0].h0, RAISE_WALL.endHeight); assert.equal(p.segments.at(-1).h1, RAISE_WALL.endHeight);
  assert.ok(p.segments.some(q => q.h0 === RAISE_WALL.peak), 'a 12 m wall reaches full height');
  const c = planEarthLine('sunder', [0, 0], [3, 0]); assert.ok(c.segments.every(q => q.h0 < SUNDER.depth && q.h1 < SUNDER.depth), 'a short chasm stays shallow');
}

// ---- Raise Wall: rises with its front, blocks from the side, walkable from its ends ----
{
  const s = world(), w = s.adventureWorld(), base = ground(s, 24, -16);
  w.enemies.push(createEnemy('foe', [22, terrainHeight(w, 22, -16.2), -16.2]));
  const hero = w.players.find(p => p.id === 'h'); hero.position = [27, terrainHeight(w, 27, -16), -16]; hero.vy = 0;
  const r = cast(s, 'wall', [18, -16], [30, -16]); assert.equal(r.ok, true, r.code);
  const spell = r.events.find(e => e.kind === 'spell'); assert.ok(spell.rupture && spell.expireTick && spell.by === 'g');
  assert.equal(ground(s, 24, -16), base, 'no instant collision under the first frame');
  assert.equal(r.events.find(e => e.kind === 'god_gift')?.gift, 'quarry_wall');
  let launched = false, lifted = false;
  for (let i = 0; i < spell.rupture.durationTicks + 4; i++) { s.step(); const foe = s.snapshot().enemies.find(e => e.id === 'foe'); if (foe?.launchTick !== undefined) launched = true; if (s.adventureWorld().players.find(p => p.id === 'h').vy > 0) lifted = true; }
  const foe = s.snapshot().enemies.find(e => e.id === 'foe');
  assert.ok(launched && foe.hp < 100, 'the rising front hurts and throws an enemy');
  assert.ok(Math.abs(foe.position[2] + 16) > RAISE_WALL.width, `thrown clear of the footprint (${foe.position[2]})`);
  assert.ok(lifted, 'a Hero on the line is carried up onto the rampart');
  const crest = ground(s, 24, -16) - base; assert.ok(crest > RAISE_WALL.peak - .4, `crest ${crest}`);
  // From the side the face is too steep to walk up.
  const side = [24, terrainHeight(s.snapshot(), 24, -19), -19]; for (let i = 0; i < 120; i++) moveOnTerrain(s.snapshot(), side, 0, .05);
  assert.ok(side[2] < -16 - RAISE_WALL.width * .45, `face blocks walking (${side[2]})`);
  // From an end the ramp can be climbed.
  const end = [16.5, terrainHeight(s.snapshot(), 16.5, -16), -16]; for (let i = 0; i < 160; i++) { moveOnTerrain(s.snapshot(), end, .05, 0); end[1] = terrainHeight(s.snapshot(), end[0], end[2]); }
  assert.ok(end[0] > 21 && end[1] - base > 2.4, `ramp climbs onto the crest (${end[0].toFixed(2)}, ${(end[1] - base).toFixed(2)})`);
  // Mid-life save survives a round trip; corrupt descriptors are refused.
  const cp = s.checkpoint(), back = loadSimulation(JSON.parse(JSON.stringify(cp)));
  assert.deepEqual(back.snapshot(), s.snapshot());
  for (const bad of [c => c.edits.find(e => e.kind === 'wall').wall.h0 = 9, c => c.edits.find(e => e.kind === 'wall').radius = 2, c => c.edits.find(e => e.kind === 'wall').wall.expireTick += 99999])
  { const c = structuredClone(cp); bad(c); assert.throws(() => loadSimulation(c)); }
  // Quarrying one segment sinks only that segment, opening a breach.
  const segs = s.snapshot().deposits.filter(d => d.special === 'wall'); assert.equal(segs.length, earthLineSegments(12));
  const mid = segs[segs.length >> 1], other = segs[0];
  let q = s;
  for (let i = 0; i < mid.maxHits; i++) {
    const c = q.checkpoint(), h = c.players.find(p => p.id === 'h'); h.attackTick = -1000; h.tool = 'pick';
    h.position = [mid.x, terrainHeight(c, mid.x, mid.z - 2.4), mid.z - 2.4]; h.yaw = Math.PI; q = loadSimulation(c);
    const hit = q.command('h', {type: 'action', action: 'strike', seq: ++seq, tool: 'pick', targetId: mid.id, point: [mid.x, terrainHeight(q.snapshot(), mid.x, mid.z), mid.z], normal: [0, 1, 0]});
    assert.equal(hit.ok, true, hit.code);
  }
  assert.equal(q.snapshot().deposits.find(d => d.id === mid.id).depleted, true);
  step(q, RAISE_WALL.sinkTicks + 2);
  assert.ok(ground(q, mid.x, mid.z) - base < .6, 'quarried segment sank, opening a breach');
  assert.ok(ground(q, other.x + 1.2, other.z) - base > 1, 'neighbouring segment stands');
  // Expiry: shatter event, shards for the Heroes, terrain returns to the ground's own shape.
  const pickups = s.snapshot().pickups.length, startTick = spell.rupture.startTick;
  const events = step(s, startTick + RAISE_WALL.lifetimeTicks - s.snapshot().tick);
  assert.ok(events.some(e => e.kind === 'raise_wall_shatter' && e.reason === 'expired'));
  assert.ok(s.snapshot().pickups.length > pickups, 'a wall that stood its minute sheds shards');
  step(s, RAISE_WALL.sinkTicks + 1);
  assert.equal(s.snapshot().edits.filter(e => e.kind === 'wall').length, 0); assert.equal(s.snapshot().deposits.filter(d => d.special === 'wall').length, 0);
  assert.ok(Math.abs(ground(s, 24, -16) - base) < 1e-9, 'ground restored');
}

// ---- Standing limit: the oldest wall shatters when a God raises one too many ----
{
  const s = world();
  for (let i = 0; i < RAISE_WALL.standing; i++) assert.equal(cast(s, 'wall', [-30, -30 + i * 8], [-20, -30 + i * 8]).ok, true);
  const r = cast(s, 'wall', [20, 30], [30, 30]);
  assert.ok(r.events.some(e => e.kind === 'raise_wall_shatter' && e.reason === 'replaced'), 'oldest replaced, never refused');
}

// ---- Sunder: the chasm tears open on its front, wounds and staggers, closes after its lifetime ----
{
  const s = world(), w = s.adventureWorld(), base = ground(s, 24, 16), bankBase = ground(s, 24, 16 + (SUNDER.width + SUNDER.bankOut) / 2);
  w.enemies.push(createEnemy('foe', [24, terrainHeight(w, 24, 16), 16]));
  const r = cast(s, 'sunder', [18, 16], [30, 16]); assert.equal(r.ok, true, r.code);
  const spell = r.events.find(e => e.kind === 'spell');
  assert.equal(ground(s, 24, 16), base, 'no instant chasm');
  assert.ok(r.events.filter(e => e.gift === 'crystal_seam').length >= 1, 'crystal seams laid bare');
  step(s, spell.rupture.durationTicks + 2);
  const foe = s.snapshot().enemies.find(e => e.id === 'foe');
  assert.ok(foe.hp < 100 && foe.slowUntil > s.snapshot().tick, 'the front wounds and staggers an enemy on the line');
  assert.ok(base - ground(s, 24, 16) > 1.8, `chasm depth ${base - ground(s, 24, 16)}`);
  assert.ok(ground(s, 24, 16 + (SUNDER.width + SUNDER.bankOut) / 2) > bankBase + .1, 'spoil bank raised');
  // An end of the chasm is a walkable way out.
  const out = [24, ground(s, 24, 16), 16]; for (let i = 0; i < 300; i++) { moveOnTerrain(s.snapshot(), out, .05, 0); out[1] = terrainHeight(s.snapshot(), out[0], out[2]); }
  assert.ok(out[0] > 30, `walked out of the chasm end (${out[0].toFixed(2)})`);
  assert.deepEqual(loadSimulation(JSON.parse(JSON.stringify(s.checkpoint()))).snapshot(), s.snapshot());
  const seams = s.snapshot().deposits.filter(d => d.kind === 'crystal').length;
  const events = step(s, spell.rupture.startTick + SUNDER.lifetimeTicks - s.snapshot().tick + SUNDER.sinkTicks + 1);
  assert.ok(events.some(e => e.kind === 'sunder_close'));
  assert.ok(Math.abs(ground(s, 24, 16) - base) < 1e-9, 'chasm closed');
  assert.equal(s.snapshot().deposits.filter(d => d.kind === 'crystal').length, seams, 'its crystal seams stay to be mined');
}

// ---- Legacy permanent kernels from older saves still load and keep their shape ----
{
  const s = world(), cp = s.checkpoint();
  cp.edits.push({id: 'oldw', kind: 'wall', x: 10, z: 30, radius: 2.5, height: 1.5}, {id: 'olds', kind: 'sunder', x: -10, z: 30, radius: 2.5, height: -1.5});
  const l = loadSimulation(cp); assert.ok(terrainHeight(l.snapshot(), 10, 30) - terrainHeight(s.snapshot(), 10, 30) > 1.2);
}

// ---- Presentation: one rampart and one chasm, bounded draws, exact tick posing ----
{
  const s = world(); cast(s, 'wall', [18, -16], [30, -16]); cast(s, 'sunder', [18, 16], [30, 16]); step(s, 140);
  const scene = new T.Scene(), view = createCrystalWall({THREE: T, scene, height: (x, z, edits) => terrainHeight({...s.snapshot(), edits}, x, z)});
  view.sync(s.snapshot()); view.update(1 / 60, s.snapshot().tick);
  const st = view.stats();
  assert.equal(st.walls, 2); assert.ok(st.crystals > 60 && st.plates > 20, JSON.stringify(st));
  assert.ok(st.draws <= 2 * 5 + 3, `draws ${st.draws}`);
  assert.ok(scene.getObjectByName('RaiseWall_' + s.snapshot().edits.find(e => e.kind === 'wall').rupture.id), 'rampart group');
  assert.ok(scene.getObjectByName('SunderChasm_' + s.snapshot().edits.find(e => e.kind === 'sunder').rupture.id), 'chasm group');
  const targets = view.targets(); assert.ok(targets.length > 0, 'rampart is quarry-targetable');
  view.dispose(); assert.equal(scene.children.length, 0);
}
console.log(JSON.stringify({suite: 'earth-spells', pass: true, elapsedSeconds: (performance.now() - started) / 1000}));
