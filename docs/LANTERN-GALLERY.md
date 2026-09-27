# Lantern Parade

An optional, untimed Sunskipper challenge in its own 14 × 18 metre court,
centred at `(205,0,65)`. Safe arrival is `(205,0,70)`, facing toward negative Z.
Three lanterns sway gently: Amber Sun (round), Mint Leaf (diamond), and Violet
Window (square). Every call identifies the name, shape and color, and bright
brackets mark the requested target. Color recognition alone is unnecessary.

Choose START, retrieve the existing Sunskipper at the left pedestal, and use
COURTYARD power. Stand behind the gold line, aim slightly above the called
lantern, and release grip / press E to throw. Trigger / click cycles power while
held and recalls while flying. Match six calls to earn the Parade Keeper medal.
Every lantern hit recalls the ring, including wrong hits; a wrong hit names the
lantern struck and the requested target without resetting earned hits. There is
no deadline, elimination, forced movement or new combat behavior.

PLAY AGAIN starts a fresh six-call round; PUT AWAY abandons it. Both preserve
completed achievements. The board shows throws and the fewest throws in a
completed round. Buttons sit ahead of the landing, at local Z 3.8, below the
ordinary throw trajectory. GPU review found the initial board text too small at
throwing distance. The main board now uses 64-point text at pixel size .005
for a nominal glyph height of .32 metres; target names use 30-point text and
the THROW HERE marker 32-point text, both at pixel size .005. Targets move no more than .48 metres
horizontally and .18 metres vertically around their authored positions; maximum
horizontal speed is .264 metres/second. Geometry uses three target colliders,
existing low-poly helpers and emissive materials, without additional lights.

## Root integration

Create `game.lantern_gallery` from `godot/lantern_gallery.gd`, call `setup(game)`
after Sunskipper and feedback, and call `tick(delta)` before Sunskipper's tick.
Setup registers this explicit receiver with Sunskipper's existing bounded weak
reference registry. Registration failure is visible in the log and prevents
starting an unwinnable round. No automatic target discovery is used.

Route `lantern_gallery:<action>` button actions to `act(action)`, supporting
`visit`, `start`, `retry`, `abandon`, and `leave`. Add the gallery's
`try_grab(hand,desktop=false)` to normal grab dispatch for its VR pedestal.
Desktop retrieval already uses `playful_ring_stand` metadata. All retrieval
delegates to the single existing ring, preserving its occupied-hand protections.
Travel delegates to Living's ordinary safe-travel method. A blocked leave keeps
the current round; successful leave or travelling more than 25 metres away
abandons its transient state.

The receiver only counts actual `on_throw` releases launched inside the marked
court lane. It rejects repeated/old IDs and foreign launches. A release can
advance only once. Retry, abandon and restore invalidate any pending release,
so an old flight cannot score in a new round. Unrelated collisions return false,
preserving ordinary Bellworks behavior and other explicit receivers.

## Persistence

`fresh_state()` and `progress_snapshot()` return exactly:

```json
{"schema":1,"revision":0,"medal":false,"completions":0,"bestShots":0}
```

`_valid(value)` is static and rejects non-dictionaries, extra fields, non-finite
numbers and inconsistent rewards. Revision is an integer from 0 to 100000000;
completions and bestShots are integers from 0 to 1000000. Medal is true exactly
when completions are positive. Best shots is zero without completions, otherwise
at least six. `restore_progress(data)->bool` validates and normalizes integer
fields, then clears active round, stage, shots, pending throw and motion phase.
It is safe before setup, and neither snapshots nor restore accept live flight,
body transforms, scripts or running-round data.

Normal play saves only completed achievements to `user://lantern_gallery.json`,
with validated temporary/backup recovery candidates. Diagnostic/offline and
smoke setup disable this storage completely. The standalone demo adapter owns
its separate optional payload; initialize this module before that adapter.
Saving trouble is shown on the board; progress remains in memory. Runtime logs
include `LANTERN_GALLERY_READY` and `LANTERN_GALLERY_COMPLETE`.

## Headless checks

```text
tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --path godot --script res://lantern_gallery_checks.gd --quit-after 1800
```

73 checks pass, including a genuine wrong-target throw and all six correct
moving-target flights using the production ring's default speed (9 m/s), gravity
(1.1 m/s²), actual release and swept world collisions. Targets move during the
flight, and physics frames synchronize their collision transforms. The tests
also cover occupied-hand retrieval, duplicate and off-lane throws, stale flight
after retry, safe/blocked departure, completed best preservation, strict durable
bounds and native-save corruption recovery. All filesystem writes occur beneath
a unique OS-temp fixture. No real player saves, service calls or GPU are used.

For a deterministic walkthrough, place the camera at `LANDING + UP * 1.7` and
aim toward a short prediction of the requested target: estimate flight time as
current distance divided by 9, sample `_lantern_position(index, motion_clock +
estimate)`, then add `.55 * estimate² - .32 * estimate` to its world Y. Copy the
camera transform to the desktop hand, retrieve and release normally. The call
order is `[0,2,1,2,0,1]`. This is a test aiming recipe; gameplay has no aim assist.

The repeat after moving the controls forward also passed every real flight,
showing the controls do not obstruct the landing-to-lantern path. Headless checks
do not establish headset comfort or final visual quality; root owns that review.
Measured durations are in `logs/lantern-gallery-timing.csv`.
