# Portal art integration contract

`world_zones.gd` owns travel identity and interaction. A portal is a root-level
`Node3D` in `data.portals` and group `adventure_portal`, with metadata `kind=portal`,
`zone=<source id>`, `target_zone=<destination id>`, `action=travel:<destination id>`,
and `base_position=<world position>`. Interaction rays hit a descendant collider;
`main.gd::_owner()` walks upward to this metadata owner, and the action calls
`AdventureRuntime.travel()`. Travel moves the player to the destination's zone
spawn, not through the arch in continuous world space. Keep the metadata owner,
action, and ray target when replacing its visual kit.

The Forge Yard has seven gates, left to right at x = -10.5, -7, -3.5, 0, 3.5,
7, 10.5 and z = 10.8: Pinewood Ruins, Sandstone Quarry, Enchanted Kitchen,
Mushroom Glade, Crystal Hollow, Sky Garden, Ember Foundry. Each has a return
gate. Four branch pairs connect Pinewood/Orchard Highlands,
Mushroom/Gloamfen, Crystal/Starfall Ridge, and Sky/Cloudbreak Keep. These are
the twelve `world_zones.gd` destinations; preserve canonical IDs and the
seven-gate order. Other systems may add destinations after this base build.

The portal node uses Godot metres. Its local origin is ground center and local
`+Z` faces the approach (`look_at(..., true)`): Forge Yard gates face `(0, y, -4)`; other gates face
their zone center. Author frame/interior art under that node at identity
position, rotation and scale. The visual aperture clearance is x ±0.4 m,
y 0.35–2.0 m, z ±0.3 m. Opaque frame meshes stay outside it. A visual interior
may occupy it only when translucent and tagged
`portal_translucent_interior=true` on its `MeshInstance3D`; it must have no
collision. The entire authored visual subtree has no collision objects or
shapes. An independent interaction surface must remain ray targetable and
parented under the portal metadata owner; a ray hit must still resolve through
`_owner()` to the travel action. Do not let decorative art catch rays or block
the player's path.

`WorldZones.portal()` now adds a thin, central `Area3D` named
`PortalInteraction` instead of the old solid body. It is ray targetable and
inherits the portal's travel action through `_owner()`, but does not block the
player. The check sweeps a standing capsule at three depths through all 22
gateways and aims a ray at each interaction area. Trees and dressing rocks
previously blocked several approaches; their deterministic placements now
leave intentional gaps around those portals. Decorative authored frames must
remain collider free and keep the same aperture clearance.

Run the source contract check from the repository root:

```powershell
tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --quit-after 1200 --script res://portal_visual_checks.gd
```

To check an authored `PackedScene` whose root is `Node3D`, add
`-- --visual-scene=res://path/to/portal_kit.tscn`. The check instantiates it
under each Forge Yard gate and rejects collision, opaque aperture intrusion,
and a nonidentity root transform. This structural test does not prove headset
legibility, correct destination imagery, ray reachability after the collider
migration, or physical comfort. Review rendered gate captures and test actual
travel plus walk-through in the playable scene before accepting an integration.

Verification lesson: the first facing assertion used local `-Z` and failed for
all 22 gates. The existing `look_at(..., true)` call deliberately uses local
`+Z`; assert that axis when checking portal facing or placing one-sided art.
The first walk-through attempt found the old solid centre, then seven nearby
obstructions: two Pinewood tree trunks, an Orchard tree trunk, two Mushroom
ring boulders, one Forge Yard backdrop rock, and one Pinewood ground-kit rock.
The capsule and ray checks expose these placements before art is accepted.
