# Ground surface kit — source and verification

Sonnet 5.5 authored this coherent 18-prop kit and six seamless PBR terrain families using the personal Claude subscription. The original 840.330-second commission exported the complete kit before its time cap, but did not produce a successful final session result. Its metadata records that outcome; final-model verification must not be inferred from the completed files. Codex independently imported, checked and visually reviewed the exported assets before accepting them.

The installed game package is `godot/assets/ground-surface-kit/`. Editable authoring code and reference sheets are retained here. `ground_surface_kit.blend.zip` contains the original Blender scene (compressed to keep the individual Git file manageable). Extract it outside the Godot project when editing; putting a source `.blend` under `godot/` activates Godot's external Blender importer unnecessarily.

Regenerate the deterministic kit with `python build.py --out <absolute-output-directory> --skip-blender`. Run without `--skip-blender` only when the configured Blender executable is available. Dependencies are NumPy and Pillow; the optional scene assembler uses Blender. See `build.py --help` for subsets. These textures are procedural artist output; their colour, normal and ORM maps are matched sets, not unverified image-to-normal conversions.

Acceptance: all 18 GLBs and six material triplets loaded in native Godot 4.7.2. The strict gate found UVs, normal arrays and 18 PBR surfaces, 12,335 source triangles, 2,290 placed instances and 257 MultiMesh holders across all 12 regions. Actual Vulkan Mobile-renderer screenshots were reviewed from eye level and elevated viewpoints. See `docs/GROUND-SURFACES.md` for reproducible commands, quality controls, performance measurements and limitations.

This kit supplies decorative vocabulary. Terrain fields, vegetation exclusions, weather, traversal and authoritative world changes remain owned by the existing gameplay systems.
