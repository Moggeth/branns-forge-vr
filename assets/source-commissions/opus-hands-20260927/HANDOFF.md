# Pocket Thunder hands: handoff (v1, 2026-09-27)

These are replacement player hands for `adventure_runtime.gd build_hand`. Fingers are skin with small clean nails. The hand wears a fingerless teal-leather Pocket Thunder glove:
- a brass medallion with a glowing bolt
- stitched knuckle edge, leather finger sleeves with brass rings and studs
- a leather cuff with brass bands, a copper coil and a glowing thunder cell

The palette keeps the live colours: skin `d4b087`, leather `4b626a`, brass `b69b74`/`d3b275`, nail `efd9bd`.

## Files
| Path | What |
|---|---|
| `builder/build_hands.py` | Deterministic builder. Produces the .blend, both GLBs, stats and renders |
| `builder/verify_glb.py` | Re-imports each GLB and checks names, scale, handedness and curl direction. Exits 1 on failure |
| `output/pocket_thunder_hand_L.glb`, `_R.glb` | Self-contained GLBs (embedded buffers, no textures), exported in rest pose |
| `output/pocket_thunder_hands.blend` | Editable scene with both hands, collections `Hand_L`/`Hand_R`, a stage and the grip demo animation |
| `output/renders/` | `back`, `palm`, `front`, `side`, `three_quarter_open`, `grip`, `grip_front`, `grip_side`; `anim/frame_*.png` shows the open→grip→open strip |
| `output/stats.json`, `output/verify.json` | Triangle counts and verification results |

Commands (Blender 2.93 at `C:\Program Files\Blender Foundation\Blender 2.93\blender.exe`):
```
blender -b --factory-startup -P builder/build_hands.py              # full build + renders (measured ~6 s)
blender -b --factory-startup -P builder/build_hands.py -- --no-render  # ~1 s
blender -b --factory-startup -P builder/verify_glb.py
```
Two consecutive builds produced byte-identical GLBs (SHA-256 L `7F76035F…`, R `133E09D8…`).

## Frame and scale
- Units are metres, in the Godot hand frame used by the live hand. The palm is centred at the origin, fingers point to **−Z**, the back of the hand is **+Y** and the wrist/cuff runs to **+Z**. The GLB root needs no correction transform.
- The **left** hand has its thumb on **+X** and the right hand on **−X**, the same as `side` in `build_hand`. The hands are built from a side parameter, not with negative scale, so normals and winding are correct on both.
- Measured from the GLB: palm width **9.2 cm**, middle knuckle → fingertip **10.6 cm** in the relaxed rest curl (about 10.95 cm straight). Bounds for L are x −0.048…0.077, y −0.067…0.029, z −0.157…0.123.
- **16,676 triangles per hand**, 54 mesh nodes, 89 nodes in total, about 295 KB per GLB. There are 8 shared materials.

## Node hierarchy (per hand, prefix `L_` or `R_`)
```
L_HandRoot                         (palm, glove, cuff and trim meshes are children)
├─ L_Index_1_Rest → L_Index_1 → L_Index_2_Rest → L_Index_2 → L_Index_3_Rest → L_Index_3 → L_Index_Tip
├─ L_Middle_…  (same pattern)
├─ L_Ring_…
├─ L_Pinky_…
└─ L_Thumb_Root (static metacarpal + sleeve)
     └─ L_Thumb_1_Rest → L_Thumb_1 → L_Thumb_2_Rest → L_Thumb_2 → L_Thumb_Tip
```
- **Driven joints** are `*_1`, `*_2`, `*_3` and `Thumb_1`, `Thumb_2`. All have identity rest rotation, and the verifier checks this. Bend is rotation about local X. The runtime's `rotation = Vector3(-angle,0,0)` curls toward the palm, and verification confirmed a curl of 2.8–4.0 cm toward the palm for each finger. The thumb closes across the palm, in front of the fingers.
- **`*_Rest` nodes** are static parents. They hold the relaxed art pose (finger curl −0.10/−0.16/−0.12 rad, splay, thumb −0.12/−0.15). Because the runtime *overwrites* joint rotation, the relaxed pose must live in these parents, and it survives tracked bends.
- `*_Tip` nodes are at the fingertip surface, which is useful for `seat_index` and touch probes.
- Segment lengths in metres (proximal/middle/distal): Index .044/.028/.022, Middle .048/.030/.024, Ring .045/.029/.023, Pinky .036/.022/.020, Thumb .031/.024 after a .038 metacarpal.

## Integration
This has not been applied to `godot/`, as the brief asked. The suggested change to `build_hand`:
```gdscript
const HAND_SCENES={"L":preload("res://art/hands/pocket_thunder_hand_L.glb"),"R":preload("res://art/hands/pocket_thunder_hand_R.glb")}
var tag="L" if side==1 else "R"          # side as computed in build_hand
var art=HAND_SCENES[tag].instantiate()
visual.add_child(art)
var joints=[]
for f in ["Index","Middle","Ring","Pinky"]:   # index first = runtime finger 0 (trigger)
	for s in [1,2,3]: joints.append(art.find_child("%s_%s_%d"%[tag,f,s],true,false))
hand.set_meta("finger_joints",joints)
hand.set_meta("thumb_joints",[art.find_child(tag+"_Thumb_1",true,false),art.find_child(tag+"_Thumb_2",true,false)])
```
Remove the old primitive palm, finger and thumb construction when you make this swap. Nothing needs to change in `hand_animation.gd`, with one exception: `seat_index` assumes a 0.025 m link length. The real index links are 0.044/0.028/0.022, so either pass the per-segment lengths or read them from `global_position` differences, which is safe. Use `L_Index_Tip` as the fingertip rather than `to_global(0,0,-0.025)`.

Import notes:
- Import with default settings.
- The glowing parts use the `PocketThunder` material, which has emission. If the glow reads too hot, lower its emission energy in Godot.
- The glove is fingerless, so held-tool grips show skin fingers. Finger radii are 7–9.5 mm, slimmer than the live 10.5–11.5 mm, to reduce tool occlusion.

## Demo animation
The `.blend` has a 72-frame, 24 fps open→grip→open loop. It is keyed on the driven joints only, with a pinky-first stagger. The grip angle is 0.95 rad, the same as the runtime's held-tool fallback. Scrub it in the viewport. The GLBs export without animation.

## Known limitations / next refinements
- There is a visible step where the glove back meets the cuff in side view. A tapered leather transition ring would soften it.
- The palm is fairly slab-like in side profile. A thenar/hypothenar bulge would help.
- Finger segments are separate capsules. At extreme bends the overlap can show a small crease at the knuckle, which is acceptable at VR viewing distance.
- The thumb pose was tuned against the 0.95 grip only. Check it against real tracked thumbs in-headset.
- Nothing was loaded in Godot 4.7.2 here. Verification was by Blender re-import of the GLBs.
