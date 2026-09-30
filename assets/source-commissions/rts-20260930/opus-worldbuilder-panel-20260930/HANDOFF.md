# World Builder Command Panel — handoff

File: `world_builder_command_panel.gd` (`class_name WorldBuilderCommandPanel`, extends `Control`).
Self-contained: default font, StyleBoxFlat + `_draw()`. No child nodes, no shaders, no assets.

## Layout (base 1920x1080, scale 1)
A single chamfered wood/brass bar, centred at the bottom, 866x218 px (~20% of height). World stays dominant.

| Zone | Base rect | Content |
|---|---|---|
| Mana orb | centre (96,104), r 70 | Violet→teal liquid, wave on surface, gold pulsing band = selected cost (red when unaffordable), `cur / max`, `-cost` |
| Regen toggle | under orb, 2 pills | `Testing 4x` / `Normal 1x`; active pill teal |
| Info plaque | x190 w372 | Palette name + F-key, selected spell title, cost · gesture, unavailable reason (red), backend `feedback` (2 lines), footer `Lumber · Helpers · Seed` |
| Palette tabs | x574, 4 stacked 92x41 | Title + F1–F4, hue stripe on active |
| Command card | x676, 3x3 of 56 px, gap 5 | Icon/silhouette, hotkey badge 1–9, mana cost (red if unaffordable), title strip, cooldown veil, selected glow |

Tooltip: parchment card above the panel over the hovered card (name, [key], Mana/Lumber/Cooldown, description, gesture, unavailable reason in ink-red). Clamped to screen.

## Palette / type / spacing
Wood `#16100b`, brass `#cca157` / dim `#755730` / hi `#ffdb8c`, slate plaque `#0e1618`, teal `#42dbd1`, violet `#804deb`, warn `#f26b52`, parchment `#ebd9b0`, ink `#301f14`.
Palette hues: Land amber, Life green, Construction sand, Encounters violet.
Type (×scale): spell title 18, tooltip title 16, body 12, labels 11, card title 9.5, min 8. Default font, outlines on numbers over art. Spacing grid ≈ 5/12/14 px.

## Scaling
`scale = clamp(min(h/1080, 0.96·w/866), 0.70, 2.4)`; all rects rounded to whole pixels.
- 960x620 → 0.70: panel 606x153 (card 39 px, title text clamps to 8 px min). Readable but dense; tooltip remains the full-detail view.
- 1920x1080 → 1.0. 4K → 2.0 (crisp: drawn at native res, not the 65% world buffer).
Put this Control in a CanvasLayer / the root UI, never inside the scaled 3D SubViewport.

## Interaction
- Left-click card → `spell_selected(id)` (even if unavailable; reason shown). Selection persists for repeated casting; `update_state.selected` is authoritative.
- Click tab → `palette_selected(id)`; pill → `regen_preset_selected(4.0|1.0)`.
- Panel consumes clicks (`accept_event`); `_has_point` limits capture to the panel/orb, so the rest of the screen passes through to the world.
- `handle_shortcut`: 1–9 / numpad 1–9 select in current palette (consumed even on empty slot), F1–F4 palettes, Esc → `cancel_targeting`. Echo ignored. Right-click is not handled (root owns it).

## Exact API
```
signal spell_selected(id: String)
signal palette_selected(id: String)            # "land" | "life" | "construction" | "encounters"
signal regen_preset_selected(multiplier: float)
signal cancel_targeting()
func setup(catalogue: Array) -> void           # {id,title,palette,description,gesture,mana,lumber,cooldown,icon}
func update_state(state: Dictionary) -> void   # {mana,max_mana,wood,selected,palette,spell_cost,feedback,seed,helpers,
                                               #  availability:{id:reason}, cooldowns:{id:0..1}, regen:float (optional)}
func set_icon_atlas(texture: Texture2D, columns: int, rows: int, indices: Dictionary) -> void
func is_over_panel(position: Vector2) -> bool  # viewport coords
func handle_shortcut(event: InputEventKey) -> bool
func bottom_extent() -> float                  # px from bottom covered by panel
func layout_for_size(size: Vector2) -> void    # called automatically on resize
```
Defaults: missing title → `id.capitalize()`; missing/unknown palette → looked up from the canonical ID lists, else Land; numbers → 0; max 9 cards/palette in catalogue order. `spell_cost` defaults to the selected entry's mana. **Addition:** optional `state.regen` (or `regen_multiplier`) highlights the active regen pill; defaults to 1x.

## Integration notes (Codex)
- Instantiate as a child of a full-screen UI `CanvasLayer`; it sets FULL_RECT anchors itself.
- Route `_unhandled_key_input` / root key handling through `handle_shortcut` first.
- Before world casting on click: `if panel.is_over_panel(mouse_pos): return`.
- Preview camera reservation: `panel.bottom_extent()` (native px) — convert to the 65% render scale yourself if needed. No camera/renderer interfaces are touched.
- Atlas: cells row-major, zero-based; blocked spells are drawn dimmed. `entry.icon` is stored but unused (atlas indices win).
- Cost: one `queue_redraw()` per frame from `_process` (for orb wave/selected pulse). If profiling cares, throttle or only redraw when hovered/selected/animating.

## Verification status
Not run: no Godot binary was invoked and no screenshots were created. Codex must:
1. Open in Godot 4.7.2 and confirm the script parses (watch for integer-division warnings, `draw_string` arg order).
2. Visually check at 960x620, 1920x1080, 3840x2160; check tooltip clamping near screen edges.
3. Confirm `_has_point` pass-through doesn't swallow world clicks outside the panel.
