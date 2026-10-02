# Browser multiplayer proof

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

Remote Heroes use the rigged `hero.glb` through `client/hero-view.js`: deterministic two-palette selection, idle/walk/run blending, authoritative HP hit reaction, tracked-hand IK and 16m LOD. Materials are shared across players and shaders warm before replacing capsules. Source/portable gloves/standalone LOD live in `assets-source/hero-20261003/` and `public/assets/`. The local first-person body is intentionally not shown. At this checkpoint remote held weapons and VR crouch/head-look refinement remain pending. Test: `node tests/hero-view.mjs`.

Terrain materials now consume a bounded presentation-only deformation field: exposed strata, wet cut floors, disturbed soil and slope transitions share the authoritative height and undeformed base. High/medium/low fields use 384/256/192 texels per side, updated through dirty rectangles under the existing frame budget. Two strata textures are retained with their generator in assets-source/terrain-strata. Existing terrain masks and gameplay geometry are unchanged. Tests: node tests/terrain-presentation.mjs. Actual high and coarse-pointer low browser shader checks passed without missing chunks or texture errors; physical mobile GPU/headset performance is still unverified.
