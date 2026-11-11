import {talentRank} from './hero-progress.js';
// Special-ability recharge per held tool, in 60 Hz simulation ticks. One table for authority, HUD and presentation.
export const SPECIAL_COOLDOWN = Object.freeze({axe: 360, pick: 240, hammer: 240, wyrmspout: 360, bow: 600, flask: 720});
// Talents that shorten a recharge (shared/hero-progress.js), by rank I, II, III: Whirlwind 6 s -> 4 / 3.5 / 3 s,
// Firestorm 10 s -> 5 / 4 / 3 s, Earthshaker 4 s -> 3.5 / 3 / 2.5 s.
export const TALENT_COOLDOWN = Object.freeze({axe: ['whirlwind', [240, 210, 180]], bow: ['firestorm', [300, 240, 180]], hammer: ['earthshaker', [210, 180, 150]]});
/** Pass the player (or any record carrying their talents) to include their talents. */
export const specialCooldown = (tool, p) => {
  const talent = TALENT_COOLDOWN[tool], rank = talent ? talentRank(p, tool, talent[0]) : 0;
  return rank ? talent[1][Math.min(3, rank) - 1] : SPECIAL_COOLDOWN[tool] || 0;
};
