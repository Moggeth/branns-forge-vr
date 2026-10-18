// The keep economy (battle v2): Gold from battle kills, the Quartermaster's item shop and Healing Draughts.
//   Gold:     felling an enemy troop pays its killer Gold (skeleton 1, golem 3, plus a Prospector's Purse bonus).
//   homeShop: {buy: itemId} or {sell: itemId} at your own keep's Quartermaster (shared/hero-items.js).
//   Draughts: drinking at the healing well also fills your draught (two with a Draught Belt); `drinkDraught` drinks
//             one anywhere for an instant heal.
// Pure simulation rules: fixed ticks, no clocks or randomness.
import {ITEMS, ITEM_SLOTS, hasItem, itemBonus, sellPrice} from './hero-items.js';
import {baseFallen, homeBattle, homePiece, pieceWorld} from './home-bases.js';
import {heroMaxHp} from './hero-progress.js';

export const SHOP = Object.freeze({
  counter: Object.freeze([0, 1.75]), reach: 2.6,
  killGold: Object.freeze({skeleton: 1, golem: 3}),
  draught: Object.freeze({heal: 50, cooldown: 90}),
});
const fail = code => ({ok: false, code, events: []});
const GOLD_CAP = 999;
export const draughtCap = p => 1 + itemBonus(p, 'draughts');
export const counterAt = side => pieceWorld(homePiece(side, 'quartermaster'), SHOP.counter);

/** Pays a hero for felling an enemy troop. Returns the Gold paid. */
export function payKillGold(state, owner, enemy, events) {
  if (!homeBattle(state) || owner?.role !== 'hero' || enemy?.battleRun === undefined || enemy.side === (owner.side || 'party')) return 0;
  const base = SHOP.killGold[enemy.kind] ?? 1, want = base + itemBonus(owner, 'goldPerKill');
  const r = owner.resources; if (!r) return 0;
  const paid = Math.min(want, GOLD_CAP - (r.gold || 0)); if (paid <= 0) return 0;
  r.gold = (r.gold || 0) + paid;
  events.push({kind: 'gold_earned', id: owner.id, amount: paid, gold: r.gold, position: [enemy.position[0], enemy.position[1] + 1.6, enemy.position[2]]});
  return paid;
}

export const isShopAction = action => action === 'homeShop' || action === 'drinkDraught';

export function shopAction(state, p, m) {
  if (m.action === 'drinkDraught') return drinkDraught(state, p);
  if (!homeBattle(state)) return fail('battle_inactive');
  if (p.role !== 'hero' || p.hp <= 0) return fail('hero_required');
  const side = p.side || 'party', base = state.battle.bases.find(b => b.side === side);
  if (!base || baseFallen(state, base)) return fail('base_fallen');
  const [x, z] = counterAt(side);
  if (Math.hypot(p.position[0] - x, p.position[2] - z) > SHOP.reach) return fail('too_far');
  const id = m.buy ?? m.sell, item = typeof id === 'string' && Object.hasOwn(ITEMS, id) ? ITEMS[id] : null;
  if (!item || (m.buy !== undefined) === (m.sell !== undefined)) return fail('invalid_item');
  const items = p.items ??= [], r = p.resources, at = [x, p.position[1] + 1.1, z];
  if (m.buy !== undefined) {
    if (hasItem(p, id)) return fail('already_owned');
    if (items.length >= ITEM_SLOTS) return fail('slots_full');
    if ((r.gold || 0) < item.cost) return fail('not_enough_gold');
    const before = heroMaxHp(p);
    r.gold -= item.cost; items.push(id);
    p.hp = Math.min(heroMaxHp(p), p.hp + Math.max(0, heroMaxHp(p) - before)); // new health arrives filled
    return {ok: true, events: [{kind: 'shop_buy', id: p.id, item: id, gold: r.gold, side, position: at}]};
  }
  if (!hasItem(p, id)) return fail('not_owned');
  const refund = Math.min(sellPrice(id), GOLD_CAP - (r.gold || 0));
  items.splice(items.indexOf(id), 1); r.gold = (r.gold || 0) + refund;
  p.hp = Math.min(p.hp, heroMaxHp(p));
  p.draughts = Math.min(p.draughts || 0, draughtCap(p));
  return {ok: true, events: [{kind: 'shop_sell', id: p.id, item: id, gold: r.gold, refund, side, position: at}]};
}

function drinkDraught(state, p) {
  if (p.role !== 'hero' || p.hp <= 0) return fail('hero_required');
  if (!(p.draughts > 0)) return fail('no_draught');
  if (state.tick < (p.draughtTick ?? -1e9) + SHOP.draught.cooldown) return fail('cooldown');
  if (p.hp >= heroMaxHp(p)) return fail('not_needed');
  p.draughts--; p.draughtTick = state.tick; p.hp = Math.min(heroMaxHp(p), p.hp + SHOP.draught.heal);
  return {ok: true, events: [{kind: 'draught_drunk', id: p.id, hp: p.hp, draughts: p.draughts, position: [...p.position]}]};
}

/** Fills a hero's draughts (the healing well calls this). Returns how many were added. */
export function fillDraughts(p) {
  const want = draughtCap(p) - (p.draughts || 0); if (want <= 0) return 0;
  p.draughts = draughtCap(p); return want;
}

// Save fields on a player: draughts, draughtTick, drinkTick, heartyUntil, flockwright (the Armoury's crossbow; all optional).
export function validTownFields(p, tick) {
  const n = (v, a, b) => v === undefined || (Number.isFinite(v) && v >= a && v <= b);
  return n(p.draughts, 0, 2) && (p.draughts === undefined || Number.isInteger(p.draughts)) && n(p.draughtTick, -1e9, tick)
    && n(p.drinkTick, -1e9, tick) && n(p.heartyUntil, 0, tick + 180 * 60) && (p.flockwright === undefined || p.flockwright === true);
}
export const restoreTownFields = p => Object.fromEntries(['draughts', 'draughtTick', 'drinkTick', 'heartyUntil', 'flockwright'].filter(k => p[k] !== undefined).map(k => [k, p[k]]));
