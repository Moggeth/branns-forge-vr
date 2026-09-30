extends Control
class_name WorldBuilderCommandPanel
## Brann's Forge RTS command panel. One Control, everything drawn in _draw():
## no per-card nodes, no shader materials. Full-rect overlay; only the panel
## silhouette accepts mouse input (see _has_point), so the world stays clickable.

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
const C_VIOLET := Color(0.50, 0.30, 0.92)
const C_MANA_DEEP := Color(0.16, 0.10, 0.46)
const C_TEXT := Color(0.93, 0.89, 0.80)
const C_TEXT_DIM := Color(0.62, 0.58, 0.50)
const C_WARN := Color(0.95, 0.42, 0.32)
const C_PARCH := Color(0.92, 0.85, 0.69, 0.98)
const C_INK := Color(0.19, 0.13, 0.08)
const C_INK_WARN := Color(0.62, 0.14, 0.08)

# Base layout at 1920x1080 (scale 1). All pixel values are multiplied by _s.
const BASE_W := 866.0
const BASE_H := 218.0
const CARD := 56.0
const GAP := 5.0
const MIN_SCALE := 0.70
const MAX_SCALE := 2.4

var _catalogue: Dictionary = {}          # id -> normalized entry
var _by_palette: Dictionary = {}         # palette id -> Array[String]
var _state: Dictionary = {}
var _palette := "land"
var _selected := ""
var _hover := ""                         # "card:<id>", "tab:<pal>", "regen:<i>", "orb"
var _t := 0.0

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
var _font: Font
var _sb_card: StyleBoxFlat
var _sb_plaque: StyleBoxFlat
var _sb_tab: StyleBoxFlat
var _sb_parch: StyleBoxFlat


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	focus_mode = Control.FOCUS_NONE
	_font = ThemeDB.fallback_font
	resized.connect(func() -> void: layout_for_size(size))
	layout_for_size(size)


func _process(delta: float) -> void:
	_t += delta
	if is_visible_in_tree():
		queue_redraw()


# ---------------------------------------------------------------- public API

func setup(catalogue: Array) -> void:
	_catalogue.clear()
	_by_palette.clear()
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
		}
		_catalogue[id] = e
		if (_by_palette[pal] as Array).size() < 9:
			(_by_palette[pal] as Array).append(id)
	queue_redraw()


func update_state(state: Dictionary) -> void:
	_state = state
	if state.has("selected"):
		_selected = str(state.selected)
	if state.has("palette") and _by_palette.has(str(state.palette)):
		_palette = str(state.palette)
	queue_redraw()


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
	var s := minf(sz.y / 1080.0, sz.x * 0.96 / BASE_W)
	_s = clampf(s, MIN_SCALE, MAX_SCALE)
	var w := roundf(BASE_W * _s)
	var h := roundf(BASE_H * _s)
	_panel = Rect2(roundf((sz.x - w) * 0.5), sz.y - h, w, h)
	var o := _panel.position
	_orb_c = o + Vector2(96, 104) * _s
	_orb_r = 70.0 * _s
	_regen.clear()
	for i in 2:
		_regen.append(_r(o, 38 + i * 60, 186, 56, 22))
	_info = _r(o, 190, 14, 372, BASE_H - 28)
	_tabs.clear()
	for i in PALETTES.size():
		_tabs.append(_r(o, 574, 20 + i * 45.5, 92, 41))
	_cards.clear()
	for i in 9:
		_cards.append(_r(o, 676 + (i % 3) * (CARD + GAP), 20 + (i / 3) * (CARD + GAP), CARD, CARD))
	_build_styles()
	queue_redraw()


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
	_selected = id  # optimistic; update_state is authoritative
	spell_selected.emit(id)
	queue_redraw()


func _choose_palette(id: String) -> void:
	_palette = id
	palette_selected.emit(id)
	queue_redraw()


# -------------------------------------------------------------------- draw

func _draw() -> void:
	if _font == null:
		return
	_draw_frame()
	_draw_orb()
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
	# wood grain bands, very faint
	for i in 5:
		var y := p.position.y + (0.25 + i * 0.17) * p.size.y
		draw_line(Vector2(p.position.x + 8 * _s, y), Vector2(p.end.x - 8 * _s, y + 3 * _s), Color(C_WOOD, 0.35), 1.0 * _s)
	var edge := poly.duplicate()
	edge.append(poly[0])
	draw_polyline(edge, C_BRASS_DIM, 3.0 * _s, true)
	draw_polyline(PackedVector2Array([poly[0], poly[1], poly[2], poly[3]]), C_BRASS, 1.5 * _s, true)
	# brass rivets at chamfers
	for q in [poly[1], poly[2]]:
		draw_circle(q + Vector2(0, 6 * _s), 2.5 * _s, C_BRASS_HI)
	# divider between info plaque and command card
	draw_line(_o(568, 16), _o(568, BASE_H - 12), C_BRASS_DIM, 1.0 * _s)


func _draw_orb() -> void:
	var c := _orb_c
	var r := _orb_r
	var mana := float(_state.get("mana", 0.0))
	var mx := maxf(float(_state.get("max_mana", 100.0)), 1.0)
	var cost := float(_state.get("spell_cost", _sel_entry().get("mana", 0.0)))
	var frac := clampf(mana / mx, 0.0, 1.0)
	var afford := mana + 0.001 >= cost
	# bezel
	draw_circle(c, r + 9 * _s, Color(0.05, 0.035, 0.025))
	draw_arc(c, r + 6 * _s, 0, TAU, 72, C_BRASS_DIM, 5 * _s, true)
	draw_arc(c, r + 7.5 * _s, PI * 1.05, PI * 1.95, 40, C_BRASS, 1.5 * _s, true)
	for i in 8:
		var a := TAU * i / 8.0 + PI / 8.0
		draw_circle(c + Vector2(cos(a), sin(a)) * (r + 6 * _s), 1.8 * _s, C_BRASS_HI)
	draw_circle(c, r, Color(0.025, 0.03, 0.06))
	# liquid
	var level := c.y + r - 2.0 * r * frac
	var wave_amp := 2.2 * _s if frac > 0.02 and frac < 0.98 else 0.0
	var pts := PackedVector2Array()
	var cols := PackedColorArray()
	for i in 56:
		var a := TAU * i / 56.0
		var q := c + Vector2(cos(a), sin(a)) * (r - 1.0)
		q.y = maxf(q.y, level + sin(_t * 1.6 + q.x / (9.0 * _s)) * wave_amp)
		pts.append(q)
		cols.append(C_VIOLET.lerp(C_MANA_DEEP, clampf((q.y - (c.y - r)) / (2 * r), 0, 1)).lerp(C_TEAL, 0.12 * (1.0 - absf(q.x - c.x) / r)))
	if frac > 0.0:
		draw_polygon(pts, cols)
		draw_line(Vector2(c.x - sqrt(maxf(r * r - pow(level - c.y, 2), 0)), level), Vector2(c.x + sqrt(maxf(r * r - pow(level - c.y, 2), 0)), level), Color(C_TEAL, 0.55), 1.5 * _s)
	# selected cost band (what the cast will consume)
	if cost > 0.0:
		var after := c.y + r - 2.0 * r * clampf((mana - cost) / mx, 0.0, 1.0)
		var top := level if afford else c.y + r - 2.0 * r * clampf(cost / mx, 0.0, 1.0)
		var band := PackedVector2Array()
		for i in 56:
			var a := TAU * i / 56.0
			var q := c + Vector2(cos(a), sin(a)) * (r - 1.0)
			q.y = clampf(q.y, top, after if afford else c.y + r)
			band.append(q)
		var pulse := 0.30 + 0.12 * sin(_t * 3.0)
		draw_colored_polygon(band, Color(C_BRASS_HI, pulse) if afford else Color(C_WARN, pulse + 0.1))
	# glass highlight
	draw_arc(c, r * 0.82, PI * 1.12, PI * 1.46, 18, Color(1, 1, 1, 0.20), 3.0 * _s, true)
	draw_circle(c + Vector2(-0.38, -0.46) * r, 3.0 * _s, Color(1, 1, 1, 0.22))
	# numbers
	var big := int(20 * _s)
	_text_outlined(Vector2(c.x - r, c.y + 7 * _s), "%d / %d" % [int(mana), int(mx)], 2 * r, big, C_TEXT, HORIZONTAL_ALIGNMENT_CENTER)
	_text_outlined(Vector2(c.x - r, c.y - 16 * _s), "MANA", 2 * r, int(10 * _s), Color(C_TEAL, 0.9), HORIZONTAL_ALIGNMENT_CENTER)
	if cost > 0.0:
		_text_outlined(Vector2(c.x - r, c.y + 26 * _s), "-%d" % int(cost), 2 * r, int(13 * _s), C_BRASS_HI if afford else C_WARN, HORIZONTAL_ALIGNMENT_CENTER)
	# regen preset toggle
	var cur := float(_state.get("regen", _state.get("regen_multiplier", 1.0)))
	for i in _regen.size():
		var rr := _regen[i]
		var on := is_equal_approx(cur, float(REGEN_PRESETS[i].mult))
		var hov := _hover == "regen:%d" % i
		_sb_tab.bg_color = Color(0.10, 0.22, 0.24) if on else Color(0.07, 0.06, 0.05)
		_sb_tab.border_color = C_TEAL if on else (C_BRASS if hov else C_BRASS_DIM)
		draw_style_box(_sb_tab, rr)
		var lbl := "%s %s" % [REGEN_PRESETS[i].hint, REGEN_PRESETS[i].label]
		_text(Vector2(rr.position.x, rr.position.y + rr.size.y * 0.5 + 4 * _s), lbl, rr.size.x, int(10 * _s), C_TEXT if on else C_TEXT_DIM, HORIZONTAL_ALIGNMENT_CENTER)


func _draw_info() -> void:
	var r := _info
	draw_style_box(_sb_plaque, r)
	var x := r.position.x + 14 * _s
	var w := r.size.x - 28 * _s
	var y := r.position.y + 26 * _s
	var pal := _pal_def(_palette)
	_text(Vector2(x, y), str(pal.title).to_upper(), w, int(11 * _s), Color(pal.hue, 0.95))
	_text(Vector2(x, y), str(pal.key), w, int(11 * _s), C_TEXT_DIM, HORIZONTAL_ALIGNMENT_RIGHT)
	y += 26 * _s
	var e := _sel_entry()
	if e.is_empty():
		_text(Vector2(x, y), "Choose a spell", w, int(18 * _s), C_TEXT_DIM)
		y += 22 * _s
		_text(Vector2(x, y), "1-9 select  ·  F1-F4 palettes  ·  Esc cancel", w, int(11 * _s), C_TEXT_DIM)
	else:
		_text(Vector2(x, y), str(e.title), w, int(18 * _s), C_TEXT)
		var reason := _reason(str(e.id))
		y += 22 * _s
		var line := _cost_line(e)
		if str(e.gesture) != "":
			line += "   ·   " + str(e.gesture)
		_text(Vector2(x, y), line, w, int(11 * _s), C_TEAL)
		if reason != "":
			y += 18 * _s
			_text(Vector2(x, y), reason, w, int(12 * _s), C_WARN)
	# backend feedback
	var fb := str(_state.get("feedback", ""))
	if fb != "":
		draw_multiline_string(_font, Vector2(x, r.end.y - 44 * _s), fb, HORIZONTAL_ALIGNMENT_LEFT, w, int(12 * _s), 2, Color(C_TEXT, 0.85))
	# resource / world strip
	var foot := "Lumber %d" % int(_state.get("wood", 0))
	if _state.has("helpers"):
		foot += "     Helpers %s" % str(_state.helpers)
	if _state.has("seed"):
		foot += "     Seed %s" % str(_state.seed)
	draw_line(Vector2(x, r.end.y - 26 * _s), Vector2(x + w, r.end.y - 26 * _s), Color(C_BRASS_DIM, 0.6), 1.0 * _s)
	_text(Vector2(x, r.end.y - 9 * _s), foot, w, int(11 * _s), C_TEXT_DIM)


func _draw_tabs() -> void:
	for i in PALETTES.size():
		var p: Dictionary = PALETTES[i]
		var r := _tabs[i]
		var on := str(p.id) == _palette
		var hov := _hover == "tab:" + str(p.id)
		_sb_tab.bg_color = Color(p.hue.darkened(0.72), 1.0) if on else Color(0.07, 0.055, 0.045)
		_sb_tab.border_color = C_BRASS_HI if on else (C_BRASS if hov else C_BRASS_DIM)
		draw_style_box(_sb_tab, r)
		if on:
			draw_rect(Rect2(r.position + Vector2(3, 4) * _s, Vector2(3 * _s, r.size.y - 8 * _s)), p.hue)
		_text(r.position + Vector2(12 * _s, 17 * _s), str(p.title), r.size.x - 16 * _s, int(12 * _s), C_TEXT if on else C_TEXT_DIM)
		_text(r.position + Vector2(12 * _s, 33 * _s), str(p.key), r.size.x - 16 * _s, int(9 * _s), Color(C_BRASS, 0.8))


func _draw_cards() -> void:
	var ids: Array = _by_palette.get(_palette, [])
	var hue: Color = _pal_def(_palette).hue
	var mana := float(_state.get("mana", 0.0))
	var cds: Dictionary = _state.get("cooldowns", {})
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
		var poor := float(e.mana) > mana + 0.001
		_sb_card.bg_color = hue.darkened(0.80)
		_sb_card.border_color = C_BRASS_DIM
		draw_style_box(_sb_card, r)
		var inner := r.grow(-3 * _s)
		# icon or fallback silhouette
		if _atlas != null and _atlas_idx.has(id):
			var cell := int(_atlas_idx[id])
			var ts := _atlas.get_size() / Vector2(_atlas_cols, _atlas_rows)
			var src := Rect2(Vector2(cell % _atlas_cols, cell / _atlas_cols) * ts, ts)
			draw_texture_rect_region(_atlas, inner, src, Color(0.55, 0.55, 0.6) if blocked else Color.WHITE)
		else:
			draw_rect(Rect2(inner.position, Vector2(inner.size.x, inner.size.y * 0.5)), Color(hue, 0.10))
			_draw_glyph(inner, _palette, i, Color(hue, 0.55 if blocked else 0.85))
		# title strip
		var strip := Rect2(inner.position.x, inner.end.y - 14 * _s, inner.size.x, 14 * _s)
		draw_rect(strip, Color(0, 0, 0, 0.62))
		_text(Vector2(strip.position.x, strip.end.y - 3.5 * _s), str(e.title), strip.size.x, int(9.5 * _s), C_TEXT, HORIZONTAL_ALIGNMENT_CENTER)
		# cooldown: dark veil drains downward-to-up with a teal leading edge
		var cd := clampf(float(cds.get(id, 0.0)), 0.0, 1.0)
		if cd > 0.0:
			var ch := inner.size.y * cd
			draw_rect(Rect2(inner.position.x, inner.end.y - ch, inner.size.x, ch), Color(0.05, 0.03, 0.12, 0.66))
			draw_line(Vector2(inner.position.x, inner.end.y - ch), Vector2(inner.end.x, inner.end.y - ch), C_TEAL, 2.0 * _s)
		if blocked:
			draw_rect(inner, Color(0.12, 0.02, 0.02, 0.35))
		# hotkey badge
		var b := Rect2(r.position + Vector2(2, 2) * _s, Vector2(14, 14) * _s)
		draw_rect(b, Color(0.04, 0.03, 0.02, 0.9))
		draw_rect(b, C_BRASS_DIM, false, 1.0 * _s)
		_text(Vector2(b.position.x, b.end.y - 3 * _s), str(i + 1), b.size.x, int(10 * _s), C_BRASS_HI, HORIZONTAL_ALIGNMENT_CENTER)
		# mana cost
		if float(e.mana) > 0.0:
			_text_outlined(Vector2(r.position.x, r.position.y + 14 * _s), str(int(e.mana)), r.size.x - 4 * _s, int(10 * _s), C_WARN if poor else C_TEAL, HORIZONTAL_ALIGNMENT_RIGHT)
		if blocked:
			draw_circle(Vector2(r.end.x - 7 * _s, r.end.y - 21 * _s), 4 * _s, C_WARN)
		# borders
		if sel:
			var glow := 0.55 + 0.25 * sin(_t * 2.4)
			draw_rect(r.grow(2 * _s), Color(C_BRASS_HI, glow * 0.45), false, 3.0 * _s)
			draw_rect(r, C_BRASS_HI, false, 2.0 * _s)
		elif hov:
			draw_rect(r, C_BRASS, false, 1.5 * _s)


func _draw_glyph(r: Rect2, pal: String, variant: int, col: Color) -> void:
	## Readable category silhouettes while the illustrated atlas loads.
	var c := r.get_center() - Vector2(0, 6 * _s)
	var u := r.size.x * 0.26
	match pal:
		"land":
			draw_colored_polygon(PackedVector2Array([c + Vector2(-1.4, 0.8) * u, c + Vector2(-0.4, -0.7) * u, c + Vector2(0.1, 0.0) * u, c + Vector2(0.6, -0.9) * u, c + Vector2(1.4, 0.8) * u]), col)
		"life":
			draw_rect(Rect2(c + Vector2(-0.12, 0.2) * u, Vector2(0.24, 0.6) * u), col.darkened(0.3))
			draw_circle(c + Vector2(0, -0.25) * u, 0.62 * u, col)
			if variant % 2 == 1:
				draw_circle(c + Vector2(-0.75, 0.1) * u, 0.38 * u, col.darkened(0.15))
		"construction":
			draw_rect(Rect2(c + Vector2(-1.0, -0.2) * u, Vector2(2.0, 1.0) * u), col)
			draw_colored_polygon(PackedVector2Array([c + Vector2(-1.2, -0.2) * u, c + Vector2(0, -1.0) * u, c + Vector2(1.2, -0.2) * u]), col.lightened(0.1))
			draw_rect(Rect2(c + Vector2(-0.25, 0.25) * u, Vector2(0.5, 0.55) * u), Color(0, 0, 0, 0.5))
		_:
			draw_colored_polygon(PackedVector2Array([c + Vector2(-0.9, -0.9) * u, c + Vector2(0.9, -0.9) * u, c + Vector2(0.9, 0.1) * u, c + Vector2(0, 0.95) * u, c + Vector2(-0.9, 0.1) * u]), col)


func _draw_tooltip() -> void:
	if not _hover.begins_with("card:"):
		return
	var id := _hover.substr(5)
	var e: Dictionary = _catalogue.get(id, {})
	if e.is_empty():
		return
	var idx: int = (_by_palette.get(_palette, []) as Array).find(id)
	var anchor := _cards[maxi(idx, 0)]
	var w := 300.0 * _s
	var pad := 12.0 * _s
	var body := str(e.description)
	var fs := int(12 * _s)
	var body_h := 0.0 if body == "" else _font.get_multiline_string_size(body, HORIZONTAL_ALIGNMENT_LEFT, w - 2 * pad, fs).y
	var reason := _reason(id)
	var h := pad * 2 + 22 * _s + 18 * _s + body_h + (18 * _s if str(e.gesture) != "" else 0.0) + (18 * _s if reason != "" else 0.0)
	var pos := Vector2(anchor.get_center().x - w * 0.5, _panel.position.y - h - 10 * _s)
	pos.x = clampf(pos.x, 8 * _s, size.x - w - 8 * _s)
	var r := Rect2(pos, Vector2(w, h))
	draw_style_box(_sb_parch, r)
	var x := r.position.x + pad
	var y := r.position.y + pad + 15 * _s
	_text(Vector2(x, y), str(e.title), w - 2 * pad, int(16 * _s), C_INK)
	_text(Vector2(x, y), "[%d]" % (idx + 1), w - 2 * pad, int(11 * _s), Color(C_INK, 0.6), HORIZONTAL_ALIGNMENT_RIGHT)
	y += 20 * _s
	_text(Vector2(x, y), _cost_line(e), w - 2 * pad, int(11 * _s), Color(0.12, 0.30, 0.38))
	y += 8 * _s
	if body != "":
		draw_multiline_string(_font, Vector2(x, y + fs), body, HORIZONTAL_ALIGNMENT_LEFT, w - 2 * pad, fs, -1, C_INK)
		y += body_h
	if str(e.gesture) != "":
		y += 16 * _s
		_text(Vector2(x, y), "Gesture: " + str(e.gesture), w - 2 * pad, int(11 * _s), Color(C_INK, 0.75))
	if reason != "":
		y += 18 * _s
		_text(Vector2(x, y), reason, w - 2 * pad, int(12 * _s), C_INK_WARN)


# ----------------------------------------------------------------- helpers

func _r(o: Vector2, x: float, y: float, w: float, h: float) -> Rect2:
	return Rect2((o + Vector2(x, y) * _s).round(), (Vector2(w, h) * _s).round())


func _o(x: float, y: float) -> Vector2:
	return _panel.position + Vector2(x, y) * _s


func _text(pos: Vector2, t: String, w: float, fs: int, col: Color, align := HORIZONTAL_ALIGNMENT_LEFT) -> void:
	draw_string(_font, pos.round(), t, align, w, maxi(fs, 8), col, TextServer.JUSTIFICATION_NONE)


func _text_outlined(pos: Vector2, t: String, w: float, fs: int, col: Color, align := HORIZONTAL_ALIGNMENT_LEFT) -> void:
	draw_string_outline(_font, pos.round(), t, align, w, maxi(fs, 8), maxi(int(3 * _s), 2), Color(0, 0, 0, 0.85))
	draw_string(_font, pos.round(), t, align, w, maxi(fs, 8), col)


func _cost_line(e: Dictionary) -> String:
	var parts: Array[String] = []
	parts.append(str(e.cost) if str(e.get("cost", "")) != "" else "Mana %d" % int(e.get("mana", 0)))
	if str(e.get("cost", "")) == "" and float(e.get("lumber", 0)) > 0.0:
		parts.append("Lumber %d" % int(e.lumber))
	if float(e.get("cooldown", 0)) > 0.0:
		parts.append("Cooldown %ss" % str(snappedf(float(e.cooldown), 0.1)))
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
