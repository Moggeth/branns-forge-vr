# Multiplayer proof packaging

Prepared deployment files only: nothing was provisioned, uploaded or deployed.
Use one Linux amd64 container containing the Node gateway, the Godot simulation
and built browser files. The gateway owns Godot's lifecycle. Browser source must
include the final approved `index.html` before building; an incomplete frontend
fails `npm run build` rather than shipping a placeholder unnoticed.

## Image and local acceptance

Run from `multiplayer/` after installing Docker; this directory is the complete
build context. Do not build from the parent workspace or copy native saves.

```sh
docker build --platform linux/amd64 -t branns-proof:review .
docker volume create branns-proof-data
docker run --detach --name branns-proof --restart unless-stopped \
  --publish 127.0.0.1:8090:8090 --mount source=branns-proof-data,target=/data \
  --env ALLOWED_ORIGINS=http://127.0.0.1:8090 branns-proof:review
curl --fail http://127.0.0.1:8090/health
docker logs branns-proof
docker exec branns-proof cat /data/logs/simulation.log
docker stop --time 10 branns-proof
```

These local commands are verification, not a remotely accessible preview. Use a
TLS reverse proxy or the approved provider endpoint for actual remote play.
Publish only 8090; never publish Godot's 8081. `/health` verifies the simulation
application ping/pong (cached for one second); it does not prove browser, WebXR or persistence acceptance. Run the
protocol tests with the exact allowed `Origin` plus browser checks against the
candidate deployment. Verify terrain survives a container restart, both clients
see shared edits, and stale replaced sessions stop reconnecting (close 4001,
`session_replaced`). Reconnect tokens do not survive server restart.

The image pins Node `22.20.0-bookworm-slim` and Godot `4.7.2-stable`; npm uses the
committed lockfile. The Godot Linux archive is checked against SHA-256
`cadd3204e728a35d3f13adb7fd0d7902636b79f6b95c40c265eb73b6c35329e4`, returned by
the [official GitHub release API](https://api.github.com/repos/godotengine/godot-builds/releases/tags/4.7.2-stable)
on 2026-10-02. [Official release](https://github.com/godotengine/godot-builds/releases/tag/4.7.2-stable).
The Node tag and Debian packages are not content-digest pinned; record the final
image digest after the first verified build and deploy that digest for rollback.
Only amd64 is supported by this Godot download; ARM requires a separately verified
archive and digest. Container build also runs Godot `--version` to catch missing
Linux shared libraries. Runtime initializes mounted directories as root, then
executes both services as the unprivileged Node user (uid 1000).

## Persistent state and security

Mount one private durable volume at `/data`. Structural world state lives in
`/data/worlds/worlds.json`; server metadata log is `/data/worlds/server.jsonl`;
gateway and simulation logs are `/data/logs`. They contain no protocol frames or
reconnect tokens. Configure supervisor/provider log rotation and disk monitoring.
Source and generated assets never need write access to the native game directory.

Exactly one replica is supported. Guest sessions and combat are in process memory;
multiple replicas would split rooms and cannot safely share this JSON file. Keep
the container running for connected play. A restart preserves structural room
state but resets guest identities; a client receiving `invalid_token` must offer a
fresh join. Rooms expire after 30 minutes without connected guests. There is no
account system, room owner, access revocation or moderation. Random room codes
provide guest access; do not place sensitive customer/resident material here.

Use an exact `ALLOWED_ORIGINS` value, such as `https://forge.example.com` (scheme,
host and optional port, no path or trailing slash). Multiple approved browser
origins are comma-separated. No wildcard is supported. A browser on that origin
uses `wss://forge.example.com/ws`. The proxy must preserve `Origin`, WebSocket
upgrade and close codes and allow long-lived connections. HTTPS is required for
remote WebXR. Origin validation stops browser cross-site use; it is not user
authentication and a custom client can supply an Origin header.

Keep tokens only in browser state and protocol messages, never URLs, analytics,
access logs or screenshots. A separate private preview with Google sign-in
requires a real identity-aware proxy on both pages and WebSocket upgrade; this
packaging does not implement one. Do not describe an obscure room URL as private
sign-in protection. Do not forward forge, voice, API keys, local services or
native save mounts into this image.

## Backup and rollback

Before an upgrade, stop this container (maintenance disconnects guests), copy the
entire `/data/worlds` directory to restricted backup storage and record the image
digest. Resume and verify `/health`; create a test edit, restart, and rejoin to
verify persistence. Provider snapshots supplement an independent backup but are
not a tested restore. Restore only while the single writer is stopped, preserving
or setting file ownership to uid/gid 1000. Restore matching state with the prior
image digest if a schema change fails. Never delete or replace the volume merely
to recover an unhealthy container; inspect both log locations first.

## Optional Fly template

`fly.toml` is an unprovisioned template. Replace its app name and allowed origin
with the approved destination, check account/organization, and review current
compute, storage, traffic and backup pricing before any resource creation. No
free tier, credit balance or spending authorization is assumed. The 1 shared CPU /
1 GiB entry is a starting configuration, not a hosted capacity guarantee.

After explicit authorization, the operator creates one app and one `world_data`
volume in the selected region, deploys from this directory with
`fly deploy --ha=false`, and checks `fly scale count 1`. The immediate deployment
strategy deliberately incurs brief downtime for the single persistent writer;
do not add a standby replica or enable automatic horizontal scaling. Verify the
actual machine count after deploy. Configure domain/TLS and restricted backups.
See [Fly configuration](https://docs.fly.io/reference/configuration) and
[volume limitations](https://docs.fly.io/volumes/overview) before provisioning.

## Optional separate static frontend

A static host such as Vercel can serve `dist`, but the persistent Godot/Node
container remains required. It is not a serverless WebSocket backend. A separate
frontend needs an explicit backend `wss://.../ws` configuration in client source
and its exact HTTPS origin in `ALLOWED_ORIGINS`; that client setting is not added
by these packaging files. Use only the same-origin container until that path is
implemented and verified. Public static hosting does not make private world
access controls unnecessary. No Vercel account or deployment was touched.

## Verification status and timing

Docker is absent from PATH and its standard Windows installation path, so an
image build/runtime test could not be run on this machine. The Godot server itself
already passed Windows engine and protocol/load tests; that does not establish
Linux image acceptance. Official release metadata and checksum lookup took
0.505 s; package/gateway/tool inspection took 0.417 s. Checksum is metadata-verified;
the Linux archive was not downloaded or executed here. Build execution remains
required before publication. Final TOML/Dockerfile static checks are recorded by
the implementation handoff. TOML parsing, Docker JSON instruction parsing,
port/volume/digest invariants and the final narrow server startup check passed
together in 0.342 s. Packaging interval: 216.831 s (18:19:46.756614 to
18:23:23.587569 local), including official-source checks, authoring and validation.
