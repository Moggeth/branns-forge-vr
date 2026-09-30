# Golem rebuild — handoff (Claude Sonnet 5.5, isolated `work/sonnet-golem-oct1/output/`)

## Generated files
- `build_golem.py` — editable, deterministic source: procedural tileable textures (numpy → PNG), materials, geometry, pivots, animations, export. Builds in about 3 s.
- `golem.glb` — 17.1 MB binary glTF, 28 embedded images, 14 meshes, 9 materials, 20,006 triangles, animations Idle/Walk/Slam.
- `golem_source.blend` — the Blender scene that produced the GLB (outside `godot/`).
- `textures/*.png` — source maps (base/normal/ORM per material + `Glow_em`).
- `render_preview.py` — imports the **exported GLB** into a clean scene and renders previews, so the images prove the embedded textures survive export.
- `preview_three_quarter / front / side / back / closeup_head / rts / vr_eye / breakdown .png`
- `build_report.json` (node list, materials, per-mesh triangle counts, bounds, texture stats) and `ART-CONTRACT.md` (dimensions, pivots, budget, animation and damage guidance).

Commands (from the `work/sonnet-golem-oct1` directory, Blender 4.5.13 from `tools/blender-4.5.13-windows-x64/`):
`blender.exe --background --factory-startup --python-exit-code 2 --python output/build_golem.py`, then the same with `output/render_preview.py`.

## Verification performed
- Export asserts: every material has a base-colour texture, at least 9 images, at least one animation; each base texture has mean luminance > 0.08 (no black textures). Emissive (Glow), normal and metallicRoughness textures are present on the exported materials.
- Viewed front, three-quarter, back, head close-up, and modular breakdown renders of the re-imported GLB. Parts separate cleanly and the remaining body stays closed. RTS, side and VR-eye renders were produced but not inspected individually.
- **Not done:** no import into Godot 4.7.2 / SteamVR, no mobile-renderer timing, no check of how Godot plays the NLA-exported clips, no HMD comfort review. No gameplay code, credentials or active checkout were touched.

## Limitations / next steps
- Silhouette is chunky and boxy. The head is smallish; from eye level the mouth, teeth and tusks in `HeadMesh` are partly hidden behind the shoulder yoke and cheeks. Quick fix: raise the Head pivot about 0.06 and lower the yoke, or enlarge the head scale in `build_head()`.
- Fingers are short chisel blades with iron tips and could be longer. Copper bands are flat rings and read slightly like flanges on the arms.
- Stone edges use one-segment chamfers with 62° sharp splitting: fine at distance, faceted up close; the normal maps carry the detail.
- Height is 2.34 m including moss and crest (body about 2.26 m), slightly over the 2.2 m brief. Scale the `Golem` root by 0.95 if the exact height matters.
- The GLB is 17 MB because PNGs are embedded. Reduce resolutions in `make_textures()` if size matters.
- Left and right are separately noised (intentional asymmetry), not mirrored copies.
- Animations are rigid-pivot poses only; Slam telegraph holds frames 26–32, impact at frame 36.
- The 720 s cap was exceeded in wall-clock. A usable export existed after the first build; two refinement passes followed.
