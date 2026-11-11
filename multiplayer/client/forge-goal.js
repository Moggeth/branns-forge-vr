// The Hero's next forge goal, shown on the supplies strip so the core loop always reads at a glance: what you are
// gathering for, how much of each resource you still need, and when it is ready to take to the forge.
//
// In a Great Wilds world the goal is the next weapon on the ladder (shared/arsenal.js). Once every weapon is forged, or
// where there is no ladder, it is the next temper of the weapon in your hands (shared/weapon-temper.js). Pure: it reads
// a snapshot and returns plain data.
import {nextWeapon, costShortfall, weaponOwned} from '../shared/arsenal.js';
import {TEMPER_TOOLS, temperCost, temperLevel, atForge} from '../shared/weapon-temper.js';
import {WEAPON_INFO} from './hero-progress-ui.js';

const NUMERAL = ['', 'I', 'II', 'III'];

/** {kind: 'forge'|'temper', tool, title, label, cost, short, ready, here} or null when there is nothing to work toward. */
export function forgeGoal(snapshot, me) {
  if (!me || me.role !== 'hero') return null;
  const here = atForge(snapshot, me);
  const rung = nextWeapon(snapshot, me);
  if (rung) {
    const short = costShortfall(me.resources, rung.cost), name = WEAPON_INFO[rung.tool]?.name || rung.tool;
    return {kind: 'forge', tool: rung.tool, title: name, label: `Forge the ${name}`, cost: rung.cost, short, ready: !Object.keys(short).length, here};
  }
  const tool = me.tool || 'axe';
  if (!TEMPER_TOOLS.includes(tool) || !weaponOwned(snapshot, me, tool)) return null;
  const cost = temperCost(me, tool);
  if (!cost) return null;
  const tier = temperLevel(me, tool) + 1, short = costShortfall(me.resources, cost), name = WEAPON_INFO[tool]?.name || tool;
  return {kind: 'temper', tool, title: `Temper ${NUMERAL[tier]}`, label: `Temper ${name} to ${NUMERAL[tier]}`, cost, short, ready: !Object.keys(short).length, here};
}

/** Have / need per resource for the strip: {wood: {have: 3, need: 6, met: false}, ...}. */
export function goalProgress(goal) {
  const out = {};
  for (const [k, need] of Object.entries(goal?.cost || {})) { const missing = goal.short?.[k] || 0; out[k] = {have: need - missing, need, met: !missing}; }
  return out;
}
