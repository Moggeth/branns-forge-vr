# Orchard spell VFX + atmosphere: handoff (claude-opus-5-5, 2026-09-29)

This is a vertical slice for Sunder, Raise Earth and Grow Forest, plus a layered horizon and an atmosphere grade. It runs in a disposable Godot 4.7.2 Mobile-renderer preview. The kit's .gd files parse, the GLB imports, and I inspected the rendered effects at eye height and tactical height (see *Proof*). **It has not been integrated into the real game, and I have not seen it against the real ground shader.** Treat it as ready for integration and the next capture round, not as finished art.

## Files (all under `output/`)
| Path | Purpose |
|---|---|
| `orchard_vfx/orchard_spell_vfx.gd` | Presenter node. `accept_event(payload)` consumes `LandscapeRuntime.visual_event` unchanged. |
| `orchard_vfx/orchard_horizon.gd` | Three-band faceted ridge horizon, plus the static `apply_orchard_grade(env, sun)` atmosphere preset. |
| `orchard_vfx/shaders/kit_surface.gdshader` | One shared opaque material for the whole kit: vertex colour × per-instance tint, plus facet cavity and damp fresh-earth darkening. |
| `orchard_vfx/shaders/dust_puff.gdshader` | Billboard soil dust with a lumpy edge and self-shading. Alpha-blended, depth-write off. |
| `orchard_vfx/shaders/magic_mote.gdshader` | Additive embers/motes. |
| `orchard_vfx/assets/spell_kit.glb` | 11 meshes: `lip_a/b/c`, `chunk_a/b/c`, `clod_a`, `pebble`, `root_seg`, `sapling`, `leaf_puff` (74 KB total). |
| `orchard_vfx/assets/spell_kit.blend` | Editable source written by the builder. |
| `blender/build_spell_kit.py` | Deterministic Blender 4.5.13 builder. It is the source of truth; regenerate the GLB rather than hand-editing it. |
| `_preview/` | Disposable Godot project (`project.godot`, `preview_capture.gd`). The runner copies `orchard_vfx/` into it. |
| `run_preview.ps1` | Build → sync → import → capture, all in one command. |
| `renders/*.png` | 30 captures: 3 spells × before/during(50%)/settling(+0.35 s)/after × eye/tactical, plus the horizon. |

## Integration API (smallest wiring)
```gdscript
const SpellVfx = preload("res://orchard_vfx/orchard_spell_vfx.gd")
var vfx := SpellVfx.new()
vfx.quality_tier = "vr"            # "vr" | "rts" | "low" (scales debris/dust budgets 1.0/0.8/0.45)
world_root.add_child(vfx)          # identity transform; payload data is already world-space
landscape_runtime.visual_event.connect(vfx.accept_event)
```
- Phases: `started` builds the effect, `animating` evaluates it at `progress`, and `settled`/`cancelled` bakes permanent geology and lets dust/motes/light finish over `tail_seconds` (1.8 s, capped by `max_effect_seconds`). `step(delta)` drives the tail; `_process` calls it automatically.
- **Reverse/undo** (`direction == "reverse"`): the same seed and operation_id rebuild identical pieces. The presenter drops that operation's permanent geology and plays the effect backwards: lips close, rocks fly back, saplings shrink. I verified this in the preview: undoing Raise took the permanent pieces from 198 to 152, and the child count returned to the permanent-only set (no leak).
- **Many historical events:** settled pieces go into **one shared MultiMesh per kit mesh** (at most 11 nodes in total, whatever the history length). Each active event adds at most 11 piece MMIs + 1 dust MMI + 1 mote MMI + 0–1 light, and they are freed at settle or tail end. Global cap: `max_permanent_pieces = 3000`; the oldest operations are evicted first.
- Disable it with `vfx.enabled = false`, or don't connect it. The presenter never reads or writes height, collision, hydrology, save or network state.
- `restore_event(payload)` (or `phase = "restore"`) bakes an operation's permanent geology without animation. `forget_operation(id)` and `clear_all()` are also available.

### Small data hooks requested from Sol (none are required for Sunder/Raise)
1. **Grow Forest** isn't in `Ops.TYPES` and doesn't emit `visual_event` today (`cast_forest` is a separate path). Smallest hook: emit a schema-1-shaped payload with `operation_type = "grow_forest"`, `world_path`, the same phases, and optionally `tree_positions: Array[Vector3]` (the real tree roots). Without `tree_positions`, the presenter places seeded trees along the path. If you also want the game's real trees to grow (instead of popping in), set `grow_saplings_persist = false` and scale those trees in over the same `progress` window. A good per-tree window is `t0 = along * 0.4 + jitter`, the same value the presenter uses; exposing it per tree is future work.
2. **Save/load:** permanent geology isn't saved (by design, since it's visual only). On load, for each replayed operation, call `vfx.restore_event(VisualEvents.started(op, id, seed, transition_for_op, model, zone_root, budget))`. That requires before/target heights per op, which `_rebuild_exposure_from_operations()` already stages. This is the migration path away from `landscape_spell_dressing.gd`: keep the old dressing until restore is wired, then retire its rock/log placeholders. Its surviving grass/fern scatter can stay.

## Design choices
- **Driven by true terrain samples.** Lip hinges, rock start/landing heights and dust heights come from the nearest `world_before`/`world_target` sample. Trench width and mound radius are measured from the samples (|Δh| > 0.12 / 0.08 m), not assumed.
- **Sunder:** a tear front travels along `world_path` (it reaches the end at 66% progress, leading the terrain easing). As it passes, torn turf plates hinge up with an overshoot (back-out easing) on both banks and settle at a 9–21° dip laid onto the local settled slope. Loose rock and clods pop from the walls behind the front, tumble with one small bounce and stay on the trench floor. Dust is born behind the front and drifts *along the travel direction*. Amber embers race along the fissure, and one amber omni light rides the front.
- **Raise:** scarp plates crack open round the shoulder. Clods and stones are forced up from below the boundary and roll out to the toe (biased toward the cast direction if the path has 2+ points). Three bedrock stones shoulder through the crown, and low dust rolls off the boundary.
- **Grow Forest:** a wave runs along the path with per-tree jitter. Five roots reach across the soil first, with a soil puff at each tip. The sapling then shoots up with overshoot, and four canopy puffs unfold one at a time at different moments. Tint families (sunlit yellow-green, deep blue-green, neutral, and a rare early-turning crown) break up the uniform colour. Green motes spiral up.
- **Materials:** everything is opaque and shares one shader. Colour is authored per facet in the builder (grass skin → topsoil → subsoil/clay → rock). Fresh fracture faces on rocks are paler, and `INSTANCE_CUSTOM.a` darkens freshly exposed earth. Transparency is limited to dust (≤ 160 quads, one draw) and additive motes.

## Budgets (measured in preview, i7/Windows, Mobile renderer)
- Per-event build: 0.9–3.6 ms (a single frame hitch on `started`). Per-frame evaluation: **0.17–0.22 ms** (CPU MultiMesh writes).
- Per event: ≤ 36 debris × quality, ≤ 160 dust × quality, sunder embers 36 × quality, lips 2–16 per side, and roots/saplings/leaves at most 12 trees × 10 pieces.
- Lights: ≤ 2 concurrent across all events, `shadow_enabled = false`, range 7 m. The kit meshes cast shadows (small low-poly meshes); set `cast_shadow` off on the MMIs for Quest-class hardware if needed.
- Tris: lips ~96, rocks 80, root ~60, sapling ~250, leaf puff 80. No LODs are authored; the meshes are already LOD1-sized.

## Atmosphere / horizon (hook values)
- `orchard_horizon.gd`: add at the Orchard centre at valley-floor height. It builds bands at radii 150/230/340 m with heights 18/42/85 m and colours foothill green → blue-green → pale blue. Ridge lines are set behind their bases so slopes face the valley and take sun/shade (lit Lambert-wrap, so day-night still applies). No collision, no transparency, ~700 tris total. `low_sectors` lowers the far band behind key sightlines. **Remove the stepped pyramidal backdrop mountains when this goes in.**
- `apply_orchard_grade(env, sun)`: Filmic tonemap (white 6), sky ambient 0.55/0.75 energy, exponential fog 0.0028 with aerial perspective 0.35, **height fog `fog_height = 3.0`, `fog_height_density = 0.035`** (valley haze), sun scatter 0.12, contrast 1.08, saturation 1.06, and sun 1.25 energy warm (1.0, 0.93, 0.8). Day-night/weather should keep animating sun/sky energy and colour after this call. Where they drive fog colour, multiply rather than overwrite. Offset `fog_height` to the Orchard floor's world Y.

## Pale flat strip (diagnosis without the source)
In `09-grow-after-tactical.png` the pale areas are large faceted polygons with hard straight edges. They're lighter and yellower than the ground, show no ground-shader noise or exposure mask, and have constant shading per facet. That points to a **separate low-resolution far-field/skirt or placeholder mesh** (or a terrain chunk falling back to a default StandardMaterial) at a different elevation, *not* the height field's ground shader. None of the copied scripts define it (I grepped for backdrop/skirt/horizon/plane). Replacement strategy: (1) give that mesh the same `orchard_ground_visual.gdshader` material with exposure disabled, or delete it and extend real terrain chunks to the boundary; (2) past the playable edge, let `orchard_horizon.gd` band 0 plus the height fog carry the distance, rather than painting a flat plane.

## Test commands and timings
```
powershell -ExecutionPolicy Bypass -File output\run_preview.ps1          # full: blender 0.6 s, import 2.0 s, capture 3.8 s (~6.4 s)
powershell -ExecutionPolicy Bypass -File output\run_preview.ps1 -SkipBlender
```
Expected output ends with `VFX_PREVIEW_OK`. The harness has a 150 s self-quit watchdog, and the runner stops only its own PID after 180 s. It uses `tools/godot/Godot_v4.7.2-stable_win64_console.exe` and `tools/blender-4.5.13-windows-x64/blender.exe` relative to the repo.

## Iteration record (candid)
1. First render: every kit mesh came out rotated 90°. Lips stood up as vertical "gravestones" and saplings lay flat, because authoring used Y-up while Blender's glTF export assumes Z-up. Fixed with an axis remap in `finish()`.
2. Revision pass after inspecting the renders: lips were floating on the Raise slope, so they now take `_slope_pitch` from settled samples. Raise debris was oversized and flung too far; it's now scaled 0.6–1.15 and lands within 1.12 r. Sunder dust was invisible at eye height, so opacity and size went up. Roots were buried, so they're now at the surface and thicker. Motes were too small (×2). Canopy tint was too uniform, so the tint families are wider. The horizon was washed into the sky, so it's darker and more saturated with less baked haze.
3. The first-pass PNGs were overwritten by the revision captures; only the final set is kept.

## Limitations / in-game review targets
- The preview ground is a flat-coloured stand-in, not `orchard_ground_visual.gdshader`. Lip grass colour (vertex `GRASS` 0.30/0.52/0.16 × tint) needs matching against the real ground in-game.
- At eye height, the near-bank Sunder lips partly hide the trench floor debris; judge in VR whether to thin the near side.
- Raise scarps viewed from outside and downhill can read as a short brown wall. Consider reducing `lift` or tilt range for shallow mounds.
- Dust at 50% is modest from the tactical camera. For RTS use `dust_scale = 1.4`.
- Grow Forest never received a real event (no hook yet), and the preview trees are kit saplings, not the game's tree assets.
- No LOD or visibility-range settings are applied. For RTS, consider `visibility_range_end` of about 120 m on permanent MMIs.
- The horizon is only verified in the preview sky, not with the game's weather/day-night.
- Blender 2.93 forge-worker contract: untouched.
