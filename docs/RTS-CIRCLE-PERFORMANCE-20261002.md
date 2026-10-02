# RTS circular preview projection cost

The planet RTS fallback draws 48-segment circular spell boundaries every
preview update. Each line formerly projected both endpoints independently,
including an expensive spherical surface normal: 96 projections even though
adjacent lines share their endpoint. `world_builder_view.gd` now retains only
the preceding endpoint during a single circle build, requiring 49 projections.
Every new build still samples fresh terrain. Render cadence, shape and UI
layout are unchanged.

## Reproduce

From the repository root:

```powershell
& tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://world_builder_circle_checks.gd
```

Require `CIRCLE_RESULT` with an empty `failures` array and no script errors.
The fixture uses the real planet fields and production projection method,
without Main, service calls, saves or rendering a window. It compares every
emitted vertex exactly against the old algorithm for planar terrain and the
sphere, including both poles, a translated planet centre `(6000,13,-27)`, and
0/1/16/20/48 segments. Changing the terrain seed must change the next build.
The preserved old algorithm exists only in the diagnostic for parity and
same-process timings. The authored ground preview is unaffected; its existing
`world_builder_ground_preview_checks.gd` remains the complementary check.

## Measured evidence and limitations

100 consecutive 48-segment builds per algorithm, CPU microseconds per build:

| Projection | Old | New | Reduction |
| --- | ---: | ---: | ---: |
| Planar fixture | 69.07 | 38.73 | 44% |
| Actual planet fields | 6164.07 | 3144.40 | 49% |

Before the production change, the new projection-budget assertion failed as
expected while old/current timings agreed (planet 6133.36/6156.38 microseconds).
After the change all geometry, budget and terrain-refresh checks passed.
The engine runs took 1.813 seconds before and 1.463 seconds after. These are
isolated CPU geometry measurements, not GPU, whole-frame or headset results;
they cover synthetic seeded terrain rather than every saved edit history.
The full-world frame benefit depends on how often these boundaries are shown.

Measured discovery/inspection command durations: 0.237, 0.190, 0.165 and
0.162 seconds. Initial combined documentation output was truncated because
VERIFICATION.md is large; subsequent reads used targeted ranges/searches.
For future investigations, search verification headings first and read the
relevant section instead of dumping the whole historical document.
