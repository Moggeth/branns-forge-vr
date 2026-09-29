# Pocket Thunder v2 handoff

Status: first version. Blender asset and Godot VFX both run; Godot side was smoke-tested in a disposable Godot 4.7.2 project (no script or shader errors, blast captured). It has NOT been run inside the live game, in VR, or on Quest-class hardware.

## Deliverables (all under output/)
- `build_bomb.py` deterministic Blender 4.5 builder (`blender --background --python build_bomb.py -- <outdir>`); writes `pocket_thunder.blend` and `bomb.glb`. No RNG, no external assets.
- `bomb.glb` self-contained, ~168 KB, 2,700 tris, 3 shared materials (PT_Forged, PT_Brass, PT_HeartGlow), no textures. Radius 0.095 m, Y-up.
  Nodes: `PocketThunder` root > `Heart`, `Shell` > `Shell_Seg_00..23` (origin at each segment's centroid, so scaling/offsetting works in place), `Binding`, `Crown`, `Base`, `TrailOrigin`.
  Blender custom props `burst_dir`, `row`, `col`, `phase` are on each segment (arrive as glTF extras; the GDScript derives them from name and rest position instead).
- `render_previews.py` + `render_01_hero.png`, `render_02_palm_scale.png`, `render_03_flight_scale.png`, `render_04_forming.png`, `render_05_seam_glow.png`.
- `godot/pocket_thunder_visuals.gd` + 5 `.gdshader` files (drop-in for `current_bomb_visuals.gd`), `godot/preview_harness/` (test scene), `previews_godot/` (blast frames and contact sheet), `STORYBOARD.md`.

## Integration steps
1. Copy `bomb.glb`, the `.gd` and all `.gdshader` into `res://pocket_thunder/` (or edit `BOMB_SCENE_PATH`/`SHADER_DIR`). Let Godot import the GLB.
2. Swap the script used for the visuals node; `setup(game)`, `create_bomb`, `update_forming`, `tick(delta)` and `explosion(pos, radius, intensity, duration, spark_count)` are unchanged. Optional: pass bomb velocity as 6th arg `direction` to `explosion`; call `update_fuse(model, elapsed/fuse_time)` each frame to drive the heart pulse.
3. Gameplay decides when to call `explosion`; the visual anticipation snap is the first 60 ms of it. If damage must land exactly on the pop, apply damage at call time + 0.06 s x (duration/0.75), or call `explosion` 60 ms early.
4. Bomb must be hidden/freed by gameplay when `explosion` is called; the floor probe ray (6 m down) will otherwise hit its collider. Add exclusions to `_floor_offset` if needed.
5. Trail keeps the `magic_bomb` group and `exploded` meta contract; it is now a tapered additive ribbon (12 points) facing the camera instead of 1 px lines.
6. Enable glow/bloom in the game Environment for the jewel emission; without it the heart reads flatter (still legible).

## Performance budgets (targets, not measured in-game)
- Live bomb: 2,700 tris + 5 motes, ~30 mesh nodes (24 segments). Each segment is its own draw; if many bombs are live, a merged-mesh LOD (see below) is the first optimisation.
- Blast rig (pooled, max 4 concurrent): 7 draw calls (disc, dome, core + 4 MultiMeshes), 14 chips + 40 sparks + 20 embers + 6 smoke = 80 instances, no allocations at explosion time except one RNG and small arrays.
- Lights: pool of 2 OmniLight3D, no shadows, active only ~0.6 s per blast; blast 3+ while both are busy simply has no light.
- Transparent overdraw: dome + disc + 6 smoke spheres are the fill-rate cost; dome is unshaded fresnel and fades by 0.44 x duration.
- CPU: ~80 instance transforms per active blast per frame in GDScript (~4 blasts = ~320); should be well under 1 ms but is unprofiled.

## Known gaps / review items
- Sparks and the core saturate toward white under Filmic + glow in the harness; lower spark alpha or emission if this washes out in the real environment.
- Shell facets read as checkered squares at close range (4x4 grid). Next art pass: fewer/larger facets with etched runes on the plateaus, bevel highlights, and an embedded 256 px etched normal/ORM texture.
- The palm proxy render uses a crude hand stand-in; use it for scale only.
- LOD idea: a single merged shell mesh for bombs further than ~3 m or when many are live.
- Heart material emission is pulsed globally (shared resource), so all bombs pulse in phase; per-bomb phase would need per-instance material.
- Audio is the same synthesised style, extended to 0.7 s with a 60 ms tick; not auditioned.
- Debris chips reuse `Shell_Seg_00`'s mesh; all chips look alike.
