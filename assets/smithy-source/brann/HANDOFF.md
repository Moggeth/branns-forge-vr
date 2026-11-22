# Brann Copperpot — second sculpt pass (handoff)

Rebuilt in Blender 4.5.13 from `output/build_brann.py`, a modified copy of the supplied builder. It is not a new character.
Build command: `blender.exe -b -P build_brann.py`, run from this folder.

## Deliverables
- `brann.glb`: the re-exported character.
- `build_brann.py`: the source.
- `export_report.json`
- `render_face_front.png` and `render_face_34.png`: real EEVEE face renders.
- `preview.png`: a strip with the full front, full 3/4, face front and face 3/4 views.
- `hammer.glb` was **not regenerated**. It is a byte-identical copy of the original, checked by hash. To re-export it, set `BRANN_EXPORT_HAMMER=1`.

## Verified constraints (from the exported GLB)
- These nodes have the same names, parents and local translations as before: HeadPivot (0,1.48,0); BeardPivot (0,.05,.10); EyeL/EyeR (±.05,.165,.112); LidL/LidR (same as the eyes); StrikePivot (-.43,1.12,0); RestPivot (.43,1.12,0); PresenceAnchor (0,2.02,0); Body; PresenceIndicator.
- PresenceIndicator still has 2 primitives (0 = gem, 1 = metal). The hand and arm pivots did not move, so the hammer contact is unchanged. The hammer face minimum X is still -0.2285.
- Height without the indicator went from 1.89 to 1.80 because the tall hair crest was removed.
- Textures are self-contained and packed. The draw cost rises with more materials: the head now has 14 primitives and the beard has 4.

## What changed
- **Face:** I removed the pink nose cone and wedge. The nose is now a soft, broad, bulbous shape made of a bridge, a ball tip and small wings. The brows have skin ledges, eyebrows made of 3 tapered tufts, eyelid folds that ring the eyes, small lower lids, and crow's-feet and forehead furrows. The irises are larger and blue-grey, with clear pupils and highlights. The eye positions are unchanged and the eyes do not bulge. I added a curved smiling mouth with upper teeth, a lower lip, lifted corners, smaller flushed apple cheeks, and ears with a rim and a lobe.
- **Hair:** Darker red-brown, with copper and shadow tones. The tall tuft is gone and replaced by low swept locks, a leather brow band, and brass goggles parked on the forehead. The goggles have rims, cups, domed tinted lenses, a nose bridge and leather straps. The goggles sit about 6 cm above the brows, so the eyes stay clear.
- **Beard:** The block has become 3 layers of curved, tapered, irregular locks over a dark core that gives a shadow plane. Each side of the moustache has 3 locks that curl up past the smile. I kept the forked braids and copper bindings.
- **Arms:** The shoulder caps are flatter and slope into the torso, with a sleeve seam. The sleeves are tighter and rolled in 3 folds. The forearms now taper, with a muscle belly. The mitten-like hand rolls are replaced by four curled fingers with 3 joints each, knuckles and nail hints, and an opposed thumb wrapped around the haft.

## Known remaining issues (I rejected the first two passes, but this one is not finished either)
1. In the full-body view, the rolled sleeves at the elbow still look like flat saucers. The torus folds need to tilt with the forearm, or become a sleeve mesh shaped from a ribbon. Fix this next.
2. The beard locks show seams where the cone segments join. For VR they need a subdivision or remesh step and a merged strand mesh.
3. The torso and shoulder silhouette (the Body sphere at y 1.27) is still wide and round. I haven't reshaped it yet.
4. The cheeks and brow are still separate soft primitives. A remeshed and sculpted head would read better under mobile lighting.
5. I have not checked the result in the game engine. I only looked at the Blender renders.
