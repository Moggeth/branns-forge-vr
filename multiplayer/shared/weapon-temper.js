// Weapon tempering: the forge upgrade for weapons a Hero already owns. Talents change how a weapon plays; tempering
// makes it hit harder, and is bought with the three resources (Timber, Iron, Crystal) at the village forge.
//
// Each weapon tempers three times (I, II, III). Every tier adds TEMPER.damagePerTier to that weapon's hits (melee
// swings, its bolts or arrows, its sticky fire). p.temper = {axe: 2, ...}, kept with the hero's progress by name
// (shared/hero-progress.js ledger) so it survives leaving, rejoining and resumed saves. Pure and deterministic.
import {ladderOn, nearForge, weaponOwned, costShortfall, payCost} from './arsenal.js';

export const TEMPER = Object.freeze({
  max: 3, damagePerTier: .15, reach: 10,
  // Cost of each tier (wire keys: wood = Timber, gems = Crystal). Generous on purpose; tighten later.
  costs: Object.freeze([
    Object.freeze({wood: 4, iron: 6}),
    Object.freeze({wood: 6, iron: 10, gems: 4}),
    Object.freeze({wood: 8, iron: 16, gems: 10}),
  ]),
  names: Object.freeze(['', 'Tempered', 'Twice-tempered', 'Masterwork']),
});
export const TEMPER_TOOLS = Object.freeze(['axe', 'pick', 'hammer', 'crossbow', 'bow', 'wyrmspout']);
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export function temperLevel(p, tool) {
  const n = record(p?.temper) && Object.hasOwn(p.temper, tool) ? p.temper[tool] : 0;
  return Number.isInteger(n) ? Math.max(0, Math.min(TEMPER.max, n)) : 0;
}
/** Damage multiplier for a hit made with `tool`. */
export const temperScale = (p, tool) => p?.role === 'hero' && tool ? 1 + TEMPER.damagePerTier * temperLevel(p, tool) : 1;
/** Cost of the next tier, or null at Masterwork. */
export const temperCost = (p, tool) => { const t = temperLevel(p, tool); return t < TEMPER.max ? TEMPER.costs[t] : null; };
/** What is still missing to pay `cost`: {iron: 3, ...}, empty when affordable. Carried iron ore counts as iron, as at the forge. */
export const shortfall = (resources, cost) => costShortfall(resources, cost || {});
/** The forge you temper at: the village forge in the Great Wilds, the heart forge elsewhere. Works on a snapshot too. */
export function atForge(state, p) {
  if (!p?.position) return false;
  if (ladderOn(state)) return nearForge(p);
  const at = state?.shrine?.position || [0, 0, 0];
  return Math.hypot(p.position[0] - at[0], p.position[2] - at[2]) <= TEMPER.reach;
}

/** Host action {action: 'temper', tool}: pay for and apply the weapon's next tier. */
export function temperAction(state, p, m) {
  const fail = code => ({ok: false, code, events: []});
  if (p.role !== 'hero' || p.hp <= 0) return fail('hero_required');
  const tool = m.tool;
  if (typeof tool !== 'string' || !TEMPER_TOOLS.includes(tool)) return fail('invalid_weapon');
  if (!weaponOwned(state, p, tool)) return fail('not_forged');
  const cost = temperCost(p, tool);
  if (!cost) return fail('fully_tempered');
  if (!atForge(state, p)) return fail('too_far');
  if (Object.keys(shortfall(p.resources, cost)).length) return fail('insufficient_resources');
  payCost(p.resources, cost);
  const tier = temperLevel(p, tool) + 1;
  p.temper = {...(record(p.temper) ? p.temper : {}), [tool]: tier};
  return {ok: true, events: [{kind: 'weapon_tempered', id: p.id, by: p.id, tool, tier, position: [p.position[0], p.position[1] + 1.2, p.position[2]]}]};
}
/** Save validation for p.temper (optional; older saves have none). */
export const validTemper = t => t === undefined || (record(t) && Object.keys(t).length <= TEMPER_TOOLS.length &&
  Object.entries(t).every(([k, n]) => TEMPER_TOOLS.includes(k) && Number.isInteger(n) && n >= 1 && n <= TEMPER.max));
export const copyTemper = t => record(t) ? Object.fromEntries(Object.entries(t).filter(([, n]) => n > 0)) : {};
