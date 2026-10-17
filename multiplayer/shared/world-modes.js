// World modes: how the big-world experiences plug into the one shared simulation.
//
//   arena      the hand-built valley (no state.world; every old save)          owner: existing game
//   wilds      The Great Wilds: persistent seeded overworld                    owner: seeded-world thread
//   expedition Expedition Roguelite: short seeded runs (experimental)          owner: roguelite thread
//   underways  The Underways: procedural dungeons off the overworld (experimental) owner: dungeons thread
//
// A mode registers hooks here; the simulation calls them. Hooks run on the host only (authority) and must be
// deterministic functions of state + inputs (no clock, no Math.random). Everything they add to state must be plain
// JSON, bounded, and validated again in `restore` (saves and host handover go through it).
//
// register(kind, hooks):
//   newState(state, world)              fill a fresh state (spawn, starting supplies, mode fields)
//   step(state, ctx, events)            once per 60 Hz tick after the core step
//   action(state, player, message, ctx) -> {ok, events}|null  for {type:'mode', ...} messages (null = not mine)
//   restore(saved, state)               copy+validate the mode's own fields from a save/checkpoint (throw if invalid)
//   snapshot(state, out)                copy the mode's fields into a snapshot/checkpoint object
//   terrain: {contains(x,z), heightAt(x,z)}   optional: own the ground inside a region (the Underways' band)
// ctx = {nextId, terrainHeight, createEnemy, world, addPickup, damageHero, hitEnemyPart}
const modes = new Map();
export function registerWorldMode(kind, hooks) { modes.set(kind, {...hooks}); }
export const worldMode = kind => modes.get(kind) || null;
export const worldModes = () => [...modes.entries()];
/** Terrain owners (e.g. dungeon interiors) are asked first; null means the overworld owns this point. */
export function modeTerrainAt(x, z) {
  for (const m of modes.values()) if (m.terrain?.contains(x, z)) return m.terrain;
  return null;
}
