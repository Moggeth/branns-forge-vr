// Asset catalogue tags: what every placeable kit piece is FOR and where it belongs. World content composes places
// from these rules (biome, slope, footprint, spacing, nearness to water/roads/forest edges, gameplay purpose)
// instead of scattering props uniformly. Add an asset here and the generator starts placing it.
//
// Fields:
//   asset     GLB name in public/assets (or a procedural id for renderer-built pieces)
//   purpose   'tree' (choppable, sim), 'resource' (mineable deposit kind, sim), 'decor' (render only), 'landmark'
//   biomes    where it grows/lies (generator biome names); weight per biome
//   slope     [min, max] coarse slope (m/m) it accepts
//   footprint collision radius in metres at scale 1 (0 = walk through)
//   spacing   minimum distance between two of the same kind (metres)
//   scale     [min, max] uniform scale
//   near      optional: 'water' | 'road' | 'forest-edge' | 'cliff' (placement prefers it)
//   danger    optional: [minTier, maxTier] (rarer kit deeper in the wilds)
//   lod       render distance band: 'near' (<45 m), 'mid' (<160 m), 'far' (whole view)
export const ASSET_TAGS = Object.freeze([
  // Choppable trees (shared/trees.js variants 0..2). Weights pick species per biome.
  {asset: 'tree', purpose: 'tree', variant: 0, biomes: {meadow: 6, forest: 4, marsh: 1, steppe: 1}, slope: [0, .6], footprint: .45, spacing: 3.2, scale: [.85, 1.25], lod: 'far'},
  {asset: 'tree_b', purpose: 'tree', variant: 1, biomes: {forest: 4, pine: 6, marsh: 4, tundra: 1}, slope: [0, .65], footprint: .45, spacing: 3.4, scale: [.85, 1.3], lod: 'far'},
  {asset: 'tree_young', purpose: 'tree', variant: 2, biomes: {meadow: 3, forest: 2, pine: 4, steppe: 3, tundra: 4, beach: 1}, slope: [0, .7], footprint: .25, spacing: 2.4, scale: [.8, 1.15], lod: 'far'},
  // Mineable deposits (shared/material-catalog.js kinds), tiered by geology and danger.
  {asset: 'stone', purpose: 'resource', biomes: {rock: 5, tundra: 3, steppe: 2, pine: 2, meadow: 1, forest: 1, beach: 1}, slope: [0, 1.2], footprint: .95, spacing: 9, near: 'cliff'},
  {asset: 'iron', purpose: 'resource', biomes: {rock: 4, pine: 2, tundra: 2, steppe: 1}, slope: [.12, 1.2], footprint: .95, spacing: 16, near: 'cliff'},
  {asset: 'copper', purpose: 'resource', biomes: {forest: 2, meadow: 1, steppe: 2, rock: 2}, slope: [.08, 1], footprint: .95, spacing: 18},
  {asset: 'mithril', purpose: 'resource', biomes: {rock: 3, snow: 3, tundra: 1}, slope: [.15, 1.4], footprint: .95, spacing: 26, danger: [2, 5]},
  {asset: 'gold', purpose: 'resource', biomes: {rock: 2, steppe: 2, beach: 1}, slope: [.1, 1.2], footprint: .95, spacing: 30, danger: [2, 5]},
  {asset: 'crystal', purpose: 'resource', biomes: {rock: 2, snow: 2, marsh: 1}, slope: [0, 1.2], footprint: .95, spacing: 34, danger: [3, 5]},
  // Render-only ground dressing. Near-band items are drawn only around the camera.
  {asset: 'boulder', purpose: 'decor', biomes: {rock: 4, tundra: 3, steppe: 2, pine: 2, meadow: .6, forest: .6, beach: 1}, slope: [0, 1.4], footprint: .9, spacing: 7, scale: [.7, 2.4], near: 'cliff', lod: 'mid'},
  {asset: 'river_stones', purpose: 'decor', biomes: {meadow: 1, forest: 1, pine: 1, marsh: 1, steppe: 1, tundra: 1, beach: 2}, slope: [0, .5], footprint: 0, spacing: 4, scale: [.8, 1.5], near: 'water', lod: 'near'},
  {asset: 'grass_tuft', purpose: 'decor', biomes: {meadow: 8, forest: 3, steppe: 6, marsh: 6, tundra: 2}, slope: [0, .6], footprint: 0, spacing: 1.2, scale: [.7, 1.4], lod: 'near'},
  {asset: 'meadow_flowers', purpose: 'decor', biomes: {meadow: 6, forest: 1, marsh: 1}, slope: [0, .4], footprint: 0, spacing: 2, scale: [.8, 1.3], lod: 'near'},
  {asset: 'fern_delicate', purpose: 'decor', biomes: {forest: 6, pine: 4, marsh: 3}, slope: [0, .7], footprint: 0, spacing: 1.8, scale: [.7, 1.3], near: 'forest-edge', lod: 'near'},
  {asset: 'mushroom_cluster', purpose: 'decor', biomes: {forest: 3, pine: 2, marsh: 2}, slope: [0, .5], footprint: 0, spacing: 5, scale: [.8, 1.4], lod: 'near'},
  {asset: 'fallen_branch', purpose: 'decor', biomes: {forest: 3, pine: 3, meadow: .5}, slope: [0, .5], footprint: 0, spacing: 6, scale: [.8, 1.2], lod: 'near'},
  {asset: 'leaf_litter', purpose: 'decor', biomes: {forest: 5, pine: 2}, slope: [0, .5], footprint: 0, spacing: 3, scale: [.8, 1.4], lod: 'near'},
  {asset: 'broadleaf_plant', purpose: 'decor', biomes: {forest: 3, marsh: 4, meadow: 1}, slope: [0, .5], footprint: 0, spacing: 3, scale: [.8, 1.3], near: 'water', lod: 'near'},
  {asset: 'pebble_scatter', purpose: 'decor', biomes: {steppe: 3, tundra: 3, rock: 3, beach: 3}, slope: [0, .8], footprint: 0, spacing: 3, scale: [.8, 1.4], lod: 'near'},
  {asset: 'root_tangle', purpose: 'decor', biomes: {forest: 2, pine: 1}, slope: [0, .6], footprint: 0, spacing: 8, scale: [.8, 1.2], near: 'forest-edge', lod: 'near'},
]);
export const TREE_TAGS = ASSET_TAGS.filter(t => t.purpose === 'tree');
export const RESOURCE_TAGS = ASSET_TAGS.filter(t => t.purpose === 'resource');
export const DECOR_TAGS = ASSET_TAGS.filter(t => t.purpose === 'decor');
export const tagFor = asset => ASSET_TAGS.find(t => t.asset === asset) || null;
