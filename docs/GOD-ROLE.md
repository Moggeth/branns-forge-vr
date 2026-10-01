# God role: Rat Stream and useful powers

The God and Hero act in the same world. In the RTS survey, **F4 → hold 4** streams rats at the pointer; releasing 4 stops. Select Rat Stream and hold the left mouse button for the same gesture. A new target follows the pointer while held. Esc, focus loss, leaving the region, an invalid target, depleted Mana, or the rat cap ends the stream. Each rat appears immediately and six can arrive per second for 0.08 Mana each. At most 256 remain active. Up to 24 nearby rats use the articulated Workshop rat; distant rats share its merged authored mesh, with a physical hit body for each. Approaching a distant rat promotes it to the articulated model.

Defeated enemies leave glowing Essence on the local floor or planet surface. Move the RTS cursor over motes to collect within 2.4 m; the Hero can see the same motes in first person. A rat grants 1 Essence, a skeleton or ghost 2, and a golem 4. Essence persists in the existing World Builder state as `god_essence` (cap 200). The Skeleton Squad costs 4 Mana and 2 Essence, summons three enemies, and has a 12-second cooldown. A lumberjack costs 3 Mana or, when Mana is insufficient, 3 Essence. The summon only charges after a valid worker placement; it does not consume Lumber. Workers fell trees and deliver timber to the shared Lumber stockpile in both the Orchard Highlands and Orchard Planet.

The God-role runtime is `godot/god_role_runtime.gd`; `godot/god_role_workers.gd` owns the workers. `godot/world_builder_view.gd` routes RTS input and shows Mana, Essence, and Lumber. The God-role ledger uses the existing `godot/world_builder_runtime.gd` save. To inspect live state, use `game.god_role.status()` and `game.god_workers.active_workers()` from a debug session. The flat Orchard and Orchard Planet remain separate destinations, while the resource ledger is shared.

## Save-isolated checks

From this repository root, run:

```powershell
& .\tools\godot\Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://god_role_checks.gd
& .\tools\godot\Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://god_role_live_checks.gd --quit-after 1500 -- --orchard-planet-preview
```

The first check covers bounded spawn/economy/motion behavior without loading Main. With 256 rats over 120 frames, the measured mean tick was 0.284 ms on flat terrain and 2.233 ms with actual planet fields; maxima were 0.412 and 2.58 ms. This is a headless diagnostic measurement, not a frame-rate promise. The second check loads actual Main in diagnostic offline mode, routes real RTS key and mouse events in both destinations, then accelerates worker ticks until timber reaches the shared stockpile. It passed 33 checks in 15.45 seconds. The harness overrides only cursor ray results to choose deterministic ground points and layout persistence to avoid resident preferences; the view's input, action, builder, travel, and worker paths are real. Both checks must print their `GOD_ROLE_*_PASS` or `GOD_ROLE_LIVE_RESULT` with `failures: []` and exit 0.

The full Main headless harness may print Godot dummy-renderer leaked-instance warnings after its success result, even after queuing Main and the view for deletion. Treat the explicit result and exit code as the behavior gate; renderer shutdown warnings remain a separate cleanup issue. Native frame pacing and physical HMD comfort have not been validated by this harness.

For a native RTS image during the live check, omit `--headless` and add `--god-role-capture=<absolute PNG path>` after `--orchard-planet-preview`. The diagnostic window stays offscreen and unfocusable. The 2026-10-02 capture at `outputs/god-role-native-oct02.png` passed 35 checks in 16.79 seconds. Its actual Orchard Planet sphere frame shows terrain, trees, and crystal seams with clear contrast, plus the Rat Stream card, Mana 19/20, Essence 2, Lumber 1, and the complete footer within the 1280×800 view. The Rat Stream card displays the correct 0.08 Mana price. This is not a physical HMD test.

The first native capture showed the *flat* Orchard under a Planet header because this harness pauses Main's processing and had left the tactical `SubViewport` on its one-frame update mode after travel. After changing regions in an offline fixture, advance the view arrival, position its camera, assert camera distance from the planet center, set the tactical viewport to `UPDATE_ALWAYS`, and wait for rendered frames before reading back pixels. The live game advances the view every frame; the stale frame was a capture-fixture error, not evidence of a live travel bug.

The next sphere capture was washed out because the planet zone had no environment entry, so region travel retained the flat Orchard height fog. Giving the planet its own environment with no height fog restored contrast in the final native frame. When a destination looks uniformly pale, inspect the zone environment that travel actually applies before changing art materials.
