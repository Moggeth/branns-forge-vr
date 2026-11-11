// The Warband: Dawnhold Forgelings a God musters and commands from above, who escort their Hero below.
// Shared, deterministic rules only (no clock, no RNG, no Three.js). A Forgeling is an entry in state.enemies
// with side 'party' and a `warband` record, so combat, remains and interpolation work as for every creature;
// the rules here decide where it goes and what it fights. Orders are per unit:
//   follow  stay in formation behind the owner's Hero, and fight what threatens it (the default)
//   move    march to a point without stopping to fight, then hold there
//   hold    guard a point: fight anything that comes close, then return to it
//   attack  chase one named foe until it falls, then hold where it fell
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
});
export const WARBAND_ORDERS = Object.freeze(['follow', 'move', 'hold', 'attack']);

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
 if (kind === 'move' || kind === 'hold') {
  if (!point(message.point) || Math.abs(message.point[0]) > ctx.reach || Math.abs(message.point[2]) > ctx.reach) return fail('invalid_order');
  at = message.point;
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
 if (o.kind === 'follow') return keys === 'kind';
 if (o.kind === 'attack') return keys === 'kind,target' && validId(o.target);
 return keys === 'kind,point' && point(o.point) && Math.abs(o.point[0]) <= reach && Math.abs(o.point[2]) <= reach && Math.abs(o.point[1]) <= 400;
}
export const restoreWarband = w => ({owner: w.owner, born: w.born, order: w.order.point ? {kind: w.order.kind, point: [...w.order.point]} : w.order.target ? {kind: w.order.kind, target: w.order.target} : {kind: w.order.kind}});
