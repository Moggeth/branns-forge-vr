# Enchanted Kitchen kit — handoff

Rebuild: `blender.exe -b --python build_kitchen.py` (deterministic, ~4 s; optional arg = output dir; `KITCHEN_ONLY=table` for a quick single-asset test). Authored in Godot axes (X right, Y up, Z depth); glTF exports Y-up.

## Deliverables
10 self-contained GLBs (embedded 256px procedural PBR textures, shared K_* palette): table, hearth, counter_a, counter_b, shelf, roof_truss, gable_wall, wall_panel, floor_rug, teacup.
`placement_enchanted_kitchen.json` (schema 1, 45 placements), `kitchen.blend` (full layout + preview lights), `preview_ground.png`, `preview_elevated.png` (roof hidden), `stats.json`.

## Budget (stats.json)
11,064 unique triangles (limit 25k); see stats.json for placed triangles. 346 draw calls if nothing is batched (old kitchen ~950); each asset is one mesh per material. No lights in any GLB. Emissive materials only (K_fire, K_magic) for flames, lanterns, windows, cups.

## Verified
Every texture mean is nonblack (darkest, iron, 0.13). Each mesh has positive signed volume, so faces wind outward. UVs are finite on every mesh. Backface culling is on. Ground and elevated renders were reviewed.

## Placement notes
- Origins are at floor level. Yaw is degrees about Y (positive turns +X toward -Z). Table at (0,0,-2); hearth front at z=-10, back to z=-12; teacups at (±5.7,2.1,-4) (origin at cup centre).
- Benches at x=±10.6 (front faces the room; the right side uses yaw 180), shelves at x=±11.7. Wall panels use yaw 90 / -90 / 0 / 180 so +Z of the asset faces into the room.
- Rug (6 x 4.6) and floor sit at y=0.02-0.05 and are visual only. Hide the old floor mesh or accept z-fighting below 2 cm.
- Assumed wall top 5.5 m, ridge 8.5 m (WALL_H in builder). Hide the old ceiling/beams, otherwise they may cover the roof. Verify the real ceiling height in-game and change WALL_H if needed.
- The chimney stack pokes through the roof (top y=9.7); hide or accept it.
- The game's "THE ENCHANTED KITCHEN" label floats near the hearth face; the hearth mantel projects to z=-9.6, which may clip the label. Nudge the label if so.

## Collision intent (visual-first, all conservative)
Keep the old invisible collision for room walls, side cabinets and table. Add none from this kit, except an optional hearth box (5 x 3.5 x 2 at the wall) if wanted. Route samples (0,11), (5,7), (5,2), (5,-3), (5,-7), (0,-6) are clear. The nearest kit pieces are the table and rug (x within ±3.3, z -4.3..0.3, plus stools at z≈-0.6/-0.65) and the counters, which start at |x|≈10. The portal at (7.5,9.5) has no kit object within about 4 m.

## Charming details
Self-stirring soup pot with glowing bubbles (counter_b); mouse-holes with cheese at the hearth base and in a cabinet; glowing potion jars; hearth cauldron; hovering steaming teacups with sparkles; herb bundles under shelves and the mantel; lit lanterns on the trusses.

## Known limits
Wood texture is stylised and slightly blotchy at close range. Windows show emissive sky panes, not real openings. Not tested in Godot; import and check scale and mesh batching there.
