# Orchard art-family revision 4: handoff (Opus, claude-opus-5-5, 2026-09-29)

**I have not seen any of this work in the actual game.** It was checked only in the disposable Mobile-renderer
preview `output/_preview/`. That preview now uses the real `orchard_masks.png`, the real `atmosphere_pipeline.gd`,
the real ground textures and the real `TreeKit` apple trees. The terrain, river and ops are still stand-ins.
The eight real-game captures in `input/captures` remain the authority. Please recapture seed 290929 at 1200x750
after integration, using the same eight views.

## 1. Runtime copy list (live paths relative to `godot/`)

| output/ file | live destination | change |
|---|---|---|
| `orchard_kit/orchard_ground_visual.gdshader` | `assets/orchard_kit/orchard_ground_visual.gdshader` | rev-4b. Same uniforms and `exposure_tex` contract. Adds a vertex() tangent frame |
| `orchard_kit/river_water.gdshader` | `assets/orchard_kit/river_water.gdshader` | colour defaults only (deeper, warmer, less white). UV/uniform contract unchanged |
| `orchard_kit/bank_stone_lip_8m.glb`, `boulder_{small,medium,large}.glb`, `cliff_strata_{low,wide,tall}.glb`, `reed_clump.glb`, `grass_tuft.glb`, `tree_orchard_{round,tall}.glb` | `assets/orchard_kit/` (same names) | rebuilt. Same names, pivots and grounding; footprints within ±15 %. Needs an editor reimport |
| `orchard_kit/visual_kit_manifest.json` | optional, docs only | tris/dims per asset |
| `orchard_vfx/orchard_spell_vfx.gd` | `orchard_vfx/orchard_spell_vfx.gd` | Sunder walls/lips clustered, rockfalls, tighter dust |
| `orchard_vfx/orchard_atmosphere_grade.gd` | `orchard_vfx/orchard_atmosphere_grade.gd` | valley height-fog fix, contrast/ambient retune |
| `tree_kit_patch/tree_kit.gd` | `tree_kit.gd` (**replace**; see hook 4) | seeded apple growth forms. Diff: `tree_kit_patch/tree_kit_forms.diff` (+42/-3) |

Unchanged from the previous handoff: `orchard_kit_materials.gd` (still `vertex_color_is_srgb = false`, which is now correct),
`pool_water.gdshader`, `orchard_horizon.gd`, `orchard_vfx/assets/spell_kit.glb`, and the shaders under `orchard_vfx/shaders/`.
Do NOT copy `tree_kit_patch/tree_kit.orig.gd` (reference only), `_kitbuild/`, `_preview/` or `samples/`.

## 2. Editable sources and build commands (measured on this machine)

```
B=tools/blender-4.5.13-windows-x64/blender.exe
$B --background --factory-startup --python output/build_visual_kit.py -- --out <ABS>/output/_kitbuild --no-render   # 3.8 s, prints VISUAL_KIT_DONE
#   then copy _kitbuild/glb/*.glb -> output/orchard_kit/, _kitbuild/source.blend -> output/source.blend
$B --background --factory-startup --python output/build_spell_kit.py -- --out <ABS>/kitbuild     # unchanged this pass
# preview (disposable; never touches the repo). Re-import is REQUIRED after every sync (sync wipes imports):
cd output/_preview && bash sync.sh
G=tools/godot/Godot_v4.7.2-stable_win64_console.exe
$G --headless --path . --import
$G --path . --script res://preview.gd -- --tag NAME          # ~7 s, 20 shots + shots/NAME-metrics.csv, 240 s watchdog
```
Sources: `build_visual_kit.py` + `source.blend` (old kit), `build_spell_kit.py` + `source/spell_kit.blend`,
and the shaders and GDScript are edited as text. No textures were added. The kit remains vertex-colour only.

## 3. Real-game failure diagnoses (from input/code plus a read-only look at godot/orchard_ground.gd)

1. **Brown Raise disc (05/06).** The mound itself was not the cause. The authored `assets/atmosphere/orchard_masks.png` alpha
   ("disturbed") holds broad soft blobs: 14 % of the map, values up to 0.93. The old shader did
   `soil_amt += m.a*0.5 + slope_soft*0.45`, so any Raise flank landing on a blob went fully to soil. My previous preview used a
   synthetic mask with a = 0, which is why it looked green. **Fix:** exposure is sampled first, and `lifted` (heap > ~10 cm)
   cancels mask and slope soil. The mask alpha now reads as drier, trampled grass with a few broken scuffs. Only the rim is bare.
2. **Full dark ring + crack net (06, 02).** The seam spanned 0.5–0.95 m of heave, which drew a closed ring. `cracks` covered the whole mound, and
   **`clods` used the Voronoi F2-F1 edge distance, so it drew cell OUTLINES.** That was the scribbly polygon net beside
   Sunder and Raise. **Fix:** the rim now spans 0.07–0.48 m of heave (0.5–1 m wide on a real flank). It is broken into runs by stretched noise, with a thin lit sod
   lip above it. Cracks are sparse (8 % of cells) and hug the rim only. Clods and floor gravel are now filled cell interiors.
   (Compare `samples/iter1-sunder-after-eye-crack-net.png` with `after-preview-sunder-after-eye.png`.)
3. **Chalk-white kit.** `build_visual_kit.py` wrote already-linearised values into a byte colour layer, so the pipeline converted them again.
   It now writes true linear values into a FLOAT_COLOR attribute, exactly like the spell/backdrop kits, and the rock palette is ~25 % darker and muted.
4. **Washed-out river and near meadow (00).** The pipeline's height fog floor is `fog_height = 0.05`, with `height_density 0.02`.
   The river valley sits below y = 0, so the brook and its banks were veiled milky-grey at 5–20 m. See hook 1.
5. **Regular Sunder (03).** Wall panels were spaced every 1.5–2.4 m on both sides at 80 %, and lips every 1.2–3.6 m. Both formed a rhythm.

## 4. What changed (visual work)

- **Ground shader:** the fixes above. Sunder strata are now warped at three scales: layers pinch and thicken, and the depth scale varies 0.75–1.3.
  They are also broken into chipped joint blocks with per-block value. Worn-mask grass, rim lip and rim cracks are new.
  Near-detail fade now uses view distance instead of `fwidth` (removes a per-facet discontinuity). A tangent frame is built in `vertex()`,
  because the heightfield meshes carry no TANGENT array but the shader writes `NORMAL_MAP`.
- **Sunder VFX:** walls come in runs of 1–4 panels per side. Each run has its own scale family (0.55–1.35), yaw ±0.45 and lean 4–26°.
  35 % of panels slump 0.2–0.6 m and drop a 2–4 stone rockfall at their foot. Runs are separated by 2–7 m gaps where only the shader
  strata show. Sod lips form clumps of 1–3 (one dominant plate plus shards at 0.45–0.75 scale), yaw ±0.9, tint 0.7–1.0 (some earth-dark).
  Clumps are 2.5–8 m apart. Dust life is 0.45–0.8 s and end size 0.35–0.65 w, so it is a knot at the tear front rather than a strip.
- **Old kit:** boulders are convex-hull fractured stones with 1–2 planar fracture cuts, per-facet key light value, lichen, and moss only on
  true tops (~50 tris each; was ~320 lumpy icospheres). Cliffs have low-contrast interrupted bands, jointed-block value, iron seeps,
  and a foot that darkens into soil. Ledge tops are sod-brown, not neon. Bank lip: stones cluster 2–3 per module with bare gravel between them.
  Sizes vary 0.14–0.56 m, flattened and rotated. The top is damp soil (matching the ground shader's `bank_wet`), the shelf is gravel, and the water edge is wet dark.
  Reeds are a per-blade mix of sedge, reed and dry rush, with a wet dark base.
- **River:** deep 0.030/0.100/0.095, mid 0.075/0.19/0.155, warmer ochre shallows, absorption depth 2.2 m, fresnel 0.22,
  sky reflection ×0.62, foam 0.32 with a narrower lace. It is still opaque with no depth or screen reads. Weather and day-night work as before (uniforms unchanged).
- **Grade (relative only, no static daytime):** in clear daylight the height-fog floor drops to −4 m with density ×0.45, and distance fog ×0.7.
  Aerial perspective goes up to 0.6, so peaks still recede. Ambient is ×0.74, sun ×1.08, contrast 1.03→1.14, saturation up to 1.1 and brightness 0.97.
  Dawn, dusk, night, rain and snow blend back to the pipeline's own values, so valley mist in rain is kept. No bloom, flicker or exposure animation.
- **Trees (`tree_kit.gd` patch):** 5 seeded forms: classic 24 %, spreading 22 %, upright 18 %, lopsided 20 %, billowy 16 %.
  They are drawn from a **separate RNG stream** (`_rng("apple_form", seed, 91/92)`), so the main RNG sequence is identical for every existing seed:
  trunk, chop taper, timber adaptation and the low fruit limb are unchanged. **Correction (verified in code):** `reach_points`
  come from the TWO lowest limb clusters (`lowest.sort_custom` by y), and the second one can be an upper limb that a form reshapes.
  The reach-point COUNT is unchanged, and heights are still clamped toward `reach_height` 1.8 m (`under.y - 0.55 .. - 0.12`).
  That second apple can move horizontally by up to ~0.5 m and slightly in height. Decorative fruit on upper clusters moves with the crown. Forms scale only the upper limbs
  (length ×0.86–1.28, elevation ×0.72–1.22), crown squash (×0.78–1.16), top mass (×0.82–1.24) and a one-sided bias. They also add 0–2
  outer clusters. A form can be forced with `opts.form`, and `apple_form(seed)` is public for tooling.
  Sample `after-preview-trees-forms-front-vs-orig-back.png` shows the same 8 seeds: the front row is patched, the back row is the original.

## 5. Sol integration hooks (smallest exact changes)

1. **Grade is ALREADY wired.** Live `atmosphere_pipeline.gd` line 34 calls `apply_after` itself. Do **not** add a second call:
   the grade multiplies (`*=`) pipeline values and assumes exactly one call per `apply`.
2. **Ground mask:** no code change. If Sol would rather keep the old broad worn look off meadows, halve `orchard_masks.png` alpha. Not required.
3. **Reed beds (proposed, `orchard_visual_kit.gd` plan(), reed loop):** before `_add(result, "reed_clump", …)` add
   `if _unit(seed, floori(next_reed / 9.0), int(side) + 41) < 0.45: continue`. This gives beds of ~7 clumps and open 9 m banks
   where the rebuilt stone lips and gravel show. It is deterministic, adds no nodes and lowers the reed count.
4. **Tree forms:** replace `godot/tree_kit.gd` with `tree_kit_patch/tree_kit.gd` (or apply `tree_kit_forms.diff`). Pickup count,
   chopping and saves are untouched. The second reach apple can shift position (see the correction in section 4). If Sol needs bit-exact
   reach points, a 3-line guard is enough: skip the form on limbs whose blob would rank in the two lowest, or compute `lowest` before
   applying the form scale. The Grow presenter still uses fixed `REAL_TREE_CROWN_Y 3.3`
   and `REAL_TREE_CROWN_R 1.5`. The forms keep the crown centre within about ±0.35 m of that for h = 4.62. If Sol wants an exact match, pass
   `TreeKit.apple_form(seed)` alongside `tree_positions` in the payload. That is a future hook, not needed now. Grow timing is unchanged
   (`start = along*0.4`, then 0.4 to full scale), and the presenter never draws a permanent tree.
5. **Kit import:** after copying the GLBs, run a normal editor reimport. `orchard_visual_kit.gd` placement needs no change (same names and pivots).

## 6. Budgets (preview metrics in `samples/preview-metrics-iter3.csv`; RTX 3080 Ti, Mobile renderer, 1200x750)

- Old kit tris: boulders 48/50/50 (were ~320 each), bank lip 208 (was ~560), reed 78, tuft 36, cliffs 3564/7128/9900 (unchanged),
  trees 540. Still 2 materials total (rock, foliage) and 0 textures. MultiMesh per 64 m chunk, visibility ranges unchanged.
- Ground shader: 7 texture reads baseline, +4 exposure taps only inside disturbed ground (unchanged). Adds 2 `cells()` evaluations inside exposure
  only, and the vertex tangent is ALU only. River: ALU-only colour changes.
- VFX: bounded by the existing `quality_budget` (max_live_debris 36, dust 160). Rockfall stones come from the same `_piece` pool, and permanent
  pieces were 150 in the preview. Preview frames: 45–106 draws and 140–284 k primitives with all three ops active.

## 7. Known limitations and honest critique

- **Hard triangular yellow/olive tints on the open meadow (real 00/03/06 and preview) are NOT fixed.** In the preview I ruled out
  `fwidth` fade (replaced), the missing tangent frame (added), terrain shadow casting (A/B with `--no-ground-shadow`: identical) and the grass
  texture (smooth). Next test for Sol, which takes about 2 minutes: temporarily set `ALBEDO = vec3(soil_amt)` and then `vec3(m.a)`, `vec3(m.g)`, and
  `vec3(slope_soft)` to see which term carries the polygon edges. My leading remaining suspect is the preview/game mask being sampled
  with `filter_linear` without mipmaps at grazing tactical angles, or an authored polygon in `orchard_masks.png` g/a.
- The Raise rim is intermittent and green-dominant in the preview, but the Raise VFX outcrops still hang mid-air *during* animation
  (07). That is by design, they rise with the terrain, but it reads as floating at 50 %. The settled state is grounded.
- Sunder lips still carry bright green grass tops from `spell_kit.glb`. Clumping removed the rhythm, but at RTS height they still read as
  green tiles. The next pass should darken the lip-top vertex colour in `build_spell_kit.py`.
- Cliff modules read as stacked slabs close up (`after-preview-kit-cliffs.png`). The colours are now muted, but the geometry is unchanged.
- The preview terrain is not game terrain, and the river bank there has little relief, so the bank ecology is only lightly verified.

## 8. QA expected from Sol after integration

1. Recapture all 8 views (seed 290929, 1200x750). Check that 05/06 are a green mound with a narrow broken brown rim (no disc, no full ring,
   no crack net), and that 03 shows irregular wall runs with gaps and rockfalls where the ravine floor stays visible.
2. Check that 00 shows readable darker water with warm edges, a clear near bank with no milky veil, and grey-brown stones rather than white.
3. Cycle hours 6/10/14/18/22 and rain/snow. Check that daylight still moves, rain keeps valley mist, and night is not crushed.
4. Apples: pick, respawn and chop patched trees of each form (`TreeKit.apple_form(seed)`). The `reach_points` count must equal the pre-patch count, and every
   reach apple must stay reachable in VR (height roughly 1.25–1.8 m, within arm reach of the trunk).
5. Run `service/test.cjs` and `service/integration.cjs` per VERIFICATION.md. No service files were touched.
