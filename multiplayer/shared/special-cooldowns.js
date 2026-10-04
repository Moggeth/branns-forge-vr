// Special-ability recharge per held tool, in 60 Hz simulation ticks. One table for authority, HUD and presentation.
export const SPECIAL_COOLDOWN = Object.freeze({axe: 360, pick: 240, hammer: 240, wyrmspout: 120, bow: 600});
export const specialCooldown = tool => SPECIAL_COOLDOWN[tool] || 0;
