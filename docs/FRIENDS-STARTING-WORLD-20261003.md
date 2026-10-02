# Friends starting-world pass — 2026-10-03

User request: a more interesting meadow, mineable dead golems, rewarding co-op progression and accessible touch combat.

## Delivered
- Opus 5.5 authored portable `client/starting-world.js`: sanctuary, crystal outcrop, ruined watch-arch and connecting stepping stones. Six merged draws, 3,888 triangles, no added lights. Root integrated 21 solid footprints, matching Hero prediction/server/enemy collision, ray occlusion and terrain-edit grounding. Initial trees clear landmarks; player-planted groves stay where cast.
- Three actual ore deposits and two discoverable supply caches complement the artwork. Fresh worlds enable landmarks. Older saves retain their original layout; create a new world to see the new default.
- Dead golem pieces accept two normal pick strikes and yield stone (two for head/torso, one per limb). Living severed pieces and held pieces cannot be mined. Cooldown/reach/tool/point validation, pickup pool limits, embedded arrow cleanup and mid-mining save restore are preserved.
- Hero touch taps collect loose loot first, or aim and begin the normal melee swing against visible enemies/tree/ore surfaces. Correct harvesting tools remain mandatory. Drag, pinch, cancellation and held bow do not attack. Direct Heal/Deliver/Drop and contextual Collect controls use independent pointer ownership; primary button says Mine/Draw/etc. according to equipped tool.
- Expeditions retain gather / fallen-star recovery / three-wave forge defence. Solo start now costs six wood/four stone. Milestones restore 20 HP/30 mana; defence entry adds three wood. Victory grants full restore and six wood/four stone/three gems per present player, once per run, alongside renown. God solo and mixed parties retain distinct tasks and bounded challenge summons.

## Provenance and limits
Commission `work/opus-friends-starting-world-20261003`: freshly verified personal fauxgrady@gmail.com, claude.ai pro, actual claude-opus-5-5, 110.154 seconds. Completed before 23:00 UTC weekly reset; no later generation. Root review found and fixed a portrait quick-dock overlap blocking Emberwing Special. Screenshot review retains open meadow with three readable destinations. Physical handset/headset and separate-network play remain unverified.

## Checks / measured seconds
- Commission: 110.154, passed.
- Starting-world art/physics/mining and codec/tree regression batch: 0.438, passed. Art rebuilt/disposed without residual scene nodes; all 21 footprint centres resolve stably.
- Adventure regression: 1.817, 12 tests passed (solo Hero, solo God, mixed roles, cap, save, duplicate commands/rewards, retries). The old pre-compact-HUD fake-DOM test was obsolete; current HUD coverage is in expedition-hud and vr-adventure-panel.
- First mobile layout browser run: 9.069, portrait 390x650 and landscape 844x340, all menu tabs fit.
- First touch cast run: 10.558, failed because direct buttons overlapped Special. Moved portrait dock above movement thumb. Corrected run: 10.994, all quick cast, line drag, two-thumb move/look, jump, attack, held bow through resize/move-release, secondary Special and cancellation passed.
- Browser mining / direct-control run: 10.476, real pick taps produce first hit, second hit breaks chunk and yields stone; all primary/direct button centres reachable at 390x650 and 844x340; no browser errors.
- Build: Vite 0.328, full production build and asset dependency precheck passed. Existing bundle size warning remains.

## Run / diagnose
`node multiplayer/tests/starting-world.mjs`; `node multiplayer/tests/adventure.mjs`; `node multiplayer/tests/touch-input.mjs`; `node multiplayer/tests/interaction-cue.test.mjs`; `node multiplayer/tests/state-codec.mjs`.
Browser: existing Playwright setup in tests/README, `browser-starting-world.mjs`, `browser-touch-casting.mjs`, `browser-mobile-layout.mjs`. Results/screenshots under ignored logs/browser-acceptance. For local real gameplay use owned Vite 5188 and peer8799; never disturb original peer8789/tunnel.

## Lessons
Adding default pickups changes total-loot baselines: isolated meteor reward fixtures clear initial pickups before measuring six-gem payout. Tree index cache keys must include the landmark layout flag when reusing the same seed across old/new saves. Read scripts with rg --files before invoking; cue tests are named interaction-cue.test.mjs. Preserve UTF-8 for all edited browser source (legacy root README is not wholly UTF-8).

## Release acceptance
Code 5bc5b80 pushed to private origin/main. Production dpl_5oMaST56hUXB8DzcqG5zwSgskouf is READY at https://branns-forge-multiplayer.vercel.app. Full build 0.324s; deploy 12.8165s. Public two-browser Hero/God acceptance 12.169s: same room 93938395, shared landmark flag, Hero expedition start replicated, God Raise Earth replicated, zero console errors. Test room is ephemeral; players should create their own new world. Public real-touch salvage and button reachability passed in 10.100s. Actual FPS and elevated captures inspected under logs/browser-acceptance/captures. Final local mining/layout 10.496s. Physical phone/headset and separate-network acceptance remain unverified.

Docs/test follow-up does not require redeployment; runtime files are unchanged. Original peer8789/tunnel preserved; overnight automation remains paused. No Claude generation after weekly reset. Work began 22:53:15 UTC; acceptance completed by 23:23:28 UTC.
