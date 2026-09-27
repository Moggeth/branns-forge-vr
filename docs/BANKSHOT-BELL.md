# Bankshot Bell

Use the Palm travel destination to visit the Bankshot Bell court. Retrieve the
Sunskipper from the left stand and keep **Courtyard** power selected. Stand
behind the gold line, aim slightly upward toward the bell's side of the teal
panel, and throw. The ring must hit the panel and then the bell in the same
throw, with no other collision in between. A direct bell hit brings the ring
back but does not score.

The bell changes position after each success. Three different bank shots earn
a medal. Every actual throw from the throwing area counts, including misses;
the fewest throws in a completed round becomes your best. There is no timer.
**Play again** resets the round while retaining your medal and best result.
**Back to Bellworks** returns to the main fair. The panel's central diamond is
an ornament, not a promise that every shot should aim at its centre.

## Controls and physical behavior

Grip the stand in VR, or aim at it and press E on desktop, to retrieve the same
Sunskipper. Release grip / E throws; trigger / click while holding changes power,
and an empty-hand trigger recalls it. The extra stand cannot duplicate the ring
or steal it from another occupied hand. Root routes the VR stand grip through
`bankshot.try_grab(hand, desktop=false)`; desktop also uses the existing tagged
Sunskipper stand ray path.

`godot/bankshot_challenge.gd` builds the court at `(165, 0, 65)`, with clear
landing `(165, 0, 71)`. The 14 x 18 metre floor is surrounded by low rails.
The panel is local `(0, 1.65, -4)`, with collision size `(9, 3.3, 0.2)`.
The forgiving bell collider is `(1.5, 1.5, 0.3)` and visits these local positions:

| Bell | Position |
|---|---|
| 1 | `(3, 1.5, 2)` |
| 2 | `(-3, 1.8, 1)` |
| 3 | `(2.2, 1.3, 0)` |

Setup registers the challenge through Sunskipper's bounded receiver API. It
accepts the read-only release context and verifies the actual throw identity,
launch area, one bounce, the exact designated panel collider and causal bounce
time. Panel hits remain unconsumed so the ordinary physical reflection occurs.
Target hits consume the flight and recall it. Duplicate callbacks cannot add
shots or score twice; an old in-flight ring cannot score a restarted round.
No guessed proximity or target highlighting awards a point.

Public API: `setup(game)`, `tick(delta)`, `act("visit" | "start" | "replay" |
"leave")`, `progress_snapshot()`, `_valid(value)`, and the stand `try_grab`.
Root owns the `bankshot:` action routing. Visual decoration is separate in
`bankshot_art.gd`, parented to the moving target and medal without new collision.

## Persistence and compatibility

Normal adventure play stores only discovery, current stage/throw count,
completion, medal, best completed score and replay count in
`user://bankshot_challenge.json`. Validated `.tmp` and `.bak` snapshots provide
interrupted-replacement and malformed-primary recovery. `BANKSHOT_READY` and
`BANKSHOT_SAVE` messages appear in the normal game log. Diagnostic mode never
reads or writes this normal-adventure save.

Persistent standalone demos instead store an optional `bankshot` dictionary in
the existing demo schema 1. Old schema-1 saves **without** that field remain
valid and load a fresh unearned Bankshot state. Existing challenge progress is
preserved. New snapshots include the field when the module is present, and
explicit demo reset clears it. Throw identity, velocity and in-flight state are
never saved. The migration tests use only unique OS-temp fixtures and never
inspect or modify the real demo save.

## Verified playable shots and checks

The headless fixture solves all three bells through real Sunskipper release,
swept collision, panel reflection and receiver callbacks. It uses unmodified
default gravity 1.1, Courtyard speed 9 m/s, camera/hand position `(165, 1.7, 71)`
and these normalized forward directions:

| Bell | Forward direction |
|---|---|
| 1 | `(0.185766, 0.097772, -0.977718)` |
| 2 | `(-0.204540, 0.097400, -0.974000)` |
| 3 | `(0.157559, 0.073856, -0.984744)` |

These are a reproducible desktop solution, not a requirement for real hand
throws. The generous target permits nearby angles and physical throws.

```text
tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --path godot --script res://bankshot_checks.gd --quit-after 300
tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --path godot --script res://bankshot_session_checks.gd --quit-after 300 -- --demo-session-check
```

The 22 gameplay checks cover real flights, provenance rejection, shot counting,
replay, valid medal state and native save recovery. The 11 migration checks
exercise a genuine old schema-1 fixture, optional-field introduction, partial
round/medal restoration, absent flight identity and explicit reset. The original
35 demo-session checks also continue to pass with their game double that has no
Bankshot property.

Fast-exit checks initially leaked one AudioStreamWAV and two audio playback
instances. A scene-frame wait did not fix the leak: AudioServer retires playback
on its own mixing boundary. The harness uses the verified Sunskipper-test fast
path, stopping the sound and waiting 0.1 seconds before and after scene teardown.
Require clean engine output, not only a passing assertion counter.

Measured work is in `logs/playful-encounters-timing.csv`. Root owns full-scene,
graphical and headset verification.
