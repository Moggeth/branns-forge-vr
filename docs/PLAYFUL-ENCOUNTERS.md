# Bellworks fair

The brass **Bellworks Fair** gate on the east side of the Forge, opposite the
Hall of Inventions, leads to a small ring-throwing court. Take the Sunskipper from
the stand to the left, then throw from behind the gold line. The board and
reward pedestal sit outside the central throwing lane. Return through **Back to
Brann**. No account, service request, or paid generation is required.

1. Ring the three coloured bells in any order. Repeating one does not count twice.
2. Play the visible melody: **Mint, Ember, Moon, Mint**. A wrong note restarts
   the melody; a wrong Mint is already the first note of the new attempt.
3. Strike the moving golden bell three times.

Each ring hit returns the Sunskipper. Recall does not score another hit. Bells
are labelled with both names and numbers so colour is not the only cue. There
is no countdown or failure penalty. Progress stays between visits and restarts.

Completion makes the reward available. Press **Claim reward** to earn the
Bellwright trophy and the Sunskipper's ember-gold appearance. Entering the court
only discovers it; discovery, trial completion and reward claim are separate
states. **Replay all trials** starts another performance while retaining the
earned trophy and appearance. Use an empty hand to operate signs and gates.

## Implementation and recovery

`godot/playful_encounters.gd` owns its court, gates, four collision targets,
progression and local save. It uses the existing WorldZones art helpers,
WorkshopScene button collisions and Living Workshop safe-travel clearance check.
The pocket court is centred at `(120, 0, 65)`, separated from the Living Workshop
test garden. Its 14 x 18 metre floor has side rails and clear entry/return landings.
The Forge gate is `(11, 0, 1)`; the Forge return landing is `(9, 0, 2)`.

Root integration: `setup(game)`, `tick(delta)`,
`act(action)` with `playful_encounter:` actions, and
`hit_target(node, world_position, velocity) -> bool` from the Sunskipper's swept
flight collision. `progress_snapshot()` returns an independent copy. Targets
must be this module's actual registered colliders; matching metadata alone does
not count. The module calls `playful_tools.unlock_reward("bellwright")` once on
claim or after loading a previously earned reward. Feedback pulses use
`playful_feedback` when available.

Native state is `user://playful_encounters.json`, with `.tmp` and `.bak`
recovery snapshots. Writes validate the temporary snapshot, preserve the last
valid primary, then replace the primary. Loading selects the highest valid
revision across all three files. A broken primary can recover from the backup;
an interrupted replacement can recover from the newer temporary snapshot.
Save failures appear on the in-world board and emit `BELLWORKS_SAVE` warnings in
the normal game log. `BELLWORKS_READY` records restored stage and persistence mode.
Close and reopen normally after repairing unavailable storage. Preserve these
three files together when moving or backing up progression.

Smoke and diagnostic sessions neither read nor write the actual save. Checks
enable storage explicitly against unique `work/bellworks-check-*` fixtures only.

## Verification and fast path

Run the portable Godot executable with:

```text
--headless --xr-mode off --path godot --script res://playful_encounter_checks.gd
```

The 23 assertions cover discovery vs completion, premature/idempotent claim,
stationary contacts, throw-line enforcement, unique bells, ordered melody and
wrong-note reset, moving target, reward persistence across replay, foreign
target rejection, snapshot isolation, valid save/reload, backup recovery,
interrupted replacement, and diagnostic no-write behavior. The latest isolated
run passed all 23 checks. The root sprint owns full-scene input, landing and
render checks; these isolated checks do not establish actual headset comfort.

Two verified implementation lessons:

- Godot JSON numbers load as floats. Array membership against integer literals
  rejected valid saved bell notes. Validate finite integral values, compare
  their integer forms and normalise loaded note indices. Save/recovery checks
  caught the issue before integration.
- Even `--headless --check-only` can initialise configured OpenXR. Omitting
  `--xr-mode off` produced graphics-requirement errors and XR leak warnings;
  explicitly disable XR for all isolated parsing and headless checks.

Measured work is recorded in `logs/playful-encounters-timing.csv`; no Git
repository was created and no paid or network service was used by this module.
