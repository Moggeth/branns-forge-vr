# Mountain colosseum boundary: handoff (Opus 5.5, 2026-10-03)

## Files (all in `output/`)
| File | Purpose |
|---|---|
| `mountain-arena.js` | `createMountainArena({THREE, scene, height, seed=7})`: one batched rock massif with strata shoulders, cliff ribs, bays/spurs, corner bastions and a broken snowy summit silhouette. |
| `mountain-ground-treatment.js` | `applyMountainGroundTreatment(material)`: a focused patch for the orchard ground material that replaces grass with moss → scree → strata rock → snow on the shared mountain slope. It does not replace `orchard-presentation.js`. |
| `test-mountain-arena.mjs` | Node contract test, using a read-only copy of the `shared/terrain.js` height formula. Last output is in `test-output.txt`. |
| `stage/index.html`, `stage/serve.cjs`, `stage/render.sh` | Controlled WebGL stage plus a headless Chrome renderer. |
| `stage/*.png` | Renders made with the final code: `fps`, `edge`, `corner`, `rts`, `rtscorner`, `fps_arena_0` (ground treatment only, no massif). |

## Integration (root)
```js
import {createMountainArena} from './mountain-arena.js';
import {applyMountainGroundTreatment} from './mountain-ground-treatment.js'; // must sit beside mountain-arena.js
// after createOrchardPresentation(...):
applyMountainGroundTreatment(orchard.material);            // also dresses the orchard skirt (it shares the material)
const arena = createMountainArena({THREE, scene, height: (x, z) => terrainHeight(x, z, snapshot.edits)});
// wherever the ground mesh is re-heighted (terrainSignature change):  arena.sync(snapshot)  or  arena.update(snapshot.edits)
// teardown: arena.dispose()
```
The `height` you pass in must be the real shared surface (`shared/terrain.js` `terrainHeight`, which includes `mountainHeight`). The `terrainHeight` in `reference/client/game.js` has no mountain term. The massif is built from whatever `height` returns, so a flat height function produces a massif standing on flat ground.

## API
- `sync(snapshot)` calls `update(snapshot.edits)`.
- `update(edits)` rebuilds only when the set of edits whose footprint reaches Chebyshev distance ≥ 51.5 changes. It returns `true` if it rebuilt.
- `rebuild()` forces a rebuild.
- `dispose()` removes the mesh and frees its geometry and material.
- `stats()` returns `{draws:1, triangles:21760, vertices:11520, rebuilds, lastRebuildMs, minInnerLift, maxY, shellStart:52, outer:65, lights:0, collision:false}`.
- Exported helpers: `ARENA`, `squarePoint(u)`, `ridgeProfile(u)`, `liftAt(s,u)`, `MOUNTAIN_ROCK_GLSL`.

## How it follows the authoritative surface
- Every massif vertex sits at `height(x,z) + lift(s,u)`. Here `s` is the Chebyshev distance and `u` is the position around a square perimeter, so the corners are continuous with no radial seam.
- `lift` is 5 cm at the inner edge (`s=52`). It rises to 35 cm within 1 m, because the shared crest curves downward and would otherwise poke through between mesh rows. polygonOffset handles the 5 cm seam.
- From `s=46` to `52` the boundary is the ground mesh itself. The shader patch removes grass there (beyond `s≈46.6–48.6`, with noise jitter), so the impassable shared slope reads as rock, scree and moss rather than a grassy invisible wall.
- The summits sit at `s≈59–62.6`. Bays push the face back up to 2.6 m. Far corners round off as a superellipse, and the extent is clamped to Chebyshev 65. The back side drops below the surface into the orchard skirt; it is only visible from high RTS angles.
- No collision, raycast targets, lights or shadow casters are added: `raycast` is a no-op and `castShadow` is false. `receiveShadow` is true.

## Budgets (measured)
- Massif: 1 draw, 21,760 triangles, 11,520 vertices, one shared `MeshStandardMaterial`.
- Ground patch: 0 extra draws, uniforms or textures. It only adds fragment ALU work.
- CPU build time: 14–17 ms for the first build in Node (includes JIT warm-up), 3.1 ms for a rebuild. Measured in Node on this machine, not in the browser runtime.

## Tests actually run
- `node output/test-mountain-arena.mjs`: 12 checks pass, exit 0 (see `test-output.txt`). They cover:
  - triangle and draw budget;
  - the front face never dipping below `height + 0.049`;
  - the inner seam matching `height + lift` to within 1.2e-6;
  - continuity at the corners and where the perimeter wraps;
  - seeded determinism;
  - interior edits not triggering a rebuild while edge edits do;
  - the extent staying within Chebyshev 65;
  - `dispose` removing the mesh.
- Renders: headless Chrome with SwiftShader WebGL (`sh output/stage/render.sh <port> fps rts ...` with `node output/stage/serve.cjs <port>` running; port 18931 was used because 8799 was already taken by another process).
  - The stage uses the real `createOrchardPresentation` from `reference/` with `loadTextures:false`, so meadow, soil and strata use the module's flat 1×1 fallback colours. The real textures were never rendered.
  - The ground is a 120 m / 128-segment plane built from the shared formula.
  - The patch compiled and applied: `fps_arena_0.png` shows rock strata on the ground band and no grass.

## Known limitations (honest)
- **No `game.js` integration was done**, and nothing ran on a GPU, in VR or with live edits. The renders are offline SwiftShader stills, not runtime evidence.
- Low cliff ribs at `s=52–55` stand up to about 1.45 m above the surface with no collision. Players can't reach them today because the movement clamp is at 50. If the walk bound becomes 55, the shared slope blocks `s≈47.3–53.7`, but the gentle crest from 53.7 to 55 could be reached, and the ribs there would act as a visual obstacle with no collision. To prevent that, raise `ARENA.shellStart` or flatten the ribs.
- In the golden preset some flat ledges catch the sun and read as tan or golden streaks (`rts.png`, `fps.png`). Moss on ledges is noise-gated. Tune `mFlatW` and the moss terms in `MOUNTAIN_ROCK_GLSL` if they look wrong with real lighting.
- From far RTS views the strata bands (3.1 m period) look fairly regular.
- The GLSL noise is a `fract(sin)` hash: deterministic per GPU, but colours may differ slightly between GPUs. The geometry uses an integer hash and is bit-stable (tested).
- The ground patch anchors on `diffuseColor.rgb *= oAlbedo;` and on the orchard variables `vOrchardWorld`, `oN`, `oSlope`, `oXZ`, `oSoil`, `oStone` and `oStoneN`. If those anchors are missing it skips itself and sets `material.userData.mountainTreatment.patched = false`. It also skips on low quality if the orchard patch didn't apply.
- An edit reaching `s≥51.5` triggers a rebuild even though the shared terrain protection stops edits changing height beyond 50. The rebuild is cheap (~3 ms) and has no visual effect.
- `reference/client/game.js` uses `PlaneGeometry(120,120,160,160)`; the stage used 128 segments as the brief specified. The massif doesn't depend on the ground's resolution.
