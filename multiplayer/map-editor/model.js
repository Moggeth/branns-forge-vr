// Map editor model: every movable placement on the map, where it stands in the world, its footprint, and the
// overlap and cliff checks. Pure (no DOM) so node tests can drive it. Reads the shared layout tables exactly as the
// game does, so what you see here is what the game builds.
import {HOME, HOME_LAYOUT, HOME_SCALE, HOME_SITES, NEUTRAL_TAVERN, TOWN_SOLIDS, homeFrame, homePoint, pieceWorld} from '../shared/home-bases.js';
import {BACK_TOWN, BACK_TOWN_LANTERNS, WORLD_EXTENT, backTownPoint, beyondWorld} from '../shared/keep-sites.js';
import {BACK_TOWN_SOLIDS} from '../shared/home-workshop.js';
import {STARTING_SITES, STARTING_PATHS} from '../shared/starting-world.js';
import {baseTrees, initialDeposits} from '../shared/world-content.js';
import {AUTHORED, EXTRA_KINDS, MAP_EXTRAS, MAP_MOVES, shiftPath, siteShift} from '../shared/map-layout.js';
import {EXTRA_BUILDINGS} from '../shared/map-extras.js';
import {baseHeight} from '../shared/terrain.js';

export {HOME, HOME_SITES, WORLD_EXTENT, baseHeight};
export const SIDES = ['party', 'rivals'];
const S = HOME_SCALE;
const round = v => +(+v).toFixed(3);
const clone = v => JSON.parse(JSON.stringify(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- the catalogue
// frame: 'keep' (keep-local, mirrored to both keeps), 'town' (corner coordinates, both corners) or 'world'.
// kind: 'point' [x, y], 'piece' {at, face}, 'placed' {at, yaw}, 'shift' {dx, dz} (landmarks).
// shape: footprint in the item's own frame, a list of {at, r} circles and {at, half} boxes (or a site's boxes).
const circle = r => [{at: [0, 0], r}];
const KEEP_POINTS = {
  barracks: ['Barracks', 3.2 * S], fountain: ['Fountain', 1.9 * S],
  pylons: ['Pylon', 1.1 * S], spires: ['Crystal spire', 1.2 * S], ballistas: ['Ballista', 2.2 * S],
  gate: ['Gate', .6], gatePillars: ['Gate pillar', .9 * S], wards: ['Ward stone', .45],
};
const KEEP_PIECES = {tavern: 'Tavern', mill: 'Mill', quartermaster: 'Quartermaster'};
const TOWN_NAMES = {workshop: 'Workshop', stores: 'Stores', cottage: 'Cottage', cottage2: 'Cottage (inner)', well: 'Well'};
const SITE_NAMES = {sanctuary: 'Ancient Stone Sanctuary', outcrop: 'Crystal Outcrop', watcharch: 'Ruined Watch-Arch'};

export function buildItems() {
  const items = [];
  const add = it => { items.push({authored: clone(it.value), rotatable: it.kind === 'piece' || it.kind === 'placed', ...it, value: clone(it.value)}); };
  const authored = key => AUTHORED[key];
  for (const [key, [label, r]] of Object.entries(KEEP_POINTS)) {
    const v = HOME_LAYOUT[key];
    if (Array.isArray(v[0])) v.forEach((p, n) => add({key: `keep.${key}.${n}`, label: `${label} ${n + 1}`, group: 'keep', frame: 'keep', kind: 'point', value: p, authoredValue: authored(`keep.${key}.${n}`), shape: circle(r)}));
    else add({key: `keep.${key}`, label, group: 'keep', frame: 'keep', kind: 'point', value: v, authoredValue: authored(`keep.${key}`), shape: circle(r),
      carry: key === 'gate' ? ['keep.gatePillars.0', 'keep.gatePillars.1'] : undefined});
  }
  for (const [key, label] of Object.entries(KEEP_PIECES)) add({key: `keep.${key}`, label, group: 'keep', frame: 'keep', kind: 'piece', value: HOME_LAYOUT[key], authoredValue: authored(`keep.${key}`), shape: TOWN_SOLIDS[key]});
  for (const [key, label] of Object.entries(TOWN_NAMES)) add({key: `town.${key}`, label, group: 'town', frame: 'town', kind: 'piece', value: BACK_TOWN[key], authoredValue: authored(`town.${key}`), shape: BACK_TOWN_SOLIDS[key]});
  BACK_TOWN_LANTERNS.forEach((p, n) => add({key: `town.lanterns.${n}`, label: `Lantern ${n + 1}`, group: 'town', frame: 'town', kind: 'point', value: p, authoredValue: authored(`town.lanterns.${n}`), shape: circle(.2)}));
  add({key: 'mug', label: 'The Muddled Mug', group: 'mug', frame: 'world', kind: 'placed', value: NEUTRAL_TAVERN, authoredValue: authored('mug'), shape: TOWN_SOLIDS.neutralTavern});
  for (const site of STARTING_SITES) {
    const [dx, dz] = siteShift(site.id);
    add({key: `site.${site.id}`, label: SITE_NAMES[site.id] || site.name, group: 'landmark', frame: 'world', kind: 'shift', value: {dx, dz}, authoredValue: {dx: 0, dz: 0},
      origin: [site.x - dx, site.z - dz], radius: site.radius,
      boxes: site.footprints.map(f => ({at: [f.x - dx - (site.x - dx), f.z - dz - (site.z - dz)], half: [f.w / 2, f.d / 2], yaw: f.rotY}))});
  }
  baseTrees.forEach(([x, z], i) => add({key: `tree${i + 1}`, label: `Tree ${i + 1}`, group: 'tree', frame: 'world', kind: 'point', value: [x, z], authoredValue: authored(`tree${i + 1}`), shape: circle(.8)}));
  initialDeposits().forEach(d => add({key: d.id, label: `${d.kind[0].toUpperCase()}${d.kind.slice(1)} ore (${d.id})`, group: 'ore', frame: 'world', kind: 'point', value: [d.x, d.z], authoredValue: authored(d.id), shape: circle(1.3)}));
  for (const it of items) { if (it.authoredValue !== undefined) it.authored = clone(it.authoredValue); delete it.authoredValue; }
  for (const e of MAP_EXTRAS) items.push(extraItem(e));
  return items;
}

// ---------------------------------------------------------------- extras (the build menu)
export const PALETTE = Object.freeze([
  {kind: 'cottage', label: 'Cottage', group: 'Buildings'}, {kind: 'cottageB', label: 'Cottage (wide)', group: 'Buildings'},
  {kind: 'well', label: 'Well', group: 'Buildings'}, {kind: 'lantern', label: 'Lantern post', group: 'Buildings'},
  {kind: 'tree', label: 'Tree', group: 'Nature'},
  {kind: 'stone', label: 'Stone boulder', group: 'Ore'}, {kind: 'iron', label: 'Iron seam', group: 'Ore'},
  {kind: 'mithril', label: 'Mithril seam', group: 'Ore'}, {kind: 'crystal', label: 'Crystal growth', group: 'Ore'},
]);
const EXTRA_SHAPE = kind => EXTRA_BUILDINGS[kind] ?? circle(kind === 'tree' ? .8 : 1.3);
const ORE_KINDS = ['stone', 'iron', 'mithril', 'crystal'];
export function extraItem(e) {
  const p = PALETTE.find(q => q.kind === e.kind), value = {x: e.x, z: e.z, yaw: e.yaw ?? 0, ...(e.style ? {style: e.style} : {}), ...(e.height ? {height: e.height} : {})};
  return {key: e.id, label: `${p?.label ?? e.kind} (new)`, group: ORE_KINDS.includes(e.kind) ? 'ore' : e.kind === 'tree' ? 'tree' : 'extra', extraKind: e.kind,
    frame: 'world', kind: 'extra', value, authored: null, rotatable: e.kind !== 'tree', removable: true, shape: EXTRA_SHAPE(e.kind)};
}
/** A new extra of `kind` at (x, z), with the next free id. */
export function addExtra(items, kind, x, z, yaw = 0, extra = {}) {
  if (!EXTRA_KINDS.includes(kind)) throw Error(`unknown kind ${kind}`);
  let n = 1; const used = new Set(items.map(i => i.key)); while (used.has(`x${n}`)) n++;
  const it = extraItem({id: `x${n}`, kind, x: round(x), z: round(z), yaw: round(yaw), ...extra});
  items.push(it); return it;
}
export const exportExtras = items => items.filter(i => i.kind === 'extra').map(i => ({id: i.key, kind: i.extraKind, x: round(i.value.x), z: round(i.value.z), yaw: round(i.value.yaw),
  ...(i.value.style ? {style: i.value.style} : {}), ...(i.value.height ? {height: i.value.height} : {})}));

// Fixed things drawn for reference but not moved here: each keep's heart and dome, and the Forge in the middle.
export const FIXED = [
  ...SIDES.map(side => ({label: side === 'party' ? 'Dawnhold heart' : 'Grumblekeep heart', at: homePoint(side, [0, 0]), r: 3.2 * S, side})),
  {label: 'The Forge', at: [0, 0], r: 2.6},
];

// ---------------------------------------------------------------- frames
const yawToward = (x, z, fx, fz) => Math.atan2(fx - x, fz - z);
function keepLocal(side, [wx, wz]) {
  const {centre, forward, right} = homeFrame(side), dx = wx - centre[0], dz = wz - centre[1];
  return [dx * right[0] + dz * right[1], dx * forward[0] + dz * forward[1]];
}
const toWorldPoint = (frame, side, p) => frame === 'keep' ? homePoint(side, p) : frame === 'town' ? backTownPoint(side, p) : [p[0], p[1]];
const toFramePoint = (frame, side, w) => frame === 'keep' ? keepLocal(side, w) : frame === 'town' ? backTownPoint(side, w) : [w[0], w[1]];
/** The sides an item appears on: both keeps for keep and town pieces, one world copy otherwise. */
export const sidesOf = it => it.frame === 'world' ? [null] : SIDES;

/** World placement {x, z, yaw} of one copy of an item. */
export function placement(it, side) {
  const v = it.value;
  if (it.kind === 'point') { const [x, z] = toWorldPoint(it.frame, side, v); return {x, z, yaw: 0}; }
  if (it.kind === 'piece') { const [x, z] = toWorldPoint(it.frame, side, v.at), [fx, fz] = toWorldPoint(it.frame, side, v.face); return {x, z, yaw: yawToward(x, z, fx, fz)}; }
  if (it.kind === 'placed') return {x: v.at[0], z: v.at[1], yaw: v.yaw};
  if (it.kind === 'extra') return {x: v.x, z: v.z, yaw: v.yaw};
  return {x: it.origin[0] + v.dx, z: it.origin[1] + v.dz, yaw: 0};
}
/** Same for the authored (unmoved) spot. */
export const authoredPlacement = (it, side) => placement({...it, value: it.authored}, side);

/** Moves one copy of an item so it stands at world (wx, wz); the item's other copy mirrors it. Returns carried keys. */
export function moveTo(it, side, wx, wz, byKey) {
  const before = placement(it, side);
  if (it.kind === 'point') it.value = toFramePoint(it.frame, side, [wx, wz]).map(round);
  else if (it.kind === 'piece') {
    // Keep the front facing the same way: the face point travels with the piece.
    const [fx, fz] = toWorldPoint(it.frame, side, it.value.face);
    it.value = {at: toFramePoint(it.frame, side, [wx, wz]).map(round), face: toFramePoint(it.frame, side, [fx + wx - before.x, fz + wz - before.z]).map(round)};
  } else if (it.kind === 'placed') it.value = {at: [round(wx), round(wz)], yaw: it.value.yaw};
  else if (it.kind === 'extra') it.value = {...it.value, x: round(wx), z: round(wz)};
  else it.value = {dx: round(wx - it.origin[0]), dz: round(wz - it.origin[1])};
  for (const key of it.carry || []) {
    const other = byKey?.get(key); if (!other) continue;
    const p = placement(other, side); moveTo(other, side, p.x + wx - before.x, p.z + wz - before.z, byKey);
  }
}
/** Turns one copy of an item to a world yaw (three.js: front +Z turned by yaw). Pieces and the Mug only. */
export function turnTo(it, side, yaw) {
  if (it.kind === 'placed') { it.value = {at: it.value.at, yaw: round(yaw)}; return; }
  if (it.kind === 'extra') { it.value = {...it.value, yaw: round(Math.atan2(Math.sin(yaw), Math.cos(yaw)))}; return; }
  if (it.kind !== 'piece') return;
  const {x, z} = placement(it, side), [fx, fz] = toWorldPoint(it.frame, side, it.value.face);
  const d = Math.max(4, Math.hypot(fx - x, fz - z));
  it.value = {at: it.value.at, face: toFramePoint(it.frame, side, [x + Math.sin(yaw) * d, z + Math.cos(yaw) * d]).map(round)};
}

// ---------------------------------------------------------------- footprints and checks
// World shapes for one copy: circles {x, z, r} and boxes {x, z, yaw, hu, hv}.
export function footprint(it, side) {
  const pl = placement(it, side);
  if (it.kind === 'shift') return it.boxes.map(b => ({x: pl.x + b.at[0], z: pl.z + b.at[1], yaw: b.yaw, hu: b.half[0], hv: b.half[1]}));
  return it.shape.map(s => {
    const [x, z] = pieceWorld(pl, s.at);
    return s.r !== undefined ? {x, z, r: s.r} : {x, z, yaw: pl.yaw, hu: s.half[0], hv: s.half[1]};
  });
}
const local = (b, x, z) => { const c = Math.cos(b.yaw), s = Math.sin(b.yaw), dx = x - b.x, dz = z - b.z; return [dx * c - dz * s, dx * s + dz * c]; };
function boxCircle(b, x, z, r) {
  const [u, v] = local(b, x, z), qu = Math.abs(u) - b.hu, qv = Math.abs(v) - b.hv;
  return Math.hypot(Math.max(qu, 0), Math.max(qv, 0)) + Math.min(Math.max(qu, qv), 0) - r;
}
export const boxCorners = b => { const c = Math.cos(b.yaw), s = Math.sin(b.yaw); return [[-b.hu, -b.hv], [b.hu, -b.hv], [b.hu, b.hv], [-b.hu, b.hv]].map(([u, v]) => [b.x + u * c + v * s, b.z - u * s + v * c]); };
/** Signed gap between two world shapes (negative = how deep they overlap). */
export function gap(a, b) {
  if (a.r !== undefined && b.r !== undefined) return Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r;
  if (a.r === undefined && b.r !== undefined) return boxCircle(a, b.x, b.z, b.r);
  if (a.r !== undefined) return boxCircle(b, a.x, a.z, a.r);
  return Math.min(...boxCorners(a).map(([x, z]) => boxCircle(b, x, z, 0)), ...boxCorners(b).map(([x, z]) => boxCircle(a, x, z, 0)),
    Math.hypot(a.x - b.x, a.z - b.z) - Math.min(a.hu, a.hv) - Math.min(b.hu, b.hv));
}
const reach = s => s.r ?? Math.hypot(s.hu, s.hv);

// A building's whole floor (the box round all its solids), so it can be grabbed by its open middle too.
function floor(it, pl) {
  if (it.kind !== 'piece' && it.kind !== 'placed') return null;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const s of it.shape) { const [hu, hv] = s.r !== undefined ? [s.r, s.r] : s.half; u0 = Math.min(u0, s.at[0] - hu); u1 = Math.max(u1, s.at[0] + hu); v0 = Math.min(v0, s.at[1] - hv); v1 = Math.max(v1, s.at[1] + hv); }
  const [x, z] = pieceWorld(pl, [(u0 + u1) / 2, (v0 + v1) / 2]);
  return {x, z, yaw: pl.yaw, hu: (u1 - u0) / 2, hv: (v1 - v0) / 2};
}
/** Every placed copy with its footprint: [{it, side, shapes, x, z, r}]. */
export function instances(items) {
  const out = [];
  for (const it of items) for (const side of sidesOf(it)) {
    const shapes = footprint(it, side), pl = placement(it, side);
    out.push({it, side, shapes, floor: floor(it, pl), x: pl.x, z: pl.z, r: Math.max(...shapes.map(s => Math.hypot(s.x - pl.x, s.z - pl.z) + reach(s)))});
  }
  for (const f of FIXED) out.push({it: {key: `fixed.${f.label}`, label: f.label, group: 'fixed'}, side: f.side ?? null, shapes: [{x: f.at[0], z: f.at[1], r: f.r}], x: f.at[0], z: f.at[1], r: f.r, fixed: true});
  return out;
}
const lanternLike = i => /^town\.lanterns|^keep\.wards/.test(i.it.key);
/** Overlapping pairs ({a, b, depth}) between different placements (a gate carries its pillars, so those pairs are fine). */
export function overlaps(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (a.it === b.it) continue;
    if (Math.hypot(a.x - b.x, a.z - b.z) > a.r + b.r) continue;
    if ((a.it.carry || []).includes(b.it.key) || (b.it.carry || []).includes(a.it.key)) continue;
    if (a.fixed && b.fixed) continue;
    let depth = 0;
    for (const sa of a.shapes) for (const sb of b.shapes) depth = Math.max(depth, -gap(sa, sb));
    if (depth > (lanternLike(a) || lanternLike(b) ? .02 : .05)) out.push({a, b, depth});
  }
  return out;
}
/** Placements standing on a slope steeper than they can sit on, or outside the walkable world. */
export function badGround(list) {
  const out = [];
  for (const p of list) {
    if (p.fixed) continue;
    if (beyondWorld(p.x, p.z, 50)) { out.push({p, why: 'outside the map'}); continue; }
    if (p.it.kind === 'shift') continue; // landmarks sit on whatever the meadow is
    const r = Math.min(p.r, p.it.kind === 'piece' ? 1.2 : 3.5); // buildings may back onto a cliff; their middle must be level
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2, h = baseHeight(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    if (hi - lo > Math.max(.6, r * .45)) out.push({p, why: `on a ${(hi - lo).toFixed(1)} m slope`});
  }
  return out;
}

// ---------------------------------------------------------------- paths and export
/** Landmark paths as the game will lay them for the current shifts. */
export function paths(items) {
  return STARTING_PATHS.map(p => {
    const id = p.id.replace(/^to-/, ''), it = items.find(i => i.key === `site.${id}`), now = siteShift(id);
    const shift = it ? [it.value.dx - now[0], it.value.dz - now[1]] : [0, 0];
    return {...p, points: shiftPath(p.points, shift)}; // STARTING_PATHS already carry the saved shift
  });
}
/** The moves table for shared/map-layout.json: only what differs from the code's authored spot. */
export function exportMoves(items) {
  const moves = {};
  // Keep keys this editor doesn't know about (written by a newer editor or by hand).
  const known = new Set(items.map(i => i.key));
  for (const [k, v] of Object.entries(MAP_MOVES)) if (!known.has(k)) moves[k] = v;
  for (const it of items) if (it.kind !== 'extra' && !same(it.value, it.authored)) moves[it.key] = clone(it.value);
  return moves;
}
export function layoutFile(items) {
  const extras = exportExtras(items);
  return JSON.stringify({version: 1, moves: exportMoves(items), ...(extras.length ? {extras} : {})}, null, 2) + '\n';
}

// Lookups the 3D view needs to draw the authored starting trees and ore, and the landmark shift already saved.
export const treeHeight = key => baseTrees[+key.slice(4) - 1]?.[2] ?? 6;
const DEPOSIT_KINDS = new Map(initialDeposits().map(d => [d.id, d.kind]));
export const oreKind = key => DEPOSIT_KINDS.get(key) ?? 'stone';
export const savedShift = id => siteShift(id);
