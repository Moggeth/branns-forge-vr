// The Warband: Dawnhold Forgelings a God musters and commands from above, who escort their Hero below.
// Shared, deterministic rules only (no clock, no RNG, no Three.js). A Forgeling is an entry in state.enemies
// with side 'party' and a `warband` record, so combat, remains and interpolation work as for every creature;
// the rules here decide where it goes and what it fights. Orders are per unit:
//   follow  stay in formation behind the owner's Hero, and fight what threatens it (the default)
//   move    march to a point without stopping to fight, then hold there
//   hold    guard a point: fight anything that comes close, then return to it
//   attack  chase one named foe until it falls, then hold where it fell
//   gather  work the trees or rocks round a point: fell, chop and quarry, haul each load to the Forge or the
//           owner's Hero, and go back for more until the area is bare (an order on a tree or rock gives this)
import {depositReward} from './material-catalog.js';

export const WARBAND = Object.freeze({
 perOwner: 6,          // living Forgelings one player commands (phone and Quest crowd budget)
 muster: 3,            // Forgelings one Muster call brings down
 landTicks: 54,        // dropping out of the forge-light: no steering or swings until they have landed
 hp: 100,              // skeleton-rig body: the same hit parts and part health as a skeleton
 damage: 14,           // one hammer blow
 walk: 2.6,            // m/s at a march
 jog: 4.6,             // m/s catching up with a Hero who has run ahead
 followAggro: 10,      // following: fight foes this close to the Hero...
 followLeash: 16,      // ...and give up a chase once this far from the Hero
 holdAggro: 9,         // holding: fight foes this close to the held point...
 holdLeash: 13,        // ...and walk back once a chase drags this far from it
 arrive: 1.6,          // a move order ends this close to its point (walkers stop 1.5 m short of a goal)
 slot: 1.6,            // spacing between Forgelings in a formation or at a move point
 area: 22,             // gathering: work sources this close to the ordered point
 pick: 3.2,            // an order this close to a tree's trunk (or 2.6 to a rock or log) is a gathering order
 grab: 2.2,            // a log or pile this close is picked up
 drop: 2.6,            // a load this close to the Forge's apron or the Hero is handed over
 forgeDrop: 4.6,       // the Forge's apron, metres from its centre
 haul: 6,              // most of one pile a Forgeling carries
 defend: 4,            // a gatherer only fights foes this close to itself
});
export const WARBAND_ORDERS = Object.freeze(['follow', 'move', 'hold', 'attack', 'gather']);
/** Gathering jobs, by the resource they bring home (wire keys: wood = Timber, gems = Crystal). */
export const WARBAND_JOBS = Object.freeze(['wood', 'iron', 'gems']);
const JOB_PILES = Object.freeze({wood: ['wood'], iron: ['ironOre'], gems: ['gems']});
const CARGO_KINDS = Object.freeze(['wood', 'ironOre', 'gems']);
const SOURCE_TYPES = Object.freeze(['tree', 'ore', 'log', 'pile']);
const jobOfRock = d => d.kind === 'iron' ? 'iron' : d.kind === 'crystal' ? 'gems' : null;
const jobOfPile = q => CARGO_KINDS.includes(q.kind) ? (q.kind === 'ironOre' ? 'iron' : q.kind) : null;

const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const finite = n => typeof n === 'number' && Number.isFinite(n);
const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
const point = v => Array.isArray(v) && v.length === 3 && v.every(finite);

export const warbandUnit = e => !!e?.warband;
/** The Forgelings `ownerId` commands, alive, in a stable order (formation slots follow it). */
export function warbandOf(state, ownerId) {
 return state.enemies.filter(e => e.warband?.owner === ownerId && e.hp > 0).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
export const warbandRoom = (state, ownerId) => Math.max(0, WARBAND.perOwner - warbandOf(state, ownerId).length);
export const warbandLanded = (e, tick) => tick - (e.warband?.born ?? -1e9) >= WARBAND.landTicks;

/** Offsets for n bodies round a point: a centre, then a ring, so a group never piles onto one spot. */
export function formationOffsets(n, spacing = WARBAND.slot) {
 const ring = (count, r, from = 0) => Array.from({length: count}, (_, k) => { const a = from + k / count * Math.PI * 2; return [+(Math.sin(a) * r).toFixed(3), +(Math.cos(a) * r).toFixed(3)]; });
 if (n <= 1) return n ? [[0, 0]] : [];
 if (n <= 4) return ring(n, spacing * .62, Math.PI); // a small knot: two side by side, a triangle, a square
 const inner = Math.min(6, n - 1);
 return [[0, 0], ...ring(inner, spacing), ...ring(n - 1 - inner, spacing * 2, Math.PI / 6)];
}
/** Where follower `index` of `count` stands behind a Hero facing `yaw` (the Hero looks along -sin, -cos). */
export function followSlot(hero, index, count) {
 const row = Math.floor(index / 3), inRow = Math.min(3, count - row * 3), col = index % 3 - (inRow - 1) / 2;
 const back = 2 + row * WARBAND.slot, side = col * WARBAND.slot, s = Math.sin(hero.yaw || 0), c = Math.cos(hero.yaw || 0);
 // Behind is +sin,+cos; the Hero's right is -cos,+sin.
 return [hero.position[0] + s * back - c * side, hero.position[1], hero.position[2] + c * back + s * side];
}

export function createForgeling(id, position, owner, tick, side = 'party') {
 return {id, position: [...position], kind: 'skeleton', side, yaw: 0, hp: WARBAND.hp,
  parts: {head: 55, torso: 100, leftArm: 55, rightArm: 55, leftLeg: 55, rightLeg: 55}, missingParts: [], attackTick: -1000,
  warband: {owner, born: tick, order: {kind: 'follow'}}};
}

/**
 * Muster: bring down up to WARBAND.muster Forgelings round `at`, never past the owner's cap or the world's.
 * ctx: {terrainHeight(state,x,z), clamp(v), worldRoom}. Returns the new units (already in state.enemies).
 */
export function musterWarband(state, owner, id, at, ctx) {
 const n = Math.min(WARBAND.muster, warbandRoom(state, owner.id), Math.max(0, ctx.worldRoom));
 const offsets = formationOffsets(n), out = [];
 for (let i = 0; i < n; i++) {
  const x = ctx.clamp(at[0] + offsets[i][0]), z = ctx.clamp(at[2] + offsets[i][1]);
  const unit = createForgeling(`${id}_${i}`, [x, ctx.terrainHeight(state, x, z), z], owner.id, state.tick, owner.side || 'party');
  // Face the God's Hero if there is one below, otherwise face the way the view looks.
  unit.yaw = owner.yaw || 0;
  state.enemies.push(unit); out.push(unit);
 }
 return out;
}

/**
 * Order the owner's Forgelings. message: {order, units?, point?, target?}. Units default to every Forgeling the
 * player commands. Move and hold points spread the group round the point. Returns {ok, code?, events}.
 */
export function warbandAction(state, p, message, ctx) {
 const fail = code => ({ok: false, code, events: []});
 const kind = message.order;
 if (!WARBAND_ORDERS.includes(kind)) return fail('invalid_order');
 if (message.units !== undefined && (!Array.isArray(message.units) || message.units.length > WARBAND.perOwner || !message.units.every(validId))) return fail('invalid_order');
 const mine = warbandOf(state, p.id), units = message.units ? mine.filter(e => message.units.includes(e.id)) : mine;
 if (!units.length) return fail('no_warband');
 let target = null, at = null;
 if (kind === 'attack') {
  if (!validId(message.target)) return fail('invalid_order');
  target = state.enemies.find(e => e.id === message.target && e.hp > 0);
  if (!target || (target.side !== undefined && target.side === (p.side || 'party')) || target.kind === 'stumpling') return fail('invalid_target');
 }
 if (kind === 'move' || kind === 'hold' || kind === 'gather') {
  if (!point(message.point) || Math.abs(message.point[0]) > ctx.reach || Math.abs(message.point[2]) > ctx.reach) return fail('invalid_order');
  at = message.point;
 }
 // A march order on a tree, rock, log or pile sets the group to work there (as right-clicking a tree does in an RTS).
 const source = kind === 'move' || kind === 'gather' ? sourceAt(state, at, ctx.trees) : null;
 if (kind === 'gather' && !source) return fail('invalid_target');
 if (source) {
  // Everyone starts on the source that was clicked; once it is spent they spread to the nearest others round it.
  const spot = [source.position[0], ctx.terrainHeight(state, source.position[0], source.position[2]), source.position[2]];
  for (const e of units) e.warband.order = {kind: 'gather', job: source.job, point: [...spot], target: source.id, type: source.type, at: [...spot]};
  return {ok: true, events: [{kind: 'warband_order', by: p.id, order: 'gather', job: source.job, units: units.map(e => e.id), position: [...at]}]};
 }
 const offsets = formationOffsets(units.length);
 // Nearest first takes the first slot, so a group moves without crossing over itself.
 const order = at ? [...units].sort((a, b) => flat(a.position, at) - flat(b.position, at) || (a.id < b.id ? -1 : 1)) : units;
 order.forEach((e, i) => {
  if (kind === 'attack') e.warband.order = {kind, target: target.id};
  else if (kind === 'follow') e.warband.order = {kind};
  else { const x = ctx.clamp(at[0] + offsets[i][0]), z = ctx.clamp(at[2] + offsets[i][1]); e.warband.order = {kind, point: [x, ctx.terrainHeight(state, x, z), z]}; }
 });
 return {ok: true, events: [{kind: 'warband_order', by: p.id, order: kind, units: units.map(e => e.id), ...(at ? {position: [...at]} : {}), ...(target ? {target: target.id, position: [...target.position]} : {})}]};
}

// ---- Gathering.
const standing = (state, tree) => { const cut = state.harvestedTrees.find(c => c.id === tree.id); return !cut || (cut.cuts < 3 && !cut.awake); };
/** Every source for `job` within `radius` of `at`: piles and logs first (wood already cut), then rocks and trees. */
function sources(state, job, at, radius, trees) {
 const out = [], near = q => flat(q, at) <= radius;
 for (const q of state.pickups) if (jobOfPile(q) === job && !q.id.startsWith('ingot') && !q.id.startsWith('gift') && (!q.side || q.side === 'party') && near([q.x, 0, q.z])) out.push({id: q.id, type: 'pile', position: [q.x, q.y ?? 0, q.z], job});
 if (job === 'wood') {
  for (const l of state.looseLogs || []) if (!l.heldBy && near(l.position)) out.push({id: l.id, type: 'log', position: [...l.position], job});
  for (const t of trees?.all() || []) if (near([t.x, 0, t.z]) && standing(state, t)) out.push({id: t.id, type: 'tree', position: [t.x, 0, t.z], job});
 } else for (const d of state.deposits) if (!d.depleted && jobOfRock(d) === job && near([d.x, 0, d.z])) out.push({id: d.id, type: 'ore', position: [d.x, 0, d.z], job});
 return out;
}
/** The source an order point lands on, if any: a rock, log or pile within 2.6 m, else a trunk within 3.2 m. */
export function sourceAt(state, at, trees) {
 let best = null, d = Infinity;
 const consider = (c, reach) => { const k = flat(c.position, at); if (k <= reach && k < d) { d = k; best = c; } };
 for (const job of WARBAND_JOBS) for (const c of sources(state, job, at, WARBAND.pick, job === 'wood' ? null : trees)) consider(c, 2.6);
 if (!best) for (const c of sources(state, 'wood', at, WARBAND.pick, trees)) consider(c, c.type === 'tree' ? WARBAND.pick : 2.6);
 return best;
}
function findSource(state, e, type, id, trees) {
 if (type === 'ore') { const d = state.deposits.find(d => d.id === id); return d && !d.depleted ? {item: d, position: [d.x, 0, d.z]} : null; }
 if (type === 'log') { const l = (state.looseLogs || []).find(l => l.id === id); return l && !l.heldBy ? {item: l, position: l.position} : null; }
 if (type === 'pile') { const q = state.pickups.find(q => q.id === id); return q ? {item: q, position: [q.x, q.y ?? 0, q.z]} : null; }
 const t = trees?.get(id); return t && standing(state, t) ? {item: t, position: [t.x, 0, t.z]} : null;
}
/** Where a loaded Forgeling hands its load over: the owner's Hero if they are nearer, else the Forge's apron. */
export function warbandDrop(state, e) {
 const len = Math.hypot(e.position[0], e.position[2]) || 1, k = WARBAND.forgeDrop / len;
 const forge = [e.position[0] * k, 0, e.position[2] * k];
 const hero = state.players.find(p => p.id === e.warband.owner && p.role === 'hero' && p.hp > 0);
 return hero && flat(hero.position, e.position) < flat(forge, e.position) ? hero.position : forge;
}
const progress = new WeakMap(); // live-only steering memory: {id, best, ticks, avoid: Map<id, untilTick>}
/**
 * Once a tick, before steering: gatherers hand over loads, pick up logs and piles in reach, and choose what to work
 * next. ctx: {trees (createTreeIndex), terrainHeight(state,x,z)}.
 */
export function stepWarbandWork(state, ctx, events) {
 for (const e of state.enemies) {
  const o = e.warband?.order; if (o?.kind !== 'gather' || e.hp <= 0 || !warbandLanded(e, state.tick)) continue;
  const memo = progress.get(e) || {id: '', best: Infinity, ticks: 0, avoid: new Map()}; progress.set(e, memo);
  const w = e.warband;
  if (w.cargo) {
   const drop = warbandDrop(state, e); delete o.target; delete o.type; delete o.at;
   if (flat(drop, e.position) > WARBAND.drop) continue;
   const owner = state.players.find(p => p.id === w.owner); if (!owner) continue;
   owner.resources ||= {}; const n = Math.min(w.cargo.amount, Math.max(0, 999 - (owner.resources[w.cargo.kind] || 0)));
   if (n <= 0) continue; // the owner's stores are full: wait at the drop
   owner.resources[w.cargo.kind] = (owner.resources[w.cargo.kind] || 0) + n;
   (owner.stats ??= {kills: 0, deaths: 0, harvested: 0, contribution: 0}).harvested = Math.min(1e9, (owner.stats.harvested || 0) + n);
   events.push({kind: 'warband_delivery', id: e.id, by: w.owner, resource: w.cargo.kind, amount: n, position: [...e.position]});
   w.cargo.amount -= n; if (w.cargo.amount <= 0) delete w.cargo;
   continue;
  }
  let current = o.target ? findSource(state, e, o.type, o.target, ctx.trees) : null;
  if (current && memo.avoid.get(o.target) > state.tick) current = null;
  if (current) {
   // Stuck behind something on the way (there is no pathfinding): leave this one for a while and pick another.
   const d = flat(e.position, current.position);
   if (memo.id !== o.target) Object.assign(memo, {id: o.target, best: d, ticks: 0});
   else if (d < memo.best - .15) Object.assign(memo, {best: d, ticks: 0});
   else if (d > 3 && ++memo.ticks > 240) { memo.avoid.set(o.target, state.tick + 1200); current = null; }
  }
  if (current && (o.type === 'log' || o.type === 'pile') && flat(e.position, current.position) <= WARBAND.grab) {
   const at = [current.position[0], ctx.terrainHeight(state, current.position[0], current.position[2]), current.position[2]];
   if (o.type === 'log') { state.looseLogs.splice(state.looseLogs.indexOf(current.item), 1); w.cargo = {kind: 'wood', amount: 1}; }
   else { const q = current.item, n = Math.min(q.amount, WARBAND.haul); w.cargo = {kind: q.kind, amount: n}; q.amount -= n; if (q.amount <= 0) state.pickups.splice(state.pickups.indexOf(q), 1); }
   events.push({kind: 'pickup', id: o.target, by: e.id, position: at, material: w.cargo.kind});
   delete o.target; delete o.type; delete o.at; continue;
  }
  if (current) { o.at = [current.position[0], ctx.terrainHeight(state, current.position[0], current.position[2]), current.position[2]]; continue; }
  delete o.target; delete o.type; delete o.at;
  if ((state.tick + e.id.length * 7) % 15) continue; // look around a few times a second, not every tick
  // A trunk on its way down: wait for its logs rather than start on another tree.
  const falling = o.job === 'wood' && state.harvestedTrees.some(c => c.cuts >= 3 && !c.landed && ctx.trees?.get(c.id) && flat([ctx.trees.get(c.id).x, 0, ctx.trees.get(c.id).z], o.point) <= WARBAND.area);
  const taken = new Set(state.enemies.filter(u => u !== e && u.warband?.owner === w.owner && u.warband.order?.target).map(u => u.warband.order.target));
  const all = sources(state, o.job, o.point, WARBAND.area, falling ? null : ctx.trees), list = all.filter(c => !(memo.avoid.get(c.id) > state.tick));
  // Bare: stand guard there. Only sources it has given up on for now: wait at the point and try them again later.
  if (!list.length) { if (!falling && !all.length) e.warband.order = {kind: 'hold', point: [...o.point]}; continue; }
  // Nearest first, spread out: a source a teammate already works counts as six metres further (trees take a crew).
  const cost = c => flat(c.position, e.position) + (taken.has(c.id) ? (c.type === 'tree' || c.type === 'ore' ? 3 : 12) : 0) + (c.type === 'tree' ? 4 : 0);
  const pick = list.reduce((a, b) => cost(b) < cost(a) || (cost(b) === cost(a) && b.id < a.id) ? b : a);
  Object.assign(o, {target: pick.id, type: pick.type, at: [pick.position[0], ctx.terrainHeight(state, pick.position[0], pick.position[2]), pick.position[2]]});
 }
}
/**
 * A gatherer's swing lands on its tree or rock (called on the strike frame of its wind-up, so the blow and the chip
 * agree). ctx: {trees, terrainHeight(state,x,z,bridges?), chopTree(state,tree,point,normal,ctx), collapseMinedWall(state,ore)}.
 */
export function warbandStrike(state, e, ctx, events) {
 const o = e.warband?.order; if (o?.kind !== 'gather' || !o.target || e.warband.cargo) return;
 const found = findSource(state, e, o.type, o.target, ctx.trees); if (!found) { delete o.target; delete o.type; delete o.at; return; }
 const item = found.item, floor = ctx.terrainHeight(state, found.position[0], found.position[2], false);
 const dx = e.position[0] - found.position[0], dz = e.position[2] - found.position[2], d = Math.max(.001, Math.hypot(dx, dz)), normal = [dx / d, 0, dz / d];
 if (o.type === 'ore') {
  item.hits = Math.min(item.maxHits, item.hits + 1);
  events.push({kind: 'stone_hit', id: item.id, by: e.id, position: [item.x + normal[0] * .7, floor + .5, item.z + normal[2] * .7], normal, material: 'stone'});
  if (item.hits >= item.maxHits) {
   item.depleted = true; ctx.collapseMinedWall?.(state, item);
   const loot = depositReward(item.kind); e.warband.cargo = {kind: loot.kind, amount: Math.min(WARBAND.haul, loot.amount)}; delete o.target; delete o.type; delete o.at;
   events.push({kind: 'ore_break', id: item.id, by: e.id, position: [item.x, floor, item.z], material: e.warband.cargo.kind});
  }
  return;
 }
 if (o.type !== 'tree') return;
 const cut = state.harvestedTrees.find(c => c.id === item.id), height = cut?.cutHeight ?? floor + 1;
 const r = ctx.chopTree(state, item, [item.x + normal[0] * .25, height, item.z + normal[2] * .25], normal, {terrainHeight: (x, z) => ctx.terrainHeight(state, x, z, false)});
 if (r.code) { progress.get(e)?.avoid.set(item.id, state.tick + 1200); delete o.target; delete o.type; delete o.at; return; }
 events.push(...(r.events || []).map(ev => ({...ev, by: e.id})));
 if (r.events?.some(ev => ev.kind === 'tree_fell')) { delete o.target; delete o.type; delete o.at; }
}

/** A God who comes down to the land gathers the Forgelings left holding a point; marching and fighting ones carry on. */
export function rallyWarband(state, p) {
 for (const e of warbandOf(state, p.id)) if (e.warband.order.kind === 'hold') e.warband.order = {kind: 'follow'};
}

/**
 * Where a Forgeling heads this tick. foes: bodies it may fight (already filtered by side and space).
 * Returns {target, dist, patrol, speed}: patrol targets are places to walk to, not things to strike.
 */
export function warbandGoal(state, e, foes) {
 const order = e.warband.order || {kind: 'follow'};
 const nearest = (from, range) => {
  let best = null, d = Infinity;
  for (const f of foes) { const k = flat(f.position, from); if (k <= range && flat(f.position, e.position) < d) { d = flat(f.position, e.position); best = f; } }
  return best;
 };
 const go = (position, speed = WARBAND.walk) => ({target: {id: 'warband-point', position}, dist: flat(e.position, position), patrol: true, speed});
 const fight = f => ({target: f, dist: flat(e.position, f.position), patrol: false, speed: WARBAND.walk});
 if (order.kind === 'attack') {
  const foe = foes.find(f => f.id === order.target);
  if (foe) return fight(foe);
  e.warband.order = {kind: 'hold', point: [...e.position]}; // it fell (or slipped away): stand guard where the fight ended
  return warbandGoal(state, e, foes);
 }
 if (order.kind === 'move') {
  if (flat(e.position, order.point) <= WARBAND.arrive) { e.warband.order = {kind: 'hold', point: order.point}; return warbandGoal(state, e, foes); }
  return go(order.point);
 }
 if (order.kind === 'hold') {
  const foe = flat(e.position, order.point) <= WARBAND.holdLeash ? nearest(order.point, WARBAND.holdAggro) : null;
  return foe ? fight(foe) : go(order.point);
 }
 if (order.kind === 'gather') {
  const foe = nearest(e.position, WARBAND.defend); if (foe) return fight(foe); // set upon at work: fight back, then carry on
  const pace = p => flat(e.position, p) > 6 ? WARBAND.jog : WARBAND.walk;
  if (e.warband.cargo) { const drop = warbandDrop(state, e); return go(drop, pace(drop)); }
  if (!order.at) return go(order.point);
  if (order.type === 'tree' || order.type === 'ore') return {target: {id: order.target, position: order.at}, dist: flat(e.position, order.at), patrol: false, speed: pace(order.at), work: true, reach: order.type === 'ore' ? 2.7 : 2.3};
  return go(order.at, pace(order.at));
 }
 // follow: the owner's Hero, if they are on the land; a God's Forgelings stand guard where they are.
 const hero = state.players.find(p => p.id === e.warband.owner && p.role === 'hero' && p.hp > 0);
 if (!hero) { e.warband.order = {kind: 'hold', point: [...e.position]}; return warbandGoal(state, e, foes); }
 const team = warbandOf(state, hero.id), index = Math.max(0, team.indexOf(e));
 const foe = flat(e.position, hero.position) <= WARBAND.followLeash ? nearest(hero.position, WARBAND.followAggro) : null;
 if (foe) return fight(foe);
 const slot = followSlot(hero, index, team.length), far = flat(e.position, slot);
 return go(slot, far > 6 ? WARBAND.jog : WARBAND.walk);
}

// ---- Strict save validation and restore.
export function validWarband(e, tick, reach) {
 if (e.warband === undefined) return true;
 const w = e.warband, o = w?.order;
 if (!w || typeof w !== 'object' || !validId(w.owner) || !Number.isSafeInteger(w.born) || w.born < 0 || w.born > tick) return false;
 if (e.kind !== 'skeleton' || !['party', 'rivals'].includes(e.side) || e.battleRun !== undefined || e.hp > WARBAND.hp) return false;
 if (!o || typeof o !== 'object' || !WARBAND_ORDERS.includes(o.kind)) return false;
 const keys = Object.keys(o).sort().join();
 if (Object.keys(w).some(k => !['owner', 'born', 'order', 'cargo'].includes(k))) return false;
 if (w.cargo !== undefined && (!w.cargo || typeof w.cargo !== 'object' || !CARGO_KINDS.includes(w.cargo.kind) || !Number.isSafeInteger(w.cargo.amount) || w.cargo.amount < 1 || w.cargo.amount > WARBAND.haul || Object.keys(w.cargo).length !== 2)) return false; // a load kept through a change of orders is delivered on the next gather
 if (o.kind === 'follow') return keys === 'kind';
 if (o.kind === 'attack') return keys === 'kind,target' && validId(o.target);
 const inWorld = q => point(q) && Math.abs(q[0]) <= reach && Math.abs(q[2]) <= reach && Math.abs(q[1]) <= 400;
 if (o.kind === 'gather') {
  const working = o.target !== undefined;
  return keys === (working ? 'at,job,kind,point,target,type' : 'job,kind,point') && WARBAND_JOBS.includes(o.job) && inWorld(o.point) && (!working || (validId(o.target) && SOURCE_TYPES.includes(o.type) && inWorld(o.at)));
 }
 return keys === 'kind,point' && point(o.point) && Math.abs(o.point[0]) <= reach && Math.abs(o.point[2]) <= reach && Math.abs(o.point[1]) <= 400;
}
export const restoreWarband = w => {
 const o = w.order;
 const order = o.kind === 'gather' ? {kind: o.kind, job: o.job, point: [...o.point], ...(o.target !== undefined ? {target: o.target, type: o.type, at: [...o.at]} : {})}
  : o.point ? {kind: o.kind, point: [...o.point]} : o.target ? {kind: o.kind, target: o.target} : {kind: o.kind};
 return {owner: w.owner, born: w.born, order, ...(w.cargo ? {cargo: {kind: w.cargo.kind, amount: w.cargo.amount}} : {})};
};
