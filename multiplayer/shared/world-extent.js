// How far the world reaches. The arena keeps its historic constants (things +/-55, keep corners +/-70, walkers +/-50);
// a generated world (shared/worldgen) reaches its own square (always inside |8000|). Dungeon interiors (The Underways)
// live in a reserved pocket band at x and z >= UNDERWAY_ORIGIN; validators admit it through inUnderwayBand.
// The simulation sets the active world around every call (setActiveWorld), and the client sets it from each snapshot,
// so modules without a state argument (validators, clamps) still read the right limits.
export const ARENA_LIMITS = Object.freeze({things: 55, extent: 70, walk: 50});
export const UNDERWAY_ORIGIN = 9000, UNDERWAY_MAX = 12000; // dungeon pocket band: UNDERWAY_ORIGIN <= x,z <= UNDERWAY_MAX
export const inUnderwayBand = (x, z) => x >= UNDERWAY_ORIGIN && z >= UNDERWAY_ORIGIN && x <= UNDERWAY_MAX && z <= UNDERWAY_MAX;
let active = null;
/** Make `world` (a registry worldFor() result, or null for the arena) the active one; returns the previous. */
export function setActiveWorld(world) { const previous = active; active = world || null; return previous; }
export const activeWorld = () => active;
/** Largest |x| or |z| any thing may have (validators). */
export const thingLimit = () => active ? Math.max(active.extent, UNDERWAY_MAX) : ARENA_LIMITS.things;
/** Largest |x| or |z| any position may have, including the arena's keep corners. */
export const extentLimit = () => active ? Math.max(active.extent, UNDERWAY_MAX) : ARENA_LIMITS.extent;
/** True inside the active limit on both axes. */
export const withinWorld = (x, z) => Math.abs(x) <= thingLimit() && Math.abs(z) <= thingLimit();
/** Run fn with `world` active, restoring the previous world afterwards (re-entrant, exception-safe). */
export function withWorld(world, fn) { const previous = setActiveWorld(world); try { return fn(); } finally { setActiveWorld(previous); } }
/** Largest |component| of any 3D position/vector the validators accept (arena: the historic 200 m sanity bound). */
export const posLimit = () => active ? Math.max(active.extent, UNDERWAY_MAX) : 200;
