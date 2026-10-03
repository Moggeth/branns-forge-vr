# Living meadow and sunlit canopies (browser Orchard) — 2026-10-03

Branch `claude/main-level-ground-trees-bob9q0`, isolated from main. Presentation only: no height,
collision, raycast, save, network or gameplay contract changed.

## What changed

- `multiplayer/client/meadow-cover.js` (new): instanced grass tufts, wildflower drifts (daisy,
  buttercup, violet, poppy and rare softly glowing moonbells) and drifting pollen/light motes.
  Grass reads the same orchard layout, dryness and disturbance functions as the ground shader, so it
  stays off foot-worn paths, the forge plaza, landmark paths/footprints, fresh craters, structures,
  foundations and live boulders. It bends in travelling wind gusts and parts around heroes.
- `multiplayer/client/tree-materials.js`: leaves gain sun translucency (golden glow when looking
  toward the sun) and a soft wrap light, so canopy undersides read green instead of near-black.
  Material version `tree-mat-v3`; bark, roots, shadows, wind and notch surfaces are unchanged.
- `multiplayer/client/game.js`: creates the meadow, forwards terrain dirty edits and structure
  snapshots, and passes up to four hero positions for trampling. `diagnostics().meadow` reports it.

## Budget

Three draws (grass, flowers, motes). No textures, lights or shadow casters; grass and flowers
receive the existing sun shadow. Fixed-capacity instance buffers are refilled around the view focus
(the hero, or the RTS view target) only after it moves 2 m. Cells bake nearest-first under a
1.5 ms per-frame budget; terrain edits rebuild only the cells under the changed kernels.

| Tier | Tufts cap | Radius | Measured near spawn (Node) |
| --- | --- | --- | --- |
| Desktop (`high`) | 9000 × 12 blades | 22 m | 7398 tufts, 301,528 triangles |
| Phone (`pointer: coarse`) | 3200 × 8 blades | 14 m | 57,250 triangles |
| Headset while presenting | 3500 | 14 m | capped per eye |

Steady refill measured 2.8 ms in Node after neighbouring cells are cached. These are geometry and
CPU numbers, not GPU frame times; physical phone/Quest frame timing is unverified.

## Verification

```
node multiplayer/tests/meadow-cover.mjs
node multiplayer/tests/tree-materials.mjs
node multiplayer/tests/orchard-presentation.mjs
```

All pass, along with tree-growth, legacy-trees, tree-integration, tree-land-timing and
`npm run build:check`. Visual review used real Chromium (SwiftShader) solo Hero and God sessions,
compared against the same capture path on commit `099080d`.
