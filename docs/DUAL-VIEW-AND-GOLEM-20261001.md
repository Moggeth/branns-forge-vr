# Native dual views, regional summons and golem rebuild

This pass keeps one authoritative Godot world and two live cameras. It changes presentation and input ownership; it does not introduce browser multiplayer.

## Controls

Open World Builder through the normal launcher, or F9 during desktop play. Existing inset layout remains the default; the top bar makes the alternatives visible.

| Action | Control |
| --- | --- |
| Switch FPS/RTS input without moving either picture | Tab, or the focus button |
| Free captured FPS mouse for layout controls | Escape |
| Resume FPS mouse look | Click the FPS picture; this first click does not fire |
| Side-by-side / picture-in-picture | Split / Inset; Shift+F9 toggles |
| Exchange split sides, retaining picture widths | Flip |
| Resize split | Drag divider; 40/50/60 buttons; double-click for 50/50 |
| Disable ratio snapping while dragging | Alt |
| Move/resize inset | Drag header / lower-right corner |
| Swap inset primary camera | F9 / Swap views |
| Fullscreen / windowed | F11 |

Mouse look stays unfiltered and immediate. Tab and Escape take precedence over travel/map input. Losing native focus releases capture. Toolbar and spell-panel clicks do not become weapon clicks. FPS Q/R no longer snap-turn; R retains crossbow reload and hold-to-reel. Q remains free for future actions. The VR snap-turn controls remain intact.

Layout, ratio, side, inset size/position and fullscreen/window placement persist in user://world-builder-view.cfg. Offline checks do not load or save that file. If old placement is unusable, close the game and rename that file; reopening restores defaults.

## Rendering and layout

Both cameras default to full pixel resolution of the actual content rectangle. At 4K with a 60/40 split, the tested Hero texture was 2299×2092 and RTS was 1533×2092; the remaining pixels are the toolbar/divider. In a 540×340 inset, content was 534×305 after its frame/header. There is no low-resolution inset texture enlarged to fill the main screen.

The Hero reuses the existing root viewport. Its native content dimensions are changed while the presentation window is open, with 3D scale 1.0, and restored on close. The RTS uses one shared-World3D SubViewport. No third camera renders a duplicate Hero picture. Optional RTS 65%/50% detail remains available but is not the default. The HMD viewport is excluded from these desktop changes.

The RTS panel is clipped and laid out within its own pane, including a compact native-text layout for narrow insets. The secondary picture renders behind its controls. The FPS HUD is retained in panes at least 600 pixels wide and suppressed in tiny spectator panes. The layout and command-panel controls remain separate from input focus.

The desktop target remains 120 fps. VR can reduce RTS redraw to 20 fps when sustained slow frames are detected, without reducing pixel resolution. Minimized redraw stops.

## Summoning on other maps

F4 opens Encounters; 1–6 choose Skeleton Patrol, Bone Duelist, Shield Patrol, Rat Swarm, Haunting and Stone Sentinel. Click valid ground to cast. The view follows region changes and automatically selects Encounters outside the Orchard. Terrain/life/construction spells continue to require the Orchard.

The same six actions work through the authoritative builder in every registered region. Bounds, dry supported floor, slope, obstacles, formation spacing and Hero clearance are validated before Mana/cooldown commitment. Rejected actions spend nothing. Warnings precede arrival; region, kind, elevation, surviving slots and delay survive JSON replay. Inactive-region encounter warnings do not tick. The global safety budget is eight encounter records.

Rats join normal animation/combat and leave their tails in the correct region. Ghosts remain fire-only. Skeletons and golems register with Adventure and ActorAnimation, preserving their ordinary loot/combat behavior. Each action has its own formation/target marker.

## Golem art and combat

Sonnet 5.5 High supplied the complete stone/copper/moss golem, editable Blender scene, deterministic texture/model builder, embedded textured GLB, named rigid pivots and Idle/Walk/Slam clips. Exact account/model verification is preserved with its source. The native runtime drives those pivots procedurally so attacks and structural damage remain synchronized.

The Stone Sentinel has 110 HP, deliberate heavy pursuit, a readable wind-up and a short ground slam. Local armour can break into physical plates. Damaged arms weaken the slam and damaged legs reduce pursuit. The exposed core is vulnerable, especially to a pickaxe. Core pulses preserve imported texture maps and mesh scale. Death produces bounded physical rubble with stone chips, dust and spatial clacks through the existing impact presentation system. No extra individual real-time light is added.

Installed GLB: godot/assets/golem/golem.glb. Source/rebuild contract: assets/golem-sonnet-20261001/README.md. Measured art budget: 20,006 triangles, 14 meshes, nine shared materials, 28 embedded PNG maps, 17.1 MB GLB. Packed editable source is archived outside Godot's import tree.

Opus 5.5 delivered the required concrete dual-view design and pure layout helper. Its source is in assets/source-commissions/dual-view-oct1/. Integration retains the existing inset default and F9 behavior; Tab/Shift+F9 expose the new independent focus/layout controls.

## Verification and timings

All checks used XR off, dummy audio and offline state. No resident game, launcher, bridge or SteamVR process was restarted. Native diagnostic windows were visible, unfocusable and offscreen. Raw logs/timings are in ignored logs/work-timing.csv.

| Measured step | Result | Seconds |
| --- | --- | ---: |
| Verified Opus UI commission | Concrete design and layout helper | 120.120 |
| Verified Sonnet 5.5 High commission | Complete golem art/source | 672.068 |
| Native Godot import | Clean import | 6.262 |
| Actual-Main FPS input check | Six checks, no failures | 7.587 |
| Focused authored golem check | Parts/materials/core/armour/slam/death/respawn pass | 0.740 |
| Final actual-Main regional summon check | Six summon kinds across Quarry/Pinewood/Orchard, real builder tick, JSON roundtrip | 7.729 |
| Final command panel check | Pane-relative layout/hits/HUD pass | 7.913 |
| Final native dual-view check | Six layouts through 4K; full pixels; no script errors; reviewed captures | 22.304 |

The clear eye-height Orchard + broad RTS sample observed 120.2 fps in two short 2-second windows at 1080p and 4K. Frame-interval p95 was 8.373 ms and 8.743 ms respectively. Readbacks occurred after timing. These are local scene measurements, not guarantees for heavy combat or headset play. Godot's sampled TIME_PROCESS monitor retained resize/fixture spikes; raw CPU values remain logged but are not presented as reliable steady CPU percentiles.

Additional focused checks cover 148 narrow-panel conditions, 29 spell entries, save migration, cross-region target geometry and marker budgets. Captures are in outputs/dual-view-oct1/. Known failed approaches and their fixes are recorded in docs/VERIFICATION.md, including camera-arrival setup, secondary-picture draw order, floor-layer masks and account switching.

Run from the repository in PowerShell, with the bundled Godot executable:

    .\tools\godot\Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot -- --desktop-focus-check
    .\tools\godot\Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://golem_checks.gd
    .\tools\godot\Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://world_builder_region_live_checks.gd -- --world-builder-check
    .\tools\godot\Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://world_builder_panel_checks.gd -- --world-builder-check
    .\tools\godot\Godot_v4.7.2-stable_win64_console.exe --xr-mode off --audio-driver Dummy --no-focus --position -12000,-12000 --path godot --script res://dual_view_checks.gd -- --world-builder-check

Reject SCRIPT ERROR/ERROR output even when Godot exits zero. Native captures, controls and automatic tests do not replace a human mouse/controller/headset acceptance pass. Relaunch the normal game to load this source update; no live hot replacement is claimed.
