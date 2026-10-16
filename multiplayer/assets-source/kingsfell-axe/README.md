# Kingsfell (the axe)

The Hero's axe since 2026-10-16, replacing Orchard's Edge. A bearded war axe: ring-patterned steel that grows out
from an amber heartstone, gold sap veins from the heart to the edge, a dark ironash haft with gold bands and a
leather grip. Visual fidelity: L2 in game, reviewed toward L3.

- `build_kingsfell.py` builds it procedurally in Blender (bpy 5.x as a Python module, plus numpy and Pillow) and
  writes the GLB, `out/build_report.json` and optional Cycles review renders. Run from this folder:
  `python3.11 build_kingsfell.py -- --out ../../public/assets/axe.glb --render /tmp/kf --samples 48 --views full,head,three-quarter,heart,edge-on,back,first-person`.
  After rebuilding, update `axe.glb`'s bytes and sha256 in `public/assets/manifest.json`.

Conventions:

- Blender X is the edge direction, Z runs up the haft, Y is the blade's thickness (glTF: +X forward, +Y up).
  `client/asset-pose.js` holds it by the `Grip_Center` empty.
- Node and material names are the contract with `client/kingsfell-luminance.js`: `KF_Steel_Edge` (honed edge),
  `KF_Steel_Ring` (cheeks), `KF_Vein` (veins; uv.x runs 0 at the heart to 1 at the edge), `KF_Amber`
  (heartstone), and the `CuttingEdge_Top/Mid/Bottom` and `Heartstone` empties used to fit the edge arc.
- Budget: about 5.3k triangles, 1.9 MB. Glow is emissive only (no lights); the readiness adds one ribbon draw.

Checks: `node tests/kingsfell-luminance.mjs`; the in-game Timberfall lab is `tests/timberfall-lab.html`.
