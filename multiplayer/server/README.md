# Authoritative multiplayer proof server

Standalone Godot 4.7.2 project. Start `godot --headless --path multiplayer/server`.
`PORT` defaults to 8081; `BIND_ADDRESS` defaults to `127.0.0.1`. Put this behind the gateway's WebSocket
proxy/TLS; this process handles JSON WebSocket messages, not HTTP pages.
`WORLD_DATA_DIR` should point to a writable private persistent volume. The default
is this separate Godot project's `user://worlds`, never the native game's saves.

Stop the specific server process or container. Structural spells synchronously
save `worlds.json` by a temporary file and rename. Restart restores room codes,
terrain edits and groves. Guest identities/tokens, players and enemies are only in
memory; after a restart rejoin as a new guest (discard an expired reconnect token).
Tokens never appear in snapshots, persisted files, or logs.

`server.jsonl` and stdout provide metadata-only startup, connection, persistence
failure and periodic health logs. Check for `started`, the intended port, and
`worlds_loaded`; `listen_failed` exits with status 1. Use a local volume outside
OneDrive for reliable atomic replacement. A save failure is logged and live play
continues, so operators must inspect persistence errors before claiming durability.
Provide log rotation through the process/container supervisor.

Bounds: 8 rooms, 32 guests each including 60-second disconnected grace, 280
connections total, 64 enemies, 64 structural edits and 64 grove points per room.
Rooms sleep when no guests are connected and expire after 30 minutes idle.
New sockets must join within 10 seconds. Messages are text JSON, at most 8192
bytes, token-bucket limited to 40/s with burst 80. Slow consumers are disconnected.
The room code is a 64-bit cryptographic random identifier; each guest's stable
reconnect token is 256 bits. Reconnecting replaces the old socket atomically;
the old socket receives close code 4001 / `session_replaced`, which clients must
treat as terminal rather than automatically reconnecting.

Simulation is 30 Hz and snapshots 10 Hz. World-space movement is normalized and
limited to 5 m/s; silence for 300 ms stops it. Hero jump starts at 5.5 m/s with
15 m/s² gravity. Position, damage, HP and mana are server-owned. Optional head and
hand poses are visual root-relative offsets with a 2.5 m reach bound. Hero strikes
have 2.8 m reach, a forward cone, 34 damage, and 0.45 s cooldown. Enemies pursue
connected heroes at 2 m/s and deal 10 damage no more than once per second; a
dead hero immediately respawns. There is no player-versus-player damage.

Gods can target anywhere inside the bounded world. Spells share a 0.75 s cooldown;
costs are skeleton 15, raise 12, grove 10 and starfall 25. Mana caps at 100 and
regenerates 3/s. Raise adds a 6 m radius / 2 m height smooth mound; starfall adds
a 5 m radius / -1 m crater and deals 90 enemy damage within 6 m. Terrain raises
lift actors safely. Role changes preserve mana/HP and have a 2 s cooldown.

Proof limitations: guest room codes are bearer access; no account ACL, ownership,
moderation, persistence of combat/guest state, distributed rooms, or production
load guarantee. Groves are structural shared world points, not a resource economy.
No server physics meshes: deterministic height-field locomotion is authoritative.

Verification fast path: run the installed Godot directly with `--headless --path
multiplayer/server --quit-after 3`, then the parent `multiplayer/tests` protocol
suite against an isolated port and temporary `WORLD_DATA_DIR`. Inspect stdout for
`SCRIPT ERROR` even when the Godot exit code is zero. GDScript callbacks such as
`_input` have reserved signatures; use `_apply_input` for protocol handlers.

Measured build/check notes (2026-10-02): initial inspection 0.278 s; first editor
parse 2.325 s detected the reserved `_input` signature; renamed the handler and
standalone headless startup passed in 0.289 s. The initial implementation interval
was 298 s (18:08:04.562 to 18:13:03 local measured wall clock).
Final startup check took 0.275 s; persisted two-room reload took 0.269 s.
Independent protocol integration passed in 7.845 s. The 32-client capacity/load
check passed in 14.698 s: 64 edits, 64 groves, 64 enemies, explicit overflow and
33rd-guest rejection; 4,480 commands across 8.306 s, 9.99 Hz snapshots, 101.23 ms
p95 broadcast interval, maximum snapshot 22,705 bytes and no protocol errors.
These are local diagnostic results, not a hosted or headset acceptance claim.
Latest strengthened protocol run passed in 8.298 s, including bounded local VR
poses and spoofed client damage rejection; server stdout had no script errors.
Owned diagnostic servers were stopped after checks. Total server work interval
was 546.642 s (18:08:04.562396 to 18:17:11.204464 local), including implementation,
independent verification coordination, restart and shutdown checks.
