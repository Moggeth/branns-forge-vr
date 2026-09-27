# Generated art on three game assets (2026-09-25)

This trial tests whether a strong 2D concept image can lift a stylised 3D
asset **inside the actual Godot game**. The answer is yes when the image is
assigned to a deliberately chosen surface, with UVs or local-space mapping,
and the existing shape and lighting continue doing their jobs. Simply wrapping
one image around an entire model would smear details and obscure materials.

| Asset | Treatment | Native evidence |
| --- | --- | --- |
| Mossward guardian shield | Generated oak-and-roots painting on the front wood, plus separate grain, raised ivory wear, normal and roughness maps. The rim, bolts, handle, body, rig and shield pickup remain intact. | `outputs/texture-trial/mossward-close-game.png` |
| Siegebird | Generated teal/gold enamel mapped onto selected existing feather panels. The mechanism, named sockets, morphs, clearance and bolt controls are unchanged. | `outputs/texture-trial/siegebird-after-game.png` |
| Hollow's Song | Violet fissure art sampled on three local planes inside the existing translucent crystal shader. Facets, rim glow and silhouette remain. | `outputs/texture-trial/hollows-song-after-game.png` |

The three source images are preserved beside their derivation code:
`assets/mossward-texture-trial/source/mossward-shield.png`,
`assets/siegebird-opus/textures/source-siegebird-enamel.png`, and
`godot/assets/hero/hollows_song_crystal.png`. Game-ready outputs live in
`godot/guardians/assets/mossward/`, `godot/assets/siegebird/siegebird.glb`,
and the Hollow's Song shader/hammer scripts. The original Siegebird model is
in `assets/siegebird-opus/pre-generated-enamel/`.

Opus 5.5, through the approved Claude Pro CLI subscription, completed the
Mossward texture derivation, UV/material builder and before/after studio
renders. It prepared Siegebird's enamel textures. Its five-hour included usage
then reached 100%; the commission ended without switching to API billing.
Codex integrated the Siegebird material, built Hollow's Song's shader treatment,
and reviewed all three in native Godot. The commission transcript and brief are
in `work/opus-texture-trial/`.

## Rebuild and check

Siegebird: run `scripts/Build-Siegebird.ps1` from PowerShell. This rebuilds
the GLB, checks mechanism clearances and runs the native crossbow check.

Mossward: from the project root, use the bundled Blender with
`--background --factory-startup --python-exit-code 2 --python assets/mossward-texture-trial/builder/build_mossward_textured.py -- --no-render`.
The self-contained GLBs appear under
`assets/mossward-texture-trial/textured/assets/mossward/`; copy the two GLBs
to `godot/guardians/assets/mossward/`, then import in Godot. The companion
`tools/make_mossward_textures.py` recreates the derived PNG maps from the
saved concept image when needed. Siegebird has a corresponding
`assets/siegebird-opus/tools/make_enamel_textures.py`.

After rebuilding, run native `--guardian-check`, `--siegebird-check`, and
`--runtime-check` using the bundled Godot with `--headless --xr-mode off
--audio-driver Dummy --path godot`. All three passed after the final files
were installed: `GUARDIAN_RESULT []`, `SIEGEBIRD_RESULT []`, and
`RUNTIME_CHECK xr=false`. Logs are under `logs/texture-final-*-check.log`.
The Godot captures are actual rendered source-game frames, not mockups.

This is a visual feasibility test, not a headset performance test. The
crossbow still has 68,252 triangles and the same mechanics; Hollow's Song
still has 16,880 triangles and six draw calls in its isolated capture.
Texture detail on Mossward reads best up close; world lighting and distance
still affect visibility. A game already running needs restarting to load these
source asset changes; historical exported demo packs are snapshots.
