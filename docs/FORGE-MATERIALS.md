# Forge Yard materials — 27 September 2026

Four generated colour maps live in `godot/assets/forge_materials/`: `grass.png`,
`timber.png`, `stone.png`, and `iron.png`. They are applied only to selected
Forge Yard ground, shelter, masonry, furnace, benches, boards, and anvil parts.
Geometry and collision shapes are unchanged. `godot/forge_materials.gd` owns the
shared material cache, triplanar scale, tint, roughness and load timing; tune it
before modifying every prop individually. The high-detail images are colour
maps, not normal/roughness maps. Other zones retain their existing palette.
The four `.png.import` files enable mipmaps to prevent distance shimmer.
ResourceLoader uses Godot's imported texture in an exported pack; direct
source-tree diagnostics can fall back to the PNG before an editor import.

Source images were generated with OpenAI imagegen. The source prompts, in
brief: seamless orthographic meadow grass/earth with straw; warm weathered
timber grain with no plank borders; gray-beige worked sandstone with subtle
aggregate; dark blue-gray forged iron with restrained hammered variation. All
prompts asked for uniform lighting, no objects or text, square tiling and no
border. The full-resolution originals remain in Codex's generated-images
folder; the named copies here are the runtime sources. Do not replace them
with a rendered prop or a perspective photograph.

Review the real Mobile-renderer captures at
`outputs/forge-material-pass.png` (forge and anvil) and
`outputs/stonewhisper-pass.png` (grass-to-stone edge and tool silhouette).
Captures use a native window with `--xr-mode off --audio-driver Dummy`; headless
capture stalls because `frame_post_draw` never arrives. The `FORGE_MATERIAL`
startup lines show per-map load cost and which loader route ran. Desktop captures verify appearance only;
the final tint and scale still need a headset look for comfort and shimmer.
