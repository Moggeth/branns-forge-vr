# Siegebird II — reproducible articulated game asset

**Superseded artwork:** the current installed model is [Opus's Kingfisher commission](SIEGEBIRD-OPUS.md). The runtime contract and gameplay described here remain relevant; the shell-based builder and old clearance counts below are historical.

## Use in VR
The existing Siegebird item ID, collection home, inventory and installed modules are retained. The game loads the new bundled GLB for that ID; the original service asset remains unchanged. Close and relaunch the game to refresh an already imported copy. No live game process was running at the end of this build.

Hold with one or two hands as before. Trigger fires only a cocked, loaded bolt. After firing, grip the brass crank with your free hand and turn forward twice. Ratchet clicks and haptics follow progress; the final ready pulse signals cocking. Release the crank, take a belt bolt, orient its point forwards on the rail and release to seat. The shaft must be within roughly 32 degrees of the forward axis; backwards bolts are rejected. Loading and firing are interlocked against an occupied crank. Quickwind uses its existing magical one-turn assistance without expanding the drum into adjacent geometry.

## Asset and build ownership
- scripts/build_siegebird.py: Blender Python builder; imports retained original shell and authors named moving parts, materials and flex shapes.
- assets/siegebird/original.glb: immutable original shell/reference.
- assets/siegebird/Siegebird.blend: editable generated assembly.
- godot/assets/siegebird/assembly.json: core dimensions and timing contract.
- godot/assets/siegebird/siegebird.glb: bundled playable model.
- godot/siegebird_runtime.gd: native controls, clutch/gear/cord/flex motion and projectile integration.
- godot/siegebird_checks.gd: interactive regression checks.
- godot/siegebird_showcase.gd: offline production wind/load/fire movie harness.

Run from the project root:

    & '.\scripts\Build-Siegebird.ps1'

Local Blender 4.5.13 LTS resides in tools/blender-4.5.13-windows-x64. It was downloaded from https://download.blender.org/release/Blender4.5/ and verified against the vendor SHA256 file. No system-wide Blender install, external AI account, paid model call or MCP server is required. Future machines need that vendor build or an explicitly tested replacement path.

Game item-local coordinates are X across, Y forward, Z top; Blender coordinates are (X,-Z,Y). Moving roots retain their pivots; fixed mesh transforms are baked into vertices. GLB shape keys Drawn and Narrow keep limbs, laminations, braces and tip fittings together. Inward flex is derived from the bowstring chord so its displayed length remains constant throughout draw. Runtime ropes reuse authored meshes rather than allocating a new mesh every frame.

The outer crank and independently counter-rotated knob drive the visible transmission during winding. On firing, an animated clutch separates the handle from the returning gears/drum. A separate latch and trigger move. This is a stylized virtual mechanism, not an engineering or manufacturing simulation.

## Verification and limits
The Blender builder samples 129 draw positions. It tests gear teeth against one another, and crank/sled/clutch/bolt/animated cord meshes against the fixed shell, rails, optic and flexed limbs. Contact between string and outer tip ferrules is specifically permitted by face location. Carriage/rail contact is permitted. Unexpected intersections reject export and preserve the prior GLB.

The current report has zero unexpected intersections and 258 intended tip contacts. This is triangle-surface testing for selected pairs, not proof against containment, coplanar overlap, every pair or every continuous intermediate state. It does not constrain the user's physically tracked hands. VR hand reach/comfort still needs the player's playtest.

Native tests cover trigger/dry fire, stale-crank interlock, loaded-crank lock, constant cord length, stationary crank during firing, direction-sensitive manual seating, physical two-turn winding across angle wrap, two-hand aim, Quickwind, optics, projectile gravity, embedding and persistence. The full project verifier passed in 37.4204249 seconds before the final limb-length refinement; the native regression suite passed again after that refinement.

Latest captures: outputs/Siegebird-Rebuilt. Movie: Siegebird-Cycle.mp4 (7 seconds, production wind/load/fire calls, silent). Mesh report: assembly-review.json. Capture draw calls were 114–120 across the isolated views, versus roughly 79–85 for the earlier simpler assembly; desktop FPS was capped around 120. These are not headset performance measurements. No claim of zero performance cost.

## Lessons from this rebuild
1. Named pivots and an editable source assembly are safer than adding runtime parts to opaque numbered meshes.
2. A visual review caught floating string anchors that a mesh-only check could not. The next sweep included cords and explicit attachment contacts.
3. Visible flex must conserve the string's length. Bending only backwards stretched it; coordinated inward flex resolved that and now has a runtime regression test.
4. Quickwind's previous drum scaling could destroy clearances. Magical speed assistance now keeps geometry stable.
5. The old bolt test used abs(dot), which allowed reversed bolts. Forward-only seating is tested explicitly.
6. The standalone crossbow test also invokes workshop checks. It needs the workshop fixture and an unlocked tier; otherwise it can report unrelated fixture errors. Godot may exit zero after script errors, so the launcher checks both logs and the final result marker.
7. Blender's mathutils Vector.length is a property, unlike Godot length(). Use --python-exit-code 2, because Blender can otherwise exit successfully after a Python exception.
8. Python urllib failed vendor HTTPS certificate validation on this machine. Windows Invoke-WebRequest succeeded with normal validation intact; do not disable TLS checks. Keep the verified archive/hash for reproducibility.

For the current finite-ammunition, attached-hand, standard optic, grapple reel and live Brann tuning controls, see [the 2026-09-17 field suite](SIEGEBIRD-FIELD-SUITE.md). This supersedes the original infinite belt-bolt instructions above.
