# Sonnet tree-cutting kit

Authored by verified `claude-sonnet-5-5` through the personal Claude.ai Pro subscription (`fauxgrady@gmail.com`); API/billing environment overrides removed. The isolated commission completed in **339.287 seconds** on 2026-09-30. Codex integrated and inspected actual Godot Mobile first/second-cut and stump/log captures.

`build_kit.py` is the deterministic Blender 4.5.13 source; `kit.blend` is editable. Run the command in `HANDOFF.md` with an explicit output directory. Generated runtime GLBs live in `godot/assets/tree_cutting/`; each embeds its textures. The kit contains progressive cut mouths, cut endgrain, bark chips, a Y-axis lumber log and an open skull basket. Measured dimensions/axes/triangle limits and limitations are in `HANDOFF.md` and `stats.json`.

Runtime systems use the real cut height and mesh split, scale the authored art, and keep visual log pickup separate from resource-award state. Diagnostic captures are ignored under `outputs/tree-cutting/`; use `godot/tree_cutting_capture.gd` to recreate them without loading the live game or touching saves. See `docs/TREE-CUTTING.md`.
