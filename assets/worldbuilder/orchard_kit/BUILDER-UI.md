# Builder window — UI layout and interaction spec (Godot 4)

This is a design spec only; no game code was edited. The builder is a second OS `Window` that shows the **live world camera** (a tactical view of the same `World3D`) for orchard world-building. The scene stays the primary content: UI chrome takes at most about 14 % of the height at 1280×800 and about 10 % at 1920×1080.

## 1. Node structure
```
BuilderWindow (Window, min_size 1024x640, title "Brann's Forge — Builder")
└─ Root (Control, full rect, mouse_filter PASS)
   ├─ WorldView (SubViewportContainer, stretch=true, full rect)
   │  └─ SubViewport (world_3d = main world, own_world_3d=false, msaa per quality tier)
   │     └─ TacticalCamera (Camera3D; orbit/pan/zoom rig; see §6)
   ├─ WorldOverlay (Control, full rect, mouse_filter IGNORE)   # ghost labels, cost tags projected from 3D
   ├─ TopBar (PanelContainer, anchored top, full width)
   ├─ ActionPalette (PanelContainer, anchored bottom-centre)
   ├─ ContextCard (PanelContainer, anchored bottom-right above palette, hidden by default)
   └─ Toasts (VBoxContainer, anchored top-right below TopBar)
```
- **Shared camera:** "sharing the live world camera" means the `SubViewport` renders the same `World3D`. The builder owns a `TacticalCamera` whose transform follows or offsets the Director camera state, driven through a shared `CameraRig` resource.
  - Toggle `Follow Director` (default on). Any manual orbit or pan turns it off; `F` turns it back on.
  - Never render the VR XR camera into this window.

## 2. Visual language (Director aesthetic)
| Token | Value | Use |
|---|---|---|
| `glass_bg` | `#0E1418` at 78 % opacity, 1 px border `#FFFFFF14`, corner radius 10 | All panels (a StyleBoxFlat; no blur shader required) |
| `glass_bg_hover` | `#16222A` at 86 % | Hovered buttons |
| `gold` | `#E3B25A` (text/icons), `#C9973F` (brass, matches the asset kit) | Primary values, selected tool, confirm |
| `teal` | `#43C6B8` | Valid preview, magic resource, info accents |
| `ember` | `#E0704A` | Invalid / blocked |
| `text` | `#EDE6D6`; secondary `#A9A396` | Body text |
| Font | Existing Director UI font; 14 px body / 12 px caption at 1280 w, 16/13 px at 1920 w | |

- **Scaling:** `content_scale_mode = CANVAS_ITEMS` with `content_scale_factor = clamp(window_height / 900, 0.9, 1.2)`. At 1280×800 this is 0.9 (minimum); at 1920×1080 it is 1.2.
- **Contrast:** all text reaches at least 4.5:1 against `glass_bg` over a bright scene, which is why the 78 % opacity floor is required.

## 3. Top bar (height 40 px @1280, 44 px @1920)
```
[◆ 128 Wood  +6/min] [✦ 42 Magic +2/min] │ ●3 Helpers busy  ▲1 idle │ Grove 2/5 · Route 14 m · Bridges 1 │  [Follow ⟲] [30|60] [⚙]
 left: resources           centre: settlement activity (flex, elides first)                      right: view controls
```
- **Resources:**
  - Each resource shows an icon, a value and a rate: gold for wood, teal for magic.
  - When a cost preview is active, the affected resource shows the pending spend inline as `128 → 108` in `gold`. If the player cannot afford it, it shows `ember` with a 2 px underline pulse (0.8 s, no flashing above 3 Hz).
- **Activity:**
  - Helper states come from the worker clips (chopping / walking / idle).
  - Clicking `▲1 idle` pans the camera to the idle helper, with `socket_overhead_icon` highlighted.
- **Responsive behaviour:**
  - Below 1280 w, the activity section drops the Grove, Route and Bridges counts first (they move into a tooltip), then the rate texts.
  - Resource values never elide.

## 4. Bottom action palette
Centred, width `min(620 px, 60 % of window width)`. Buttons are 56 px tall at 1280 and 64 px at 1920, with a 16 px margin from the bottom edge.
```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│ 🪓 Mark      │ ⟿ Carve      │ ⌒ Place      │ 🌳 Plant     │
│   Harvest  1 │   Route    2 │   Bridge   3 │   Grove    4 │
│   free       │   2 ✦ / m    │  40◆ 10✦     │  15◆ 5✦      │
└──────────────┴──────────────┴──────────────┴──────────────┘
```
- **Each button** has an icon (24 px), a label, the shortcut digit (caption, top-right) and a cost line.
  - The cost line turns `ember` when the action is unaffordable. The button stays clickable so the player can see why it fails.
- **Button states:**

  | State | Look |
  |---|---|
  | Normal | glass |
  | Hover | `glass_bg_hover`, 1 px `gold` top border, tooltip after 400 ms with a one-line description and shortcut |
  | Active tool | filled `#E3B25A` at 22 %, 2 px gold border, label in gold |
  | Disabled (locked by progression) | 40 % opacity with a lock glyph; tooltip gives the unlock condition |

- **Context card** (bottom-right, 280 px wide, visible while a tool is active):
  - Tool name, a live readout (e.g. "Route 6.4 m · 13 ✦"), and two key hints: `LMB place · RMB/Esc cancel`.
  - It never covers the palette or the centre 60 % of the view.

## 5. Tool previews, cost and invalid states (in-world)
Ghosts are drawn with an **opaque unshaded material using a dither pattern**, not alpha blending, to stay cheap and sort correctly. Valid previews use a `teal` fresnel rim and invalid ones use `ember`. Every preview has a 2D cost tag (a `WorldOverlay` Label) projected 0.3 m above the anchor.

| Tool | Hover (no click) | Preview (after 1st click / drag) | Valid | Invalid (reason shown in tag) |
|---|---|---|---|---|
| Mark Harvest | Tree under cursor gets a gold outline and its wood yield `+12◆` | Click toggles the mark: an axe icon at the tree top. Drag box-selects trees | Nearest `Stockpile.socket_worker_chop_stand` is reachable (path line drawn in teal, dashed) | "No stockpile in range", "Young tree" |
| Carve Route | Ground ring at the cursor with a waymarker ghost (`waymarker.glb`) | Click places waymarkers; a spline follows the cursor. Each segment shows its length, and the running total cost is on the card | Slope ≤ 25°, no overlap with colliders, the 2 m corridor ribbon shown in teal | Segment turns ember: "Too steep", "Blocked", "Not enough ✦" |
| Place Bridge | The bridge ghost snaps between two route ends or across the water gap; its length is shown | `Q`/`E` or the mouse wheel with `Shift` rotates in 15° steps | Both abutments are on ground and the span is within the bridge length range | "Span too long", "Abutment in water" |
| Plant Grove | A circle brush (r = 3 m) with sapling ghost dots | `[`/`]` resize (2–6 m); click plants | Soil tiles show a teal dot | Dots over paths or stockpiles turn ember and are skipped; the cost counts only valid dots |

- **Commit:** a gold pulse at the anchor, resources animate down over 0.3 s, and a toast appears ("Route carved · 14 m").
- **Failed commit:** a single 120 ms ember shake of the cost tag and an error toast. Nothing is spent.

## 6. Input
| Input | Action |
|---|---|
| `1`–`4` | Select tool (press again to deselect) |
| LMB | Use the tool (place / mark / add route point) |
| LMB drag | Box-select for Mark Harvest; brush paint for Plant Grove |
| RMB / `Esc` | Cancel the preview, then deselect the tool, then close any popup (in that order) |
| `Enter` / double-click | Finish the route |
| `Backspace` | Remove the last route point |
| `Q` / `E`, `Shift`+wheel | Rotate the ghost 15° |
| `[` / `]` | Brush radius |
| MMB drag / `Alt`+LMB | Orbit the camera |
| RMB drag (no tool active) or `W A S D` | Pan (the speed scales with zoom) |
| Wheel | Zoom (distance 6–60 m, pitch 35–75° linked to zoom) |
| `F` | Re-follow the Director camera |
| `Tab` | Cycle idle helpers |
| `Ctrl+Z` | Undo the last builder commit (if supported by game state) |
| `F1` | Shortcut overlay |

- **Keyboard focus:** it stays in the `BuilderWindow`. The builder must not steal VR input; handle `_unhandled_input` per `Window`.
- **Rebinding:** all shortcuts are listed in `InputMap` actions prefixed `builder_`, so they can be rebound.

## 7. Render quality tiers (builder viewport only)
The VR headset frame budget has priority. The builder `SubViewport` is a secondary cost.

| Setting | **Tactical 30** (default) | **Tactical 60** |
|---|---|---|
| Update | `SubViewport.render_target_update_mode = UPDATE_ALWAYS`, throttled by skipping alternate frames (update when `Engine.get_frames_drawn() % 2 == 0` on a 60/72/90 Hz VR loop, which gives about 30–45 fps) | Every frame |
| Resolution | `scaling_3d_mode = FSR` (FSR1), `scaling_3d_scale = 0.67` | FSR, scale 0.85 |
| MSAA | Off (FXAA on) | 2× |
| Shadows | Directional only, 1 cascade, 2048 atlas, max distance 40 m | 2 cascades, 60 m |
| SSAO / SSIL / SSR / glow / volumetric fog | Off | SSAO half-res on; the rest off |
| LOD threshold | `mesh_lod_threshold = 4.0` | 1.0 |
| Visibility | The builder camera's cull mask hides the VR-only layers (hands, HUD) and far detail props | Same |

- **Toggle:** the `30|60` switch in the top bar changes tiers.
- **Automatic fallback:** the builder drops to Tactical 30 when the VR frame time exceeds 90 % of its budget for 2 s. It shows a teal toast, "Builder view reduced to keep VR smooth".
- **Minimised window:** `render_target_update_mode = UPDATE_DISABLED`.

## 8. Layout checks
| | 1280×800 (scale 0.9) | 1920×1080 (scale 1.2) |
|---|---|---|
| Top bar | 36 px (4.5 %) | 53 px (4.9 %) |
| Palette + margin | 64 px (8 %) | 91 px (8.4 %) |
| Clear scene | about 87 % of the height; the centre 60 % × 70 % is always free of chrome | about 87 % |
| Context card | 252 px wide, right-aligned, bottom 76 px | 336 px |

Test each tier and resolution with a bright meadow scene and a dark dusk scene. Text contrast, the ember/teal distinction and the invalid states must be readable in both. Invalid states must never rely on colour alone: they also use the icon (⛔), the reason text and the shake.
