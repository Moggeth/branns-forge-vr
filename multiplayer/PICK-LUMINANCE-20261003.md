# Stonewhisper pick luminance (2026-10-03)

The browser pick's authored Resonance gems now behave as its light source and as
the diegetic special (crystal wall) cooldown. No GLB, socket, bounds or
simulation change; `client/pick-luminance.js` is presentation only.

- **All picks** (remote heroes, workers, holsters): `enhancePickTemplate()` patches
  the shared `Resonance_Crystal`, `Brass_Trim` and `Steel_Blued` materials once at
  load. Faceted inner-glow gems (per-facet tone from derivative face normals,
  view-dependent twinkle), a fake blue gem spill on nearby head metal from seven
  crystal groups, low-frequency brass wear, faint temper sheen on the blued head.
- **Held pick**: `weapon-readiness.js` adds `createPickLuminance()` to the pick
  indicator. It uses private material/geometry copies (restored on dispose), so
  the shared template is never written. On special use the gems discharge and go
  dormant; over the 4 s recharge the two heart gems brighten continuously, the arm
  shards ignite in order from the eye outward with a short flash each, and the
  crown bouquet ignites last with the existing ready pulse. The shaft node strip
  is unchanged.
- **Budget**: no lights, post or extra passes. The held pick adds one instanced
  additive halo draw (21 billboards; crown shares one), keeping the readiness
  indicator at 3 draws. Reduced motion disables the flashes and time twinkle.

Checks: `node tests/pick-luminance.mjs` (gem discovery, ignition order, budget,
restore) and `node tests/weapon-readiness.mjs`. Verified in the real built
browser game (special fired, gems drained/recharged, zero console errors) on
SwiftShader. Not verified on a physical phone or headset.
