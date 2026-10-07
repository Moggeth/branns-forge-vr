# Keep ballistas (Sunlance and Gnashjaw)

The gate ballistas of Dawnhold (Sunlance) and Grumblekeep (Gnashjaw). Visual fidelity level 2.

- `build_keep_ballistas.py` builds both machines in Blender (bpy 4.5 or 5.x) and writes
  `keep_ballistas.glb`, `keep_ballistas.blend` and `build_report.json` (node list, triangle counts).
  Run: `python3 build_keep_ballistas.py --out /tmp/kb`, then copy `keep_ballistas.glb` to
  `multiplayer/public/assets/`.
- `render_keep_ballistas.py GLB OUT [samples]` makes Cycles review renders from the shipped GLB.

Conventions:

- Blender +Y is forward and Z is up (the exporter turns that into -Z forward, Y up).
- Vertex colours are written as linear floats (`hexc()` converts from sRGB). Writing sRGB bytes washes
  everything out in the game.
- Node names are the contract with `client/keep-ballista-art.js`: `S_`/`G_` + Root, Base, Turret,
  Cradle, Nock, Muzzle, the two limbs and their `_Tip` empties, the bolt (`S_Bolt`, `G_Harpoon`, origin
  at the nock pointing +Y), the crank (`S_Crank`, `G_Drum`) and `G_Jaw`.
- The muzzle and trunnion heights must match `KEEP_BALLISTA.*.trunnion/ahead/above` in
  `shared/home-ballista.js`, so shots leave from the barrel you see.
- Budget: about 6k to 7k triangles per machine; glow materials are emissive only (no extra lights).

Review lab: `multiplayer/tests/keep-ballista-lab.html` (open through the dev server).
