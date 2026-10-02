# Browser-hosted Brann's Forge: feasibility and implementation scope

Status: source audit and proposal, 2 October 2026. No remote multiplayer,
browser game, WebXR port or public server was deployed by this work.

## Decision

The intended product is feasible: open a link, join a room, and inhabit the
same world as Hero, Fairy or world-builder, with VR on supported devices.
Three.js is a suitable browser renderer. It does not provide the existing
physics, game rules, accounts or multiplayer automatically.

Recommended first candidate: **Three.js clients + a hosted Godot simulation**.
Keep native OpenXR as a supported VR client while proving WebXR separately.
This is a substantial engineering programme; full feature parity and headset
performance cannot be confirmed by an audit. Start with a falsifiable slice.

The earlier MULTIPLAYER-SESSION-ARCHITECTURE.md proposed a player's native
game owning the world. That is a useful private co-op stepping stone, but it
cannot deliver independent hosted worlds when that player turns their PC off.
Hosted authority is the long-term target proposed here.

## What is reusable, and what needs work

| Area | Existing evidence | Browser/shared-world work |
| --- | --- | --- |
| Models and animation | 329 GLB 2 files, 154.41 MiB total; 4 contain skins, 7 contain animation clips | Reuse geometry/textures/clips, verify colours, transforms and animation in Three.js; stream selected asset packs. Most animation also lives in game code. |
| Environments | Placement JSON and `authored_zone_kit.gd` batching/collision metadata | Portable asset catalogue and chunk manifests; preserve gameplay identities independently of instancing. |
| Terrain and planet | `orchard_planet_fields.gd`, `orchard_planet_terrain.gd`, runtime operation stacks | Server emits authoritative chunk heights/meshes, edit revisions and collision data. Do not assume matching seeds yield identical noise in JS. |
| Presentation | 24 Godot shaders, procedural meshes, particles, weather and native Control UI | Rebuild renderer-specific materials/VFX/UI; preserve art direction and GPU budgets. GLB alone does not include the scene's full appearance. |
| Combat and physics | Posed-triangle enemy contact, bone-local arrows, dismemberment, spring limbs, mining and gripping | Preserve authoritative mechanics in Godot initially; replicate attachment/bone/entity IDs and state transitions; browser prediction and visual reconciliation are new work. |
| Multiple roles | Native FPS/RTS/Fairy windows share one `World3D` | Separate player entities, authenticated role ownership, remote commands and snapshots. A second camera today is not a network client. |
| Session foundation | `service/session-contract.cjs` validators and replay gates | New versioned schema: transforms, asset IDs, animation, health, ownership, world edits, events and snapshots; current schema only carries 128 position-only entities. |
| Persistence/progression | Local saves, quest configuration, workshop tiers, RTS resource ledger | Per-world storage and transactions, reconnect/recovery, permissions, idempotent rewards and save migration. |
| Forge and voice | Local service can commission code/assets and initiate paid work | Separate privileged service and quotas; ordinary public players must never gain local developer tools or credentials. |

Inventory includes test and unused content, not a shipping manifest. Largest
GLB is the golem, 16.35 MiB. The audit reads GLB headers/JSON; it does not certify
visual parity, licences, texture memory, animation quality or browser loading.
The only declared required extension found was KHR_texture_transform, which
Three.js GLTFLoader supports. See the official [loader documentation](https://threejs.org/docs/pages/GLTFLoader.html).

Reproduce with `python scripts/web_readiness.py`. It writes an ignored JSON
inventory and errors to `logs/`, plus measured `logs/work-timing.csv`. It does
not start a game, alter saves or publish assets. First run: 0.522 seconds,
329 valid GLB headers/manifests, zero parse errors.

## Compare the three approaches before committing to the whole migration

1. **Godot web export:** greatest potential code reuse if the user mainly
   wants browser access. Current project uses Mobile/OpenXR and only a Windows
   export preset. Godot web requires Compatibility/WebGL2 and a WebXR adapter;
   native windows, local service URLs, process execution, audio and storage
   need adaptation. Run a small isolated export test rather than changing the
   live project renderer. This would be a browser game, but not Three.js.
2. **Three.js client, Godot server:** preserves physical rules while providing
   a real browser-native client. Requires server boot isolation, a portable
   protocol, scene export and browser presentation/input. Headless tests show
   some game logic can run without a display, not that the full game is ready
   to host unattended. Audit GPU-dependent mesh readback before stripping
   visuals: precise hitboxes still need mesh and skeleton data on the server.
3. **Three.js plus a JavaScript simulation:** clean browser-first architecture
   but the largest rewrite. A physics library does not reproduce our grip,
   cutting, articulated remains and terrain logic. Keep this option if the
   server extraction proves too costly; do not maintain two competing rulesets.

Official references: [Godot web export](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html),
[Godot WebXR](https://docs.godotengine.org/en/4.7/tutorials/xr/webxr_intro.html),
[dedicated servers](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_dedicated_servers.html).

## Proposed runtime boundary

```text
HTTPS site/CDN: login, lobby, Three.js client, versioned asset packs
                         |
                 authenticated WSS
                         |
              room/session gateway
                         |
          long-lived headless Godot world
          commands -> simulation -> snapshots/events
                         |
            world persistence + checkpoints

Native OpenXR client ---- same room protocol
Browser WebXR client ---- same room protocol when supported
Privileged forge/voice -- separate opt-in, metered service
```

Rendering runs locally on each player's device; this is not video streaming.
Server owns collisions, health, resource spending, item ownership and edits.
Local camera/head tracking must never wait for a network round trip. Predict
movement and held presentation locally; reconcile physical results. Interpolate
remote actors. Validate reach/velocity/actions server-side without making the
headset camera follow corrections abruptly. The existing native Hero must also
become a client; it cannot remain a second authority in a hosted room.

Start with small private rooms of 2–4 participants, not an MMO. Interest filters,
sleeping physics and dormant rooms contain server cost. Load nearby content,
cache immutable packs, compress textures/geometry after visual checks, and
offer quality tiers for standalone headsets and phones. Free-to-play is a player
pricing choice; hosting, bandwidth and optional AI still consume resources.
Measure cost per active room-hour before committing to a free operating budget.

Vercel or another CDN can serve the site, login endpoints and assets. Use a
long-lived process/container host for simulation. Do not make the simulation's
lifetime depend on a serverless HTTP request. Current official Vercel pages
give conflicting WebSocket guidance (older limits say unsupported, newer
Fluid-compute guidance says supported); validate the chosen deployment rather
than relying on the old proposal's beta claim. This does not affect the
recommendation to host the simulation independently. Sources:
[limits](https://vercel.com/docs/limits),
[current real-time guidance](https://vercel.com/i/websocket-vs-server-sent-events).

Never expose `service/server.js` or proxy port 8787 publicly. It binds loopback
and includes forge/voice/save capabilities. Build a separate allowlisted game
protocol. Room codes locate rooms; short-lived scoped credentials authorize
players. Reject stale roles, duplicate rewards, malformed inputs and excessive
spawn/edit rates. Keep account tokens, local paths and forge prompts out of
snapshots. Public launch also needs account recovery, reporting/moderation,
backup/restore, cost caps and an asset/licensing review.

## How VR joins

Target browser flow: open HTTPS URL in a supported headset browser, sign in or
use a paired short-lived session, choose room and Hero role, then deliberately
press Enter VR and accept the browser's immersive-session permission. Use
runtime capability detection and offer ordinary desktop play if unsupported.
Three.js supports WebXR rendering; browser/device support remains uneven.
Do not promise the Vive Pro 2 + SteamVR + browser combination without testing
that exact runtime. Preserve native Vive support through the shared protocol.

Acceptance must cover controller bindings, two-hand bow drawing, grip poses,
haptics, floor height, reference-space reset/recentering, radial planet up,
lost tracking/session interruption and physical comfort. A mouse-driven XR
emulator cannot establish headset acceptance. Headless source checks cannot
establish WebXR compatibility. References:
[Three.js VR](https://threejs.org/manual/pages/how-to-create-vr-content.html),
[WebXR availability and HTTPS](https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API).

## First proof and gates

**Stage A — choose the cheapest viable client:** compare one small Godot web
export against one Three.js scene loaded from the same authored assets. Measure
cold load, memory, frame time and visual fidelity on desktop and a target
headset. Treat 15 MiB initial playable download and 60 FPS desktop as initial
budgets to test, not present capabilities. Headset budget follows its actual
refresh rate. Keep a capped low-detail tier and disclose compromises.

**Stage B — real shared world:** a clean headless process with a disposable
world, one clearing, tree, skeleton and tool. Two separate browser sessions:
Hero moves/strikes; RTS summons a skeleton and raises a small patch. Both see
the same death, terrain collision and exactly one resource reward. Drop a
connection and restart/rejoin from a checkpoint without duplicate rewards.
No native render window or developer bridge may be required for this gate.

**Stage C — physical identity:** precise skull/limb hit, embedded arrow follows
the struck bone, detach/death preserves it, and two players cannot both own a
held object. Add Fairy and shared terrain edits only after state identity holds.

**Stage D — VR:** native client joins the hosted authority, then WebXR on an
actual supported headset. Test throws, perch, bow, mining and terrain changes
under realistic latency. Keep simulation validation independent of local pose
smoothing. Handle background tabs and connection loss explicitly.

**Stage E — private hosted playtest:** login, invitations, session grants,
backup/recovery and bandwidth/cost telemetry. Measure p50/p95/p99 round-trip
and input-to-authoritative-result latency, room tick time, browser CPU/GPU frame
time, bytes/sec and asset download size. Begin with proposed 30 Hz simulation
and 10–20 Hz state delivery, then tune from evidence; VR rendering stays at the
device rate. Repeat with constrained bandwidth and latency injection.

Only after these gates expand to the small planet, all biomes and full content.
Exact completion dates or parity claims before these proofs would be guesses.

## Parallel programme

- **Astra simulation/network owner:** clean server boot, command boundary,
  state identity, authority and persistence; no browser UI ownership.
- **Astra browser owner:** renderer, asset loading, remote animation and
  client prediction against a frozen protocol; no server rule duplication.
- **Astra gameplay owner:** a coherent Forge -> timber/ore -> guardian ->
  physical return -> tool unlock adventure. Connect existing quest, workshop
  and RTS economies with exactly-once rewards rather than inventing another
  progression ledger.
- **Astra verification owner:** network-failure, frame-budget, asset and
  cross-client parity fixtures. Coordinator owns interface changes/integration.
- **Opus design/art:** compact lobby/HUD and coherent environment/VFX passes;
  serial isolated commissions using the personal subscription once signed in.

Do not start four clients with different state assumptions. Agree the minimal
protocol first; then split ownership and integrate one playable milestone at
a time. Current compact UI commission remains prepared but blocked by signed-out
Claude CLI. No metered fallback was used.
