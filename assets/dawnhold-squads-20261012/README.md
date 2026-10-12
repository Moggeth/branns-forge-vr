# Dawnhold squads (2026-10-12)

Six RTS units for Dawnhold, modelled from scratch on a shared **Forgeling Mk II** body. Concept and review stage: nothing here is wired into the game yet.

```
pip install bpy                                   # Blender as a Python module (built and tested with bpy 5.2)
python3 build_squads.py --unit all                # out/<unit>.glb + out/sunlance_cart.glb + reports
python3 build_squads.py --unit all --render       # plus Cycles turnarounds in renders/
python3 compose_sheets.py                         # review sheets in sheets/
```

- `squad_body.py`: the shared body (head with mood eyelids, barrel torso with the sun medallion, arms, legs, tabard) and materials.
- `build_squads.py`: each unit's kit, proportions and expression, the Sunlance Cart (static parts: Cart_Frame, Wheel_L, Wheel_R, Ballista, Bolt), export.
- `render_squads.py`: review poses and cameras. `compose_sheets.py`: sheet layout.

The rig is the skeleton warband's 18 joints (same names), so `client/forgeling-look.js`-style loading and the procedural motion carry over.
Units are about 24-29k triangles each. A crowd LOD (about 5k) is still to do before RTS use on phones and Quest.
Character sheets: /mnt/project-files/rts-units/character-sheets.md (project files).
