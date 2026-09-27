# Orchard brook footbridge: handoff

## Files
| File | Purpose |
|---|---|
| `build_bridge.py` | Deterministic build using a fixed RNG seed of 20260928. It saves `bridge.blend`, exports `bridge.glb`, writes `asset.json` and renders the review PNGs. Add `-- --no-render` to skip the renders. |
| `bridge.blend` | Editable scene. Visual meshes are in the `bridge_visual` collection and collision proxies in `bridge_collision`, all parented to the empty `orchard_brook_bridge`. |
| `bridge.glb` | Standalone export with 7 visual meshes and 3 collision boxes. |
| `asset.json` | Dimensions for the walkway, parapet, span and collision boxes (glTF axes), plus build stats. |
| `verify_glb.py` / `verify_reimport.json` | Reimports the GLB in a clean `--factory-startup` Blender process and records the results. |
| `review_front/side/top/three_quarter/back_underside.png` | Eevee review renders. The underside view is taken from below the opposite corner, with the ground hidden. |

Command: `blender.exe --background --factory-startup --python build_bridge.py`

## Conventions
- Units are metres. In glTF, +Y is up and the long axis is Z. The bridge is mirror-symmetric, so the Blender −Y→glTF +Z flip doesn't matter.
- The origin is at the centre of the walking deck. The plank tops are at Y=0, with a random dip of 0 to −6 mm per plank.
- Collision uses Godot's `-colonly` nodes:
  - `col_walkway-colonly`: X ±1.7, Z ±2.95, Y −0.2..0. It covers the deck plus the stone landings.
  - `col_parapet_L/R-colonly`: |X| from 1.7 to 2.31, Y −0.2..1.23. These cover the walls, posts and caps.
- The walkway is 3.4 m of clear width. Every inner stone face sits at exactly |X| = 1.70, and the copings and post caps overhang outward only. The build and the reimport both check for visual vertices with |x| < 1.7 above the deck, and both found **none**.

## Measured (Windows 11, Blender 4.5.13)
| Step | Time |
|---|---|
| Geometry build (in-script) | 0.088 s |
| GLB export | 0.105 s |
| 5 Eevee renders at 1100×850 | 1.53 s |
| Full process wall time (build, export, renders) | **2.14 s** |
| No-render rebuild | 0.56 s |
| Clean reimport verification | 0.53 s |

Determinism: two consecutive builds produced byte-identical GLBs (the SHA-256 hashes matched).

Reimport results (`verify_reimport.json`):
- 10 meshes: 7 visual and 3 collision.
- **9,832 visual triangles**. Stone accounts for 6,864, moss 600, wood 1,144 and nail heads 1,224.
- Visual size is 4.62 W × 5.88 L × 2.90 H m, from the footing at −1.62 to the post-cap moss at +1.28.
- No walkway intrusions.

## Reference-to-3D decisions
- **Top view (primary reference).** Planks run across the width in one run with 17 boards, stone parapets sit on both sides, and square posts stand at all four corners. Deck length is 5.0 m and clear width 3.4 m, exactly as stated.
- **Materials.** Chamfered, pale warm-grey coursed stone in two tones, warm brown planks, a darker timber band and moss clumps on caps, copings and faces. These match the sheet's identity. The look comes from flat colour and geometry only, with no textures or UVs.
- **Silhouette.** The parapet is 0.90 m high, slightly taller than the post-to-wall step on the sheet, which is a comfortable VR railing height. Posts rise to 1.05 m and have 1.23 m capstones that project past the wall line, as on the sheet. The wooden stripe on the side view became a **timber sill beam** (Y −0.2..0) running along the top of each side wall.
- **Underside (my interpretation).** The side view shows a low arch, while the three-quarter view hides the underside. I made the side walls real **segmental stone arch rings** (13 voussoirs, 4.6 m clear span, springing at −1.15, soffit crown at −0.62) with spandrel masonry that follows the extrados up to the sill. The deck between the walls doesn't hang on the arch. It sits on **5 timber stringers** (0.22 × 0.32 m) with 2 cross braces, and the stringers bear on full-width stone **abutments** that are buried in the banks from |Z| 2.3 to 2.95.
  - This keeps the deck flat and walkable, and it avoids a humped stone barrel that the flat top view contradicts.
  - It also gives an honest load path: arch walls carry the parapets, and stringers carry the walkway.
- **Span.** The clear span between abutment faces is 4.6 m, so the bridge covers a 3–5 m brook as an open crossing, not a ford. There is 1.2 m under the timber soffit above the footing level.
- **Posts** run full height from the footing (a plinth course at −1.6) up to the cap, which reads as the end piers in the side view.

## Defects found and corrections
1. **Wall moss looked like spiky shards.** Every moss blob was being randomly rotated about Z, which swung the thin axis away from the wall. Flat patches now spin, but wall patches keep their thin axis on X.
2. **Coping moss intruded into the walkway.** The intrusion check reported 3 vertices at |x| < 1.7. Coping patches are now circular and centred 0.21 m outside the inner face, and the check now reports none.
3. **Stringer ends showed past the posts in the side view.** They were 5.5 m long and now stop at the deck ends (±2.5).
4. **A gap showed between the arch crown and the timber sill.** The ring depth went from 0.34 to 0.40 m so the extrados meets the sill.
5. **The first pass looked washed out.** I darkened the stone and moss, raised the sun energy and lowered the world light.
6. **There was a 0.4 m-deep hole over each abutment behind the deck ends.** A stone threshold landing now sits flush at Y=0 from |Z| 2.5 to 2.95, and the walkway collision covers it.

## Tradeoffs and known limits
- **Nail heads cost 12% of the triangles** (102 small boxes). They can be dropped with a 3-line edit, or baked into a texture if the game later adds UVs.
- **There are no UVs or textures, only material-colour styling.** Stone variation comes from randomly assigning two materials per block. That keeps it to 7 draw calls, but the moss is less lush than on the sheet.
- **The moss blobs are low-poly icospheres** (20 tris each). They read as stylised clumps up close but are not organic drapes.
- **The collision is box-simplified.** The post caps and outward coping overhang add ≤0.06 m outside the parapet boxes, which is only visual. The underside has no collision because the player isn't expected to go below.
- **The bridge doesn't include a bank or terrain.** The footings end at Y −1.6, and the level's terrain has to meet the stone landings at Y=0 and bury the abutment backs.
- The review lighting and ground plane exist only in the renders. They are created after export, so they aren't in the GLB. They aren't in the saved `.blend` either, because the scene is saved before render setup.
