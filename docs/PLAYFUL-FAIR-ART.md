# Bellworks garden fair art

`godot/playful_fair_art.gd` dresses the existing court without taking ownership of
gameplay. Add the node, call `setup(game)` after `playful_encounters.setup(game)`,
then call `tick(delta)` after the encounter's tick so the gold trolley follows the
current moving target. Setup is idempotent and safely skips a missing encounter.

The art adds a compact grass and stone island, faceted garden backdrop, four trees,
six planted urns, perimeter bunting, warm timber/brass trim, three ordinary bell
ropes and a fourth rope on a moving gold-bell trolley. The central throwing volume
stays open. New scenery has no collisions, light sources, or shadow casters. Existing
gameplay floor and fencing remain authoritative. Geometry beyond the fence is a
visual backdrop, not a new traversable area.

Static art reuses the project's `WorldZones` primitives and `WorkshopArt.bake`:
248 source pieces become 15 material batches. With four suspension assemblies and
the trolley, the entire addition renders in 25 meshes. There are no per-frame mesh
allocations. Suspensions mirror their bell's visibility and hide when a bell is
freed; the art inherits court visibility. The backdrop stays within 15 meters
horizontally and 17 meters lengthwise of the existing court origin.

## Discovery labels

The first coordinated screenshots showed duplicate Sunskipper titles: two permanent
labels at the forge stand plus the feedback system's contextual label. When the
`sunskipper` hint exists, the integration should hide the forge stand's two direct
Label3D children (permanent title and permanent controls). Keep the court stand's
label unless a separate contextual court hint is registered. Do not hide the held
ring's mode label or the trial board's progress. Feedback labels now wrap at 680
pixels, keeping longer instructions within a 1.7 meter wide text area.

## Checks and visual boundary

Use the portable engine with `--headless --audio-driver Dummy --xr-mode off
--path godot --script res://playful_fair_art_checks.gd --log-file <absolute-path>`.
The standalone fake encounter performs no service calls or player-save writes.
It checks the actual node tree for zero lights/collisions/shadow casters, a thirty
mesh maximum, material batching, bounded geometry, repeated setup, 600 moving-bell
updates without growth, and hiding/freed-bell behavior.

First result: `PLAYFUL_FAIR_ART_RESULT []`, 0.313 seconds. The design followed visual
inspection of the initial forge-discovery, Bellworks-court and Sunskipper captures.
Final appearance is reserved for the coordinator's actual rendering pass; the
headless test does not certify visual quality or headset comfort. Timings are in
`logs/playful-feedback-timing.csv`.
