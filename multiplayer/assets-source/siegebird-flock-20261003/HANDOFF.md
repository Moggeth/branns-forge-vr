# Siegebird songbird reload and crossbow uptick (2026-10-03)

Browser game only (`multiplayer/`). The Godot copy (`godot/assets/siegebird/siegebird.glb`) and the Opus source
(`assets/siegebird-opus/`) are unchanged.

## What changed
- **Reload is 1.0 s** (`shared/combat.js` `SIEGEBIRD`): 60 ticks, host accepts from 54 ticks for network jitter.
- **A songbird brings each bolt.** It flies in from off-frame on the right for odd reloads and the left for even ones,
  hovers, drops the bolt onto the rail at 0.80 s and is out of the sight line by 1.0 s. Six plumages (kingfisher,
  robin, bluebird, cardinal, chickadee, greenfinch) cycle per player with no repeat twice in a row, with a soft blue
  resonance shimmer on the flight feathers. Everyone sees the birds; they are hidden beyond 26 m.
- **Golden songbird:** chance 3% + 0.15% per Siegebird hit, capped at 15% (rolled deterministically in the shared sim).
  Its bolt does quad damage (48 x 4). Golden bird, spark trail, seated-bolt glow, muzzle ring, golden flight comet,
  embedded glow, a chime and a stronger rumble.
- **Mechanism:** the crank winds two turns with 8 ratchet clicks, the latch catches, the string slides back, the bolt
  settles. Synthesized audio per plumage, panned to the bird's side. Rumble on clicks, latch and seat.
- **Crossbow material uptick:** the Opus builder's walnut and heartwood were gamma-darkened twice (walnut averaged
  sRGB 13,4,2, near black). `source/uptick_crossbow.py` regenerates only those two textures in correct sRGB and
  asserts everything else in the GLB is byte-identical. The sight and silhouette are untouched.

## Files
- Client: `client/siegebird-reload.js` (timeline, mechanism, cues, plumage order), `client/siegebird-flock.js`
  (birds, golden dressing), `client/siegebird-audio.js`; wiring in `game.js`, `hero-view.js`, `asset-pose.js`,
  `combat-view.js`, `projectile-streaks.js`, `contact-feedback.js`, `weapon-controller.js`.
- Asset: `public/assets/siegebird_songbird.glb` (96 KB, 3.8k tris) from `source/build_songbird.py`
  (Blender 4.5 bpy: `python source/build_songbird.py out/siegebird_songbird.glb`).
- Tests: `tests/siegebird-flock.mjs` (sim), `tests/siegebird-songbird.mjs` (presentation: alternation, framing,
  hand-off within 2 cm, raycast clearance against the crossbow and sight, golden, shared geometry).

## Previews
`node preview/serve.mjs` (port 8823), then `node tools/shoot.mjs "preview/reload.html?view=fps&n=1" out.png 1500 600`.
Pages: `crossbow.html`, `birds.html`, `reload.html` (`view=fps|ads|third|top`, `n`, `golden=1`, `times=`).
`captures/final/` holds the reviewed sheets.

## Known limits
- A headless real-game capture is not possible in the cloud container: the full world renders at about 1.5 s per
  frame on SwiftShader and the existing `tests/browser-siegebird.mjs` also times out there before the crossbow is
  equipped. No page errors were logged with this code loaded. `tools/game-capture.mjs` uses a virtual clock and should
  work on a GPU machine.
- Remote heroes keep the plain crossbow without the Moon-and-Hawk sight (sharing the sight would copy geometry).
- Follow-up: fix `wood_image()` gamma in the Opus builder itself so the Godot copy gets the same wood.

# Round 2: coherent winch, lingering birds, materials, perfect wind, VR cranking (2026-10-04)

- **Winch** (`client/siegebird-reload.js` `SIEGEBIRD_WINCH`, `siegebirdMechanism`): on release the clutch slides out
  and the drum, reduction and pinion freewheel back while the crank stays put; the clutch bites (`engage` cue), then two
  crank turns drive one drum turn through 10:20 teeth. The pawl clicks over 17 of the 18 crown-ratchet teeth and drops
  into the last notch. The cable wraps on the drum with a level wind (`asset-pose.js` `cableWrapGeometry`, one shared
  geometry and a per-mesh draw range). The strings ride the morphed limb tips; the arms overshoot and the string hums.
- **Lingering birds** (`siegebird-flock.js` `SIEGEBIRD_ROOST`, `attachWorld`, `updateWorld`): at 1.1 s each bird is
  handed to world space and either perches on the outer face of a nearby standing tree crown (65%, raycast in
  `game.js` `siegebirdPerches`) or flies 85 m out and climbs 18 m. Max 6 birds; the oldest percher leaves first; a felled
  tree flushes its birds; culled beyond 75 m.
- **Materials** (`source/uptick_crossbow.py`, materials and textures only, geometry asserted unchanged): oiled walnut
  with pores and clearcoat, brushed and worn brass and bronze, blued iridescent steel, waxed cord and leather sheen.
- **Perfect wind** (`shared/combat.js` `SIEGEBIRD`, `siegebirdPerfect`; action `wind`): the first fire press during a
  reload is judged against the latch (60% of the reload, +-6 ticks on the host, +-4 predicted locally). A hit makes the
  next reload quick (45 ticks, accepted from 40; presentation plays at 1/0.75). One press per reload; a miss is final.
  `player.siegebird` gains optional `quick` and `wind` (old 3-key saves still load).
- **VR hand cranking** (`client/siegebird-wind.js`): squeeze the free hand on the crank knob and turn it. The wind follows
  the crank (ratchet: never backwards), clicks rumble in that hand, and the songbird hovers beside the rail until the
  pawl latches. Let go and the winch finishes by itself after 0.35 s. Latching before the bird would seat (80%) earns the
  quick reload. Untested in a headset: tune `SIEGEBIRD_WIND.grabReach` and the crank axis sign on device first.
- Tests: `tests/siegebird-wind.mjs` (new), `tests/siegebird-flock.mjs` (perfect wind, saves), `tests/siegebird-songbird.mjs`
  (winch coherence), `tests/crossbow-cords.mjs` (limb-riding strings).
- Previews: `preview/mech.html` (winch close-ups), `preview/roost.html` (perches), `preview/clip.html` with
  `tools/clip.mjs` for mp4 clips (`view=third|mech|fps`, `quick=1`, `perfect=.6`).
