# Reset World

Desktop: **M → Reset World… → Yes, Reset World**. The confirmation explains the scope and initially focuses **Cancel**. The Map can also be opened from the strategic view.

VR: **B → Travel → Reset World…**. The hand menu changes to **Are you sure?** and **Yes, reset world**. Confirm within 15 seconds. **Close**, closing with B, or letting the timer expire cancels.

Confirmation restores the Orchard using its current seed and recipe, clears the terrain operation journal and settlement state (grown forests, construction, meteors, workers and settlement resources), rebuilds the local game scene and returns the Hero to Brann's Forge. Level, quest, workshop and crafted-item persistence are separate and are not reset. Other regions return to their normal scene state. This is a local game reset, not a remote multiplayer reset.

Relaunch normally once to load the feature. Implementation and checks did not restart the resident game, touch resident world saves, or reset the player's world.

## Backups and recovery

Before replacing either save, the reset copies both original files and writes the current in-memory world to a timestamped backup directory. A backup failure leaves the current world running. A scene reload failure attempts to restore the original saves and resume play. Old-scene autosaving is blocked during the successful reload so it cannot overwrite the fresh saves.

Godot's default state directory on this machine is `%APPDATA%\Godot\app_userdata\Brann's Forge VR`. The two reset files are `landscape_v1.json` and `world_builder_v1.json`. Backups are under `world-reset-backups/<UTC timestamp>-<unique suffix>/` and contain those files when they previously existed, plus `live-world.json`.

To recover a backed-up world, first **Stop managed session** in the launcher. Copy the two saved JSON files from the chosen backup into the same state directory, then relaunch. Do not copy while the game is running because autosaving can replace them. `live-world.json` is a diagnostic snapshot, not a drop-in save file.

Game logs contain `WORLD_RESET confirmed` and `WORLD_RESET reload_complete` with the backup path. Use the launcher's **Open logs** for the current session.

## Verification and reusable fast path

Run from the project root:

```powershell
& '.\tools\godot\Godot_v4.7.2-stable_win64_console.exe' --headless --xr-mode off --audio-driver Dummy --path godot --script res://world_reset_checks.gd --quit-after 1800 --log-file "$PWD\logs\world-reset-check.log" -- --world-builder-check
```

The fixture uses disposable OS-temp saves outside OneDrive. It checks actual Map confirmation and cancellation, VR arming/expiry, invalid paths, exact backups, rollback, preserved character/item fixtures, a real Main scene reload, safe Forge return and subsequent walking. Never point this fixture at resident saves. Removing `--headless` additionally captures the actual confirmation layout under `outputs/world-reset-review/`.

Measured on 2026-10-01: resource import **4.86 s**, first full-scene check **15.55 s**, final native render/reload/movement check **22.08 s**, final resource import **4.84 s**. All assertions passed. The first headless teardown reported a known ObjectDB leak warning; the final native run had no matching errors or warnings. The 960-pixel modal capture was inspected and its full explanation/buttons are readable. Physical headset confirmation remains untested.

For future reset changes, test the real scene lifecycle and post-reset movement, not just JSON replacement: shutdown autosaves, stale scene references and a paused tree can otherwise make an apparently successful reset unusable. Use XR off and the offline diagnostic flag so verification never claims the resident headset or service.
