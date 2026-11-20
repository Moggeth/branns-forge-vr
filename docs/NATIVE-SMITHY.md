# Brann’s native smithy

Choose **Adventure** in the Brann’s Forge Launcher, then desktop or VR. The forge is the starting destination. Return through a home gate or choose Forge Yard from the travel map. The launcher’s Stop and Logs controls apply to this scene. Godot also writes `user://logs/game.log`.

## Walking the yard

Brann’s handoff bench is beside his anvil. The ledger behind the bench offers talk, voice, forge progression and invention. The tool board is on the other side of the hearth. Practice dummies share a western lane. Seven gates face the open central court. The eastern aisle leads to the armory directory.

Each of nine bays accommodates six physical display positions. When the first 54 addresses fill, use the directory to turn to another folio on the same floor. Stand numbers continue across folios. A returned weapon goes back to its original address. A weapon you hold, wear or drop stays with you when someone turns the directory. The starter hammer remains beside Brann. The guide and the commission completion message report where a docked item can be found. The pre-existing `user://collection_homes.json` preserves order across launches.

## Running the native checks

From this repository, use the bundled Godot 4.7.2 console executable with `--headless --xr-mode off --audio-driver Dummy --path godot`. Append one of these script commands.

- `--script res://smithy_checks.gd -- --world-builder-preview` runs the real offline game with 127 registered items. It probes floor support and capsule clearance through every gate into every bay, tests active and archived physics, checks the four commission buttons, and plays a complete three-strike handoff.
- `--script res://portal_visual_checks.gd -- --visual-script=res://portal_kit/portal_kit.gd` checks all travel links and the gateway artwork against walkable and ray-selectable clearance.
- `--script res://portal_walkthrough_checks.gd` checks desktop and tracked-head crossing, cancellation, exits and cooldowns.
- With graphical Godot, omit `--headless` and use `--script res://forge_yard_art_review.gd -- --world-builder-preview`. The 15 screenshots land in `outputs/forge-yard-review/`. An absolute destination can be supplied with `--smithy-review-output=...`. Use the complete workshop fixture, including its tier and recipe availability, for repeatable populated armory shots.

The physics checks found an invisible ridge from the neighbouring quarry and a dummy stand in the yard-to-armory aisle. Distant terrain tagged as a backdrop is excluded from generated decoration collision. A stand’s front control has its own physical depth, so stand on the visitor side to probe it. Use real scene rays, floor heights and the player capsule after changing the layout. A desktop capture cannot verify headset tracking or comfort.
