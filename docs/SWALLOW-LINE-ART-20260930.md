# Swallow Line authored grappling hook

Swallow Line now uses a Sonnet 5.5-authored model: curved bird-talon hooks, a compact rope-wound reel, steel side plates, brass fittings and a textured wood/leather grip. The previous procedural model had a large plain spool and straight metallic spikes. Compare the [before](../assets/swallow-line-sonnet/previews/game_before.png) and [after](../assets/swallow-line-sonnet/previews/game_after.png) actual first-person Godot captures. [Front](../assets/swallow-line-sonnet/renders/front.png), [side](../assets/swallow-line-sonnet/renders/side.png) and [three-quarter](../assets/swallow-line-sonnet/renders/three_quarter.png) Blender renders show the underlying authored form.

The mechanical link is real: `SpoolPivot` contains the drum, flanges and wound cord, and the existing reeling tick rotates it about its local X axis. `HookTip` anchors the drawn gameplay tether. The rest of the tool remains rigid. The trigger still attaches, hold still reels, release pauses, and dropping the handle detaches. The procedural fallback remains if the GLB or its required markers cannot load. Collision is still the existing gameplay-owned box and covers the 0.742 m tall, 0.487 m wide silhouette.

The editable Blend, deterministic Blender builder, self-contained GLB, stats and artist handoff are in [`assets/swallow-line-sonnet/`](../assets/swallow-line-sonnet/HANDOFF.md). Godot installs it under `godot/weapons/`. The model has 3,568 triangles, eight mesh draw items and five material families; it adds no lights. Rebuild from the repository root:

```powershell
& './tools/blender-4.5.13-windows-x64/blender.exe' --background --factory-startup --python-exit-code 2 --python 'assets/swallow-line-sonnet/build_swallow_line.py'
Copy-Item -LiteralPath 'assets/swallow-line-sonnet/swallow_line.glb' -Destination 'godot/weapons/swallow_line.glb'
& './tools/godot/Godot_v4.7.2-stable_win64_console.exe' --headless --editor --xr-mode off --audio-driver Dummy --path godot --quit
& './tools/godot/Godot_v4.7.2-stable_win64_console.exe' --headless --xr-mode off --audio-driver Dummy --path godot --script res://swallow_line_art_checks.gd
```

The verified personal-subscription Sonnet 5.5 commission took **137.630 s**. An independent Blender run took **2.882 s** and produced a byte-identical GLB. Godot imported it in about **4.04 s**. The focused test took **7.78 s**, checking imported markers, visible moving drum/flanges, actual reel rotation and tether-origin wiring. The actual-game capture took **11.40 s**. These figures are step timings, not a headset frame-time claim.

The final focused check passed again after tether wiring, the complete native/service integration passed in **63.148 s**, and all seven service unit tests passed in **0.265 s** wall time.

Known art limitation: the fixed rope lead starts near the spinning wound cord, so its joint may shift visually at some spool angles. Tether tension, clipping against real walls and hand comfort still need a VR playtest. Existing sessions require a relaunch to load the new asset.
