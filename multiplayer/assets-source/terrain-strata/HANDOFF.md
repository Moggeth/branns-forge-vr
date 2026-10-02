# Ground & terrain deformation — handoff (Opus 5.5 lane, 2026-10-03)

Status: FINAL for this sprint (06:56 → 07:22 Sydney, ~25 min wall; timing in `logs/work-timing.csv`). Not integrated, not Godot-validated, no headset/GPU acceptance — root owns integration and validation.

## Deliverables (all inside this folder)
| File | What |
|---|---|
| `multiplayer/client/orchard-presentation.js` | Drop-in replacement for `client/orchard-presentation.js` (v2). All v1 named exports kept and v1 mask/classification output is byte-identical (tested). |
| `multiplayer/client/terrain-deformation-field.js` | NEW bounded, presentation-only deformation field (dirty-rect, time-budgeted job, half-float texture). |
| `multiplayer/assets-source/terrain-strata/generate_terrain_strata.py` | Deterministic numpy/Pillow generator for the strata kit. |
| `multiplayer/public/assets/terrain_strata_albedo.png`, `terrain_strata_normal.png` | NEW texture kit (512², RGB, see sizes below). |
| `multiplayer/tests/terrain-presentation.test.mjs` (+ `terrain-field.golden.json`) | Node regression tests. |
| `fixture/` | Browser render fixture (headless Edge, SwiftShader CPU) + test height fixture with every edit kind. |
| `shots/` | Before (`ref-*`) / after (`new-*`) captures + stats JSON. |

## Integration (root)
1. Copy `multiplayer/client/orchard-presentation.js` and `multiplayer/client/terrain-deformation-field.js` into `multiplayer/client/`.
2. Copy the two `terrain_strata_*.png` into `multiplayer/public/assets/` (and the generator into `multiplayer/assets-source/terrain-strata/`).
3. One-line narrow patch in `client/game.js` (createOrchardPresentation call, ~line 91) — pass the authoritative *undeformed* surface:
   ```js
   const orchard = createOrchardPresentation({scene, renderer, ground, sun, camera, height: (x, z) => terrainHeight(x, z, snapshot.edits),
     baseHeight: (x, z) => terrainHeight(x, z, []),
     quality: globalThis.matchMedia?.('(pointer: coarse)').matches ? 'low' : 'high', edits: snapshot.edits});
   ```
   Without `baseHeight` the module keeps the exact v1 shading path (`stats().deformation.reason === 'no baseHeight'`), so the copy alone is safe.
4. Nothing else changes: `rebuildGround()` already calls `orchard.groundChanged({edits})`; `orchard.update(dt, camera)` drains the job. `spell-presentation.js`, shared simulation, colliders and geography are untouched.
5. If the asset dependency test (`tests/asset-dependencies.mjs`) lists public assets, add the two PNGs.

## Design
* Height truth: field texel = `height(x,z)` and `baseHeight(x,z)` from the caller only (no parallel terrain formula). Shader strata depth = `base - fragmentWorldY`, so bands sit at true world heights on the real (faceted) mesh.
* Field channels (RGBA16F, linear-filtered): base, displacement D, raise peak, ejecta ring.
* Work: `groundChanged` → `setEdits` only diffs edit keys and queues dirty rects (added/removed edits, merged); never samples. `update()` drains under the shared `DEFORM_JOB_BUDGET_MS = 1.5` (mask job first, deform gets the remainder, min .25 ms). No full-world synchronous resample on a spell.
* Shading (ground material only; no extra draw calls, meshes, lights; programs: 1 ground variant per quality):
  - strata faces on steep cut/raised ground (triplanar on high/medium, dominant-axis on low) with horizon-dependent roughness and normal relief;
  - raise flanks keep torn sod slabs on gentler parts; cuts show turf lip → loam → ochre subsoil → clay → gravel → bedrock;
  - cut floors: horizon tint carried by soil micro texture, planar bedrock when deeper than ~1.4 m;
  - wet floors (darker, rougher→glossier) and small puddles in the deepest flats (roughness .07, flattened normal);
  - ejecta clods in a ring just outside cuts; flattened/darkened grass ring;
  - edge breakup: mid-frequency fray on path/disturbed borders + turf-lip darkening on the soil side; planar bedrock blended into slope/deposit stone.
* Feature switches (uniforms, no recompile): `orchard.setFeatures({strata, wet, ejecta, edges})` (0/1). Constructor: `deformation: false`, `features: {...}`. Quality: high 384² field + triplanar, medium 256², low 192² single-axis.
* New API: `setFeatures`, `flushDeformation()` (loading/tests only), `stats().deformation {enabled, reason, strata, size, pending, queuedRects, lastStepMs, maxStepMs, cpuMs, texels, uploads, features}`, exports `TERRAIN_FEATURES`, `DEFORM_JOB_BUDGET_MS`; `createOrchardGroundMaterial({strata})`.

## Test commands
```
node multiplayer/tests/terrain-presentation.test.mjs          # ~0.7 s
node fixture/capture.mjs "variant=ref" "variant=new"            # before/after captures -> shots/
node fixture/capture.mjs "variant=new&quality=low&tag=low" "variant=new&deform=off&tag=off"
python multiplayer/assets-source/terrain-strata/generate_terrain_strata.py   # ~12 s
```
Capture server: 127.0.0.1:5291 (not 8787/8788/5178). It launches a private-profile headless Edge and kills only that process tree.

## Measured results (this machine, SwiftShader CPU WebGL2 in headless Edge; Node 22 for unit tests)
| Item | Value |
|---|---|
| Unit tests (`terrain-presentation.test.mjs`) | 9/9 pass, 0.67 s wall |
| Deformation field, fixture (11 edits, high 384²) | 15,481 texels, drained in 6–7 frames via `update()`; mean 1.41 ms/frame, max 2.0 ms (SwiftShader page, mask+deform together) |
| Node `update()` drain | 6 frames, max 1.78 ms/frame (mask+deform+rest of update) |
| Worst case 64 overlapping r6 edits | 175–212 steps, max single step 1.55–1.91 ms (target 1.5; overshoot = one 8-texel check interval under JIT/GC jitter), 264–321 ms total CPU spread over frames |
| Shader compile | 0 program errors at high (strata 2), low (strata 1), off (strata 0) in WebGL2 |
| Disposal | after `dispose()`: renderer textures 12→3 (high), 10→1 (low); programs 4→1; ground material restored; node test checks every owned texture fires `dispose` and dispose is idempotent |
| Extra draw calls / lights / meshes | 0 / 0 / 0 (all work inside the existing ground material; `addedDrawCalls` unchanged at 3) |
| New texture download | `terrain_strata_albedo.png` 317,119 B + `terrain_strata_normal.png` 406,435 B = 723,554 B (≤ 4 MB budget). GPU: two 512² RGBA8 + mips ≈ 2.8 MB; deform field RGBA16F 384² = 1.18 MB (256² 0.5 MB, 192² 0.3 MB) |
| Texture generator | 12–17 s, deterministic (fixed seed; sha256 printed) |
| Capture run | ~3–6 s per variant page |
| Extra fragment cost | Not measured on a real GPU. Undeformed pixels pay one extra half-float fetch + the fray noise; deformed pixels add 4 (triplanar) + 2 (bedrock) fetches inside a branch; low quality uses 2 + 0. Root should profile on target GPU/VR. |

## Screenshots (`shots/`)
* `contact-sheet.png` — top: Sunder ref | new; middle: Lower crater ref | new; bottom: new high | new low trench crops.
* `ref-*.png` (v1) vs `new-*.png` (v2), views: `ground` (FPS eye), `elevated` (RTS orbit), `sunder` (dramatic low profile across the trench), `crater`, `raise`.
* `new-low-*` (quality low), `new-off-*` (deformation:false → v1 look), `new-edgesonly-ground` (strata/wet/ejecta off), `new-nostrata-sunder`, `diag-strata-off-vs-on.png`, iteration crops `compare-sunder-crop.png`, `iter3-sunder-crop.png`.
* Note: the white blobs at the top of `*-elevated.png` are the backdrop/sky being clipped by the fixture camera's 180 m far plane at RTS height. They are the same in ref and new (a fixture/game-camera matter, not part of this lane).

## Visual iteration log (inspected every render)
1. First kit: bedrock read as a brick grid, ochre subsoil too saturated, pebbles looked like polka dots. → Muted palette, smaller lower-contrast pebbles, then warped periodic Voronoi fracture blocks with per-block facet tint/tilt and gated cracks.
2. Crater floor showed the 4×1.6 m bedrock repeat. → Bedrock planar UVs rotated and warped. Clay ring too pale → floor tint reduced.
3. Raise mound showed a grey rock band high on the flank. → Raise depth compressed ×0.7 so mounds read as loam/subsoil, with rock only low on steep walls.
4. Glittery lit trench walls → strata normal strength 7→3.5 in the kit, shader relief 1.3→0.45, inherited slope normals damped on faces. The diagnostic (`diag-strata-off-vs-on.png`) shows the remaining sheen also appears with strata off, so it is inherited v1 soil normal/grazing-sun behaviour.
Result: v1 rendered grass on the floor of a 2 m Lower crater, and Sunder walls as uniform brown. v2 shows a turf lip, loam/subsoil/clay/gravel horizons at true world heights, a bedrock floor, wet darkening with small puddles, and an ejecta ring.

## Known limitations / follow-ups
* Strata read best on Sunder/Lower/Wall (slopes ≥ ~20°). Starfall (r5, −1 m, ~17°) shows mostly loam/subsoil floor plus wet.
* The v1 "disturbed" mask (rim churn) still paints a broad brown disc around craters. I kept it unchanged to preserve the mask job and byte-identical parity. Root may want to narrow the `bakeDisturbedChannel` band later.
* Remaining specular speckle on sunlit soil slopes is inherited from v1 (see diagnostic). A follow-up could reduce `orchard_soil_normal` strength on slopes.
* Field resolution 0.31 m (high). Very thin features below that soften. Displacement stacks beyond half-float precision are irrelevant at game scale.
* Puddles use the scene environment map (RoomEnvironment) for reflection, so they read as neutral glossy patches rather than sky mirrors.
* Not validated: real GPU frame time, VR comfort/scale, Godot import (no GLB asset in this lane; the deliverable is a shader/runtime module plus a PNG kit), Vite build/asset-dependency test of the real project.
* `classifySurface`/`contact()` (footstep puffs/material) are deliberately unchanged, so footsteps on strata faces still classify by v1 slope/mask rules.

## Ownership / safety
Only this folder was written. `spell-presentation.js`, shared simulation, game.js, colliders and worldgen are untouched (game.js needs only the one-line `baseHeight` option above). The live game's `public/assets` was read-only, served to the fixture for meadow/soil textures. The shared `node_modules` junction was read-only. No API calls, installs, Godot imports or GPU use: Edge ran SwiftShader with a private temp profile, and only processes matching that profile were stopped.
