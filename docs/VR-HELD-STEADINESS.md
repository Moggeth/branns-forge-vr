# VR held-object steadiness

Held weapons and props now receive subtle adaptive position/rotation filtering.
Small tracking tremors are damped; deliberate movement increases the response
rate. Authored mass (`held_mass`, rigid-body `mass`, or `combat_mass`) gives
heavier objects slightly more inertia. This is perceived weight, not a change
to physical mass, damage or throw strength.

The **Held-object steadiness** slider in the hand menu's Tuning page defaults to
**0.65**, ranges from 0 to 1, and persists through the normal tuning service.
Zero restores exact calibrated tracking. Existing saved tuning snapshots acquire
the new default without resetting their other values. Relaunch the game normally
to load the source update; the current game and SteamVR were left running.

At the default, the filtered pose stays within **3.9 mm / 0.52 degrees** of the
sampled controller pose. The algorithm uses exponential, frame-rate-independent
response with a quiet-motion cutoff, a low-passed speed estimate and faster
response during deliberate motion. Discontinuities, tracking loss/reacquisition,
ownership changes, calibration changes and long frame stalls reset the filter.
The approach follows the speed-adaptive principle described by the
[1€ filter authors](https://gery.casiez.net/1euro/); this is a small original
implementation with explicit lag caps, not a new dependency.

## Integration boundary

`held_pose_runtime.gd` filters each occupied **CalibratedGrip** socket once per
frame, before item mechanics. Glove and object share that socket. It becomes
top-level while occupied so later raw controller updates cannot bypass damping;
its ownership parent remains the controller. Stored poses are in tracking space.
Rig movement is reapplied without sampling again, so walking, snap turns, portals
and moving ground do not trail behind the player.

Ordinary one-/two-handed tools, matches, pouch/tokens, bow arrows, the reel and
other separately managed socket props use this path. Movable Living Workshop
creations use calibrated socket offsets too. The two-handed solver uses those
same palm anchors. Controllers/HMD, grip buttons, throw samples, climbing motion,
physical crank motion and manual grip calibration remain unfiltered. An empty
hand or FPS fixture keeps its original exact calibrated pose.

When authoring a new held item, attach it through `game.hand_socket(hand)` or
the standard grip runtime. Set `held_mass` only when a perceived-weight override
is needed. Do not add a second per-item filter or write to XRController3D.

## Checks and recovery

Run from the project root, with the bundled Godot console executable:

```powershell
& ./tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://held_pose_filter_checks.gd
& ./tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://held_pose_runtime_checks.gd -- --held-pose-check
```

Require each named JSON result's empty `failures` array and reject SCRIPT ERROR
or ERROR output even when the process exits zero. The runtime fixture refuses
to load Main without its isolation flag and has a 45-second failure watchdog.
Neither check needs a headset, service, API call or player save.

80 deterministic filter checks pass at 72/90/120/144 Hz; 32 actual-Main checks
cover ownership, two-handed contact, raw tracking/history, physical release,
tracking loss, nocked arrows, light bolts, runtime creations, calibration, FPS
and rig movement. The default actual-socket jitter trace retains **43% of input
RMS**. The complete per-hand adapter benchmark took **6.39 microseconds**;
the filter alone measured about **2 microseconds** per sample. These are CPU
microbenchmarks, not live VR frame-time or comfort measurements.

Measured final checks: filter 0.347 s; actual-Main steadiness 6.821 s; grip pose
7.012 s; Siegebird 7.380 s; FPS 7.663 s; Living Workshop 6.913 s; disposable
service integration 59.745 s. The 14 focused service/tuning tests also pass.
Detailed process outputs are in `logs/smoothing-*-20260930.log` and
`logs/integration.log`; wall-clock work spans are in `logs/work-timing.csv`.

For feel tuning, reduce the slider toward zero if precision tasks feel delayed.
If only a new item jitters, inspect whether it bypasses the socket or its
two-hand anchor. Physical headset acceptance remains the next playtest.
