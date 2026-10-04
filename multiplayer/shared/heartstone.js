// Heartstones (the God-side 'influence' structures in shared/inventions.js). Shared, deterministic, host-authoritative.
// A Heartstone is a living geode heart. Every half second it pulses: Heroes of its side within its reach recover health
// and mana, and the pulse strengthens with each Bloom level the world reaches (shared/bloom.js). A broken Heartstone
// (hp 0) is silent until a Hero restores it with Crystal. Opponents breaking it cut off that side's healing well.
// No state of its own: everything it needs is already in the structure, the players and state.bloom.
import {heroMaxHp} from './hero-progress.js';
import {bloomLevel} from './bloom.js';

export const HEARTSTONE = Object.freeze({reach: 6, every: 30, hp: [0.5, 0.75, 1, 1.25], mana: [1, 1.5, 2, 2.5]});
const sideOf = p => p.side === 'rivals' ? 'rivals' : 'party';

export const heartstoneLevel = state => Math.min(HEARTSTONE.hp.length - 1, bloomLevel(state.bloom || 0));

/** Per-tick: living Heartstones restore nearby Heroes of their side. Returns the heroes touched this tick (for tests). */
export function stepHeartstones(state) {
  if (state.tick % HEARTSTONE.every || !state.inventions) return 0;
  const level = heartstoneLevel(state), hp = HEARTSTONE.hp[level], mana = HEARTSTONE.mana[level];
  let touched = 0;
  for (const b of state.inventions.structures) {
    if (b.type !== 'influence' || b.hp <= 0) continue;
    for (const p of state.players) {
      if (p.role !== 'hero' || p.hp <= 0 || sideOf(p) !== b.side) continue;
      if (Math.hypot(p.position[0] - b.position[0], p.position[2] - b.position[2]) > HEARTSTONE.reach) continue;
      if (p.hp >= heroMaxHp(p) && (p.mana ?? 100) >= 100) continue;
      p.hp = Math.min(heroMaxHp(p), p.hp + hp); if (typeof p.mana === 'number') p.mana = Math.min(100, p.mana + mana); touched++;
    }
  }
  return touched;
}
