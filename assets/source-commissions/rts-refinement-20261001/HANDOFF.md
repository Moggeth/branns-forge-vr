# RTS command panel + Tidal Glass Mana orb — handoff

Files (drop-in, `res://` root): `output/world_builder_command_panel.gd`, `output/mana_orb.gdshader`, `output/ui_symbols.gd`
(the panel `preload`s `res://ui_symbols.gd`, and loads `res://mana_orb.gdshader` if it exists; without the shader it
falls back to a flat fill, so the panel stays usable). No textures: noise is procedural hash value-noise, so it is deterministic.

Verified here: compiles and renders in Godot 4.7.2 (off-screen GPU window, SubViewport capture, fallback font).
Not verified: integration with the real game, native tests, HMD/VR use, GPU cost measurement, long-session look
(only still frames viewed — the animation was never watched in motion).
Screenshots: `shots/panel_{1280,1920,3840,1600,1024}_{half,full,empty}.png`, `shots/orb_half_zoom.png`,
`shots/compact_1024_crop.png`. Re-run: `check/capture.gd` (`SHOTS=<dir> [ONLY=1280_half,...]`, see command in check/).

## Preserved API
Signals, `setup`, `update_state`, `set_icon_atlas`, `is_over_panel`, `handle_shortcut`, `bottom_extent`, `layout_for_size`,
fields `_cards _tabs _panel _orb_c _orb_r` (panel-local coordinates; `_orb_r` is the inner glass radius, bezel adds 9*s).
F1–F4 = tabs left to right, 1–9 = 3x3 row-major. Only the panel silhouette (+orb) takes mouse; targeting clicks outside pass through.
`implemented` is kept when normalising catalogue entries (default true). A card with `implemented=false` is drawn grey and
does NOT set the local `_selected`; it still emits `spell_selected(id)` (as before) so the game can raise its own transient red
view label. If you would rather it emit nothing, gate it in `_choose_spell`.
Tooltip behaviour unchanged (hover a card; availability reason shown); it is now clamped fully on-screen in x and y.

## Layout / typography
Base size 908x256 (1080p, scale 1): orb column | Ability Info plaque | category tabs above 3x3 grid.
Cells 124x62: 30px icon area (hotkey badge left, icon centre, drop+cost right) over a dark label band with the full title
wrapped to <=2 lines. Scale = min(H/1080, 0.97W/908), clamped 0.88..2.4, never wider than the viewport or taller than 46% of it.
Measured: 1280x720 -> s0.88 (225px tall); 1600x900 -> 0.88; 1920x1080 -> 1.0 (908x256); 3840x2160 -> 2.0.
Compact (H<680 or W<1100, e.g. 1024x600): base 734x192, s>=0.9; cells reflow to icon-left / label-right (112x46),
smaller orb (r50), regen pills shortened to "4x/1x". At 1024x600 the panel is 661x173.
Fonts use the fallback font; every size is floored at 10px (`MIN_FONT`), body 12–13, titles 16–19, labels 11.5–12.5 at scale 1.
Text fitting is by real glyph advance (`_fit`): word wrap, may shrink at most ~2px, only then ellipsis (full title is in the hover tooltip).
Tab widths follow measured text so "Construction" never clips. Symbols (land, life, construction, encounters, mana drop,
clock, crosshair/line/ring/point picked from the gesture text, log, worker) are vector-drawn in `ui_symbols.gd`.
Info plaque: ABILITY INFO heading (+category/F-key), title, Mana / Cooldown / Gesture (+Lumber if >0) rows, availability reason
in red, backend `feedback` in dim text only if room, footer: log "Lumber n" and worker "Helpers n". Seed removed.
Body rows are height-budgeted so they can never run into the footer.

## Orb
Children of the panel (both `MOUSE_FILTER_IGNORE`): `ManaOrbShader` (one ColorRect, inner glass square only) and `ManaOrbOverlay`
(transparent Control above it: glass rim, "MANA", `mana / max`, pending `-cost` badge, all outlined). The overlay is a second node
because a child always draws after its parent's `_draw`, so it is the only way the numerals stay above the shader.
Bezel, finials and dark backing are drawn by the panel underneath.
Shader: violet liquid with a soft multi-sine boundary (calm when near empty/brimming), domain-warped circulation (slow rotation),
ridge-noise caustics in teal, faint wisps, sparse drifting motes (one grid hash, no nodes), rim darkening, upper-left window arc
+ specular, a dark scrim under the numerals, much darker empty glass. Selected-spell cost = thin brass line at the post-spend level
(red line at the cost height when unaffordable), not a pie. Cost ~ 3 noise lookups x2 + one mote hash per pixel.
Script cost per frame: a few float compares and up to 5 `set_shader_parameter` calls only while filling/pulsing; the panel no longer
redraws every frame (selection glow is static), it redraws on state/hover changes.
Response: displayed fill eases toward `mana/max_mana` (~5/s exponential). Spend (drop > 0.4 mana in one update): 0.7s ripple + warm
meniscus flash. Recharge: reaching full, or a jump >= 4% of max: 1.1s soft teal ring + surface glow. Slow regen never pulses.
First `update_state` and any `max_mana` change snap without animation.

## Known limits
- Cards without an atlas icon all show the category symbol (as before, the atlas is still honoured).
- Shader visuals were judged from stills only; check the motion in-game before locking values. Tunables: uniforms `deep_color body_color tide_color empty_color`,
  caustic gain (0.58) and scrim strength (0.42) in the shader.
- Performance numbers above are estimates, not measurements.
- Ran over the 540 s cap; files were exported before the final polish passes.
