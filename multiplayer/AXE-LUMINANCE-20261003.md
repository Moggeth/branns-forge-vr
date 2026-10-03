# Orchard's Edge axe luminance (2026-10-03)

The axe counterpart of `PICK-LUMINANCE-20261003.md`. The honed edge is now the axe's light source and the brass vine
is the conduit that feeds it, and both show the special's recharge. No GLB, node, socket, bounds or
simulation change; `client/axe-luminance.js` and `client/axe-ready-cue.js` are presentation only.

- **All axes** (remote heroes, holsters): `enhanceAxeTemplate()` patches the shared `OE_Steel_HonedEdge`,
  `OE_Steel_BladeCheek`, `OE_Brass_Inlay` and `OE_Steel_ForgedDark` materials once at load. The edge is a circular
  arc fitted from the authored `CuttingEdge_*` markers. It gets a ground bevel (grind lines parallel to the edge,
  polished apex) and a thin blue resonance line at the apex. The cheek gets a grazing temper sheen and a fake glow
  from the edge. The brass gets tarnish and polish, and the forged steel gets wear in its roughness. The brass meshes
  get one static `axeChannel` attribute (ignition order).
- **Held axe**: `weapon-readiness.js` adds `createAxeLuminance()` to the axe indicator, which uses private material
  copies (restored on dispose). When the cleave is used the edge flashes and goes dark. Over the 6 s recharge the
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

## The cleave (replaces Sunder)

Mitch found the Sunder special undercooked: it dented a 7.7 m line, left three generic stones, and dealt 55 damage
plus a small shove. The axe special is now a cleave, `shared/axe-cleave.js` (tuning in `AXE_CLEAVE`).

- One level sweep in front of the hero, 4.5 m deep across 140°. Every skeleton inside it dies in one hit, and an
  armoured golem takes a heavy blow and is thrown back.
- The nearest four standing trees inside the sweep are felled away from the hero, through the normal `chopTree`
  rules, so they drop the usual logs and keep any existing notch height.
- It makes no terrain edits and no deposits. Old saves that contain `axe_sunder` scars and stones still load.
- The cooldown went from 4 s to 6 s. All special cooldowns now live in `shared/special-cooldowns.js`.
- Presentation: the first-person swing (`weapon-special-motion.js`) cocks back over the right shoulder and drives
  level, with the edge leading right to left. `client/axe-cleave-view.js` releases a blue crescent along the same
  arc (a pool of 4, one draw each while visible), plays a whoosh, thump and ring, and buzzes your own phone. VR keeps
  its controller rumble from `contact-feedback`.
- The God Sunder spell is untouched.

Checks: `node tests/axe-cleave.mjs` covers the arc edges, one-hit kills, the golem, felling, cooldown, reload and
old saves. `tests/axe-cleave-review.html` shows the swing and crescent. `tests/axe-cleave-game.html` runs the real
game with placed skeletons.
