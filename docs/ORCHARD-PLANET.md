# Little Orchard planet

Little Orchard is a separate native Godot destination. The original Orchard Highlands and its save remain available. The globe has an 85 m base radius and roughly 534 m circumference, with its center outside existing maps at (6000, 0, 0).

Choose **Little Orchard - whole planet** in the launcher, or use `./start.ps1 -Desktop -WorldBuilder -OrchardPlanet`. **M** opens the destination map; **F/G** selects/travels. **F9** opens or returns from World Builder. **Tab** switches FPS/RTS focus, **Esc** frees the pointer, **Shift+F9** switches split/inset, and **F11** toggles fullscreen. The survey renders the actual same World3D, rather than a second simulated map. Restart normally to load source changes. Resident sessions and saves were left intact.

## World and systems

`orchard_planet_fields.gd` owns seeded continuous XYZ fields on the sphere. Nine smoothly weighted regions cover temperate Orchard, forest, highland, alpine, desert, crystal, wetland, magical and ruins landscapes. Rivers follow downhill samples and carve their beds; lakes have actual surface meshes. Terrain, dressing, weather, ecology and gameplay share these fields.

`orchard_planet_terrain.gd` renders 54 cube-face chunks, currently 43,200 triangles, and builds physics from the same vertices. Spherical-cap dirty updates affect local chunks. Incremental preparation yields between short slices; render/collider commits share geometry. Local-up movement, jumping and point gravity keep Hero, loose physical objects, enemies, projectiles and the fairy oriented on either hemisphere. Controller/HMD poses remain local to the rig.

Starting gameplay includes 58 biome-clustered TreeKit trees (16 authored interactive trunks), 12 registered ore deposits, 10 creatures and apple pickups: 96 placements, below the 110-object initial budget. Existing authored enemy/worker/natural-asset libraries are reused. Sonnet dressing adds bounded instanced clutter and regional landmarks. Mining, combat, physical drops and existing weapon systems are integrated where applicable.

World Builder supports geodesic Path, Earthen Wall, Crystal Fault, Raise Earth, Sunder, Grove, Forest Line, Tree Ring and Starfall. Line spells operate along the globe surface; terrain deformation changes the actual collision. Starfall creates mineable star-iron/star-gem chunks. Skeleton squads, duelists, shield pairs, rats, ghosts and golems also work here. [Stage 1 God role](GOD-ROLE.md) adds continuous rat spawning, visible Essence collection and lumberjacks who cut trees and deliver timber.

## Art and visual review

Verified personal Pro subscription commissions used explicit Sonnet 5.5. The first took 420.309 s and timed out after delivering usable shaders/textures; the narrower second took 168.025 s and supplied a coherent kit using existing GLBs. Source, shaders, textures and palette are under `godot/planet_art/`. This avoids giving the artist ownership of terrain semantics or the seed.

The actual game was captured and inspected from orbit, ground level, alpine, crystal, desert, ruins, water and a Sunder/Tree Ring event. Review corrected inward water winding, insufficient water visibility and night-side ambient light. A live capture after travelling through the original Orchard also caught inherited height fog: the planet now supplies an explicit environment preset so the old fog cannot wash out it or the Hero inset. Coarse riverbank geometry and further ground-level art refinement remain possible; this is a playable foundation, rather than a claim of finished AAA art.

## Verification and measured cost

- Fields: production seed plus 20 others, all nine biome centers, downhill river networks, seams and matching render/collider vertices.
- Focused checks: gameplay, radial movement/projectiles, fairy planet flight, worker delivery, God-role resource accounting, RTS ground previews, narrow panel and reset.
- Actual-main planet acceptance: `ORCHARD_PLANET_INTEGRATION_RESULT []`, 4.177 s. Travel/landing, exterior collision, real terrain spells, creature orientation, both hemispheres, jumping, shared RTS World3D and returning to Forge.
- Actual-main God-role acceptance: 35 checks, 16.79 s with native capture. Flat and spherical Rat Stream key/mouse hold/release, deaths/Essence, skeleton costs/cooldown and delivered lumber.
- Service unit checks: 7/7; full isolated service integration: 79.305 s, adventure failures=[] and siege ledger passed.
- Eight-view actual-game showcase: 18.849 s, median rendered wall interval 8.272 ms at 960x540. Main simulation was disabled for capture and GPU timing unavailable, so this is NOT a full-game or VR frame-rate measurement.
- Terrain baseline peak rebuild 144.730 ms. Incremental 16-vertex preparation with a 1.8 ms budget reduced measured peak warmup work to 3.203 ms; local Raise update peak 2.775 ms. Roughly 324 ticks warm all terrain chunks; arrival waits for every collider.
- 256-rat simulation: mean 0.284 ms on flat terrain and 2.233 ms on real planet fields, with distant authored rats batched and at most 24 full near models. Rendering and total frame cost are additional.

Run from the repository root with the bundled Godot executable:

```powershell
& .\tools\godot\Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot -- --orchard-planet-check
& .\tools\godot\Godot_v4.7.2-stable_win64_console.exe --xr-mode off --audio-driver Dummy --path godot --resolution 960x540 --script res://orchard_planet_showcase.gd -- --orchard-planet-preview
node service/planet-coordinate-test.cjs
node service/integration.cjs
```

Images/logs are in ignored `logs/`. Stop normal managed sessions with `./stop.ps1`, which targets recorded project processes. Runtime planet errors go to `user://logs/orchard_planet.log`; state is under the Godot user-data folder printed at startup.

## Persistence and reset

Seed, terrain operations, spell placements and encounter commands are saved separately at `user://orchard_planet_v1.json`. Ordinary Orchard state stays separate. The God-role resource ledger shares World Builder's saved Mana/Essence/Lumber state. Transient enemy lives, individual rat crowds and current worker animation/jobs are not persisted as a full simulation snapshot.

**M > Reset World...** on Little Orchard asks for confirmation, verifies a byte-exact backup and successful old-save deletion, then resets only the planet and returns to the Forge. Character progress, settlement resources and the original Orchard stay. Planet rat crowds, motes and helpers clear without awarding resources. Backup/delete failure aborts rebuilding. Synthetic reset checks never touch resident saves.

## Validated failure lessons

The service originally limited world/context and workshop coordinates to +/-1000. Building the planet at x=6000 invalidated every subsequent context update, even after returning to the Forge because planet targets were still in the context. This caused misleading tier/cache-recovery failures. Both validators now match the session contract's +/-10000 bound. `planet-coordinate-test.cjs` checks world/context/token coordinates at 6 km and rejects NaN/extreme values (0.077 s). Audit all validators when adding distant maps.

Godot uses clockwise front faces here. Test a physics ray from outside toward the terrain and assert an outward normal; matching mesh/collider arrays alone missed inward one-sided collision. Inspect SCRIPT ERROR even if a check returns exit 0. Retain RefCounted runners across awaits/deferred calls. Always give --log-file an absolute path; a relative log path failed although rendering continued.

After incremental rebuilds, a test's fixed 28-frame assumption accessed a null collider and stalled. Wait for dirty/preparing/morphing work to settle, with a timeout, rather than treating a frame count as completion. Stop only that diagnostic process if it hangs. RTS quick-cast tests need --world-builder-check; missing it intentionally fails to protect user saves. Write documentation explicitly as UTF-8 on Windows; default cp1252 rejected a Unicode arrow and truncated an untracked document, which was reconstructed.

## Current boundaries

Specialized authored minigames/construction remain on their original maps. This surface terrain has no volumetric caves. Legacy flat liquid-flow simulation uses local fire-patch fallback on the planet. Workers avoid unsafe slopes and seek another job if blocked, but do not plan complete detours around new ravines. Physical HMD comfort still requires a headset playtest. This pass adds neither browser/Three.js deployment nor a remote network player; the shared native world and existing local co-op are the current implementation.
