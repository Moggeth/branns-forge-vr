# Brann's Forge — Dual View (FPS + RTS) Layout Design

Status: design handoff for root Codex. Scope: desktop (non-VR) native Godot 4.7 window. No web UI. Two render sources only: the existing **Hero viewport** (FPS) and **one tactical SubViewport** (RTS).

All sizes are **logical px at UI scale 1.0** (reference window 1920x1080). UI scale is `clamp(min(win_w/1920, win_h/1080) * 1.0, 0.75, 2.0)` rounded to 0.05; at 960x620 → 0.75 (floor), at 3840x2160 → 2.0. Minimum readable text: 13 logical px body, 11 logical px tooltip caption (→ ≥ 9.75 physical px at the floor; use 12 physical as absolute floor).

---

## 1. Concepts: layout vs focus (never conflate)

| Concept | What it controls | Changed by | Visual cue |
|---|---|---|---|
| **Layout** | Where panes sit and their size: `pip` or `split`, which view is primary/left, ratio, PiP rect | Chrome bar, divider drag, PiP drag/resize, F9, Ctrl+Shift+F (flip) | Chrome bar layout segment highlights |
| **Input focus** | Which pane receives keyboard + mouse (WASD/mouselook vs RTS camera/selection) | TAB, clicking into a pane, ESC (releases capture only) | 2 px gold focus frame around focused pane + focus pill in chrome bar |
| **Pointer capture** | Mouse locked/hidden for FPS mouselook | Only when FPS has focus AND player clicks into FPS (or TAB into FPS) | Crosshair visible; cursor hidden |

Rule: **TAB never moves a divider, never swaps panes, never resizes PiP.** Layout changes never change focus, except that if a view becomes hidden (not possible in these modes — both always visible) focus stays put.

---

## 2. Layout modes

### 2.1 Picture-in-picture (`pip`) — retained
- Primary view fills the window; secondary view is a floating inset.
- Default inset: secondary = RTS, anchored bottom-right, size **480x300** logical, margin **16** from edges, offset above FPS HUD bottom strip (y margin = 16 + HUD bottom reserve 72 when primary is FPS).
- Drag: grab the inset's **title strip** (top 22 px, shows "Tactical" / "Hero" + mini buttons). Dragging anywhere else in the inset is gameplay input for that view.
- Resize: 12x12 px grip at every corner (cursor `CURSOR_FDIAGSIZE`/`BDIAGSIZE`) plus 6 px edge bands. Aspect free; min **240x150**, max **70% of window width x 70% of height**.
- Snap: within 24 px of a window edge/corner, snap to margin 16. Hold Alt to disable snap.
- Mini buttons in title strip (right side, 18x18 each): **⇄ Swap** (primary↔secondary), **⊟ Split** (convert to split). Tooltips: "Swap main and inset view (Ctrl+Shift+F)", "Side-by-side view (F9)".
- Stored as normalized rect (fractions of window) so it survives resolution change; clamped on load.

### 2.2 Split (`split`) — new
- Left/right panes, divider between. `left_view` ∈ {`fps`, `rts`}; default **FPS left, RTS right**.
- Ratio = left pane width / (window width − divider). Presets **0.50, 0.60, 0.40**; free drag clamps to **[0.25, 0.75]**, and each pane ≥ **320** logical px wide (divider refuses further drag).
- Divider: visual **4 px** (pine `#23483C` with 1 px gold `#C9A24A` centre line), hit area **12 px** (4 + 4 each side). Cursor `CURSOR_HSIZE`. Center grip: 3 gold dots, 4x28 px.
- Drag snaps to presets when within **±0.015** (magnetic); Alt disables. Double-click divider → 50/50.
- Keyboard: **Ctrl+Shift+Left/Right** nudge 0.05; **Ctrl+Shift+F** flip sides (ratio mirrors: 0.60 → 0.40 so each view keeps its width); **Ctrl+Shift+0** reset 50/50.
- Divider drag, while held, never lets either viewport receive the mouse events (no accidental fire / box-select).

### 2.3 F9 compatibility
F9 keeps its existing meaning ("toggle dual view") extended as a cycle: **Single primary → PiP → Split → Single primary**. If existing code treats F9 as binary show/hide RTS inset, keep `F9` = toggle between *off* and *last used dual mode* (`pip` or `split`), and add **Shift+F9** = switch PiP⇄Split. **Recommendation: the latter** (preserves muscle memory; nothing breaks). Single mode shows only the primary view (secondary SubViewport `render_target_update_mode = DISABLED`).

---

## 3. Resolution: both cameras full resolution at pane size

- Each pane's SubViewport `size` = pane rect size in **physical pixels** (`pane_logical * content_scale_factor`, rounded, ≥ 64), set on every layout change / window resize. **Never** use `SubViewportContainer.stretch_shrink > 1`. `stretch = true` with shrink 1 is fine; or set size manually — manual preferred to avoid a one-frame mismatch.
- Hero viewport: if it is the root viewport today, in split/PiP-primary it must render into a SubViewport (or root with `Viewport` size override) matching its pane — the design requirement is 1:1 texel:pixel for both. Camera `keep_aspect` = KEEP_HEIGHT for FPS (vertical FOV stays constant; narrower pane = narrower horizontal FOV). RTS ortho/perspective camera keeps its zoom per height, so compacting the pane shows less width, not a squashed map.
- Debounce SubViewport reallocation during divider/PiP drag: resize at most every **50 ms** while dragging and once on release (avoids VRAM thrash at 4K).
- Hidden/secondary views in single mode: disable updates, don't free.

---

## 4. Chrome bar

A single restrained strip — present in every mode, always drawn on top, not part of either viewport.

- Position: **top-centre of the window**, height **28** logical, auto width (~ 520 in full form), 0 px from top, rounded bottom corners 6. Background pine `#14261F` at 86% alpha, 1 px bottom/side border gold `#C9A24A` at 55%. Text parchment `#E9DDBF`, active item teal `#3FB6A8` underline 2 px.
- In split mode it straddles the divider (centered on the window, not a pane) so it belongs to neither view.
- **Auto-dim**: at 35% opacity when pointer is captured by FPS, 100% when cursor is free or hovering within 40 px. Never fully hidden (except tiny fallback, §8).

Contents, left → right (full form):

| # | Control | Size | Label | Tooltip |
|---|---|---|---|---|
| 1 | Focus pill | 112x20 | `● HERO` or `● TACTICAL` (gold dot) | "Keyboard & mouse go to this view. TAB to switch." |
| 2 | sep | 1x16 | | |
| 3 | Layout segmented | 3x 64x20 | `Single` `Inset` `Split` | "Show one view (F9)" / "Picture-in-picture (Shift+F9)" / "Side by side (Shift+F9)" |
| 4 | sep | | | |
| 5 | Ratio segmented (split only; hidden in pip/single) | 3x 44x20 | `40` `50` `60` (left pane %) | "Left pane 40% / 50% / 60% — or drag the divider" |
| 6 | Flip | 24x20 | `⇄` | "Swap sides (Ctrl+Shift+F)" |
| 7 | sep | | | |
| 8 | Fullscreen | 24x20 | `⛶` | "Fullscreen (F11)" |
| 9 | Menu | 24x20 | `☰` | "View settings" → popup: UI scale, chrome auto-dim, snap, reset layout |

Buttons: flat, 1 px gold border on hover, teal fill 18% when active. Glyphs rendered with the game font or icon textures (don't depend on emoji font presence — ship 16x16 SVG icons: `swap.svg`, `fullscreen.svg`, `menu.svg`).

Keyboard/mouse: chrome bar is clickable only when the cursor is free (FPS not captured). Clicking the chrome bar **does not change focus**.

---

## 5. Focus, capture and ESC

States: `focus ∈ {fps, rts}`, `captured ∈ {true,false}` (only possible when focus = fps).

| Event | Result |
|---|---|
| **TAB** | Toggle focus fps↔rts. Entering fps → capture immediately (mouselook ready, no fire). Leaving fps → release capture, warp cursor to centre of RTS pane. Layout unchanged. |
| **ESC** (any state) | Release capture (`MOUSE_MODE_VISIBLE`). Focus value unchanged. If already uncaptured and no menu open → open existing pause/game menu (current behaviour). ESC is **never** swallowed by the FPS. |
| **Left click in FPS pane while uncaptured** | Set focus = fps, capture, **consume the click** (no fire, no interact). Set `_suppress_fire_until_release = true`; fire is ignored until LMB is released. |
| **Right/middle click in FPS pane while uncaptured** | Same as left — focus + capture, consumed. |
| **Click in RTS pane** | Focus = rts; the click **is** delivered (select/command) — RTS clicks are cheap and expected. Exception: if focus was fps (captured), ESC/TAB is required first — captured cursor can't reach the RTS pane anyway. |
| **Click on divider / PiP title / chrome bar** | Never changes focus or capture. |
| **Window loses OS focus (alt-tab)** | Release capture; on return, stay uncaptured until click in FPS (consumed). |
| **Menu/dialog open** | Release capture; restore nothing automatically. |

Focus indication:
- Focused pane: **2 px gold `#C9A24A` inner frame** + 1 px dark outer line `#0B1410` for contrast on bright scenes. Unfocused pane: 1 px pine `#23483C` frame, no dimming of the 3D image (both views must stay readable).
- Captured FPS: frame turns teal `#3FB6A8` (meaning "mouse locked here"). Uncaptured FPS with focus: gold frame + small centre hint `Click to aim` (13 px, 70% parchment, fades after 2 s; tooltip-style, not modal).
- Chrome focus pill mirrors the same colour.
- In single mode, frames are not drawn (only one pane).

Keybinds deliberately avoid the Windows key, Alt+Tab and Ctrl+Esc. All bindings go through `InputMap` actions so they're rebindable:

| Action | Default |
|---|---|
| `view_focus_toggle` | Tab |
| `view_release_pointer` | Escape |
| `view_dual_toggle` | F9 |
| `view_mode_cycle` | Shift+F9 |
| `view_flip` | Ctrl+Shift+F |
| `view_ratio_left` / `_right` | Ctrl+Shift+Left / Right |
| `view_ratio_reset` | Ctrl+Shift+0 |
| `view_fullscreen` | F11 |

TAB conflict: if FPS uses TAB for inventory/scoreboard today, move that to `I`/hold-`Q` — TAB is owned by view focus while dual mode is active; in single mode TAB may keep its old meaning.

---

## 6. FPS HUD in a pane

- The FPS HUD is a `CanvasLayer`/Control **parented to the FPS pane rect**, not the window. Anchor crosshair to pane centre, health/ammo bottom-left of pane, compass top of pane (below chrome bar if the pane touches the window top: offset 28 + 6).
- HUD scale = UI scale × `clamp(pane_w / 1280, 0.8, 1.0)` so it stays legible at narrow panes; never below text 13 logical.
- When FPS is PiP inset: show only crosshair + health bar (compact HUD); hide compass/ammo text.

## 7. RTS command panel confined to RTS pane

- Bottom command panel is anchored to the **RTS pane**, full pane width minus 8 px margins each side, height **148** logical (Full). It never extends under the FPS pane.
- Three density tiers chosen by RTS pane width `w` (logical):
  - **Full** (w ≥ 900): portrait/selection 148x132 | command grid 5x3 of 40x40 buttons | minimap 132x132 bottom-right.
  - **Compact** (560 ≤ w < 900): height **104**; selection shows icon + count only (96 wide); command grid 5x2 of 36x36 with a `›` page button; minimap 96x96.
  - **Mini** (w < 560 or pane height < 360 — typical PiP): panel collapses to a **36 px** bar with the 5 most-used commands (32x32) and an **Expand ▴** button (tooltip "Show full commands"). Expand shows the Compact panel as an overlay inside the pane bounds (clipped); it auto-collapses when focus leaves RTS.
- User override on the panel's top-right: `▾`/`▴` toggle stored as `rts_panel_pref ∈ {auto, compact, full}`; `auto` default.
- Resource/top bar of the RTS: single 24 px row at top of RTS pane; in Mini hides labels, keeps icons+numbers.

## 8. Tiny-window fallback

Window logical width at scale 0.75 floor:
- **≥ 960x620** (supported minimum): everything works; split panes at 50/50 are each ~478 logical → RTS uses Mini/Compact appropriately. Chrome bar full width ~520 fits.
- **< 800 width or < 520 height**: chrome bar collapses to **icon form**: focus dot (20x20), mode button cycling Single/Inset/Split (24x20), ☰ (24x20) — ~ 100 wide. Ratio/flip move into ☰ menu.
- **Split cannot give both panes ≥ 320 logical** (window < 660 logical): split auto-falls back to **PiP** for display (setting still stored as `split`; restored when window grows). Show a one-time 13 px toast in chrome: "Window too narrow for side-by-side — showing inset."
- Set `get_window().min_size = Vector2i(640, 400)` physical.

## 9. Fullscreen (F11)

- F11 toggles `WINDOW_MODE_EXCLUSIVE_FULLSCREEN`? **No** — use `WINDOW_MODE_FULLSCREEN` (borderless), which alt-tabs cleanly and keeps capture logic simple. Store `fullscreen: bool`. Restore previous windowed size/position on exit.
- Layout ratios/rects are normalized so they survive the change without drift.

## 10. Settings schema (persisted)

File: `user://view_layout.cfg` (ConfigFile, section `[view]`). Save debounced 500 ms after last change and on quit. Unknown/invalid values → default, clamped.

```ini
[view]
version=1
dual_enabled=true            ; F9 state
mode="split"                 ; "pip" | "split"  (last used dual mode)
primary="fps"                ; pip: which view fills window  ("fps"|"rts")
split_left="fps"             ; split: which view is on the left
split_ratio=0.5              ; left pane fraction, clamp [0.25,0.75]
pip_rect=Rect2(0.735, 0.62, 0.25, 0.278) ; normalized x,y,w,h of inset
pip_snap=true
focus="fps"                  ; restored as focus but NEVER restored as captured
rts_panel_pref="auto"        ; "auto"|"compact"|"full"
chrome_autodim=true
ui_scale_override=0.0        ; 0 = automatic
fullscreen=false
windowed_rect=Rect2i(0,0,0,0) ; 0 size = OS default
```

Defaults on first run: dual enabled, `split`, FPS left, 0.50, focus fps, uncaptured (player clicks to aim — avoids grabbing the mouse at launch).

## 11. Palette reference (existing gold/pine/teal)

| Token | Hex | Use |
|---|---|---|
| gold | `#C9A24A` | focus frame, borders, divider line |
| gold_hi | `#E8C872` | hover |
| pine_900 | `#0B1410` | outer contrast line |
| pine_800 | `#14261F` | chrome bg (86% α) |
| pine_600 | `#23483C` | divider body, unfocused frame |
| teal | `#3FB6A8` | captured state, active selection |
| parchment | `#E9DDBF` | text |

Tooltips: 300 ms delay, pine_800 bg, 1 px gold 40%, 11 logical text, max width 280, never over the crosshair (place below/beside cursor, flipped at edges).

## 12. Implementation notes for root

- Node tree: `DualViewRoot (Control, full rect)` → `FpsPane (SubViewportContainer)` [Hero viewport], `RtsPane (SubViewportContainer)` [tactical SubViewport], `Divider (Control)`, `PipFrame (Control, drag/resize handles)`, `FocusFrames (Control, draw only, mouse_filter IGNORE)`, `ChromeBar (PanelContainer)`. Chrome and frames on a CanvasLayer above both panes.
- Gameplay input routing: a single `_unhandled_input` gate forwards events to the focused view only. `SubViewportContainer.mouse_filter` of the unfocused pane stays STOP so the first click is caught by the gate (focus change) instead of leaking.
- The consumed-click rule: handle in `_input` before the weapon's handler; mark `get_viewport().set_input_as_handled()` and set the suppress flag until `InputEventMouseButton.pressed == false`.
- `layout_rects(window_size, settings) -> {fps: Rect2, rts: Rect2, divider: Rect2}` should be a pure function (see `dual_view_layout.gd`) so tests can cover 960x620, 1920x1080, 3840x2160, tiny fallback, flip and clamps without a GPU.

## 13. Limits of this design

- Not verified in engine; no screenshots were captured. Sizes are reasoned, not measured on a 960x620 or 4K display.
- Assumes Hero view can render into a pane-sized viewport; if it's the root viewport with post-effects bound to window size, root must confirm re-parenting cost.
- Existing F9/TAB/ESC bindings were not read from `input/`; the compatibility choices in §2.3 and §5 must be checked against current handlers.
- VR/HMD path untouched.
