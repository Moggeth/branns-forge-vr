# Experimental native fuel combat

The shared surface-fuel simulation is active in ordinary VR and desktop play. The older `-ExperimentalFuelCombat` launcher flag remains accepted, but is not needed for normal play. Some offline diagnostic modes still use the legacy four-pool fire path. The launcher does not replace an already-running game; close and relaunch to pick up code changes.

At Emberdew common goods, throw an unlit vial to lay fuel, or light a wick and throw to ignite it. Touching puddles conduct fire; all burning fuel is consumed. Ghosts still take only fire damage. Standing in fire hurts the player, with a cooldown. A player-held or fairy-carried match, the hearth torch, Wyrmspout flame, Sunfall, Ember Gauntlet, a burning prop or a hot Siegebird bolt can ignite fuel through shared local heat contact. This also works while the field is still scanning after the first impact. See [the fire implementation notes](FIRE-UNIFICATION-AUDIT.md).

The Ember Gallery's right copper basin holds dry timber, damp timber and oilcloth for visible combinations. Dry wood catches; damp wood steams until its wetness subsides; oilcloth catches quickly. Water poured from a gallery vessel quenches and wets those samples as well as spilled fuel. A burning sample can light a nearby spill. The field's liquid display now connects neighboring cells with a subtle moving oil sheen, rather than drawing isolated circular discs.

## Bounds and persistence

- 40 bottles of remaining fuel across all regions, including pending impacts. Capacity returns as fuel burns or evaporates; existing fuel is not evicted for new bottles.
- One fixed 24m, 64x64 surface patch per region, up to eight regions. First impact positions the patch. Leaving pauses that region; returning restores its puddles in place. Nothing is saved across game restarts.
- A patch can relocate only once empty. Out-of-patch, unsupported-surface and full-capacity impacts show a notice; bottles still shatter. This is a prototype boundary, not an unlimited world simulation.
- Physics surface discovery runs 128 cells per game tick, usually 32 ticks after the first impact. Pending spills reserve capacity. Floor sampling starts just above the first impact, allowing cave floors below ceilings.
- Single surface layer: no stacked floors, vertical wall coating, dynamically moving surfaces or robust thin-wall separation. Large height changes block contact ignition; liquid can flow downhill. Empty/no-hit cells block flow. Surface collision authoring controls where spills can settle.
- The active patch simulates at 10Hz, with a bounded 0.2s catch-up step. Rendering uses two shared MultiMeshes and at most three pooled non-shadowed lights. All fuel cells remain physical; dense scenes sample no more than 640 visible flame meshes. Empty patches skip simulation. Inactive patches do not simulate or render.
- Weather wetness transfers only where the active weather grid samples the same surface. Sheltered/remote surfaces are not treated as globally rained on. Soaked fuel extinguishes. This is not whole-world rainfall simulation.

## Verification and diagnostics

Run `scripts/check-fuel-combat.ps1`. It runs offline, uses diagnostic state, does not write player saves or call paid services, and checks success markers AND script errors. Logs are `logs/fuel-combat-check.log`, `logs/fire-check.log`, `logs/weather-game-check.log`, and `logs/weather-verification.log`. Measured timings append to `logs/work-timing.csv`.

Checks exercise the real vial impact handler, capacity reservation, 40 impacts and rejection of a 41st, unlit persistence, match ignition both during the pending scan and after the spill is visible, contact ignition reaching a remote ghost, non-fire immunity, fire death, player damage cooldown, complete fuel consumption, rain-soaked extinction, zone return, cave floor support, dry/damp/oilcloth behavior, local water quenching and a real falling RigidBody contact. The existing fire, weather, fairy, torch, Wyrmspout, Siegebird and Living Workshop checks also run separately.

Still requires headset validation: first-impact scan latency, frame times with many patches, throw/impact placement on authored scenery, flame depth/stereo readability, fire-light appearance, and player foot-height damage feel (currently camera height minus 1.5m). Weather Lab graphical captures measured 1, 10 and 40 bottles on desktop, but no VR performance claim follows from those tests.

## Reversible checkpoint

Historical pre-change files are in `backups/fuel-combat-20260921-005800/`. The project now has Git history; use current Git commits for rollback analysis instead of restoring that old snapshot directly over later game changes.

Implementation entry points: `heat_contacts.gd` owns cross-source heat and water contacts, `fuel_combat.gd` owns combat/world bounds, and `weather_lab.gd` provides the conservative field and shared visuals through fuel-only setup. No duplicate rain/audio/sky system is created for fuel combat.
