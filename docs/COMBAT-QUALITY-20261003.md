# Combat quality pass — 2026-10-03

Scope chosen under the user's general quality mandate: make enemy attacks avoidable and readable, give crowds personal space, and make death/recovery behave cleanly. Reuses existing authored animations; no Claude generation after the expired overnight sprint.

## Behavior

- Enemies commit to one Hero and one facing during their wind-up and recovery. The authored strike remains tick 18. A sidestep, retreat, interruption, or solid cover can prevent damage; a closer friend cannot inherit a winding-up attack.
- Deterministic local separation keeps summoned crowds apart. A bounded probe fan steers around trunks and landmarks, including terrain height changes. This is local steering, not a complete navigation mesh.
- Respawns check forge/landmark/trunk collision and avoid enemies and burning cells where space permits. Three seconds of damage protection lets the player recover. Respawn events cancel held weapons/movement and reset camera prediction immediately.
- Target identity and protection survive checkpoints. Old checkpoints without these optional fields remain valid; an old in-progress attack without a target recovers harmlessly.

## Verification and measured timings

Work began 2026-10-02 23:25:07 UTC. Timings below are observed tool/harness durations, not estimates.

| Step | Outcome | Seconds |
| --- | --- | ---: |
| Enemy behavior + simulation/codec/starting-world/meteor batch | Pass; 10 new focused cases | 1.504 |
| 8 Hero / 64 enemy / 64 edit simulation stress | 600 steps, 1.306 ms per tick | 0.784 |
| Browser touch dodge / held-bow death / recovery | Pass, no console errors, screenshots inspected | 12.830 |
| Session/reload first regression batch | Failed stale resource-cache baseline | 0.326 |
| Corrected session/reload + combat-session + adventure | 13 session and 12 adventure cases pass | 2.699 |
| Real-command Hero expedition first run | Failed stale conservation baseline | 0.003 |
| Corrected real-command Hero expedition | Victory, 209 simulated seconds, zero deaths | 0.372 |
| Real-command mixed expedition | Victory; host reload and role switches | 0.398 |
| Real-command solo God expedition | Victory | 0.214 |
| Production build + dependency check | Pass; existing chunk-size warning | 1.204 |

The CPU measurement covers simulation only, not rendering, transport, or physical phone/headset performance. Browser verification uses Chromium touch emulation and normal controls; it does not establish physical-device or separate-network acceptance.

## Run and diagnose

`node multiplayer/tests/enemy-behaviour.mjs`

`node --test multiplayer/tests/session.mjs multiplayer/tests/session-reload.mjs`

`node multiplayer/tests/expedition-real-play.mjs hero` (also `mixed` and `god`).

`node multiplayer/tests/browser-combat-quality.mjs` uses existing PW_CORE/PW_CHROME and ACCEPT_BASE settings. It imports a synthetic world through the normal save picker, dodges via the touch joystick, holds Draw until a real death, and checks respawn cleanup. Results and captures are in ignored `logs/browser-acceptance`. Local verification uses owned Vite 5188 and peer 8799; preserve original peer 8789/tunnel.

## Lessons

- A wide Raise Earth mound lifts both combatants and is not necessarily cover. Use a narrow, sufficiently tall wall between them when verifying occlusion; do not weaken the implementation to satisfy an incorrect test fixture.
- Starting caches are existing resources, not newly dropped loot. Conservation tests must count their baseline. Expedition inventories must also account for explicit milestone/victory reward events. Both older harness assumptions were corrected without changing gameplay to match them.
- On PowerShell pass `-g` globs to `rg` (or discover files first); wildcard file arguments such as `multiplayer/client/touch*` are not expanded.
- Preserve the tick-18 animation contract when changing enemy logic. Target lock, facing, cover, save/load and local input cleanup must be verified together.

## Public release

Code `e1819d9` pushed to private `origin/main`. Production `dpl_EpwCheS6HkxZykgpQDv1PGdScm8e` is READY at https://branns-forge-multiplayer.vercel.app. Build/deploy took 13.280 seconds. Public touch dodge, held-bow death and recovery passed in 14.234 seconds. Public two-browser Hero/God join, expedition start and shared terrain cast passed in 9.316 seconds; no browser errors. Both FPS captures inspected. These are fresh browser sessions, not physical-device acceptance.

Owned peer8799 and Vite5188 stopped after verification (2.114 seconds); original peer8789 PID43880 retained. Runtime release requires the host to refresh; no world reset needed. Overnight automation remains paused. Acceptance/cleanup completed at approximately 23:45:53 UTC. Unrelated untracked Godot UID files preserved.
