import {heroMaxHp} from './hero-progress.js';
import {restoreMill} from './home-mill.js';
import {HOME_SITES} from './keep-sites.js';
import {movedPlaced, movedTable} from './map-layout.js';
// Always-on home bases (battle v2): Dawnhold (party) in the south-west corner and
// Grumblekeep (rivals) in the north-east. Each sits under a shield dome held up by
// three pylons, with a heart forge, barracks, fountain, two crystal spires and two
// ballistas at its gate. Breaking every pylon drops the dome; smashing the heart wins
// the siege, and the fallen base rebuilds one level stronger.
// Pure simulation rules: fixed ticks, no clocks, rendering or random streams.

export const HOME = Object.freeze({
  TAVERN_SCALE: 1.3, // taverns drawn and walled this many times their kit size (see TAVERN_SCALE below)
  domeRadius: 18.5, heartHp: 600, pylonHp: 300, levelCap: 5,
  shieldDownTicks: 90 * 60, rebuildTicks: 180 * 60, waveTicks: 60 * 60, firstWaveTicks: 20 * 60,
  fountainEvery: 30, fountainHeal: 5,
  turrets: Object.freeze({
    spire: Object.freeze({hp: 250, range: 9, cooldown: 90, damage: 14}),
    ballista: Object.freeze({hp: 300, range: 17, cooldown: 240, damage: 40, heroDamage: 20}), // range trimmed as the keep widened: same reach from the heart
  }),
  reward: Object.freeze({iron: 12, wood: 12, gems: 6, starOre: 3}),
  // Hands-on pieces (shared/home-interact.js): drink at the fountain, ring the barracks bell, hammer-mend parts.
  drink: Object.freeze({reach: 3 * 1.3, heal: 40, cooldown: 10 * 60}), // per hero; also fills the Healing Draught
  bell: Object.freeze({reach: 2.6, cooldown: 75 * 60}),
  repair: 30,
});
// Manned home ballistas (shared/home-ballista.js): a Hero aims, fires and cranks one like a Timberline.
export const HOME_MANNED = Object.freeze({
  reach: 3.4, seat: 1.75, pitchMin: -8 * Math.PI / 180, pitchMax: 25 * Math.PI / 180,
  range: 30, reloadTicks: 150, fireTicks: 30, crankHold: 12, operatorBoost: 2, helperBoost: 3,
  damage: 60, heroDamage: 30, muzzle: 1.45,
});
export const HOME_NAMES = Object.freeze({party: 'Dawnhold', rivals: 'Grumblekeep'});
export {HOME_SITES} from './keep-sites.js';

// Base-local layout in metres: x is to the right of the gate, y points out of the
// gate toward the world centre. The client builds the same pieces from this table.
// 2026-10-08 ring keep: the heart stands in a round bowl cut into the corner mountains (shared/keep-sites.js).
// The front half is open toward the lane (gate, ballistas, pylons, spires); the buildings stand round the back
// half of the ring facing the heart; a narrow pass behind the heart leads to a hollow in the corner.
// HOME_SCALE still sizes the kit buildings (1.3x their modelled size).
export const HOME_SCALE = 1.3;
const P = (x, y) => Object.freeze([x, y]);
const polar = (deg, r) => P(+(Math.sin(deg * Math.PI / 180) * r).toFixed(3), +(Math.cos(deg * Math.PI / 180) * r).toFixed(3));
// face: the base-local point a building's front (+Z of its model) looks toward.
const piece = (at, face) => Object.freeze({at: Object.freeze(at), face: Object.freeze(face)});
const HEART = P(0, 0);
// Every entry can be moved by the local map editor (shared/map-layout.js); both keeps mirror the move.
export const HOME_LAYOUT = movedTable('keep', {
  barracks: P(-14, .5), fountain: P(-6.5, 6.5),
  // Two pylons flank the gate; the third guards the mouth of the pass.
  pylons: Object.freeze([P(9, 13), P(-9, 13), P(0, -16)]),
  spires: Object.freeze([P(-15.5, 8), P(15.5, 8)]),
  ballistas: Object.freeze([P(-10.5, 17.5), P(10.5, 17.5)]),
  gate: P(0, 17.5), gatePillars: Object.freeze([P(-3.4, 17.5), P(3.4, 17.5)]),
  // Boundary wards ring the dome, leaving the gate, the pylons, the barracks, the shop and the backs of the tavern and mill clear.
  wards: Object.freeze([50, 72, 111, 160, -160, -111, -72, -50].map(d => polar(d, 18.2))),
  bellPost: P(+(2.95 * HOME_SCALE).toFixed(3), +(2.75 * HOME_SCALE).toFixed(3)), // in the barracks' own frame (three.js x, z)
  // Town pieces (shared/home-shop.js, home-mill.js, taverns.js) on the back half of the ring, fronts to the heart.
  tavern: piece(P(-10.6, -10.6), HEART),
  mill: piece(P(10.6, -10.6), HEART),
  quartermaster: piece(P(14, .5), HEART),
}, ['bellPost']);
// The shared tavern ("The Muddled Mug") stands off the lane south of the Forge, its front toward the centre.
export const NEUTRAL_TAVERN = movedPlaced('mug', Object.freeze({at: Object.freeze([6, -28]), yaw: Math.atan2(-6, 28)}));

const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const sideKey = side => side === 'rivals' ? 'rivals' : 'party';

/** Unit vectors for a base: forward (out of the gate, toward the centre) and right. */
export function homeFrame(side) {
  const [x, z] = HOME_SITES[sideKey(side)], l = Math.hypot(x, z), f = [-x / l, -z / l];
  return {centre: [x, z], forward: f, right: [-f[1], f[0]]};
}
export function homePoint(side, [lx, ly]) {
  const {centre, forward, right} = homeFrame(side);
  return [centre[0] + right[0] * lx + forward[0] * ly, centre[1] + right[1] * lx + forward[1] * ly];
}

/** World placement of a town piece: [x, z] and the three.js yaw that turns its front (+Z) toward its face point. */
export function homePiece(side, name) {
  const {at, face} = HOME_LAYOUT[name], [x, z] = homePoint(side, at), [fx, fz] = homePoint(side, face);
  return {x, z, yaw: Math.atan2(fx - x, fz - z)};
}
/** World [x, z] of a point given in a placed piece's own frame (three.js x, z). */
export const pieceWorld = ({x, z, yaw}, [px, pz]) => { const c = Math.cos(yaw), s = Math.sin(yaw); return [x + px * c + pz * s, z - px * s + pz * c]; };
/** A world point in a placed piece's own frame. */
export const pieceLocal = ({x, z, yaw}, [wx, wz]) => { const c = Math.cos(yaw), s = Math.sin(yaw), dx = wx - x, dz = wz - z; return [dx * c - dz * s, dx * s + dz * c]; };

const partIds = side => {
  const id = `battle-base-${side}`;
  return [...HOME_LAYOUT.pylons.map((_, n) => [`${id}-pylon-${n}`, 'pylon', HOME_LAYOUT.pylons[n]]),
    ...HOME_LAYOUT.spires.map((_, n) => [`${id}-spire-${n}`, 'spire', HOME_LAYOUT.spires[n]]),
    ...HOME_LAYOUT.ballistas.map((_, n) => [`${id}-ballista-${n}`, 'ballista', HOME_LAYOUT.ballistas[n]])];
};
export const partMaxHp = kind => kind === 'pylon' ? HOME.pylonHp : HOME.turrets[kind].hp;

// Staggered first shots so the gate's four turrets never fire as one volley.
const firstShot = id => /-spire-1$/.test(id) ? 45 : /-ballista-0$/.test(id) ? 60 : /-ballista-1$/.test(id) ? 180 : 0;
function makePart(side, [id, kind, local], height) {
  const [x, z] = homePoint(side, local);
  return {id, kind, side, position: [x, height(x, z), z], hp: partMaxHp(kind), maxHp: partMaxHp(kind), ...(kind === 'pylon' ? {} : {readyTick: firstShot(id)})};
}

export function createHomeBase(side, height, level = 1) {
  const [x, z] = HOME_SITES[side];
  return {id: `battle-base-${side}`, side, position: [x, height(x, z), z], hp: HOME.heartHp, maxHp: HOME.heartHp,
    level, shieldDownUntil: 0, fallenUntil: 0, parts: partIds(side).map(p => makePart(side, p, height))};
}

export const homeBattle = state => state.battle?.v === 2 && state.battle.status === 'running';
export const baseFallen = (state, base) => base.fallenUntil > state.tick;
export const pylonsDown = base => base.parts.every(p => p.kind !== 'pylon' || p.hp <= 0);
/** The dome stands while the base is up and at least one pylon holds. */
export const shieldUp = (state, base) => !baseFallen(state, base) && !pylonsDown(base);

/** Live objects the given side may strike: enemy pylons and turrets, and an exposed enemy heart. */
export function siegeTargets(state, side) {
  if (!homeBattle(state)) return [];
  const out = [];
  for (const base of state.battle.bases) {
    if (base.side === side || baseFallen(state, base)) continue;
    for (const part of base.parts) if (part.hp > 0) out.push(part);
    if (!shieldUp(state, base) && base.hp > 0) out.push(base);
  }
  return out;
}
export function findHomeTarget(state, id) {
  if (state.battle?.v !== 2) return null;
  for (const base of state.battle.bases) {
    if (base.id === id) return {base, target: base};
    const part = base.parts.find(p => p.id === id);
    if (part) return {base, target: part};
  }
  return null;
}

/** Applies damage to a heart, pylon or turret. Returns true when it landed. */
export function damageHome(state, id, amount, side, events) {
  const found = findHomeTarget(state, id);
  if (!homeBattle(state) || !found || !Number.isFinite(amount) || amount <= 0 || amount > 1000) return false;
  const {base, target} = found;
  if (base.side === side || !['party', 'rivals'].includes(side) || baseFallen(state, base) || target.hp <= 0) return false;
  if (target === base && shieldUp(state, base)) {
    events.push({kind: 'home_shield_block', id, side: base.side, position: [...base.position]});
    return false;
  }
  target.hp = Math.max(0, target.hp - amount);
  events.push({kind: target === base ? 'battle_base_hit' : 'home_part_hit', id, part: target.kind || 'heart', side: base.side, hp: target.hp, position: [...target.position]});
  if (target.hp > 0) return true;
  if (target.kind === 'pylon') {
    events.push({kind: 'home_part_broken', id, part: 'pylon', side: base.side, position: [...target.position]});
    if (pylonsDown(base)) {
      base.shieldDownUntil = state.tick + HOME.shieldDownTicks;
      events.push({kind: 'home_shield_down', id: base.id, side: base.side, until: base.shieldDownUntil, position: [...base.position]});
    }
  } else if (target !== base) {
    events.push({kind: 'home_part_broken', id, part: target.kind, side: base.side, position: [...target.position]});
  } else {
    // Siege won: the heart falls, the winners are paid, the base rebuilds a level stronger.
    const winner = base.side === 'party' ? 'rivals' : 'party', stock = state.inventions?.stockpiles?.[winner], reward = {};
    for (const [k, n] of Object.entries(HOME.reward)) {
      const amountWon = n * base.level;
      reward[k] = amountWon;
      if (stock) stock[k] = Math.min(999, (stock[k] || 0) + amountWon);
    }
    base.fallenUntil = state.tick + HOME.rebuildTicks;
    base.shieldDownUntil = 0;
    for (const part of base.parts) part.hp = 0;
    state.battle.winner = winner;
    state.battle.sieges = Math.min(1e9, (state.battle.sieges || 0) + 1);
    events.push({kind: 'home_siege_won', winner, fallen: base.side, level: base.level, reward, position: [...base.position], rebuildTick: base.fallenUntil});
  }
  return true;
}

/** Per tick: rebuilds, pylon recovery, fountains and turret fire. */
/** A Hero's hammer mends a damaged or broken pylon or turret of their own base. A mended pylon lifts a fallen dome. */
export function repairHome(state, id, side, events) {
  const found = findHomeTarget(state, id);
  if (!homeBattle(state) || !found || found.target === found.base || found.base.side !== side || baseFallen(state, found.base)) return false;
  const {base, target} = found;
  if (target.hp >= target.maxHp) return false;
  const was = target.hp, dome = shieldUp(state, base);
  target.hp = Math.min(target.maxHp, target.hp + HOME.repair);
  events.push({kind: 'home_part_repaired', id, part: target.kind, side, hp: target.hp, mended: was <= 0, position: [...target.position]});
  if (!dome && target.kind === 'pylon' && shieldUp(state, base)) { base.shieldDownUntil = 0; events.push({kind: 'home_shield_up', id: base.id, side, position: [...base.position]}); }
  return true;
}

export function stepHomeBases(state, ctx, events) {
  if (!homeBattle(state)) return;
  const heroes = state.players.filter(p => p.role === 'hero' && p.hp > 0);
  for (const base of state.battle.bases) {
    base.position[1] = ctx.terrainHeight(state, base.position[0], base.position[2]);
    for (const part of base.parts) part.position[1] = ctx.terrainHeight(state, part.position[0], part.position[2]);
    if (base.fallenUntil && state.tick >= base.fallenUntil) {
      base.fallenUntil = 0; base.level = Math.min(HOME.levelCap, base.level + 1); base.hp = base.maxHp;
      for (const part of base.parts) { part.hp = part.maxHp; if (part.readyTick !== undefined) part.readyTick = state.tick + 60 + firstShot(part.id); }
      events.push({kind: 'home_rebuilt', id: base.id, side: base.side, level: base.level, position: [...base.position]});
    }
    if (baseFallen(state, base)) continue;
    if (base.shieldDownUntil && state.tick >= base.shieldDownUntil) {
      base.shieldDownUntil = 0;
      for (const part of base.parts) if (part.kind === 'pylon') part.hp = part.maxHp;
      events.push({kind: 'home_shield_up', id: base.id, side: base.side, position: [...base.position]});
    }
    // The fountain mends its own side inside the dome footprint.
    if (state.tick % HOME.fountainEvery === 0) {
      for (const hero of heroes) if (sideKey(hero.side) === base.side && hero.hp < heroMaxHp(hero) && flat(hero.position, base.position) <= HOME.domeRadius) hero.hp = Math.min(heroMaxHp(hero), hero.hp + HOME.fountainHeal);
      for (const bot of state.enemies) if (bot.battleRun !== undefined && bot.side === base.side && bot.hp > 0 && flat(bot.position, base.position) <= HOME.domeRadius) bot.hp = Math.min(bot.kind === 'golem' ? 320 : 100, bot.hp + HOME.fountainHeal);
    }
    for (const turret of base.parts) {
      // Ballistas aim and fire their own ballistic shots (shared/home-ballista.js).
      if (turret.kind !== 'spire' || turret.hp <= 0 || state.tick < turret.readyTick) continue;
      const spec = HOME.turrets[turret.kind];
      let best = null, range = spec.range;
      for (const bot of state.enemies) if (bot.hp > 0 && bot.battleRun !== undefined && bot.side !== base.side) { const d = flat(bot.position, turret.position); if (d <= range) { range = d; best = bot; } }
      // Troops draw fire first, so heroes pushing behind their own squad are covered.
      if (!best) for (const hero of heroes) if (sideKey(hero.side) !== base.side && (hero.protectedUntil ?? 0) <= state.tick) { const d = flat(hero.position, turret.position); if (d <= range) { range = d; best = hero; } }
      if (!best) continue;
      turret.readyTick = state.tick + spec.cooldown;
      const hero = heroes.includes(best);
      events.push({kind: 'home_turret_fire', id: turret.id, turret: turret.kind, side: base.side, targetId: best.id, from: [...turret.position], to: [...best.position], tick: state.tick});
      if (hero) ctx.damageHero(state, best, spec.heroDamage ?? spec.damage, events, turret.position);
      else ctx.damageEnemy(best, spec.damage, events, base.side);
    }
  }
}

/** Keeps hostile bodies outside a standing dome. Mutates position in place. */
export function resolveHomeDomes(state, position, side, radius = .3) {
  if (!homeBattle(state)) return position;
  for (const base of state.battle.bases) {
    if (side === base.side || !shieldUp(state, base)) continue;
    const dx = position[0] - base.position[0], dz = position[2] - base.position[2], d = Math.hypot(dx, dz), min = HOME.domeRadius + radius;
    if (d >= min) continue;
    const x = d > 1e-4 ? dx / d : base.side === 'party' ? 1 : -1, z = d > 1e-4 ? dz / d : base.side === 'party' ? 1 : -1;
    position[0] = base.position[0] + x * min; position[2] = base.position[2] + z * min;
  }
  return position;
}

// Solid footprints (base-local circles and the barracks box) so nobody walks through the buildings.
const K = HOME_SCALE;
const SOLIDS = Object.freeze([
  {at: [0, 0], r: 3.3 * K}, {at: HOME_LAYOUT.fountain, r: 2.0 * K},
  ...HOME_LAYOUT.pylons.map(at => ({at, r: .9 * K})), ...HOME_LAYOUT.spires.map(at => ({at, r: 1.1 * K})), ...HOME_LAYOUT.ballistas.map(at => ({at, r: .95 * K})),
  ...HOME_LAYOUT.gatePillars.map(at => ({at, r: .85 * K})), ...HOME_LAYOUT.wards.map(at => ({at, r: .45 * K})),
]);
const BARRACKS = Object.freeze({half: [3.2 * K, 2.2 * K]});
// Town pieces' solid parts in their own frame: boxes {at, half} and circles {at, r}. Taverns are open-fronted halls
// you walk into (walls, bar, tables and posts are solid); the shop stall is one box; the mill is its tower and hopper.
// The taverns are drawn TAVERN_SCALE times their kit size (2026-10-09: roomier, so a crowd fits inside); the kit
// footprints below are in kit metres and scaled here, so the walls, the safe zone and the bar all grow together.
export const TAVERN_SCALE = HOME.TAVERN_SCALE;
const scaled = (solids, k = TAVERN_SCALE) => Object.freeze(solids.map(q => Object.freeze({at: [q.at[0] * k, q.at[1] * k], ...(q.r !== undefined ? {r: q.r * k} : {half: [q.half[0] * k, q.half[1] * k]})})));
const KEEP_TAVERN = scaled([
  {at: [0, -3], half: [4.2, .25]}, {at: [-4, -.1], half: [.25, 3.1]}, {at: [4, -.1], half: [.25, 3.1]},
  {at: [0, -2.1], half: [2.55, .4]}, {at: [-2.2, .6], r: .75}, {at: [2.2, .6], r: .75}, {at: [-3.8, 2.8], r: .25}, {at: [3.8, 2.8], r: .25}]);
export const TOWN_SOLIDS = Object.freeze({
  tavern: KEEP_TAVERN,
  neutralTavern: scaled([
    {at: [0, -4], half: [5.7, .25]}, {at: [-5.5, -.1], half: [.25, 4.1]}, {at: [5.5, -.1], half: [.25, 4.1]},
    {at: [0, -2.9], half: [3.3, .4]}, ...[[-3, 1.6], [3, 1.6], [-3, -.6], [3, -.6]].map(at => ({at, r: .75})), {at: [-5.3, 3.8], r: .25}, {at: [5.3, 3.8], r: .25}]),
  quartermaster: Object.freeze([{at: [0, 0], half: [2.5, 1.75]}]),
  mill: Object.freeze([{at: [0, 0], r: 2.7}, {at: [0, 3.3], r: .7}, {at: [-2, 3], r: .45}]),
});
/** The shared tavern's placement, in the same shape as homePiece(). */
export const neutralTavern = () => ({x: NEUTRAL_TAVERN.at[0], z: NEUTRAL_TAVERN.at[1], yaw: NEUTRAL_TAVERN.yaw});
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
/** World yaw (three.js, about +Y) of a base's gate; local +Z of a piece points out of the gate. */
export const gateYaw = side => { const {forward} = homeFrame(side); return Math.atan2(forward[0], forward[1]); };
// The barracks door faces the heart across the ring.
export const barracksYaw = side => { const [bx, bz] = homePoint(side, HOME_LAYOUT.barracks), [hx, hz] = HOME_SITES[sideKey(side)]; return Math.atan2(hx - bx, hz - bz); };
/** World [x, z] of a base's bell post, beside the barracks door. */
export function bellPostAt(side) {
  const [bx, bz] = homePoint(side, HOME_LAYOUT.barracks), t = barracksYaw(side), c = Math.cos(t), sn = Math.sin(t), [px, pz] = HOME_LAYOUT.bellPost;
  return [bx + px * c + pz * sn, bz - px * sn + pz * c];
}
export function resolveHomeStructures(state, position, radius = .3) {
  if (!homeBattle(state)) return position;
  for (const side of ['party', 'rivals']) {
    const [cx, cz] = HOME_SITES[side];
    if (Math.abs(position[0] - cx) > 26 || Math.abs(position[2] - cz) > 26) continue;
    for (const name of ['tavern', 'quartermaster', 'mill']) pushOut(position, homePiece(side, name), TOWN_SOLIDS[name], radius);
    for (const {at, r} of SOLIDS) {
      const [x, z] = homePoint(side, at), dx = position[0] - x, dz = position[2] - z, d = Math.hypot(dx, dz), min = r + radius;
      if (d >= min) continue;
      const k = d > 1e-4 ? min / d : 0;
      position[0] = d > 1e-4 ? x + dx * k : x + min; position[2] = d > 1e-4 ? z + dz * k : z;
    }
    // Barracks: the same oriented box the client draws (three.js yaw about +Y).
    const [bx, bz] = homePoint(side, HOME_LAYOUT.barracks), t = barracksYaw(side), c = Math.cos(t), sn = Math.sin(t);
    const dx = position[0] - bx, dz = position[2] - bz, u = dx * c - dz * sn, v = dx * sn + dz * c, hu = BARRACKS.half[0] + radius, hv = BARRACKS.half[1] + radius;
    if (Math.abs(u) < hu && Math.abs(v) < hv) {
      let nu = u, nv = v;
      if (hu - Math.abs(u) < hv - Math.abs(v)) nu = Math.sign(u || 1) * hu; else nv = Math.sign(v || 1) * hv;
      position[0] = bx + nu * c + nv * sn; position[2] = bz - nu * sn + nv * c;
    }
    const [postX, postZ] = bellPostAt(side), ex = position[0] - postX, ez = position[2] - postZ, ed = Math.hypot(ex, ez), em = .3 + radius;
    if (ed < em && ed > 1e-4) { position[0] = postX + ex / ed * em; position[2] = postZ + ez / ed * em; }
  }
  const n = NEUTRAL_TAVERN.at;
  if (Math.abs(position[0] - n[0]) < 9 * TAVERN_SCALE && Math.abs(position[2] - n[1]) < 9 * TAVERN_SCALE) pushOut(position, neutralTavern(), TOWN_SOLIDS.neutralTavern, radius);
  return position;
}

/** The same solids as plain shapes (the Stormreel cable routes round them): circles {id, x, z, r} and boxes
 *  {id, x, z, yaw, at: [u, v], half: [hu, hv]} whose corners are pieceWorld({x, z, yaw}, [u ± hu, v ± hv]). */
export function homeSolids(side) {
  const out = [], tag = `home-${sideKey(side)}`;
  for (const [n, {at, r}] of SOLIDS.entries()) { const [x, z] = homePoint(side, at); out.push({id: `${tag}-s${n}`, x, z, r}); }
  const [bx, bz] = homePoint(side, HOME_LAYOUT.barracks);
  out.push({id: `${tag}-barracks`, x: bx, z: bz, yaw: barracksYaw(side), at: [0, 0], half: BARRACKS.half});
  const [px, pz] = bellPostAt(side); out.push({id: `${tag}-bell`, x: px, z: pz, r: .3});
  for (const name of ['tavern', 'quartermaster', 'mill']) {
    const placed = homePiece(side, name);
    for (const [n, sol] of TOWN_SOLIDS[name].entries()) {
      const id = `${tag}-${name}${n}`;
      if (sol.r !== undefined) { const [x, z] = pieceWorld(placed, sol.at); out.push({id, x, z, r: sol.r}); }
      else out.push({id, x: placed.x, z: placed.z, yaw: placed.yaw, at: sol.at, half: sol.half});
    }
  }
  return out;
}

/** Squad for one barracks wave: forgeling-style allies for Dawnhold, skeletons then golems for Grumblekeep. */
export function squadFor(base) {
  const n = Math.min(6, 2 + base.level);
  return Array.from({length: n}, (_, i) => base.level >= 2 && i === n - 1 ? 'golem' : 'skeleton');
}

const int = (n, a, b) => Number.isSafeInteger(n) && n >= a && n <= b;
const num = (n, a, b) => Number.isFinite(n) && n >= a && n <= b;
const vec = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

// Optional manning fields a saved ballista may carry; anything out of range fails the restore.
function manning(p, tick) {
  const out = {}, M = HOME_MANNED;
  if (p.operator != null) { if (typeof p.operator !== 'string' || !/^[-\w]{1,64}$/.test(p.operator)) throw Error('Invalid home bases'); out.operator = p.operator; }
  for (const [k, a, b] of [['aimYaw', -Math.PI, Math.PI], ['aimPitch', M.pitchMin, M.pitchMax], ['fireTick', -1000, tick], ['crankUntil', 0, tick + M.crankHold], ['helpUntil', 0, tick + M.crankHold]]) {
    if (p[k] === undefined) continue;
    if (!num(p[k], a, b)) throw Error('Invalid home bases');
    out[k] = p[k];
  }
  return out;
}

export function restoreHomeBases(bases, tick) {
  const bad = () => { throw Error('Invalid home bases'); };
  if (!Array.isArray(bases) || bases.length !== 2) bad();
  return ['party', 'rivals'].map((side, i) => {
    const b = bases[i], ids = partIds(side);
    if (!b || b.id !== `battle-base-${side}` || b.side !== side || b.maxHp !== HOME.heartHp || !num(b.hp, 0, HOME.heartHp) || !vec(b.position)
      || b.position[0] !== HOME_SITES[side][0] || b.position[2] !== HOME_SITES[side][1] || Math.abs(b.position[1]) > 200 || !int(b.level, 1, HOME.levelCap)
      || !num(b.shieldDownUntil, 0, tick + HOME.shieldDownTicks) || !num(b.fallenUntil, 0, tick + HOME.rebuildTicks) || !Array.isArray(b.parts) || b.parts.length !== ids.length) bad();
    const parts = ids.map(([id, kind], n) => {
      const p = b.parts[n];
      if (!p || p.id !== id || p.kind !== kind || p.side !== side || p.maxHp !== partMaxHp(kind) || !num(p.hp, 0, p.maxHp) || !vec(p.position) || Math.abs(p.position[1]) > 200
        || (kind !== 'pylon' && !num(p.readyTick, 0, tick + 600))) bad();
      const [x, z] = homePoint(side, HOME_LAYOUT[kind === 'pylon' ? 'pylons' : kind === 'spire' ? 'spires' : 'ballistas'][+id.at(-1)]);
      return {id, kind, side, position: [x, p.position[1], z], hp: p.hp, maxHp: p.maxHp, ...(kind === 'pylon' ? {} : {readyTick: p.readyTick}), ...(kind === 'ballista' ? manning(p, tick) : {})};
    });
    const extra = {};
    for (const [k, span] of [['drinkReadyTick', 20 * 60], ['bellReadyTick', HOME.bell.cooldown]]) { // drinkReadyTick: older saves (drinks are per hero now)
      if (b[k] === undefined) continue;
      if (!num(b[k], 0, tick + span)) bad();
      extra[k] = b[k];
    }
    const mill = restoreMill(b.mill, tick); if (mill) extra.mill = mill;
    return {id: b.id, side, position: [...b.position], hp: b.hp, maxHp: b.maxHp, level: b.level, shieldDownUntil: b.shieldDownUntil, fallenUntil: b.fallenUntil, parts, ...extra};
  });
}
