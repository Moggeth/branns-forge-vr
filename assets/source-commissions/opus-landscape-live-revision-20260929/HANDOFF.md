# Orchard live-revision handoff (Opus, 2026-09-29)

Revised against the 10 real-game captures in `input/captures`, all reviewed at 1200x750.
**I have not seen the integrated game after this revision.** Everything below was checked only in a
disposable Mobile-renderer preview (`_preview/`). That preview uses stand-in terrain, real-shaped
Sunder and Raise height deltas, the game's own exposure-painting algorithm, the river UV contract and
stand-in trees with world_builder timing. The coordinator's real-game captures are the authority.

## 1. Files to copy (live paths are relative to `godot/`)

| output/ file | live destination | change |
|---|---|---|
| `orchard_kit/river_water.gdshader` | `assets/orchard_kit/river_water.gdshader` | rewritten, same uniforms + UV contract |
| `orchard_kit/orchard_ground_visual.gdshader` | `assets/orchard_kit/orchard_ground_visual.gdshader` | rewritten, same uniforms, same `exposure_tex` contract, adds one optional `clay_col` |
| `orchard_kit/backdrop/mountain_cliff_chunk.glb` | `assets/orchard/mountain_cliff_chunk.glb` (**replace**) | new massif, same footprint and pivot |
| `orchard_kit/backdrop/mountain_peak_snow.glb` | `assets/orchard/mountain_peak_snow.glb` (**replace**) | new massif, same footprint and pivot |
| `orchard_vfx/orchard_spell_vfx.gd` | `orchard_vfx/orchard_spell_vfx.gd` | Sunder/Raise/Grow builders revised, new kit meshes |
| `orchard_vfx/assets/spell_kit.glb` (+ existing `.import`) | `orchard_vfx/assets/spell_kit.glb` | 19 meshes (was 11). Presenter requires all 19 |
| `orchard_vfx/shaders/kit_surface.gdshader` | same | adds world-space facet grain |
| `orchard_vfx/orchard_horizon.gd` | same | darker bands, forest-crown near band, **no longer overrides sun** |
| `orchard_vfx/orchard_atmosphere_grade.gd` | same (new file) | depth/form layer that runs after the atmosphere pipeline |

Unchanged (keep as they are): `orchard_kit/*.glb` visual kit, `orchard_kit_materials.gd`, `pool_water.gdshader`, `dust_puff.gdshader`, `magic_mote.gdshader`.
Editable source: `build_spell_kit.py`, `build_backdrop_kit.py`, `source/spell_kit.blend`, `source/backdrop_kit.blend`.
Delete the stale `.uid` files only if Godot complains. The new GLBs need a normal editor import pass.

## 2. Build steps

```
B=tools/blender-4.5.13-windows-x64/blender.exe
$B --background --factory-startup --python output/build_spell_kit.py    -- --out <ABS>/kitbuild      # prints PIECE tris, SPELL_KIT_OK (~1 s)
$B --background --factory-startup --python output/build_backdrop_kit.py -- --out <ABS>/orchard_kit/backdrop   # BACKDROP_OK (~1 s)
# preview (disposable, never touches repo):
bash output/_preview/sync.sh
G=tools/godot/Godot_v4.7.2-stable_win64_console.exe
$G --headless --path output/_preview --import
$G --path output/_preview --script res://preview.gd -- --tag final        # ~47 s wall, writes shots/ + metrics csv
```
Colour contract fix: both builders now write the palette as sRGB converted to linear, into a FLOAT_COLOR
attribute. The old kit wrote display values as linear, so everything rendered about 2x too bright. That caused the neon sod
blocks and chalk-white debris in captures 02, 03 and 05.

## 3. Integration hooks for Sol

1. **Atmosphere (no static daytime).** The old `OrchardHorizon.apply_orchard_grade()` set `sun.light_energy = 1.25` and a fixed
   colour, which froze daylight. It now only sets shadows. Add one line wherever `AtmospherePipeline.apply(env, sun, sky, hour, weather, q)`
   runs for the Orchard:
   `preload("res://orchard_vfx/orchard_atmosphere_grade.gd").apply_after(env, sun, hour, weather)`
   That gives sky-split ambient (form on hills), aerial perspective scaled by day, noon elevation capped at 44° (longer
   shadows; dawn and dusk untouched), blended shadow splits, a softer sun in rain, and a mild contrast grade. Everything is relative to the
   pipeline's values. No bloom, flicker or exposure animation (VR comfort).
2. **Backdrop source.** The pale stepped mountains come from `godot/orchard_art.gd` lines ~224-231: 8 × `mountain_cliff_chunk` at
   r = 226 m and 3 × `mountain_peak_snow` at r = 395 m. Fix it by replacing the two GLBs; no code change is needed. `Finish.apply_mesh` already
   enables vertex-colour albedo. Tris: cliff 832 (original 832), peak 1440 (original 1040).
3. **Carved-path blocks on Raise (captures 05 and 06).** Source: `world_builder_runtime.gd::_render_path()`. It builds an
   **unshaded** tan quad strip draped once at carve time, so later Raise or Sunder ops bury or float its segments.
   `orchard_ground.add_path(a, b)` already paints the path into `macro_mask.r`, which the ground shader draws as soil. Smallest fix:
   in `_render_path`, skip adding the `CarvedPath_%02d` MeshInstance, or set `mesh.visible = false`. Keep the waymarker, the `data.paths`
   record, `orchard_ground.add_path` and navigation untouched, so gameplay is unchanged. Preview samples 08 and 10 show a path drawn only
   through the mask, crossing a Raise without floating blocks. If a raised tread is still wanted, re-drape the strip in
   `landscape_spell_dressing.refresh_region` and use the ground shader rather than `SHADING_MODE_UNSHADED`.
4. **Grow Forest.** Keep `main.gd`: `grow_saplings_persist = false`. With `tree_positions` present, the presenter now calls
   `_build_grow_real`. It never draws a second tree. It uses the real schedule (`start = along*0.4`, then 0.4 progress to full scale).
   If `W.tree` crown height differs from 3.3 m (at size 4.4), tune `REAL_TREE_CROWN_Y` and `REAL_TREE_CROWN_R` at the top of the presenter.
5. **Exposure.** No painter change is required. Optional: decaying `r` over game time would let old scars re-green. The shader
   already treats shallow change as trampled turf.
6. `LandscapeSpellDressing` still adds `geo_boulder_mossy_a` ×3 around each Raise and split boulders along each Sunder.
   Those pale mossy boulders in captures 05 and 06 are not mine. Consider scaling them down or dropping them now that the VFX places
   outcrops and scarps.

## 4. What changed and why (critique → fix)

- **River (capture 00):** The long streaks came from 12:1 anisotropic noise scrolled forever. The ripples are now isotropic,
  advected with a two-phase flow map. The metallic look came from low roughness mirroring the pale sky. Now engine specular is
  0.28 and a controlled fake reflection picks up dark banks near the edges. Colour is a stationary world-space pebble bed under
  depth-based absorption (reds absorb first), so shallows read warm and the thalweg deep green-teal. The last ~8 % across becomes wet
  stones, so the ribbon meets the bank as a shoreline. It stays opaque with no depth or screen reads.
- **Sunder (02/03):** Lips were rectangular 4×6 grids, evenly spaced. They are now irregular 11-sided sod plates with a saw-toothed
  tear edge, overhanging grass skin, turf/topsoil/subsoil/clay bands on the torn sides and hanging root threads. They are placed in clusters with gaps and
  mixed with thin crusts. New stratified wall panels (`wall_a/b`, eroded ledges) stand at the foot of each bank. Their tops sit at the original
  surface and their height scales to the real cut depth. The ground shader colours the walls by **depth below the original surface**, so bands follow the
  heightfield's cut from any view. Floors get loose topsoil and gravel. Dust is born only at the moving front, is 55 % of the old count,
  thinner and shorter-lived, and nothing is born after the front ends. That fixes the dust blanket in capture 03.
- **Raise (05/06):** The dark disc came from painted `r` reaching 1 for any change over 16 cm, with the old shader turning all of `r` into soil.
  Heaved turf now stays green. Soil shows only on one narrow, wobbling **stress contour** on the lower shoulder where the heave is
  steep (gradient from 4 exposure taps), with sparse tension cracks beside it and rare fresh-stone outcrops at the crest. The VFX
  puts sparse turf crusts and angular shards along 2-3 broken arcs, at the seam radius measured from samples. Spall debris rolls a short way
  downhill. There is no generic airborne debris, and dust is small, low and ends by 70 %.
- **Grow (08/09):** A seedling wave runs down the cast line from t = 0, so by 0.5 s the first half of the line is sprouting. Each tree gets a
  heave ring and 5-7 surface root runners just before its trunk appears. Leaf clusters then bloom at the real crown height while the
  real tree is ~55 % grown and fold back into its canopy as it completes. Motes spiral up the trunks.
- **Ground:** Meadow breakup at 3 scales, shaded-slope moisture tint, soft noise clumps, near-field tufts and roughness variation.
  Exposure UVs are noise-warped by ~0.7 m to hide the 1 m texel squares.
- **Backdrop:** Ridged, gullied, flat-faceted massifs on a jittered grid (no terraces). Forested skirts, cool steep rock, and snow only
  on gentle high faces of the far peak. Colours are mid/dark so scene fog provides the atmospheric scale. Horizon bands are darker, the
  near band has a forest-crown serration, and the per-facet random striping is removed.

**Iterations (in `samples/`):**
- iter1 → iter2: (a) my cell-ID "dry patch" term drew hard yellow polygons all over the meadow, replaced with smooth noise;
  (b) the Raise seam threshold covered the whole flank in camouflage blotches, fixed with a contour band; (c) sod still too bright
  and rail-like, fixed with a darker palette and sparser clusters; (d) crown blooms floated above small trees, now anchored to the real
  growth; (e) the river shoreline was a bright uniform band.
- iter2 → final: dark box-like `wall_b` scarps on the Raise were made rare and low; seam rock chips halved; the triangle-shaped aspect
  tint was softened.
- Compare `samples/iter1-*` with `samples/final-*`.

## 5. Measured budgets (preview, all three spells live at once, Mobile renderer, 1200x750)

- Spell kit: 19 meshes, 1,672 tris total. Sod plates ~112, walls 302, stones 16-28, leaf_puff 80, sapling 182.
- Live per-frame (Sunder + Raise + Grow simultaneously): 307 animated pieces in ≤ 19 MultiMeshes and 384 billboard particles
  (dust + motes), 33 presenter nodes including ≤ 2 omni lights without shadows. After settle: 127 permanent pieces in 14 shared MultiMeshes. Dust and motes are freed.
- Whole preview frame: 34-122 draw calls, 130k-214k primitives. The 161² terrain plus shadow pass dominates, so this is not a game number.
- Ground shader: 7 texture reads baseline, +4 exposure taps only on disturbed pixels (dynamic branch). River: 0 textures, ALU only.
- Backdrop: 8×832 + 3×1440 tris, no shadows (as before). Horizon: ~1.1k tris per band.
- Full metrics per shot: `samples/final-metrics.csv`.

## 6. Known limitations and real-game QA needed

- Not seen in the real game. Please capture the same 10 views. Check: lip and wall colour against the real ground texture grade; wall panels at
  the real Sunder profile (`_wall_foot` walks outward to the last point with ≥ 72 % of centre depth; cuts under 0.25 m get no walls, and a pure V-cut puts the panel near the centre line); Raise seam radius on
  the real falloff; tree crown height constants; river at VR eye height under real sky radiance.
- The Grow wave at 0.5 s reads well at eye level but is still modest from 30 m RTS in the preview (seedlings ~0.5 m, motes faint
  in daylight). If RTS needs more, raise `dust_scale` for RTS or the sprout scale.
- Wall panels are one-sided in look (face −X). The back is plain topsoil and hidden in the bank.
- The orchard visual kit (`build_visual_kit.py`: bank_stone_lip, boulders, cliff_strata_*, reeds, trees) was **not rebuilt** in this pass.
  It likely has the same linear/sRGB brightness error (pale boulders). Next step: apply `lin()` + FLOAT_COLOR from `build_spell_kit.py`
  there and replace the horizontal strata stripes with the wall-panel band logic.
- The fake river reflection cannot show real bank objects (no SSR on Mobile). Rain rings are approximate.
- `orchard_horizon.gd` changed colours, heights and radii. If the game places it far from the Orchard centre, re-check the silhouette.
