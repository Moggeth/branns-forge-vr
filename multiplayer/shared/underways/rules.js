// The Underways, shared rules: entering and leaving, rooms that wake as Heroes step in, hazards on the shared tick, urns
// and chests, the key and its gate, the rest shrine, the crowned guardian and its hoard, and the way home.
// Host-authoritative and deterministic. Saves keep only progress (state.underways); every dungeon is regenerated from
// its run's seed, so the generated baseline and the players' changes stay separate.
//
// state.underways = {runs: [run], delves: {siteId: clears}}
// run = {id, slot, seed, style, depth, site, tag, back: [x, y, z, yaw], startTick, woke: [roomId], opened: [chestId],
//        key, gateTick, wave, bossId, bossDown, hoardTick, rest: {heroId: tick}, emptySince, cleared}
import {hashSeed, UNDERWAY_STYLES, tileAt, GRID} from './gen.js';
import {SPACE, inUnderway, slotOf, slotOrigin, runInSlot, dungeonOf, underwayFloor} from './space.js';
import {underwaySites} from './sites.js';
import {BOSS_HP} from './constants.js';
export {BOSS_HP};

export const UNDERWAYS = Object.freeze({
  portalReach: 1.4, returnRadius: 1, exitRadius: 1.5, arrive: 3.2, back: 3.4,
  emptyClose: 20 * 60,          // a dungeon nobody is in closes after 20 s (its foes and loot go with it)
  keyReach: 1.3, gateReach: 3.2, shrineReach: 1.9, restCooldown: 45 * 60, chestReach: 2.6,
  hoardDelay: 100,              // the guardian falls; the hoard rumbles, then bursts
  exitDelay: 90,                // the way out opens after the burst
  maxRuns: SPACE.slots,
});
export const HAZARD_DAMAGE = Object.freeze({spikes: [14, 22], flame: [6, 12], rockfall: [24, 45]}); // [hero, foe]

export const emptyUnderways = () => ({runs: [], delves: {}});
const state0 = state => (state.underways ||= emptyUnderways());
const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const world = (run, x, z) => { const [ox, oz] = slotOrigin(run.slot); return [x + ox, z + oz]; };
const heroesIn = (state, run) => state.players.filter(p => p.role === 'hero' && p.hp > 0 && slotOf(p.position[0], p.position[2]) === run.slot);

/** The seed a site's next delve uses: the world seed, the site, and how many times it has been cleared. */
export function siteSeed(state, site) {
  return hashSeed(site.seed ?? state.seed, site.id, state0(state).delves[site.id] || 0);
}

/** Open a dungeon run (the entrance rules and the roguelite both call this). Returns the run or null when full. */
export function openUnderway(state, {seed, style = 'mine', depth = 1, site = null, tag = null, back}) {
  const U = state0(state);
  if (!UNDERWAY_STYLES.includes(style) || !Number.isSafeInteger(seed) || U.runs.length >= UNDERWAYS.maxRuns) return null;
  if (site) { const open = U.runs.find(r => r.site === site); if (open) return open; }
  let slot = 0; while (U.runs.some(r => r.slot === slot)) slot++;
  if (slot >= SPACE.slots) return null;
  let n = 1; while (U.runs.some(r => r.id === `uw${n}`)) n++;
  const run = {id: `uw${n}`, slot, seed, style, depth: Math.max(1, Math.min(4, depth | 0)), site, tag, back: back.map(v => Math.round(v * 1000) / 1000),
    startTick: state.tick, woke: [0], opened: [], key: false, gateTick: -1, wave: 0, bossId: null, bossDown: -1, hoardTick: -1, rest: {}, emptySince: -1, cleared: false};
  U.runs.push(run);
  return run;
}

/** Carry a Hero down into a run (to the entry room, facing in). */
export function enterUnderway(state, p, run, events, {release} = {}) {
  const d = dungeonOf(run), [x, z] = world(run, d.entry.x, d.entry.z - UNDERWAYS.arrive);
  release?.(p); // carried logs, ore and snacks stay on the surface
  p.position = [x, underwayFloor(state, x, z), z]; p.vy = 0; p.move = [0, 0]; p.velocity = [0, 0, 0]; p.yaw = d.entry.yaw;
  p.protectedUntil = Math.max(p.protectedUntil ?? 0, state.tick + 60);
  events.push({kind: 'underway_enter', id: p.id, run: run.id, position: [...p.position], yaw: p.yaw, name: d.name, style: run.style});
}
export function leaveUnderway(state, p, run, events, {terrainHeight}, reason = 'return') {
  const [bx, , bz, yaw] = run.back;
  p.position = [bx, terrainHeight(state, bx, bz), bz]; p.vy = 0; p.move = [0, 0]; p.velocity = [0, 0, 0]; p.yaw = yaw;
  p.protectedUntil = Math.max(p.protectedUntil ?? 0, state.tick + 60);
  events.push({kind: 'underway_leave', id: p.id, run: run.id, position: [...p.position], yaw, reason});
}

/** Surface entrance check for one Hero: standing in a site's mouth carries them down. */
function entranceFor(state, p, sites) {
  for (const s of sites) {
    if (Math.hypot(p.position[0] - s.mouth[0], p.position[2] - s.mouth[1]) > UNDERWAYS.portalReach) continue;
    if (Math.abs(p.position[1] - s.y) > 2.5) continue;
    return s;
  }
  return null;
}

function spawnFoe(state, run, enc, ctx, events) {
  if (state.enemies.length >= 64) return null;
  const [x, z] = world(run, enc.x, enc.z), id = `${run.id}_${enc.id}`;
  if (state.enemies.some(e => e.id === id)) return null;
  const e = ctx.createEnemy(id, [x, underwayFloor(state, x, z), z], enc.kind);
  Object.assign(e, {yaw: enc.yaw, uw: run.id, room: enc.room});
  if (enc.boss) { e.boss = true; e.hp = BOSS_HP; }
  if (e.kind === 'skeleton') e.emergeTick = state.tick; // they crawl up out of the floor
  state.enemies.push(e);
  if (enc.boss) run.bossId = id;
  events.push({kind: 'underway_wake', id, run: run.id, room: enc.room, position: [...e.position], boss: !!enc.boss});
  return e;
}

/** One tick of every open run. */
export function stepUnderways(state, ctx, events) {
  const U = state0(state), sites = underwaySites(state);
  // Heroes at a surface mouth go down (one run per site; a site's delve count picks its seed).
  for (const p of state.players) {
    if (p.role !== 'hero' || p.hp <= 0 || p.dragon || inUnderway(p.position[0], p.position[2])) continue;
    const s = entranceFor(state, p, sites); if (!s) continue;
    const run = openUnderway(state, {seed: siteSeed(state, s), style: s.style, depth: s.depth || 1, site: s.id, back: [s.back[0], s.y, s.back[1], s.yaw + Math.PI]});
    if (run) enterUnderway(state, p, run, events, ctx); else events.push({kind: 'underway_full', id: p.id, position: [...p.position]});
  }
  for (const run of [...U.runs]) stepRun(state, run, ctx, events);
}

function stepRun(state, run, ctx, events) {
  const d = dungeonOf(run), heroes = heroesIn(state, run), [ox, oz] = slotOrigin(run.slot), tick = state.tick;
  const local = p => [p.position[0] - ox, p.position[2] - oz];
  // Close a run nobody is in (a cleared one as soon as the last Hero is out).
  if (!heroes.length) {
    if (run.emptySince < 0) run.emptySince = tick;
    if (run.cleared || tick - run.emptySince >= UNDERWAYS.emptyClose) { closeRun(state, run, events); return; }
    return;
  }
  run.emptySince = -1;
  for (const p of heroes) {
    const [lx, lz] = local(p), [i, j] = tileAt(lx, lz), room = i >= 0 && j >= 0 && i < GRID && j < GRID ? d.roomOf[j * GRID + i] : -1;
    // Rooms wake when a Hero is in them (corridors never wake anything).
    if (room >= 0 && !run.woke.includes(room)) {
      run.woke.push(room);
      for (const enc of d.encounters) if (enc.room === room && !enc.wave) spawnFoe(state, run, enc, ctx, events);
      events.push({kind: 'underway_room', run: run.id, room, beat: d.rooms[room].beat, id: p.id, position: [...p.position], lore: d.rooms[room].lore});
    }
    // The key, the gate, the shrine, the way home and (after the hoard) the way out.
    if (d.key && !run.key && Math.hypot(lx - d.key.x, lz - d.key.z) < UNDERWAYS.keyReach && !state.enemies.some(e => e.uw === run.id && e.room === d.key.room && e.hp > 0)) { // its guards must fall first
      run.key = true; events.push({kind: 'underway_key', run: run.id, id: p.id, position: [...p.position]});
    }
    if (d.gate && run.key && run.gateTick < 0 && Math.hypot(lx - d.gate.x, lz - d.gate.z) < UNDERWAYS.gateReach) {
      run.gateTick = tick; const [gx, gz] = world(run, d.gate.x, d.gate.z);
      events.push({kind: 'underway_gate', run: run.id, id: p.id, position: [gx, underwayFloor(state, gx, gz), gz]});
    }
    if (d.shrine && Math.hypot(lx - d.shrine.x, lz - d.shrine.z) < UNDERWAYS.shrineReach && tick - (run.rest[p.id] ?? -1e9) >= UNDERWAYS.restCooldown) {
      run.rest[p.id] = tick; p.hp = ctx.heroMaxHp(p); p.mana = 100;
      events.push({kind: 'underway_rest', run: run.id, id: p.id, position: [...p.position]});
    }
    if (Math.hypot(lx - d.entry.x, lz - d.entry.z) < UNDERWAYS.returnRadius) { leaveUnderway(state, p, run, events, ctx, 'return'); continue; }
    if (run.hoardTick >= 0 && tick - run.hoardTick >= UNDERWAYS.exitDelay && d.exit && Math.hypot(lx - d.exit.x, lz - d.exit.z) < UNDERWAYS.exitRadius) {
      run.cleared = true; leaveUnderway(state, p, run, events, ctx, 'victory');
    }
  }
  // The guardian's retinue answers in two waves as it weakens; its fall bursts the hoard.
  const boss = run.bossId ? state.enemies.find(e => e.id === run.bossId) : null;
  if (boss) {
    const want = boss.hp <= BOSS_HP / 3 ? 2 : boss.hp <= BOSS_HP * 2 / 3 ? 1 : 0;
    while (run.wave < want) {
      run.wave++;
      for (const enc of d.encounters) if (enc.wave === run.wave) spawnFoe(state, run, enc, ctx, events);
      events.push({kind: 'underway_wave', run: run.id, wave: run.wave, id: boss.id, position: [...boss.position]});
    }
  } else if (run.bossId && run.bossDown < 0) {
    run.bossDown = tick; const [hx, hz] = world(run, d.hoard.x, d.hoard.z);
    events.push({kind: 'underway_boss_down', run: run.id, position: [hx, underwayFloor(state, hx, hz), hz]});
  }
  if (run.bossDown >= 0 && run.hoardTick < 0 && tick - run.bossDown >= UNDERWAYS.hoardDelay) burstHoard(state, run, d, heroes, ctx, events);
  stepHazards(state, run, d, heroes, ctx, events);
}

// The hoard: a fountain of Gold, Crystal and rare ore, a snack for the road, a share of glory for everyone inside and one
// piece of kit each (a Quartermaster item the Hero lacks, while they have room).
const HOARD_ITEMS = ['charm', 'leech', 'kettle', 'boots', 'whetstone', 'breastplate', 'purse', 'belt', 'locket'];
const STYLE_ORE = Object.freeze({mine: 'mithrilOre', crypt: 'gems', keep: 'ironOre'});
function burstHoard(state, run, d, heroes, ctx, events) {
  run.hoardTick = state.tick;
  const [hx, hz] = world(run, d.hoard.x, d.hoard.z), y = underwayFloor(state, hx, hz), drops = [];
  const loot = [['gold', 10], ['gold', 10], ['gold', 6 + 4 * run.depth], ['gems', 4], [STYLE_ORE[run.style], 4], ['starOre', 2 + run.depth], ['apple', 2]];
  loot.forEach(([kind, amount], n) => {
    const a = n / loot.length * Math.PI * 2 + (hashSeed(run.seed, 'hoard') % 100) / 100, r = 1.6 + (n % 2) * .7;
    const id = ctx.addPickup(kind, hx + Math.cos(a) * r, hz + Math.sin(a) * r, amount); if (id) drops.push(id);
  });
  const granted = [];
  heroes.forEach((p, n) => {
    ctx.grantXp(state, p, 120 + 60 * run.depth, events, p.position);
    const items = Array.isArray(p.items) ? p.items : (p.items = []);
    const pool = HOARD_ITEMS.filter(id => !items.includes(id)), pick = pool[hashSeed(run.seed, p.id, n) % Math.max(1, pool.length)];
    if (pick && items.length < 6) { items.push(pick); granted.push({id: p.id, item: pick}); }
  });
  events.push({kind: 'underway_hoard', run: run.id, ...(run.tag ? {tag: run.tag} : {}), position: [hx, y, hz], drops, granted, name: d.name});
}

/** Hazard phase for a tick (shared by rules and renderer). */
export const hazardPhase = (h, tick) => ((tick + h.offset) % h.period + h.period) % h.period;
function stepHazards(state, run, d, heroes, ctx, events) {
  const tick = state.tick, [ox, oz] = slotOrigin(run.slot);
  // Only rooms someone has reached do anything (and only while Heroes are inside: closed runs stop above).
  const bodies = [...heroes.map(p => ({p, hero: true})), ...state.enemies.filter(e => e.uw === run.id && e.hp > 0).map(e => ({p: e, hero: false}))];
  for (const h of d.hazards) {
    if (!run.woke.includes(h.room)) continue;
    const ph = hazardPhase(h, tick), [hd, ed] = HAZARD_DAMAGE[h.type];
    let strike = false, hits = b => false;
    const lx = b => b.p.position[0] - ox - h.x, lz = b => b.p.position[2] - oz - h.z;
    if (h.type === 'spikes') { strike = ph === 0 || ph === 24; hits = b => Math.abs(lx(b)) < h.half && Math.abs(lz(b)) < h.half; }
    else if (h.type === 'flame') { strike = ph < h.on && ph % 14 === 6; hits = b => Math.hypot(lx(b), lz(b)) < h.radius; }
    else if (h.type === 'rockfall') { strike = ph === h.warn; hits = b => Math.hypot(lx(b), lz(b)) < h.radius; }
    if (!strike) continue;
    for (const b of bodies) {
      if (!hits(b)) continue;
      if (b.hero) ctx.damageHero(state, b.p, hd, events, [h.x + ox, b.p.position[1], h.z + oz]);
      else if (state.enemies.includes(b.p) && b.p.hp > 0) ctx.damageEnemy(state, b.p, ed, events);
    }
  }
}

/** A Hero's swing near an urn or chest breaks it open. Returns events, or null when nothing breakable is in reach. */
export function strikeUnderway(state, p, events, ctx) {
  const slot = slotOf(p.position[0], p.position[2]); if (slot < 0) return null;
  const run = runInSlot(state, slot); if (!run) return null;
  const d = dungeonOf(run), [ox, oz] = slotOrigin(slot), fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  let best = null, bestD = Infinity;
  for (const c of d.chests) {
    if (run.opened.includes(c.id) || !run.woke.includes(c.room)) continue;
    const dx = c.x + ox - p.position[0], dz = c.z + oz - p.position[2], dist = Math.hypot(dx, dz);
    if (dist > UNDERWAYS.chestReach || (dist > .6 && (fx * dx + fz * dz) / dist < .4)) continue;
    if (dist < bestD) { best = c; bestD = dist; }
  }
  if (!best) return null;
  run.opened.push(best.id);
  const [x, z] = [best.x + ox, best.z + oz], roll = hashSeed(run.seed, best.id), drops = [];
  const loot = best.tier ? [['gold', 5 + 2 * run.depth], [STYLE_ORE[run.style], 2], ...(roll % 3 === 0 ? [['starOre', 1]] : [])]
    : roll % 10 < 5 ? [['gold', 1 + roll % 2]] : roll % 10 < 7 ? [['apple', 1]] : [];
  loot.forEach(([kind, amount], n) => { const a = n * 2.1 + roll % 7, id = ctx.addPickup(kind, x + Math.cos(a) * .7, z + Math.sin(a) * .7, amount); if (id) drops.push(id); });
  events.push({kind: 'underway_open', run: run.id, chest: best.id, tier: best.tier, id: p.id, position: [x, underwayFloor(state, x, z), z], drops});
  return events;
}

function closeRun(state, run, events) {
  const U = state0(state), inSlot = q => slotOf(q[0], q[2]) === run.slot;
  state.enemies = state.enemies.filter(e => e.uw !== run.id && !inSlot(e.position));
  state.pickups = state.pickups.filter(q => slotOf(q.x, q.z) !== run.slot);
  for (const key of ['projectiles', 'embeds', 'detachedParts']) if (Array.isArray(state[key])) state[key] = state[key].filter(q => !(Array.isArray(q.position) && inSlot(q.position)));
  if (run.cleared && run.site) U.delves[run.site] = Math.min(1e6, (U.delves[run.site] || 0) + 1);
  U.runs.splice(U.runs.indexOf(run), 1);
  events.push({kind: 'underway_closed', run: run.id, cleared: run.cleared});
}

// ---- Save validation and restore (strict whitelist; worlds saved before the Underways load with none open).
const isInt = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
export function restoreUnderways(saved) {
  const u = saved.underways;
  if (u === undefined) return emptyUnderways();
  if (!u || typeof u !== 'object' || !Array.isArray(u.runs) || u.runs.length > UNDERWAYS.maxRuns || !u.delves || typeof u.delves !== 'object') throw Error('Invalid underways');
  const tick = saved.tick, ids = new Set(), slots = new Set(), runs = [];
  for (const r of u.runs) {
    const ok = r && typeof r === 'object' && /^uw\d{1,4}$/.test(r.id) && !ids.has(r.id) && isInt(r.slot, 0, SPACE.slots - 1) && !slots.has(r.slot) &&
      Number.isSafeInteger(r.seed) && UNDERWAY_STYLES.includes(r.style) && isInt(r.depth, 1, 4) && (r.site === null || typeof r.site === 'string' && r.site.length <= 40) &&
      (r.tag === null || typeof r.tag === 'string' && r.tag.length <= 40) && Array.isArray(r.back) && r.back.length === 4 && r.back.every(Number.isFinite) &&
      Math.abs(r.back[0]) <= 8000 && Math.abs(r.back[2]) <= 8000 && isInt(r.startTick, -1000, tick) && Array.isArray(r.woke) && r.woke.length <= 64 && r.woke.every(n => isInt(n, 0, 63)) &&
      Array.isArray(r.opened) && r.opened.length <= 128 && r.opened.every(s => typeof s === 'string' && s.length <= 16) && typeof r.key === 'boolean' && isInt(r.gateTick, -1, tick) &&
      isInt(r.wave, 0, 2) && (r.bossId === null || typeof r.bossId === 'string' && r.bossId.length <= 40) && isInt(r.bossDown, -1, tick) && isInt(r.hoardTick, -1, tick) &&
      r.rest && typeof r.rest === 'object' && Object.keys(r.rest).length <= 16 && Object.values(r.rest).every(n => isInt(n, -1e9, tick)) && isInt(r.emptySince, -1, tick) && typeof r.cleared === 'boolean';
    if (!ok) throw Error('Invalid underway run');
    ids.add(r.id); slots.add(r.slot);
    runs.push({id: r.id, slot: r.slot, seed: r.seed, style: r.style, depth: r.depth, site: r.site, tag: r.tag, back: [...r.back], startTick: r.startTick, woke: [...r.woke], opened: [...r.opened],
      key: r.key, gateTick: r.gateTick, wave: r.wave, bossId: r.bossId, bossDown: r.bossDown, hoardTick: r.hoardTick, rest: {...r.rest}, emptySince: r.emptySince, cleared: r.cleared});
  }
  const delves = {};
  for (const [k, v] of Object.entries(u.delves)) { if (k.length > 40 || !isInt(v, 0, 1e6)) throw Error('Invalid underway delves'); delves[k] = v; }
  return {runs, delves};
}
/** Enemy fields the Underways add: which run, which room, and the crowned guardian flag. */
export function validUnderwayEnemy(e, runs) {
  if (e.uw === undefined) return e.room === undefined && e.boss === undefined;
  return typeof e.uw === 'string' && runs.some(r => r.id === e.uw) && isInt(e.room, 0, 63) && (e.boss === undefined || e.boss === true && e.kind === 'golem');
}
export const underwayEnemyFields = ({uw, room, boss}) => uw === undefined ? {} : {uw, room, ...(boss ? {boss} : {})};
