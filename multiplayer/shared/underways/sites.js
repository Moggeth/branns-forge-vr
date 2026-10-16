// Where the Underways open onto the world. Data, not code: the arena's entrances are authored here (and can be moved
// in the map editor under `underway.<id>`); a generated overworld supplies its own through state.worldUnderways
// (the same shape, stable ids). Pure: no clocks, randomness or DOM.
//   x, z   the portal's centre, set into the hillside
//   yaw    the way the portal leads (three.js yaw: 0 faces -z); Heroes come back out facing the other way
//   mouth  where a Hero must stand to go down; back  where they come back out
import {moved} from '../map-layout.js';
import {baseHeight} from '../terrain.js';

const site = (id, name, style, depth, [x, z], yaw) => {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  return Object.freeze({id, name, style, depth, x, z, yaw, y: baseHeight(x - fx * .8, z - fz * .8),
    mouth: Object.freeze([x - fx * .8, z - fz * .8]), back: Object.freeze([x - fx * 3.6, z - fz * 3.6])});
};
// The Glimmerdelve: an old mine dug into the north mountain foot, its timbered portal facing the meadow.
export const ARENA_UNDERWAYS = Object.freeze([
  site('glimmerdelve', 'the Glimmerdelve', 'mine', 1, moved('underway.glimmerdelve', [20, -48.2]), 0),
]);
/** Every entrance in this world: the arena's own, plus any a generated overworld has placed. */
export function underwaySites(state) {
  const extra = Array.isArray(state?.worldUnderways) ? state.worldUnderways : null;
  return extra ? [...(state.landmarks === false ? [] : ARENA_UNDERWAYS), ...extra] : ARENA_UNDERWAYS;
}
