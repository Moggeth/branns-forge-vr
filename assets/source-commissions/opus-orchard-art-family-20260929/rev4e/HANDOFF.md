# Orchard rev-4e: raised-path simplification (Opus, claude-opus-5-5): NOT previewed, NOT seen in game
1. Changed file: `output/orchard_kit/orchard_ground_visual.gdshader` only → copy to `godot/assets/orchard_kit/orchard_ground_visual.gdshader`.
2. Cause of the rev4d stripes: the patch/crack noise was sampled in slope-aligned coordinates (`q` from the per-fragment normal), which drew parallel contour bands.
3. Change: the body of `if (lifted > 0.0 && path > 0.03) {…}` is replaced. There is no `q`, no slope axis, no cells and no cracks; everything is world-space isotropic noise only.
4. The old path (`m.r`) now fades smoothly under lifted turf: `path_keep = mix(1, remnant*0.75, path_lift)`. `path_lift` grades with heap height (exposure B) plus broad noise.
5. `remnant` is a single broad (~6-8 m), soft-edged noise blob field. A few irregular old-tread patches survive at 75 % strength; everything else is turf.
6. Faint, sparse soil spots (`path_rubble` ≤ 0.45) appear where tread was lost. The subtle foot tear is the existing rev-4 heap rim (exposure block, unchanged).
7. Outside lifted ground the path is identical (`path_keep = 1`). Uniforms, the `exposure_tex`/`macro_mask` contract and the texture read count are unchanged. ALU is lower than rev4d.
8. `path_crack` stays 0 and `path_tone` stays 0.5 (a ×0.965 tone on remnants). They are kept only so the downstream lines compile unchanged.
9. QA: recapture 04/06 (eye + tactical). Expect a green raised mound with a narrow torn foot rim and a few soft brown remnants, and no stripes, net or outlines. The road should be unchanged off the hill.
10. If still unacceptable: revert to rev4b behaviour for this term by forcing `path_keep = mix(1.0, 0.0, path_lift)` (a clean fade). Accept or revert on the real capture.
