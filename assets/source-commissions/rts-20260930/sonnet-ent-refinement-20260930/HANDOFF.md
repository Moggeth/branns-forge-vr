# Ent presentation revision (ent_presentation.gd)

**Not run.** No Godot binary was available in this folder, so the script has not been parsed or rendered. Expect a first-pass GDScript typing fix or two, and check the geometry visually.

## What changed
- Public API is unchanged: `setup`, `react`, `set_condition`, `update_motion`, plus `clear_cache`. Static `_mats` and `_meshes` caches are kept.
- Everything now lives in a `Rig` node aligned to the real `Trunk` mesh: its axis and lean, base radius, taper, and polygon side count (read from the mesh triangle count). If there is no `Trunk`, it falls back to the `Crown` AABB. Rig units are trunk-base radii.
- Face parts are sampled on the trunk surface, not placed as boards. `_sp(u, y, h)` gives the point at angle `u` from the front and height `y`, following the octagonal cross-section and taper, plus relief height `h`. Patch edges sit `LIP` (0.03 R) above the surface, so they blend into the bark.
- The face has:
  - Sockets: bark rim with a recess.
  - Eyes: amber iris and dark pupil, sunk in the socket.
  - Eyelids: bark ellipses that slide over the eyes for blinking and waking, and roll for mood.
  - Brow ridges: arched strips that start and end flush with the bark.
  - Nose: a dome.
  - Cheeks: two low domes.
  - Smile: a dark groove between two lips, flat for pine.
- Arms are complete branch limbs: buried shoulder knot, upper arm with a side twig, elbow knot, forearm, wrist knot and three twig fingers. Each pivot point sits inside a knot, so bending never opens a gap.
- Feet are hip knot, thick root leg, ankle knot, and three splayed root toes. They tuck under the ground when asleep and lift and plant alternately when moving.
- Bark facets get a deterministic per-triangle shade so it isn't flat. Limb and face meshes are winding-safe: `_tri()` emits clockwise triangles seen from the outside, with explicit outward normals.
- Mood: hostile rolls brows and lids inner-down, raises the arms and dims the eyes slightly. Calm lifts brows and lids, waves the forearms and turns the eyes green. Fire adds a charcoal bark material with a faint ember emission and the existing seams, which now follow the taper. Burning eyes are orange, and pollen becomes embers.
- Canopy sway is tied to the same breath, walking stride and recoil as the limbs.

## Budget (estimated, not measured)
| Item | Triangles |
|---|---|
| Face relief | ~300 |
| Eyes | ~170 |
| Lids and brows | ~240 |
| Arms (×2) | ~2 × 210 |
| Feet and toes (×2) | ~2 × 190 |
| **Total** | **~1500 (about 1400 without seams)** |

Seams add ~45 triangles when burning. Measure with `get_faces().size() / 3` and trim `segs` if it is over.

- Draw calls: 15 mesh instances, 16 with seams. Those are the face relief, eyes, 2 lids, 2 brows, 4 arm pieces and 4 leg pieces.
- Particles: pollen 20 plus chips 10, which is 30.
- Materials: bark, seam and mote materials are shared. The eye material is per-instance, and its colour is set through `albedo_color` because it is unshaded.

## Caching
- Limb meshes (`arm`, `forearm`, `foot`, `toes`) and seams are shared by all Ents.
- Face meshes are keyed by species, polygon sides, height quantised to 0.5 R, front-direction phase quantised to 0.02 rad, and handedness. Trunks with a different lean or phase build their own set, which is a few hundred triangles.

## Limitations
- The presentation node is assumed to sit at the tree's local identity, as before, and `Trunk` must be a direct child of the tree.
- Brows and lids shift up to about 0.05 R while animating, so a slight gap can open under their lip.
- Arms and legs are fixed proportions in trunk radii, so a very thin trunk gets short arms.
- Arms hang forward-sideways (±75° from the front). A trunk with a large lean tilts the whole rig with it, which is intended.
- The sockets and eyes were tuned for the apple trunk in the review shots. Pine uses the same layout with a lower face and a stern flat brow and mouth.
