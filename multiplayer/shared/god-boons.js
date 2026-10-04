import {battleActive} from './battle-mode.js';
// God spells feed the Heroes. Every cast leaves something a Hero can use: real materials to mine or pick
// up, fruit that heals, or a short boon. Pure and deterministic (authority state only, no clock or RNG).
// Feeding is its own reward: nothing here pays the God back.
import {DEPOSIT_CATALOG} from './material-catalog.js';
import {SUNDER} from './terrain.js';

export const BOONS = Object.freeze({
  charge: {hits: 3, ticks: 900, bonus: 40, strikeDamage: 25, radius: 3}, // Lightning near a Hero
  swift: {ticks: 360, speed: 1.4, radius: 7},                              // Frost Nova around a Hero
  sanctuary: {radius: 5, hpPerSecond: 3},                               // standing inside a Tree Ring
  blessing: {hits: 8, ticks: 1800, heal: 20, radius: 6},                  // Blessing: a long weapon charge
  quake: {radius: 8, heroDamage: 8, ores: ['ironOre', 'copperOre']},       // Quake shakes ore loose
  seamSpacing: 4, apples: 2, rainApples: 3,
});
const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

function addDeposit(state, kind, x, z, ctx) {
  if (Math.hypot(x, z) < 7 || state.deposits.length + state.pendingStarfalls.length >= 80) return null;
  if (state.deposits.some(d => !d.depleted && Math.hypot(d.x - x, d.z - z) < BOONS.seamSpacing)) return null;
  const id = ctx.nextId(state, 'o'), info = DEPOSIT_CATALOG[kind];
  state.deposits.push({id, x, z, kind, hits: 0, maxHits: info.maxHits, depleted: false});
  return id;
}
export function addPickup(state, kind, x, z, amount, ctx) {
  const near = state.pickups.find(q => q.kind === kind && q.amount < 10 && Math.hypot(q.x - x, q.z - z) < 1);
  if (near) { near.amount = Math.min(10, near.amount + amount); return near.id; }
  if (state.pickups.length >= 256) return null;
  const id = ctx.nextId(state, 'p');
  state.pickups.push({id, kind, x, z, y: ctx.terrainHeight(state, x, z, false), amount});
  return id;
}

/** Called once per accepted cast, after the spell's own effect. Returns presentation events. */
export function castBoons(state, caster, spell, at, ctx, {start, end, id: castId} = {}) {
  const events = [], gift = (what, id, position, extra = {}) => events.push({kind: 'god_gift', spell, gift: what, id, position, by: caster.id, ...extra});
  const [x, , z] = at;
  if (spell === 'raise' || spell === 'lower') {
    // Raised earth bares a stone boulder; a pit reaches an iron seam.
    const kind = spell === 'lower' ? 'iron' : 'stone', id = addDeposit(state, kind, x, z, ctx);
    if (id) gift(kind === 'iron' ? 'iron_seam' : 'stone_boulder', id, [x, ctx.terrainHeight(state, x, z), z]);
  }
  if (spell === 'wall') {
    // The rampart itself is the gift: every segment can be quarried for stone, and it sheds shards when it shatters.
    const segments = state.deposits.filter(d => d.special === 'wall' && d.editId.startsWith(castId + '_')), mid = segments[segments.length >> 1];
    if (mid) gift('quarry_wall', mid.id, [mid.x, ctx.terrainHeight(state, mid.x, mid.z), mid.z]);
  }
  if (spell === 'sunder') for (let k = 1; k <= SUNDER.seams; k++) {
    // The chasm lays bare crystal seams on its floor; they stay to be mined after it closes.
    const t = k / (SUNDER.seams + 1), px = start[0] + (end[0] - start[0]) * t, pz = start[2] + (end[2] - start[2]) * t, id = addDeposit(state, 'crystal', px, pz, ctx);
    if (id) gift('crystal_seam', id, [px, ctx.terrainHeight(state, px, pz), pz]);
  }
  if (spell === 'grove' || spell === 'wave') for (let i = 0; i < BOONS.apples; i++) {
    const a = i * Math.PI + .6, px = x + Math.cos(a) * 1.2, pz = z + Math.sin(a) * 1.2, id = addPickup(state, 'apple', px, pz, 1, ctx);
    if (id) gift('apple', id, [px, ctx.terrainHeight(state, px, pz), pz]);
  }
  if (spell === 'heal') {
    // Rain ripens fruit on nearby groves.
    for (const g of state.groves.filter(g => Math.hypot(g.x - x, g.z - z) <= 7).slice(0, BOONS.rainApples)) {
      const id = addPickup(state, 'apple', g.x + .8, g.z, 1, ctx);
      if (id) gift('apple', id, [g.x + .8, ctx.terrainHeight(state, g.x + .8, g.z), g.z]);
    }
  }
  if (spell === 'quake') BOONS.quake.ores.forEach((kind, i) => {
    const a = i * Math.PI + 1.1, px = x + Math.cos(a) * 1.6, pz = z + Math.sin(a) * 1.6, id = addPickup(state, kind, px, pz, 1, ctx);
    if (id) gift('ore', id, [px, ctx.terrainHeight(state, px, pz), pz], {material: kind});
  });
  for (const hero of state.players) {
    if (hero.role !== 'hero') continue;
    const allied=!battleActive(state)||(hero.side||'party')===(caster.side||'party');
    if (spell === 'quake' && (!battleActive(state)||!allied) && flat(hero.position, at) <= BOONS.quake.radius) ctx.damageHero(state, hero, BOONS.quake.heroDamage, events);
    if (spell === 'blessing' && allied && flat(hero.position, at) <= BOONS.blessing.radius) {
      hero.hp = Math.min(100, hero.hp + BOONS.blessing.heal);
      hero.charge = {hits: Math.max(BOONS.blessing.hits, hero.charge?.hits || 0), until: Math.max(state.tick + BOONS.blessing.ticks, hero.charge?.until || 0)};
      gift('blessing', hero.id, [...hero.position], {hits: hero.charge.hits, until: hero.charge.until});
    }
    if (spell === 'lightning' && flat(hero.position, at) <= BOONS.charge.radius) {
      // A near miss hurts, but the Hero's weapon drinks the charge.
      if(!battleActive(state)||!allied)ctx.damageHero(state, hero, BOONS.charge.strikeDamage, events);
      if(!allied)continue;
      hero.charge = {hits: Math.max(BOONS.charge.hits, hero.charge?.hits || 0), until: Math.max(state.tick + BOONS.charge.ticks, hero.charge?.until || 0)};
      gift('charge', hero.id, [...hero.position], {hits: hero.charge.hits, until: hero.charge.until});
    }
    if (spell === 'frost' && allied && flat(hero.position, at) <= BOONS.swift.radius) {
      hero.swiftUntil = state.tick + BOONS.swift.ticks;
      gift('swift', hero.id, [...hero.position], {until: hero.swiftUntil});
    }
  }
  return events;
}

/** Melee strike bonus from a stored Lightning charge; consumes one charge when the strike lands on an enemy. */
export function spendCharge(state, hero) {
  const c = hero.charge;
  if (!c) return 0;
  if (c.until <= state.tick || c.hits <= 0) { delete hero.charge; return 0; }
  if (--c.hits <= 0) delete hero.charge;
  return BOONS.charge.bonus;
}
export const swiftFactor = (state, hero) => (hero.swiftUntil ?? 0) > state.tick ? BOONS.swift.speed : 1;

/** Per tick: Tree Ring sanctuaries heal, expired boons clear. */
export function stepBoons(state) {
  const rings = state.groves.filter(g => g.kind === 'ring');
  for (const hero of state.players) {
    if (hero.role !== 'hero') continue;
    if (hero.charge && hero.charge.until <= state.tick) delete hero.charge;
    if (hero.swiftUntil !== undefined && hero.swiftUntil <= state.tick) delete hero.swiftUntil;
    if (hero.hp < 100 && rings.some(g => Math.hypot(hero.position[0] - g.x, hero.position[2] - g.z) <= BOONS.sanctuary.radius)) hero.hp = Math.min(100, hero.hp + BOONS.sanctuary.hpPerSecond / 60);
  }
}
const CHARGE_HITS = Math.max(BOONS.charge.hits, BOONS.blessing.hits), CHARGE_TICKS = Math.max(BOONS.charge.ticks, BOONS.blessing.ticks);
export function validBoons(p, tick) {
  if (p.charge !== undefined && (!p.charge || typeof p.charge !== 'object' || !Number.isSafeInteger(p.charge.hits) || p.charge.hits < 1 || p.charge.hits > CHARGE_HITS || !Number.isSafeInteger(p.charge.until) || p.charge.until < 0 || p.charge.until > tick + CHARGE_TICKS)) return false;
  return p.swiftUntil === undefined || Number.isSafeInteger(p.swiftUntil) && p.swiftUntil >= 0 && p.swiftUntil <= tick + BOONS.swift.ticks;
}
