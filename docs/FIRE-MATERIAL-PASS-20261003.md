# Spatial fire and material feedback — 2026-10-03

## Changes

- Ground-fire scorching samples actual posed host geometry surface samples across head, torso, both arms and both legs. Each region retains its own char amount; samples are bounded to eight points per region, evaluated at 2 Hz only near active flame volumes. Headless hosts retain deterministic anatomical sampling. Missing parts are skipped.
- Removed a visual-only `fire` event shortcut which added 0.25 torso char on every burn damage tick irrespective of exposure. This was a direct source of black torsos beside white limbs. MeshStandardMaterial char uniforms now have bounded per-actor/region material instances and share shader programs; the former `uniformsNeedUpdate` flag alone does not refresh standard-material custom uniforms on repeated shared-material draws.
- Char and Phoenix burn timers survive checkpoint/reload. Detached remains retain char and burning on the struck part. Quenching stops attached fire while preserving char. Ordinary arrows remain non-incendiary; only authoritative curved Phoenix arrows ignite from their accepted physical contact.
- Attached fire reuses the existing flame presentation pool: at most 32 patches, four fire draw calls and three fixed point lights. No per-enemy lights or duplicate particle system.
- Invention events carry their actual material; foundation/sanctuary stone impacts no longer need the old client-wide metal rewrite. Contact audio maps bone/weapon on stone, timber, metal, shield and flesh, with explicit shield interception and existing bone/golem sounds.
- Fifteen new deterministic, authored procedural WAVs: three each for blunt stone, timber knock, shield thunk, flesh thud and Phoenix screech. Existing bounded spatial audio pool handles all of them, including .3-second Phoenix call throttling and small pitch/timbre variation.

## Integration contract

`simulation.setFireSamples(provider)` is host-only local state, never a network command. Provider receives an enemy and returns `{head:[[x,y,z],...],...}`. `combat.fireSamples(id)` exposes cached authored bone-local surface bounds transformed with current animated joints. Root wires this via the host session and `game.fireSamples` forwarding.

`createFirePresentation({fireSamples:id=>combat.fireSamples(id)})` follows burning live body parts. Remove `invention_hit` and `invention_destroyed` from the old game.js forced-metal remap; normal `materialAudio` routing handles those events directly. Authority emits `shoot.phoenix` for the screech.

## Verification and measured timings

- Existing fire authority/control/save tests passed (0.040 seconds suite).
- Spatial fire/Phoenix/shield/save/structure-material regression suite passed (0.007 seconds).
- Real skeleton GLB tests verify posed foot motion updates exposure points and keeps the opposite leg unchanged. Independent actor materials prevent scorch leakage; generic burn damage no longer chars the torso. 40 actors measured 1.22 ms/frame emerging, 0.56 ms/frame idle in the final CPU run. This is not a physical-phone GPU claim.
- Material WebAudio graph suite: 12 tests passed, including 28 actual WAV loads, contact routing, variation, capped voices, disposal and distance culling (0.121 seconds).
- Fire presentation tests: actual Wyrmspout GLB validator passed; attached body/remains fire uses existing pool. Full 256-cell/96-packet CPU particle update measured 0.064 ms/frame; 633 of 768 instances, four draws, three lights.
- Fire performance suite passed (0.215 seconds), no unchanged-terrain resampling; contact-authority session test passed.
- New audio generation: 15 files in 0.216 seconds.

## Limits and lessons

GPU compilation and rendered visual acceptance passed again against the final authored-surface provider in real Chromium (4.532 seconds): clean control, ankle-height ember exposure producing legs-only char, all-six-region char, and unchanged char 1.5 seconds after quenching. Screenshots under `logs/fire-scorch-gpu/captures/` were inspected. No GPU/JavaScript/HTTP errors. Subjective audio listening remains unverified. Actual phone/headset acceptance is not established by these Node tests. Fire exposure is a bounded anatomical approximation, not per-triangle heat transport. Raised or lowered limbs follow real host animation where a renderer is available.

An initial material test expected wood contacts to remain unhandled and exactly 13 files. Those expectations were outdated after this requested expansion; updated to assert timber routing and all 28 real buffers. Do not reintroduce the fallback bell to satisfy the old expectation.

## Audio spectral review

Measured new stone contact has a 637 Hz spectral centroid and 0.12% of its energy after 200 ms; the previous metal ricochet is 1967 Hz with 15.77% after 200 ms. Timber is 391 Hz, shield 596 Hz, flesh 172 Hz. All new variants peak below 0.58 full-scale. These measurements establish distinct damped contact families and no clipping, not a substitute for subjective listening. Full values: `logs/fire-scorch-gpu/audio-spectral-review.json`.

Browser diagnostic: `node tests/browser-fire-scorch.mjs` against an existing Vite server with `ACCEPT_BASE`, `PW_CORE`, `PW_CHROME` and `BROWSER_QA_DIR` configured as in browser acceptance. The test starts and closes its own browser, no server or production changes. The initial diagnostic setup failed because a repo-relative `multiplayer/` path was run from inside multiplayer; corrected explicit repo cwd before retry.

## Final authored-surface coverage review

The sampling upgrade caches actual weighted-bone geometry bounds once and transforms at most eight samples per region during ecology. A review initially alleged that the skeleton head joint was at the origin; that diagnosis was retracted because it had inspected the mesh named Head rather than the weighted Head_1 bone. The reason for this upgrade is fuller surface coverage and safe rigid-mesh handling, not a proven skeleton joint-origin defect.

The old gallery expected a full 0.8 m ground flame to leave the torso and hanging hand white. Actual surface samples correctly reached the lower pelvis and hand, so that expectation was wrong. The final strict-isolation gallery uses a localized source from -0.45 m to +0.20 m (ankle-height embers); its two legs reach char 1, while head, torso and both arms remain exactly 0. The all-region control reaches 1 in every region, clean control remains untouched. Extinguished screenshot inspected: those exact patterns persist. `fire-authored-samples.mjs` separately covers ordinary floor flames, elevated skull flames, animation, rigid golems and no repeat vertex reskinning.

## Foundation and Phoenix asset acceptance

- Authored stone foundation retains its original six-metre collision support while visible beveled edge reaches 2.999 m. Asset bound tolerance now accepts this millimetre bevel; gameplay/support assertions are unchanged.
- New ray-grid regression checks over 700 actual masonry/mortar contacts against rendered terrain. Every hit has more than 1.5 cm clearance with the 16 cm visual ground recess. Root made the recess follow the new mortar bed depth. Foundation suite passed in 0.283 s.
- Real imported-world test, 10.880 s: FPS distant/near/four lateral camera moves and RTS. Screenshots inspected: distinct beveled varied masonry, ground contact, no old terrain checkerboard. This is screenshot plus geometric separation evidence, not a temporal pixel flicker metric.
- Real Phoenix input: desktop ADS/Q curved draw and mobile held Draw plus second-finger Special both show the guide without GPU/JS errors. Phone-sized 844×390 screenshot inspected. Physical phone acceptance remains unverified.
- GPU depth test: 4,821 guide pixels when uncovered, zero differing pixels versus no-guide control behind an opaque wall. All three guide materials depth-test and do not write depth. Actual game contact marker terminates at forge/tree; gallery shows the full arc.
- Desktop guide update measured 6.3 ms last / 10.1 ms maximum in headless SwiftShader run; mobile emulation 8.4 ms last / 12 ms maximum. These are local CPU timings under emulation, not hardware frame-rate guarantees.

Reproduction: `tests/browser-foundation-art.mjs`, `tests/browser-phoenix-guide.mjs`; isolated depth fixture `tests/phoenix-guide-review.html`. Captures: `logs/foundation-art-gpu/captures/`, `logs/phoenix-guide-gpu/captures/`. Tests close owned browsers and reuse port 5178.

Fixture lessons: foundation restore enforces 0.75 m grid, so use z=8.25, not z=8; pre-validate with loadSimulation before opening the browser. Avoid game/HMR edits during held-input browser runs. CDP touchEnd identifies the released finger: release Special's point while retaining Draw, rather than releasing Draw by accident.
