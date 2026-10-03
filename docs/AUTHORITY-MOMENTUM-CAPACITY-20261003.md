# Emberdew momentum and world capacity — 3 October 2026

## Implemented authority behavior

Emberdew fuel adds the Hero's real locomotion velocity to its existing six-metre-per-second launch and two-metre-per-second upward impulse. Horizontal velocity comes from the preceding completed authority movement step after terrain, forge, tree and world-boundary collision resolution, capped at the established five-metre-per-second walking speed. Current authority `vy` supplies jump/fall momentum, including a jump accepted immediately before the throw. Client `velocity` fields are ignored. Flame packets, arrows and bolts retain their existing launch behavior.

Player `velocity` is persisted and included in snapshots. Older saves default to zero horizontal momentum; invalid, non-finite or excessive components reject restore. Respawn and role changes clear motion. Stationary collision corrections do not create a throw impulse. The existing combat hook consumes only `ctx.playerVelocity(player)`.

Before allocating crystal, Starfall, Hero axe/pick special or expedition-start content, the authority reclaims already depleted, unreferenced deposit records. This frees the eighty-deposit budget without awarding resources again, changing terrain, recycling IDs or altering loose pickups. Deposits referenced by embeds, workers, a pending Starfall, the active expedition or a live linked wall remain protected. Pending Starfall reservations still count against capacity. Undepleted ore is never evicted.

The **sixty-four terrain-edit limit remains permanent this pass**. Depleted deposit reclamation does not reclaim axe scars or other persistent deformation. Waiting, collecting ore, or gaining mana cannot free a permanent terrain slot. Mining a linked pick wall removes its actual edit through the existing mechanic; reclaiming its depleted record then frees its ore slot. No terrain-history deletion or cap increase was introduced.

## Verification

`node --test multiplayer/tests/throw-momentum-capacity.mjs` contains eight focused tests covering FPS and tracked-VR motion, blocked walking, stopped motion, jumping/falling, forged velocity, legacy and invalid saves, fuel-only inheritance, safe ore reclamation, replay, references and actual crystal/axe command routes.

The original seven cases plus existing lumber-session and solo-settlement tests passed **18/18 in 2.774931 seconds**. After adding fuel-only regression coverage, the eight cases plus the existing snapshot codec suite passed **17/17 in 0.197525 seconds**. These are measured shell durations. No browser, headset, production restart or publication was performed by this lane.

## Terrain storage investigation — proposal only

The checked-in research fixture `multiplayer/tests/terrain-storage-budget.mjs` does not change runtime state or protocol. Run it with Node to reproduce deterministic lossless tile round trips, a valid busy checkpoint, current codec costs and message sizes. It uses Node zlib only to measure compression; that is not a browser implementation recommendation.

Existing constraints:

- Peer envelopes have a hard **524,288-byte** limit, with 12,000-byte transport chunks. The two-million-character save/codec limit is therefore not the effective live-world limit.
- Codec arrays cannot exceed 4,096 items. A flat terrain raster exceeds this. Numeric snapshots also undergo millimetre quantization, which must never silently alter stored terrain sums.
- Unchanged opaque tile strings already produce small snapshot deltas, but each publication still serializes, parses and hashes the full snapshot. Periodic keyframes occur every 100 publications, roughly five seconds.
- Desktop recovery checkpoints are full snapshots every half-second. They bypass the snapshot delta codec. Mobile checkpoint throttling does not fix desktop-host migration cost.
- Up to eight local saves can each contain a full checkpoint. A design must account for aggregate storage quota, not only the per-file limit.

The surface uses a fixed 0.75-metre grid. Mountain protection makes all deformation at grid vertices with max(|x|,|z|) >= 50 irrelevant. The inner 133 by 133 vertices need **17,689 samples per channel**. Exact future raise/lower behavior requires independent **unclamped earth and axe-scar sums**, with removable pick walls and unfinished ruptures retained separately. Baking only the visible clamped height would lose history. Apply mountain protection once after the sums.

Research encoded 16 by 16 tiles of two Float64 channels into base64, omitting empty tiles. The busy fixture validates through the real checkpoint loader and has eight players, four workers, sixty-four enemies and edits, eighty deposits, 256 pickups, ninety-six projectiles with sixteen-point trails, ninety-six detached parts, 192 embeds, 256 fuel cells and thirty-two fire surfaces. It is substantial valid state, not a mathematical maximum. Its checkpoint is **355,498 bytes**; quantized live snapshot is **226,115 bytes**.

| Accumulated kernels | Nonempty tiles | Raw tile JSON | Lossless deflate tile JSON | Busy checkpoint + deflate |
| --- | ---: | ---: | ---: | ---: |
| 64 | 68 | 334,433 B | 81,469 B | 436,982 B |
| 512 | 81 | 379,472 B | 209,588 B | 565,101 B |
| 4,096 | 81 | 379,472 B | 298,120 B | 653,633 B |

Raw tile checkpoints already exceed the transport cap at sixty-four kernels. Compression passes that fixture initially but fails at 512 kernels. The 4,096-kernel compressed live keyframe is 524,309 bytes, also above the cap. Compression is not a worst-case capacity guarantee.

Unchanged deltas were at most **142 bytes** in this static fixture. Across seven peers, host publish/frame creation averaged **2.66–3.81 ms per publication** and one guest's decode averaged **1.48–2.44 ms**, including the existing busy game state. Full desktop checkpoints would still resend **163–596 KB/s per peer of compressed terrain alone**. The entire research run took **4.066082 seconds** wall time.

Float32 conversion changed sampled channel values by up to 0.48 micrometres in these cases; fixed 16.16 by up to 7.63 micrometres. These are measured single-conversion errors, not long-run guarantees. Repeated rounding can accumulate and alter later cancellation. Neither is a lossless replacement for history.

### Recommended future boundary

Do not put the full base into current checkpoint/keyframe messages. A robust design needs independently transferred immutable tile blobs, a revision/manifest reference in snapshots and checkpoints, and explicit readiness gating before a peer can accept a world or host promotion. An uncompressed tile is at most 4,096 raw bytes, approximately 5.5 KB base64, comfortably below the existing transport envelope. There are at most eighty-one tiles, with a bounded raw decoded footprint of **283,024 bytes** and roughly **380 KB encoded**. Send changed tiles only, retain a validated old revision until all new dependencies arrive, and attach the full tile data to exported saves. All terrain render/cache/support consumers must take the same revision.

The save path needs aggregate quota handling for eight expanded worlds; the transfer path needs late-join, dropped-frame, rejoin, old-client and host-migration tests. The synchronous load path also needs an explicitly chosen browser-safe decoder before adding compression. Restoring a manifest must reject invalid tile coordinates, duplicate tiles, excessive encoded length, non-finite values and missing dependencies. A schema requires parent approval and coordinated terrain, session, peer and renderer ownership. **None of this proposal is implemented.**

### Why simple edit pruning is not the general answer

Saturated or apparently overwritten earth cannot be discarded: later opposing edits can reveal it. Duplicate pick walls cannot be discarded while their independent deposits can still be mined. Arbitrary positive/negative kernel cancellation can change floating-point addition order. A narrow exact case is a matching raise/lower pair at the beginning of the earth channel, before any other earth contribution; it starts at zero and cancels exactly. Another is a kernel whose entire circle is outside the protected interior, where deformation is identically zero. Neither meaningfully addresses ordinary repeated axe specials, so no extra pruning was added this pass.

## Measured work and lessons

Authority implementation/initial validation ran from **01:54:14.760 to 01:59:44.314 UTC (329.554 seconds)**. Terrain constraint inspection, fixture authoring and measurements ran through **02:06:30.147 UTC (405.833 seconds)**. Focused follow-up coverage completed at **02:07:26.342 UTC**. Component shell durations included initial inspection 0.279092 s, follow-up inspection 0.155865 s, syntax/read 0.125541 s, initial ore checks 0.220367 s, combined gameplay checks 2.774931 s and terrain research 4.066082 s. Phase totals include those component checks rather than adding them twice.

On PowerShell, use `rg --files` to discover an existing test and `rg PATTERN directory -g '*.js'` for filtered searches. A guessed `network-budget.mjs` filename and positional `peer/*.js` glob both wasted a short inspection attempt; neither path was required. The reliable fast path is file discovery followed by exact reads.

The important rejected approach is the full numeric terrain array: it violates codec array limits, is silently wire-quantized, can exceed the tighter peer envelope, and would be repeatedly sent through the independent full-checkpoint path. Investigate actual end-to-end envelopes before selecting a persistent geometry representation.
