# Living Workshop: operating and extending the game

## Start, use and recover

Use the existing desktop shortcut or Start Brann VR.cmd. This engine installation
needs one normal launch; creations composed from its registered capabilities then
publish during play. No production process was restarted during implementation.
Stop Brann.cmd remains the identity-checked shutdown path. No paid generation or
voice sessions are needed to run verification.

The archive gate stands west of Brann at (-11,0,1). Point and trigger to visit.
The hall has stable paginated version records, provenance pages, retrieve/restore,
remove, an ancestry lens and a console of working experiments. Current weapons
remain in the existing collection. Legacy model retrieval recalls a free item to
its stand; a held/holstered item must first be released. A package restoration
returns that package to its original world location, never to the player's hand.

Ask Brann to inspect Living Workshop capabilities before an unusual request.
Examples: “Make a lantern that a little creature follows”, “Build a low-gravity
practice courtyard with a return portal”, or “Give that device a switch that opens
its linked gate.” The service distinguishes submitted, deferred, applied and
rejected. Only the native client can confirm that an addition is active. The
native client checks exact dependencies and can commit a related batch together.

If something remains deferred, release its old object, detach its grapple/stop
recording, or leave the region being replaced. If rejected, the old world stays
available; the status contains the reason. Dependencies can prevent removal.
Restoring a prior version restores that version's own saved state. Use the archive
to remove an experiment when finished, preserving its history.

## Architecture and scope

- Service: immutable manifests, lineage and prompt/transcript evidence, strict
  schemas, exact dependency graph, receipts, atomic persistence and desired state.
- Native coordinator: inert construction, safe-frame atomic group activation,
  held/occupied deferral, per-session acknowledgements, bounded persistence and
  rollback. Stale acknowledgements never retry over a newer acknowledged phase.
- Native capabilities: registered, versioned components plus an event/action
  interpreter. No generated GDScript, native library or arbitrary filesystem access.
- Museum: a bounded viewport over stored history, plus playable test packages.
- Embodiment: reversible overlays on existing settings; personal preferences are
  not overwritten by applying or removing an experimental profile.

All packages are explicit about identity, version, scope, provenance and dependencies.
The current scope targets package-owned entities, plus explicit player embodiment.
“World” is not permission to mutate any native node. New materials, devices,
behaviours and regions can combine installed primitives. New render backends,
network protocols, native physics solvers, arbitrary NPC AI and entirely new
controller APIs remain engine work. Existing GLB commissions still use their
established generation/import pipeline alongside this new declarative route.

History is bounded: up to 512 immutable manifests, 16 active package identities,
192 active entities, 32 dynamic bodies (16 per package), 64 per-version native
state snapshots. Eight shared nearby point lights, bounded events/offcuts/gesture
samples and nearby labels keep costs explicit. These are initial measured limits,
not a guarantee of VR frame rate on every configuration.

No historical audio has been invented or secretly recorded. Completed text
transcripts supplied by the voice transport can be linked to new requests. A
missing transcript remains missing; old briefs are labelled reconstructed. The
ancestry lens reports stored evidence and recent package events, not a complete
causal trace of every pre-existing scenery object.

## State and diagnosis

- service/data/living-workshop.json: immutable history, desired versions,
  deployments, bounded event/transcript journal. BRANN_DATA_DIR overrides for tests.
- Godot user://living_world.json: active manifests, transforms and per-version states.
- Godot user://living_museum_homes.json: stable record addresses.
- logs/service-*.log and Godot user://logs/game.log: startup and operational errors.
- LIVING_APPLIED reports id/version and staging wall time; LIVING_REJECTED includes
  validation failures; LIVING_NETWORK records connection errors.
- logs/work-timing.csv: measured attempts, failures, verification and rendering.

Closing normally snapshots before nodes are disposed. A crash recovers the most
recent periodic snapshot (roughly eight seconds), then reconciles with the service's
desired versions. Removing an experiment does not erase its history. Do not delete
service/data or user files as a troubleshooting shortcut; back up first.

## Verification and capture

Run `Verify Brann.ps1` with BRANN_TEST_ROOT set to a temporary unsynced directory.
It runs the existing suite, the new offline lifecycle checks and an isolated real
HTTP-to-native test. Require markers and absence of SCRIPT ERROR/ERROR, not exit
code alone. The focused network test is `node scripts/check-living-network.cjs`.
It chooses an ephemeral port, disables model credentials, identifies its child
service and stops only its own processes.

For a deterministic full-scene visual/performance review:

    tools/godot/Godot_v4.7.2-stable_win64_console.exe --xr-mode off --path godot -- --living-showcase

This mode disables service requests and player saves, loads all nine demo
identities, reports coordinator/component CPU time and writes four views under
work/living-showcase. Headless mode skips screenshots. Measurements exclude
physics/render/VR compositor costs. The initial full verifier passed in 43.61s;
HTTP/native lifecycle passed in 2.12s. See verification notes for subsequent runs.

Final rendered showcase: nine active packages / 73 entities; mean update 0.312ms, p95 0.342ms, maximum 0.899ms (240 CPU samples, excludes physics/render). Final normal-audio Vulkan capture passed in 19.61s. Final native lifecycle and HTTP handoff rechecks passed after input/persistence/render refinements. Physical headset playtesting remains outstanding.
