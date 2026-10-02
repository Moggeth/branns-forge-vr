# Browser mobile controls — 2026-10-02

Scope: the hosted eight-player browser proof. Native Godot weapons, inventory,
crafting and other maps have not been ported by this change.

## Complete available-action mapping

| Function | Phone/tablet | Desktop | WebXR Hero |
| --- | --- | --- | --- |
| Move Hero | Left thumb stick | WASD/arrows | Left controller stick |
| Look | Right stick or drag world | Captured mouse | Head tracking |
| Strike | Attack | Left click | Trigger |
| Jump | Jump | Space | Standard primary face button A/X |
| God pan | Left stick | WASD/arrows | God is selected outside immersive Hero |
| God orbit/tilt | Right stick or drag world | Right drag | — |
| God zoom | +/− or two-finger pinch | Wheel | — |
| God centre | Centre button | Enable touch controls for button | — |
| Choose Skeleton/Raise/Grove/Starfall | Spell tray | Tray or 1–4 | — |
| Aim / cast | Tap terrain to aim, then Cast; centre aim otherwise | Click terrain casts | — |
| Cancel fixed aim | Cancel | Touch overlay Cancel when enabled | — |
| Release / menu | Menu button | Esc releases pointer, then Menu | Secondary B/Y exits immersive and opens menu |
| Fullscreen / exit | Toolbar or Menu → Display & controls | Menu → Display & controls / browser exit | Browser manages immersive display |
| Switch role | Menu role cards | Same | Exit immersive, then same |
| Copy code / invite | Menu | HUD or Menu | Exit immersive, then same |
| Backup / host reset / leave | Menu (reset requires confirmation) | Same | Exit immersive, then same |
| Recovery / continue hosting | Recovery notice button if offered | Same | Exit immersive, then same |
| Create / join / import / resume | Lobby buttons | Same | Browser UI before Enter VR |

God mode in immersive VR is not advertised by this browser proof. Standard XR
face-button mapping is feature-dependent; controllers without those buttons use
the platform's exit UI. It has not been physically headset-tested.

## Architecture and recovery

- `client/mobile-ui.js`/`.css`: Opus view layer, no game loop or pointer handling.
- `client/touch-input.js`: per-pointer ownership, radial dead zone, cancellation,
  world drag/pinch, tap-versus-drag distinction. Multiple fingers remain independent.
- `client/mobile-controls.js`: preferences, button routing, browser lifecycle,
  actual fullscreen feature detection, permission failure and menu integration.
- `client/game.js`: shared desktop/XR/touch actions; no synthetic keyboard events.
  Look is frame-time based; movement magnitude remains bounded. Stationary God
  centre aim caches the camera/terrain result instead of raycasting every frame.
- Preferences: `branns-forge.touch.*` in localStorage, failures tolerated. No new
  credentials, remote telemetry, external dependencies or paid services.
- Blur, app backgrounding, rotation, role changes, menu, disconnect and XR clear
  held input. Browser pointer cancellation and lost capture reset each thumb.
- `window.brannHarness.controls()` is read-only local diagnostic camera/swing
  state. Existing connection diagnostics omit reconnect credentials.
- Fullscreen needs a direct user gesture. Safari/device support varies; the app
  explains Add to Home Screen where unavailable. Manifest/iOS standalone metadata
  do not imply offline capability. See [MDN Fullscreen API](https://developer.mozilla.org/en-US/docs/Web/API/Fullscreen_API)
  and [Pointer events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events).

## Verification

`node --test tests/touch-input.mjs tests/session.mjs tests/world-saves.mjs tests/simulation.mjs`
passes 12 tests (81.7977 ms). Build completed in 178 ms compiler time; combined
regression/build command 0.9555631 s. Bundle: 714.68 kB / 187.86 kB gzip JS,
30.05 kB / 7.54 kB gzip CSS. Existing Three.js chunk warning remains visible.
No new animation loop, lights or 3D asset downloads were added for the controls.

Reproducible browser fixture: build against a disposable local peer endpoint,
copy `tests/mobile-playtest.html` into ignored `dist/mobile-playtest.html`, then
run Vite preview and open that page. Never use a populated friend room for tests.
The fixture uses synthetic PointerEvents with a capture shim only in its iframe
and restores native methods afterward; it does not establish physical multi-touch
acceptance. Thirteen real-renderer/simulation integration assertions passed in
3.926 s: simultaneous movement/look, heading, jump, attack animation, cancellation,
menu stop, aim without cast, cast, cancel, zoom both ways, God orbit/tilt, handedness.

Visual checks: 360x640 portrait Hero/God; 640x360 short landscape and 844x390.
Real browser Fullscreen button entered fullscreen and changed to Exit full screen;
exit restored normal mode. Actual iPhone/Android, safe-area hardware, OS interruption,
mobile GPU frame times and physical headset tests remain pending.

## Commission and lessons

Opus UI commission: verified personal `fauxgrady@gmail.com`, Claude.ai Pro, scrubbed
provider/API overrides, requested/actual/canonical `claude-opus-5-5`, high effort,
204.934 seconds. Isolated editable output: `work/opus-mobile-controls-20261002`.
Codex owns integration, behaviour, tests and deployment. No API-billed fallback.

- Short landscape utility buttons initially overlapped Cast/Orbit. A centered
  second top row fixes this; inspect both portrait and short landscape, not only
  desktop responsive width.
- Repeated clearInput calls after setActive(false) cancelled the pending network
  stop message. Retain that scheduled message while inactive; the end-to-end
  menu-stop regression detects motion that unit-level stick tests cannot.
- Synthetic iframe tests need `new (win().Event)(...)`; `new win().Event(...)`
  constructs the accessor instead. Initial fixture failed before gameplay.
- A missed swing emits no server combat event; assert the real weapon animation
  timestamp rather than assuming a fabricated `swing` event exists.
- Use an isolated compiled-output deployment from OS temp per PEER-PLAYTEST.md.
  The diagnostic HTML is deliberately excluded from public deployment.
