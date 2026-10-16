// Where the Underways open onto the world. Data, not code: the arena's entrances are authored here (and can be moved
// in the map editor under `underway.<id>`); a generated overworld supplies its own through
// registerUnderwaySites (the same shape, stable ids). Pure: no clocks, randomness or DOM.
//   x, z   the portal's centre, set into the hillside
//   yaw    the way the portal leads (three.js yaw: 0 faces -z); Heroes come back out facing the other way
//   mouth  where a Hero must stand to go down; back  where they come back out
import {moved} from '../map-layout.js';
import {baseHeight} from '../terrain.js';

const site = (id, name, style, depth, [x, z], yaw, seed = null, height = baseHeight) => {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  return Object.freeze({id, name, style, depth, x, z, yaw, seed, y: height(x - fx * .8, z - fz * .8),
    mouth: Object.freeze([x - fx * .8, z - fz * .8]), back: Object.freeze([x - fx * 3.6, z - fz * 3.6])});
};
// The Glimmerdelve: an old mine dug into the north mountain foot, its timbered portal facing the meadow.
export const ARENA_UNDERWAYS = Object.freeze([
  site('glimmerdelve', 'the Glimmerdelve', 'mine', 1, moved('underway.glimmerdelve', [20, -48.2]), 0),
]);
/** A generated overworld registers how to list its entrances (pure, from the state's world descriptor). */
let provider = null;
export function registerUnderwaySites(fn) { provider = typeof fn === 'function' ? fn : null; }
/** Every entrance in this world: the arena's own, or the ones a generated overworld lists (arena saves have no world). */
export function underwaySites(state) {
  const extra = provider && state?.world ? provider(state) : null;
  return Array.isArray(extra) ? extra : ARENA_UNDERWAYS;
}

// A generated overworld's entrances ({id, x, z, yaw facing OUT of the cliff, tier 1..5, seed, name, biome}) as sites.
// Style follows the biome (mountain/rock: mine, marsh/forest: crypt, ruins/grass: keep); tier sets depth (1..4).
const STYLE_FOR = b => /mount|rock|cliff|tundra|snow|alpine/.test(b || '') ? 'mine' : /marsh|swamp|wet|forest|wood|bog/.test(b || '') ? 'crypt' : 'keep';
export function sitesFromEntrances(entrances, height) {
  return entrances.map(e => site(e.id, e.name || 'the Underways', e.style || STYLE_FOR(e.biome), Math.max(1, Math.min(4, Math.ceil((e.tier || 1) * .8))), [e.x, e.z], e.yaw + Math.PI, e.seed ?? null, height));
}
