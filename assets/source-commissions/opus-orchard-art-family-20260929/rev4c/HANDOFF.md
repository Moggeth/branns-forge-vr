# Orchard rev-4c: post-integration correction (Opus, claude-opus-5-5, 2026-09-29)

This is a bounded follow-up to the integrated rev4b. `HANDOFF.md` (rev-4/4b) stays valid except where this file overrides it.
**These changes have not been seen in the actual game.** They were checked only in the disposable preview (`_preview/`, real
`orchard_masks.png`, stand-in terrain with an authored path crossing the Raise). Sol's recapture is the authority.

## 1. Diagnosis correction (my rev-4 claim was wrong for this capture)

The rev4b game pair `04-raise-before-hero-eye` → `06-raise-after-hero-eye` shows that the broad brown band exists **before** the Raise.
It is an authored path: macro mask R, written by `orchard_ground.add_path`/`sync_paths`. The Raise lifted the path into a hill,
and the shader kept `m.r * 0.9` in `soil_amt`, so an unbroken road stayed painted up and over the mound. My rev-4 "disturbed alpha
blob" fix was real (alpha soil is still suppressed on heaps), but it was not the main cause here. I had not compared a before-Raise
frame, and I should have.

## 2. Changes

### A. Raised path fractures (priority fix): `orchard_kit/orchard_ground_visual.gdshader`
Inside lifted ground (`lifted`, i.e. exposure B > ~6 cm of heave, and `m.r > 0.03`), and only there:
- `path_lift = smoothstep(0.12, 0.9, heap_m ± noise)`: the effect grows with real local heave, taken from exposure B.
- The tread breaks into ~2 m Voronoi slabs (`cells(at*vec2(0.48,0.6) + warp)`). The fraction of surviving slabs falls from 100 % at the
  foot to ~50 % at full lift. Surviving slabs keep path soil with a per-slab value (0.82–1.1, reads as tilted tread). Open joints between
  slabs are dark torn earth.
- Where tread is lost, turf has rolled over it (grass, slightly drier), with occasional fresh-earth/clay rubble pockets and pale stone chips.
- Outside the heap, the path is byte-for-byte the old term (`path_keep = 1`). The existing narrow foot-rim tear from rev-4 still cuts
  the road where it meets the heap, so the road visibly *breaks* at the rise instead of stopping at a line.
- Contract unchanged: same uniforms, same `exposure_tex` r/g/b meaning, same `macro_mask` meaning. No new inputs or adapter.
- Cost: one extra `cells()` (9 hash taps, ALU only) plus 3 noise taps, evaluated only in fragments that are both lifted and on a path.
  No texture reads added. The baseline meadow cost is unchanged.

### B. Sunder lip caps (secondary): `build_spell_kit.py` → `orchard_vfx/assets/spell_kit.glb`
- The `lip_a/b/c` outline changed from superellipse³ (rectangular) to exponent 2.2 with 0.66–1.06 bite and a 22 % deep-notch chance, so plates read as torn sod rather than tiles.
- Top cap colour: 30 % of top wedges are torn earth (TURF→TOPSOIL). The rest are shaded/trampled grass (25–70 % toward GRASS_SHADE),
  and some are TURF-dulled. Cap mean luminance is roughly −35 %.
- Same 19 meshes, names, pivots and topology. Lips are ~113 tris each; the kit totals 1674 tris. `orchard_spell_vfx.gd` is unchanged
  (it already clusters lips per rev-4), and instancing/MultiMesh is unaffected.

## 3. Exact copy list (live paths relative to `godot/`)

| output/ file | live destination |
|---|---|
| `orchard_kit/orchard_ground_visual.gdshader` | `assets/orchard_kit/orchard_ground_visual.gdshader` |
| `orchard_vfx/assets/spell_kit.glb` | `orchard_vfx/assets/spell_kit.glb` (keep the existing `.import`; reimport) |

Nothing else changed in rev-4c. Editable sources: `build_spell_kit.py` and `source/spell_kit.blend` (rebuilt). The shader is text.

Rebuild the spell kit (measured ~2 s):
```
tools/blender-4.5.13-windows-x64/blender.exe --background --factory-startup --python output/build_spell_kit.py -- --out <ABS>/output/_spellbuild
# prints PIECE ... tris, SPELL_KIT_OK 19 tris 1674; copy _spellbuild/spell_kit.glb -> orchard_vfx/assets/, .blend -> source/
```
Preview: `cd output/_preview && bash sync.sh && Godot --headless --path . --import && Godot --path . --script res://preview.gd -- --tag X` (~7 s).

## 4. Before/after samples: `output/samples/rev4c/`

- `game-rev4b-04-raise-before-eye.png` / `game-rev4b-06-raise-after-eye-PATH-OVER-HILL.png`: the real-game fault.
- `preview-rev4b-raise-after-{tactical,eye}.png` vs `preview-rev4c-raise-after-{tactical,eye}.png`. In rev4b the road ran continuously
  over the mound. In rev4c it tears at the rim, and the mound carries broken, jointed tread with turf gaps. The mound is not a
  uniform green blob, and the road is intact on both sides of it.
- `game-rev4b-03-sunder-after-tactical-GREEN-CAPS.png` vs `preview-rev4c-sunder-after-tactical.png`.
- `preview-rev4c-metrics.csv`: raise-after tactical 64 draws, 195 k prims; sunder-after 62 draws, 201 k prims. This matches rev4b within noise.

## 5. Honest critique and known limits

- In the preview, the fractured tread reads well at tactical height. From directly above, the Voronoi joints can look slightly like
  **flagstone paving**. If Sol's recapture shows that, lower joint strength (`* 0.85` → `* 0.5`) or raise the joint noise.
- The preview eye view of the mound is dominated by its green flank. The path in my stand-in crosses the upper shoulder, not straight at
  the camera as in game capture 06. The game view will show more of the fracture than my eye sample does, so judge it on the recapture.
- The lip-cap improvement is modest at tactical distance in the preview. The caps are darker and less rectangular, but the
  `kit_surface.gdshader` wrap lighting still lifts them. If they still read as tiles in the game, the next step is placement density in
  `orchard_spell_vfx.gd` (fewer `big` lips), not more colour work.
- The hard triangular meadow tints (rev-4 known limit) are still unresolved; see `HANDOFF.md` §7 for the debug recipe.
- Game capture 06-after still shows the pale `geo_boulder_mossy_a` from `LandscapeSpellDressing` on the crest. It is not mine, and scaling it down or dropping it
  remains a Sol-side option (HANDOFF.md hook 6 of the prior revision).

## 6. QA for Sol

Recapture 04/06 (eye + tactical) and 03 at seed 290929, 1200x750. Expected results:
- (a) the path is unchanged away from the Raise;
- (b) on the Raise it breaks at the foot rim into tilted slabs, turf gaps and a few rubble pockets, with no continuous brown road over the crest;
- (c) the mound is still visibly disturbed, not uniform green;
- (d) Sunder lips are darker and irregular.

No logic, networking, physics, save or terrain-truth changes were made.
