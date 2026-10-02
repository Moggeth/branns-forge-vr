# Ground material v3 polish: handoff (Opus 5.5 lane, 2026-10-03)

Status: done for this bounded pass. Measured time: 07:24:08 → 07:28:13 Sydney for the tooling (4.1 min by the folder clock, logged in `logs/work-timing.csv`), plus write-up. **Not integrated. No real GPU, real-game or headset acceptance.** All images are SwiftShader CPU WebGL2 renders in headless Edge.

## What changed
I only changed `multiplayer/client/orchard-presentation.js`, at the same path as before. The changes are shader constants inside the existing ground material. There are no new uniforms, textures, programs, meshes, lights, draw calls or APIs, and no geometry or gameplay changes. Mask/classification code, the deformation field, job budgets and textures are unchanged; `terrain-deformation-field.js` is byte-identical to the baseline. CRLF line endings are kept.

The fix targets the inherited micro-normal glitter and pitted stipple:

| Area | Before → after | Why |
|---|---|---|
| Grass normal | strength .6 → .3, sampled with +1 mip bias | Blade relief at full res + grazing sun = the crunchy gravel look |
| Soil / stone normal | ×1.0 / ×1.4 → ×0.5 / ×0.6 | Glitter on cut walls and slopes (the "inherited v1" sheen) |
| Micro-normal distance fade | 1→.35 over 18–70 m → 1→.25 over 6–40 m | RTS/elevated shimmer |
| Strata relief | fade 1→.45 → .75→.3 (8–45 m) | Lit trench walls sparkled |
| Dry roughness | new floor `max(r, .86)` after stone; stone .72 → .82 | Matte dry ground. Wet (.42 → .55) and puddle (.07) are applied after, so only depressed floors go glossy |
| Grass albedo | near detail contrast .7 → .5 (fade from 6 m), +.7 mip bias | Removes per-blade speckle |
| Broad colour | macro 0.9+0.2·n → 0.84+0.3·n + 0.14 drift at 18 m wavelength | Variation now comes from low-frequency drifts, not fine noise |
| AO / height darkening | ORM AO .55 → .28; soil height .8+.4b → .88+.24b | Dark pits |
| Exposed stone | saturation .35 → .45, brightness .75+.5b → .72+.3b | Pale speckled stone patches on mound flanks |
| Cut floors | horizon gain .74 → .62; bedrock floor ×(.76,.74,.72) | Pale clay ring and a glowing bedrock disc in craters |

Reproducible patch record: `fixture/apply_v3_tuning.py`, `apply_v3_iter2.py`, `apply_v3_iter3.py`, `apply_v3_iter4.py`. They are exact-match replacements that refuse partial application, applied in order to the baseline in `reference/base/client/`.

## Integration
Copy `multiplayer/client/orchard-presentation.js` over the baseline v2 module (the one the previous handoff `BASELINE-HANDOFF.md` delivered). No other file changes. The `game.js` `baseHeight` patch is the same as in that handoff.

## Evidence (in `shots/`)
- Matched before/after sheets (`base` = frozen baseline v2, `new` = v3). The camera, lighting and fixture are identical in each pair.
  - `compare-base-vs-v3-a.png`: eye-level ground, undeformed meadow, Sunder.
  - `compare-base-vs-v3-b.png`: crater, elevated/RTS, high-orbit meadow.
  - `compare-base-vs-v3-low.png`: low quality crater, Sunder, meadow.
- Full-size images: `base-*.png` / `new-*.png` (views: ground, elevated, sunder, crater, meadow, meadowhigh, raise), `*-low-*`, `new-off-*`, `new-medium-sunder.png`.
- `v3-metrics.json` covers the lower (ground) half of each frame. `hf_std` is the std of luminance minus a 5×5 blur, i.e. fine stipple energy. `hot_px` is luminance > .75.

| View | hf_std base → v3 | hot px | mean L |
|---|---|---|---|
| meadow (undeformed, eye) | .0790 → .0500 (−37%) | 0 → 0 | .242 → .255 |
| ground (eye) | .0334 → .0171 (−49%) | 0 → 0 | .235 → .246 |
| sunder | .0748 → .0397 (−47%) | 100 → 0 | .198 → .220 |
| crater | .0609 → .0255 (−58%) | 55 → 0 | .185 → .201 |
| elevated / RTS | .0118 → .0054 (−54%) | 0 → 0 | .216 → .221 |
| low: meadow / sunder / crater | −65% / −44% / −60% | sunder 142 → 0, crater 26 → 0 | +.01–.03 |

Fixture changes are fixture-only. `variant=base` serves `reference/base/`. Two views were added: `meadow` (eye-level, undeformed) and `meadowhigh`. Helpers `fixture/sheet.py` and `fixture/metrics.py` were also added.

## Regressions run
- `node multiplayer/tests/terrain-presentation.test.mjs`: **9/9 pass**, 0.67 s. This includes the golden field checksum and byte-identical v1 mask/classification parity. That parity test needs `reference/multiplayer/client/orchard-presentation.js`, which was missing from this sprint copy. I copied it read-only from the live `multiplayer/client/` (v1, no deformation import).
- Shader compile in the browser: 0 errors at high (strata 2), medium (2), low (1) and `deformation:false` (0). The node test also covers patch anchors for every quality/strata level.
- Disposal is unchanged from the baseline: textures 12→3 (high/medium), 10→1 (low), 9→3 (off); programs 4→1; ground material restored.
- Draw calls: 1 in the fixture, same as the baseline. Job drain max step is 1.9–2.0 ms in the SwiftShader page, same as the baseline.
- Cost: four `texture2D` calls gained a bias argument and there is one more value-noise evaluation. There are no extra fetches and the low-quality path is still cheaper than high. Real GPU cost was not measured.

Commands:
```
python fixture/apply_v3_tuning.py ... (already applied; for record only)
node fixture/capture.mjs "variant=base" "variant=new" "variant=base&quality=low&tag=low" "variant=new&quality=low&tag=low"
python fixture/sheet.py shots/compare-base-vs-v3-a.png ground,meadow,sunder base new
python fixture/metrics.py
node multiplayer/tests/terrain-presentation.test.mjs
```

## Known limits
- The crater still has a lighter bedrock disc and a soft rim sheen where the Sunder wall meets the wet floor. Both are much reduced but not gone, and the disc partly reflects RoomEnvironment through the puddles. A darker bedrock row in `terrain_strata_albedo.png` would be the next step. I did not regenerate the kit.
- Pebbles on worn paths (`ground` view) come from the live `orchard_soil_albedo.png`. They are softened by the AO/height change but still read as discrete dots near the eye. Changing that means editing the shared v1 soil texture, which is outside this pass.
- The broad brown "disturbed" disc around craters is the unchanged v1 mask. It is left as is to preserve byte-identical parity.
- The ground is about 4–8% brighter on average because the AO/pit darkening was removed. Root may want to check this against the real game's exposure and grade.
- The fixture's sun and hemisphere lights only approximate `game.js`. Grazing-sun glitter must be confirmed in the real game on a real GPU, and in the headset, where per-eye mip selection differs.

## Ownership
I wrote only inside this folder: the module, `fixture/`, `reference/`, `shots/`, `logs/` and this file. There was no git, network, API, install or Godot use. Edge ran with a private temp profile and only that profile's processes were stopped. The modified `game.js` and `spell-presentation.js` in the parent checkout belong to other lanes and were not touched.
