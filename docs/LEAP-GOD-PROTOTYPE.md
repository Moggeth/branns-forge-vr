# Leap Motion God prototype

Local Windows experiment, opt-in, no production deployment. Tracking stays on
the connected PC; casts use the existing authority. No images, OS cursor events
or automatic XR probe. Routine logs never store hand coordinates.

## Try it

Run `./scripts/Start-LeapPreview.ps1` (hidden background process).
Open http://127.0.0.1:5194/?leap on this PC. Choose **God**, then **Play solo**
(or a cloud room). Click **Hands: off** to enable. Hold an open hand comfortably
over the sensor; its position becomes screen centre. Move left/right and up/down
to aim the existing ground reticle. Either hand works; right is preferred if both
are present initially. Keep that hand in view.

- Choose spells using the existing spell bar.
- Quick Cast on: thumb/index pinch casts a point spell immediately, once.
- Quick Cast off: pinch previews, release casts a point spell.
- Sunder/Wall/Growth Wave: pinch, move hand, release to finish the line.
- **Recenter hand** resets calibration; open your hand where comfortable.
- WASD, right mouse drag and wheel still control the camera. Two-hand camera
  gestures and an in-hand palette are outside this quick slice.
- **Hands: on** disables hand control. Menus, leaving God mode, focus loss,
  stale frames and lost tracking cancel gestures. Open hand to rearm.

Stop: `./scripts/Start-LeapPreview.ps1 -Stop`. Checks PID, command and start time
before stopping only its preview and native reader. Direct foreground alternative:
`cd multiplayer` then `node leap-preview.mjs`; Ctrl+C closes Vite and the reader.
Do not start both launchers simultaneously.

## Requirements / diagnosis

Existing multiplayer/node_modules, Node, Python, Ultraleap SDK x64 and running
Tracking Service required. Reader uses the installed packed LeapC 6.2 ABI and
`C:/Program Files/Ultraleap/LeapSDK/lib/x64/LeapC.dll`. No driver installation or
tracking-mode change. Place sensor for desktop use. Physical comfort needs testing.

Logs: logs/leap-bridge.log and logs/leap-preview.{stdout,stderr}.log.
Diagnostic: `python scripts/leap_frames.py --seconds 3` prints hand frames locally.
`/__leap/frame` exposes latest status/frame through loopback Vite only, no CORS.
Native output capped at 60 Hz; browser consumes latest frames around 30 Hz,
separate from 60 Hz simulation. Frames older than 180 ms cannot cast.
For errors check service/USB cable/logs, stop and restart launcher. Port 5194
conflicts fail rather than taking another process's port. Public Vercel game
does not connect to this local experiment yet.

## Verification and measured timings (2026-10-04)

- Sensor probe: 3.013 s, 179 frames, one hand. Command 3.279 s. Live preview
  subsequently returned 58.3 Hz and frame age 15 ms with no hand present.
- Pure gestures and patch notes: 0.177 s. Exactly-once casts, line release,
  hand identity, tracking loss/staleness, focus/menu, spell changes, invalid
  terrain and non-quick casting pass.
- Guarded actual-game Chromium: 17.283 s. Synthetic hands through real browser
  adapter spawned one skeleton; drawn Sunder produced seven terrain edits;
  menu cancelled unfinished line. Zero console errors; test browser closed.
- Build check: 1.064 s, existing bundle-size advisory only.
- Production build: 1.393 s including branch creation. Focused input, touch,
  gesture and patch-note checks: 0.312 s. Hidden launcher start/stop/restart and
  duplicate-start detection: 3.257 s, live frame age 10 ms at 57.9 Hz.
- Discovery commands: 0.296/0.770/0.232/0.247/0.243/0.231/0.174/0.162 s.
  Private-repo/account check and fetch: 3.132 s.

Real sensor and synthetic browser gestures tested separately. Physical hand-to-cast
latency/comfort, two-client play and all sensor orientations remain unverified.

Lessons: use installed packed LeapC ABI rather than assuming legacy LeapJS service.
Local same-origin Vite avoids unresolved hosted HTTPS/native transport. Use guarded
browser harness to avoid cursor capture/SteamVR. Failed patch used truncated
one-line context; split exact hunks. README contains non-UTF8 bytes, so preserve
bytes when inserting link. Accidental nonexistent diagnostic script failed in
0.117 s; it was not retried.

Launcher recovery: initial restart check failed (4.342 s); ownership comparison
mixed Windows path separators and ISO-date deserialization. Normalize both paths
and compare creation ticks as strings, then wait for termination. Re-test passed;
only owned reader/preview processes were stopped. No recurring visible terminal.
