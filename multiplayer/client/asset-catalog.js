// Keep the full authored world at entry. Only unequipped tools and cosmetic
// ground cover stream later; trees, buildings and creatures never swap in late.
export const STREAMED_WEAPONS=new Set(['pick','hammer','crossbow','bow','wyrmspout','stormreel','staff']);
export const DECORATION_ASSETS=['grass_tuft','meadow_flowers','fern_delicate','leaf_litter','pebble_scatter','mushroom_cluster','fallen_branch','broadleaf_plant','river_stones','root_tangle'];
export const SECONDARY_ASSETS=new Set([...STREAMED_WEAPONS,'heavy_launcher','waist_pouch',...DECORATION_ASSETS]);
export const WORLD_TEMPLATE_ASSETS=['tree','tree_b','tree_young','tree_lod','tree_b_lod','tree_young_lod','star_gem','stone_chunk','orchard_apple','skeleton','forgeling','axe','pick','hammer','crossbow','bow','wyrmspout','stormreel','staff','arrow','wings','siegebird_songbird','golem','boulder','meteor','bank','ridge','roots','log','endcap','cut1','cut2','chip','bridge','grass_tuft','meadow_flowers','fern_delicate','leaf_litter','pebble_scatter','mushroom_cluster','fallen_branch','broadleaf_plant','river_stones','root_tangle'];
export const STARTUP_ASSETS=['timberline_ballista','timberline_bolts','stormspire','reel_pack','bases_kit','town_kit','backtown_kit','keep_ballistas','landmarks_kit','hero','forge','forge_lod',...WORLD_TEMPLATE_ASSETS.filter(name=>!SECONDARY_ASSETS.has(name))];
