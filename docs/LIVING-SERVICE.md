# Living Workshop service (20 September 2026)

The local service now accepts versioned declarative additions while the native game runs. `service/living-workshop.js` owns validation, an immutable version archive, desired deployment versions, a bounded cause journal, provenance transcripts, and retry receipts. `server.js`, `world.js`, and `forge.js` connect it to native polling and actual Brann tool calls. No extra dependencies or API subscription are required; existing authorized voice credentials are reused without recording raw audio. Automated verification uses offline mocks only.

## Runtime and persistence

Start and stop using the existing project launchers; a service source change requires restarting this local service once. Later packages do not require a service/game restart. The registry is `service/data/living-workshop.json`, or `$BRANN_DATA_DIR/living-workshop.json` in tests. It is separate from player inventory/progression. A same-directory temporary file and atomic rename persist each transaction; write failure restores the complete in-memory registry. Preserve a failed/corrupt save for diagnosis instead of deleting it. Standard server logs contain package/version/deployment status, never API keys or raw audio.

Immutable `(id, version)` pairs cannot change. New versions must be consecutive. Rollback requests an existing version; version zero removes the desired package without deleting its history. Old versions remain queryable. Dependencies pin exact versions; removing/upgrading a provider while an incompatible consumer remains desired is rejected. `publish-batch` validates a related set against the complete proposed desired graph and commits the registry atomically. Deployment members carry `transactionId`; scene activation reliability depends on the native loader's validation and acknowledgement, not merely service success.

Each deployment has its own monotonically assigned `generation`. ACKs must match both version and generation. `clientId` identifies a native play session: a new session may revalidate old content; an applied version cannot regress within the same session through late staged callbacks. Published, staged, deferred, rejected and applied are distinct. Saved application status is historical evidence with timestamps, not proof that a headset is currently running.

## Endpoints

- `GET /api/vr/state`: full `liveWorkshop` snapshot: catalog, desired packages, all version history, deployment states, recent events/transcripts, registry generation.
- `GET /api/vr/living/catalog`: exact schemas, config ranges, budgets, limitations and the museum's deterministic demo packages.
- `GET /api/vr/living/history?id=<id>`: version history and recorded causes for a package; no id returns the collection.
- `POST /api/vr/living/publish`: `{package, requestId}`.
- `POST /api/vr/living/publish-batch`: `{packages, requestId}`.
- `POST /api/vr/living/rollback`: `{id, version, requestId}`; zero deactivates.
- `POST /api/vr/living/ack`: `{id, version, generation, clientId, status, reason}`.
- `POST /api/vr/living/event`: `{packageId, entityId, event, detail}`.

Mutation validation failures return HTTP 409 with useful reason. APIs inherit existing loopback host/origin restrictions. Publish/rollback retry IDs are deduplicated over a bounded 256-receipt window; reuse with different content rejects. Cause events are not automatically retried by the native client.

## Brann and provenance

Brann now has actual `inspect_living_workshop`, `publish_living_package`, `publish_living_batch`, and `restore_living_version` tools. Query first, then author strict package JSON. The instructions explicitly distinguish saving a package from native delivery, scope additions rather than arbitrary edits to existing systems, and retain developer/restart requirements for genuinely new engine primitives. Full historical manifests are fetched on demand rather than inserted into every ordinary game snapshot sent to Brann.

Text chat requests are captured exactly. Completed user transcript events, when supplied by the voice transport, are captured as `voice_transcript`; no transcript is fabricated when the transport does not send one. Raw audio is never recorded. Package provenance stores the captured request separately from Brann's interpretation. Original legacy commission requests are now saved before refinement expands the generation brief. Old jobs remain visible with their model URLs, lineage IDs and versions, explicitly labelled reconstructed when only historical design briefs exist. A legacy brief is not described as a verbatim spoken transcript.

History is bounded: 512 package versions, 512 recent cause events, 256 recent unlinked transcripts, and 256 retry receipts. A version embeds its request text; archive/retention expansion is needed before promising an infinite event history. Capabilities are version 1; unsupported versions or fields reject. Preserving old behaviour indefinitely still requires retaining compatible native primitives.

## Supported boundaries

Sixteen desired packages, 192 total entities, 64 entities per package, 16 dynamic bodies per package and 32 total dynamic bodies. Per-package limits: 96 links, 64 rules, 128 actions and 128 KiB. There is no eval, arbitrary script/file/process access or implicit resource award.

Package-owned materials, connections, sensing, fields, creatures, objectives, transformations and maker mechanics are stylised native components. Instance/design/region/world scopes do not grant arbitrary access to baseline objects. The sole explicit external target is `player` for bounded `embodiment` settings (hand colour/scale, curl multiplier and locomotion speed). Controller tracking is not altered.

## Verification and lessons

`node --test service/living-workshop-test.cjs` covers immutable history, duplicate replay, stale ACKs, removal/rollback, dependency failure and coordinated batch upgrades, write-failure rollback, resource budgets, unsupported capabilities, provenance, real Brann dispatch, new native sessions, and actual isolated loopback HTTP startup/state/history/ACK. The HTTP fixture uses an OS-assigned port and temporary data, verifies process identity, and kills only its own spawned child. It never submits an AI request or launches generation.

All 68 service tests passed in 0.474020 seconds measured shell time (Node reported 0.398672 seconds). The first new eight tests took 0.179020 seconds; new HTTP coverage took 0.720189 seconds; batch/session follow-up took 0.367664 seconds. See `logs/work-timing.csv` for measured commands. Native physical behaviour/performance is verified by the coordinator and component agent separately.

Two discovery reads guessed nonexistent files (`service/forge-test.cjs`, then the demo file before its owner had written it). Both failed immediately without mutations. Use `rg --files service -g '*test.cjs'` and coordinate file readiness before reading new agent-owned output. Demo validation succeeded for all ten manifests once the file was ready. Avoid adding filesystem reads of secret contents: credential inspection returned only `authorizedCredentialPresent=true`.

### Native integration follow-up

`node scripts/check-living-network.cjs` creates an isolated temporary service on an OS-assigned loopback port, launches the real Godot game with `--living-check-network`, then verifies initial application, physical grip deferral, release-triggered replacement, unsupported-revision rejection, exact-version rollback and removal while retaining history. It passed in **2.120 seconds** with `LIVING_NETWORK_RESULT []`; observed headless staging was 1.566 / 3.633 / 4.291 ms. This is a deterministic scene/HTTP test, not a headset frame-time claim.

The first run overlapped a coordinator-owned incomplete test script and failed to parse `living_checks.gd.run`; a second run reached `_apply_embodiment` but found the known desktop-hand missing `hand_visual` metadata. Coordinator fixed both; the next run passed. The harness now terminates its own native child immediately on `SCRIPT ERROR` or `ERROR:` rather than waiting out `--quit-after`. Native test mode disables the main process loop, sets `smoke=true` to prevent user-save writes, and enables HTTP only against the isolated fixture; no voice context or paid request is submitted.

Fourteen new service tests now include unique legacy lineage numbering when refining an older version, static-labelled grabbable body-budget accounting, and equality of the pinned native capability schema. When changing catalog contracts, regenerate `godot/living_capabilities.json` from `{components,actions,events,links,budgets}` returned by `catalog()` and run that equality test.

Voice provenance now listens on both the service sideband and the managed WebRTC data channel. The helper forwards only completed transcript text (no partials, binary audio, or unrelated event fields) to `POST /api/forge/session/:id/transcript`; the route requires ownership of the active authenticated voice session. Duplicate utterance IDs are preserved once. Actual VM transport forwarding and mocked authenticated session HTTP tests pass; no live voice call was made. Reload the managed helper through the normal launcher on the next restart to load its updated JavaScript. Fifteen Living Workshop service tests now pass, plus the new voice-forwarding regression in `voice-test.cjs`.
