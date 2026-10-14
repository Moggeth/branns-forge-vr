// Ring keeps (2026-10-08): each keep sits in a bowl carved out of its corner mountains, its buildings on a half ring
// round the heart, with a narrow pass leading back to a walled back town in the corner (past the old map edge). Nothing overlaps, every building stands on level
// ground, the ground under the ring is flat, and the town is reachable only up the pass.
import assert from 'node:assert/strict';
import {HOME_LAYOUT as L, HOME_SITES, TAVERN_SCALE, homePiece, homePoint, pieceWorld} from '../shared/home-bases.js';
import {KEEP_CARVE, WORLD_EXTENT, backTownPiece, keepCarve, onKeepGround} from '../shared/keep-sites.js';
import {BACK_TOWN_SOLIDS, STORES, WORKSHOP, backTownSpot, resolveBackTowns} from '../shared/home-workshop.js';
import {baseHeight, moveOnTerrain} from '../shared/terrain.js';
import {coveCarve} from '../shared/larimar-cove.js';
const liveState = {battle: {v: 2, status: 'running'}};

let count = 0;
const test = (name, fn) => { fn(); count++; console.log('PASS', name); };
// [name, base-local centre, footprint radius] for everything that stands in the keep.
const items = [['heart', [0, 0], 4.3], ['barracks', L.barracks, 4.5], ['fountain', L.fountain, 2.6], ['tavern', L.tavern.at, 4.5 * TAVERN_SCALE],
  ['mill', L.mill.at, 3.2], ['quartermaster', L.quartermaster.at, 2.8], ['gate', L.gate, 2],
  ...L.pylons.map((p, i) => [`pylon${i}`, p, 1.2]), ...L.spires.map((p, i) => [`spire${i}`, p, 1.5]),
  ...L.ballistas.map((p, i) => [`ballista${i}`, p, 1.6]), ...L.wards.map((p, i) => [`ward${i}`, p, .6])];

test('nothing in the keep overlaps anything else', () => {
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const [a, pa, ra] = items[i], [b, pb, rb] = items[j];
    assert.ok(Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) >= ra + rb, `${a} overlaps ${b}`);
  }
});

test('the town buildings stand on a half ring behind the heart', () => {
  for (const name of ['barracks', 'tavern', 'mill', 'quartermaster']) {
    const at = name === 'barracks' ? L.barracks : L[name].at, r = Math.hypot(...at);
    assert.ok(r > 12 && r < 16.5, `${name} on the ring (${r.toFixed(1)} m)`);
    assert.ok(at[1] < 1, `${name} sits on the back half`);
  }
});

test('every piece stands on level ground inside the carved bowl, in both keeps', () => {
  for (const side of ['party', 'rivals']) for (const [name, p, r] of items) {
    const [x, z] = homePoint(side, p); let lo = Infinity, hi = -Infinity;
    // The tavern is a long hall (its circle overstates it): sample its real floor, walls to porch, instead.
    const hall = name === 'tavern' && homePiece(side, 'tavern'), k = TAVERN_SCALE;
    const ring = hall ? [...Array(48)].map((_, i) => pieceWorld(hall, [(i % 8 / 7 - .5) * 8.5 * k, (Math.floor(i / 8) / 5 * 6.95 - 3.25) * k]))
      : [...Array(12)].map((_, a) => [x + Math.cos(a) * r, z + Math.sin(a) * r]);
    for (const [px, pz] of ring) { const h = baseHeight(px, pz); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    const flat = hall || Math.hypot(...p) + r < KEEP_CARVE.bowl ? .1 : .3; // the gate ballistas stand out on the rolling meadow
    assert.ok(hi - lo < flat, `${side} ${name} ground varies ${(hi - lo).toFixed(2)} m`);
    assert.ok(Math.max(Math.abs(x), Math.abs(z)) < 55, `${side} ${name} inside the map`);
  }
});

test('a narrow pass leads back from each keep into its back town, walled by cliffs', () => {
  for (const [sx, sz] of Object.values(HOME_SITES)) {
    const g = Math.sign(sx), l = Math.hypot(sx, sz), bx = sx / l, bz = sz / l, rx = -bz, rz = bx; // back toward the corner, and across
    const at = (back, side) => [sx + bx * back + rx * side, sz + bz * back + rz * side];
    const floor = baseHeight(sx, sz);
    for (let back = 0; back <= KEEP_CARVE.pass.to; back += .5) {
      const [x, z] = at(back, 0); assert.ok(Math.abs(baseHeight(x, z) - floor) < .35, `pass floor at ${back} m`);
    }
    const [cx, cz] = at(KEEP_CARVE.pass.to - 6, KEEP_CARVE.pass.half + KEEP_CARVE.pass.blend + 2.5);
    assert.ok(baseHeight(cx, cz) - floor > 5, 'cliffs stand either side of the pass');
    const {from, to} = KEEP_CARVE.town;
    for (let u = from + 1; u <= to - 1; u += 1) for (let v = from + 1; v <= to - 1; v += 1) {
      assert.equal(keepCarve(g * u, g * v), 1, `town ground open at ${u},${v}`);
      assert.ok(Math.abs(baseHeight(g * u, g * v) - floor) < .5, `town floor level at ${u},${v}`);
    }
    // Larimar Cove (2026-10-10) opens off the town's inner side, so a wall point inside the cove is checked past the cove's far shore instead
    for (const [u, v] of [[(from + to) / 2, from - 4], [from - 4, (from + to) / 2], [(from + to) / 2, to + 2.5], [to + 2.5, (from + to) / 2]]) {
      const [wu, wv] = coveCarve(g * u, g * v) > 0 ? [u, from - 14] : [u, v];
      assert.equal(coveCarve(g * wu, g * wv), 0, `wall point ${wu},${wv} lies outside the cove`);
      assert.ok(baseHeight(g * wu, g * wv) - floor > 8, `the town is walled in at ${wu},${wv}`);
    }
    assert.ok(Math.max(Math.abs(g * to), Math.abs(g * to)) < WORLD_EXTENT, 'the town stays inside the world');
  }
});

test('walking reaches the back town only through the pass', () => {
  const state = {edits: [], tick: 0};
  const walk = (from, to, steps = 900) => {
    const p = [from[0], baseHeight(...from), from[1]];
    for (let i = 0; i < steps; i++) {
      const dx = to[0] - p[0], dz = to[1] - p[2], d = Math.hypot(dx, dz); if (d < .2) break;
      moveOnTerrain(state, p, dx / d * .1, dz / d * .1); p[1] = baseHeight(p[0], p[2]);
    }
    return p;
  };
  for (const side of ['party', 'rivals']) {
    const g = side === 'rivals' ? 1 : -1, [sx, sz] = HOME_SITES[side], town = [g * 60, g * 60];
    // Straight up the pass from the heart: arrives.
    let p = walk([sx, sz], [g * 55.5, g * 55.5]); p = walk([p[0], p[2]], town);
    assert.ok(Math.hypot(p[0] - town[0], p[2] - town[1]) < .5, `${side}: the pass leads into the town (stopped at ${p[0].toFixed(1)}, ${p[2].toFixed(1)})`);
    // Back out again, and to every building's door.
    p = walk(town, [sx + g * 8, sz + g * 8]); assert.ok(Math.hypot(p[0] - sx - g * 8, p[2] - sz - g * 8) < .5, `${side}: and back out to the keep`);
    // From the open meadow and the bowl's rim, heading straight at the town: the old edge and the cliffs stop you.
    for (const from of [[g * 45, g * 20], [g * 20, g * 45], [g * 48, g * 5], [g * 5, g * 48], [g * 49, g * 30], [g * 30, g * 49]]) {
      const q = walk(from, town), u = q[0] * g, v = q[2] * g;
      assert.ok(u < KEEP_CARVE.town.from - 1 || v < KEEP_CARVE.town.from - 1, `${side}: no way round from ${from} (reached ${q[0].toFixed(1)}, ${q[2].toFixed(1)})`);
    }
  }
});

test('the back town buildings stand apart, on the town floor, inside the world', () => {
  const placed = Object.keys(BACK_TOWN_SOLIDS);
  const disc = name => { const sol = BACK_TOWN_SOLIDS[name]; let r = 0; for (const q of sol) r = Math.max(r, Math.hypot(...q.at) + (q.r ?? Math.hypot(...q.half))); return r; };
  for (const side of ['party', 'rivals']) {
    for (const name of placed) {
      const {x, z} = backTownPiece(side, name), r = disc(name);
      for (let a = 0; a < 16; a++) {
        const px = x + Math.cos(a / 16 * Math.PI * 2) * r * .8, pz = z + Math.sin(a / 16 * Math.PI * 2) * r * .8;
        assert.ok(onKeepGround(px, pz), `${side} ${name} sits on carved ground`);
      }
    }
    for (const name of placed) for (const q of BACK_TOWN_SOLIDS[name]) { // every footprint really blocks
      const [x, z] = backTownSpot(side, name, q.at), probe = [x, 0, z]; resolveBackTowns(liveState, probe, 0);
      assert.ok(Math.hypot(probe[0] - x, probe[2] - z) > 0, `${side} ${name} solid at ${q.at} blocks`);
    }
    const pa = Object.fromEntries(placed.map(n => [n, backTownPiece(side, n)]));
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
      const a = pa[placed[i]], b = pa[placed[j]];
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= disc(placed[i]) * .62 + disc(placed[j]) * .62, `${side} ${placed[i]} crowds ${placed[j]}`);
    }
    // Every door and the Workshop's anvil can be stood at.
    for (const [name, spot] of [['workshop', WORKSHOP.anvil], ['stores', STORES.door]]) {
      const [x, z] = backTownSpot(side, name, spot), at = backTownSpot(side, name, [spot[0], spot[1] + 1.2]);
      const probe = [at[0], 0, at[1]]; resolveBackTowns(liveState, probe);
      assert.ok(Math.hypot(probe[0] - at[0], probe[2] - at[1]) < 1e-9, `${side} ${name}: you can stand in front of it`);
      assert.ok(onKeepGround(x, z), `${side} ${name} spot on carved ground`);
    }
  }
});

test('the back town is only solid while the keep battle runs', () => {
  const [x, z] = backTownSpot('party', 'well', [0, 0]), probe = [x, 0, z];
  resolveBackTowns({battle: null}, probe); assert.deepEqual([probe[0], probe[2]], [x, z]);
  resolveBackTowns(liveState, probe); assert.ok(Math.hypot(probe[0] - x, probe[2] - z) >= 1.29);
});

test('the open meadow away from the keeps is untouched by the carve', () => {
  assert.equal(keepCarve(0, 0), 0); assert.equal(keepCarve(-34, 34), 0); assert.equal(keepCarve(50, -50), 0);
});

console.log(`keep-ring: ${count} checks passed`);
