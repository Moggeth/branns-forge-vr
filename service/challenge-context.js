'use strict';

// Small, bounded facts from playable obstacles. Text from a player or an
// invention never becomes a privileged instruction in Brann's prompt.
const PHASES = new Set(['sealed', 'partial', 'open', 'claimed']);
const ID = /^[a-z][a-z0-9_]{0,47}$/;
function normalize(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).filter(v => v && typeof v === 'object'
    && ID.test(v.id) && ID.test(v.zone) && PHASES.has(v.phase))
    .map(v => ({
      id: v.id,
      zone: v.zone,
      phase: v.phase,
      stepsDone: Number.isInteger(v.stepsDone) ? Math.max(0, Math.min(8, v.stepsDone)) : 0,
      stepsTotal: Number.isInteger(v.stepsTotal) ? Math.max(0, Math.min(8, v.stepsTotal)) : 0,
      rewardClaimed: v.rewardClaimed === true,
    }));
}
module.exports = {normalize};
