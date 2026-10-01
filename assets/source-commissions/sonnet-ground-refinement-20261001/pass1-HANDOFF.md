# Ground refinement handoff — Sonnet 5.5, 2026-10-01

**Status: authored, NOT run.** Nothing here was parsed or rendered by Godot. I started a headless parse check against
the active `godot/` project, stopped it before it finished, and confirmed afterwards that `git status` is clean and no
Godot process is left. Treat every file as untested source: first job is a parse + Orchard/Pinewood capture.
Nothing outside this folder was edited. Source files are `input/` copies; `git diff --no-index input/X output/X` shows each change.

## Files to promote (`output/` → `godot/`)

| output file | destination | change |
|---|---|---|
| `assets/orchard_kit/orchard_ground_visual.gdshader` | `godot/assets/orchard_kit/` | rev-5 palette, anti-speckle, grass↔soil↔rock transitions, mask warp |
| `orchard_ground.gd` | `godot/` | texture repeat 0.60/0.68 → 0.40/0.44 per m |
| `ground_surface_palette.gdshader` | `godot/` | new `contrast`, `drift_amount` uniforms; ragged accent blend |
| `ground_surface_palette.gd` | `godot/` | `DRIFT` per-zone hue table, larger tile, stronger accent, contrast |
| `ground_kit.gd` | `godot/` | legacy grass retirement, anchor/cluster/gap ecology, mask-driven chances |
| `orchard_dressing.gd` | `godot/` | `flower_clump` retired, new rim pass |
| `orchard_foliage.gd` | `godot/` | canopy response in tree shader, new `shadow_material()` |
| `orchard_art.gd` | `godot/` | canopy shadow twin (instanced crowns and the interactive-tree upgrade) |

No new binary assets are required. Public function signatures are unchanged; the only additions are optional trailing
arguments (`_surface_kind_chance(..., id)`, `_emit(..., tag)`). Weather uniforms (`rain_wetness`, `snow_cover`), exposure
texture, path painting and `sync_paths`/`add_path` are untouched.

## What changed and why

### 1. Ground shader (Orchard) — `orchard_ground_visual.gdshader`
- **Carpet/speckle.** The albedo texture's luma was multiplied in at gain 2.2 and strength 0.85, and two noise layers
  (`fine` at 0.55/m, near-field tufts at 4.3/m, ±12 %) were added on top. Now: texture luma gain 1.6, clamped
  0.55–1.45 and applied at ×0.62; near-field noise is 0.93–1.05 at 2.6/m; `fine` is 0.93–1.06. Grain stays visible
  under the player, but value structure comes from larger shapes.
- **Large stylized shapes.** Value drift widened to 0.80–1.14. Three new 4–14 m drifts (`drift_a/b`): clover-green
  pools, moss pools (weighted by the damp/litter mask so they sit where the ecology says), and sun-warmed knolls
  (suppressed under litter). New palette uniforms `grass_clover`, `moss_col`; `grass_cool` is a deeper blue-green,
  `grass_lush` and `grass_warm` are more saturated, soils a little richer. Uniform names and bindings are preserved.
- **Grass → soil.** Soil now also appears in thin-turf pools whose edge is cut by the grass albedo's blade luma
  (ragged, not a disc). Along any soil edge (`soil·(1−soil)`), grass blades overlap the soil, and a darker damp rim
  sits just outside them. This applies to paths, banks and worn patches without touching lifted/exposed ground.
- **Soil → rock.** A gravel-fleck scree skirt begins below the rock threshold; moss gathers on the shaded lip of
  slopes before the strata rock takes over. Order is now grass → soil → scree → moss lip → rock.
- **Hard tan polygons.** The macro mask is 0.625 m/texel, so bilinear edges read as straight polygons (the pale
  trapezoid in `orchard_highlands-ground-eye.png`). The mask lookup is now warped by ~1.3 m + 0.45 m noise.
  Placement still samples the unwarped mask, so ecology and gameplay exclusions are unchanged.
- Texture reads: unchanged (the new blade/fray terms reuse `gt`). Added cost is ALU only: 5 `fbm/noise2` taps.

### 2. Floor shader for the other zones — `ground_surface_palette.*`
Large (8–30 m) patches shift toward a per-zone `DRIFT` colour (lawn/moss for greens, rust for quarry/foundry, cool
violet for crystal/starfall), then take a mild chroma lift and contrast about a dark-mid pivot (`contrast` 1.12–1.22).
The accent blend front is eroded by the accent texture's own luma, so soil/rock/grass interleave instead of
feathering. Tile 0.58/0.72 → 0.40/0.52 per m; accent 0.28/0.20 → 0.42/0.30. Still two albedo textures per pixel.
Snow/rain handling is unchanged.

### 3. Ecology — `ground_kit.gd`
- **Legacy `gk_grass_*` (flat green sticks) retired where the surface kit supplies grass.** `LEGACY_GRASS_KEEP`:
  Orchard 0 %, Pinewood/Glade 30 %, Quarry 50 %, others unchanged (Forge Yard keeps 100 %, no kit grass there).
  The loop still draws the identical RNG values and only gates the append, so rock placement and
  `GroundRockCollision` are bit-identical.
- **Anchors.** Placed stones/wood/debris (30 % of the budget, placed first) and, optionally, tree roots are indexed in a
  4 m grid. Grass/fern/litter/flower chance becomes `lerp(open-lawn thinning, 1, proximity) × (0.40 + 1.35·proximity)`:
  clustered at rocks/logs, sparse between them.
- **Deliberate gaps.** A second slow noise (0.036/m) opens clean lawn (up to −88 % understory) so the new ground
  shader is what you see across them.
- **Mask-driven chances (Orchard).** Stones ×(0.55 + 1.7·bank + 0.5·worn). Ferns ×(0.70 + 1.1·bank + 0.5·litter).
  Litter/wood ×(0.30 + 2.0·litter). Props now explain the shader's damp banks and leaf mats.
- **Flowers.** `meadow_flowers` (the PBR prop) only appears as drifts, at gap edges and rock feet.
- Budgets are unchanged: the same `SURFACE_BUDGET`, `SURFACE_SPEC_LIMIT` 8, chunking and visibility ranges.
  Acceptance is now selective, so if attempts run out a zone ends *below* budget, never above.
- **Optional hook:** `root.set_meta("orchard_tree_positions", Array[Vector3])` before `GroundKit.populate` adds
  trunk-root anchors. Nothing sets it today, so roots are not yet clustered. Trees are placed in `orchard_art.grove`
  (`tree.position`); one line there would publish them.

### 4. Orchard woodland — `orchard_dressing.gd`
- `flower_clump` (the chunky white flowers) is in `RETIRED`: still placed so the shared RNG stream is identical, never
  emitted. Its `.glb` stays on disk. `ground_kit` `meadow_flowers` replaces it.
- New `_rim_pass`: own seed (+4417), after the main pass. Tufts (3–6) and `fern_lady` (1–2) per rock or fallen log
  (72 % of anchors), biased to the shaded north-west foot, using the same `_allowed`, field and mask rules. About
  1.5 k instances at normal quality. Holders are named `Woodland_rim_*`, so `clear_path` still clears them.

Instance accounting at normal quality (before → after): `flower_clump` 1300 → 0; legacy Orchard `gk_grass` ≤7200 → 0;
rim pass 0 → ~1.5 k. Net about −7 k instances, so the budget falls with no new draw calls beyond the extra rim holders
(≤ 2 species × chunks). If the lawn looks thin after review, raise `RIM_CHANCE` or `RIM_PLANTS` rather than reviving legacy
grass; do not change `COUNTS` ahead of rocks (it shifts the RNG stream).

### 5. Canopy — `orchard_foliage.gd`, `orchard_art.gd`
Limits: the crown mesh architecture is not rebuilt (that needs a Blender pass). This is a bounded shader/shadow adjustment.
- **Visual response.** The tree material now applies cool-shaded undersides → warm sunlit tops
  (`crown_y` ramp), world-space leaf-clump value noise (0.90–1.09) and a sun-catching yellow on the clump peaks.
  Faceted low-poly stays; large flat facets no longer read as one flat green.
- **Shadows.** The hard crown-hull shadow came from the crown mesh casting directly. Crown holders now set
  `cast_shadow = OFF` and a `SHADOWS_ONLY` twin shares the same `MultiMesh`. Its `shadow_material()` discards a
  deterministic world-space clump pattern (~25–30 % holes, `hole_level` 0.40) with the same wind. Shadow-map resolution,
  bias, light energy and filter are untouched, so shadows are not globally weakened. The edge is ragged and the shade has
  light flecks. Cost is the same shadow geometry plus a discard; no new lights, no extra main-pass draws.
  Because the twin shares the `MultiMesh` resource, per-instance hiding in route clearing affects both.
- **Limits.** The pattern is x/z-dominant, so oblique sun (> ~50°) closes some holes between hull layers; if the
  effect is too weak at low sun, lower `hole_level` to 0.36 or raise the noise scale. Interactive-tree crowns get a
  child `CanopyLeafShadow` mesh twin, which doubles shadow draw of that crown only (few trees).
  `tree_kit` fallback trees are untouched.

## Verify (cheapest first)
1. Copy the eight files in, then run `service/test.cjs` and `service/integration.cjs` (fast path); nothing there
   touches this code, so it only guards regressions.
2. Open Godot once: any shader compile error appears in the output (the `.gdshader` edits are the highest-risk lines).
   Check `GROUND_KIT`, `GROUND_SURFACE`, `WOODLAND_DRESSING` log lines; `instances=` must be ≤ the earlier value.
3. Native captures from the same cameras as `input/*-ground-eye.png`: Orchard and Pinewood, plus
   `--ground-surface-quality=off` for the shader alone. Check: no beige trapezoid, no stick-green blades, soft ragged
   canopy shadows, plants hugging rocks with open lawn between, no bare disc where legacy grass was.
4. Rock collision regression: `GroundRockCollision` / `WoodlandRockCollision` transforms must match the previous run (RNG
   preserved by design). Rain and snow: set wetness/snow and confirm paths still darken/whiten.
5. Raise/Sunder on lawn: exposure rims are unchanged code, but the new `thin`/fray terms are gated by `lifted`, `steep`
   and `leaf`; confirm no brown disc returns on a Raise.

## Known risks
- Unrun GLSL/GDScript. The `lifted` and `steep` variables are used by the new soil block, which sits after both
  declarations; the soil-block `leaf` and `gl` come from earlier lines (check if the compiler complains).
- `shadows_disabled` in the shadow-twin `render_mode` is intended to be harmless for a `SHADOWS_ONLY` caster; if Godot
  rejects it, delete that token.
- I did not render the new look, so contrast constants (`contrast` 1.22, drift strengths) are judgement values.
  Tune `texture_strength` and the `drift_*` smoothstep centres first.
