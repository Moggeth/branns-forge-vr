// Expedition Roguelite run upgrades (boons) and starting kits. Pure data, no imports, so hero-items.js can fold a
// hero's boons into itemBonus() and every system that already reads item bonuses (health, damage, speed, armour,
// regeneration, leech, gold, draughts) picks them up with no extra wiring. Boons last for one run only.
// Numeric keys match shared/hero-items.js ITEMS; `xp` is granted once when the boon is picked, `lives` adds to the
// party's shared lives and `mana` speeds a God's mana regeneration.
export const BOON_LIMIT = 24;
export const BOONS = Object.freeze(Object.fromEntries(Object.entries({
  // Hero boons
  ironhide: {name: 'Ironhide', tier: 'common', role: 'hero', text: '+30 max health.', hp: 30},
  keen: {name: 'Keen Edge', tier: 'common', role: 'hero', text: 'Your weapons hit 15% harder.', damage: .15},
  fleet: {name: 'Fleet Foot', tier: 'common', role: 'hero', text: 'Run 12% faster.', speed: .12},
  mending: {name: 'Mending Moss', tier: 'common', role: 'hero', text: 'Heal 1.5 health every second.', regen: 1.5},
  stoneskin: {name: 'Stoneskin', tier: 'common', role: 'hero', text: 'Take 10% less damage.', armor: .1},
  insight: {name: 'Campfire Tales', tier: 'common', role: 'hero', text: 'Gain 60 experience right now.', xp: 60},
  bounty: {name: 'Bounty Mark', tier: 'common', role: 'hero', text: '+2 Gold for every foe you fell.', goldPerKill: 2},
  flasks: {name: 'Spare Flask', tier: 'common', role: 'hero', text: 'Carry one more Healing Draught.', draughts: 1},
  leech: {name: 'Thirsty Blade', tier: 'rare', role: 'hero', text: 'Heal for 6% of the damage you deal.', lifesteal: .06},
  heartwood: {name: 'Heartwood', tier: 'rare', role: 'hero', text: '+60 max health and heal 1 health every second.', hp: 60, regen: 1},
  fury: {name: 'Forge Fury', tier: 'rare', role: 'hero', text: 'Your weapons hit 30% harder.', damage: .3},
  scavenger: {name: 'Scavenger', tier: 'common', role: 'hero', text: '+3 Gold for every foe you fell, and 30 experience now.', goldPerKill: 3, xp: 30},
  bulwark: {name: 'Bulwark', tier: 'rare', role: 'hero', text: 'Take 20% less damage, but run 8% slower.', armor: .2, speed: -.08},
  windrunner: {name: 'Windrunner', tier: 'rare', role: 'hero', text: 'Run 20% faster and heal half a health every second.', speed: .2, regen: .5},
  secondwind: {name: 'Second Wind', tier: 'rare', role: 'hero', text: 'The party gains a spare life, but you lose 20 max health.', lives: 1, hp: -20},
  glass: {name: 'Glass Heart', tier: 'epic', role: 'hero', text: 'Hit 45% harder, but lose 30 max health.', damage: .45, hp: -30, unlock: true},
  phoenix: {name: 'Phoenix Feather', tier: 'epic', role: 'any', text: 'The party gains a spare life.', lives: 1, unlock: true},
  // God boons
  wellspring: {name: 'Wellspring', tier: 'common', role: 'god', text: 'Your mana refills 50% faster.', mana: .5},
  deepwell: {name: 'Deep Well', tier: 'rare', role: 'god', text: 'Your mana refills twice as fast.', mana: 1},
  starwell: {name: 'Starwell', tier: 'common', role: 'god', text: 'Your mana refills 30% faster, and the party’s haul grows by 15 Embers.', mana: .3, haul: 15},
  ember: {name: 'Kindled Ember', tier: 'rare', role: 'god', text: 'The party gains a spare life.', lives: 1},
}).map(([id, spec]) => [id, Object.freeze({id, ...spec})])));
export const BOON_IDS = Object.freeze(Object.keys(BOONS));
export const validBoonList = list => Array.isArray(list) && list.length <= BOON_LIMIT && list.every(id => typeof id === 'string' && Object.hasOwn(BOONS, id));
/** Sum of one numeric bonus over a player's run boons (0 when none). */
export function boonBonus(p, key) {
  let n = 0;
  if (Array.isArray(p?.runBoons)) for (const id of p.runBoons) { const v = Object.hasOwn(BOONS, id) ? BOONS[id][key] : 0; if (typeof v === 'number') n += v; }
  return n;
}

// Starting kits: the early equipment choice at camp. A kit is a starting pack plus one boon.
export const KITS = Object.freeze(Object.fromEntries(Object.entries({
  woodcutter: {name: 'Woodcutter', tool: 'axe', boon: 'ironhide', text: 'Axe in hand, +30 max health, and a pack of timber for quick walls and bridges.', pack: {wood: 12, stone: 2}},
  prospector: {name: 'Prospector', tool: 'pick', boon: 'stoneskin', text: 'Pick in hand, take 10% less damage, and a pack of stone and iron.', pack: {stone: 8, iron: 6}},
  skirmisher: {name: 'Skirmisher', tool: 'crossbow', boon: 'fleet', text: 'Crossbow in hand, run 12% faster, and a few gems for the road.', pack: {wood: 4, gems: 3}},
}).map(([id, spec]) => [id, Object.freeze({id, ...spec, pack: Object.freeze(spec.pack)})])));
export const KIT_IDS = Object.freeze(Object.keys(KITS));

// Permanent Hall of Embers unlocks (bought between runs with banked Embers, kept on each player's device).
// The host applies them when a player joins a run. Levels are capped here, so a modified client gains little.
export const HALL = Object.freeze(Object.fromEntries(Object.entries({
  spark: {name: 'Spare Ember', max: 2, costs: [60, 160], text: 'The party starts each run with one more life per level (the best in the party counts).'},
  seasoned: {name: 'Seasoned', max: 2, costs: [80, 200], text: 'Start each run with 30 experience per level.'},
  reroll: {name: 'Second Thoughts', max: 2, costs: [50, 140], text: 'Reroll your upgrade cards once per run per level.'},
  choice: {name: 'Wider Choice', max: 1, costs: [180], text: 'See four upgrade cards instead of three.'},
  packmule: {name: 'Packmule', max: 2, costs: [40, 120], text: 'Start each run with extra supplies.'},
  glass: {name: 'Glass Heart', max: 1, costs: [120], text: 'Adds the Glass Heart upgrade to your card pool.'},
  phoenix: {name: 'Phoenix Feather', max: 1, costs: [220], text: 'Adds the Phoenix Feather upgrade to your card pool.'},
}).map(([id, spec]) => [id, Object.freeze({id, ...spec, costs: Object.freeze(spec.costs)})])));
export const HALL_IDS = Object.freeze(Object.keys(HALL));
/** A sanitised copy of a client's Hall levels (unknown keys dropped, levels clamped). */
export function cleanHall(meta) {
  const out = {};
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) for (const id of HALL_IDS) {
    const n = meta[id];
    if (Number.isSafeInteger(n) && n > 0) out[id] = Math.min(HALL[id].max, n);
  }
  return out;
}
