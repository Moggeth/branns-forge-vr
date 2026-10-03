# Claude takeover handoff - 2026-10-03

## Current baseline

The user is considering handing primary development to Claude and requested documentation
and loose-end cleanup. This handoff adds no new gameplay or deployment.

- Repository: private `Moggeth/branns-forge-vr`, branch `main`.
- Real Windows checkout: `C:/Users/mog/OneDrive/Documents/Coding/Personal/Python/things_are_different_now/branns-forge-vr`.
- The ChatGPT folder with a similar name holds attachments, not this Git checkout.
- Play: https://branns-forge-multiplayer.vercel.app
- Live gameplay revision: **9577d73** (PR #4 Siegebird songbirds), deployed 2026-10-03.
- Live deployment: `dpl_95AqcLDvbfWybauChX8UN3H5xcQn`
  (previous: `dpl_GaeqAKBdJG1naU3yop9MU27pzjRj` at 4adc79c).
  Siegebird deploy took 20.213s; public check 1.552s: root 200,
  `/assets/siegebird_songbird.glb` 200 (96788 bytes, matches source), live bundle
  contains Siegebird code. No in-game, mobile or headset playtest of it yet.
- PR1 pick polish merged as `5a1b743`; PR2 Timberline kit merged as `3663970`.
  Integration on top of those merges is essential: do not replace it with the kit alone.
- At handoff inspection, main matched origin/main, no open GitHub PRs, and the public
  page returned HTTP 200. Cloud health returned protocol1, maxPeers8, bounded-websocket relay.
  These are availability checks, not a fresh eight-player performance/load test.

## Architecture and ownership

| Area | Authoritative source / entry points |
| --- | --- |
| Application | `multiplayer/lobby.js`, `index.html`, `client/game.js` |
| World rules | `multiplayer/shared/simulation.js`, `combat.js`, `inventions.js`, `terrain.js` |
| Session, saves, migration | `client/session.js`, `world-saves.js`, `state-codec.js`, `wire-quantize.js` |
| Network | `peer/browser.js`, `cloud/worker.js`, `cloud/wrangler.jsonc` |
| Trees and harvesting | `client/tree-view.js`, `tree-growth.js`, `tree-carve.js`, `tree-batch.js`; shared harvesting rules |
| Construction | `shared/inventions.js`, `client/invention-view.js`, `invention-art.js`, `invention-panel.js` |
| Weapons | `client/weapon-controller.js`, `weapon-motion.js`, `weapon-special-motion.js`, `weapon-readiness.js`, `pick-luminance.js` |
| Input | `client/game.js`, `mobile-controls.js`, `touch-input.js`, `touch-actions.js`; VR routes into the same actions |
| Art | browser exports in `multiplayer/public/assets/`; reusable authored sources in `multiplayer/assets-source/` |
| Native predecessor | `godot/`; `service/` is the native forge bridge; `native/` is an unbuilt Unity draft |

All paths in the table after the first row are relative to `multiplayer/` unless prefixed.
Do not port old engine rotations, controllers or physics wholesale. The browser is a separate
runtime. The whole-planet Orchard is a native experiment, not the shipped browser default.
The deployed browser world is a bounded Orchard valley with terrain deformation.

Vercel delivers assets/code; each device renders. One player's browser runs the 60 Hz
simulation, with guest snapshots at 20 Hz. Cloudflare Workers/Durable Objects provide
room codes, membership, reconnection, handoff coordination and relay fallback. Direct
WebRTC is preferred. The developer PC can be off; an active player still needs to host.
There is no always-running dedicated world or cloud save store. Browser saves/recovery
and file export/import are the persistence mechanism. Hosting rights and ownership are
not hardened competitive multiplayer/anti-cheat. Maximum room size is eight.

Read [cloud operations](../multiplayer/cloud/README.md) for deployment, logs, recovery,
free-tier limits and the already verified direct/relay/host-loss scenarios. Do not promise
unlimited free scale. Do not restart or reintroduce the retired desktop Quick Tunnel.

## What just shipped

- Authored Timberline machine and bolt GLBs, live filament, Fire/Reload/Idle animation,
  distance LOD, shared materials and pooled cut debris. Four-second cooldown; ammo is
  2 Wood + 1 Iron. Build cost: 10 Wood + 6 Iron + 2 Mithril.
- V2 Timberline flight releases after three simulation ticks, travels at 46 m/s and
  sweeps contacts along the filament. Hits are applied once as it reaches targets;
  trees sever, golem arms detach, and stone/structures/soil block passage. Old 12-tick
  saved volleys still load. Animation seeks by shared fireTick, including late join.
- Pick gems/metal refinements and diegetic special cooldown drain/recharge. Held materials
  remain instance-owned; disposal restores shared template resources.
- Recent placement fix normalizes accumulated yaw; Heroes can build after multiple turns.
- Temporary testing supplies near forge approach (-1.2, 6.2): E/Collect grants exactly
  one Timberline recipe as a persisted atomic bundle. New worlds only; no automatic
  refill on reconnect/reload. No new basket art was requested, and ammo is not included.
- E at the forge opens the workshop; B quick build; Hero T places Timberline; God T is
  Frost; Shift+B bridge. Structures can be operated nearby or through Workshop > Built.

The latest unit/browser evidence is in [verification log](VERIFICATION.md), at the end.
Actual hosted checks covered FPS/RTS rendering, pick charged/spent/recharged visuals,
shared Timberline firing/reload between host and guest. Touch firing/ammo was tested
with browser touch input. Physical phone/headset comfort/performance is still unverified.
The last deploy took 22.846s; public asset render check 23.440s; shared machine check 14.837s.

## Outstanding work: explicit, not silently declared complete

1. **Review Claude's meadow/canopy work already in progress.** Remote branch
   `origin/claude/main-level-ground-trees-bob9q0`, head `6bd929f`; art commit `c4b2bd0`.
   Not merged or deployed, and no PR was open at inspection. It changes `game.js`,
   `tree-materials.js`, adds `meadow-cover.js`, a focused test and
   `docs/MEADOW-CANOPY-20261003.md`. Its base predates recent integrations. Review/diff
   against current main, integrate selectively, profile actual ground/RTS/mobile views.
   Do not recommission the same work or copy its old game.js over current main.
2. **Crystal-wall follow-up:** the user's Claude screenshot described a separate
   request to redesign the pick special's immediate terrain ridge into a progressive
   magical emergence. No corresponding open PR/remote branch was identified here.
   Check Claude's own active task before starting duplicate work; not marked delivered.
3. **Timberline kit boundary:** live controls retain level horizontal cutting aim.
   Optional authored elevation/grip controls are not exposed as a new control scheme.
   The source collision GLB is retained, while gameplay still uses existing structural
   collision bounds and rendered meshes for targeting. The kit's optional continuous
   resistance/bowing flight response and Impact clip are not fully connected to
   authoritative contact; solid hits currently terminate the live volley with dust.
   These are concrete polish opportunities, not claims of full rigid-body simulation.
4. **Acceptance:** physical Android/iPhone and supported WebXR headset; separate-network
   friends; busy skeleton/grove/building scenes; sustained eight-player play. Automated
   Chromium, same-machine peers and geometry tests do not establish these results.
5. **Gameplay/design:** evaluate whether the forge/harvest/invention/conflict loop is
   rewarding in a real session. Current Expedition and autonomous raids are implemented,
   but PvPvE balance, onboarding, Hero/God counterplay and long-term persistence remain
   iterative design work. Historical migration recommendations are not a complete parity audit.
6. **Rendering/performance:** the authored machine still has many animated parts/draws
   (artist reported roughly 60-70 calls). Measure several machines in a busy scene;
   preserve art quality while batching static compatible parts if needed. Default terrain,
   mountains and ore identity remain areas the user wants continuously improved.

## Start, verify, deploy

Use Node >=22.12, installed dependencies in `multiplayer/` (`npm ci` only if needed).
From that directory:

```powershell
$env:VITE_PEER_WS_URL='wss://branns-forge-rooms.fauxgrady.workers.dev/peer/cloud'
npm run dev -- --strictPort
```

Vite defaults to 127.0.0.1:5178. Use a hidden process for remote/background work and keep
its PID/session for cleanup. Do not stop all Node/Python/PowerShell processes. Logs,
screenshots and timing records belong under ignored `logs/`. `npm run build` validates
packaged GLB texture dependencies before building. Do not use `npm test` blindly:
`tests/run.mjs` expects the legacy gateway on 8090.

Focused baseline (from `multiplayer/`; check each exit code):

```powershell
node tests/simulation.mjs
node tests/solo-session.mjs
node tests/inventions-review.mjs
node tests/timberline-integration.mjs
node tests/pick-luminance.mjs
node tests/foundation-tiles.mjs
node tests/placement-rotation.mjs
node tests/testing-supplies.mjs
npm run build
```

Existing actual-browser harness: `tests/browser-acceptance-lib.mjs`.
- `browser-pr-assets.mjs`: import QA save, rendered assets, mouse fire/reload, pick states.
  Set `ASSET_CLOUD=1` for host/guest machine synchronization instead of solo coverage.
- `browser-timberline.mjs`: actual touch Aim & fire and ammunition spending.
- `browser-friends.mjs`: create/join, party quest, shared terrain; `EXPECT_CLOUD=1` checks
  cloud endpoints, `FORCE_RELAY=1` tests no-ICE fallback, `HOST_CRASH=1` tests continuation.
- Set `ACCEPT_BASE` to the dev or public URL and `BROWSER_QA_DIR` to an absolute ignored
  output path. `PW_CORE` selects installed playwright-core and `PW_CHROME` its Chromium.
  Machine-specific cached locations can be found in existing local test commands/logs;
  do not assume those Windows cache paths exist on Claude's other execution hosts.
- `?acceptanceProbe` exposes a read-only state/diagnostic probe. Tests should act through
  real input or explicitly imported validated fixtures, not mutate live game internals.

Production frontend deploy, only after relevant checks:

```powershell
./scripts/deploy-peer-preview.ps1 -PeerUrl 'wss://branns-forge-rooms.fauxgrady.workers.dev/peer/cloud'
```

This builds and stages compiled public assets in OS temp, hashes copied assets and
publishes to the existing Vercel project. Verify actual public gameplay afterward.
For a bad release, inspect/promote a verified earlier deployment via Vercel; retain
recovery exports before world-schema changes. Frontend asset changes do not require
redeploying the Cloudflare Worker. Cloud deployment commands are in its README.

## Safety of the handoff / local state

- No tracked local implementation changes remained when this handoff began. Nineteen
  unrelated untracked `godot/*.gd.uid` files were preserved; do not delete or stage them
  as part of browser work. Generated logs/source-work folders may be ignored, not portable.
- Main matched private origin/main after fetch. Recheck immediately before edits/push:
  other Claude work is concurrent. GitHub personal account is Moggeth; shared CLI account
  selection has changed under other tasks before. Never print tokens or commit credentials.
- Overnight Forge sprint and coordinator automations were already **PAUSED**. Leave them
  paused. No new Claude generation was launched for this handoff, and the prior QA Vite
  and browser sessions were stopped. A targeted process check found no project Node,
  Claude, Python or cloudflared job; it is not an audit of unrelated/system-wide services.
- User-owned historical 8789/tunnel windows were left untouched by the cloud migration.
  They are unnecessary for the current public site. Do not resurrect them from old notes.
- README includes legacy non-UTF8 bytes. Preserve bytes when inserting a short header;
  avoid a blind encoding conversion that corrupts the long historical record.
- AGENTS.md retains native instructions for native-only work. Its corrected opening and
  this handoff take precedence when choosing the active browser project/workflow.

## Handoff verification performed

All eight focused Node checks listed above passed during this handoff. The first run
of simulation.mjs exposed stale assumptions: a Grove limit fixture targeted the protected
forge apron, and an old section expected the forge to be destructible. Test-only commit
`0e9e77e` moves the cap fixture outside the apron and asserts current permanent-forge
behavior plus legal off-apron casting. Gameplay was not changed or redeployed.
