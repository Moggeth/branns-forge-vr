# Material refinements handoff (Opus 5.5, 2026-10-03)

Deliverable: `output/material-refinements.js` (materials and shaders only; no changes to geometry, API, positions, instancing, damage or budgets).

## Integration (root)
- `crystal-wall.js`: after `mats` is created, call `applyCrystalMaterial(mats.core,'core'); applyCrystalMaterial(mats.pale,'pale'); applyCrystalMaterial(mats.rock,'rock');`. The function sets colour, emissive, roughness and metalness, chains any existing `onBeforeCompile`, and appends `|crystal-<kind>-v2` to the cache key.
- `mountain-arena.js`: replace the `MOUNTAIN_ROCK_GLSL` export with the one in this file, keeping the same `mountainRock(vec3 w, vec3 n, vec3 tint)`. Bump `MOUNTAIN_ARENA_VERSION` and the ground key `mountain-ground-v1` so cached programs refresh.

## Shader chunks
- **Crystal vertex** (after `begin_vertex`): `vCrysLocal = position` and `vCrysMetric = position * |modelMatrix cols| * |instanceMatrix cols|` (instancing is handled with `#ifdef USE_INSTANCING`). Patterns stay fixed to each crystal and match between the instanced batch and loose debris meshes.
- **Crystal fragment** (after `emissivemap_fragment`, where `normal`, `roughnessFactor` and `totalEmissiveRadiance` already exist):
  - darkened prism edges, using an angular facet distance with sides = 5 for core and 6 for pale (matching crystal-wall shapes);
  - noise-isoline veins and hairline inclusions, at roughly 10–25 cm scale, so a facet 0.9 m away is no longer blank;
  - faint growth striations;
  - a darker rooted base;
  - a view-dependent dark refracted rim;
  - emissive limited to a face-on luminous core, suppressed on edges and veins.
  - Roughness is 0.06–0.6 and metalness is 0. Everything is opaque, with no textures, uniforms or lights.
- **Rock plinth**: slate variation plus sparse teal flecks.
- **Mountain**:
  - large-scale granite and sandstone rock bodies, with iron staining;
  - dipping beds reduced to about ±7% (previously a full-contrast band);
  - jointed blocks, vertical clefts and dark seep streaks on steep faces;
  - pale dust on ledges;
  - moss at the foot (y < ~6.5) and in low clefts, plus lichen patches.
  - Snow line raised from 18.2 to ~22.5, limited to up-facing ledges, broken by noise and kept out of clefts; summits get thin caps only.
  - All helpers use the `mtn` prefix; no orchard identifiers are used.

## Verification
- `node output/check-materials.mjs <multiplayer dir>` against installed three r186: all checks pass. Covered: anchors patched for every kind; `normal`, `roughnessFactor` and `totalEmissiveRadiance` declared before use; vertex injection after `transformed`; cache keys; mountain signature, prefixes, unique locals and no orchard references.
- **Not verified:** actual GLSL compilation (no glslang or WebGL available in this folder), browser or mobile appearance, performance, and the snow-line height against the real summit Y range (if summits sit below ~22 m there will be almost no snow; lower `mLine` if needed). The edge-angle assumption only holds for the current `unitCrystal` vertex angles. Root should compile in the browser and take before/after captures of the 0.9 m wall view and the arena view.
