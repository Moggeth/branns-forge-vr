# Orchard visual review capture

Run from the repository root with the portable graphical Godot build:

```powershell
& .\tools\godot\Godot_v4.7.2-stable_win64_console.exe --xr-mode off --audio-driver Dummy --path godot --script res://landscape_visual_review.gd --quit-after 1800 -- --world-builder-preview --landscape-seed=290929
```

The script refuses to run without the fixed seed and `--world-builder-preview`. That flag puts the game and World Builder in offline diagnostic mode, so the capture never loads or writes the player's terrain and settlement saves. It uses the actual shared Orchard world with an eye-height camera and the World Builder's elevated survey camera. It records the brook/bank and before, during and after stages of Sunder, Raise Earth and Grow Forest.

Review the twenty 1200 × 750 PNGs and `result.json` in ignored `outputs/landscape-visual-review/`. The final console line begins `LANDSCAPE_VISUAL_REVIEW` and includes each capture path, seed, failure list and measured script duration. Exit code zero means all three spells succeeded and all twenty images were saved; inspect the images for visual quality. The graphical run takes roughly 12 seconds on the development RTX 3080 Ti. Keep `--xr-mode off` to avoid starting SteamVR. If a run fails, inspect the first Godot `SCRIPT ERROR` and the final result line; deleting the ignored review output directory is safe before a rerun.
