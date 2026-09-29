# Mooncap Lantern refinement handoff
Files: build_mooncap_lantern.py, mooncap_lantern.blend, mooncap_lantern.glb (self-contained, embedded textures), build_stats.json, preview_threequarter/closeup/front.png.

Changed (from game_first_pass.png critique):
- Cap: 54-segment dome with a 6-lobe scalloped, drooping brim, 18 subtle geometric ridges, 256px albedo with radial veins, blotches and pale spots. Emission cut from 1.6 to 0.45 (textured), roughness 0.7, so shading survives.
- Gills: 32 cubes replaced by one mesh of 40 solid tapered radial fins (closed prisms, no thin one-sided faces) plus 8 motes. Emission cut from 2.0 to 0.55 and the texture is a dark violet-teal gradient brightening only at the fin's free edge. No transparency.
- Handle: ~4.2 cm grasp section, lighter lengthwise grain/knot texture, and a separate cloth wrap (RootWrap, 6 coils).
- Brass: darker recessed patches, leaf-like embossing in albedo, scalloped BrassBase, roughness 0.5, metallic 0.85. All meshes now have UVs (the first pass had none on the brass curves, hence flat gold).
- Node names kept: LightAnchor (empty at z 0.55), MooncapGlow (cap mesh).

Stats: 4,812 triangles, 6 materials, 14 mesh nodes (draw items) plus the LightAnchor empty. Height 0.860 m, width/depth 0.394 m, grip origin (0,0,0) (bottom at -0.02 m).
Known limits: brass rib/ring UVs are cylindrical fallbacks, so embossing there is only approximate. Gill undersides are lit mostly by emission; check in-game intensity (StandardMaterial emission energy can be tuned down further). Textures are procedural 256px/128px, not hand-painted. Previews are Blender EEVEE, not Godot.
