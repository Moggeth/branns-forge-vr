# Orchard Brook walkable comparison

This isolated Godot preview lets you walk through benchmark variants A–E without opening the live Brann's Forge game. From the repository root:

```powershell
& godot/experiments/visual_2d3d/preview/Start-Preview.ps1 -Variant E
& godot/experiments/visual_2d3d/preview/Start-Preview.ps1 -Variant B -Fresh
```

The launcher loads `godot/experiments/visual_2d3d/<variant>_smoke/world.tscn` if it exists. `-Fresh` builds from the saved `world_spec.json`, which is useful after spec or builder edits. `-Scene res://.../world.tscn` selects another scene saved within the Godot project. For a new saved scene, run `Run-World.ps1` first; the preview never writes a scene. B uses `planning/artifacts/B/world_spec.json`; A, C, D and E use `variants/<letter>/world_spec.json`.

WASD moves, mouse looks, Shift sprints, Space jumps, R resets to the southwest spawn, and F1–F5 switches A–E. Escape releases the mouse; click captures it again. Switching builds the chosen spec fresh. The walker has capsule collision with terrain and the bridge deck. Falling below the world resets to spawn. This is a desktop navigation preview, not a VR or full gameplay acceptance test.

For a quick parse, construction, and spawn collision check:

```powershell
& godot/experiments/visual_2d3d/preview/Start-Preview.ps1 -Variant E -Smoke
& godot/experiments/visual_2d3d/preview/Start-Preview.ps1 -Variant D -Fresh -Smoke
```

Every launch writes timestamped `preview/logs/*.log` for in-engine events and `*.console.log` for Godot output, including parse errors. `-Smoke` checks the terrain collider, walker floor and movement, bridge deck collider, and camera; it returns exit code 0 on success and 2 on a runtime check failure. If a saved scene fails to load, try `-Fresh`; if the fresh build fails, run `Run-World.ps1 -CheckOnly` on its spec and inspect the error in the preview log. Close the window or use Alt+F4 to stop. Runtime logs are ignored by Git.

Validation on 2026-09-28: Godot 4.7.2 headless smoke passed for saved E and fresh A, B, C, D and E world specs. Final movement/collision smoke was rerun for saved E and fresh D: each moved about 1.1 m while grounded and hit `WalkableDeckCollision` at the bridge. Interactive mouse and keyboard behaviour has not been manually exercised in a desktop window.

During the first E smoke, Godot could not open its log because PowerShell's `Tee-Object` held the same file; separate engine and console logs fixed it. A later smoke extension introduced two GDScript inference errors, and the invalid script left the SceneTree process running; explicit `bool` types fixed the parse and the subsequent checks passed. If a future startup prints a parse error and appears hung, inspect `*.console.log`, stop that preview process, and fix the script before rerunning. The measured steps and corrections are in `timings.csv`.
