# Free timber construction verification

Run offline; `--world-builder-check` keeps the live-scene fixture away from the player's settlement save:

```powershell
& .\tools\godot\Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://world_builder_construction_checks.gd
& .\tools\godot\Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://world_builder_construction_live_checks.gd -- --world-builder-check
```

The synthetic fixture checks all four deck kinds against physics rays and worker height sampling, rejects wet bridge banks and insufficient lumber without ledger changes, validates persisted records, rebuilds the physical deck after a JSON save round trip, and proves A* can cross a river only after a free bridge exists. The live fixture surveys a real Orchard river span away from the fixed bridge, builds without writing the save, checks the Hero's floor ray, finds a route over wet cells, and moves an actual lumberjack over that deck.

The existing authored stone arch bridge is 5.88 m long with a 4.6 m clear water span. It is retained for the fixed crossing. The free structures use dimensions matched to their actual colliders; scaling the full stone arch to an arbitrary span would break the authored proportions.

The free structures now use the Sonnet-authored timber mesh generator with the Orchard stockpile's four imported wood textures. It emits one mesh with six surfaces per structure. The isolated fixture checks every triangle's geometric winding against its stored normal, confirms the textures load in Godot, checks the mesh budget, and verifies that pier feet meet the terrain sampled at each actual pier position. Measured results were 2,172 triangles for the 10 m bridge, 1,788 for the ramp, 960 for the stairs, 2,148 for the boardwalk, and 6,924 for a maximum-length 36 m boardwalk. Floor, rail and terrain-grounded pier colliders remain separate physics bodies. Visual review in the actual orchard and headset comfort remain separate acceptance checks.

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
| First Sonnet visual integration geometry fixture | Failed: all generated face windings opposed their normals | 0.469 |
| Corrected face winding geometry fixture | Passed | 0.453 |
| Full 36 m boardwalk mesh budget fixture | Passed, 6,924 triangles | 0.452 |
| Authored wood texture import fixture | Passed | 0.454 |
| Actual Orchard route after visual integration | Passed; concurrent Ent script parse fix included | 7.032 |

The fast method is to keep Godot Node member names distinct from native properties, give fixture vectors explicit types, survey central river candidates at least 18 m bank-to-bank, and add `builder.center` for World3D ray positions. For new procedural meshes, compare triangle cross products with declared normals before capturing; the first delivered winding was reversed and would have culled front faces. Use the isolated fixture for iteration; load the real scene only for final integration evidence.
