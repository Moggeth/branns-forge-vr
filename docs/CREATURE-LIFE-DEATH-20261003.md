# Browser creature life, damage and death — 2026-10-03

The multiplayer client now layers creature presentation onto the shipped skeleton and golem GLBs. Skeletons crawl through soil when their saved `emergeTick` starts; ordinary golems assemble their authored legs, core, arms, plates and head in sequence. The module never moves the authoritative actor root, reparents a bone, or substitutes a collision proxy. Combat's existing triangle sweep sees the posed mesh, and embedded arrows remain on their bone or detached piece.

The server retains optional six-part `scorch` (`head`, `torso`, `leftArm`, `rightArm`, `leftLeg`, `rightLeg`) in snapshots and save/load. Flame and burning ground accumulate it on contacted parts. Part health drives stone cracks and bone wear; corpse pieces carry the final damage. Killing blows give detached pieces varied momentum and a brief visual collapse that blends into their authoritative physical poses. Settled remains sleep to avoid repeated ground sampling. Optional capped damage numbers are off by default; no enemy floating health bar was added. The forge shrine's objective bar is separate.

`client/creature-life-death.js` is the isolated Opus 5.5 art deliverable, integrated by `client/combat-view.js`. `game.js` calls `combat.beginCreatureFrame()` before mixers and enemy motion. Combat view then applies creature poses after golem and meteor motion, before projectile contacts, and advances detached poses and particles. Only skeletons and golems enter this presentation; rats and ghosts keep their own visuals. The normal simulation spawn and adventure spawn paths set `emergeTick`, and restoration preserves it. Meteor-born golems retain their existing meteor unfurl.

The art commission used the sanitized personal `fauxgrady@gmail.com` claude.ai Pro subscription, with no API key source. Runner metadata verified requested, actual, canonical and final model `claude-opus-5-5`. The isolated output is `work/opus-creature-life-death-20261003/`, with a detailed `ART_HANDOFF.md`; the run completed in **842.793 s**. Its original mechanical suite was adapted only for the real repo's `multiplayer/public/assets` path. The copied `multiplayer/tests/creature-life-death.mjs` checks actual GLBs, motion layering, emergence order, no root displacement, collapse handoff, scorch easing, disposal and bounds. Forty simultaneously emerging actors took **1.19 ms/frame** CPU including enemy motion; the settled presentation took **0.53 ms/frame** in that Node fixture. These are CPU fixture measurements, not a frame-rate claim.

Verification on the integrated checkout:

| Step | Result | Measured duration |
| --- | --- | ---: |
| Creature GLB suite | Passed | 0.8 s |
| Scorch/save/fire/varied death suite | Passed | 0.005 s |
| Combat + combat-view + fire suites | Passed | 0.048 / 0.522 / 0.029 s |
| Vite `build:check` | Passed, 76 modules | 0.322 s build |
| Real Chromium at disposable Vite port 5197 | Skeleton soil crawl and distinct golem assembly rendered; scorch shader produced no page errors | 2.9–4.5 s per capture command |
| Real fixture torso shot | Mesh contact accepted at `target.torso / Torso`, embed attached | 5.8 s command/wait |
| Three torso shots | Three accepted mesh contacts; six physical remains and death event | 5.1 s command/wait |
| Session/codec/performance regression | Passed; 64-enemy/96-arrow CPU p95 2.75 ms, wire snapshot 50,396 bytes | 0.7 s combined command |

Screenshots from the review are ignored local diagnostics under `multiplayer/.playwright-cli/creature-*.png`. The fixture supports `?emerge&distance=5` and `?scorch&distance=5` to reproduce the art states without altering the live game. The stable scorch capture had zero console/page errors. Concurrent Vite hot reloads of other agents' asset code transiently logged GLTF blob texture failures; reloading the fixture cleared them. GPU appearance was reviewed at desktop viewport; physical VR/headset comfort and broad device performance remain untested.

Recovery lessons: The isolated commission folder lacks the project's `three` dependency, so bare Node import there initially failed; use its `tests/three-resolve.mjs` with `THREE_ROOT` or run the copied test from `multiplayer/`. The real assets live in `multiplayer/public/assets`, not `multiplayer/assets`. Port 5188 was occupied during visual review; use a verified spare port and keep resident 8789 untouched. A fixture skull shot may honestly pass a bone gap; the torso scenario reliably checks the collision-to-embed-to-death path without weakening contact rules. The spawned Vite review server was stopped after capture.
