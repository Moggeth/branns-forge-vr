# Brann’s native smithy

Choose **Adventure** in **Brann’s Forge Launcher**, then desktop or VR. Start in Forge Yard. Walk toward Brann for the starter hammer and the commission ledger, east to the armory, or across the courtyard to the gateways. A home gate or Forge Yard on the travel map brings you back. The launcher’s Stop and Logs controls apply to Adventure. Native logs also live in `user://logs/game.log`.

[Before and after, Brann and the armory](../assets/smithy-source/review/smithy.jpg) · [All nine courtyard gateways](../assets/smithy-source/review/gates.jpg) · [11-second in-game film](../assets/smithy-source/review/smithy-motion.mp4)

## The yard and the collection

The central paths connect Brann’s anvil, the seven expedition gates and the eastern armory. The western practice lane, Living Museum and Bellworks Fair each have their own approach. Foliage, cradles and the quarry backdrop leave those routes clear. The 206 m valley is scenery. Traversal uses a separate walkable floor.

There are nine armory bays with six numbered stands each. Bays open as the collection grows. Beyond 54 addresses, use the directory beside the entrance to turn the folio. Numbers continue across folios. Held, belted and dropped equipment stays in the world. A recalled weapon goes back to its original address, and the starter hammer keeps its own handoff bench beside Brann. Existing `user://collection_homes.json` files preserve item order. The resource guide and Brann’s completion notice also give the stand and folio.

The commission ledger provides talk, voice, workshop upgrades and invention. On completion Brann strikes the billet three times before the creation becomes available at its assigned stand. His hammer uses the visible striking face as the contact point. The furnace, chimney, impact sparks, layered strike sounds, gaze, eyelids, breathing and speech movement are driven by the native game.

## Art and destination windows

The runtime kit has 43 GLBs, including Brann and his hammer, workshop buildings, fixtures, training equipment, stands, valley scenery and gateway frames. The corresponding Blender scripts and art handoffs live under [assets/smithy-source](../assets/smithy-source/). Embedded material textures stay inside the imported assets. The grounds artwork also supplies the two side-door frames.

Twelve core destinations have individually modeled frames and their own moving veil patterns. Real views of those destinations and both side rooms are baked into 14 small WebPs. The windows use bounded parallax and respond to approach, crossing and arrival. The nearest gates add light and particles. The 22 core travel links retain their original walk-through and ray actions. Sky Garden carries a blue-white forked arc around its rim. Cloudbreak Keep carries a gold-violet variant. Both build and decay over roughly four seconds. The middle stays open to the view.

To regenerate windows after changing a destination, run graphical Godot with `--xr-mode off --audio-driver Dummy --path godot --script res://portal_kit/bake_destination_views.gd -- --world-builder-preview`. Append `--views=forge_yard,museum,bellworks` to refresh just those three. Import the changed files in the editor before packaging or testing. Mounting labels use runtime state. Keep the authored plaque artwork free of sample orders or quest text.

## Reproducing the native checks

Use the bundled Godot 4.7.2 console executable. From the repository, start with `--headless --xr-mode off --audio-driver Dummy --path godot`, followed by one of the options below.

- `--script res://smithy_checks.gd -- --world-builder-preview` loads the real offline game, creates 127 registered items, and checks 1,799 points along walkable routes. It also exercises three folios, held and recalled tools, the four ledger controls, the workshop upgrade, the two side doors and Brann’s three-strike handoff.
- `--script res://portal_visual_checks.gd -- --visual-script=res://portal_kit/portal_kit.gd` checks 22 live travel links, including opening geometry and ray access. `--script res://portal_walkthrough_checks.gd` checks desktop and tracked-head crossing, cancellation, exits and cooldowns.
- `-- --expedition-check` exercises zone travel, resources, fog restoration and horizon geometry. The Forge Yard’s five valley meshes are excluded individually from weather overlays. The stream uses the project’s animated water surface.
- `-- --playful-check` uses the real Bellworks gate, controls, return trip, bank shot and museum interactions. On desktop, E takes or drops Sunskipper, X throws it and a click recalls it.
- With graphical Godot, `--script res://portal_kit/check_storm.gd` compares the actual portal materials at peak and rest on the same frame. It checks both lightning variants, the center of each window and two unaffected gates.
- With graphical Godot, omit `--headless` and add `--script res://forge_yard_art_review.gd -- --world-builder-preview`. This writes 19 in-game views and logs visible draw and primitive counts by view. The default directory is `outputs/forge-yard-review/`. Override it with `--smithy-review-output=<absolute path>`. The review loads the built-in workshop fixture with available recipes and uses the live hammer and gameplay camera. To capture the short silent film, add `--fixed-fps 24` before `--script` and `--smithy-motion-output=<absolute path>` after `--world-builder-preview`. Encode the 260 numbered JPEGs at 24 fps.

If an aisle becomes impassable, inspect nearby scenery collision and the front depth of the stand buttons with the real player capsule. If an imported meadow is white, inspect both the glTF colour channel and the imported material’s vertex-colour flag. An earlier portal frame looked clear in a still while its decorations intersected the opening. Check the actual mesh opening and travel physics after frame edits. If the Bankshot landing is blocked, inspect the shipped Starfall Ridge collision manifest. Its three observatory skyline cliffs sit beyond the walkable zone and must stay visual-only. The travel log records the blocking body. Source, manifest and live court must agree. For changes to the integrated checks, compile their GDScript directly with `--check-only` before running the full scene.

Desktop results and simulated tracked-head crossings are available. Physical headset comfort and performance require a headset playtest.
