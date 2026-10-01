# Orchard tree and habitat uplift — 2026-10-01

Sonnet 5.5 owns the visual treatment; Codex integrates it with native Godot gameplay. Personal Claude.ai subscription and actual claude-sonnet-5-5 session model verified. The initial artist run (480.415 s) and finalize run (180.441 s) both reached their process time caps; usable source and a written handoff were recovered and independently tested. No fallback model or API billing.

## Tree implementation

Installed source: godot/tree_kit.gd. Procedural, editable branches, flared roots, layered leaf sprigs and bark shading; no new texture imports. Native near trees retain Crown/Trunk/Far/chop metadata and reachable apple placements. Orchard groves use shared cached mesh variants, 64 m chunks, close dappled shadows, near/far LOD and uncapped distant visibility. Canonical render seeds, yaw and scale survive conversion to choppable timber. Fallen canopy shadows use the actual split mesh.

## Verification

Tree forms: 0.309 s, 4 seeds and 5 forms passed. Tree cutting: 1.330 s, three-hit felling, stump, physical log, explicit pickup and resource claim passed. Apples: 10.714 s, 15 checks, 271 fruit, shoot/detach/grab/eat behavior passed (existing two ObjectDB exit leaks remain). World Builder: 11.103 s, shared-world worker harvesting, Hero chopping, save round-trip and pane-relative quality passed.

World Builder's old quality fixture expected a fixed 640x400 surface; current dual-view panes have dynamic sizes. Assert half/full of the current pane and explicitly settle the debounced resize before testing. This changes the diagnostic, not player resolution.

Native review: godot/orchard_tree_review.gd, offscreen/no-focus, save isolated. Run the bundled Godot with --xr-mode off --audio-driver Dummy --path godot --script res://orchard_tree_review.gd --quit-after 2400 -- --world-builder-preview --landscape-seed=290929 --review-output=<absolute output directory>. Captures include tree ground/RTS, paths/banks, cut progression, stump/log, and standalone specimens. Render snapshots are diagnostic counts, not proof of VR framerate. Reports are under outputs/orchard-tree-review/.

## Artist source

assets/source-commissions/sonnet-orchard-hero-20261001 preserves briefs, handoff, model/timing metadata and patch provenance. The installed GDScript is the canonical editable generator; historical patch scripts are provenance, not an idempotent rebuild interface. Generate instances directly through TreeKit APIs.

## Visual iteration and rendering cost

Sonnet's 27.015 s follow-up tightened the disconnected outer leaf sprays without changing seeds or card counts. Final tree/habitat native review completed in 21.436 s with 12 captures and no script/shader errors. The artist's habitat commission completed in 280.609 s with final model metadata verified.

A 60-tree, 1200x750 native Mobile-renderer fixture on the RTX 3080 Ti measured median GPU tree cost of 0.278 -> 0.685 ms near and 0.061 -> 0.088 ms far, old -> new. Four visible draw calls in every case. The diagnostic ran in 2.202 s; it is an isolated mono comparison, not the full Orchard, headset, or dual-view performance promise. Run godot/orchard_tree_gpu_check.gd graphically with --baseline-script=<absolute old TreeKit script>, exported from 8eb84cb:godot/tree_kit.gd. JSON and four images are under outputs/orchard-tree-gpu*.

New habitat decoration added 3–8 draw calls across the matched actual-world captures (for example placed ground 729 -> 737). Tiny additions are shadowless and distance-culled; all are batched by asset/chunk.

## Habitat implementation and checks

Sonnet authored root-margin litter/tufts/twigs/ferns, sparse path shoulders and river-field-based bank runs/gaps. Independent random streams preserve existing gameplay rock placement. Warm compressed-earth path centers transition through ragged shoulders; damp banks use subtle moss, silt and gravel rather than glossy uniform mud. Weather/exposure bindings remain intact.

orchard_habitat_checks passed headless (1.162 s) and native offscreen (2.593 s). Across low/high quality: root-base props 1002/2285, path-edge props 89/104, bank props 30/108. Deterministic duplicate builds match, budgets stay bounded, water/path exclusions and address metadata pass, and native transform readback confirms route clearing actually hides a prop. No new decorative collisions were added.

Remaining limits: distant LOD deliberately simplifies leaves; the tree remains stylized. Full-world VR playtesting is still needed. Existing apple fixture reports two ObjectDB exit leaks. Native screenshot readback creates diagnostic hitches and must not be confused with player frame time.

## Live river-material binding

Bank art and material now consume the same river distance/width fields. A separate filtered 128² L8 texture overrides only the shader's bank channel; CPU sampling uses matching bilinear filtering. The original 512² authored mask is untouched, and saved path reload cannot erase live bank state. Setup computes once; accepted hydrology updates use water_dirty bounds; unchanged regions skip the texture upload.

The first integration rewrote the 512² mask and measured 189.494 ms initial / 15.356 ms local. It was replaced before release: final graphical measurements are 11.403 ms initial / 0.984 ms local (16,384 initial texels, 451 changed local texels). Headless and native Vulkan binding checks pass, including source-image/CPU and GPU texture readback agreement. Final combined 12-view native review took 21.647 s with no script/shader errors. Exposure checks passed in 0.398 s.
