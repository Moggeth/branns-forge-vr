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

**Current baseline limitation:** `WorldZones.portal()` adds a central
`StaticBody3D` of size 1.6 × 2.0 × 0.7 m. It fully blocks walking through the
arch. The headless check reports this as `legacy_blocked_apertures`; it cannot
claim current portals are walkable. A playable walk-through portal needs a
production change that moves/replaces that collider while retaining a reachable
interaction target and verifies the result with a player-sized physics sweep.
This contract and optional art check do not modify that gameplay behavior.

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
