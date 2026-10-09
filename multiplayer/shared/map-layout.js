// Map layout overrides, written by the local map editor (map-editor/index.html, never deployed). An empty `moves`
// leaves every placement exactly where the code authors it. Each key names one placement and its value replaces it
// in that placement's own frame:
//   keep.*      keep-local point [x, y] or town piece {at, face} (shared/home-bases.js HOME_LAYOUT), both keeps mirror it
//   town.*      back-town piece {at, face} or lantern [u, v] in corner coordinates (shared/keep-sites.js), both corners
//   mug         The Muddled Mug {at: [x, z], yaw} in world space
//   site.<id>   a landmark's shift {dx, dz} in metres; its footprints and the end of its path move with it
//   tree<n>, ore<n>  a starting tree or ore deposit's world [x, z] (new worlds only; saved deposits keep their spot)
// Pure data and maths: no clocks, randomness or DOM.
import layout from './map-layout.json' with {type: 'json'};

const LIMIT = 80;
const finite = v => Number.isFinite(v) && Math.abs(v) <= LIMIT;
const pair = v => Array.isArray(v) && v.length === 2 && v.every(finite);
const isPoint = v => pair(v);
const isPiece = v => !!v && typeof v === 'object' && pair(v.at) && pair(v.face);
const frozenPair = v => Object.freeze([+v[0], +v[1]]);

export const MAP_MOVES = Object.freeze({...(layout && typeof layout.moves === 'object' && !Array.isArray(layout.moves) ? layout.moves : {})});
// What the code authored before any override, by key, so the editor can show and reset the original spot.
export const AUTHORED = {};

/** Overrides one value (a point or a piece) when the move has the same shape; anything malformed is ignored. */
export function moved(id, value, moves = MAP_MOVES) {
  if (!(id in AUTHORED)) AUTHORED[id] = value;
  const m = moves[id];
  if (m === undefined) return value;
  if (isPoint(value) && isPoint(m)) return frozenPair(m);
  if (isPiece(value) && isPiece(m)) return Object.freeze({at: frozenPair(m.at), face: frozenPair(m.face)});
  return value;
}
/** A frozen table of points, point lists and pieces with every entry passed through moved(prefix.key[.n]). */
export function movedTable(prefix, table, skip = [], moves = MAP_MOVES) {
  const out = {};
  for (const [key, value] of Object.entries(table)) {
    if (skip.includes(key)) out[key] = value;
    else if (Array.isArray(value) && value.length && Array.isArray(value[0])) out[key] = Object.freeze(value.map((p, n) => moved(`${prefix}.${key}.${n}`, p, moves)));
    else out[key] = moved(`${prefix}.${key}`, value, moves);
  }
  return Object.freeze(out);
}
/** A list of points, each passed through moved(prefix.n). */
export const movedList = (prefix, list, moves = MAP_MOVES) => Object.freeze(list.map((p, n) => moved(`${prefix}.${n}`, p, moves)));
/** A world placement {at: [x, z], yaw}. */
export function movedPlaced(id, value, moves = MAP_MOVES) {
  if (!(id in AUTHORED)) AUTHORED[id] = value;
  const m = moves[id];
  return m && pair(m.at) && Number.isFinite(m.yaw) ? Object.freeze({at: frozenPair(m.at), yaw: +m.yaw}) : value;
}
/** A landmark's [dx, dz] shift ([0, 0] when unmoved). */
export function siteShift(id, moves = MAP_MOVES) {
  const m = moves[`site.${id}`];
  return m && finite(m.dx) && finite(m.dz) ? [+m.dx, +m.dz] : [0, 0];
}
/** A landmark path follows its site: the far end moves the whole shift, the Forge end stays, points between ease. */
export function shiftPath(points, [dx, dz]) {
  if (!dx && !dz) return points;
  const n = points.length - 1;
  return points.map(([x, z], i) => { const w = n ? i / n : 1; return [+(x + dx * w).toFixed(3), +(z + dz * w).toFixed(3)]; });
}
/** A landmark site (shared or client copy) with its centre and footprints shifted. */
export function shiftSite(site, moves = MAP_MOVES) {
  const [dx, dz] = siteShift(site.id, moves);
  if (!dx && !dz) return site;
  return {...site, x: +(site.x + dx).toFixed(3), z: +(site.z + dz).toFixed(3), footprints: (site.footprints || []).map(f => ({...f, x: f.x + dx, z: f.z + dz}))};
}
