# Lumber collection and pickup marker

Browser contract (2026-10-03): `collectTarget` consumes the specified reachable loose log for one wood immediately. `nearestCollectible` is the shared selector for E, the cue and the marker: a held log first, otherwise the nearest eligible pickup/log, with ID ordering for equal distances. Full resource stacks and apples that cannot heal are excluded. Terrain visibility and capsule reach are checked by authority; the client may supply a further read-only visibility predicate against rendered scene occluders. Send the selected ID so an unseen nearer object cannot replace the highlighted item. Client-supplied amounts never change the reward.

`createPickupHighlight({scene})` owns one ring mesh, one shared material and no lights. `update(candidate, now, height)` moves it to the selected target, or hides it immediately for null/full/held targets. Call `dispose()` with the game. This small affordance uses the existing warm resource palette; actual phone and headset acceptance still needs playtesting.

VR reward: send `grab` with `{id, interaction:'vr-grip', hand:1}` after updating tracked poses. The host requires a recent head/right-hand pose and a right hand within 0.45 m of the log capsule. `stowLog {id}` grants **two wood** only while holding that same log, after at least 12 simulation ticks, with at least 0.25 m hand displacement and the right hand within 0.35 m of `waistPouchPosition(player)`. Call this on the grip-to-pouch release path. The pouch function returns a world-axis local offset from the feet; add player.position for its world centre. Regular E/Collect grants one wood. Capacity failure retains the whole log.

The physical proof belongs to live host state in a WeakMap, is consumed once and clears on release. It is absent from saved/imported state; after reload or host migration, release and grip again to re-establish physical proof. Existing held logs remain valid for ordinary collection. Hand poses are client-reported, so this validates the pose/action sequence rather than hardware identity. Collection increments bounded harvested statistics by actual awarded resources.

Run from repository root:

```powershell
node multiplayer/tests/lumber-collection.mjs
node multiplayer/tests/meteor-resources.mjs
node multiplayer/tests/tree-integration.mjs
node multiplayer/tests/interaction-cue.test.mjs
node multiplayer/tests/interaction-cue-view.test.mjs
```

Tests cover exact-once collection, authority sequence replay, amount spoofing, role/range/terrain/cap rejection, tracked grip/waist effort, ordinary grabs, stale poses, full bonus, proof loss on reload/drop, legacy saves and shared marker disposal. Existing tree and resource checks remain green.

## Verified fast path and failed strategies

- Browser paths are under `multiplayer/client`, dependency metadata is `multiplayer/package.json`, and browser documentation lives directly in `multiplayer/`. Root `client/`, root `package.json` and `multiplayer/docs/` do not exist. Discover before assuming a path. `rg` positional `*.js` does not expand in PowerShell; use `rg -g '*.js' <pattern> <directory>`.
- A first selector re-searched both arrays for every candidate. The 48-log/256-pickup frozen-snapshot benchmark took 876 microseconds per decision and failed its 500-microsecond budget. Iterate resolved objects in one pass, and range-filter full-stack diagnostics before ID lookup. Verified follow-up: 31–34 microseconds per decision. Test fixtures need a real `role:'hero'` so an early guard cannot produce a misleadingly fast pass.
- PowerShell returns the last native command exit code for multiple test commands. Inspect every explicit test result; use independent invocations or `$LASTEXITCODE` checks for aggregate CI.

Measured tool timings are in ignored `logs/lumber-collection-timing.csv`. The final five-suite regression call passed in 1.067 seconds tool wall time, excluding concurrent integration work.

## Existing waist pouch asset reuse and equipment help audit

`public/assets/waist_pouch.glb` reuses the existing Opus-authored `assets-source/resources/optional-glb/treasure_satchel.glb`. The GLB JSON retains the Leather and Linen mesh primitives and omits the Brass primitive containing three spilled coins; binary buffers and embedded textures are unchanged. Result: 128112 bytes, 1104 triangles, bottom-centre origin, Grip `[0,.319,0]`, ResourcePivot `[0,.181,0]`. The hero body's own pouches are merged into skinned HeroBody/HeroLeather and are not independently addressable nodes. Keep the wearable copy separate from the original optional prop.

`tests/hold-overlays.mjs` exercises F1 in the lobby, repeat suppression, key release, Tab typing/lobby exclusion, held-key priority, blur/visibility/Escape cancellation, pinned touch overlays and listener disposal. All ten hold/help checks pass. Help was audited against combat and VR input routing: Siegebird 0.7-second firing, Emberwing 0.55 seconds, fuel 1 second, Wyrm vent 2 seconds with 3-second overheat lock, and either trigger activates axe/pick/hammer specials while their strikes remain physical swings. This validates input logic, not browser-layout or headset comfort.

Windows edit lesson: Python `Path.read_text()` without an explicit encoding interpreted UTF-8 punctuation as the local Windows code page, making Unicode-aware replacement silently miss the cooldown text. Tests detected the unchanged 0.35-second label. Rewrite/read with explicit UTF-8 (`read_text(encoding='utf-8')`, `write_text(..., encoding='utf-8')` or PowerShell `Set-Content -Encoding utf8`); retain tests for the real cooldown labels.
