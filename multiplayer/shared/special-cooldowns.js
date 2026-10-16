import {hasTalent} from './hero-progress.js';
// Special-ability recharge per held tool, in 60 Hz simulation ticks. One table for authority, HUD and presentation.
export const SPECIAL_COOLDOWN = Object.freeze({axe: 420, pick: 240, hammer: 240, wyrmspout: 360, bow: 600, flask: 720});
// Talents that shorten a recharge (shared/hero-progress.js): Whirlwind 7 s -> 5 s, Firestorm 10 s -> 5 s. Timberfall also
// comes back sooner with every biting axe blow (Sapdrinker, shared/timberfall.js).
export const TALENT_COOLDOWN = Object.freeze({axe: ['whirlwind', 300], bow: ['firestorm', 300]});
/** Pass the player (or any record carrying their talents) to include their talents. */
export const specialCooldown = (tool, p) => {
  const talent = TALENT_COOLDOWN[tool];
  return talent && hasTalent(p, tool, talent[0]) ? talent[1] : SPECIAL_COOLDOWN[tool] || 0;
};
