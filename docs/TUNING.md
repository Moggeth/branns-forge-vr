# Live tuning registry

The optional developer bench is http://127.0.0.1:8787/tuning. It does not start voice or generation. Ordinary gameplay controls remain native. Drag sliders to stage a batch; labels update immediately, and Apply changes sends the batch. Reload current discards pending edits. Reset defaults, Undo last apply and Apply preset are deliberate buttons. Conflicts keep pending edits visible until reloaded.

## API contract

GET /api/vr/tuning returns {revision,values,schema,canUndo,presets}. The identical snapshot is included as tuning in GET /api/vr/state. Schema is keyed by dotted setting name; each entry has type (number or integer), default, min, max, step, label, help and group. The step describes UI increments; numeric API values within range need not be multiples of step. Native polling applies values according to the native implementation, without service restart.

POST /api/vr/tuning accepts exactly one operation:

- {values:{"throw.gain":1.6},expectedRevision:0} merges a batch.
- {action:"reset",expectedRevision:1} restores defaults.
- {action:"undo",expectedRevision:2} restores the previous applied snapshot.
- {preset:"gentle",expectedRevision:3} applies a complete default-based preset.

expectedRevision is optional for simple agent requests, recommended for editors to prevent overwriting changes made elsewhere. A successful operation returns the full snapshot and increments revision. Invalid input/conflicts return HTTP409 with error text and do not change state. Unknown keys (including inherited Object names), fields, actions and presets are rejected, as are strings, nonfinite/out-of-range numbers and fractional integer settings. The service uses its existing loopback and same-origin restrictions.

## Defaults

| Key | Default |
| --- | --- |
| input.grip_press | 0.60 |
| input.grip_release | 0.50 |
| hands.pitch_degrees | −90 |
| hands.yaw_degrees | 0 |
| hands.roll_degrees | 0 |
| player.eye_height | 1.70 |
| bomb.formation_seconds | 0.45 |
| bomb.radius | 0.095 |
| throw.gain | 1.45 |
| throw.window_seconds | 0.12 |
| throw.assist_lift | 0.65 |
| throw.min_speed | 1.0 |
| throw.max_speed | 18 |
| bomb.fuse_seconds | 3 |
| bomb.impact_delay | 0.85 |
| bomb.bounce | 0.25 |
| bomb.gravity | 1 |
| bomb.blast_radius | 3.2 |
| bomb.damage | 45 |
| bomb.self_damage_ratio | 0.65 |
| vfx.intensity | 1 |
| vfx.duration | 0.75 |
| vfx.spark_count | 24 (integer) |
| audio.volume | 0.65 |
| haptics.strength | 1 |
| locomotion.speed | 2.7 |
| combat.enemy_speed | 1 |

The throw minimum is a drop-versus-throw threshold, never a forced minimum launch speed. Locomotion controls both left-stick VR and desktop speed. Haptics may scale to1.5 but native output still clamps to the device amplitude range.

## Persistence and recovery

## Native controls and extension boundary

B on either Knuckle opens the wrist menu; choose Tuning. All37parameters are
available over six pages. Point the dominant controller, hold trigger to drag,
release to apply once. Closing or changing tabs discards an unfinished gesture.
The desktop equivalent is Tab and left mouse. Undo last is available on each
page. The native client applies service revisions during its normal polling.
Dragging retains its starting revision, so another editor's change causes a
conflict rather than being overwritten.

Tune Brann.ps1 reads the complete schema/current values. Examples:

```powershell
& '.\Tune Brann.ps1' -Key throw.gain -Value 1.7
& '.\Tune Brann.ps1' -Preset gentle
& '.\Tune Brann.ps1' -Undo
```

Bomb formation takes its duration when created. Released bombs snapshot fuse,
impact delay, radius, gravity, bounce and damage. Visual/audio/haptic preferences
can apply to subsequent effects immediately. Throw estimation retains the
strongest velocity from the short history window; it does not average motion.
Below the threshold, a stationary hand releases a drop. Teleport, grapple, travel
and snap turn clear motion history. THROW logs include raw/assisted speed and
applied tuning revision. Headset feel still needs player feedback.

service/tuning.js is the authoritative schema. tuning_runtime.gd carries matching
offline defaults and implements native sliders/throw sampling. Future systems
add a schema entry plus a consumer; do not turn arbitrary structural gameplay
changes into numeric configuration. Keep visual helpers separate from physics.

## Saved state

service/data/tuning.json (or BRANN_DATA_DIR/tuning.json) holds current values, revision and previous values together. No file is written on a fresh default-only startup. Each change writes a temporary sibling then atomically renames it. In-memory state changes only after that rename succeeds. Failed writes preserve the previous file and memory. Undo swaps current and previous, so a second undo restores the latest choice. Reset/presets are also undoable. This is one-step rollback, not unbounded history.

Successful changes log TUNING revision and changed keys/action to the existing timestamped service logs. Invalid saved data fails startup rather than silently losing adjustments; stop the owned service, preserve the bad file for diagnosis, then restore a known valid backup or move it aside to use defaults. Normal-runtime tuning data was not changed during implementation.

## Offline verification

25 service tests passed in0.343324s (Node runner0.179800s). Focused tuning validation and JavaScript syntax checks passed in0.293587s after adding inherited-key rejection. Tests cover exact defaults/schema, detached snapshot values, type/range/integer failures, atomic batch rejection, stale revision conflicts, restart persistence, undo after restart, failed persistence preserving disk/memory/revision, presets and reset. Tests use isolated temporary directories and no API/worker calls. Native application and browser interaction are coordinator verification; no claim of headset feel follows from these tests.

