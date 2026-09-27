# World art and zone contract

Eight playable procedural 3D environments are built by godot/world_zones.gd;
godot/workshop_scene.gd preserves Brann, the forge rack and the existing scene API.
There are no downloaded textures or generated placeholder background images.
The palette and silhouettes follow the supplied Forge Yard, Sandstone Quarry,
Enchanted Kitchen, Pinewood Ruins, Mushroom Glade, Crystal Hollow, Sky Garden
and Ember Foundry references. The ruins include calm apple trees and hand-picked apples.

## Coordinates and navigation

Centers in meters (x, y, z):
- forge_yard: (0, 0, 0), tier 1
- sandstone_quarry: (52, 0, 0), tier 2
- enchanted_kitchen: (0, 0, 52), tier 1
- pinewood_ruins: (-52, 0, 0), tier 1
- mushroom_glade: (-52, 0, 52), tier 2
- crystal_hollow: (52, 0, 52), tier 3
- sky_garden: (-52, 0, -52), tier 3
- ember_foundry: (52, 0, -52), tier 4

Each scene.zones entry has name, center, spawn, tier, bounds (XZ Rect2),
root (decorative scene group), capture_position and capture_target (global meters).
Spawn defaults to center+(0,0,8), except forge at origin. Bounds are 30m square,
except sky 44m square. Sky main platform is y0, windmill y1.8, flower island y3.2.
Only actual solid landing surfaces have kind=floor collisions: there is no
invisible floor over the Crystal Hollow bridge gap or Sky Garden void.

Seven physical waystones in the Forge Yard connect all initial destinations.
Each zone has a return waystone. The accessible zone destinations themselves
are ungated; tools unlock their resources, barriers and traversal opportunities.
This supports imaginative alternate solutions and exploration before mastery.

## Gameplay metadata

Interactive objects are root-level Node3D nodes with global transforms. Every
object carries kind, stable id, zone, and base_position; collision children sit
under the metadata owner. Data arrays: resources, barriers, anchors, enemies,
portals. Decorative roots can be hidden independently; runtime must also hide
interactive owners by their zone metadata when culling inactive areas.

- Resource: group adventure_resource; resource and resource_id aliases;
  requires (axe, pick, or empty for hand gathering), amount, health and hp.
- Enemy: group adventure_enemy; kind=enemy; enemy_type skeleton/wisp/golem/boss;
  health/hp, damage, resource/drop, loot dictionary, alive.
- Barrier: group adventure_wall; requires=bomb or chop; health/hp.
- Anchor: group grapple_anchor; destination is the safe global landing point.
- Portal: group adventure_portal; target_zone and action=travel:<zoneid>.

Resource identifiers match the progression service: rat_tail, lumber, stone,
iron, apple, spore, crystal, haunted_bone, sky_bloom, ember_core. Tails remain
native kitchen rats. Skeletons drop haunted bones, the Cinder Warden drops
one ember core. Trees have separate nearby apple nodes so gathering fruit
does not require cutting down a beautiful tree.

The physical Possibilities board contains action=tool:<canonical id> for all
eight progression tools and action=upgrade. All are appended to scene.buttons.

## Rendering and verification

A shared primitive mesh/material cache and per-zone MultiMesh batches collapse
hundreds of flowers, rocks, planks and architecture pieces into a small number
of draw calls. Interactive nodes are excluded from batching. No costly image
or mesh-generation service is used at startup. Current scene-build probe counts:
8 zones, 26 resources, 6 enemies, 14 portals and 4 grapple anchors.

Fast isolated build check (no voice or network service):
  tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --path godot --script ../work/world_probe.gd

The probe constructs WorkshopScene once and prints counts, then quits. It runs
under half a second on the current machine. Headless editor registration also
passed. Native visual captures and gameplay verification are coordinated by the
main task; actual headset comfort and stereo performance require a VR playtest.
Measured art-task timings are in logs/world-build-timing.csv.

## Validated transform lesson

First native capture showed diagonal beams crossing the forge floor. Cause:
line() passed local endpoints to look_at_from_position(), which writes global
coordinates; ropes and skeleton limbs in translated zones moved into the forge.
Fixed line orientation with local Basis.looking_at().get_euler(), preserving the
local midpoint and scale. Use local rotations when assembling translated zone
decorations; never feed local points to global look-at methods. Scene build
remained valid before this visual fault, so render inspection is essential.

## Native visual polish

Native screenshots exposed washed-out horizons, foliage hiding its own apples,
an overly prominent foreground mushroom, and cave wall gaps. The bounded polish
adds per-zone environment metadata (ambient/sun/sky/fog), warm hearth lights,
closed cave walls and ceiling with colored crystal illumination, dusk Foundry
lighting, and distant mountains, clouds and floating Sky Garden islands.
Canopy apples now hang outside the foliage envelope, rock triangle normals are
flat per-face, and mushroom undersides sit below their caps. The Glade entry
view has a clear pond sightline. The runtime applies each environment profile
when travelling; roots remain compatible with inactive-region culling.
