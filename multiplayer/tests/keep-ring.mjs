// Ring keeps (2026-10-08): each keep sits in a bowl carved out of its corner mountains, its buildings on a half ring
// round the heart, with a narrow pass leading back to a hollow. Nothing overlaps, every building stands on level
// ground, the ground under the ring is flat, and the pass is walkable while the cliffs either side are not.
import assert from 'node:assert/strict';
import {HOME_LAYOUT as L, HOME_SITES, homePoint} from '../shared/home-bases.js';
import {KEEP_CARVE, keepCarve} from '../shared/keep-sites.js';
import {baseHeight} from '../shared/terrain.js';

let count = 0;
const test = (name, fn) => { fn(); count++; console.log('PASS', name); };
// [name, base-local centre, footprint radius] for everything that stands in the keep.
const items = [['heart', [0, 0], 4.3], ['barracks', L.barracks, 4.5], ['fountain', L.fountain, 2.6], ['tavern', L.tavern.at, 4.5],
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
    for (let a = 0; a < 12; a++) { const h = baseHeight(x + Math.cos(a) * r, z + Math.sin(a) * r); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    const flat = Math.hypot(...p) + r < KEEP_CARVE.bowl ? .1 : .3; // the gate ballistas stand out on the rolling meadow
    assert.ok(hi - lo < flat, `${side} ${name} ground varies ${(hi - lo).toFixed(2)} m`);
    assert.ok(Math.max(Math.abs(x), Math.abs(z)) < 55, `${side} ${name} inside the map`);
  }
});

test('a narrow pass leads back from each keep to a hollow, walled by cliffs', () => {
  for (const [sx, sz] of Object.values(HOME_SITES)) {
    const l = Math.hypot(sx, sz), bx = sx / l, bz = sz / l, rx = -bz, rz = bx; // back toward the corner, and across
    const at = (back, side) => [sx + bx * back + rx * side, sz + bz * back + rz * side];
    const floor = baseHeight(sx, sz);
    for (let back = 0; back <= KEEP_CARVE.hollow.at; back += .5) {
      const [x, z] = at(back, 0); assert.ok(Math.abs(baseHeight(x, z) - floor) < .35, `pass floor at ${back} m`);
    }
    const [cx, cz] = at(KEEP_CARVE.pass.to - 1, KEEP_CARVE.pass.half + KEEP_CARVE.pass.blend + 2.5);
    assert.ok(baseHeight(cx, cz) - floor > 5, 'cliffs stand either side of the pass');
    assert.equal(keepCarve(...at(KEEP_CARVE.hollow.at, 0)), 1, 'the hollow is open ground');
    const [hx, hz] = at(KEEP_CARVE.hollow.at, 0); assert.ok(Math.max(Math.abs(hx), Math.abs(hz)) < 55, 'the hollow is inside the map');
  }
});

test('the open meadow away from the keeps is untouched by the carve', () => {
  assert.equal(keepCarve(0, 0), 0); assert.equal(keepCarve(-34, 34), 0); assert.equal(keepCarve(50, -50), 0);
});

console.log(`keep-ring: ${count} checks passed`);
