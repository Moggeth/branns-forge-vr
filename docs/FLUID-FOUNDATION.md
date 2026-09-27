# Measured fluid, ignition and functional light

The existing 64×64 surface fuel solver remains the common implementation for the
weather playground and opt-in native fuel combat. It accepts 320 fuel units
(40 eight-unit bottles), with eight visited-zone patches retained for the current
session. Inactive patches pause; this is not a disk save format or a 3D fluid engine.

## Integration API

`fuel_combat.pour(position, zone_id, amount, lit=false)` returns the exact accepted
quantity. A vessel subtracts **only that return value**. Out-of-patch, unsupported,
inactive-zone and full-capacity requests return zero. Near capacity, a continuous
pour can accept only the remaining fraction. Existing `impact(position,zone,lit)`
is still a full-bottle operation and rejects the entire bottle if there is no room.

The initial surface scan proceeds at 128 rays per tick. Accepted pours reserve
their measured quantities immediately. One support ray validates each pour before
acceptance, and preserves thin-ledge support that can fall between grid-center
rays. Different-height pours onto an already occupied column reject rather than
moving existing oil to a roof or lower floor. This is still one surface height per
column; separate vertically stacked fluid layers need a future extension.

Call measured pours at around 10–20 Hz; render a continuous stream independently.
The simulation itself runs at 10 Hz. Avoid hundreds of independent pour calls per
render frame. Accepted pours update visuals immediately; stationary torch checks
without new ignition do not rebuild the field visuals.

- `ignite_near(position, radius)`: ignites nearby dry fuel, returns newly lit cells.
- `extinguish_near(position, radius)`: extinguishes and wets nearby cells, returns
  cells that were burning. Oil remains and can reignite after drying.
- Both contacts survive an initial pending surface scan. Coalesced pending contact
  records are bounded at 128; repeated stationary contact consumes one record.
- `active_counts()`: total fuel, capacity, field count, pending units, current
  puddle/flame/light counts and readiness.
- `prewarm_region(zone_id, center, scan_ceiling)`: reserves an empty, fixed 24 m
  region around a prefab centre. Its incremental scan starts when visited, from
  the supplied ceiling height (choose below indoor ceilings and above surfaces).
  Repeating the call leaves existing origin/fuel untouched. Unlike an ordinary
  first-impact patch, a prefab patch never relocates when empty. The eight-region
  limit still applies.

## Light budget and appearance

Each field owns exactly three reusable `OmniLight3D` nodes. Only the active zone is
visible. Fire cells are grouped into 3 m regions; nearby substantial fires receive
the lights. Cluster centres are fuel-weighted, with a minimum spacing between
selected regions. Position and energy ease over time; two slow sine variations
change energy by approximately 5%, without hard blinking. These lights illuminate
the actual scene but do not cast shadows. A held torch can own a separate, budgeted
shadow light. This separation must be retained when adding new handheld effects.

Flame sway is shader-driven between simulation ticks. Puddles and flames remain
bounded MultiMeshes with up to 4096 instances each. The retained `fire_light`
property aliases the first pooled light for legacy diagnostics; callers should
not move it manually because the pool now positions lights around actual fire.

The final visual pass varies individual flame height (.65–1.30 multiplier plus
gentle .10 growth), width (.76–1.18), and bending phase using stable world-position
seeds. Amber cores fall to orange/red tips; emission is .26 rather than .50 to
retain colour. Oil uses one opaque lit shader with subtle moving specular ripples
(roughness .125–.195, normal perturbation .035), no extra draw calls or shadows.
Neither shader changes fluid simulation or collision surfaces.

Actual Vulkan Mobile scene capture is under `outputs/ember-fluid-polish`, including
before/after torch views, river of fire and forty-bottle stress. Final measured
desktop mono GPU time on RTX 3080 Ti at 1280×800: median .805 ms, p95 .877 ms,
30 draws, 467 burning cells. This measures the isolated showcased camera view,
not headset stereo or full game CPU cost. The shared capture fixture freezes fuel
consumption for the measured frames to keep the stress workload consistent.

## Verification and recovery

Run the focused fixture (no normal save, service or paid generation):

```powershell
& tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://fluid_foundation_checks.gd
& tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://fluid_audio_checks.gd
& scripts/check-fuel-combat.ps1
```

Require `FLUID_FOUNDATION_RESULT` with empty `failures`, exit zero, and no engine
errors. The focused fixture verifies 202 checks, including 40-bottle conservation,
contact ignition, measured pending volumes, unsupported rejection, water while
scanning, wet barriers, travel persistence and three-light bounds. Native bottle
combat, legacy fire, native weather and desktop weather regressions passed.

The 40-bottle CPU stress exercises 970 puddles and 930 flames. Measured step timings
are printed in `logs/fluid-foundation-checks.log`; these are headless CPU numbers,
not GPU or headset frame-time claims. Integration owns the GPU/VR review.

Test fixture learning: constructing the full weather audio engine merely to test
fuel left an `AudioStreamWAV`/playback reference at dummy-driver shutdown, even
after stopping it. The focused fixture now uses fuel-only setup and a minimal
weather-mode override. The unchanged desktop-weather integration still tests the
full weather setup. Do not add ambient audio to isolated fluid tests.

## Quiet pouring audio

`fluid_audio.gd` is a reusable Node3D. Instantiate once, call `setup(parent)`
(which attaches it if needed), then call
`update(pouring, water, world_position, extinguishing, delta)` each frame.
It prebuilds oil/water/hiss filtered-noise loops and owns only two pooled voices.
No pitched impacts, rhythmic sequences, per-frame streams or one-shot allocation.
Pouring fades in/out; a successful extinguish contact sustains a soft hiss for
0.3 seconds. `stop()` immediately silences both for teardown. Loop seam continuity,
bounded waveform levels, setup idempotence and two-voice capacity are checked by
`fluid_audio_checks.gd`; subjective in-headset audio level still needs playtesting.

GDScript learning: `ready` is a native Node signal, so use `initialized` as a state
member. A script parse failure can leave a SceneTree test running without its
success marker; always retain `--quit-after` and subprocess timeout protection.
Standalone demo fixture paths must live under the OS `TEMP` directory; a custom
path under project `work/` correctly disables persistence and causes the adapter
assertion to fail. Use a fresh temporary directory when invoking captures directly.

Pre-change snapshots: `work/fluid-foundation/*.before.gd`. No Git repository exists;
initialising or publishing one still requires explicit authorisation.
