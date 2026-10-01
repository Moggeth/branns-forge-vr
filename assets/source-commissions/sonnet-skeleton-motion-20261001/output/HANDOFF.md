# Skeleton guardian motion — handoff

Rebuild (deterministic, ~2 s): `blender -b --python output/build_skeleton_motion.py -- --out ABS_DIR [--rigs mossward,...]`
Reads `input/<rig>_rig.glb` relative to the script. Writes `<rig>_rig.glb`, editable `<rig>_rig.blend`, `manifest.json`.
**Status: built and exported only. No visual review, Godot import or gameplay check was done; the coordinator owns those.**

## Rig changes
- Old actions and bone poses were cleared. Geometry, materials and mesh names are unchanged. Triangles: Mossward 17,092, Prismwatch 14,454, Cinderkeep 18,454, all under 30k.
- Material base colours were compared with the inputs and match. There are no cameras or lights, and all 13 bones are exported as joints.
- Removed only the importer's `Icosphere` bone-shape helper mesh (no weights, 80 tris).
- Mossward already had `LeftLeg -> LeftKnee -> LeftFoot` (and the right-hand equivalent). Its bones and weights are untouched.
- Prismwatch and Cinderkeep got `Left/RightKnee` and `Left/RightFoot`, using Mossward's joint ratios:
  - Knee at 0.534 and ankle at 0.127 of leg height, with a ±0.02/0.018 m blend.
  - Hip, shin and foot weights are discrete and sum to 1. The shin bone is named `*Knee`, as on Mossward.
- Sockets are non-deforming bones:
  - `RightHand` (child of `RightArm`) and `WeaponTip` (child of `RightHand`).
  - Positions come from the geometry (below, Godot x/up/fwd at rest):

| Rig | RightHand | WeaponTip | Weapon |
|---|---|---|---|
| Mossward | 0.308, 0.707, 0.137 | 0.350, 0.687, 0.164 | none; the tip is the fist's farthest point from the shoulder, not a fake reach |
| Prismwatch | 0.285, 0.674, 0.130 | 0.287, 0.619, 0.171 | crystal tip |
| Cinderkeep | 0.343, 0.632, 0.115 (grip centroid) | 0.396, 0.391, 0.288 (farthest arm vertex) | held weapon |

- Shield stays skinned to `LeftArm`. Head, Torso, arm and leg meshes are still separate and hideable.
- Jaw is **not authored**. Head is one rigid skinned mesh with only a `Head` weight, and I did not invent a jaw.

## Axes and naming
- +Y up, +Z forward, no root X/Z motion. Root only moves vertically (hops and crouches).
- `Left*` bones are the −X side and carry the shield. They are the anatomical right of a +Z-facing body, so the names are the rig's, not anatomy.
- Hop clips use the named sole: `hop_left` → `LeftFoot`, `hop_right` → `RightFoot`.
- `turn_left` is a positive-Y (Godot) left turn, toward +X:
  - The first foot to lift is on the +X side, which is the `Right*` bones.
  - Root yaw is not animated. The actor provides the rotation, and the clip supplies the lead twist, lifted feet and re-planting.

## Clips (24 fps, one action each, baked every frame)

| Clip | Frames | Notes |
|---|---|---|
| idle | 48 + 1 | 2.0 s loop. Feet planted by IK, breathing, head scan |
| walk | 24 + 1 | 1.0 s loop. See below |
| attack | 40 + 1 | See below |
| hop_left / hop_right | 20 + 1 | One-shot, in place. See below |
| turn_left / turn_right | 24 + 1 | One-shot. Lead foot lifts during 0.05–0.50, the other during 0.50–0.95, each yaws and re-plants, torso and head lead the turn |
| stagger | 28 + 1 | One-shot. Snap-back, flung arms, damped wobble, back-foot stumble step |

For loops, the last frame equals the first.

**walk**
- Stride is 0.60 m per cycle.
- Each foot is supported for 0.60 of the cycle, so the stance foot travels back 0.36 m relative to the body (±0.18 m).
- Right foot is offset by 0.5 cycle.
- Stance foot speed equals root speed at 0.60 m/s over the 1.0 s cycle. Set playback speed so the actor's speed times the cycle time is 0.60 m.
- Legs stay bent (hip-to-ankle distance 0.915 of full leg length).
- Heel strike and toe-off roll about the heel and toe, with a small vault in root height.
- Upper body is slightly unstable: torso weight shift plus a 3rd-harmonic wobble, with the head countering.
- Measured on the evaluated armature, flat-foot slip is ≤ 1.5 mm/frame against a 25 mm/frame step, and flat-foot ankle height stays within 2 mm.

**attack**
- Anticipation 0–0.65 (coil, hold, tremble at 0.45–0.65).
- Strike crossing 0.65–0.80. Weapon-tip forward distance by phase (Mossward): −0.60 at 0.65, −0.69 at 0.70, +0.20 at 0.75, +0.78 at 0.80. The other rigs show the same crossing in `manifest.json`.
- Vulnerable recovery 0.80–1.0.
- Feet stay planted (idle stance) and the legs absorb the root dip. There is no forward lunge, because there is no root motion.

**hop**
- Flight fraction is 0.25–0.72 (a parabola, 0.15 m apex over the take-off height).
- The named sole is the only ground contact. The other foot tucks and re-lands at the end.
- Take-off is at a straight leg; landing absorbs into the crouch and ends in the bent-leg stance.
- Measured airborne phase is 0.30–0.70, using a 12 mm ankle-clearance threshold.

## Hand-offs and unverified items
- The coordinator should run Godot import, visual review, and the weapon and foot-IK checks. The in-clip leg IK already plants feet, so analytic foot IK should only correct for terrain.
- Slip and clearance numbers above come from Blender FK on the baked actions, not from Godot.
- The hop apex of 0.15 m is stylised. Check it against the game's hop distance and timing.
- Damage and part hiding are unchanged. The existing adapter's `LeftKnee`, `RightKnee`, `LeftFoot` and `RightFoot` bone lookups now resolve on all three rigs.
