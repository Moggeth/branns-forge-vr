# StarShard geode lighting integration

The existing `meteor` deposit is the StarShard geode. `world-content-view.js` now attaches the authored geode-light module immediately after fracture construction and before applying damage. This ordering preserves real missing-shell discovery when importing already damaged deposits without replaying flying chips.

The nearest twelve damaged geodes within thirty-five metres of the camera can emit light, at two instanced draws each. Farther or over-budget deposits retain their normal authored geometry and fracture but add no glow draws. Priority updates in the same frame when the camera moves; old slots release before nearer deposits request them. Geometry and shader materials are shared. No dynamic lights, bloom or particles were added. Light meshes do not intercept mining or projectile raycasts.

Damage reset, depletion, content removal and world disposal release light handles before fracture geometry. Stone deposits and intact geodes add no lighting. Existing world diagnostics now expose `geodeLights`, including current users, lit count, budget and individual hole/draw counts.

The integration changes only `multiplayer/client/world-content-view.js` and the new `geode-light.js` in runtime code. The latter preserves the delivered art with a twelve-geode default, explicit enable/disable input, accurate hidden draw stats and a defined-order GLSL smoothstep equivalent. No bottle, game or fire-renderer code was changed by this lane.

## Source and checks

Source: `work/opus-geode-emberdew-light-20261003/output/geode-light.js` and its handoff. Existing commission metadata records `fauxgrady@gmail.com`, subscription authentication (`claude.ai`, Pro), verified actual model `claude-opus-5-5`, and **442.269 seconds** commission duration. Integration did not start a new generation.

Run `node --test multiplayer/tests/geode-light.mjs`. Both tests passed in **0.358099 seconds** measured shell time. They load the actual meteor and boulder GLB geometry, use the real fracture module, and exercise restored/progressive damage, intact and stone exclusion, reset/depletion, nearest-twelve selection, camera-distance culling, unchanged shared assets and final disposal. Browser texture decoding is bypassed only in this Node geometry test. The existing artist handoff contains SwiftShader screenshots; this integration run does not establish physical headset or GPU performance acceptance.

Integration began **02:10:10.818 UTC**; functional verification completed **02:14:16.898 UTC (246.080 seconds)**. Inspection commands measured 0.272961 s, 0.292638 s, 0.171713 s and 0.154039 s; final source/diff verification measured 0.215490 s. Tests and reads are included in the phase interval. Final handoff timing is appended to ignored `logs/authority-momentum-capacity-timing.csv`.

Two guessed fracture-test names did not exist. Use `rg --files multiplayer/tests` and select its actual `browser-mining-fracture.mjs` rather than inferring names. When recording UTC durations in PowerShell, subtract two `DateTimeOffset` values; mixing `[datetime]` parsing with `UtcNow` produced a time-zone offset in an initial timing row, which was corrected before handoff.
