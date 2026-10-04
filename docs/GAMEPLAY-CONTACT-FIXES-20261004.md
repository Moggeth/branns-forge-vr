# Roots, Phoenix contacts, golden bolts and first-use preparation

Engineering pass on 2026-10-04; base main 4b0ba8c, isolated branch codex/gameplay-contact-fixes-20261004. Original checkout and unrelated assets preserved. No new art commission: existing authored art and render paths reused.

## Behavior and causes

- Stumpling burrowing previously removed the harvest record, restoring the deterministic tree at its original seed position (reproduced 5.58m away). Optional bounded treeRoots overrides now store exact x/z and retain stable IDs. Shared world content, collision index, orchard masks and save/reload use them; Ent awakening transfers ownership. Old saves remain valid.
- Phoenix curved aim had a deliberate 0.035-radian dead cone. A shared bow-shot helper now uses atan2 rotation vectors continuously through zero for both preview and release, with the existing 1.1-radian cap.
- Phoenix scenery hits previously added ground fuel immediately. Elevated impacts now retain surface position/normal for four seconds and emit a bounded delayed ground ignition when the floor is near enough. Creature fire continues to follow the existing struck-part attachment. World patches remain world-space; this is not a new attachment system for moving scenery.
- Golden embedded Siegebird bolts enter the same collection selector, highlight, E/Collect and touch hit path as other items. Authoritative removal grants exactly one refined gold, respects reach/terrain visibility/inventory cap and prevents replay or duplicate collection. Flying bolts and ordinary bolts cannot be collected for gold. Moving actors use the shared anatomical reach envelope; detached remains use their rotated local contact.
- Standing trees only warm instanced materials. First damage previously added non-instanced bark/endcaps, chips and hidden canopy effects after play began. Startup now prepares those real materials/geometry across all three variants. Fire prepares its four hidden material/buffer paths offscreen. Mining retains at most 12 nearby fracture partitions and their warm materials until world disposal. No quality, tick-rate or art reduction.

## Evidence

- Required automated suite: **164/164 passed**, 100.561 seconds (logs/gameplay-contact-ci.log).
- Production-module build check: 0.859 seconds. Existing large-chunk advisory remains.
- Browser startup: 11.962 seconds, ready at 11.225 seconds, no errors, no XR, no mouse capture. Three tree variants, 24 temporary geometries, five pools and 12 mining partitions prepared. Tree preparation 5.90ms; mining preparation 88.20ms on this browser. These are loading costs, not claimed frame-rate improvements.
- CPU fixture measurements from actual assets: mining uncached 16.89ms versus retained attachment 0.37ms; tree subsequent notch 1.10ms. GPU frame-time improvement and physical phone/headset acceptance are unmeasured.
- Regression coverage: 201 small-angle preview/release/flight samples; golden reward/cap/range/role/terrain occlusion/replay/save; exact Stumpling root/save/collision/chop; fire surface/drop/quench/deformation/budget/save; warmup cleanup and borrowed-resource ownership.
- Browser collection integration: 10.156 seconds; visible golden embed selected, actual game.interact dispatch accepted, +1 gold, embed removed and highlight cleared, no console errors.
- Browser evidence and screenshots: ignored logs/contact-startup-browser.*, logs/contact-collection-browser.*. Browser fixtures use the guarded acceptance launcher; native pointer capture and WebXR are disabled and browser is closed in finally.

## Measured steps and lessons

Task start 10:26:07 UTC. Discovery and bounded implementation through initial integrated acceptance checkpoint at 10:39:32 UTC: 805 seconds, overlapping delegated work. Focused aim/collection/lumber checks: 0.414s; new aim/gold tests: 0.316s; Stumpling focused check: 2.608s; fire warmup/performance/storage: 4.124s; final tree/mining focused checks: 0.562s. Identity/private-repo validation plus branch push: 3.409s. Full build/suite/browser timings above are measured tool or monotonic runtime outputs, not estimates.

- Do not assume compileAsync(scene) warms idle-hidden effects or non-instanced damage variants. Include actual representative geometry, texture upload, and a render pass; keep materials alive until their warmed programs have live owners. Never emit fake simulation effects to warm visuals.
- Golden collection reuses an existing embed identity rather than creating a second redeemable pickup. Save tests must verify consumed embeds cannot reappear.
- Node CPU fixtures do not prove GPU hitch elimination. Use renderer startup diagnostics and an actual browser; keep physical-device limits explicit.
- One CI invocation redirected to ../../logs from multiplayer and never ran because the directory did not exist (0.207s). Correct path is ../logs; use ErrorActionPreference=Stop so failed redirection cannot look successful. Likewise root commands use logs/, not ../logs/.
- Browser synthetic route fulfillment changed the fixture network context and triggered Chromium local-network restrictions for Vite HMR (9.882s failed check despite correct collection). Serve a real temporary fixture from Vite instead; wait for networkidle after creation because HMR can reload it (first attempt 0.817s). Corrected fixture passes and is deleted in finally. Do not disable browser security to hide the error.
- Use rg --files before guessing paths; Windows positional globs are not expanded. Two stale extra tests were reproduced or identified as existing exclusions: ents assumes five grove trees instead of adaptive four; creature-state expects obsolete torso scorch. Existing fire-presentation also needs an absent optional asset-lab validator; standalone fire-warmup covers new preparation without it. No required test was excluded.

## Run and inspect

From multiplayer: node tests/ci.mjs and npm run build:check. Focused tests are phoenix-aim-continuity, golden-bolt-collection, stumplings, fire-spatial-phoenix, fire-warmup, tree-harvest-warmup and mining-warmup under tests/.

Read-only browser diagnostics: document.querySelector('canvas').brannDiagnostics().startup includes treeHarvestWarmup and miningWarmup measurements and an error field. A warmup failure is reported rather than silently presented as successful preparation.
