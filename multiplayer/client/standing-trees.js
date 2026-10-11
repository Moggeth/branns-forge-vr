import {worldTrees} from '../shared/world-content.js';
import {isFelled} from '../shared/trees.js';

// Network snapshots have fresh object identities even when the forest is unchanged.
// Keep the presentation list stable so canopy uploads aren't repeated at 20 Hz.
// Compare derived values, not a hash/revision: scheduled growth and relocated roots
// must still become visible at precisely the authoritative tick and position.
export function createStandingTrees() {
  let snapshot = null, cached = [];
  return state => {
    if (state === snapshot) return cached;
    snapshot = state;
    const felled = new Set((state.harvestedTrees || []).filter(isFelled).map(t => t.id));
    const next = worldTrees(state).filter(t => !felled.has(t.id));
    if (next.length !== cached.length || next.some((t,i) => {
      const p=cached[i];
      return t.id!==p.id || t.x!==p.x || t.z!==p.z || t.height!==p.height || t.variant!==p.variant;
    })) cached = next;
    return cached;
  };
}
