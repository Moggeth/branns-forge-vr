# Backend resilience — 2026-10-07

The simulation backend runs in the hosting player browser. Cloudflare coordinates
membership and relays fallback traffic; Vercel distributes the client. These
changes harden the actual authoritative path without new paid infrastructure,
wire-format changes, Worker migrations, or changes to visual quality.

## Confirmed gaps and fixes

- Direct RTC intake formerly parsed arbitrarily large raw frames, retained up to
  eight incomplete messages per peer without an aggregate byte bound, and checked
  final message size only after allocating decoded chunks. `peer/frame-inbox.js`
  now checks raw size and token buckets first, limits base64 and UTF-8 decoding,
  validates IDs/fragment counts, expires incomplete assemblies, and retains at
  most two encoded messages per edge. Guests have a 16 KiB command envelope
  ceiling; the host retains the existing 512 KiB world-message ceiling.
- Incomplete fragments used to refresh host liveness. Only completed, permitted
  envelope types now do, so broken fragment streams cannot indefinitely conceal
  a failed host. This is transport liveness, not proof of advancing simulation.
- Correctly encoded but semantically unloadable checkpoints replaced guest
  recovery state and were advertised as ready. WorldSession installs the actual
  simulation loader as the validation gate. Rejected updates cannot change the
  checkpoint revision, advertise readiness, emit a checkpoint, or trigger a guest
  autosave. Valid later updates recover normally, including negotiated deltas.
  Hosts likewise validate before publication and autosave the validated copy.
  Stopping solo or multiplayer publishes a fresh validated point first.
- The 80/s guest-command allowance also applied to a host broadcasting events
  for the whole room. A 180-event burst lost 100 events in the old code. Host
  message envelopes now have a separate finite 512/s allowance; guest commands
  retain 80/s. This does not make either side unbounded.

## Diagnostics and operating limits

`window.brannHarness.network()` returns copied transport counters, rejection
reasons, retained/peak assembly sizes, recovery counts/validation time, and host
simulation counters. It excludes packet bodies, names, codes, SDP and reconnect
secrets. Save that JSON with reproduction steps when investigating a connection.
No per-packet console logging or telemetry uploads are added. Recovery failures
surface an actionable notice at most once per ten seconds per validator.

Limits live in `peer/frame-inbox.js`: guest 160 frames/s and 256 KiB/s; host
1500 frames/s and 16 MiB/s (one second burst capacity). Host pending base64 text
is capped at about 1.4M characters; each guest about 44K. Decoded payloads and
browser-owned RTC buffers are additional, so these are not whole-process RAM
limits. The existing relay limits remain stricter. Old clients keep their
existing behavior until refreshed. Trusted browser hosts are still not anti-cheat.

## Verification and lessons

Focused tests cover fragmented Unicode/ArrayBuffer transport, malformed UTF-8,
base64, oversized frames/messages, duplicate fragments, stale epochs, interleaved
incomplete payloads, timeout/recovery, 31 independent guest budgets, and a 20 Hz
250 KB snapshot plus 2 Hz 490 KB recovery stream without admissions being dropped.
Legacy and delta recovery tests corrupt actual simulation checkpoints and prove
both in-memory and saved recovery copies survive; subsequent valid updates work.

Four transport/recovery regressions were run against the prior browser module:
all four failed at behavioral assertions (bad revision accepted, partial traffic
refreshing liveness, and 80 of 180 events delivered). The new implementation passes.
Local 32-human/64-enemy recovery-loader sampling: p95 0.876 ms, max 1.445 ms over
50 loads (twice-per-second live cadence). This is Node CPU evidence, not a physical
phone FPS claim. Do not replace semantic validation with hash-only validation:
a hash detects damaged transmission, not an invalid simulation state.

Commands from multiplayer: `node tests/frame-inbox.mjs`,
`node tests/checkpoint-delta.mjs`, `node tests/session.mjs`, `node tests/ci.mjs`.
Browser verification uses real direct and forced-relay pairs plus host loss.
Detailed tool durations and browser output are in ignored logs/backend-resilience.

WorkCodex review failed after 11 seconds with Azure 401, Principal does not have
access to API/Operation. It produced no review. Do not repeat the same commission
until Azure authorization is repaired; local investigation continued independently.

## Deliberate remaining boundaries

This is not a dedicated authoritative cloud simulation. Automatic cloud saves,
account-bound saved-player ownership, cross-version simulation compatibility, and
priority scheduling of outbound snapshots/events are separate architectural work.
The 512 KiB recovery wire ceiling remains; raising it requires coordinated codec,
fragmentation and relay load tests. Public internet-scale stress, physical phone,
and headset acceptance are not established by the synthetic 32-client tests.

Verification checkpoint: all 190 blocking Node suites passed in 108.1 s;
production build passed in 1.250 s. Actual direct WebRTC sessions passed shared
terrain commands, signaling loss/reconnect, host transfer and old-host input in
5.972 s. Forced cloud relay plus abrupt host-tab loss retained the world and
resumed in 24.858 s (including fallback/grace). No invalid recovery notices.

The first cloud-transport harness run exercised these behaviors successfully but
failed its final error check because it still sent a manual continue request
after automatic takeover (no_offer). Removed that stale second request rather
than weakening the error assertion; retest passed. Patch-note validation also
caught a filename missing date hyphens before publication; use
YYYY-MM-DD-slug.md and run the parser after writing, as well as validating area.

Actual rendered touch-layout game acceptance passed in 23.522 s: two players joined,
validated recovery advanced with zero rejected intake, host closed, and the guest
continued ticking as host. Host validation max was 4.2 ms and guest max 2.4 ms in
that short Chromium run. Test browsers closed in finally blocks; VR and pointer
capture were disabled. This is emulation, not physical phone testing.

Browser QA must dismiss `.pn-close` when patch notes open on a fresh profile.
`#create` is now Quick Play, so tests should return an empty directory only in their
own page route before clicking it, to create an owned room instead of joining
real players. Room creation, transport and gameplay still use the live service.
A repeated test launch also followed a Python edit with the wrong CWD; use absolute
paths for scripted edits and check exit status before launching another test.

Visual evidence correction: the first 23.522 s rendered-flow capture showed the
loading backdrop despite working networking. Added an explicit wait for both
renderers' startup.ready flags; the next screenshot was inspected and shows the
actual world, weapon, terrain and HUD. Never infer model/shader readiness from
membership, HUD presence, or advancing snapshots alone.
