# The Hall of Inventions and the test garden

The small turquoise archive gate stands west of Brann, at (-11, 0, 1).
Point at it and press trigger. It opens a separate, generous archive hall.
Current equipment remains on the existing named collection stands in the yard.
The hall is a version archive, with six record medallions displayed per page;
it does not pretend that every historical model is simultaneously instantiated.

The hall is at (-120, 0, 0). This is deliberate: placing the whole building
at the proposed (-9, 0, 7) covered existing collection stands and destination
portals. Moving it immediately west crossed the forge's giant scenery rocks.
The pocket hall avoids changing those established landmarks. Its return gate
lands at (-9, 0, 2), clear of the archive gate. Its frame stays south of the
existing apple tree at (-11, 0, 3).

## History and provenance

- Each record has an immutable id@version address. The append-only local
  address book is user://living_museum_homes.json; incoming service order does
  not rearrange existing homes. Diagnostic tests never write that file.
- **Story** selects the record and shows a short excerpt at its stand. The
  main archive console pages through the full request, interpretation, concrete
  manifest summary and parent invention IDs.
- **Retrieve** on a legacy model asks the existing collection system for that
  item. **Retrieve** on a package asks the live runtime to activate that exact
  version at its original world location. It does not silently spawn a region
  or device into the player's hand.
- Applied, staged, deferred, rejected and archived are distinct. Press feedback
  acknowledges input; it does not assert successful deployment.
- **Remove active experiment** requests version zero, preserving history.
  Dependencies can prevent removing a foundation while its dependants remain.
- **Ancestry lens** delegates pointed-entity inspection to the live runtime.
- Exact captured conversation text is shown when referenced transcript records
  are available. Historical design briefs are explicitly labelled reconstructed,
  not verified speech. Raw audio is not recorded automatically.

Only six exhibit records and four experiment buttons are present at once.
Full-size historical models are requested on demand. The service currently
bounds its history and package sizes separately; the UI does not imply infinite
storage merely because it can paginate beyond 100 entries.

## Working experiments

Select an experiment on the right-hand console. Required garden packages are
published first. Once the garden is applied, **Enter test garden** uses a
floor/capsule-checked transition into a 64 by 64 metre space at (120, 0, 0).
The existing closest eastern zone ends near X=67; the garden starts at X=88.
Point at the turquoise return gate to return to the forge.

| Experiment | What to try |
| --- | --- |
| The Open-Hand Test Garden | Grip the bronze reel on the table. Aim and trigger to attach, then hold trigger to reel. Empty-hand grip the stone towers to climb. Four broad landings culminate in a summit beacon and objective. |
| Fire, Water and New Growth | Trigger the ember stone to heat timber, use the cistern to wet it, then grip the pruning, repair or growth tools and point/trigger at package-owned objects. A visible irrigation link supplies a sprout. |
| The Copper Heart Engine | Trigger the copper heart: connected power lights the lamp and lifts a gate. Start the motor and watch water transfer between two reservoirs. |
| The Lantern and the Listener | Ring a bell for the investigating brass listener, approach the motion-sensing lantern, meet a following jade companion and a shy violet companion. |
| A Pocket of Moonlight | Grip and release loose little moons inside the low-gravity field. Toggle a local visibility veil; it affects experiment objects, not the whole headset image. |
| Tools That Make Tools | Record a hand-carried gesture and replay its visible path; select two objects with the joiner; paint the practice wall climbable. |
| The Glass-Eye Practice Yard | Point the practice lance at the body or golden weak spot and trigger. Precision damage differs; the repair switch resets the target. |
| Moonweaver Gloves | Apply a reversible hand colour, visual size, finger curl and movement profile through the runtime's supported embodiment interface. |
| Lantern Seed, versions 1 and 2 | Create a grabbable lamp, then request its companion version while holding the original. Confirm replacement defers; restore either recorded version through the archive. |

These demonstrate bounded, reusable interactions. They are not a general fluid
solver, arbitrary script injection, full structural engineering, or proof that
new engine primitives can be installed without restarting.

## Source and verification

scripts/build-living-demos.py deterministically generates:

- service/living-demo-packages.json — service catalogue source.
- godot/living_demo_packages.json — identical offline/native fallback.

Run the builder with Python; no Blender, network or paid model calls are involved.
The initial suite contains ten versioned packages, nine invention identities,
and 74 entity definitions, counting both Lantern Seed versions.

Native archive regression, from PowerShell:

    & '.\tools\godot\Godot_v4.7.2-stable_win64_console.exe' --headless --xr-mode off --path godot --script res://living_museum_checks.gd

Require LIVING_MUSEUM_RESULT [] and no script errors. It checks 137-version
pagination, stable legacy addresses when package history is inserted before it,
version-specific retrieval/removal, entry/exit, ancestry mode, sequential
first/second-version publication, and the six-exhibit bound.

For a real native render, omit headless, add --resolution 1600x1000, then append
-- --museum-capture=<absolute output PNG>. Add --museum-interior for the
interior angle. These captures are isolated fixtures and do not alter saves.
work/living-museum-interior.png was visually inspected. Separate component
and coordinator tests cover actual activation, mechanics, collision-safe travel
and held-version replacement.

## Lessons from implementation

- A helper called c(kind, **config) collided with component configs that also
  contain kind. Renamed its first parameter component_type; regenerate both
  JSON files together. Schema validation then accepted all ten packages.
- Test world coordinates against both existing portals/collection stands and
  decorative backdrop extents. Merely checking zone-centre separation is not
  enough for a building.
- A return destination must be in front of its gate collider, not at its centre.
- A large archive should expose its semantics clearly: a preserved record is
  not an already loaded full-size model, and activating a region version is
  different from putting a tool into a hand.
- The first integrated Vulkan/Mobile showcase exited inside native Windows
  code with heap corruption and no GDScript error. A Dummy-audio comparison
  completed in 19.46 seconds; an ordinary-audio recheck also completed in
  14.66 seconds. Audio is therefore not an established cause. Preserve the
  original logs rather than claiming the fault was fixed by muting audio.
  The component renderer subsequently bounded its active native light pool.
- Final ordinary-audio Vulkan capture after the light/label limits passed in
  19.61 seconds: nine active packages, 73 entities, component tick mean 0.312 ms,
  p95 0.342 ms, maximum 0.899 ms. All four renders were inspected. These are
  desktop fixture measurements, not a full VR headset frame-time guarantee.

