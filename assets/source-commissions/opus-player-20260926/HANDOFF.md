# Player Adventurer — handoff

A gender-neutral traveler: moss-wool coat with a flared, back-split skirt, a rust scarf, a folded hood, rolled sleeves over linen, leather bracers with brass studs, a crossbody strap, and a satchel on the right back hip. A small brass-caged blue crystal charm sits on the belt. The boots have folded cuffs, toe caps and brass buckles. The hair is tousled with a small bun tied by a brass ring. The **right shoulder** has a raised blue felt cushion in a leather rim with six brass studs and a stitched star. It is the fairy's perch.

## Files
| Path | What |
|---|---|
| `output/player.glb` | Runtime asset. Self-contained: textures are embedded in the binary chunk and there are no URIs. |
| `output/player.blend` | Editable scene (Blender 2.93). It adds a `Preview_NotExported` collection with the ground, lights, camera and a stand-in fairy. |
| `build_player.py` | Rebuilds everything: `"C:\Program Files\Blender Foundation\Blender 2.93\blender.exe" -b --factory-startup -P build_player.py` (add `-- --no-render` to skip renders). A full build takes about 4 s. |
| `output/validation.json` | Report from the GLB check the build runs automatically (details below). |
| `output/renders/` | `player_front`, `player_back`, `player_three_quarter`, `player_three_quarter_right`, `player_perch_closeup`, `player_motion_sheet` (rows 1–2: 8 walk frames; row 3: 4 idle frames). |

## Coordinates and scale (as imported in Godot)
- The unit is metres. +Y is up, the character faces **-Z**, and character right is **+X**.
- The origin is on the ground between the feet. Bounds are X ±0.30, Y 0.00–1.732, Z -0.18 (toe) to +0.21 (satchel).
- Height is **1.732 m** to the top of the hair.

## Node hierarchy and pivots
Every part is a **rigid mesh node** with its origin at its joint. There is no skinning. In rest pose all node rotations are identity and parts only have translations. To drive tracking, set the `rotation` / `quaternion` of these nodes.

| Node | Parent | Pivot (world, Y-up) | Tris | Notes |
|---|---|---|---|---|
| `Player` | — | 0, 0, 0 | — | Root (empty) |
| `Hips` | Player | 0, 0.93, 0 | — | Empty. Parent of the torso and legs |
| `Torso` | Hips | 0, 1.00, 0 (waist) | 2772 | Chest, coat skirt, belt, scarf, hood, strap, satchel, charm, both shoulder pads |
| `Head` | Torso | 0, 1.43, 0 (neck) | 2756 | Neck, face, hair. Hide this in the local headset view |
| `UpperArm_R` / `_L` | Torso | ±0.185, 1.355, 0 | 332 | Shoulder ball and coat sleeve |
| `Forearm_R` / `_L` | UpperArm | ±0.225, 1.085, +0.01 | 576 | Linen sleeve, bracer, and a shirt cuff that ends at the wrist |
| `Thigh_R` / `_L` | Hips | ±0.088, 0.93, 0 | 192 | |
| `Shin_R` / `_L` | Thigh | ±0.088, 0.51, 0 | 292 | Includes the knee patch |
| `Boot_R` / `_L` | Shin | ±0.088, 0.10, 0 (ankle) | 808 | Sole bottom is at Y = 0 |
| `ShoulderPerch` | Torso | **+0.235, 1.415, 0** | — | Empty, not rendered. It sits on top of the felt cushion |
| `Wrist_R` / `_L` | Forearm | ±0.25, 0.84, -0.025 | — | Empty. Sleeve opening, where the tracked hand should meet the sleeve |
| `HeadEye` | Head | 0, 1.585, -0.07 | — | Empty. Approximate eye point, for aligning the head to the HMD |

**Rest-pose directions** (useful for IK and retargeting):
- Arms hang in a relaxed A-pose. The upper arm points from the shoulder to the elbow along roughly (+0.04, -0.27, +0.01) for the right arm, mirrored in X for the left. The forearm points from the elbow to the wrist along (+0.025, -0.245, -0.035).
- Legs point straight down (-Y).

For tracked hands, aim `UpperArm`/`Forearm` using two-bone IK so that `Wrist_*` lands on the controller's wrist. The sleeves have no hands, only a dark inner cap inside the cuff.

## Animations (in the GLB; Godot creates an AnimationPlayer)
- `idle`: 2.0 s loop at 30 fps. Breathing, a slight hip sway, a gentle head look-around and relaxed arm sway.
- `walk`: 1.0 s loop (one full stride). Leg swing with knee bend, counter-swinging arms, hip bob and a torso twist.

Both clips key translation and rotation on `Hips`, and rotation on all 12 parts (the translation keys on parts equal the rest translation). The first and last frames match. Set the loop mode in Godot's import settings (`Loop` for both clips). When tracking drives a part, stop the clip or blend it out for that part.

## Materials and textures
- **1 material** (`Adventurer`, glTF metallic-roughness), shared by all 12 meshes. That is **12 draw calls** (per eye).
- Three **64×64** PNG atlases in an 8×8 grid of flat-colour swatches: base colour, ORM (G = roughness, B = metallic; brass is metallic) and emission (only the belt crystal glows). Total texture memory is tiny (under 50 KB uncompressed).
- UVs point each primitive at one spot in its swatch, so colours read as flat painted panels. To recolour, change the `swatch(...)` values in `build_player.py` and rebuild.
- There is no alpha, so the whole asset renders opaque.

## Budget
- **9,928 triangles** in total. The GLB is about 362 KB.

## Validation (done by the build)
The build parses the GLB header and JSON. It checks that every required node exists, that there are no external buffer or image URIs, the triangle count, bounds (height must be 1.65–1.75 m and the minimum Y about 0), the ShoulderPerch world position, and both animation clips. The result is written to `output/validation.json`.

Last result: height 1.732 m, perch (0.235, 1.415, 0), idle 2.03 s, walk 1.03 s. The extra 1/30 s is the duplicated loop frame.

## Assumptions and caveats
- **Rigid parts, not skinned.** Overlapping shoulder balls, elbow and knee spheres and rolled cuffs hide the joint gaps. Extreme elbow or knee bends (beyond about 120°) may show seams. Walking with the thighs swung far forward can make them clip slightly through the coat skirt, because the skirt belongs to the rigid Torso.
- **The perch is on the Torso**, not UpperArm_R, so it stays still while the arm moves.
- The Torso contains no neck. The neck belongs to `Head`, so hiding `Head` locally leaves only the scarf ring. The fairy camera still sees the full head.
- **GLB bytes are not identical between builds.** Blender 2.93's glTF exporter orders animation accessors through Python set iteration. The *content* is deterministic: `validation.json.content_fingerprint` is an order-independent hash of meshes, node transforms, animation data and images, and it matched across repeated builds.
- Built with the locally installed Blender 2.93 (exporter from that version). I did not do a Godot import in the live project, as instructed. The GLB follows the standard glTF 2.0 +Y-up convention.
- The fairy in the renders is a preview stand-in only and is not exported.
