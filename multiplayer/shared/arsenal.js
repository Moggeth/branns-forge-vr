// The Hero's arsenal: which weapons a player may draw. Pure; the client reads it to build the hotbar.
//
// Scope (2026-11-11, "Shrink scope and tighten core loop"): the game is focused on a short list of weapons. Shelved
// weapons keep all their code, art and rules, but stay off the hotbar unless Labs is on (add ?labs=1 to the address
// once; ?labs=0 turns it off). To bring one back, take it out of SHELVED_WEAPONS.
export const SHELVED_WEAPONS = Object.freeze(['flask', 'staff']); // Emberdew, Sunthread
export const WEAPON_NAMES = Object.freeze({axe: 'Axe', pick: 'Pick', hammer: 'Sunfall', crossbow: 'Siegebird', bow: 'Emberwing',
  wyrmspout: 'Wyrmspout', flask: 'Emberdew', staff: 'Sunthread', flockwright: 'Flockwright', stormreel: 'Stormreel'});
/** True when this weapon is shelved for the current build (hidden and not drawable). */
export const weaponShelved = (tool, {labs = false} = {}) => !labs && SHELVED_WEAPONS.includes(tool);

// ---------------------------------------------------------------- the weapon ladder
// New Great Wilds worlds start every Hero with the Axe and Pick. Each further weapon is forged once, in order, at the
// village forge (the Wilds' origin) from Timber, Iron and Crystal; after that it is yours on its hotbar key. Worlds
// without state.arsenal (Brann's Valley, the experiments, every save made before the ladder) own every weapon.
// state.arsenal = {forged: {heroNameKey: [tool, ...]}} : by hero name, like the hero ledger, so a resumed save (whose
// peers have new ids) keeps what was forged. Plain JSON, bounded, validated in restoreArsenal.
export const STARTING_WEAPONS = Object.freeze(['axe', 'pick']);
export const WEAPON_LADDER = Object.freeze([
  Object.freeze({tool: 'crossbow', cost: Object.freeze({wood: 8, iron: 4})}),
  Object.freeze({tool: 'bow', cost: Object.freeze({wood: 12, gems: 3})}),
  Object.freeze({tool: 'hammer', cost: Object.freeze({iron: 10, gems: 5})}),
  Object.freeze({tool: 'wyrmspout', cost: Object.freeze({wood: 8, iron: 12, gems: 8})}),
]);
export const ARSENAL_RULES = Object.freeze({forgeReach: 10, ledger: 64});
const LADDER_TOOLS = WEAPON_LADDER.map(s => s.tool);
const nameKey = name => { const k = typeof name === 'string' ? name.trim().toLowerCase().slice(0, 24) : ''; return k === '__proto__' ? '' : k; };
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export const createArsenal = () => ({forged: {}});
/** True when this world uses the weapon ladder (only new Great Wilds worlds). Works on state or snapshot. */
export const ladderOn = state => record(state?.arsenal);
/** Ladder weapons this hero has forged, in ladder order. */
// Own-property lookups only: a hero called "Constructor" must not read Object.prototype.
const entry = (forged, key) => (key && Object.hasOwn(forged, key) && Array.isArray(forged[key])) ? forged[key] : [];
export const forgedWeapons = (state, p) => ladderOn(state) ? [...entry(state.arsenal.forged, nameKey(p?.name))] : [...LADDER_TOOLS];
/** May this hero draw this weapon? Weapons off the ladder (limb, Flockwright, Stormreel...) follow their own rules. */
export function weaponOwned(state, p, tool) {
  if (!ladderOn(state) || !LADDER_TOOLS.includes(tool)) return true;
  return forgedWeapons(state, p).includes(tool);
}
/** The next rung for this hero ({tool, cost}), or null when every weapon is forged. */
export function nextWeapon(state, p) {
  if (!ladderOn(state)) return null;
  const have = forgedWeapons(state, p);
  return WEAPON_LADDER.find(s => !have.includes(s.tool)) || null;
}
/** What is still missing to pay for a rung: {wood: 3, ...}, empty when affordable. */
export function costShortfall(resources, cost) {
  const out = {};
  for (const [k, n] of Object.entries(cost)) { const have = resources?.[k] || 0; if (have < n) out[k] = n - have; }
  return out;
}
export const nearForge = p => Math.hypot(p.position[0], p.position[2]) <= ARSENAL_RULES.forgeReach;

/** Host action {action: 'craftWeapon', tool}. Forges the hero's next ladder weapon and puts it in their hands. */
export function craftWeapon(state, p, message) {
  const fail = code => ({ok: false, code, events: []});
  if (!ladderOn(state)) return fail('no_ladder');
  if (p.role !== 'hero' || p.hp <= 0) return fail('hero_required');
  const next = nextWeapon(state, p);
  if (!next) return fail('all_forged');
  if (message.tool !== next.tool) return fail(LADDER_TOOLS.includes(message.tool) && weaponOwned(state, p, message.tool) ? 'already_forged' : 'not_next');
  if (!nearForge(p)) return fail('too_far');
  if (Object.keys(costShortfall(p.resources, next.cost)).length) return fail('insufficient_resources');
  const key = nameKey(p.name); if (!key) return fail('invalid_player');
  const forged = state.arsenal.forged;
  if (!Object.hasOwn(forged, key) && Object.keys(forged).length >= ARSENAL_RULES.ledger) {
    const here = new Set(state.players.map(q => nameKey(q.name)));
    const drop = Object.keys(forged).find(k => !here.has(k)); if (!drop) return fail('ledger_full');
    delete forged[drop];
  }
  for (const [k, n] of Object.entries(next.cost)) p.resources[k] -= n;
  forged[key] = LADDER_TOOLS.filter(t => t === next.tool || entry(forged, key).includes(t));
  const rung = LADDER_TOOLS.indexOf(next.tool) + 1;
  return {ok: true, events: [{kind: 'weapon_forged', id: p.id, by: p.id, tool: next.tool, rung, of: LADDER_TOOLS.length,
    position: [p.position[0], p.position[1] + 1.2, p.position[2]]}]};
}
/** Save validation: undefined (no ladder) or {forged: {key: [ladder tools in order]}}. Throws when invalid. */
export function restoreArsenal(saved) {
  const a = saved.arsenal;
  if (a === undefined) return undefined;
  if (!record(a) || !record(a.forged) || Object.keys(a).length !== 1 || Object.keys(a.forged).length > ARSENAL_RULES.ledger) throw Error('Invalid arsenal');
  const forged = {};
  for (const [key, list] of Object.entries(a.forged)) {
    if (!key || key !== nameKey(key) || !Array.isArray(list) || list.length > LADDER_TOOLS.length || new Set(list).size !== list.length ||
        !list.every(t => LADDER_TOOLS.includes(t))) throw Error('Invalid arsenal');
    forged[key] = LADDER_TOOLS.filter(t => list.includes(t));
  }
  return {forged};
}
