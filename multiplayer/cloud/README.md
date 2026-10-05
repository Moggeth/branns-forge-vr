# Cloud rooms (personal free plan)

Stable service: https://branns-forge-rooms.fauxgrady.workers.dev

Browser endpoint: `wss://branns-forge-rooms.fauxgrady.workers.dev/peer/cloud`.
Vercel serves the game/assets. One player runs the 60 Hz world simulation. Cloudflare
Workers and one SQLite Durable Object per room handle eight-digit invites, membership,
reconnect credentials and host handoff. Neither the developer's PC nor its tunnel is
in this route. Closing the browser that is *currently hosting a world* still requires
another eligible desktop player to accept the continuation offer. Otherwise use the
browser recovery save. This is not a dedicated always-running simulation/cloud save.

Direct WebRTC is preferred. After eight seconds without a usable connection, the same
cloud service forwards bounded game frames over secure WebSockets. This avoids a paid
TURN dependency and works when UDP/direct peer connections are blocked. The relay can
see forwarded payloads; it does not log or persist game state. Each client renders its
own graphics. A relay has extra latency compared with a direct route.

The personal account's Workers **Free / $0 / Current plan** was verified in the
dashboard on 2026-10-03. No paid plan, TURN service or payment method was enabled.
Free quotas are hard limits, not unlimited capacity: 100,000 Worker requests/day,
100,000 Durable Object requests/day (incoming WebSocket messages count 20:1),
13,000 GB-seconds/day of DO duration and the SQLite storage/write limits apply.
Multiple busy relayed rooms use that allowance faster than direct rooms. At capacity,
new joins/relayed play can fail until reset; solo works and healthy direct edges can
continue through a temporary signaling outage. Never promise unlimited public scale.
Pricing source: https://developers.cloudflare.com/durable-objects/platform/pricing/

## Deploy / inspect / recover

### Public room directory (2026-10-04)

`GET /peer/rooms` lists public multiplayer rooms, 50 at a time. Pass the returned
`nextCursor` as `cursor` for the next page. Rows expose only room codes, host/player
display names, initial chosen roles, online counts and playing/full/waiting status.
They never include reconnect secrets, peer IDs, ICE data or saves. Solo is not listed.
There is no private multiplayer mode. Listing is read-only, origin checked for browser
requests, and separately rate limited (60 requests/minute/IP).

Deploy the v2 Wrangler migration before publishing a browser that uses this endpoint.
It adds a separate SQLite ForgeDirectory binding; it does not replace ForgeRoom or
delete existing room data. Active rooms refresh metadata once per minute and on
membership/handoff; entries expire after 150 seconds without refresh. Empty rooms
are removed immediately. Existing rooms from before this deployment appear when
their coordinator next handles traffic or membership; a page reconnect registers an
otherwise idle old room. Directory failure is logged and does not reject gameplay.
The index introduces one refresh/alarm per occupied room per minute, separate from
gameplay traffic. Pagination and cleanup bound individual operations; it is not an
unlimited-capacity lobby service.

### Quick play regions (2026-10-05)

The welcome screen's **Play** button reads the directory and joins the fullest joinable
room in the player's region, else creates one (`client/quick-play.js`). Regions are
coarse ping buckets from Cloudflare's `request.cf.continent`, never from the client:
`na`, `sa`, `eu` (Europe + Africa), `as`, `oc` (Oceania + Antarctica). The Worker stamps
a room's region at creation (any client-supplied `region` parameter is discarded) and
the room's listing carries it; `GET /peer/rooms` also returns the caller's own `region`.
No code changes are needed in the Durable Object migrations. Until this Worker version
is deployed, rows and callers have no region, so quick play matches every room
(fullest first) instead of by region. Rooms created before the deploy stay unregioned
and only match unregioned callers.

A full room reserves a disconnected guest's seat for five seconds. Its coordinator
refreshes the listing at that deadline, so the vacancy does not wait for the next
minute heartbeat. Host and pending continuation seats retain their separate recovery
rules. `node tests/cloud-directory-lifecycle.mjs` verifies these deadlines and
hibernation; `node tests/room-service-gate.mjs` verifies release readiness checks.

Checks: `node tests/room-directory.mjs`, `node tests/public-room-directory.mjs`, then
`CLOUD_TEST_URL=http://127.0.0.1:8792 node cloud/directory-test.mjs` against the owned
local Wrangler process (set the environment variable using your shell's syntax).
The live test verifies CORS, no public writes, list/create/join/full, host transfer,
waiting status and empty-room removal. Use `node cloud/test.mjs` for protocol recovery.

From `multiplayer/` using the personal Cloudflare subscription:

```powershell
npx --yes wrangler@4.147.0 whoami
npx --yes wrangler@4.147.0 deploy --config cloud/wrangler.jsonc
$env:PEER_URL='wss://branns-forge-rooms.fauxgrady.workers.dev/peer/cloud'
node scripts/check-room-service.mjs
./scripts/deploy-peer-preview.ps1 -PeerUrl wss://branns-forge-rooms.fauxgrady.workers.dev/peer/cloud
```

Despite its historical filename, `deploy-peer-preview.ps1` publishes production.
Deploy the Worker first, then require the read-only readiness gate to pass before
publishing the frontend. The gate requires `/peer/health` to advertise the shared
human capacity (currently 32) and `/peer/rooms` to return a valid HTTP 200 listing;
it times out after eight seconds and never logs endpoint credentials. The live
frontend workflow runs this same gate before its build and deploy. To inspect the
Worker separately, run `npx --yes wrangler@4.147.0 tail --config cloud/wrangler.jsonc`.

`GET /peer/health` reports service/protocol, never credentials. Dashboard Workers
observability samples 10% of events; explicit application logs include room/count only.
Do not print Wrangler OAuth tokens, socket credentials, SDP or game frame contents.
Secrets stay in Wrangler's user configuration, never this repository. Revalidate the
Free plan before any account upgrade or paid service integration.

The Worker uses a hibernating WebSocket API, persisted membership/authority and alarms
instead of polling timers. Closed rooms expire after 30 minutes with no signaling
sockets; all rooms have an eight-hour lifetime. Worlds remain recoverable from client
saves. An explicit host departure offers continuation immediately; network loss gets
15 seconds of grace. A continuation offer lasts two minutes. Healthy direct peers
decline unnecessary migration offers after a signaling-only interruption.

Origins are explicitly allowlisted; signaling/relay routes are restricted to the
room's host and guests. There are per-IP connection limits, per-socket message/byte
limits, at most 32 members, at most 40 pending/connected sockets, and 12-second
join timeouts. These limits reduce abuse but invite codes are not private accounts or
anti-cheat. Browser hosts are authoritative and trusted in this friends playtest.

For local development:

```powershell
npx --yes wrangler@4.147.0 dev --config cloud/wrangler.jsonc --port 8791 --inspector-port 9233
# Separate shell:
$env:VITE_PEER_WS_URL='ws://127.0.0.1:8791/peer/cloud'
npm run dev -- --strictPort
# Separate shell:
node cloud/test.mjs
```

Stop only the owned local Wrangler/Vite commands with Ctrl+C. `.wrangler` runtime
state is ignored. Do not delete a production Durable Object namespace to troubleshoot:
that loses room membership. Deploy a fix/rollback and let clients resume with their
credentials. The user-owned old 8789 service and Quick Tunnel were deliberately not
stopped during migration and are no longer required by the new website build.

## Verification and lessons

- Local protocol: 0.353 s. Hosted protocol: 1.984 s. Origin rejection, room/peer isolation,
  eight-player limit, relay forwarding, epoch rejection, reconnect identity, transfer and
  host-departure recovery passed.
- Hosted real-browser direct route: 6.031 s, including a forced signaling outage while
  simulation/RTC continue, restoration without replacing the live simulation, host
  handoff and old-host commands accepted by the new host.
- Hosted forced no-ICE route: 17.743 s, including the eight-second fallback at first
  join and again at handoff. Game commands replicate through the actual cloud relay.
- Public-interface local-cloud Hero/God expedition and terrain replication: 11.978 s.
- Solo/reload regression and legacy Node signaling tests: combined command 2.178 s.
- Timberline: 14 authority checks (0.168 s); real touch Aim & fire and 2 Wood + 1 Iron
  ammunition deduction (5.964 s). Build costs 10 Wood + 6 Iron + 2 Mithril; four-second
  reload. Menu > Forge > Build > Timberline; then Built > Aim & fire. VR has the same
  ray placement/aim actions, but physical headset acceptance is still unverified.
- Initial protocol fixture assumed ordering across *different* sockets: transfer raced
  checkpoint readiness and timed out. Use a same-socket ping acknowledgment barrier.
- An initial browser fixture sent `target` to cast instead of the real `point` contract;
  it correctly failed `invalid_cast`. Reuse existing session fixtures.
- Handoff left old relay/ICE frames in flight; the coordinator rejects stale epochs and
  the client suppresses only errors already explained by a known epoch/departure.
- Wrangler OAuth lacks subscription-list API permission (403). Verify the actual plan
  in the dashboard rather than attempting wider credentials or assuming it is paid/free.
- Abrupt host-tab loss now recovers in the hosted browser test (17.700 s including
  the 15-second grace). An RTC channel can remain nominally open after its host is
  gone: use recent received game traffic for liveness, never `readyState` alone.
  The crash fixture must wait for the recovery checkpoint, not merely the faster
  rendered snapshot. An abrupt crash can lose the last half-second between checkpoints.
- Final direct outage/handoff retest: 5.994 s. The original live simulation survives
  signaling reconnect; commands also reach the new host after handoff.
- Public Vercel cutover build/stage/deploy: 11.615 s, source b6538e4,
  deployment `dpl_A2R4JwqAXbkmcgkpPfCYqD6ujxLH`. Public Hero/God play: 13.350 s;
  solo/portrait lobby with zero sockets: 6.182 s. Public forced-relay Hero/God play:
  19.927 s, with every room socket verified on the cloud hostname. Both players saw
  the shared Expedition and terrain edits, with no application/resource errors.

Cloud Worker version at cutover: `b5842550-8296-4178-a4fb-69cd9e6b5fa9`.

The liveness fix shipped as source `d95e2ef`, Vercel
`dpl_HXLRKtbijk2vcf6E1WVh6C3aPMio` (13.270 s build/stage/deploy). With local
Wrangler and Vite stopped, the anonymous public two-browser UI check passed in
30.500 s: create/join, Expedition, terrain replication, cloud-only socket URLs,
abrupt host-browser closure, visible **Continue world here** button and successful
takeover retaining the terrain edit. The old user-owned 8789 service was preserved.
A subsequent text-only correction replaces the obsolete "no relay" warning with
the actual cloud fallback status; it does not change the verified network protocol.

Use `tests/cloud-transport.mjs` with `CLOUD_WS_URL`, `ACCEPT_BASE` (local fixture server),
`PW_CORE`, `PW_CHROME`, `BROWSER_QA_DIR`; `FORCE_RELAY=1` injects unavailable ICE.
Fixtures are excluded from the public deployment. `cloud/test.mjs` accepts
`CLOUD_TEST_URL` / `CLOUD_TEST_ORIGIN`. Logs/captures/results go under ignored `logs/`.
Physical headset, physical phone and two independent household networks remain manual
acceptance items; forced-relay tests demonstrate the fallback, not those devices.
