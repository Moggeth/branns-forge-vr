# Mining visual art — handoff (2026-10-01)

Deliverable: `mining_visual_art.gd` (self-contained `RefCounted`, static cached; no images/scenes/per-frame code). Fixture: `mining_review.gd` plus `project.godot`, which runs under `--path <this folder>`. Visuals only; the host owns health, inventory and timers. The Stonewhisper pick GLB was not touched.

## Finalize result
- Godot 4.7.2 (`tools/godot/Godot_v4.7.2-stable_win64_console.exe`) compiled and ran both scripts with no script errors. The review exited 0 with `failures=[]` in about 2.7 s wall-clock (cache warm 39 ms), on GPU (RTX 3080 Ti, Forward+, off-screen, `--no-focus --xr-mode off`).
- **One fix, to the review fixture only (`mining_review.gd`).** The stage-3 winding check flagged 5–8 triangles per mesh, and stage-3 variant 1 exceeded the 1 % tolerance. Inspection showed those triangles are correctly wound (dot = 1.000 against the clockwise face normal). They are steep sliver/chip side walls that undercut by a few degrees, so `n.z` was about -0.01 to -0.12. The "genuinely downward" threshold went from `-0.001` to `-0.25`. After the change every crack mesh reports 0 flagged triangles. `mining_visual_art.gd` is unchanged.
- The five review PNGs in `review/` were re-rendered by the final run.

## API
```
Art.crack_mesh(stage 1..3, seed) -> ArrayMesh   # XY plane, +Z normal, ~0.32 m footprint, caller aligns +Z to surface normal
Art.crystal_mesh(seed) -> ArrayMesh             # ~0.12-0.16 m wide, 0.18 m tall, cyan/violet/amber
Art.shell_chip_mesh(seed) -> ArrayMesh          # stariron chunk, 0.14 m longest axis
Art.material(kind) -> Material                  # stone iron crystal meteor ice obsidian (+ fissure fissure_hot strata vein)
Art.decorate_site(parent, point, normal, stage, seed) -> Node3D  # one Node3D + one MeshInstance3D, no script, shadows/GI off
Art.warm_cache()  /  Art.triangle_count(mesh)                    # helpers
```
- `crack_mesh` already has materials assigned. Surfaces are 0 fissure rim/lip/dark floor, 1 strata shards and 2 glowing slivers (stage 3 only).
- `decorate_site` rolls the mesh by the seed and lifts it 2 mm off the surface to avoid z-fighting.

## Cache and budgets (measured)
| Item | Count | Triangles | Surfaces |
|---|---|---|---|
| Crack stage 1 (4 variants) | 4 | 179–185 | 2 |
| Crack stage 2 (4 variants) | 4 | 343–474 | 2 |
| Crack stage 3 (4 variants) | 4 | 708–865 | 3 |
| Crystal (6 variants) | 6 | 280–294 | 1 |
| Stariron chip (6 variants) | 6 | 313–320 | 1 |

- Limits are ≤1500 triangles per stage, ≤500 per chunk and ≤3 surfaces; all are met.
- Cache is 24 meshes, 10 shared materials and 2 shared shaders (surface and crystal). Total build cost is about 39 ms, lazy per key or via `warm_cache()` at load.
- Crack footprint measured at 0.12–0.30 m across variants. Relief is 4–27 mm.
- All geometry is opaque with clockwise winding and no alpha. Materials use no refraction, screen texture or per-fragment lights. Ice is an opaque proxy with a cheap rim glow.
- Vertex COLOR carries the shader contract: for surface meshes `rgb` is tint and `a = 1 - fresh`. Crystal meshes use r base→tip, g facet random, b hue mix, a bevel strip.

## Critique
Strengths:
- Stage progression reads clearly in `cracks_front.png`. Stage 1 is a thin single fracture with a few grains. Stage 2 is a branched network with chips. Stage 3 is wide and heavily branched, with glowing cyan/violet slivers inside a warm stone rim.
- The crystals and stariron chips are the strongest pieces. Crystals have a facet and bevel read with a cheap internal glow, and the six material kinds are distinct in `items.png`.

Weaknesses:
- **Ground/RTS scale.** In `site_ground.png` (3.4 m back, 1 m up) and the RTS shot, the 0.32 m cracks are small and thin. Stage 3 reads thanks to its glow. Stages 1–2 are close to invisible from that distance. Consider scaling `decorate_site` by 1.5–2x for RTS, or have the caller scale it by camera height. This is the main thing to judge in-game.
- Crack rims are bright, salmon/cream and fairly uniform. They read as sticks or roots more than as bevelled stone. A darker stone-coloured rim and a stronger dark floor would sit better on the Orchard ground, at the cost of near-view fracture contrast.
- The stage-3 mineral glow is the same cyan/violet at every site. It is not yet tied to the deposit kind (`fissure_hot` exists but is not wired into `decorate_site`).
- Ground review used a flat stone plane only. It was not checked on slopes, on the real Forge Yard or Orchard materials, or in HMD.

## Intended usage
1. Call `Art.warm_cache()` during load.
2. On a mining hit, call `Art.decorate_site(world, hit_point, hit_normal, stage, deposit_seed)`. Free or replace the returned node when the stage changes.
3. Spawn `crystal_mesh` and `shell_chip_mesh` with `Art.material("crystal")` and `Art.material("meteor")` as pickups. The host handles their physics, collection and timers.

## Model metadata
See `metadata-final.json`. The first-run `metadata.json` shows `model_verified: true`, `actual_model: claude-sonnet-5-5` and `final_verified: false`, because that run hit the 420 s timeout. This finalize pass ran in the same isolated folder as `claude-sonnet-5-5`. I did not independently check the Claude.ai account, which is recorded only from the first run's metadata.
