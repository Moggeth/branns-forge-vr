# Hearthlight: a portable pool of warm light

Hearthlight is a single reusable carved-wood torch with a copper cage, leather
binding and a little leaf crest. Grip the torch or any Hearthlight stand to carry
it. The holding hand's trigger works its flint striker: kindle or snuff. Release
grip to put it down physically; it collides with tables and floors but uses loose
item collision layer 8 so it does not immobilise the player. Retrieve it by grip.
On desktop, aim and use the normal grab/trigger/drop controls.

The lit tip ignites nearby surface fuel through `fuel_combat.ignite_near` and
lights fresh matches or vial wicks after 0.3 seconds of gentle contact. Both the
torch and wick must move slower than 0.8 m/s. It can light several preparations
without a match timer. Water interaction is owned by the fluid gallery system.

## Integration and limits

`godot/hearth_torch.gd` is a Node with `setup(game)`, `tick(delta)`,
`try_grab(hand, desktop=false)`, `busy(hand)`, `trigger(hand)`, `release(hand)` and
`home()`. Route its owned inputs before generic tools and bomb formation. It
reserves `game.held[hand instance ID]` with metadata `kind=hearth_torch`.
Tracking loss should call `home()` through the normal hand cleanup path.

`create_stand(parent, local_position)` creates another retrieval station for the
same torch; the position is grip height, not ground height. No station can steal
a held torch or duplicate it. An empty hand can retrieve an unheld torch from
any visible station, including one previously left on the ground. It remains lit
when carried between zones. An offworld torch or one more than 100 metres from
the player returns to a visible station. The torch's current dropped pose and
lit state are session state; the restart default is lit at the forge stand.

`tip_position()`, `lit`, `light`, and `status()` support integration diagnostics
and fire/ghost fear systems. `set_shadows(false)` disables its one shadow light
when profiling needs a cheaper tier. No other system should create a second
torch light. Light range is 8 metres; energy varies at most ±5%, with smooth
slow waves. Flame meshes are emissive, but the OmniLight3D provides the actual
illumination and environmental shadows. Torch meshes themselves do not cast
shadows, preventing its metal cage from strobing across the room. Beyond 14m
shadow fading begins; hidden-zone lights, audio and loose-body simulation stop.

Crackle and striker audio are deterministic generated PCM WAVs. The low-volume
three-second crackle loop is spatial, with restrained random pops and a softened
loop seam. Smoke/test fixtures remain silent; playable offline demos have audio. Geometry has three flame
layers and eight reused ember meshes; no growing particle or sound-player pool.

## Verification

Run from the project root:

```powershell
& tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --path godot --xr-mode off --audio-driver Dummy --script res://hearth_torch_checks.gd --quit-after 4000
```

Require `HEARTH_TORCH_CHECK` JSON with `ok:true`, an empty `failures` list, and no
engine errors. The 27 checks include real RigidBody3D tabletop landing, ownership,
trigger toggling, gentle wick ignition, shared fuel ignition, ±5% flicker bound,
shadow budget override, dropped re-grabbing, cross-zone carry and hidden-light
suppression. These are offline engine checks; they do not verify headset grip
feel, perceived brightness or VR performance. Full scene captures and exported
build/GPU performance belong to the integration walkthrough.

The real main-scene routing test is `hearth_torch_integration_checks.gd`, with
the same command plus `-- --playful-demo`. Its 14 checks include E pickup/drop,
trigger snuff/relight, real aim-ray retrieval, managed-prop exclusions and existing
generic two-handed weapon handling. Require `HEARTH_TORCH_INTEGRATION` with
`ok:true` and no errors. The flag is mandatory: the fixture refuses to start
without it so ordinary save writers and network services remain disabled.

Integration lesson: occupying `game.held` is not sufficient ownership isolation.
`grip_runtime.tick()` historically enrolled every held prop, disabled its pickup
shape, and enabled weapon adjustments/two-handed grabs. The managed kinds
`hearth_torch`, `ember_vessel`, and `fire_supply` now retain their owning module's
attachment/drop policy while still receiving visual finger curl. Torch pickup
collision is explicitly disabled while held and re-enabled on drop/home; do not
depend on the generic weapon drop path to restore it.

GPU review caught an authored-scale regression: `WorldZones.cyl` uses a unit
primitive and scales the MeshInstance3D to its physical dimensions. Replacing an
ember's scale with `Vector3.ONE * decay` turned a 6mm ember into a metre-wide cone.
Animated mesh effects now multiply saved `authored_scale` by decay. The focused
fixture samples 600 frames and bounds actual world ember size below 15mm and
flame size below 20cm. Animate unit scale only on purpose-built Node3D parents,
not on dimensioned primitive meshes.
