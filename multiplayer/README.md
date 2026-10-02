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
native tree/skeleton/axe assets in a small shared clearing. Gods spend mana on
skeletons, raised earth, groves and a telegraphed meteor. Heroes can interrupt
God spells by damaging the shrine. Full native combat, buildings, inventory,
world generation and progression are not yet ported.

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
