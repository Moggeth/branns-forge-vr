// Hero items from the keep Quartermaster (shared/home-shop.js): an Overwatch Stadium style kit of up to six items
// bought with Gold. Items are kept through deaths and saved with the hero (and their name ledger). No imports, so
// hero-progress.js, combat and movement can all read the bonuses. Pure and deterministic.
export const ITEM_SLOTS = 6;
export const ITEMS = Object.freeze(Object.fromEntries(Object.entries({
  breastplate: {name: 'Brass Breastplate', cost: 12, tier: 'common', text: '+40 max health.', hp: 40},
  boots: {name: 'Springheel Boots', cost: 12, tier: 'common', text: 'Run 15% faster.', speed: .15},
  whetstone: {name: 'Grumpy Whetstone', cost: 15, tier: 'common', text: 'Your weapons hit 15% harder.', damage: .15},
  kettle: {name: 'Pocket Kettle', cost: 14, tier: 'common', text: 'A hot cuppa on the go: heal 2 health every second.', regen: 2},
  purse: {name: "Prospector's Purse", cost: 10, tier: 'common', text: '+1 Gold for every foe you fell, and the mill pays you 25% more.', goldPerKill: 1, millBonus: .25},
  belt: {name: 'Draught Belt', cost: 10, tier: 'common', text: 'Carry two Healing Draughts instead of one.', draughts: 1},
  charm: {name: 'Forgeling Shield-Charm', cost: 16, tier: 'rare', text: 'Take 15% less damage.', armor: .15},
  leech: {name: 'Leech in a Jar', cost: 18, tier: 'rare', text: 'Heal for 10% of the damage you deal.', lifesteal: .1},
  hat: {name: "Ballista Captain's Hat", cost: 20, tier: 'rare', text: 'Manned ballistas reload twice as fast and hit 50% harder.', ballista: true},
  crown: {name: 'Siege Crown', cost: 25, tier: 'epic', text: 'Deal 40% more damage to enemy pylons, turrets and hearts.', siege: .4},
  locket: {name: 'Heartstone Locket', cost: 40, tier: 'epic', text: '+80 max health and 10% harder hits.', hp: 80, damage: .1},
}).map(([id, spec]) => [id, Object.freeze({id, ...spec})])));
export const ITEM_IDS = Object.freeze(Object.keys(ITEMS));
export const sellPrice = id => Math.floor((ITEMS[id]?.cost || 0) / 2);

const owned = p => Array.isArray(p?.items) ? p.items : [];
export const hasItem = (p, id) => owned(p).includes(id);
/** Sum of one numeric bonus over the hero's items (0 when none). */
export function itemBonus(p, key) {
  let n = 0;
  for (const id of owned(p)) { const v = Object.hasOwn(ITEMS, id) ? ITEMS[id][key] : 0; if (typeof v === 'number') n += v; }
  return n;
}
export const validItems = list => Array.isArray(list) && list.length <= ITEM_SLOTS && new Set(list).size === list.length
  && list.every(id => typeof id === 'string' && Object.hasOwn(ITEMS, id));
