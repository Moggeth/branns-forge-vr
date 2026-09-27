# Ember Gallery: fluids, fire and functional light

Launch `Play Ember Gallery Desktop.cmd` or `Play Ember Gallery VR.cmd` from the
project root after building. The same features are integrated into the normal game:
Toolbelt > Travel > Ember Gallery. Hearthlight also has a stand beside forge supplies.
The new source takes effect on next normal launch; no running game was stopped.

## Playable loop

The vaulted stillhouse has real colliders, shallow sloped copper gutters, three
catch basins, a clear central walkway and a shadowed side alcove. Its moody lighting
is local to this zone. Brighter / Moody gives an immediate visibility adjustment.

Oil and water cans are physical, finite containers. Grip/E takes or releases;
trigger opens/closes the valve. VR tilt controls flow; desktop pours while the
valve is open. The stream starts at the actual spout. Only accepted oil is debited.
Refill at the board. Bottles are separate real physics objects: take lit/unlit from
the board, then release grip/E to throw. Lit wicks expire after ten seconds.

Hearthlight has a copper cage, carved handle, flint striker, embers and spatial
crackle. Its trigger kindles/snuffs. It actually illuminates and casts shadows,
ignites oil and fresh wicks, and frightens ghosts without killing them merely by
light. It travels between zones, drops onto surfaces and can be retrieved. Multiple
stands summon the same single torch. Cans and fire supplies use owned interactions,
while hand finger curl and ordinary two-handed weapon interactions remain intact.

Fire travels through touching fuel, consumes it and can hurt the player. Water
quenches fire and wets the remaining oil; drying permits later ignition. Three
copper seals record a spreading fire trail, quenching fire and discovering the
alcove with a lit torch. There is no timer or quest/combat requirement.

## Scope and persistence

The native game now enables spreading fuel by default; the explicit legacy fire
check retains its old pool fixture. Up to 320 fuel units (40 bottles) occupy at
most eight 24m surface fields. Simulation is conservative and bounded, not a full
3D liquid solver: a cell has one supported height, and conflicting stacked spills
are rejected. A prefab prewarms its fixed region below the roof. Old first-impact
regions may re-anchor only once empty. Fuel is never moved merely to follow a player.

Spills persist between visits for this session; inactive regions pause. Loose
vessels freeze when hidden. Transient fluids and object positions reset on restart.
Seals persist in `user://ember_gallery.json` in the normal game. The standalone
snapshot uses ONLY `user://EmberGalleryDemo/progress.json` and its backups, not the
normal game or BellworksDemo namespace. Older snapshots without emberGallery remain
valid. The confirmed Demo reset clears this demo's seals and gallery spills.
Run only one instance per save namespace at once; exclusive-writer locks remain
outside this pass. Existing release ZIPs are unchanged.

## Technical boundaries

- `ember_gallery.gd`: owned vessels, stream, supply board, discovery and progress.
- `ember_gallery_art.gd`: eight batched scenery materials, colliders and anchors.
- `hearth_torch.gd`: one real 8m light, one shadow map, <=5% gentle light variation.
- `fuel_combat.gd`: active-region adapter, support validation, measured pour,
  prewarming, pending reservations, ignition/extinction and fire damage.
- `weather_lab.gd`: shared surface solver, batched liquid/flame meshes, reflective
  ripple and varied flame shaders, three eased shadowless fire lights.
- `fluid_audio.gd`: two pooled quiet pouring/hissing voices; no per-drop drum sounds.

Pour updates run at 10Hz; visual streams and lights update every frame. Fire light
selection favours visible nearby concentrations. Shadows belong to the torch;
the pooled fire lights are shadowless to keep a predictable budget.
See FLUID-FOUNDATION.md, HEARTHLIGHT.md and EMBER-GALLERY-ART.md for component APIs.

## Build, check and recover

`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Build-EmberGallery.ps1`
exports into `outputs/ember-gallery-build` and creates a new timestamped ZIP.
Use `-SkipArchive` during iteration. The launchers pass the safe offline flags;
bare executable startup is refused by the existing export feature guard.

`node scripts/check-ember.cjs` uses disposable temporary demo saves and real main
input/raycast/rigidbody routes. Add `--pack outputs/ember-gallery-build/EmberGallery.pck`
to verify the export. Add `--capture` for native GPU evidence and timing JSON.
Focused suites: fluid_foundation_checks.gd, fluid_audio_checks.gd,
hearth_torch_checks.gd and hearth_torch_integration_checks.gd (the integration
requires --playful-demo). Maintained activity and demo suites cover older progress.

Logs: `logs/ember-*.log`, `logs/hearth-torch*.log`, `logs/fluid*.log` and
`logs/work-timing.csv`. Close the game window to stop; relaunch via its CMD to
recover. No service restart, API key or paid generation is needed for this package.

## Evidence and limitations

`outputs/ember-gallery-export/` contains captures of the packaged game, including
identical-camera unlit/lit comparison, spreading fire and a physical pouring can.
`performance.json` reports actual RTX 3080 Ti measurements at 1280x800 and roughly
40 bottles (467 visible flame cells). Consumption is frozen for this GPU stress
sample so load does not dwindle during measurement; scripted scene processing is
also disabled. GPU render time therefore is NOT whole-game frame time or a stereo
VR guarantee. Independent CPU stress tests exercise the 10Hz fluid simulation.
Headset comfort, controller ergonomics and audio level still need human playtesting.
