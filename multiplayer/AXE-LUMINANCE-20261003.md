# Orchard's Edge axe luminance (2026-10-03)

The axe counterpart of `PICK-LUMINANCE-20261003.md`. The honed edge is now the axe's light source and the brass vine
is the conduit that feeds it, and both show the sundering strike's recharge. No GLB, node, socket, bounds or
simulation change; `client/axe-luminance.js` and `client/axe-ready-cue.js` are presentation only.

- **All axes** (remote heroes, holsters): `enhanceAxeTemplate()` patches the shared `OE_Steel_HonedEdge`,
  `OE_Steel_BladeCheek`, `OE_Brass_Inlay` and `OE_Steel_ForgedDark` materials once at load. The edge is a circular
  arc fitted from the authored `CuttingEdge_*` markers. It gets a ground bevel (grind lines parallel to the edge,
  polished apex) and a thin blue resonance line at the apex. The cheek gets a grazing temper sheen and a fake glow
  from the edge. The brass gets tarnish and polish, and the forged steel gets wear in its roughness. The brass meshes
  get one static `axeChannel` attribute (ignition order).
- **Held axe**: `weapon-readiness.js` adds `createAxeLuminance()` to the axe indicator, which uses private material
  copies (restored on dispose). When the strike is used the edge flashes and goes dark. Over the 4 s recharge the
  blossom kindles, a spark runs down the vine, the edge line fills outward from where the vine meets it, and the
  light jumps to the honed edge and sweeps from the middle out to both horns. When the edge is ready it flares and the
  inlays hand their light to it, so they go back to gold. Timing is in `AXE_SCHEDULE`. The gold edge runes are
  unchanged.
- **Ready cue**: one quiet whetstone "shing" and a ring when the edge re-arms, with one light haptic tick (controller
  in VR, `navigator.vibrate` on touch). It is local, fires once per recharge and never fires on equip.
- **Budget**: no lights, post or extra passes. The held axe adds one additive ribbon draw along the edge (40
  segments), so the readiness indicator uses 2 draws. Reduced motion disables the flashes and the drifting shimmer.

Checks: `node tests/axe-luminance.mjs` (edge fit, ignition order, budget, restore, ready cue), plus
`node tests/weapon-readiness.mjs` and `node tests/pick-luminance.mjs`. Review fixture:
`tests/axe-luminance-review.html` (`?before`, `?night`, `?view=cheek|edge|held`, `?charge=`). It was verified in the
real built browser game: the special fired, the edge drained and recharged, and the console showed zero errors. That
run used SwiftShader. It has not been verified on a physical phone or headset.
