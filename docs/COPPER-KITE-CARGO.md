# Copper Kite Cargo

Walk across Bellworks' east bridge to the cargo garden, or use its Palm travel
shortcut. Take the Copper Kite wand from the stand at the entrance. The three
parcels are marked **SUN / 1**, **LEAF / 2** and **MOON / 3**; their matching
receiving nests use the same words, numbers and colours.

Aim at a parcel and trigger/click to pull it with the wand. Move it slowly into
its nest. Another trigger/click gently releases it while you keep the wand.
Press A in VR, or X on desktop, to deliberately toss a parcel. Release grip,
or press E on desktop, to put away the wand and drop any held parcel safely.
This is physical movement: parcels fall, collide, tumble and need a moment to
settle.

All three correct parcels must rest in their own nests for one second. Holding
one with the wand does not count. There is no timer. Once all three nest lamps
turn green, grip the brass lever handle and pull it toward you. The handle
moves with your hand and springs back when released. An accepted pull gives a
short confirming pulse; an unready pull gives a stronger rejection pulse.
Desktop players can click **Grow copper bloom** with an empty hand. The flower opens
and the permanent **Copper Gardener** trophy appears. Press **Reset three cargo
blocks** to play again. The earned trophy remains; only the three existing
parcels are returned to the starting tray. Parcels that leave the play area
return automatically, so a missed toss cannot make the puzzle unwinnable.

## Integration and state

`godot/cargo_playground.gd` owns three `RigidBody3D` parcels, matching collision
troughs, bridge, garden floor, signs, flower and reward. Root initializes
`magnetic_wand` first, then calls `setup(game)` and `tick(delta)`. Button actions
use prefix `cargo:` with `visit`, `launch` and `reset`. `LANDING` is the clear
world position `(136, 0, 65)`; the annex is centred at `(140, 0, 65)`.

The only edit to the older Bellworks module opens the east rail between local
z = -1.7 and +1.7 and removes the centre decorative post. The level bridge has
its own floor and side rails; it meets both existing court and new annex floors.

Each cargo body stays a direct child of its owner root, uses collision layer 8
and mask 9, has mass 0.6, and registers through the wand's explicit ownership
API. Reset calls `release_target(body)` before changing a body's transform.
Sorting checks the actual wand target, so a magnet-held body cannot score.
There are exactly three bodies; no operation spawns replacement parcels.

The physical lever exposes `try_grab(hand, desktop=false)`, `busy(hand)` and
`release(hand)` for root grip routing and bomb suppression. It requires a free
hand within 0.24m of the handle, clamps pull travel to 0.34m, and attempts one
launch at roughly 0.26m per grip. Letting go, acquiring another tool, or moving
more than 0.55m from the handle disengages it. No player movement is forced.
The two nest-lamp materials are cached at setup and assigned only when a lamp's
settled state changes, avoiding repeated material lookups/render assignments.

`progress_snapshot()` distinguishes discovery, readiness, launch and earned
reward and provides settled timers and completed-round count. A launch can
increase the count only once until reset. The permanent state is saved in
`user://copper_kite_cargo.json`; `.tmp` and `.bak` support interrupted writes
and malformed-primary recovery. Parcel poses and partial sorting are session
state: reopening starts the parcels on the tray while retaining discovery,
the earned trophy and the round count. Save failures appear on the board and
emit `CARGO_SAVE` warnings in the normal game log. Startup emits `CARGO_READY`.

Smoke and diagnostic setup disables real save reads and writes. Tests use only
unique `work/cargo-check-*` fixture files. No service or paid generation is used.

## Checks and lessons

Run portable Godot with:

```text
--headless --xr-mode off --path godot --script res://cargo_playground_checks.gd
```

The 39 passing assertions cover the three-body bound, correct/incorrect nests,
held and moving body rejection, one-second settling, explicit/idempotent launch,
permanent reward across reset, release-before-reset, lost-cargo return, actual
rigid-body fall and settling, bridge floor continuity, capsule clearance,
isolated save/reload, backup and temporary recovery, malformed reward rejection
and diagnostic no-write behavior. Additional grip checks cover occupied-hand
and bomb-formation rejection, physical lever acceptance/rejection haptics,
one attempt per grip, reach limits, release and spring return. A stable-scene
check verifies unchanged indicator material identity and assignment count.
Real physics ran for 150 headless frames.
Root integration owns full-scene controls, movement and graphical verification.

Use a field named `can_launch` rather than `ready` on Node scripts: `ready` is a
built-in signal and a local member with that name fails parsing. This was caught
by the inexpensive parser check and corrected before the physics run. Existing
JSON-number normalization and explicit `--xr-mode off` lessons remain applicable.
Measured durations are in `logs/playful-encounters-timing.csv`.
