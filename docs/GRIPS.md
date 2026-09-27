# Grips and holsters

Controls: squeeze the same handle with a second hand; release either hand to
handoff. Hold A while gripping to adjust position/rotation, release A to lock.
Index A/B are explicitly mapped by setup_actions.gd in openxr_action_map.tres.
Two hip slots accept a slow release (at most 1.2 m/s), with a proximity cue and
haptic. Grip near an occupied slot draws its tool. Recall ignores stowed tools.
Tool selection reuses existing objects rather than duplicating them.

The grip_runtime.gd module owns grip records and slots; main.held remains the
hand-to-item ownership source. Two-hand solving aligns the authored handle axis,
including antiparallel poses, then anchors the first grip. Handoff preserves the
world transform. A adjustment stores the relative grip transform per controller
on the item. Finger joints curl procedurally; this is not skeletal finger tracking
or a full physical two-body constraint. Support visual correction is capped at
15 cm and does not alter raw controller tracking.

Built-in handles use local Y -0.03 to 0.46 m. Custom items currently default to
local Y 0 to 0.35 m; differently authored handles need grip_min/grip_max metadata
and may need an axis adapter in a future iteration. Per-item adjusted grips and
slot assignments are session state, not disk inventory. Persisted ownership is
unchanged. The belt follows headset horizontal position/yaw; height is a tunable
HMD offset, so calibrate player height before judging the hip position.

Live tuning: grip.secondary_reach, holster.reach, holster.height. Defaults are
0.18, 0.20 and 0.65 m. All are in the native B > Tuning pages and service schema.
Logs include HOLSTER, GRIP_RELEASE and THROW. Run Verify Brann.ps1 for lifecycle
checks: two-hand alignment, both handoff directions, solo adjustment, holster /
draw transform retention, travel/recall retention and fast release throwing.
The offline --capture-grips flag previews real hand/tool meshes without a paid
API or live microphone. Use start.ps1 / stop.ps1 for the managed runtime; logs
and process identities are under logs/. Physical comfort still needs headset
playtesting.
