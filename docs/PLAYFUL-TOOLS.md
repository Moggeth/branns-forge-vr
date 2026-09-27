# Sunskipper returning ring

The Sunskipper is a free, offline physical toy with three toss powers, tracked VR
throws, automatic return, a musical click for power/catch/impact, eight glowing
inlays, a bounded ten-spark trail and a Bellwright reward finish. It cannot damage
the player. The Bellworks fair consumes its physical impacts through the encounter
module. No service, generated asset or paid API is needed.

The forge pedestal is at **(9, 0, 4.5)**, clear of the east fair gate landing.
The court pedestal is at **(117, 0, 68)**. Both retrieve the same ring. The court's
small glowing ring is a display token, not a second interactive item.

## Play

- Grip / E near either pedestal to take the ring. Another hand cannot steal it.
- Trigger / left click while holding cycles Soft Toss, Courtyard, Long Shot.
- Release grip / E to throw. Deliberate VR hand velocity preserves throw direction;
  slow releases and desktop throws follow aim, with the selected power.
- Trigger / left click with the original empty hand recalls. A successful bell
  strike recalls automatically. A clear empty hand catches the returning ring.
- Three bounces, five seconds of flight, twelve seconds total, falling below the
  world, a zone change, or a long teleport recover the ring. Occupied hands cannot
  be overwritten. A held ring travels with its holder.

Recall is spectral, so scenery cannot trap the ring. Outbound flight uses swept
centerline rays and capped 20ms substeps to catch thin bells at up to 21m/s. The
ring's decorative outer rim does not expand its collision radius. Bellwright changes
the inlays and stand title; encounter persistence owns whether that reward is earned.

## Integration ownership

`godot/playful_tools.gd` owns its scene nodes and its holder; it does **not** enter
the generic weapon `held` dictionary. Root must wire these interfaces:

| API | Hook |
|---|---|
| `setup(game)` | After adventure zone groups and optional playful feedback exist |
| `tick(delta)` | Once per frame |
| `try_grab(hand, desktop=false)` | Before generic grip/item handling |
| `release(hand) -> bool` | First in adventure release; true consumes it |
| `trigger(hand) -> bool` | After menu handling, before generic tool triggers |
| `busy(hand) -> bool` | Desktop E release toggle, trigger allowance and held-hand checks |
| `claims_trigger(hand) -> bool` | Bomb suppression for held or recall-bound free hand |
| `retrieve(hand) -> bool` | Optional fair console free reissue; never duplicates |
| `unlock_reward(id)` | Encounter calls with `bellwright`; idempotent cosmetic application |

An outbound hit calls `game.playful_encounters.hit_target(collider, position,
velocity)`. True recalls the ring. False bounces. Returning flight never calls
this callback, preventing duplicate bell progress. The optional feedback module
receives throw, recall and catch pulses plus the forge pedestal proximity hint.

Setup stores no user data. The module has no saves or network requests. Events
with prefix `PLAYFUL_TOOLS` go into the launcher's normal game log. Normal stop
and recovery remain the existing Brann launch/stop workflow; restart restores the
ring at its forge pedestal. The fair reapplies an earned skin from its own state.

## Fast isolated verification

Additional target games explicitly call `register_target_receiver(receiver)`;
the ring retains at most four weak references. Duplicate registration is
idempotent, freed/queued receivers are pruned, and
`unregister_target_receiver(receiver)` removes a receiver. Nodes must implement
`hit_target(collider, point, velocity, context) -> bool`; optional
`on_throw(context)` runs only on an actual release. No target auto-discovery or
script loading occurs.

Receivers run in registration order. True consumes the collision and causes the
normal ring recall. If none accepts, the existing Bellworks callback still runs,
then ordinary physical bounce if that also refuses. Return flight invokes neither
target path. Throw speeds, ownership and direction are unchanged.

Each callback receives a fresh immutable Dictionary containing:

| Key | Meaning |
|---|---|
| `throwId` | Monotonic actual-release ID, unchanged throughout that flight |
| `bounceCount` | Completed unconsumed physical collisions in this throw |
| `launchPosition` | Camera world position at release |
| `lastBounceCollider` | Previous actual bounce collider, or null if absent/freed |
| `lastBounceAt` | Flight-age seconds of previous bounce; -1 before any bounce |
| `flightAge` | Current elapsed flight seconds |

Snapshots do not change when later throws occur; numeric fields remain finite.
A retained collider reference must still be checked with `is_instance_valid` if
used after its callback, since the scene can subsequently retire that node.
Bounce provenance updates only after the current collision is refused by both
receiver paths. Every throw resets it. A bankshot should verify its own recorded
throw ID, launch area, designated previous wall and bounce timestamp before
awarding progress.

The focused suite retains all original 34 checks and adds a real thin-wall bounce
into a second thin collider, same-throw provenance, normal Bellworks fallback,
immutable snapshots, reset on next throw, weak-reference cleanup and the cap.

From the project root in PowerShell:

```powershell
& 'tools/godot/Godot_v4.7.2-stable_win64_console.exe' --headless --xr-mode off --path godot --script res://playful_tools_checks.gd
```

This uses a small mock game with a **real Godot physics world**. It does not load
main, start the service, or touch real saves. The 61 checks include charge wrap,
both stands, single ownership, Living/bomb/weapon exclusions, physical velocity,
thin-bell collision, exact-once callback, spectral return, ordinary wall bounce,
zone and same-zone teleport recovery, fall/timeout rescue, and reward application.
Latest result: **61 checks, zero failures**, engine process 0.596 seconds. Real
desktop rendered layout, audio quality and headset throwing need central visual
and headset verification; these tests do not claim those observations.

## Validated lessons

- Registered target challenges receive per-throw provenance from actual swept
  collisions. A target callback runs before its collision becomes a bounce, so
  `lastBounceCollider` correctly identifies the preceding wall. Never award a
  bankshot from proximity, a guessed wall, or a previous throw's cached bounce.

- **Always include `--xr-mode off` in offline headless commands.** `--headless`
  alone still entered SteamVR's OpenXR initialization and stalled after
  `XR_ERROR_GRAPHICS_REQUIREMENTS_CALL_MISSING`. The specific owned parse process
  was identified by its command line and stopped. Explicit XR-off parsing completed
  in 0.371 seconds. Do not kill unrelated Godot or SteamVR processes.
- **Let the audio mixer retire playback before ending tiny harnesses.** The first
  fast successful checks exited while the sound thread still retained one
  `AudioStreamWAV` and one `AudioStreamPlaybackWAV`. Merely calling stop and waiting
  one process frame did not resolve the warning. Stop audio, wait 0.1 seconds,
  free the scene, then wait 0.1 seconds; the same suite exits cleanly.
- **Check hand ownership outside `game.held`.** Living objects, workshop systems
  and forming bombs each own hands independently. `_free_hand` tests those systems
  before pickup or catch; recall yields to a newly occupied hand and returns home.
- **Portal travel may preserve the adventure zone ID.** A camera displacement
  above 15m recovers a loose ring too; checking only the named zone missed this.

Measured step details are in `logs/playful-tools-timing.csv`. Initial delivery
used four new files. The later bounded receiver extension backed up its existing
source/tests/docs under `work/sunskipper-receiver-backup-20260921-080819/`.
