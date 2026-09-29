# Orchard bank and undergrowth art — 2026-09-30

Sonnet 5.5 authored four new textured props for the existing procedural Orchard: a moss-banded boulder, a shallow stratified river slab, a fallen branch and a solid-frond fern. The game retains its Opus-authored trees, interactive apple/lumber resources, terrain, stream, routes, procedural placement masks and world-builder reactions. The new meshes replace the corresponding rock/log variants; the fern is a modest additional variant. They go through the same chunked MultiMesh dressing path and rock collision proxies, so a carved path still clears them and terrain deformation still reprojects them.

Inspect [the actual game's ground view](../assets/orchard-bank-sonnet/previews/orchard_highlands-ground-eye.png), [RTS view](../assets/orchard-bank-sonnet/previews/orchard_highlands-elevated-rts.png), and close views of the [boulder](../assets/orchard-bank-sonnet/previews/rock_mossy_boulder.png), [branch](../assets/orchard-bank-sonnet/previews/branch_fallen_mossy.png) and [fern](../assets/orchard-bank-sonnet/previews/fern_bank_patch.png). These are Godot captures in the playable world; the separate Sonnet renders in `assets/orchard-bank-sonnet/` show the unplaced kit. The visual result is a selective dressing improvement, not a replacement of the existing orchard layout.

`assets/orchard-bank-sonnet/` contains the editable Blend, deterministic Blender builder, four GLBs, renders and stats. `godot/assets/atmosphere/sonnet_bank/` contains the installed GLBs. Each has one mesh/surface and embedded colour and roughness textures. Their triangle counts are 1,280 / 1,280 / 710 / 1,210. The installed dressing keeps 130 boulders, 90 slabs and 140 logs; it adds 480 fern patches across the 320 m region. Rocks retain conservative collision proxies sized to their new mesh bounds. The material cache now keys separate Sonnet atlases by variant, preserving the Opus shared atlas for older assets.

Verification: Blender rebuilt all four GLBs byte-identically in **2.326 s**; Godot imported them without errors in **4.352 s**; the focused field/material check passed in **0.291 s**; all four save-isolated, close actual-game captures passed in **11.502 s**; and all 24 ground/RTS zone captures passed in **14.188 s**. The Orchard screenshots measured 1,131 ground-eye and 1,015 elevated draw calls. Those are single-view sample counts, not a VR stereo frame-time benchmark; the broader Orchard still has significant pre-existing scenery draw cost.

Run the focused checks from the repo root:

```powershell
& .\tools\godot\Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://orchard_dressing_fields_checks.gd --quit-after 2400
& .\tools\godot\Godot_v4.7.2-stable_win64_console.exe --xr-mode off --audio-driver Dummy --path godot --script res://orchard_bank_art_review.gd --quit-after 2400 -- --world-builder-preview
```

Commission lesson: the original broad Orchard prompt occupied Sonnet for **280.5 s** without exporting a usable model, so that run was stopped before it consumed more subscription time. A narrower four-prop brief required an exported textured GLB and render before planning; it completed with verified Sonnet 5.5 in **208.947 s** and yielded an independently rebuildable kit. For future environment commissions, ask for a small runnable first artifact, then expand only after seeing it. On Windows PowerShell, use `Copy-Item 'path/*.glb'` for a glob; `-LiteralPath 'path/*.glb'` treats the asterisk literally and fails.
