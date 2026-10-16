# Kingsfell (the axe)

The Hero's axe since 2026-10-16, replacing Orchard's Edge. A bearded war axe: ring-patterned steel that grows out
from an amber heartstone, gold sap veins from the heart to the edge, a dark ironash haft with gold bands and a
leather grip. Visual fidelity: L2 in game, reviewed toward L3.

Its story, carried by the detail: dwarven smiths forged it from the heart of a fallen king-oak. The rings in the steel
are that tree's growth rings, an oak leaf is still sealed in the heartstone, a crown on the socket and the maker's
crowned-tree stamp on the poll mark it as royal work, a gold interlace of vines wraps the socket, tally marks of felled
giants are inlaid on the haft, and the acorn the tree grew from hangs from the pommel in amber.

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
- Every textured material has albedo, metal/rough and normal maps (numpy relief). Ambient occlusion is baked in Cycles
  into the vertex colours (COLOR_0) and multiplied into base colour (`--no-ao` skips the bake for quick iterations).
  Textures are PNG source art; the delivery build converts them losslessly (never lossy: AGENTS.md). To keep that
  small, data maps are authored at 6 bits and colour at 7, the edge map is flat outside the bevel band and the haft
  relief is half resolution.
- Blender gotcha: set a data image's colorspace to Non-Color *before* writing its pixels, or they come out blank.
- The heartstone's depth (ember, trapped leaf, sap specks) is a parallax effect in the runtime shader, not geometry.
- Budget: about 8.4k triangles, 5.5 MB source GLB, about 2.7 MB delivered. Glow is emissive only (no lights); the readiness adds one ribbon draw.

Checks: `node tests/kingsfell-luminance.mjs`; the in-game Timberfall lab is `tests/timberfall-lab.html`.
