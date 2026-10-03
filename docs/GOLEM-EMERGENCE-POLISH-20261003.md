# Golem emergence polish — 2026-10-03

## Changes and evidence

The polished creature assembly was running alongside a second legacy spell
animation: `FX.golem` created six generic slab/rock parts and dominant ritual
rings. Removed that duplicate presentation. The actual asset assembly retains
its staged appearance, swirling trajectories, snap/settle, dust and bindings.
No replacement art was required or commissioned.

All 14 targeting previews rapidly fade after the local player's authoritative
cast acknowledgement (roughly 112 ms maximum; immediate with reduced motion).
They stay quiet at the cast position until aim moves 0.4 m or the spell changes.
Rejected casts retain their informative preview. Starfall retains a restrained
thin danger outline; the competing sky beacon and extra star were removed.

Creature assembly was receiving integer snapshot ticks despite rendering every
frame. A shared presentation-only fractional clock now drives enemy movement,
creature assembly and meteor emergence. It advances with elapsed time, corrects
packet jitter gradually, resets on room/tick rewind, and caps extrapolation at
300 ms during a network stall. Simulation authority remains unchanged.
Particle drag/gravity use elapsed-time integration, late-life sinking uses dt,
and unseen actors expire after three seconds rather than 180 render frames.

## Verification and measured timings

- Discovery/instructions/fetch: 1.336 + 2.104 seconds, main synchronized.
- `node tests/emergence-polish.mjs`: 0.141 seconds test body (0.356 tool).
  Actual golem GLB poses match at equal elapsed times at 60/72/90/120/144/240 Hz
  with 20 Hz snapshots; tests cover intermediate pose updates, monotonic packet
  jitter, stall bounds, rewind and combat-view clock consumption.
- Same suite verifies all 14 markers with normal and reduced motion, rejection,
  rearming and absence of duplicate visible golem BoxGeometry.
- Existing creature/spell suites: 1.155 seconds. Targeting, combat-view, meteor
  and progressive-sunder group: 1.584 seconds. All passed.
- Local build: 0.364 seconds Vite, 112 modules; all 30 packaged asset references
  verified. Owned QA servers: peer 8799 and preview 5188.
- Real browser emergence: 7.297 seconds; 40/40 sampled frames fractional,
  shared creature/render clock, marker fade/rearm and zero console errors.
- Touch casting: 11.096 seconds; quick-tap marker, quick/confirmed line casts,
  pinch/cancel, two thumbs, jump, attack, independent bow draw/curve/release.
- Two browser friends: 11.219 seconds; shared world, expedition and terrain cast,
  zero console errors.

Evidence: ignored `logs/golem-polish-browser/`. Browser scripts accept
ACCEPT_BASE and use the existing browser-acceptance-lib Playwright harness.
Run node tests from `multiplayer/`, not the repository root.
These are deterministic refresh-rate checks and emulated-touch acceptance,
not physical 120 Hz headset or phone performance measurements.

## Lessons

- An initial camera point hid the summoned golem behind a canopy. The revised
  browser test casts at (950, 400) and captures unobstructed assembly stages.
- A root-cwd test invocation failed in 0.206 seconds; use multiplayer cwd.
- The existing touch test twice waited 30 seconds for an obsolete Resume button
  after role switching. Roles now close the menu automatically. Assert the
  actual role/menu state instead of clicking a hidden control.
- Keep the original public peer 8789/tunnel and unrelated Godot UID work intact.
