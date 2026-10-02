# Meteor and resource geology kit: handoff (Opus 5.5, 2026-10-03)

All work stayed inside this isolated folder. No game, lobby or shared-simulation files were changed, and I made no git, network, API or paid-service calls and installed nothing. The `node_modules` junction and the asset-lab `gltf-validator` were only read. I did not run Godot.

## What this kit fixes / adds
- **The transparent-front-face bug is fixed by construction.** The reference `meteor.glb` was one `doubleSided` material with no textures (640 tris), and its base sat 0.25 m below its origin.
  - Every rock here is a **single closed, star-shaped shell**: an icosphere where each vertex direction keeps exactly one radius.
  - Fracture cuts, strata ledges, recessed seams, struck faces and the flat base are all radial edits, so the shell cannot fold, open or self-flip.
  - Crystals are separate closed star-section prisms whose bases are buried inside the rock.
  - All materials are **opaque and single-sided**. Blender's `recalc_face_normals` is applied as a belt-and-braces step.
  - The independent verifier proves the results; see "Verification" below.
- **Meteor.** Opaque iron fusion crust with regmaglypt "thumbprint" pits and rust bloom, silver flecks on the ridges, and jagged fracture facets.
  - Three **recessed glowing star-seams** (emissive 3.2) run across it.
  - A **pick-struck front facet** (it faces -Z, toward an approaching player) exposes dark crystalline interior with conchoidal facets, star-iron flecks and violet glints.
  - A **six-crystal star-gem cluster** bursts out of that facet. Smaller star-gems erupt from the seams, and three crust ejecta crumbs sit at the base.
- **Star-gems are five-point star-section crystals** (10-sided star prism with a faceted termination). They shade deep violet at the root, through ice-cyan, to a gold tip, and have internal fracture planes and four-point glints. They read as cut treasure, not glowing spheres, and they are visibly embedded.
- **Three stone deposit variants.** All three are stone (`kind:'stone'` still yields stone), so they carry no emissive and stay readable as not-gems.
  - `boulder`: layered sedimentary outcrop with overhanging strata ledges and a worked face.
  - `boulder_b`: tall, jagged, tilted-strata outcrop with 12 fracture cuts and quartz/iron veins.
  - `boulder_c`: low, wide cleaved boulder with a deep vertical cleft.
- **Harvested resources:**
  - `star_gem_meteoric` (0.28 m): a hero star-gem plus two satellites, gripped by a crust shard with a glowing seam lip. It is an alternative to the accepted `star_gem`; it does not replace it.
  - `star_iron_ore` (0.20 m): a dense struck lump, half crust and half bright worked iron, with a glowing seam.
- **Optional extras:**
  - `stone_chips`: three tiny closed shards (240 tris) for the impact/magic lane to spawn if it wants them. I did not edit the spell module.
  - Staged damage `meteor_worked1/2` and `boulder_worked1/2`: extra struck faces expose more interior/crystal. They are usable only through the optional patch below.
- **LODs:** `*_lod.glb` for every asset (≤1.5k tris).

## Files
| path | what |
|---|---|
| `build_geology.py` | deterministic Blender 4.5 builder (textures, meshes, materials, GLBs, renders, contract, .blend) |
| `verify_geology.py` | independent numpy GLB verifier (closure, winding, normals, rays, budgets, COLOR_0, axes) |
| `validate_gltf.cjs` | Khronos glTF-Validator runner (read-only shared module) |
| `out/glb/*.glb` | 17 self-contained GLBs (embedded JPEG maps) |
| `out/source_geology.blend` | editable scene, maps packed (base assets; variants rebuild from the builder) |
| `out/textures/geo_albedo.png` (1024), `geo_normal.png` (512) | the shared atlas: TL meteor crust, TR deposit stone, BL star-gem, BR worked interior |
| `out/geology_contract.json` | per-asset tris/materials/bytes/bbox/dimensions/build time, conventions, timings |
| `out/verify_report.json`, `out/gltf_validator_report.json` | check outputs |
| `out/contact_sheet.png` | top: FPS eye-height lineup (1.65 m); bottom: RTS high angle |
| `out/closeups_sheet.png`, `out/renders/` | meteor struck face, meteor seams side, boulder worked face, meteoric star-gem, **meteor cross-section**, boulders B/C |
| `logs/` | build logs, `work-timing.csv` |

## Exact commands
```
"C:/Users/mog/OneDrive/Documents/Coding/Personal/Python/things_are_different_now/branns-forge-vr/tools/blender-4.5.13-windows-x64/blender.exe" --background --factory-startup --python-exit-code 2 --threads 2 --python build_geology.py -- --out "C:/Users/mog/OneDrive/Documents/Coding/Personal/Python/things_are_different_now/branns-forge-vr/work/opus-sprint-mining-geology-20261003/out" --samples 16
python verify_geology.py out
node validate_gltf.cjs out
```
- `--no-render` skips the Cycles renders: GLBs, contract and blend only, 4.1 s wall.
- `--out` must be absolute.
- Rendering is Cycles CPU, 2 threads.

## Contract (preserved)
- Metres, +Y up, -Z front, origin at the bottom centre (min y = 0, verified). Root, `Grip` and `ResourcePivot` empties are in every GLB, matching the accepted resource kit's convention.
- **Runtime template names are unchanged: `meteor` and `boulder`.** `world-content-view.js` `authored(name, size)` rescales by bounds height and re-centres the bottom, and strips `colonly` nodes. This kit has none: no helper occluders and no collision boxes. Every visible mesh *is* the raycast surface.
- Authored heights are close to the runtime target, so scale stays near 1 and VR scale is honest:

  | asset | authored W×H×D (m) | runtime height | runtime scale |
  |---|---|---|---|
  | meteor | 2.18×1.59×2.21 | 1.5 | 0.945 |
  | boulder | 1.90×1.12×1.55 | 1.2 | 1.07 |
  | boulder_b | 1.38×1.21×1.27 | 1.2 | 0.99 |
  | boulder_c | 1.99×1.18×1.57 | 1.2 | 1.02 |

  The meteor's runtime footprint is about 2.06 m wide, against about 2.0 m for the old meteor, so spawn size is not broken.
- **Visible hit points:** the server accepts a pick hit only within **1.5 m horizontally** of the deposit and **±2 m vertically** of terrain (`simulation.js` L231). Ray battery: 96 outside-in rays per asset, mimicking `THREE.Raycaster.intersectObjects(targets, true)`. Maximum horizontal hit radius at runtime scale:

  | asset | max hit radius (m) |
  |---|---|
  | meteor | 1.011 |
  | meteor_lod | 1.039 |
  | meteor_worked1 / worked2 | 1.009 / 0.881 |
  | boulder | 0.997 |
  | boulder_b | 0.684 |
  | boulder_c | 0.992 |

  Every value is inside 1.5 m, and ejecta crumbs and crystals are included. The existing hit-shrink scale (`1 - hits/maxHits*0.15`) only reduces these values.
- `COLOR_0` is a linear multiplier holding AO, height light, scorch, moss and seam warmth. It is clamped to [0,1] and is not white-only: the white fraction is ≤ 0.018, and the verifier enforces the Forge Yard lesson. In Godot use `vertex_color_use_as_albedo=true`.
- Materials (shared names, ≤4 per GLB):

  | material | metallic | roughness | emissive |
  |---|---|---|---|
  | `GeoRock` | 0.15 | 0.86 | — |
  | `GeoInterior` | 0.55 | 0.42 | — |
  | `GeoStarGem` | 0 | 0.12 | albedo atlas as emissive map, `KHR_materials_emissive_strength` 1.6 |
  | `GeoSeam` | 0 | 0.30 | strength 3.2 |

  All four use the albedo and normal maps and are opaque and single-sided. Tangents are exported, so tangent space is explicit for three.js and Godot.
- Meteor warm-up: the template is still called `meteor`, so the existing `renderer.compileAsync(gltf.scene, …)` warm-up in `game.js` covers the new materials unchanged. No renderer or disposal code is affected.

## Budgets (measured, `out/verify_report.json`)
| asset | tris | mats | GLB bytes | LOD tris |
|---|---|---|---|---|
| meteor | 5800 | 4 | 949 416 | 1480 |
| meteor_worked1 / 2 | 5880 / 5960 | 4 | 954 360 / 875 164 | — |
| boulder | 5120 | 2 | 825 860 | 1280 |
| boulder_b | 5120 | 2 | 741 920 | 1280 |
| boulder_c | 5120 | 2 | 762 512 | 1280 |
| star_gem_meteoric | 440 | 3 | 257 028 | 160 |
| star_iron_ore | 1280 | 3 | 333 668 | 320 |
| stone_chips | 240 | 2 | 232 040 | — |

- Limits held everywhere: ≤6000 tris high, ≤1500 LOD, ≤4 materials.
- **Shared atlas:** about 188 KB embedded per GLB (two JPEGs, ~94 KB each), well under 4 MB. The source PNGs are 1.18 MB and 0.68 MB.
- **GLB size:** most bytes are geometry, because flat-shaded facets split vertices and carry normals, tangents, COLOR_0 and UVs. All 17 GLBs total 9.4 MB, but the integrated default set is only `meteor` + `boulder`, about 1.78 MB.
- **If size matters:** meshopt/Draco or the LODs are the root's call. Dropping tangents saves about 16 B per vertex but brings back the validator's generated-tangent warnings.

## Verification (actually run)
- `verify_geology.py out` returned **all_ok True**. Every one of the 17 GLBs passes all of these:
  - 0 open or non-manifold edges after position welding.
  - 0 inconsistent directed edges.
  - Every connected piece has positive signed volume, so winding is outward.
  - Stored normals agree with the winding on 100% of triangles.
  - **The rays hit 0 back faces.** Each outside ray's first hit is a front face, so backface culling can never show a see-through wall. The few "misses" are rays that pass beside the tiny pickups.
  - No double-sided or alpha materials, embedded images only, no cameras or lights, min y = 0, Grip and ResourcePivot present.
- `validate_gltf.cjs` (Khronos glTF-Validator) reported **0 errors and 0 warnings on all 17**.
  - The first run found real `ACCESSOR_NON_CLAMPED` COLOR_0 errors (values above 1) and generated-tangent warnings. Both were fixed in the builder by clamping colours and exporting tangents.
- **Determinism:** a second `--no-render` build into `logs/det_out` produced SHA-256-identical GLBs for all 17 files.
- **Visual review:** eight successful rendered builds (six review steps). What changed between them:
  - Pass 1→2: the interior had a concentric "fingerprint" pattern and was replaced by angular conchoidal facets. Struck faces became smaller. The stone went from a tortoise-shell crack pattern to strata bands with overhanging ledges. Meteor crystals were turned upright and made larger.
  - Pass 2→3: fixed smeared strata on top faces. Added a capped cross-section (bisect plus fill on a render-only copy) that shows a solid shell and cut star-gem bases.
  - Pass 3→4: re-proportioned the meteor and deposits so their runtime footprints match.
  - Pass 4→5: irregular per-band ledge depth, so `boulder` no longer reads as evenly stacked slabs.
  - Pass 5→6: widened the FPS lineup framing so no asset is cropped.
  - After the final build: validator 0/0, verifier all_ok, and determinism re-checked (0 hash differences).

## Measured times (`logs/work-timing.csv`)
- Session start: 06:56 local (taken from `.start_time.txt`, written by my first command).
- First GLB plus renders at about 6 min. The baseline handoff was written at about 15 min, and this final pass finished at about 19 min.
- Final full build: 54.0 s wall at 2 CPU threads.
  - Textures: 0.67 s. Per-asset build and export: 0.09–0.35 s.
  - Renders: 49.7 s for eight Cycles frames at 16 samples.
  - `--no-render` build: 4.1 s.
- `verify_geology.py`: about 6 s. Khronos validator: about 3 s.

## Integration notes for the root (nothing applied)
1. **Drop-in (no code):** copy `out/glb/meteor.glb` → `multiplayer/public/assets/meteor.glb` and `out/glb/boulder.glb` → `public/assets/boulder.glb`. Both templates are already loaded by name in `game.js`.
2. **Optional deposit variety:** a narrow patch in `world-content-view.js` L25, plus adding `'boulder_b','boulder_c'` to the `game.js` load list. It falls back to `boulder` until the variants load:
   ```js
   const bv=['boulder','boulder_b','boulder_c'][[...c.id].reduce((h,ch)=>(h*31+ch.charCodeAt(0))>>>0,7)%3];
   if(c.type==='deposit')root=authored(c.kind==='meteor'?'meteor':(templates.has(bv)?bv:'boulder'),c.kind==='meteor'?1.5:1.2);
   ```
3. **Optional staged damage:** the existing hook is `deposit.hits / maxHits` in the snapshot. When the stage changes, the patch re-instantiates the root with `meteor_worked1/2` / `boulder_worked1/2`:
   - Stage: `stage = hits/maxHits >= .66 ? 2 : hits/maxHits >= .33 ? 1 : 0`.
   - On a stage change, `remove(e.root)` and then do the normal create and `tag`.
   - `targets()` is rebuilt every call, so raycasts follow automatically, and the existing scale shrink can stay.

   This adds no mechanic and no state. It is untested in the browser, so I left it as a note.
4. **Optional pickups:** set `PICKUP_ASSETS.gems='star_gem_meteoric'` if the root prefers the meteoric gem over the accepted `star_gem`. Its contract matches: bottom origin, Grip, ResourcePivot, about 0.28 m tall versus 0.257. `star_iron_ore` has no pickup kind today, so it is reserved and adds no new mechanic. `stone_chips` is there for the impact/magic lane.
5. **LODs:** `*_lod.glb` are standalone and share material names. Hook them up only if a distance swap exists or is added (trees already use a `_lod` naming pattern).

## Known limitations (honest)
- I reviewed everything only in Blender Cycles renders (AgX). **There is no Godot capture, browser/three.js capture or headset check.** The root must confirm the following in real captures:
  - emissive strength in three.js (it has no bloom by default, so the seams will look flatter than in Cycles);
  - JPEG sRGB handling;
  - COLOR_0 multiplication in Godot.
- The ray battery is my own Python Möller–Trumbore re-implementation of the raycast, not a run of the actual `THREE.Raycaster`. Loading GLBs with embedded images in headless Node would need DOM image shims, which I did not add.
- The seams are selected per triangle, so they show a stepped, lightning-like edge at close range. This suits the jagged language, but it is not a smooth vein.
- `boulder`'s strata are fairly regular ("stacked slabs"). `boulder_b` and `boulder_c` break that up.
- The meteor's gem clusters near the seams sometimes read as pale shards rather than coloured crystals under strong sun.
- Per-face box-projection UVs, wrapped inside each tileable quadrant, can show slight texture discontinuities between adjacent facets. Flat shading and the facet language mostly hide this.
- The `.blend` keeps only the base assets visible; the worked/LOD variants are hidden objects. The builder is the source of truth.
