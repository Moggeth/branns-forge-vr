# Multiplayer protocol checks

Browser acceptance scripts using `browser-acceptance-lib.mjs` disable WebXR by
default so desktop testing cannot wake SteamVR/OpenXR merely by checking headset
availability. Use `BROWSER_QA_XR=1` only for deliberate XR acceptance. Always close
owned browser contexts in `finally`, end any XR session, and close any VR runtime
the test started when finished. Do not leave test browser windows or headsets
running. Set `PW_CORE`, `PW_CHROME` and `ACCEPT_BASE` to the existing local runtime
and disposable review server; capture evidence under ignored `logs/`.

Run against an owned disposable proof server, never the native forge/voice service:

```powershell
$env:TEST_WS_URL = 'ws://127.0.0.1:8090/ws'
node multiplayer/tests/run.mjs
node multiplayer/tests/load.mjs
node multiplayer/tests/network.mjs
$env:TEST_ORIGIN = 'http://127.0.0.1:8090'
node multiplayer/tests/gateway.mjs
```

The scripts create synthetic rooms, keep reconnect secrets in memory, and print only sanitized JSON results and measured per-step timings. They close their own connections but do not start/stop the server or alter source game saves. Redirect stdout to the project's ignored `logs/` directory for durable evidence. The server owns room expiration and proof-state cleanup. `TEST_LOAD_SECONDS` defaults to 8 and can extend the concurrency window. Install the multiplayer package's `ws` dependency first.

Integration covers independent peer roles, replicated authoritative movement, idle stop, sequence replay, local VR pose bounds, role permissions, mana/cast cooldown, identity-preserving role changes, reconnect exclusion, invalid numerical values, oversized input, enemy summon, real melee damage, ignored client damage and starfall death/terrain replication. Load checks 32 simultaneous clients, explicit rejection of client 33, saturation of all three 64-entry world caps and overflow refusal, concurrent input, bounded snapshots and broadcast cadence. This is transport/simulation evidence; it does not establish browser presentation, physical VR interaction or WAN performance. Disconnected-player 60-second eviction and 30-minute idle-room expiration are not timed by these short suites.

## Recorded local proof — 2026-10-02

Ran against the independently owned Godot proof server on loopback port 18081 with isolated proof state. No native bridge or native save was accessed. Results below omit room/player identifiers and reconnect tokens.

| Step | Outcome | Measured seconds |
| --- | --- | ---: |
| Instructions and contract read | Complete | 0.077 |
| Project verification guidance read | Complete | 0.086 |
| Initial Node syntax checks | Pass | 0.208 |
| Initial protocol integration | Pass | 7.845 |
| 32 clients and 33rd rejection | Pass | 1.106 |
| 64 edits, 64 groves, 64 enemies and overflow rejection | Pass | 5.285 |
| Concurrent input and broadcast measurement | Pass | 8.307 |
| Expanded integration first attempt | Harness snapshot race | 2.484 |
| Expanded integration after targeted harness fix | All nine checks pass | 8.298 |

The load window sent 4,480 commands in 8.306 seconds (target 20 Hz per peer, actual aggregate about 539 commands/second). Broadcast cadence was 9.99 Hz; p95 arrival interval was 101.23 ms. Maximum snapshot was 22,705 bytes, aggregate received traffic across all 32 peers was 60,103,764 bytes, and command errors during the measured load window were zero. World-cap rejection errors occurred deliberately before the measurement window.

Harness learning: independent sockets do not receive a snapshot atomically. An immediate caster-mana assertion after the observing hero received its terrain snapshot failed despite correct server behavior. Await the caster's own updated snapshot before asserting its mana. The targeted fix passed on the next run; do not replace state-based waits with larger arbitrary sleeps.

## Gateway and reconnect review

`network.mjs` uses a synthetic browser WebSocket to exercise the actual network client without a live server. Five regression checks passed in 0.702 seconds: commands wait for welcome, sequence restores correctly, rejected/expired identities stop reconnecting, session takeover does not fight the new socket, and transient disconnects still retry. The transient retry interval measured 0.565 seconds.

`gateway.mjs` uses the root-owned gateway and never starts another instance. `/health`, forbidden-origin and wrong-path rejection, create/join/pong traversal and preserved takeover close code 4001 all passed in 0.346 seconds. Set `TEST_REQUIRE_ORIGIN=1` when targeting production to additionally assert missing-Origin rejection. That production-only branch was not executed against the development instance.

Review fixes verified in source: terminal join errors end stale-token loops; sends wait for welcome/sequence restoration; takeover close codes survive the proxy; readiness uses a bounded application ping cached for one second; the child simulation binds loopback. Origin allowlisting is exact and production requires configuration. Origin checks restrict browsers but are not authentication; guest room codes/reconnect tokens remain the proof's access model. No account/login boundary was tested.

Production-mode follow-up (2026-10-02): `node tests/production.mjs` starts and
stops an isolated, owned gateway/server pair through a private IPC channel. Exact
Origin rejection, missing-Origin rejection, health ping and takeover passed; all
nine integration checks passed through that production-mode proxy. Measured
readiness + suites: 9.714 s. Physical VR/WAN and image runtime remain unverified.
Final server spawn/separation follow-up: nine checks passed (~8.23 s); targeted
separated Hero spawn and enemy-on-Hero push-out check passed in 0.470 s.

Browser verification: two local browser tabs independently joined as Hero/God;
a terrain raise appeared in both snapshots and raised the Hero to the new ground;
a summoned authored skeleton attacked the Hero. No console errors were observed.
The selected browser correctly reported immersive VR unsupported. Model height
inspection found the skeleton 1.676 m, normalized to 1.7 m; observed camera
clipping was enemy overlap, fixed with bounded server separation. The renderer
bundle compiled successfully; native headset/controllers have not been tested.
