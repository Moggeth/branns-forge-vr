# Pocket Thunder v3 revision

## Copy into game
- `bomb.glb` -> `godot/pocket_thunder/bomb.glb` (re-import)
- `godot/pt_dome.gdshader`, `pt_shockwave.gdshader` -> `godot/pocket_thunder/`
- `godot/pocket_thunder_visuals.gd` (small edits, API unchanged; MAX_BURSTS 8 / MAX_LIGHTS 2 kept, no shadows on lights)
- pt_debris/pt_smoke/pt_spark shaders unchanged.

## Model (build_bomb.py)
- Shell: 13 irregular forged plates (noise-warped Voronoi cells on a fine sphere), was 24 lat/long tiles. Ragged seams left open so the heart shows through; plates have a raised plateau, bevelled edges and dark skirts.
- Plates stay individually addressable: `Shell_Seg_00..12`, origin at centroid, extras `burst_dir`, `phase` (the .gd now reads `phase` from glTF extras; falls back to index-based).
- Materials (still 3): much darker blue-black steel (0.028,0.04,0.07), warmer brass; 3 plates full brass, 4 plates brass-rimmed, rest dark.
- Heart: radius 0.80R, saturated teal-green emission 2.4 (4.0 washed to white in Godot).
- Crown: lower broad collar, five uneven prongs (heights 0.11-0.20R) and a faceted jewel; previous 6 tall symmetric claws looked toy-like. Binding: three broken brass clamp arcs with studs instead of a full ring.
- 2632 triangles, 3 materials, radius 0.095 m, same centre/markers (Heart, Shell, Crown, Base, Binding, TrailOrigin).

## Blast
- Dome: now a thin pressure ripple (rim + moving band), 0.22 of e (was 0.38), max scale 0.6R (was 0.85R), much lower alpha.
- Shockwave: angular-noise ragged front (radius varies ~+-25% by angle), broken edge segments, irregular spokes/scuffs instead of regular rune notches, plus a hot inner pool that lights the blast centre and dies quickly.
- Debris: real bomb plates now larger-but-scaled (0.28-0.6), faster (2.2-4.0R launch speed), lower drag (1.7) so they visibly depart; still 14 multimesh instances.
- Warm pulse: core alpha 0.6 peak, core grows to 2.1x, light peak energy 3.4 with faster decay (7.5). Trail untouched.

## Observations
- Harness: `previews/godot_blast_contact_sheet.png` (rows 1-2 ground-level 8 timepoints, rows 3-4 elevated), `previews/godot_model_forming.png`, Blender renders in `previews/render_0*.png`. Harness script `previews/harness_main.gd` (needs a game stub with `elapsed`).
- Ripple is barely visible after ~0.2s; ring reads clearly from elevated view, ground view shows ragged ring plus warm floor glow. Frame is not washed white; only centre pixels saturate for 2-3 frames.
- No new nodes: same 8 rigs x 7 nodes and 2 lights. Cost changes: shockwave fragment shader has ~6 hash/noise evaluations on a small quad (negligible).

## Limitations
- Plate seams are triangle-stepped (fine sphere quantisation) so edges read sawtooth up close; intentional forged look but not smooth.
- Debris chips are dark and rely on ember heat colouring against grass; not tested in the real game scene/lighting (harness only, flat grass).
- Plate scale relative to chips tuned by eye at radius 2.2; check at other radii. Untested in VR headset or with real physics throw.
