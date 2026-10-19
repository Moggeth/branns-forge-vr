# Flockwright (the Armoury's crossbow)

Source: Mitch's `siegebird.zip` download (2026-10-18). `SOURCE-README.md` is its original README (it calls the
weapon "Siegebird"; in game it is the **Flockwright**, since the Siegebird crossbow already exists).

`build_flockwright_glb.py` is the supplied builder with three changes:
- the bird ellipsoids' triangle winding is flipped (the originals faced inward and rendered black);
- it writes `out/flockwright.glb`;
- textures are 1024² JPEG (quality 88) instead of 2048² PNG: 0.99 MB instead of 13.8 MB.

Rebuild: `python3 build_flockwright_glb.py`, then copy `out/flockwright.glb` to `public/assets/`.
Sockets: GripMain (pivot), Muzzle (tip), BoltRest, Sight. Clips: Idle, Fire, Reload (client/flockwright.js fits them
to the host's cycle in shared/combat.js FLOCKWRIGHT).
