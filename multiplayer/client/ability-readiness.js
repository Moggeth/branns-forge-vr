import {SPELLS, WEAPONS} from '../shared/spells.js';
import {WYRMSPOUT} from '../shared/wyrmspout.js';
import {specialCooldown} from '../shared/special-cooldowns.js';
import {SIEGEBIRD} from '../shared/combat.js';

const clamp = n => Math.max(0, Math.min(1, n));
// Read authority clocks; changing tools never resets or invents a cooldown.
export function readiness(lastTick, duration, tick) {
  if (!Number.isFinite(lastTick) || !Number.isFinite(tick) || duration <= 0) return 1;
  return clamp((tick - lastTick) / duration);
}
export function weaponReadiness(player = {}, tool = 'axe', tick = 0) {
  // A Siegebird reload after a perfect wind runs quick (shared/combat.js SIEGEBIRD).
  const basic = tool === 'crossbow' && player.siegebird?.quick ? SIEGEBIRD.quickTicks : WEAPONS.find(w => w.id === tool)?.cooldown || 0;
  const secondary = specialCooldown(tool, player);
  const overheated = (player.overheatUntil || 0) > tick;
  return {
    attackReady: overheated ? clamp(1 - (player.overheatUntil - tick) / WYRMSPOUT.refillTicks) : readiness(player.attackTick, basic, tick),
    specialReady: secondary ? readiness(player.specialTick, secondary, tick) : 1,
    hasSpecialCooldown: secondary > 0,
    heat: clamp(player.heat || 0), overheated,
    attackSeconds: overheated ? (player.overheatUntil - tick) / 60 : (1 - readiness(player.attackTick, basic, tick)) * basic / 60,
    specialSeconds: secondary ? (1 - readiness(player.specialTick, secondary, tick)) * secondary / 60 : 0,
  };
}
export function spellbookReadiness(player = {}, tick = 0, selected = 'skeleton', enabled = true) {
  // Spells have no recovery timer (mana is the only gate); castTick still marks the last cast.
  return {mana: player.mana || 0, tick, selected, enabled,
    spellTicks: Object.fromEntries(SPELLS.map(s => [s.id, player.castTick ?? -1000]))};
}
