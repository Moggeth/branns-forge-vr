# Progressive Sunder and spatial spell targeting

Sunder now reserves its complete bounded edit set at cast acceptance, then deforms actual earth from the first endpoint to the second. Each edit keeps an optional rupture descriptor: id, 2D start/end, startTick and durationTicks. The 60 Hz authoritative clock drives smooth settling over a 1.1 metre trailing band. A 12 metre line completes in 72 ticks. Final edit heights remain permanent and cumulative terrain stays within the existing six metre cap.

No delayed edit insertion or client-only collision exists. Checkpoints and snapshots carry the same descriptor. Midway restores resume from saved tick; late joins reconstruct the active effect once from edits, and completed joins do not replay it. Legacy edits without descriptors remain fully settled. Restore rejects future starts, invalid coordinates/durations, non-collinear kernels and inconsistent descriptors for the same cast. Unknown fields are discarded.

## Integration contract

- All live surface queries must include the snapshot tick: terrainHeight({edits,tick},x,z,false). Missing tick intentionally means fully settled for old static consumers.
- Render earth with the existing 120 metre PlaneGeometry, 160 segments, rotated -PI/2. Shared triangle interpolation is exact for its Float32 vertices.
- terrainFrameKey(edits,tick) changes only while an affected kernel changes. Initialize the prior key to null, never the empty string (an empty-edit world also has an empty-string key).
- terrainDirtyEdits(previous,next,previousTick,tick) includes new, removed, changed and currently advancing kernels. Expand circles by .75 metre for neighbouring triangle support; refresh normals after vertex changes.
- orchard.groundChanged({edits,terrainTick}) updates temporal texture patches under the existing frame budget. It does not rebake the whole mask on every tick.
- createSpellPresentation receives tickSeconds:1/60 and getTerrainTick returning that same snapshot tick. Production additionally passes terrainGrid:true with the bare-earth height callback. This caches grid vertices and reconstructs exact shared triangles for markers; arbitrary custom height callbacks should leave this option off.
- World content sync reanchors ore, trees, crystal walls and only affected scatter instances. Initialize scatter terrain key to null so an untouched world gets its first transforms.
- Line marker previews should provide actual clamped start/end. For implicit six metre perpendicular casts, also send fallback:true so the preview uses three kernels. Explicit lines use ceil(horizontalLength/2.5)+1. XZ length, not vertical separation, governs authority validation.

## Art provenance and runtime

The spatial marker design was commissioned through scripts/claude_commission.py in isolated work/opus-world-targeting-20261003. Verified account fauxgrady@gmail.com, claude.ai Pro subscription, exact requested/init/final model claude-opus-5-5, HIGH effort, no API billing. Generation passed in 723.470 seconds. Original runnable sources, preview, handoff and non-secret verification metadata are archived at assets-source/spell-targeting.

Runtime client/spell-targeting.js supplies skull summoning seals, four squad locations, masonry golem glyph, raised/lowered contours, directional rupture corridor, volumetric wall, five planting sites for Grove, eight for Tree Ring, astral Starfall, Crystal Bloom, Healing Rain, Lightning and Frost Nova. Invalid styling changes both colour and broken line/X motifs. Reduced motion freezes decorative time and hides motes. Three preallocated geometry/material pairs replace the previous reticle allocation path.

Integration corrected the commission brief's stale Grove/Tree Ring positions to real world-content placement: five trees at radius 2.5, eight at radius 4. Added shared SPELL_TARGET_SHAPES, spatially bounded terrain invalidation, exact triangle height caching and malformed-coordinate rejection. Marker ghost heights communicate the nominal new mound/wall; existing cumulative saturation, protected mountain attenuation and bridge geometry are not simulated by the ghost volume.

## Verification and timings (2026-10-03)

- progressive-sunder.mjs: horizontal line validation; untouched endpoint before front; exact matching VFX front; midway migration; corrupt-save rejection; concurrent casts; cap rejection without edits/mana mutation; final-state equivalence; completed late join; rewind; ore anchor movement; initial scatter; bounded temporal soil updates.
- Actual Three downward rays at 42 locations across six rupture stages differ from shared terrain by at most 1.3545e-14 metres.
- spell-targeting.mjs: all 14 spells, valid/invalid, high/medium/low, sloped conformance, exact positions, invalid input, buffer/material reuse across 1,400 changes, temporal invalidation, disposal, real terrain at 64 edits.
- Marker maxima: high 3 draws/3,856 triangles; medium 3/2,532; low 2/1,166. No dropped strands. Cheap-height rebuild average .184 ms; real 64-edit moving-wall mean 1.337 ms, max 1.587 ms with warm grid cache. Without the cache, measured mean 7.656 ms/max 8.464 ms.
- Final parallel command wall times: progressive .406 s; targeting .536 s; presentation .495 s; spectacle .765 s (111 checks); terrain presentation .707 s; world content .202 s. All passed. Progressive temporal orchard frame max1.494 ms; existing 64-edit deformation budget max1.75 ms.
- Generation screenshots were inspected for overview, Sunder and squad. Actual integrated browser, touch-device and HMD acceptance remain the root integration owner's verification; unit timing is not a GPU frame-rate claim.
- Phase elapsed through documentation: 1769.102 seconds, including concurrent commission. Detailed command and commission records are in logs/work-timing.csv.

## Lessons retained

Use authoritative geometry, not old descriptive prose, when commissioning markers: the original brief incorrectly described three Grove trees. Tests must compare real shape contracts. A .bakes test assertion initially compared two undefined fields; it now checks the numeric maskBakes property. Empty-string terrain signatures need an explicit uninitialized sentinel. Full 64-edit height sampling per marker costs most of a desktop frame; cache vertices under the exact triangle contract and clear on temporal/edit changes. A suspected vertical-line validation defect was disproved: simulation's local distance helper is already XZ-only; a regression test records that behaviour. One command failed before execution due to a mistyped workspace path; use the exact project path from this document/task rather than reconstructing it.
