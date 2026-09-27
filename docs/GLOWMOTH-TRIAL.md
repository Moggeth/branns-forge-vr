# Glowmoth asset trial

`godot/glowmoth.gd` builds the carried brass lantern and its separate released moth. The lantern grip band is local Y `0.02–0.23`; its dark handle runs continuously into the cage. The cage has upright joined rails, a vertical crown bail, translucent blue scalloped wings with gold edging and veins, and a hinged lid. Trigger deploys from the lantern socket and recalls to that socket. Scout movement uses a swept sphere and a shadowed 5.2 m omni light.

The builder batches fixed geometry by material while keeping each wing hinge and the lid animated. Expected rendered surfaces are 15 for the carried asset (five body materials, two lid materials, two per wing) and 12 for the scout (four body materials and two per wing). This is the material-surface draw count; the mesh-instance counts are six and five.

## Verification

- Godot 4.7.2 `--check-only --script res://glowmoth.gd` passed in 0.22 seconds after the final visual edit.
- The Vulkan atelier capture completed all three views in 2.63 seconds. Reviewed images: `outputs/atelier-review/glowmoth-final/glowmoth-0.png`, `-1.png`, and `-2.png`. The final capture shows the complete crown bail, joined straight cage rails, colored wings with visible gold details, and the full handle.
- An earlier headless runtime probe exercised socket deployment, wall clearance, lid opening, recall and lid closure in 1.55 seconds. That probe preceded the final visual-only assembly offset and material changes; parent integration checks cover the current package.

There is no confirmed headset comfort or lighting test in this asset trial.
