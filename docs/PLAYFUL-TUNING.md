# Live playful-tool tuning

Six parameters reuse the existing native sliders, browser tuner, service validation,
atomic `tuning.json` persistence, revision checks and undo. No second settings file
or tuning service was introduced. Original behavior remains the default.

| Key | Label | Default | Allowed range | Takes effect |
|---|---|---:|---:|---|
| `playful.ring_toss_gain` | Ring toss strength | 1 | 0.5–1.5 | Next throw |
| `playful.ring_gravity` | Ring drop | 1.1 | 0–3 m/s² | Current flight |
| `playful.ring_recall_speed` | Ring recall speed | 18 | 4–18 m/s | Current recall |
| `playful.magnet_range` | Wand reach | 4.5 | 1.5–4.5 m | Acquisition and current tether |
| `playful.magnet_pull` | Wand pull acceleration | 22 | 10–22 m/s² | Current tractor step |
| `playful.magnet_fling` | Wand toss speed | 4.2 | 1–5.8 m/s | Next A/X fling |

Ring launch retains its 21 m/s ceiling. The wand retains 2 kg eligibility, 22 m/s²
maximum acceleration, 6 m/s combined velocity and all existing ownership/occlusion
checks. Its spring coefficient 30, damping 10 and gravity compensation 9.8 stay
unchanged. Lower pull acceleration makes the distant pull gentler while the minimum
still supports gravity compensation. Reducing reach releases cargo beyond the new
range plus the existing 0.5 m tether tolerance. Gentle trigger/click placement is
unchanged. Native parameter reads clamp again and reject nonfinite values, so
session overrides cannot bypass hard caps. Standalone mocks without `game.tuning`
continue to use original defaults.

## Access and integration

All six controls automatically appear in the existing full tuning menu and the
browser tuner's `playful` category. Quick-menu keys remain unchanged. For a direct
“Playful tools” entry in an existing menu, the coordinator may set
`game.qol.page = "tuning"` then call `game.tuning.action("playful")`. This action
rebuilds the current menu and filters to six sliders over two pages. Its first-page
Previous button becomes All settings, which clears the filter. No main or QoL file
was edited in this lane; this optional entry is the only root integration needed.

“Less pull” maps to `playful.magnet_pull`. An authorized client can use the existing
`POST /api/vr/tuning` request with `values` and `expectedRevision`; the service stores
the result and the normal polling path applies it. These additions do not install
a new Brann voice tool for editing global tuning. Do not claim that spoken requests
already execute this adjustment automatically. Existing manual sliders are usable.

Example request (replace the revision with the current snapshot's revision):

```json
{"values":{"playful.magnet_pull":14},"expectedRevision":3}
```

Both normal service and client need the updated source/schema loaded. No production
service was contacted or restarted during implementation. Offline diagnostics still
follow the existing non-persistent tuning restrictions.

## Source and verification

The authoritative schema remains the entries in `service/tuning.js`.
`godot/tuning_schema.json` was regenerated directly from its exported `SCHEMA`, and
the six matching constants were added to `tuning_runtime.gd`. Existing service
parity tests compare the complete schemas/defaults. Before edits, exact copies of
`tuning.js`, `tuning_schema.json`, `tuning_runtime.gd`, `playful_tools.gd` and
`magnetic_wand.gd` were saved to `work/playful-tuning-backup-20260921-072901/`.

Run the portable engine headlessly with Dummy audio, XR off, an absolute log path,
and `--script res://playful_tuning_checks.gd`. It exercises actual ring release,
active flight and recall across tuning revisions, live wand target acquisition,
range reduction/release, real fling velocity, native hard caps and fallback behavior.
It never loads player saves or calls the service. New service tests are in
`service/playful-tuning-test.cjs`; run them with `service/tuning-test.cjs` for atomic
bounds rejection, persistence/reload, revision conflict, undo and old-save migration.

Verified results:

- New native tuning behavior: passed, 0.290 seconds.
- Existing Sunskipper regression: 34 checks passed, 0.385 seconds.
- Existing Copper Kite regression: 43 checks passed, 1.224 seconds.
- Service tuning regression: 8 tests passed, 0.115 seconds.

Timings are measured engine/runner invocation durations; parallel steps overlap.
The durable timing record is `logs/playful-feedback-timing.csv`. Native HUD/menu
appearance and physical headset preference still require the coordinator's playtest.
