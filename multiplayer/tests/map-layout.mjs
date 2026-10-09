// Map layout overrides (shared/map-layout.js) and the local map editor's model (map-editor/model.js):
// an empty layout changes nothing, moves land where the editor showed them, and a committed layout only names real
// placements with well-formed values.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AUTHORED, MAP_MOVES, moved, movedPlaced, movedTable, shiftPath, shiftSite} from '../shared/map-layout.js';
import {HOME_LAYOUT, NEUTRAL_TAVERN, homePiece} from '../shared/home-bases.js';
import * as M from '../map-editor/model.js';
const turn = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

// Overrides keep each placement's shape and ignore anything malformed.
const table = {a: [1, 2], list: [[0, 0], [1, 1]], piece: {at: [3, 4], face: [0, 0]}};
const out = movedTable('t', table, [], {'t.a': [5, 6], 't.list.1': [7, 8], 't.piece': {at: [9, 9], face: [1, 1]}, 't.list.0': {at: [1, 1]}});
assert.deepEqual(out.a, [5, 6]);
assert.deepEqual(out.list, [[0, 0], [7, 8]]);
assert.deepEqual(out.piece, {at: [9, 9], face: [1, 1]});
assert.deepEqual(moved('t2', [1, 1], {t2: [NaN, 3]}), [1, 1], 'non-finite values are ignored');
assert.deepEqual(moved('t3', [1, 1], {t3: [500, 3]}), [1, 1], 'far-off values are ignored');
assert.deepEqual(movedPlaced('m', {at: [1, 2], yaw: 0}, {m: {at: [3, 4], yaw: 1}}), {at: [3, 4], yaw: 1});
assert.deepEqual(shiftPath([[0, 0], [2, 0], [4, 0]], [2, 4]), [[0, 0], [3, 2], [6, 4]], 'the Forge end stays, the far end follows');
const site = shiftSite({id: 's1', x: 1, z: 1, footprints: [{x: 2, z: 3}]}, {'site.s1': {dx: 1, dz: -1}});
assert.deepEqual([site.x, site.z, site.footprints[0].x, site.footprints[0].z], [2, 0, 3, 2]);

// The editor sees every authored placement, and the committed layout only moves things it knows about.
const items = M.buildItems(), keys = new Set(items.map(i => i.key));
assert.ok(items.length >= 50, `editor lists ${items.length} placements`);
for (const key of Object.keys(MAP_MOVES)) assert.ok(keys.has(key), `map-layout.json moves an unknown placement: ${key}`);
const file = JSON.parse(readFileSync(new URL('../shared/map-layout.json', import.meta.url), 'utf8'));
assert.equal(file.version, 1);
// With no moves for a key, the game's table is exactly what the code authored.
for (const it of items) if (!(it.key in MAP_MOVES) && it.kind !== 'shift') assert.deepEqual(it.value, it.authored, `${it.key} unchanged`);
if (!('keep.tavern' in MAP_MOVES)) assert.deepEqual(HOME_LAYOUT.tavern, AUTHORED['keep.tavern']);
if (!('mug' in MAP_MOVES)) assert.deepEqual(NEUTRAL_TAVERN.at, [6, -28]);

// What the editor shows is where the game puts it: the editor's placement of a keep piece matches homePiece().
const byKey = new Map(items.map(i => [i.key, i])), tavern = byKey.get('keep.tavern');
for (const side of M.SIDES) {
  const a = M.placement(tavern, side), b = homePiece(side, 'tavern');
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 1e-6 && turn(a.yaw, b.yaw) < 1e-6, `${side} tavern placement`);
}
// Moving one keep's copy mirrors into the other, keeps its facing, and survives the round trip through the layout file.
const r0 = M.placement(tavern, 'rivals'), p0 = M.placement(tavern, 'party');
M.moveTo(tavern, 'rivals', r0.x + 2, r0.z - 1, byKey);
const r1 = M.placement(tavern, 'rivals'), p1 = M.placement(tavern, 'party');
assert.ok(Math.abs(r1.x - r0.x - 2) < .01 && Math.abs(r1.z - r0.z + 1) < .01, 'moved where dropped');
assert.ok(Math.abs(Math.hypot(p1.x - p0.x, p1.z - p0.z) - Math.hypot(2, 1)) < .01, 'twin moved the same distance');
assert.ok(turn(r1.yaw, r0.yaw) < .01, 'facing kept');
M.turnTo(tavern, 'party', p1.yaw + .4);
assert.ok(turn(M.placement(tavern, 'party').yaw, p1.yaw + .4) < .01, 'turned');
const moves = M.exportMoves(items);
assert.deepEqual(movedTable('keep', {tavern: tavern.authored}, [], moves).tavern, tavern.value);
// Gate pillars travel with the gate.
const gate = byKey.get('keep.gate'), pillar = byKey.get('keep.gatePillars.0'), g0 = M.placement(gate, 'party'), q0 = M.placement(pillar, 'party');
M.moveTo(gate, 'party', g0.x + 1.5, g0.z, byKey);
const q1 = M.placement(pillar, 'party');
assert.ok(Math.abs(q1.x - q0.x - 1.5) < .01 && Math.abs(q1.z - q0.z) < .01, 'pillar followed the gate');
// The overlap check flags a building dropped on another.
const mill = byKey.get('keep.mill'), m = M.placement(mill, 'party');
M.moveTo(tavern, 'party', m.x + 1, m.z, byKey);
assert.ok(M.overlaps(M.instances(items)).some(o => [o.a.it.key, o.b.it.key].includes('keep.mill') && [o.a.it.key, o.b.it.key].includes('keep.tavern')), 'tavern on mill is flagged');
console.log(`map layout: ${items.length} editable placements, ${Object.keys(MAP_MOVES).length} moved in the layout file`);
