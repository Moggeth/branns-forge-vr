# The Director's Table — local asymmetric prototype

The first adversarial role is playable in **Pinewood Ruins**. One person plays the ordinary Godot adventurer in VR or on desktop. A second person commands enemies from a native Godot window on the same PC. Little Wing can still join as the adventurer's ally through F8. This is an opt-in match mode; the ordinary adventure launchers and save progression remain available.

## Launch and stop

- Extend the Windows display to the projector and get SteamVR's headset and controllers showing ready. Open **Brann's Forge Launcher** on the desktop, choose **Director**, **VR headset**, and **Native window**, then press **Start Game**. For no-headset practice choose **Monitor / projector**. The launcher checks that SteamVR's compositor is running so a missing headset does not silently turn the evening into a desktop game. It opens the ordinary adventurer viewport and a second native **Brann's Forge — Director** window. Move the Director window to the projector and press **F11** for fullscreen. The tactical camera shares the live Godot `World3D`; there is no browser, JPEG stream, or second game process in this path.
- Give the Director window to the second player and the headset to the adventurer. F8 in the Godot adventurer window can open Little Wing if a third person wants to help. Closing the Director window removes that view but leaves the adventurer playing; the launcher's **Stop managed session** button closes this project's recorded game, audio helper, and service when the session is over.
- Close an ordinary or browser Director game window before switching to native mode. The launcher refuses to replace an already-running game with a different mode. It preserves unrelated Godot and SteamVR processes. A previous native session can be brought back by closing the game and launching again.
- Choose **Browser view - older fallback** in the launcher for the previous web Director. It opens `http://127.0.0.1:8787/director/` as a dedicated Chrome/Edge app window when Chromium is installed; otherwise it uses the default browser. The fallback uses the local frame stream and requires the service Director endpoints. Earlier batch shortcuts remain under `launcher/legacy/` for compatibility.
- For startup or action problems, inspect the latest `logs/game-*.log` for `DIRECTOR_LOCAL`, `DIRECTOR_SESSION`, `DIRECTOR_COMMAND`, and `DIRECTOR_RESULT`. `logs/service-*.log` and the browser console apply to the browser fallback. The native window's `Render 100% / 75% / 50%` selector reduces its 3D resolution if the headset or projector slows down.

## Round rules

The native Director presses **Begin Round**, then hovers an approach and presses **1–4** to cast a card there immediately. **W/N/E** selects west/north/east from the keyboard; **Enter** repeats the selected card at that approach. Clicking a card then an approach also casts it. Right- or middle-drag orbits the camera, the mouse wheel zooms, **R** resets the view, and **F11** toggles fullscreen. The approach glows **2.2 seconds** before enemies arrive. Costs, cooldowns, and a nine-enemy field cap constrain calls. Sparks regenerate at 0.55/s, up to ten.

The browser fallback has its own controls: hover an approach and press **1–4** to cast, **Q/E** cycle approaches, **Escape** clears the choice, drag to orbit, and wheel to zoom.

| Call | Result | Sparks |
|---|---|---:|
| Bone patrol | Two skeletons | 3 |
| Wandering lights | Two wisps | 2 |
| Stone sentinel | One golem | 5 |
| Dusk veil | Pinewood darkens for 12 seconds; Little Wing's glow becomes useful | 4 |

The adventurer wins by standing beside each of three physical waystones for about 1.8 seconds, within 2½ minutes. The director wins by defeating them or holding the forest until time runs out. Leaving Pinewood forfeits the round. Finishing pauses director-summoned enemies; **Rematch** clears them and resets the waystones, then **Begin Round** starts again. Ordinary Pinewood enemies stand down during the match. Director-summoned creatures use the existing Godot combat, hit reactions, shields, and physics; their deaths do not mint normal RPG loot or XP.

## Technical boundary

The native path uses `godot/director_local_view.gd`, a second Godot `Window` with its own HUD and a shared-world tactical `SubViewport`. Its controls call the local `godot/director_runtime.gd` match logic directly. The second camera initially renders at a 60 fps cap and 75% scale; the window also offers 30 fps, uncapped, 50% and 100% choices. The UI keeps responding between 3D refreshes. There is no GPU readback, JPEG encoding or browser image transfer in this path, but each tactical render still costs GPU time. `godot/director_runtime.gd` owns warnings, actor spawns, waystones, dusk state, and outcomes; `godot/adventure_runtime.gd` handles actual attacks and deaths.

The browser fallback under `service/public/director/` displays a 1024×576 live Godot camera feed at most five JPEG frames per second while the page is viewed. Godot projects approach coordinates into the frame so markers align during orbit. The stream uses asynchronous GPU readback when available. The service stores only the latest frame in memory and validates the local session, camera bounds, costs, cooldowns, stale connections, and enemy cap.

The service remains bound to **127.0.0.1**. This is local same-PC multiplayer; sending the URL to someone elsewhere will not connect them. Remote play requires an authenticated gateway, transport design, reconnect ownership, and proper exposure review. The browser's live state uses frequent small HTTP snapshots for this local trial; a later remote version should move to a purpose-built realtime transport. It should not duplicate Godot physics in JavaScript.

## Verification and current limits

Run `scripts/check-director-local.ps1` for the native view and a complete local summon; add `-DesktopVisual` for a brief two-window capture and desktop frame-time rehearsal. `node scripts/check-director.cjs` checks the offline match rules, and `node scripts/check-director-performance.cjs --native-window` exercises a tiny shared-world render. A 360-frame desktop rehearsal on this PC, with the native view at 60 fps/75% scale, measured **120 engine FPS and 9.33 ms p95 frame time**. This is desktop evidence only; the headset must be ready for a meaningful VR measurement. During play, `DIRECTOR_PERF` appears every ten seconds in `logs/game-*.log` with engine FPS, p95 frame time, tactical cap, scale, and draw calls. If headset motion suffers, set the Director view to 30 fps and 50% scale first.

`node scripts/check-director-bridge.cjs`, `node scripts/check-director-frame.cjs`, and `cd service; npm test` verify the browser fallback. The frame test writes `outputs/director-live-frame.jpg` and diagnostic details to `logs/director-frame-check.log`. In a local 3080 Ti desktop browser-feed test, asynchronous readback plus JPEG encoding took about **5.1 ms** for the first frame, compared with about **20 ms** using synchronous `get_image()`; these are not VR frame-time measurements.

Visual reviews: [live fullscreen round](../outputs/director-fullscreen-live.png) and [mobile demo layout](../outputs/director-mobile-demo.png).

This native mode has not yet been physically tested with a VR headset, projector, and two or three human players. The second camera adds scene rendering cost at the chosen resolution. No 120 FPS claim is warranted until headset frame timing is measured during a live round. Start at 75% or 50% Director render scale if the headset stutters, and check SteamVR frame timing along with `logs/game-*.log`. Combat balance, sight-line fairness, HUD readability on the actual projector, and comfort need a live playtest.
