# Orchard brook footbridge — handoff

Built without images. Files: `build_bridge.py` (deterministic, seed 20260928), `bridge.blend`, `bridge.glb`,
`asset.json` (collision and clearance dimensions), `verify_glb.py` → `verify_reimport.json`, and `review_*.png` (front, side, top, three_quarter, back_underside).

Rebuild: `blender.exe -b --factory-startup --python build_bridge.py` (add `-- --no-render` to skip the renders).

## Design
- The deck is 5.0 m long and made of 20 cross planks in three warm timber tints, with small jitter. The top is at Y=0 and the origin is the centre of the deck. The long axis is glTF +Z.
- The 3.4 m walkway is clear. Every parapet or pillar vertex above the deck is at |x| ≥ 1.72 (the margin is 0.02 m, set by the pillar stone jitter), and the build asserts this. Nothing crosses overhead.
- The structure is 3 inner stringers plus 2 fascia beams, carried on coursed stone abutments with a slight batter. The clear span between the abutment faces is 4.0 m, and the stream bed is 1.45 m below the deck. Knee braces run from the abutment faces up to the stringers, with a bearing sill, a mid-span tie and timber end headers.
- There are four stacked stone pillars with capstones and moss caps. Each side has a timber parapet 1.0 m high: posts, a top rail, a mid rail and X-braced bays, plus iron bolts and straps. Moss grows on the lower stream-side courses.
- 7 render meshes grouped by part (Deck, Frame, Abutments, Pillars, Railings, Ironwork, Moss) and 8 materials. There is no texture, so the look is low-poly and flat-shaded.
- There are 9 box colliders named `*-colonly`, which Godot imports as collision only: the deck (walkable, top at 0), 2 rails, 4 pillars and 2 abutments.

## Measured (this machine)
- Build 0.13 s, save+export 0.11 s, rendering 5 Eevee views 1.63 s. The whole Blender process took 2.30 s wall time.
- Clean reimport check took 0.54 s. Results: 16 meshes (7 render + 9 colliders), 9,152 render triangles, size 4.64 × 5.24 × 2.75 m (width × length × height, 5.24 m includes the abutments), and the deck top is at −0.0003.

## Defects found and corrected
1. On the first build, the stone cap slab under each deck end cut through the stringer ends, and the front view showed an open void under the deck. I replaced it with a timber end header (see the front render).
2. The GLB exporter's default Y-up conversion maps Blender −Y to glTF +Z. Because the bridge is symmetric this is harmless, and the axes are documented in asset.json.

## Tradeoffs and known limits
- The abutment blocks go all the way through the wall and none are hidden, so some inner faces are wasted (about 3.7k triangles). A shell-only abutment could save roughly 40%.
- Moss is thin slab geometry rather than a vertex-colour blend. That is cheap and reads well, but looks a little like stickers up close.
- The deck is flat with no camber, which keeps the collision a simple box. Plank tops can sit up to 8 mm below Y=0, which does not matter for the collider.
- The bridge does not include an approach path, ground or water. The review ground plane appears only in the renders. The abutments end at z = ±2.62, so the scene needs to supply the banks.
- It has not been imported into Godot yet. That is the next check to run in a disposable project.
