# Siegebird / Kingfisher — Opus asset commission

The installed game asset is now the original Kingfisher design commissioned from Claude Code's `claude-opus-5-5` using the user's verified Claude.ai Pro subscription. The artist built it from scratch; no prior Siegebird shell was imported. Codex supplied the mechanical integration contract, reviewed renders and the actual game, requested bounded corrections, and integrated the result. API credentials were excluded from every commission process. There was no API-key generation or fallback.

## Playing and viewing

Use **Brann's Forge Launcher** and choose Adventure with VR headset or Monitor / projector. The new mesh replaces the bundled model for the existing Siegebird ID; ownership, collection home, ammunition and abilities remain intact. An already-loaded game needs a relaunch to load this native asset change. No existing play session was stopped. Old exported demo packs are independent snapshots.

The public orbit preview is https://attempting-blank-jun-saturn.trycloudflare.com/#siegebird-showroom-eaffac8276c5 . This temporary tunnel requires the PC to remain awake. Refresh the link with the asset-showroom helper if the tunnel is restarted. Only selected geometry and materials are hosted, not prompts or project files.

## Source and rebuild

- `assets/siegebird-opus/`: editable .blend, final GLB, original Python builder and studio renderer, contract fixture and isolated Godot verifier. `HANDOFF.md` is the artist's detailed description and limitations; it predates the coordinator's final in-game checks below.
- `godot/assets/siegebird/siegebird.glb`: installed playable asset.
- `assets/siegebird/pre-opus/`: previous installed model and assembly config, retained for recovery.
- `outputs/Siegebird-Opus/`: studio renders, motion sheets, actual game captures, structural/clearance reports and browser captures.
- `work/opus-siegebird/`: private commission briefs, original/resumed session logs and subscription-guarded runner. Never publish this folder.

Run `scripts/Build-Siegebird.ps1` to rebuild the current Opus asset, promote it to the game and run native crossbow checks. The former `scripts/build_siegebird.py` remains a legacy source; it is no longer the default builder. To reproduce all studio renders and the artist's isolated verification, run `assets/siegebird-opus/run_pipeline.ps1`. These use only local Blender/Godot.

`godot/siegebird_showroom.gd` initializes the actual production mechanism before export and rotates the prop into conventional viewer coordinates. This matters: the raw game's neutral pivots have not received the reduction gear's runtime phase offset. Publish the showroom script through the existing asset-showroom skill, rather than publishing that uninitialized GLB. The showroom is visual; interactive weapon controls remain in-game.

## Integration and validation

The optional authored `ReelSocketArt` and `SelectorArt` replace the old placeholder cuboids while preserving their exact interaction positions. Historical models retain the fallback geometry. The normal trigger, finger target, crank attachment, two-hand aim, bolt seating, projectile behavior, finite supplies, recovery and grapple module retain the existing runtime.

- Original baseline and final installed asset both returned `SIEGEBIRD_RESULT []`. Final tests additionally verify authored fittings are actually used at the correct positions.
- Offline supply-ledger integration returned `SIEGE_LEDGER_RESULT []`.
- Blender checks 43 winding/release/trigger states: zero unexpected triangle intersections, 950 contacts restricted to intended guide/nock/anchor regions. Unexpected intersections abort export and preserve the previous file. This is sampled surface testing, not a proof against every possible intersection, containment or real tracked hand pose.
- Native hero/front/mechanism/top/grip screenshots inspected. Trigger-finger test pose reports a 0.0000202 m fingertip target gap. Physical controller comfort still requires headset playtesting.
- Final model: 68,252 triangles, 12 materials, 35 mesh instances, 71 material surfaces. Prior model: 26,834 triangles, 16 materials, 168 mesh instances. More geometric detail is offset in part by better batching; this is not a headset performance guarantee. Matching native hero capture logs reported 303 draw calls before and 168 after, with frame rate capped near 120. Treat these as scene observations, not an isolated GPU benchmark.
- Public view loaded all five gallery assets with zero browser warnings/errors. Siegebird checked at desktop 1440x950 and phone 390x844, with angle/orbit controls. Viewer framing now derives its center and distance from each asset's dimensions.
- Two existing audio ObjectDB shutdown warnings remain in the game checks; no new script/engine errors were reported.

## Measured timings and lesson

Initial high-effort commission was interrupted after **1,106.157 s** with no asset builder delivered. Resuming the same session at medium effort produced and self-reviewed the asset in **893.373 s**; the focused art-director correction pass took **134.947 s**. Total Claude process time: **2,134.477 s (35.6 minutes)**. Start future commissions with a tangible first-version milestone, then direct concrete revisions; do not treat long reasoning as progress.

Final local rebuild plus native regression: **6.215 s**. Five final native captures: **32.365 s**. Supply-ledger verification: **4.345 s**. Initial publication: **2.443 s**. Detailed records are in `logs/work-timing.csv`, and the artist's pipeline timings remain in the working commission logs.
