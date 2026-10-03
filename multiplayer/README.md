# Browser multiplayer proof

## Physical inventions — 2026-10-03

Open **Menu → Manage the forge**. **Build** shows costs and missing materials; tap/click clear ground to place. **Stores** deposits everything and refines ore into physical metal at the forge. **Built** operates, repairs, turns and aims machines. The central forge and its work apron are permanent. Keep Wood as one resource; Iron/Mithril/Star ore refine 1:1 in 2–3 seconds. Shared stores belong to your side and pay recipes automatically (Heroes near forge/storehouses, Gods anywhere).

All twelve core structure jobs are implemented. Timberline uses 2 Wood + 1 Iron per shot, cuts trees in a cascade and severs golem arms. Heavy Launcher costs 3 Stone + 1 Iron per shot and deforms ground. Wards, traps, gate, logging yard, prospecting, sanctuary rally, tower ramp and barracks defenders have distinct actions. Machines can turn 45° per action, with a short turning delay plus firing reload. Opponents can attack Influence sources to disable nearby destructive God spells. Quiet-interval incursions and distant patrols provide ongoing salvage.

Heroes can E/tap nearby owned structures. VR uses the wrist workshop with controller-ray placement/aiming; grip ore and release over the hopper, or use the convenient Refine action. Worker assignments include ore and scrap, so solo Gods can advance the same economy. Physical phone/HMD acceptance remains unverified.

Checks: `node tests/inventions-review.mjs`, `node tests/material-economy.mjs`, `node tests/forge-protection.mjs`; browser `tests/browser-inventions.mjs` imports an explicitly stocked QA save and uses actual touch controls. `tests/invention-gallery.html` renders the actual authored models. See [source, measured timings and limitations](../docs/PHYSICAL-INVENTIONS-20261003.md).


## Quiet phone HUD — 2026-10-03

Tap the current spell/weapon to open its palette. **More (⋯)** holds invitations,
role switching, help and party. Quest expands on tap; **Actions** includes Heal,
Deliver and Drop. Quick cast stays directly accessible. See [mobile HUD handoff](../docs/MOBILE-QUIET-HUD-20261003.md).

## Golem emergence polish — 2026-10-03

Duplicate block-based spawn effects are removed; the authored stone assembly
now advances every rendered frame independently of snapshot delivery. All spell
previews recede after a confirmed cast. See [verification and timing](../docs/GOLEM-EMERGENCE-POLISH-20261003.md).

## Mining, ranged weapons and performance - 2026-10-03

F9 or the Hero/God button switches perspective. Distinct ranged reticles, a curved
bow guide, embedded cracks, liquid slosh, StarShard light and restored pick/crossbow
details are integrated. Long UI text wraps; trees use shared material/wind upgrades.
Fire and terrain targeting avoid repeated mesh/height work.

See [the polish handoff](../docs/MINING-WEAPONS-POLISH-20261003.md) for exact
provenance, tests, cost evidence, commands and remaining limits. Permanent terrain
storage still caps at 64 edits; the error explains that waiting will not clear it.

## Equipment and terrain mastery — 2026-10-03

Hold **F1** for the current tool's basic attack, special and interactions. Hold
**Tab** for party K/D/damage, the current objective and expedition/menu actions;
releasing restores prior mouse capture. Phone players have matching help/party
icons. The small bottom-right build tag identifies the exact source revision.

Orchard's Edge special (**Q/right click**, or **Special** on touch) winds back
and bowls a sundering strike forward, leaving shallow permanent scars and
mineable stone. Stonewhisper raises a curved, persistent crystal wall; mining
each section breaks its crystals and removes that section of raised earth.
Both share a four-second special cooldown. In VR, trigger activates the special
and ordinary strikes remain physical swings.

**E** directly collects nearby lumber (one wood); a subtle ground highlight
marks the eligible target. VR right grip can physically take a log, then release
it into the visible right waist pouch for **two wood**. Ordinary drops/throws
remain available. This bonus is pose-validated and cannot be collected twice.
Boulders and meteors lose real chunks with exposed interiors as they are mined.
Left-hand Emberwing is mirrored outward in FPS/VR and remote-player presentation.

Mountains now form the visible world boundary. Collision and deformation use
the exact triangles rendered by the ground, including saved/reloaded edits.
All friends should refresh to this version before starting or continuing a room.
See [../docs/EQUIPMENT-TERRAIN-20261003.md](../docs/EQUIPMENT-TERRAIN-20261003.md)
for tests, artist provenance, measured timings and physical-device limitations.

## Live eight-player peer preview — 2026-10-02

Open https://branns-forge-multiplayer.vercel.app . Choose Hero (FPS, or Enter VR
on a supported headset) or God (RTS) using the icon cards, then Create a world.
Copy the eight-digit room code or invite link for a friend; they select their
role and Join. No account needed. The Opus-designed fantasy lobby replaces the
engineering toolbar. Connection endpoints are configured at build time, never
shown as a player input. Menu releases controls and exposes role switching,
backup download, host-only confirmed reset and leaving. The shared world keeps
running while a menu is open. Save/resume/import live in secondary sections.

The current browser-hosted route uses **8 players, fixed 60 Hz simulation and
20 Hz snapshots**, with rendering at the device's refresh rate. It reuses the
native corrected axe/pick motion and authored tree, skeleton, geology, ground,
cutting and bridge assets. Heroes chop trees, collect wood, build bridges, mine
stone/Starfall meteorites and collect healing apples. The second wave adds native Siegebird, Emberwing curved arrows, Sunfall Sledge, golem armour, precise bone contacts, embedded arrows and usable detached bones. Gods now have fourteen spells with authored effects and quick-cast line gestures. See [IMPORT-WAVE-2.md](IMPORT-WAVE-2.md) for controls, evidence, artist provenance and remaining limitations; [IMPORT-WAVE-1.md](IMPORT-WAVE-1.md) preserves the earlier harvest/build wave. Heroes can interrupt God spells by damaging the shrine.

The current host can reset (confirmation + pre-reset recovery save). If they
leave, the world pauses for a reconnect grace period, then an eligible desktop
peer with the latest checkpoint gets an explicit Continue world offer. This
transfers room authority; it does not measure which device has the best network.
No acceptance means a paused world and a downloadable recovery checkpoint.
Local autosaves retain up to eight worlds; Resume/import creates a fresh room
from that saved state. Browser storage is not cloud backup; download important
saves. Continuations are independent copies, with no account-based ownership or
automatic conflict merging yet.

Vercel hosts only public compiled assets. A Cloudflare **temporary Quick Tunnel**
connects signaling to this PC. The PC and both processes must remain running.
WebRTC carries simulation state between players. A TURN relay is not configured:
some pairs of home/mobile/work networks may fail to connect. This is a friend
playtest, not an always-available or broadly scalable production service.

See [peer/README.md](peer/README.md) for lifecycle/configuration and
[PEER-PLAYTEST.md](PEER-PLAYTEST.md) for deployment and verification.

The Opus 5.5 lobby commission completed on the verified personal Pro subscription
in 348.176 seconds; Codex integrated and verified the real network behavior.
Physical headset and separate-household acceptance are still pending.

## Mobile controls

Phones/tablets automatically show two thumb sticks. Hero: Move / Look, Attack,
Jump. God: Pan / Orbit-and-tilt, zoom buttons or pinch, Centre, tap the ground to
aim, then Cast; Cancel returns to centre aim. All fourteen spells stay in the scrolling tray. Hero equipment, Collect/Eat and Bridge buttons remain accessible above the sticks.
Portrait and landscape are supported, including swapped sticks for left-handed
play. Menu → Display & controls changes sensitivity and Automatic/Always on/Off.
The same menu retains role switching, invites, backups, host reset and leaving;
world import/resume/create/join remain on the lobby.

Full screen is in the touch toolbar and the menu. It uses the actual browser API,
shows an exit state and respects permission denial. Unsupported browsers explain
Add to Home Screen; the manifest and iOS standalone metadata enable an app-like
launch where supported. There is no offline multiplayer promise or forced
orientation lock. Browser API support varies; physical phone testing is pending.

Desktop mappings remain; right-drag now tilts the God camera too. On standard
WebXR controllers, primary A/X jumps and secondary B/Y exits VR into the menu;
left stick moves and trigger strikes. Controllers without those buttons retain
the browser/system exit path. Physical headset verification is still pending.

See [MOBILE-CONTROLS.md](MOBILE-CONTROLS.md) for the complete mapping and acceptance.

## Earlier dedicated-server proof (separate, not deployed)

The original dedicated-server route below remains available for local verification.
Vercel is now authenticated; an empty Fly app exists but no machine/volume was
deployed or paid hosting started. The production index now targets peer rooms;
the dedicated-server engineering harness remains under tests/. Do not deploy
the old container configuration assuming the new lobby uses its protocol.

This is a small independent shared clearing, not a port of the full native game.
It does not connect to native saves, the native running game, voice services or
local Codex/Claude tools. Existing tree, skeleton and axe assets are reused.

## Implemented

- Up to 32 guests per room, any combination of Hero and God, up to 8 rooms.
- Hero desktop movement, jump and simple melee; WebXR session/controller/head
  integration and immersive rendering. Physical headset acceptance is pending.
- God camera and skeleton, raise-earth, grove and starfall commands.
- Authoritative 30 Hz simulation and 10 Hz shared snapshots; health, mana,
  movement, spell limits and damage are server-owned.
- Reconnect grace, duplicate-command rejection, session takeover protection,
  exact browser-origin restrictions, message/queue limits and bounded world state.
- Structural edits/groves persist; guest identities and combat reset on restart.
  Expired reconnect credentials stop retrying and require a fresh guest join.

The proof's combat uses range/cone checks, not the native bone/surface collision
system. There is no full inventory, ecology, resource economy, native avatar,
voice, account login or distributed multi-server room routing. Trees are shared
decorative placement points and do not block locomotion. The 32-client measurement
is local network/server validation, not 32 rendered headset clients or a WAN SLA.

## Local development and tests

Use Node 22.12+ and Godot 4.7.2. From this folder:

```powershell
npm ci
npm start
# In a separate terminal:
npm run dev
```

Gateway 8090 starts only its own Godot child on loopback 8081. It uses the repo's
installed Windows engine or `GODOT_BIN`. The Vite engineering page is
`http://127.0.0.1:5178/tests/browser-harness.html`. These are local diagnostics,
not remotely accessible links. Create a room in one tab; open its room link in a
second, choose either role, and join. Hero: WASD, Space, click to capture/strike,
Escape releases the cursor. God: WASD pan, right-drag orbit, wheel zoom, select a
spell and click terrain. Role changes are authoritative and briefly rate-limited.

```powershell
npm run test:network
npm test
npm run test:gateway
npm run test:load
npm run build:check
```

Tests make disposable rooms; use a dedicated instance/state directory, not a
populated deployment. `TEST_WS_URL` chooses the server and `TEST_ORIGIN` supplies
the exact permitted origin. Production-origin coverage adds
`TEST_REQUIRE_ORIGIN=1`. `build:check` compiles the diagnostic page to ignored
`dist-check/`; `npm run build` separately compiles the current peer lobby.

Stop the specific foreground gateway/Vite with Ctrl+C. The gateway stops only its
owned Godot process. Never stop all Godot/Node processes. Metadata logs are in
`logs/gateway.jsonl`, `logs/simulation.log` and `state/server.jsonl`; isolated world
state is `state/worlds.json` (or `WORLD_DATA_DIR`). Source, dependency caches, state
and logs remain separate. Do not clear state to troubleshoot startup.

## Hosting handoff

See [DEPLOYMENT.md](DEPLOYMENT.md). One persistent Linux container can serve both
the game and WSS, independently of this PC. Vercel may instead serve the static
frontend. Its Functions now support WebSockets, but connections have maximum
duration and may reconnect to different instances; this single-owner Godot
simulation still needs a persistent process. See
[Vercel WebSockets](https://vercel.com/docs/functions/websockets).

Remote immersive VR requires HTTPS and a browser/headset combination exposing
`immersive-vr`. Support is feature-detected; desktop fallback remains available.
The user's Vive Pro 2/browser combination has not yet been tested.
See [WebXR](https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API).

The dedicated-server container is not deployed. Its older 32-client checks do
not describe the current eight-player peer preview. Docker/container runtime,
separate-household connectivity and physical headset acceptance remain unverified.
The peer lobby commission and integration are complete; see the current status above.

## Evidence

[tests/README.md](tests/README.md) records measured protocol/load/regression
results, limits and harness lessons. [server/README.md](server/README.md)
documents persistence and lifecycle. Local browser checks verified two tabs,
both roles, shared raised terrain and an attacking skeleton without browser
console errors. The test browser correctly reported immersive VR unavailable.
These earlier checks used the engineering harness. Physical VR acceptance remains pending.

Browser automation lessons: target this canvas by its `aria-label`, not its
snapshot's generic role. The browser evaluate surface uses an isolated world;
page module globals are unavailable there. Read the visible diagnostics instead
of repeatedly trying to inspect `window.brannHarness`. A diagnostic Vite bundle
build completed in 0.739 s (141 ms compiler time); Three.js makes the single bundle
about 650 kB / 166 kB gzip. The current lobby still statically imports the renderer; a future loading pass
should split it so room selection does not wait for the renderer/assets. Do not hide the warning by only
raising the chunk-size threshold.

Browser import orientation and review: [ORIENTATION.md](ORIENTATION.md).

Selective native migration decisions: [curation report](../docs/browser-migration/README.md) and complete file/catalogue register.

### Wayfarer’s Forge landmark
The shared world power anchor now uses Opus 5.5’s portable forge kit. Walk toward the forge from spawn; its open working face points toward you. Its existing shared health still interrupts God casting for eight seconds when depleted. This is not a crafting menu. Artist-authored character collision boxes, a walkable low plinth, and a 24 m visual LOD are shared across host simulation and client prediction. Diagnostic `game.diagnostics().forge` reports asset count, active LOD and power.

Source/axes/sockets/rebuild: `../assets/asset-lab/wayfarer-forge/HANDOFF.md`. Rebuild via `python scripts/asset_lab.py build assets/asset-lab/wayfarer-forge/asset.json` from repository root. Both GLBs embed textures and import into Godot; native scene placement is not changed. Collision metadata is mirrored in `shared/forge-layout.json`; `node tests/forge.mjs` checks source parity, accessibility, overlapping-box escape and sustained movement. `npm run dev`, then `/tests/forge-playtest.html` opens the actual game renderer for ground/RTS/LOD, surface strikes, and power-off review. Browser failures appear in the fixture’s error field. The fixture is local QA and is not shipped in production.

Limitations: coarse character boxes, no new crafting, no hearth particle simulation yet, no physical headset acceptance. Enemy collision is respected, but this pass does not add obstacle-routing AI.

2026-10-03 browser milestone: tree cut-height falls and collectible physical logs, optional Forge Expedition, eight equipment slots including Wyrmspout/Emberdew, fourteen God spells, authored ground/fire/wood audio, touch layout fixes and Hero VR wrist objectives. See IMPORT-TREES-EXPEDITION.md, IMPORT-PRESENTATION-20261003.md and IMPORT-VR-EXPEDITION-20261003.md for verification and limits. Deployment script -StageOnly builds and verifies nested asset hashes without publishing.

Keyboard/quick-cast acceptance: from the repository root run `node multiplayer/tests/browser-keyboard.mjs` with `ACCEPT_BASE` pointing to a local QA server (default http://127.0.0.1:5188) or the hosted preview. `PW_CORE` and `PW_CHROME` optionally select installed playwright-core and Chromium. This creates its own test room and uses real input plus the read-only acceptance probe. It checks quick point casting, repeats after the server cooldown, UI-hover suppression, toggle-off selection, menu Tab containment, controls-guide focus restoration and Escape. Results are saved to ignored `logs/browser-keyboard.json`; nonzero exit means failure. Same-machine Chromium evidence does not establish physical phone, headset or cross-network acceptance.
## Material impact audio (2026-10-03)

Stone, bone, metal, armour fracture and ore rewards use 13 deterministic spatial WAV variants via client/material-audio.js (651452 bytes). Wood retains its existing bank. Voices are bounded to 12 material + 16 wood; diagnostics expose loaded buffers, active/peak voices and culling under canvas.brannDiagnostics().audio. Enemy embeds no longer add a duplicate generic beep over the bone hit. Audio unlock remains gesture-driven. Authored synthesis/test sources and metrics live in assets-source/material-audio; generator output is a local assets/ folder, copy approved WAVs to public/assets/material-audio after review. Test: node tests/material-audio.mjs; python assets-source/material-audio/test_material_audio_assets.py (numpy). Objective tests do not replace headphone/phone listening or physical iOS acceptance.

## Expedition world presentation (2026-10-03)

client/expedition-presentation.js consumes snapshot.adventure and the same terrain height as gameplay. Delivered supplies visibly accumulate beside the forge; rune progress, star-site beacon and encounter countdown rings follow authoritative state. Optional Expedition actions are unchanged. Idle costs zero visible draws; hard limits are10renderables,64sparks,8warnings. All nodes ignore contact/raycast. Materials are precompiled with startup spell shaders; disposal is owned by the module. Regression: node tests/expedition-presentation.test.mjs. Desktop actual tree-to-forge delivery captured in the sprint record; physical headset comfort remains to be assessed.

## Compact objectives and VR input ownership (2026-10-03)

The Expedition card starts collapsed in a corner; open its heading for the full objective list and secondary actions. Progress, the next role-specific step, and incoming encounter warnings remain visible. Leave requires confirmation. Expansion preference is stored locally; updates preserve focused controls. Hero delivery shows carried resources; God aid shows actual mana requirements. Short landscape touch mode uses a 47px row. Mobile objective drawers intentionally take pointer priority over thumb pads when expanded, and the menu stays above both.

Opus design is integrated in client/adventure-view.js and expedition-hud.css. Legacy mobile banner rules explicitly exclude this new card. Test node tests/expedition-hud.mjs and node tests/vr-adventure-panel.mjs. Root browser evidence covers 27 stage/viewport fixtures, real Hero/God controls, 320/360/640/960/1280 layouts, Leave/Stay, and Tithe. A fixture is not an end-to-end campaign victory test.

VR hand mapping and trigger ownership are centralized in client/vr-input-policy.js; full mapping and single-controller limits are in ../docs/VR-CONTROLS.md. Left-stick click now interacts/stows. Controller disconnection, menu and equipment changes cancel pending inputs rather than firing a late release. Test node tests/vr-input-policy.mjs. Physical headset, phone and cross-network acceptance remain outstanding.

### Contextual harvesting hints
Heroes receive a small read-only aim cue for trees, ore and loose logs, plus held-log, nearby pickup and forge-delivery guidance. Labels follow desktop/touch controls; menus, God view and XR hide the DOM cue. Probing is capped at 10 Hz with terrain occlusion and short target hysteresis. Tests: `node tests/interaction-cue.test.mjs` and `node tests/interaction-cue-view.test.mjs`. Physical headset cues remain separate from this DOM feature.

Tree art uses the canopy-20261003 kit (`assets-source/trees/canopy-20261003/`). Its builder and packed Blender source preserve exact shipped trunk/root topology, cut guides and fall tips; new lobed leaf shells, twig collars, bark and end grain retain existing instancing, LOD, wind and harvesting.

Meteor and boulder templates use the closed, opaque geology-20261003 kit. `assets-source/geology-20261003/` retains the deterministic builder, Blender source and verification contract; it can regenerate 17 variants/LODs/pickups. Only the two existing runtime templates are installed currently; worked-state models and additional resource kinds are not wired.

Remote Heroes use the rigged `hero.glb` through `client/hero-view.js`: deterministic two-palette selection, idle/walk/run blending, authoritative HP hit reaction, tracked-hand IK and 16m LOD. Materials are shared across players and shaders warm before replacing capsules. Source/portable gloves/standalone LOD live in `assets-source/hero-20261003/` and `public/assets/`. The local first-person body is intentionally not shown. Remote Heroes now carry all seven regular weapons using the same authored grip contracts as local VR hands; bow uses the left grip. VR head-look and bounded crouch preserve feet and tracked-hand IK. Attributed successful strikes and specials animate remote attacks; air swings and bow draw are not replicated by the current protocol. Held bones retain the existing physics presentation rather than a duplicate weapon. Tests: `node tests/hero-view.mjs` and `node tests/hero-equipment.mjs`. Physical HMD acceptance remains outstanding.

Terrain materials now consume a bounded presentation-only deformation field: exposed strata, wet cut floors, disturbed soil and slope transitions share the authoritative height and undeformed base. High/medium/low fields use 384/256/192 texels per side, updated through dirty rectangles under the existing frame budget. Two strata textures are retained with their generator in assets-source/terrain-strata. Existing terrain masks and gameplay geometry are unchanged. Tests: node tests/terrain-presentation.mjs. Actual high and coarse-pointer low browser shader checks passed without missing chunks or texture errors; physical mobile GPU/headset performance is still unverified.

### Touch casting and multi-finger controls
Quick cast on: tap ground to cast a point spell; Sunder/Wall drag from start to end and cast on release (two taps also work). Quick cast off: tap to aim, or drag a line, then press Cast. The Cast button hides in quick mode. Pinch zoom, cancelled pointers, gestures ending over UI, spell changes, menus and focus loss do not accidentally cast. Invalid line lengths show an explicit 0.5–18m hint and invalid targeting tint. God camera orbit remains on the right thumb stick; point-spell world drags also orbit.

Mobile utility buttons own their pointer through release so live HUD text updates cannot swallow a tap. Weapon/spell/action buttons explicitly route secondary fingers: hold Attack and press Special with the other thumb to curve Emberwing without releasing the arrow. Pointer cancellation stops held attacks. Regression: `node tests/touch-input.mjs`; browser touch evidence uses actual Chromium touch events on portrait/landscape views and is recorded in the sprint document. Physical phone testing is still outstanding.

### Staged magical tree growth
Newly planted trees now extend a sapling trunk, sprout branches, expand foliage, ripen fruit and settle with a small deterministic canopy jiggle inside the existing 1.4 seconds. Mature transforms are unchanged; no extra draw calls or geometry. Growth uses per-part instance matrices in client/tree-growth.js. Existing/saved/late-joined trees start mature. Cutting during growth safely completes the presentation before the existing notch/fall logic. Branches are grouped meshes, so they sprout as a family rather than twig by twig.

Checks: `node tests/tree-growth.mjs` and `node tests/tree-integration.mjs`. Reusable actual-browser checks from repository root: `node multiplayer/tests/browser-touch-casting.mjs` and `node multiplayer/tests/browser-tree-growth.mjs`. Set ACCEPT_BASE for local QA or hosted preview; PW_CORE/PW_CHROME optionally select installed Playwright/Chromium. These create isolated rooms and use real input plus read-only diagnostics. Results/screenshots go to ignored logs/browser-acceptance/. Local staged visual fixture: /tests/tree-growth-stages.html. Physical phone/headset acceptance remains outstanding.


Boulder refinement: the installed boulder now uses the angular fractured silhouette in `assets-source/geology-20261003/boulder-refinement/`, which supersedes the original builder for this one runtime asset. Same closed single shell, 5120 triangles and two materials; 663896 bytes. Other generated variants remain original and are not runtime swaps. The meteor is unchanged.

## Mobile, meteor and skeleton pass — 2026-10-03

Phone lobby and Menu fit portrait/landscape without scrolling. Menu has Play, Controls, World and Supplies tabs; expanded help/recovery lists remain secondary content. Collapsed quests occupy one row; fullscreen/menu share the top-right utility dock.

Tap visible loose gems, stone, apples, logs or bones within reach to collect. Raw deposits and trees still require tools. Quick cast uses taps for point spells and drag release for line spells. Bow draw survives releasing the movement finger and small browser-toolbar resizes.

Starfall deterministically awakens a meteor golem 25% of the time. It unfolds and fights; killing it pays six gems, triple the normal reward. Outcomes and overflow rewards survive saves.

Menu → Supplies: three wood bandages a Hero (+35 health) or mends the Forge for a God (+20); two stone repairs +35 Forge integrity (Heroes within five metres); one gem rekindles a Hero (+35 health, ready eligible special, cool weapon) or restores +40 God mana. No benefit means no consumption. Bridges and Expedition deposits remain available.

Skeleton broad-phase uses conservative bone bounds; exact animated triangles and embedded arrows remain intact. Nearby enemy shadow casters cap at four touch/eight desktop. See [performance evidence](../docs/SKELETON-CONTACT-PERFORMANCE.md) and [mobile/meteor handoff](../docs/MOBILE-METEOR-PASS-20261003.md).

## Starting meadow and friends expedition

Fresh worlds include a stone sanctuary, mining outcrop and ruined watch-arch, connected by stepping stones, with ore and hidden supplies to discover. Old saves retain their layout. Dead golem chunks take two pick swings to salvage stone.

On touch, tap a visible enemy to aim and swing; tap a tree with the axe or ore/golem chunk with the pick. Loose loot taps collect it. Heal, Deliver and Drop are directly accessible. Hold Draw to use Emberwing as before.

Press **Start Expedition**: gather and Deliver to the Forge, recover the fallen star, then defend and rekindle the Forge through three waves. Milestones restore the party; victory grants six wood/four stone/three gems each and full health/mana. Gods contribute through terrain/planting, bounded tithe and combat spells, including solo play.

[Implementation, tests and timings](../docs/FRIENDS-STARTING-WORLD-20261003.md).

## Combat and recovery

Enemy melee commits to a target and direction during the wind-up. Dodge aside or retreat before the strike; a stagger or solid cover interrupts damage. Crowds separate and steer around nearby trunks and structures. Death grants three seconds of protection, clears a held attack and resets the camera at the new spawn. These rules apply to existing saves after refreshing the host's game.

[Combat verification, limits and timings](../docs/COMBAT-QUALITY-20261003.md).
