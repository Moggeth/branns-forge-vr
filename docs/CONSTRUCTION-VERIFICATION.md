# Free timber construction verification

Run offline; `--world-builder-check` keeps the live-scene fixture away from the player's settlement save:

```powershell
& .\tools\godot\Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://world_builder_construction_checks.gd
& .\tools\godot\Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://world_builder_construction_live_checks.gd -- --world-builder-check
```

The synthetic fixture checks all four deck kinds against physics rays and worker height sampling, rejects wet bridge banks and insufficient lumber without ledger changes, validates persisted records, rebuilds the physical deck after a JSON save round trip, and proves A* can cross a river only after a free bridge exists. The live fixture surveys a real Orchard river span away from the fixed bridge, builds without writing the save, checks the Hero's floor ray, finds a route over wet cells, and moves an actual lumberjack over that deck.

The existing authored stone arch bridge is 5.88 m long with a 4.6 m clear water span. It is retained for the fixed crossing. The free structures use dimensions matched to their actual colliders; scaling the full stone arch to an arbitrary span would break the authored proportions. A reusable authored timber module would improve their appearance.

Construction records pin deck elevations. Later terrain edits can bury a deck or leave a bank below its end. The route planner uses the higher of terrain and deck at each cell, and will stop using an inaccessible route, but terraforming currently does not prevent these conflicts or repair the structure. This is a remaining authoring constraint.

## Measured implementation checks and recovery

| Step | Result | Seconds |
| --- | --- | ---: |
| Initial repo/runtime/navigation discovery | Read contracts | 0.099 + 0.081 + 0.050 |
| First navigation fixture | Parse failed: a Node field was named `owner`, colliding with native `Node.owner` | 0.837 |
| Corrected navigation fixture | Passed | 0.830 |
| First isolated construction fixture | Parse failed: untyped dictionary duplicate inference | 0.189 |
| Corrected isolated construction fixture | Passed | 0.365 |
| First live fixture | Parse failed: inferred endpoint vectors from dynamic data | 0.183 |
| First live river survey | Failed: selected border span; ray used local coordinates as global | 7.024 |
| Second live river survey | Failed: short span made grid endpoints unrouteable | 6.937 |
| Corrected live river survey | Passed, route over wet deck | 6.847 |
| Lumberjack traversal added | Passed, actual worker crossed | 7.309 |

The fast method is to keep Godot Node member names distinct from native properties, give fixture vectors explicit types, survey central river candidates at least 18 m bank-to-bank, and add `builder.center` for World3D ray positions. Use the isolated fixture for iteration; load the real scene only for final integration evidence.
