// The Brinedeep salt mines' rules (the mine's shape is shared/salt-mines.js): rich salt seams, cave-ins, firedamp and
// the Saltback crabs. Pure simulation: fixed ticks, no clocks, renderer or random streams. The "random" choices are
// seeded hashes of (room seed, mine, slot, tick), so every peer, replay and late joiner agrees.
//
// - Salt seams: five seam slots per mine. A mined-out seam waits a little, then a fresh one glows out of the rock
//   somewhere else in the same mine (never beside a Hero). Now and then the seam is a salt heart, worth far more.
// - Cave-ins: every pick strike on salt strains the mine's roof. Strain bleeds away slowly; past the limit, dust
//   starts trickling over the Hero who did it and a moment later the roof comes down there. The rubble holds salt.
// - Firedamp: two pockets of gas seep from vents in each hall. Fire reaching a full pocket (Wyrmspout flame, a lit
//   Emberdew cinder, a phoenix flare) sets it off: a blast that hurts everyone near, shakes the roof loose and cracks
//   a salt heart out of the rock. The vent then seeps full again over a couple of minutes.
// - Saltback crabs: hermit crabs in salt-crystal shells. While Heroes are in a mine they climb out of its brine pools
//   (a few at a time), scuttle sideways at the nearest Hero and pinch. Hurt badly, they bolt for the pool and dive;
//   left alone, they wander home and dive anyway. Felled, they drop the salt off their shells.
import {MINE, MINE_SIDES, mineCeiling, mineDepth, mineField, mineInside, minePoint, mineSideAt, mineWalkable, portalAlong} from './salt-mines.js';
import {DEPOSIT_CATALOG} from './material-catalog.js';

export const SALT = Object.freeze({
  check: 30,                      // ticks between seam checks
  seamsPerMine: 5,
  respawn: Object.freeze([5400, 9000]), // 1.5-2.5 minutes at 60 Hz
  heroClear: 5,                   // a seam never glows out within this distance of a Hero
  heart: .14,                     // chance a fresh seam deep in the hall is a salt heart
  strain: Object.freeze({salt: 9, saltHeart: 14, saltRubble: 3, blast: 45, limit: 100, early: 55, earlyChance: .22, release: 60, decayTicks: 75}),
  fall: Object.freeze({warnTicks: 105, radius: 1.65, damage: 30, crab: 70, near: Object.freeze([.35, 1.45]), cap: 6, rubbleCap: 3}),
  damp: Object.freeze({refill: 7800, reach: 1.5, height: 2.4, radius: 4.4, damage: 46, crab: 110, burst: 6, falls: 2}),
  crab: Object.freeze({
    maxPerMine: 3, worldCap: 58, spawnCheck: 240, emergeTicks: 72, diveTicks: 54, idleTicks: 1500,
    hp: 60, part: 60, radius: .36, height: .55, aggro: 8.5, reach: 1.25, windup: 21, cooldown: 90, damage: 9,
    scuttle: 2.55, wander: .9, flee: 3.1, fleeBelow: .3, loot: 2,
  }),
});
// Firedamp vents, in corner space (the same in both mines).
export const DAMP_VENTS = Object.freeze([Object.freeze([56.3, 59.7]), Object.freeze([62.7, 55.7])]);

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
/** FNV-style 32-bit mix of numbers and strings (the same family as the stumplings'). Pure. */
function mix(...parts) {
  let h = 2166136261;
  for (const p of parts) for (const c of String(p)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return h >>> 0;
}
const unit = (...p) => mix(...p) / 4294967296;
export const SALT_KINDS = Object.freeze(['salt', 'saltHeart', 'saltRubble']);
export const isSaltDeposit = d => SALT_KINDS.includes(d?.kind);
export const isSeam = d => Number.isInteger(d?.seam);
export const isSaltback = e => e?.kind === 'saltback';

// ---- Fixed spots, found once from the mine's shape (pure maths, the same on every peer), in corner space.
// Seam spots hug the walls a little inside the walking line, so a Hero can stand in front and swing.
function findSpots() {
  const spots = [], target = MINE.walk + .5;
  const keep = (u, v, deep) => {
    if (spots.some(s => Math.hypot(s.u - u, s.v - v) < 1.75)) return;
    if (MINE.pools.some(p => Math.hypot(p[0] - u, p[1] - v) < p[2] + 1)) return;
    if (DAMP_VENTS.some(p => Math.hypot(p[0] - u, p[1] - v) < 1.9)) return;
    spots.push(Object.freeze({u: +u.toFixed(3), v: +v.toFixed(3), deep}));
  };
  const toWall = (pu, pv, du, dv, hi) => {
    let lo = 0;
    for (let i = 0; i < 26; i++) { const r = (lo + hi) / 2, [x, z] = minePoint('east', [pu + du * r, pv + dv * r]); if (mineInside(x, z) > target) lo = r; else hi = r; }
    const u = pu + du * lo, v = pv + dv * lo, [x, z] = minePoint('east', [u, v]);
    return Math.abs(mineInside(x, z) - target) < .08 ? [u, v] : null;
  };
  for (const h of MINE.halls) for (let k = 0; k < 40; k++) {
    const a = k / 40 * Math.PI * 2, at = toWall(h[0], h[1], Math.cos(a), Math.sin(a), 9);
    if (at && mineField(at[0], at[1]).along > portalAlong() + 6.5) keep(at[0], at[1], true);
  }
  for (let i = 2; i < MINE.path.length - 1; i++) {
    const a = MINE.path[i], b = MINE.path[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (const f of [.2, .5, .8]) for (const side of [-1, 1]) {
      const at = toWall(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, -(b[1] - a[1]) / len * side, (b[0] - a[0]) / len * side, 4);
      if (at) keep(at[0], at[1], false);
    }
  }
  return Object.freeze(spots);
}
export const SEAM_SPOTS = findSpots();
/** World [x, z] of a seam spot or vent in one mine. */
export const spotPoint = (side, s) => minePoint(side, Array.isArray(s) ? s : [s.u, s.v]);
export const ventPoint = (side, i) => minePoint(side, DAMP_VENTS[i]);
export const poolPoint = (side, i) => minePoint(side, [MINE.pools[i][0], MINE.pools[i][1]]);
const mineOf = d => d.mine === 'east' || d.mine === 'west' ? d.mine : mineSideAt(d.x, d.z);

/** Fresh mine bookkeeping: roof strain and firedamp vents per mine, and falls on their way down. */
export const emptyMines = () => ({east: {strain: 0, damp: [0, 0]}, west: {strain: 0, damp: [0, 0]}, falls: []});
const heroesIn = (state, side) => (state.players || []).filter(p => p.role === 'hero' && p.hp > 0 && mineDepth(p.position[0], p.position[2]) > .3 && mineSideAt(p.position[0], p.position[2]) === side);

// ---- Seams
function placeSeam(state, side, slot, previous) {
  const tick = state.tick | 0, seed = state.seed | 0, live = (state.deposits || []).filter(d => !d.depleted && d.mine === side);
  for (let a = 0; a < 12; a++) {
    const s = SEAM_SPOTS[Math.floor(unit(seed, side, slot, tick, a) * SEAM_SPOTS.length)], [x, z] = spotPoint(side, s);
    if (previous && Math.hypot(previous.x - x, previous.z - z) < 2) continue;
    if (live.some(d => Math.hypot(d.x - x, d.z - z) < 2)) continue;
    if (!previous?.initial && (state.players || []).some(p => p.role === 'hero' && Math.hypot(p.position[0] - x, p.position[2] - z) < SALT.heroClear)) continue;
    const heart = s.deep && !live.some(d => d.kind === 'saltHeart') && unit(seed, side, slot, tick, 'heart') < SALT.heart;
    return {x: +x.toFixed(3), z: +z.toFixed(3), kind: heart ? 'saltHeart' : 'salt'};
  }
  return null;
}
export const seamRespawnTicks = (seed, slot, tick) => SALT.respawn[0] + Math.floor(unit(seed, 'respawn', slot, tick) * (SALT.respawn[1] - SALT.respawn[0]));
const slotSide = slot => slot < SALT.seamsPerMine ? 'east' : 'west';
function stepSeams(state, ctx, events) {
  if (!Array.isArray(state.deposits)) return;
  const bySlot = new Map();
  for (const d of state.deposits) if (isSeam(d)) bySlot.set(d.seam, d);
  for (let slot = 0; slot < SALT.seamsPerMine * 2; slot++) {
    const old = bySlot.get(slot), side = slotSide(slot);
    if (old && !old.depleted) continue;
    if (old && old.respawnTick === undefined) { old.respawnTick = state.tick + seamRespawnTicks(state.seed | 0, slot, state.tick); continue; }
    if (old && state.tick < old.respawnTick) continue;
    const drop = !!old && ctx.retained?.({...old, seam: undefined, respawnTick: undefined}) === false;
    if (state.deposits.length + (state.pendingStarfalls?.length || 0) - (drop ? 1 : 0) >= 80) continue; // shared deposit budget
    const spot = placeSeam(state, side, slot, old || {initial: true});
    if (!spot) continue;
    if (old) { delete old.seam; delete old.respawnTick; if (drop) state.deposits.splice(state.deposits.indexOf(old), 1); }
    const id = `salt${slot}t${state.tick}`, c = DEPOSIT_CATALOG[spot.kind], y = ctx.terrainHeight(state, spot.x, spot.z);
    state.deposits.push({id, x: spot.x, z: spot.z, kind: spot.kind, hits: 0, maxHits: c.maxHits, depleted: false, mine: side, seam: slot});
    events.push({kind: 'geology_emerge', id, material: 'salt', position: [spot.x, y, spot.z], tick: state.tick, salt: spot.kind});
  }
}

// ---- Cave-ins
function scheduleFall(state, side, x, z, events, cause) {
  const M = state.mines;
  if (M.falls.length >= SALT.fall.cap || !mineWalkable(x, z) || mineCeiling(x, z) <= 0) return null;
  const id = `fall${state.tick}${side[0]}${M.falls.length}`, fallTick = state.tick + SALT.fall.warnTicks;
  M.falls.push({id, side, x: +x.toFixed(3), z: +z.toFixed(3), fallTick});
  events.push({kind: 'mine_creak', id, side, position: [x, 0, z], fallTick, cause});
  return id;
}
/** A spot near a body where the roof gives way (a little off the body, so a quick Hero steps clear). */
function fallNear(state, side, at, k) {
  for (let a = 0; a < 8; a++) {
    const ang = unit(state.seed | 0, side, state.tick, k, a, 'ang') * Math.PI * 2, r = SALT.fall.near[0] + unit(state.seed | 0, side, state.tick, k, a, 'r') * (SALT.fall.near[1] - SALT.fall.near[0]);
    const x = at[0] + Math.cos(ang) * r, z = at[1] + Math.sin(ang) * r;
    if (mineWalkable(x, z) && mineCeiling(x, z) > 0 && !state.mines.falls.some(f => Math.hypot(f.x - x, f.z - z) < 1.4)) return [x, z];
  }
  return null;
}
function addStrain(state, side, amount, at, events, cause) {
  const m = state.mines[side];
  m.strain = clamp(m.strain + amount, 0, 200);
  const early = m.strain >= SALT.strain.early && unit(state.seed | 0, side, state.tick, 'early') < SALT.strain.earlyChance;
  if (m.strain < SALT.strain.limit && !early) return;
  const spot = fallNear(state, side, at, 0);
  if (spot && scheduleFall(state, side, spot[0], spot[1], events, cause)) m.strain = Math.max(0, m.strain - SALT.strain.release);
}
/** A pick strike landed on a deposit: salt strains its mine's roof. Call after the hit is counted. */
export function noteSaltStrike(state, ore, p, events) {
  if (!isSaltDeposit(ore) || !state.mines) return;
  addStrain(state, mineOf(ore), SALT.strain[ore.kind] ?? SALT.strain.salt, [p.position[0], p.position[2]], events, 'pick');
}
function landFalls(state, ctx, events) {
  const M = state.mines;
  for (const f of [...M.falls]) {
    if (state.tick < f.fallTick) continue;
    M.falls.splice(M.falls.indexOf(f), 1);
    const y = ctx.terrainHeight(state, f.x, f.z), hit = [];
    for (const p of state.players) if (p.role === 'hero' && p.hp > 0 && Math.hypot(p.position[0] - f.x, p.position[2] - f.z) < SALT.fall.radius && Math.abs(p.position[1] - y) < 2.5) { ctx.damageHero(state, p, SALT.fall.damage, events, [f.x, y + 3, f.z]); hit.push(p.id); }
    for (const e of [...state.enemies]) if (isSaltback(e) && Math.hypot(e.position[0] - f.x, e.position[2] - f.z) < SALT.fall.radius) ctx.damageEnemy(state, e, SALT.fall.crab, events);
    // the fallen rock: a quick heap of salt rubble, if the mine has room for another
    let rubble = null;
    if (state.deposits.filter(d => d.kind === 'saltRubble' && !d.depleted && d.mine === f.side).length < SALT.fall.rubbleCap && state.deposits.length + (state.pendingStarfalls?.length || 0) < 80) {
      rubble = `rubble${f.id}`;
      state.deposits.push({id: rubble, x: f.x, z: f.z, kind: 'saltRubble', hits: 0, maxHits: DEPOSIT_CATALOG.saltRubble.maxHits, depleted: false, mine: f.side});
    }
    events.push({kind: 'mine_fall', id: f.id, side: f.side, position: [f.x, y, f.z], hit, rubble, roof: y + mineCeiling(f.x, f.z)});
  }
}

// ---- Firedamp
const FIRE_SHOT = q => q.kind === 'flame' || (q.kind === 'fuel' && q.lit) || (q.kind === 'arrow' && (q.flare || q.phoenix));
/** Is this vent full of gas? */
export const dampReady = (state, side, i) => !!state.mines && state.tick >= (state.mines[side]?.damp?.[i] ?? 0);
function blast(state, side, i, ctx, events, by) {
  const m = state.mines[side], [x, z] = ventPoint(side, i), y = ctx.terrainHeight(state, x, z), D = SALT.damp;
  m.damp[i] = state.tick + D.refill;
  events.push({kind: 'firedamp_blast', side, vent: i, position: [x, y + .4, z], by: by || null});
  for (const p of state.players) {
    if (p.role !== 'hero' || p.hp <= 0) continue;
    const d = Math.hypot(p.position[0] - x, p.position[2] - z);
    if (d < D.radius && Math.abs(p.position[1] - y) < 3) ctx.damageHero(state, p, Math.round(8 + (D.damage - 8) * (1 - d / D.radius)), events, [x, y, z]);
  }
  for (const e of [...state.enemies]) {
    const d = Math.hypot(e.position[0] - x, e.position[2] - z);
    if (isSaltback(e) && d < D.radius) ctx.damageEnemy(state, e, Math.round(D.crab * (1 - .6 * d / D.radius)), events, by);
  }
  // the blast cracks the rock round the vent open: salt scattered about it and a salt heart in the wall
  for (let k = 0; k < D.burst && state.pickups.length < 256; k++) {
    const a = (k + unit(state.seed | 0, side, state.tick, k)) / D.burst * Math.PI * 2, r = .9 + .9 * unit(state.seed | 0, side, state.tick, k, 'r');
    let px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    if (!mineWalkable(px, pz)) { px = x + Math.cos(a) * .5; pz = z + Math.sin(a) * .5; }
    state.pickups.push({id: ctx.nextId(state, 'p'), kind: 'salt', x: +px.toFixed(3), z: +pz.toFixed(3), y: ctx.terrainHeight(state, px, pz), amount: 1});
  }
  if (!state.deposits.some(d => d.kind === 'saltHeart' && !d.depleted && d.mine === side) && state.deposits.length + (state.pendingStarfalls?.length || 0) < 80) {
    // in the wall nearest the vent, wherever a live seam is not already standing
    const live = state.deposits.filter(d => !d.depleted && d.mine === side), spot = SEAM_SPOTS.map(s => spotPoint(side, s)).filter(([sx, sz]) => !live.some(d => Math.hypot(d.x - sx, d.z - sz) < 1.2))
      .sort((a, b) => Math.hypot(a[0] - x, a[1] - z) - Math.hypot(b[0] - x, b[1] - z))[0];
    if (spot) {
      const id = `heart${state.tick}${side[0]}${i}`, hy = ctx.terrainHeight(state, spot[0], spot[1]);
      state.deposits.push({id, x: +spot[0].toFixed(3), z: +spot[1].toFixed(3), kind: 'saltHeart', hits: 0, maxHits: DEPOSIT_CATALOG.saltHeart.maxHits, depleted: false, mine: side});
      events.push({kind: 'geology_emerge', id, material: 'salt', position: [spot[0], hy, spot[1]], tick: state.tick, salt: 'saltHeart', blast: true});
    }
  }
  // the roof shakes loose round the blast
  m.strain = clamp(m.strain + SALT.strain.blast, 0, 200);
  for (let k = 0; k < D.falls; k++) { const spot = fallNear(state, side, [x, z], k + 1); if (spot) scheduleFall(state, side, spot[0], spot[1], events, 'blast'); }
}
function stepDamp(state, ctx, events) {
  const shots = (state.projectiles || []).filter(FIRE_SHOT);
  if (!shots.length) return;
  for (const side of MINE_SIDES) for (let i = 0; i < DAMP_VENTS.length; i++) {
    if (!dampReady(state, side, i)) continue;
    const [x, z] = ventPoint(side, i), y = ctx.terrainHeight(state, x, z);
    const spark = shots.find(q => Math.hypot(q.position[0] - x, q.position[2] - z) < SALT.damp.reach && q.position[1] - y < SALT.damp.height && q.position[1] - y > -.5);
    if (spark) blast(state, side, i, ctx, events, spark.ownerId);
  }
}

// ---- Saltback crabs
export const saltbackParts = () => ({head: SALT.crab.part, torso: SALT.crab.part, leftArm: SALT.crab.part, rightArm: SALT.crab.part, leftLeg: SALT.crab.part, rightLeg: SALT.crab.part});
export function createSaltback(id, side, pool, tick, seed, y) {
  const [x, z] = poolPoint(side, pool);
  return {id, kind: 'saltback', position: [x, y, z], yaw: wrap(unit(seed, id, 'yaw') * Math.PI * 2), hp: SALT.crab.hp, parts: saltbackParts(), missingParts: [], attackTick: -1000, wakeTick: tick, home: [+x.toFixed(3), +z.toFixed(3)]};
}
export const saltbackEmerging = (e, tick) => tick - e.wakeTick < SALT.crab.emergeTicks;
export const saltbackDiving = (e, tick) => e.diveTick !== undefined && tick >= e.diveTick;
function stepCrabs(state, ctx, events) {
  const C = SALT.crab;
  for (const e of [...state.enemies]) {
    if (!isSaltback(e) || e.diveTick === undefined || state.tick < e.diveTick + C.diveTicks) continue;
    state.enemies.splice(state.enemies.indexOf(e), 1);
    state.embeds = (state.embeds || []).filter(m => m.targetId !== e.id);
    events.push({kind: 'saltback_gone', id: e.id, position: [...e.position]});
  }
  if (state.tick % C.spawnCheck) return;
  for (const side of MINE_SIDES) {
    const here = heroesIn(state, side), crabs = state.enemies.filter(e => isSaltback(e) && mineSideAt(e.home[0], e.home[1]) === side);
    if (!here.length || crabs.length >= C.maxPerMine || state.enemies.length >= C.worldCap) continue;
    // A fresh mine stirs at once; after that, each check has an even chance of another crab.
    if (crabs.length && unit(state.seed | 0, side, state.tick, 'crab') < .5) continue;
    const pool = Math.floor(unit(state.seed | 0, side, state.tick, 'pool') * MINE.pools.length), [x, z] = poolPoint(side, pool);
    if (here.some(p => Math.hypot(p.position[0] - x, p.position[2] - z) < 1.6)) continue; // not under a Hero's boots
    const crab = createSaltback(ctx.nextId(state, 'crab'), side, pool, state.tick, state.seed | 0, ctx.terrainHeight(state, x, z));
    state.enemies.push(crab);
    events.push({kind: 'saltback_emerge', id: crab.id, side, position: [...crab.position], tick: state.tick, material: 'salt'});
  }
}
/**
 * One tick of crab movement and pinching inside stepEnemies. ctx: {heroes, ground(x,z), resolve(position, radius),
 * damageHero(state, hero, amount, events, from), events}. A crab never leaves its mine.
 */
export function stepSaltbackMotion(state, e, {heroes, ground, resolve, damageHero, events}) {
  const C = SALT.crab, tick = state.tick;
  if (saltbackEmerging(e, tick) || saltbackDiving(e, tick)) return;
  const side = mineSideAt(e.home[0], e.home[1]);
  let target = null, best = C.aggro;
  for (const h of heroes) {
    if (h.hp <= 0 || mineDepth(h.position[0], h.position[2]) <= .05 || mineSideAt(h.position[0], h.position[2]) !== side) continue;
    const d = flat(e.position, h.position); if (d < best && Math.abs(h.position[1] - e.position[1]) < 2) { best = d; target = h; }
  }
  if (target) e.seenTick = tick;
  const hurt = e.hp <= C.hp * C.fleeBelow, home = [e.home[0], e.position[1], e.home[1]], toHome = flat(e.position, home);
  // Bolting home hurt, or bored with no Hero about: dive back into the brine once there.
  const bored = !target && tick - Math.max(e.wakeTick, e.seenTick ?? e.wakeTick) > C.idleTicks;
  if ((hurt || bored) && toHome < .6) { e.diveTick = tick; events?.push({kind: 'saltback_dive', id: e.id, position: [...e.position]}); return; }
  // A pinch in progress: hold still and snap on the hit frame.
  const age = tick - e.attackTick;
  if (age >= 0 && age < C.windup + 12) {
    if (age === C.windup) {
      const victim = heroes.find(h => h.id === e.attackTarget);
      if (victim && victim.hp > 0) {
        const d = flat(e.position, victim.position), dot = (-Math.sin(e.yaw) * (victim.position[0] - e.position[0]) - Math.cos(e.yaw) * (victim.position[2] - e.position[2])) / Math.max(d, .001);
        if (d < C.reach + .35 && dot > .5 && Math.abs(victim.position[1] - e.position[1]) < 1.6 && (e.hurtTick ?? -1e9) < e.attackTick) damageHero(state, victim, C.damage, events, e.position);
      }
    }
    return;
  }
  let dx = 0, dz = 0, speed = 0, face = null;
  if (hurt) { dx = home[0] - e.position[0]; dz = home[2] - e.position[2]; speed = C.flee; }
  else if (target) {
    dx = target.position[0] - e.position[0]; dz = target.position[2] - e.position[2]; face = Math.atan2(-dx, -dz);
    if (best < C.reach) {
      speed = 0;
      if (tick - e.attackTick > C.cooldown && Math.abs(wrap(face - e.yaw)) < .5 && (e.hurtTick ?? -1e9) < tick - 18) { e.attackTick = tick; e.attackTarget = target.id; events?.push({kind: 'saltback_pinch', id: e.id, target: target.id, position: [...e.position]}); }
    } else speed = C.scuttle * (e.slowUntil > tick ? .4 : 1);
  } else if (toHome > 3.5) { dx = home[0] - e.position[0]; dz = home[2] - e.position[2]; speed = C.wander * 1.3; }
  else {
    // Pootle about the pool in 2 s legs: a seeded heading, a pause now and then.
    const leg = Math.floor((tick - e.wakeTick) / 120), r = unit(e.id, leg);
    if (r < .65) { const a = unit(e.id, leg, 'a') * Math.PI * 2; dx = Math.sin(a); dz = Math.cos(a); speed = C.wander; }
  }
  const length = Math.hypot(dx, dz);
  // Crabs walk sideways: the shell turns side-on to its path, and squares up to a Hero it is about to pinch.
  if (length > 1e-6 && speed > 0) {
    dx /= length; dz /= length;
    const heading = Math.atan2(-dx, -dz), sideways = wrap(heading + (unit(e.id, 'hand') < .5 ? 1 : -1) * Math.PI / 2);
    const want = face !== null && best < 2.6 ? face : sideways;
    e.yaw = wrap(e.yaw + clamp(wrap(want - e.yaw), -.22, .22));
    for (const angle of [0, .6, -.6, 1.2, -1.2, 1.9, -1.9]) {
      const c = Math.cos(angle), s = Math.sin(angle), x = dx * c - dz * s, z = dx * s + dz * c;
      const px = e.position[0] + x * .45, pz = e.position[2] + z * .45;
      if (!mineWalkable(px, pz)) continue;
      const probe = [px, e.position[1], pz], before = [...probe];
      resolve(probe, C.radius, C.height);
      if (Math.hypot(probe[0] - before[0], probe[2] - before[2]) > .025 || Math.abs(ground(probe[0], probe[2]) - e.position[1]) > .6) continue;
      const nx = e.position[0] + x * speed / 60, nz = e.position[2] + z * speed / 60;
      if (mineWalkable(nx, nz)) { e.position[0] = nx; e.position[2] = nz; }
      break;
    }
  } else if (face !== null) e.yaw = wrap(e.yaw + clamp(wrap(face - e.yaw), -.22, .22));
  // Never on top of a Hero: step out of their boots.
  for (const h of heroes) { const d = flat(e.position, h.position); if (d < .7 && d > 1e-4 && Math.abs(e.position[1] - h.position[1]) < 2) { const nx = h.position[0] + (e.position[0] - h.position[0]) / d * .7, nz = h.position[2] + (e.position[2] - h.position[2]) / d * .7; if (mineWalkable(nx, nz)) { e.position[0] = nx; e.position[2] = nz; } } }
  resolve(e.position, C.radius, C.height); e.position[1] = ground(e.position[0], e.position[2]);
}
/** Loot from a felled crab: the salt off its shell, where it fell. ctx: {nextId, terrainHeight}. */
export function dropSaltbackLoot(state, e, ctx, events) {
  if (state.pickups.length >= 256) return;
  const [x, , z] = e.position;
  state.pickups.push({id: ctx.nextId(state, 'p'), kind: 'salt', x: +x.toFixed(3), z: +z.toFixed(3), y: ctx.terrainHeight(state, x, z), amount: SALT.crab.loot});
  events.push({kind: 'saltback_loot', id: e.id, position: [...e.position], salt: SALT.crab.loot});
}

/** Root calls once per simulation tick (after enemy movement). ctx: {terrainHeight(state,x,z), nextId(state,prefix),
 * damageHero(state,hero,amount,events,from), damageEnemy(state,enemy,amount,events,ownerId), retained(deposit)}. */
export function stepSaltMines(state, ctx, events = []) {
  if (!Number.isSafeInteger(state.tick) || state.tick <= 0) return;
  state.mines ??= emptyMines();
  const M = state.mines;
  if (state.tick % SALT.strain.decayTicks === 0) for (const side of MINE_SIDES) if (M[side].strain > 0) M[side].strain = Math.max(0, M[side].strain - 1);
  landFalls(state, ctx, events);
  stepDamp(state, ctx, events);
  stepCrabs(state, ctx, events);
  if (state.tick % SALT.check === 0 || state.tick === 1) stepSeams(state, ctx, events);
}

// ---- Strict save validation.
const finite = n => typeof n === 'number' && Number.isFinite(n);
const validTick = (t, tick, ahead = 0) => Number.isSafeInteger(t) && t >= 0 && t <= tick + ahead;
/** Restore the mines' bookkeeping from a save (absent in older saves: a fresh, quiet mine). Throws on bad data. */
export function restoreMines(saved) {
  const m = saved.mines;
  if (m === undefined) return emptyMines();
  const tick = saved.tick;
  const bad = () => { throw Error('Invalid salt mines'); };
  if (!m || typeof m !== 'object' || Array.isArray(m) || !Array.isArray(m.falls) || m.falls.length > SALT.fall.cap) bad();
  const out = {falls: []};
  for (const side of MINE_SIDES) {
    const s = m[side];
    if (!s || !finite(s.strain) || s.strain < 0 || s.strain > 200 || !Array.isArray(s.damp) || s.damp.length !== DAMP_VENTS.length || !s.damp.every(t => validTick(t, tick, SALT.damp.refill))) bad();
    out[side] = {strain: s.strain, damp: [...s.damp]};
  }
  const ids = new Set();
  for (const f of m.falls) {
    if (!f || typeof f.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(f.id) || ids.has(f.id) || !MINE_SIDES.includes(f.side) || !finite(f.x) || !finite(f.z) || !mineWalkable(f.x, f.z) || !validTick(f.fallTick, tick, SALT.fall.warnTicks)) bad();
    ids.add(f.id); out.falls.push({id: f.id, side: f.side, x: f.x, z: f.z, fallTick: f.fallTick});
  }
  return out;
}
/** Save validation for a deposit's optional mine fields. Throws on malformed values. */
export function validateMineDeposit(d, tick, slots) {
  if (d.mine === undefined) { if (d.seam !== undefined || isSaltDeposit(d)) throw Error('Invalid salt deposit'); return; }
  if (!MINE_SIDES.includes(d.mine) || !isSaltDeposit(d) || mineInside(d.x, d.z) < 0) throw Error('Invalid salt deposit');
  if (d.seam === undefined) { if (d.respawnTick !== undefined && d.vein === undefined) throw Error('Invalid salt deposit'); return; }
  if (!Number.isInteger(d.seam) || d.seam < 0 || d.seam >= SALT.seamsPerMine * 2 || slots.has(d.seam) || slotSide(d.seam) !== d.mine || d.vein !== undefined) throw Error('Invalid salt deposit');
  if (d.respawnTick !== undefined && (!d.depleted || !Number.isSafeInteger(d.respawnTick) || d.respawnTick < 0 || d.respawnTick > tick + SALT.respawn[1])) throw Error('Invalid salt deposit');
  slots.add(d.seam);
}
/** A saved crab must be a whole, plausible crab living in one of the mines. */
export function validSaltback(e, saved) {
  if (!isSaltback(e)) return e.diveTick === undefined && e.seenTick === undefined;
  const C = SALT.crab;
  return Number.isSafeInteger(e.wakeTick) && e.wakeTick >= 0 && e.wakeTick <= saved.tick && Array.isArray(e.home) && e.home.length === 2 && e.home.every(finite) &&
    MINE.pools.some((p, i) => MINE_SIDES.some(side => { const [x, z] = poolPoint(side, i); return Math.abs(x - e.home[0]) < .01 && Math.abs(z - e.home[1]) < .01; })) &&
    (e.diveTick === undefined || (validTick(e.diveTick, saved.tick) && saved.tick < e.diveTick + C.diveTicks)) && (e.seenTick === undefined || validTick(e.seenTick, saved.tick)) &&
    e.hp <= C.hp && mineInside(e.position[0], e.position[2]) > 0;
}
