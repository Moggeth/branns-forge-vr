# Experimental native fuel combat

The shared surface-fuel simulation is active in ordinary VR and desktop play. The older `-ExperimentalFuelCombat` launcher flag remains accepted, but is not needed for normal play. Some offline diagnostic modes still use the legacy four-pool fire path. The launcher does not replace an already-running game; close and relaunch to pick up code changes.

At Emberdew common goods, throw an unlit vial to lay fuel, or light a wick and throw to ignite it. Touching puddles conduct fire; all burning fuel is consumed. Ghosts still take only fire damage. Standing in fire hurts the player, with a cooldown. Lit matches still repel ghosts. A player-held match does not yet ignite a puddle; the fairy-carried match and hearth torch have separate ignition paths. See [the fire unification audit](FIRE-UNIFICATION-AUDIT.md).

## Bounds and persistence

- 40 bottles of remaining fuel across all regions, including pending impacts. Capacity returns as fuel burns or evaporates; existing fuel is not evicted for new bottles.
- One fixed 24m, 64x64 surface patch per region, up to eight regions. First impact positions the patch. Leaving pauses that region; returning restores its puddles in place. Nothing is saved across game restarts.
- A patch can relocate only once empty. Out-of-patch, unsupported-surface and full-capacity impacts show a notice; bottles still shatter. This is a prototype boundary, not an unlimited world simulation.
- Physics surface discovery runs 128 cells per game tick, usually 32 ticks after the first impact. Pending spills reserve capacity. Floor sampling starts just above the first impact, allowing cave floors below ceilings.
- Single surface layer: no stacked floors, vertical wall coating, dynamically moving surfaces or robust thin-wall separation. Large height changes block contact ignition; liquid can flow downhill. Empty/no-hit cells block flow. Surface collision authoring controls where spills can settle.
- The active patch simulates at 10Hz, with a bounded 0.2s catch-up step. Rendering uses two shared MultiMeshes and at most three pooled non-shadowed lights. Empty patches skip simulation. Inactive patches do not simulate or render.
- Weather wetness transfers only where the active weather grid samples the same surface. Sheltered/remote surfaces are not treated as globally rained on. Soaked fuel extinguishes. This is not whole-world rainfall simulation.

## Verification and diagnostics

Run `scripts/check-fuel-combat.ps1`. It runs offline, uses diagnostic state, does not write player saves or call paid services, and checks success markers AND script errors. Logs are `logs/fuel-combat-check.log`, `logs/fire-check.log`, `logs/weather-game-check.log`, and `logs/weather-verification.log`. Measured timings append to `logs/work-timing.csv`.

Checks exercise the real vial impact handler, capacity reservation, 40 impacts and rejection of a 41st, unlit persistence, contact ignition reaching a remote ghost, non-fire immunity, fire death, player damage cooldown, complete fuel consumption, rain-soaked extinction, zone return, cave floor support and a real falling RigidBody contact. The unchanged legacy fire suite and weather/playground suites also run.

Still requires headset validation: first-impact scan latency, frame times with many patches, throw/impact placement on authored scenery, flame depth/stereo readability, fire-light appearance, and player foot-height damage feel (currently camera height minus 1.5m). No VR performance claim follows from headless tests.

## Reversible checkpoint

Historical pre-change files are in `backups/fuel-combat-20260921-005800/`. The project now has Git history; use current Git commits for rollback analysis instead of restoring that old snapshot directly over later game changes.

Implementation entry points: `fuel_combat.gd` owns combat/world bounds; `weather_lab.gd` provides the existing conservative field and shared visuals through fuel-only setup. No duplicate rain/audio/sky system is created for fuel combat.
