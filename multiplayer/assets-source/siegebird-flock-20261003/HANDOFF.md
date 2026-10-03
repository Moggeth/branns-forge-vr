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
