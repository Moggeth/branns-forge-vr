# Forge Yard and Crystal Hollow run — 2026-09-27

The two priorities were the first clear tool-driven adventure loop and a Forge Yard that feels like a place to work rather than a set of floating menus. The playable Godot project is `godot/`; the service that speaks for Brann is `service/`.

## What changed

- The Forge Yard's simple box shelter became an authored timber-and-stone workshop with layered roof, chimney, beams, lanterns, metalwork and banners. Its main affordances now sit under three overhead station signs: talk to Brann, grow the forge, and test your craft. The existing Brann, collection, workshop upgrades, portals, smoke and gameplay anchors remain functional.
- Crystal Hollow became a composed cave with strata walls, mine traces, hanging crystals, a chasm arch, trails to both controls and a sculpted vault. The 14 modular Opus 5.5 GLBs are placed 49 times from `godot/assets/crystal-hollow/layout.json`; 29 simple collision proxies keep the art physical without mesh collision. The authored kit contributes 26,439 placed triangles and nine material slots. Its center bridge, return portal, ore, enemies and interaction positions remain accessible.
- The Prism Vault is a two-seal challenge. A quarry pick or bomb opens the fracture seal; Hollow's Song or three apprentice-hammer blows opens the song seal. Both routes use existing tools and trigger physical in-world response. When both seals wake, the veil drops; touching the heart grants the permanent Prism Ward (20% incoming damage reduction). Progress is stored locally in `user://crystal_hollow_challenge.json` and appears in the journal.
- The game sends structured challenge progress to the local service. Brann's text and live-voice instructions can discuss actual seal and reward state. Conversation alone cannot solve the challenge or claim a reward.

## Asset source and rebuilding

The isolated Opus commissions used the verified personal `fauxgrady@gmail.com` Claude.ai Pro subscription and pinned `claude-opus-5-5`, one after the other. The child environment removed Anthropic/Claude API override variables; the recorded model initialization reported `apiKeySource:none`. Editable source and briefs are curated under `assets/source-commissions/forge-yard/` and `assets/source-commissions/crystal-hollow/`. Playable GLBs live under `godot/assets/forge-yard/` and `godot/assets/crystal-hollow/glb/`. The source commission HANDOFF files describe the pieces and art constraints, although their original relative command examples refer to the now-ignored commission working folders.

From the repository root, a quick local Crystal Hollow rebuild is:

```powershell
$source = (Resolve-Path assets/source-commissions/crystal-hollow/build_crystal_hollow.py).Path
$out = Join-Path (Get-Location) 'work/crystal-hollow-rebuild'
& tools/blender-4.5.13-windows-x64/blender.exe --background --factory-startup --python-exit-code 2 --python $source -- --out $out --no-render
```

Inspect the new files and compare with the approved assets before copying anything into `godot/`; the working output does not automatically replace the live kit. `python scripts/asset_lab.py inspect <asset-spec> <glb>` runs Khronos and disposable Godot import validation. All 14 Crystal Hollow GLBs passed that check in this run. A changed piece must also pass in-game import, gameplay regression and a rendered view. For Forge Yard, the editable builder is `assets/source-commissions/forge-yard/build_forge_yard.py`; its source handoff and layout manifest describe its two approved GLBs.

## Fast checks

```powershell
& tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --editor --import --path godot --xr-mode off --quit
& tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --path godot --xr-mode off --script res://hollow_challenge_checks.gd -- --hollow-challenge-check
& tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --path godot --xr-mode off -- --expedition-check
Push-Location service; npm test; Pop-Location
```

Require `HOLLOW_CHECK_RESULT []`, `EXPEDITION_RESULT [] zones=17 reachable=12`, 103 passing service tests, and no `SCRIPT ERROR` in Godot output. Godot sometimes exits zero after a script error, so exit code alone is insufficient. The final actual-game captures were reviewed at `outputs/forge-opus-first-20260927.png` and `outputs/hollow-opus-second-20260927.png`; the captures are local review artifacts, not Git source. The Crystal Hollow capture reported 262 whole-frame draw calls, versus 283 in the earlier procedural capture, both at a reported desktop 120 FPS. These are single-view desktop diagnostics and do not establish VR frame time or comfort.

## Timing and lessons

Measured Opus commission wall times were 580.524 s for Forge Yard and 674.625 s for Crystal Hollow. All 14 Crystal GLB Asset Lab inspections took 31.408 s together. Final Crystal Godot import took 2.805 s, expedition check 3.061 s and focused challenge check 0.563 s; finer records are in ignored `logs/work-timing.csv`.

The early Sol workers inherited a staging-copy current directory, so their finished source had to be reapplied into this real repository. Future delegated work must name the actual Git checkout with an absolute path. The first Crystal art integration only created seven box colliders because the commission also specified cylinder and wall-ring proxy types; the loader now handles all three, creating 29. A rebuilt layout should be checked for passage clearance and collider count before a capture. No headset playtest occurred this run. In VR, check whether signage is legible, the arch and vault preserve reach, emissive crystals are comfortable, and the new geometry maintains steady frame time.
