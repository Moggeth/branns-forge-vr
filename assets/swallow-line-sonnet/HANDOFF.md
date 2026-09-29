# Swallow Line handoff
Rebuild: `blender.exe -b -P build_swallow_line.py` (from this folder; writes GLB, blend, stats, renders/).

- Godot-space size: 0.487 W x 0.742 H x 0.171 D (Y -0.099..+0.072 fwd/back in -Z terms). Grip origin (0,0,0), wood grip Y 0.10-0.305, leather wraps 0.115-0.165 and 0.235-0.285.
- Talon tips: side at (+-0.24, 0.741, 0), front at (0, 0.735, -0.097). Height is 0.74, just under the 0.75-0.9 target; scale ~1.05 if wanted.
- `HookTip` empty at (0, 0.70, -0.05), near the claw cluster centre (below the front tip).
- `SpoolPivot` empty at (0, 0.38, 0); spin about local +X. Children: Spool_steel (spindle + drum), Spool_brass (two flanges + hubs, r 0.072), Spool_rope (7-turn braided helix wound on the drum). Everything else is outside the pivot.
- Axle: spindle runs through side plates (x +-0.068) with brass bolt caps; plates -> socket/bridge -> grip, so the shaft connects spool to body.
- Rope path: wound cord on drum (spins), fixed `Rope_lead` leaves the drum front-top at (0,0.066,0.40) Blender-> Godot (0,0.40,-0.066), rises to a brass eyelet on the head at Godot (0,0.585,-0.05). Gameplay tether should start near the eyelet/HookTip. Lead does not spin; cord wound texture is visibly braided so spin reads.
- Budget: 3568 tris, 8 mesh nodes/draw items (5 rigid + 3 in pivot), 5 materials (Brass, DarkSteel, Rope, Leather, Wood), embedded 256px textures, opaque, no lights/cameras/collision, no vertex colours.
- Limits: procedural textures (not hand painted); talons are dark steel tapered tubes without brass claw sleeves; wing engravings are texture-only chevrons; drum wound cord is a simple helix (no groove geometry); the fixed lead ends at the drum tangent, so at some spin angles it visibly departs from the wound cord. Not tested in Godot.
