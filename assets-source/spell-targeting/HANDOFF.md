# Spell targeting — Opus 5.5 commission handoff (2026-10-03)

## Files (all in `output/`)
| File | Purpose |
|---|---|
| `spell-targeting.js` | Self-contained ES module (446 lines). Only imports `three`. Exports `createSpellTargeting`, `SPELL_SHAPES`, `lineKernels`, `DEFORM_CAP`, `LINE_SPACING`, `FALLBACK_LINE`. |
| `test.mjs` | `node test.mjs`. Runs without WebGL. |
| `preview.html` | Hilly sunlit test terrain showing all 14 markers. Query options: `?invalid=1`, `?only=<id>`, `?q=low`, `?rm=1`, `?cam=top`. Needs `--allow-file-access-from-files` or any static server. |
| `shots/*.png` | Headless Edge (SwiftShader) captures: `overview`, `invalid`, close-ups of skeleton, squad, golem, grove, crystal, lightning, wall, raise and sunder, plus `squad-invalid`, `crystal-invalid` and `starfall-low`. |
| `package.json`, `node_modules/three` | `{"type":"module"}` and a **junction** to `multiplayer/node_modules/three` (r186). Both are local scaffolding; do not copy them into the repo. |

No replacement `spell-presentation.js` is included. Nothing outside `output/` was modified.

## API
```js
const t = createSpellTargeting({ scene, height, quality: 'high'|'medium'|'low', reducedMotion: false });
t.root                // Group 'SpellTargeting' (children: SpellTargetingSurface, SpellTargetingGlyphs, SpellTargetingMotes)
t.setTarget({ spell, point, start, end, radius?, valid }) // returns true if shown; null/unknown/garbage -> hidden, false
t.update(nowMs, dt)   // rebuilds geometry only when the target key changes; otherwise only uniforms update
t.configure({ quality, reducedMotion })
t.stats()             // {spell,valid,visible,draws,triangles,ribbonPoints,strands,droppedStrands,motes,surface,builds,lastBuildMs,heightSamplesPerBuild,...}
await t.prepareShaders(renderer, camera, scene) // compiles detached clones; no visible change
t.dispose()           // removes root, disposes 3 geometries + 3 materials; safe to call twice
```
- Vectors can be `[x,y,z]` or anything with `{x,y?,z}`, including `THREE.Vector3`. Non-finite values reject the target.
- Spell lookup uses `Object.hasOwn`, so `'toString'` and `'__proto__'` are hidden safely.
- A height callback that throws or returns NaN/Infinity is treated as 0.
- **Positioning is exact:** the target is rebuilt in the same `update()` call. No positional smoothing is applied. Only the fade (about 0.12 s, and instant with reduced motion) and the shader animation are smoothed.
- Line spells use `start`/`end` exactly. If those are missing or degenerate, a valid `point` gives the brief's 6 m east–west fallback.

## Design (each preview shows its spell, not a generic circle)
Shared vocabulary:
- **Ground strokes** are flat ribbons baked onto the terrain. Each edge vertex is sampled from `height()` + 0.06 m, so the strokes conform on slopes.
- **Air strokes** face the camera and are used for volume and height cues.
- Every stroke has a darker rim and a bright core, so it reads on both bright grass and dark soil.
- **Invalid:** colour shifts to red, every stroke is cut by periodic gaps, valid-only details are hidden, and red X crosses appear. Invalid is shown by shape, not by colour alone.

| Spell | Design |
|---|---|
| skeleton | Bone ring (r 2), dashed violet inner ring, 12 alternating rune ticks/chevrons, line-art skull with negative-space sockets/nose and a toothed jaw, two small risen-knuckle arcs, violet motes. |
| squad | **Four** seals at the authority's exact spawns (±1.4, ±1.4), each with a small skull. Dashed square formation, outward tick marks, central rune. |
| golem | Heavy octagon (r 2.6), eight buttress bars, four interlocking L-shaped masonry stones around a keystone, four short standing stone posts. Heavier strokes and slower glow than the skeleton markers. |
| raise | Exact r 6 footprint. Contour rings lifted to +0.5/+1/+1.5 m on the smoothstep profile, 12 lifted profile spokes with an animated pulse, a peak ring at +2 m, a vertical gauge with an up-arrow and 0.5 m ticks, and a translucent mound surface with contour bands. |
| lower | Exact r 6 footprint. Depth contours at −0.5/−1/−1.5 m drawn **on the ground** with denser dashes toward the centre, a ground-level depth-map surface, two rings of inward chevrons, a sinking spiral, and a 2 m gauge above the centre pointing down. Nothing is hidden underground. |
| sunder | Exact kernel-union outline (width 5 m, scalloped where it really is) plus a torn inset edge. Also: a jagged central fracture seam with a pulse that travels start→end, forward-angled branch fractures at every kernel, half-depth trench lines at ±1.25 m, kernel diamonds, direction chevrons, an origin seal, a destination arrowhead and a ground depth-map surface. |
| wall | Exact kernel-union outline on the ground. A crest line lifted on the actual summed +1.5 m kernel profile, a cross-section rib per kernel, side profile lines, vertical height posts with caps, flanking direction chevrons, start seal and end arrow, and a translucent stone volume surface. |
| grove | Leaf-scalloped rim (r 4), the existing twin swirl, a seed/vesica centre, curving bark roots to the three exact tree sites with curled side rootlets, a leaf rosette per tree, and standing saplings. |
| ring | Eight saplings exactly on r 3.6, a braided vine (two phase-offset waves) that grows around the ring, leaves between the saplings, and a dashed canopy limit at r 4.5. |
| starfall | Compass rose aligned to world X/Z, triple inward orbital spirals, eight converging chevrons, and a **fixed** white crosshair with a centre dot. Also an 18 m sky beam, a tilted orbit ring overhead and falling star motes. |
| crystal | Hexagonal footprint (r 2.6), inner hexagon rotated 30°, triangulated facet lines, and a wireframe cluster of three faceted prisms (main one 1.9 m to the tip). |
| heal | Rippling water rim (r 7), three ripple rings, six rain-drop glyphs, a rounded sanctuary cross with an inner circle, and falling rain motes. Uses a mint/water palette and calm low-frequency waves, so it reads differently from grove. |
| lightning | Charged dashed rim (r 3), six jagged bolts converging on the centre, a fixed crosshair, and a jagged sky bolt. |
| frost | Icicle-toothed rim (r 7), six branched dendrite arms with tip spears, and a central hex. It is a round snowflake, unlike crystal's hex plates and standing prisms. |

## Performance (measured, Node 24, this machine)
- `node test.mjs` passes. Total run 272–281 ms.
- 1400 consecutive target changes, cycling all spells and qualities: **0.16 ms per update** including the full rebuild.
- A single rebuild takes 0.2–1.6 ms. The heaviest are raise, lower, sunder and wall, at about 3000 `height()` calls per rebuild. Costs repeat with your `height()` cost.
- Worst case across all 14 spells:

| Quality | Draws (budget) | Triangles (budget) | Dropped strands |
|---|---|---|---|
| high | 3 (20) | 3856 (12000) | 0 |
| medium | 3 | 2532 | 0 |
| low | 2 (10) | 1166 (5000) | 0 |

- Allocation: three preallocated geometries (packed glyph ribbon, topo surface grid, motes) and three owned ShaderMaterials. Buffers are rewritten in place, and the test asserts the same buffer and material identities after 1400 updates. No lights, no textures, no shared materials touched. Bounding spheres are fixed and frustum culling is off for the three meshes.
- Hard caps: 6000 ribbon points, a segment cap per quality (high 4800 = 9600 tris, low 2200), a 30×30 surface grid, and 64 motes. Strands beyond the cap are dropped and counted in `stats().droppedStrands`.
- Reduced motion: animation time is frozen at 0, the sunder pulse is off, motes are hidden and the fade is instant. Direction stays readable through chevrons and arrows.
- Low quality skips secondary motifs flagged `fine`, has no motes, and uses a coarser surface grid.

## Contracts used / discrepancies to check
1. Line kernels use `ceil(d/2.5)+1`, placed evenly from start to end, exactly as `shared/simulation.js` does. This is exported as `lineKernels`.
   - For the point fallback I draw the brief's 6 m east–west line with **3 kernels**, matching the authority's count of 3.
   - The authority's real fallback spaces those 3 kernels 3 m apart, **perpendicular to the player's facing**. That spacing exceeds 2.5 m, and I don't receive the player's facing.
2. Tree layout: I followed the brief (grove offsets [−2,−1.5], [2,−1.5], [0,2]; ring 8 trees at r 3.6). However, `multiplayer/shared/world-content.js` currently spawns **grove = 5 trees at r 2.5** and **ring = 8 trees at r 4** (angles i·2π/8, starting at +X). Both layouts are in `SPELL_SHAPES` and are easy to change. The parent should confirm which one is authoritative.
3. Squad spawns at (±1.4, ±1.4), which are diagonal corners. This matches `simulation.js` (`x±1.4, z±1.4`).
4. Raise and lower previews use `height()` + offset, with the offset clamped to ±2 for a single edit. I can't see existing edits, so a preview where saturation at ±6 would truncate the mound is not shown truncated.
5. Sunder and wall overlap is summed and capped at ±6, as in `rawTerrainHeight` earth edits.

## Evidence and limitations
- The screenshots are headless SwiftShader at 1600×1000 and 900×700, viewed at oblique RTS distances. **Not verified:** VR/HMD comfort, real-device mobile legibility, or integration in the actual game scene with real lighting, fog or post-processing.
- Air strokes are expanded in view space, so very close VR views may show minor width popping where a stroke points straight at the camera.
- With `depthTest` on, terrain can hide parts of a footprint behind a ridge. That is intentional and honest, but there is no x-ray outline.
- The lift is 0.06 m plus polygon offset. Where the height callback is coarser than the rendered terrain mesh, a stroke can clip under the triangle mesh; the strokes sample the same callback as the terrain, so this is expected to be rare.
- The skull, droplet and leaf motifs are simple line art. Their orientation is fixed in world space (+Z), not turned toward the camera.
- `prepareShaders` was only tested with a mock `compileAsync`. A real WebGL compile was exercised only through the preview page.
- Time used: about 11 minutes of the 20-minute allowance. I did not iterate on fine art-direction polish, such as colour tuning against the actual orchard palette.
