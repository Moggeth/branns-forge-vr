# Tree tip sprig revision (tree_kit.gd)

Edit confined to `_mesh_leaf_mass` (near leaf cards), 2 lines:
- Ragged outer cards' standoff from the blob surface reduced from +2..16 % to +0.8..6.4 % of radius (`1.0 + (range - 1.0) * 0.4`), so tip sprays sit against their supporting leaf mass instead of hovering above the canopy. The `randf_range` call is kept, so the RNG sequence, near/far shared seeds and card count are unchanged.
- Ragged card scale 0.62 -> 0.80: larger sprigs cover more pixels per leaf, reducing needle/confetti shimmer at the tips with no extra shader work or geometry.

Unchanged: bark, roots, shadows, blobs, fruit/reach points, APIs, wind, physics. Not rendered or tested here (Codex owns verification). If the tips still look detached or too heavy, tune the `0.4` and `0.8` constants.
