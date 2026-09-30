extends Control
class_name WorldBuilderCommandPanel
## Brann's Forge RTS command panel. One Control draws frame, tabs, 3x3 cards, info
## plaque and tooltip in _draw(): no per-card nodes. Full-rect overlay; only the panel
## silhouette accepts mouse input (see _has_point), so the world stays clickable.
## Two small children serve the Mana orb: a shader ColorRect (Tidal Glass liquid) and a
## transparent overlay Control drawn above it (rim, numerals, cost badge) so the shader
## can never cover the numbers. Both ignore the mouse.

const Sym := preload("res://ui_symbols.gd")
const ORB_SHADER := "res://mana_orb.gdshader"

signal spell_selected(id: String)
signal palette_selected(id: String)
signal regen_preset_selected(multiplier: float)
signal cancel_targeting()

const PALETTES: Array[Dictionary] = [
	{"id": "land", "title": "Land", "key": "F1", "hue": Color(0.86, 0.58, 0.30)},
	{"id": "life", "title": "Life", "key": "F2", "hue": Color(0.42, 0.80, 0.46)},
	{"id": "construction", "title": "Construction", "key": "F3", "hue": Color(0.80, 0.68, 0.44)},
	{"id": "encounters", "title": "Encounters", "key": "F4", "hue": Color(0.72, 0.46, 0.92)},
]
const DEFAULT_ORDER := {
	"land": ["path", "sunder", "raise", "wall", "meteor", "fault"],
	"life": ["grove", "forest", "ring", "awaken"],
	"construction": ["bridge", "ramp", "stairs", "boardwalk", "outpost", "tower", "platform", "gate", "barricade"],
	"encounters": ["patrol", "golem"],
}
const REGEN_PRESETS := [{"label": "4x", "mult": 4.0, "hint": "Testing"}, {"label": "1x", "mult": 1.0, "hint": "Normal"}]

# Palette -------------------------------------------------------------------
const C_WOOD_DEEP := Color(0.085, 0.060, 0.045, 0.97)
const C_WOOD := Color(0.17, 0.115, 0.075)
const C_BRASS := Color(0.80, 0.63, 0.34)
const C_BRASS_DIM := Color(0.46, 0.34, 0.18)
const C_BRASS_HI := Color(1.0, 0.86, 0.55)
const C_SLATE := Color(0.055, 0.085, 0.095, 0.96)
const C_TEAL := Color(0.26, 0.86, 0.82)
const C_MANA_ICON := Color(0.66, 0.58, 1.0)
const C_TEXT := Color(0.94, 0.90, 0.82)
const C_TEXT_DIM := Color(0.68, 0.64, 0.56)
const C_WARN := Color(0.98, 0.46, 0.36)
const C_PARCH := Color(0.92, 0.85, 0.69, 0.98)
const C_INK := Color(0.19, 0.13, 0.08)
const C_INK_WARN := Color(0.62, 0.14, 0.08)

# Layout (base pixels at scale 1; multiplied by _s). Full: 1080p-class. Compact: <=1100x680.
const BASE_W := 908.0
const BASE_H := 280.0
const CARD_W := 124.0
const CARD_H := 68.0
const CARD_GAP := 5.0
const MIN_SCALE := 0.88
const MAX_SCALE := 2.4
const C_BASE_W := 734.0
const C_BASE_H := 192.0
const C_CARD_W := 112.0
const C_CARD_H := 46.0
const C_CARD_GAP := 4.0
const C_MIN_SCALE := 0.90
const MIN_FONT := 10

var _catalogue: Dictionary = {}          # id -> normalized entry (incl. implemented flag)
var _by_palette: Dictionary = {}         # palette id -> Array[String] (max 9)
var _state: Dictionary = {}
var _palette := "land"
var _selected := ""
var _hover := ""                         # "card:<id>", "tab:<pal>", "regen:<i>", "orb"
var _compact := false

var _atlas: Texture2D
var _atlas_cols := 1
var _atlas_rows := 1
var _atlas_idx: Dictionary = {}

var _s := 1.0
var _panel := Rect2()
var _orb_c := Vector2.ZERO
var _orb_r := 0.0
var _info := Rect2()
var _tabs: Array[Rect2] = []
var _cards: Array[Rect2] = []
var _regen: Array[Rect2] = []
var _tab_fs := 12
var _font: Font
var _sb_card: StyleBoxFlat
var _sb_plaque: StyleBoxFlat
var _sb_tab: StyleBoxFlat
var _sb_parch: StyleBoxFlat
var _fit_cache: Dictionary = {}

# Mana orb
var _orb_rect: ColorRect
var _orb_overlay: Control
var _orb_mat: ShaderMaterial
var _fill := 0.0                         # displayed (smoothed) fill
var _fill_target := 0.0
var _fill_init := false
var _prev_mana := -1.0
var _prev_max := -1.0
var _gain_pulse := 0.0
var _spend_pulse := 0.0
var _last_uniform_fill := -1.0


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	focus_mode = Control.FOCUS_NONE
	_font = ThemeDB.fallback_font
	_build_orb_nodes()
	resized.connect(func() -> void: layout_for_size(size))
	layout_for_size(size)


func _process(delta: float) -> void:
	if not is_visible_in_tree():
		return
	var moved := false
	if absf(_fill_target - _fill) > 0.0004:
		_fill += (_fill_target - _fill) * (1.0 - exp(-5.0 * delta))
		moved = true
	elif _fill != _fill_target:
		_fill = _fill_target
		moved = true
	if _gain_pulse > 0.0:
		_gain_pulse = maxf(_gain_pulse - delta / 1.1, 0.0)
		moved = true
	if _spend_pulse > 0.0:
		_spend_pulse = maxf(_spend_pulse - delta / 0.7, 0.0)
		moved = true
	if moved:
		_push_orb_uniforms()


# ---------------------------------------------------------------- public API

func setup(catalogue: Array) -> void:
	_catalogue.clear()
	_by_palette.clear()
	_fit_cache.clear()
	for p in PALETTES:
		_by_palette[p.id] = []
	for raw in catalogue:
		if typeof(raw) != TYPE_DICTIONARY or str(raw.get("id", "")) == "":
			continue
		var id := str(raw.id)
		var pal := str(raw.get("palette", _default_palette(id))).to_lower()
		if not _by_palette.has(pal):
			pal = _default_palette(id)
		var e := {
			"id": id,
			"title": str(raw.get("title", id.capitalize())),
			"palette": pal,
			"description": str(raw.get("description", "")),
			"gesture": str(raw.get("gesture", "")),
			"mana": float(raw.get("mana", 0.0)),
			"lumber": float(raw.get("lumber", raw.get("wood", 0.0))),
			"cost": str(raw.get("cost", "")),
			"cooldown": float(raw.get("cooldown", 0.0)),
			"icon": raw.get("icon", null),
			"implemented": bool(raw.get("implemented", true)),   # grey cards must stay unselectable
		}
		_catalogue[id] = e
		if (_by_palette[pal] as Array).size() < 9:
			(_by_palette[pal] as Array).append(id)
	queue_redraw()
	_orb_redraw()


func update_state(state: Dictionary) -> void:
	_state = state
	if state.has("selected"):
		_selected = str(state.selected)
	if state.has("palette") and _by_palette.has(str(state.palette)):
		_palette = str(state.palette)
	_track_mana()
	queue_redraw()
	_orb_redraw()


func set_icon_atlas(texture: Texture2D, columns: int, rows: int, indices: Dictionary) -> void:
	_atlas = texture
	_atlas_cols = maxi(columns, 1)
	_atlas_rows = maxi(rows, 1)
	_atlas_idx = indices
	queue_redraw()


func is_over_panel(pos: Vector2) -> bool:
	if not is_visible_in_tree():
		return false
	var local := pos - global_position
	return _panel.has_point(local) or local.distance_to(_orb_c) <= _orb_r + 10.0 * _s


func handle_shortcut(event: InputEventKey) -> bool:
	if event == null or not event.pressed or event.echo:
		return false
	var k := event.keycode
	if k == KEY_ESCAPE:
		cancel_targeting.emit()
		return true
	if k >= KEY_F1 and k <= KEY_F4:
		_choose_palette(PALETTES[k - KEY_F1].id)
		return true
	var n := -1
	if k >= KEY_1 and k <= KEY_9:
		n = k - KEY_1
	elif k >= KEY_KP_1 and k <= KEY_KP_9:
		n = k - KEY_KP_1
	if n >= 0:
		var ids: Array = _by_palette.get(_palette, [])
		if n < ids.size():
			_choose_spell(str(ids[n]))
		return true  # consume digit even on empty slot so it never leaks to world
	return false


func bottom_extent() -> float:
	## Pixels covered from the bottom of this Control (viewport space, native res).
	return size.y - _panel.position.y


func layout_for_size(sz: Vector2) -> void:
	if _font == null:
		_font = ThemeDB.fallback_font
	_compact = sz.y < 680.0 or sz.x < 1100.0
	var bw := C_BASE_W if _compact else BASE_W
	var bh := C_BASE_H if _compact else BASE_H
	var s := minf(sz.y / (720.0 if _compact else 1080.0), sz.x * 0.97 / bw)
	s = clampf(s, C_MIN_SCALE if _compact else MIN_SCALE, MAX_SCALE)
	s = minf(s, (sz.x - 8.0) / bw)          # never wider than the viewport
	s = minf(s, sz.y * 0.46 / bh)           # never taller than 46% of it
	_s = maxf(s, 0.4)
	var w := roundf(bw * _s)
	var h := roundf(bh * _s)
	_panel = Rect2(roundf((sz.x - w) * 0.5), sz.y - h, w, h)
	var o := _panel.position
	_regen.clear()
	_tabs.clear()
	_cards.clear()
	var tab_x := 0.0
	var tab_w := 0.0
	var tab_y := 0.0
	var tab_h := 0.0
	var grid := Vector2.ZERO
	var cell := Vector2.ZERO
	var gap := 0.0
	if _compact:
		_orb_c = o + Vector2(66, 66) * _s
		_orb_r = 50.0 * _s
		for i in 2:
			_regen.append(_r(o, 12 + i * 56, 140, 52, 22))
		_info = _r(o, 130, 8, 244, 176)
		tab_x = 382; tab_y = 8; tab_w = 344; tab_h = 24
		grid = Vector2(382, 38)
		cell = Vector2(C_CARD_W, C_CARD_H)
		gap = C_CARD_GAP
	else:
		_orb_c = o + Vector2(94, 100) * _s
		_orb_r = 74.0 * _s
		for i in 2:
			_regen.append(_r(o, 20 + i * 78, 198, 72, 26))
		_info = _r(o, 184, 12, 316, 232)
		tab_x = 512; tab_y = 12; tab_w = 382; tab_h = 28
		grid = Vector2(512, 47)
		cell = Vector2(CARD_W, CARD_H)
		gap = CARD_GAP
	_layout_tabs(o, tab_x, tab_y, tab_w, tab_h)
	for i in 9:
		_cards.append(_r(o, grid.x + (i % 3) * (cell.x + gap), grid.y + (i / 3) * (cell.y + gap), cell.x, cell.y))
	_build_styles()
	_place_orb_nodes()
	queue_redraw()
	_orb_redraw()


func _layout_tabs(o: Vector2, x: float, y: float, w: float, h: float) -> void:
	## Tab widths follow measured text (icon + label + padding); spare width is shared out equally.
	var gap := 4.0
	var fs := _fs(12.5 if not _compact else 12.0)
	var widths: Array[float] = []
	while true:
		widths.clear()
		var total := gap * (PALETTES.size() - 1)
		for p in PALETTES:
			var tw := _font.get_string_size(str(p.title), HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x / _s
			var cw := (6.0 + 13.0 + 4.0 + 6.0 if _compact else 10.0 + 15.0 + 6.0 + 10.0) + tw
			widths.append(cw)
			total += cw
		if total <= w or fs <= MIN_FONT:
			var extra := maxf(w - total, 0.0) / PALETTES.size()
			for i in widths.size():
				widths[i] += extra
			break
		fs -= 1
	_tab_fs = fs
	var cx := x
	for i in PALETTES.size():
		_tabs.append(_r(o, cx, y, widths[i], h))
		cx += widths[i] + gap


# ------------------------------------------------------------------- input

func _has_point(point: Vector2) -> bool:
	return is_over_panel(point + global_position)


func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion:
		var h := _hit((event as InputEventMouseMotion).position)
		if h != _hover:
			_hover = h
			queue_redraw()
	elif event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.pressed and mb.button_index == MOUSE_BUTTON_LEFT:
			var h := _hit(mb.position)
			if h.begins_with("card:"):
				_choose_spell(h.substr(5))
			elif h.begins_with("tab:"):
				_choose_palette(h.substr(4))
			elif h.begins_with("regen:"):
				regen_preset_selected.emit(float(REGEN_PRESETS[int(h.substr(6))].mult))
		accept_event()  # clicks on the panel never reach the world


func _notification(what: int) -> void:
	if what == NOTIFICATION_MOUSE_EXIT and _hover != "":
		_hover = ""
		queue_redraw()


func _hit(p: Vector2) -> String:
	var ids: Array = _by_palette.get(_palette, [])
	for i in _cards.size():
		if _cards[i].has_point(p) and i < ids.size():
			return "card:" + str(ids[i])
	for i in _tabs.size():
		if _tabs[i].has_point(p):
			return "tab:" + str(PALETTES[i].id)
	for i in _regen.size():
		if _regen[i].has_point(p):
			return "regen:%d" % i
	if p.distance_to(_orb_c) <= _orb_r:
		return "orb"
	return ""


func _choose_spell(id: String) -> void:
	var e: Dictionary = _catalogue.get(id, {})
	if bool(e.get("implemented", true)):
		_selected = id  # optimistic; update_state is authoritative. Grey cards never self-select.
	spell_selected.emit(id)
	queue_redraw()
	_orb_redraw()


func _choose_palette(id: String) -> void:
	_palette = id
	palette_selected.emit(id)
	queue_redraw()


# -------------------------------------------------------------------- draw

func _draw() -> void:
	if _font == null:
		return
	_draw_frame()
	_draw_orb_bezel()
	_draw_regen()
	_draw_info()
	_draw_tabs()
	_draw_cards()
	_draw_tooltip()


func _draw_frame() -> void:
	var p := _panel
	var c := 22.0 * _s
	var poly := PackedVector2Array([
		p.position + Vector2(0, c), p.position + Vector2(c, 0),
		Vector2(p.end.x - c, p.position.y), Vector2(p.end.x, p.position.y + c),
		p.end, Vector2(p.position.x, p.end.y)])
	# soft shadow lip above the panel so it lifts off the world
	draw_rect(Rect2(p.position.x + c, p.position.y - 6 * _s, p.size.x - 2 * c, 6 * _s), Color(0, 0, 0, 0.25))
	draw_colored_polygon(poly, C_WOOD_DEEP)
	for i in 5:   # wood grain bands, very faint
		var y := p.position.y + (0.25 + i * 0.17) * p.size.y
		draw_line(Vector2(p.position.x + 8 * _s, y), Vector2(p.end.x - 8 * _s, y + 3 * _s), Color(C_WOOD, 0.35), 1.0 * _s)
	var edge := poly.duplicate()
	edge.append(poly[0])
	draw_polyline(edge, C_BRASS_DIM, 3.0 * _s, true)
	draw_polyline(PackedVector2Array([poly[0], poly[1], poly[2], poly[3]]), C_BRASS, 1.5 * _s, true)
	for q in [poly[1], poly[2]]:   # brass rivets at chamfers
		draw_circle(q + Vector2(0, 6 * _s), 2.5 * _s, C_BRASS_HI)
	# column dividers: orb | info | palette
	var d1 := _info.position.x - 6 * _s
	var d2 := _tabs[0].position.x - 6 * _s
	for dx in [d1, d2]:
		draw_line(Vector2(dx, p.position.y + 16 * _s), Vector2(dx, p.end.y - 12 * _s), C_BRASS_DIM, 1.0 * _s)


func _draw_orb_bezel() -> void:
	## Brass bezel and dark backing; the shader child paints the glass over the inside.
	var c := _orb_c
	var r := _orb_r
	draw_circle(c, r + 9 * _s, Color(0.05, 0.035, 0.025))
	draw_circle(c, r, Color(0.02, 0.022, 0.05))
	draw_arc(c, r + 5 * _s, 0, TAU, 96, C_BRASS_DIM, 8 * _s, true)
	draw_arc(c, r + 8 * _s, PI * 1.05, PI * 1.95, 48, C_BRASS, 1.6 * _s, true)
	draw_arc(c, r + 2.2 * _s, PI * 0.05, PI * 0.95, 48, Color(C_BRASS_HI, 0.55), 1.2 * _s, true)
	for i in 4:   # cardinal finials
		var a := TAU * i / 4.0 - PI * 0.5
		var d := Vector2(cos(a), sin(a))
		var n := Vector2(-d.y, d.x)
		var b := c + d * (r + 6 * _s)
		draw_colored_polygon(PackedVector2Array([b + d * 9 * _s, b + n * 4.5 * _s, b - d * 2 * _s, b - n * 4.5 * _s]), C_BRASS)
		draw_polyline(PackedVector2Array([b + d * 9 * _s, b + n * 4.5 * _s, b - d * 2 * _s, b - n * 4.5 * _s, b + d * 9 * _s]), C_BRASS_HI, 1.0 * _s)
	for i in 4:   # studs between finials
		var a2 := TAU * i / 4.0 - PI * 0.25
		draw_circle(c + Vector2(cos(a2), sin(a2)) * (r + 5.5 * _s), 1.8 * _s, C_BRASS_HI)


func _draw_regen() -> void:
	var cur := float(_state.get("regen", _state.get("regen_multiplier", 1.0)))
	for i in _regen.size():
		var rr := _regen[i]
		var on := is_equal_approx(cur, float(REGEN_PRESETS[i].mult))
		var hov := _hover == "regen:%d" % i
		_sb_tab.bg_color = Color(0.10, 0.22, 0.24) if on else Color(0.07, 0.06, 0.05)
		_sb_tab.border_color = C_TEAL if on else (C_BRASS if hov else C_BRASS_DIM)
		draw_style_box(_sb_tab, rr)
		var lbl := str(REGEN_PRESETS[i].label) if _compact else "%s %s" % [REGEN_PRESETS[i].hint, REGEN_PRESETS[i].label]
		var fs := _fs(11.5)
		_text_c(rr, lbl, fs, C_TEXT if on else C_TEXT_DIM)


func _draw_info() -> void:
	var r := _info
	draw_style_box(_sb_plaque, r)
	var pad := (11.0 if _compact else 15.0) * _s
	var x := r.position.x + pad
	var w := r.size.x - 2.0 * pad
	var y := r.position.y + pad * 0.75
	var f_head := _fs(11.5)
	var f_title := _fs(16.0 if _compact else 19.0)
	var f_row := _fs(12.0 if _compact else 13.0)
	var pal := _pal_def(_palette)
	# heading
	y += _txt(x, y, "ABILITY INFO", f_head, C_BRASS)
	_txt(x, y - _font.get_height(f_head), "%s  %s" % [str(pal.title).to_upper(), pal.key], f_head, Color(pal.hue, 0.95), w, HORIZONTAL_ALIGNMENT_RIGHT)
	y += 3 * _s
	draw_line(Vector2(x, y), Vector2(x + w, y), Color(C_BRASS_DIM, 0.75), 1.0 * _s)
	y += (5 if _compact else 8) * _s
	# footer strip geometry (reserve first so body text can never run into it)
	var f_foot := _fs(12.0)
	var foot_h := _font.get_height(f_foot)
	var foot_y := r.end.y - pad * 0.75 - foot_h
	var limit := foot_y - 8 * _s
	# title + rows
	var e := _sel_entry()
	if e.is_empty():
		y += _txt(x, y, "Choose an ability", f_title, C_TEXT_DIM) + 4 * _s
		y += _lines(x, y, "1-9 select  ·  F1-F4 categories  ·  Esc cancel", w, f_row, C_TEXT_DIM, 3)
	else:
		var t := _fit(str(e.title), w, f_title, 2, f_title - 3)
		y += _draw_fit(x, y, t, C_TEXT) + (3 if _compact else 6) * _s
		var mana := float(_state.get("mana", 0.0))
		var poor := float(e.mana) > mana + 0.001
		var mtxt := str(e.cost) if str(e.cost) != "" else ("Mana %d" % int(e.mana) if float(e.mana) > 0.0 else "No mana cost")
		y += _row("mana", mtxt, x, y, w, f_row, C_WARN if poor else C_TEXT, C_MANA_ICON)
		var cd := float(e.cooldown)
		y += _row("clock", "Cooldown %s s" % _num(cd) if cd > 0.0 else "No cooldown", x, y, w, f_row, C_TEXT if cd > 0.0 else C_TEXT_DIM, C_BRASS)
		if str(e.gesture) != "":
			y += _row(Sym.gesture_kind(str(e.gesture)), str(e.gesture), x, y, w, f_row, C_TEXT, C_TEAL)
		if float(e.lumber) > 0.0 and str(e.cost) == "" and y + _font.get_height(f_row) < limit:
			y += _row("log", "Lumber %d" % int(e.lumber), x, y, w, f_row, C_TEXT, Color(0.78, 0.55, 0.32))
		var reason := _reason(str(e.id))
		if reason != "" and y + _font.get_height(f_row) <= limit:
			var rt := _fit(reason, w, f_row, 2 if y + _font.get_height(f_row) * 2 <= limit else 1, f_row - 1)
			y += _draw_fit(x, y + 2 * _s, rt, C_WARN) + 4 * _s
	var fb := str(_state.get("feedback", ""))
	if fb != "" and y + _font.get_height(f_head) <= limit:
		var ft := _fit(fb, w, f_head, 2 if y + _font.get_height(f_head) * 2 <= limit else 1, f_head - 1)
		_draw_fit(x, y, ft, Color(C_TEXT, 0.80))
	# resource strip: Lumber (log) + Helpers (worker)
	draw_line(Vector2(x, foot_y - 5 * _s), Vector2(x + w, foot_y - 5 * _s), Color(C_BRASS_DIM, 0.6), 1.0 * _s)
	var isz := foot_h * 0.95
	var rx := x
	Sym.draw(self, "log", Rect2(rx, foot_y + (foot_h - isz) * 0.5, isz, isz), Color(0.78, 0.55, 0.32), 1.2 * _s)
	var lt := "Lumber %d" % int(_state.get("wood", 0))
	_txt(rx + isz + 6 * _s, foot_y, lt, f_foot, C_TEXT)
	if _state.has("helpers"):
		rx = x + w * 0.5
		Sym.draw(self, "worker", Rect2(rx, foot_y + (foot_h - isz) * 0.5, isz, isz), C_TEAL, 1.2 * _s)
		_txt(rx + isz + 6 * _s, foot_y, "Helpers %s" % str(_state.helpers), f_foot, C_TEXT)


func _row(kind: String, text: String, x: float, y: float, w: float, fs: int, col: Color, icol: Color) -> float:
	var lh := _font.get_height(fs)
	var isz := lh * 0.95
	var t := _fit(text, w - isz - 8 * _s, fs, 2, fs - 1)
	var th := lh * (t.lines as Array).size()
	var rh := maxf(th, isz)
	Sym.draw(self, kind, Rect2(x, y + (lh - isz) * 0.5 + 1 * _s, isz, isz), icol, 1.4 * _s)
	_draw_fit(x + isz + 8 * _s, y, t, col)
	return rh + (2 if _compact else 4) * _s


func _draw_tabs() -> void:
	for i in PALETTES.size():
		var p: Dictionary = PALETTES[i]
		var r := _tabs[i]
		var on := str(p.id) == _palette
		var hov := _hover == "tab:" + str(p.id)
		_sb_tab.bg_color = Color(p.hue.darkened(0.70), 1.0) if on else Color(0.075, 0.058, 0.046)
		_sb_tab.border_color = C_BRASS_HI if on else (C_BRASS if hov else C_BRASS_DIM)
		draw_style_box(_sb_tab, r)
		if on:
			draw_rect(Rect2(r.position.x + 5 * _s, r.end.y - 4 * _s, r.size.x - 10 * _s, 2.5 * _s), p.hue)
		var col: Color = C_TEXT if on else C_TEXT_DIM
		var icol: Color = p.hue if on else Color(p.hue, 0.60)
		var tw := _font.get_string_size(str(p.title), HORIZONTAL_ALIGNMENT_LEFT, -1, _tab_fs).x
		var isz := minf(15.0 * _s, r.size.y - 8 * _s)
		var total := isz + 6 * _s + tw
		var sx := r.position.x + (r.size.x - total) * 0.5
		Sym.draw(self, str(p.id), Rect2(sx, r.position.y + (r.size.y - isz) * 0.5 - 1 * _s, isz, isz), icol, 1.3 * _s)
		var lh := _font.get_height(_tab_fs)
		_txt(sx + isz + 6 * _s, r.position.y + (r.size.y - lh) * 0.5 - 1 * _s, str(p.title), _tab_fs, col)


func _card_parts(r: Rect2) -> Dictionary:
	## Icon area / label band split. Full: icon on top, label below. Compact: icon left, label right.
	if _compact:
		var iw := 30.0 * _s
		return {"icon_area": Rect2(r.position, Vector2(iw, r.size.y)), "label": Rect2(r.position.x + iw, r.position.y, r.size.x - iw, r.size.y)}
	var ih := 30.0 * _s
	return {"icon_area": Rect2(r.position, Vector2(r.size.x, ih)), "label": Rect2(r.position.x, r.position.y + ih, r.size.x, r.size.y - ih)}


func _draw_cards() -> void:
	var ids: Array = _by_palette.get(_palette, [])
	var hue: Color = _pal_def(_palette).hue
	var mana := float(_state.get("mana", 0.0))
	var cds: Dictionary = _state.get("cooldowns", {})
	var f_label := _fs(12.5 if not _compact else 11.5)
	for i in 9:
		var r := _cards[i]
		if i >= ids.size():
			_sb_card.bg_color = Color(0.04, 0.03, 0.025)
			_sb_card.border_color = Color(C_BRASS_DIM, 0.45)
			draw_style_box(_sb_card, r)
			continue
		var id := str(ids[i])
		var e: Dictionary = _catalogue[id]
		var sel := id == _selected
		var hov := _hover == "card:" + id
		var blocked := _reason(id) != ""
		var ready := bool(e.implemented)
		var poor := float(e.mana) > mana + 0.001
		var parts := _card_parts(r)
		var ia: Rect2 = parts.icon_area
		var lb: Rect2 = parts.label
		var body := hue.darkened(0.80) if ready else Color(0.10, 0.10, 0.10)
		_sb_card.bg_color = body
		_sb_card.border_color = C_BRASS_DIM if ready else Color(0.30, 0.28, 0.25)
		draw_style_box(_sb_card, r)
		# icon area (slightly lighter well) and label band (dark) with a hairline between
		var inset := 2.0 * _s
		draw_rect(ia.grow(-inset), Color(hue.darkened(0.62), 1.0) if ready else Color(0.14, 0.14, 0.14))
		draw_rect(lb.grow(-inset), Color(0, 0, 0, 0.42))
		if _compact:
			draw_line(Vector2(lb.position.x, r.position.y + 4 * _s), Vector2(lb.position.x, r.end.y - 4 * _s), Color(C_BRASS_DIM, 0.6), 1.0 * _s)
		else:
			draw_line(Vector2(r.position.x + 4 * _s, lb.position.y), Vector2(r.end.x - 4 * _s, lb.position.y), Color(C_BRASS_DIM, 0.6), 1.0 * _s)
		# icon
		var isz := (20.0 if _compact else 22.0) * _s
		var ic := ia.get_center() + (Vector2(4, -2) * _s if _compact else Vector2.ZERO)
		var irect := Rect2(ic - Vector2(isz, isz) * 0.5, Vector2(isz, isz))
		var icol := Color(hue, 0.55 if (blocked or not ready) else 0.92)
		if not ready:
			icol = Color(0.45, 0.45, 0.45)
		if _atlas != null and _atlas_idx.has(id):
			var cell := int(_atlas_idx[id])
			var ts := _atlas.get_size() / Vector2(_atlas_cols, _atlas_rows)
			var src := Rect2(Vector2(cell % _atlas_cols, cell / _atlas_cols) * ts, ts)
			draw_texture_rect_region(_atlas, irect.grow(2 * _s), src, Color(0.5, 0.5, 0.5) if (blocked or not ready) else Color.WHITE)
		else:
			Sym.draw(self, _palette, irect, icol, 1.4 * _s)
		# cooldown: dark veil rises with a teal leading edge across the whole cell
		var cd := clampf(float(cds.get(id, 0.0)), 0.0, 1.0)
		if cd > 0.0:
			var cin := r.grow(-2 * _s)
			var ch := cin.size.y * cd
			draw_rect(Rect2(cin.position.x, cin.end.y - ch, cin.size.x, ch), Color(0.05, 0.03, 0.12, 0.50))
			draw_line(Vector2(cin.position.x, cin.end.y - ch), Vector2(cin.end.x, cin.end.y - ch), C_TEAL, 2.0 * _s)
		# label: full title, wrapped to at most two lines and centred in its band
		var lpad := 6.0 * _s
		var lw := lb.size.x - 2.0 * lpad
		var t := _fit(str(e.title), lw, f_label, 2, f_label - 2)
		var lh := _font.get_height(int(t.fs))
		var block := lh * (t.lines as Array).size()
		var ly := lb.position.y + (lb.size.y - block) * 0.5
		var tcol := C_TEXT if ready else Color(0.55, 0.53, 0.50)
		for li in (t.lines as Array).size():
			_txt(lb.position.x + lpad, ly + li * lh, str(t.lines[li]), int(t.fs), tcol, lw, HORIZONTAL_ALIGNMENT_CENTER)
		if blocked and ready:
			draw_rect(r.grow(-2 * _s), Color(0.14, 0.02, 0.02, 0.30))
		# hotkey badge
		var bs := 15.0 * _s
		var b := Rect2(r.position + Vector2(4, 4) * _s if not _compact else r.position + Vector2(3, 3) * _s, Vector2(bs, bs))
		draw_rect(b, Color(0.04, 0.03, 0.02, 0.92))
		draw_rect(b, C_BRASS_DIM, false, 1.0 * _s)
		_text_c(b, str(i + 1), _fs(11.0), C_BRASS_HI)
		# mana cost (icon + number); red when unaffordable
		if float(e.mana) > 0.0 and ready:
			var f_cost := _fs(12.0 if not _compact else 11.0)
			var cs := str(int(e.mana))
			var ccol := C_WARN if poor else C_TEAL
			var cw := _font.get_string_size(cs, HORIZONTAL_ALIGNMENT_LEFT, -1, f_cost).x
			var clh := _font.get_height(f_cost)
			var dsz := clh * 0.85
			if _compact:
				var mx := ia.get_center().x - (cw + dsz + 2 * _s) * 0.5
				var my := r.end.y - clh - 3 * _s
				Sym.draw(self, "mana", Rect2(mx, my + (clh - dsz) * 0.5, dsz, dsz), Color(ccol, 0.9), 1.0)
				_text_o(mx + dsz + 2 * _s, my, cs, f_cost, ccol)
			else:
				var mx2 := ia.end.x - 6 * _s - cw
				var my2 := ia.position.y + (ia.size.y - clh) * 0.5
				Sym.draw(self, "mana", Rect2(mx2 - dsz - 2 * _s, my2 + (clh - dsz) * 0.5, dsz, dsz), Color(ccol, 0.9), 1.0)
				_text_o(mx2, my2, cs, f_cost, ccol)
		if blocked:
			draw_circle(Vector2(r.end.x - 7 * _s, r.position.y + 7 * _s), 3.5 * _s, C_WARN)
		# borders
		if sel:
			draw_rect(r.grow(2 * _s), Color(C_BRASS_HI, 0.30), false, 3.0 * _s)
			draw_rect(r, C_BRASS_HI, false, 2.0 * _s)
		elif hov:
			draw_rect(r, C_BRASS, false, 1.5 * _s)


func _draw_tooltip() -> void:
	if not _hover.begins_with("card:"):
		return
	var id := _hover.substr(5)
	var e: Dictionary = _catalogue.get(id, {})
	if e.is_empty():
		return
	var idx: int = (_by_palette.get(_palette, []) as Array).find(id)
	var anchor := _cards[maxi(idx, 0)]
	var w := minf(300.0 * _s, size.x - 16.0)
	var pad := 12.0 * _s
	var iw := w - 2.0 * pad
	var f_t := _fs(16.0)
	var f_b := _fs(12.5)
	var f_s := _fs(12.0)
	var title := str(e.title)
	var body := str(e.description)
	var reason := _reason(id)
	var gest := "Gesture: " + str(e.gesture) if str(e.gesture) != "" else ""
	var th := _font.get_multiline_string_size(title, HORIZONTAL_ALIGNMENT_LEFT, iw - 34 * _s, f_t).y
	var cl := _cost_line(e) if bool(e.implemented) else "Not yet available"
	var ch := _font.get_multiline_string_size(cl, HORIZONTAL_ALIGNMENT_LEFT, iw, f_s).y
	var bh := 0.0 if body == "" else _font.get_multiline_string_size(body, HORIZONTAL_ALIGNMENT_LEFT, iw, f_b).y
	var gh := 0.0 if gest == "" else _font.get_multiline_string_size(gest, HORIZONTAL_ALIGNMENT_LEFT, iw, f_s).y
	var rh := 0.0 if reason == "" else _font.get_multiline_string_size(reason, HORIZONTAL_ALIGNMENT_LEFT, iw, f_s).y
	var gapv := 5.0 * _s
	var h := pad * 2 + th + gapv + ch + (gapv + bh if bh > 0.0 else 0.0) + (gapv + gh if gh > 0.0 else 0.0) + (gapv + rh if rh > 0.0 else 0.0)
	var pos := Vector2(anchor.get_center().x - w * 0.5, _panel.position.y - h - 10 * _s)
	pos.x = clampf(pos.x, 8 * _s, maxf(size.x - w - 8 * _s, 0.0))
	pos.y = clampf(pos.y, 4.0, maxf(size.y - h - 4.0, 4.0))
	var r := Rect2(pos, Vector2(w, h))
	draw_style_box(_sb_parch, r)
	var x := r.position.x + pad
	var y := r.position.y + pad
	_para(x, y, title, iw - 34 * _s, f_t, C_INK)
	_txt(x, y, "[%d]" % (idx + 1), f_s, Color(C_INK, 0.6), iw, HORIZONTAL_ALIGNMENT_RIGHT)
	y += th + gapv
	_para(x, y, cl, iw, f_s, Color(0.12, 0.30, 0.38))
	y += ch
	if bh > 0.0:
		y += gapv
		_para(x, y, body, iw, f_b, C_INK)
		y += bh
	if gh > 0.0:
		y += gapv
		_para(x, y, gest, iw, f_s, Color(C_INK, 0.75))
		y += gh
	if rh > 0.0:
		y += gapv
		_para(x, y, reason, iw, f_s, C_INK_WARN)


# ---------------------------------------------------------------- mana orb

func _build_orb_nodes() -> void:
	if _orb_rect != null:
		return
	if ResourceLoader.exists(ORB_SHADER):
		_orb_rect = ColorRect.new()
		_orb_rect.name = "ManaOrbShader"
		_orb_rect.color = Color.WHITE
		_orb_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
		_orb_mat = ShaderMaterial.new()
		_orb_mat.shader = load(ORB_SHADER)
		_orb_rect.material = _orb_mat
		add_child(_orb_rect)
	_orb_overlay = Control.new()
	_orb_overlay.name = "ManaOrbOverlay"
	_orb_overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_orb_overlay.draw.connect(_draw_orb_overlay)
	add_child(_orb_overlay)


func _place_orb_nodes() -> void:
	if _orb_overlay == null:
		return
	var rect := Rect2((_orb_c - Vector2(_orb_r, _orb_r)).round(), Vector2(_orb_r, _orb_r).round() * 2.0)
	for n in [_orb_rect, _orb_overlay]:
		if n != null:
			(n as Control).position = rect.position
			(n as Control).size = rect.size
	_push_orb_uniforms()


func _orb_redraw() -> void:
	if _orb_overlay != null:
		_orb_overlay.queue_redraw()


func _track_mana() -> void:
	var mana := float(_state.get("mana", 0.0))
	var mx := maxf(float(_state.get("max_mana", 100.0)), 1.0)
	_fill_target = clampf(mana / mx, 0.0, 1.0)
	if not _fill_init or absf(mx - _prev_max) > 0.001:
		_fill = _fill_target      # first sample / max changed: no animated sweep
		_fill_init = true
	elif _prev_mana >= 0.0:
		var d := mana - _prev_mana
		if d < -0.4:
			_spend_pulse = clampf(-d / maxf(mx * 0.12, 1.0), 0.35, 1.0)
		elif _prev_mana < mx - 0.05 and mana >= mx - 0.05:
			_gain_pulse = 1.0     # reached full
		elif d >= maxf(mx * 0.04, 1.0):
			_gain_pulse = 0.7     # sudden refill; slow regen never pulses
	_prev_mana = mana
	_prev_max = mx
	_push_orb_uniforms()


func _push_orb_uniforms() -> void:
	if _orb_mat == null:
		return
	var mana := float(_state.get("mana", 0.0))
	var mx := maxf(float(_state.get("max_mana", 100.0)), 1.0)
	var cost := float(_state.get("spell_cost", _sel_entry().get("mana", 0.0)))
	_orb_mat.set_shader_parameter("fill", _fill)
	_orb_mat.set_shader_parameter("cost_frac", clampf(cost / mx, 0.0, 1.0))
	_orb_mat.set_shader_parameter("afford", 1.0 if mana + 0.001 >= cost else 0.0)
	_orb_mat.set_shader_parameter("gain_pulse", _gain_pulse * _gain_pulse * (3.0 - 2.0 * _gain_pulse))
	_orb_mat.set_shader_parameter("spend_pulse", _spend_pulse * _spend_pulse)
	if _fill != _last_uniform_fill:
		_last_uniform_fill = _fill


func _draw_orb_overlay() -> void:
	## Drawn above the shader: glass rim, numerals and the pending-cost badge.
	var ci := _orb_overlay
	var r := _orb_r
	var c := Vector2(r, r)
	var mana := float(_state.get("mana", 0.0))
	var mx := maxf(float(_state.get("max_mana", 100.0)), 1.0)
	var cost := float(_state.get("spell_cost", _sel_entry().get("mana", 0.0)))
	var afford := mana + 0.001 >= cost
	if _orb_mat == null:   # shader missing: plain flat fill so the panel stays usable
		var lvl := c.y + r - 2.0 * r * clampf(mana / mx, 0.0, 1.0)
		var pts := PackedVector2Array()
		for i in 48:
			var a := TAU * i / 48.0
			pts.append(Vector2(c.x + cos(a) * (r - 1.0), maxf(c.y + sin(a) * (r - 1.0), lvl)))
		if mana > 0.0:
			ci.draw_colored_polygon(pts, Color(0.30, 0.16, 0.70))
	ci.draw_arc(c, r - 1.0 * _s, 0, TAU, 96, Color(0.02, 0.02, 0.05, 0.9), 2.0 * _s, true)
	ci.draw_arc(c, r - 3.0 * _s, PI * 1.55, PI * 2.25, 32, Color(0.75, 0.85, 1.0, 0.16), 1.2 * _s, true)
	var fs_big := maxi(int(r * 0.37), 14)
	var fs_sep := maxi(int(fs_big * 0.66), MIN_FONT)
	var fs_lab := maxi(int(r * 0.155), MIN_FONT)
	var ol := maxi(int(3.0 * _s), 2)
	# caption
	var cap := "MANA"
	var cw := _font.get_string_size(cap, HORIZONTAL_ALIGNMENT_LEFT, -1, fs_lab).x
	var cy := c.y - fs_big * 0.62
	ci.draw_string_outline(_font, Vector2(c.x - cw * 0.5, cy).round(), cap, HORIZONTAL_ALIGNMENT_LEFT, -1, fs_lab, ol, Color(0, 0, 0, 0.9))
	ci.draw_string(_font, Vector2(c.x - cw * 0.5, cy).round(), cap, HORIZONTAL_ALIGNMENT_LEFT, -1, fs_lab, Color(0.78, 0.92, 1.0))
	# numerals: mana / max
	var cur := str(floori(mana + 0.0001))
	var mxs := " / %d" % roundi(mx)
	var w1 := _font.get_string_size(cur, HORIZONTAL_ALIGNMENT_LEFT, -1, fs_big).x
	var w2 := _font.get_string_size(mxs, HORIZONTAL_ALIGNMENT_LEFT, -1, fs_sep).x
	var nx := c.x - (w1 + w2) * 0.5
	var ny := c.y + fs_big * 0.34
	ci.draw_string_outline(_font, Vector2(nx, ny).round(), cur, HORIZONTAL_ALIGNMENT_LEFT, -1, fs_big, ol + 1, Color(0, 0, 0, 0.9))
	ci.draw_string(_font, Vector2(nx, ny).round(), cur, HORIZONTAL_ALIGNMENT_LEFT, -1, fs_big, Color(0.98, 0.95, 0.88))
	ci.draw_string_outline(_font, Vector2(nx + w1, ny).round(), mxs, HORIZONTAL_ALIGNMENT_LEFT, -1, fs_sep, ol, Color(0, 0, 0, 0.9))
	ci.draw_string(_font, Vector2(nx + w1, ny).round(), mxs, HORIZONTAL_ALIGNMENT_LEFT, -1, fs_sep, Color(0.82, 0.86, 0.95))
	# pending cost badge
	if cost > 0.0:
		var bc := Vector2(c.x, c.y + r * 0.63)
		var br := maxf(r * 0.20, 12.0)
		ci.draw_circle(bc, br, Color(0.04, 0.035, 0.06, 0.94))
		ci.draw_arc(bc, br, 0, TAU, 40, C_BRASS if afford else C_WARN, 1.6 * _s, true)
		var fs_c := maxi(int(br * 0.95), MIN_FONT)
		var ct := "-%d" % int(cost)
		var ctw := _font.get_string_size(ct, HORIZONTAL_ALIGNMENT_LEFT, -1, fs_c).x
		ci.draw_string(_font, Vector2(bc.x - ctw * 0.5, bc.y + fs_c * 0.35).round(), ct, HORIZONTAL_ALIGNMENT_LEFT, -1, fs_c, C_BRASS_HI if afford else C_WARN)


# ----------------------------------------------------------------- helpers

func _r(o: Vector2, x: float, y: float, w: float, h: float) -> Rect2:
	return Rect2((o + Vector2(x, y) * _s).round(), (Vector2(w, h) * _s).round())


func _fs(base: float) -> int:
	return maxi(int(roundf(base * _s)), MIN_FONT)


func _txt(x: float, y_top: float, t: String, fs: int, col: Color, w := -1.0, align := HORIZONTAL_ALIGNMENT_LEFT) -> float:
	## Draw one line with its top at y_top. Returns the line height.
	draw_string(_font, Vector2(x, y_top + _font.get_ascent(fs)).round(), t, align, w, fs, col)
	return _font.get_height(fs)


func _text_o(x: float, y_top: float, t: String, fs: int, col: Color) -> void:
	var p := Vector2(x, y_top + _font.get_ascent(fs)).round()
	draw_string_outline(_font, p, t, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, maxi(int(3 * _s), 2), Color(0, 0, 0, 0.85))
	draw_string(_font, p, t, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, col)


func _text_c(r: Rect2, t: String, fs: int, col: Color) -> void:
	var lh := _font.get_height(fs)
	draw_string(_font, Vector2(r.position.x, r.position.y + (r.size.y - lh) * 0.5 + _font.get_ascent(fs)).round(), t, HORIZONTAL_ALIGNMENT_CENTER, r.size.x, fs, col)


func _para(x: float, y_top: float, t: String, w: float, fs: int, col: Color) -> float:
	## Word-wrapped paragraph (unbounded lines). Returns height.
	draw_multiline_string(_font, Vector2(x, y_top + _font.get_ascent(fs)).round(), t, HORIZONTAL_ALIGNMENT_LEFT, w, fs, -1, col)
	return _font.get_multiline_string_size(t, HORIZONTAL_ALIGNMENT_LEFT, w, fs).y


func _lines(x: float, y_top: float, t: String, w: float, fs: int, col: Color, max_lines: int) -> float:
	var f := _fit(t, w, fs, max_lines, fs - 1)
	return _draw_fit(x, y_top, f, col)


func _draw_fit(x: float, y_top: float, f: Dictionary, col: Color) -> float:
	var fs := int(f.fs)
	var lh := _font.get_height(fs)
	for i in (f.lines as Array).size():
		_txt(x, y_top + i * lh, str(f.lines[i]), fs, col)
	return lh * (f.lines as Array).size()


func _wrap(text: String, w: float, fs: int) -> Array[String]:
	var lines: Array[String] = []
	var cur := ""
	for word in text.split(" ", false):
		var trial := word if cur == "" else cur + " " + word
		if cur != "" and _font.get_string_size(trial, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x > w:
			lines.append(cur)
			cur = word
		else:
			cur = trial
	if cur != "" or lines.is_empty():
		lines.append(cur)
	return lines


func _ellipsize(t: String, w: float, fs: int) -> String:
	if _font.get_string_size(t, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x <= w:
		return t
	while t.length() > 1 and _font.get_string_size(t + "…", HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x > w:
		t = t.left(t.length() - 1)
	return t.strip_edges() + "…"


func _fit(text: String, w: float, fs0: int, max_lines: int, fs_floor: int) -> Dictionary:
	## Word-wrap by real glyph advances. Shrinks at most to fs_floor (>= MIN_FONT) before it
	## gives up; only then does the final line get an ellipsis (hover tooltip shows the full text).
	var key := "%s|%d|%d|%d|%d" % [text, int(w), fs0, max_lines, fs_floor]
	if _fit_cache.has(key):
		return _fit_cache[key]
	if _fit_cache.size() > 600:
		_fit_cache.clear()
	var fs := fs0
	var floor_fs := maxi(fs_floor, MIN_FONT)
	var lines: Array[String] = []
	while true:
		lines = _wrap(text, w, fs)
		var ok := lines.size() <= max_lines
		for l in lines:
			if _font.get_string_size(l, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x > w:
				ok = false
		if ok or fs <= floor_fs:
			break
		fs -= 1
	var truncated := false
	if lines.size() > max_lines:
		truncated = true
		var rest := " ".join(lines.slice(max_lines - 1))
		lines = lines.slice(0, max_lines - 1)
		lines.append(_ellipsize(rest, w, fs))
	for i in lines.size():
		if _font.get_string_size(lines[i], HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x > w:
			lines[i] = _ellipsize(lines[i], w, fs)
			truncated = true
	var out := {"lines": lines, "fs": fs, "truncated": truncated}
	_fit_cache[key] = out
	return out


func _num(v: float) -> String:
	return String.num(v, 1).trim_suffix(".0")


func _cost_line(e: Dictionary) -> String:
	var parts: Array[String] = []
	parts.append(str(e.cost) if str(e.get("cost", "")) != "" else "Mana %d" % int(e.get("mana", 0)))
	if str(e.get("cost", "")) == "" and float(e.get("lumber", 0)) > 0.0:
		parts.append("Lumber %d" % int(e.lumber))
	if float(e.get("cooldown", 0)) > 0.0:
		parts.append("Cooldown %ss" % _num(float(e.cooldown)))
	return "  ·  ".join(parts)


func _reason(id: String) -> String:
	var av: Dictionary = _state.get("availability", {})
	return str(av.get(id, ""))


func _sel_entry() -> Dictionary:
	return _catalogue.get(_selected, {})


func _pal_def(id: String) -> Dictionary:
	for p in PALETTES:
		if p.id == id:
			return p
	return PALETTES[0]


func _default_palette(id: String) -> String:
	for pal in DEFAULT_ORDER:
		if id in DEFAULT_ORDER[pal]:
			return pal
	return "land"


func _build_styles() -> void:
	_sb_card = _mk_sb(Color.BLACK, C_BRASS_DIM, 1.5, 4)
	_sb_plaque = _mk_sb(C_SLATE, C_BRASS_DIM, 1.0, 6)
	_sb_plaque.shadow_color = Color(0, 0, 0, 0.4)
	_sb_plaque.shadow_size = int(4 * _s)
	_sb_tab = _mk_sb(Color.BLACK, C_BRASS_DIM, 1.0, 4)
	_sb_parch = _mk_sb(C_PARCH, Color(0.45, 0.30, 0.14), 2.0, 5)
	_sb_parch.shadow_color = Color(0, 0, 0, 0.45)
	_sb_parch.shadow_size = int(8 * _s)


func _mk_sb(bg: Color, border: Color, bw: float, radius: float) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.border_color = border
	sb.set_border_width_all(maxi(int(roundf(bw * _s)), 1))
	sb.set_corner_radius_all(int(radius * _s))
	sb.anti_aliasing = true
	return sb
