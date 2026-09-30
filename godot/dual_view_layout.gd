class_name DualViewLayout
extends RefCounted
## Pure layout math for DUAL-VIEW-DESIGN.md. No nodes, no GPU; unit-testable.
## All inputs/outputs are in physical window pixels; logical sizes are scaled by ui_scale().

const REF := Vector2(1920.0, 1080.0)
const RATIO_MIN := 0.25
const RATIO_MAX := 0.75
const RATIO_PRESETS := [0.4, 0.5, 0.6]
const RATIO_SNAP := 0.015
const DIVIDER_W := 4.0
const DIVIDER_HIT := 12.0
const PANE_MIN_W := 320.0
const PIP_MIN := Vector2(240.0, 150.0)
const PIP_MAX_FRAC := 0.7
const PIP_MARGIN := 16.0
const PIP_SNAP := 24.0
const CHROME_H := 28.0

const DEFAULTS := {
	"version": 1,
	"dual_enabled": true,
	"mode": "split",
	"primary": "fps",
	"split_left": "fps",
	"split_ratio": 0.5,
	"pip_rect": Rect2(0.735, 0.62, 0.25, 0.278),
	"pip_snap": true,
	"focus": "fps",
	"rts_panel_pref": "auto",
	"chrome_autodim": true,
	"ui_scale_override": 0.0,
	"fullscreen": false,
}


static func ui_scale(win: Vector2, override_scale := 0.0) -> float:
	if override_scale > 0.0:
		return clampf(override_scale, 0.75, 2.0)
	var s := minf(win.x / REF.x, win.y / REF.y)
	return snappedf(clampf(s, 0.75, 2.0), 0.05)


static func clamp_ratio(ratio: float, win: Vector2, scale: float) -> float:
	var usable := win.x - DIVIDER_W * scale
	var min_frac := maxf(RATIO_MIN, PANE_MIN_W * scale / maxf(usable, 1.0))
	return clampf(ratio, min_frac, 1.0 - min_frac) if min_frac < 0.5 else 0.5


static func snap_ratio(ratio: float, disable_snap := false) -> float:
	if not disable_snap:
		for p in RATIO_PRESETS:
			if absf(ratio - p) <= RATIO_SNAP:
				return p
	return ratio


static func split_fits(win: Vector2, scale: float) -> bool:
	return win.x - DIVIDER_W * scale >= 2.0 * PANE_MIN_W * scale


## Returns the display mode actually used (split falls back to pip when too narrow).
static func effective_mode(settings: Dictionary, win: Vector2) -> String:
	if not settings.get("dual_enabled", true):
		return "single"
	var mode: String = settings.get("mode", "split")
	if mode == "split" and not split_fits(win, ui_scale(win, settings.get("ui_scale_override", 0.0))):
		return "pip"
	return mode


## { mode, fps: Rect2, rts: Rect2, divider: Rect2, divider_hit: Rect2 } — Rect2() when absent.
static func layout_rects(win: Vector2, settings: Dictionary) -> Dictionary:
	var scale := ui_scale(win, settings.get("ui_scale_override", 0.0))
	var mode := effective_mode(settings, win)
	var full := Rect2(Vector2.ZERO, win)
	var out := {"mode": mode, "fps": Rect2(), "rts": Rect2(), "divider": Rect2(), "divider_hit": Rect2(), "scale": scale}
	match mode:
		"single":
			out[settings.get("primary", "fps")] = full
		"split":
			var dw := roundf(DIVIDER_W * scale)
			var ratio := clamp_ratio(settings.get("split_ratio", 0.5), win, scale)
			var left_w := roundf((win.x - dw) * ratio)
			var left := Rect2(0, 0, left_w, win.y)
			var right := Rect2(left_w + dw, 0, win.x - left_w - dw, win.y)
			var left_view: String = settings.get("split_left", "fps")
			out[left_view] = left
			out["rts" if left_view == "fps" else "fps"] = right
			out["divider"] = Rect2(left_w, 0, dw, win.y)
			var hit := DIVIDER_HIT * scale
			out["divider_hit"] = Rect2(left_w + dw * 0.5 - hit * 0.5, 0, hit, win.y)
		"pip":
			var primary: String = settings.get("primary", "fps")
			out[primary] = full
			out["rts" if primary == "fps" else "fps"] = pip_to_pixels(settings.get("pip_rect", DEFAULTS.pip_rect), win, scale)
	return out


static func pip_to_pixels(norm: Rect2, win: Vector2, scale: float) -> Rect2:
	var size := (norm.size * win).clamp(PIP_MIN * scale, win * PIP_MAX_FRAC)
	var m := PIP_MARGIN * scale
	var pos := (norm.position * win).clamp(Vector2(m, m + CHROME_H * scale), win - size - Vector2(m, m))
	return Rect2(pos.round(), size.round())


static func pip_from_pixels(rect: Rect2, win: Vector2) -> Rect2:
	return Rect2(rect.position / win, rect.size / win)


## Snap a dragged PiP rect to window margins (skip when Alt held).
static func snap_pip(rect: Rect2, win: Vector2, scale: float) -> Rect2:
	var m := PIP_MARGIN * scale
	var s := PIP_SNAP * scale
	var r := rect
	if r.position.x < m + s: r.position.x = m
	if win.x - r.end.x < m + s: r.position.x = win.x - m - r.size.x
	if r.position.y < m + s: r.position.y = m
	if win.y - r.end.y < m + s: r.position.y = win.y - m - r.size.y
	return r


## Flip sides; mirror the ratio so each view keeps its width.
static func flipped(settings: Dictionary) -> Dictionary:
	var s := settings.duplicate()
	s.split_left = "rts" if s.get("split_left", "fps") == "fps" else "fps"
	s.split_ratio = 1.0 - float(s.get("split_ratio", 0.5))
	return s


## RTS command panel density tier from RTS pane logical size.
static func rts_panel_tier(pane: Rect2, scale: float, pref := "auto") -> String:
	if pref != "auto":
		return pref
	var w := pane.size.x / scale
	var h := pane.size.y / scale
	if w < 560.0 or h < 360.0:
		return "mini"
	return "compact" if w < 900.0 else "full"


## Viewport render size for a pane: 1:1 physical pixels, never shrunk.
static func viewport_size(pane: Rect2) -> Vector2i:
	return Vector2i(maxi(64, roundi(pane.size.x)), maxi(64, roundi(pane.size.y)))


static func sanitize(raw: Dictionary) -> Dictionary:
	var s := DEFAULTS.duplicate()
	for k in raw:
		if s.has(k) and typeof(raw[k]) == typeof(s[k]):
			s[k] = raw[k]
	if s.mode not in ["pip", "split"]: s.mode = DEFAULTS.mode
	if s.primary not in ["fps", "rts"]: s.primary = "fps"
	if s.split_left not in ["fps", "rts"]: s.split_left = "fps"
	if s.focus not in ["fps", "rts"]: s.focus = "fps"
	if s.rts_panel_pref not in ["auto", "compact", "full"]: s.rts_panel_pref = "auto"
	s.split_ratio = clampf(s.split_ratio, RATIO_MIN, RATIO_MAX)
	return s
