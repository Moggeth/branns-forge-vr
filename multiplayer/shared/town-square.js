// The town square: the ring round each keep's heart forge, where Heroes spawn, dressed as a friendly market square.
// Cobbles round the heart, string lights from the heart's crown to ribboned poles, and four hands-on stalls built in
// Blender (assets/square-20261023 -> /assets/square_kit.glb):
//   trainer  a training ring: two straw dummies to whack and a coach who opens your weapon talents
//   bakery   a baker's cart beside a glowing bread oven: a free apple, straight into your hand (three bites of health)
//   stage    the bard's stage: ask for a tune and the square bobs along
//   board    the welcome board: town news (the patch notes) and a signpost
// Placements are keep-local like shared/home-bases.js HOME_LAYOUT (x right of the gate, y out of the gate) and can be
// moved by the local map editor (shared/map-layout.js, keys square.*); both keeps mirror them.
// Pure simulation rules: fixed ticks, no clocks, rendering or random streams.
import {homeBattle, homePoint, pieceWorld, pieceLocal} from './home-bases.js';
import {handApple} from './fruit.js';
import {nextEntityId} from './entity-id.js';
import {movedTable} from './map-layout.js';

const P = (x, y) => Object.freeze([x, y]);
const piece = (at, face) => Object.freeze({at: Object.freeze(at), face: Object.freeze(face)});
const HEART = P(0, 0);
export const SQUARE_LAYOUT = movedTable('square', {
  trainer: piece(P(6.6, -7.6), HEART),
  bakery: piece(P(-8.7, -3.4), HEART),
  stage: piece(P(6.5, 6.5), HEART),
  board: piece(P(3.7, 10.1), P(0, 7)),
  // Ribboned poles the string lights run to from the heart's crown; clear of the gate road, the pass and every stall.
  poles: Object.freeze([P(4.4, 12.4), P(-4.4, 12.4), P(10.2, 8.2), P(-10.6, 4.9), P(3.7, -10.9), P(-3.7, -10.9)]),
});
export const SQUARE = Object.freeze({
  radius: 13.5,        // cobbles reach this far from the heart (the dome is 18.5)
  edge: 1.6,           // and fade into the grass over this
  innerRadius: 4.2,    // the heart's own plinth
  reach: 2.6,          // how close a Hero must stand to a stall to use it
  heartCrown: 5.0,     // the string lights start this high above the heart
  songs: 4,
});
// Where each stall is used, in its own frame (three.js x, z): the bakery's counter, the bard on the stage's front edge,
// the coach by the talent board, the face of the welcome board.
export const SQUARE_SPOTS = Object.freeze({
  bakery: P(.4, 1.2), stage: P(0, 2.1), trainer: P(.2, 1.4), board: P(0, .9),
});
// Solid parts in each piece's own frame (three.js x, z), in the shape TOWN_SOLIDS uses: boxes {at, half}, circles {at, r}.
// The training ring's sanded floor and the open front of everything stay walkable.
export const SQUARE_SOLIDS = Object.freeze({
  trainer: Object.freeze([{at: [-1.25, .35], r: .32}, {at: [1.25, .45], r: .32}, {at: [0, -1.35], half: [1.1, .3]}, {at: [-1.75, -.95], r: .45},
    {at: [2.15, -1.25], r: .12}, {at: [1.1, -1.7], r: .1}]),
  bakery: Object.freeze([{at: [.4, -.1], half: [1.6, .82]}, {at: [-2, -.5], r: .75}, {at: [2.35, -.1], half: [.45, .6]}, {at: [2.35, -1], r: .3}]),
  stage: Object.freeze([{at: [0, 0], r: 1.7}]),
  board: Object.freeze([{at: [0, 0], half: [1.15, .15]}, {at: [1.5, -.2], r: .12}]),
});
export const SQUARE_PIECES = Object.freeze(['trainer', 'bakery', 'stage', 'board']);

const sideKey = side => side === 'rivals' ? 'rivals' : 'party';
/** World placement {x, z, yaw} of a square piece; its front (+Z) looks at its face point. */
export function squarePiece(side, name) {
  const {at, face} = SQUARE_LAYOUT[name], [x, z] = homePoint(sideKey(side), at), [fx, fz] = homePoint(sideKey(side), face);
  return {x, z, yaw: Math.atan2(fx - x, fz - z)};
}
export const squareSpot = (side, name) => pieceWorld(squarePiece(side, name), SQUARE_SPOTS[name]);
export const squarePoles = side => SQUARE_LAYOUT.poles.map(p => homePoint(sideKey(side), p));
/** 1 on the cobbles, 0 beyond them, smooth across the edge. */
export function squareCover(side, x, z) {
  const [cx, cz] = homePoint(sideKey(side), HEART), d = Math.hypot(x - cx, z - cz);
  return d <= SQUARE.radius - SQUARE.edge ? 1 : d >= SQUARE.radius ? 0 : (SQUARE.radius - d) / SQUARE.edge;
}
/** Which keep's square (x, z) is on, if any. */
export function squareAt(x, z) {
  for (const side of ['party', 'rivals']) if (squareCover(side, x, z) > 0) return side;
  return null;
}

/** Hero spawn: a step out from the heart on the gate side, looking into the square at the heart. */
export function squareSpawnYaw(side, position) {
  const [hx, hz] = homePoint(sideKey(side), HEART);
  return Math.atan2(position[0] - hx, position[2] - hz);
}

function pushOut(position, placed, solids, radius) {
  for (const sol of solids) {
    const [u, v] = pieceLocal(placed, [position[0], position[2]]), [cu, cv] = sol.at;
    let nu = u, nv = v;
    if (sol.r !== undefined) {
      const du = u - cu, dv = v - cv, d = Math.hypot(du, dv), min = sol.r + radius;
      if (d >= min) continue;
      if (d > 1e-4) { nu = cu + du / d * min; nv = cv + dv / d * min; } else nu = cu + min;
    } else {
      const hu = sol.half[0] + radius, hv = sol.half[1] + radius, du = u - cu, dv = v - cv;
      if (Math.abs(du) >= hu || Math.abs(dv) >= hv) continue;
      if (hu - Math.abs(du) < hv - Math.abs(dv)) nu = cu + Math.sign(du || 1) * hu; else nv = cv + Math.sign(dv || 1) * hv;
    }
    [position[0], position[2]] = pieceWorld(placed, [nu, nv]);
  }
}
/** Keeps bodies out of the stalls, the stage and the poles. Mutates position in place. */
export function resolveSquare(state, position, radius = .3) {
  if (!homeBattle(state)) return position;
  for (const side of ['party', 'rivals']) {
    const [cx, cz] = homePoint(side, HEART);
    if (Math.abs(position[0] - cx) > 16 || Math.abs(position[2] - cz) > 16) continue;
    for (const name of SQUARE_PIECES) pushOut(position, squarePiece(side, name), SQUARE_SOLIDS[name], radius);
    for (const [x, z] of squarePoles(side)) {
      const dx = position[0] - x, dz = position[2] - z, d = Math.hypot(dx, dz), min = .25 + radius;
      if (d < min && d > 1e-4) { position[0] = x + dx / d * min; position[2] = z + dz / d * min; }
    }
  }
  return position;
}
/** The same solids as plain shapes, for routing (shared/home-bases.js homeSolids shape). */
export function squareSolids(side) {
  const out = [], tag = `square-${sideKey(side)}`;
  for (const name of SQUARE_PIECES) {
    const placed = squarePiece(side, name);
    SQUARE_SOLIDS[name].forEach((q, n) => {
      if (q.r !== undefined) { const [x, z] = pieceWorld(placed, q.at); out.push({id: `${tag}-${name}-${n}`, x, z, r: q.r}); }
      else out.push({id: `${tag}-${name}-${n}`, x: placed.x, z: placed.z, yaw: placed.yaw, at: q.at, half: q.half});
    });
  }
  // the poles route as thin posts (a single peg the cable bends round), like the other slim posts in the keep
  squarePoles(side).forEach(([x, z], n) => out.push({id: `${tag}-pole-${n}`, x, z, r: .12}));
  return out;
}

export const isSquareAction = action => action === 'squareApple' || action === 'squareTune';
/** The bakery hands over an apple; the bard strikes up a tune. Either keep's square serves anyone standing there. */
export function squareAction(state, p, m) {
  const fail = code => ({ok: false, code, events: []});
  if (!homeBattle(state)) return fail('battle_inactive');
  if (p.role !== 'hero' || p.hp <= 0) return fail('hero_required');
  const name = m.action === 'squareApple' ? 'bakery' : 'stage';
  const side = ['party', 'rivals'].find(s => { const [x, z] = squareSpot(s, name); return Math.hypot(p.position[0] - x, p.position[2] - z) <= SQUARE.reach; });
  if (!side) return fail('too_far');
  if (name === 'bakery') {
    const [x, z] = squareSpot(side, 'bakery');
    return handApple(state, {nextId: nextEntityId}, p, [x, p.position[1] + 1.1, z]);
  }
  const [x, z] = squareSpot(side, 'stage');
  return {ok: true, events: [{kind: 'square_tune', side, by: p.id, song: state.tick % SQUARE.songs, position: [x, p.position[1] + 1.4, z]}]};
}
