// God spells feed the Heroes. Every cast leaves something a Hero can use: real materials to mine or pick
// up, fruit that heals, or a short boon. Pure and deterministic (authority state only, no clock or RNG).
// Feeding is its own reward: nothing here pays the God back.
import {DEPOSIT_CATALOG} from './material-catalog.js';

export const BOONS = Object.freeze({
  charge: {hits: 3, ticks: 900, bonus: 40, strikeDamage: 25, radius: 3}, // Lightning near a Hero
  swift: {ticks: 360, speed: 1.4, radius: 7},                              // Frost Nova around a Hero
  sanctuary: {radius: 4.5, hpPerSecond: 3},                               // standing inside a Tree Ring
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
export function castBoons(state, caster, spell, at, ctx, {start, end} = {}) {
  const events = [], gift = (what, id, position, extra = {}) => events.push({kind: 'god_gift', spell, gift: what, id, position, by: caster.id, ...extra});
  const [x, , z] = at;
  if (spell === 'raise' || spell === 'lower' || spell === 'wall') {
    // Raised earth bares a stone boulder; a pit reaches an iron seam; a wall can be quarried.
    const kind = spell === 'lower' ? 'iron' : 'stone', p = spell === 'wall' ? [(start[0] + end[0]) / 2, (start[2] + end[2]) / 2] : [x, z];
    const id = addDeposit(state, kind, p[0], p[1], ctx);
    if (id) gift(kind === 'iron' ? 'iron_seam' : 'stone_boulder', id, [p[0], ctx.terrainHeight(state, p[0], p[1]), p[1]]);
  }
  if (spell === 'sunder') for (const t of [1 / 3, 2 / 3]) {
    // Crystal glints along the crack.
    const px = start[0] + (end[0] - start[0]) * t, pz = start[2] + (end[2] - start[2]) * t, id = addPickup(state, 'gems', px, pz, 1, ctx);
    if (id) gift('crystal', id, [px, ctx.terrainHeight(state, px, pz), pz]);
  }
  if (spell === 'grove') for (let i = 0; i < BOONS.apples; i++) {
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
  for (const hero of state.players) {
    if (hero.role !== 'hero') continue;
    if (spell === 'lightning' && flat(hero.position, at) <= BOONS.charge.radius) {
      // A near miss hurts, but the Hero's weapon drinks the charge.
      ctx.damageHero(state, hero, BOONS.charge.strikeDamage, events);
      hero.charge = {hits: BOONS.charge.hits, until: state.tick + BOONS.charge.ticks};
      gift('charge', hero.id, [...hero.position], {hits: BOONS.charge.hits, until: hero.charge.until});
    }
    if (spell === 'frost' && flat(hero.position, at) <= BOONS.swift.radius) {
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
export function validBoons(p, tick) {
  if (p.charge !== undefined && (!p.charge || typeof p.charge !== 'object' || !Number.isSafeInteger(p.charge.hits) || p.charge.hits < 1 || p.charge.hits > BOONS.charge.hits || !Number.isSafeInteger(p.charge.until) || p.charge.until < 0 || p.charge.until > tick + BOONS.charge.ticks)) return false;
  return p.swiftUntil === undefined || Number.isSafeInteger(p.swiftUntil) && p.swiftUntil >= 0 && p.swiftUntil <= tick + BOONS.swift.ticks;
}
