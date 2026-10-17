// The Underways in a generated world: every cave entrance the world generator placed (shared/worldgen) becomes a
// dungeon site, styled by its biome and deepened by its tier. Pure and cached per generated world.
import {worldFor} from '../worldgen/registry.js';
import {registerUnderwaySites, sitesFromEntrances} from './sites.js';

const made = new WeakMap();
registerUnderwaySites(state => {
  const w = worldFor(state); if (!w) return null;
  let s = made.get(w); if (!s) made.set(w, s = Object.freeze(sitesFromEntrances(w.entrances, (x, z) => w.heightAt(x, z))));
  return s;
});
